# B-C.7.3 USB Linux Host驱动

> 所属章节：第五部 B. 总线协议 > B-C.7 USB总线
>
> 难度：[E] Expert | 预计阅读时间：45分钟

## <span class="blue"> 本节导读

前两节我们搞懂了USB的电气特性和协议栈——从OTG的ID线判别到CDC/MSC/HID这些类设备的描述符结构。这一节我们把视角切到**Linux内核的USB Host端**：当你把一个U盘插到开发板上，或者接上USB摄像头、4G模块时，内核到底发生了什么？

你将看到四个核心数据结构如何撑起整个USB子系统，理解xHCI/EHCI/OHCI三代控制器驱动的分工，掌握URB这个"USB世界的skb"的用法，最后通过UVC摄像头+移远EC20 4G模块的实战，把Host驱动的整条链路跑通。

<br>

---

## <span class="blue"> USB子系统的四大核心数据结构 [E]

Linux USB子系统的架构可以类比网络子系统：有总线、有设备、有驱动，还有负责底层收发的"控制器"。这四个角色对应四根顶梁柱：

```c
/* include/linux/usb.h — USB子系统的四大核心结构 */
struct usb_hcd;       /* Host Controller Driver — 主机控制器驱动 */
struct usb_bus;       /* 逻辑总线，一条USB总线对应一个bus */
struct usb_device;    /* 物理设备，每个插入的USB设备对应一个 */
struct usb_driver;    /* 设备驱动，匹配特定interface的驱动 */
```

它们的关系可以用这张图来理解：

