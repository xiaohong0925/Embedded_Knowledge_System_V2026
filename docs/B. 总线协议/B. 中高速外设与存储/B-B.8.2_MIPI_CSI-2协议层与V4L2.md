# B-B.8.2 MIPI CSI-2协议层与V4L2

> 所属章节：第五部 B. 总线协议 > B-B.8 MIPI接口
>
> 难度：[I] Intermediate | [M] Master | 预计阅读时间：45分钟

## <span class="blue"> 本节导读

上一节我们从物理层认识了MIPI D-PHY的电气特性和低速/高速模式切换机制。现在我们把目光往上移一层——**CSI-2协议层**定义了摄像头数据如何被封装、传输和校验，而**Linux V4L2子系统**则负责把这些数据从硬件搬到用户空间。这两者的结合，构成了嵌入式Linux平台摄像头采集的核心链路。

本节的内容组织如下：先拆解CSI-2的短包/长包格式，理解数据类型和虚拟通道的概念；再梳理V4L2的架构和关键ioctl；最后通过一个**OV5640 500万像素摄像头**的完整实例，把传感器配置、设备树、抓图、ISP处理和FFmpeg推流串成一条完整的pipeline。读完本节，你应该能独立搭建一套从Sensor到屏幕/网络的摄像头系统。

---

## <span class="blue"> 知识点319：MIPI CSI-2协议层 [I][M]

CSI-2（Camera Serial Interface 2）是MIPI联盟定义的摄像头接口协议。它运行在D-PHY物理层之上，把所有与图像相关的数据抽象成统一的包格式。理解CSI-2的包结构，是调试摄像头花屏、丢帧、颜色异常等问题的基础。

### 协议层整体架构

从协议栈的视角看，CSI-2位于D-PHY之上，应用层之下：

```
+-------------------------+
|      应用层 (ISP/App)    |
+-------------------------+
|    CSI-2 协议层          |  <-- 本节聚焦
|  (包格式化/VC/错误检测)   |
+-------------------------+
|    D-PHY 物理层          |  <-- 上一节
|  (HS/LP/时钟/数据lane)   |
+-------------------------+
```

CSI-2协议层主要做三件事：**包格式化**（把图像数据切成包）、**通道复用**（多摄像头虚拟通道隔离）、**错误检测**（ECC+CRC保护数据完整性）。

### 短包（Short Packet）—— 4字节

短包只有4字节，用来传输同步信息，不携带图像数据本身。它的结构极为紧凑：

| 字节 | 内容 | 说明 |
|:--:|:---|:---|
| Byte 0 | Data Type [5:0] + Virtual Channel [1:0] | 数据类型 + 虚拟通道号 |
| Byte 1 | Word Count [7:0] / Field / Line Number | 行号或帧号低8位 |
| Byte 2 | Word Count [15:8] / Frame Number | 行号或帧号高8位 |
| Byte 3 | ECC [7:0] | 6bit ECC，可纠正1bit错误、检测2bit错误 |

短包的Data Type字段决定了它的语义：

- **帧起始（FS, 0x00）**：标志一帧图像开始
- **帧结束（FE, 0x01）**：标志一帧图像结束
- **行起始（LS, 0x02）**：标志一行有效数据开始
- **行结束（LE, 0x03）**：标志一行有效数据结束

> 💡 **提示**：短包的Word Count字段在行起始/行结束中存放的是**行号**，在帧起始/帧结束中存放的是**帧号**。这个细节在调试多帧异常时很有用——你可以通过dmesg中的帧号判断是否存在跳帧。

### 长包（Long Packet）—— 6字节头 + N字节数据 + 2字节CRC

长包是CSI-2传输图像数据的主力。它的结构如下：

```
+--------+--------+--------+--------+--------+--------+-------  --------+--------+--------+
|  Byte  |  Byte  |  Byte  |  Byte  |  Byte  |  Byte  |   Byte 6 ~    |  Byte  |  Byte  |
|   0    |   1    |   2    |   3    |   4    |   5    |  (6+WC-1)     | WC+6   | WC+7   |
+--------+--------+--------+--------+--------+--------+-------  --------+--------+--------+
|DT[5:0]| VC[1:0]|  WC [7:0]      |  WC [15:8]     | ECC    |  数据payload   | CRC[7:0]|CRC[15:8]|
+--------+--------+--------+--------+--------+--------+-------  --------+--------+--------+
 \______/ \__________________/ \________________/ \______/ \______________/ \__________/
  1byte        1byte                  1byte         1byte       N bytes        2 bytes
  包头                              Word Count      纠错码      图像数据         校验码
```

