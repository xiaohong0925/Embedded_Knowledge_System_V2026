# B-D.13.4 实战：I2S Codec 声卡注册与放音/录音

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] | 预计阅读时间：70 分钟

## 本节导读

13.1 讲了 I2S 的时序，13.2 讲了 ASoC 的三层架构与接口选型，本篇把一颗真实的 Codec 跑起来：以 WM8960（带耳机/扬声器功放、录音 PGA，内核有现成驱动 `snd-soc-wm8960`）为例，从接线、设备树、内核配置到 `aplay` 出声、`arecord` 录音，每一步带真实输出样本和验证判据。ES8388、TLV320AIC31xx 等同类 Codec 流程一致，寄存器细节换数据手册。

> 本节覆盖：WM8960 最小硬件连接（I2C 控制面 + I2S 数据面 + MCLK）、MCLK/BCLK/LRCK 三个时钟的分工与换算、设备树三处修改点逐属性解读、内核配置项清单、六层验证流程（每层附真实命令输出与判据）、放音/录音/音量控制实操、DAPM 功耗验证、bring-up 排障对照表。按"接线 → 时钟 → 内核 → 设备树 → 逐层验证 → 排障 → 产品化"展开——这正是你拿到一块焊好 Codec 的新板子后从零到出声的实际顺序。

读完你应该能独立完成三件事：为一颗内核已收录的 Codec 写出完整设备树并解释每个属性的失配症状、按六层流程逐级定位"没声"停在哪一层、把音量通路配置持久化并验证 DAPM 功耗达到产品级状态。

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

<!-- 【待补图】WM8960 与 SoC 接线原理图（★必要，建议生图）
生图提示词：工程原理图风格技术插图，白底，中文标注，横版 16:10。左侧 SoC 方框（标注引脚名 I2C1_SDA/SCL、I2S0_MCLK、I2S0_SCLK、I2S0_LRCK、I2S0_SDO、I2S0_SDI），右侧 WM8960 方框（标注 SDA/SCL、MCLK、BCLK、DACLRC、ADCLRC、DACDAT、ADCDAT、HP_L/R、SPK_LP/LN、MICP/MICN），两侧引脚间画连线并标注信号名与方向箭头。控制面连线用蓝色并成组标注"I2C 控制面（寄存器配置）"，数据面用绿色标注"I2S 数据面（音频流）"，MCLK 用红色单独标注"主时钟 12.288MHz，必须接"。右下小图画耳机插座（经耦合电容）、扬声器、麦克风三个负载。风格：扁平矢量、细线条、蓝绿红三色区分功能组、无装饰。-->

接线纪律：

- I2C 是控制面（读写 Codec 寄存器），I2S 是数据面——两个总线都要通，声卡才能工作。I2C 不通时驱动 probe 失败；I2S 不通时 probe 成功但无声。这个分界直接决定排障时先查哪边。
- MCLK 必须接。WM8960 支持内部 PLL 从 BCLK 生成系统时钟，但首次 bring-up 建议直接供 12.288 MHz MCLK（256×48 kHz），少一个变量。
- 模拟侧：耳机输出 HP_L/HP_R 经耦合电容到插座；扬声器接 SPK 差分对；麦克风差分进 MICP/MICN，MICBIAS 由 Codec 内部提供。

## 先分清三个时钟：MCLK、BCLK、LRCK

新手最容易在这里栽跟头，I2S 接口其实有三个时钟，各管一层：

> MCLK（主时钟）：Codec 内部数字电路（PLL、DAC/ADC 调制器）的基准时钟，频率 = 采样率 × 倍率（常用 256fs：48 kHz × 256 = 12.288 MHz）。它不参与数据传输，只保证 Codec 内部电路跑在正确节奏上。没有 MCLK，Codec 寄存器能读写（I2C 正常），但音频通路整个不工作——这就是"I2C 通、probe 成功、就是无声"的第一嫌疑。
>
> BCLK（位时钟）：数据线上每个比特的节拍，频率 = 采样率 × 每声道位数 × 声道数。48 kHz × 32 bit × 2 声道 = 3.072 MHz。示波器上放音期间才出现。
>
> LRCK（帧时钟/左右声道时钟）：标识当前时隙是左还是右声道，频率 = 采样率本身（48 kHz）。占空比 50%，高电平对应一声道、低电平对应另一声道（极性由格式定，13.1 讲过）。

