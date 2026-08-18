# B-D.13.2 I2S Linux 驱动与 ASoC

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] | 预计阅读时间：40 分钟

## 本节导读

13.1 解决了线怎么接、时序怎么对，本节解决 Linux 里驱动怎么组织。嵌入式音频硬件是"SoC 内部 I2S 控制器 + 外部 Codec"的两片结构，内核为此专门设计了 ASoC（ALSA System on Chip）框架：Platform 驱动管 SoC 侧，Codec 驱动管芯片侧，Machine 层把两边粘起来——你在项目里真正要写的基本只有 Machine 层，而且多数情况设备树就够了。

本节覆盖：ASoC 三层架构与各自职责、DAPM 自动功耗管理的工作方式、`simple-audio-card` 设备树的完整配置与每个属性的含义、ALSA 用户态工具链、"没声音"的系统化排障流程。完整的 codec 上电放音/录音实战在 13.4。

## ASoC 三层架构

```
 用户空间：aplay / arecord / amixer / 你的应用
 ──────────────────────────────────────────────
 ALSA 核心：snd_pcm（数据流）、snd_ctl（控制接口）
 ──────────────────────────────────────────────
 ASoC：
   Machine 层   snd_soc_card / dai_link —— 板级粘合（你写的部分）
      │
      ├── Platform 层  CPU DAI 控制器 + DMA + 时钟（SoC 厂商写好）
      │
      └── Codec 层     ADC/DAC、混音、增益、通路（芯片厂商写好）
 ──────────────────────────────────────────────
 硬件：SoC I2S 控制器 ══ BCLK/LRCK/SD ══ Codec 芯片
```

三层职责与修改频率：

| 层 | 职责 | 谁写 | 你要不要动 |
|:---|:---|:---|:---|
| Platform | SoC I2S 控制器、DMA、时钟分频、FIFO | SoC 厂商 BSP | 几乎不动 |
| Codec | 芯片寄存器抽象、音量/mute/通路控制 | 芯片厂商（内核已收录大量型号） | 内核有现成驱动就不动 |
| Machine | 描述"本板哪个 I2S 口接哪个 Codec、什么格式、谁出时钟" | 板级开发者（你） | 必做 |

分层带来的实际收益：换 Codec 只改 Machine 层指向，Platform 复用；同一块板换 SoC，Codec 驱动原样带走。绝大多数板子不用写 Machine 驱动代码——内核的 `simple-audio-card` 通用 Machine 驱动直接吃设备树。

## 设备树：simple-audio-card 完整配置

以"SoC 的 I2S0 接 INMP441 麦克风（录音）、I2S1 接 MAX98357A 功放（放音）"为例：

```dts
/ {
    sound {
        compatible = "simple-audio-card";
        simple-audio-card,name = "rk3568-audio";   /* aplay -l 显示的名字 */

        /* 录音链路：I2S0 ← INMP441 */
        simple-audio-card,dai-link@0 {
            format = "i2s";                       /* 对应 13.1 的四种模式：
                                                     i2s/left_j/right_j/dsp_a/dsp_b */
            bitclock-master = <&cpu_dai0>;        /* CPU 出 BCLK（SoC 主模式） */
            frame-master    = <&cpu_dai0>;        /* CPU 出 LRCK */
            mclk-fs = <256>;                      /* MCLK = 256 × Fs */

            cpu_dai0: cpu {
                sound-dai = <&i2s0_8ch>;
                dai-tdm-slot-num   = <2>;
                dai-tdm-slot-width = <24>;        /* 与 Codec 实际位深一致 */
            };
            codec_dai0: codec {
                sound-dai = <&inmp441>;
            };
        };

        /* 放音链路：I2S1 → MAX98357A */
        simple-audio-card,dai-link@1 {
            format = "i2s";
            bitclock-master = <&cpu_dai1>;
            frame-master    = <&cpu_dai1>;
            mclk-fs = <256>;

            cpu_dai1: cpu {
                sound-dai = <&i2s1_8ch>;
                dai-tdm-slot-num   = <2>;
                dai-tdm-slot-width = <16>;
            };
            codec_dai1: codec {
                sound-dai = <&max98357a>;
            };
        };
    };
};

&i2c1 {
    status = "okay";
    inmp441: inmp441 {
        compatible = "invensense,inmp441";
        sd-gpios  = <&gpio3 RK_PA2 GPIO_ACTIVE_LOW>;   /* 模式选择脚 */
    };
    max98357a: max98357a@2c {
        compatible = "maxim,max98357a";
        reg = <0x2c>;
    };
};

&i2s0_8ch {
    status = "okay";
    pinctrl-0 = <&i2s0_sclk &i2s0_lrck_rx &i2s0_sdi0>;
    pinctrl-names = "default";
};

&i2s1_8ch {
    status = "okay";
    pinctrl-0 = <&i2s1_sclk &i2s1_lrck_tx &i2s1_sdo0>;
    pinctrl-names = "default";
};
```

每个属性的判读要点：