**长包各字段详解：**

| 字段 | 大小 | 说明 |
|:---|:--:|:---|
| Data Type | 6bit | 定义数据格式（RAW8/RAW10/YUV422等） |
| Virtual Channel | 2bit | 虚拟通道号 0~3，支持4路摄像头复用 |
| Word Count | 16bit | 数据payload的字节数，最大65535 |
| ECC | 8bit | 对包头（前4字节）的纠错码，可纠正单bit错误 |
| Payload | N字节 | 实际的图像数据，N = Word Count |
| CRC | 16bit | 对全部payload数据的循环冗余校验 |

> ⚠️ **陷阱**：CRC只覆盖**payload数据**，不覆盖包头。这意味着如果ECC未能检测到包头损坏，接收端可能会用错误的数据类型解析数据。某些低成本ISP在包损严重时的花屏现象，往往根源于此。

### 完整包格式对比

| 包类型 | 总大小 | 内容组成 | 主要用途 |
|:------|:------:|:--------|:---------|
| 短包 | 4字节 | DT+VC / 计数 / ECC | 帧起始/结束、行同步、通用短包 |
| 长包 | 6+WC+2字节 | 包头 / ECC / Payload / CRC | 传输实际图像数据 |

### 虚拟通道（Virtual Channel, VC）

MIPI CSI-2支持4个虚拟通道（VC = 0,1,2,3），让**单条物理MIPI总线**可以同时传输多路摄像头的数据：

```
+-----------+     +-----------+     +-----------+     +-----------+
|  Camera 0 |     |  Camera 1 |     |  Camera 2 |     |  Camera 3 |
|   VC=0    |     |   VC=1    |     |   VC=2    |     |   VC=3    |
+-----+-----+     +-----+-----+     +-----+-----+     +-----+-----+
      |                 |                 |                 |
      +-----------------+-----------------+-----------------+
                        |
                   +----+----+
                   |  CSI-2  |          同一物理MIPI链路
                   | Muxer   |          4路VC独立标识
                   +----+----+
                        |
                   +----+----+
                   | D-PHY   |
                   | 2-lane  |
                   +---------+
```

每个数据包的包头中都嵌入了2bit的VC字段，接收端根据VC值把数据分发到对应的处理通道。这在**多目摄像头**（如手机前后置双摄、车载环视）中非常关键——不需要为每颗sensor单独布线，节省PCB面积和引脚资源。

### CSI-2数据类型（Data Type, DT）

CSI-2定义了丰富的数据类型来支持不同格式的图像数据。以下是嵌入式平台最常用的类型：

| 数据类型 | 值 | 说明 | 位深 | 每像素字节 |
|:--------|:--:|:-----|:--:|:---------:|
| Null | 0x10 | 填充包，无有效数据 | - | - |
| Embedded 8b | 0x12 | 嵌入式数据（sensor元信息） | 8 | 1 |
| RAW6 | 0x28 | RAW Bayer 6bit | 6 | 0.75 |
| RAW7 | 0x29 | RAW Bayer 7bit | 7 | 0.875 |
| RAW8 | 0x2A | RAW Bayer 8bit | 8 | 1 |
| RAW10 | 0x2B | RAW Bayer 10bit（嵌入式填充） | 10 | 1.25 |
| RAW12 | 0x2C | RAW Bayer 12bit（嵌入式填充） | 12 | 1.5 |
| RAW14 | 0x2D | RAW Bayer 14bit（嵌入式填充） | 14 | 1.75 |
| RGB888 | 0x24 | RGB 8:8:8 | 24 | 3 |
| RGB565 | 0x22 | RGB 5:6:5 | 16 | 2 |
| YUV422 8b | 0x1E | YUV422 8bit（UYVY/YUYV） | 16 | 2 |
| YUV420 8b | 0x18 | YUV420 Legacy | 12 | 1.5 |
| User Defined 1 | 0x30 | 厂商自定义类型1 | 变长 | 变长 |
| Frame Start | 0x00 | 帧起始短包 | - | - |
| Frame End | 0x01 | 帧结束短包 | - | - |
| Line Start | 0x02 | 行起始短包 | - | - |
| Line End | 0x03 | 行结束短包 | - | - |