换算链一条线：MCLK 供 Codec 内部 → Codec/SoC 分频出 BCLK 和 LRCK → BCLK/LRCK 驱动数据线。所以 12.288 MHz MCLK 对应 48 kHz 采样率是设计好的整数关系（256 分频再 64 分频）；设备树里 `mclk-fs = <256>` 声明的就是这个倍率，Codec 驱动拿它校验采样率合法性。

时钟由谁出（主从）是另一个正交问题：本篇方案 SoC 出 BCLK/LRCK（SoC 主）、WM8960 收（Codec 从），MCLK 由 SoC 时钟树供给 Codec。两边都配成主或都配成从，数据线会"永远安静"且无任何报错——排障表里有对应条目。

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

这份清单对应 13.2 讲的三层：`SND_SOC_WM8960` 是 Codec 层，`SND_SOC_ROCKCHIP_I2S` 是 Platform 层（I2S 控制器 + DMA），`SND_SOC_SIMPLE_CARD` 是 Machine 层（把前两者缝合成一张声卡）。缺任何一层，症状各不相同：缺 Codec 则 probe 无匹配；缺 Platform 则 CPU 侧 DAI 不存在；缺 Machine 则两边都在但声卡不出现。

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

三个判读点：`format = "i2s"` 对应 WM8960 默认的 I2S 模式；`mclk-fs = <256>` 匹配 12.288 MHz / 48 kHz；Codec 节点的 `#sound-dai-cells = <0>` 是 machine 引用的前提。时钟主从缺省为 SoC 出 BCLK/LRCK（SoC 主模式），与 WM8960 默认从模式互补，不写 `bitclock-master` 时 simple-card 按 CPU 侧为从处理——此处显式心智：**SoC 出时钟、Codec 收时钟**。需要反转主从时（比如用 Codec 的 PLL 出 BCLK），在 cpu/codec 子节点里加 `bitclock-master` / `frame-master` 指到 codec 侧。

> ⚠️
> WM8960 的 I2C 地址是固定的 0x1A，但模块板有时把地址脚拉成别的值（少数模块到 0x1B）。probe 报 `-121`（远程 IO 错误）时先 `i2cdetect -y 1` 确认芯片真实挂在哪个地址。

## 分层验证：每一层都有判据

上电后按顺序验证，任何一步失败先停下排障——不要跳层，下层没通时上层的所有现象都是误导。

### 第 1 层：I2C 控制面

```text
# i2cdetect -y 1
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:                         -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- 1a -- -- -- -- --
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
40: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
50: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
60: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- --
```

判据：`0x1a` 位置出现应答。全空查 SDA/SCL 接线与上拉电阻；出现 `UU` 说明该地址已被驱动占用（probe 已经成功，正常）；地址在别处出现说明模块地址脚状态与预期不符。

### 第 2 层：驱动 probe

```text
# dmesg | grep -i wm8960
[    2.417812] wm8960 1-001a: supply AVDD not found, using dummy regulator
[    2.418633] wm8960 1-001a: supply DBVDD not found, using dummy regulator
[    2.425507] wm8960 1-001a: chip revision A
```

判据：出现芯片信息行且无错误码残留。`supply ... not found, using dummy regulator` 是提示不是错误（设备树没声明电源时内核用虚拟稳压器兜底）。真正要警惕的两个错误码：`-121`（EREMOTEIO，I2C 地址或总线问题，回第 1 层）；`-517`（EPROBE_DEFER，依赖的时钟/regulator 还没就绪，内核会稍后重试——如果反复刷 -517 永不成功，去查 MCLK 时钟节点是否使能）。

