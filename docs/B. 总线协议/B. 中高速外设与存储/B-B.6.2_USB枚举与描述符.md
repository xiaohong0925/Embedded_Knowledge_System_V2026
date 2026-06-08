# B-B.6.2 USB枚举与描述符

> 所属章节：第五部 B. 总线协议 > B-B.6 USB子系统
>
> 难度：[I] Intermediate | [M] Master | 预计阅读时间：25分钟

## <span class="blue"> 本节导读

当你把U盘插入电脑，或者把手机接到充电头上，你有没有想过，系统是怎么知道"来了一个新设备"、"这是个什么东西"、"它有几个功能"、"每个功能用什么方式通信"的？这一整套"握手认识"的过程，就是USB的**枚举（Enumeration）**。枚举是USB协议中最核心、最精妙的流程之一——8个步骤环环相扣，任何一步出错，设备就会被系统拒之门外。

本节将用协议分析仪的视角，把枚举8步的每一个控制传输拆开给你看。你还会学到描述符的完整层次结构，学会用`lsusb -v`解读设备的"身份证"。无论你是调试设备不识别的问题，还是写USB gadget驱动，这些知识都是你的基本功。

<br>

## <span class="blue"> 知识点303：USB枚举8步详解 [I][M]

### 什么是枚举？

枚举就是主机（Host）和新插入的USB设备从"素不相识"到"建立通信"的完整过程。本质上，主机通过一系列**控制传输**（Control Transfer）读取设备的描述符，给它分配资源，最终加载对应的驱动。

USB枚举有一个硬性规定：**枚举期间的所有通信，都通过端点0（EP0）进行**。端点0是USB设备中唯一无需配置就必须存在的双向端点，专门用于控制传输。

> 💡 **提示**：枚举期间的地址默认为0。在Set Address之前，总线上只能有一个地址为0的设备——这就是为什么USB Hub会逐个端口启用设备。

<br>

### 枚举8步总览

| 步骤 | 主机发送 | 设备返回 | 目的 |
|------|---------|---------|------|
| ① 连接检测 | 检测D+/D-上拉 | 信号电平变化 | 发现设备连接，判断速度模式 |
| ② 总线复位 | Hub下发RESET信号（10ms+） | 设备复位到默认状态 | 设备进入默认状态，地址=0 |
| ③ 地址分配 | `SET_ADDRESS` | ACK | 给设备分配唯一地址（1~127） |
| ④ 获取设备描述符 | `GET_DESCRIPTOR`（Device） | 设备描述符（18字节） | 了解设备基本信息、bMaxPacketSize0 |
| ⑤ 获取配置描述符 | `GET_DESCRIPTOR`（Configuration） | 配置描述符+接口+端点 | 了解设备功能结构和资源需求 |
| ⑥ 获取接口/端点描述符 | 继续`GET_DESCRIPTOR` | 接口/端点描述符 | 细化每个功能的通信参数 |
| ⑦ 获取字符串描述符 | `GET_DESCRIPTOR`（String） | 字符串描述符 | 获取可读的产品/厂商名称 |
| ⑧ 设置配置 | `SET_CONFIGURATION` | ACK | 激活配置，设备进入工作状态 |

<br>

### 枚举时序：控制传输的握手细节

USB的每个控制传输都由3个阶段组成：Setup → Data → Status。下面以**第④步获取设备描述符**为例，画出完整的总线交互：

```
 主机(Hub)                                  设备
    |                                         |
    |===== SETUP Token (ADDR=0, EP=0) ======>|  ① Setup令牌包
    |                                         |
    |===== DATA0 (8字节Setup数据) ==========>|  ② 包含bmRequestType/bRequest/wValue
    |   bRequest = GET_DESCRIPTOR             |     wValue = DEVICE (0x0100)
    |   wLength = 8 or 18                     |     wIndex = 0, wLength = 18
    |                                         |
    |<===== ACK ==============================|  ③ 设备ACK确认收到Setup
    |                                         |
    |<===== DATA1 (设备描述符前8字节) ========|  ④ 设备返回描述符数据
    |   bLength = 18                          |
    |   bDescriptorType = 1                   |
    |   bcdUSB = 0x0200                       |
    |   bMaxPacketSize0 = 64  <-- 关键字段!   |
    |                                         |
    |===== ACK ==============================>|  ⑤ 主机ACK确认收到数据
    |                                         |
    |===== OUT Token (ADDR=0, EP=0) =========>|  ⑥ Status阶段：零长度数据包
    |===== DATA1 (0字节) ====================>|     表示主机状态阶段
    |                                         |
    |<===== ACK ==============================|  ⑦ 设备ACK，传输完成
    |                                         |

    [ 整个控制传输完成，主机已获得设备描述符 ]
```

