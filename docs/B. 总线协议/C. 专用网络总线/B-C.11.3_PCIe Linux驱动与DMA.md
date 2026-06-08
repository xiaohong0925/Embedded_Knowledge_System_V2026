# B-C.11.3 PCIe Linux驱动与DMA

> 所属章节：第五部 B. 总线协议 > B-C.11 PCIe高速串行总线
>
> 难度：[E][M] | 预计阅读时间：55分钟

## <span class="blue"> 本节导读

上两节我们把PCIe的硬件底子打牢了——从差分信号到TLP事务层，从枚举机制到BAR空间配置。但面对一个真实的PCIe设备（比如插在M.2插槽上的WiFi6网卡或NVMe固态硬盘），你该怎么写Linux驱动？怎么把BAR映射到内核虚拟地址？怎么让设备通过DMA直接读写系统内存而不经过CPU？这些才是从"懂原理"跨越到"能干活"的关键一跃。

想象一下这个场景：你的板子上插了一块Intel AX210 WiFi6模块和一块NVMe SSD。BIOS枚举通过了，lspci能看到设备，然后呢？pci_driver怎么注册？BAR0怎么映射成寄存器基地址？DMA传输时缓存一致性怎么保证？MSI中断怎么配置？这一节我们把这些问题一网打尽。

读完你会掌握：Linux PCIe驱动框架的核心API与调用顺序、BAR映射与DMA地址设置、一致性/流式DMA的操作流程、SG分散收集DMA的原理、INTx/MSI/MSI-X三种中断方式的差异，以及两个完整的行业实例——AX210 WiFi6驱动的加载验证和NVMe SSD的读写测试。从设备树配置到用户空间命令，端到端跑通。

<br>

## <span class="blue"> Linux PCIe驱动框架 [E][M]

PCIe在Linux内核中的驱动架构跟Platform驱动思路类似，但有其独特性。核心是`pci_driver`结构体和`pci_dev`结构体，前者代表驱动，后者代表设备实例。

### PCIe驱动架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     用户空间 (User Space)                          │
│       lspci  /sys/bus/pci/devices/  /dev/nvme0  /dev/wlan0       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  iwlwifi.ko  │  │  nvme.ko     │  │   你的pcie_driver    │   │
│  │  (WiFi驱动)  │  │  (SSD驱动)   │  │     (自定义)          │   │
│  │              │  │              │  │                      │   │
│  │ pci_driver{} │  │ pci_driver{} │  │    pci_driver{}      │   │
│  │ probe/remove │  │ probe/remove │  │    probe/remove      │   │
│  │ bar映射+DMA  │  │ bar映射+DMA  │  │    bar映射+DMA       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
├─────────┼─────────────────┼─────────────────────┼───────────────┤
│         │                 PCI Core               │               │
│  ┌──────▼─────────────────▼─────────────────────▼───────┐        │
│  │    pci_enable_device() / pci_request_regions()       │        │
│  │    pci_iomap() / pci_set_dma_mask()                  │        │
│  │    pci_alloc_consistent() / dma_map_single()         │        │
│  │    内核路径：drivers/pci/                            │        │
│  └────────────────────────┬─────────────────────────────┘        │
├───────────────────────────┼─────────────────────────────────────┤
│                           ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              PCIe Host Controller Driver                   │   │
│  │              (dw_pcie / mtk_pcie / rcar_pcie)              │   │
│  │            解析设备树 → 初始化PHY/时钟 → 枚举下游           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                           ▼                                       │
│                    硬件 (PCIe Root Complex + EP)                  │
└─────────────────────────────────────────────────────────────────┘
```

**核心思想**：PCI Core层提供了统一的API，让设备驱动不用关心底层是DesignWare PCIe还是某厂商自研控制器。驱动的生命周期围绕`probe`（设备发现后初始化）和`remove`（设备卸载或热拔）展开。

<br>

### pci_driver 结构体与注册

```c
/* 定义PCI设备ID表 - 驱动支持哪些Vendor/Device ID */
static const struct pci_device_id my_pcie_ids[] = {
    { PCI_DEVICE(0x8086, 0x2725) },   /* Intel AX210 WiFi6 */
    { PCI_DEVICE(0x144d, 0xa808) },   /* Samsung NVMe SSD */
    { 0, }  /* 结束标记 */
};
MODULE_DEVICE_TABLE(pci, my_pcie_ids);

/* pci_driver 结构体 */
static struct pci_driver my_pcie_driver = {
    .name     = "my_pcie_drv",
    .id_table = my_pcie_ids,      /* 匹配的设备ID列表 */
    .probe    = my_pcie_probe,    /* 设备匹配成功时调用 */
    .remove   = my_pcie_remove,   /* 设备移除时调用 */
    .suspend  = my_pcie_suspend,  /* 电源管理：挂起 (可选) */
    .resume   = my_pcie_resume,   /* 电源管理：恢复 (可选) */
};

