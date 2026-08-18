# B-C.7.3 USB Linux Host 驱动

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[E] | 预计阅读时间：45 分钟

## 本节导读

前两节讲了 USB 的物理层和枚举协议——那是"总线上发生了什么"。本节把视角抬到内核内部：设备插进开发板的 USB 口之后，Linux 的 USB 子系统是哪些模块、哪些数据结构在协作，最终让 `uvcvideo`、`usb-storage`、`cdc_acm` 这些驱动接管设备的。

这一层知识的价值在两个场景里最直接：一是你要为没有标准类驱动的 USB 设备写驱动（Vendor Specific 设备），必须会用 URB 与设备收发数据；二是设备工作不正常时，你要知道从控制器到驱动的整条链路上每一环在哪里、怎么看状态。

本节覆盖：USB 子系统的四大核心数据结构及其分层关系、xHCI/EHCI/OHCI 三代控制器驱动的分工、URB 的同步/异步用法与 DMA 缓冲区管理、热插拔到 udev 的完整事件链、设备树中 USB 控制器节点的配置要点，以及 UVC 摄像头 + EC20 4G 模块两个真实设备的完整点亮流程。

## USB 子系统的四大核心数据结构

Linux USB 子系统的结构与网络子系统高度对称：有总线、有设备、有驱动，还有负责底层收发的控制器。四个角色对应四个结构体：

```c
/* include/linux/usb.h — USB 子系统的四大核心结构 */
struct usb_hcd;       /* Host Controller Driver — 主机控制器驱动 */
struct usb_bus;       /* 逻辑总线，一条 USB 总线对应一个 bus */
struct usb_device;    /* 物理设备，每个插入的 USB 设备对应一个 */
struct usb_driver;    /* 设备驱动，按 interface 匹配的驱动 */
```

> HCD（Host Controller Driver）：主机控制器驱动。主机控制器是 SoC 里负责在 USB 线上收发信号的硬件模块，HCD 是它的驱动。它是整个 USB 子系统唯一碰硬件寄存器的部分，往上所有代码都只面对软件抽象。

四者的分层关系：

```
┌─────────────────────────────────────────────────────────────┐
│                    用户空间 (lsusb / 应用)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  uvcvideo    │  │  cdc-acm     │  │  usb-storage     │   │
│  │  (摄像头)     │  │  (4G模块)     │  │  (U盘)            │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────▼─────────┐   │
│  │usb_driver    │  │usb_driver    │  │usb_driver        │   │
│  │.id_table={   │  │.id_table={   │  │.id_table={       │   │
│  │ USB_DEVICE(  │  │ USB_DEVICE(  │  │ USB_INTERFACE(   │   │
│  │  0x046d,...) │  │  0x2c7c,...) │  │  0x0781,...)     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         └─────────────────┼────────────────────┘             │
│                           │ 按 id_table 匹配                  │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │               USB Core (usbcore)                       │   │
│  │  • 设备枚举（地址分配、描述符读取）                        │   │
│  │  • 驱动匹配与绑定                                        │   │
│  └────────────────────────┬──────────────────────────────┘   │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │               usb_bus（逻辑总线）                         │   │
│  └────────────────────────┬──────────────────────────────┘   │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │               usb_hcd（主机控制器驱动）                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐     │   │
│  │  │  xHCI    │  │   EHCI   │  │      OHCI        │     │   │
│  │  │USB 3.x   │  │USB 2.0   │  │   USB 1.1        │     │   │
│  │  └────┬─────┘  └────┬─────┘  └────────┬─────────┘     │   │
│  └───────┼─────────────┼─────────────────┼───────────────┘   │
│          └─────────────┼─────────────────┘                    │
│                        ▼                                      │
│              USB Host Controller 硬件                          │
│           （SoC 内置 / PCIe 扩展卡）                            │
└─────────────────────────────────────────────────────────────┘
```

**`usb_hcd`** 是最底层，每个主机控制器硬件对应一个实例，负责调度所有传输：DMA 映射、中断处理、端口状态监控。

