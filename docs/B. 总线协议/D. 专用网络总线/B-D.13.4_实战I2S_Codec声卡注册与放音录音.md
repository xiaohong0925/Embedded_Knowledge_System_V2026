# B-D.13.4 实战：I2S Codec 声卡注册与放音/录音

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] | 预计阅读时间：50 分钟

## 本节导读

13.1~13.3 讲了 I2S 时序、ASoC 架构和接口选型，本篇把一颗真实的 Codec 跑起来：以 WM8960（带耳机/扬声器功放、录音 PGA，内核有现成驱动 `snd-soc-wm8960`）为例，从接线、设备树、内核配置到 `aplay` 出声、`arecord` 录音，每一步带验证判据。ES8388 等同类 Codec 流程一致，寄存器细节换数据手册。

本篇直接先修是 13.2（ASoC 与 simple-audio-card）；时序问题回 13.1。

本节覆盖：WM8960 最小硬件连接（I2C 控制 + I2S 数据 + MCLK）、设备树三处修改点、内核配置项清单、声卡注册的分层验证、放音/录音/音量控制实操、bring-up 排障全流程。

## 场景与硬件

```
 ┌──────────────── SoC ────────────────┐      ┌────── WM8960 ──────┐
 │ I2C1_SDA/SCL ────────────────────────┼──────┤ SDA/SCL（控制面）   │
 │ I2S0_MCLK  ──────────────────────────┼──────┤ MCLK               │
 │ I2S0_SCLK(BCLK) ─────────────────────┼──────┤ BCLK               │
 │ I2S0_LRCK  ──────────────────────────┼──────┤ DACLRC/ADCLRC      │
 │ I2S0_SDO   ──────────────────────────┼──────┤ DACDAT（放音数据）  │
 │ I2S0_SDI   ◄─────────────────────────┼──────┤ ADCDAT（录音数据）  │
 │              3.3 V / GND 共地        │      │ HP_L/R → 耳机      │
 └──────────────────────────────────────┘      │ SPK_LP/LN → 扬声器  │
                                                │ MICP/MICN → 麦克风  │
                                                └────────────────────┘
```

接线纪律：

- I2C 是控制面（读写 Codec 寄存器），I2S 是数据面——两个总线都要通，声卡才能工作。I2C 不通时驱动 probe 失败；I2S 不通时 probe 成功但无声。
- MCLK 必须接。WM8960 支持内部 PLL 从 BCLK 生成系统时钟，但首次 bring-up 建议直接供 12.288 MHz MCLK（256×48 kHz），少一个变量。
- 模拟侧：耳机输出 HP_L/HP_R 经耦合电容到插座；扬声器接 SPK 差分对；麦克风差分进 MICP/MICN，MICBIAS 由 Codec 内部提供。

## 内核配置

```
CONFIG_SND=y
CONFIG_SND_SOC=y
CONFIG_SND_SOC_I2C_AND_SPI=y
CONFIG_SND_SOC_WM8960=y
CONFIG_SND_SOC_SIMPLE_CARD=y          # simple-audio-card Machine 驱动
# SoC 侧 Platform 驱动（按所用 SoC 选择），如：
CONFIG_SND_SOC_ROCKCHIP=y
CONFIG_SND_SOC_ROCKCHIP_I2S=y
```

确认 Codec 驱动编译进去的直接判据：`grep WM8960 .config`；模块形式则确认 `snd-soc-wm8960.ko` 在根文件系统里且能 `modprobe`。

## 设备树：三处修改

```dts
/* 1. I2C 总线上声明 Codec */
&i2c1 {
    status = "okay";

    wm8960: wm8960@1a {                    /* WM8960 固定 I2C 地址 0x1A */
        compatible = "wlf,wm8960";
        reg = <0x1a>;
        #sound-dai-cells = <0>;
        clocks = <&i2s0_mclk_src>;         /* MCLK 来源，按 SoC 时钟树写 */
        clock-names = "mclk";
    };
};

/* 2. I2S 控制器使能 + 引脚 */
&i2s0_8ch {
    status = "okay";
    pinctrl-0 = <&i2s0_mclk &i2s0_sclk &i2s0_lrck_tx &i2s0_lrck_rx
                 &i2s0_sdo0 &i2s0_sdi0>;
    pinctrl-names = "default";
};

/* 3. Machine 层：simple-audio-card */
/ {
    sound {
        compatible = "simple-audio-card";
        simple-audio-card,name = "wm8960-sound";
        simple-audio-card,format = "i2s";
        simple-audio-card,mclk-fs = <256>;

        simple-audio-card,cpu {
            sound-dai = <&i2s0_8ch>;
        };
        simple-audio-card,codec {
            sound-dai = <&wm8960>;
        };
    };
};
```

三个判读点：`format = "i2s"` 对应 WM8960 默认的 I2S 模式；`mclk-fs = <256>` 匹配 12.288 MHz / 48 kHz；Codec 节点的 `#sound-dai-cells = <0>` 是 machine 引用的前提。时钟主从缺省为 SoC 出 BCLK/LRCK（SoC 主模式），与 WM8960 默认从模式互补，不写 `bitclock-master` 时 simple-card 按 CPU 侧为从处理——此处显式心智：**SoC 出时钟、Codec 收时钟**。

> ⚠️
> WM8960 的 I2C 地址是固定的 0x1A，但模块板有时把地址脚拉成别的值（少数模块到 0x1B）。probe 报 `-121`（远程 IO 错误）时先 `i2cdetect -y 1` 确认芯片真实挂在哪个地址。

## 分层验证：每一层都有判据