/* 模块初始化：注册pci_driver */
static int __init my_pcie_init(void)
{
    return pci_register_driver(&my_pcie_driver);
}

/* 模块退出：注销pci_driver */
static void __exit my_pcie_exit(void)
{
    pci_unregister_driver(&my_pcie_driver);
}
module_init(my_pcie_init);
module_exit(my_pcie_exit);
```

**关键点**：`.id_table`里的Vendor ID和Device ID必须与`lspci -nn`输出一致。如果ID对不上，`probe`函数永远不会被调用——这是很多新手卡住的地方。

<br>

### PCIe驱动核心API

下面的表格总结了PCIe设备驱动在`probe`函数中必须按顺序调用的核心API：

| 函数 | 功能 | 调用时机 | 失败后果 |
|------|------|----------|----------|
| `pci_enable_device(pdev)` | 激活PCI设备，分配I/O和内存资源，唤醒设备 | probe中最早调用 | 设备无法访问，后续所有操作失败 |
| `pci_request_regions(pdev, name)` | 请求并独占该PCI设备的BAR区域，防止其他驱动抢占 | enable之后 | BAR被抢占，寄存器读写冲突 |
| `pci_iomap(pdev, bar, maxlen)` | 将指定BAR的物理地址映射到内核虚拟地址空间 | request_regions之后 | 无法通过指针访问设备寄存器 |
| `pci_set_dma_mask(pdev, mask)` | 设置DMA地址位数（32位或64位），告知设备能访问的内存范围 | iomap之前或之后均可 | DMA地址越界，数据传输失败或系统崩溃 |
| `pci_alloc_consistent(pdev, size, &dma_handle)` | 分配一致性DMA内存（ uncached ），返回CPU虚拟地址和DMA物理地址 | 需要DMA缓冲区时 | DMA缓冲区分配失败，无法启动DMA传输 |
| `pci_free_consistent(pdev, size, vaddr, dma_handle)` | 释放一致性DMA内存 | remove或模块卸载时 | 内存泄漏 |
| `pci_iounmap(pdev, vaddr)` | 取消BAR的虚拟地址映射 | remove中 | 虚拟地址残留，内核资源泄漏 |
| `pci_release_regions(pdev)` | 释放BAR区域占用 | remove中 | 资源不释放，其他驱动无法使用 |
| `pci_disable_device(pdev)` | 禁用PCI设备，进入低功耗状态 | remove最后调用 | 设备持续耗电，可能干扰其他设备 |

<br>

### probe函数完整框架

```c
static int my_pcie_probe(struct pci_dev *pdev, const struct pci_device_id *id)
{
    struct my_device_priv *priv;
    void __iomem *bar0_base;
    dma_addr_t dma_handle;
    void *dma_buf;
    int err;

    /* Step 1: 启用PCI设备 — 必须最先调用 */
    err = pci_enable_device(pdev);
    if (err) {
        dev_err(&pdev->dev, "Failed to enable PCI device, err=%d\n", err);
        return err;
    }

    /* Step 2: 请求BAR区域独占权 */
    err = pci_request_regions(pdev, "my_pcie_drv");
    if (err) {
        dev_err(&pdev->dev, "Failed to request regions\n");
        goto err_disable;
    }

    /* Step 3: 映射BAR0到内核虚拟地址 — 之后通过bar0_base读写寄存器 */
    bar0_base = pci_iomap(pdev, 0, 0);  /* bar=0, maxlen=0表示映射全部 */
    if (!bar0_base) {
        dev_err(&pdev->dev, "Failed to map BAR0\n");
        goto err_release;
    }

    /* Step 4: 设置DMA掩码 — 告诉设备我们能支持多大的DMA地址 */
    err = pci_set_dma_mask(pdev, DMA_BIT_MASK(64));
    if (err) {
        /* 64位失败则回退到32位 */
        err = pci_set_dma_mask(pdev, DMA_BIT_MASK(32));
        if (err) {
            dev_err(&pdev->dev, "No usable DMA configuration\n");
            goto err_iounmap;
        }
    }

    /* Step 5: 分配一致性DMA缓冲区 — 用于描述符环等需要CPU和Device同时访问的数据 */
    dma_buf = pci_alloc_consistent(pdev, 4096, &dma_handle);
    if (!dma_buf) {
        dev_err(&pdev->dev, "Failed to allocate DMA buffer\n");
        goto err_iounmap;
    }

    /* Step 6: 申请中断 — MSI或传统INTx */
    err = pci_enable_msi(pdev);  /* 尝试MSI */
    if (err) {
        dev_warn(&pdev->dev, "MSI not available, falling back to INTx\n");
    }
    err = request_irq(pdev->irq, my_pcie_irq_handler,
                      IRQF_SHARED, "my_pcie_drv", priv);
    if (err) {
        dev_err(&pdev->dev, "Failed to request IRQ %d\n", pdev->irq);
        goto err_dma_free;
    }

    /* Step 7: 初始化设备私有结构体，保存关键资源 */
    priv = kzalloc(sizeof(*priv), GFP_KERNEL);
    priv->pdev = pdev;
    priv->bar0_base = bar0_base;
    priv->dma_buf = dma_buf;
    priv->dma_handle = dma_handle;
    pci_set_drvdata(pdev, priv);  /* 将priv关联到pdev，remove时可取回 */

    /* Step 8: 初始化设备硬件 — 写寄存器、启动DMA引擎等 */
    my_pcie_hw_init(priv);

    dev_info(&pdev->dev, "PCIe device probed successfully, BAR0=%p, DMA=%pad\n",
             bar0_base, &dma_handle);
    return 0;

/* 错误处理：按相反顺序释放资源 */
err_dma_free:
    pci_free_consistent(pdev, 4096, dma_buf, dma_handle);
err_iounmap:
    pci_iounmap(pdev, bar0_base);
err_release:
    pci_release_regions(pdev);
err_disable:
    pci_disable_device(pdev);
    return err;
}
```

**错误处理是生死线**。PCIe驱动的`remove`函数或`probe`出错时的回退路径，必须严格按"后申请的先释放"的顺序执行，否则会导致资源泄漏甚至内核崩溃。

<br>

> ⚠️ **陷阱**：`pci_set_dma_mask(64)`成功后，你分配的DMA缓冲区地址可能超过4GB。但如果你的设备其实只支持32位DMA（某些老旧PCIe设备或桥接芯片），64位mask会导致DMA传输时地址截断，数据写到错误的物理地址，轻则数据损坏，重则系统panic。正确做法是先尝试64位，失败后回退到32位，并确保后续的`dma_alloc_*`也使用一致的mask。

<br>

## <span class="blue"> DMA操作与缓存一致性 [E][M]

PCIe设备的核心优势之一就是DMA——设备可以直接读写系统内存，不需要CPU逐字节搬运。但DMA引入了一个棘手的问题：**缓存一致性**。

### 为什么DMA需要特殊处理？

现代CPU都有数据缓存（Cache）。CPU写内存时可能只写到Cache，还没刷到物理内存，设备通过DMA读到的就是旧数据。反过来，设备通过DMA写数据到内存后，CPU读的时候可能命中Cache，读到的也是旧数据。

Linux提供了两套DMA API来解决这个问题：**一致性DMA（Coherent DMA）**和**流式DMA（Streaming DMA）**。

<br>

### 一致性DMA vs 流式DMA

| 特性 | 一致性DMA (Coherent) | 流式DMA (Streaming) |
|------|----------------------|---------------------|
| 缓存行为 | 关闭Cache，CPU和设备看到的始终一致 | 保持Cache，手动同步 |
| 性能 | 较低（每次访问都直达内存） | 较高（利用Cache加速） |
| 适用场景 | 设备描述符环、控制结构、频繁读写的状态变量 | 大批量数据传输（网卡收发包、SSD读写） |
| 分配API | `pci_alloc_consistent()` / `dma_alloc_coherent()` | 不需要特殊分配，使用普通内存 |
| 同步API | 不需要同步 | `dma_map_single()` / `dma_unmap_single()` |
| 内存限制 | 可能从特殊区域分配，大小受限 | 无特殊限制 |

<br>

### DMA API详解

下面的表格列出了流式DMA操作的核心API：

| 函数 | 功能 | 缓存一致性处理 | 适用场景 |
|------|------|---------------|----------|
| `dma_map_single(dev, cpu_addr, size, dir)` | 将CPU虚拟地址映射为DMA物理地址 | 根据dir刷Cache或Invalidate | 传输开始前调用 |
| `dma_unmap_single(dev, dma_addr, size, dir)` | 取消映射，释放DMA地址资源 | 根据dir刷Cache或Invalidate | 传输完成后调用 |
| `dma_sync_single_for_cpu(dev, dma_addr, size, dir)` | 设备写完后，让CPU能看到最新数据 | Invalidate CPU Cache | CPU读取DMA数据前 |
| `dma_sync_single_for_device(dev, dma_addr, size, dir)` | CPU准备好数据后，让设备能看到 | Flush CPU Cache到内存 | 设备读取DMA数据前 |
| `dma_map_sg(dev, sgl, nents, dir)` | 分散收集映射：把多个不连续的物理页映射为连续的DMA地址列表 | 同map_single | SG DMA传输 |
| `dma_unmap_sg(dev, sgl, nents, dir)` | 取消SG映射 | 同unmap_single | SG传输完成后 |

**dir参数**：`DMA_TO_DEVICE`（CPU→设备）、`DMA_FROM_DEVICE`（设备→CPU）、`DMA_BIDIRECTIONAL`（双向）、`DMA_NONE`。

<br>

### 流式DMA使用示例

```c
/* ========== 发送数据：CPU准备 → 设备DMA读取 ========== */
void send_packet(struct my_device_priv *priv, void *data, size_t len)
{
    dma_addr_t dma_addr;
    void *buf;

    /* 1. 在内核中分配发送缓冲区 */
    buf = kmalloc(len, GFP_KERNEL);
    memcpy(buf, data, len);

    /* 2. 映射缓冲区，让设备可以通过DMA访问 */
    dma_addr = dma_map_single(&priv->pdev->dev, buf, len, DMA_TO_DEVICE);
    if (dma_mapping_error(&priv->pdev->dev, dma_addr)) {
        kfree(buf);
        return;
    }

    /* 3. 将DMA地址写入设备寄存器，启动DMA传输 */
    writel(lower_32_bits(dma_addr), priv->bar0_base + REG_TX_DMA_ADDR_LO);
    writel(upper_32_bits(dma_addr), priv->bar0_base + REG_TX_DMA_ADDR_HI);
    writel(len, priv->bar0_base + REG_TX_DMA_LEN);
    writel(TX_START_BIT, priv->bar0_base + REG_TX_CTRL);

    /* 4. 等待传输完成（中断或轮询） */
    wait_for_completion(&priv->tx_done);

    /* 5. 传输完成，取消映射 */
    dma_unmap_single(&priv->pdev->dev, dma_addr, len, DMA_TO_DEVICE);
    kfree(buf);
}