**`usb_bus`** 是逻辑概念。每个 Hub（包括 Root Hub）产生一条 `usb_bus`，一条总线上最多分配 127 个设备地址。

> Root Hub（根集线器）：主机控制器驱动虚拟出来的一个"内置 Hub"。它没有实体芯片，但对外行为与真实 Hub 一致——控制器上的每个物理 USB 口都是 Root Hub 的一个端口。这样内核可以用同一套 Hub 驱动代码管理所有端口，不管端口是直连控制器还是经过外部 Hub。

**`usb_device`** 代表一个物理设备。注意匹配粒度：一个物理设备可以暴露多个 interface（4G 模块常同时有串口、网卡、诊断口），**每个 interface 独立绑定各自的 `usb_driver`**——这就是为什么"驱动绑在接口上而不是设备上"这一结论贯穿 USB 开发的方方面面。

**`usb_driver`** 就是你要写的驱动，通过 `id_table` 里的 VID/PID 或接口类别字段匹配设备，匹配成功后由 USB Core 调用 `probe()`。

> ⚠️ VID/PID 只是识别"谁家的什么产品"，真正决定驱动匹配的是 interface 级的 `bInterfaceClass/SubClass/Protocol`。一个 4G 模块的多个 interface 会分别绑定 `cdc_acm`、`cdc_ether`、`qmi_wwan` 等不同驱动——排查"驱动没加载"问题时，先看 `lsusb -v` 里的接口类别，而不是只看 VID/PID。

## 控制器驱动：xHCI / EHCI / OHCI

三代控制器对应三代 USB 标准：

| 控制器 | USB 标准 | 最高速率 | 驱动模块 | 典型平台 |
|--------|---------|---------|---------|---------|
| OHCI | USB 1.1 | 12 Mbit/s (Full Speed) | `ohci-hcd` | 老 ARM9 SoC、工控遗留设备 |
| EHCI | USB 2.0 | 480 Mbit/s (High Speed) | `ehci-hcd` | i.MX6、RK3288、全志 H3 |
| xHCI | USB 3.0/3.1/3.2 | 5/10/20 Gbit/s | `xhci-hcd` | RK3399、i.MX8、树莓派 4 及以后 |

**OHCI** 最老，只支持 Full/Low Speed，把大量调度工作交给硬件完成，软件干预少。新设计里基本不会遇到，维护十年前的工控板时才可能碰到。

**EHCI** 是 USB 2.0 时代的主力，只处理 High Speed 设备；总线上的 Full/Low Speed 设备要经"伴生控制器"（通常就是 OHCI）转发。EHCI 用异步和周期性两种调度列表，软件维护成本较高。

**xHCI** 是当前绝对主流，从设计上统一了 USB 2.0/3.x，不再需要伴生控制器。它基于 Transfer Ring 的调度模型，硬件能力更强、软件负担更轻。驱动代码在 `drivers/usb/host/xhci-*.c`，是 USB 子系统最活跃的代码区域之一。

xHCI 能通吃两代设备的原因在物理层：一个 USB 3.x 端口内部有**两组独立信号线**——SuperSpeed 差分对（SSTX/SSRX）和 USB 2.0 的 D+/D-（见 B-C.7.1）。插 USB 3.x 设备时两组线同时工作，插 USB 2.0 设备时只用 D+/D-，xHCI 控制器内部自动路由：

```
Root Hub（xHCI 虚拟）
│
├─ Port 1 ──→ USB 3.0 SSD      （SSTX/SSRX + D+/D- 同时工作）
├─ Port 2 ──→ UVC 摄像头        （只走 D+/D-，480M）
└─ Port 3 ──→ EC20 4G 模块      （只走 D+/D-，480M）
```

## URB：USB 世界的传输请求块

URB（USB Request Block）是 USB 子系统数据传输的基本单元，地位等同网络子系统的 `sk_buff`。任何一次 USB 传输——控制、批量、中断、等时——都封装为一个 URB，提交给 HCD 调度，完成后回调通知。

