# PCIe事务层与TLP包格式

<span class="badge-i">[Intermediate]</span>

<span class="red">事务层（Transaction Layer）是PCIe协议栈的核心，负责将CPU/设备的读写请求封装为TLP（Transaction Layer Packet），并通过ID路由、地址路由或隐式路由将数据包送达目标设备。</span> TLP的格式与路由机制决定了PCIe地址空间如何映射、设备如何通信，是理解PCIe软件模型的关键。

<br>事务层向上为设备驱动程序提供标准化的Memory/IO/Configuration读写接口，向下将请求转换为标准TLP通过数据链路层和物理层发送。所有PCIe数据传输的本质都是TLP的发送与接收。

---

## <strong>基础认知</strong>

<span class="green">TLP</span> 是PCIe事务层的数据包单元，由Header（必需）、Data Payload（可选）和TLP Digest（可选CRC，即ECRC）组成。Header长度固定为3 DW（12字节）或4 DW（16字节），格式取决于事务类型。

<br>PCIe定义了四类基础事务：Memory事务、IO事务、Configuration事务和Message事务。其中Memory事务是最常用的（用于BAR空间访问和DMA），IO事务为兼容遗留设备保留，Configuration事务用于枚举和配置设备，Message事务用于中断、电源管理和错误报告。

### <strong>TLP Header格式概览</strong>

```mermaid
graph LR
    subgraph "TLP结构"
        H[Header<br/>3或4 DW]
        D[Data Payload<br/>0–1024 DW]
        C[TLP Digest<br/>1 DW ECRC]
    end
    
    subgraph "3DW Header字段"
        FMT[Fmt[1:0]<br/>00=3DW无数据<br/>10=3DW有数据]
        TYPE[Type[4:0]<br/>00000=MRd<br/>00010=MWr]
        TC[TC[2:0]<br/>流量类]
        ATTR[Attr<br/>排序属性]
        LEN[Length<br/>数据长度]
        REQ[Requester ID<br/>Bus/Dev/Fn]
        TAG[Tag<br/>事务标签]
        ADDR[Address<br/>32位地址]
    end
    
    FMT --> H
    TYPE --> H
```

<br>3 DW Header用于32位地址空间的Memory/IO事务；4 DW Header用于64位地址空间的Memory事务。Fmt和Type字段联合决定TLP的完整语义。

| Fmt[1:0] | Type[4:0] | 事务类型 | 地址宽度 |
|----------|-----------|----------|----------|
| 00 | 00000 | Memory Read | 32-bit |
| 01 | 00000 | Memory Read | 64-bit |
| 10 | 00000 | Memory Write | 32-bit |
| 11 | 00000 | Memory Write | 64-bit |
| 00 | 00100 | Configuration Read Type 0 | — |
| 10 | 00100 | Configuration Write Type 0 | — |
| 01 | 10xxx | Message | — |

<br><span class="blue">Fmt字段的最高位指示是否存在Data Payload，次高位指示Header是3 DW还是4 DW。</span> 这种紧凑编码使Header解析高效。

### <strong>请求事务与完成事务</strong>

PCIe采用Split Transaction模型：非Posted事务（如Memory Read、Configuration Read）需要目标设备返回Completion TLP，Posted事务（如Memory Write）无需完成确认。

<br>Requester ID（16-bit，格式为Bus[7:0]:Device[4:0]:Function[2:0]）标识请求来源，Completion通过Requester ID路由回发起者。Tag字段（5-bit或8-bit，取决于Extended Tag支持）与Requester ID共同构成Transaction ID，使一个Requester可同时发起多个未完成事务。

---

## <strong>原理解析</strong>

### <strong>为什么PCIe需要三种路由机制</strong>

<span class="blue">PCIe拓扑是树形结构，TLP从源到目的可能经过多个Switch。不同事务类型需要不同的路由策略，因为它们的寻址语义不同。</span>

<br>**地址路由（Address Routing）** 用于Memory和IO事务。Switch检查TLP中的目标地址，将其与自己的地址解码窗口（Base/Limit寄存器）对比，决定从哪个下游端口转发或是否向上游转发。这类似于IP路由中的子网匹配。

