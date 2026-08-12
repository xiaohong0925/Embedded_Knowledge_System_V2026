# D.6 内存与 DMA

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[E→M] | 预计阅读时间：40 分钟
>
> 与第9/12章的分工：第9章讲内存机制——buddy、SLUB 与 kmalloc 路径（9.2/9.3）、CMA（9.4）；12.1.4 讲 mmap 的系统调用路径；本篇讲驱动里怎么选怎么写——分配函数与 GFP 标志、kfifo 环形缓冲、DMA 两种映射与 cache 同步、mmap fop 的产品级实现。
>
> 与11.1.4的分工：裸驱动篇展示 ioremap/mmap 野路子长什么样、为什么过时；本篇给同类需求（用户态直接碰硬件）的正统形态。

## <span class="blue"> 本节导读

D.4 埋了两个钩子：FIFO 半满要批量搬 16 帧、`schedule_work` 转出去的批量活还没着落。批量数据放哪、怎么高效交给用户态，就是本篇要回答的。TS502 是 I2C 设备没有 DMA 能力，DMA 部分以"高速采集卡"对照场景讲——读者自己的 PCIe/AXI 项目会直接用到。<BR>
本节覆盖：分配函数与 GFP 标志场景表、kfifo 单读单写无锁缓冲（TS502 批量读落地）、DMA coherent vs streaming 与 cache 同步点、scatter-gather 概念、mmap 直通的四种正统形态（寄存器窗口/保留内存/coherent 零拷贝/权限校验）——把"用户态直接摸硬件"从野路子变成可维护的产品接口。

---

## <span class="blue"> kfifo：TS502 的批量缓冲落地 [E]

内核自带的环形缓冲 `kfifo`（`linux/kfifo.h`）是驱动里生产者-消费者缓冲的默认答案。TS502 的数据通路：work（生产者，批量读芯片 FIFO）→ kfifo → read（消费者，弹给用户态）。

```c
#include <linux/kfifo.h>

struct ts502_data {
    /* …… */
    struct kfifo fifo;              /* 采样数据环形缓冲 */
    struct work_struct fifo_work;   /* D.4 埋的 FIFO 半满批量搬运 */
};

/* probe 里：4KB 缓冲 = 2048 个采样点 */
ret = kfifo_alloc(&data->fifo, 4096, GFP_KERNEL);

/* 生产者：FIFO 半满中断转来的 work（进程上下文，可以做 I2C） */
static void ts502_fifo_work(struct work_struct *work)
{
    struct ts502_data *data = container_of(work, struct ts502_data, fifo_work);
    u8 burst[32];                       /* 一次最多搬 16 帧 × 2 字节 */
    int ret, depth;

    depth = i2c_smbus_read_byte_data(data->client, TS502_REG_FIFO_STATUS);
    if (depth < 0 || !(depth & 0x3f))
        return;

    ret = i2c_smbus_read_i2c_block_data(data->client, TS502_REG_FIFO_DATA,
                                        sizeof(burst), burst);
    if (ret < 0)
        return;

    kfifo_in(&data->fifo, burst, ret);  /* 入环：满时返回实际入队字节数 */

    if (kfifo_len(&data->fifo) >= 2)
        ts502_data_arrived(data);       /* 复用 D.3 通知：置标志+唤醒+SIGIO */
}

/* 消费者：read 改为从 kfifo 弹出（kfifo_to_user 内部做好 copy_to_user） */
static ssize_t ts502_read(struct file *filp, char __user *buf,
                          size_t count, loff_t *ppos)
{
    struct ts502_data *data = filp->private_data;
    unsigned int copied;
    int ret;

    /* …… D.3 的阻塞/非阻塞等待逻辑不变 …… */

    ret = kfifo_to_user(&data->fifo, buf, count & ~1UL, &copied);
    return ret ? ret : copied;
}
```

kfifo 的三个关键性质：

