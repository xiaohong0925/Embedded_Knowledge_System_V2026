# B-B.8.4 LVDS/eDP/HDMI/DisplayPort显示接口

> 所属章节：第五部 B. 总线协议 > B-B.8 多媒体与显示接口
>
> 难度：[E] Expert | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

嵌入式设备的显示接口种类繁多——从传统的LVDS到主流的HDMI/DisplayPort，再到专为移动设备设计的MIPI DSI/eDP。选错接口意味着：PCB走线困难、EMI超标、或者根本点不亮屏幕。

本节先深入四种核心显示接口的物理层与协议层原理，再讲解Linux `panel-simple`驱动的设备树配置与Panel Timings参数，最后以一个工控机双屏方案（MIPI DSI主屏+HDMI外接显示器）作为行业实例，手把手教你配置xrandr多屏扩展。读完你会明白：为什么EDID被称为显示器的"身份证"，以及DDC通道出问题后如何强制指定时序来救急。

---

## <span class="blue"> 知识点323：LVDS / eDP / HDMI / DisplayPort 物理层与协议层 [E]

### LVDS：低压差分信号（Low-Voltage Differential Signaling）

LVDS是嵌入式领域最经典的显示接口之一，1994年由NS（美国国家半导体）推出，至今仍在工业屏、车机、医疗设备中大量使用。

**物理层**：LVDS采用低电压差分对传输，每对线的摆幅仅约**350mV**（峰峰值），远低于TTL/CMOS电平。差分传输的天然优势是共模噪声抑制能力强，适合长距离走线。一个标准的LVDS接口包含**4对数据线**（Data0~Data3）加**1对时钟线**（CLK），共10根信号线。

```
LVDS 24-bit 单像素模式引脚分配
┌─────────────────────────────────────┐
│  LVDS0_TX0+ / LVDS0_TX0-  ── Data0 │
│  LVDS0_TX1+ / LVDS0_TX1-  ── Data1 │
│  LVDS0_TX2+ / LVDS0_TX2-  ── Data2 │
│  LVDS0_TX3+ / LVDS0_TX3-  ── Data3 │
│  LVDS0_CLK+ / LVDS0_CLK-  ── Clock │
└─────────────────────────────────────┘
         4对数据 + 1对时钟 = 5对差分线
```

**单像素 vs 双像素模式**：单像素模式（Single Pixel）下，每个时钟周期传输1个像素（24bit色深 = 3字节），5对差分线足够。对于1080p@60Hz以上的高分辨率，单像素模式的时钟频率会超过LVDS的物理上限（约135MHz像素时钟），此时需要切换到**双像素模式**（Dual Pixel / Dual Link）——用两组各5对差分线，每个时钟周期并行传输2个像素，时钟频率减半。

LVDS还有一个变体叫**OpenLDI**，以及TI推出的降低EMI版本**FPD-Link**（Flat Panel Display Link），后者通过加扰（Scrambling）和嵌入式时钟技术进一步降低辐射，在车规芯片中极为常见。

### eDP：嵌入式DisplayPort（Embedded DisplayPort）

eDP是VESA专为笔记本、平板、嵌入式设备定制的DisplayPort子集，目标是替代LVDS。它把DisplayPort的灵活性与低引脚数结合在一起。

**Lane配置**：eDP支持**1/2/4 lane**模式，每条lane是1对差分线。4 lane模式下仅需8根数据线+2根AUX线=10根线，即可驱动4K@60Hz的屏幕。相比之下，LVDS双像素模式需要20根信号线，eDP的PCB布局优势巨大。

**AUX通道**：eDP内置一条独立的**AUX（Auxiliary）通道**，用于传输配置命令和EDID读取。AUX是半双工的差分信号对，速率1Mbps。面板初始化、背光控制、电源管理等都通过AUX完成。这省去了LVDS方案中额外的I2C或SPI引脚。