<br>**ID路由（ID Routing）** 用于Configuration事务和Completion。目标由Bus+Device+Function三元组标识，Switch使用配置空间中预配的次级总线号（Secondary Bus Number）和从属总线号（Subordinate Bus Number）进行路由决策。ID路由不依赖地址，因为Configuration空间在枚举前尚未分配地址。

<br>**隐式路由（Implicit Routing）** 用于Message事务。某些Message（如INTx中断、电源管理、错误报告）的目标不是特定设备，而是沿拓扑传播到"所有感兴趣者"。Message的Type字段编码了传播方向：Broadcast（RC到所有）、Local（到RC）、Gather（EP到RC）。

### <strong>BAR空间的映射原理</strong>

<span class="green">BAR（Base Address Register）</span> 位于配置空间Header中（Type0头偏移0x10~0x24），用于声明设备需要的地址空间类型和大小。驱动程序通过向BAR写入全1、读回值的方式计算所需空间。

<br>BAR字段结构：

| 位域 | 含义 |
|------|------|
| Bit 0 | 0=Memory空间，1=IO空间 |
| Bit 1:2 | Memory类型：00=32-bit，10=64-bit |
| Bit 3 | 0=Non-prefetchable，1=Prefetchable |
| Bit 31:4 | 可写位表示所需空间大小（对齐粒度） |

<br><span class="blue">向BAR写入0xFFFFFFFF后读回，低位的0被保留位占据，高位的1表示设备需要的大小。</span> 例如读回0xFFFFF000表示需要4 KB对齐的4 KB空间（低12位为0，其余可编程）。

<br>64-bit BAR由两个相邻的32-bit BAR组成：低BAR含bit 0:2类型字段，高BAR提供地址高位。配置64-bit BAR时，必须先写高BAR再写低BAR，否则低BAR的写入可能触发地址更新。

### <strong>TLP的排序规则</strong>

PCIe定义了 relaxed ordering 和 ID-based ordering 机制。传统PCI的强排序（Strong Ordering）保证所有事务按序完成，但限制了并发性。PCIe允许设备标记TLP的Attr字段以请求宽松的排序约束。

<br>Attr字段：
- Bit 0: No Snoop（1=请求者已保证缓存一致性，无需RC snoop）
- Bit 1: Relaxed Ordering（1=允许此TLP与其他TLP乱序）
- Bit 2: ID-Based Ordering（1=允许不同ID的TLP之间乱序）

<br><span class="blue">对于DMA传输，若设备已维护缓存一致性（如通过SMMU/IOMMU），设置No Snoop可减少RC的snoop开销，显著降低延迟。</span> 但错误设置No Snoop会导致缓存一致性问题。

---

## <strong>技术教学</strong>

### <strong>使用setpci读写BAR和配置空间</strong>

```bash
# 查看设备所有BAR的当前值
lspci -vv -s 01:00.0 | grep -E "Region|BAR"

# 使用setpci读取BAR0（偏移0x10）
sudo setpci -s 01:00.0 0x10.l
# 输出类似：f4100000  → BAR0映射到物理地址0xf4100000

# 读取BAR1（若为64-bit BAR的高32位）
sudo setpci -s 01:00.0 0x14.l

# 计算BAR所需空间：写入全1后读回
sudo setpci -s 01:00.0 0x10.l=0xffffffff
sudo setpci -s 01:00.0 0x10.l
# 若输出0xfffff000，则空间大小 = ~(0xfffff000) + 1 = 0x1000 = 4KB
# 完成后恢复原值！
sudo setpci -s 01:00.0 0x10.l=0xf4100000
```

<br><span class="blue">修改BAR值会导致设备地址映射变化，可能使正在运行的驱动崩溃。操作前务必确认设备未被占用。</span>

### <strong>通过内核接口发送TLP（测试用途）</strong>

