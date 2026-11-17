<div class="reader-b2" markdown="1">

# SPI Core 与控制器驱动的执行过程

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 4 页，共 6 页
> 
> 本页回答：**SPI Core 怎样调度传输请求，控制器驱动怎样执行它，数据和状态又怎样返回？**

---

## <span class="blue"> SPI Core 怎样调度控制器驱动

外设驱动调用 `spi_sync(spi, &message)` 后，最先发生的不是写寄存器，而是 Core 对同一笔 message 的校验与调度。沿 v6.6 源码可以把本例继续拆成七步。

1. **锁定并校验。** `spi_sync()` 获取控制器的 `bus_lock_mutex`，再进入 `__spi_sync()`。校验路径确认设备设置、transfer 缓冲区、字长和长度等条件；`spi_setup()` 的默认值和控制器能力检查也在设备使用路径中生效。
2. **选择执行路径。** 队列为空且控制器允许时，v6.6 可以走 noqueue 快路径，直接执行而不先排入异步队列；否则设置完成对象，排队并等待。两条路径都实现同一个同步语义，不应把“同步”理解成必定经过某一种队列。
3. **逐段取出 transfer。** 默认 `spi_transfer_one_message()` 先选中设备，再按链表顺序处理本例的前导段和数据段。Rockchip 在 probe 中把 `ctlr->transfer_one` 设为 `rockchip_spi_transfer_one`，不是直接替换整个 `transfer_one_message`。
4. **交给控制器驱动。** Core 对每个 transfer 调用 `ctlr->transfer_one(ctlr, msg->spi, xfer)`。Rockchip 函数检查长度和缓冲区，保存当前 transfer，并调用 `rockchip_spi_config()` 配置本次传输。
5. **选择 DMA 或中断驱动路径。** Rockchip 通过 `can_dma` 判断是否使用 DMA；v6.6 的条件包含 `xfer->len / bytes_per_word >= rs->fifo_len`，还要求 DMA 通道可用。FIFO 是控制器内部暂存收发数据的小容量硬件队列。这个条件说明选择依赖字数和控制器 FIFO，不存在通用的“数十字节就是 DMA 分水岭”。本例 5 字节和 4 字节是否走 DMA 要以实际控制器状态为准，本文不预写实测结论。
6. **完成并回到 Core。** 若控制器函数返回负值，默认 message 路径进入错误出口；若返回正值，Core 等待该 transfer 完成。成功段把长度累加到 `actual_length`，随后才处理下一段。
7. **收尾并唤醒调用者。** `spi_finalize_current_message()` 解除缓冲区映射、释放传输资源并执行完成通知。同步路径取得 `message->status` 后返回。外设驱动此时才能读取接收缓冲区并释放描述符。

正常路径和错误路径在 CS 上也有明确差别。默认情况下，两段之间不设置 `cs_change`，CS 保持有效，Flash 因而把前导段和数据段看成同一笔命令。第一段出错时，Core 跳到出口并撤销选中，不再把第二段伪装成成功。最后一段默认完成后也撤销选中。

`cs_change` 需要按位置解释：在非末段设置为 1，Core 会在段间短暂撤销再恢复选中；在末段设置为 1，默认路径把 `keep_cs` 置为真，表示可以让设备保持选中到后续操作。因此，“message 结束 CS 必定拉高”是错误概括。只有器件手册明确要求时才设置该字段；普通 Fast Read 的两段保持默认零值。

同步接口的便利有明确代价。`spi_sync()` 可以睡眠，并且源码没有为等待设置超时，不能用于不能睡眠的上下文。`spi_async()` 则要求提交者设置完成回调，并保持 message、transfer 和缓冲区直到回调结束。`spi_async()` 返回 0 只表示请求已被接受，不表示硬件已经完成；完成回调里的 `message->status` 才给出最终状态。v6.6 只承诺回调在**不能睡眠的上下文**运行，不能简单等同为硬中断上下文，也不能在回调中调用可能睡眠的函数。

---

[在新窗口打开 SPI Framework Lab](./html/spi-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。在实验室中观察正常与首段失败路径，确认第二段、CS 和负错误的处理。

## <span class="blue"> 本页自查

??? details "Q5. 为什么不能把“message 结束 CS 必定拉高”当作不变量？"

    默认路径通常在 message 完成后撤销选中，但末段 `cs_change = 1` 会设置 `keep_cs`，允许设备保持选中。非末段的 `cs_change = 1` 则用于段间短暂撤销并恢复选中，两处语义必须按位置区分。

??? details "Q7. Rockchip 是否直接实现了默认 `transfer_one_message()`，DMA 又由什么条件决定？"

    v6.6 的 Rockchip 驱动设置的是 `ctlr->transfer_one = rockchip_spi_transfer_one`，默认 message 遍历仍由 Core 完成。DMA 由 `can_dma` 判断，条件包括传输字数与 `fifo_len` 的关系以及 DMA 通道是否可用，不能套用一个通用字节阈值。

---

[上一页：SPI 传输请求的组织](B-B.4.3_SPI Linux驱动框架_message.md) · [下一页：常用传输接口及其适用场景](B-B.4.3_SPI Linux驱动框架_api.md)

</div>