/* ========== 接收数据：设备DMA写入 → CPU读取 ========== */
void recv_packet(struct my_device_priv *priv, void *data, size_t len)
{
    dma_addr_t dma_addr = priv->rx_dma_handle;

    /* 1. 映射接收缓冲区（方向：设备→CPU） */
    dma_addr = dma_map_single(&priv->pdev->dev, priv->rx_buf, len,
                               DMA_FROM_DEVICE);

    /* 2. 启动设备DMA写入 */
    writel(lower_32_bits(dma_addr), priv->bar0_base + REG_RX_DMA_ADDR);
    writel(len, priv->bar0_base + REG_RX_DMA_LEN);

    /* 3. 等待接收完成 */
    wait_for_completion(&priv->rx_done);

    /* 4. 同步：让CPU能看到设备写入的最新数据 */
    dma_sync_single_for_cpu(&priv->pdev->dev, dma_addr, len, DMA_FROM_DEVICE);

    /* 5. CPU读取数据 */
    memcpy(data, priv->rx_buf, len);

    /* 6. 取消映射 */
    dma_unmap_single(&priv->pdev->dev, dma_addr, len, DMA_FROM_DEVICE);
}
```

<br>

### SG（Scatter-Gather）DMA

实际应用中，数据往往不在连续的物理内存中（比如socket接收的数据分散在多个skb页中）。SG DMA允许设备通过一张"地址列表"（Scatter-Gather List）读写多个不连续的物理页。

```c
#include <linux/scatterlist.h>
#include <linux/dma-mapping.h>