> 💡 **提示**：**RAW10**是最常见的sensor原生输出格式。10bit的像素值实际占用16bit（低10bit有效，高6bit填0），但在MIPI上传输时采用"嵌入式填充"——每4个像素打包成5字节（40bit = 4×10bit），节省25%的带宽。这种打包方式在ISP解包时会自动还原。

### ECC与CRC：双重错误检测

CSI-2提供了两层数据完整性保护：

**ECC（Error Correction Code）**—— 1字节，保护**包头**（前4字节）：
- 基于汉明码实现
- 可**纠正1bit**错误、**检测2bit**错误
- 对短包尤为重要，因为短包没有CRC保护

**CRC（Cyclic Redundancy Check）**—— 2字节，保护**整个payload**：
- 使用CRC-16-CCITT多项式（0x1021）
- 可检测所有1bit/2bit错误、所有奇数位错误
- 不纠正错误，只标记数据损坏

```
数据流方向：

发送端：
  原始数据 → 计算ECC → 填入包头 → 计算CRC → 填入包尾 → MIPI发送

接收端：
  MIPI接收 → 验证ECC（纠正/检测）→ 验证CRC（通过/丢弃）→ 送ISP
```

> 🔴 **危险**：在高速传输（如4lane @ 1.5Gbps/lane）或PCB走线质量不佳的场景下，CRC错误率会显著上升。如果在dmesg中看到大量`CSI CRC error`或`ECC error`日志，首先要检查MIPI走线的等长匹配、阻抗控制和参考时钟质量——这往往不是软件问题。

---

## <span class="blue"> 知识点320：Linux V4L2子系统 [I][M]

V4L2（Video for Linux 2）是Linux内核中负责视频采集和输出的框架。它屏蔽了不同摄像头硬件的差异，为用户提供了一套统一的ioctl接口。

### V4L2架构三件套

```
用户空间                    内核空间
+---------+              +---------------------+
| v4l2-ctl|              |    V4L2 Core        |
| ffmpeg  | ← ioctl →    | (video_device层)    |
| App     |              +----------+----------+
+---------+                         |
                                    | subdev调用
                           +--------+--------+
                           |  v4l2_subdev    |  ← sensor驱动注册
                           |  (OV5640等)     |
                           +--------+--------+
                                    |
                           +--------+--------+
                           |  media_entity   |  ← 连接CSI-2控制器
                           |  (CSI-2/ISP)    |
                           +-----------------+
```

**三个核心结构体：**

| 结构体 | 作用 | 类比理解 |
|:------|:-----|:--------|
| `struct video_device` | 向用户空间暴露`/dev/videoN`设备节点 | 相当于驱动的"门面" |
| `struct v4l2_ioctl_ops` | 定义该设备支持的ioctl操作集 | 相当于"服务菜单" |
| `struct v4l2_subdev` | 表示一个视频子设备（如sensor、ISP）| 相当于"后端服务" |

**V4L2关键ioctl命令：**

| ioctl命令 | 功能 | 关键参数 |
|:----------|:-----|:---------|
| `VIDIOC_QUERYCAP` | 查询设备能力 | `struct v4l2_capability`（驱动名/版本/支持功能） |
| `VIDIOC_ENUM_FMT` | 枚举支持的像素格式 | `struct v4l2_fmtdesc`（FourCC格式码） |
| `VIDIOC_G_FMT` / `S_FMT` | 获取/设置数据格式 | `struct v4l2_format`（宽/高/格式/stride） |
| `VIDIOC_G_PARM` / `S_PARM` | 获取/设置流参数 | `struct v4l2_streamparm`（帧率/时间戳模式） |
| `VIDIOC_REQBUFS` | 申请内核缓冲区 | `struct v4l2_requestbuffers`（数量/类型/内存模式） |
| `VIDIOC_QUERYBUF` | 查询缓冲区信息 | `struct v4l2_buffer`（偏移/长度/状态） |
| `VIDIOC_QBUF` | 将空缓冲区入队 | `struct v4l2_buffer` |
| `VIDIOC_DQBUF` | 将填满的缓冲区出队 | `struct v4l2_buffer`（含时间戳/序号） |
| `VIDIOC_STREAMON` / `STREAMOFF` | 启动/停止视频流 | 缓冲区类型 |
| `VIDIOC_S_CTRL` | 设置控制参数 | `struct v4l2_control`（曝光/增益/白平衡等） |

