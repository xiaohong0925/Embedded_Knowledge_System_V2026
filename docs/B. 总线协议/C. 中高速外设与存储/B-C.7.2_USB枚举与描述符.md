# B-C.7.2 USB枚举与描述符

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[I] | 预计阅读时间：30 分钟

## 本节导读

把 U 盘插上电脑，几秒钟后系统弹出了盘符。这几秒钟里，主机和设备之间发生了一整套严格的"身份核查"流程：主机要弄清这个设备是谁、能干什么、需要多少电、用哪几个通道传数据，然后才决定加载哪个驱动。这个流程叫**枚举（Enumeration）**，它是 USB 协议里最核心的流程——设备驱动加载、设备节点生成、上层应用能用上设备，全都以枚举成功为前提。

反过来说，嵌入式开发中"USB 设备插上没反应"这类问题，九成都能在枚举流程里找到断点。读懂枚举，你就拿到了排查这类问题的地图。

本节覆盖：枚举的 8 个步骤及其总线交互细节、控制传输的三阶段握手、描述符的树形层次与关键字段、标准设备类与驱动的对应关系、`lsusb -v` 输出解读、枚举失败的系统化排查方法。

## 先建立三个概念

枚举流程涉及的所有通信都建立在三个基础概念上，先把它们说清楚。

> 端点（Endpoint）：USB 设备内部的一个数据通道编号，类似设备上的"窗口"。每个端点有固定的方向（IN = 设备发给主机，OUT = 主机发给设备）和传输类型。一个设备可以有多个端点，各管一摊事——U 盘用一个端点收命令、一个端点发数据；摄像头用一个端点传图像、一个端点收控制命令。

> 端点 0（EP0）：所有 USB 设备出厂就必须具备的双向端点，也是唯一一个无需任何配置就能用的端点。它的唯一职责是承载枚举和后续的设备管理命令。主机与新设备的一切"前期谈判"都发生在 EP0 上。

> 控制传输（Control Transfer）：USB 四种传输类型之一，专为命令与状态交互设计，特点是双向、可靠、有严格的应答机制。枚举期间的每一次问答都是一次控制传输。

有了这三个概念，枚举就可以用一句话概括：**主机通过 EP0 发起一系列控制传输，读取设备自报家底的数据结构（描述符），然后给设备分配地址、激活配置、加载驱动。**

## 枚举的 8 个步骤

| 步骤 | 主机动作 | 设备响应 | 目的 |
|------|---------|---------|------|
| ① 连接检测 | 监测 D+/D- 电平 | 上拉电阻拉高电平 | 发现设备接入，判断速度模式 |
| ② 总线复位 | Hub 发出 RESET 信号（≥10ms） | 复位到默认状态 | 设备进入默认状态，地址 = 0 |
| ③ 地址分配 | `SET_ADDRESS` | ACK | 给设备分配总线上唯一的地址（1~127） |
| ④ 获取设备描述符 | `GET_DESCRIPTOR`（Device） | 设备描述符（18 字节） | 获得设备基本信息和 EP0 包大小 |
| ⑤ 获取配置描述符 | `GET_DESCRIPTOR`（Configuration） | 配置 + 接口 + 端点描述符 | 获得设备完整的功能结构 |
| ⑥ 获取接口/端点细节 | 随 ⑤ 一并返回 | 接口/端点描述符 | 明确每个功能的通信参数 |
| ⑦ 获取字符串描述符 | `GET_DESCRIPTOR`（String） | 字符串描述符 | 获得可读的产品名、厂商名、序列号 |
| ⑧ 设置配置 | `SET_CONFIGURATION` | ACK | 激活配置，设备进入工作状态，驱动匹配 |

这 8 步顺序是强制的，任何一步失败，枚举就中断，设备对系统而言等于不存在。下面把每一步在总线上实际发生了什么拆开看。

### ① 连接检测：一个上拉电阻引发的事件

USB 设备在 D+ 或 D- 上接了一个 1.5kΩ 上拉电阻（在 B-C.7.1 物理层篇中讲过）。插入瞬间，Hub 检测到哪根线被拉高，就知道来了设备，还知道了它的速度档位：

| 上拉位置 | 速度模式 | 典型设备 |
|---------|---------|---------|
| D+ 上拉 | Full-Speed（12 Mbit/s） | 大多数全速设备 |
| D- 上拉 | Low-Speed（1.5 Mbit/s） | 键盘、鼠标 |
| D+ 上拉，随后 Chirp 协商 | High-Speed（480 Mbit/s） | U 盘、摄像头 |

