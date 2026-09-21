# B-C.9.3 MIPI DSI 协议层与 DRM

> 所属章节：第五部 B. 总线协议 > B-C.9 显示与摄像
>
> 难度：[M] Master | 预计阅读时间：40 分钟

## <span class="blue"> 本节导读

前两节讲的是"摄像头进"（CSI-2）；本节讲"屏幕出"（DSI）。DSI 与 CSI-2 共享 D-PHY 物理层，包格式同源，但应用方向相反、且多了一套显示专用的 DCS 命令集。软件栈这边对应的框架也从 V4L2 换成了 DRM/KMS。

点一块 MIPI 屏的翻车现场高度集中：白屏、花屏、镜像、红蓝交换。这四个问题的根因几乎都能在本篇找到——初始化序列时序、COLMOD 像素格式、MADCTL 扫描方向。本节把这些讲透，并给出 DRM/KMS 的组件地图与一套可复制的调屏流程。

本节覆盖：DSI 命令模式与视频模式的取舍、短包/长包格式、DCS 核心命令集与 MADCTL/COLMOD 详解、初始化序列的时序纪律、DRM/KMS 组件链（CRTC→Encoder→Connector→Panel）、5 寸 ST7701S 屏的完整设备树与 modetest 验证、显示类问题排查表。

## <span class="blue"> DSI 的两种工作模式

DSI 协议层定义了两种截然不同的模式，选择哪种由面板构造和应用场景共同决定。

### 命令模式（Command Mode）

基于事务的低功耗方式：面板内部自带帧缓冲（GRAM），CPU 只在画面变化时发 DCS 命令更新 GRAM，面板自己负责把 GRAM 持续刷到屏幕上：

```
CPU → DCS 命令（0x2C Memory Write）+ 像素数据 → 面板 GRAM → 面板自行刷新
```

> GRAM（Graphic RAM）：显示驱动 IC 内置的帧存储器。带 GRAM 的面板能"记住"一整帧画面，主机不发新数据，画面也一直显示。

优势是功耗极低——画面不变时链路可以完全静默，适合电子书、智能手表、工业仪表这类静态画面为主的设备。代价是刷新率受主机更新频率限制，不适合视频。

### 视频模式（Video Mode）

实时像素流：DSI 控制器按固定显示时序持续不断地向面板发送像素流，面板不需要整帧 GRAM，只要行缓冲：

```
DDR 帧缓冲 → DMA → LCD 控制器 → DSI Host → 面板逐行实时显示
```

优势是高刷新率、低延迟，手机主屏、车载导航都是这种。代价是链路持续跑 HS，功耗高。

### 对比与选型

| 维度 | 命令模式 | 视频模式 |
|------|---------|---------|
| 传输 | 按需事务 | 实时像素流 |
| 面板 GRAM | 必须有（存整帧） | 不需要（行缓冲即可） |
| 功耗 | 低（空闲可停时钟） | 高（持续 HS） |
| 适用 | 静态 UI、电子纸、仪表 | 视频、手机主屏 |
| 撕裂 | 需要 TE 信号同步 | 时序天然同步 |

> 撕裂（Tearing）：帧缓冲在屏幕刷新到一半时被更新，导致画面上半是新帧、下半是旧帧的错位现象。命令模式下由面板的 TE（Tearing Effect）信号通知主机"现在刷新空隙，可以写 GRAM"；视频模式因为主机按显示时序逐行推流，天然与屏幕同步。

> 💡 选型判断不只看屏幕尺寸：很多 5 寸以下工业屏用命令模式 + 内置 GRAM，功耗可低至视频模式的十分之一。反过来，不要以为小屏就一定是命令模式——看面板手册里驱动 IC 支持的模式和有无 GRAM。

## <span class="blue"> 包格式：与 CSI-2 同源的短包/长包

DSI 的包结构与 CSI-2 一脉相承（同一套 D-PHY 之上）。

**短包（4 字节）**：Data ID（VC+DT）+ 2 字节参数 + ECC。DCS 短写命令走这里——Payload 就是一个命令码（或命令码 + 1 字节参数）。

**长包（4 字节头 + Payload + 2 字节 CRC）**：Payload 最大 64KB，图像数据块和长配置序列走这里。

命令模式写一帧 800×480×16bpp 图像的包序列：

```
[长包] DI=0x29(DCS Long Write) → 0x2C(Memory Write) + 后续参数
[长包] 连续像素数据：800×480×2 = 768000 字节，分包发送
```

ECC 保包头、CRC 保 Payload 的分工与 CSI-2 完全一致，不再重复。

## <span class="blue"> DCS 命令集：面板的标准语言

DCS（Display Command Set）是 MIPI 定义的显示面板标准指令集。初始化、睡眠唤醒、亮度、GRAM 读写都靠它。

