# B-C.9.4 LVDS / eDP / HDMI / DisplayPort

> 所属章节：第五部 B. 总线协议 > B-C.9 显示与摄像
>
> 难度：[E] Expert | 预计阅读时间：40 分钟

## <span class="blue"> 本节导读

MIPI DSI 不是唯一的显示接口。工业屏大量用 LVDS，笔记本内屏是 eDP，外接显示器是 HDMI/DP，MCU 级小屏和工业 HMI 还活跃着最原始的 RGB/DPI 并口——选错接口的代价很具体：PCB 走线爆炸、EMI 超标、或者屏幕根本点不亮。本篇把 MIPI 之外的五个主流显示接口的物理层与协议层讲清楚，给出六接口全景对比表，最后用一个"DSI 主屏 + HDMI 外接"的双屏实例把配置与排障跑通。

读完后两个高频问题的答案应该在你手里：EDID 为什么被称为显示器的"身份证"（读不到会怎样、怎么救）；面对一块屏，怎么在六种接口里做出有理据的选型。

本节覆盖：LVDS/eDP/HDMI/DP/RGB-DPI 的物理层与关键机制、panel-simple 驱动与 Panel Timings 参数计算、六接口选型对比、RK3568 双屏设备树与 xrandr 配置、EDID/DDC/HPD 相关故障排查。

## <span class="blue"> LVDS：工业显示的老兵

LVDS（Low-Voltage Differential Signaling）1994 年由美国国家半导体推出，至今仍是工业屏、车机、医疗设备的主力接口。

**物理层**：低电压差分传输，摆幅仅约 350mV，共模噪声抑制能力强，支持数米走线。标准 24-bit 单像素接口为 4 对数据线 + 1 对时钟线，共 5 对差分线：

```
LVDS0_TX0± ── Data0      LVDS0_TX3± ── Data3
LVDS0_TX1± ── Data1      LVDS0_CLK± ── Clock
LVDS0_TX2± ── Data2      （4 数据对 + 1 时钟对 = 10 根线）
```

**单像素 vs 双像素**：单像素模式每个时钟传 1 个像素。分辨率上到 1080p@60Hz 以上，像素时钟会顶破 LVDS 的物理上限（约 135MHz），此时切双像素模式（Dual Link）——两组各 5 对差分线并行，每周期传 2 个像素，时钟减半。代价是信号线翻倍到 20 根，PCB 布局压力骤增。

变体：OpenLDI 是 LVDS 的标准化版本；TI 的 FPD-Link 在其基础上加扰码与嵌入式时钟降低 EMI，车规场景极常见（长距版本就是 B-C.9.1 提到的加串/解串方案）。

## <span class="blue"> eDP：为笔记本内屏而生

eDP（Embedded DisplayPort）是 VESA 为笔记本/平板/嵌入式定制的 DisplayPort 子集，目标就是替代 LVDS。

**Lane 架构**：1/2/4 lane 可选，每 lane 一对差分线。4-lane 仅 8 根数据线 + 2 根 AUX 线就能驱动 4K@60Hz——对比 LVDS 双像素的 20 根线，PCB 优势是压倒性的。

**AUX 通道**：内置一条半双工差分辅助通道（1Mbit/s），面板初始化、EDID 读取、背光控制、电源管理都走它，省掉 LVDS 方案外挂的 I2C/SPI。

**PSR（Panel Self Refresh）**：画面不变时主控停止发视频流，面板用内部缓存自刷新。电池设备的刚需——静态界面下显示链路几乎零功耗。

## <span class="blue"> HDMI：消费电子事实标准

**TMDS 编码**：RGB 视频与音频经 TMDS（Transition Minimized Differential Signaling）编码为串行流，走 3 对 Data 通道，第 4 对传像素时钟。编码核心是 8b/10b——8bit 数据编成 10bit 传输码，保证直流平衡和足够的跳变沿供接收端恢复时钟。

Type-A 接口 19 针里的关键角色：

| 引脚 | 信号 | 作用 |
|------|------|------|
| 1~12 | TMDS Data0~2 ± / Clock ± | 音视频数据与像素时钟 |
| 13 | CEC | 一线遥控多设备（电视遥控器控机顶盒） |
| 15/16 | SCL/SDA | DDC 通道（I2C），读 EDID |
| 18 | +5V | 源端供电（55mA 上限），供显示器 EDID 芯片 |
| 19 | HPD | 热插拔检测 |