Hub 把这个事件上报给主机，枚举开始。

### ② 总线复位

Hub 向新接入的端口发出至少 10ms 的 SE0 信号（D+ 和 D- 同时拉低）。设备收到复位后回到出厂默认状态：地址清零、EP0 的同步序列归位、配置值清零。如果设备支持 High-Speed，此时进行 Chirp K/J 握手完成升速协商（细节见 B-C.7.1）。

> ⚠️ 复位之后、地址分配之前，设备的地址是 0。地址 0 是"未分配"的保留地址，总线上同一时间只能有一个设备处于这个状态——这就是 Hub 必须逐个端口完成枚举，而不能同时给两个新设备发命令的原因。

### ③ 地址分配（SET_ADDRESS）

主机发出第一个控制传输，给设备分配 1~127 之间的唯一地址：

```
Setup包内容：
  bmRequestType = 0x00 (Host→Device, 标准请求, 设备接收)
  bRequest      = 0x05 (SET_ADDRESS)
  wValue        = 新地址 (1~127)
  wIndex        = 0
  wLength       = 0
```

设备必须在这次传输的状态阶段完成 ACK 之后的 2ms 内切换到新地址。切换失败，设备就会从主机视野里消失。

### ④ 获取设备描述符

这是主机第一次真正"读取"设备。设备描述符共 18 字节，其中对枚举本身最关键的是 `bMaxPacketSize0`——EP0 一次能传的最大包大小：

```
Setup包内容：
  bmRequestType = 0x80 (Device→Host, 标准请求, 设备接收)
  bRequest      = 0x06 (GET_DESCRIPTOR)
  wValue        = 0x0100 (Device描述符, Index=0)
  wIndex        = 0
  wLength       = 8 或 18
```

注意主机的一个稳妥做法：**先只请求前 8 字节**。因为此时还不知道设备 EP0 的包大小（低速 8 字节、全速可以是 8/16/32/64 字节），用最小的 8 字节请求保证不会出错。前 8 字节里恰好包含 `bMaxPacketSize0`，拿到它之后，主机再按正确的包大小重新完整请求 18 字节。

> ⚠️ `bMaxPacketSize0` 与实际硬件能力不符，是自研 USB 设备固件最常见的 bug 之一。设备上报 8 字节但实际能发 64 字节（或反过来），主机按错误的包大小解析后续数据，从第 ⑤ 步开始全部失败，而且 dmesg 里的报错（通常是 -71 EPROTO）并不会告诉你根因在这里。

### ⑤~⑥ 获取配置描述符：一次拿回整棵树

配置描述符的请求有个特别之处：设备会把**整个配置下的描述符层次一次性打包返回**——配置描述符、所有接口描述符、每个接口下的所有端点描述符，按顺序拼接成一整块数据。

主机的做法同样是两步：先请求 9 字节的配置描述符头，从其中的 `wTotalLength` 字段得知整块数据的总长度，再按总长度重新请求一次。

返回数据的布局以一个 CDC 虚拟串口设备为例：

```
+-------------------+ 偏移0, 长度9
| 配置描述符        | bLength=9, wTotalLength=67
+-------------------+ 偏移9, 长度9
| IAD描述符         | (CDC设备特有，声明接口组合关系)
+-------------------+ 偏移18, 长度9
| 接口0描述符       | bInterfaceClass=0x02 (CDC-Control)
+-------------------+ 偏移27, 长度5
| 端点描述符        | bEndpointAddress=0x83 (IN, EP3)
+-------------------+ 偏移32, 长度9
| 接口1描述符       | bInterfaceClass=0x0A (CDC-Data)
+-------------------+ 偏移41, 长度7
| 端点描述符        | bEndpointAddress=0x01 (OUT, EP1)
+-------------------+ 偏移48, 长度7
| 端点描述符        | bEndpointAddress=0x82 (IN, EP2)
+-------------------+
```

主机拿到这块数据后，就完整掌握了设备的功能结构：有几个接口、每个接口是什么类别、各用几个端点、端点的方向和类型是什么。

### ⑦ 获取字符串描述符

