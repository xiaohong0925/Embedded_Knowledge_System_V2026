# B-C.9.3 MIPI DSI协议层与DRM

> 所属章节：第五部 B. 总线协议 > B-C.9 MIPI接口
>
> 难度：[I] Intermediate | [M] Master | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

上一节我们梳理了DSI的物理层和链路层，搞懂了LP/HS模式切换和LP escape mode的握手流程。本节把视线往上挪一层——DSI的**协议层**，以及Linux中驱动这些显示面板的**DRM/KMS框架**。

DSI协议层是DSI控制器与显示面板之间的"语言"：命令模式怎么发DCS指令？视频模式怎么实时刷图？短包和长包的格式差异是什么？这些决定了你的面板能不能正确初始化、能不能稳定出图。

DRM/KMS则是Linux显示栈的核心——从Framebuffer到DSI控制器，再到物理面板，整个显示pipeline如何组织？设备树怎么配？驱动怎么写？出了问题怎么调？

读完本节，你将掌握DSI双模式的工作机制、常用DCS命令集、DRM/KMS组件架构，并能独立完成一个MIPI DSI LCD面板的驱动集成与调试。

---

## <span class="blue"> DSI协议层：命令模式与视频模式 [I]

DSI在协议层定义了两种截然不同的工作模式，分别对应静态画面和动态视频两种应用场景。

### 命令模式（Command Mode）

命令模式是一种**低功耗、基于事务**的工作方式。DSI控制器通过发送DCS（Display Command Set）命令来更新面板内部的帧缓冲（Frame Memory）。面板内部集成了GRAM（Graphic RAM），CPU只需在画面变化时发送更新指令，平时可以进入低功耗状态。

典型工作流程：

```
CPU → 发送DCS命令(0x2C Memory Write) + 图像数据 → 面板GRAM → 面板自动刷新显示
```

命令模式的优势在于**功耗极低**——只有画面需要更新时才消耗总线带宽，非常适合电子书阅读器、智能手表、工业仪表盘等以静态画面为主的设备。它的代价是**刷新率受限**（受CPU更新频率和DSI带宽双重限制），不适合播放视频。

### 视频模式（Video Mode）

视频模式则是**实时流传输**的工作方式。DSI控制器以固定的时序（类似MIPI DPI接口）持续不断地向面板发送像素流，面板不需要内置大容量GRAM，只需要行缓冲即可。

典型工作流程：

```
DDR → DMA → LCD控制器 → DSI主机 → 面板(逐行/逐帧实时显示)
```

视频模式的优势是**高刷新率、低延迟**——适合智能手机、平板、车载导航等需要播放动态视频的场景。代价是DSI链路需要持续处于高速模式，**功耗相对较高**。

### 两种模式的关键差异

| 对比维度 | 命令模式 | 视频模式 |
|:---------|:---------|:---------|
| 传输方式 | 基于事务，按需更新 | 实时像素流 |
| 面板GRAM | 需要（存储整帧图像） | 不需要（仅需行缓冲） |
| 功耗 | 低（空闲时可停时钟） | 高（持续HS传输） |
| 适用场景 | 静态UI、电子纸、仪表盘 | 视频播放、手机主屏 |
| 带宽需求 | 低（与画面变化率成正比） | 高（与分辨率和刷新率成正比） |
| 撕裂问题 | 需要Tearing Effect信号同步 | 天然同步，无撕裂 |
| DSI包类型 | 短包（命令）+ 长包（数据块） | 主要用长包传输像素数据 |

> ⚠️ **陷阱**：很多工程师误以为DSI只能用视频模式驱动手机大屏。实际上，很多中小尺寸工业屏（5寸以下）采用命令模式+内部GRAM的方案，功耗可以低至视频模式的1/10。选型时要根据应用场景权衡。

---

## <span class="blue"> DSI短包与长包格式 [I]

DSI协议层的数据单元分为**短包（Short Packet）**和**长包（Long Packet）**，分别用于传输控制命令和数据负载。

### 短包格式（4字节）

短包用于传输DCS命令或参数，结构紧凑：

```
+--------+--------+--------+--------+--------+--------+
| Data ID|  WC[7:0] |  WC[15:8]  |  ECC  |  Payload  |
| (8bit) | (8bit)  |  (8bit)   | (8bit) | (8/16bit) |
+--------+--------+--------+--------+--------+--------+
  DI        WC(=0/1)           ECC      CMD/PARAM
```