上电后按顺序验证，任何一步失败先停下排障：

```bash
# 第 1 层：I2C 控制面
i2cdetect -y 1
# 判据：0x1a 位置有应答
#   失败 → 查 SDA/SCL 接线、上拉电阻、设备树 reg 地址

# 第 2 层：驱动 probe
dmesg | grep -i wm8960
# 判据：wm8960 1-001a: probe 成功，无 -121 / -517 残留错误
#   -517（EPROBE_DEFER）反复出现 → MCLK 时钟或 regulator 没就绪

# 第 3 层：声卡注册
aplay -l && arecord -l
# 判据：card 0: wm8960sound [wm8960-sound] 出现，播放/录音设备各一
#   无声卡 → dmesg 看 asoc 相关行，Machine 层 link 未建立

# 第 4 层：放音
speaker-test -D plughw:0 -c 2 -t sine -f 1000 -l 2
# 判据：耳机/扬声器出 1 kHz 正弦音，左右各一次
#   无声 → 进排障流程（下节）

# 第 5 层：音量与通路
amixer -c 0 contents | less            # 看有哪些控件
amixer -c 0 cset name='Headphone Playback Volume' 100,100
amixer -c 0 cset name='Left Output Mixer PCM' on
amixer -c 0 cset name='Right Output Mixer PCM' on

# 第 6 层：录音
arecord -D plughw:0 -f S16_LE -r 48000 -c 2 -d 5 mic.wav
amixer -c 0 cset name='Capture Volume' 24,24
# 判据：mic.wav 非静音，aplay mic.wav 回放可辨认环境声
#   全零 → MICBIAS 未开或输入通路未选
```

`speaker-test` 没出声但流程无报错时，示波器看三根线：MCLK 12.288 MHz、BCLK 在放音期间出现（48 kHz × 32 bit slot × 2 = 3.072 MHz）、SD 线上有数据跳变。时钟在而数据静，或数据线恒高/恒低，都是定位线索。

## 排障：bring-up 全流程对照表

| 症状 | 判据层 | 优先怀疑 | 动作 |
|:---|:---|:---|:---|
| i2cdetect 无 0x1a | 第 1 层 | 接线/上拉/地址 | 量 I2C 波形；换地址重试 |
| probe -121 | 第 2 层 | I2C 地址错 | i2cdetect 拿真实地址改设备树 |
| probe 反复 -517 | 第 2 层 | MCLK 时钟/regulator 未就绪 | `clk_summary` 查 MCLK 父时钟使能状态 |
| 无 card 0 | 第 3 层 | simple-card 未匹配 | dmesg 全文找 `asoc`；核对 `sound-dai` 引用与 `#sound-dai-cells` |
| 放音无声、流程无报错 | 第 4 层 | MCLK 未输出（PLL 失锁静默） | 示波器量 MCLK；`cat /sys/kernel/debug/clk/clk_summary` |
| 有声但杂音刺耳 | 第 4 层 | format 不匹配（I2S vs LJ 错位 1 bit） | 改 `format = "left_j"` 对比；回 13.1 对时序 |
| 左右反了 | 第 4 层 | LRCK 极性 | WM8960 寄存器 R7 的 LRP 位，或换 `format` 试 |
| 声音慢半拍/快半拍 | 第 4 层 | 采样率/时钟比例错 | `aplay -v` 看协商参数；量 BCLK 实际频率 |
| 录音全零 | 第 6 层 | MICBIAS 未开 / 输入通路未选 | `amixer contents` 找 Input PGA 与 MICBIAS 开关 |
| 录音底噪大 | 第 6 层 | PGA 增益过高、模拟地布局 | 降 Capture Volume；查模拟走线 |

## 从能响到能用

声卡响起来之后还有三件事才算产品级：

1. **默认控件状态**：量产镜像用 `alsactl store` 把音量、通路配置存进 `/var/lib/alsa/asound.state`，开机 `alsactl restore`，避免每次上电回到静音默认。
2. **功耗**：确认不放音时 DAPM 已把功放通路断电——`cat /sys/kernel/debug/asoc/*/dapm/*` 看 Widget 状态，功放在 Off 态才对。
3. **应用对接**：上层用 PulseAudio/PipeWire 还是直接 `hw:` 设备，按产品形态定；语音识别前端接 arecord 的原始流即可，多路混音再上音频服务。

到这里，13.1 的时序、13.2 的架构、本篇的实操形成闭环：线接对（13.1）→ 驱动组织对（13.2）→ 每一层可验证（本篇）。换任何一颗内核已收录的 Codec，流程不变，只有寄存器和控件名变。

## 本节自查

读完本篇，你应能独立完成以下动作：

- 画出 SoC 与 WM8960 之间的完整接线（含 I2C 与 I2S 两个面）
- 写出三处设备树修改并解释每个属性的失配症状
- 按六层验证流程逐级确认声卡状态，每层说出判据与失败出口
- 用 amixer 打开放音通路、设音量、开 MICBIAS 完成一次录放闭环
- 对"probe 成功但无声"给出基于示波器的三线检查顺序
- 说明产品化还需补的三件事（控件持久化、DAPM 功耗、应用层对接）

## 参考资料

- WM8960 数据手册（Cirrus Logic）——寄存器图、时序、模拟通路
- 内核源码：`sound/soc/codecs/wm8960.c`、`sound/soc/generic/simple-card.c`
- 设备树绑定：`Documentation/devicetree/bindings/sound/wlf,wm8960.yaml`
- alsa-utils/alsa-lib 文档（alsactl、asound.state 格式）
