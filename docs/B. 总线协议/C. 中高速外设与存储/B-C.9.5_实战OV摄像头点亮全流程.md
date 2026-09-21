# B-C.9.5 实战：OV 系摄像头点亮全流程（设备树 → V4L2 采集 → 显示）

> 所属章节：第五部 B. 总线协议 > B-C.9 显示与摄像
>
> 难度：[M] Master | 预计阅读时间：45 分钟（含动手 90~120 分钟）

## <span class="blue"> 本节导读

这是板块 3 的收官实战：把一颗 OV 系 MIPI 摄像头（以 OV5640 为例，方法对 OV 全系与大多数 MIPI sensor 通用）从"焊上板子"一路点到"画面显示在 DSI 屏上"。前三篇分别讲了 D-PHY 物理层、CSI-2 + V4L2、DSI + DRM——这一篇把它们串成一条完整的数据通路，并按真实工程的节奏分七段验证，每段都有明确的通过判据和失败时的排查方向。

点亮摄像头是嵌入式调试里"链条最长"的任务之一：供电、时钟、复位、I2C、MIPI 布线、设备树、驱动、格式协商、DMA、显示，任何一环断了表现都是"没图"。这篇实战的核心交付物不是某个脚本，而是**分段验证的方法论**——每段独立验证，问题永远被锁定在当前段内。

先把要打通的链路完整摆出来，后面每一段都是在验证这条链上的一段：

```
OV5640 感光阵列
   │ I2C（配置通道：读写寄存器）
   │ MIPI CSI-2 2-lane（数据通道：图像像素流）
   ▼
SoC CSI-2 控制器 ──→ ISP（格式转换/缩放，部分 SoC 可选）
   │ DMA
   ▼
DDR 帧缓冲 ──→ 应用（v4l2-ctl/ffmpeg 采集）
   │
   ▼
LCD 控制器 → DSI Host → 屏（B-C.9.3 已点亮的显示通路）
```

注意图里两条性质完全不同的通道：I2C 配置通道（慢、双向、承载寄存器读写）和 MIPI 数据通道（快、单向、只运像素）。点亮失败时第一件事永远是先分清断在哪条通道上——第 3 段的 CHIP ID 验证就是这条分界线。

<!-- 【待补图】images/b-c-9-5-camera-to-display-pipeline.png（优先级：★必要）
图名：摄像头到屏幕的全链路数据流向图
生图提示词：横向系统框图，16:9，深色科技风背景。从左到右画五个大方框：OV5640 摄像头模组（画一个小镜头图标）、MIPI CSI-2 控制器、ISP/DMA、DDR 帧缓冲、DSI 屏（画一个小屏幕图标）。方框之间用粗箭头连接并标注数据类型：模组到控制器标"MIPI 高速像素流（单向）"，控制器到 DDR 标"DMA 搬运"，DDR 到屏标"应用读取 → DRM 显示"。在模组上方画一条细的虚线箭头从 SoC 指向模组，标注"I2C 配置通道（低速双向）"。每个方框下方用小字标注对应的验证手段：万用表/i2cdetect、media-ctl、v4l2-ctl、modetest。全图中文标注。 -->

本节覆盖：硬件检查清单、完整设备树、七段点亮流程（供电→时钟→I2C→驱动→MIPI→采集→显示）、raw 帧解析验证、FFmpeg 推流，以及覆盖全链路的排障对照表。

## <span class="blue"> 硬件检查清单（上电前）

软件之前，先排除物理层。摄像头模组的每根线都有明确的验证手段：

| 检查项 | 手段 | 合格判据 |
|--------|------|---------|
| 三路供电 AVDD/DOVDD/DVDD | 万用表量模组排针 | 2.8V / 1.8V / 1.5V（以 datasheet 为准） |
| XCLK 输入时钟 | 示波器 | 24MHz（或 27MHz）方波/正弦，幅度达标 |
| RESET/PWDN 引脚 | 万用表/示波器 | 上电后 RESET 释放为高、PWDN 为低（以模组定义为准） |
| MIPI 走线 | 目检 + 原理图比对 | D0/D1/CLK 差分对连接正确、无极性反接 |
| I2C 上拉 | 万用表 | SDA/SCL 有上拉（通常 4.7kΩ 到 1.8V） |