> EDID（Extended Display Identification Data）：显示器内置 EEPROM 里的 128 字节身份数据——支持的分辨率与时序列表、制造商、序列号。源端（你的板子）通过 DDC（就是一条 I2C，地址 0x50）读它来决定输出什么格式。没有 EDID，源端不知道显示器能吃什么，只能猜。

> HPD（Hot Plug Detect）：显示器的"我插上了"信号线。显示器接入时拉高此线，源端检测到边沿后才去读 EDID、建链路。HPD 引脚没配或极性反，系统层面表现为"显示器不存在"。

## <span class="blue"> DisplayPort：高带宽的现代架构

DP 同为 1/2/4 lane 差分结构，但单 lane 速率远高于 LVDS：DP 1.2 每 lane 5.4 Gbit/s，DP 1.4 达 8.1 Gbit/s，4-lane 总带宽 25.8 Gbit/s，可驱 8K@60Hz。

与 HDMI 的像素流不同，DP 用**微包（Micro-Packet）**架构：视频数据封装在定长包中传输，时钟内嵌，不需要独立时钟通道。包化架构让带宽可以灵活分配给视频、音频、甚至 USB（DP Alt Mode，Type-C 一线通的底层）。

**链路训练（Link Training）** 是 DP 特有机制：正式传视频前，收发双方经 AUX 通道协商 lane 数、速率档位、驱动强度与均衡参数，按实际信道质量定工作点。训练失败的典型症状是屏幕闪断、降分辨率——此时查线缆质量与连接器。

## <span class="blue"> RGB/DPI：并口直推的原始方案

RGB 并口（内核里叫 DPI，Display Parallel Interface）是最古老的显示接口：不编码、不打包、不差分，每个像素时钟沿直接把一组 TTL 电平的 RGB 数据推到面板上。

**信号构成**（以 24bpp 为例）：

```
D[23:16] ── R[7:0]      HSYNC ── 行同步
D[15:8]  ── G[7:0]      VSYNC ── 帧同步
D[7:0]   ── B[7:0]      DE    ── 数据有效
                        PCLK  ── 像素时钟
共 24 根数据线 + 4 根控制线 = 28~29 根，全单端 TTL
```

**DE 模式与 SYNC 模式**：面板有两种吃法。SYNC 模式下控制器按完整时序发 HSYNC/VSYNC 和前后肩，面板靠同步脉冲找每行每帧的边界；DE 模式只认 DE 高电平期间的像素，同步脉冲可以省略。用哪种看面板手册，设备树里对应 `de-active` 与同步信号的极性配置——配错的表现是画面整体偏移或只在左上角显示一小块。

**它现在还活在哪**：STM32/全志 F1C100s 这类 MCU 级芯片的 LTDC/LCD 控制器、4.3 寸和 7 寸工业 HMI 屏（800×480 是主流）、以及大量十年以上寿命的存量工控设备。这些场景分辨率低、走线短（屏就贴在板子旁边），并口的缺点被场景消化掉了。

**上限与代价**：单端 TTL 的 EMI 差、走线必须等长、最多走 30cm；24 根数据线吃引脚，分辨率上 1080p 像素时钟近 150MHz，边沿速率跟不上的同时 EMI 已经超标。所以它是"低成本小屏"的专属方案——这也是选型表里它排在最末的原因。

设备树写法与 panel-simple 完全一致（下一节），区别只在控制器节点是 LCDC/LTDC 而不是 DSI Host，且没有初始化序列——并口屏大多没有寄存器配置通道，时序给对就亮。

<!-- 【待补图】images/b-c-9-4-rgb-dpi-timing.png（优先级：★必要）
图名：RGB/DPI 并口显示时序图
生图提示词：数字时序波形图，参考 LCD 数据手册风格，16:9，白底黑线。画三组波形：第一行 PCLK 连续方波；第二行 DE 信号，高电平区段标注"有效像素 800"并在其间画若干竖线表示像素时钟计数；第三行 HSYNC，在每行开始处一个负脉冲，脉冲宽度标注 hsync-len。在时间轴上用双向箭头依次标出：hback-porch（HSYNC 后沿到 DE 升起）、hactive（DE 高电平段）、hfront-porch（DE 降落到下一个 HSYNC）。右侧另画一个小框示意垂直方向 VSYNC/vback-porch/vactive/vfront-porch 的堆叠关系。所有标注用中文，字体清晰，配色黑白为主、关键区间用浅蓝色填充。 -->