字符串描述符是可选的，但它提供了人类可读的厂商名、产品名、序列号——你在 `lsusb` 输出里看到的 "SanDisk Cruzer Blade" 就来自这里。设备描述符里的 `iManufacturer`、`iProduct`、`iSerialNumber` 字段存的是字符串的索引号，主机按索引逐个取回：

```
Setup包：
  wValue = 0x0300 (String描述符, Index=0 → 语言ID列表)
  wValue = 0x0301 (String描述符, Index=1 → 厂商字符串)
```

### ⑧ 设置配置（SET_CONFIGURATION）

```
Setup包：
  bmRequestType = 0x00
  bRequest      = 0x09 (SET_CONFIGURATION)
  wValue        = bConfigurationValue (通常是1)
```

这是枚举的"点火"动作。设备收到后激活指定配置，所有非 0 端点开始工作，设备进入**已配置状态（Configured State）**。主机随即根据各接口描述符的 Class/SubClass/Protocol 三字段去匹配并加载驱动——匹配成功，你在 dmesg 里看到 `usb 1-1: ...` 后面跟着 `usb-storage`、`cdc_acm` 之类的驱动绑定日志，设备节点生成，枚举画上句号。

## 控制传输的三阶段握手

上面每一步在总线上都不是一发一收那么简单。USB 的每次控制传输由三个阶段构成：**Setup 阶段 → Data 阶段 → Status 阶段**。以第 ④ 步"获取设备描述符"为例，完整的总线交互如下：

```
 主机(Hub)                                  设备
    |                                         |
    |===== SETUP Token (ADDR=0, EP=0) ======>|  Setup阶段：令牌包
    |===== DATA0 (8字节Setup数据) ==========>|  内含bmRequestType/bRequest/wValue
    |                                         |
    |<===== ACK ==============================|  设备确认收到Setup
    |                                         |
    |<===== DATA1 (设备描述符数据) ===========|  Data阶段：设备回传描述符
    |   bLength = 18                          |
    |   bMaxPacketSize0 = 64  <-- 关键字段    |
    |                                         |
    |===== ACK ==============================>|  主机确认收到数据
    |                                         |
    |===== OUT Token (ADDR=0, EP=0) =========>|  Status阶段：零长度状态包
    |===== DATA1 (0字节) ====================>|
    |<===== ACK ==============================|  设备确认，传输完成
```

这个三阶段结构保证了控制传输的可靠性：每个阶段都有 ACK 应答，任何一环没有应答，主机就知道传输失败并重试。抓包分析枚举问题时，你看到的每一组 Setup/Data/ACK 都对应这里的一个阶段。

> 💡 用 usbmon 抓包看枚举过程，是排查"设备不识别"最直接的证据链。内核开启 `CONFIG_USB_MON` 后，可以从 `/sys/kernel/debug/usb/usbmon` 读取原始 URB 数据，也可以用 tcpdump 存成 pcap 文件交给 Wireshark 图形化分析：

```bash
mount -t debugfs none /sys/kernel/debug
modprobe usbmon

# 查看总线列表，找到设备所在总线（如 bus 1）
ls /sys/kernel/debug/usb/usbmon

# 抓取 bus 1 上的所有 USB 通信
cat /sys/kernel/debug/usb/usbmon/1u

# 或存为 pcap 文件，用 Wireshark 打开分析
tcpdump -i usbmon1 -w usb_enum.pcap
```

## 描述符：设备的自报家底

枚举过程中主机读取的所有信息都来自**描述符（Descriptor）**——设备固件里一组定长、定格式的数据结构。描述符按严格的树形层次组织：每个设备只有一个设备描述符，向下展开为配置、接口、端点三层：

```
                    ┌──────────────────────┐
                    │    设备描述符         │ 全设备唯一
                    │  (Device Descriptor) │
                    │  bNumConfigurations  │
                    └──────────┬───────────┘
                               │ 1..N
              ┌────────────────┼────────────────┐
              │                │                │
         ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
         │ 配置描述 │     │ 配置描述 │     │ 配置描述 │
         │ 符(Cfg1)│     │ 符(Cfg2)│     │ 符(CfgN)│
         │bNumIntfs│     │bNumIntfs│     │bNumIntfs│
         └────┬────┘     └────┬────┘     └────┬────┘
              │ 1..N
       ┌──────┼──────┐
       │      │      │
   ┌───▼───┐┌─▼───┐┌▼─────┐
   │接口0  ││接口1││接口2 │
   │bNumEPs││bNumE││bNumEP│
   └───┬───┘└─────┘└──┬───┘
       │ 0..N
  ┌────┼────┐
  │    │    │
┌─▼─┐┌▼──┐┌▼───┐
│EP0││EP1││EP2 │  (端点描述符)
│IN/││OUT││INT │
│OUT││BULK│IN │
└───┘└───┘└────┘
```

