# B-D.10.3 PCIe Linux 驱动与 DMA

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[M] Master | 预计阅读时间：50 分钟

## <span class="blue"> 本节导读

10.1 讲清了链路与拓扑，10.2 讲清了枚举与配置空间——这两篇的成果，是系统启动后每个 PCIe 设备都带着一份"已分配好的资源清单"等在那里。本篇回答的问题是：驱动代码怎么把这份清单消费掉。`pci_driver` 怎么注册、`probe()` 里那七八个 API 调用各自对应哪个硬件动作、DMA 为什么必须处理缓存一致性、MSI-X 中断在代码里怎么落地——这些是 PCIe 驱动开发的全部骨架。

本篇与 D 扩展的分工：D 扩展讲"驱动写法的通用套路体系"（probe 模式、资源管理、子系统封装），本篇只讲 PCI 驱动特有的部分——总线特有的 API、DMA 与中断的 PCI 侧机制。通用机制（bus-device-driver 匹配、devm 资源管理）见主线第 11 章，不重复展开。

本篇面向要在真实板卡上写或调 PCIe 驱动的工程师，所有 API 以 v6.6 内核为准。锚点实例是两块经典设备：Intel AX210 WiFi 模组（PCIe x1）与 NVMe SSD（PCIe x4）。

本节覆盖：PCI Core 分层与驱动注册、probe 的完整步骤与每步的失败症状、BAR 映射与寄存器访问、缓存一致性问题的完整推理、一致性/流式/SG 三种 DMA 的选型与代码、INTx/MSI/MSI-X 的代码落地、真实设备的加载验证路径、常见故障排查表。

---

## <span class="blue"> 驱动在内核里的位置

一个 PCIe 设备驱动并不直接面对硬件链路，它叠在三层之上：

```text
┌──────────────────────────────────────────────────┐
│ 用户空间：lspci / /sys/bus/pci / /dev/nvme0       │
├──────────────────────────────────────────────────┤
│ 设备驱动：iwlwifi.ko / nvme.ko / 你的驱动          │
│   pci_driver{ .probe .remove .id_table }         │
├──────────────────────────────────────────────────┤
│ PCI Core（drivers/pci/）                          │
│   枚举（10.2）/ 资源分配 / 统一 API 出口           │
├──────────────────────────────────────────────────┤
│ 主控驱动（dw_pcie 等，SoC 原厂提供）                │
│   解析设备树 → 初始化 PHY/时钟 → 拉起 LTSSM        │
└──────────────────────────────────────────────────┘
```

这张分层图解释了驱动开发的实际边界：**枚举、总线扫描、地址分配都由 PCI Core 和主控驱动在你介入之前完成**。你的驱动被 `probe()` 叫醒时，BAR 已经分好了地址、链路已经训练完毕——你要做的是"启用设备、接管资源、开始收发"。这也解释了排障的分界：`lspci` 都看不到的设备不是你的驱动的问题（往下看 PHY/时钟/复位）；`lspci` 正常但驱动不工作，才是本篇内容的问题域。

---

## <span class="blue"> 驱动注册与匹配

PCI 驱动与 platform 驱动（第 11 章）同构：一个描述"我是谁"的结构体、一张描述"我支持谁"的 ID 表、一对 probe/remove 回调。不同的是匹配依据——platform 驱动靠设备树 compatible 字符串，PCI 驱动靠**枚举读到的 Vendor ID / Device ID**：

```c
/* ID 表：本驱动支持哪些设备 */
static const struct pci_device_id my_pcie_ids[] = {
    { PCI_DEVICE(0x8086, 0x2725) },   /* Intel AX210 */
    { PCI_DEVICE(0x144d, 0xa808) },   /* Samsung NVMe */
    { 0, }                            /* 结束标记 */
};
MODULE_DEVICE_TABLE(pci, my_pcie_ids);

static struct pci_driver my_pcie_driver = {
    .name     = "my_pcie_drv",
    .id_table = my_pcie_ids,
    .probe    = my_pcie_probe,
    .remove   = my_pcie_remove,
};

module_pci_driver(my_pcie_driver);   /* 注册/注销一体宏 */
```

