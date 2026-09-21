# B-D.10.6 实战：PCIe EP 卡 BAR 访问与 DMA 驱动开发全流程

> 所属章节：第五部 B. 总线协议 > B-D.10 PCIe
>
> 难度：[M] Master | 预计阅读时间：60 分钟

## <span class="blue"> 本节导读

10.1~10.3 的每一篇都停在了"机制讲透"的边界上。本篇把边界拆掉：拿一张典型的 FPGA PCIe Endpoint 卡，从它的内部结构出发，走完"枚举确认 → BAR 寄存器访问 → DMA 双向传输 → 中断联动 → 联调排障"的完整闭环。读完后你应该能独立面对一块陌生的 EP 卡，在没有原厂支持的情况下把基本通信跑起来。

这正是 PCIe 卡工程师岗位的日常形态：FPGA 同事实现链路侧（SerDes、TLP 引擎）和卡上逻辑，软件侧拿到的是一份寄存器手册和一张卡。本篇的寄存器设计取自这一类卡的通行结构，不绑定任何具体厂商。

本篇是代码级实战，10.1~10.3 是直接先修；板卡 bring-up 遇到信号完整性问题时回 10.4。没有硬件的读者走最后一节的 QEMU 后备路径，全部代码可跑。

本节覆盖：典型 EP 卡的内部结构与寄存器布局、驱动侧 BAR 映射的完整实现、用户态访问 BAR 的三条路径与选型、DMA 描述符环的驱动实现、MSI-X 完成中断、联调四类故障的定位路径、QEMU edu 虚拟设备后备。

---

## <span class="blue"> 场景与硬件结构：一张典型 EP 卡长什么样

我们面对的卡：FPGA 实现 PCIe EP 硬核 + 卡上业务逻辑，对外暴露 BAR0（寄存器区）和一个 DMA 引擎（主机内存 ↔ 卡内缓冲双向搬运），中断用 MSI-X。这是测试测量卡、采集卡、加速卡的通行最小结构。

```text
┌──────────────────── FPGA EP 卡 ────────────────────┐
│                                                     │
│  PCIe EP 硬核 ── BAR0 寄存器窗口 ── 业务逻辑寄存器    │
│      │                                              │
│      └────────── DMA 引擎 ──────── 卡内 DDR 缓冲     │
│                    │                                │
│                 MSI-X 发生器                         │
└──────────────────────┬──────────────────────────────┘
                       │ x4 链路
                  主机 Root Complex
```

配套的寄存器手册（通行约定，实际项目以原厂手册为准）：

| 偏移 | 寄存器 | 作用 |
|:----:|--------|------|
| 0x00 | ID | 只读魔数（如 0xCAED_0001）——驱动探活第一读 |
| 0x04 | VERSION | FPGA 逻辑版本 |
| 0x08 | CTRL | Bit0 = 全局使能，Bit1 = DMA 启动（门铃） |
| 0x0C | STATUS | Bit0 = DMA 忙，Bit1 = DMA 完成（写 1 清除） |
| 0x10 | IRQ_STATUS | 中断挂起位（写 1 清除） |
| 0x14 | IRQ_ENABLE | 中断使能位 |
| 0x20 | DMA_DESC_LO / 0x24 HI | 描述符环的总线地址 |
| 0x28 | DMA_DESC_NUM | 环中描述符数量 |

> 门铃（Doorbell）：驱动启动硬件动作的通行手法——驱动把参数写进各寄存器后，往 CTRL 写一个"启动位"，硬件看到该位翻转即开工。名字来自"按铃通知"，本质是寄存器写触发的边沿逻辑。

DMA 引擎采用**描述符环**：驱动在主机内存里建一个环形数组，每个描述符是 `{总线地址, 长度, 控制位}`，硬件按环逐个执行搬运。描述符环是双方长期共享的小结构——按 10.3 的选型口诀，用一致性 DMA 分配；搬运的数据缓冲区用流式 DMA。

---

## <span class="blue"> 驱动实现：从 probe 到 BAR 寄存器访问

probe 骨架沿用 10.3 的七步（托管 API 版），这里补上 EP 卡特有的部分——探活读 ID 与寄存器访问封装：