> ⚠️ OV 系 sensor 的上电时序是硬性要求：DOVDD → AVDD → DVDD → XCLK 稳定 → 释放 RESET → 等 20ms 才允许 I2C 访问。时序错不一定立刻烧片，但会导致芯片偶发不识别——"有时能扫到 0x3c 有时不能"八成是这里。内核 sensor 驱动会按设备树里声明的 regulator 顺序和 `startup-delay-us` 处理时序，你的任务是把设备树写对。

## <span class="blue"> 设备树：三条通道一次写全

摄像头在系统里有三条独立通道，设备树分别描述：**供电/控制**（regulator + GPIO）、**配置通道**（I2C 节点）、**数据通道**（endpoint 互联）：

```dts
/* ==== 1. 供电：三路 regulator ==== */
reg_ov5640_avdd: regulator-avdd {
    compatible = "regulator-fixed";
    regulator-name = "ov5640_avdd";
    regulator-min-microvolt = <2800000>;
    regulator-max-microvolt = <2800000>;
    gpio = <&gpio1 5 GPIO_ACTIVE_HIGH>;
    enable-active-high;
    startup-delay-us = <20000>;          /* 上电后等 20ms */
};
/* dovdd（1.8V）、dvdd（1.5V）同理定义 */

/* ==== 2+3. sensor 节点：I2C 配置通道 + MIPI 数据通道 ==== */
&i2c2 {
    status = "okay";
    clock-frequency = <100000>;

    ov5640: camera@3c {
        compatible = "ovti,ov5640";
        reg = <0x3c>;

        AVDD-supply  = <&reg_ov5640_avdd>;
        DOVDD-supply = <&reg_ov5640_dovdd>;
        DVDD-supply  = <&reg_ov5640_dvdd>;
        reset-gpios  = <&gpio3 14 GPIO_ACTIVE_LOW>;
        pwdn-gpios   = <&gpio3 15 GPIO_ACTIVE_HIGH>;
        clocks = <&clks IMX6QDL_CLK_CKO>;
        clock-names = "xclk";
        clock-frequency = <24000000>;

        port {
            ov5640_ep: endpoint {
                remote-endpoint = <&mipi_csi_ep>;
                data-lanes = <1 2>;
                clock-noncontinuous;
                link-frequencies = /bits/ 64 <160000000>;
            };
        };
    };
};

/* CSI-2 控制器侧 */
&mipi_csi {
    status = "okay";
    ports {
        #address-cells = <1>;
        #size-cells = <0>;
        port@0 {
            reg = <0>;
            mipi_csi_ep: endpoint {
                remote-endpoint = <&ov5640_ep>;
                data-lanes = <1 2>;      /* 必须与 sensor 侧一致 */
            };
        };
    };
};
```

三个一致性检查（写完后逐项核对）：`data-lanes` 两端一致；`remote-endpoint` 双向互指无拼写错误；regulator 的 `startup-delay-us` 覆盖上电时序要求。

## <span class="blue"> 七段点亮流程

### 第 1 段：供电确认

```bash
dmesg | grep -i regulator
```

正常时这里应该一片安静——regulator 框架只在出错时才说话。如果看到 `regulator-fixed: probe failed` 或 `failed to get supply` 字样，说明设备树的 regulator 引用有问题，后面不用看了。

日志安静之后用万用表实测三路电压（模组排针上量，不要在 SoC 侧量）。通过判据：AVDD/DOVDD/DVDD 实测值都在 datasheet 允许范围内。失败 → 查设备树 regulator 定义、`enable-active-high` 极性是否写反、硬件电源树有没有真把 GPIO 接到 LDO 使能脚上。

### 第 2 段：时钟确认

```bash
cat /sys/kernel/debug/clk/clk_summary | grep -i cko
```

```
       clock             enable_cnt  prepare_cnt  rate        accuracy   phase
cko2                        1            1        24000000    0          0
```

关注三列：`enable_cnt ≥ 1`（有人使能了它）、`rate = 24000000`（频率正确）。如果 `enable_cnt = 0`，说明 sensor 驱动没有成功 `clk_prepare_enable`——通常是设备树 `clocks` 属性引错了时钟源，或者驱动 probe 在更早的步骤就失败了（回第 1 段查供电）。

