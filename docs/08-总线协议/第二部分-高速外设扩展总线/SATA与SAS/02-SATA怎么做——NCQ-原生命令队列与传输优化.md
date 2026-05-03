# SATA怎么做——NCQ、原生命令队列与传输优化

<span class="badge-b">[B]</span> <span class="badge-i">[I]</span> <span class="badge-e">[E]</span> <span class="badge-m">[M]</span>

SATA 的"性能天花板"不仅来自物理层速率，
更来自命令调度效率。
本章深入 AHCI 端口寄存器、NCQ 队列、FIS 帧结构和 DMA 传输，
让你理解 SATA SSD 的实际带宽是如何被榨取的。

---

## 核心定义与价值

<span class="red">NCQ（Native Command Queuing）</span> 是 SATA 的核心性能优化机制。
它允许 Host 同时向设备提交最多 32 个未完成的命令，
由设备内部的调度器根据物理位置重新排序，减少机械硬盘的寻道时间。

**在 SSD 时代，NCQ 的价值发生了变化：**

- 机械硬盘：NCQ 减少寻道时间，收益巨大
- SATA SSD：NCQ 掩盖命令提交延迟，允许并行 Flash 操作，收益中等
- 与 NVMe 对比：NCQ 的 32 深度 vs NVMe 的 64K 深度，差距悬殊

---

### 类比：餐厅后厨的订单调度

NCQ 像一家高级餐厅的后厨：

- <span class="green">Host</span> = 前台服务员，一次可以写下 32 张订单（32 深度队列）
- <span class="green">Device</span> = 主厨，决定先炒哪道菜（命令重排序）
- <span class="green">FIS</span> = 订单单上的标准格式（菜品名、桌号、特殊要求）
- <span class="green">DMA</span> = 传菜员直接从厨房把菜端到桌上，不经过前台
- <span class="green">PRD 表</span> = 传菜路线图，告诉传菜员菜要分几趟端、每趟端到哪里

没有 NCQ 的餐厅：一次只能炒一道菜，炒完才能收下一单。

---

## 核心机制原理解析

### <strong>1. AHCI 端口寄存器：命令提交的核心战场</strong>

<br>

每个 SATA 端口在 AHCI 中有 0x80 字节的寄存器空间：

| 寄存器 | 偏移 | 说明 |
|--------|------|------|
| PxCLB | 0x00 | Command List Base Address（低 32 bit） |
| PxCLBU | 0x04 | Command List Base Upper（高 32 bit） |
| PxFB | 0x08 | FIS Base Address（低 32 bit） |
| PxFBU | 0x0C | FIS Base Upper（高 32 bit） |
| PxIS | 0x10 | Port Interrupt Status |
| PxIE | 0x14 | Port Interrupt Enable |
| PxCMD | 0x18 | Port Command / Status |
| PxTFD | 0x20 | Port Task File Data |
| PxSIG | 0x24 | Port Signature |
| PxSSTS | 0x28 | Port SATA Status |
| PxSCTL | 0x2C | Port SATA Control |
| PxSERR | 0x30 | Port SATA Error |
| PxSACT | 0x34 | Port SATA Active |
| PxCI | 0x38 | Port Command Issue |
| PxSNTF | 0x3C | Port SATA Notification |
| PxFBS | 0x40 | Port FIS-based Switching |
| PxDEVSLP | 0x44 | Port Device Sleep |

<br>

**PxCMD 寄存器关键位：**

| 位 | 名称 | 说明 |
|----|------|------|
| 31 | ICC | Interface Communication Control |
| 4 | FRE | FIS Receive Enable |
| 3 | CLO | Command List Override |
| 0 | ST | Start：1=启动端口命令处理 |

<br>
<span class="blue">初始化端口的顺序：写 CLB/FB 基址 → 置位 FRE → 置位 ST。</span>
ST 置位后，AHCI 控制器开始从 Command List 中读取命令并执行。

---

### <strong>2. Command List 结构：32 个槽位的环形队列</strong>

<br>

Command List 是内存中的 32 个条目数组，每个条目 32 字节（0x20）：

