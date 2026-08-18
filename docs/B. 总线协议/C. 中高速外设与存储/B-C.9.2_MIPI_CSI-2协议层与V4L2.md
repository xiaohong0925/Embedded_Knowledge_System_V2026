# B-C.9.2 MIPI CSI-2 协议层与 V4L2

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[M] | 预计阅读时间：45 分钟

## 本节导读

上一节讲了 D-PHY 物理层——信号怎么在线上跑。本节往上走两层：CSI-2 协议层定义图像数据怎么打包、打标签、校验；Linux V4L2 子系统定义数据进内核后怎么被管理、怎么交到应用手里。摄像头调试中"花屏、丢帧、颜色异常"这三类经典问题，分别对应 CSI-2 的包结构、帧同步、数据类型三个知识点——看懂协议层，这些问题才有排查入口。

本节覆盖：CSI-2 的短包/长包结构与 ECC/CRC 双重校验、数据类型（RAW/YUV/RGB）与虚拟通道、V4L2 的核心结构与 ioctl 流程、MIPI 摄像头在设备树里的描述方式（endpoint 互联模型）、v4l2-ctl 的最小验证流程。完整的 OV 系摄像头点亮实战（含排障全流程）在 B-C.9.5。

## CSI-2 协议层

CSI-2（Camera Serial Interface 2）跑在 D-PHY 之上，做三件事：**包格式化**（图像数据切成包）、**通道复用**（多路摄像头共享一条物理链路）、**错误检测**（ECC + CRC）。

```
应用层（ISP / 应用）
─────────────────────
CSI-2 协议层    ← 本节：包格式、VC、校验
─────────────────────
D-PHY 物理层    ← 上一节：LP/HS、lane
```

### 短包：4 字节的同步信令

短包不带图像数据，只传同步信息，固定 4 字节：

| 字节 | 内容 |
|------|------|
| Byte 0 | 数据类型 DT[5:0] + 虚拟通道 VC[1:0] |
| Byte 1~2 | 行号 / 帧号（16bit 计数字段） |
| Byte 3 | ECC（包头纠错码） |

DT 字段决定语义，四个同步类型最重要：

| DT | 名称 | 含义 |
|----|------|------|
| 0x00 | FS（Frame Start） | 一帧开始，计数字段 = 帧号 |
| 0x01 | FE（Frame End） | 一帧结束 |
| 0x02 | LS（Line Start） | 一行有效数据开始，计数字段 = 行号 |
| 0x03 | LE（Line End） | 一行结束 |

> 💡 帧号字段是调试丢帧的直接证据：dmesg 或驱动统计里帧号跳变（1, 2, 4, 5…）说明第 3 帧在链路上丢了——往下查带宽够不够、DMA 有没有溢出，而不是怀疑 sensor。

### 长包：图像数据的主力载体

```
┌────────┬─────────┬──────────┬─────┬──────────────────┬─────────┐
│ DT+VC  │ WC 低字节│ WC 高字节│ ECC │   Payload（N字节）│ CRC-16  │
│ 1B     │ 1B      │ 1B       │ 1B  │   图像数据        │ 2B      │
└────────┴─────────┴──────────┴─────┴──────────────────┴─────────┘
            Word Count = Payload 字节数（16bit，最大 65535）
```

| 字段 | 大小 | 作用 |
|------|------|------|
| DT + VC | 1B | 数据格式 + 虚拟通道号 |
| Word Count | 2B | Payload 字节数 |
| ECC | 1B | 保护包头：纠 1bit、检 2bit |
| Payload | N B | 实际图像数据 |
| CRC-16 | 2B | 保护 Payload：检错不纠错 |

**ECC 与 CRC 的分工**是两层防护：ECC（汉明码）保护包头——包头错了接收端连"这是什么数据、多长"都不知道，所以必须能纠正；CRC-16 保护 Payload——数据错了只能丢弃，但一行像素坏掉不至于破坏整个解析状态机。注意边界：**CRC 不覆盖包头**，包头的保护全靠那 1 字节 ECC。

> ⚠️ dmesg 里出现密集的 `CSI CRC error` / `ECC error`，大概率不是软件问题：高速率（4 lane × 1.5G）下走线质量差、阻抗失配、参考时钟抖动都会直接推高误码。先回到 B-C.9.1 的物理层约束查板子，再查配置。

### 数据类型（DT）：sensor 输出格式的身份标签

| DT 值 | 格式 | 每像素位数 | 备注 |
|-------|------|-----------|------|
| 0x2A | RAW8 | 8 | Bayer 原始数据 |
| 0x2B | RAW10 | 10 | **最常见的 sensor 原生格式** |
| 0x2C | RAW12 | 12 | 高动态范围 sensor |
| 0x24 | RGB888 | 24 | 已插值的彩色图 |
| 0x1E | YUV422 8b | 16 | UYVY/YUYV |
| 0x12 | Embedded 8b | — | sensor 元信息（寄存器快照、温度等） |
| 0x00~0x03 | FS/FE/LS/LE | — | 同步短包 |