eDP还引入了**PSR（Panel Self Refresh）**功能——当显示内容不变时，主控制器可以停止发送视频流，让面板用内部缓存自刷新，显著降低功耗。这对于电池供电设备是刚需。

### HDMI：高清多媒体接口（High-Definition Multimedia Interface）

HDMI是消费电子的事实标准，从电视到显示器无处不在。但在嵌入式Linux中驱动HDMI，你需要理解它的几个关键机制。

**TMDS编码**：HDMI的数据传输采用**TMDS（Transition Minimized Differential Signaling）**。视频数据（RGB 24bit）和音频数据经过TMDS编码器转换为串行比特流，通过3对TMDS Data通道传输。第4对TMDS Clock提供像素时钟参考。TMDS的核心是8b/10b编码——每8bit有效数据编码为10bit传输码，保证直流平衡并提供足够的跳变沿供时钟恢复。

```
HDMI Type-A 19pin 信号分配（关键引脚）
┌────────────────────────────────────────────┐
│  Pin 1-3:   TMDS Data2+ / Data2 Shield / - │
│  Pin 4-6:   TMDS Data1+ / Data1 Shield / - │
│  Pin 7-9:   TMDS Data0+ / Data0 Shield / - │
│  Pin 10-12: TMDS Clock+ / Clock Shield / - │
│  Pin 13:    CEC (Consumer Electronics Control)│
│  Pin 15-16: SCL / SDA (DDC / I2C for EDID) │
│  Pin 17:    Ground                         │
│  Pin 18:    +5V Power (max 55mA)           │
│  Pin 19:    Hot Plug Detect (HPD)          │
└────────────────────────────────────────────┘
```

**DDC通道**：HDMI的Pin15/Pin16是一组**I2C总线**，称为DDC（Display Data Channel）。它的唯一任务就是在显示器插入时，从显示器的EEPROM中读取**EDID**（Extended Display Identification Data）。EDID包含分辨率、时序、制造商、序列号等信息。没有EDID，显卡不知道显示器能支持什么分辨率。

**CEC**：Pin13的CEC线允许一个遥控器控制多个设备（如电视遥控器同时控制机顶盒和音响）。嵌入式Linux中可以通过`cec-ctl`工具操作。

> ⚠️ **陷阱**：HDMI的DDC（I2C）读取EDID失败 → DRM子系统无法识别显示器 → `dmesg`中看不到`connector status changed` → X/Wayland无法输出任何画面。常见根因：DDC的I2C引脚没有正确配置pinctrl、上拉电阻缺失、或者HDMI线缆质量差导致I2C信号畸变。救急方案：在设备树中强制指定 timings（见下方行业实例）。

### DisplayPort：LVDS的现代替代

DisplayPort（DP）是VESA推出的高性能数字显示接口，设计上就是为了取代LVDS和DVI。

**Lane架构**：DP也采用1/2/4 lane的差分对结构，每条lane速率远高于LVDS——DP 1.2每lane可达5.4Gbps，DP 1.4每lane达8.1Gbps。4 lane的DP 1.4总带宽高达25.82Gbps，足以驱动8K@60Hz或4K@120Hz。

**微包架构**：与HDMI的像素流不同，DP使用**微包（Micro-Packet）**传输。视频数据被封装在固定长度的数据包中传输，同时内嵌时钟信息，不需要独立的时钟通道。这种架构让DP可以灵活地分配带宽给视频、音频、USB（DP Alt Mode）等多种数据流。

**AUX通道**：DP也有一条AUX通道（1Mbps），用于EDID读取、链路训练和配置。链路训练（Link Training）是DP特有的——在正式开始传输视频前，发送端和接收端通过AUX协商lane数量、驱动强度和均衡参数，确保高速信号完整性。

> 💡 **提示**：EDID是显示器的"身份证" → 读取命令：`cat /sys/class/drm/card0-HDMI-A-1/edid | parse-edid`。如果系统没装`parse-edid`，`hexdump -C`也能看到ASCII描述的显示器型号。