V4L2的缓冲区管理采用**生产者-消费者模型**：驱动填充缓冲区（生产者），用户空间读取后归还（消费者）。通过`mmap`把内核缓冲区映射到用户空间，避免了数据拷贝，这是零拷贝采集的关键。

### V4L2设备树CSI节点配置

典型的MIPI CSI-2控制器设备树节点如下：

```dts
// CSI-2控制器节点（以i.MX6为例）
&mipi_csi {
    compatible = "fsl,imx6-mipi-csi2";
    reg = <0x021dc000 0x4000>;
    interrupts = <0 100 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&clks IMX6QDL_CLK_MIPI_CORE>,
             <&clks IMX6QDL_CLK_MIPI_IPG>;
    clock-names = "mipi_core", "mipi_ipg";
    status = "okay";

    // 连接到ISP（Image Signal Processor）
    ports {
        #address-cells = <1>;
        #size-cells = <0>;

        port@0 {
            reg = <0>;
            mipi_csi_ep: endpoint {
                remote-endpoint = <&csi2_ep>;
                data-lanes = <1 2>;        // 使用2 lane
                lane-speed = <800>;         // 每lane 800Mbps
                bus-width = <10>;           // RAW10输入
            };
        };
    };
};

// OV5640摄像头子节点（挂在I2C总线上）
&i2c2 {
    ov5640: camera@3c {
        compatible = "ovti,ov5640";
        reg = <0x3c>;                       // I2C地址

        // 供电控制
        AVDD-supply = <&reg_ov5640_avdd>;   // 模拟供电 2.8V
        DOVDD-supply = <&reg_ov5640_dovdd>; // 数字IO供电 1.8V
        DVDD-supply = <&reg_ov5640_dvdd>;   // 数字核心供电 1.5V

        // 复位和使能引脚
        reset-gpios = <&gpio3 14 GPIO_ACTIVE_LOW>;
        pwdn-gpios = <&gpio3 15 GPIO_ACTIVE_HIGH>;

        // MIPI CSI-2 输出端点
        port {
            ov5640_ep: endpoint {
                remote-endpoint = <&mipi_csi_ep>;
                data-lanes = <1 2>;         // 2 lane输出
                lane-speed = <800>;          // 800Mbps/lane
                bus-width = <10>;            // RAW10
                clock-noncontinuous;         // 时钟非连续模式
                link-frequencies = /bits/ 64 <160000000>; // link freq = lane-speed * lanes
            };
        };
    };
};

// 稳压器定义
reg_ov5640_avdd: regulator-avdd {
    compatible = "regulator-fixed";
    regulator-name = "ov5640_avdd";
    regulator-min-microvolt = <2800000>;
    regulator-max-microvolt = <2800000>;
    gpio = <&gpio5 1 GPIO_ACTIVE_HIGH>;
    enable-active-high;
};

reg_ov5640_dovdd: regulator-dovdd {
    compatible = "regulator-fixed";
    regulator-name = "ov5640_dovdd";
    regulator-min-microvolt = <1800000>;
    regulator-max-microvolt = <1800000>;
};

reg_ov5640_dvdd: regulator-dvdd {
    compatible = "regulator-fixed";
    regulator-name = "ov5640_dvdd";
    regulator-min-microvolt = <1500000>;
    regulator-max-microvolt = <1500000>;
};
```

### v4l2-ctl工具速查

`v4l2-ctl`是V4L2调试的瑞士军刀，属于`v4l-utils`工具包：

```bash
# 1. 查看设备能力
v4l2-ctl -d /dev/video0 --all

# 2. 枚举支持的格式和分辨率
v4l2-ctl -d /dev/video0 --list-formats-ext

# 3. 查询当前格式
v4l2-ctl -d /dev/video0 --get-fmt-video

# 4. 设置格式（1920x1080 YUYV）
v4l2-ctl -d /dev/video0 --set-fmt-video=width=1920,height=1080,pixelformat=YUYV

# 5. 设置帧率（30fps）
v4l2-ctl -d /dev/video0 --set-parm=30

# 6. 设置曝光时间（单位为行）
v4l2-ctl -d /dev/video0 --set-ctrl=exposure=1000

# 7. 查看所有控制项
v4l2-ctl -d /dev/video0 --list-ctrls

# 8. 抓取一帧到文件
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=1 --stream-to=/tmp/cap.raw

# 9. 连续抓取并保存
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=100 --stream-to=/tmp/cap.yuv
```

