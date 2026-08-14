# B-D.10.2 PCIe枚举与配置空间

> 所属章节：第五部 B. 总线协议 > B-D.10 PCIe总线
>
> 难度：[E] Expert / [M] Master | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

上一节我们了解了PCIe的物理层和链路训练，但那只是"修路"的过程。路修好了，CPU怎么才能知道这条路上连了哪些设备、各自需要什么资源？这就是**枚举（Enumeration）**和**配置空间（Configuration Space）**要解决的问题。

本节你将深入理解：

- Root Complex如何从零开始扫描整个PCIe拓扑树
- BDF（Bus/Device/Function Number）寻址体系的本质
- 配置空间的256字节/4KB布局结构
- BAR（Base Address Register）的机制与陷阱
- Capability链表的遍历方法

枚举是PCIe体系中最精妙的设计之一——它是一套**自描述、自配置**的协议，让操作系统无需硬编码就能识别任意PCIe设备。

---

## <span class="blue"> 知识点348：PCIe枚举与BDF寻址 [E][M]

### 为什么需要枚举

想象一下，你刚启动一块全新的ARM开发板，PCIe插槽上插着NVMe SSD和USB扩展卡。CPU复位后，它对这些设备一无所知——不知道存在什么设备，不知道需要多少内存，不知道中断需求。枚举就是CPU" census（人口普查）"的过程。

### 枚举的发起者：Root Complex

在PCIe拓扑中，**Root Complex（RC）**是绝对的"根"。它内部包含一个Host Bridge，负责：

1. 发起配置读写请求（CfgRd0/CfgRd1、CfgWr0/CfgWr1）
2. 将CPU的MMIO访问转换为PCIe事务层包（TLP）
3. 管理整个PCIe域的地址映射

枚举正是由RC在系统初始化阶段（UEFI/BIOS或Linux内核早期）主动发起的。

### 枚举过程：深度优先扫描

枚举的核心算法是**深度优先搜索（DFS）**。RC从Bus 0开始，逐层向下探测：

```
阶段1：RC发现Root Port（总线0上的PCIe控制器）
       → 给Root Port的Secondary Bus分配Bus号

阶段2：扫描新Bus上的所有Device（0-31号设备槽位）
       → 对每个Device，读取Vendor ID
       → 若Vendor ID != 0xFFFF，说明设备存在

阶段3：发现Switch/Bridge
       → 为其下游分配新的Bus号
       → 递归进入新Bus继续扫描

阶段4：发现Endpoint（如NVMe、网卡）
       → 记录其BDF、BAR需求、中断信息

阶段5：分配资源
       → 根据所有BAR的大小总和分配MMIO/I/O空间
       → 写入BAR基地址
       → 配置Command寄存器使能设备
```

BDF编码是16位的：

```
[15:8]  Bus Number    (8bit)  → 最多256条总线
[ 7:3]  Device Number (5bit)  → 每条总线最多32个设备
[ 2:0]  Function Number (3bit) → 每个设备最多8个功能
```

一个典型的嵌入式系统拓扑：

```
0000:00:00.0  Root Complex（RC本身，通常不显示）
├── 00:01.0  Root Port 0  ──→ Bus 1
│                              └── 01:00.0  NVMe SSD（Endpoint）
└── 00:02.0  Root Port 1  ──→ Bus 2
                               └── 02:00.0  PCIe Switch
                                   ├── 03:00.0  USB 3.0控制器
                                   └── 04:00.0  千兆网卡
```

### 配置空间的层级结构

每个PCIe功能（Function）都包含一份配置空间，分为三个区域：

| 区域 | 偏移范围 | 大小 | 说明 |
|:---:|:---:|:---:|:---|
| **Header** | 0x00 - 0x3F | 64字节 | 所有PCI/PCIe设备必须实现 |
| **Capability链表** | 0x40 - 0xFF | 192字节 | 标准Capability结构 |
| **Extended Capability链表** | 0x100 - 0xFFF | 3.75KB | PCIe扩展Capability |

配置空间的访问方式有两种：