1. **单生产者单消费者无锁**：`kfifo_in` 与 `kfifo_out` 内部用内存屏障配对，一写一读不需要外加锁——中断转 work、work 到 read 这条链正好满足。多生产者（两个 work 同时 in）必须上锁或用 `kfifo_in_locked`
2. **满了丢新数据**：`kfifo_in` 返回实际入队字节数，写满时静默截断。采集场景要明确溢出策略：丢新的（保留历史）还是丢旧的（`kfifo_skip` 腾位置），并在 FIFO_STATUS 溢出位置位时上报统计（D.9 的 debugfs 计数器）
3. **`kfifo_to_user` 直达用户态**：省一次内核内存到内核内存的拷贝，比"先 kfifo_out 到临时缓冲再 copy_to_user"少一轮

---

## <span class="blue"> 分配函数与 GFP 标志：场景表 [E]

| 函数/标志 | 睡眠 | 物理连续 | 典型场景 |
|---|---|---|---|
| kmalloc + GFP_KERNEL | 可 | 是 | 进程上下文的默认选择 |
| kmalloc + GFP_ATOMIC | 否 | 是 | 中断/自旋锁内；可能失败，必须查返回值 |
| kmalloc + GFP_NOIO | 可 | 是 | 文件系统/块层路径：回收内存时不许再发起 IO |
| kvmalloc | 可 | 否（大块时） | 大缓冲（>几十KB）且不需要 DMA |
| vmalloc | 可 | 否 | 只需虚拟连续；**禁止给 DMA** |
| kmem_cache | 可配 | 是 | 同尺寸对象高频申请释放（每帧一个描述符） |
| mempool | 可 | 是 | 关键路径"不许失败"：预留库存兜底 |

选型决策链四步：① 什么上下文——原子上下文只有 GFP_ATOMIC；② 多大——超过几十 KB 考虑 kvmalloc；③ 要不要给 DMA——要，就走 DMA API（下一节），kmalloc/vmalloc 都不该直接给设备；④ 失败代价——不许失败的分配上 mempool。

机制层（buddy 为什么提供不了任意大小、SLUB 怎么服务 kmalloc）见 9.2/9.3，驱动侧只需记住 kmalloc 的实际上限：**单次分配超过 4MB 几乎必败，超过一页（4KB）就要开始考虑替代方案**。

---

## <span class="blue"> DMA 两种映射：cache 一致性是驱动自己的事 [E→M]

TS502 走 I2C 没有 DMA，本节用对照场景：一块高速数据采集卡（PCIe 或 AXI 主设备），采样数据由硬件直接写内存。CPU 和设备看内存的视角不同——CPU 看的是带 cache 的视图，设备看的是物理内存本身。ARM 上两者**不自动一致**：CPU 写进 cache 的数据设备看不到，设备写进内存的数据 CPU 可能读到 cache 里的旧值。内核 DMA API 就是管这个一致性的，两种用法：

### coherent：一致性内存（描述符/小环）

```c
dma_addr_t handle;
void *buf = dma_alloc_coherent(&pdev->dev, 4096, &handle, GFP_KERNEL);
/* buf 是 CPU 侧虚拟地址，handle 是给设备的总线地址 */
/* 读写任意时刻一致，无需 sync；释放：dma_free_coherent() */
```

省心，代价是这类内存来自受限区域（CMA，机制见 9.4），大块分配容易失败且浪费。**只用于小而长寿的结构**：DMA 描述符环、控制块。

### streaming：流式映射（数据缓冲主力）

```c
handle = dma_map_single(&pdev->dev, buf, len, DMA_FROM_DEVICE);

/* 给设备前：确保 CPU 的修改落到内存 */
dma_sync_single_for_device(&pdev->dev, handle, len, DMA_FROM_DEVICE);
/* …… 设备 DMA 搬运 …… */
/* 设备写完：丢弃 cache 旧值，CPU 才能读到新数据 */
dma_sync_single_for_cpu(&pdev->dev, handle, len, DMA_FROM_DEVICE);

dma_unmap_single(&pdev->dev, handle, len, DMA_FROM_DEVICE);
```