### 第 3 层：声卡注册

```text
# aplay -l
**** List of PLAYBACK Hardware Devices ****
card 0: wm8960sound [wm8960-sound], device 0: ff0a0000.i2s-WM8960 HiFi wm8960-hifi-0 []
  Subdevices: 1/1
  Subdevice #0: subdevice #0

# arecord -l
**** List of CAPTURE Hardware Devices ****
card 0: wm8960sound [wm8960-sound], device 0: ff0a0000.i2s-WM8960 HiFi wm8960-hifi-0 []
  Subdevices: 1/1
```

读法：`card 0` 的名字来自设备树 `simple-audio-card,name`；`ff0a0000.i2s-WM8960 HiFi` 这段是 CPU DAI 与 Codec DAI 拼接出的链路名——看到它就证明 Machine 层把两边缝上了。只有 `aplay -l` 报 `no soundcards found` 而 probe 正常时，去 dmesg 搜 `asoc` 或 `simple-card`，多半是 `sound-dai` 引用指错或 `#sound-dai-cells` 没写。

### 第 4 层：放音

```text
# speaker-test -D plughw:0 -c 2 -t sine -f 1000 -l 2
speaker-test 1.2.8
Playback device is plughw:0
Stream parameters are 48000Hz, S16_LE, 2 channels
Sine wave rate is 1000.0000Hz
Rate set to 48000Hz (requested 48000Hz)
Buffer size range from 2048 to 16384
Periods = 4
...
Front Left
Front Right
```

判据：报 `Front Left` 时左耳机响 1 kHz 正弦音、报 `Front Right` 时右耳机响。这行文字和实际发声的对应关系同时也是左右声道校验——右边在报 `Front Left` 时响，就是 LRCK 极性或左右走线反了。

`speaker-test` 没出声但流程无报错时，示波器看三根线：MCLK 12.288 MHz、BCLK 在放音期间出现（48 kHz × 32 bit slot × 2 = 3.072 MHz）、SD 线上有数据跳变。时钟在而数据静，或数据线恒高/恒低，都是定位线索。

### 第 5 层：音量与通路

先看清这张卡有哪些控件（WM8960 驱动导出有 70+ 个）：

```text
# amixer -c 0 contents | grep -A1 "name='Headphone Playback Volume'"
numid=12,iface=MIXER,name='Headphone Playback Volume'
  ; type=INTEGER,access=rw---R--,values=2,min=0,max=127,step=0
  : values=87,87
        | dBscale-min=-73.00dB,step=1.00dB,mute=1
```

读法：`values=2` 是左右声道各一个值；`max=127` 对应 +6 dB；默认 87 大约是 -10 dB 左右——响但不够响。通路确认要同时看 Output Mixer 开关是否把 PCM 信号接到了耳机放大器：

```text
# amixer -c 0 cset name='Headphone Playback Volume' 100,100
numid=12,iface=MIXER,name='Headphone Playback Volume'
  : values=100,100
# amixer -c 0 cset name='Left Output Mixer PCM' on
# amixer -c 0 cset name='Right Output Mixer PCM' on
```

音频通路的心智模型是 `DAC → Output Mixer（选择 PCM/DMIX/旁路）→ Headphone/Speaker 放大器 → 引脚`，每一环都有独立开关与增益。"有声但很小"和"完全无声"在这条链上对应不同环，用 `amixer contents` 沿链逐环确认，不要凭感觉乱调。

<!-- 【待补图】WM8960 音频通路与控件对应图（△可选，建议生图）
生图提示词：技术流程图，白底工程蓝图风格，中文标注，横版 16:9。画面分两行：上行放音通路"PCM 数据 → DAC → Output Mixer → Headphone/Speaker 放大器 → HP_L/R、SPK 引脚"，每个方块下方标注对应的 amixer 控件名（'PCM Playback Volume'、'Left/Right Output Mixer PCM'、'Headphone Playback Volume'、'Speaker Playback Volume'）；下行录音通路"MICP/MICN 引脚 → MICBIAS 供电 → Input PGA → ADC → I2S ADCDAT"，标注控件名（'MICBIAS'、'Input PGA'、'Capture Volume'）。每个方块画独立开关图标表示可独立使能/断电，标注"DAPM 按通路连通性自动上下电"。风格：扁平矢量、细线条、蓝色系为主、无装饰。-->

