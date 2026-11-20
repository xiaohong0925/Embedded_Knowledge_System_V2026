<div class="reader-b2" markdown="1">

# SPI Core 与控制器驱动的执行过程

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 4 页，共 6 页
> 
> 本页回答：**SPI Core 怎样调度传输请求，控制器驱动怎样执行它，数据和状态又怎样返回？**

---

## <span class="blue"> SPI Core 怎样调度控制器驱动

上一页写完了协议驱动的代码：`probe` 组装 `spi_message`，调用 `spi_sync()` 提交。

但 `spi_sync()` 进去之后发生了什么？Controller 怎么收到这个请求？CS 什么时候拉低、什么时候拉高？数据又是怎么从 `rx_buf` 回到用户手里的？

<div class="interactive-demo">
  <iframe
    src="../html/spi-sync-callchain.html"
    title="SPI 同步调用链与错误返回交互演示"
    loading="lazy"
    style="width:100%;height:640px;border:0;"
  ></iframe>
</div>

### 同步调用在哪里校验、执行和等待

先看 [`drivers/spi/spi.c:4190-4274`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4190-4274"}。`spi_sync()` 是外层加锁包装，`__spi_sync()` 才选择直接执行或排队等待。<BR>
以下为节选，统计与 trace 代码从略：

```c
// drivers/spi/spi.c · __spi_sync() 与 spi_sync()（v6.6 节选，逐行注释版）
static int __spi_sync(struct spi_device *spi, struct spi_message *message)
{
    /* 在调用者栈上建一个完成量；下面会睡在它上面，栈帧没返回就不存在悬空问题 */
    DECLARE_COMPLETION_ONSTACK(done);   
    int status;
    struct spi_controller *ctlr = spi->controller;  /* 取出 message 要发到哪条总线的控制器 */

    /* 提交前先做合法性检查（传输方向/长度/速率与设备、控制器能力是否匹配），不合规在这里就返回，不碰硬件 */
    status = __spi_validate(spi, message);          
    if (status != 0)
        return status; /* 校验失败：错误直接交还协议驱动 */

    /* 记录这条 message 属于哪个设备，后面 Core 拉 CS、统计都要靠它 */
    message->spi = spi;                             

    /* 队列为空且控制器允许时，直接走 noqueue 路径。 */
    /* READ_ONCE：与队列维护方形成单向同步，只保证"同一上下文内"的收发顺序；跨上下文的竞争由外层 io_mutex 兜住 */
    if (READ_ONCE(ctlr->queue_empty) && !ctlr->must_async) {
        message->actual_length = 0;       /* 累计长度清零，从 0 开始数 */
        message->status = -EINPROGRESS;   /* 标记"进行中"，执行完会被改写为真实结果；这也是后面判断异常的哨兵值 */

    /* 不调 kthread、不进队列，就在当前进程上下文里直接跑一遍 message：相当于"同步地借异步的壳" */
        __spi_transfer_message_noqueue(ctlr, message);
        return message->status;    /* 传输已在上面跑完，status 即终值，不再经过完成回调 */
    }

    /* 否则保留同步／异步请求的顺序，排队并睡眠等待完成。 */
    /* 挂上完成回调；传输结束时由 Core 调用，内部做的事就是 complete(&done) */
    message->complete = spi_complete;              
    /* 回调参数指向栈上的完成量，回调用它把睡着的调用者唤醒 */
    message->context = &done;                       
    /* 提交到异步队列（持总线锁提交，和正在跑的异步消息保持先进先出）；返回 0 只表示"被接受"，不是"传完了" */
    status = spi_async_locked(spi, message);        

    if (status == 0) {
        /* 睡眠点：等到 Core 收尾时pi_complete 唤醒；不可中断、无超时 */
        wait_for_completion(&done);                 
        /* 真正的传输结果由 Core 写在message->status 里（如 -EIO） */
        status = message->status;                   
        
    }
    /* 收尾：message 可能被调用者复用， 摘掉指向栈变量的指针，防止误用 */
    message->context = NULL;                        
    
    /* 0=成功；非 0=提交失败或传输失败 */
    return status;                                 
}

int spi_sync(struct spi_device *spi, struct spi_message *message)
{
    int ret;
    /* 先拿总线锁：同一条 SPI 总线上同时只允许一个同步传输 */
    mutex_lock(&spi->controller->bus_lock_mutex);   
    ret = __spi_sync(spi, message);    /* 持锁执行；能走到这里说明上下文可睡眠 */
    mutex_unlock(&spi->controller->bus_lock_mutex); /* 释放总线锁 */

    return ret;
}
```

这里能看到几个文字流程不容易讲清的细节：

1. `spi_sync()` 先持有 `bus_lock_mutex`；
2. **`DECLARE_COMPLETION_ONSTACK` 为什么敢用栈变量**：因为 `wait_for_completion` 之后函数才返回，唤醒回调 `spi_complete` 一定发生在返回之前，栈上的 `done` 不会提前失效。
3. `__spi_validate()` 在校验失败时直接返回错误；
4. **`status` 的两层含义**：`spi_async_locked` 返回的 `status` 是"提交结果"，`message->status` 才是"传输结果"。这就是为什么提交成功后还要覆盖一次 `status`。
5. noqueue 只是直接执行的一种路径，另一条路径仍然通过 `wait_for_completion()` 实现同步等待。
   > 两条路径最终都把 `message->status` 交回调用者，所以“同步”描述的是调用者等待结果，而不是固定经过某一种队列。

### Core 怎样逐段调用控制器并收尾

再看同一份 [`spi.c:1481-1590`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="1481-1590"} 的默认 `spi_transfer_one_message()`。下面保留本例需要的循环、错误出口、CS 和长度处理，统计、DMA 映射与回退细节从略：

```c
// drivers/spi/spi.c · spi_transfer_one_message()（v6.6 节选，逐行注释版）
static int spi_transfer_one_message(struct spi_controller *ctlr,
                                    struct spi_message *msg)
{
    struct spi_transfer *xfer;
    bool keep_cs = false;   /* 默认：message 结束后撤销选中 CS */
    int ret = 0;
    /* 先取第一段，只为读它的 cs_off 属性 */
    xfer = list_first_entry(&msg->transfers, struct spi_transfer, transfer_list);
    /* 整条 message 只在这里拉一次 CS：默认置有效；若首段声明 cs_off（这一段要在 CS 无效下执行）就不拉 */                            
    spi_set_cs(msg->spi, !xfer->cs_off, false); 
    /* 从第一段开始逐段遍历；一个 message 里通常有多段（前导 + 数据） */
    list_for_each_entry(xfer, &msg->transfers, transfer_list) {
        /* 跳过"无缓冲区且长度为 0"的空段,空段只用来表达时序上的间隔 */
        if ((xfer->tx_buf || xfer->rx_buf) && xfer->len) {
            /* 控制器上的完成量是全局复用的字段，每等一次前先归零 */
            reinit_completion(&ctlr->xfer_completion);
                                                
            /* 每一个 transfer 都在这里交给控制器驱动。 */
            /* 驱动回调：负=启动即失败，0=已同步完成，正=已异步启动（中断/DMA 收尾） */
            ret = ctlr->transfer_one(ctlr, msg->spi, xfer);
                                                
            if (ret < 0) {
                dev_err(&msg->spi->dev,
                        "SPI transfer failed: %d\n", ret);
                goto out;   /* 启动就失败：打印并退出整个 message */
            }

            /* 正值表示传输已经启动，Core 等待本次完成。 */
            if (ret > 0) {
                /* 睡在 xfer_completion 上；驱动的中断/DMA 回调完成时唤醒 */
                ret = spi_transfer_wait(ctlr, msg, xfer);
                                                
                if (ret < 0)
                    msg->status = ret;  /* 等待超时/失败：把哨兵值改写成真实错误，作为"循环终止"信号 */        
            }
        }

        /* 出错或等待失败时，不再进入下一段。 */
        if (msg->status != -EINPROGRESS)  /* -EINPROGRESS 是"本段一切正常"的哨兵值；一旦变了说明上面出过事 */      
            goto out;

        if (xfer->cs_change) {    /* 本段要求段间动 CS */
            if (list_is_last(&xfer->transfer_list,
                             &msg->transfers)) {
                keep_cs = true;   /* 是最后一段：改默认行为，出口处不撤销选中（留给下一个 message） */
            } else {  /* 非末段：短暂撤销再恢复，制造一个片选毛刺供从机锁存状态 */
                if (!xfer->cs_off)
                    spi_set_cs(msg->spi, false, false);
                _spi_transfer_cs_change_delay(msg, xfer); /* 间隔宽度由 cs_change_delay 决定 */
                if (!list_next_entry(xfer, transfer_list)->cs_off)
                    spi_set_cs(msg->spi, true, false); /* 下一段也声明不管 CS 才恢复选中 */
            }
        }

        /* 只有走到这里，当前段长度才累计为已完成。 */
        msg->actual_length += xfer->len;   /* 失败段永远不会到达这里，所以actual_length 只统计真传完的字节 */
    }

out:
    if (ret != 0 || !keep_cs)   /* 出错了，或者调用者没要求保持选中：都必须撤销 CS，避免从机悬空在半条命令上 */
        spi_set_cs(msg->spi, false, false);

    if (msg->status == -EINPROGRESS)  /* 全程无异常：哨兵值换成 ret（此时为 0），status 才是合法的最终返回值 */
        msg->status = ret;
    /* 解 DMA 映射、释放资源、调msg->complete(msg->context),同步路径在这里被唤醒 */
    spi_finalize_current_message(ctlr);  
    return ret;   /* 返回给 __spi_sync：0 或负错误 */
}
```

本例的两段 transfer 就按这条循环执行。

```c
    spi_set_cs(msg->spi, !xfer->cs_off, false); 
    list_for_each_entry(xfer, &msg->transfers, transfer_list) {
        if ((xfer->tx_buf || xfer->rx_buf) && xfer->len) {
            ...
            ret = ctlr->transfer_one(ctlr, msg->spi, xfer);
            if (ret < 0) {
                dev_err(&msg->spi->dev, "SPI transfer failed: %d\n", ret);
                goto out;   /* 启动就失败：打印并退出整个 message */
            }
            if (ret > 0) {
                ret = spi_transfer_wait(ctlr, msg, xfer);
                if (ret < 0) msg->status = ret;  /* 等待超时/失败：把哨兵值改写成真实错误，作为"循环终止"信号 */        
            }
        }
    ...
```
Core 先把 CS 置为有效，再依次调用 `ctlr->transfer_one()`：第一段产生 5 字节前导，第二段接收 4 字节数据。<BR>
负错误直接跳到 `out`，等待失败也会改变 `msg->status`，因此失败段不会累加 `actual_length`，第二段也不会被伪装成成功。

```c
// drivers/spi/spi.c · spi_transfer_one_message()
        msg->actual_length += xfer->len;  
    }
out:
    if (ret != 0 || !keep_cs)  spi_set_cs(msg->spi, false, false);
    if (msg->status == -EINPROGRESS) msg->status = ret;
    spi_finalize_current_message(ctlr);  
    return ret;   /* 返回给 __spi_sync：0 或负错误 */
// drivers/spi/spi.c · __spi_sync() 与 spi_sync()
    __spi_transfer_message_noqueue(ctlr, message);
    return message->status;    /* 传输已在上面跑完，status 即终值，不再经过完成回调 */
// code/B-B.4.3/spi_frame_observer.c
    ret = spi_sync(spi, &message);
```
成功走到循环末尾时，`actual_length` 才加上当前段长度。全部成功后，本例得到 `5 + 4 = 9`。<BR>
最后的 `spi_finalize_current_message()` 负责解除映射、释放资源并执行完成通知，同步路径随后取得 `message->status`，协议驱动这时才能读取 `rx_buf` 并释放描述符。

### Rockchip 怎样接住 Core 交出的 transfer

上一节 Core 在循环里执行的是 `ret = ctlr->transfer_one(ctlr, msg->spi, xfer);`。<br>
在 RK3568 上，`ctlr->transfer_one` 在 probe 中被赋值为 `rockchip_spi_transfer_one`，所以这次函数调用最终就进入下面的 `rockchip_spi_transfer_one()`。它接到的仍是上一节那个设备 `msg->spi` 和当前段 `xfer`，不是另一笔新事务。

到这里，Core 仍负责逐段调度，Rockchip 负责当前段的实际执行。先回看 probe 时注册了哪些回调，再沿同一个 `xfer` 看配置、DMA／IRQ 选择和返回 Core 的过程。

> 💡 DMA（Direct Memory Access，直接内存访问）不是 Flash 协议要求，也不是 SPI 默认的“快车道”。它只是控制器在内存和 FIFO 之间搬数据的一种方式：小传输常用 CPU 配合中断直接读写 FIFO（PIO／IRQ），省去 DMA 配置；较长的连续传输才更可能通过 DMA 减少 CPU 占用。本例两段只有 5 和 4 字节，所以走 IRQ。

控制器驱动与 Core 的接口就是 [`struct spi_controller`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi_controller" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="521-743"} 上的几个函数指针。<BR>
Rockchip 在 [`spi-rockchip.c:877-908`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi-rockchip.c){: data-code-viewer="true" data-code-title="spi-rockchip.c" data-code-path="Linux v6.6 · drivers/spi/spi-rockchip.c" data-code-lines="877-908"} 的 `rockchip_spi_probe()` 里先注册 `setup`、`set_cs` 和 `transfer_one`，再在 DMA 通道可用时补上 `can_dma`：

```c
// drivers/spi/spi-rockchip.c · rockchip_spi_probe()（v6.6 节选，逐行注释版）
ctlr->setup = rockchip_spi_setup;                /* 选中设备时 Core 回调：把速率、模式写进寄存器 */
ctlr->set_cs = rockchip_spi_set_cs;              /* Core 的 spi_set_cs() 最终落到这：操作 SoC 的片选寄存器 */
ctlr->transfer_one = rockchip_spi_transfer_one;  /* 每个 transfer 的执行入口，本节的主角 */

/* 两条 DMA 通道都申请到，才安装 can_dma；申请不到就永远不装，
   后面驱动内部判空兜底，当作"这台控制器没有 DMA" */
if (ctlr->dma_tx && ctlr->dma_rx) {
    rs->dma_addr_tx = mem->start + ROCKCHIP_SPI_TXDR;  /* TX FIFO 寄存器物理地址，交给 DMA 当外设端口 */
    rs->dma_addr_rx = mem->start + ROCKCHIP_SPI_RXDR;  /* RX FIFO 同理 */
    ctlr->can_dma = rockchip_spi_can_dma;              /* 每个 transfer 进来时由它拍板走不走 DMA */
}
```

#### 一个 transfer 进来之后：先配置，再二选一

再看 [`spi-rockchip.c:668-722`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi-rockchip.c){: data-code-viewer="true" data-code-title="spi-rockchip.c" data-code-path="Linux v6.6 · drivers/spi/spi-rockchip.c" data-code-lines="668-722"} 的 `rockchip_spi_transfer_one()`，执行顺序是固定的：先算宽度、存上下文，再让 `can_dma` 拍板，然后配置寄存器，最后按拍板结果分两条路启动：

```c
// drivers/spi/spi-rockchip.c · rockchip_spi_transfer_one()（v6.6 节选，逐行注释版）
static int rockchip_spi_transfer_one(
        struct spi_controller *ctlr,
        struct spi_device *spi,
        struct spi_transfer *xfer)
{
    struct rockchip_spi *rs = spi_controller_get_devdata(ctlr);
    int ret;
    bool use_dma;

    /* 长度与缓冲区检查从略。 */
    rs->n_bytes = xfer->bits_per_word <= 8 ? 1 : 2;  /* 每字 1 还是 2 字节，决定 FIFO 按什么宽度计数 */
    rs->xfer = xfer;  /* 记下当前段：中断/DMA 回调收尾时要回读它的 buffer 和 len */
    /* can_dma 在 probe 里可能没装（没申请到通道），先判空：返回 false 不是错误，只是"硬件没条件，走中断" */
    use_dma = ctlr->can_dma ? ctlr->can_dma(ctlr, spi, xfer) : false;

    /* 速率、SPI 模式、FIFO 阈值这些寄存器两条路径都要配，所以放在分支之前 */
    ret = rockchip_spi_config(rs, spi, xfer, use_dma, ctlr->target);
    if (ret)
        return ret;  /* 配置失败返回负值：Core 看到 ret<0 直接 goto out，CS 一定撤销、后续段不再执行 */

    if (use_dma)
        return rockchip_spi_prepare_dma(rs, ctlr, xfer);  /* 已启动 DMA：返回正数，完成由 DMA 回调通知 Core */

    return rockchip_spi_prepare_irq(rs, ctlr, xfer);      /* 已使能中断：返回正数，完成由中断通知 Core */
}
```

两个分支的返回值都符合 `transfer_one` 的约定：正数表示"已异步启动，完成时我会通知 Core"，于是 `spi_transfer_one_message()` 里 `ret > 0` 的分支会睡在 `xfer_completion` 上，等驱动的回调唤醒。唯一的例外是配置失败返回负值，这正是 Core 循环里 `ret < 0` 跳 `out` 的入口。

#### `can_dma` 的拍板标准：和 FIFO 深度比长短

`can_dma` 只看一件事，这次传输够不够长。它的参照物是 FIFO：

> **FIFO** 是控制器内部暂存收发数据的小容量硬件队列：驱动先把数据填进 TX FIFO（或从 RX FIFO 取走），硬件再把队列里的数据逐位搬到总线上，队列有深度上限。Rockchip 的 `rs->fifo_len` 在 probe 时读硬件版本寄存器（`ROCKCHIP_SPI_VERSION`）得出：VER2 类型控制器为 64 字，其余为 32 字。

比 FIFO 还短的传输，中断路径填一次/取一次就完了，启动 DMA 反而是开销；达到 FIFO 深度还靠中断逐次搬运，会频繁打断 CPU，才值得让 DMA 接手：

```c
// drivers/spi/spi-rockchip.c · rockchip_spi_can_dma()（v6.6 节选）
static bool rockchip_spi_can_dma(struct spi_controller *ctlr,
                                 struct spi_device *spi,
                                 struct spi_transfer *xfer)
{
    struct rockchip_spi *rs = spi_controller_get_devdata(ctlr);
    unsigned int bytes_per_word = xfer->bits_per_word <= 8 ? 1 : 2;

    /* 传输字数（不是字节数）≥ FIFO 深度 → 用 DMA */
    return xfer->len / bytes_per_word >= rs->fifo_len;
}
```

两个条件叠加才真的走 DMA：`can_dma` 拍板为真，**且** probe 里申请到了 DMA 通道（`ctlr->can_dma` 非空）。所以没有"数十字节就是 DMA 分水岭"这种通用阈值，Rockchip 判断的是字数对 FIFO 深度，通道还得申请得到。

回到本例：两段各 5/4 字节、8 bits/word 即 5/4 字，必然小于 fifo_len 的下限 32，无论 DMA 通道是否申请成功，`can_dma` 都不会放行，**本例的两段传输确定走中断路径**。

### `cs_change` 怎样表达事务边界

SPI 线路上没有任何"命令开始/结束"的协议标记。<br>
字节流和字节流之间的边界，很多器件是靠 CS 的边沿来界定的：CS 拉低＝命令开始，CS 拉高＝命令结束、内部状态锁存。

Core 的默认策略只有一条硬规则：一条 message 内 CS 一直有效，message 收尾时撤销。<br>
但器件手册要求的边界并不总和 message 对齐，这就是 `cs_change` 存在的理由：给协议驱动一个口子，说明**这一段传完后，要不要改变 Core 默认的片选处理**。

先看代码，`cs_change` 的分支在[`spi.c:1559-1573`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-lines="1559-1573"}：

```c
// drivers/spi/spi.c · spi_transfer_one_message()（v6.6 节选，逐行注释）
        if (xfer->cs_change) { /* 本段传完后要改变默认的 CS 处理；为 0 则什么都不做，这正是本例的情况 */
            if (list_is_last(&xfer->transfer_list,
                             &msg->transfers)) {
            /* 关键判断：本段是不是 transfers 链表的最后一段，同名字段按位置分两种语义 */
                keep_cs = true;  /* 末段置 1：只立一个标记，出口处据此跳过默认的撤销动作，
                                 CS 保持选中到下一条 message */
            } else {   /* 非末段置 1：段间制造一个 CS 无效间隔 */
                if (!xfer->cs_off)
                    spi_set_cs(msg->spi, false, false);/* 先撤销选中；本段声明 cs_off（CS 由器件自己管）就不动 */
                _spi_transfer_cs_change_delay(msg, xfer);
                /* 无效间隔的宽度，按 cs_change_delay等待；值为 0 时 Core 默认 10 μs，
                   实际应按器件手册设置 */
                if (!list_next_entry(xfer, transfer_list)->cs_off)
                    spi_set_cs(msg->spi, true, false);
                /* 下一段也不要求 CS 无效，就恢复选中，开始下一笔"命令" */
            }
        }
```

**先定义两个词。**"末段/非末段"指本段在 message 的 transfers 链表里的位置：后面没有别的 transfer 了，就是末段；后面还有，就是非末段。<BR>
这个字段写在某个 transfer 上，但作用点永远在"这一段传完之后"，Core 只看一件事：这一段结束后，队列里还有没有下一段。

**为什么会有两种相反的效果？**因为 SPI 框架要解决的边界问题本来就有两类，<br>
`cs_change` 把两类问题压缩进了一个按位置分义的字段：

<div class="interactive-demo">
  <iframe
    src="../html/spi-cs-change.html"
    title="cs_change 三种场景的 CS 时序"
    loading="lazy"
    style="width:100%;height:520px;border:0;"
  ></iframe>
</div>

1. **写在非末段：在字节流中途结束当前命令。** 有的器件需要在一个 CS 周期
   内看到一次片选脉冲，比如某些 ADC 在 CS 上升沿锁存转换结果，某些 Flash
   要靠 CS 脉冲退出连续读模式。没有 `cs_change`，一个 message 里的多段
   transfer 会永远黏成一个 CS 周期，驱动表达不了"到这里为止是一命令"。
   spi.h 的 kerneldoc 写的就是这个用途："Toggling chipselect in this way
   may be needed to terminate a chip command"
   ([`spi.h:1002-1006`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-lines="1002-1006"})。
2. **写在末段：把 CS 保留给下一条 message。** 有的器件协议要求一笔事务
   跨多条命令、CS 全程拉低，但驱动的下一条命令内容要依赖上一条的返回，
   必须读完一条、撤吗？不行，撤了事务就断了。末段置 1 就是告诉 Core：
   这条 message 的收尾你别管。kerneldoc 的描述是 "a series of
   spi_message submissions, where the whole transaction ends when the
   chipselect goes inactive"
   ([`spi.h:1008-1016`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-lines="1008-1016"})。
   注意它不是总线锁：多设备总线上开始访问另一设备时 CS 照样被切走。

> 这两段语义是 SPI 框架诞生时就写进 spi.h 的原始设计。2020 年还有人把末段的 `keep_cs` 当 bug 提补丁，SPI 维护者 MarkBrown 的原话是 "This is the opposite of the intended behaviour — wewant to deassert chip select at the end of the message **unless** cs_change is set on the last transfer"，补丁随即撤回。
<!-- -->
> 真正的问题是命名：`cs_change` 的实际含义是"本段结束后 CS 的处理交给我（驱动）决定"，而不是字面的"切换 CS"。用户态 spidev.h 里的注释恰好写反了，调 CS 行为诡异时先核对内核 spi.h 的原文。

回到本例，`struct spi_transfer transfers[2] = { }` 让两段都保持 `cs_change = 0`，Flash 因而把 5 字节前导和 4 字节数据看成同一笔 Fast Read。若给第一段写上 `cs_change = 1`，前导结束后 CS 会先撤销，Flash 在数据阶段到来前就结束了当前命令；第二段开始的新片选周期不再携带原来的命令上下文，读回结果也就不能按预期的 `A7 5C 3F 19` 解释。**这就是本例不能随手打开它的原因。**

---

[在新窗口打开 SPI Framework Lab](./html/spi-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。在实验室中观察正常与首段失败路径，确认第二段、CS 和负错误的处理。

## <span class="blue"> 本页自查

??? details "Q5. 为什么不能把“message 结束 CS 必定拉高”当作不变量？"

    默认路径通常在 message 完成后撤销选中，但末段 `cs_change = 1` 会设置 `keep_cs`，允许设备保持选中。非末段的 `cs_change = 1` 则用于段间短暂撤销并恢复选中，两处语义必须按位置区分。

??? details "Q7. Rockchip 是否直接实现了默认 `transfer_one_message()`，DMA 又由什么条件决定？"

    v6.6 的 Rockchip 驱动设置的是 `ctlr->transfer_one = rockchip_spi_transfer_one`，默认 message 遍历仍由 Core 完成。DMA 由 `can_dma` 判断，条件包括传输字数与 `fifo_len` 的关系以及 DMA 通道是否可用，不能套用一个通用字节阈值。

---

[上一页：SPI 传输请求的组织](B-B.4.3_SPI Linux驱动框架_message.md) · [下一页：手工与封装](B-B.4.3_SPI Linux驱动框架_api.md)

</div>
