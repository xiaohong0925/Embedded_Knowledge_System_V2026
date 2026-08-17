# B-D.10.2 PCIe 枚举与配置空间

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] Intermediate ~ [M] Master | 预计阅读时间：45 分钟

## <span class="blue"> 本节导读

10.1 讲了链路怎么修通——但链路通只是物理层就绪。CPU 复位后面对的是一片黑暗：不知道 PCIe 域里插了什么设备、每个设备要多少内存地址空间、设备的中断怎么递过来。把这片黑暗点亮的过程叫**枚举（Enumeration）**，承载这一切信息的标准化存储结构叫**配置空间（Configuration Space）**。

这两个机制是 PCIe 软件世界的大门：驱动的 `probe()` 拿到的资源是枚举阶段分配好的，`lspci` 显示的每一行都来自配置空间，设备树里 PCIe 节点的 `ranges` 属性描述的就是配置空间与 MMIO 的地址翻译关系。看不懂配置空间，写 PCIe 驱动就是在背 API；看懂了，驱动代码里每个函数调用都能对应到硬件动作。

本篇不要求任何背景，所有术语就地解释。工具一节给出 `lspci -vvv` 完整真实输出的逐段解读——读完后你应该能把任何一个字段反查到配置空间的具体偏移。

本节覆盖：枚举为什么存在、BDF 寻址体系、Root Complex 深度优先扫描全过程、Type 0/1 Header 布局与关键寄存器、BAR 的机制与探测原理、Capability 链表与 MSI/MSI-X 的寄存器面、lspci/setpci/sysfs 三个工具面。

---

## <span class="blue"> 为什么需要枚举：PCI 时代的血泪史

枚举要解决的问题，放在 PCI 时代看得最清楚。上世纪九十年代的 PCI 扩展卡需要用户手动设置跳线或拨码开关来选择 I/O 地址和 IRQ 中断号——两块卡选了同一个 IRQ，系统就随机死机。装卡之前要查手册、记已占用的资源、祈祷不冲突。

根治办法是让资源分配从"人肉静态配置"变成"系统启动时自动发现、自动分配"：

1. **发现**：扫描所有可能的设备位置，读出"我是谁、我需要什么"；
2. **分配**：统筹所有设备的地址需求，给每个设备分一段不冲突的地址空间，写回设备；
3. **交接**：把分配结果交给操作系统，驱动按图索骥。

PCIe 完整继承了这套"即插即用"模型，并把发现手段标准化为配置空间——**每个设备在上电时就自带一份统一格式的自述档案**，放在固定地址，等 RC 来读。系统不需要任何硬编码的设备清单，就能识别一张从未见过的卡。这是 PCIe 生态二十年不坠的根基。

---

## <span class="blue"> BDF 寻址：每个设备的身份证号

> 枚举：系统启动时由 Root Complex 发起，扫描整个 PCIe 拓扑、为每个设备分配总线号与地址资源、建立"物理插了什么 ↔ 软件看到什么"映射的过程。在 x86 上由 BIOS/UEFI 与内核接力完成，在嵌入式 Linux 上主要由内核 PCI 子系统在启动早期完成。

枚举的成果是给每个设备功能发一个唯一地址——BDF：

> BDF（Bus:Device.Function）：PCIe 设备的三段式地址，共 16 位。Bus（8 位，0~255）是总线号，标识设备挂在哪条总线段上；Device（5 位，0~31）是该总线上的设备槽位号；Function（3 位，0~7）是设备内部的功能号——一块双口网卡是一个 Device、两个 Function，各自拥有独立的配置空间。

```text
[15:8]  Bus Number    (8 bit)  → 最多 256 条总线段
[ 7:3]  Device Number (5 bit)  → 每条总线段最多 32 个设备
[ 2:0]  Function Number (3 bit)→ 每个设备最多 8 个功能
```

`lspci` 输出里的 `01:00.0` 就是 BDF 的常用记法（Bus 1、Device 0、Function 0）。为什么 Bus 要 8 位、Device 只要 5 位？因为点对点链路每条"总线"上实际只有一个设备——Device 字段在 PCIe 时代几乎恒为 0，地址空间的主力是 Bus 号：每遇到一个 Switch/Bridge 就消耗一个新 Bus 号。这就是为什么枚举的核心工作是**分配 Bus 号**。

---

## <span class="blue"> 枚举过程：Root Complex 的深度优先扫描

枚举由 RC 发起，算法是深度优先搜索（DFS）——沿着一条分支走到底，再回溯。全过程只需一种操作：**配置读写事务**（Configuration Read/Write TLP，专门用于访问配置空间的事务类型）。