```c
#include <linux/pci.h>
#include <linux/dma-mapping.h>

#define REG_ID          0x00
#define REG_CTRL        0x08
#define REG_STATUS      0x0c
#define REG_IRQ_STATUS  0x10
#define REG_IRQ_ENABLE  0x14
#define REG_DESC_LO     0x20
#define REG_DESC_HI     0x24
#define REG_DESC_NUM    0x28

#define CARD_MAGIC      0xcaed0001
#define CTRL_ENABLE     BIT(0)
#define CTRL_DMA_START  BIT(1)
#define ST_DMA_DONE     BIT(1)

struct ep_card {
    struct pci_dev *pdev;
    void __iomem *bar0;
    struct ep_desc *ring;      /* 一致性 DMA：描述符环 */
    dma_addr_t ring_dma;
    int nvec;
};

struct ep_desc {               /* 与 FPGA 约定的描述符格式 */
    __le32 addr_lo;
    __le32 addr_hi;
    __le32 len;
    __le32 flags;
};

static int ep_probe(struct pci_dev *pdev, const struct pci_device_id *id)
{
    struct ep_card *card;
    u32 magic;
    int err;

    card = devm_kzalloc(&pdev->dev, sizeof(*card), GFP_KERNEL);
    if (!card)
        return -ENOMEM;
    card->pdev = pdev;
    pci_set_drvdata(pdev, card);

    err = pcim_enable_device(pdev);
    if (err)
        return err;
    err = pcim_iomap_regions(pdev, BIT(0), "ep_card");
    if (err)
        return err;
    pci_set_master(pdev);
    card->bar0 = pcim_iomap_table(pdev)[0];
    if (!card->bar0)
        return -ENOMEM;

    /* 探活：读 ID 寄存器验证 BAR 映射正确——不对就是映射/翻译出了问题 */
    magic = readl(card->bar0 + REG_ID);
    if (magic != CARD_MAGIC) {
        dev_err(&pdev->dev, "bad magic 0x%08x (expect 0x%08x)\n", magic, CARD_MAGIC);
        return -ENODEV;
    }

    err = dma_set_mask_and_coherent(&pdev->dev, DMA_BIT_MASK(64));
    if (err)
        dma_set_mask_and_coherent(&pdev->dev, DMA_BIT_MASK(32));

    /* 一致性 DMA 分配描述符环：64 个描述符 */
    card->ring = dma_alloc_coherent(&pdev->dev,
                                    64 * sizeof(struct ep_desc),
                                    &card->ring_dma, GFP_KERNEL);
    if (!card->ring)
        return -ENOMEM;

    /* MSI-X：先申请 2 向量（向量0=DMA完成，向量1=错误上报） */
    card->nvec = pci_alloc_irq_vectors(pdev, 2, 2, PCI_IRQ_MSIX);
    if (card->nvec < 0)
        card->nvec = pci_alloc_irq_vectors(pdev, 1, 1,
                                           PCI_IRQ_MSI | PCI_IRQ_LEGACY);
    if (card->nvec < 0)
        return card->nvec;
    err = devm_request_irq(&pdev->dev, pci_irq_vector(pdev, 0),
                           ep_irq_handler, 0, "ep_card", card);
    if (err)
        return err;

    /* 使能设备与中断 */
    writel(0x1, card->bar0 + REG_IRQ_ENABLE);
    writel(CTRL_ENABLE, card->bar0 + REG_CTRL);

    dev_info(&pdev->dev, "ep_card probed, magic ok, nvec=%d\n", card->nvec);
    return 0;
}
```

注意 probe 里那个 `readl(REG_ID)` 探活——它是 EP 卡驱动的标准动作，也是排障分水岭：**ID 读对，说明枚举、BAR 分配、地址翻译、映射四层全通；ID 读错（常见读回全 0 或全 1），问题一定在这四层里**，按联调一节的顺序查。

---

## <span class="blue"> 用户态访问 BAR 的三条路径

调试期和轻量场景下，经常不想写完整内核驱动，直接在用户态戳寄存器。三条路径按侵入性排序：

| 路径 | 做法 | 优点 | 局限 |
|------|------|------|------|
| `devmem` 命令 | `devmem 0x<f4000000+偏移>` 直读物理地址 | 零代码，shell 即用 | 无并发保护、无数值检查；需要 BAR 地址已分配且拿到的是 CPU 视角地址 |
| sysfs `resource0` | `mmap()` `/sys/bus/pci/devices/.../resource0` | 不需内核模块，地址由内核给好 | 部分发行版默认限制；中断拿不到 |
| UIO | 加载 `uio_pci_generic` 或自写 UIO 驱动，`mmap()` + `read()` 等中断 | 用户态完整方案：寄存器 + 中断 | DMA 与 Cache 一致性在用户态很难做对——**只适合做控制面，别在用户态做 DMA 数据面** |

devmem 实战示例（设备在 `01:00.0`，BAR0 起始 0xf4000000）：

```bash
devmem 0xf4000000            # 读 ID 寄存器 → 0xCAED0001
devmem 0xf4000008 32 0x1     # CTRL 置使能位
```

> ⚠️ 用户态路径的正确角色是**调试探针**：驱动没写好之前，用 devmem 先验证"卡是活的、手册是对的"。正式产品的数据面（DMA）必须回内核态——用户态拿不到 Cache 同步和 IOMMU 的正确处理。

