# B-D.13.2 I2S Linux 驱动与 ASoC

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] | 预计阅读时间：55 分钟

## 本节导读

13.1 解决了线怎么接、时序怎么对，本节解决 Linux 里驱动怎么组织。嵌入式音频硬件是"SoC 内部 I2S 控制器 + 外部 Codec"的两片结构，内核为此专门设计了 ASoC（ALSA System on Chip）框架：Platform 驱动管 SoC 侧，Codec 驱动管芯片侧，Machine 层把两边粘起来——你在项目里真正要写的基本只有 Machine 层，而且多数情况设备树就够了。

> 本节覆盖：ASoC 三层架构与各自职责、simple-audio-card 设备树的完整配置与逐属性判读、DAPM 自动功耗管理的工作方式与 debugfs 实况、ALSA 用户态工具链与 kcontrol 的来源、xrun（欠载/过载）的机理与缓冲参数、"没声音"的五步排障流程。按"驱动怎么分层 → 设备树怎么写 → 功耗谁管 → 用户态怎么碰 → 流为什么会断 → 坏了怎么查"展开——这正是你把一块新板子的音频从驱动组织到出声验证的认知顺序。

读完你应该能独立完成三件事：为"SoC + 一颗或多颗 Codec"的板子写出 simple-audio-card 设备树并预判每个属性的失配症状、用 aplay/amixer/debugfs 三层工具验证声卡各环节状态、诊断 xrun 类断续故障并调整缓冲参数。

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

<!-- 【待补图】ASoC 三层架构与职责分工图（★必要，建议生图）
生图提示词：技术分层架构图，白底工程蓝图风格，中文标注，横版 16:10。自上而下四层：顶层"用户空间（aplay/arecord/amixer/应用）"灰色；第二层"ALSA 核心（snd_pcm 数据流 + snd_ctl 控制接口）"浅蓝；第三层"ASoC"为蓝色重点层，内部横向三框：左"Platform 层（SoC I2S 控制器+DMA+时钟）"标注"SoC 厂商写，几乎不动"，中"Machine 层（dai_link 板级粘合）"用红色边框标注"板级开发者写，多数用 simple-audio-card 纯设备树"，右"Codec 层（ADC/DAC/混音/通路）"标注"芯片厂商写，内核已收录"；底层"硬件：SoC I2S 控制器 ═BCLK/LRCK/SD═ Codec"深灰。层间连线标注数据流方向。右侧竖排标注"换 Codec 只动 Machine，换 SoC 只动 Platform"。风格：扁平矢量、细线条、蓝色系为主、无装饰。-->

三层职责与修改频率：

| 层 | 职责 | 谁写 | 你要不要动 |
|:---|:---|:---|:---|
| Platform | SoC I2S 控制器、DMA、时钟分频、FIFO | SoC 厂商 BSP | 几乎不动 |
| Codec | 芯片寄存器抽象、音量/mute/通路控制 | 芯片厂商（内核已收录大量型号） | 内核有现成驱动就不动 |
| Machine | 描述"本板哪个 I2S 口接哪个 Codec、什么格式、谁出时钟" | 板级开发者（你） | 必做 |

分层带来的实际收益：换 Codec 只改 Machine 层指向，Platform 复用；同一块板换 SoC，Codec 驱动原样带走。绝大多数板子不用写 Machine 驱动代码——内核的 `simple-audio-card` 通用 Machine 驱动直接吃设备树。

Machine 层的核心抽象是 dai_link：一条 dai_link 描述一对"CPU DAI ↔ Codec DAI"的连接关系，包括格式、时钟主从、MCLK 倍率。一张声卡可以有多条 dai_link——录放用不同 I2S 口的板子就是两条。设备树里的 `dai-link@0/@1` 与之一一对应。

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

注册成功的样子先在 dmesg 里认一遍，排障时才有对照基准：

```text
# dmesg | grep -iE "asoc|sound"
[    2.531204] asoc-simple-card sound: ASoC: binding dai-link@0 ...
[    2.532011] asoc-simple-card sound: INMP441 <-> ff3a0000.i2s mapping ok
[    2.533120] asoc-simple-card sound: MAX98357A <-> ff3c0000.i2s mapping ok
```