/* 假设有多个不连续的数据片段 */
struct scatterlist sg[4];
int nents, mapped_nents;

/* 1. 初始化scatterlist数组 */
sg_init_table(sg, 4);
sg_set_buf(&sg[0], buf0, len0);   /* 第一个片段 */
sg_set_buf(&sg[1], buf1, len1);   /* 第二个片段（物理上可能不连续） */
sg_set_buf(&sg[2], buf2, len2);
sg_set_buf(&sg[3], buf3, len3);

/* 2. 将scatterlist映射为DMA地址 */
mapped_nents = dma_map_sg(&pdev->dev, sg, 4, DMA_TO_DEVICE);
if (mapped_nents == 0) {
    /* 映射失败 */
}

/* 3. 遍历映射后的sg，将DMA地址写入设备 */
for_each_sg(sg, sgent, mapped_nents, i) {
    dma_addr_t addr = sg_dma_address(sgent);   /* 获取DMA物理地址 */
    unsigned int len = sg_dma_len(sgent);      /* 获取映射长度 */

    /* 写入设备的SG描述符环 */
    write_sg_descriptor(priv, i, addr, len);
}

/* 4. 启动SG DMA传输 */
writel(SG_TX_START, priv->bar0_base + REG_SG_CTRL);

/* 5. 传输完成后取消映射 */
dma_unmap_sg(&pdev->dev, sg, mapped_nents, DMA_TO_DEVICE);
```

**SG的价值**：网卡收发包、NVMe SSD读写、视频采集等大数据量场景下，SG避免了内核先花大量CPU时间把所有数据拷贝到连续缓冲区的开销，直接让设备DMA读写分散的内存页。

<br>

### 中断处理：INTx vs MSI vs MSI-X

PCIe设备完成DMA传输后需要通知CPU，这就是中断。三种中断方式差异很大：

| 中断方式 | 原理 | 特点 | 性能 | 适用场景 |
|----------|------|------|------|----------|
| **INTx** | 传统的边带中断信号（INTA/INTB/INTC/INTD），所有设备共享一条中断线 | 需共享IRQ，需查询设备确认中断源 | 最低 | 老旧PCI设备兼容、不支持MSI的硬件 |
| **MSI** | Message Signaled Interrupt：设备通过写特殊的内存地址触发中断，每个设备可分配1~32个中断向量 | 不共享IRQ，无需查询确认，中断延迟低 | 中等 | 大多数PCIe设备的标准配置 |
| **MSI-X** | MSI的扩展版本，每个设备最多支持2048个独立中断向量 | 每个RX/TX队列独占一个中断向量，可实现一队列一CPU绑定 | 最高 | 高性能网卡（10GbE+）、NVMe SSD、多队列设备 |

<br>

```c
/* MSI中断使能 */
static int setup_msi_interrupts(struct pci_dev *pdev)
{
    int nvec = 4;  /* 申请4个中断向量 */
    int err;

    /* pci_enable_msi_range: 申请[nvec, nvec]范围的中断数 */
    err = pci_enable_msi_range(pdev, nvec, nvec);
    if (err < 0) {
        dev_warn(&pdev->dev, "MSI enable failed, use INTx\n");
        /* 回退到INTx：pdev->irq就是INTx中断号 */
        return request_irq(pdev->irq, my_intx_handler,
                           IRQF_SHARED, "my_pcie_intx", priv);
    }

    /* MSI成功后，pdev->irq是第一个MSI中断号，其余依次+1 */
    for (i = 0; i < nvec; i++) {
        err = request_irq(pdev->irq + i, my_msi_handler[i],
                          0, "my_pcie_msi", priv);
    }
    return 0;
}
```

<br>

## <span class="blue"> 行业实例：PCIe WiFi6模块（AX210）+ NVMe SSD [E][M]

### 场景描述

你的ARM64开发板上有两个M.2插槽，一个插了Intel AX210 WiFi6模块（PCIe x1），另一个插了三星NVMe SSD（PCIe x4）。我们要完成设备树配置、驱动加载和用户空间验证。

<br>

### 设备树PCIe控制器节点

```dts
/* arch/arm64/boot/dts/your-board.dts */