`MODULE_DEVICE_TABLE` 宏把 ID 表导出给用户空间——设备插入时 udev 据此自动加载对应内核模块，这就是 PCIe 设备"插上来驱动自己就来了"的完整链路：枚举读到 ID → 生成 modalias → udev 匹配 → modprobe 加载 → probe 被调用。

> 💡 除了精确 ID 匹配，还有通配匹配：`PCI_DEVICE_CLASS(0x010802, ~0)` 匹配所有 NVMe 类设备（靠 10.2 讲的 Class Code）——nvme 驱动就是这样成批通吃所有厂商 NVMe 盘的。你的自定义驱动一般走精确 ID；当设备可换料（同一功能不同厂商）时才考虑 class 匹配。

probe 永远不被调用的头号原因就是 ID 对不上：拿 `lspci -nn` 的实际输出（方括号里的 `[8086:2725]`）逐一核对 ID 表，注意 Subsystem ID 不参与默认匹配。

---

## <span class="blue"> probe 完整流程：每一步对应一个硬件动作

`probe()` 里的 API 调用顺序不是惯例，是依赖关系——每步失败的症状都不同，记住这张表，驱动加载失败时按症状反查步骤：

| 步骤 | API | 对应 10.2 的哪个概念 | 失败时的典型症状 |
|------|-----|---------------------|------------------|
| 1. 启用设备 | `pci_enable_device()` | Command 寄存器置位、资源激活 | 后续一切访问无效；dmesg 报 "can't enable device" |
| 2. 独占 BAR 区域 | `pci_request_regions()` | resource 树占用标记 | 报 "BAR in use"——上一个驱动没释放干净 |
| 3. 设为总线主 | `pci_set_master()` | Command.Bit2 Bus Master | 不调用则 DMA 静默失败——寄存器读写正常但数据不动 |
| 4. 映射 BAR | `pci_iomap(pdev, 0, 0)` | BAR0 的 CPU 侧地址 | 返回 NULL：BAR 未使能或地址冲突 |
| 5. 设 DMA 掩码 | `dma_set_mask_and_coherent()` | 设备可寻址内存范围 | 高内存机器上 DMA 数据损坏（地址截断） |
| 6. 申请中断 | `pci_alloc_irq_vectors()` | MSI/MSI-X Capability | 中断永远不触发 |
| 7. 初始化硬件 | 写设备寄存器 | —— | 视设备而定 |

完整骨架（v6.6 现代 API）：

```c
struct my_priv {
    struct pci_dev *pdev;
    void __iomem *bar0;
    int nvec;
};

static int my_pcie_probe(struct pci_dev *pdev, const struct pci_device_id *id)
{
    struct my_priv *priv;
    int err;

    priv = devm_kzalloc(&pdev->dev, sizeof(*priv), GFP_KERNEL);
    if (!priv)
        return -ENOMEM;
    priv->pdev = pdev;
    pci_set_drvdata(pdev, priv);

    /* 1+2 合并：使能设备并请求全部 BAR 区域（devm 托管，免手动释放） */
    err = pcim_enable_device(pdev);
    if (err)
        return err;
    err = pcim_iomap_regions(pdev, BIT(0), "my_pcie_drv");
    if (err)
        return err;

    /* 3. 允许设备做 Bus Master——DMA 的前提 */
    pci_set_master(pdev);

    /* 4. 取 BAR0 映射基地址，之后 readl/writel 访问寄存器 */
    priv->bar0 = pcim_iomap_table(pdev)[0];
    if (!priv->bar0)
        return -ENOMEM;

    /* 5. DMA 掩码：先试 64 位，失败回退 32 位 */
    err = dma_set_mask_and_coherent(&pdev->dev, DMA_BIT_MASK(64));
    if (err)
        err = dma_set_mask_and_coherent(&pdev->dev, DMA_BIT_MASK(32));
    if (err) {
        dev_err(&pdev->dev, "no usable DMA configuration\n");
        return err;
    }

    /* 6. 中断：优先 MSI-X 多向量，依次自动降级 MSI → INTx */
    priv->nvec = pci_alloc_irq_vectors(pdev, 1, 4,
                                       PCI_IRQ_MSIX | PCI_IRQ_MSI | PCI_IRQ_LEGACY);
    if (priv->nvec < 0)
        return priv->nvec;
    err = devm_request_irq(&pdev->dev, pci_irq_vector(pdev, 0),
                           my_irq_handler, 0, "my_pcie_drv", priv);
    if (err)
        return err;

    /* 7. 设备硬件初始化：写寄存器、建描述符环…… */
    my_hw_init(priv);

    dev_info(&pdev->dev, "probed: bar0=%p, vectors=%d\n", priv->bar0, priv->nvec);
    return 0;
}
```