三个方向参数（`DMA_TO_DEVICE` / `DMA_FROM_DEVICE` / `DMA_BIDIRECTIONAL`）告诉内核该清洗还是作废 cache——方向写错等于没 sync。sync 点的口诀：**设备要读之前 for_device，CPU 要读之前 for_cpu**。

### scatter-gather：离散段一次映射

真实数据缓冲经常不是一整块物理连续内存（用户态大缓冲、vmalloc 区域）。`dma_map_sg()` 把 `scatterlist` 描述的多个离散段一次映射给设备，硬件按段表逐项搬运。驱动侧的增量工作只是填段表——前提是硬件支持 SG；不支持 SG 的硬件只能退化为 coherent 大缓冲或分段多次 DMA。

> 💡 踩坑自检：数据"大部分时候对、偶尔错"、重启后变好——八成是 cache 同步漏了一拍。这类 bug 的复现与定位是 DMA 调试的经典反面教材，工具手段链 E 扩展。

---

## <span class="blue"> mmap 直通：野路子的正统形态 [E→M]

需求本身正当：用户态想直接读硬件寄存器（调试工具）、想要零拷贝的数据通路（高吞吐采集）。野路子有两张面孔——`/dev/mem` 映整个物理内存（11.1.4 展示过，等于把系统大门钥匙交给所有进程）、驱动里 ioremap 后自己维护一套 ad-hoc 接口。正统形态是**驱动实现 mmap fop，把映射范围收在自己的校验之下**：

```c
static int ts502_mmap(struct file *filp, struct vm_area_struct *vma)
{
    size_t size = vma->vm_end - vma->vm_start;

    /* ① 校验：只允许映射自己的资源窗口，offset 与 size 双重检查 */
    if (vma->vm_pgoff != 0 || size > TS502_WINDOW_SIZE)
        return -EINVAL;

    /* ② 寄存器窗口必须禁 cache */
    vma->vm_page_prot = pgprot_noncached(vma->vm_page_prot);

    /* ③ 物理帧号映射进用户地址空间 */
    if (remap_pfn_range(vma, vma->vm_start,
                        data->regs_phys >> PAGE_SHIFT,
                        size, vma->vm_page_prot))
        return -EAGAIN;
    return 0;
}
```

四种正统形态按需求选：

| 需求 | 形态 | 关键 API |
|---|---|---|
| 用户态访问设备寄存器（调试/产测） | 寄存器窗口映射 | `remap_pfn_range` + `pgprot_noncached` |
| 零拷贝数据通路（采集→用户态） | coherent 缓冲直通 | `dma_mmap_coherent` |
| 大块预留内存（帧缓冲/AI 推理输入） | reserved-memory 声明 + 映射 | 设备树 reserved-memory + `remap_pfn_range` |
| 快速原型、硬件未定型 | 放弃内核 mmap，用 UIO | D.17 用户态驱动 |

安全边界三条：**校验 `vm_pgoff` 与 size**（不校验等于把任意物理内存拱手让人，/dev/mem 的洞换个地方重现）；**寄存器窗口禁 cache**（不禁则用户态读到的是 cache 旧值）；**只映射自己的资源**（`data->regs_phys` 来自自己的 DT reg，绝不接受用户传入物理地址）。配套语义：mmap 设备的 `.llseek` 用 `fixed_size_llseek`（D.2 的四种取值在这里闭环）。

---