### 第 6 层：录音

```text
# amixer -c 0 cset name='Capture Volume' 24,24
# arecord -D plughw:0 -f S16_LE -r 48000 -c 2 -d 5 mic.wav
Recording WAVE 'mic.wav' : Signed 16 bit Little Endian, Rate 48000 Hz, Stereo
# aplay mic.wav
```

判据：`mic.wav` 非静音，回放可辨认环境声。录音全零的排查顺序：`amixer contents` 里找 `Input PGA` 开关与 `MICBIAS`——驻极体麦克风没有 MICBIAS 供电就输出零，这是"录音全零"的第一嫌疑；其次确认输入选择器选的是 MICP/MICN 所在的通路。

### 加分项：用 i2cget 抽查 Codec 内部状态

amixer 的每个控件背后都是 Codec 寄存器的若干位。验证流程卡在半中间时，直接读寄存器能确认"软件以为的状态"和"芯片实际的状态"是否一致：

```text
# i2cget -y 1 0x1a 0x04 w        ← R4（Audio Interface 低字节）
0x41xx                            ← 高位随配置变化，关键是 Format 位域
# i2cget -y 1 0x1a 0x07 w        ← R7（Audio Interface 高字节：LRCLK 极性/字长）
0x00xx
```

WM8960 寄存器是 9 位有效数据，读回值只取低 9 位对照数据手册的位图。典型用途两个：杂音刺耳时读 R4 确认 Format 位域确实是 I2S（`0b10`）而不是 Left-Justified；左右反了时读 R7 确认 LRP 位。内核驱动代码 `sound/soc/codecs/wm8960.c` 里的寄存器默认值表是比对基准。

> 💡
> I2S 这一组信号的信号完整性要求不高——BCLK 才 3 MHz 量级，普通走线即可。真正要小心的是 MCLK（12.288 MHz 连续时钟）不要贴着模拟输入走线长距离平行走，它会串进麦克风通路变成固定频率的底噪。录音底噪里出现稳定的 12 kHz 左右啸叫时，先怀疑 MCLK 串扰再怀疑增益。

## 换一颗 Codec 时的差异清单

本篇流程的内核通用性来自于：变化的部分全部被封装在数据手册和设备树里。换到 ES8388 或 TLV320AIC31xx 时，对照这张清单逐项替换：

| 项 | WM8960 | 换芯时怎么定 |
|:---|:---|:---|
| compatible / 驱动 | `wlf,wm8960` / `SND_SOC_WM8960` | 新芯片数据手册与 `Documentation/devicetree/bindings/sound/` |
| I2C 地址 | 固定 0x1A | 查手册的地址引脚真值表，上电先 i2cdetect |
| MCLK 倍率 | 256fs | 查手册"系统时钟"节；有些 Codec 支持 128/256/384/512fs 多档 |
| 默认主从 | 从 | 查手册 Audio Interface 寄存器默认值 |
| 控件名 | `Headphone Playback Volume` 等 | `amixer contents` 导出新卡的控件清单，重走通路 |
| 供电时序 | 无强制 | 部分 Codec 要求 AVDD 先于 DVDD，设备树 regulator 节声明 |

流程本身——六层验证、排障表、产品化三件事——一行不用改。