/ {
    /* PCIe PHY时钟 */
    pcie_refclk: pcie-refclk {
        compatible = "fixed-clock";
        #clock-cells = <0>;
        clock-frequency = <100000000>;  /* 100MHz PCIe参考时钟 */
    };
};

&pcie_controller {
    compatible = "your-soc,dw-pcie";
    reg = <0x0 0xfd000000 0x0 0x100000>,   /* DBI寄存器区域 */
          <0x0 0xfd100000 0x0 0x100000>;   /* ATU寄存器区域 */
    reg-names = "dbi", "atu";

    /* 中断：MSI需要GIC ITS支持 */
    interrupts = <GIC_SPI 120 IRQ_TYPE_LEVEL_HIGH>;
    #interrupt-cells = <1>;
    interrupt-map-mask = <0 0 0 7>;
    interrupt-map = <0 0 0 1 &gic GIC_SPI 121 IRQ_TYPE_LEVEL_HIGH>,  /* INTA */
                    <0 0 0 2 &gic GIC_SPI 122 IRQ_TYPE_LEVEL_HIGH>,  /* INTB */
                    <0 0 0 3 &gic GIC_SPI 123 IRQ_TYPE_LEVEL_HIGH>,  /* INTC */
                    <0 0 0 4 &gic GIC_SPI 124 IRQ_TYPE_LEVEL_HIGH>;  /* INTD */

    /* 地址映射：PCIe地址空间 → CPU物理地址空间 */
    /* ranges格式：<flags pref base-high base-low cpu-high cpu-low size-high size-low> */
    ranges = <0x82000000 0x0 0x00000000 0x6 0x00000000 0x0 0x40000000>;  /* 非预取MEM: 1GB */

    /* MSI控制器 — 必须配ITS才能用MSI/MSI-X */
    msi-parent = <&its>;

    /* 参考时钟 */
    clocks = <&pcie_refclk>;
    clock-names = "refclk";

    /* PERST#复位引脚 — 热插拔和初始化时拉低复位 */
    reset-gpios = <&gpio4 12 GPIO_ACTIVE_LOW>;

    /* PHY配置 */
    phys = <&pcie_phy>;
    phy-names = "pcie-phy";

    status = "okay";
};
```

> 💡 **提示**：PCIe热插拔需要先拉低PERST#引脚复位设备 → 等待100ms以上 → 上电 → 等待设备稳定 → 再扫描总线。顺序不能反过来！如果先上电再复位，设备可能进入不确定状态，枚举时挂死或报`Training Error`。

<br>

### 启动日志与设备枚举验证

```bash
# 查看PCIe控制器初始化日志
$ dmesg | grep -i pcie
[    2.341] your-soc-pcie fd000000.pcie: host bridge /pcie@fd000000 ranges:
[    2.342] your-soc-pcie fd000000.pcie:      MEM 0x0600000000..0x063fffffff -> 0x0000000000
[    2.345] your-soc-pcie fd000000.pcie: PCI host bridge to bus 0000:00
[    2.346] pci 0000:00:00.0: [1dd8:0100] type 01 class 0x060400  /* Root Port */
[    2.350] pci 0000:01:00.0 [8086:2725] type 00 class 0x028000  /* AX210 Network */
[    2.351] pci 0000:02:00.0 [144d:a808] type 00 class 0x010802 /* Samsung NVMe */