## <span class="blue"> Trade-off 表格 [E→M]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 大缓冲分配 | kvmalloc | kmalloc 硬扛 | kvmalloc 大块成功率高但虚拟连续，不能 DMA；kmalloc 物理连续但大块易失败 |
| DMA 映射 | coherent | streaming | coherent 零维护但吃 CMA 受限内存；streaming 高效但 sync 点全靠自觉 |
| 数据通路 | read + kfifo | mmap 零拷贝 | read 简单安全，吞吐受拷贝限制；mmap 零拷贝但接口复杂度与安全责任上移 |
| 用户态碰硬件 | 驱动 mmap fop | /dev/mem | fop 范围受控可审计；/dev/mem 是一扇不设防的门 |
| 溢出策略 | 丢新数据 | kfifo_skip 丢旧数据 | 保历史 vs 保最新，由业务语义决定，必须显式选择 |

---

## <span class="blue"> 常见陷阱 [E→M]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 原子上下文用 GFP_KERNEL | "scheduling while atomic" | 中断/锁内调用了可睡眠分配 | 换 GFP_ATOMIC 并检查失败 |
| vmalloc 缓冲给 DMA | 数据错乱无规律 | 虚拟连续但物理离散，设备按物理地址搬运 | DMA 缓冲走 dma_alloc_coherent/streaming |
| 忘 dma_sync_*_for_cpu | 读到旧数据，重启自愈 | CPU 读了 cache 里的过期副本 | sync 点口诀：设备读前 for_device，CPU 读前 for_cpu |
| coherent 当数据缓冲 | 大块分配失败、CMA 耗尽 | 受限内存用在错误用途 | 描述符用 coherent，数据用 streaming |
| mmap 不校验范围 | 用户态读到内核内存 | 没查 vm_pgoff/size | 双重校验 + 只映射自己的 reg |
| kfifo 多生产者无锁 | 数据偶发错乱 | 多个 work 并发 kfifo_in | 单读单写才无锁，否则 kfifo_in_locked |

---

## <span class="blue"> 动手练习

1. 给 TS502 压测：采样率 100Hz + 业务每 2 秒读一次，观察 kfifo 溢出行为；分别实现"丢新"和"丢旧"两种策略，用 FIFO_STATUS 溢出位计数验证（为 D.9 的 debugfs 统计器备料）。
2. 在 kfifo_in 前后加 `kfifo_len` 打印，确认单读单写下不加锁也无错乱；再故意起两个 kthread 同时 kfifo_in，观察错乱现象，理解无锁条件的边界。
3. （有 MMIO 设备的板子）给自己的寄存器窗口写 mmap fop，用户态读 CHIP_ID；然后去掉 `pgprot_noncached`，连续读一个由硬件自增的计数器寄存器，观察值"卡住不动"的 cache 效应。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| kfifo | 单读单写无锁；满时策略必须显式；kfifo_to_user 省一次拷贝 | 溢出策略写了吗 |
| GFP 选型 | 上下文→大小→是否 DMA→失败代价，四步决策链 | 原子上下文里有 GFP_KERNEL 吗 |
| coherent | 省心但吃 CMA，只给描述符/小环 | 数据缓冲在用 coherent 吗 |
| streaming | sync 口诀：设备读前 for_device，CPU 读前 for_cpu | 两个 sync 点都齐吗 |
| scatter-gather | 离散段一次映射，前提是硬件支持 SG | 硬件 SG 能力确认过吗 |
| mmap fop | 校验 pgoff/size、寄存器禁 cache、只映射自己的资源 | 校验和 pgprot 都有吗 |
| 正统化 | /dev/mem 与 ioremap 野路子的产品形态是受控 mmap fop | 映射范围收在驱动校验之下吗 |

---

## <span class="blue"> 下一步

数据通路齐了，但 TS502 的配置还散落在代码常量里——地址写死、中断脚写死、报警阈值写死。换一块板子就要改代码重编译。下一篇（D.7 设备树进阶）把这些硬件事实全部搬进 DT：`of_property_read` 全家桶、自定义 binding 的设计规范、资源编排的获取时序。

螺旋衔接：内存分配——第9章 kmalloc/SLUB/CMA 机制（理解级）→ 本篇（写法级）→ 第25章 Camera 零拷贝全链路（系统级）。★第2次出现（写法级）