---

## <span class="blue"> 行业实例：OV5640摄像头采集 + ISP处理 + FFmpeg推流

### 硬件概述

| 参数 | 规格 |
|:-----|:-----|
| Sensor型号 | OmniVision OV5640 |
| 分辨率 | 500万像素（2592×1944） |
| MIPI接口 | CSI-2, 2 lane |
| 输出格式 | RAW10 / YUV422 / RGB565 / JPEG |
| 最大帧率 | 2592×1944@15fps / 1080p@30fps / 720p@60fps |
| 封装 | CSP-28pin |
| I2C地址 | 0x3c (7bit) / 0x78 (8bit写) |

### 系统架构

```
+--------+    MIPI CSI-2    +----------+    DMA    +------+   CPU/MEM
| OV5640 |  2lane, YUV422   |  CSI-2   | --------→ | DDR  |   |  |
| Sensor |  --------------→ | Controller|           +------+   |  |
|        |   800Mbps/lane   | (V4L2)   | --------→ | ISP  | ←→ |App|
+--------+                  +----------+           +------+   |  |
                                    ↑                          |  |
                              I2C配置 ↑                          |FFmpeg
                              (0x3c) |                          |推流
                                    +----------------------→ 网络输出
```

### 完整的OV5640设备树配置

```dts
#include <dt-bindings/gpio/gpio.h>

/ {
    // 稳压器：OV5640三路供电
    regulators {
        compatible = "simple-bus";
        #address-cells = <1>;
        #size-cells = <0>;

        reg_ov5640_avdd: regulator@0 {
            compatible = "regulator-fixed";
            regulator-name = "ov5640_avdd";
            regulator-min-microvolt = <2800000>;
            regulator-max-microvolt = <2800000>;
            regulator-always-on;
            gpio = <&gpio1 5 GPIO_ACTIVE_HIGH>;
            enable-active-high;
            startup-delay-us = <20000>;     // 20ms上电延时
        };

        reg_ov5640_dovdd: regulator@1 {
            compatible = "regulator-fixed";
            regulator-name = "ov5640_dovdd";
            regulator-min-microvolt = <1800000>;
            regulator-max-microvolt = <1800000>;
            regulator-always-on;
            startup-delay-us = <5000>;
        };

        reg_ov5640_dvdd: regulator@2 {
            compatible = "regulator-fixed";
            regulator-name = "ov5640_dvdd";
            regulator-min-microvolt = <1500000>;
            regulator-max-microvolt = <1500000>;
            regulator-always-on;
            startup-delay-us = <10000>;
        };
    };

    // MIPI CSI-2 控制器节点
    mipi_csi2: mipi-csi@21dc000 {
        compatible = "fsl,imx6q-mipi-csi2";
        reg = <0x021dc000 0x4000>;
        interrupts = <GIC_SPI 100 IRQ_TYPE_LEVEL_HIGH>;
        clocks = <&clks IMX6QDL_CLK_MIPI_CORE>,
                 <&clks IMX6QDL_CLK_MIPI_IPG>;
        clock-names = "mipi_core", "mipi_ipg";
        assigned-clocks = <&clks IMX6QDL_CLK_MIPI_CORE>;
        assigned-clock-rates = <80000000>;       // 80MHz参考时钟
        status = "okay";

        ports = <&mipi_csi2_port>;
    };

    // OV5640 CSI端口端点
    mipi_csi2_port: port {
        mipi_csi2_ep: endpoint {
            remote-endpoint = <&ov5640_mipi_ep>;
            data-lanes = <1 2>;                 // 使用lane1和lane2
            bus-width = <8>;                     // YUV422输出，8bit
            lane-speed = <800>;                  // 800Mbps/lane
        };
    };

    // ISP节点（集成在SoC内部）
    csi: csi@21c4000 {
        compatible = "fsl,imx6q-csi";
        reg = <0x021c4000 0x4000>;
        interrupts = <GIC_SPI 102 IRQ_TYPE_LEVEL_HIGH>;
        clocks = <&clks IMX6QDL_CLK_CSI_IPG>,
                 <&clks IMX6QDL_CLK_CSI_AXI>,
                 <&clks IMX6QDL_CLK_CSI_MCLK>;
        clock-names = "ipg", "axi", "mclk";
        status = "okay";

        port {
            csi_ep: endpoint {
                remote-endpoint = <&mipi_csi2_ep>;
            };
        };
    };
};

// I2C总线上的OV5640设备
&i2c3 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_i2c3>;
    clock-frequency = <100000>;                 // I2C 100kHz
    status = "okay";

    ov5640: ov5640@3c {
        compatible = "ovti,ov5640";
        reg = <0x3c>;                           // 7bit I2C地址

        // 三路供电
        AVDD-supply = <&reg_ov5640_avdd>;       // 2.8V 模拟
        DOVDD-supply = <&reg_ov5640_dovdd>;     // 1.8V IO
        DVDD-supply = <&reg_ov5640_dvdd>;       // 1.5V 数字核心

        // 控制引脚
        reset-gpios = <&gpio1 4 GPIO_ACTIVE_LOW>;   // XCLR 低有效复位
        pwdn-gpios = <&gpio1 6 GPIO_ACTIVE_HIGH>;   // PWDN 高有效掉电

        // XCLK输入时钟（24MHz晶振）
        clocks = <&clks IMX6QDL_CLK_CKO>;
        clock-names = "xclk";
        clock-frequency = <24000000>;

        // MIPI端点
        port {
            ov5640_mipi_ep: endpoint {
                remote-endpoint = <&mipi_csi2_ep>;
                data-lanes = <1 2>;             // 2 lane
                lane-speed = <800>;
                clock-noncontinuous;            // MIPI时钟非连续
                link-frequencies = /bits/ 64 <160000000>;
            };
        };
    };
};
```