配置事务分两种类型，区分依据是目标在不在当前总线上：

| 类型 | 用途 | 转发规则 |
|:----:|------|----------|
| Type 0 | 目标 Bus 就是当前 Bus——直接送达本总线设备 | 不跨桥 |
| Type 1 | 目标 Bus 在下游——Bridge/Switch 负责接力 | Bridge 检查目标 Bus 是否落在自己 Secondary~Subordinate 范围内，在则转成 Type 0 继续向下 |

Secondary/Subordinate Bus Number 这两个寄存器是 Bridge 的"辖区范围"：下游直接挂的总线号（Secondary）和下游最深处的总线号（Subordinate）。枚举时 RC 逐层填写它们，枚举完成后它们同时承担**路由表**的职责——后续每个配置事务靠它们找到路径。

完整流程五个阶段：

```text
阶段1  RC 扫描 Bus 0（RC 内部总线），发现各个 Root Port
       └─ Root Port 本质是一个 Bridge，给它的 Secondary 分配 Bus 1

阶段2  进入 Bus 1，遍历 Device 0~31：对每个位置读 Vendor ID
       ├─ 读回 0xFFFF → 该位置无设备，跳过
       └─ 读回有效值 → 设备存在，继续读 Header Type

阶段3  发现 Bridge（Header Type = 1）
       └─ 分配新 Bus 号写入其 Secondary，递归进入新总线扫描
          全部扫完后回填 Subordinate（记录最深总线号）

阶段4  发现 Endpoint（Header Type = 0）
       └─ 探测每个 BAR 的大小需求（方法见 BAR 一节）

阶段5  回溯完毕后统一分配资源
       └─ 按各设备 BAR 需求在 MMIO 窗口中排布基地址，写回 BAR
          置 Command 寄存器使能位，设备上线
```

> 💡 Vendor ID 读回 0xFFFF 是"无设备"的判定依据——总线上没有设备应答时，上拉电阻使数据线读回全 1。所以驱动调试时看到 Vendor ID = 0xFFFF，含义是"链路另一头根本没人"，先查物理层（卡没插好、供电、PERST#），别查驱动。

一个典型嵌入式系统的枚举结果：

```text
-[0000:00]---00.0  Root Complex Host Bridge
           +-01.0-[01]----00.0  NVMe SSD（Endpoint）
           +-02.0-[02]--+-00.0  Switch 上行口
           |            +-01.0-[03]----00.0  FPGA 加速卡
           |            \-02.0-[04]----00.0  万兆网卡
           \-03.0-[05]----00.0  WiFi 模组
```

这就是 `lspci -tv` 的输出格式：方括号是分配到的 Bus 号，缩进是父子关系。注意 Bus 号按发现顺序递增（00→01→02→03→04→05），深度优先的分配顺序一目了然。

---

## <span class="blue"> 配置空间：设备的标准化自述档案

> 配置空间：每个 PCIe Function 自带的一片 4 KB 标准化寄存器区，前 64 字节（Header）格式由规范强制统一，其余是可选的 Capability 扩展区。操作系统对设备的识别、资源分配、能力查询全部通过读写这片区域完成。

4 KB 分三段：

| 区域 | 偏移范围 | 内容 |
|------|----------|------|
| Header | 0x00~0x3F | 64 字节，所有设备必须实现，格式规范强制 |
| Capability 区 | 0x40~0xFF | 192 字节，PCI 时代的标准能力链表 |
| Extended Capability 区 | 0x100~0xFFF | 3840 字节，PCIe 扩展能力（AER、VC 等） |

### Header 布局（Type 0，Endpoint）

| 偏移 | 字段 | 读它要什么 |
|:----:|------|-----------|
| 0x00 | Vendor ID + Device ID | 设备身份，`lspci` 显示设备名的依据（查 pci.ids 数据库） |
| 0x04 | Command | **三个关键使能位**：Bit0 I/O Space、Bit1 Memory Space、Bit2 Bus Master。BAR 分了地址但不置 Bit1，设备寄存器就是访问不到；不做 DMA 的设备可以不置 Bit2 |
| 0x06 | Status | Bit4 表示存在 Capability 链表；Bit3 中断挂起状态 |
| 0x08 | Revision ID + **Class Code**（3 字节） | 设备类别：[Base:Sub:Interface]。`0x010802` = 存储/NVMe，`0x020000` = 以太网，`0x030000` = VGA——通用驱动（nvme、ahci、xhci）靠它成批匹配设备 |
| 0x0E | Header Type | Bit7 多功能设备标志；低 7 位 = 0 表示 Endpoint，= 1 表示 Bridge |
| 0x10~0x24 | **BAR0~BAR5** | 六组基址寄存器，下一节专讲 |
| 0x2C | Subsystem Vendor/Device ID | 板卡级身份：同一块芯片不同厂商的成品卡靠它区分（笔记本厂商定制网卡靠 Subsystem ID 加载各自的配置） |
| 0x30 | Expansion ROM Base | 可选 ROM 的映射地址（显卡 BIOS、网卡 PXE 固件所在） |
| 0x34 | Capabilities Pointer | Capability 链表的表头偏移 |
| 0x3C/0x3D | Interrupt Line / Pin | 传统 INTx 中断的引脚号与路由到的 IRQ——MSI 时代基本只剩兼容意义 |