```
┌─────────────────────────────────────────────────────────────┐
│                    用户空间 (lsusb / devfs)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  uvcvideo    │  │  cdc-acm     │  │  usb-storage     │   │
│  │  (摄像头)     │  │  (4G模块)     │  │  (U盘)            │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                    │             │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────▼─────────┐   │
│  │usb_driver    │  │usb_driver    │  │usb_driver        │   │
│  │.id_table={   │  │.id_table={   │  │.id_table={       │   │
│  │ USB_DEVICE(  │  │ USB_DEVICE(  │  │ USB_INTERFACE(   │   │
│  │  0x046d,...) │  │  0x2c7c,...) │  │  0x0781,...)     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         └─────────────────┼────────────────────┘             │
│                           │ match (vendor_id / product_id)   │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │               USB Core (usbcore.ko)                    │   │
│  │  • 设备枚举 (Address Assignment)                        │   │
│  │  • 配置解析 (Descriptor Parsing)                        │   │
│  │  • 驱动匹配 (Driver Binding)                           │   │
│  └────────────────────────┬──────────────────────────────┘   │
│                           │                                   │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │               usb_bus (逻辑总线)                        │   │
│  │  bus->controller = &usb_hcd->self                      │   │
│  └────────────────────────┬──────────────────────────────┘   │
│                           │                                   │
│  ┌────────────────────────▼──────────────────────────────┐   │
│  │               usb_hcd (Host Controller Driver)          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐     │   │
│  │  │  xHCI    │  │   EHCI   │  │      OHCI        │     │   │
│  │  │USB 3.0/  │  │USB 2.0   │  │   USB 1.1        │     │   │
│  │  │  3.1     │  │  高速    │  │   全速/低速       │     │   │
│  │  └────┬─────┘  └────┬─────┘  └────────┬─────────┘     │   │
│  └───────┼─────────────┼─────────────────┼───────────────┘   │
│          └─────────────┼─────────────────┘                     │
│                        ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              USB Host Controller 硬件                     │   │
│  │         (SoC内置 / PCI扩展卡 / 外置Hub)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**`usb_hcd`** 是最底层的结构，每个USB主机控制器对应一个`usb_hcd`实例。它负责调度所有USB传输——DMA映射、中断处理、端口状态监控都由它或直接由硬件完成。xHCI/EHCI/OHCI各自有自己的`hcd_driver`操作集。

**`usb_bus`** 是逻辑概念。每插入一个USB Hub（包括Root Hub），内核就创建一条新的`usb_bus`。一条总线上最多127个设备地址（0是默认地址，1~127可分配）。

**`usb_device`** 代表一个物理USB设备。注意：一个物理设备可能有多个`usb_interface`（比如4G模块同时有CDC-ACM串口、ECM网卡、NCM网卡），每个interface可以绑定不同的`usb_driver`。

**`usb_driver`** 就是你写的USB设备驱动。它通过`id_table`里的`vendor_id`和`product_id`（或`device_class`/`interface_class`）来匹配设备。匹配成功后，USB Core会调用你的`probe()`函数。

> ⚠️ **陷阱**：USB设备的`vendor_id`和`product_id`只是识别 device's vendor，真正决定驱动匹配的是`interface`级别的`bInterfaceClass`/`bInterfaceSubClass`/`bInterfaceProtocol`。一个4G模块可能暴露多个interface，分别匹配`cdc_acm`、`cdc_ether`、`qmi_wwan`等不同驱动。

<br>

---

## <span class="blue"> USB控制器驱动：xHCI / EHCI / OHCI [E]

Linux内核中，USB控制器驱动经历了三代演进，分别对应USB 1.1/2.0/3.x标准：

| 控制器 | USB标准 | 最高速率 | Linux驱动模块 | 典型SoC/芯片 |
|--------|---------|----------|---------------|-------------|
| **OHCI** | USB 1.1 | 12 Mbps (Full Speed) | `ohci-hcd` | 老旧ARM9 SoC、LPC系列 |
| **EHCI** | USB 2.0 | 480 Mbps (High Speed) | `ehci-hcd` | i.MX6、RK3288、全志H3 |
| **xHCI** | USB 3.0/3.1 | 5/10 Gbps (Super/Super+Speed) | `xhci-hcd` | RK3399、i.MX8、树莓派4 |

**OHCI（Open Host Controller Interface）** 是最老的一代。它把很多调度工作交给硬件，软件干预较少。在现在的嵌入式开发中已经基本被淘汰，但如果你维护 legacy 设备（比如十年前的工控板），可能还会遇到。OHCI只支持Full Speed和Low Speed。

**EHCI（Enhanced Host Controller Interface）** 是USB 2.0时代的主力。EHCI只处理High Speed设备，如果总线上接了Full/Low Speed设备，会通过"Companion Controller"（伴生控制器，通常就是OHCI）来转发。EHCI使用异步和周期性两种调度列表，软件需要维护这些链表。

**xHCI（eXtensible Host Controller Interface）** 是现在绝对的主流。xHCI从设计上就统一了USB 2.0/3.0/3.1，不再需要Companion Controller。它采用基于"Transfer Ring"的调度模型，硬件能力更强，软件负担更轻。xHCI的驱动代码在`drivers/usb/host/xhci-*.c`中，是USB子系统里最活跃的代码区域之一。

```
┌────────────────────────────────────────────────────────────┐
│                    Root Hub (虚拟Hub)                        │
│                       usb_bus #1                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Port 1      │  │  Port 2      │  │  Port 3          │  │
│  │  USB 3.0     │  │  USB 2.0     │  │  USB 2.0         │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                  │                    │            │
│    ┌────▼────┐        ┌────▼────┐         ┌────▼────┐       │
│    │ USB3    │        │ USB2    │         │ USB2    │       │
│    │ SSD     │        │ UVC     │         │ EC20    │       │
│    │ (xHCI)  │        │ Cam     │         │ 4G      │       │
│    └─────────┘        └─────────┘         └─────────┘       │
│                                                             │
│  xHCI控制器内部会自动路由：                                    │
│  • SuperSpeed信号 → xHCI SS路径 (USB3.0差分对)                │
│  • HighSpeed信号  → xHCI HS路径 (USB2.0差分对)                │
└────────────────────────────────────────────────────────────┘
```

> 💡 **提示**：在xHCI控制器上，一个物理端口实际上有两组信号线：USB 3.0的SuperSpeed差分对（SSTX+/SSTX-, SSRX+/SSRX-）和USB 2.0的D+/D-。插入USB 3.0设备时两组线都用；插入USB 2.0设备时只用D+/D-。这就是为什么xHCI能同时兼容两代设备而不需要Companion Controller。

<br>

---

## <span class="blue"> URB：USB Request Block [E]

URB是USB子系统中数据传输的基本单元，地位等同于网络子系统中的`skb`。每个USB传输——不管是控制传输、批量传输、中断传输还是等时传输——都封装在一个URB里。

### URB核心API一览

| 函数 | 功能 | 传输类型 | 同步/异步 |
|------|------|----------|-----------|
| `usb_alloc_urb()` | 分配URB内存 | 任意 | — |
| `usb_fill_control_urb()` | 填充控制传输URB | 控制(Control) | 异步准备 |
| `usb_fill_bulk_urb()` | 填充批量传输URB | 批量(Bulk) | 异步准备 |
| `usb_fill_int_urb()` | 填充中断传输URB | 中断(Interrupt) | 异步准备 |
| `usb_submit_urb()` | 提交URB到HCD调度 | 任意 | **异步** |
| `usb_bulk_msg()` | 同步批量传输 | 批量(Bulk) | **同步** |
| `usb_control_msg()` | 同步控制传输 | 控制(Control) | **同步** |
| `usb_kill_urb()` | 取消URB（同步等待） | 任意 | — |
| `usb_free_urb()` | 释放URB | 任意 | — |

### URB使用模式

**同步模式**（简单但会阻塞，适合初始化/配置阶段）：

```c
/* 同步控制传输 — 读取设备描述符（8字节） */
int ret;
char buf[8];
ret = usb_control_msg(
    dev,                    /* struct usb_device *dev */
    usb_rcvctrlpipe(dev, 0), /* 控制读管道，端点0 */
    USB_REQ_GET_DESCRIPTOR,  /* bRequest = 0x06 */
    USB_DIR_IN | USB_TYPE_STANDARD | USB_RECIP_DEVICE,
    USB_DT_DEVICE << 8,      /* wValue = 0x0100 (Device Descriptor) */
    0,                       /* wIndex = 0 */
    buf,                     /* 接收缓冲区 */
    8,                       /* wLength */
    5000                     /* 超时5秒 (ms) */
);
/* 返回实际接收字节数，<0 表示错误 */
```

**异步模式**（非阻塞，适合数据流阶段）：

```c
/* 异步批量传输 — UVC摄像头视频数据读取 */
struct urb *urb;
void *buf;
dma_addr_t dma;