| 命令 | 码 | 功能 | 备注 |
|------|-----|------|------|
| Sleep In | 0x10 | 进睡眠 | 功耗最低 |
| Sleep Out | 0x11 | 出睡眠 | **之后必须等 120ms** |
| Display Off | 0x28 | 关显示 | GRAM 内容保留 |
| Display On | 0x29 | 开显示 | 开始从 GRAM 刷屏 |
| Column Address Set | 0x2A | 设列地址窗口 | 4 字节参数：XS/XE |
| Page Address Set | 0x2B | 设行地址窗口 | 4 字节参数：YS/YE |
| Memory Write | 0x2C | 写 GRAM | 跟像素数据流 |
| MADCTL | 0x36 | 扫描方向控制 | 见下文 |
| COLMOD | 0x3A | 像素格式 | 0x55=16bpp，0x66=18bpp，0x77=24bpp |
| Write Brightness | 0x51 | 亮度 | 0x00~0xFF |

### MADCTL：一个字节决定画面方向

```
MADCTL[7:0] = [MY, MX, MV, ML, RGB, -, -, MH]

MY(D7) 行地址顺序     0=上→下  1=下→上
MX(D6) 列地址顺序     0=左→右  1=右→左
MV(D5) 行列交换       0=正常   1=交换（横竖屏切换）
ML(D4) 行刷新顺序
RGB(D3) 颜色序        0=RGB    1=BGR
MH(D2) 水平刷新顺序
```

常见值：正常竖屏 `0x00`；横屏 `0x60`（MX+MV）；竖屏镜像 `0xC0`（MY+MX）；红蓝反了就翻 RGB 位。

### 初始化序列的时序纪律

标准流程（顺序与延时都不可省）：

```
上电 → 硬件复位（RST 低 ≥10μs）→ 等 10ms
  → Sleep Out(0x11) → 等 120ms          ← 面板内部电路稳定时间
  → MADCTL(0x36) 扫描方向
  → COLMOD(0x3A) 像素格式
  → 厂商私有寄存器配置（电源/Gamma/VCOM……）
  → Display On(0x29) → 正常显示
```

四类经典翻车与根因一一对应：

| 现象 | 根因 |
|------|------|
| 白屏（背光亮无图像） | 初始化序列缺步骤，或 Sleep Out 后没等够 120ms，后续命令被面板忽略 |
| 花屏/色彩异常 | COLMOD 像素格式与 DSI 输入格式不匹配 |
| 镜像/旋转/红蓝交换 | MADCTL 配置与面板安装方向不符 |
| 局部不刷新 | 0x2A/0x2B 的地址窗口参数错误 |

## <span class="blue"> DRM/KMS：Linux 显示栈的组件链

DRM（Direct Rendering Manager）是内核显示框架，KMS（Kernel Mode Setting）负责模式配置。一条 DSI 显示链路被抽象为五个组件的串联：

```
drm_crtc        → drm_encoder → drm_bridge → drm_connector → drm_panel
（显示控制器，    （信号编码，    （可选桥接片，  （接口连接检测， （物理面板，
  如 RK VOP）      如 DSI Host）   如 DSI→LVDS）   报告 EDID/状态）  如 ST7701S）
      │
      ▼
  Framebuffer/GEM（用户态 mmap 的帧缓冲）
```

> 各组件一句话版：CRTC 回答"画面从哪来、什么时序"（从 DDR 帧缓冲按显示时序取数）；Encoder 回答"转成什么信号"（DSI/LVDS/HDMI）；Bridge 是中间的协议转换芯片；Connector 回答"对面插了什么"；Panel 回答"这块屏怎么初始化"。调屏时按这条链逐环确认，不会迷路。

实际硬件 pipeline：

```
DDR 帧缓冲 → DMA → LCD 控制器(VOP/DCSS/DE2) → DSI Host → MIPI 2/4 lane → 面板驱动IC → 玻璃
```

## <span class="blue"> 实战：5 寸 ST7701S（800×480，DSI 2-lane）

### 硬件与连接

面板：5 寸 IPS，800×480，ST7701S 驱动 IC，DSI 2-lane，PWM 背光，另挂 GT911 电容触摸（I2C）。SoC 侧以 RK3568 为例。

### 设备树