```c
/* 通过Linux内核的PCIe DMA测试接口理解TLP流动 */
#include <linux/pci.h>

/* 驱动中读取设备BAR空间的典型流程 */
static int my_pcie_probe(struct pci_dev *pdev, const struct pci_device_id *id)
{
    void __iomem *bar0;
    u32 val;

    /* 1. 使能设备（启用Memory/IO空间和总线主控） */
    pci_enable_device(pdev);
    
    /* 2. 请求BAR0区域 */
    pci_request_region(pdev, 0, "my_driver");
    
    /* 3. 映射BAR0到内核虚拟地址 */
    bar0 = pci_iomap(pdev, 0, pci_resource_len(pdev, 0));
    
    /* 4. 读取BAR0偏移0处的寄存器 */
    val = readl(bar0 + 0x00);
    dev_info(&pdev->dev, "BAR0[0x00] = 0x%08X\n", val);
    
    /* 此 readl 在PCIe层面被转换为：
     * - TLP Header: Mrd, 64-bit地址=BAR0基址+0x00
     * - Completion返回32-bit数据
     */
    
    pci_iounmap(pdev, bar0);
    pci_release_region(pdev, 0);
    return 0;
}
```

---

## <strong>软硬件实战</strong>

### <strong>场景一：NVMe SSD的BAR空间分析与寄存器访问</strong>

NVMe控制器使用BAR0（通常为64-bit Memory BAR）暴露其寄存器空间。以Linux用户态mmap方式访问：

```c
/* 用户态通过mmap访问PCIe设备BAR — 以NVMe控制器为例 */
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <stdint.h>

#define NVME_BAR_SIZE   0x4000   /* 16KB BAR空间 */

int main(int argc, char **argv)
{
    const char *resource = "/sys/bus/pci/devices/0000:01:00.0/resource0";
    int fd = open(resource, O_RDONLY);
    if (fd < 0) {
        perror("open resource0");
        return 1;
    }

    /* mmap BAR0到用户态虚拟地址空间 */
    volatile uint32_t *bar = mmap(NULL, NVME_BAR_SIZE, PROT_READ,
                                  MAP_SHARED, fd, 0);
    if (bar == MAP_FAILED) {
        perror("mmap");
        close(fd);
        return 1;
    }

    /* NVMe Controller Capabilities Register (CAP) 在BAR0偏移0x00 */
    uint64_t cap_lo = bar[0];   /* 低32位 */
    uint64_t cap_hi = bar[1];   /* 高32位 */
    uint64_t cap = (cap_hi << 32) | cap_lo;

    printf("NVMe CAP Register: 0x%016lX\n", cap);
    printf("  MQES (Max Q Entries): %lu\n", (cap & 0xFFFF) + 1);
    printf("  CQR (Contig Qs Required): %s\n", (cap & (1UL<<16)) ? "Yes" : "No");
    printf("  TO (Timeout): %lu * 500ms\n", (cap >> 24) & 0xFF);

    /* NVMe Version Register (VS) 在偏移0x08 */
    uint32_t vs = bar[2];
    printf("NVMe Version: %u.%u.%u\n",
           (vs >> 16) & 0xFFFF, (vs >> 8) & 0xFF, vs & 0xFF);

    munmap((void *)bar, NVME_BAR_SIZE);
    close(fd);
    return 0;
}
```

<br><span class="blue">sysfs的resourceN文件直接暴露PCIe BAR的物理地址映射，mmap后访问触发CPU的Memory Read TLP。</span> 此操作需root权限，且绕过内核驱动直接访问硬件可能导致状态不一致。

### <strong>场景二：Switch地址路由窗口配置与调试</strong>

PCIe Switch的每个Downstream Port包含一对Base/Limit寄存器，定义了该端口下游子树的地址范围。

```bash
# 查看Switch端口的路由窗口
# 假设Switch位于Bus 2，Downstream Port在Device 1
sudo lspci -vv -s 02:01.0 | grep -E "Memory behind bridge|Prefetchable memory"

# 典型输出：
# Memory behind bridge: f4000000-f41fffff [size=2M]
# Prefetchable memory behind bridge: 00000000f4200000-00000000f43fffff [size=2M]
```