两处相对老代码的现代化修正，值得展开：

**`pcim_*` 与 `devm_*` 托管 API**（11.3.4 的 devm 机制在 PCI 侧的延伸）：`pcim_enable_device()`、`pcim_iomap_regions()` 申请的资源随设备自动释放，probe 出错返回时不用手写七八个 `goto` 回退标签——老代码里"按相反顺序释放资源"的错误处理阶梯，被资源托管整个消掉了。新代码一律用托管版。

**`pci_alloc_irq_vectors()` 取代 `pci_enable_msi()`**：这是 v6.6 的统一中断分配 API——传入想要的最小/最大向量数和支持的中断类型（`PCI_IRQ_MSIX | PCI_IRQ_MSI | PCI_IRQ_LEGACY`），内核按优先级自动尝试并降级。取第 i 个向量的中断号用 `pci_irq_vector(pdev, i)`——**不要再用 `pdev->irq + i` 推算**，MSI-X 的向量号并不保证连续，那是旧 MSI 时代的侥幸写法。

---

## <span class="blue"> DMA 与缓存一致性：为什么 DMA 需要专门一套 API

### 问题本身

CPU 有 Cache：CPU 写内存时，数据可能只进了 Cache，物理内存里还是旧值；设备 DMA 直读物理内存，读到的就是旧数据。反方向同样成立：设备 DMA 写了物理内存，CPU 读时命中了 Cache 里的旧副本。两边各看各的，数据就悄悄错了——而且这种错误**偶发、与负载相关、不可稳定复现**，是驱动 bug 里最难查的一类。

> 缓存一致性（Cache Coherence）：同一份内存数据在 CPU Cache 和物理内存（以及 DMA 设备视角）之间保持一致的性质。x86 的 PCIe DMA 由硬件保证一致性（snooping）；多数 ARM 嵌入式 SoC 的 DMA 不保证，必须由软件（驱动调 DMA API）维护——这就是这套 API 存在的理由，也是同一份驱动代码在 x86 上"没问题"、搬到 ARM 上就数据损坏的经典根源。

### 两种解法

| | 一致性 DMA（Coherent） | 流式 DMA（Streaming） |
|---|---|---|
| 做法 | 分配不可缓存的内存，CPU 与设备始终直访内存 | 用普通内存，传输前后手动同步 Cache |
| 性能 | 每次访问都穿到内存，慢 | 日常访问走 Cache，快 |
| 适用 | 描述符环、门铃寄存器镜像——小而频繁、双方都要读写 | 大块数据单向搬运——网卡报文、SSD 读写 |
| API | `dma_alloc_coherent()` / `dma_free_coherent()` | `dma_map_single()` / `dma_unmap_single()` + sync 系列 |

选型口诀：**长期共享的小结构用一致性，单次搬运的大数据用流式**。一个设备驱动几乎总是两者混用：描述符环（一致性）+ 数据缓冲区（流式）。

### 流式 DMA 的完整动作序列

流式 DMA 的每个 API 对应一次明确的 Cache 操作，理解了这个对应关系就永远不会用错：

