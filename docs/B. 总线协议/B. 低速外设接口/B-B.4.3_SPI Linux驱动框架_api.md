<div class="reader-b2" markdown="1">

# 手工 message 与便捷封装

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 5 页，共 6 页
> 
> 本页回答：**同一笔 Fast Read 用手工 message 和便捷封装分别怎样写，封装改变了什么，什么时候应该选择哪一种？**

---

## <span class="blue"> 从底层执行回到协议驱动的选择

第四页展开 Core 和 Rockchip，是为了看清手工 message 怎样被逐段执行，不代表每次访问都必须手写这些步骤。现在回到协议驱动的调用点：**对于同一笔 5＋4 字节 Fast Read，什么时候可以用 `spi_write_then_read()` 缩短代码？**

先把两种实现放在一起。它们读取的地址、数据和底层路径相同，差别在于缓冲区、message、transfer 和完成长度由谁管理。

### 手工版：调用者管理每个步骤

这是第三页 [`spi_frame_observer.c`](code/B-B.4.3/spi_frame_observer.c){: data-code-viewer="true" data-code-title="spi_frame_observer.c" data-code-path="本篇教学配套 · code/B-B.4.3/spi_frame_observer.c"} 中的读取函数。这里按同一逻辑完整列出，并把长度常量展开为 5 和 4，便于与后面的封装版逐项对照：

```c
static int spi_frame_observer_read(struct spi_device *spi, u32 address,
                                   u8 *data)
{
    struct spi_transfer transfers[2] = { };
    struct spi_message message;
    u8 *tx_buf;
    u8 *rx_buf;
    int ret;

    if (address > 0xffffff)
        return -EINVAL;

    /* 手工版自行准备可被控制器映射的缓冲区。 */
    tx_buf = kzalloc(5, GFP_KERNEL);
    rx_buf = kzalloc(4, GFP_KERNEL);
    if (!tx_buf || !rx_buf) {
        ret = -ENOMEM;
        goto out_free;
    }

    /* 5 字节前导：Fast Read、24 位地址和 dummy。 */
    tx_buf[0] = 0x0b;
    tx_buf[1] = (address >> 16) & 0xff;
    tx_buf[2] = (address >> 8) & 0xff;
    tx_buf[3] = address & 0xff;
    tx_buf[4] = 0x00;

    /* 第一段发送前导；第二段接收四字节。 */
    transfers[0].tx_buf = tx_buf;
    transfers[0].len = 5;
    transfers[1].rx_buf = rx_buf;
    transfers[1].len = 4;

    spi_message_init(&message);
    spi_message_add_tail(&transfers[0], &message);
    spi_message_add_tail(&transfers[1], &message);

    ret = spi_sync(spi, &message);
    if (ret < 0)
        goto out_free;

    /* 手工版可以直接检查 message 记录的完成长度。 */
    if (message.actual_length != 5 + 4) {
        ret = -EIO;
        goto out_free;
    }

    memcpy(data, rx_buf, 4);

out_free:
    kfree(rx_buf);
    kfree(tx_buf);
    return ret;
}
```

手工版的所有权很清楚：调用者分配并释放缓冲区，组装两段 transfer，调用 `spi_sync()`，检查返回状态和 `message.actual_length`，最后复制有效数据。它可以精确检查本例是否完成了 `5 + 4 = 9` 字节，也能直接设置 `cs_change`、延迟、速率等 transfer 字段。

### 封装版：把重复步骤交给框架