/* 1. 分配URB和DMA缓冲区 */
urb = usb_alloc_urb(0, GFP_KERNEL);
buf = usb_alloc_coherent(dev, size, GFP_KERNEL, &dma);

/* 2. 填充URB */
usb_fill_bulk_urb(
    urb,                    /* URB */
    dev,                    /* usb_device */
    usb_rcvbulkpipe(dev, ep_addr), /* 批量接收管道 */
    buf,                    /* DMA缓冲区 */
    size,                   /* 传输长度 */
    my_callback,            /* 完成回调函数 */
    my_context              /* 传给回调的私有数据 */
);
urb->transfer_dma = dma;    /* 告诉HCD用DMA */
urb->transfer_flags |= URB_NO_TRANSFER_DMA_MAP;

/* 3. 提交URB — 立即返回，传输完成后回调被触发 */
usb_submit_urb(urb, GFP_KERNEL);

/* 4. 回调函数 */
static void my_callback(struct urb *urb)
{
    if (urb->status == 0) {
        /* urb->actual_length 是实际收到的字节数 */
        /* 处理 buf 中的数据... */
    }
    /* 如果需要持续读取，重新提交 */
    usb_submit_urb(urb, GFP_ATOMIC);
}
```

**两种模式的选择原则**：控制传输（枚举、配置）通常用`usb_control_msg()`因为它简单；数据流（摄像头视频、4G数据、U盘读写）必须用异步URB，否则你的进程/中断上下文会被阻塞，整个系统卡顿。

> 🔴 **危险**：在回调函数`my_callback`里重新提交URB时，必须用`GFP_ATOMIC`而不是`GFP_KERNEL`——因为回调运行在中断上下文（或tasklet），不能睡眠。

<br>

---

## <span class="blue"> DMA传输与缓存一致性 [E]

USB 2.0及以上控制器的批量传输通常走DMA。前面代码里`usb_alloc_coherent()`分配的是一致性DMA内存（Consistent DMA），CPU和控制器看到的内存内容始终保持一致，不需要手动刷缓存。

```c
/* DMA缓冲区管理的两种方案 */

/* 方案A：一致性DMA（推荐，简单安全） */
void *buf = usb_alloc_coherent(dev, size, GFP_KERNEL, &dma);
/* 使用buf... */
usb_free_coherent(dev, size, buf, dma);