一个真实差异案例能说明清单的用法：ES8388 与 WM8960 管脚近似但 I2C 地址可配（CE 脚电平决定 0x10/0x11）、默认就是 I2S 格式、MCLK 支持 256/384/512fs 三档、且要求 AVDD 先上电。换芯后设备树只改四处——compatible、reg 地址、mclk-fs、regulator 声明，随后从第 1 层重新走一遍验证流程，大约半小时就能出声。这正是 ASoC 分层设计的回报：Machine 和 Platform 完全不动，变的只有 Codec 这一个插头。

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
| 两侧都配成主/都从 | 第 4 层 | 时钟主从冲突，数据线静默 | 确认 `bitclock-master`/`frame-master` 指向唯一一方 |
| 录音全零 | 第 6 层 | MICBIAS 未开 / 输入通路未选 | `amixer contents` 找 Input PGA 与 MICBIAS 开关 |
| 录音底噪大 | 第 6 层 | PGA 增益过高、模拟地布局、MCLK 串扰 | 降 Capture Volume；查模拟走线；底噪带固定啸叫查 MCLK 走线 |
| 放音启停有"咔哒"声 | 第 4 层 | DAPM 上下电瞬态，pop 抑制未生效 | 确认驱动的 pop 抑制时序；必要时加大功放使能延迟 |
| 只有单边声道响 | 第 4/5 层 | 另一声道 Mixer 开关未开或走线断 | `amixer contents` 对比左右控件值；量 HP_L/R 两路 |

排查的总原则：**症状先映射到层，层内再按怀疑度排序**。跨越两层的症状（如"有声但失真"涉及时钟与格式两侧）优先用能同时观察两侧的手段——`aplay -v` 看协商参数、示波器看三线，一次观测排除一整类嫌疑。

`aplay -v` 是时钟问题的主力工具，它把应用层请求与硬件实际协商结果并排打出来：

```text
# aplay -v -D plughw:0 test.wav
Playing WAVE 'test.wav' : Signed 16 bit Little Endian, Rate 44100 Hz, Stereo
Hardware PCM card 0 'wm8960-sound' device 0 subdevice 0
Its setup is:
  stream       : PLAYBACK
  access       : RW_INTERLEAVED
  format       : S16_LE
  rate         : 48000            ← 硬件实际跑的采样率
  channels     : 2
  ...
```

读法：WAV 文件是 44.1 kHz，硬件协商成 48 kHz——`plughw` 插件层做了重采样转换。如果用 `hw:0` 直开而驱动只声明支持 48 kHz，44.1 kHz 的文件会直接报参数错误。"声音慢半拍"类问题先在这里看 rate 一行是否符合预期，再上示波器量 BCLK 验证（48 kHz × 64 = 3.072 MHz 为基准）。

## 从能响到能用

声卡响起来之后还有三件事才算产品级：

1. **默认控件状态**：量产镜像用 `alsactl store` 把音量、通路配置存进 `/var/lib/alsa/asound.state`，开机 `alsactl restore`，避免每次上电回到静音默认。注意这个文件按**声卡名**索引，设备树里改了 `simple-audio-card,name` 后旧状态文件会失配，重新 store 一次。
2. **功耗**：确认不放音时 DAPM 已把功放通路断电。
3. **应用对接**：上层用 PulseAudio/PipeWire 还是直接 `hw:` 设备，按产品形态定；语音识别前端接 arecord 的原始流即可，多路混音再上音频服务。直接 `hw:` 方案延迟最低但独占设备，音频服务方案支持混音与动态路由但引入缓冲延迟——对讲门铃类产品选前者，智能音箱类产品选后者。

> DAPM（动态音频电源管理）：ASoC 把音频通路拆成带电源状态的"Widget"（DAC、混音器、放大器各是一个），内核按当前通路连通性自动上下电——没有放音流时整条链应处于 Off。验证看 debugfs：
>
> ```text
> # cat /sys/kernel/debug/asoc/wm8960-sound/dapm/bias_level
> Off
> # grep -H . /sys/kernel/debug/asoc/wm8960-sound/dapm/* | grep -E "HP|SPK"
> .../dapm/HPL: Off  in 0 out 0  (0.0)      ← 耳机左放大器已断电
> .../dapm/SPKL: Off  in 0 out 0  (0.0)     ← 扬声器放大器已断电
> ```
>
> `bias_level` 应为 `Off`，各功放 Widget 应为 `Off`。放音一停它们还保持 `On`，说明有通路没关干净，静态电流会多出几到十几毫安——电池供电产品要在这里抠功耗。