> sk_buff：Linux 网络子系统里描述一个网络数据包的核心结构体，从网卡驱动到协议栈层层传递的都是它。URB 之于 USB，就是 skb 之于网络。

核心 API：

| 函数 | 功能 | 同步/异步 |
|------|------|----------|
| `usb_alloc_urb()` | 分配 URB | — |
| `usb_fill_control_urb()` / `usb_fill_bulk_urb()` / `usb_fill_int_urb()` | 填充三类 URB | 异步准备 |
| `usb_submit_urb()` | 提交给 HCD，立即返回 | 异步 |
| `usb_control_msg()` / `usb_bulk_msg()` | 封装好的整次传输 | 同步（阻塞） |
| `usb_kill_urb()` | 取消 URB（同步等待完成） | — |
| `usb_free_urb()` | 释放 | — |

### 同步模式：适合初始化与配置

```c
/* 同步控制传输——读设备描述符前 8 字节 */
char buf[8];
int ret = usb_control_msg(
    dev,                          /* struct usb_device * */
    usb_rcvctrlpipe(dev, 0),      /* 控制读管道，端点 0 */
    USB_REQ_GET_DESCRIPTOR,       /* bRequest = 0x06 */
    USB_DIR_IN | USB_TYPE_STANDARD | USB_RECIP_DEVICE,
    USB_DT_DEVICE << 8,           /* wValue = 0x0100 */
    0,                            /* wIndex */
    buf, 8,                       /* 缓冲区与 wLength */
    5000                          /* 超时 ms */
);
/* 返回实际接收字节数，< 0 为错误码 */
```

### 异步模式：数据流的唯一选择

```c
/* 异步批量传输——以视频数据读取为例 */
struct urb *urb;
void *buf;
dma_addr_t dma;

/* 1. 分配 URB 和一致性 DMA 缓冲区 */
urb = usb_alloc_urb(0, GFP_KERNEL);
buf = usb_alloc_coherent(dev, size, GFP_KERNEL, &dma);

/* 2. 填充 URB */
usb_fill_bulk_urb(urb, dev,
    usb_rcvbulkpipe(dev, ep_addr),  /* 批量接收管道 */
    buf, size,                      /* DMA 缓冲区与长度 */
    my_callback,                    /* 完成回调 */
    my_context);                    /* 回调私有数据 */
urb->transfer_dma = dma;
urb->transfer_flags |= URB_NO_TRANSFER_DMA_MAP;  /* 我们自己管 DMA 映射 */

/* 3. 提交后立即返回，硬件传输完成后触发回调 */
usb_submit_urb(urb, GFP_KERNEL);

/* 4. 回调：处理数据并重新提交，形成持续数据流 */
static void my_callback(struct urb *urb)
{
    if (urb->status == 0) {
        /* urb->actual_length 为实际收到字节数，处理 buf 数据 */
    }
    usb_submit_urb(urb, GFP_ATOMIC);  /* 重新入队 */
}
```

两种模式的分工原则：枚举、配置阶段的零星控制传输用 `usb_control_msg()`，简单直接；数据流（视频、网络包、磁盘读写）必须用异步 URB——同步 API 会阻塞调用者直到传输完成，放在数据路径上整个系统都会被拖住。

> 🔴 URB 完成回调运行在中断上下文（或 tasklet），不能睡眠。回调里重新提交 URB 时内存分配标志必须用 `GFP_ATOMIC` 而不是 `GFP_KERNEL`；在回调里调用任何可能睡眠的函数（`kmalloc(GFP_KERNEL)`、`mutex_lock`、I2C/SPI 传输等）都会触发内核调度告警，严重时直接死锁。

## DMA 与缓存一致性

批量传输走 DMA，缓冲区管理有两套方案：