---

## <span class="blue"> 知识点324：Linux panel-simple 驱动与设备树配置 [E]

### panel-simple 驱动架构

`panel-simple`是Linux内核中一个通用面板驱动，位于`drivers/gpu/drm/panel/panel-simple.c`。它的设计哲学是：大部分LCD面板只需要正确的**时序参数（Panel Timings）**和**供电/复位/使能引脚**即可工作，不需要为每款面板写独立驱动。

```
panel-simple 驱动架构
┌─────────────────┐
│  DRM/KMS 子系统  │  ← userspace 通过 ioctl 操作
├─────────────────┤
│  panel-simple.c │  ← 通用面板驱动
├─────────────────┤
│  OF/设备树匹配   │  ← 读取 compatible + timings
├─────────────────┤
│  GPIO/Regulator │  ← 控制复位、背光、供电
├─────────────────┤
│  MIPI DSI/LVDS  │  ← 底层显示接口驱动
└─────────────────┘
```

### 设备树 panel 节点配置

一个完整的`panel-simple`设备树节点需要包含：compatible、电源/复位GPIO、背光引用、以及详细的显示时序。下面是一个MIPI DSI面板的典型配置：

```dts
// 设备树 panel 节点（MIPI DSI 10.1寸工业屏）
&dsi {
    status = "okay";
    // DSI 控制器连接到 panel 的端口
    ports = <&dsi_out>;

    panel@0 {
        compatible = "simple-panel-dsi";
        reg = <0>;

        // 电源和复位引脚
        reset-gpios = <&gpio3 RK_PA5 GPIO_ACTIVE_LOW>;
        enable-gpios = <&gpio3 RK_PA6 GPIO_ACTIVE_HIGH>;

        // 背光引用
        backlight = <&backlight>;

        // 供电（如果面板需要独立IO供电）
        avdd-supply = <&vcc_3v3>;

        // DSI 具体配置
        dsi,flags = <MIPI_DSI_MODE_VIDEO | MIPI_DSI_MODE_VIDEO_BURST>;
        dsi,format = <MIPI_DSI_FMT_RGB888>;
        dsi,lanes = <4>;

        // 显示时序（Panel Timings）——最关键的部分！
        panel-timing {
            clock-frequency = <70000000>;   // 像素时钟 70MHz
            hactive = <1280>;                // 水平有效像素
            hback-porch = <80>;              // 水平后肩
            hfront-porch = <80>;             // 水平前肩
            hsync-len = <40>;                // 水平同步宽度
            vactive = <800>;                 // 垂直有效行数
            vback-porch = <12>;              // 垂直后肩
            vfront-porch = <12>;             // 垂直前肩
            vsync-len = <4>;                 // 垂直同步宽度
            hsync-active = <0>;              // 同步极性：0=低有效
            vsync-active = <0>;
            de-active = <0>;
            pixelclk-active = <0>;
        };
    };
};
```

### Panel Timings 参数详解

| 参数 | 说明 | 计算方法 |
|------|------|----------|
| `clock-frequency` | 像素时钟频率（Hz） | = (hactive + hfp + hbp + hsync) × (vactive + vfp + vbp + vsync) × 刷新率 |
| `hactive` | 水平有效像素 | 面板物理分辨率宽度 |
| `hfront-porch` (hfp) | 水平前肩 | 行有效结束到HSYNC的像素数 |
| `hback-porch` (hbp) | 水平后肩 | HSYNC结束到下一行有效的像素数 |
| `hsync-len` | 水平同步宽度 | HSYNC脉冲持续的像素数 |
| `vactive` | 垂直有效行数 | 面板物理分辨率高度 |
| `vfront-porch` (vfp) | 垂直前肩 | 帧有效结束到VSYNC的行数 |
| `vback-porch` (vbp) | 垂直后肩 | VSYNC结束到下一帧有效的行数 |
| `vsync-len` | 垂直同步宽度 | VSYNC脉冲持续的行数 |
| `hsync-active` | HSYNC极性 | 0=低有效/负极性，1=高有效/正极性 |
| `vsync-active` | VSYNC极性 | 同上 |