```c
/* 发送路径：CPU 备好数据 → 设备读走 */
dma_addr_t dma;

dma = dma_map_single(&pdev->dev, buf, len, DMA_TO_DEVICE);
/* map 的动作：把 buf 对应 Cache 行刷回内存，返回设备可用的总线地址 */
if (dma_mapping_error(&pdev->dev, dma))
    return -ENOMEM;

/* 把总线地址和长度写进设备寄存器，敲门铃启动 DMA */
writel(lower_32_bits(dma), priv->bar0 + REG_DMA_ADDR_LO);
writel(upper_32_bits(dma), priv->bar0 + REG_DMA_ADDR_HI);
writel(len,               priv->bar0 + REG_DMA_LEN);
writel(DMA_START,         priv->bar0 + REG_DMA_CTRL);

wait_for_completion(&priv->done);     /* 等完成中断 */

dma_unmap_single(&pdev->dev, dma, len, DMA_TO_DEVICE);
/* unmap 的动作：本例方向下无实际 Cache 操作，释放映射资源 */
```

接收路径多一步：设备写完后、CPU 读之前，要用 `dma_sync_single_for_cpu()` 使对应 Cache 行失效——否则 CPU 读到的是 Cache 里的旧副本。`DMA_TO_DEVICE` 方向刷 Cache、`DMA_FROM_DEVICE` 方向失效 Cache，方向参数就是告诉内核该做哪个动作，写错方向的后果就是数据偶发错乱。

> ⚠️ map 与 unmap 之间的缓冲区是"借给设备"的：期间 CPU 代码不许读写这段内存（数据对 CPU 不可信），也不许 `kfree`。提前释放的破坏要等 DMA 引擎碰巧写到那片内存时才发作——可能已经是别的驱动的数据了。

### SG（Scatter-Gather）：不连续内存的直接传输

> Scatter-Gather（分散-收集）：把多个物理上不连续的内存片段，组织成一张"地址+长度"列表交给设备，设备按列表逐段 DMA，免去 CPU 先把数据拷到连续缓冲区的开销。

应用场景决定它绕不开：网络协议栈的 skb 数据天然分散在多页里；NVMe 一次 I/O 对应文件系统的多个页框。内核用 `struct scatterlist` 数组描述片段，`dma_map_sg()` 一次性映射整张表：

```c
struct scatterlist sg[4];
int nents;

sg_init_table(sg, 4);
sg_set_buf(&sg[0], buf0, len0);
sg_set_buf(&sg[1], buf1, len1);
/* ... */

nents = dma_map_sg(&pdev->dev, sg, 4, DMA_TO_DEVICE);
if (!nents)
    return -ENOMEM;

for_each_sg(sg, sgent, nents, i) {
    write_sg_desc(priv, i, sg_dma_address(sgent), sg_dma_len(sgent));
}
writel(SG_START, priv->bar0 + REG_DMA_CTRL);
/* …完成后… */
dma_unmap_sg(&pdev->dev, sg, 4, DMA_TO_DEVICE);
```

> 💡 IOMMU 会改变 `dma_map_*` 的行为：启用 IOMMU（ARM SMMU / Intel VT-d）时，map 返回的是 IOVA（I/O 虚拟地址）而非物理地址，SG 的多个不连续物理页还可能被 IOMMU 拼成连续 IOVA（`nents` 返回值小于输入）。设备能不能用直通地址、IOMMU 开关对性能的影响，是服务器/虚拟化场景的日常议题；嵌入式裸机上多数不启用。

---

## <span class="blue"> 中断的代码面：INTx / MSI / MSI-X

10.2 讲了寄存器面（Capability 结构、MSI-X 表），这里只补代码落地的差异：

| | INTx | MSI | MSI-X |
|---|---|---|---|
| 本质 | 虚拟化边带信号，多设备共享 IRQ | 写特定地址的 TLP，至多 32 向量且连续 | 写特定地址的 TLP，至多 2048 向量各自独立 |
| 代码申请 | `PCI_IRQ_LEGACY` | `PCI_IRQ_MSI` | `PCI_IRQ_MSIX` |
| 处理函数 | 必须先读设备寄存器确认中断源（共享） | 向量即来源，免确认 | 向量即来源，且可一队列一向量绑 CPU |
| 现状 | 只作兼容后备 | 普通设备标配 | 多队列高性能设备（NVMe、万兆网卡）标配 |

`pci_alloc_irq_vectors(pdev, min, max, flags)` 一套调用覆盖三者的尝试与降级，处理函数注册用 `pci_irq_vector(pdev, i)` 取向量号——上一节的 probe 骨架已经是完整写法。多队列设备的典型手法：probe 时申请 N 个向量，每个队列 `request_irq` 一个，再用 `irq_set_affinity()` 把向量 i 绑到 CPU i——网卡/NVMe 的多核性能就来自这里。