<br>

### 步骤详解

#### ① 连接检测：D+上拉的秘密

USB设备在插入时，会通过一个**1.5kΩ电阻**将D+或D-上拉到3.3V。这个简单的电路动作，是设备向世界宣告"我来了"的方式：

| 上拉方式 | 速度模式 | 说明 |
|---------|---------|------|
| D+ 上拉1.5kΩ | Full-Speed（12Mbps） | 最常见的低速/全速设备 |
| D- 上拉1.5kΩ | Low-Speed（1.5Mbps） | 键盘、鼠标等低速设备 |
| D+ 无外部上拉，靠chirp协商 | High-Speed（480Mbps） | 设备先以全速连接，再协商升速 |

> ⚠️ **陷阱**：设备描述符中`bMaxPacketSize0`必须在地址分配前就是正确的值！如果设备报告8字节但实际支持64字节（或反过来），主机会用错误的包大小继续通信，导致后续所有传输失败。这是自制USB设备最常见的bug之一。

<br>

#### ② 总线复位

Hub向设备发送至少10ms的SE0信号（D+和D-同时为低）。设备收到复位后：
- 地址回到默认值0
- 端点0的DATA toggle回到DATA0
- 配置值回到0（未配置状态）
- 如果是High-Speed设备，开始chirp序列协商速度

<br>

#### ③ 地址分配（SET_ADDRESS）

```
Setup包内容：
  bmRequestType = 0x00 (Host→Device, 标准请求, 设备接收)
  bRequest      = 0x05 (SET_ADDRESS)
  wValue        = 新地址 (1~127)
  wIndex        = 0
  wLength       = 0
```

主机分配1~127之间的唯一地址。**注意**：设备必须在Status阶段ACK后的2ms内切换到新地址。如果切换失败，设备会从总线上"消失"。

<br>

#### ④ 获取设备描述符

```
Setup包内容：
  bmRequestType = 0x80 (Device→Host, 标准请求, 设备接收)
  bRequest      = 0x06 (GET_DESCRIPTOR)
  wValue        = 0x0100 (Device描述符, Index=0)
  wIndex        = 0
  wLength       = 64 或 18 (先请求8字节获取bMaxPacketSize0)
```

这里有一个技巧：主机通常**先只请求8字节**。因为不知道设备的包大小，先用默认的8字节安全请求。拿到`bMaxPacketSize0`后，再用正确的包大小完整请求18字节设备描述符。

<br>

#### ⑤~⑥ 获取配置/接口/端点描述符

配置描述符请求比较特殊——它**一次性返回整个描述符层次**：配置描述符 + 所有接口描述符 + 所有端点描述符，全部打包在一起。

```
Setup包：
  wValue = 0x0200 (Configuration描述符)
  wLength = 先请求9字节(仅配置头)，再请求wTotalLength字节(全部)
```

返回的数据布局如下（以一个简单的CDC串口设备为例）：

```
+-------------------+ 偏移0, 长度9
| 配置描述符        | bLength=9, wTotalLength=67
+-------------------+ 偏移9, 长度9
| IAD描述符         | (CDC设备特有，联合接口)
+-------------------+ 偏移18, 长度9
| 接口0描述符       | bInterfaceClass=0x02 (CDC)
+-------------------+ 偏移27, 长度5
| 端点0描述符(CDC)  | bEndpointAddress=0x83 (IN, EP3)
+-------------------+ 偏移32, 长度9
| 接口1描述符       | bInterfaceClass=0x0A (CDC-Data)
+-------------------+ 偏移41, 长度7
| 端点1描述符(Data) | bEndpointAddress=0x01 (OUT, EP1)
+-------------------+ 偏移48, 长度7
| 端点2描述符(Data) | bEndpointAddress=0x82 (IN, EP2)
+-------------------+ 偏移55, 长度...
| 额外描述符...     |
+-------------------+
```

<br>

#### ⑦ 获取字符串描述符

字符串描述符是可选但强烈建议的——它们提供了人类可读的产品名称、厂商名称、序列号。`lsusb`显示的厂商名和产品名就来自这里。

```
Setup包：
  wValue = 0x0300 (String描述符, Index=0 → 语言ID列表)
  wValue = 0x0301 (String描述符, Index=1 → 厂商字符串)
```

<br>

#### ⑧ 设置配置（SET_CONFIGURATION）

```
Setup包：
  bmRequestType = 0x00
  bRequest      = 0x09 (SET_CONFIGURATION)
  wValue        = bConfigurationValue (通常是1)
```