`mapping ok` 一行一条 dai_link——缺哪条查哪条的设备树；出现 `probe of sound failed with error -517` 是依赖未就绪的推迟（EPROBE_DEFER），反复刷且最终失败时按 13.4 第 2 层的方法查时钟与 regulator。

## DAPM：音频通路的自动电源管理

Codec 内部由几十个小模块组成：DAC、ADC、PGA、混音器、输出驱动，每个都能独立上下电。DAPM（Dynamic Audio Power Management）把这些模块建模为 Widget，模块间的信号流向建模为 Route：

```
 放音通路：  DAC → Mixer → Output Driver → Speaker Pin
 录音通路：  MIC Bias → PGA → ADC → 数字接口
```

ALSA 启动放音流时，DAPM 沿放音通路反向把途径的 Widget 全部上电；流停止后自动下电。音量、通路切换等暴露为 kcontrol，`amixer` 直接读写。

> kcontrol（内核控件）：ALSA 控制接口的最小单元——一个音量滑块、一个通路开关、一个枚举选择器各是一个 kcontrol。`amixer contents` 列出的每一项都是它。kcontrol 由 Codec 驱动按数据手册的寄存器图导出，所以**不同 Codec 的控件名完全不同**，脚本换芯片必须重写——13.4 的"换芯差异清单"里控件名占一行就是这个原因。

对开发者的实际意义：

- Codec 驱动里路由声明不全，会导致对应通路永远不上电——"寄存器读写都正常、就是不出声"的另一种成因。
- 调试时看 DAPM 实况：挂 debugfs 后 `cat /sys/kernel/debug/asoc/*/dapm/*`，每个 Widget 的 On/Off 状态和电源路径都在里面。

一份放音中的 DAPM 实况节选（`cat .../dapm/*` 的输出拼接）：

```text
.../dapm/DAC: On  in 1 out 1  (0.4)        ← DAC 已上电，有输入有输出
.../dapm/Left Output Mixer: On  in 1 out 1
.../dapm/HPL: On  in 1 out 1               ← 耳机放大器在供电
.../dapm/MICP: Off  in 0 out 0             ← 录音侧 Widget 全部断电 ✓
```

读法：`On/Off` 是电源状态，`in/out` 是激活的输入输出路径数。放音时录音侧全 Off 是 DAPM 正常工作的证据；放音无声且 `HPL` 显示 Off，就沿"DAC→Mixer→HPL"的 in 计数往回找断在哪一环——断点 Widget 的上游就是缺的 Route 或没开的 kcontrol。

## ALSA 用户态工具链

| 工具 | 用途 | 常用形式 |
|:---|:---|:---|
| `aplay -l` / `arecord -l` | 列出已注册声卡 | 确认 Machine 层注册成功的第一步 |
| `aplay` | 放音 | `aplay -D plughw:0 test.wav`；`-v` 显示协商出的硬件参数 |
| `arecord` | 录音 | `arecord -D hw:0 -f S16_LE -r 48000 -c 2 -d 10 t.wav` |
| `amixer contents` / `cset` | 读写 kcontrol | 脚本友好；`amixer -c 0 contents` |
| `alsamixer` | 交互式调音台 | 现场手动确认通路时比 contents 快 |
| `speaker-test` | 正弦波/声道测试 | `speaker-test -c 2 -t sine -f 1000` |
| `alsactl store/restore` | 控件状态持久化 | 量产镜像保存音量配置 |

工具读出的信息链：`aplay -l` 证明声卡注册 → `aplay -v` 证明流参数协商成功 → 示波器证明时钟与数据在线——三层各管一段，排障时按这个顺序收敛。

## xrun：音频流的欠载与过载

"有声但每隔几秒咔哒/断续一下"是独立的一类故障，与无声不同源——它来自缓冲区的供需失衡：

> xrun（underrun/overrun）：放音时 DMA 环形缓冲被读空叫 underrun（应用喂数据不够快），录音时缓冲写满没来得及取走叫 overrun。两者都让硬件在中途插不进新数据，听感是咔哒声或瞬时静音。