```c
/* 方案 A：一致性 DMA（简单安全，首选） */
void *buf = usb_alloc_coherent(dev, size, GFP_KERNEL, &dma);
/* 使用 buf... */
usb_free_coherent(dev, size, buf, dma);

/* 方案 B：流式 DMA（高性能，需手动维护缓存） */
void *buf = kmalloc(size, GFP_KERNEL);
dma_addr_t dma = dma_map_single(dev->bus->controller, buf, size, DMA_TO_DEVICE);
/* 提交 URB，传输完成后... */
dma_unmap_single(dev->bus->controller, dma, size, DMA_TO_DEVICE);
kfree(buf);
```

> 一致性 DMA（coherent/consistent DMA）：分配时就保证 CPU 和 DMA 控制器看到的是同一份数据的内存——通过将该页标记为不可缓存，或依赖硬件 snoop 实现。代价是 CPU 访问变慢（没有缓存加速）。
>
> 流式 DMA（streaming DMA）：普通内存临时映射给 DMA 使用。`dma_map_single` 时把 CPU 缓存里的脏数据回写到内存（clean），`dma_unmap_single` 时作废对应缓存行（invalidate），防止 CPU 之后读到旧数据。缓存操作有开销，但 CPU 平时访问这块内存是走缓存的，适合大块、高频的传输。

绝大多数 USB 设备驱动用方案 A 就够了。只有 USB 3.0 SSD、高清视频采集这类对带宽极度敏感的场景，才值得上流式 DMA 做优化。

## 热插拔：从引脚电平到设备节点的完整链条

设备插入后，内核到用户空间的完整事件链：

```
设备插入，D+/D- 电平变化
    │
    ▼
xHCI 产生 Port Status Change Event，中断触发
    │
    ▼
hub_irq() → hub_port_connect_change() → usb_new_device()
    │
    ▼
usb_enumerate_device()：执行 B-C.7.2 的枚举 8 步
    │
    ▼
device_add() → kobject_uevent("add") → 通知 udevd
    │
    ▼
usb_match_id() 遍历各 usb_driver 的 id_table
    │
    ▼
匹配成功 → 驱动 probe() 被调用
    │
    ▼
probe() 注册上层设备：/dev/video0、/dev/ttyUSB0、/dev/sda ...
    │
    ▼
udevd 按 /lib/udev/rules.d/ 规则收尾：
    • 设权限（MODE="0666"）
    • 建符号链接（/dev/ec20-at → ttyUSB0）
    • 触发脚本（起网络服务、跑初始化）
```

> udev：Linux 的用户空间设备管理器。内核检测到设备插拔后发出 uevent 事件，udevd 收到事件后按规则文件匹配，执行建节点、设权限、建软链接、跑脚本等动作。设备节点的"最后一公里"（权限对不对、名字稳不稳定）都是 udev 管的。

一条典型的 EC20 udev 规则：

```bash
# /etc/udev/rules.d/50-ec20.rules
# CDC-ACM 虚拟串口（AT 指令口）——固定名字 + 放开权限
SUBSYSTEM=="tty", ATTRS{idVendor}=="2c7c", ATTRS{idProduct}=="0125", \
    ATTRS{bInterfaceNumber}=="02", SYMLINK+="ec20-at", MODE="0666"

# QMI/WWAN 接口——插入时自动跑初始化脚本
SUBSYSTEM=="usb", ATTRS{idVendor}=="2c7c", ATTRS{idProduct}=="0125", \
    ATTR{bInterfaceNumber}=="00", RUN+="/usr/sbin/ec20-qmi-setup.sh"
```

udev 规则的价值在于**设备命名的稳定性**：ttyUSB0/1/2 的编号按枚举顺序分配，插拔顺序一变编号就乱；用 `SYMLINK+="ec20-at"` 给接口 2 固定一个名字，应用程序永远打开 `/dev/ec20-at` 就不会错。

## 设备树中的 USB 控制器节点

以 RK3399 为例，USB 控制器的设备树描述涉及两个角色：xHCI 控制器本体和 USB PHY：