```dts
&dsi {
    status = "okay";
    rockchip,lane-rate = <500>;        /* 每 lane 500 Mbit/s */

    dsi_panel: panel@0 {
        compatible = "sitronix,st7701s", "simple-panel-dsi";
        reg = <0>;

        backlight = <&backlight_lcd>;
        power-supply = <&vcc3v3_lcd>;
        reset-gpios = <&gpio0 RK_PC6 GPIO_ACTIVE_LOW>;

        dsi,flags = <MIPI_DSI_MODE_VIDEO | MIPI_DSI_MODE_VIDEO_BURST>;
        dsi,format = <MIPI_DSI_FMT_RGB888>;
        dsi,lanes = <2>;

        /* 显示时序：800x480 @ 60Hz */
        panel-timing {
            clock-frequency = <30000000>;
            hactive = <800>;
            vactive = <480>;
            hfront-porch = <40>;
            hsync-len = <10>;
            hback-porch = <40>;
            vfront-porch = <20>;
            vsync-len = <5>;
            vback-porch = <20>;
        };

        /* DCS 初始化序列（字节编码格式由 panel 驱动定义，
           本例为 Rockchip panel-simple-dsi 格式：
           首字节=包类型(05/15/29)，ff 开头=延时 ms） */
        panel-init-sequence = [
            05 78 11            /* Sleep Out，延时 0x78=120ms */
            15 00 36 00         /* MADCTL = 0x00：正常扫描，RGB */
            15 00 3A 77         /* COLMOD = 0x77：24bpp RGB888 */
            29 00 B6 0A 82 27 00   /* DISCTRL（ST7701S 私有寄存器） */
            29 00 C1 24 02 03      /* PWMCTRL */
            29 00 B5 0F 0F         /* VCOM */
            29 00 C0 08 05         /* PWRCTRL1 */
            29 00 E0 00 0C 11 05 0A 06 2F 44 4A 0D 18 15 19 10 1A 00  /* Gamma+ */
            29 00 E1 00 19 11 05 0A 06 2F 44 4A 0D 18 15 19 10 1A 00  /* Gamma- */
            05 28 29            /* Display On，延时 40ms */
        ];

        panel-exit-sequence = [
            05 28 28            /* Display Off */
            05 78 10            /* Sleep In */
        ];
    };
};

/* 背光：PWM 调光 */
backlight_lcd: backlight {
    compatible = "pwm-backlight";
    pwms = <&pwm4 0 25000 0>;          /* 25kHz */
    brightness-levels = <
          0   1   2   3   4   5   6   7
          8  16  32  48  64  80  96 112
        128 144 160 176 192 208 224 240
        255
    >;
    default-brightness-level = <12>;
    power-supply = <&vcc5v0_lcd>;
};
```

> ⚠️ `panel-init-sequence` 的字节编码格式是**驱动私有的**，不是设备树通用标准。Rockchip 下游驱动用"类型+延时+载荷"，其他平台（如内核主线 `panel-simple`）格式不同。换平台时第一动作是读对应 panel 驱动的 binding 文档（`Documentation/devicetree/bindings/display/panel/`），照抄别家格式的初始化序列是白屏的经典来源。

### 验证：modetest 与 fb0 两级测试

```bash
# 1. DRM 组件注册情况
modetest -M rockchip
```

```
Encoders:
id  crtc type  possible crtcs possible clones
36  34   DSI    0x00000001    0x00000000
Connectors:
id  encoder status     name   size(mm)  modes  encoders
37  36     connected  DSI-1  110x65    1      36
```

`connected` + 有 modes 说明面板链路通了。

```bash
# 2. 彩条测试：不依赖任何文件系统内容，直接验证显示通路
modetest -M rockchip -s 37@36:800x480 -C smpte
```

看到 SMPTE 彩条 = CRTC→Encoder→DSI Host→Panel 全链路正常。白屏/花屏则问题在 panel 初始化序列。

```bash
# 3. fb 级验证：直接写像素
cat /dev/urandom > /dev/fb0        # 雪花噪点 = fb→panel 通路正常
fbset                               # 查看当前模式参数
```

```bash
# 4. 背光独立验证
echo 255 > /sys/class/backlight/backlight_lcd/brightness
echo 0   > /sys/class/backlight/backlight_lcd/brightness
```

> 💡 背光亮 ≠ 显示正常。很多面板上电背光就亮（背光电路独立供电），图像链路完全没通时屏幕也是"亮的白屏"。所以调屏三步法的顺序是：先 modetest 彩条（不依赖背光判断），再背光 PWM，最后应用画面。

### 调试命令

```bash
# DRM 日志与动态调试
dmesg | grep -i "drm\|dsi\|panel"
echo 'module rockchip_drm +p' > /sys/kernel/debug/dynamic_debug/control
echo 'module dw_mipi_dsi +p' > /sys/kernel/debug/dynamic_debug/control

# DRM 状态全景
cat /sys/kernel/debug/dri/0/state

# 连接器状态
cat /sys/class/drm/card0-DSI-1/status
```