**计算示例**：1280×800@60Hz面板

```
hactive = 1280, hfp = 80, hbp = 80, hsync = 40
→ 总水平像素 = 1280 + 80 + 80 + 40 = 1480

vactive = 800, vfp = 12, vbp = 12, vsync = 4
→ 总垂直行数 = 800 + 12 + 12 + 4 = 828

clock-frequency = 1480 × 828 × 60 = 73,526,400 Hz ≈ 73.5MHz
（通常取整为70MHz或74.25MHz标准值）
```

这些参数从哪来？直接问面板厂商要**数据手册（Datasheet）**，或者如果面板有EDID，从EDID中解析出来。

---

## <span class="blue"> 显示接口全景对比

| 维度 | MIPI DSI | LVDS | eDP | HDMI | DisplayPort | DPI（RGB） |
|------|----------|------|-----|------|-------------|------------|
| **信号线数** | 4-lane: 8+2 | 单: 8+2 / 双: 16+4 | 4-lane: 8+2 | 3 TMDS + CLK | 4-lane: 8+2 | 24+3+2 |
| **最大分辨率** | 4K@60 (DSI-2) | 1920×1200@60 | 8K@60 (eDP 1.4b) | 8K@60 (HDMI 2.1) | 8K@60 (DP 1.4) | 1080p@60 |
| **典型功耗** | 低 | 中 | 低 | 中 | 中 | 高 |
| **EMI/辐射** | 低（差分） | 中 | 低（加扰） | 中 | 低 | 高（并行TTL） |
| **PCB复杂度** | 中 | 高（线多） | 低 | 中 | 低 | 极高（24+根线） |
| **BOM成本** | 中 | 中 | 中 | 低（芯片便宜） | 中 | 低（无需编码器） |
| **线缆长度** | <30cm（板对板） | <5m | <50cm | <15m | <3m | <30cm |
| **音频支持** | 否 | 否 | 是 | 是 | 是 | 否 |
| **EDID读取** | 需额外I2C | 需额外I2C | AUX内置 | DDC内置 | AUX内置 | 需额外I2C |
| **主要场景** | 手机/平板/车机 | 工业屏/医疗 | 笔记本/高端平板 | 电视/显示器 | 显示器/显卡 | MCU小屏/老方案 |
| **Linux驱动** | `drm/bridge/synopsys` | `panel-simple` | `drm/bridge/analogix` | `drm/bridge/synopsys` | `drm/bridge/analogix` | `panel-simple` |

---

## <span class="blue"> 行业实例：工控机外接HDMI显示器 + MIPI DSI主屏双显示

### 场景描述

一台基于RK3568的工业控制机，需要同时驱动两个显示输出：
- **主屏**：MIPI DSI 10.1寸 1280×800（电容触摸，工业操作界面）
- **外接屏**：HDMI 24寸 1920×1080（调试/监控扩展显示）

双屏工作在DRM（Direct Rendering Manager）框架下，通过`rockchip` DRM驱动统一管理。

### 硬件接线

```
         RK3568 SoC
    ┌─────────────────────┐
    │                     │
    │   ┌───────────┐     │     MIPI DSI 10.1"
    │   │ MIPI DSI  ├─────┼────→ 4-lane DSI + I2C(触摸)
    │   │ Controller│     │     供电: 3.3V/5V
    │   └───────────┘     │
    │                     │
    │   ┌───────────┐     │     HDMI 24" Monitor
    │   │ HDMI TX   ├─────┼────→ TMDS[0:2] + CLK
    │   │ (内置PHY) │     │     DDC: I2C2_SCL/SDA
    │   └───────────┘     │     HPD: GPIO0_B7
    │                     │
    └─────────────────────┘
```

