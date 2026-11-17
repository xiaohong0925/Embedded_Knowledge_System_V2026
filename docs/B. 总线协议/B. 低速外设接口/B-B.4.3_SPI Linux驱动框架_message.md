<div class="reader-b2" markdown="1">

# SPI 传输请求的组织

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 3 页，共 6 页
> 
> 本页回答：**怎样用 `spi_message`、`spi_transfer` 和缓冲区组织一次传输，并正确处理返回值与资源释放？**

---

## <span class="blue"> 用 message 和 transfer 组织一次传输

便捷 API 会隐藏分段、缓冲区复制和返回值细节。本篇先手工构造一笔 message，确保每个字节和每种状态都能找到对应代码，再使用封装减少重复工作。

> `spi_transfer`：一段具有独立缓冲区和长度的传输描述。`tx_buf` 非空而 `rx_buf` 为空时，同时移入的数据被丢弃；`tx_buf` 为空而 `rx_buf` 非空时，控制器移出零并保存同时移入的数据。SPI 并不是在第二种情况下停止 MOSI 时钟。

<!-- -->

> `spi_message`：按顺序执行的一组 transfer。Core 把它作为一次总线事务调度，并记录总长度、实际完成长度和最终状态；同一 message 内通常保持从设备被选中。

下面的完整模块是本篇原创教学代码，面向 Linux v6.6 外设协议驱动模型。它不是 Rockchip 或 spi-nor 源码节选，也不提供产品级 Flash 管理。运行上下文是可睡眠的进程上下文：模块加载后，设备匹配触发 probe，probe 同步执行一次只读 Fast Read。

配套文件：[`spi_frame_observer.c`](code/B-B.4.3/spi_frame_observer.c){: data-code-viewer="true" data-code-title="spi_frame_observer.c" data-code-path="本篇教学配套 · code/B-B.4.3/spi_frame_observer.c"}。

```c
// SPDX-License-Identifier: GPL-2.0
#include <linux/errno.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/slab.h>
#include <linux/spi/spi.h>
#include <linux/string.h>

#define OBSERVER_CMD_LEN  5
#define OBSERVER_DATA_LEN 4

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

    /* SPI Core 可按控制器需要映射这些 kmalloc 族缓冲区。 */
    tx_buf = kzalloc(OBSERVER_CMD_LEN, GFP_KERNEL);
    rx_buf = kzalloc(OBSERVER_DATA_LEN, GFP_KERNEL);
    if (!tx_buf || !rx_buf) {
        ret = -ENOMEM;
        goto out_free;
    }

    tx_buf[0] = 0x0b;
    tx_buf[1] = (address >> 16) & 0xff;
    tx_buf[2] = (address >> 8) & 0xff;
    tx_buf[3] = address & 0xff;
    tx_buf[4] = 0x00;              /* 8 个 dummy 时钟 */

    transfers[0].tx_buf = tx_buf;
    transfers[0].len = OBSERVER_CMD_LEN;
    transfers[1].rx_buf = rx_buf;
    transfers[1].len = OBSERVER_DATA_LEN;

    spi_message_init(&message);
    spi_message_add_tail(&transfers[0], &message);
    spi_message_add_tail(&transfers[1], &message);

    /* 同步返回前，栈上的 message 和 transfers 始终有效。 */
    ret = spi_sync(spi, &message);
    if (ret < 0)
        goto out_free;

    if (message.actual_length != OBSERVER_CMD_LEN + OBSERVER_DATA_LEN) {
        ret = -EIO;
        goto out_free;
    }

    memcpy(data, rx_buf, OBSERVER_DATA_LEN);

out_free:
    kfree(rx_buf);
    kfree(tx_buf);
    return ret;
}

static int spi_frame_observer_probe(struct spi_device *spi)
{
    u8 data[OBSERVER_DATA_LEN] = { };
    int ret;

    dev_info(&spi->dev,
             "matched: cs=%u, mode=0x%x, max_speed_hz=%u, bits_per_word=%u\n",
             spi->chip_select, spi->mode, spi->max_speed_hz,
             spi->bits_per_word);

    ret = spi_frame_observer_read(spi, 0x001234, data);
    if (ret < 0) {
        dev_err(&spi->dev, "fast_read failed: ret=%d\n", ret);
        return ret;
    }

    dev_info(&spi->dev,
             "fast_read: ret=0, addr=0x001234, data=%02x %02x %02x %02x\n",
             data[0], data[1], data[2], data[3]);
    return 0;
}

static void spi_frame_observer_remove(struct spi_device *spi)
{
    dev_info(&spi->dev, "unbound\n");
}

static const struct of_device_id spi_frame_observer_of_match[] = {
    { .compatible = "kimi,spi-frame-observer" },
    { }
};
MODULE_DEVICE_TABLE(of, spi_frame_observer_of_match);

static struct spi_driver spi_frame_observer_driver = {
    .driver = {
        .name = "spi_frame_observer",
        .of_match_table = spi_frame_observer_of_match,
    },
    .probe = spi_frame_observer_probe,
    .remove = spi_frame_observer_remove,
};
module_spi_driver(spi_frame_observer_driver);

MODULE_AUTHOR("Embedded Knowledge System V2026");
MODULE_DESCRIPTION("Read-only SPI framework teaching observer");
MODULE_LICENSE("GPL");
```