- **Data ID**：标识虚拟通道（VC[1:0]）和数据类型（DT[5:0]）
- **WC**：字计数，短包中固定为0x0000或0x0001
- **ECC**：错误校验码，可纠正1bit错误、检测2bit错误
- **Payload**：DCS命令码（8bit）或命令+参数（16bit）

### 长包格式（6字节头 + Payload + 2字节CRC）

长包用于传输大块的图像数据或长配置序列：

```
+--------+----------+----------+--------+------------+--------+
| Data ID|  WC[7:0]  |  WC[15:8]  |  ECC  |   Payload   |  CRC   |
| (8bit) |  (8bit)   |  (8bit)   | (8bit) | (0~65535B)  | (16bit)|
+--------+----------+----------+--------+------------+--------+
  DI        Word Count(实际长度)   ECC      实际数据      CRC校验
```

- **Word Count**：Payload的实际字节数（最大64KB）
- **Payload**：实际的图像数据或配置数据流
- **CRC**：16位循环冗余校验，覆盖整个Payload

一个典型的Memory Write（0x2C）命令传输一帧800×480×16bpp图像的过程：

```
[短包] DI=0x39(DCS Long Write) → 发送命令0x2C(Memory Write Start)
[长包] DI=0x3B(DCS Pixel Stream) → 连续发送800×480×2=768000字节像素数据
```

> 💡 **提示**：长包的Payload大小直接影响DSI传输效率。Payload越大，包头开销占比越小。但过大的包可能导致面板FIFO溢出——通常参考面板手册中的推荐值（常见为512字节~几KB）。

---

## <span class="blue"> DCS命令集详解 [M]

DCS（Display Command Set）是MIPI联盟定义的显示面板标准指令集。掌握这些命令是调试DSI面板的基础——初始化序列、睡眠唤醒、亮度调节、读写GRAM都靠它们。

### 核心DCS命令速查表

| 命令 | 代码 | 功能 | 参数 | 说明 |
|:-----|:-----|:-----|:-----|:-----|
| NOP | 0x00 | 空操作 | 无 | 可用于读取面板状态 |
| Software Reset | 0x01 | 软件复位 | 无 | 复位后需等待5ms再发命令 |
| Sleep In | 0x10 | 进入睡眠模式 | 无 | 面板停止显示，功耗降至最低 |
| Sleep Out | 0x11 | 退出睡眠模式 | 无 | 唤醒后面板需120ms稳定 |
| Partial Mode On | 0x12 | 局部显示模式 | 无 | 仅更新部分区域 |
| Normal Mode On | 0x13 | 正常显示模式 | 无 | 全屏显示 |
| Display Off | 0x28 | 关闭显示 | 无 | 关闭面板输出（GRAM数据保留） |
| Display On | 0x29 | 打开显示 | 无 | 开始从GRAM刷新到面板 |
| Column Address Set | 0x2A | 设置列地址（X） | 4字节：XS[15:8], XS[7:0], XE[15:8], XE[7:0] | 定义写入窗口的水平范围 |
| Page Address Set | 0x2B | 设置页地址（Y） | 4字节：YS[15:8], YS[7:0], YE[15:8], YE[7:0] | 定义写入窗口的垂直范围 |
| Memory Write | 0x2C | 写入GRAM | 像素数据流 | 将像素数据写入当前窗口 |
| Memory Read | 0x2E | 读取GRAM | 返回像素数据 | 从当前窗口读取像素 |
| MADCTL | 0x36 | 存储器访问控制 | 1字节：MY/MX/MV/ML/RGB/MH | 控制扫描方向和RGB/BGR格式 |
| COLMOD | 0x3A | 接口像素格式 | 1字节：0x55=16bit, 0x66=18bit, 0x77=24bit | 定义输入像素深度 |
| Write Display Brightness | 0x51 | 写入亮度 | 1字节：0x00~0xFF | 调节面板显示亮度 |

### MADCTL扫描方向控制

MADCTL（Memory Access Control）是最重要的DCS命令之一，一个字节控制了整个显示的方向和格式：

```
MADCTL[7:0] = [MY, MX, MV, ML, RGB, X, X, MH]

MY (D7): 行地址顺序  0=从上到下, 1=从下到上
MX (D6): 列地址顺序  0=从左到右, 1=从右到左
MV (D5): 行列交换    0=正常, 1=交换(横屏/竖屏切换)
ML (D4): 行刷新顺序  0=从上到下, 1=从下到上
RGB(D3): RGB/BGR     0=RGB, 1=BGR
MH (D2): 水平刷新    0=从左到右, 1=从右到左
```