### 抓图、编码与推流

以下是OV5640在1080p@30fps、YUV422格式下的完整操作链条：

```bash
# =================== 步骤1：查看设备状态 ===================
# 确认video0节点存在
ls -la /dev/video*
# crw-rw---- 1 root video 81, 0 Jan  1 00:00 /dev/video0

# 查看设备能力
v4l2-ctl -d /dev/video0 --all
# 重点看 Driver name, Card type, Bus info, Capabilities

# =================== 步骤2：枚举支持格式 ===================
v4l2-ctl -d /dev/video0 --list-formats-ext
# 预期输出示例：
# ioctl: VIDIOC_ENUM_FMT
#   Type: Video Capture
#   [0]: 'YUYV' (YUYV 4:2:2)
#       Size: Stepwise 32x32 - 2592x1944 with step 2/2
#   [1]: 'UYVY' (UYVY 4:2:2)
#   [2]: 'RGB565' (RGB565)
#   [3]: 'MJPG' (Motion-JPEG, compressed)

# =================== 步骤3：设置格式和帧率 ===================
v4l2-ctl -d /dev/video0 \
    --set-fmt-video=width=1920,height=1080,pixelformat=YUYV \
    --set-parm=30

# 验证设置是否生效
v4l2-ctl -d /dev/video0 --get-fmt-video
# VIDIOC_G_FMT: ok
#   Format Video Capture:
#     Width/Height      : 1920/1080
#     Pixel Format      : 'YUYV' (YUYV 4:2:2)
#     Field             : None
#     Bytes per Line    : 3840
#     Size Image        : 4147200

# =================== 步骤4：抓一帧YUV图 ===================
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=1 --stream-to=/tmp/frame.yuv

# YUV转PNG查看（在开发主机上）
ffmpeg -s 1920x1080 -pix_fmt yuyv422 -i /tmp/frame.yuv /tmp/frame.png

# =================== 步骤5：连续采集 + ffmpeg编码推流 ===================
# 方法A：采集为YUV文件，再编码
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=300 \
    --stream-to=/tmp/out.yuv
ffmpeg -f rawvideo -s 1920x1080 -pix_fmt yuyv422 -i /tmp/out.yuv \
    -c:v libx264 -preset fast -crf 23 output.mp4

# 方法B：管道方式实时推流（v4l2 → ffmpeg → RTMP）
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=0 \
    --stream-to=/dev/stdout 2>/dev/null | \
    ffmpeg -f rawvideo -s 1920x1080 -pix_fmt yuyv422 -i - \
           -c:v libx264 -preset ultrafast -tune zerolatency \
           -b:v 4M -f flv rtmp://server/live/stream

# 方法C：使用ffmpeg直接从V4L2设备读取（更简洁）
ffmpeg -f v4l2 -input_format yuyv422 -video_size 1920x1080 \
       -framerate 30 -i /dev/video0 \
       -c:v libx264 -preset fast -f flv rtmp://server/live/stream

# =================== 步骤6：调节Sensor参数 ===================
# 查看所有可调参数
v4l2-ctl -d /dev/video0 --list-ctrls
# 常见参数：
#   exposure_auto (int)  : 自动曝光开关
#   exposure_absolute   : 曝光时间（单位：100μs）
#   gain                : 模拟增益
#   brightness          : 亮度
#   contrast            : 对比度
#   saturation          : 饱和度
#   white_balance_auto  : 自动白平衡

# 手动设置曝光和增益（用于固定光照场景）
v4l2-ctl -d /dev/video0 --set-ctrl=exposure_auto=1          # 关闭自动曝光
v4l2-ctl -d /dev/video0 --set-ctrl=exposure_absolute=100    # 10ms曝光
v4l2-ctl -d /dev/video0 --set-ctrl=gain=100                 # 增益
```