/* 方案B：流式DMA（高性能，但需要手动sync） */
void *buf = kmalloc(size, GFP_KERNEL);
dma_addr_t dma = dma_map_single(dev->bus->controller, buf, size, DMA_TO_DEVICE);
/* 提交URB，传输完成后... */
dma_unmap_single(dev->bus->controller, dma, size, DMA_TO_DEVICE);
kfree(buf);
```

在ARM SoC上，一致性DMA通过关闭该页的高速缓存（non-cacheable）或硬件snoop来实现。流式DMA则需要在`dma_map_single`时做clean cache（数据回写到内存），在`dma_unmap_single`时做invalidate cache（丢弃缓存行）。

> 💡 **提示**：大多数USB设备驱动直接用`usb_alloc_coherent()`就够了。只有在性能极其敏感的场景（比如USB 3.0 SSD、高清视频采集），才需要考虑流式DMA的优化。

<br>

---

## <span class="blue"> 热插拔与udev处理 [E]

USB是热插拔总线。当你插入一个设备时，这条调用链会被触发：

```
设备插入
    │
    ▼
USB控制器中断 → xHCI检测到Port Status Change Event
    │
    ▼
hub_irq() → hub_port_connect_change() → usb_new_device()
    │
    ▼
usb_enumerate_device():
    • 分配地址 (SET_ADDRESS)
    • 读取设备描述符 (GET_DESCRIPTOR)
    • 读取配置描述符
    • 选择配置 (SET_CONFIGURATION)
    │
    ▼
usb_bus_add_device() → kobject_uevent("add") → udevd
    │
    ▼
内核：usb_match_id() 遍历 usb_driver 的 id_table
    │
    ▼
匹配成功 → 驱动 probe() 被调用
    │
    ▼
驱动创建字符设备节点（/dev/video0、/dev/ttyUSB0等）
    │
    ▼
udevd：根据 /lib/udev/rules.d/ 中的规则
    • 设置权限（chmod 666 /dev/ttyUSB0）
    • 创建符号链接（/dev/4g-modem → /dev/ttyUSB0）
    • 触发用户空间脚本（ifup wwan0、systemd服务等）
```

一个典型的udev规则文件（针对移远EC20）：

```bash
# /etc/udev/rules.d/50-ec20.rules
# 移远EC20 4G模块 — 创建友好符号链接+设置权限

# CDC-ACM虚拟串口（AT指令口）
SUBSYSTEM=="tty", ATTRS{idVendor}=="2c7c", ATTRS{idProduct}=="0125", \
    ATTRS{bInterfaceNumber}=="02", SYMLINK+="ec20-at", MODE="0666"

# CDC-ACM虚拟串口（Modem口）
SUBSYSTEM=="tty", ATTRS{idVendor}=="2c7c", ATTRS{idProduct}=="0125", \
    ATTRS{bInterfaceNumber}=="03", SYMLINK+="ec20-modem", MODE="0666"

# QMI/WWAN接口
SUBSYSTEM=="usb", ATTRS{idVendor}=="2c7c", ATTRS{idProduct}=="0125", \
    ATTR{bInterfaceNumber}=="00", RUN+="/usr/sbin/ec20-qmi-setup.sh"
```

<br>

---

## <span class="blue"> 设备树USB控制器配置 [E]

以Rockchip RK3399（树莓派4同款xHCI）为例，USB控制器的设备树配置涉及两个节点：xHCI控制器本身 + USB PHY。

```dts
// arch/arm64/boot/dts/rockchip/rk3399.dtsi — 简化版

/* USB 3.0 xHCI控制器节点 */
usb@fe800000 {
    compatible = "generic-xhci";
    reg = <0x0 0xfe800000 0x0 0x100000>;   /* 寄存器基址1MB */
    interrupts = <GIC_SPI 105 IRQ_TYPE_LEVEL_HIGH>;
    
    /* 时钟和复位 */
    clocks = <&cru SCLK_USB3OTG0_REF>,
             <&cru SCLK_USB3OTG0_SUSPEND>,
             <&cru ACLK_USB3OTG0>;
    clock-names = "ref_clk", "suspend_clk", "bus_clk";
    resets = <&cru SRST_USB3_OTG0>;
    reset-names = "usb3-otg";
    
    /* 引用PHY — xHCI通过这个句柄找到USB3 PHY和USB2 PHY */
    phys = <&u2phy0_otg>, <&tcphy0_usb3>;
    phy-names = "usb2-phy", "usb3-phy";
    
    /* extcon用于检测ID脚和VBUS，决定Host/Device模式 */
    extcon = <&u2phy0>;
    
    /* 电源域 */
    power-domains = <&power RK3399_PD_USB3>;
    
    /* DMA配置 — xHCI需要64位DMA */
    dma-coherent;
    
    status = "okay";
};