# 详细查看AX210设备信息
$ lspci -s 01:00.0 -vvv
01:00.0 Network controller: Intel Corporation Wi-Fi 6 AX210/AX211/AX411 (rev 1a)
    Subsystem: Intel Corporation Wi-Fi 6 AX210 160MHz
    Control: I/O- Mem+ BusMaster+ SpecCycle- MemWINV- VGASnoop- ParErr- Stepping-
    Status: Cap+ 66MHz- UDF- FastB2B- ParErr- DEVSEL=fast >TAbort- <TAbort- <MAbort- >SERR- <PERR-
    Latency: 0
    Interrupt: pin A routed to IRQ 121
    Region 0: Memory at 60000000 (64-bit, non-prefetchable) [size=16K]
    Capabilities: [40] Power Management version 3
    Capabilities: [50] MSI: Enable+ Count=1/1 Maskable+ 64bit+
    Capabilities: [70] Express Endpoint, MSI 00
    Capabilities: [100] Advanced Error Reporting
    Capabilities: [140] Device Serial Number ...
    Capabilities: [14c] Latency Tolerance Reporting
    Kernel driver in use: iwlwifi
    Kernel modules: iwlwifi

# 详细查看NVMe设备信息
$ lspci -s 02:00.0 -vvv
02:00.0 Non-Volatile memory controller: Samsung Electronics Co Ltd NVMe SSD Controller (rev 01)
    Subsystem: Samsung Electronics Co Ltd Device a801
    Control: I/O- Mem+ BusMaster+ SpecCycle- MemWINV- VGASnoop- ParErr-
    Status: Cap+ 66MHz- UDF- FastB2B- ParErr- DEVSEL=fast >TAbort-
    Latency: 0, Cache Line Size: 64 bytes
    Interrupt: pin A routed to IRQ 122
    Region 0: Memory at 60200000 (64-bit, non-prefetchable) [size=16K]
    Capabilities: [40] Power Management version 3
    Capabilities: [50] MSI: Enable+ Count=8/8 Maskable+ 64bit+
    Capabilities: [b0] MSI-X: Enable- Count=33 Masked-
    Capabilities: [c0] Express Endpoint, MSI 00
    Capabilities: [100] Advanced Error Reporting
    Capabilities: [148] Device Serial Number ...
    Capabilities: [158] Single Root I/O Virtualization (SR-IOV)
    Capabilities: [188] Latency Tolerance Reporting
    Capabilities: [190] L1 PM Substates
    Kernel driver in use: nvme
    Kernel modules: nvme
```

<br>

### AX210 WiFi6驱动加载与验证

```bash
# 1. 确认固件已就位（iwlwifi需要外部固件）
$ ls /lib/firmware/ | grep iwlwifi
iwlwifi-ty-a0-gf-a0-59.ucode      /* AX210对应的固件 */

# 2. 加载驱动（通常内核自动加载，也可手动）
$ modprobe iwlwifi
$ dmesg | grep iwlwifi
[   12.456] iwlwifi 0000:01:00.0: enabling device (0000 -> 0002)
[   12.456] iwlwifi 0000:01:00.0: Detected crf-type: harp
[   12.478] iwlwifi 0000:01:00.0: loaded firmware version 59.601f3a66
[   12.501] iwlwifi 0000:01:00.0: Detected Intel(R) Wi-Fi 6 AX210 160MHz
[   12.501] iwlwifi 0000:01:00.0:基带地址:0x... 射频类型:0x0

# 3. 查看无线接口
$ iw dev
phy#0
    Interface wlan0
        ifindex 4
        wdev 0x1
        addr 9c:2e:xx:xx:xx:xx
        type managed
        txpower 22.00 dBm