### 调试命令速查

```bash
# ===== 内核日志排查 =====
# 查看OV5640驱动初始化日志
dmesg | grep -i ov5640
# [    3.450000] ov5640 2-003c: ov5640 detected at address 0x3c
# [    3.460000] ov5640 2-003c: clock: 24000000 Hz, link freq: 160000000 Hz
# [    3.470000] ov5640 2-003c: 2 data lanes at 800Mbps/lane

# 查看MIPI CSI错误
dmesg | grep -i "csi\|mipi"
# [   12.340000] mipi_csi2: data type mismatch (expected 0x1e, got 0x00)
# [   12.345000] mipi_csi2: CRC error on lane 0

# 开启详细调试（需重新编译内核开启CONFIG_VIDEO_ADV_DEBUG）
dmesg -n debug
echo 7 > /sys/kernel/debug/tracing/dynamic_v4l2/debug_level

# ===== I2C直接访问寄存器（确认sensor响应） =====
i2cdetect -y 2            # 扫描I2C总线2，应看到0x3c
i2cdump -y 2 0x3c b       # dump所有寄存器（256字节）
# 读寄存器0x300a (CHIP ID高字节，应为0x56)
i2cget -y 2 0x3c 0x300a w

# ===== V4L2详细诊断 =====
# 枚举所有格式、分辨率和帧率
v4l2-ctl -d /dev/video0 --list-formats-ext

# 查询媒体拓扑（media-ctl工具）
media-ctl -d /dev/media0 --print-topology
media-ctl -d /dev/media0 --enum-links

# 读取当前链路配置
media-ctl -d /dev/media0 --get-v4l2 '"ov5640 2-003c":0'

# ===== 示波器测量要点 =====
# MIPI信号质量检查项：
# 1. CLK lane差分幅度：200mVpp（HS模式）/ 1.2V（LP模式）
# 2. Data lane HS差分幅度：200mVpp ± 20%
# 3. 单端共模电压：200mV ± 50mV
# 4. 上升/下降时间：< 300ps（HS模式）
# 5. 数据速率：800Mbps/lane（对应400MHz时钟）
# 6. 多lane间skew：< 0.2 UI（UI = 1/800M = 1.25ns）
```

### OV5640配置时序要点

| 阶段 | 时序要求 | 说明 |
|:-----|:---------|:-----|
| 上电顺序 | DOVDD → AVDD → DVDD → XCLR释放 | 严格的电源上电顺序，违反可能损坏sensor |
| 复位脉宽 | XCLR低电平 ≥ 1ms | 硬复位最小脉宽 |
| 复位后等待 | ≥ 20ms | 等待内部电路稳定后再I2C访问 |
| XCLK启动 | 先于复位释放 | 24MHz晶振必须在复位释放前稳定 |
| I2C配置 | 复位后20ms开始 | 配置寄存器序列（约200+个寄存器） |
| MIPI启动 | 寄存器配置完成后 | 软件触发streaming开始 |