例如，一个常见的竖屏转横屏配置：

```c
// 竖屏模式：MY=0, MX=0, MV=0, RGB=0 → 0x00
// 横屏模式：MY=0, MX=1, MV=1, RGB=0 → 0x60
// 竖屏镜像：MY=1, MX=1, MV=0, RGB=0 → 0xC0
```

> ⚠️ **陷阱**：DSI面板初始化序列**必须严格按手册顺序执行**，每一步的延时也不能省。常见翻车现场：
> - Sleep Out后立刻发Display On → 面板还没稳定 → **花屏**
> - 跳过COLMOD像素格式设置 → 面板默认格式与DSI输入不匹配 → **色彩异常**
> - MADCTL设置错误 → 画面镜像/旋转/蓝红交换 → **显示方向不对**
> - 延时不够（Sleep Out需要120ms）→ 后续命令被忽略 → **白屏无显示**

### 典型初始化序列

一个标准的DSI面板初始化流程如下（时序不可乱）：

```
[上电] → 硬件复位(RST引脚低电平≥10μs) → 等待10ms
  → Sleep Out (0x11) → **等待120ms**
  → MADCTL (0x36) 设置扫描方向
  → COLMOD (0x3A) 设置像素格式 (如0x55=16bpp)
  → DISCTRL (0xB6等) 显示功能控制
  → 其他配置命令...
  → Display On (0x29) → 正常显示
```

---

## <span class="blue"> Linux DRM/KMS子系统架构 [I]

DRM（Direct Rendering Manager）是Linux内核的显示管理框架，KMS（Kernel Mode Setting）是其子系统，负责显示模式的配置和切换。理解DRM组件架构是编写DSI显示驱动的关键。

### DRM/KMS核心组件

| 组件 | 职责 | 关键函数/结构体 |
|:-----|:-----|:----------------|
| `drm_driver` | DRM设备入口，注册总线操作 | `drm_dev_alloc()`, `drm_dev_register()` |
| `drm_crtc` | CRT控制器，代表一个独立的显示管道 | `drm_crtc_init()`, `drm_crtc_helper_set_mode()` |
| `drm_encoder` | 编码器，将CRTC输出转换为特定信号 | `drm_encoder_init()`, `drm_encoder_helper_funcs` |
| `drm_connector` | 连接器，检测物理连接状态 | `drm_connector_init()`, `detect()`, `get_modes()` |
| `drm_panel` | 抽象面板层，统一 panel 操作接口 | `drm_panel_add()`, `drm_panel_remove()` |
| `drm_bridge` | 桥接芯片（如DSI→LVDS转换器） | `drm_bridge_attach()`, `drm_bridge_funcs` |
| `drm_framebuffer` | 帧缓冲管理 | `drm_fb_cma_create()`, `drm_gem_fb_create()` |

组件之间的连接关系：

```
+------------+     +-----------+     +------------+     +-----------+     +-------+
|            |     |           |     |            |     |           |     |       |
|  drm_crtc  |────▶| drm_encoder|────▶| drm_bridge |────▶| drm_connector|────▶| Panel |
|            |     |           |     |  (可选)    |     |           |     |       |
+------------+     +-----------+     +------------+     +-----------+     +-------+
      │
      ▼
+------------+
|   FB/GEM   |  ← 用户空间通过mmap映射的帧缓冲
+------------+
```

### DSI显示Pipeline

在嵌入式系统中，一条完整的DSI显示pipeline通常是这样的：

```
DDR (帧缓冲)
  │
  ▼ DMA
SoC LCD控制器 (如Rockchip VOP / i.MX DCSS / Allwinner DE2)
  │
  ▼ DPI/RGB或内部接口
DSI Host控制器 (内置在SoC中，如Synopsys DWC DSI)
  │
  ▼ MIPI DSI 1/2/4 Lane
DSI Panel (带驱动IC的LCD模组，如ST7701S/ILI9881C)
  │
  ▼
物理显示
```

DRM/KMS将这整条链路抽象为drm_crtc（LCD控制器）→ drm_encoder（DSI Host）→ drm_connector（DSI接口）→ drm_panel（物理面板）的组件链。