有条件的话示波器在模组排针上实测。示波器看到的是模拟真相：频率对不对、幅度够不够（XCLK 高电平要达到 DOVDD 域的高电平标准）、有没有起振。失败 → 查 `clocks`/`clock-frequency` 属性和 SoC 时钟父链。

### 第 3 段：I2C 配置通道

```bash
i2cdetect -y 2
```

```
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:                         -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- 3c -- -- --
```

看到 `3c` 出现，说明 sensor 在应答它的 I2C 地址。然后读 CHIP ID 验明正身：

```bash
i2cget -y 2 0x3c 0x300a w          # CHIP ID 高字节
```

```
0x5600
```

OV5640 的 CHIP ID 寄存器是 0x300A（高字节）和 0x300B（低字节），正确值分别是 0x56 和 0x40。注意 OV 系寄存器地址是 16 位宽，而 `i2cget` 的地址参数只有 8 位——`w` 模式下传入 0x300a 时低 8 位才是实际寄存器偏移，读到 0x56xx 即正确（不同 i2cget 版本对 16 位地址的支持有差异，读不出来时换 `i2ctransfer` 发双字节地址）。

通过判据：CHIP ID 读出 `0x56`。**这是整个点亮流程最重要的一个里程碑**——它证明供电、时钟、复位、I2C 四件事全对，且配置通道畅通。失败 → 回到第 1、2 段，并用示波器看 I2C 波形：有没有起始条件、从机有没有拉 ACK、ACK 电平是否被正确识别（1.8V 域的 sensor 配 3.3V 上拉时，ACK 低电平可能不够低）。

### 第 4 段：驱动绑定与 video 节点

```bash
dmesg | grep -i ov5640
ls -l /dev/video*
```

```
ov5640 2-003c: ov5640 detected at address 0x3c
crw-rw---- 1 root video 81, 0 /dev/video0
```

第一行说明 sensor 驱动的 probe 跑完了：驱动按设备树拿了 regulator、GPIO、时钟，然后通过 I2C 读了 CHIP ID 并与预期值比对——这就是第 3 段手工做的事，驱动自己又做了一遍。第二行说明 V4L2 框架为整个 pipeline 创建了采集节点。

通过判据：probe 成功日志 + video 节点生成。失败 → 看 dmesg 具体报错逐字读：`endpoint not connected` 类查 `remote-endpoint` 双向互指；没有任何 ov5640 字样查内核配置 `CONFIG_VIDEO_OV5640` 有没有编进来；`failed to read chip id` 回第 3 段。

### 第 5 段：链路拓扑与格式枚举

```bash
media-ctl -d /dev/media0 --print-topology
```

```
- entity 1: ov5640 2-003c (1 pad, 1 link)
            type V4L2 subdev subtype Sensor flags 0
            device node name /dev/v4l-subdev0
	pad0: Source
		[fmt:UYVY8_2X8/1920x1080 field:none]
		-> "mxc-mipi-csi2.0":0 [ENABLED]

- entity 5: mxc-mipi-csi2.0 (2 pads, 2 links)
            type V4L2 subdev subtype Unknown flags 0
	pad0: Sink
		[fmt:UYVY8_2X8/1920x1080 field:none]
		<- "ov5640 2-003c":0 [ENABLED]
	pad1: Source
		-> "mxc-mipi-csi2.0 capture":0 [ENABLED]
```

> entity / pad / link：media controller 框架的三个基本概念。entity 是链路里的一个处理单元（sensor、CSI 控制器、ISP 都是 entity）；pad 是 entity 的进出端口，分 Source（出）和 Sink（入）；link 是两个 pad 之间的连接，`[ENABLED]` 表示当前生效。读拓扑图就是沿着 link 从 Sensor 一路走到 capture 节点，中间任何一环没有 `[ENABLED]` 就是断点。

通过判据：从 `ov5640` 实体能沿 ENABLED 链路走到 capture 节点；各 pad 上的格式协商一致（上例都是 `UYVY8_2X8/1920x1080`）。再看采集节点认什么格式：

```bash
v4l2-ctl -d /dev/video0 --list-formats-ext
```

```
ioctl: VIDIOC_ENUM_FMT
	Type: Video Capture
	[0]: 'UYVY' (UYVY 4:2:2)
		Size: Discrete 1920x1080
			Interval: Discrete 0.033s (30.000 fps)
		Size: Discrete 1280x720
			Interval: Discrete 0.033s (30.000 fps)
```