> ⚠️ **陷阱**：**MIPI CSI-2的lane数必须成对使用**——规范只支持1 lane、2 lane或4 lane配置。**3 lane是不支持的**。即使你用4 lane控制器但只物理连接了3对差分线，也不能工作。这是因为MIPI协议的数据打包机制是按2的幂次对齐的。如果发现画面错位或颜色异常，首先确认硬件连接的lane数与设备树配置一致。

> 💡 **提示**：摄像头pipeline调试要**按阶段验证**，不要一步到位：
> 1. **先确认sensor输出**：I2C能读到CHIP ID → 能配置寄存器 → MIPI有信号输出（示波器看lane上有无HS toggle）
> 2. **再配CSI-2控制器**：确认时钟/数据lane连接正确 → 确认数据类型匹配 → 看dmesg有无CRC/ECC错误
> 3. **然后调ISP**：确认像素格式转换正确 → 确认DMA写入DDR的地址和stride正确
> 4. **最后调display pipeline**：确认DRM/KMS或用户空间能正确显示
> 每个阶段都用`v4l2-ctl`抓一帧raw数据确认输出正常，再推进到下一阶段。

---

## <span class="blue"> 本节总结

| 主题 | 关键要点 |
|:-----|:---------|
| CSI-2短包 | 4字节：DT+VC / 计数 / ECC；用于帧/行同步 |
| CSI-2长包 | 6+WC+2字节：包头/ECC/Payload/CRC；传输图像数据 |
| 数据类型 | RAW8/RAW10/RAW12/YUV422/RGB888等16种标准格式 |
| 虚拟通道 | 2bit VC支持4路摄像头复用同一条MIPI链路 |
| ECC+CRC | ECC保护包头（纠1bit/检2bit），CRC保护payload（检错） |
| V4L2核心 | video_device + v4l2_ioctl_ops + v4l2_subdev三层结构 |
| 关键ioctl | QUERYCAP/ENUM_FMT/S_FMT/REQBUFS/QBUF/DQBUF/STREAMON |
| 缓冲区管理 | mmap零拷贝、生产者-消费者模型 |
| 设备树要点 | csi2控制器节点 + ov5640子节点 + 三路供电regulator + reset gpio |
| 调试顺序 | I2C确认 → MIPI信号 → 格式匹配 → ISP → display，逐步验证 |

---

## <span class="blue"> 下一步

掌握了MIPI CSI-2的输入侧，下一节我们把目光转向**输出侧**——**B-B.8.3 MIPI DSI协议层与DRM**。DSI是MIPI联盟定义的显示接口协议，与CSI-2类似但服务于显示输出方向。我们将学习DSI的包格式、DCS显示命令集，以及Linux DRM/KMS子系统如何驱动DSI显示屏。CSI-2负责"看"，DSI负责"显"——输入输出两条MIPI链路，构成嵌入式设备完整的视觉体验。

---

## <span class="blue"> 配套资源

**推荐文档：**
- MIPI Alliance, "MIPI CSI-2 Specification v3.0", 2021
- MIPI Alliance, "MIPI D-PHY Specification v2.5", 2021
- Linux Kernel, `Documentation/userspace-api/media/v4l/v4l2.rst`
- OmniVision, "OV5640 Datasheet", 2011

**工具链：**
- `v4l-utils`（含v4l2-ctl, media-ctl）
- `yavta`（Yet Another V4L2 Test Application）
- FFmpeg（视频编码推流）
- `i2c-tools`（i2cdetect/i2cdump/i2cget/i2cset）

**调试信号测量点：**
| 测量位置 | 信号 | 预期值 | 异常判断 |
|:---------|:-----|:-------|:---------|
| MIPI CLK± | 差分时钟 | 200mVpp, 400MHz | 无信号=时钟未启动 |
| MIPI D0± | 差分数据 | 200mVpp toggle | 无toggle=sensor未输出 |
| MIPI D1± | 差分数据 | 与D0同步toggle | D0有但D1无=lane配置错误 |
| XCLK引脚 | 24MHz时钟 | 正弦/方波 24MHz | 无时钟=sensor不工作 |
| I2C SDA/SCL | 数据/时钟 | 1.8V电平脉冲 | 无脉冲=I2C未初始化 |