> 💡 **提示**：DRM驱动的调试有一个**三步验证法**：
> 1. **先确认DSI控制器配置正确**——看dmesg中drm是否成功注册，dsi host是否probe成功
> 2. **再调panel初始化**——确认DCS序列正确发出，用逻辑分析仪抓DSI波形看命令是否被面板ACK
> 3. **最后调背光**——确认背光PWM有输出，亮度可调节
> 背光先亮不代表显示正常——很多面板默认上电背光就亮，但图像可能根本没送过去。

---

## <span class="blue"> 行业实例：5寸LCD（MIPI DSI 2lane）驱动集成 [M]

### 硬件规格

- **面板型号**：5寸IPS全视角LCD模组
- **分辨率**：800 × 480（WVGA）
- **接口**：MIPI DSI 2 Lane
- **驱动IC**：ST7701S（或兼容型号）
- **背光**：PWM调光，正极性
- **触摸**：电容式I2C接口（GT911）

### 设备树完整配置

```dts
// arch/arm64/boot/dts/rockchip/rk3568-myboard.dts

&dsi {
    status = "okay";
    
    // DSI控制器配置
    rockchip,lane-rate = <500>;  // Mbps per lane, 2lane共1000Mbps
    
    dsi_panel: panel@0 {
        compatible = "sitronix,st7701s", "simple-panel-dsi";
        reg = <0>;
        
        // 背光配置
        backlight = <&backlight_lcd>;
        
        // 电源配置
        power-supply = <&vcc3v3_lcd>;
        reset-gpios = <&gpio0 RK_PC6 GPIO_ACTIVE_LOW>;
        
        // DSI时序参数 (参考面板手册)
        dsi,flags = <MIPI_DSI_MODE_VIDEO | MIPI_DSI_MODE_VIDEO_BURST>;
        dsi,format = <MIPI_DSI_FMT_RGB888>;
        dsi,lanes = <2>;
        
        // 显示时序 (800x480 @ 60Hz)
        panel-timing {
            clock-frequency = <30000000>;  // 30MHz
            hactive = <800>;
            vactive = <480>;
            hfront-porch = <40>;
            hsync-len = <10>;
            hback-porch = <40>;
            vfront-porch = <20>;
            vsync-len = <5>;
            vback-porch = <20>;
        };
        
        // DCS初始化序列 (严格按手册顺序！)
        panel-init-sequence = [
            // Sleep Out - 唤醒面板
            05 11                  // DCS Short: Sleep Out (0x11)
            ff 78                  // Delay 120ms
            
            // MADCTL - 扫描方向控制
            15 36 00               // DCS Short: MADCTL, 参数0x00 (正常扫描, RGB)
            
            // COLMOD - 像素格式: 0x55=16bpp, 0x66=18bpp, 0x77=24bpp
            15 3A 77               // DCS Short: COLMOD, 参数0x77 (24bpp RGB888)
            
            // DISCTRL - 显示功能控制 (ST7701S寄存器)
            29 B6 0A 82 27 00      // DCS Long: DISCTRL
            
            // PWMCTRL - PWM背光控制
            29 C1 24 02 03         // DCS Long: PWMCTRL
            
            // VCOM设定
            29 B5 0F 0F            // DCS Long: VCOM设置
            
            // Power Control
            29 C0 08 05            // DCS Long: PWRCTRL1
            
            // Gamma校正
            29 E0 00 0C 11 05 0A 06 2F 44 4A 0D 18 15 19 10 1A 00
            29 E1 00 19 11 05 0A 06 2F 44 4A 0D 18 15 19 10 1A 00
            
            // Display On
            05 29                  // DCS Short: Display On (0x29)
            ff 28                  // Delay 40ms
        ];
        
        // 休眠序列 (系统suspend时执行)
        panel-exit-sequence = [
            05 28                  // Display Off
            ff 28                  // Delay 40ms
            05 10                  // Sleep In
            ff 78                  // Delay 120ms
        ];
    };
};

// DSI到panel的端口连接
&dsi {
    ports = <&dsi_out>;
    
    dsi_out: port@1 {
        reg = <1>;
        dsi_out_panel: endpoint {
            remote-endpoint = <&panel_in_dsi>;
        };
    };
};

// 背光PWM配置
&pwm4 {
    status = "okay";
    
    backlight_lcd: backlight {
        compatible = "pwm-backlight";
        pwms = <&pwm4 0 25000 0>;  // PWM4, index 0, 25kHz
        brightness-levels = <
              0   1   2   3   4   5   6   7
              8  16  32  48  64  80  96 112
            128 144 160 176 192 208 224 240
            255
        >;
        default-brightness-level = <12>;  // 默认约50%亮度
        power-supply = <&vcc5v0_lcd>;
    };
};

// LCD电源 (3.3V LDO)
&vcc3v3_lcd {
    gpio = <&gpio0 RK_PC5 GPIO_ACTIVE_HIGH>;
    enable-active-high;
    regulator-boot-on;
};
```