```dts
// arch/arm64/boot/dts/rockchip/rk3399.dtsi（简化）

/* USB 3.0 xHCI 控制器节点 */
usb@fe800000 {
    compatible = "generic-xhci";
    reg = <0x0 0xfe800000 0x0 0x100000>;      /* 寄存器基址，1MB */
    interrupts = <GIC_SPI 105 IRQ_TYPE_LEVEL_HIGH>;

    clocks = <&cru SCLK_USB3OTG0_REF>,
             <&cru SCLK_USB3OTG0_SUSPEND>,
             <&cru ACLK_USB3OTG0>;
    clock-names = "ref_clk", "suspend_clk", "bus_clk";
    resets = <&cru SRST_USB3_OTG0>;
    reset-names = "usb3-otg";

    /* PHY 引用：xHCI 经此找到 USB2 和 USB3 PHY */
    phys = <&u2phy0_otg>, <&tcphy0_usb3>;
    phy-names = "usb2-phy", "usb3-phy";

    /* extcon 检测 ID 脚和 VBUS，决定 Host/Device 模式 */
    extcon = <&u2phy0>;

    power-domains = <&power RK3399_PD_USB3>;
    dma-coherent;

    status = "okay";
};

/* USB 2.0 OTG PHY */
u2phy0: usb2-phy@e450 {
    compatible = "rockchip,rk3399-u2phy";
    reg = <0xe450 0x10>;
    #phy-cells = <0>;

    u2phy0_otg: otg-port {
        #phy-cells = <0>;
        status = "okay";
    };
    u2phy0_host: host-port {
        #phy-cells = <0>;
        status = "okay";
    };
};

/* USB 3.0 Type-C PHY（SuperSpeed 信号） */
tcphy0: usb3-phy@ff7c0000 {
    compatible = "rockchip,rk3399-typec-phy";
    reg = <0x0 0xff7c0000 0x0 0x40000>;
    #phy-cells = <0>;

    tcphy0_usb3: usb3-port {
        #phy-cells = <0>;
        status = "okay";
    };
};
```

关键属性：

| 属性 | 含义 | 配置错误的后果 |
|------|------|---------------|
| `compatible = "generic-xhci"` | 用内核通用 xHCI 驱动 | 控制器完全不加载 |
| `phys` / `phy-names` | 引用 PHY 节点 | 控制器能 probe，但检测不到任何设备插入 |
| `extcon` | 外部连接器检测（OTG 模式切换） | Host/Device 角色不切换 |
| `dma-coherent` | 声明 DMA 一致性 | ARM64 上 DMA 数据错乱 |
| `power-domains` | 电源域 | 挂起恢复后控制器失效 |

> ⚠️ USB 子系统 bring-up 最常见的现象是"xHCI 驱动加载成功、没有任何报错，但插设备毫无反应"。此时按顺序查：PHY 节点的 `status` 是否 `okay` → 时钟是否使能（`/sys/kernel/debug/clk/clk_summary`）→ 复位是否释放 → VBUS 供电是否打开（很多板子的 VBUS 由 GPIO 或稳压器控制，设备树里要写 `vbus-supply`）。`dmesg | grep -i xhci` 里出现 `failed to initialize PHY` 或 `-ENODEV` 时直接锁定 PHY 配置。

## 实战一：UVC 摄像头（Host 端现成驱动）

场景：RK3399 开发板接罗技 C920 摄像头做视频采集。UVC（USB Video Class）是标准设备类，内核 `uvcvideo` 驱动直接接管，你要做的是验证链路并用 V4L2 API 取图。

> V4L2（Video4Linux2）：Linux 的视频设备统一接口。所有摄像头——不管走 USB、MIPI CSI 还是并行口——驱动都向上注册为 `/dev/videoN`，应用用同一套 ioctl API 设置格式、申请缓冲区、取帧。本节用的是它的用户态这一半，框架原理在第 9 篇 MIPI CSI-2 里展开。

### 确认设备识别与驱动绑定

```bash
lsusb
```

```
Bus 001 Device 003: ID 046d:082d Logitech, Inc. HD Pro Webcam C920
```

```bash
# 确认 UVC 接口类别
lsusb -v -d 046d:082d | grep -A3 bInterfaceClass
```