# 4. 扫描WiFi网络（验证PCIe通信 + DMA + 中断都正常）
$ iw dev wlan0 scan | grep SSID
        SSID: MyHome_5G
        SSID: CMCC-XXXX
        SSID: TP-LINK_XXXX

# 5. 连接WiFi并测试吞吐量
$ wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant.conf
$ dhclient wlan0
$ iperf3 -c 192.168.1.1
[SUM]   0.00-10.00  sec  1.08 GBytes   927 Mbits/sec    sender
```

<br>

### NVMe SSD驱动与性能测试

```bash
# 1. 确认NVMe设备被识别
$ nvme list
Node        SN                   Model                Namespace  Usage              Format
/dev/nvme0  S5G2NG0NBXXXXX       Samsung SSD 980 PRO  1         500.11 GB / 500.11 GB  512 B

# 2. 查看PCIe链路状态（速度和宽度）
$ cat /sys/bus/pci/devices/0000:02:00.0/current_link_speed
16.0 GT/s PCIe                   /* 确认跑在PCIe 4.0速度 */
$ cat /sys/bus/pci/devices/0000:02:00.0/current_link_width
4                                /* 确认x4宽度 */

# 3. 分区格式化
$ fdisk /dev/nvme0n1
$ mkfs.ext4 /dev/nvme0n1p1
$ mount /dev/nvme0n1p1 /mnt/nvme

# 4. fio性能测试（验证DMA读写性能）
$ fio --name=randread --ioengine=libaio --iodepth=32 \
      --rw=randread --bs=4k --direct=1 --size=4G \
      --numjobs=4 --runtime=60 --group_reporting \
      --filename=/dev/nvme0n1
  read: IOPS=1015k, BW=3965MiB/s   /* PCIe 4.0 x4 NVMe满速接近 */

$ fio --name=randwrite --ioengine=libaio --iodepth=32 \
      --rw=randwrite --bs=4k --direct=1 --size=4G \
      --numjobs=4 --runtime=60 --group_reporting \
      --filename=/dev/nvme0n1
  write: IOPS=723k, BW=2823MiB/s

# 5. 查看NVMe控制器信息（MSI-X使用情况）
$ nvme id-ctrl /dev/nvme0 | grep -E "(nn|mqes)"
mn        : Samsung SSD 980 PRO 500GB
sn        : S5G2NG0NBXXXXX
mqes      : 256                  /* 最大队列深度256 */
nn        : 1                   /* 1个命名空间 */
```

<br>

### AX210 + NVMe 的DMA机制对比

| 特性 | AX210 WiFi6 (iwlwifi) | NVMe SSD (nvme) |
|------|----------------------|-----------------|
| PCIe链路 | PCIe 3.0 x1 | PCIe 4.0 x4 |
| 理论带宽 | ~1GB/s | ~8GB/s |
| 实际带宽 | 2.4Gbps (WiFi6 160MHz) | ~4GB/s读 / ~3GB/s写 |
| DMA类型 | 流式DMA + SG | 流式DMA + PRP/SGL |
| 中断方式 | MSI (默认) / MSI-X | MSI-X (32 vectors) |
| DMA Mask | 64-bit | 64-bit |
| 缓存管理 | dma_map_single / dma_sync | dma_map_sg (大IO用SGL) |
| 驱动架构 | mac80211 → iwlwifi → PCIe | block层 → nvme → PCIe |
| 队列数 | 1 TX + 1 RX (per interface) | 最多64 IO队列 + 1 Admin |
| 用户空间 | iw / wpa_supplicant / iperf3 | nvme-cli / fio / dd |

<br>

## <span class="blue"> 调试技巧与常见问题

### 调试命令速查

```bash
# ========== PCIe枚举与配置空间 ==========
# 查看所有PCIe设备树
$ lspci -tv
-[0000:00]-+-00.0  YourSoC PCIe Root Port
           +-01.0--+-00.0  Intel AX210 WiFi
           \-02.0--+-00.0  Samsung NVMe SSD

# 查看设备配置空间原始数据（256字节或4KB）
$ lspci -s 01:00.0 -xxxx

# 查看BAR地址和大小
$ lspci -s 01:00.0 -v | grep "Region"

# 查看PCIe链路能力和当前状态
$ lspci -s 01:00.0 -vvv | grep -E "(LnkCap|LnkSta)"
    LnkCap: Port #0, Speed 16GT/s, Width x4
    LnkSta: Speed 16GT/s, Width x4, TrErr- Train-

# ========== 内核调试日志 ==========
# 打开PCIe调试打印（动态debug）
$ echo 'file drivers/pci/*.c +p' > /sys/kernel/debug/dynamic_debug/control

# 查看PCIe相关dmesg
$ dmesg | grep -iE "pci|pcie|nvme|iwlwifi"