Bridge/Switch 用的是 Type 1 Header：BAR 只有两个，省下的位置放 Primary/Secondary/Subordinate Bus Number 和下游窗口的地址范围寄存器——即上一节的"辖区范围"。

---

## <span class="blue"> BAR 深度解析：设备怎么领地址空间

> BAR（Base Address Register，基址寄存器）：设备用来声明"我需要多大地址空间"、枚举阶段被写入"你的空间从哪里开始"的寄存器。枚举之后，CPU 访问这段地址就会被 RC 路由到该设备——设备的寄存器、队列、缓冲都通过 BAR 暴露给软件。

### 三类 BAR 与属性位

BAR 是 32 位寄存器，低 4 位是只读属性位，高位才是可编程基地址：

```text
Bit 0    空间类型：0 = Memory（MMIO），1 = I/O 端口（PCI 遗留，PCIe 基本不用）
Bit 1    保留
Bit 2    Memory 类型时：0 = 32 位地址，1 = 64 位地址（此时吃掉相邻的下一个 BAR 作高 32 位）
Bit 3    Prefetchable：1 = 该区域可读预取/写合并（显存帧缓冲类）；0 = 寄存器类，必须严格按序访问
```

Prefetchable 位不是性能提示，是**正确性声明**：预取意味着 CPU 可以主动多读、乱序读。设备寄存器读一次就清一次的状态位如果被预取，数据就丢了——所以寄存器区 BAR 必须标 non-prefetchable。`lspci` 里 `Memory at ... (64-bit, non-prefetchable)` 的每个词都对应这些位。

### 大小探测：写全 1 读回

枚举时系统不知道设备要多少空间，用了一个巧妙的自描述机制：

```text
1. 保存 BAR 原值
2. 向 BAR 写入 0xFFFFFFFF
3. 读回——设备内部只实现了它需要的地址线，高位有效、低位恒为 0
4. 有效位取反 +1，即为申请的地址空间大小
5. 恢复 BAR 原值
```

实例演算：向 BAR0 写全 1 后读回 `0xFFF00004`——

```text
低 4 位 0b0100 → Bit0=0（Memory 空间）、Bit2=1（64 位地址）、Bit3=0（non-prefetchable）
高 28 位掩码 0xFFF00000 → 取反得 0x000FFFFF，+1 = 0x00100000 = 1 MB
结论：这是一个 64 位、1 MB、non-prefetchable 的 BAR；高 32 位基地址放在 BAR1 里
```

实际读回值的低 4 位取决于设备实现，逐位对照上面的属性位定义拆即可。6 个 BAR 的常见分工是 BAR0 放主寄存器区、BAR2/BAR4 放队列或大缓冲；未使用的 BAR 硬件读回全 0。

> 🔴 BAR 里写的地址是 **PCI 域地址**，不必然等于 CPU 物理地址。简单系统里 RC 做 1:1 映射，两者数值相同；复杂 SoC 里 RC 内有地址翻译单元（ATU），BAR 地址要经 ATU 换算才是 CPU 视角的物理地址。写驱动时不需要手工换算——用 `pci_resource_start()` 拿到的就是翻译后的地址；直接对 BAR 原始值做 `ioremap()` 是移植性 bug。设备树 PCIe 节点的 `ranges` 属性描述的就是这层翻译（第 11 章设备树机制在此合流）。

---

## <span class="blue"> Capability 链表与 MSI/MSI-X

64 字节的 Header 装不下 PCIe 不断扩展的新能力，于是有了链表式扩展：每个 Capability 是挂在链上的一个节点。