```
    bInterfaceClass       14 Video
    bInterfaceSubClass    1 Video Control
    bInterfaceClass       14 Video
    bInterfaceSubClass    2 Video Streaming
```

```bash
dmesg | grep -i uvc
```

```
[   12.345678] uvcvideo: Found UVC 1.00 device HD Pro Webcam C920 (046d:082d)
[   12.389012] input: HD Pro Webcam C920 as /devices/.../input/input2
```

```bash
ls -l /dev/video*
```

```
crw-rw---- 1 root video 81, 0 /dev/video0
```

### 命令行抓帧验证

```bash
# 查看支持的格式与分辨率
v4l2-ctl -d /dev/video0 --list-formats-ext
```

```
    [0]: 'MJPG' (Motion-JPEG, compressed)
        Size: Discrete 1920x1080
        Interval: Discrete 0.033s (30.000 fps)
    [1]: 'YUYV' (YUYV 4:2:2)
        Size: Discrete 640x480
```

```bash
# 设 1080p MJPEG，抓一帧存文件
v4l2-ctl -d /dev/video0 --set-fmt-video=width=1920,height=1080,pixelformat=MJPG
v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=1 --stream-to=/tmp/capture.jpg
```

### C 代码：V4L2 取帧的最小完整流程

V4L2 取帧固定七步：打开 → 设格式 → 申请缓冲区 → mmap 映射并入队 → 开流 → 出队取帧 → 关流清理。这个骨架对 USB 摄像头和 MIPI 摄像头通用：

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <linux/videodev2.h>

struct buffer { void *start; size_t length; };

int main(void)
{
    int fd = open("/dev/video0", O_RDWR | O_NONBLOCK, 0);
    if (fd < 0) { perror("open"); return 1; }

    /* 1. 设置格式：1920x1080 MJPEG */
    struct v4l2_format fmt = {0};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = 1920;
    fmt.fmt.pix.height = 1080;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_MJPEG;
    fmt.fmt.pix.field = V4L2_FIELD_ANY;
    ioctl(fd, VIDIOC_S_FMT, &fmt);

    /* 2. 向驱动申请 4 个缓冲区 */
    struct v4l2_requestbuffers req = {0};
    req.count = 4;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    ioctl(fd, VIDIOC_REQBUFS, &req);

    /* 3. mmap 映射到用户态，并入队交给驱动填充 */
    struct buffer buffers[4];
    for (int i = 0; i < req.count; i++) {
        struct v4l2_buffer buf = {0};
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = i;
        ioctl(fd, VIDIOC_QUERYBUF, &buf);
        buffers[i].length = buf.length;
        buffers[i].start = mmap(NULL, buf.length,
                                PROT_READ | PROT_WRITE, MAP_SHARED,
                                fd, buf.m.offset);
        ioctl(fd, VIDIOC_QBUF, &buf);
    }

    /* 4. 开流 */
    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ioctl(fd, VIDIOC_STREAMON, &type);

    /* 5. 出队取一帧（缓冲区在队列里循环：驱动填满一个，应用取走一个） */
    struct v4l2_buffer buf = {0};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    ioctl(fd, VIDIOC_DQBUF, &buf);

    FILE *fp = fopen("/tmp/capture.jpg", "wb");
    fwrite(buffers[buf.index].start, buf.bytesused, 1, fp);
    fclose(fp);
    printf("Captured %u bytes\n", buf.bytesused);

    /* 6. 关流清理 */
    ioctl(fd, VIDIOC_STREAMOFF, &type);
    for (int i = 0; i < req.count; i++)
        munmap(buffers[i].start, buffers[i].length);
    close(fd);
    return 0;
}
```

缓冲区队列是 V4L2 的核心机制：申请的一组缓冲区在"驱动队列"和"应用手里"之间循环——`QBUF` 把空缓冲区交给驱动填数据，`DQBUF` 把填满的缓冲区取回来，处理完再 `QBUF` 回去。零拷贝、无停顿的连续采集就靠这个循环。

## 实战二：EC20 4G 模块（多接口复合设备）

EC20 通过 USB 枚举为一个复合设备，多个 interface 分别绑定不同驱动：CDC-ACM 接口生成 `/dev/ttyUSB0` 等串口（走 AT 指令），QMI 接口绑定 `qmi_wwan` 生成网卡（走数据业务）。

### 确认识别与拓扑

```bash
lsusb
```

```
Bus 001 Device 005: ID 2c7c:0125 Quectel Wireless Solutions Co., Ltd. EC25 LTE modem
```

```bash
lsusb -t
```

```
/:  Bus 01.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/6p, 480M
    |__ Port 2: Dev 2, If 0, Class=Hub, Driver=hub/4p, 480M
        |__ Port 1: Dev 5, If 0, Class=Communications, Driver=cdc_acm, 480M
        |__ Port 1: Dev 5, If 1, Class=CDC Data, Driver=cdc_acm, 480M
        |__ Port 1: Dev 5, If 2, Class=Communications, Driver=cdc_acm, 480M
        |__ Port 1: Dev 5, If 3, Class=CDC Data, Driver=cdc_acm, 480M