- `format`：必须与 Codec 数据手册 Audio Interface 章节一致，两边（SoC 与 Codec）说的是同一种模式。这是"没声音"的第一嫌疑——13.1 的四种模式在这里一一对应。
- `bitclock-master` / `frame-master`：谁出时钟谁就是主。SoC 主模式最简单；Codec 主模式（用 Codec 内部 PLL 出 BCLK/LRCK）在时钟精度敏感的场景用，配置方向反转。
- `mclk-fs`：MCLK 与采样率的倍率，Codec 手册给定支持范围（常见 128/256/384/512）。
- `dai-tdm-slot-width`：与 Codec 实际输出位深一致，配小了截数据，配大了引入错位。
- 无控制接口的 Codec（INMP441 这类纯 I2S 数据芯片）：内核没有对应驱动时用 `snd-soc-dummy` 占位，格式与位深在 Machine 层配好即可工作。

> ⚠️
> MCLK 引脚必须在 pinctrl 里配置出来，且 SoC 时钟树里 MCLK 父时钟要真的使能。设备树全对但 MCLK 引脚悬空，症状就是 13.1 说的"一切正常就是无声"。bring-up 阶段先用示波器确认 MCLK/BCLK/LRCK 三根线上有时钟，再怀疑软件。

## DAPM：音频通路的自动电源管理

Codec 内部由几十个小模块组成：DAC、ADC、PGA、混音器、输出驱动，每个都能独立上下电。DAPM（Dynamic Audio Power Management）把这些模块建模为 Widget，模块间的信号流向建模为 Route：

```
 放音通路：  DAC → Mixer → Output Driver → Speaker Pin
 录音通路：  MIC Bias → PGA → ADC → 数字接口
```

ALSA 启动放音流时，DAPM 沿放音通路反向把途径的 Widget 全部上电；流停止后自动下电。音量、通路切换等暴露为 kcontrol，`amixer` 直接读写。对开发者的实际意义：

- Codec 驱动里路由声明不全，会导致对应通路永远不上电——"寄存器读写都正常、就是不出声"的另一种成因。
- 调试时看 DAPM 实况：挂 debugfs 后 `cat /sys/kernel/debug/asoc/*/dapm/*`，每个 Widget 的 On/Off 状态和电源路径都在里面。

## ALSA 用户态工具链

| 工具 | 用途 | 常用形式 |
|:---|:---|:---|
| `aplay -l` / `arecord -l` | 列出已注册声卡 | 确认 Machine 层注册成功的第一步 |
| `aplay` | 放音 | `aplay -D plughw:0 test.wav`；`-v` 显示协商出的硬件参数 |
| `arecord` | 录音 | `arecord -D hw:0 -f S16_LE -r 48000 -c 2 -d 10 t.wav` |
| `amixer contents` / `cset` | 读写 kcontrol | 脚本友好；`amixer -c 0 contents` |
| `speaker-test` | 正弦波/声道测试 | `speaker-test -c 2 -t sine -f 1000` |
| `alsactl store/restore` | 控件状态持久化 | 量产镜像保存音量配置 |

工具读出的信息链：`aplay -l` 证明声卡注册 → `aplay -v` 证明流参数协商成功 → 示波器证明时钟与数据在线——三层各管一段，排障时按这个顺序收敛。

## 排障：ASoC 层系统化流程

"没声音"按从软件到硬件的顺序排查，每步有明确出口：

```
 1. aplay -l 有声卡吗？
      无 → Machine 层没注册：dmesg | grep -i asoc / sound 看 defer/失败原因
           常见：Codec 节点 probe 失败（I2C 地址错）、sound-dai 引用错
 2. aplay -v 能跑吗？
      不能 → 流参数协商失败：dai-tdm-slot 与 Codec 位深不匹配、
             采样率不在 Codec 支持列表
 3. amixer contents 里通路控件开吗？音量是 0 吗？
      → DAPM 路由或默认控件值问题；cset 打开对应开关再试
 4. 示波器看 MCLK → BCLK → LRCK → SD，哪根线没有？
      MCLK 无 → 时钟树/pinctrl；BCLK/LRCK 无 → Platform 层没起来；
      SD 无数据但时钟正常 → format 主从配反
 5. 有线有声但内容是杂音 → format 模式不匹配（回 13.1 对时序）
```

录音侧对称，把 aplay 换 arecord、通路换成 ADC/PGA/MIC Bias。MIC Bias 未开导致麦克风无供电而无声，是录音侧的专属高发坑。

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出 ASoC 三层各自的职责与归属（谁维护、你改哪层）
- 为一块"SoC + 双 Codec"的板子写出 simple-audio-card 设备树
- 解释 format/bitclock-master/mclk-fs/slot-width 四个属性各自的失配症状
- 用 aplay/arecord/amixer 完成声卡注册验证与一次录放
- 按五步流程定位一例"没声音"，并说出每步排除的是哪一层
- 在 debugfs 里查看 DAPM 实况并指出未上电的 Widget

## 参考资料

- 内核文档：`Documentation/sound/soc/`（ASoC 架构、DAPM、Machine 编写指南）
- 设备树绑定：`Documentation/devicetree/bindings/sound/simple-card.yaml`
- 内核源码：`sound/soc/generic/simple-card.c`、`sound/soc/codecs/`（各 Codec 驱动）
- ALSA 工具源码：alsa-utils（aplay/amixer 的参数细节）