这最后一步就像按下"启动按钮"。设备收到后激活指定配置，所有非0端点开始工作，设备正式进入**已配置状态（Configured State）**。此时，主机会根据接口描述符中的Class/SubClass/Protocol匹配并加载对应的驱动。

<br>

> 💡 **提示**：用`usbmon`抓包看枚举过程是排查设备不被识别的利器。内核开启`CONFIG_USB_MON`后，通过`/sys/kernel/debug/usb/usbmon`读取原始URB数据。Wireshark也可以直接打开usbmon的pcap文件，图形化地显示每一步的Setup/Data/ACK交互。

```bash
# 挂载debugfs并开启usbmon
$ sudo mount -t debugfs none /sys/kernel/debug
$ sudo modprobe usbmon

# 查看总线列表，找到你的设备所在总线（如bus 1）
$ ls /sys/kernel/debug/usb/usbmon
0s  0u  1s  1t  1u  2s  2t  2u

# 抓取bus 1上的所有USB通信（16进制格式）
$ sudo cat /sys/kernel/debug/usb/usbmon/1u
# 或使用tcpdump保存为pcap文件，用Wireshark分析
$ sudo tcpdump -i usbmon1 -w usb_enum.pcap
```

<br>

## <span class="blue"> 知识点304：USB描述符详解 [I][M]

### 描述符层次结构

USB设备的描述符是一个严格的**树形层次结构**。每个设备有且只有一个设备描述符，向下展开到配置、接口、端点：

```
                    ┌──────────────────────┐
                    │    设备描述符         │ 1个
                    │  (Device Descriptor) │
                    │  bNumConfigurations │
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

<br>

### 四大描述符对比

| 描述符 | 大小(字节) | 关键字段 | 用途 |
|--------|-----------|---------|------|
| **设备描述符** | 18 | `bcdUSB`, `bDeviceClass`, `bMaxPacketSize0`, `idVendor`, `idProduct`, `bNumConfigurations` | 设备级信息：USB版本、厂商ID、产品ID、包大小 |
| **配置描述符** | 9 | `bNumInterfaces`, `bConfigurationValue`, `bmAttributes`, `bMaxPower` | 电源属性、配置标识、包含多少接口 |
| **接口描述符** | 9 | `bInterfaceClass`, `bInterfaceSubClass`, `bInterfaceProtocol` | 功能分类：决定加载哪个驱动 |
| **端点描述符** | 7 | `bEndpointAddress`, `bmAttributes`, `wMaxPacketSize`, `bInterval` | 通信参数：方向、类型、包大小、轮询间隔 |

<br>

### 设备描述符字段详解

| 字段 | 偏移 | 大小 | 示例值 | 含义 |
|------|------|------|--------|------|
| `bLength` | 0 | 1 | 0x12 | 描述符长度 = 18字节 |
| `bDescriptorType` | 1 | 1 | 0x01 | 设备描述符类型 |
| `bcdUSB` | 2 | 2 | 0x0200 | USB 2.0规范 |
| `bDeviceClass` | 4 | 1 | 0x00 | 由接口指定Class（复合设备常见） |
| `bDeviceSubClass` | 5 | 1 | 0x00 | 子类 |
| `bDeviceProtocol` | 6 | 1 | 0x00 | 协议 |
| `bMaxPacketSize0` | 7 | 1 | 0x40 | EP0最大包大小 = 64字节 |
| `idVendor` | 8 | 2 | 0x046D | 厂商ID（Logitech） |
| `idProduct` | 10 | 2 | 0xC52B | 产品ID |
| `bcdDevice` | 12 | 2 | 0x0100 | 设备版本号 |
| `iManufacturer` | 14 | 1 | 0x01 | 厂商字符串索引 |
| `iProduct` | 15 | 1 | 0x02 | 产品字符串索引 |
| `iSerialNumber` | 16 | 1 | 0x00 | 无序列号 |
| `bNumConfigurations` | 17 | 1 | 0x01 | 1种配置 |

<br>

### 配置描述符关键字段

| 字段 | 含义 |
|------|------|
| `bNumInterfaces` | 此配置包含的接口数量 |
| `bConfigurationValue` | Set Configuration时使用的配置号 |
| `bmAttributes` | Bit 7=保留1, Bit 6=自供电, Bit 5=远程唤醒 |
| `bMaxPower` | 最大电流 = 值 × 2mA（USB2.0）或 × 8mA（USB3.0） |

### 端点描述符关键字段

| 字段 | 位布局 | 含义 |
|------|--------|------|
| `bEndpointAddress` | Bit 7: 0=OUT, 1=IN; Bit 3..0: 端点号 | 如 0x81 = EP1-IN |
| `bmAttributes` | Bit 1..0: 00=Control, 01=Isochronous, 10=Bulk, 11=Interrupt | 传输类型 |
| `wMaxPacketSize` | 最大数据包大小（字节） | BULK端点通常512（HS）/64（FS） |
| `bInterval` | 轮询间隔（ms或微帧） | 中断/同步端点才有效 |

<br>

### 标准USB设备类速查表

USB设备通过接口描述符的`bInterfaceClass`字段声明自己的功能类别。以下是嵌入式Linux开发中最常见的设备类：

| Class | SubClass | Protocol | 典型设备 | Linux驱动 |
|-------|----------|----------|----------|-----------|
| `0x01` Audio | 0x01 (Control) | 0x00 | USB声卡、耳机 | `snd-usb-audio` |
| `0x02` CDC-Control | 0x02 (ACM) | 0x01 (AT) | USB转串口（ACM） | `cdc_acm` |
| `0x03` HID | 0x01 (Boot) | 0x01/0x02 | 键盘、鼠标、游戏手柄 | `usbhid` |
| `0x08` Mass Storage | 0x06 (SCSI) | 0x50 (Bulk) | U盘、SD读卡器、硬盘 | `usb-storage` |
| `0x0A` CDC-Data | 0x00 | 0x00 | CDC串口的数据通道 | `cdc_acm`（与0x02配对） |
| `0x0E` Video | 0x01 | 0x00 | USB摄像头（UVC） | `uvcvideo` |
| `0x0E` Video | 0x03 (Control) | 0x00 | 摄像头控制接口 | `uvcvideo` |
| `0xE0` Wireless | 0x01 | 0x01 | 蓝牙适配器 | `btusb` |
| `0xFF` Vendor Specific | 任意 | 任意 | 厂商自定义设备 | 需专属驱动 |

> 💡 **提示**：CDC-ACM串口设备通常有**两个接口**：接口0是`0x02/0x02/0x01`（CDC控制，管理线状态），接口1是`0x0A/0x00/0x00`（CDC数据，实际收发数据）。这两个接口通过**IAD（Interface Association Descriptor）** 描述符关联在一起。看到这种组合，你就知道它是一个USB转串口设备。

<br>

### 用lsusb -v解读描述符

下面是一个真实的U盘设备描述符解读示例（`lsusb -v -d 0781:5567`）：

```bash
$ lsusb -v -d 0781:5567