> 配置（Configuration）：设备的一种工作模式。大多数设备只有一种配置；少数设备有多种，比如一个 USB 网卡可以提供"高性能模式"和"低功耗模式"两种配置，主机用 SET_CONFIGURATION 选其一。
>
> 接口（Interface）：一项独立的功能。一个复合设备可以有多个接口——带麦克风的 USB 耳机，音频输出是一个接口、麦克风是一个接口、音量按键（HID）又是一个接口。**Linux 的 USB 驱动是绑在接口上的，不是绑在整个设备上的**，这是理解 USB 驱动模型的关键。

四层描述符的分工与关键字段：

| 描述符 | 大小(字节) | 关键字段 | 回答的问题 |
|--------|-----------|---------|-----------|
| 设备描述符 | 18 | `bcdUSB`, `bMaxPacketSize0`, `idVendor`, `idProduct`, `bNumConfigurations` | 这是谁家的什么产品？EP0 一次能传多少字节？ |
| 配置描述符 | 9 | `bNumInterfaces`, `bConfigurationValue`, `bmAttributes`, `bMaxPower` | 这个配置有几个功能？吃多少电？ |
| 接口描述符 | 9 | `bInterfaceClass`, `bInterfaceSubClass`, `bInterfaceProtocol` | 这项功能属于什么类别？该用哪个驱动？ |
| 端点描述符 | 7 | `bEndpointAddress`, `bmAttributes`, `wMaxPacketSize`, `bInterval` | 数据走哪个通道？方向、类型、包大小是什么？ |

### 设备描述符字段详解

| 字段 | 偏移 | 大小 | 示例值 | 含义 |
|------|------|------|--------|------|
| `bLength` | 0 | 1 | 0x12 | 描述符长度 = 18 字节 |
| `bDescriptorType` | 1 | 1 | 0x01 | 类型 = 设备描述符 |
| `bcdUSB` | 2 | 2 | 0x0200 | 遵循 USB 2.0 规范 |
| `bDeviceClass` | 4 | 1 | 0x00 | 0 表示类别在接口级定义（复合设备常见） |
| `bDeviceSubClass` | 5 | 1 | 0x00 | 子类 |
| `bDeviceProtocol` | 6 | 1 | 0x00 | 协议 |
| `bMaxPacketSize0` | 7 | 1 | 0x40 | EP0 最大包大小 = 64 字节 |
| `idVendor` | 8 | 2 | 0x0781 | 厂商 ID（示例为 SanDisk） |
| `idProduct` | 10 | 2 | 0x5567 | 产品 ID |
| `bcdDevice` | 12 | 2 | 0x0100 | 设备固件版本号 |
| `iManufacturer` | 14 | 1 | 0x01 | 厂商字符串的索引 |
| `iProduct` | 15 | 1 | 0x02 | 产品字符串的索引 |
| `iSerialNumber` | 16 | 1 | 0x03 | 序列号字符串的索引 |
| `bNumConfigurations` | 17 | 1 | 0x01 | 共 1 种配置 |

`idVendor`（VID）和 `idProduct`（PID）合起来是设备的身份证号，Linux 靠它俩在驱动 ID 表里查找匹配项。VID 由 USB-IF 组织统一分配，自制设备调试时常用 0x1209（pid.codes 社区为开源项目保留的 VID）。

### 配置与端点描述符的关键字段

配置描述符：

| 字段 | 含义 |
|------|------|
| `bNumInterfaces` | 此配置包含的接口数量 |
| `bConfigurationValue` | SET_CONFIGURATION 时要填的配置号 |
| `bmAttributes` | Bit 7 固定为 1，Bit 6 = 自供电，Bit 5 = 支持远程唤醒 |
| `bMaxPower` | 设备从总线取电的上限，单位 2mA（USB 2.0）或 8mA（USB 3.0） |

端点描述符：

