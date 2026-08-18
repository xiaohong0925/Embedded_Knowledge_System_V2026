# B-C.9.5 实战：OV 系摄像头点亮全流程（设备树 → V4L2 采集 → 显示）

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[M] | 预计阅读时间：45 分钟（含动手 90~120 分钟）

## 本节导读

这是板块 3 的收官实战：把一颗 OV 系 MIPI 摄像头（以 OV5640 为例，方法对 OV 全系与大多数 MIPI sensor 通用）从"焊上板子"一路点到"画面显示在 DSI 屏上"。前三篇分别讲了 D-PHY 物理层、CSI-2 + V4L2、DSI + DRM——这一篇把它们串成一条完整的数据通路，并按真实工程的节奏分七段验证，每段都有明确的通过判据和失败时的排查方向。

点亮摄像头是嵌入式调试里"链条最长"的任务之一：供电、时钟、复位、I2C、MIPI 布线、设备树、驱动、格式协商、DMA、显示，任何一环断了表现都是"没图"。这篇实战的核心交付物不是某个脚本，而是**分段验证的方法论**——每段独立验证，问题永远被锁定在当前段内。

本节覆盖：硬件检查清单、完整设备树、七段点亮流程（供电→时钟→I2C→驱动→MIPI→采集→显示）、raw 帧解析验证、FFmpeg 推流，以及覆盖全链路的排障对照表。

## 硬件检查清单（上电前）

软件之前，先排除物理层。摄像头模组的每根线都有明确的验证手段：

| 检查项 | 手段 | 合格判据 |
|--------|------|---------|
| 三路供电 AVDD/DOVDD/DVDD | 万用表量模组排针 | 2.8V / 1.8V / 1.5V（以 datasheet 为准） |
| XCLK 输入时钟 | 示波器 | 24MHz（或 27MHz）方波/正弦，幅度达标 |
| RESET/PWDN 引脚 | 万用表/示波器 | 上电后 RESET 释放为高、PWDN 为低（以模组定义为准） |
| MIPI 走线 | 目检 + 原理图比对 | D0/D1/CLK 差分对连接正确、无极性反接 |
| I2C 上拉 | 万用表 | SDA/SCL 有上拉（通常 4.7kΩ 到 1.8V） |

> ⚠️ OV 系 sensor 的上电时序是硬性要求：DOVDD → AVDD → DVDD → XCLK 稳定 → 释放 RESET → 等 20ms 才允许 I2C 访问。时序错不一定立刻烧片，但会导致芯片偶发不识别——"有时能扫到 0x3c 有时不能"八成是这里。内核 sensor 驱动会按设备树里声明的 regulator 顺序和 `startup-delay-us` 处理时序，你的任务是把设备树写对。

## 设备树：三条通道一次写全

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

## 七段点亮流程

### 第 1 段：供电确认

```bash
# 内核日志里 regulator 无报错；万用表实测三路电压
dmesg | grep -i regulator
```

通过判据：三路电压实测值在 datasheet 允许范围内。失败 → 查设备树 regulator 定义、使能 GPIO 极性、硬件电源树。

### 第 2 段：时钟确认

```bash
# 时钟框架视角确认 XCLK 已使能且频率正确
cat /sys/kernel/debug/clk/clk_summary | grep -i cko
```

通过判据：24MHz 使能。有条件的话示波器在模组排针上实测。失败 → 查 `clocks`/`clock-frequency` 属性和 SoC 时钟父链。

### 第 3 段：I2C 配置通道

```bash
i2cdetect -y 2                     # 应看到 0x3c
i2cget -y 2 0x3c 0x300a w          # CHIP ID 高字节，OV5640 应返回 0x56xx
```

通过判据：CHIP ID 读出 `0x56`。**这是整个点亮流程最重要的一个里程碑**——它证明供电、时钟、复位、I2C 四件事全对。失败 → 回到第 1、2 段，并用示波器看 I2C 波形（有没有起始条件、有没有 ACK）。

### 第 4 段：驱动绑定与 video 节点

```bash
dmesg | grep -i ov5640
ls -l /dev/video*
```

```
ov5640 2-003c: ov5640 detected at address 0x3c
crw-rw---- 1 root video 81, 0 /dev/video0
```

通过判据：probe 成功日志 + video 节点生成。失败 → 看 dmesg 具体报错：endpoint 解析失败查 `remote-endpoint` 互指；compatible 不匹配查内核 `CONFIG_VIDEO_OV5640`。

### 第 5 段：链路拓扑与格式枚举

```bash
media-ctl -d /dev/media0 --print-topology
v4l2-ctl -d /dev/video0 --list-formats-ext
```

通过判据：拓扑里 sensor→CSI→ISP 各实体链路连通（`ENABLED`）；格式列表非空。拓扑断链 → subdev 间的 endpoint 没建起来，回查设备树 port 层级。

### 第 6 段：采集验证（核心段）

```bash
# 设格式：1080p YUYV 30fps
v4l2-ctl -d /dev/video0 \
    --set-fmt-video=width=1920,height=1080,pixelformat=YUYV --set-parm=30

# 抓 10 帧到文件
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=10 --stream-to=/tmp/cap.yuv

# 拷到开发机转图查看
ffmpeg -s 1920x1080 -pix_fmt yuyv422 -i /tmp/cap.yuv -frames:v 1 /tmp/frame.png
```

通过判据：文件大小 = 1920×1080×2×10 字节，png 图像内容正确（对着有特征的物体拍，比如带字的纸）。这一段的失败模式最丰富，单独给排障表（见文末）。

### 第 7 段：上屏显示

采集→显示打通的最后一步，用 ffmpeg 把 V4L2 采集直接送到 framebuffer（DSI 屏已在 B-C.9.3 点量的前提下）：

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

## 排障对照表（按失败段定位）

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

## 本节总结

| 自查项 | 完成本实战你应能独立做到 |
|--------|------------------------|
| 硬件检查 | 按清单验证供电/时钟/复位/走线/上拉五项 |
| 设备树 | 写出三路 regulator + sensor 节点 + 控制器 endpoint 的完整配置 |
| 分段点亮 | 按七段流程逐段推进，每段说出通过判据 |
| 采集验证 | 用 v4l2-ctl 抓帧并用 ffmpeg 转图确认内容正确 |
| 链路隔离 | 用 test pattern 把 MIPI 链路问题与光学问题分离 |
| 上屏 | 用 fbdev/kmssink/推流三种方式之一把画面送出去 |
| 排障 | 给定任一失败现象，定位到段并给出下一步手段 |

## 配套资源

- OV5640 Datasheet 与 Software Application Note（寄存器手册，OmniVision）
- 内核 sensor 驱动源码：`drivers/media/i2c/ov5640.c`（上电时序与寄存器表的标准参考）
- V4L2 采集代码骨架：见 B-C.7.3 实战一的 C 代码（MIPI 与 UVC 摄像头通用）
- media-ctl 文档：`Documentation/userspace-api/media/mediactl/`
- GStreamer kmssink 文档：https://gstreamer.freedesktop.org/