/* USB2.0 OTG PHY — 同时提供Host和Device能力 */
u2phy0: usb2-phy@e450 {
    compatible = "rockchip,rk3399-u2phy";
    reg = <0xe450 0x10>;
    #phy-cells = <0>;
    
    /* PHY内部有两个端口 */
    u2phy0_otg: otg-port {
        #phy-cells = <0>;
        status = "okay";
    };
    u2phy0_host: host-port {
        #phy-cells = <0>;
        status = "okay";
    };
};

/* USB3.0 Type-C PHY — SuperSpeed信号 */
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

关键字段解读：

| 属性 | 含义 | 注意事项 |
|------|------|----------|
| `compatible = "generic-xhci"` | 使用内核通用xHCI驱动 | 大多数xHCI控制器都用这个 |
| `phys` / `phy-names` | 引用的PHY节点 | 必须同时提供usb2-phy和usb3-phy |
| `extcon` | 外部连接器检测 | OTG模式切换的关键 |
| `dma-coherent` | 声明DMA一致性 | 缺少会导致ARM64上DMA失败 |
| `power-domains` | 电源域 | 断电后需重新初始化 |

> ⚠️ **陷阱**：USB PHY的时钟和复位如果配置错误，xHCI控制器能加载但检测不到任何设备插入。排查时先看`dmesg | grep -i xhci`是否有`-ENODEV`或`failed to initialize PHY`。

<br>

---

## <span class="blue"> 行业实例：UVC摄像头 + 移远EC20 4G模块 [E]

### 场景描述

这是智能安防网关的典型配置：USB接口连接1080p摄像头做视频采集，同时通过4G模块把压缩后的视频流上传到云端。RK3399开发板作为Host，两个USB设备分别挂在Root Hub的不同端口上。

### 硬件接线

```
RK3399开发板 (USB Host)
│
├─[USB3.0 Port 1]──→ UVC摄像头（罗技C920，USB 2.0 High Speed）
│                       • 接口：USB-A
│                       • 供电：Bus Power（≤500mA）
│                       • 端点：ISO传输，最大384MB/s
│
└─[USB3.0 Port 2]──→ USB 3.0 Hub（带独立电源）──→ 移远EC20 4G模块
                                                   • 接口：Mini PCIe + USB转接板
                                                   • 供电：**需要独立5V/2A**
                                                   • 端点：BULK传输（数据）+ INT传输（信号）
```

> ⚠️ **陷阱**：USB供电不足是嵌入式项目中最隐蔽的故障源之一。EC20在4G搜索网络时瞬时电流可达1.5A，远超USB标准规定的500mA。如果直接从开发板USB口供电，会导致电压跌落、模块反复复位、甚至拖垮整个USB总线让摄像头也掉线。**必须外接带独立电源的USB Hub**。

### UVC摄像头端

```bash
# ===== 步骤1：确认摄像头被识别 =====
$ lsusb
Bus 001 Device 003: ID 046d:082d Logitech, Inc. HD Pro Webcam C920

# 查看完整描述符 — 确认UVC接口
$ lsusb -v -d 046d:082d | grep -A3 bInterfaceClass
    bInterfaceClass       14 Video
    bInterfaceSubClass    1 Video Control
    bInterfaceClass       14 Video
    bInterfaceSubClass    2 Video Streaming

# 查看内核是否加载了uvcvideo驱动
$ dmesg | grep -i uvc
[ 12.345678] uvcvideo: Found UVC 1.00 device HD Pro Webcam C920 (046d:082d)
[ 12.367890] uvcvideo 1-1:1.0: Entity type for entity Extension 4 was not initialized!
[ 12.389012] input: HD Pro Webcam C920 as /devices/.../input/input2

# 确认设备节点
$ ls -l /dev/video*
crw-rw---- 1 root video 81, 0 /dev/video0
```