## <span class="blue"> 六接口全景对比

| 维度 | MIPI DSI | LVDS | eDP | HDMI | DP | DPI(RGB) |
|------|----------|------|-----|------|-----|----------|
| 信号线数 | 4-lane: 10 | 单 10 / 双 20 | 4-lane: 10 | 19 | 4-lane: 10 | 29+ |
| 最大分辨率 | 4K@60 | 1920×1200@60 | 8K@60 | 8K@60 (2.1) | 8K@60 (1.4) | 1080p@60 |
| 功耗 | 低 | 中 | 低（PSR） | 中 | 中 | 高 |
| PCB 复杂度 | 中 | 高 | 低 | 中 | 低 | 极高 |
| 线缆长度 | < 30cm | < 5m | < 50cm | < 15m | < 3m | < 30cm |
| 音频 | 否 | 否 | 是 | 是 | 是 | 否 |
| EDID 通道 | 外挂 I2C | 外挂 I2C | AUX 内置 | DDC 内置 | AUX 内置 | 外挂 I2C |
| 典型场景 | 手机/平板/车机 | 工业屏/医疗 | 笔记本内屏 | 电视/显示器 | 显示器/显卡 | MCU 小屏/老方案 |

选型速判：板内连小屏 → DSI；工业屏要长走线抗干扰 → LVDS；电池设备内屏 → eDP；外接商用显示器 → HDMI/DP；MCU 级低成本小屏 → DPI。

## <span class="blue"> panel-simple 与 Panel Timings

`panel-simple`（`drivers/gpu/drm/panel/panel-simple.c`）是内核的通用面板驱动，设计前提是：大多数 LCD 面板只需要正确的时序参数和供电/复位/背光控制，不值得每款屏写一个驱动。设备树节点提供一切：

```dts
panel@0 {
    compatible = "simple-panel-dsi";
    reg = <0>;
    reset-gpios = <&gpio3 RK_PA5 GPIO_ACTIVE_LOW>;
    enable-gpios = <&gpio3 RK_PA6 GPIO_ACTIVE_HIGH>;
    backlight = <&backlight>;
    avdd-supply = <&vcc_3v3>;

    dsi,flags = <MIPI_DSI_MODE_VIDEO | MIPI_DSI_MODE_VIDEO_BURST>;
    dsi,format = <MIPI_DSI_FMT_RGB888>;
    dsi,lanes = <4>;

    panel-timing {
        clock-frequency = <70000000>;
        hactive = <1280>;
        hback-porch = <80>;   hfront-porch = <80>;  hsync-len = <40>;
        vactive = <800>;
        vback-porch = <12>;   vfront-porch = <12>;  vsync-len = <4>;
        hsync-active = <0>;   vsync-active = <0>;
        de-active = <0>;      pixelclk-active = <0>;
    };
};
```

### Timings 参数的含义与计算

> 前肩/后肩（Front/Back Porch）：同步脉冲前后的空白间隔，源自 CRT 时代电子束回扫需要的时间，数字时代保留为时序裕量。水平方向的四个参数（有效区 + 前肩 + 同步 + 后肩）合起来是一行的总像素数，垂直方向同理合起来是一帧的总行数。

```
行总像素 = hactive + hfront-porch + hsync-len + hback-porch
帧总行数 = vactive + vfront-porch + vsync-len + vback-porch
像素时钟 = 行总像素 × 帧总行数 × 刷新率

示例 1280×800@60Hz：
  行总 = 1280 + 80 + 40 + 80 = 1480
  帧总 = 800 + 12 + 4 + 12 = 828
  clock = 1480 × 828 × 60 ≈ 73.5 MHz
```

参数来源永远是面板数据手册。有 EDID 的屏可以解析 EDID 获得；都没有时用 `cvt 1280 800 60` 生成标准 modeline 再换算。

## <span class="blue"> 实战：RK3568 双屏（DSI 主屏 + HDMI 外接）

场景：工控机，DSI 10.1 寸 1280×800 做主界面，HDMI 24 寸 1080p 做监控扩展。双屏各用一个 VOP（视频输出处理器）。

### 设备树关键片段