---

## <span class="blue"> DMA 传输实现：描述符环转起来

发起一次"主机 → 卡"的 DMA 传输，驱动侧的完整动作：

```c
int ep_dma_send(struct ep_card *card, void *buf, size_t len)
{
    struct ep_desc *d = &card->ring[0];
    dma_addr_t data_dma;

    /* 1. 流式映射数据缓冲区（10.3 的 Cache 同步在 map 里完成） */
    data_dma = dma_map_single(&card->pdev->dev, buf, len, DMA_TO_DEVICE);
    if (dma_mapping_error(&card->pdev->dev, data_dma))
        return -ENOMEM;

    /* 2. 填描述符 */
    d->addr_lo = cpu_to_le32(lower_32_bits(data_dma));
    d->addr_hi = cpu_to_le32(upper_32_bits(data_dma));
    d->len     = cpu_to_le32(len);
    d->flags   = cpu_to_le32(DESC_VALID);

    /* 3. 告诉硬件环在哪、几个描述符，然后按门铃 */
    writel(lower_32_bits(card->ring_dma), card->bar0 + REG_DESC_LO);
    writel(upper_32_bits(card->ring_dma), card->bar0 + REG_DESC_HI);
    writel(1, card->bar0 + REG_DESC_NUM);
    writel(CTRL_ENABLE | CTRL_DMA_START, card->bar0 + REG_CTRL);

    /* 4. 等完成中断，然后解除映射 */
    wait_for_completion_timeout(&card->dma_done, HZ);
    dma_unmap_single(&card->pdev->dev, data_dma, len, DMA_TO_DEVICE);
    return 0;
}
```

中断处理函数——读挂起位、清中断、唤醒等待者：

```c
static irqreturn_t ep_irq_handler(int irq, void *data)
{
    struct ep_card *card = data;
    u32 pending = readl(card->bar0 + REG_IRQ_STATUS);

    if (!pending)
        return IRQ_NONE;              /* 共享中断下必须区分"不是我的" */

    writel(pending, card->bar0 + REG_IRQ_STATUS);   /* 写 1 清除 */
    if (pending & ST_DMA_DONE)
        complete(&card->dma_done);
    return IRQ_HANDLED;
}
```

反向传输（卡 → 主机）同构：方向改 `DMA_FROM_DEVICE`，完成后 CPU 读数据前由 `dma_unmap_single` 完成 Cache 失效——10.3 讲的同步语义在这里落地。

---

## <span class="blue"> 联调：四类故障的定位路径

EP 卡联调的问题集中在四类，每类有固定的排查顺序——多数能收敛到前几篇的具体机制上：

**第一类：枚举失败**（`lspci` 看不到卡）
→ dmesg 看主控日志 → REFCLK/PERST# 时序（10.4 热插拔一节）→ LTSSM 卡哪个状态（10.1 决策表）→ 还不通则降速降宽度保底。

**第二类：BAR 访问错**（卡枚举到了，读 ID 不对）
→ `lspci -v` 看 Control 行 Mem+ 是否置位 → 读回全 1 = 地址翻译问题（设备树 ranges / ATU，10.2 🔴 框）→ 读回全 0 = BAR 没分到地址 → 读回乱码 = 信号质量问题（10.4 决策树）。

**第三类：DMA 数据错**（传输完成但内容不对）
→ 先验证单缓冲流式 DMA（最小路径）→ 查 Cache 同步调用点（10.3 ⚠️ 框）→ 查 DMA mask 与实际内存高度 → 最后怀疑描述符格式与 FPGA 端的位序约定（`cpu_to_le32` 不是装饰——FPGA 侧通常小端，跨平台移植时逐字节对）。

**第四类：性能不达标**
→ `current_link_speed/width` 确认协商（10.1 口诀算理论值）→ 描述符环深度与单描述符长度（环太浅、块太小都压不满带宽）→ MSI-X 向量与 CPU 亲和 → AER 计数排除物理层重传损耗（10.4）。

> 💡 联调期的黄金组合：**devmem 探活 + lspci 看链路 + 示波器看 PERST#/REFCLK**。软件和硬件各自证明自己没有问题之后，剩下的就是接口约定——那一类问题最终都落在寄存器手册与代码的逐位对照上。

---

## <span class="blue"> 无硬件后备：QEMU edu 设备

QEMU 内置一个教学用虚拟 PCI 设备 `edu`（内核源码 `Documentation` 与 QEMU 的 `hw/misc/edu.c` 有对应实现），它实现了与本篇同构的最小集合：BAR0 寄存器（含 ID 探活）、简单 DMA、MSI/INTx 中断。启动：

```bash
qemu-system-x86_64 -device edu ...
```