> Capability 链表：配置空间 0x40 起的能力扩展区。每个节点格式为 `[ID: 8 bit][Next 指针: 8 bit][数据区...]`，从 Header 0x34 的 Capabilities Pointer 出发顺链遍历，Next 为 0x00 即结束。0x100 之后是格式类似的 Extended Capability 链表（16 位 ID），PCIe 新能力都放在那边。

遍历算法四步：确认 Status.Bit4 → 读 0x34 得首节点偏移 → 逐节点读 ID 与 Next → Next=0 收工。常用节点：

| Capability | ID | 作用 |
|-----------|:--:|------|
| Power Management | 0x01 | D0~D3 电源状态管理 |
| MSI | 0x05 | 消息中断（传统版） |
| **PCIe Capability** | 0x10 | 本系列反复打交道的一个：链路速率/宽度能力（LnkCap）、当前状态（LnkSta）、设备能力（MaxPayload）都在它里面 |
| MSI-X | 0x11 | 多向量消息中断 |
| AER | 扩展区 0x01 | 高级错误报告，10.4 专讲 |

### MSI/MSI-X 的寄存器面

10.1 讲过 MSI 的本质是设备向特定内存地址发一笔 Memory Write TLP。这个"特定地址+数据"从哪来？就配置在这两个 Capability 里：

**MSI（0x05）**：节点内含 Message Address（32/64 位）与 Message Data 寄存器。枚举/驱动加载时，内核把一个"落在中断控制器上的特殊地址"写进 Message Address，把中断向量号写进 Message Data。设备要发中断，就往这个地址写这个数据——RC 收到后转交中断控制器，对应中断触发。最多 32 个向量，且必须**连续分配**（Count 字段记录 2 的幂）。

**MSI-X（0x11）**：MSI 的现代化版本，两个关键改进——向量数上限 2048、每个向量独立配置地址与数据（不必连续）。结构上它不再把表放在 Capability 节点里，而是用 **Table BIR/Offset 字段指向某个 BAR 空间内的一张表**：每行 16 字节（地址 + 数据 + 掩码位），配一个 PBA（Pending Bit Array）记录挂起状态。网卡给每个收发队列配一个 MSI-X 向量、绑到不同 CPU，靠的就是这张表。

驱动侧的 API（`pci_alloc_irq_vectors()` 等）在 10.3 讲；这里记住结论：**MSI 至多 32 且连续，MSI-X 至多 2048 且独立，新设备一律 MSI-X**。

---

## <span class="blue"> 工具面：lspci / sysfs / setpci

### lspci -vvv 逐段解读

下面是一份真实 NVMe SSD 的完整输出，逐段对照前文概念：

```text
01:00.0 Non-Volatile memory controller: Samsung NVMe SSD Controller (prog-if 02 [NVM Express])
```

首行 = BDF + Class Code 解码 + pci.ids 查出的厂商设备名。`prog-if 02` 就是 Class Code 的 Interface 字节。

```text
        Control: I/O- Mem+ BusMaster+ ...
        Status: Cap+ 66MHz- ... INTx-
        Latency: 0, Cache Line Size: 64 bytes
        Interrupt: pin A routed to IRQ 16
```

Command/Status 寄存器的当前值直译：`Mem+` 是 Bit1 Memory Space 已使能（BAR 地址已生效），`BusMaster+` 是 Bit2 已使能（设备可以做 DMA）。`Cap+` 表示 Capability 链表存在。`Interrupt: pin A` 是 Interrupt Pin 寄存器值——INTx 时代的遗留信息，该设备实际用 MSI。

```text
        Region 0: Memory at f4000000 (64-bit, non-prefetchable) [size=16K]
        Region 4: Memory at f4004000 (64-bit, non-prefetchable) [size=256]
```

BAR 解码结果。Region 0 即 BAR0：64 位（BAR0+BAR1 组合）、non-prefetchable（寄存器区）、16 KB。注意没有 Region 1——BAR1 被 BAR0 吃掉当高 32 位了。

```text
        Capabilities: [80] Power Management version 3
                Status: D0 NoSoftRst+ ...
        Capabilities: [90] MSI: Enable- Count=1/32 Maskable- 64bit+
        Capabilities: [b0] Express Endpoint, MSI 00
                DevCap: MaxPayload 256 bytes ...
                LnkCap: Port #0, Speed 8GT/s, Width x4 ...
                LnkSta: Speed 8GT/s, Width x4
        Capabilities: [100 v1] Advanced Error Reporting
        Capabilities: [150 v1] Virtual Channel
        ...
        Kernel driver in use: nvme
```