Bus 001 Device 008: ID 0781:5567 SanDisk Corp. Cruzer Blade
Device Descriptor:
  bLength                18          # 描述符长度
  bDescriptorType         1          # 设备描述符
  bcdUSB               2.00          # USB 2.0
  bDeviceClass            0           # 由接口定义Class
  bDeviceSubClass         0
  bDeviceProtocol         0
  bMaxPacketSize0        64           # EP0包大小64字节
  idVendor           0x0781 SanDisk   # 厂商ID
  idProduct          0x5567            # 产品ID
  bcdDevice            1.00            # 固件版本1.00
  iManufacturer           1 SanDisk    # 厂商名（字符串索引1）
  iProduct                2 Cruzer Blade  # 产品名
  iSerial                 3 4C530001... # 序列号
  bNumConfigurations      1             # 只有1种配置
  Configuration Descriptor:
    bLength                 9
    bDescriptorType         2
    wTotalLength       0x0020           # 整个配置共32字节
    bNumInterfaces          1            # 1个接口
    bConfigurationValue     1            # 配置值为1
    iConfiguration          0            # 无配置名
    bmAttributes         0x80            # Bit7=1（总线供电）
    bMaxPower             200mA          # 最大电流200mA
    Interface Descriptor:
      bLength                 9
      bDescriptorType         4
      bInterfaceNumber        0            # 接口编号0
      bAlternateSetting       0
      bNumEndpoints           2            # 2个端点
      bInterfaceClass         8 Mass Storage  # U盘！
      bInterfaceSubClass      6 SCSI
      bInterfaceProtocol     80 Bulk-Only    # BOT协议
      iInterface              0
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

<br>

### 字段解读速查