虚拟机里 `lspci` 会看到一个 `1234:11e8` 的设备——本篇的 probe 骨架改一下 ID 表和寄存器偏移即可直接驱动它。DMA 部分 edu 提供单次搬移（无描述符环），够验证 map/unmap/中断的完整链路。**先用 edu 把驱动框架跑通，再上真实板卡**——虚拟环境里把 dma_map/中断/devmem 的手感练出来，真板联调时就能把注意力全部留给硬件差异。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 内核驱动 vs UIO 用户态 | 内核态能做对 DMA/一致性/中断全套；UIO 上手快但止步于控制面 |
| 描述符环 vs 寄存器直写地址 | 环支持排队与背压，是量产结构；单寄存器方案够原型验证 |
| MSI-X 多向量 vs 单向量 | 多向量分离完成/错误路径，可绑核；小卡单向量足够 |
| devmem 探活 vs 先写驱动 | devmem 十分钟验证硬件活性；但正式路径必须回内核驱动 |
| QEMU edu 先行 | 框架错误在虚拟环境里便宜；edu 无描述符环，环逻辑仍需真板验证 |

---

## <span class="blue"> 本节总结

本篇把 10.1~10.4 的机制全部兑换成了动作。贯穿全篇的最重要习惯是 **ID 探活**：probe 里的 `readl(REG_ID)` 是 EP 卡驱动的排障分水岭——读对了，枚举、BAR 分配、地址翻译、映射四层全通，之后的问题都在驱动与逻辑接口层；读错了，问题一定锁在那四层里，不用往下猜。这一个动作把"没反应"这个大症状劈成了两个不相交的问题域。

DMA 的实现套路到此闭环：描述符环是双方长期共享的小结构用一致性 DMA，数据缓冲是单次搬运用流式 DMA——10.3 的选型口诀在真实代码里就是这两个 API 的分工。传输序列五步（映射→填描述符→按门铃→等中断→解映射）固定不变，变的只是描述符格式与寄存器约定；中断处理函数的三件套（读挂起位、IRQ_NONE 分支、写 1 清除）是所有 EP 卡中断的通用骨架。

用户态三条路径记住各自的正确角色：devmem 和 resource0 是**调试探针**——驱动写好之前先验证"卡是活的、手册是对的"；UIO 能做控制面但别碰 DMA 数据面（Cache 一致性和 IOMMU 在用户态做不对）。没有硬件时用 QEMU edu 把框架手感练出来，再上真板——框架错误在虚拟环境里便宜得多。

### 速查表

| 项 | 要点 |
|----|------|
| 探活 | probe 首读 ID 魔数；读错=枚举/BAR/翻译/映射四层之一，读对=进入接口层 |
| DMA 分工 | 描述符环=coherent；数据缓冲=streaming+方向参数 |
| 传输五步 | map → 填描述符 → 写环地址+数量 → 按门铃 → 等中断+unmap |
| 中断三件套 | 读 IRQ_STATUS、空则 IRQ_NONE、写 1 清除 |
| 用户态 | devmem/resource0=探针；UIO=控制面；DMA 数据面必须回内核 |
| 联调四类 | 枚举失败查 LTSSM/复位时钟；BAR 错查 Mem+/ranges；DMA 错查 Cache 同步与位序；性能差查协商速率+环深度 |
| 无硬件 | QEMU edu（1234:11e8），改 ID 表和偏移即可复用本篇骨架 |

### 本节自查

1. probe 里读 ID 返回 0xFFFFFFFF 和返回乱码，分别指向哪一层的问题？
2. 为什么描述符环用 `dma_alloc_coherent` 而数据缓冲用 `dma_map_single`？反过来会怎样？
3. 中断处理函数里 `IRQ_NONE` 分支省掉会有什么后果？
4. 用户态 UIO 方案为什么不适合做 DMA 数据面？
5. DMA 带宽只有理论值一半，按什么顺序查协商速率、环深度、AER 三项？

## <span class="blue"> 下一步

PCIe 组（10.1~10.6）到此收官——从链路拓扑到枚举配置、驱动 DMA、高速排障、CXL 生态再到本篇的 EP 卡实战，一条线走完。下一站进入 **D.11 CAN 组**，开篇 **B-D.11.1 CAN FD 物理层与帧格式**：从计算机内部最高速的互联跳到工业与汽车领域最可靠的现场总线，机器人行业的关节通信主力就是它。

> 💡 本篇骨架往两个方向延伸：把它从"最小 EP 卡驱动"扩展成完整子系统驱动（字符设备接口、并发控制、子系统封装）的写法体系在 D 扩展驱动专题；QEMU edu 的虚拟设备实现在 QEMU 源码 `hw/misc/edu.c`，读它比读文档更快。DMA API 的权威参考是内核 `Documentation/core-api/dma-api.rst`。