<br>Switch的Memory Base/Limit寄存器位于配置空间偏移0x20（Type1 Header），格式为16-bit对齐的高地址位：

```c
/* 解析Switch Memory Base/Limit寄存器 */
uint32_t base_limit = pci_read_config_dword(pdev, 0x20);
uint16_t mem_base  = (base_limit >> 0)  & 0xFFF0;   /* bits 15:4 */
uint16_t mem_limit = (base_limit >> 16) & 0xFFF0;   /* bits 31:20 */

/* 实际地址 = 高16位 << 16 | 0x0000 */
printf("Switch downstream memory window: 0x%08X - 0x%08X\n",
       mem_base << 16, (mem_limit << 16) | 0xFFFFF);
```

<br><span class="blue">Switch仅检查TLP地址是否落在其任一Downstream Port的Base/Limit窗口内，若均不匹配则向上游转发。地址重叠会导致路由歧义，枚举算法通过资源分配避免此问题。</span>

---

## <strong>历史演进</strong>

<span class="red">TLP格式从PCIe 1.0到6.0保持了核心Header结构的向后兼容，但每代都有扩展字段以支持新功能。</span>

<br>PCIe 1.0定义了基础3 DW/4 DW Header，支持32-bit和64-bit地址，Transaction ID由Requester ID + Tag组成。ECRC（End-to-End CRC）作为可选项在Header后附加，提供跨Switch的端到端完整性校验。

<br>PCIe 2.0引入了Extended Tag字段（从5-bit扩展到8-bit），使单个Requester可同时挂起256个未完成的非Posted事务，提升了高延迟链路的吞吐量。Attr字段增加了ID-Based Ordering支持。

<br>PCIe 3.0将Max Payload Size扩展至4 KB，同时增加了Phantom Function支持以进一步扩展Tag空间。

<br>PCIe 4.0和5.0主要在TLP层面保持兼容，性能提升来自物理层提速。

<br>PCIe 6.0引入了FLIT模式，TLP在事务层被重组为固定256-byte的FLIT（Fixed Latency Interface Transmission）块。这改变了TLP的传输封装方式，但事务层的语义（请求/完成类型、路由规则）保持不变。FLIT模式下，多个TLP可打包进单个FLIT，或一个大型TLP拆分到多个FLIT。

<br><span class="purple">CXL协议在PCIe 6.0物理层上运行，但在事务层完全替换为CXL协议。CXL.io保留PCIe TLP语义用于IO操作，CXL.cache和CXL.memory使用全新的cache和memory语义，这是PCIe事务层生态的重大扩展。</span>

---

## 小结与练习

| 要点 | 说明 |
|------|------|
| 核心概念 | TLP是事务层数据包，Header含Fmt/Type/地址/ID，Data Payload可选；四类事务满足不同寻址需求 |
| 关键技能 | 掌握BAR探测算法（写全1读回），理解三种路由机制适用场景，能解析lspci的BAR输出 |
| 常见误区 | 混淆Posted与非Posted事务；忽视Attr字段的排序语义；64-bit BAR未按高低顺序写入 |
| 路由机制 | 地址路由用于Memory/IO；ID路由用于Configuration/Completion；隐式路由用于Message |
| FLIT演进 | Gen6将TLP打包为256-byte FLIT块，事务层语义不变但封装方式变化 |

**练习**

1. 某设备Type0 Header的BAR0读回值为0xFFFFF004。分析该BAR的类型（Memory/IO）、地址宽度（32/64-bit）、Prefetchable属性，并计算所需地址空间大小。

2. 解释为什么Completion TLP必须使用ID路由而非地址路由。如果某Switch的地址路由表损坏但ID路由正常，哪些事务类型仍可工作？哪些会失败？

3. 在NVMe驱动中，驱动程序通过writel()向BAR0偏移0x14写入命令队列门铃值。描述此操作在PCIe事务层生成的TLP类型、Header关键字段（Fmt、Type、地址来源）以及是否为Posted事务。
