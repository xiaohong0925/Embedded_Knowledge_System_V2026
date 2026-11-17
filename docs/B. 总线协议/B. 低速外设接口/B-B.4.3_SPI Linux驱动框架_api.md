<div class="reader-b2" markdown="1">

# 常用传输接口及其适用场景

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 5 页，共 6 页
> 
> 本页回答：**基础传输接口与 `spi_write_then_read()` 有什么关系，什么时候适合使用便捷封装？**

---

## <span class="blue"> 便捷接口减少了哪些工作

前面的手工实现已经展示了缓冲区分配、清零、分段和释放的重复工作。对于“小量命令写在前、数据读在后”的器件访问，`spi_write_then_read()` 可以把同一语义写得更短：

```c
static int spi_frame_observer_read_small(struct spi_device *spi, u8 *data)
{
    u8 tx[5] = { 0x0b, 0x00, 0x12, 0x34, 0x00 };
    int ret;

    ret = spi_write_then_read(spi, tx, sizeof(tx), data, 4);
    if (ret < 0)
        return ret;

    return 0;
}
```

这个函数仍是节选，不替代前面的完整模块。`spi` 是匹配得到的设备对象，`tx` 是 5 字节前导，`data` 至少要有 4 字节空间。成功返回 0，失败返回负错误码，依然不返回读取字节数。

v6.6 的实现并没有发明另一种传输：它初始化 message 和两个 transfer，把发送与接收数据复制到内部小缓冲区，再调用 `spi_sync()`；成功后把接收部分复制回调用者。也正因为实现负责复制，函数文档明确说传入缓冲区不必是 DMA-safe。这里的 DMA-safe 指可被控制器 DMA 映射和访问的内存属性，而不是“数据内容正确”。

封装没有改变三件事：前导段仍为 5 字节，读取段仍为 4 字节；两段默认仍处于同一 CS 有效周期；SPI 线上仍是全双位移。它减少的是样板代码，不是时钟、dummy 或错误判断。

`spi_write_then_read()` 面向小传输。性能敏感或批量传输仍应使用手工 message 和满足 DMA 要求的缓冲区，避免每次复制。选择依据来自实现中的复制成本和生命周期要求，而不是给使用频率编造比例。

---

## <span class="blue"> 本页自查

??? details "Q6. `spi_write_then_read()` 相比手工实现省掉了什么，仍要检查什么？"

    它负责内部缓冲区复制、message 初始化、双段组装、同步调用和成功后的数据复制。调用者仍要提供正确的命令、地址、dummy 和接收长度，并检查返回值；封装不改变全双工、CS 边界和器件协议。

---

[上一页：SPI Core 与控制器驱动的执行过程](B-B.4.3_SPI Linux驱动框架_execution.md) · [下一页：驱动构建、运行验证与应用边界](B-B.4.3_SPI Linux驱动框架_practice.md)

</div>