[`spi_write_then_read()`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4377-4430"} 面向“先写一段、再读一段”的访问。对于本例，调用者只需提供设备、前导和接收位置：

```c
static int spi_frame_observer_read_small(struct spi_device *spi, u8 *data)
{
    u8 tx[5] = { 0x0b, 0x00, 0x12, 0x34, 0x00 };

    return spi_write_then_read(spi, tx, sizeof(tx), data, 4);
}
```

这里的 `tx` 仍是 5 字节前导，`data` 仍至少有 4 字节空间。函数成功返回 0，失败返回负错误码，不返回读取字节数。调用者不再直接管理 message、transfer 和内部缓冲区，但命令、地址、dummy 与数据长度仍必须由自己给对。

这个接口会复制传入和传出的数据，因此调用者的缓冲区不必满足 DMA-safe 要求。DMA-safe 指内存能否被控制器 DMA 映射和访问，不是“数据内容是否正确”。复制的代价也决定了它主要面向小传输，而不是批量或性能敏感路径。

### 两种写法究竟差在哪里

| 对照点 | 手工 message | `spi_write_then_read()` |
|---|---|---|
| message 与 transfer | 调用者显式初始化和挂接 | 封装内部创建 |
| 缓冲区 | 调用者分配并释放，Core 按需要映射 | 封装复制到内部缓冲区 |
| 返回与长度 | 可检查 `spi_sync()` 返回值和 `actual_length` | 只取得 0 或负错误码，不暴露 `actual_length` |
| 可定制内容 | 可直接设置 CS、延迟、速率和多段结构 | 主要提供写后读的标准两段结构 |
| 主要代价 | 样板代码和生命周期管理较多 | 数据复制，定制空间较少 |
| 更适合 | 批量、性能敏感或需要精确控制的访问 | 小量、常规的写后读访问 |

`actual_length` 的差异尤其值得注意：手工版可以直接写出“返回值必须等于 0，完成长度必须等于 9”的检查；封装版不把 message 交给调用者，因此不能在外部照搬这项检查。若完成长度是必须显式审核的证据，手工版更直接。

## <span class="blue"> 封装内部仍进入同一条执行路径

`spi_write_then_read()` 没有绕开第四页。v6.6 的 [`drivers/spi/spi.c:4377-4430`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4377-4430"} 仍然创建 message 和两个 transfer，最后调用 `spi_sync()`。下面保留这条主线，内部缓冲区申请与释放从略：

```c
// drivers/spi/spi.c · spi_write_then_read()（v6.6 节选）
    spi_message_init(&message);
    memset(x, 0, sizeof(x));

    if (n_tx) {
        x[0].len = n_tx;
        spi_message_add_tail(&x[0], &message);
    }
    if (n_rx) {
        x[1].len = n_rx;
        spi_message_add_tail(&x[1], &message);
    }

    /* 把调用者的数据复制进内部缓冲区。 */
    memcpy(local_buf, txbuf, n_tx);
    x[0].tx_buf = local_buf;
    x[1].rx_buf = local_buf + n_tx;

    status = spi_sync(spi, &message);
    if (status == 0)
        memcpy(rxbuf, x[1].rx_buf, n_rx);
```

因此，两种写法最终都进入同一个 `spi_sync()`，再由 Core 逐段交给 Rockchip。封装没有改变 5＋4 字节、全双工、CS 边界或底层执行路径；它减少的是协议驱动里的重复步骤，而不是器件要求的时钟和错误处理。

选择时可以压缩成一句话：**小量标准写后读优先考虑封装；需要避免复制、定制传输或显式审核完成长度时，保留手工 message。**

### 其他接口速查

这些接口只是不同的提交入口，并没有各自发明一套传输机制；底层仍然回到 message、transfer 和控制器执行路径。当前实例只需理解它们的用途，不逐个展开实现。

| 接口 | 什么时候用 | 最需要记住的边界 |
|---|---|---|
| [`spi_write()`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1376-1397"} | 只发送、不接收 | 单段写封装，底层仍组 message 并同步执行 |
| [`spi_read()`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1399-1420"} | 只接收、不发送有效命令 | 单段读封装，时钟仍持续提供 |
| [`spi_sync()`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4243-4274"} | 手工组装 message 后同步提交 | 可睡眠；成功返回 0，失败返回负错误码 |
| [`spi_async()`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4050-4090"} | 提交后由回调接收完成通知 | 返回 0 只表示接受请求；message、transfer 和缓冲区必须活到回调结束 |

---

## <span class="blue"> 本页自查

??? details "Q6. `spi_write_then_read()` 相比手工实现省掉了什么，仍要检查什么？"

    它负责内部缓冲区复制、message 初始化、双段组装、同步调用和成功后的数据复制。调用者仍要提供正确的命令、地址、dummy 和接收长度，并检查返回值；封装不改变全双工、CS 边界和底层路径，也不向调用者暴露 `actual_length`。

---

[上一页：SPI Core 与控制器驱动的执行过程](B-B.4.3_SPI Linux驱动框架_execution.md) · [下一页：验证与产品移交](B-B.4.3_SPI Linux驱动框架_practice.md)

</div>