- **Configuration Access Type 0**：用于访问**同一总线**上的目标设备（目标Bus = 当前Bus）
- **Configuration Access Type 1**：用于通过Bridge访问**下游总线**的设备（目标Bus ≠ 当前Bus）

Bridge收到Type 1请求后，如果目标Bus在其Secondary/Subordinate范围内，会将其转换为Type 0转发给下游设备。

---

## <span class="blue"> 知识点349：关键寄存器与Capability链表 [E][M]

### 配置空间Header布局

PCIe配置空间的前64字节Header分为Type 0（Endpoint）和Type 1（Bridge/Switch）两种格式。以下是Type 0 Header的完整布局：

### 表格：PCIe配置空间布局（Type 0 Header）

| 偏移 | 大小 | 字段名 | 说明 |
|:---:|:---:|:---|:---|
| 0x00 | 2B | **Vendor ID** | 厂商标识，如0x8086=Intel，0x10EC=Realtek |
| 0x02 | 2B | **Device ID** | 设备标识，由厂商定义 |
| 0x04 | 2B | Command | 设备全局控制位（IO/Memory Space使能、Bus Master等） |
| 0x06 | 2B | Status | 设备状态位（中断状态、能力链表存在位等） |
| 0x08 | 1B | Revision ID | 设备版本号 |
| 0x09 | 3B | Class Code | 设备类别码：[23:16]=Base Class，[15:8]=Sub Class，[7:0]=Interface |
| 0x0C | 1B | Cache Line Size | 缓存行大小（以32字节为单位） |
| 0x0D | 1B | Latency Timer | 传统PCI保留，PCIe中写0 |
| 0x0E | 1B | Header Type | [7]=多功能设备标志，[6:0]=Header类型（0=Type0，1=Type1） |
| 0x0F | 1B | BIST | 内建自测寄存器 |
| 0x10 | 4B | **BAR0** | 基址寄存器0 |
| 0x14 | 4B | **BAR1** | 基址寄存器1（或BAR0的高32位） |
| 0x18 | 4B | **BAR2** | 基址寄存器2 |
| 0x1C | 4B | **BAR3** | 基址寄存器3（或BAR2的高32位） |
| 0x20 | 4B | **BAR4** | 基址寄存器4 |
| 0x24 | 4B | **BAR5** | 基址寄存器5（或BAR4的高32位） |
| 0x28 | 4B | CardBus CIS Pointer | CardBus指针，PCIe不使用 |
| 0x2C | 2B | Subsystem Vendor ID | 子系统厂商ID |
| 0x2E | 2B | Subsystem Device ID | 子系统设备ID |
| 0x30 | 4B | Expansion ROM Base | 扩展ROM基址 |
| 0x34 | 1B | **Capabilities Pointer** | 指向第一个Capability的偏移 |
| 0x35-0x3B | - | Reserved | 保留 |
| 0x3C | 1B | Interrupt Line | 连接的中断线（PIC模式下的IRQ号） |
| 0x3D | 1B | Interrupt Pin | 中断引脚（1=INTA#，2=INTB#，3=INTC#，4=INTD#） |
| 0x3E | 2B | Min/Max Grant | 传统PCI保留，PCIe中写0 |

### 表格：关键寄存器功能速查

| 寄存器 | 偏移 | 功能 | 典型值/位定义 |
|:---:|:---:|:---|:---|
| Vendor ID | 0x00 | 标识设备厂商 | 0x8086(Intel), 0x10EC(Realtek), 0x144D(Samsung) |
| Device ID | 0x02 | 标识具体设备 | 厂商自定义，如0xA808=Intel AX210 WiFi |
| Class Code | 0x08 | 设备功能类别 | 0x010802=NVMe，0x020000=以太网，0x030200=3D显卡 |
| Command | 0x04 | 使能各种功能 | Bit0=IO Space，Bit1=Memory Space，Bit2=Bus Master |
| Status | 0x06 | 反映设备状态 | Bit4=Capabilities List存在，Bit3=中断状态 |
| BAR0-5 | 0x10-0x24 | 请求MMIO/I/O空间 | 低4位为属性位，高28/60位为可编程地址 |
| Cap Ptr | 0x34 | Capability链表头指针 | 指向0x40-0xFF范围内的偏移 |