到这里，13.1 的时序、13.2 的架构、本篇的实操形成闭环：线接对（13.1）→ 驱动组织对（13.2）→ 每一层可验证（本篇）。换任何一颗内核已收录的 Codec，流程不变，只有寄存器和控件名变。

## 本节总结

本篇把一颗 Codec 从焊接好到出产品级声音的全过程走了一遍，方法比 WM8960 这个具体型号重要。核心纪律只有三条：**控制面与数据面分开验证**——I2C 通只证明寄存器能读写，I2S 通才证明音频能流动，"probe 成功但无声"永远落在数据面或时钟上；**三个时钟各司其职**——MCLK 喂 Codec 内部电路、BCLK 给比特打拍、LRCK 标左右声道，`mclk-fs` 声明的倍率把三者锁成整数关系，主从配置冲突会让数据线静默且零报错；**排障严格按层走**——i2cdetect → dmesg probe → aplay/arecord -l → speaker-test → amixer 通路 → arecord 闭环，每一层都有明确判据和失败出口，跳层排查得到的现象全是误导。能响之后用 `alsactl store` 固化控件、用 DAPM debugfs 确认功放断电，才算从实验台走到产品。这套流程对任何内核已收录的 I2S Codec 原样适用。

| 关键结论 | 一句话记忆 |
|:---|:---|
| 两面分验 | I2C=控制面、I2S=数据面；probe 成功≠能出声 |
| 三个时钟 | MCLK 喂内部（256fs）、BCLK 打拍子（fs×位宽×声道）、LRCK 分左右（=fs） |
| 主从纪律 | 只能一方出 BCLK/LRCK；双主/双从=数据线静默无报错 |
| 六层验证 | I2C→probe→声卡注册→放音→通路→录音，逐层判据不跳层 |
| 无声排查 | 示波器三线：MCLK 在不在、BCLK 放音期出不出、SD 动不动 |
| 格式错症状 | I2S/LJ 错位=刺耳杂音；LRCK 极性反=左右互换 |
| 录音全零 | 先查 MICBIAS，再查 Input PGA 通路 |
| 产品化 | alsactl 固化控件 + DAPM 确认断电 + 定应用层方案 |

## 本节自查

读完本篇，你应能独立完成以下动作：

- 画出 SoC 与 WM8960 之间的完整接线，区分 I2C 控制面与 I2S 数据面
- 解释 MCLK/BCLK/LRCK 的分工与频率换算，算出 48 kHz 下的三个时钟值
- 写出三处设备树修改并解释 `mclk-fs`、`#sound-dai-cells`、`bitclock-master` 的失配症状
- 按六层验证流程逐级确认声卡状态，每层说出判据与失败出口
- 用 amixer 沿"DAC→Mixer→放大器"链打开放音通路、设音量、开 MICBIAS 完成一次录放闭环
- 用 `aplay -v` 与示波器三线检查定位"probe 成功但无声"
- 用 DAPM debugfs 输出验证不放音时功放已断电

## 参考资料

- WM8960 数据手册（Cirrus Logic）——寄存器图、时序、模拟通路
- 内核源码：`sound/soc/codecs/wm8960.c`、`sound/soc/generic/simple-card.c`
- 设备树绑定：`Documentation/devicetree/bindings/sound/wlf,wm8960.yaml`、`Documentation/devicetree/bindings/sound/simple-card.yaml`
- alsa-utils/alsa-lib 文档（alsactl、asound.state 格式）
- 本书关联：13.1（I2S/PCM 时序——杂音与左右反的判据来源）、13.2（ASoC 三层与接口选型）、13.3（数字麦 PDM/PDM 麦克风阵列）