### 缓冲区、描述符和数据各有自己的生命期

`kzalloc()` 分配并清零内核内存，`GFP_KERNEL` 表示这里允许在分配过程中睡眠，适用于当前 probe 上下文。两个分配必须同时成功，否则进入 `out_free`。对空指针调用 `kfree()` 是允许的，所以失败路径和成功路径可以共用同一出口，不会漏掉另一个已经分配成功的缓冲区。

手工 transfer 的缓冲区需要能被 SPI Core 按控制器要求映射，本例使用 `kzalloc` 而不是把未说明约束的局部数组直接交给底层。`message` 和 `transfers` 是描述符，不是 DMA 数据缓冲区；它们位于栈上，但 `spi_sync()` 返回前函数不会退出，因此 Core 使用期间仍然有效。若改用异步提交，就不能让描述符或缓冲区在回调前失效。

`spi_message_init()` 将 message 清零并初始化链表，`spi_message_add_tail()` 按调用顺序追加两段。`transfers` 的零初始化使未设置的 `speed_hz`、`bits_per_word` 和 `cs_change` 保持默认值：继承设备配置，不在第一段之后主动改变 CS。

第一段只设置 `tx_buf`，长度是 5，表示命令、地址和 dummy 共用一段连续前导。第二段只设置 `rx_buf`，长度是 4，Core 因此提供 32 个额外时钟并把 MISO 数据放入 `rx_buf`。整个 message 仍交换 9 个全双工字节，只是第一段的同时接收值被丢弃，第二段的同时发送值由零填充。

### 返回值和数据必须分别判断

`spi_sync()` 的返回值不是字节数。v6.6 明确约定：**0 表示事务成功，负值表示错误。** 成功时，`message.actual_length` 累计成功完成的 transfer 长度，本例应等于 `5 + 4 = 9`。代码把长度不符转换为 `-EIO`，避免把不完整事务当成完整数据。

错误路径不复制 `rx_buf` 到调用者数组，也不打印伪造的数据结果。probe 将负错误码继续返回设备模型，驱动绑定因此失败。正常路径才复制 4 字节并打印。无论成功或失败，两个堆缓冲区都在函数返回前释放。

`module_spi_driver()` 展开为模块初始化和退出所需的驱动注册、注销样板。`MODULE_DEVICE_TABLE(of, ...)` 导出设备树匹配表，使用户空间模块自动加载机制能够识别匹配关系。它们只负责驱动生命周期，不改变 Fast Read 帧格式。

---

[在新窗口打开 SPI Framework Lab](./html/spi-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。在实验室中对照双段提交、实际完成长度、返回值和缓冲区释放。

## <span class="blue"> 本页自查

??? details "Q3. 为什么本例的第二段只设置 `rx_buf`，却仍会占用 SCLK？"

    SPI 传输始终同时移入和移出相同数量的字节。`tx_buf == NULL` 时，Core 的语义是移出零并填充 `rx_buf`，不是停止发送时钟。第二段长度 4，因此产生 32 个时钟并取得 4 个 MISO 字节。

??? details "Q4. 一笔成功读取的返回值和 `actual_length` 分别应是多少？"

    `spi_sync()` 成功返回 0，不返回 9。两段长度分别为 5 和 4，全部成功后 `message.actual_length` 为 9。只有返回值为 0 且完成长度符合预期，教学代码才把接收缓冲区复制为有效结果。

---

[上一页：设备描述、注册与驱动匹配](B-B.4.3_SPI Linux驱动框架_startup.md) · [下一页：SPI Core 与控制器驱动的执行过程](B-B.4.3_SPI Linux驱动框架_execution.md)

</div>