### 初始化序列代码解析

设备树中的`panel-init-sequence`使用特定格式编码DCS命令：

| 前缀 | 含义 | 格式 |
|:-----|:-----|:-----|
| `05` | DCS Short Write, 无参数 | `05 <cmd>` |
| `15` | DCS Short Write, 1参数 | `15 <cmd> <param>` |
| `29` | DCS Long Write | `29 <cmd> <len> <param1> <param2> ...` |
| `39` | DCS Long Write (带延迟) | `39 <cmd> <len> <params...>` |
| `ff` | 延时命令 | `ff <ms>` |

### modetest显示测试

DRM驱动加载成功后，使用`modetest`工具测试显示pipeline：

```bash
# 1. 查看DRM设备信息
root@myboard:~# modetest -M rockchip

# 输出示例：
# Encoders:
# id  crtc type  possible crtcs possible clones 
# 36  34   DSI    0x00000001    0x00000000
#
# Connectors:
# id  encoder status      name       size (mm)    modes  encoders
# 37  36     connected    DSI-1      110x65       1      36
#
# CRTCs:
# id  fb  pos  size
# 34  39  (0,0)  (800x480)

# 2. 在指定connector上测试彩条画面
root@myboard:~# modetest -M rockchip -s 37@36:800x480

# -s: set mode, 格式为 connector_id@encoder_id:WxH
# 如果看到垂直彩条 = CRTC/Encoder/DSI Host正常
# 如果白屏/花屏 = panel初始化序列有问题

# 3. 生成测试图案并显示
root@myboard:~# modetest -M rockchip -s 37@36:800x480 -C smpte
# -C smpte: SMPTE彩条图案
# -C color: 纯色填充
```

### fbset查看帧缓冲

```bash
# 查看当前帧缓冲配置
root@myboard:~# fbset

# 输出：
# mode "800x480-60"
#     # D: 30.000 MHz, H: 31.250 kHz, V: 60.00 Hz
#     geometry 800 480 800 480 32
#     timings 33333 40 40 20 20 10 5
#     rgba 8/16,8/8,8/0,8/24
# end mode

# 关键字段解读：
# geometry: 可视宽度 可视高度 虚拟宽度 虚拟高度 色深(bit)
# timings: 像素时钟 左距 右距 上距 下距 水平同步 垂直同步
# rgba: 红/绿/蓝/透明度 的偏移量和位数

# 测试帧缓冲写入 (直接写像素)
root@myboard:~# cat /dev/urandom > /dev/fb0
# 屏幕应该显示雪花噪点 = 确认fb→dsi→panel通路正常

# 清屏为红色 (RGB888: 红=0x00FF0000)
root@myboard:~# python3 -c "
import ctypes
fb = open('/dev/fb0', 'wb')
red = b'\x00\xff\x00\x00' * 800 * 480  # BGRA格式
fb.write(red)
fb.close()
"
```

### 调试命令汇总

```bash
# === 内核DRM日志 ===
root@myboard:~# dmesg | grep -i drm
[    2.345678] rockchip_drm fd900000.vop: [drm:vop_component_bind] VOP initialized
[    2.456789] dw-mipi-dsi fe060000.dsi: [drm:dw_mipi_dsi_host_attach] DSI host attached
[    2.567890] panel-dsi 0-0000: ST7701S panel initialized
[    2.678901] rockchip_drm fd900000.vop: [drm:vop_crtc_enable] CRTC 34 enabled

# 开启DRM动态调试
root@myboard:~# echo 'module rockchip_drm +p' > /sys/kernel/debug/dynamic_debug/control
root@myboard:~# echo 'module dw_mipi_dsi +p' > /sys/kernel/debug/dynamic_debug/control

# === 查看DRM状态文件 ===
root@myboard:~# cat /sys/kernel/debug/dri/0/state
# 显示所有crtc/encoder/connector的当前状态

# === 查看DSI寄存器 ===
root@myboard:~# cat /sys/kernel/debug/dri/0/DSI-1/status
# connected / disconnected

# === 抓DSI波形 (逻辑分析仪设置) ===
# 1. 设置触发条件：LP→HS模式切换
# 2. 采样率：≥2×HS比特率 (2lane@500Mbps → ≥1GSa/s)
# 3. 通道：CLKP/CLKN, D0P/D0N, D1P/D1N
# 4. 预期波形：LP11 → LP00 → HS请求 → HS时钟突发 → 数据包
# 5. 用MIPI DSI协议解码器验证DCS命令序列

# === 背光调试 ===
root@myboard:~# cat /sys/class/backlight/backlight_lcd/brightness
128
root@myboard:~# echo 255 > /sys/class/backlight/backlight_lcd/brightness  # 最亮
root@myboard:~# echo 0 > /sys/class/backlight/backlight_lcd/brightness    # 熄灭
```