逻辑分析仪抓 DSI 波形时的要点：采样率 ≥ 2×HS 比特率（2-lane @ 500Mbit/s 需要 ≥1GSa/s）；通道接 CLK±、D0±、D1±；用 MIPI DSI 协议解码直接还原出初始化 DCS 序列，与手册逐条比对——这是白屏问题的终极手段。

### 问题排查表

| 现象 | 第一怀疑 | 手段 |
|------|---------|------|
| 白屏 | 初始化序列缺步骤/延时不够/编码格式抄错 | 逻辑分析仪比对 DCS 序列 |
| 花屏、彩色噪点 | COLMOD 与 dsi,format 不一致 | 核对两端像素格式 |
| 镜像/旋转/红蓝反 | MADCTL | 翻对应位 |
| 画面撕裂 | 命令模式缺 TE 同步；视频模式时序错 | 查 TE 连线与时序参数 |
| 背光闪烁 | PWM 频率过低 | 提到 20kHz 以上 |
| modetest 无 connector | 设备树端口/endpoint 没连上 | 对照 dmesg 的 panel probe 日志 |

## <span class="blue"> 本节总结

把 DSI 收拢成一句话：它就是"显示方向的 CSI-2"——同一层 D-PHY、同一套短包/长包格式，差别只在数据流向相反，以及多了一套 DCS 命令语言。前两节学的包格式、ECC/CRC 分工、LP/HS 状态切换，到这里全部直接复用，真正的新内容只有 DCS 命令集和 DRM/KMS 这条组件链。

调屏的四类经典翻车不是玄学，每一个都有唯一的机械根因：白屏对应初始化序列（缺步骤、延时不够、编码格式抄错平台），花屏对应 COLMOD 与 DSI 输入格式不匹配，镜像和红蓝反对应 MADCTL 的那几个位，局部不刷新对应 0x2A/0x2B 的地址窗口。拿到一块点不亮的屏，先按这张对应表定位到寄存器，再动手改，比盲目换初始化序列快得多。

工程流程上记住两件事：一是 `panel-init-sequence` 的字节编码格式是驱动私有的，换平台先读 binding 文档再抄序列；二是验证顺序固定为 modetest 彩条 → fb 写像素 → 背光控制，三步各自独立、互不依赖，能把"链路不通"和"背光没起"彻底分开。

### 速查表

| 项 | 要点 |
|----|------|
| 模式选型 | 静态 UI/低功耗 → 命令模式（面板带 GRAM）；视频/高刷 → 视频模式 |
| 关键延时 | 硬件复位后 ≥10ms；Sleep Out(0x11) 后必须等 120ms |
| MADCTL(0x36) | MY/MX/MV 控制扫描方向，RGB 位翻转转 BGR |
| COLMOD(0x3A) | 0x55=16bpp / 0x66=18bpp / 0x77=24bpp，必须与 dsi,format 一致 |
| DRM 链 | CRTC → Encoder → Bridge → Connector → Panel，调屏逐环确认 |
| 验证三步 | modetest 彩条 → `cat /dev/urandom > /dev/fb0` → 背光 PWM |
| 终极手段 | 逻辑分析仪 DSI 解码，与手册逐条比对 DCS 序列 |

### 本节自查

1. 命令模式和视频模式对面板硬件的要求差在哪？为什么电子书用前者、手机主屏用后者？
2. 一块屏点亮后画面左右镜像、红蓝互换，分别该改 MADCTL 的哪几位？
3. Sleep Out 之后的 120ms 延时省掉会怎样？为什么？
4. `modetest -s 37@36:800x480 -C smpte` 出彩条能证明什么、不能证明什么？
5. 把 Rockchip 的 `panel-init-sequence` 原样抄到内核主线 `panel-simple` 驱动的平台上，会发生什么？为什么？

## <span class="blue"> 下一步

下一节 **B-C.9.4 LVDS/eDP/HDMI/DisplayPort**：MIPI DSI 主要覆盖中小尺寸屏，工业大屏、笔记本内屏和桌面显示器走的是另一条路线。下一节把四种主流显示接口的电气特性、协议层次和 DRM 里的对接方式一次理清，并补上工控 HMI 里仍然常见的 RGB/DPI 并口屏。

> 💡 本节的 DRM 组件链（CRTC→Encoder→Connector→Panel）本质上是第 11 章设备模型在显示子系统的一次特化——每个组件都是一个 `struct device`，靠 of_graph 的 port/endpoint 串联；DCS 初始化序列与 B-B.3 节 I2C 外设的寄存器配置序列同属"配置通道"套路，只是一个走 DSI 一个走 I2C；panel-timing 里的 hfront-porch/vsync-len 等显示时序参数，在 B-C.9.4 讲 RGB/DPI 并口屏时还会原样再用一次。