方括号里是偏移，正好演示链表结构：0x80（PM）→ 0x90（MSI）→ 0xB0（PCIe）→ 0x100 起进入扩展区（AER、VC……）。`LnkCap` 与 `LnkSta` 的判读方法在 10.1 已建立——Speed/Width 一致即健康。最后一行是当前绑定的内核驱动。

### /sys/bus/pci/devices

每个设备一个目录，常用文件：

```bash
cat /sys/bus/pci/devices/0000:01:00.0/resource
```

```text
0x00000000f4000000 0x00000000f4003fff 0x0000000000140404
0x0000000000000000 0x0000000000000000 0x0000000000000000
...
```

每行一个 BAR：`起始地址 结束地址 flags`。flags 位域对应 `include/linux/ioport.h` 的 `IORESOURCE_*`（0x200=MEM、0x800=PREFETCH、0x1000=MEM_64 等）——起始地址是全 0 的行表示该 BAR 未使用或被 64 位组合吃掉。

同目录下还有：`config`（配置空间原始 4 KB，可 hexdump）、`irq`（当前 IRQ 号）、`driver`（符号链接指向绑定驱动）、`vendor`/`device`/`class`（三个 ID 的原始值）。

### setpci：寄存器级读写

`setpci` 直接读写配置空间，单位后缀 `.b/.w/.l` = 字节/字/双字：

```bash
setpci -s 01:00.0 0x00.w        # Vendor ID → 144d
setpci -s 01:00.0 0x04.w        # Command → 0006（Mem+ BusMaster+）
setpci -s 01:00.0 0x10.l        # BAR0 → f4000004（低 4 位属性：64-bit Memory）
setpci -s 01:00.0 0x34.b        # Cap Pointer → 80
setpci -s 01:00.0 0x04.w=0x0006 # 写：使能 Memory Space + Bus Master
```

> ⚠️ setpci 写操作绕过内核 PCI 子系统的状态管理。改 Command 使能位尚可恢复；**改 BAR 基地址会让内核维护的 resource 树与硬件失步，后果不可预期**——演示和学习在虚拟机上做，生产机器只读不写。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 自描述枚举 vs 设备树静态描述 | PCIe 设备可热插拔、拓扑任意，必须运行时枚举；ARM 板级设备不可枚举才需要设备树——两套模型在 RC 节点处交汇 |
| 集中资源分配 vs 设备自报固定地址 | 无冲突、可利用碎片；代价是启动时间增加、固件/内核分工复杂 |
| MSI vs MSI-X | MSI 简单但向量少且连续；MSI-X 表占 BAR 空间但每向量独立——多队列设备没有第二种选择 |
| Prefetchable vs non-prefetchable | 预取提升大块数据吞吐；寄存器区标错成 prefetchable 是隐蔽的正确性 bug |
| 32 位 vs 64 位 BAR | 64 位摆脱 4 GB 以下地址拥挤；代价是吃掉相邻 BAR 槽位 |

---

## <span class="blue"> 本节总结

| 自查项 | 读完应能独立完成的动作 |
|--------|------------------------|
| 枚举动机 | 说清 PCI 时代手动配置的痛点，以及"发现→分配→交接"三阶段 |
| BDF | 把 `02:01.0` 翻译成三段含义；解释为什么 PCIe 时代 Device 恒为 0、Bus 号才是主力 |
| 枚举流程 | 复述 DFS 五阶段；解释 Secondary/Subordinate 的双重身份（枚举产物 + 路由表） |
| 配置空间 | 默画 4 KB 三段布局；说出 Vendor ID 读回 0xFFFF 的真实含义 |
| Header 寄存器 | 说出 Command 三个使能位各自管什么、不置位的症状 |
| BAR | 完整演算一遍写全 1 探测；解释 prefetchable 的正确性含义；说清 PCI 域地址与 CPU 物理地址的关系 |
| Capability | 手写遍历算法；说出 MSI/MSI-X 的结构差异与选型结论 |
| 工具 | 给一段 `lspci -vvv` 输出，把每个字段反查到配置空间偏移 |

---

## <span class="blue"> 配套资源

- **规范**：PCIe Base Specification 第 7 章（Configuration Space）
- **内核**：`drivers/pci/probe.c`（枚举实现）、`include/linux/ioport.h`（resource flags 位域）
- **工具**：`man lspci` / `man setpci`；[pcilookup.com](https://pcilookup.com/)（Vendor/Device ID 反查）
- **衔接**：B-D.10.1（链路与拓扑）；B-D.10.3（驱动侧怎么消费本篇的资源分配结果）；B-D.10.4（AER 扩展 Capability 详解）