```bash
# ===== 步骤2：用v4l2-ctl抓图 =====
# 查看支持的格式和分辨率
$ v4l2-ctl -d /dev/video0 --list-formats-ext
ioctl: VIDIOC_ENUM_FMT
    Type: Video Capture
    [0]: 'MJPG' (Motion-JPEG, compressed)
        Size: Discrete 1920x1080
        Interval: Discrete 0.033s (30.000 fps)
    [1]: 'YUYV' (YUYV 4:2:2)
        Size: Discrete 640x480
        Interval: Discrete 0.033s (30.000 fps)

# 设置格式并抓取一帧
$ v4l2-ctl -d /dev/video0 --set-fmt-video=width=1920,height=1080,pixelformat=MJPG
$ v4l2-ctl -d /dev/video0 --stream-mmap --stream-count=1 --stream-to=/tmp/capture.jpg
# 输出文件大小约50~200KB（MJPEG压缩）
```

```c
/* ===== C语言版本：用V4L2 API编程抓图 ===== */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <linux/videodev2.h>

struct buffer {
    void *start;
    size_t length;
};

int main(int argc, char **argv)
{
    int fd = open("/dev/video0", O_RDWR | O_NONBLOCK, 0);
    if (fd < 0) { perror("open"); return 1; }

    /* 1. 设置视频格式 — 1920x1080 MJPEG */
    struct v4l2_format fmt = {0};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = 1920;
    fmt.fmt.pix.height = 1080;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_MJPEG;
    fmt.fmt.pix.field = V4L2_FIELD_ANY;
    ioctl(fd, VIDIOC_S_FMT, &fmt);

    /* 2. 请求4个缓冲区 */
    struct v4l2_requestbuffers req = {0};
    req.count = 4;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    ioctl(fd, VIDIOC_REQBUFS, &req);

    /* 3. MMAP映射缓冲区 */
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
        ioctl(fd, VIDIOC_QBUF, &buf);  /* 入队 */
    }

    /* 4. 开始采集 */
    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ioctl(fd, VIDIOC_STREAMON, &type);

    /* 5. 取出一帧 */
    struct v4l2_buffer buf = {0};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    ioctl(fd, VIDIOC_DQBUF, &buf);  /* 出队 */

    /* 6. 写入文件 */
    FILE *fp = fopen("/tmp/capture.jpg", "wb");
    fwrite(buffers[buf.index].start, buf.bytesused, 1, fp);
    fclose(fp);
    printf("Captured %u bytes → /tmp/capture.jpg\n", buf.bytesused);

    /* 7. 清理 */
    ioctl(fd, VIDIOC_STREAMOFF, &type);
    for (int i = 0; i < req.count; i++) munmap(buffers[i].start, buffers[i].length);
    close(fd);
    return 0;
}
```

### 移远EC20 4G模块端

```bash
# ===== 步骤1：确认4G模块被识别 =====
$ lsusb
Bus 001 Device 005: ID 2c7c:0125 Quectel Wireless Solutions Co., Ltd. EC25 LTE modem

# 查看USB树形拓扑 — 确认挂在哪个Hub下
$ lsusb -t
/:  Bus 01.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/6p, 480M
    |__ Port 2: Dev 2, If 0, Class=Hub, Driver=hub/4p, 480M
        |__ Port 1: Dev 5, If 0, Class=Communications, Driver=cdc_acm, 480M
        |__ Port 1: Dev 5, If 1, Class=CDC Data, Driver=cdc_acm, 480M
        |__ Port 1: Dev 5, If 2, Class=Communications, Driver=cdc_acm, 480M
        |__ Port 1: Dev 5, If 3, Class=CDC Data, Driver=cdc_acm, 480M

# 查看生成的tty设备
$ ls -l /dev/ttyUSB*
crw-rw---- 1 root dialout 188, 0 /dev/ttyUSB0   ← AT指令口
lrwxrwxrwx 1 root root       7 /dev/ec20-at → ttyUSB0   ← udev规则创建的软链接
```