---

## <span class="blue"> 真实设备验证：AX210 + NVMe

以一块 ARM64 开发板接 AX210（PCIe x1）与 NVMe SSD（PCIe x4）为例，走一遍从设备树到功能验证的最短路径。

### 设备树：PCIe 主控节点的关键属性

```dts
&pcie {
    clocks = <&pcie_refclk>;              /* 100 MHz 参考时钟，链路训练的前提 */
    reset-gpios = <&gpio4 12 GPIO_ACTIVE_LOW>;   /* PERST# */
    phys = <&pcie_phy>;
    msi-parent = <&its>;                  /* MSI 需要中断控制器的 ITS 支持 */
    ranges = <0x82000000 0x0 0x00000000 0x6 0x00000000 0x0 0x40000000>;
    /* ranges：PCI 域地址 → CPU 物理地址的翻译表（10.2 的 ATU 一节） */
    status = "okay";
};
```

`ranges` 行是本篇与 10.2 的接缝：BAR 分到的 PCI 域地址经它翻译成 CPU 地址。配错的表现是设备能枚举、寄存器读写全错。

### 枚举与驱动加载日志判读

```text
[    2.345] pcie fd000000.pcie: host bridge ranges: MEM 0x0600000000..0x063fffffff
[    2.346] pci 0000:00:00.0: [1dd8:0100] type 01 class 0x060400   ← Root Port
[    2.350] pci 0000:01:00.0: [8086:2725] type 00 class 0x028000   ← AX210
[    2.351] pci 0000:02:00.0: [144d:a808] type 00 class 0x010802   ← NVMe
[   12.478] iwlwifi 0000:01:00.0: loaded firmware version 59.xxxx
[   12.501] iwlwifi 0000:01:00.0: Detected Intel(R) Wi-Fi 6 AX210 160MHz
```

三行 `pci 0000:` 就是枚举的现场报告：BDF、ID、Header Type（type 00 = Endpoint，01 = Bridge）、Class Code——与 10.2 的配置空间逐字段对应。随后 iwlwifi 打印固件加载与设备识别，说明驱动 probe 走完了全程。

### 功能验证与两者的机制差异

验证路径不需要长：AX210 用 `iw dev wlan0 scan`（扫到 SSID 即证明 PCIe 通信 + DMA + 中断链路全通）；NVMe 用 `nvme list` 确认设备、`fio` 跑带宽、对 `current_link_speed/width` 确认协商速率。两个设备放在一起，恰好覆盖本篇所有机制的两种典型用法：

| | AX210（iwlwifi） | NVMe SSD（nvme） |
|---|---|---|
| 链路 | PCIe 3.0 x1 | PCIe 4.0 x4 |
| DMA 形态 | 流式 + SG（skb 报文） | 流式 + SGL（块 I/O） |
| 一致性内存 | 描述符环 | Admin/IO 队列 |
| 中断 | MSI 单向量 | MSI-X 33 向量（每队列一个） |
| 带宽瓶颈 | 空口（2.4 Gbps），PCIe 绰绰有余 | PCIe 链路本身——降速立刻可见 |

这张表也给出排查直觉：**NVMe 性能不达标先查链路协商（10.1 的方法），WiFi 吞吐量不达标先查空口，PCIe 极少是瓶颈**。

---

## <span class="blue"> 调试与排障

### 命令速查

```bash
lspci -tv                                   # 拓扑树
lspci -s 01:00.0 -vvv                       # 完整配置空间解码（10.2 逐段讲过）
dmesg | grep -iE "pci|pcie"                 # 枚举与主控日志
echo 'file drivers/pci/*.c +p' > /sys/kernel/debug/dynamic_debug/control   # 打开 PCI Core 动态调试
cat /proc/interrupts | grep -E "nvme|iwl"   # 中断向量分配与触发计数
cat /sys/bus/pci/devices/0000:02:00.0/current_link_speed    # 协商速率
cat /sys/bus/pci/devices/0000:02:00.0/current_link_width    # 协商宽度
cat /sys/bus/pci/devices/0000:01:00.0/dma_mask_bits         # DMA 掩码
dmesg | grep -i iommu                       # IOMMU 状态
```