```

注意 `lsusb -t` 里同一个 Dev 5 下面并列了 If 0~3 四个接口、各自绑着驱动——这就是"驱动绑在接口上"在真实设备上的样子。

```bash
ls -l /dev/ttyUSB* /dev/ec20-at
```

```
crw-rw---- 1 root dialout 188, 0 /dev/ttyUSB0
lrwxrwxrwx 1 root root          7 /dev/ec20-at -> ttyUSB0
```

### AT 指令连通性测试

```bash
minicom -D /dev/ttyUSB0 -b 115200
```

```
AT                  → OK                        （握手）
AT+CGMM             → EC25                      （型号）
AT+CSQ              → +CSQ: 28,99               （信号 0~31，28 良好）
AT+CREG?            → +CREG: 0,1                （1 = 已注册网络）
AT+CGDCONT=1,"IP","cmnet"                       （设 APN，示例为移动）
AT+QIACT=1          → OK                        （激活 PDP 上下文）
```

> APN（Access Point Name）：运营商数据网络的接入点名称，告诉模块连哪个数据网络、用什么鉴权。国内常见值：移动 `cmnet`、联通 `3gnet`、电信 `ctnet`。APN 配错是最常见的"模块有信号但上不了网"的原因。

### C 代码：AT 指令的收发封装

AT 交互的本质是"发一行命令、等一个期望字符串"。封装一个带超时的 `at_cmd()`，后续所有业务都建立在它上面：

```c
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>

/* 发 AT 指令，等待期望响应，返回 0 成功 */
int at_cmd(int fd, const char *cmd, const char *expect,
           char *resp, size_t resp_len, int timeout_ms)
{
    char buf[512];
    tcflush(fd, TCIOFLUSH);
    snprintf(buf, sizeof(buf), "%s\r\n", cmd);
    write(fd, buf, strlen(buf));

    memset(resp, 0, resp_len);
    int total = 0, elapsed = 0;
    while (elapsed < timeout_ms) {
        int n = read(fd, resp + total, resp_len - total - 1);
        if (n > 0) {
            total += n;
            resp[total] = '\0';
            if (strstr(resp, expect)) return 0;
        }
        usleep(100000);   /* 100ms 轮询 */
        elapsed += 100;
    }
    return -1;
}