| 字段 | 位布局 | 含义 |
|------|--------|------|
| `bEndpointAddress` | Bit 7：0=OUT、1=IN；Bit 3..0：端点号 | 如 0x81 = EP1-IN |
| `bmAttributes` | Bit 1..0：00=Control、01=Isochronous、10=Bulk、11=Interrupt | 传输类型 |
| `wMaxPacketSize` | 最大包大小（字节） | HS 的 Bulk 端点为 512，FS 为 64 |
| `bInterval` | 轮询间隔 | 仅中断/同步端点有意义 |

> 四种传输类型：Control（控制）用于枚举与设备管理，双向可靠；Interrupt（中断）用于小数据、低延迟的周期上报，如键盘按键；Bulk（批量）用于大数据量、无实时要求的传输，如 U 盘读写，总线空闲时才调度；Isochronous（同步）用于恒定速率、允许偶尔丢包的场景，如摄像头图像、音频流——不重传，因为重传一帧旧画面没有意义。

## 标准设备类：驱动匹配的钥匙

接口描述符的 Class/SubClass/Protocol 三字段声明了这项功能遵循的标准类别。遵循标准类的设备不需要厂商提供专用驱动，内核里的通用类驱动直接接管：

| Class | SubClass | Protocol | 典型设备 | Linux 驱动 |
|-------|----------|----------|----------|-----------|
| `0x01` Audio | 0x01 | 0x00 | USB 声卡、耳机 | `snd-usb-audio` |
| `0x02` CDC-Control | 0x02 (ACM) | 0x01 | USB 转串口（控制面） | `cdc_acm` |
| `0x0A` CDC-Data | 0x00 | 0x00 | USB 转串口（数据面） | `cdc_acm`（与 0x02 配对） |
| `0x03` HID | 0x01 (Boot) | 0x01/0x02 | 键盘、鼠标、手柄 | `usbhid` |
| `0x08` Mass Storage | 0x06 (SCSI) | 0x50 (Bulk-Only) | U 盘、读卡器、移动硬盘 | `usb-storage` |
| `0x0E` Video | 0x01/0x03 | 0x00 | USB 摄像头（UVC） | `uvcvideo` |
| `0xE0` Wireless | 0x01 | 0x01 | 蓝牙适配器 | `btusb` |
| `0xFF` Vendor Specific | 任意 | 任意 | 厂商自定义设备 | 需专属驱动 |

> 💡 CDC-ACM 虚拟串口设备通常有两个接口：接口 0 是 `0x02/0x02/0x01`（CDC 控制，管理串口参数和线路状态），接口 1 是 `0x0A/0x00/0x00`（CDC 数据，实际收发字节流）。两者通过 **IAD（Interface Association Descriptor）** 声明"我们是一伙的"。在 `lsusb -v` 里看到这个组合，就可以断定这是一个 USB 转串口设备。

## 实战：解读一个真实 U 盘的描述符

下面是一个 SanDisk U 盘的 `lsusb -v` 完整输出（已按层次缩进），对照上面各表逐字段看：

```bash
lsusb -v -d 0781:5567
```

```
Bus 001 Device 008: ID 0781:5567 SanDisk Corp. Cruzer Blade
Device Descriptor:
  bLength                18           # 描述符长度
  bDescriptorType         1           # 设备描述符
  bcdUSB               2.00           # USB 2.0
  bDeviceClass            0           # 类别在接口级定义
  bDeviceSubClass         0
  bDeviceProtocol         0
  bMaxPacketSize0        64           # EP0 包大小 64 字节
  idVendor           0x0781 SanDisk   # 厂商 ID
  idProduct          0x5567           # 产品 ID
  bcdDevice            1.00           # 固件版本 1.00
  iManufacturer           1 SanDisk
  iProduct                2 Cruzer Blade
  iSerial                 3 4C530001...
  bNumConfigurations      1           # 只有 1 种配置
  Configuration Descriptor:
    bLength                 9
    bDescriptorType         2
    wTotalLength       0x0020         # 整个配置共 32 字节
    bNumInterfaces          1         # 1 个接口
    bConfigurationValue     1
    bmAttributes         0x80         # 总线供电
    bMaxPower             200mA       # 取电上限 200mA
    Interface Descriptor:
      bLength                 9
      bDescriptorType         4
      bInterfaceNumber        0
      bAlternateSetting       0
      bNumEndpoints           2       # 2 个端点
      bInterfaceClass         8 Mass Storage   # 大容量存储类
      bInterfaceSubClass      6 SCSI
      bInterfaceProtocol     80 Bulk-Only
      Endpoint Descriptor:                     # EP1-BULK OUT
        bLength                 7
        bDescriptorType         5
        bEndpointAddress     0x01  EP 1 OUT
        bmAttributes            2  Transfer Type Bulk
        wMaxPacketSize     0x0200  512 bytes
      Endpoint Descriptor:                     # EP2-BULK IN
        bLength                 7
        bDescriptorType         5
        bEndpointAddress     0x82  EP 2 IN
        bmAttributes            2  Transfer Type Bulk
        wMaxPacketSize     0x0200  512 bytes
```