> Bayer 格式：图像传感器的感光单元上覆盖着棋盘格状的彩色滤光片，每个像素只感应一种颜色（R/G/B 之一），排列成 RGGB 等图案。RAW 数据就是这些"单色像素"的原始值，彩色图像要由 ISP 做去马赛克插值后才得到。所以 RAW10 输出的 sensor 必须配 ISP；YUV/RGB 输出的 sensor 是内部已集成了处理电路。

RAW10 的传输打包值得一提：4 个 10bit 像素挤进 5 字节（40bit = 4×10bit），比每像素占 16bit 省 25% 带宽。接收端解包还原，对上层透明。

### 虚拟通道（VC）：一条物理链路跑多路摄像头

包头里的 2bit VC 字段（0~3）让**一条 MIPI 链路时分复用多路数据流**。接收端按 VC 把包分发到不同处理通道。多目摄像头（手机双摄、车载环视、机器人双目）靠它省掉成倍的布线：

```
Camera0(VC=0) ┐
Camera1(VC=1) ┼──► CSI-2 复用 ──► 一条 D-PHY 链路 ──► SoC 按 VC 分流
Camera2(VC=2) ┘
```

对单摄像头场景 VC 恒为 0，可以当它不存在；遇到"双目只亮一目"的问题时，先查两路数据的 VC 是否配成了同一个值。

## V4L2：视频数据的内核管家

V4L2（Video for Linux 2）是内核的视频采集/输出框架。所有摄像头——USB 的（B-C.7.3 见过）、MIPI 的、并口的——都经它向用户态暴露 `/dev/videoN` 和统一 ioctl 接口。

### 架构三件套

```
用户空间：v4l2-ctl / ffmpeg / 你的应用
              │ ioctl
内核：  ┌─────▼──────────────┐
        │ video_device        │ ← /dev/videoN 的门面
        │ v4l2_ioctl_ops      │ ← 支持的 ioctl 操作集
        └─────┬──────────────┘
              │ subdev 调用
        ┌─────▼──────────────┐
        │ v4l2_subdev         │ ← sensor / ISP / CSI 控制器各是一个
        └─────┬──────────────┘
              │ media entity 互联（media-ctl 可见的拓扑）
        ┌─────▼──────────────┐
        │ CSI-2 控制器 + DMA  │
        └────────────────────┘
```

现代 SoC 的摄像头链路是多个 subdev 的串联：sensor（OV5640）→ CSI-2 控制器 → ISP → DMA。每个环节是一个 `v4l2_subdev`，彼此用 media entity 连接成拓扑图，`media-ctl --print-topology` 可以把整条链路打印出来——这是复杂 SoC 上排查"数据走到哪断了"的地图。

### ioctl 标准流程

应用层采集视频的固定七步（与 B-C.7.3 的 UVC 抓图代码同构，因为 UVC 驱动也是 V4L2 设备）：

| 步骤 | ioctl | 作用 |
|------|-------|------|
| 1 | `VIDIOC_QUERYCAP` | 查设备能力 |
| 2 | `VIDIOC_ENUM_FMT` | 枚举支持的像素格式 |
| 3 | `VIDIOC_S_FMT` | 设置宽高与格式 |
| 4 | `VIDIOC_REQBUFS` | 向驱动申请缓冲区 |
| 5 | `VIDIOC_QBUF` | 空缓冲区入队交给驱动填充 |
| 6 | `VIDIOC_STREAMON` + `VIDIOC_DQBUF` 循环 | 开流，取出填满的缓冲区 |
| 7 | `VIDIOC_STREAMOFF` + 释放 | 关流清理 |

缓冲区是生产者-消费者模型：驱动（生产者）填满一个缓冲区标记完成，应用（消费者）`DQBUF` 取走、用完 `QBUF` 归还。配 `mmap` 映射后全程零拷贝。

### 设备树：endpoint 互联模型

MIPI 摄像头的设备树描述分两半个节点，靠 endpoint 互相引用连成链路：

```dts
/* CSI-2 控制器侧（i.MX6 示例） */
&mipi_csi {
    status = "okay";
    ports {
        #address-cells = <1>;
        #size-cells = <0>;
        port@0 {
            reg = <0>;
            mipi_csi_ep: endpoint {
                remote-endpoint = <&ov5640_ep>;  /* 指向 sensor 侧 */
                data-lanes = <1 2>;              /* 用 lane 1、2 */
            };
        };
    };
};

/* sensor 侧：挂在 I2C 总线上 */
&i2c2 {
    ov5640: camera@3c {
        compatible = "ovti,ov5640";
        reg = <0x3c>;                            /* I2C 地址 */

        /* 三路供电 + 两个控制 GPIO + 输入时钟 */
        AVDD-supply  = <&reg_avdd>;            /* 2.8V 模拟 */
        DOVDD-supply = <&reg_dovdd>;           /* 1.8V IO */
        DVDD-supply  = <&reg_dvdd>;            /* 1.5V 数字核心 */
        reset-gpios  = <&gpio3 14 GPIO_ACTIVE_LOW>;
        pwdn-gpios   = <&gpio3 15 GPIO_ACTIVE_HIGH>;
        clocks = <&clks IMX6QDL_CLK_CKO>;
        clock-names = "xclk";                   /* 24MHz 外部晶振 */

        port {
            ov5640_ep: endpoint {
                remote-endpoint = <&mipi_csi_ep>; /* 指回控制器侧 */
                data-lanes = <1 2>;
                clock-noncontinuous;              /* 空闲时时钟停，省电 */
                link-frequencies = /bits/ 64 <160000000>;
            };
        };
    };
};
```

