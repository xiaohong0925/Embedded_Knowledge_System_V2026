# USB怎么调——Host-Gadget驱动与调试工具

<span class="badge-b">[B]</span> <span class="badge-i">[I]</span> <span class="badge-e">[E]</span> <span class="badge-m">[M]</span>

掌握 USB 的理论之后，本章进入实战。
从 Linux USB 子系统架构到 xHCI/EHCI/OHCI Host 控制器，
从 Gadget 驱动框架到 usbmon/Wireshark 抓包，
让你具备排查任何 USB 问题的能力。

---

## 核心定义与价值

<span class="red">Linux USB 子系统</span> 是内核中最复杂也最成熟的子系统之一。
它分层清晰：HCD 处理硬件，usbcore 管理设备，Class Driver 实现具体功能。

**调试 USB 问题的核心工具链：**

- <span class="green">lsusb -t -v</span>：查看拓扑和描述符
- <span class="green">dmesg | grep usb</span>：跟踪内核枚举和错误日志
- <span class="green">usbmon</span>：内核级 USB 流量捕获
- <span class="green">Wireshark + usbpcap</span>：图形化 USB 协议分析
- <span class="green">/sys/kernel/debug/usb/devices</span>：内核设备状态

---

### 类比：城市交通指挥中心

Linux USB 子系统像一座城市的交通体系：

- <span class="green">xHCI</span> = 现代地铁系统（高速、大运量、统一管理）
- <span class="green">EHCI</span> = 快速公交 BRT（比地铁慢但覆盖广）
- <span class="green">OHCI/UHCI</span> = 老式有轨电车（速度慢但还在跑）
- <span class="green">usbcore</span> = 交通指挥中心（调度所有交通工具）
- <span class="green">Class Driver</span> = 各线路的运营公司（hid/usb-storage/cdc-acm）
- <span class="green">usbmon</span> = 道路监控摄像头（记录每一辆车的轨迹）

---

## 核心机制原理解析

### <strong>1. Linux USB 子系统分层架构</strong>

<br>

```mermaid
graph TD
    A[User Space: libusb / usbfs] --ioctl--
    B[usbcore: USB Core Layer]
    B --urb--
    C[HCD: xHCI / EHCI / OHCI / UHCI]
    C --register/irq--
    D[Host Controller Hardware]
    D --D+/D- / SS--
    E[USB Device]

    F[ConfigFS / FunctionFS] --
    G[Gadget Core]
    G --
    H[UDC Driver: dwc3 / musb]
    H --
    D
```

<br>

**Host 侧层次：**

| 层次 | 模块 | 功能 |
|------|------|------|
| Client | usb-storage / hid / cdc-acm | 解析设备数据，对接上层子系统 |
| Core | usbcore | 设备管理、urb 分配、带宽分配、枚举 |
| HCD | xhci-hcd / ehci-hcd / ohci-hcd | 寄存器操作、DMA 调度、中断处理 |
| PHY | phy-usb | 物理层复位、时钟、电源 |

<br>

**Gadget 侧层次：**

| 层次 | 模块 | 功能 |
|------|------|------|
| Function | f_mass_storage / f_acm / f_rndis | 实现 USB 类协议 |
| ConfigFS | configfs | 动态配置 Gadget 的设备和功能 |
| UDC | dwc3 / musb / cdns-usb | 管理 Device 控制器硬件 |

---

### <strong>2. Host 控制器：xHCI、EHCI、OHCI、UHCI</strong>

<br>

| 控制器 | 标准 | USB 版本 | 最大速率 | 特点 | 现代平台 |
|--------|------|---------|---------|------|---------|
| UHCI | Intel | USB 1.x | 12 Mbps | 软件驱动为主 | 已淘汰 |
| OHCI | Compaq/MS | USB 1.x | 12 Mbps | 硬件调度为主 | 已淘汰 |
| EHCI | Intel | USB 2.0 | 480 Mbps | 仅处理 HS，FS/LS 通过 Companion 控制器 | 逐渐淘汰 |
| xHCI | Intel | USB 3.x | 5-20 Gbps | 统一控制器，兼容所有速度 | 当前主流 |

<br>

**xHCI 的核心改进：**

- 一个控制器管理 USB 1.x/2.0/3.x 所有速度，不再需要 Companion 控制器
- 基于内存的命令环（Command Ring）和事件环（Event Ring），类似 NVMe 的 SQ/CQ
- 支持最多 255 个 Root Hub 端口、31 个 Device Slot、64K 个端点上下文
- USB 3.0 的 Bulk Stream 支持

<br>

**xHCI 的关键数据结构：**