### 常见问题排查

| 现象 | 可能原因 | 排查方法 |
|:-----|:---------|:---------|
| 白屏（背光亮，无图像） | 初始化序列错误/缺步骤 | 逻辑分析仪抓DSI命令序列，对比手册 |
| 花屏（彩色条纹/噪点） | COLMOD像素格式不匹配 | 检查DSI format与COLMOD一致性 |
| 画面镜像/旋转 | MADCTL设置错误 | 核对MADCTL参数与硬件安装方向 |
| 颜色异常（红蓝交换） | RGB/BGR设置错误 | 调整MADCTL的RGB位 |
| 画面撕裂 | 视频模式下无TE同步 | 命令模式用TE信号；视频模式调时序 |
| 屏幕闪烁 | 背光PWM频率过低 | 提高PWM频率到20kHz以上 |
| 局部区域不刷新 | 窗口地址设置错误 | 检查Column/Page Address Set参数 |

---

## <span class="blue"> 本节总结

| 主题 | 关键要点 |
|:-----|:---------|
| DSI双模式 | 命令模式（低功耗+GRAM，适合静态UI）vs 视频模式（实时流传输，适合动态视频） |
| 包格式 | 短包4字节（DCS命令）+ 长包（6字节头+Payload+CRC，图像数据） |
| DCS核心命令 | Sleep Out(0x11)→MADCTL→COLMOD→配置→Display On(0x29)，**顺序和延时不可变** |
| MADCTL | 控制扫描方向、RGB/BGR、横竖屏切换，调试显示方向的利器 |
| DRM/KMS组件链 | crtc → encoder → bridge(可选) → connector → panel，对应显示pipeline各阶段 |
| 调试三步法 | ①DSI控制器probe → ②panel初始化序列 → ③背光PWM |
| 测试工具 | modetest测试显示通路，fbset查看帧缓冲参数，dmesg查DRM日志 |

DSI协议层的核心在于**理解命令模式和视频模式的适用场景**，以及**严格遵循初始化时序**。DRM/KMS框架虽然组件众多，但只要理清crtc→encoder→connector→panel的数据流向，配合设备树配置和modetest工具，DSI显示驱动的调试就有章可循。

---

## <span class="blue"> 下一步

下一节 **B-C.9.4 LVDS eDP HDMI DisplayPort**，我们将跳出MIPI生态，看看嵌入式系统中其他主流显示接口的技术特点和选型考量——LVDS的工业长距离传输优势、eDP的自刷新节能机制、HDMI的消费电子兼容性、DisplayPort的高带宽与嵌入式eDP变体。你会了解到，为什么工业平板偏爱LVDS、高端笔记本转向eDP、而树莓派同时提供DSI和HDMI输出。

---

## <span class="blue"> 配套资源

- **MIPI DSI规范**：MIPI Alliance Specification for Display Serial Interface, Version 1.3
- **DCS规范**：MIPI Alliance Specification for Display Command Set, Version 1.3
- **Linux DRM文档**：`Documentation/gpu/drm-kms.rst`
- **ST7701S数据手册**：Sitronix ST7701S datasheet（含完整DCS初始化序列）
- **Rockchip DRM驱动**：`drivers/gpu/drm/rockchip/`
- **Synopsys DWC MIPI DSI驱动**：`drivers/gpu/drm/bridge/synopsys/dw-mipi-dsi.c`
- **推荐工具**：modetest（libdrm-utils）、fbset、逻辑分析仪（支持MIPI DSI解码）