这个结构揭示了一个关键事实：**MIPI 摄像头在系统里有两条独立通道**。配置通道走 I2C（寄存器读写：分辨率、曝光、增益），数据通道走 MIPI（像素流）。设备树里 sensor 节点挂 I2C 总线下（配置通道），`port/endpoint` 描述 MIPI 连线（数据通道），两条通道缺一不可。

`remote-endpoint` 双向互指、`data-lanes` 两端一致是两条硬性约束；写错的表现是控制器正常 probe、sensor 正常应答，但开流后收不到任何数据。

## 最小验证流程：v4l2-ctl 六步

以 OV5640（500 万像素，I2C 0x3c，2-lane CSI-2）为例，分阶段验证，每步过了再走下一步：

```bash
# ① I2C 通道：sensor 活着吗？（读 CHIP ID，应为 0x56xx）
i2cdetect -y 2
i2cget -y 2 0x3c 0x300a w

# ② 驱动绑定：video 节点生成了吗？
ls /dev/video* && dmesg | grep -i ov5640

# ③ 能力枚举：支持的格式与分辨率
v4l2-ctl -d /dev/video0 --list-formats-ext

# ④ 设格式：1080p YUYV 30fps
v4l2-ctl -d /dev/video0 \
    --set-fmt-video=width=1920,height=1080,pixelformat=YUYV --set-parm=30

# ⑤ 抓一帧验证数据通路
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=1 --stream-to=/tmp/frame.yuv
# 开发机上转图查看：ffmpeg -s 1920x1080 -pix_fmt yuyv422 -i frame.yuv frame.png

# ⑥ 链路拓扑（复杂 SoC 多 subdev 时用）
media-ctl -d /dev/media0 --print-topology
```

各阶段失败的定位：

| 卡在 | 现象 | 排查方向 |
|------|------|---------|
| ① | i2cdetect 看不到 0x3c | 供电三路电压、reset/pwdn 电平、24MHz XCLK、I2C 地址 |
| ② | 无 /dev/video0 | compatible 匹配、设备树 status、驱动 dmesg 报错 |
| ③④ | 枚举为空或 S_FMT 失败 | subdev 链路未建（media-ctl 看拓扑）、endpoint 互指错误 |
| ⑤ | 超时无数据 | lane 数/速率两端不一致；示波器看 MIPI 线上有无 HS 翻转 |
| ⑤ | 花屏/颜色错 | DT 不匹配（YUYV 当 RAW 解）、lane 错位、bpp 计算错 |

> 💡 摄像头调试的黄金纪律是**逐段验证**：I2C 读到 ID → MIPI 线上有信号 → CSI 控制器无 CRC 报错 → 抓到格式正确的 raw 帧 → 再谈 ISP 与显示。跨阶段一步到位地调，出了问题没有定位支点。完整的多场景点亮流程见 B-C.9.5。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 包结构 | 画出短包/长包字段布局，说明 ECC 保包头、CRC 保数据的分工 |
| 同步机制 | 解释 FS/FE/LS/LE 的作用，用帧号跳变诊断丢帧 |
| 数据类型 | 说出 RAW10 的打包方式与 Bayer 格式的含义，判断 sensor 是否需要 ISP |
| 虚拟通道 | 解释 VC 复用机制，诊断"双目只亮一目" |
| V4L2 流程 | 写出 ioctl 七步采集流程，说明 QBUF/DQBUF 的生产者-消费者模型 |
| 设备树 | 写出 sensor + 控制器的 endpoint 互指配置，说清 I2C/MIPI 双通道分工 |
| 调试验证 | 按六步流程逐段点亮一颗新 sensor，并对各阶段失败给出排查方向 |

## 配套资源

- MIPI CSI-2 Specification v3.0（MIPI Alliance）
- 内核 V4L2 文档：`Documentation/userspace-api/media/v4l/`
- OV5640 Datasheet（OmniVision）
- 工具：`v4l-utils`（v4l2-ctl、media-ctl）、`yavta`、`i2c-tools`、FFmpeg
- 信号测量参考：MIPI HS 差分幅度 200mVpp、CLK 频率 = lane 速率/2、lane 间 skew < 0.2 UI