ALSA 的缓冲用两个参数刻画：`period`（每次中断搬运的帧数）与 `buffer`（环形缓冲总帧数 = period × 周期个数）。欠载的根本原因是应用在两次中断之间没能准备好下一个 period——CPU 被抢占、调度延迟过大、或 period 设得太小。收敛动作按顺序试：加大 buffer（`aplay --buffer-time=100000`，单位 µs）、加大 period、应用侧提高实时优先级（`chrt`）、检查系统是否有长时间关中断的驱动。判断证据看 dmesg 或 aplay 退出时的统计：

```text
# aplay -D plughw:0 long.wav
...
underrun!!! (at least 12.345 ms long)        ← 每次欠载打印一行，附持续时间
```

低延迟产品（对讲、VoIP）把 buffer 压小换延迟，xrun 风险随之上升——延迟与抗抖动是这笔账的两端，按产品形态选平衡点，不是越小越好。

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

录音侧对称，把 aplay 换 arecord、通路换成 ADC/PGA/MIC Bias。MIC Bias 未开导致麦克风无供电而无声，是录音侧的专属高发坑。断续类故障不进这张表——那是 xrun，回上一节调缓冲。

## 本节总结

ASoC 把"一块板子的音频"拆成三份各归其主：Platform 归 SoC 厂商、Codec 归芯片厂商、Machine 归板级开发者——你的工作量被收敛到一条 dai_link 的设备树描述，这是分层设计给一线工程师的直接红利。围绕这条 dai_link，本篇的硬知识是四组对应：`format` 对错决定有没有声、`bitclock/frame-master` 配反导致数据线静默、`mclk-fs` 失配让 Codec 内部时钟错乱、`slot-width` 错位引入杂音——每个属性都对应一类可观察症状，排障因此可以按属性倒查。DAPM 把上下电从驱动代码里拿出来交给通路拓扑，kcontrol 是你在用户态拧它的手柄；xrun 则是另一个维度的问题——缓冲供需失衡，解法在 period/buffer 参数与调度优先级。排障五步流（注册→协商→通路→时钟→格式）与 13.4 的六层实战互相印证：本节给地图，实战篇给脚步。

| 关键结论 | 一句话记忆 |
|:---|:---|
| 三层分工 | Platform=SoC 厂、Codec=芯片厂、Machine=你（多数纯设备树） |
| dai_link | 一对 CPU↔Codec DAI 的连接；一张声卡可多条 |
| 四属性失配 | format→无声/杂音；主从反→数据静默；mclk-fs→时钟错；slot→截断/错位 |
| DAPM | 通路拓扑驱动上下电；debugfs 看 Widget On/Off 与 in/out 计数 |
| kcontrol | amixer 控件即内核控件；名随芯片变，换芯必重写脚本 |
| xrun | 缓冲供需失衡；加大 buffer/period、提实时优先级 |
| 排障五步 | 注册→协商→通路→时钟→格式，从软件到硬件 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出 ASoC 三层各自的职责与归属（谁维护、你改哪层），解释 dai_link 的含义
- 为一块"SoC + 双 Codec"的板子写出 simple-audio-card 设备树
- 解释 format/bitclock-master/mclk-fs/slot-width 四个属性各自的失配症状
- 从 dmesg 的 `mapping ok` 行确认 dai_link 注册结果
- 用 aplay/arecord/amixer 完成声卡注册验证与一次录放
- 在 debugfs 里读 DAPM 实况，沿 in/out 计数定位未上电的 Widget
- 解释 xrun 的成因，为一例断续故障给出缓冲与调度两侧的调整动作

## 参考资料

- 内核文档：`Documentation/sound/soc/`（ASoC 架构、DAPM、Machine 编写指南）
- 设备树绑定：`Documentation/devicetree/bindings/sound/simple-card.yaml`
- 内核源码：`sound/soc/generic/simple-card.c`、`sound/soc/codecs/`（各 Codec 驱动）
- ALSA 工具源码：alsa-utils（aplay/amixer 的参数细节）；`alsactl` 状态文件格式
- 本书关联：13.1（I2S 时序与四种 format）、13.4（WM8960 完整实战——本节的地图在那里落地为脚步）、B-C.7.4（USB Gadget——USB Audio 设备端）