### Class Code的编码规则

Class Code是操作系统识别设备类型的关键。3字节分别代表：

```
Class Code = [Base Class : Sub Class : Interface]

0x01 0000  → Mass Storage / SCSI
0x01 0001  → Mass Storage / IDE
0x01 0006  → Mass Storage / Serial ATA（AHCI）
0x01 0008  → Mass Storage / NVMe
0x02 0000  → Network / Ethernet
0x02 0080  → Network / Other（无线网卡常在此）
0x03 0000  → Display / VGA
0x03 0002  → Display / 3D Controller
0x0C 0330  → Serial Bus / USB / XHCI
```

Linux内核的`pci.ids`数据库就是靠Vendor ID + Device ID + Class Code来匹配驱动的。

### BAR（Base Address Register）深度解析

BAR是PCIe设备告诉系统"我需要多少地址空间"的机制。每个设备最多6个BAR，每个BAR可以是：

- **32位MMIO空间**：BAR[0]=0，BAR[31:4]=基地址
- **64位MMIO空间**：BAR0+BAR1组合，BAR0[2]=1表示64位，BAR1为高32位
- **I/O空间**：BAR[0]=1，表示I/O端口空间（PCIe中基本淘汰）

BAR的低4位是属性位：

```
Bit 0: 空间类型（0=Memory，1=I/O）
Bit 1: 保留（Memory类型）或保留（I/O类型）
Bit 2: Memory类型时（0=32位，1=64位）
Bit 3: Prefetchable（0=不可预取，1=可预取）
```

### Capability链表结构

PCIe设备通过Capability链表扩展功能。遍历方法：

1. 读取Status寄存器Bit4，确认Capabilities List存在
2. 从Capabilities Pointer（0x34）读取第一个Capability的偏移
3. 每个Capability格式：`[Capability ID:8bit] | [Next Pointer:8bit] | [Data...]`
4. Next Pointer为0x00表示链表结束

### 表格：常见Capability链表

| Capability | ID | 功能说明 |
|:---:|:---:|:---|
| Power Management | 0x01 | 电源管理状态（D0-D3hot/D3cold） |
| AGP | 0x02 | 已淘汰的加速图形端口 |
| VPD | 0x03 | Vital Product Data，存储序列号等信息 |
| Slot Identification | 0x04 | PCI插槽标识 |
| MSI | 0x05 | **Message Signaled Interrupts**，用内存写模拟中断 |
| CompactPCI HotSwap | 0x06 | 热插拔支持 |
| PCI-X | 0x07 | PCI-X扩展 |
| HyperTransport | 0x08 | AMD HyperTransport |
| Vendor Specific | 0x09 | 厂商自定义Capability |
| Debug Port | 0x0A | EHCI调试端口 |
| CompactPCI | 0x0B | CompactPCI中央资源控制 |
| PCI Hot-Plug | 0x0C | PCI热插拔 |
| PCI Bridge Subsystem ID | 0x0D | PCI桥子系统ID |
| AGP 8x | 0x0E | AGP 8x扩展 |
| Secure Device | 0x0F | 可信计算组功能 |
| **PCIe Capability** | **0x10** | **PCIe核心Capability（链路状态、速度、宽度等）** |
| **MSI-X** | **0x11** | **扩展Message Signaled Interrupts，支持多向量** |
| SATA Data/Index Config | 0x12 | SATA配置 |
| Advanced Features | 0x13 | PCI-SIG高级功能 |
| Enhanced Allocation | 0x14 | 增强分配 |
| Flattening Portal | 0x15 | FPB（已淘汰） |