```
Offset 0x00: DW0  - Command Information
  [31:16] PRDTL  - Physical Region Descriptor Table Length
  [14]    NCQ?   - 1 = NCQ 命令（带 Tag）
  [12:8]  PMP    - Port Multiplier Port
  [7:5]   C      - Command Control
  [4:0]   CFIS   - Command FIS Length (in DW)

Offset 0x04: DW1  - Command Status / Reserved
Offset 0x08: DW2  - Command Table Base Address Low
Offset 0x0C: DW3  - Command Table Base Address High
Offset 0x10: DW4  - Reserved
Offset 0x14: DW5  - Reserved
Offset 0x18: DW6  - Reserved
Offset 0x1C: DW7  - Reserved
```

<br>

每个槽位指向一个 <span class="green">Command Table</span>，
Command Table 包含：

- CFIS（Command FIS，最多 64 byte）
- ACMD（ATAPI Command，可选，16 byte）
- PRD（Physical Region Descriptor 表，每个 16 byte，最多 65535 个）

---

### <strong>3. FIS（Frame Information Structure）类型与格式</strong>

<br>

FIS 是 SATA 链路上的基本传输单元，类似 PCIe 的 TLP。

| FIS 类型 | 类型码 | 方向 | 用途 |
|---------|--------|------|------|
| Register H2D | 0x27 | Host→Device | 发送 ATA 命令 |
| Register D2H | 0x34 | Device→Host | 命令完成 / 状态更新 |
| DMA Activate | 0x39 | Device→Host | 允许 Host 发起 DMA |
| DMA Setup | 0x41 | Bidirectional | 第一方 DMA 设置 |
| Data | 0x46 | Bidirectional | PIO 数据传输 |
| BIST Activate | 0x58 | Bidirectional | 自检 |
| PIO Setup | 0x5F | Device→Host | PIO 传输设置 |
| Set Device Bits | 0xA1 | Device→Host | NCQ 完成通知 |

<br>

**Register H2D FIS 格式（5 DW = 20 byte）：**

```
Byte 0:    Type = 0x27
Byte 1:    [7] = 1 (Command), [6:4] = Port Multiplier, [3:0] = 保留
Byte 2-3:  Features [15:8] [7:0]
Byte 4-7:  Sector Count [15:0] + LBA Low [23:0]
Byte 8-11: LBA Mid/High + Device/Head
Byte 12-15: Features Exp + Sector Count Exp + LBA Low/Mid/High Exp
Byte 16-17: Control
Byte 18-19: 保留
```

<br>
<span class="blue">Register H2D FIS 与 legacy IDE 的 Task File 寄存器一一对应，
这是 SATA 向后兼容 ATA 命令集的设计核心。</span>

---

### <strong>4. DMA 传输：PRD 表的散集魔法</strong>

<br>

PRD（Physical Region Descriptor）表描述了数据在内存中的位置。
由于数据可能分散在多个不连续的物理页中，PRD 表允许 DMA 引擎按顺序传输多个物理区域。

```
每个 PRD Entry（16 byte）：
Byte 0-3:   Data Base Address Low
Byte 4-7:   Data Base Address High
Byte 8-11:  Reserved
Byte 12-15: [31] I=Interrupt on completion, [30:0] Data Byte Count
```

<br>
<span class="blue">PRD 的 Data Byte Count 字段是 0-based：值为 0 表示 1 byte，值为 0x1FFFFF 表示 2MB。</span>

---

## 技术教学与实战

### Linux libata 核心结构体

```c
/* include/linux/libata.h */
struct ata_port {
    struct Scsi_Host  *scsi_host;
    struct ata_link     link;        /* 端口链路状态 */
    unsigned int        port_no;     /* 端口号 */
    unsigned int        pflags;      /* 端口标志 */
    u32                   cmd;         /* 当前命令 */
    /* ... */
};

struct ata_device {
    struct ata_link    *link;
    struct ata_port    *ap;
    unsigned int        devno;       /* 设备号 0/1 */
    unsigned int        class;       /* ATA/ATAPI/PM */
    u64                   n_sectors;   /* 总扇区数 */
    u32                   cylinders;     /* CHS 参数 */
    u32                   heads;
    u32                   sectors;
    /* ... */
};

struct ata_queued_cmd {
    struct ata_port    *ap;
    struct ata_device  *dev;
    u8                    tag;          /* NCQ Tag 0-31 */
    u32                   n_elem;          /* PRD 元素数 */
    struct scatterlist   *sg;             /* scatterlist */
    struct ata_taskfile  tf;             /* ATA Task File */
    /* ... */
};
```