```dts
/* DSI 主屏：绑定 VOPB */
&dsi {
    status = "okay";
    panel@0 {
        compatible = "simple-panel-dsi";
        reg = <0>;
        reset-gpios = <&gpio3 RK_PA5 GPIO_ACTIVE_LOW>;
        enable-gpios = <&gpio3 RK_PA6 GPIO_ACTIVE_HIGH>;
        backlight = <&backlight>;
        dsi,flags = <MIPI_DSI_MODE_VIDEO | MIPI_DSI_MODE_VIDEO_BURST>;
        dsi,format = <MIPI_DSI_FMT_RGB888>;
        dsi,lanes = <4>;
        panel-timing {
            clock-frequency = <70000000>;
            hactive = <1280>;  hback-porch = <80>;
            hfront-porch = <80>; hsync-len = <40>;
            vactive = <800>;   vback-porch = <12>;
            vfront-porch = <12>; vsync-len = <4>;
        };
    };
};

/* HDMI：绑定 VOPL，DDC 走 I2C2，HPD 配 GPIO */
&hdmi {
    status = "okay";
    ddc-i2c-bus = <&i2c2>;                       /* EDID 全靠它 */
    pinctrl-names = "default";
    pinctrl-0 = <&hdmi_hpd_pin>;
};

&i2c2 {
    status = "okay";
    clock-frequency = <100000>;                  /* DDC 标准 100kHz */
};

/* 两个 VOP 各绑一路输出（双屏的核心） */
&vopb { /* port → dsi endpoint */ };
&vopl { /* port → hdmi endpoint */ };
```

### EDID 读不到时的救急

DDC 不通（pinctrl 错、上拉缺失、线缆劣质）时，DRM 拿不到 EDID，显示器黑屏。救急方案是在设备树强制时序，绕过 EDID：

```dts
&hdmi {
    status = "okay";
    ddc-i2c-bus = <&i2c2>;
    /* 强制 1920x1080@60（参数必须精确匹配显示器规格书） */
    hdmi-timings = <148500 1920 88 148 44 1080 4 36 5>;
};
```

> ⚠️ 强制 timings 是绕过机制不是修复——参数错会画面偏移、闪烁甚至触发显示器黑屏保护。正确的参数从显示器规格书或同型号 EDID dump 里来，不要手算瞎试。

### 用户态双屏配置

```bash
# 看连接器
xrandr --listmonitors
```

```
 0: +*DSI-1 1280/217x800/136+0+0  DSI-1
 1: +HDMI-A-1 1920/531x1080/299+1280+0  HDMI-A-1
```

```bash
# 扩展模式：DSI 左（主），HDMI 右
xrandr --output DSI-1 --mode 1280x800 --pos 0x0 --primary \
       --output HDMI-A-1 --mode 1920x1080 --pos 1280x0

# 镜像模式
xrandr --output HDMI-A-1 --mode 1280x800 --same-as DSI-1

# 只开外接屏（主屏休眠省电）
xrandr --output DSI-1 --off --output HDMI-A-1 --mode 1920x1080 --primary
```

无 X/Wayland 环境下用 modetest 直接测 DRM 层（排障时先排除桌面环境干扰）：

```bash
modetest -M rockchip                          # 列全部 connector/crtc/encoder
modetest -M rockchip -s 75:1280x800 -v        # 直连测试 DSI
modetest -M rockchip -s 89:1920x1080 -v       # 直连测试 HDMI
```

## <span class="blue"> 排障速查

```bash
# EDID 读取验证（大小为 0 = DDC 不通）
ls -l /sys/class/drm/card0-HDMI-A-1/edid
cat /sys/class/drm/card0-HDMI-A-1/edid | parse-edid

# DDC 总线扫描（显示器 EDID 在 0x50）
i2cdetect -y 2

# DRM 绑定与 EDID 日志
dmesg | grep -iE "drm|hdmi|dsi"
```

| 现象 | 第一怀疑 | 验证 |
|------|---------|------|
| HDMI 完全无输出 | HPD 引脚未配/极性反 | 量 HPD 电平；查 pinctrl |
| 黑屏且无 EDID | DDC I2C 不通 | `i2cdetect` 看 0x50 |
| 画面偏移/闪烁 | timings 参数错 | 对照面板手册修 porch |
| DSI 屏无背光 | 背光驱动未加载 | `/sys/class/backlight/` 下有无节点 |
| 双屏只亮一个 | 两路输出绑了同一 VOP | `modetest` 看 crtc 分配 |
| 偏色（红蓝反） | RGB/BGR 格式不匹配 | 查 dsi,format 与面板要求 |