### 设备树完整配置

```dts
// RK3568 工控机双显设备树配置

// 1. MIPI DSI 主屏节点
&dsi {
    status = "okay";
    // DSI 使用 VOPB（Video Output Processor B）
    ports = <&dsi_out>;

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
            hactive = <1280>;    hback-porch = <80>;
            hfront-porch = <80>; hsync-len = <40>;
            vactive = <800>;     vback-porch = <12>;
            vfront-porch = <12>; vsync-len = <4>;
            hsync-active = <0>;  vsync-active = <0>;
            de-active = <0>;     pixelclk-active = <0>;
        };
    };
};

// DSI 端口连接到 VOPB
&dsi_out {
    dsi_out_port: endpoint {
        remote-endpoint = <&vopb_out_dsi>;
    };
};

// 2. HDMI 外接显示器节点
&hdmi {
    status = "okay";
    // 使用 VOPL（Video Output Processor L）—— 双屏需要不同VOP
    ports = <&hdmi_out>;
    // DDC I2C 用于读取EDID
    ddc-i2c-bus = <&i2c2>;
    // HPD（热插拔检测）引脚
    pinctrl-names = "default";
    pinctrl-0 = <&hdmi_hpd_pin>;
    hpdd-gpios = <&gpio0 RK_PB7 GPIO_ACTIVE_HIGH>;
    // 5V供电使能（部分设计需要）
    // vdd_5v-supply = <&vcc5v0_hdmi>;
};

// HDMI 端口连接到 VOPL
&hdmi_out {
    hdmi_out_port: endpoint {
        remote-endpoint = <&vopl_out_hdmi>;
    };
};

// 3. DDC I2C pinctrl 配置（关键！EDID读取依赖此配置）
&i2c2 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&i2c2_xfer>;
    clock-frequency = <100000>;  // DDC标准速率100kHz
};

&pinctrl {
    // HDMI HPD引脚配置
    hdmi {
        hdmi_hpd_pin: hdmi-hpd {
            rockchip,pins = <0 RK_PB7 RK_FUNC_GPIO &pcfg_pull_none>;
        };
    };

    // I2C2 用于HDMI DDC
    i2c2 {
        i2c2_xfer: i2c2-xfer {
            rockchip,pins =
                <0 RK_PB5 1 &pcfg_pull_none>,  // I2C2_SCL
                <0 RK_PB6 1 &pcfg_pull_none>;  // I2C2_SDA
        };
    };
};

// 4. VOP（Video Output Processor）配置——双屏需要两个VOP
&vop {
    status = "okay";
    // VOPB 分配给 DSI
    vopb: vop@ffbc0000 {
        status = "okay";
        port@0 {
            vopb_out_dsi: endpoint {
                remote-endpoint = <&dsi_out_port>;
            };
        };
    };
    // VOPL 分配给 HDMI
    vopl: vop@ffbd0000 {
        status = "okay";
        port@0 {
            vopl_out_hdmi: endpoint {
                remote-endpoint = <&hdmi_out_port>;
            };
        };
    };
};

// 5. DRM 虚拟 CRTC 配置
&drm {
    status = "okay";
    // 启用双显支持
    rockchip,crtc-mode = <DUAL_CHANNEL>;
};
```

### 强制指定 Timings（EDID读取失败时的救急方案）

如果HDMI显示器的DDC I2C通信失败，可以在设备树中强制指定时序：

```dts
// 在hdmi节点中强制指定 timings（绕过EDID）
&hdmi {
    status = "okay";
    ddc-i2c-bus = <&i2c2>;
    
    // 强制 1920x1080@60Hz timings（Pioneer 24寸显示器）
    // 格式: <clock-kHz hactive hfp hbp hsync vactive vfp vbp vsync>
    // 注意：不同面板参数不同，需查阅面板规格书
    hdmi-timings = <148500 1920 88 148 44 1080 4 36 5>;
    // hsync-active-high, vsync-active-high
    hdmi-sync-pol = <1 1>;
};
```