```bash
# ===== 步骤2：AT指令测试与拨号 =====
$ minicom -D /dev/ttyUSB0 -b 115200

# 在minicom中依次输入AT指令：
AT                      # 握手 → 返回 OK
AT+CGMM                 # 查询型号 → 返回 EC25
AT+CSQ                  # 查询信号强度 → 返回 +CSQ: 28,99 (0~31, 28很好)
AT+CREG?                # 网络注册状态 → +CREG: 0,1 (1=已注册本地网络)
AT+CGDCONT=1,"IP","cmnet"  # 设置APN（中国移动）
AT+QICSGP=1,1,"cmnet","","",1  # 配置PDP上下文
AT+QIACT=1              # 激活PDP上下文
AT+QIFGCNT=0            # 配置TCP/IP场景

# 测试TCP连接
AT+QIOPEN=1,0,"TCP","180.97.33.107",80,0,0
→ +QIOPEN: 0,0          # 连接成功
AT+QISEND=0,5           # 发送5字节
> hello
→ SEND OK
AT+QICLOSE=0            # 关闭连接
```

```c
/* ===== C语言版本：通过EC20发送HTTP请求 ===== */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>

/* 发送AT指令并等待期望的响应 */
int at_cmd(int fd, const char *cmd, const char *expect,
           char *resp, size_t resp_len, int timeout_ms)
{
    char buf[512];
    int n;

    tcflush(fd, TCIOFLUSH);
    snprintf(buf, sizeof(buf), "%s\r\n", cmd);
    write(fd, buf, strlen(buf));

    /* 读取响应 */
    memset(resp, 0, resp_len);
    int total = 0;
    int elapsed = 0;
    while (elapsed < timeout_ms) {
        n = read(fd, resp + total, resp_len - total - 1);
        if (n > 0) {
            total += n;
            resp[total] = '\0';
            if (strstr(resp, expect)) return 0;  /* 找到期望字符串 */
        }
        usleep(100000);  /* 100ms */
        elapsed += 100;
    }
    return -1;  /* 超时 */
}

int main(void)
{
    /* 打开串口 */
    int fd = open("/dev/ttyUSB0", O_RDWR | O_NOCTTY);
    if (fd < 0) { perror("open"); return 1; }

    struct termios tty = {0};
    cfsetospeed(&tty, B115200);
    cfsetispeed(&tty, B115200);
    tty.c_cflag |= CS8 | CREAD | CLOCAL;
    tcsetattr(fd, TCSANOW, &tty);

    char resp[512];

    /* 检查模块就绪 */
    if (at_cmd(fd, "AT", "OK", resp, sizeof(resp), 2000) != 0) {
        fprintf(stderr, "Modem not responding\n");
        close(fd);
        return 1;
    }
    printf("Modem ready: %s\n", resp);

    /* 检查信号 */
    if (at_cmd(fd, "AT+CSQ", "+CSQ:", resp, sizeof(resp), 3000) == 0)
        printf("Signal: %s", resp);

    /* 检查网络注册 */
    if (at_cmd(fd, "AT+CREG?", "+CREG:", resp, sizeof(resp), 3000) == 0)
        printf("Registration: %s", resp);

    close(fd);
    return 0;
}
```

### 验证步骤清单

| 步骤 | 命令 | 期望输出 | 排查 |
|------|------|----------|------|
| 1. 设备是否上电 | `lsusb` | 看到VID:PID | 没出现→检查供电/线缆 |
| 2. 驱动是否匹配 | `dmesg \| grep -i usb` | driver bound 信息 | 未匹配→lsusb -v看class |
| 3. 设备节点 | `ls -l /dev/video* /dev/ttyUSB*` | 节点存在 | 不存在→检查udev规则 |
| 4. 摄像头采集 | `v4l2-ctl --stream-to` | 生成.jpg文件 | 失败→检查带宽/格式 |
| 5. 4G信号 | `AT+CSQ` → 返回 `28,99` | 信号>10 | 信号差→检查天线 |
| 6. 网络注册 | `AT+CREG?` → `0,1` | 状态=1 | 未注册→检查SIM卡/APN |

<br>

---

## <span class="blue"> 调试命令速查 [E]