`/proc/interrupts` 是中断问题的第一手证据：向量分到了没有、计数涨不涨、是否均匀分布在多个 CPU 上，一行看全。

### 常见故障对照

| 现象 | 最可能原因 | 第一手检查 |
|------|-----------|-----------|
| `lspci` 看不到设备 | PERST# 未释放 / 参考时钟未起 / LTSSM 卡在 Detect | dmesg 主控日志；量 REFCLK 与 PERST# |
| 设备可见但寄存器读写无效 | `ranges` 翻译错 / Command.Mem 未使能 | 对设备树 ranges；`lspci -v` 看 Control 行 |
| probe 从未被调用 | ID 表不匹配 | `lspci -nn` 对 ID；查 modalias |
| 寄存器正常但 DMA 不动 | 漏调 `pci_set_master()` | 补调用；`lspci -v` 看 BusMaster+ |
| DMA 数据偶发错乱 | 缓存同步缺失 / dir 写错 | 审 `dma_sync_single_for_cpu` 调用点 |
| 中断不触发 | MSI 需 ITS 而设备树没配 / 向量号取错 | `msi-parent` 属性；`/proc/interrupts` |
| 高内存机器上数据损坏 | DMA mask 64 位与设备能力不匹配 | `dma_mask_bits`；回退 32 位验证 |
| 性能远低于标称 | 链路降速 / 队列深度不足 | `current_link_speed/width`；fio 加大 iodepth |

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| `pcim_/devm_` 托管 vs 手动释放 | 消灭回退阶梯与泄漏类 bug；代价是释放时机不再精确可控（绑定设备生命周期） |
| 一致性 vs 流式 DMA | 简单正确 vs 高性能但要手动同步——正确姿势是混用：环用一致性、数据用流式 |
| 精确 ID 匹配 vs Class 通配 | 精确匹配防误绑；Class 通配支持换料，但要承担同类别设备行为差异 |
| MSI-X 多向量 vs 单向量 | 多队列绑多核，中断并行；向量数消耗系统资源，小设备无必要 |
| IOMMU 开 vs 关 | 安全隔离与 IOVA 灵活性 vs 映射开销与调试复杂度 |

---

## <span class="blue"> 本节总结

| 自查项 | 读完应能独立完成的动作 |
|--------|------------------------|
| 分层定位 | 说出 PCI Core 在 probe 前替你完成了什么；按"lspci 是否可见"切分问题域 |
| 注册匹配 | 写出 id_table + `module_pci_driver` 骨架；用 `lspci -nn` 排查 probe 不触发 |
| probe 步骤 | 默写七步顺序，并给每步说出失败症状 |
| 现代 API | 说清 `pcim_*` 托管相对手动 goto 阶梯的收益；用 `pci_alloc_irq_vectors`/`pci_irq_vector` 写中断申请 |
| 缓存一致性 | 完整复述 DMA 数据错乱的机理；解释 x86 与 ARM 的差异来源 |
| DMA 选型 | 给一个设备场景（描述符环 + 数据缓冲），正确拆分一致性/流式并写出 API 序列 |
| SG | 说出 SG 解决什么问题、`nents` 返回值为什么可能小于输入 |
| 中断 | 三种中断方式选型；解释 `pdev->irq + i` 为什么是错的 |
| 排障 | 对着常见故障表，把"寄存器正常但 DMA 不动"这类症状映射到检查动作 |

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/PCI/pci.rst`、`Documentation/core-api/dma-api.rst`
- **内核源码**：`drivers/pci/`（PCI Core）、`drivers/nvme/host/`（MSI-X 多队列范本）、`include/linux/pci.h`（本篇全部 API 原型）
- **工具**：pciutils（lspci/setpci）、nvme-cli、fio
- **衔接**：B-D.10.1（链路层）、B-D.10.2（配置空间与 BAR）、第 11 章（设备模型与 devm）、B-D.10.6（把本篇骨架跑成一张 EP 卡的完整实战）