```c
/* Slot Context */
struct xhci_slot_ctx {
    u32 dev_info;       /* Route String / Speed / Hub / MTT */
    u32 dev_info2;      /* Slot State / Number of Entries */
    u32 tt_info;        /* TT Hub Slot ID / TT Port Number */
    u32 dev_state;      /* USB Device Address / Intr Target */
    u32 reserved[4];
};

/* Endpoint Context */
struct xhci_ep_ctx {
    u32 ep_info;        /* EP State / Interval / LSA / CErr */
    u32 ep_info2;       /* EP Type / Max Burst / Max Pkt Size */
    u64 deq;            /* TR Dequeue Pointer */
    u32 tx_info;        /* Average TRB Length / Max ESIT Payload */
    u32 reserved;
};
```

---

### <strong>3. Gadget 驱动框架：Mass Storage、CDC ACM、RNDIS</strong>

<br>

**Mass Storage Gadget（g_mass_storage）：**

```bash
# 加载模块，将 mmcblk0 作为 U 盘
modprobe g_mass_storage file=/dev/mmcblk0 removable=1 stall=0

# dmesg 输出：
g_mass_storage: Gadget Mass Storage, version: 2009/09/11
g_mass_storage: file: /dev/mmcblk0
g_mass_storage: Number of LUNs=1
udc-core: registering UDC driver [g_mass_storage]
```

<br>

**CDC ACM Gadget（串口模拟）：**

```bash
# 加载模块
modprobe g_serial

# 主机侧看到新的串口：/dev/ttyACM0
# 设备侧通过 /dev/ttyGS0 读写
```

<br>

**RNDIS Gadget（网卡模拟）：**

```bash
# 加载模块
modprobe g_ether host_addr=02:00:00:00:00:01 dev_addr=02:00:00:00:00:02

# 主机侧看到新的网卡：usb0
# 可以配置 IP，建立网络连接
ifconfig usb0 192.168.7.1
```

<br>

**Gadget 的两种配置方式：**

| 方式 | 特点 | 场景 |
|------|------|------|
| 传统模块 | g_mass_storage / g_serial / g_ether | 快速测试，功能固定 |
| ConfigFS | 动态组合多个 Function | 产品级，一个 Gadget 同时是 U 盘+串口+网卡 |

---

### <strong>4. 调试工具：usbmon 与 Wireshark</strong>

<br>

**usbmon 内核抓包：**

```bash
# 加载 usbmon 模块
modprobe usbmon

# 查看可用总线
ls /sys/kernel/debug/usb/usbmon
0s  0u  1s  1u  2s  2u
# s = 短格式，u = 所有设备（含 Hub）

# 抓包总线 1（短格式）
cat /sys/kernel/debug/usb/usbmon/1s | head -20
# 输出格式：
f4d0bc80 1576597833 S Ci:1:002:0 s a3 00 0000 0001 0004 4 <
f4d0bc80 1576597833 C Ci:1:002:0 0 4 = 01010000
f4d0bc80 1576597834 S Ci:1:002:0 s a3 00 0000 0002 0004 4 <
f4d0bc80 1576597834 C Ci:1:002:0 0 4 = 01030000
```

<br>

字段解读：

| 字段 | 含义 |
|------|------|
| f4d0bc80 | URB 指针 |
| 1576597833 | 时间戳（μs） |
| S/C | S=Submit（提交），C=Complete（完成） |
| Ci | Control IN（控制传输，方向 IN） |
| 1:002:0 | Bus 1, Device 2, Endpoint 0 |
| s a3 00 0000 0001 0004 | Setup 包内容 |
| 0 | 状态码（0=成功） |
| 4 | 传输字节数 |
| = 01010000 | 数据内容 |

<br>

**Wireshark + usbpcap（Windows）/ usbmon（Linux）：**

```bash
# Linux: Wireshark 直接捕获 usbmon 接口
sudo wireshark -i usbmon1

# 过滤特定设备
usb.device_address == 3
```

<br>

**dmesg 排查 USB 问题：**

```bash
# 设备不识别
dmesg | grep -i usb | grep -i "not responding"
# 根因：设备未正确上拉 D+，或供电不足

# 带宽不足（Isochronous 丢包）
dmesg | grep -i "usbfs: USBDEVFS_CONTROL"
# 根因：Isochronous 端点带宽超过总线容量

# 设备频繁断开
dmesg | grep -i "USB disconnect"
# 根因：VBUS 跌落、信号完整性差、线缆质量问题
```

---

## 技术教学与实战

### 完整排查：USB 设备不识别

某开发板插入 USB 摄像头后，/dev/video0 未出现。

排查清单：