> 🔴 **危险**：BAR里写的地址是**PCI域地址**，不是CPU物理地址！
>
> 在大多数简单系统中，PCI域地址空间被Root Complex直接映射到CPU物理地址空间（1:1映射），所以两者数值相同。但在复杂SoC（如某些ARM服务器芯片）中，Root Complex内部有一个**ATU（Address Translation Unit）**，负责将PCI域地址转换为CPU物理地址。
>
> 在ATU存在的情况下，BAR里的地址加上ATU的偏移才等于CPU物理地址。写驱动时如果用`ioremap()`直接映射BAR地址，必须确认内核已经完成了这个转换——幸运的是，Linux的PCI子系统已经帮你处理好了，通过`pci_resource_start()`获取的地址就是CPU视角的地址。

> 💡 **提示**：判断BAR大小的标准方法是：
> ```
> 1. 保存BAR的原始值
> 2. 向BAR写入0xFFFFFFFF
> 3. 读回BAR的值
> 4. 取反并加1，得到BAR大小
> 5. 恢复BAR原始值
> ```
> 例如：读回0xFFFF0003 → 取反=0x0000FFFC → +1=0x00010000 → BAR大小=64KB
> 低2位的0x3是属性位（Memory空间+64位），不参与大小计算。

---

## <span class="blue"> 用户空间查看工具

### lspci -vvv 输出解读

```bash
$ sudo lspci -vvv -s 01:00.0

# 第一行：BDF + Class Code解码 + 厂商设备名
01:00.0 Non-Volatile memory controller: Samsung Electronics Co Ltd NVMe SSD Controller SM981/PM981 (prog-if 02 [NVM Express])

# Subsystem：子系统厂商和设备ID
        Subsystem: Samsung Electronics Co Ltd Device a801

# Control：Command寄存器的当前值
        Control: I/O- Mem+ BusMaster+ SpecCycle- MemWINV- VGASnoop- ParErr- Stepping- SERR- FastB2B- DisINTx+
        # I/O-  : I/O空间未使能
        # Mem+  : Memory空间已使能
        # BusMaster+ : 设备可作为Bus Master发起DMA

# Status：Status寄存器的当前值
        Status: Cap+ 66MHz- UDF- FastB2B- ParErr- DEVSEL=fast >TAbort- <TAbort- <MAbort- >SERR- <PERR- INTx-
        # Cap+  : Capability链表存在

# Latency和Interrupt
        Latency: 0, Cache Line Size: 64 bytes
        Interrupt: pin A routed to IRQ 16

# Region 0-4：BAR0-4的解码结果
        Region 0: Memory at f4000000 (64-bit, non-prefetchable) [size=16K]
        Region 4: Memory at f4004000 (64-bit, non-prefetchable) [size=256]
        # "64-bit"表示BAR0+BAR1组合成64位地址
        # "non-prefetchable"表示Bit3=0，CPU不能预取此区域

# Capabilities链表展开：
        Capabilities: [80] Power Management version 3
                # 0x80是第一个Capability的偏移
                Flags: PMEClk- DSI- D1- D2- AuxCurrent=0mA PME(D0-,D1-,D2-,D3hot-,D3cold-)
                Status: D0 NoSoftRst+ PME-Enable- DSel=0 DScale=0 PME-
                # D0 = 当前电源状态为D0（全速运行）

        Capabilities: [90] MSI: Enable- Count=1/32 Maskable- 64bit+
                # MSI Capability在偏移0x90
                # Enable- : MSI当前未使能（设备可能用INTx或MSI-X）
                # Count=1/32 : 支持最多32个向量，当前分配1个
                # 64bit+ : 支持64位消息地址
                Address: 0000000000000000  Data: 0000

        Capabilities: [b0] Express endpoint, MSI 00
                # PCIe Capability在偏移0xB0——这是最重要的Capability
                DevCap: MaxPayload 256 bytes, PhantFunc 0, Latency L0s <1us, L1 <8us
                # MaxPayload 256B : 设备支持的最大TLP负载
                DevCtl: CorrErr- NonFatalErr- FatalErr- UnsupReq- RlxdOrd+ ExtTag- PhantFunc- AuxPwr- NoSnoop+ FLReset-
                # RlxdOrd+ : 允许宽松排序（提升性能）
                LnkCap: Port #0, Speed 8GT/s, Width x4, ASPM L1, Exit Latency L1 <64us
                # Speed 8GT/s : PCIe 3.0速率
                # Width x4    : 4条Lane
                LnkCtl: ASPM L1 Enabled; RCB 64 bytes, Disabled- CommClk+
                # ASPM L1 Enabled : 主动状态电源管理已使能L1
                LnkSta: Speed 8GT/s, Width x4
                # 当前实际协商的速率和宽度

        Capabilities: [100 v1] Advanced Error Reporting
        Capabilities: [150 v1] Virtual Channel
        Capabilities: [180 v1] Power Budgeting
        Capabilities: [1c0 v1] Latency Tolerance Reporting
        Capabilities: [1e0 v1] L1 PM Substates
        Capabilities: [250 v1] Secondary PCI Express
        # 0x100及以上偏移属于Extended Capability区域

        Kernel driver in use: nvme
        # 当前绑定到该设备的内核驱动
```