```bash
# ===== 查看USB拓扑树 =====
$ lsusb -t
# 输出示例：
# /:  Bus 02.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/4p, 5000M   ← USB3.0, 5Gbps
#     |__ Port 1: Dev 2, If 0, Class=Mass Storage, Driver=usb-storage, 5000M
# /:  Bus 01.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/2p, 480M    ← USB2.0, 480Mbps
#     |__ Port 1: Dev 3, If 0, Class=Video, Driver=uvcvideo, 480M

# ===== 查看USB设备完整描述符 =====
$ lsusb -v -d 046d:082d
# 能看到：设备描述符/配置描述符/接口描述符/端点描述符/字符串描述符
# 排查兼容性问题时，对比datasheet和实际描述符是否一致

# ===== 查看内核USB日志 =====
$ dmesg | grep -i usb
$ dmesg -w | grep -i xhci    # 实时跟踪

# ===== 监控udev事件（热插拔调试神器） =====
$ udevadm monitor --property --subsystem-match=usb --subsystem-match=tty
# 插入设备时，你会看到完整的udev事件链和ENV属性

# ===== 查看USB驱动绑定状态 =====
$ ls /sys/bus/usb/drivers/   # 列出所有已注册的USB驱动
$ ls /sys/bus/usb/devices/   # 列出所有USB设备
$ cat /sys/kernel/debug/usb/devices  # 完整的USB拓扑信息

# ===== xhci调试信息 =====
$ cat /sys/kernel/debug/usb/xhci/*  # 寄存器状态/ring状态（需root）
```

> 💡 **提示**：`lsusb -v`输出的信息量和Windows下USBView工具完全一致。当你遇到一个USB设备在Linux上工作不正常，第一步就是`lsusb -v`对比设备的描述符——特别是`bConfigurationValue`、`bInterfaceClass`和端点`wMaxPacketSize`，很多时候是设备描述符本身不合规导致驱动拒绝绑定。

<br>

---

## <span class="blue"> 本节总结

| 主题 | 要点 | 常见坑 |
|------|------|--------|
| **四大结构** | `usb_hcd`→`usb_bus`→`usb_device`→`usb_driver` 分层解耦 | 混淆device和interface的匹配粒度 |
| **控制器驱动** | xHCI(USB3)统一EHCI(USB2)+OHCI(USB1.1)，不再需要Companion | 缺少PHY时钟/复位→检测不到设备 |
| **URB传输** | 控制/批量/中断用异步URB；同步API仅适合初始化 | 回调里用`GFP_KERNEL`会触发睡眠警告 |
| **DMA** | `usb_alloc_coherent()`一致性DMA最常用 | ARM64上忘加`dma-coherent`属性 |
| **热插拔** | `hub_irq`→枚举→`usb_match_id`→`probe`→`uevent`→udevd | udev规则没写对→设备节点权限错误 |
| **UVC摄像头** | 内核`uvcvideo`驱动，用户空间V4L2 API | ISO带宽不足→降低分辨率或帧率 |
| **4G模块** | CDC-ACM虚拟串口，AT指令控制 | **供电不足**→间歇性断开 |

<br>

---

## <span class="blue"> 下一步

你已经掌握了USB Host端的完整驱动链路。下一节 **B-C.7.4 USB Gadget模式与ConfigFS** 将把视角翻转——让你的开发板扮演USB Device角色。你将学习：

- Gadget框架：`usb_gadget_driver` / `usb_composite_driver` / ConfigFS动态配置
- 实战：把RK3399变成一个USB大容量存储设备（通过ConfigFS暴露块设备）
- RNDIS/ECM网络Gadget：开发板通过USB线共享网络给PC
- 复合Gadget：同时暴露串口+网卡+存储（多功能USB设备）

这是USB驱动进阶的必经之路，也是很多工业场景（比如通过USB给设备固件升级、USB调试终端）的核心技术。

<br>

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/driver-api/usb.rst`（USB驱动API参考）
- **USB规范**：usb.org 下载 USB 3.2 Spec + xHCI Spec
- **UVC文档**：`linux-uvc.berlios.de`（UVC驱动项目主页）
- **移远EC20 AT指令手册**：《Quectel_EC2x&EG9x&EM05_TCP(IP)_AT_Commands_Manual》
- **推荐书籍**：《Linux Device Drivers, 3rd Edition》第13章（USB驱动）
- **调试工具包**：`lsusb`(usbutils)、`v4l2-ctl`(v4l-utils)、`minicom`、`udevadm`