> ⚠️ **陷阱**：强制timings参数必须精确匹配面板规格！错误的 porch/sync 值会导致画面偏移、闪烁、甚至显示器黑屏保护。务必从面板数据手册或`modeline`工具获取正确值。

### 用户空间：xrandr 双屏配置

DRM驱动加载成功后，系统会出现两个DRM connector：
- `DSI-1` —— MIPI DSI主屏
- `HDMI-A-1` —— HDMI外接显示器

```bash
#!/bin/bash
# 双屏配置脚本 /usr/local/bin/dual-screen-setup.sh

# 查看当前显示器列表
echo "=== 当前连接的显示器 ==="
xrandr --listmonitors
# 输出示例:
# 0: +*DSI-1 1280/217x800/136+0+0  DSI-1
# 1: +HDMI-A-1 1920/531x1080/299+1280+0  HDMI-A-1

# 方案1：扩展模式（DSI主屏在左，HDMI在右）
xrandr --output DSI-1 --mode 1280x800 --pos 0x0 --primary \
       --output HDMI-A-1 --mode 1920x1080 --pos 1280x0

# 方案2：镜像模式（两屏显示相同内容，按较小分辨率缩放）
# xrandr --output DSI-1 --mode 1280x800 --primary \
#        --output HDMI-A-1 --mode 1280x800 --same-as DSI-1

# 方案3：仅外接HDMI（关闭DSI省电）
# xrandr --output DSI-1 --off \
#        --output HDMI-A-1 --mode 1920x1080 --primary

# 方案4：DSI竖屏 + HDMI横屏
# xrandr --output DSI-1 --mode 800x1280 --rotate right --primary \
#        --output HDMI-A-1 --mode 1920x1080 --pos 800x0
```

### 开机自动配置

```bash
# 方法1：lightdm/gdm 显示管理器配置
# /etc/lightdm/lightdm.conf
display-setup-script=/usr/local/bin/dual-screen-setup.sh

# 方法2：用户级 autostart
# ~/.config/autostart/dual-screen.desktop
[Desktop Entry]
Type=Application
Name=Dual Screen Setup
Exec=/usr/local/bin/dual-screen-setup.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
```

---

## <span class="blue"> 调试手段与常见问题排查

### 1. 查看DRM连接器状态

```bash
# 列出所有显示器和分辨率
xrandr --listmonitors
# 或详细版
xrandr --verbose

# 示例输出（双屏正常工作）
 0: +*DSI-1 1280/217x800/136+0+0  DSI-1
 1: +HDMI-A-1 1920/531x1080/299+1280+0  HDMI-A-1
```

### 2. modetest 工具（libdrm 自带）

```bash
# 安装：apt install libdrm-tests
# 查看所有 DRM 资源
modetest -M rockchip

# 关键输出解析
Connectors:
 id encoder status   name       size (mm) modes encoders
 75 72     connected DSI-1      217x136   1     72   # MIPI DSI 连接正常
 89 0      connected HDMI-A-1   531x299   8     88   # HDMI 连接正常

# 强制测试模式（绕开X/Wayland，直接操作DRM）
modetest -M rockchip -s 75:1280x800 -v   # 测试DSI
modetest -M rockchip -s 89:1920x1080 -v  # 测试HDMI
```

### 3. dmesg 查看驱动加载日志

```bash
# 过滤DRM相关日志
dmesg | grep -i drm
dmesg | grep -i hdmi
dmesg | grep -i dsi

# 正常启动的关键日志：
[    2.345] rockchipdrm fd900000.display-subsystem: bound ff968000.hdmi (ops 0xfffffffe)
[    2.356] rockchipdrm fd900000.display-subsystem: bound ff968000.dsi (ops 0xfffffffe)
[    2.367] [drm] Supports vblank timestamp caching Rev 2
[    2.378] [drm] Initialized rockchip 3.0.0 for display-subsystem on minor 0
[    2.456] [drm] Connector HDMI-A-1: get EDID from DDC
[    2.467] [drm] Connector HDMI-A-1: EDID解析成功，1920x1080@60Hz
```