### /sys/bus/pci/devices 资源查看

```bash
# 查看某PCIe设备的所有资源分配
$ cat /sys/bus/pci/devices/0000:01:00.0/resource

# 输出格式：每行代表一个BAR资源
# start_addr    end_addr        flags（含义见include/linux/ioport.h）
0x00000000f4000000 0x00000000f4003fff 0x0000000000040200
# BAR0: 64-bit MMIO, 从0xF4000000开始，大小16KB
# flags 0x00402200 = IORESOURCE_MEM | IORESOURCE_MEM_64 | IORESOURCE_PREFETCH

0x0000000000000000 0x0000000000000000 0x0000000000000000
# BAR1: 为0表示BAR0+BAR1组合成64位，BAR1自身没有独立区域

0x0000000000000000 0x0000000000000000 0x0000000000000000
# BAR2: 未使用

0x0000000000000000 0x0000000000000000 0x0000000000000000
# BAR3: 未使用

0x00000000f4004000 0x00000000f40040ff 0x0000000000040200
# BAR4: 64-bit MMIO, 从0xF4004000开始，大小256字节

0x0000000000000000 0x0000000000000000 0x0000000000000000
# BAR5: 为0，BAR4+BAR5组合

0x0000000000000000 0x0000000000000000 0x0000000000000200
# ROM BAR: 未使能

# flags位的含义（十六进制位域）：
# bit 0    : IORESOURCE_IO (0x00000100)
# bit 1    : IORESOURCE_MEM (0x00000200)
# bit 3    : IORESOURCE_PREFETCH (0x00000800)
# bit 4    : IORESOURCE_MEM_64 (0x00001000)
# bit 8    : IORESOURCE_DISABLED (0x00010000)

# 查看设备配置空间的原始字节
$ sudo hexdump -C /sys/bus/pci/devices/0000:01:00.0/config | head -8
# 前64字节即Header区域

# 查看当前使用的IRQ
$ cat /sys/bus/pci/devices/0000:01:00.0/irq
16

# 查看已使能的驱动
$ cat /sys/bus/pci/devices/0000:01:00.0/driver/module/drivers/pci:nvme
# 或简单地
$ ls -la /sys/bus/pci/devices/0000:01:00.0/driver
```

### 调试命令：树形查看与寄存器读写