int main(void)
{
    int fd = open("/dev/ttyUSB0", O_RDWR | O_NOCTTY);
    if (fd < 0) { perror("open"); return 1; }

    struct termios tty = {0};
    cfsetospeed(&tty, B115200);
    cfsetispeed(&tty, B115200);
    tty.c_cflag |= CS8 | CREAD | CLOCAL;
    tcsetattr(fd, TCSANOW, &tty);

    char resp[512];
    if (at_cmd(fd, "AT", "OK", resp, sizeof(resp), 2000) != 0) {
        fprintf(stderr, "Modem not responding\n");
        close(fd);
        return 1;
    }
    at_cmd(fd, "AT+CSQ", "+CSQ:", resp, sizeof(resp), 3000);
    printf("Signal: %s", resp);

    close(fd);
    return 0;
}
```

### 供电：这个环节翻过的车最多

EC20 在搜网瞬间的电流可达 1.5A 以上，远超 USB 2.0 标准端口的 500mA 供电能力。从开发板 USB 口直接取电的典型症状是：模块枚举成功、AT 能通，一开始拨号就掉线重枚举——dmesg 里反复出现 `USB disconnect` / `new high-speed USB device`。这类"软件查不出毛病"的问题，根子在电源。

工程做法：4G 模块独立供电（专用 5V/2A 电源），USB 只走信号线；或者经过带外接电源的 USB Hub 转接。整个 USB 设备排障里，**供电问题要和软件问题放在同一优先级排查**。

### 验证清单

| 步骤 | 命令 | 期望结果 | 不满足时查什么 |
|------|------|---------|---------------|
| 设备上电枚举 | `lsusb` | 看到 2c7c:0125 | 供电、线缆、模块电源时序 |
| 驱动绑定 | `lsusb -t` | cdc_acm / qmi_wwan | `lsusb -v` 看接口类别，内核配置 |
| 设备节点 | `ls /dev/ttyUSB*` | 节点存在 | udev 规则、驱动注册 |
| 摄像头取帧 | `v4l2-ctl --stream-to` | 生成 jpg | 分辨率/带宽，换 MJPG 降负载 |
| 模块信号 | `AT+CSQ` | 首位 > 10 | 天线、SIM 卡 |
| 网络注册 | `AT+CREG?` | `0,1` | APN、SIM 欠费、制式覆盖 |

## 调试命令速查

```bash
# USB 拓扑树：总线/端口/设备/接口/驱动/速率一目了然
lsusb -t

# 完整描述符：排查兼容性时与 datasheet 逐项对比
lsusb -v -d 046d:082d

# 内核日志（-w 实时跟踪，插拔设备时看全过程）
dmesg -w | grep -i usb

# udev 事件监控：看热插拔触发了哪些事件和属性
udevadm monitor --property --subsystem-match=usb --subsystem-match=tty

# sysfs 视角：已注册驱动与设备
ls /sys/bus/usb/drivers/
ls /sys/bus/usb/devices/
cat /sys/kernel/debug/usb/devices

# xHCI 寄存器与 ring 状态（需 root + debugfs）
cat /sys/kernel/debug/usb/xhci/*
```

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 子系统结构 | 画出 `usb_hcd → usb_bus → usb_device → usb_driver` 四层关系，说清每层职责 |
| 匹配粒度 | 解释"驱动绑接口不绑设备"，并用 `lsusb -t` 输出指出一个复合设备的各接口绑定情况 |
| URB 使用 | 写出一个异步批量传输的完整代码骨架（分配/填充/提交/回调重提交），说明回调里为什么必须 `GFP_ATOMIC` |
| DMA 方案 | 说出一致性 DMA 与流式 DMA 的区别和各自的适用场景 |
| 热插拔链路 | 从电平变化开始，按顺序说出到设备节点生成的每一环 |
| 设备树 | 检查一个 USB 控制器节点的 PHY/时钟/复位/VBUS 配置，定位"插设备无反应" |
| 实战验证 | 用 `v4l2-ctl` 从 UVC 摄像头抓一帧图；用 AT 指令确认 4G 模块的信号与注册状态 |

## 配套资源

- 内核文档：`Documentation/driver-api/usb.rst`（USB 驱动 API 参考）
- 规范原文：usb.org 的 USB 3.2 Specification 与 xHCI Specification
- EC20 AT 指令手册：《Quectel_EC2x&EG9x&EM05_TCP(IP)_AT_Commands_Manual》
- 《Linux Device Drivers》第 3 版第 13 章：USB Drivers
- 调试工具包：`lsusb`（usbutils）、`v4l2-ctl`（v4l-utils）、`minicom`、`udevadm`