格式列表非空且覆盖你要用的分辨率即可。拓扑断链 → subdev 间的 endpoint 没建起来，回查设备树 port 层级；格式列表为空 → 驱动 probe 了但 pipeline 没组好，dmesg 找 async 子框架的等待日志。

### 第 6 段：采集验证（核心段）

```bash
# 设格式：1080p UYVY 30fps（必须与第 5 段枚举出的格式一致）
v4l2-ctl -d /dev/video0 \
    --set-fmt-video=width=1920,height=1080,pixelformat=UYVY --set-parm=30

# 抓 10 帧到文件
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=10 --stream-to=/tmp/cap.yuv
```

```
<<<<<<<<<< 10.02 fps
10 frames captured, 0 dropped
```

先验证字节数对不对——这是最快的完整性检查：

```bash
ls -l /tmp/cap.yuv
# 期望值 = 1920 × 1080 × 2 字节/像素 × 10 帧 = 41472000 字节
```

YUYV/UYVY 这类 YUV422 打包格式是每 2 个像素占 4 字节，即每像素 2 字节。文件大小不符说明 DMA 搬运不完整。大小对了再转图看内容：

```bash
ffmpeg -s 1920x1080 -pix_fmt uyvy422 -i /tmp/cap.yuv -frames:v 1 /tmp/frame.png
```

通过判据：帧数够 10 帧、fps 接近 30、文件大小精确等于期望值、png 图像内容正确（对着有特征的物体拍，比如带字的纸）。注意 ffmpeg 的 `-pix_fmt` 必须和采集格式一致——UYVY 写成 yuyv422 会得到颜色错乱的图，这种"抓到了但颜色不对"是格式名写错，不是硬件问题。这一段的失败模式最丰富，单独给排障表（见文末）。

### 第 7 段：上屏显示

采集→显示打通的最后一步，用 ffmpeg 把 V4L2 采集直接送到 framebuffer（DSI 屏已在 B-C.9.3 点亮的前提下）：

```bash
# 方案 A：fb 直显（简单，适合验证）
ffmpeg -f v4l2 -input_format yuyv422 -video_size 800x480 -framerate 30 \
       -i /dev/video0 -pix_fmt bgra -f fbdev /dev/fb0

# 方案 B：GStreamer 走 DRM/KMS（支持硬件缩放合成，量产方案）
gst-launch-1.0 v4l2src device=/dev/video0 ! \
    video/x-raw,width=800,height=480 ! \
    kmssink

# 方案 C：网络推流（不带屏的调试场景）
ffmpeg -f v4l2 -input_format yuyv422 -video_size 1280x720 -framerate 30 \
       -i /dev/video0 -c:v libx264 -preset ultrafast -tune zerolatency \
       -f flv rtmp://server/live/cam
```

通过判据：屏上出画面 / 播放器拉到流。至此整条链路打通：Sensor → MIPI → CSI → ISP → DDR → 应用 → DRM → DSI → 屏。

## <span class="blue"> 排障对照表（按失败段定位）

| 现象 | 所在段 | 第一怀疑 | 手段 |
|------|--------|---------|------|
| i2cdetect 无 0x3c | 3 | 供电/复位/PWDN 电平 | 万用表三路电压 + GPIO 状态 |
| 能扫到但读 ID 错 | 3 | I2C 电平不匹配（1.8V 域接 3.3V 上拉） | 示波器看 ACK 电平 |
| 无 /dev/video0 | 4 | compatible/endpoint | dmesg probe 报错逐字读 |
| 拓扑断链 | 5 | port/endpoint 层级错误 | media-ctl 对照设备树 |
| STREAMON 超时无数据 | 6 | lane 数两端不一致；sensor 未真正开流 | 示波器看 MIPI 线有无 HS 翻转；查 sensor 驱动日志 |
| 花屏（有图但错乱） | 6 | DT 格式不匹配（YUYV 按 RAW 解）；lane 顺序接反 | `--list-formats-ext` 与驱动默认格式比对 |
| 颜色偏色 | 6 | Bayer 序/Bayer 翻转，或 YUV 分量序错 | 拍纯色卡（红纸）对照 |
| 帧率不达标 | 6 | link-frequencies 过低；曝光时间超限 | `v4l2-ctl --get-parm`；减小分辨率复测 |
| 抓图正常上屏黑 | 7 | DRM 链路或像素格式转换 | 先 modetest 彩条确认屏侧完好 |