## <span class="blue"> 本节总结

显示接口的分化不是历史偶然，而是同一道算术题的六种答案：分辨率×刷新率决定带宽，带宽÷单 lane 速率决定 lane 数，lane 数×电气形式决定线数和 PCB 成本。LVDS 用低摆幅差分换来了工业场景要的抗干扰和米线级走线；eDP 用 AUX 通道和 PSR 换来了电池设备要的低功耗；HDMI/DP 用更高的单 lane 速率和内置识别通道换来了"插上就能用"的消费体验；RGB/DPI 什么额外机制都不要，换来了最低成本小屏方案。选型时先算带宽账，再看线数账和功耗账，接口自己就浮出来了。

外接显示器这一族（HDMI/DP）的可靠性建立在一条识别链上：HPD 通知"我插上了"→ DDC（一条固定地址 0x50 的 I2C）读 EDID → 源端按 EDID 列表配时序。这条链上任何一环断了——HPD 没配、DDC 不通、EDID 数据损坏——系统表现都是"显示器不存在"。排障的顺序就是沿链逐环验证：`i2cdetect` 看 0x50、读 `edid` 文件看大小、最后才轮到强制 timings 这种绕过手段。

panel-simple 的设计哲学值得记住：大多数面板不需要专有驱动，一组精确的 timings 参数加上供电/复位/背光就够了。这意味着调屏的核心能力不是写驱动，而是读懂数据手册的时序表，并把它精确翻译成 `panel-timing` 节点——行总/帧总/像素时钟的换算必须随手能算。

### 速查表

| 项 | 要点 |
|----|------|
| LVDS 上限 | 单像素约 135MHz 像素时钟；超了切双像素，线数翻倍 |
| eDP 三大件 | lane 可伸缩（1/2/4）+ AUX 内置控制 + PSR 面板自刷新 |
| HDMI 识别链 | HPD → DDC(I2C@0x50) → EDID 128 字节 |
| DP 特有 | 微包架构 + 链路训练（闪断/降分辨率先查线缆） |
| RGB/DPI | 24 数据 + HSYNC/VSYNC/DE/PCLK，无配置通道，时序给对就亮 |
| 像素时钟 | (hactive+hfp+hsw+hbp) × (vactive+vfp+vsw+vbp) × 刷新率 |
| EDID 救急 | 设备树 `hdmi-timings` 强制时序，参数必须来自规格书 |
| 双屏关键 | 两路输出各绑一个 VOP/CRTC，xrandr 配位置关系 |

### 本节自查

1. 一块 1080p@60Hz 的工业屏，走线 2 米，为什么选 LVDS 双像素而不是 HDMI？
2. EDID 读到 0 字节，按什么顺序排查 HPD、DDC、EDID 三环？每环用什么命令？
3. 给定 800×480@60Hz，porch 参数 hfp=40/hsw=48/hbp=40、vfp=13/vsw=3/vbp=29，像素时钟是多少？
4. eDP 的 PSR 和 DSI 的命令模式都在省功耗，省的分别是哪一部分？
5. 双屏只亮一个，`modetest` 输出里应该看什么字段来定位？

## <span class="blue"> 下一步

下一节 **B-C.9.5 实战：OV 摄像头点亮全流程**——C.9 组的收官实战，把 9.1~9.3 三节的 D-PHY、CSI-2、V4L2 全部串起来：从设备树 endpoint 到 `media-ctl` 链路拓扑，再到 `v4l2-ctl` 抓帧验证，走通一个摄像头从接上排线到拿到第一帧图像的完整路径。

> 💡 本篇的 timings 参数（hfront-porch/vsync-len 这套词汇）与 B-C.9.3 DSI 节的 `panel-timing` 是同一张表——显示时序是跨接口通用的语言，学会一次处处可用。EDID 的 DDC 通道就是一条标准 I2C（B-B.3），`i2cdetect` 在这里的用法和扫传感器完全一样；双屏实战里的两个 VOP 各绑一路输出，对应第 11 章设备模型里"一个驱动实例管一份硬件资源"的原则。