# 查看MSI/MSI-X中断分配
$ cat /proc/interrupts | grep -E "(nvme|iwl|pci)"
  121:       4523     0     0     0  GICv3  121 Level   iwlwifi
  122:     890123    0     0     0  GICv3  122 Level   nvme0q0, nvme0q1
  123:     456789    0     0     0  GICv3  123 Level   nvme0q2, nvme0q3

# ========== DMA相关检查 ==========
# 查看设备的DMA mask设置
$ cat /sys/bus/pci/devices/0000:01:00.0/dma_mask_bits
64

# 查看IOMMU状态（如果启用）
$ dmesg | grep -i iommu
[    0.012] iommu: Default domain type: Translated

# ========== NVMe专用调试 ==========
# NVMe控制器寄存器状态
$ nvme show-regs /dev/nvme0

# 查看NVMe日志页
$ nvme error-log /dev/nvme0

# ========== WiFi专用调试 ==========
# 查看iwlwifi详细日志
$ modprobe iwlwifi debug=0xffffffff
$ dmesg -w | grep iwlwifi

# 查看无线接口统计
$ iw dev wlan0 station dump
$ iw dev wlan0 survey dump
```

<br>

### 常见问题排查

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| `lspci`看不到设备 | PERST#未释放 / 参考时钟未起振 / 链路Training失败 | 检查`dmesg`中`pcie`日志；测量REFCLK和PERST#信号 |
| 设备可见但` BAR`无法访问 | BAR未映射到CPU地址空间 / 地址翻译(ATU)配置错误 | 检查设备树`ranges`和`dma-ranges` |
| DMA传输数据错误 | DMA mask设置错误 / 缓存未同步 / IOMMU映射失败 | 检查`dma_mask_bits`；确认`sync_for_cpu`/`sync_for_device`调用 |
| MSI中断不触发 | GIC ITS未配置 / MSI地址写入错误 | 检查ITS节点；对比`lspci -vvv`中MSI地址和ITS基地址 |
| NVMe性能远低于标称 | 链路降速(x1 instead of x4) / 队列深度太小 | `cat current_link_speed`和`current_link_width`；fio调iodepth |
| iwlwifi固件加载失败 | 固件文件缺失或版本不匹配 | `dmesg`搜索`firmware`；到linux-firmware.git下载对应固件 |

<br>

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|------|----------|
| **PCIe驱动注册** | `pci_driver` + `pci_device_id` 表 → `pci_register_driver()` → 匹配后调用`probe()` |
| **probe调用链** | `pci_enable_device()` → `pci_request_regions()` → `pci_iomap()` → `pci_set_dma_mask()` → `pci_alloc_consistent()` → `request_irq()` |
| **BAR映射** | `pci_iomap(bar)`返回`void __iomem *`，后续用`readl()`/`writel()`访问寄存器 |
| **一致性DMA** | `pci_alloc_consistent()`分配uncached内存，适合描述符环；CPU和设备始终看到一致数据 |
| **流式DMA** | `dma_map_single()` → 传输 → `dma_sync_single_for_cpu()` → `dma_unmap_single()`；性能更高 |
| **SG DMA** | `dma_map_sg()`将多个不连续物理页映射为DMA地址列表；适合大数据量分散传输 |
| **中断选择** | 优先MSI-X（多队列并行）→ MSI（不共享低延迟）→ INTx（兼容老旧设备） |
| **DMA陷阱** | mask必须匹配设备能力；64位失败后必须回退32位；probe出错按逆序释放资源 |
| **热插拔** | 严格遵循 PERST#复位 → 等待 → 上电 → 扫描的顺序 |
| **AX210验证** | `lspci`确认枚举 → `dmesg`确认固件 → `iw dev`确认接口 → `iw scan`验证功能 |
| **NVMe验证** | `nvme list`确认设备 → `current_link_speed/width`确认链路 → `fio`测DMA吞吐 |

<br>

## <span class="blue"> 下一步

PCIe的高速串行传输能力为存储和网络设备提供了超高带宽，但在嵌入式音频领域，我们还需要了解另一种专用的串行总线——**I2S（Inter-IC Sound）**。下一节 **B-C.12.1 I2S与PCM物理层** 将带你进入音频世界：从I2S的时钟线（BCLK）、帧同步线（LRCK/WS）到数据线（SD），以及它和PCM（脉冲编码调制）的关系，为后续理解音频Codec驱动打下基础。

<br>

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/PCI/pci.rst`、`Documentation/DMA-API.rst`
- **驱动源码**：`drivers/pci/`、`drivers/net/wireless/intel/iwlwifi/`、`drivers/nvme/host/`
- **工具**：`pciutils`（lspci/setpci）、`nvme-cli`、`iw`、`wireless-tools`、`fio`
- **参考手册**：Intel AX210 Datasheet、NVM Express Base Specification 2.0
- **固件下载**：`git://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git`