> 💡 第 6 段的一个加速技巧：sensor 大多内置测试图模式（test pattern，彩条/渐变），OV5640 是寄存器 `0x503D` 写 `0x80` 开启。开测试图后 MIPI 输出的是芯片自己生成的已知图案——抓出来如果是标准彩条，说明 MIPI 链路 + 解包全对，剩下的问题只在镜头/感光侧。这一招把"链路问题"和"光学问题"一刀切开。

## <span class="blue"> 本节总结

这篇实战真正交付的不是点亮 OV5640 的步骤，而是分段验证的方法论：链条越长，越不能端到端地看结果——"没图"这一个现象背后有十来个可能的断点，逐段推进让每一段都有独立的通过判据，问题永远被锁定在当前段内。这套节奏（先物理层、再配置通道、再数据通道、最后应用层）不只对摄像头成立，网卡、存储、音频的 bring-up 都是同一个套路。

七段里最值钱的两个里程碑要记住：一是第 3 段的 CHIP ID——能读到它，说明供电、时钟、复位、I2C 四个物理前提全对，之后的所有问题都被划进软件域；二是 test pattern——开测试图后抓出来的图像是芯片自己生成的已知图案，链路对则图案标准，这一招把"MIPI 链路问题"和"镜头光学问题"一刀切开，能省掉半天瞎猜。

设备树的三条通道（供电、I2C 配置、endpoint 数据）是这类外设的通用写法，和 B-C.9.3 的 panel 节点、B-B.3 的传感器节点结构同构。写完后养成习惯做三个一致性检查：`data-lanes` 两端一致、`remote-endpoint` 双向互指、regulator 时序覆盖 datasheet 要求——这三个是 review 摄像头设备树时命中率最高的错误点。

### 速查表

| 项 | 要点 |
|----|------|
| 上电时序 | DOVDD→AVDD→DVDD→XCLK→释放 RESET→等 20ms 才允许 I2C |
| 第一里程碑 | i2cget 读 CHIP ID（0x300A=0x56），过了=物理层四件事全对 |
| 拓扑验证 | `media-ctl --print-topology`，沿 ENABLED 从 Sensor 走到 capture |
| 完整性快查 | 文件大小 = 宽×高×2×帧数（YUV422 每像素 2 字节） |
| 链路/光学隔离 | test pattern：OV5640 写 0x503D=0x80 |
| 上屏三方案 | fbdev 直显（验证用）/ kmssink（量产）/ ffmpeg 推流（无屏） |
| DTS 三查 | data-lanes 两端一致、endpoint 双向互指、startup-delay 覆盖时序 |

### 本节自查

1. 为什么"能扫到 0x3c 但时有时无"优先怀疑上电时序而不是 I2C 驱动？
2. `media-ctl` 拓扑里 sensor 实体存在但 link 不是 ENABLED，问题在哪一层？
3. 抓到 10 帧但文件只有 3000 万字节（期望 4147 万），说明什么？
4. ffmpeg 转出的 PNG 颜色发紫发绿，但画面结构清楚，最可能是什么原因？
5. STREAMON 超时无数据，示波器应该看哪几根线、看什么现象？

## <span class="blue"> 下一步

C 板块（中高速外设与存储）到此收官。下一站进入 **D 板块：专用网络总线**，开篇 **B-D.10.1 PCIe 基础与物理层**——从板级低速总线跨到计算机系统里带宽最高、协议最复杂的互联，你会看到 SerDes、LTSSM、TLP 这些词如何把"设备互联"这件事推向另一个量级。

> 💡 本篇是前三篇的合龙：D-PHY（B-C.9.1）解释了示波器上 LP/HS 翻转的波形含义，CSI-2 与 V4L2（B-C.9.2）解释了 media-ctl 拓扑里的格式协商，DSI 与 DRM（B-C.9.3）提供了第 7 段的显示通路。往后走，sensor 寄存器配置的全部技巧来自 B-B.3 I2C，probe 流程与 endpoint 解析的机制根基在第 11 章设备模型，V4L2 的完整用户态编程见 B-C.7.3 的 UVC 实战（MIPI 与 UVC 摄像头在应用层是同一套 API）。