从这段输出能读出完整故事：这是一个 USB 2.0 的 U 盘，总线供电，最大取电 200mA；只有一个配置、一个接口，接口类别是 Mass Storage / SCSI / Bulk-Only，所以内核会用 `usb-storage` 驱动接管；数据走两个 Bulk 端点——EP1-OUT 接收主机下发的 SCSI 命令和数据，EP2-IN 回传数据和状态，每包 512 字节。

## 排障：枚举失败怎么查

设备插上没反应时，按下面的顺序收集证据，每一步都能把问题范围缩小一半：

```bash
# 1. 看内核日志——有没有连接事件，卡在哪一步
dmesg | tail -20
```

```
[  +0.002345] usb 1-1: new high-speed USB device number 5 using xhci_hcd
[  +0.012345] usb 1-1: device descriptor read/64, error -71   <-- 枚举中断
```

第一行说明连接检测和复位成功了（主机已经识别到速度并发起枚举）；第二行说明读设备描述符失败，问题定位在第 ④ 步，多半是设备固件响应异常或信号质量问题。

```bash
# 2. 用 usbmon 抓包，看设备到底回了什么（还是什么都没回）
cat /sys/kernel/debug/usb/usbmon/1u | head -50

# 3. 如果能读到部分描述符，详细查看
lsusb -v -d xxxx:xxxx | less

# 4. 查看 USB 拓扑，确认设备挂在哪个 Hub 的哪个口
lsusb -t
```

常见错误码对照：

| 错误码 | 含义 | 典型根因 |
|--------|------|----------|
| `-71` EPROTO | 协议错误 | `bMaxPacketSize0` 与实际不符、设备固件未按规范响应 Setup |
| `-32` EPIPE | 端点停滞 | 设备固件对控制传输回了 STALL |
| `-110` ETIMEDOUT | 超时 | 设备在规定时间内没有任何响应 |
| `-84` EILSEQ | CRC 错误 | 信号完整性问题：线缆过长/劣质、ESD 损伤、阻抗不匹配 |
| `-62` EIO | I/O 错误 | 物理层故障，先换线换口排除 |

排障经验：dmesg 里只有 `new high-speed USB device` 而没有任何后续，问题在设备固件（没响应 Setup）；能看到描述符但驱动没绑定，查 VID/PID 是否在驱动 ID 表里；间歇性失败（时好时坏）优先怀疑线缆、接触和供电，而不是软件。

> 💡 抓包时给电脑插一个 USB Hub，目标设备接在 Hub 上，其他设备都拔掉，用 `usbmon` 指定该 Hub 所在总线号，可以只捕获目标设备的枚举流量，避免被键鼠等设备的周期中断传输淹没。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 枚举流程 | 按顺序说出枚举 8 步，并指出每步失败时枚举停在哪里 |
| 控制传输 | 画出一次控制传输的 Setup/Data/Status 三阶段交互 |
| 描述符层次 | 说明设备→配置→接口→端点四层关系，解释驱动为什么绑在接口上 |
| 关键字段 | 指出 `bMaxPacketSize0`、VID/PID、`bInterfaceClass` 各自影响什么 |
| 输出解读 | 拿到一段 `lsusb -v` 输出，能还原出设备的速度、供电、接口类别和端点布局 |
| 排障 | 设备不识别时，用 dmesg + usbmon + lsusb 三步定位失败环节 |

## 配套资源

- USB 2.0 Specification（usb.org 官方）：第 8 章描述符、第 9 章设备框架（枚举全流程）
- usbmon 内核文档：`Documentation/usb/usbmon.rst`
- lsusb 源码（usbutils 包）：https://github.com/gregkh/usbutils
- Wireshark USB 抓包指南：https://wiki.wireshark.org/CaptureSetup/USB
- 《Linux Device Drivers》第 3 版第 13 章：USB Drivers