| 步骤 | 命令 | 目的 |
|------|------|------|
| 1 | lsusb | 确认设备是否在总线上 |
| 2 | lsusb -v -d xxx:yyy | 读取描述符，确认接口类别 |
| 3 | dmesg \| grep -i usb | 查看枚举过程 |
| 4 | lsusb -t | 确认挂载的 Hub 和端口 |
| 5 | lsmod \| grep uvc | 确认 uvcvideo 驱动已加载 |
| 6 | modprobe uvcvideo | 手动加载驱动 |
| 7 | ls /dev/video* | 确认设备节点 |
| 8 | usbmon 抓包 | 分析枚举失败点 |

<br>

常见根因：

| 现象 | 根因 | 修复 |
|------|------|------|
| lsusb 无输出 | 供电不足 / 上拉电阻未连接 | 检查 VBUS 电压，测量 D+ 上拉 |
| 枚举到一半停止 | 描述符损坏 / CRC 错误 | usbmon 抓包确认哪一步失败 |
| 驱动未加载 | 内核未编译对应 Class Driver | 确认 CONFIG_USB_UVC=y |
| 设备节点不出现 | udev 规则缺失 | 检查 /etc/udev/rules.d/ |

---

## 嵌入式专属实战场景

### 场景：为 STM32 配置 USB RNDIS 网络共享

STM32 作为 Gadget，通过 USB 为 PC 提供网络连接：

```c
/* STM32 HAL 配置 */
/* 1. 初始化 USB OTG FS */
MX_USB_OTG_FS_PCD_Init();

/* 2. 初始化 LwIP */
MX_LWIP_Init();

/* 3. 配置 RNDIS Gadget */
rndis_init();
netif_add(&gnetif, &ipaddr, &netmask, &gw, NULL, &ethernetif_init, &ethernet_input);
netif_set_default(&gnetif);
netif_set_up(&gnetif);

/* 4. 主循环 */
while (1) {
    usb_rndis_task();   /* 处理 USB 数据 */
    lwip_periodic();    /* LwIP 定时任务 */
}
```

<br>

PC 侧识别为 RNDIS 网卡后，配置网络：

```bash
# Linux PC
sudo ip addr add 192.168.7.2/24 dev usb0
sudo ip link set usb0 up
ping 192.168.7.1   # STM32 的 IP

# Windows PC
# 自动识别为 "Remote NDIS based Internet Sharing Device"
# 在网络适配器中配置 IP
```

---

## 历史演进与前沿

### USB 调试工具的演进

| 工具 | 年代 | 能力 | 现状 |
|------|------|------|------|
| usbfs / usbdevfs | 1999 | 用户空间直接访问 USB | 已废弃 |
| usbmon | 2005 | 内核抓包，无用户态开销 | 当前主流 |
| usbpcap | 2010 | Windows 抓包驱动 | 配合 Wireshark |
| bpftrace / eBPF | 2020 | 内核态动态追踪 | 未来趋势 |

---

## 本章小结

| 主题 | 关键要点 |
|------|---------|
| xHCI | 统一控制器，兼容 USB 1.x/2.0/3.x，基于内存的命令环/事件环 |
| EHCI | USB 2.0 专用，FS/LS 通过 Companion 控制器 |
| Gadget | Function Driver → ConfigFS → UDC → 硬件 |
| Mass Storage | g_mass_storage file=/dev/mmcblk0 |
| CDC ACM | g_serial，主机侧识别为 /dev/ttyACM0 |
| RNDIS | g_ether，主机侧识别为 usb0 网卡 |
| usbmon | /sys/kernel/debug/usb/usbmon/Ns，S=提交 C=完成 |
| 排查 | lsusb → dmesg → lsmod → usbmon，按此顺序 |

---

## 练习

1. 为什么 xHCI 一个控制器可以管理 USB 1.x/2.0/3.x 所有速度，而 EHCI 需要 OHCI/UHCI 作为 Companion 控制器？
   xHCI 在硬件架构上做了什么统一？
2. 某嵌入式 Linux 设备使用 g_ether 作为 RNDIS Gadget。PC 侧可以识别设备但无法 ping 通。
   设计一个从物理层到应用层的排查清单。
3. usbmon 输出中的 "S" 和 "C" 分别代表什么？为什么它们总是成对出现？如果只出现 S 没有 C，说明什么问题？
4. 对比传统模块方式（g_mass_storage）和 ConfigFS 方式配置 Gadget 驱动。ConfigFS 的核心优势是什么？
   在什么场景下传统模块方式仍然更简便？
5. 某 USB 摄像头在 xHCI 控制器上工作正常，在 EHCI 控制器上频繁丢帧。
   从带宽分配和 Isochronous 调度两个角度分析可能原因。