<br>
<span class="green">tag 字段</span> 是 NCQ 的灵魂：每个命令分配一个 0-31 的 Tag，
设备通过 Set Device Bits FIS 中的 SActive 字段通知 Host 哪些 Tag 已完成。

---

## 嵌入式专属实战场景

### 场景：fio 测试 SATA SSD 的 NCQ 收益

```bash
# 测试 4K 随机读，队列深度 1（无 NCQ 收益）
fio --name=randread --ioengine=libaio --iodepth=1 \\
    --rw=randread --bs=4k --direct=1 --size=1G \\
    --runtime=60 --filename=/dev/sda
# 结果: iops=8500, bw=34.0MiB/s

# 测试 4K 随机读，队列深度 32（NCQ 满负荷）
fio --name=randread --ioengine=libaio --iodepth=32 \\
    --rw=randread --bs=4k --direct=1 --size=1G \\
    --runtime=60 --filename=/dev/sda
# 结果: iops=98000, bw=392MiB/s
```

<br>
队列深度从 1 提升到 32，4K 随机读 IOPS 提升了 11.5 倍。
<span class="blue">这就是 NCQ 的威力：让 SSD 内部的多个 Flash 通道并行工作，充分压榨硬件潜力。</span>

---

## 历史演进与前沿

### NCQ 的演进与局限

| 年份 | 里程碑 | 说明 |
|------|--------|------|
| 2004 | NCQ 随 SATA 3G 引入 | 32 深度队列，机械硬盘寻道优化 |
| 2008 | SATA SSD 普及 | NCQ 开始用于掩盖 Flash 擦写延迟 |
| 2011 | NVMe 1.0 发布 | 64K 队列 × 64K 深度，NCQ 显得微不足道 |
| 2015 | AHCI 性能瓶颈凸显 | 单队列 + 寄存器轮询成为瓶颈 |
| 2020 | NVMe 全面替代 SATA SSD | 新笔记本几乎不再配备 SATA 接口 |

<br>
<span class="blue">NCQ 的 32 深度在 SSD 时代已不够用：消费级 NVMe SSD 的队列深度通常运行在 64-256，数据中心级 NVMe 运行在 1K-4K。</span>

---

## 本章小结

| 主题 | 关键要点 |
|------|---------|
| Command List | 32 个槽位，每个指向 Command Table（CFIS + ACMD + PRD） |
| FIS | H2D 发命令，D2H 回状态，DMA Setup/Activate 控制 DMA，Set Device Bits 通知 NCQ 完成 |
| PRD | 散集描述符，每个 16 byte：地址（64-bit）+ 长度（31-bit）+ I 中断标志 |
| NCQ Tag | 0-31，Set Device Bits FIS 的 SActive 字段按位标记完成 |
| libata | ata_port / ata_device / ata_queued_cmd，tag 字段绑定 NCQ |
| fio 实测 | iodepth=1 → 8.5K IOPS，iodepth=32 → 98K IOPS |

---

## 练习

1. AHCI 的 Command List 有 32 个槽位，但 PxCI（Command Issue）是 32-bit 寄存器。
   如果 Host 同时提交 32 个命令，然后想再提交第 33 个，驱动层需要如何处理？
2. PRD 表的 Data Byte Count 是 0-based。如果要传输 4KB（4096 byte），PRD 中应该写 4095 还是 4096？
3. Register H2D FIS 的 Features 字段与 legacy ATA 的 Features 寄存器有什么对应关系？
   为什么 SATA 要保留这些 legacy 字段？
4. 在机械硬盘上使用 NCQ，收益主要来自寻道时间减少；在 SATA SSD 上使用 NCQ，收益来源是什么？
   为什么 SATA SSD 的 NCQ 收益比 NVMe 的队列并行小得多？
5. 阅读 libata 源码：ata_qc_complete() 函数中，如何判断一个 NCQ 命令是否完成？
   它如何与 Set Device Bits FIS 的 SActive 字段交互？