### 4. EDID 读取与解析

```bash
# 读取原始EDID（16进制）
cat /sys/class/drm/card0-HDMI-A-1/edid | hexdump -C

# 使用 parse-edid 解析为人类可读格式
apt install read-edid
cat /sys/class/drm/card0-HDMI-A-1/edid | parse-edid
# 输出：制造商、型号、序列号、支持分辨率列表...

# 如果EDID读取失败，文件不存在或全0
ls -la /sys/class/drm/card0-HDMI-A-1/edid
# -rw-r--r-- 1 root root 0 Dec 12 10:30 ...  # 大小为0 = 读取失败
```

### 5. 常见问题速查表

| 现象 | 根因 | 排查命令 |
|------|------|----------|
| HDMI无输出，`xrandr`看不到 | HPD引脚未配置或极性反 | `gpioget 0 15` 检查HPD电平 |
| HDMI黑屏，dmesg无EDID | DDC I2C不通 | `i2cdetect -y 2` 看能否扫描到0x50 |
| 画面偏移/闪烁 | Timings参数错误 | 对比面板手册修正porch值 |
| DSI屏无背光 | PWM背光驱动未加载 | `cat /sys/class/backlight/brightness` |
| 双屏只能亮一个 | VOP配置冲突 | `modetest -M rockchip` 查看crtc绑定 |
| 色彩异常（偏红/绿） | RGB/BGR顺序错 | 检查dsi,format = RGB888 vs BGR888 |

---

## <span class="blue"> 本节总结

| 要点 | 内容 |
|------|------|
| **LVDS核心** | 4/8对数据+1对时钟，单/双像素模式，工业场景经典方案 |
| **eDP优势** | 替代LVDS，1/2/4 lane，AUX通道内置，PSR低功耗，线少速高 |
| **HDMI关键** | TMDS编码，DDC(I2C)读EDID是识别前提，CEC多设备控制 |
| **DisplayPort** | 微包架构，链路训练自适应，带宽最高，AUX配置 |
| **panel-simple** | 通用驱动，设备树提供timings+GPIO即可，80%面板适用 |
| **Timings计算** | clock = (hactive+hfp+hbp+hsync)×(vactive+vfp+vbp+vsync)×Hz |
| **EDID是身份证** | 无EDID则无法识别 → 强制timings救急，但必须准确 |
| **双屏要点** | 两个VOP各绑定一个输出，xrandr配置扩展/镜像/独显 |

---

## <span class="blue"> 下一步

**B-C.9.1 CAN FD物理层与帧格式**

从显示世界切换到工业通信的核心总线——CAN FD。我们将深入理解CAN的差分信号、仲裁机制、以及CAN FD相比传统CAN在数据段提速8倍的原理。同时讲解Linux SocketCAN框架、`can-utils`工具集、以及工业车辆/机器人中的CANopen协议栈。如果你在做工控、汽车电子或机器人，这是必修课。

---

## <span class="blue"> 配套资源

- **VESA标准**：eDP 1.4b Specification（VESA官网会员下载）
- **HDMI标准**：HDMI 2.1 Specification（hdmi.org）
- **EDID详解**：VESA Enhanced Display Data Channel Standard
- **Linux文档**：`Documentation/devicetree/bindings/display/panel/panel-simple.yaml`
- **Rockchip DRM**：`drivers/gpu/drm/rockchip/` 内核源码
- **工具链**：`modetest` (libdrm-tests), `xrandr` (x11-xserver-utils), `parse-edid` (read-edid)
- **推荐书籍**：《Embedded Linux Primer》第12章 - Framebuffer与DRM
- **在线计算**：`cvt` 和 `gtf` 命令生成 modeline（`xserver-xorg-core`自带）