| lsusb输出 | 对应描述符字段 | 实际意义 |
|-----------|--------------|----------|
| `bcdUSB 2.00` | `bcdUSB` | 设备兼容USB 2.0规范 |
| `bDeviceClass 0` | `bDeviceClass` | 功能在接口级别定义（可能是复合设备） |
| `bMaxPacketSize0 64` | `bMaxPacketSize0` | 控制传输每包最大64字节 |
| `idVendor/idProduct` | VID/PID | 系统匹配驱动的关键标识 |
| `bNumInterfaces 2` | `bNumInterfaces` | 此配置包含2个功能接口 |
| `bmAttributes 0x80` | `bmAttributes` | 0x80=总线供电；0xC0=自供电；0xA0=远程唤醒 |
| `bMaxPower 200mA` | `bMaxPower` | 枚举期间请求的电流上限 |
| `bInterfaceClass 8 Mass Storage` | `bInterfaceClass` | 大容量存储类 → 匹配`usb-storage`驱动 |
| `bEndpointAddress 0x82` | `bEndpointAddress` | 端点号2，方向IN（数据发往主机） |
| `bmAttributes 2 Bulk` | `bmAttributes` | BULK传输类型，适合大块数据传输 |
| `wMaxPacketSize 512` | `wMaxPacketSize` | High-Speed BULK端点标准包大小 |

<br>

### 调试实战：枚举失败的排查思路

当你的USB设备插入Linux系统但不被识别时，按以下顺序排查：

```bash
# 1. 看内核日志 —— 是否有设备连接事件
$ dmesg | tail -20
[  +0.002345] usb 1-1: new high-speed USB device number 5 using xhci_hcd
[  +0.012345] usb 1-1: device descriptor read/64, error -71   <-- 出错了！

# 错误-71 = EPROTO = 协议错误，通常是枚举握手失败

# 2. 用usbmon抓包看原始数据
$ sudo cat /sys/kernel/debug/usb/usbmon/1u | head -50

# 3. 详细查看设备描述符（如果能读到部分）
$ lsusb -v -d xxxx:xxxx 2>&1 | less

# 4. 查看USB拓扑结构
$ lsusb -t
/:  Bus 02.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/6p, 5000M
    |__ Port 1: Dev 5, If 0, Class=Mass Storage, Driver=usb-storage, 5000M
```

常见枚举失败原因对照：

| 错误码 | 含义 | 可能原因 |
|--------|------|----------|
| `-71` EPROTO | 协议错误 | bMaxPacketSize0不匹配、Setup响应超时 |
| `-32` EPIPE | 端点暂停 | 设备固件未正确响应控制传输 |
| `-110` ETIMEDOUT | 超时 | 设备未在指定时间内响应ACK |
| `-62` EIO | I/O错误 | 物理信号问题、线缆不良、ESD损伤 |
| `-84` EILSEQ | CRC错误 | 信号完整性问题、线缆过长 |

<br>

## <span class="blue"> 本节总结

| 要点 | 内容摘要 |
|------|---------|
| **枚举本质** | 主机通过EP0用控制传输读取设备描述符、分配地址、激活配置的过程 |
| **枚举8步** | 连接检测→复位→Set Address→设备描述符→配置描述符→接口/端点→字符串→Set Configuration |
| **控制传输结构** | 每个控制传输 = Setup包 + Data包 + ACK包，三个阶段的完整握手 |
| **描述符层次** | 设备(1) → 配置(1..N) → 接口(1..N) → 端点(0..N)，严格树形结构 |
| **Class决定驱动** | bInterfaceClass决定Linux匹配哪个驱动（如0x08→usb-storage，0x0E→uvcvideo） |
| **关键陷阱** | bMaxPacketSize0在Set Address前就必须正确，否则后续通信全部失败 |
| **调试利器** | usbmon + Wireshark = 图形化分析枚举过程；dmesg + lsusb = 快速诊断 |

<br>

## <span class="blue"> 下一步

下一节**B-B.6.3 USB Linux Host驱动**，我们将从协议层跃升到内核层：了解Linux USB子系统的核心数据结构（`usb_device`、`usb_driver`、`urb`）、USB Gadget Framework的内核实现，以及如何编写一个从设备树到用户空间完整打通的USB设备驱动。你还将亲手配置一个树莓派作为USB Gadget（模拟U盘或虚拟串口），体验从设备端的视角。

<br>

## <span class="blue"> 配套资源

- USB 2.0 Specification（USB.org官方）：https://www.usb.org/document-library/usb-20-specification
- usbmon内核文档：`Documentation/usb/usbmon.rst`
- `lsusb`源码：usbutils包 https://github.com/gregkh/usbutils
- Wireshark USB抓包指南：https://wiki.wireshark.org/CaptureSetup/USB
- 《Linux Device Drivers》第13章：USB Drivers

<br>

> 💡 **提示**：建议准备一个便宜的USB Hub和一根USB延长线，把Hub接在电脑上，目标设备插在Hub上。这样抓包时可以用`usbmon`指定Hub的总线号，捕获目标设备的完整枚举过程而不会被其他USB设备的流量干扰。