```bash
# ========== lspci -t 树形拓扑 ==========
$ lspci -t -v
-[0000:00]-+-00.0  Intel Corporation Xeon E3-1200 v6/7th Gen Core Host Bridge
           +-01.0-[01]----00.0  Samsung Electronics Co Ltd NVMe SSD
           +-14.0  Intel Corporation 200 Series/Z370 Chipset USB 3.0 xHCI
           +-1c.0-[02]--+-00.0  ASMedia Technology ASM1182 PCIe Switch
           |            +-02.0-[03]----00.0  Intel I210 Gigabit Network
           |            \-04.0-[04]----00.0  Fresco Logic FL1100 USB 3.0
           +-1f.0  Intel Corporation 200 Series LPC Controller

# 解读：
# 00:01.0 是Root Port，其下游是Bus 1，设备01:00.0
# 00:1c.0 是另一个Root Port，下游接了ASM1182 Switch
# Switch的下游端口分别引出Bus 3和Bus 4

# ========== setpci 读写寄存器 ==========
# 读取Vendor ID（0x00，2字节）
$ sudo setpci -s 01:00.0 0x00.w
144d

# 读取Device ID（0x02，2字节）
$ sudo setpci -s 01:00.0 0x02.w
a808

# 读取整个Class Code（0x08，4字节）
$ sudo setpci -s 01:00.0 0x08.l
01080200
# 解码：Base=0x01(Mass Storage), Sub=0x08(NVMe), IF=0x02

# 读取Command寄存器（0x04，2字节）
$ sudo setpci -s 01:00.0 0x04.w
# 输出例如 0x0006 = Bus Master(0x04) + Memory Space(0x02)

# 读取BAR0（0x10，4字节）
$ sudo setpci -s 01:00.0 0x10.l
f4000004
# 0x04 = 低4位，Bit2=1表示64位BAR

# 读取BAR1（BAR0的高32位）
$ sudo setpci -s 01:00.0 0x14.l
00000000

# 完整64位BAR地址 = 0x00000000f4000000

# 读取Capability Pointer
$ sudo setpci -s 01:00.0 0x34.b
80
# 第一个Capability在偏移0x80

# 读取偏移0x80处的Capability
$ sudo setpci -s 01:00.0 0x80.l
# 低字节=Capability ID，第2字节=Next Pointer

# 修改Command寄存器使能Bus Master
$ sudo setpci -s 01:00.0 0x04.w=0x0006
# 0x02=Memory Space Enable, 0x04=Bus Master Enable

# ⚠️ 危险操作：直接修改BAR可能导致系统崩溃！
# $ sudo setpci -s 01:00.0 0x10.l=0x12345000  ← 不要这样做！
```

---

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|:---|:---|
| **枚举算法** | RC从Bus 0开始DFS深度优先扫描，为每个发现的Bridge分配新Bus号，为Endpoint分配BDF |
| **BDF编码** | 16位地址 = Bus[15:8] + Device[7:3] + Function[2:0]，最多256 Bus × 32 Dev × 8 Func |
| **配置访问类型** | Type 0访问同一总线设备，Type 1通过Bridge访问下游总线 |
| **Header区域** | 0x00-0x3F共64字节，含Vendor/Device/Class Code/Command/Status/BAR等关键寄存器 |
| **BAR机制** | 6个BAR声明MMIO/I/O需求，低4位是属性位，写入全1读回可计算大小 |
| **⚠️ BAR陷阱** | BAR地址是PCI域地址，非CPU物理地址；复杂SoC需经ATU转换 |
| **Capability链表** | 从偏移0x34开始遍历，每个节点=[ID:8][NextPtr:8][Data...]，0x00结束 |
| **关键Capability** | Power Management(0x01)、MSI(0x05)、PCIe(0x10)、MSI-X(0x11) |
| **调试工具** | `lspci -t`看拓扑、`lspci -vvv`看详情、`setpci`读写寄存器、`/sys/bus/pci`查资源 |

---

## <span class="blue"> 下一步

**B-D.10.3 PCIe Linux驱动与DMA**

你将学习如何在Linux中编写PCIe设备驱动——从`pci_register_driver()`的注册流程，到`probe()`中请求BAR并`ioremap()`映射，再到配置MSI-X中断和实现高性能DMA传输。DMA是PCIe设备（如NVMe、网卡、GPU）的灵魂，理解了配置空间后再学DMA，你会发现一切豁然开朗。

---

## <span class="blue"> 配套资源

- **PCI Express Base Specification 6.0** — PCI-SIG官方规范，第7章（Configuration Space）
- **Linux PCI驱动框架源码**：`drivers/pci/`目录，重点`probe.c`、`access.c`、`pci-sysfs.c`
- **工具手册**：`man lspci`、`man setpci`、`man pci`
- **在线数据库**：[pcilookup.com](https://pcilookup.com/) — 查询Vendor ID / Device ID对应关系
- **推荐书籍**：《PCI Express System Architecture》MindShare Inc. — 配置空间和枚举的权威参考书
