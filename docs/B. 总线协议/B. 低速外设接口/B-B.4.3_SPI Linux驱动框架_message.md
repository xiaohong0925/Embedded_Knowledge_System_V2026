<div class="reader-b2" markdown="1">

# SPI 传输请求的组织

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 3 页，共 6 页
> 
> 本页回答：**怎样用 `spi_message`、`spi_transfer` 和缓冲区组织一次传输，并正确处理返回值与资源释放？**

---

## <span class="blue"> 用 message 和 transfer 组织一次传输


上一页看完了 `spi_device` 的创建和匹配：DTS 子节点被 Core 遍历、注册、最终交到协议驱动的 `probe()` 手里。  
`probe` 拿到 `spi_device *spi` 之后，第一件实事就是发起一次读取，本篇写这段代码。

先回头牵一根线：4.2 看懂了 Fast Read 0x0B 在引脚上是 **一次 CS 拉低、72 个连续时钟**：

| 节拍 | 内容 | 字节数 |
|------|------|--------|
| 1-8  | 命令 0x0B | 1 |
| 9-32 | 地址 00 12 34 | 3 |
| 33-40 | dummy | 1 |
| 41-72 | 数据 D0-D3 | 4 |

进入 Linux 驱动后，这 72 拍被拆成 **两个 [`spi_transfer`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi_transfer" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1029-1070"} ** 来描述，但包装在 **同一个 [`spi_message`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi_message" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1106-1147"} ** 里<br>
Core 保证两段之间 CS 不会断开，硬件上仍然是一次连续 transaction。

```c
    struct spi_transfer transfers[2] = { };
    /* Segment 0：发命令，同时收到的数据丢弃 */
    transfers[0].tx_buf = tx_buf;   // {0x0B, 0x00, 0x12, 0x34, 0x00}  len=5  ← 前 40 拍
    transfers[0].len = OBSERVER_CMD_LEN;

    /* Segment 1：移出零，同时收 4 字节 MISO */
    transfers[1].rx_buf = rx_buf;   // len=4  ← 后 32 拍
    transfers[1].len = OBSERVER_DATA_LEN;

    spi_message_init(&message);
    spi_message_add_tail(&transfers[0], &message);
    spi_message_add_tail(&transfers[1], &message);
```

为什么要拆两段？因为 Linux SPI 框架规定：**一个 transfer 同时只能有一个 tx_buf 和一个 rx_buf**。

命令段需要"发 5 字节、同时收的东西扔掉"，数据段需要"发 0、同时收 4 字节"<br>
两种方向/用途不同，所以分成两个 transfer 来描述。硬件上它们仍然连续，CS 全程拉低。

> [`spi_transfer`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi_transfer" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1029-1070"} ：一段具有独立缓冲区和长度的传输描述。`tx_buf` 非空而 `rx_buf` 为空时，同时移入的数据被丢弃；`tx_buf` 为空而 `rx_buf` 非空时，控制器移出零并保存同时移入的数据。SPI 并不是在第二种情况下停止 MOSI 时钟。

<!-- -->

> [`spi_message`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi_message" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1106-1147"}：按顺序执行的一组 transfer。Core 把它作为一次总线事务调度，并记录总长度、实际完成长度和最终状态；同一 message 内通常保持从设备被选中。

## <span class="blue"> 实例教学

下面先手工构造一笔完整的读取，看清每个字段对应引脚上的哪些时钟；后面再用封装函数减少重复代码。

配套文件：[`spi_frame_observer.c`](code/B-B.4.3/spi_frame_observer.c){: data-code-viewer="true" data-code-title="spi_frame_observer.c" data-code-path="本篇教学配套 · code/B-B.4.3/spi_frame_observer.c"}。

```c
// SPDX-License-Identifier: GPL-2.0
// 教学驱动：演示 Linux SPI 框架下手工构造双段 message 的完整流程。
// 不管理 Flash 页、不处理擦写，只做一次只读 Fast Read 并打印结果。

#include <linux/errno.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/slab.h>
#include <linux/spi/spi.h>
#include <linux/string.h>

/* Fast Read 0x0B = 1 字节命令 + 3 字节地址 + 1 字节 dummy = 5 字节前导 */
#define OBSERVER_CMD_LEN  5
/* 预期读回 4 字节数据 */
#define OBSERVER_DATA_LEN 4
```

### 步骤一：分配缓冲区

```c
/**
 * spi_frame_observer_read() - 发起一次 Fast Read 并回传 4 字节数据。
 *
 * @spi:    匹配成功后 Core 传进来的设备对象，包含片选、模式、速度等配置。
 * @address: 24 位 Flash 地址，范围 0x000000 ~ 0xffffff。
 * @data:   调用者提供的缓冲区，成功时写入 4 字节读取结果。
 *
 * 返回值：0 表示成功，负值表示错误码（-EINVAL / -ENOMEM / -EIO 等）。
 */
static int spi_frame_observer_read(struct spi_device *spi, u32 address,
                                   u8 *data)
{
    /*
     * 两个 transfer 组成一次完整 message：
     *   transfer[0]：发命令（tx_buf），同时 MISO 移入的值被丢弃。
     *   transfer[1]：收数据（rx_buf），同时 MOSI 移出零。
     * 注意：{ } 零初始化让未显式设置的字段（speed_hz、bits_per_word、
     * cs_change）保持默认值，继承 spi_device 的配置。
     */
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
```

`kzalloc()` 分配并清零内核内存，`GFP_KERNEL` 表示允许在分配过程中睡眠，当前是可睡眠的进程上下文，所以能用。

不要用局部栈数组直接交给底层：某些控制器需要做 DMA 映射，只有 `kmalloc` 族缓冲区才满足要求，且生命周期必须覆盖整个 `spi_sync()`。

两个分配必须同时成功，否则进入 `out_free`。<br>
对空指针调用 `kfree()` 是安全的，所以失败和成功路径共用同一出口，不会漏掉另一个已经分配成功的缓冲区。

### 步骤二：组装命令、设置两段 transfer

```c
    /* 组装命令段：0x0B Fast Read + 3 字节地址 + 1 dummy 字节 */
    tx_buf[0] = 0x0b;
    tx_buf[1] = (address >> 16) & 0xff; /* 地址高字节 */
    tx_buf[2] = (address >> 8)  & 0xff; /* 地址中字节 */
    tx_buf[3] = address         & 0xff; /* 地址低字节 */
    tx_buf[4] = 0x00;                   /* dummy：值无所谓，占位 8 个时钟 */
    /* 第一段：只发不收（rx_buf 未设置，同时移入的数据被 Core 丢弃） */
    transfers[0].tx_buf = tx_buf;
    transfers[0].len    = OBSERVER_CMD_LEN;
    /* 第二段：只收不发（tx_buf 未设置，Core 自动移出零） */
    transfers[1].rx_buf = rx_buf;
    transfers[1].len    = OBSERVER_DATA_LEN;
```

第一段只发不收（`rx_buf` 未设置，同时移入的数据被 Core 丢弃），对应引脚上前 40 拍：命令 0x0B + 地址 + dummy。

第二段只收不发（`tx_buf` 未设置，Core 自动移出零），对应后 32 拍：MISO 数据存入 `rx_buf`。

`transfers` 的 `{ }` 零初始化让未设置的 `speed_hz`、`bits_per_word` 和 `cs_change` 保持默认值：继承 `spi_device` 的配置，不在第一段之后主动改变 CS。

### 步骤三：挂到 message 并同步提交

```c
    /*
     * 把两段按顺序挂到 message 链表上。
     * 同一 message 内的 transfer 连续执行，CS 全程拉低，不会断开。
     */
    spi_message_init(&message);
    spi_message_add_tail(&transfers[0], &message);
    spi_message_add_tail(&transfers[1], &message);

    /* 同步返回前，栈上的 message 和 transfers 始终有效。 */
    ret = spi_sync(spi, &message);
    if (ret < 0)
        goto out_free;
```

`spi_message_init()` 将 message 清零并初始化链表；`spi_message_add_tail()` 按调用顺序追加两段。同一 message 内的 transfer 连续执行，**CS 全程拉低，不会断开**。

`spi_sync()` 是同步提交：睡眠等待控制器完成全部 transfer 后返回。返回前 `message` 和 `transfers` 仍在栈上有效，Core 可以安全访问。**若改用异步提交 `spi_async()`，就不能让描述符或缓冲区在回调前失效。**

### 步骤四：返回值和数据必须分别判断

```c
    if (message.actual_length != OBSERVER_CMD_LEN + OBSERVER_DATA_LEN) {
        ret = -EIO;
        goto out_free;
    }
    /* 只把有效数据复制给调用者；前导命令本身不返回 */
    memcpy(data, rx_buf, OBSERVER_DATA_LEN);

out_free:
    /* kfree(NULL) 是安全的，所以成功和失败路径共用同一出口 */
    kfree(rx_buf);
    kfree(tx_buf);
    return ret;
}
```

`spi_sync()` 的返回值不是字节数：v6.6 约定 **0 表示事务成功，负值表示错误**。返回 0 只表示"提交并执行完毕"，不等于"长度一定对"，若 Flash 未就绪或 CS 线异常，可能只完成了一部分。

所以必须检查 `message.actual_length`，本例应为 `5 + 4 = 9`。代码把长度不符转换为 `-EIO`，避免把不完整事务当成完整数据。错误路径不复制 `rx_buf`，也不打印伪造结果；只有返回 0 且长度正确时，才把 4 字节复制给调用者。

无论成功或失败，两个堆缓冲区都在函数返回前释放。

### probe 与驱动注册

```c
/*
 * probe()：设备树匹配成功后，Core 调用这个函数，传入已经创建好的 spi_device。
 * 本例只做一件事：读一次地址 0x001234，把 4 字节数据打印到内核日志。
 */
static int spi_frame_observer_probe(struct spi_device *spi)
{
    u8 data[OBSERVER_DATA_LEN] = { };
    int ret;
    /* 打印 Core 从 DTS 解析到的实际参数，确认匹配结果和配置预期一致 */
    dev_info(&spi->dev,
             "matched: cs=%u, mode=0x%x, max_speed_hz=%u, bits_per_word=%u\n",
             spi->chip_select, spi->mode, spi->max_speed_hz,
             spi->bits_per_word);

    ret = spi_frame_observer_read(spi, 0x001234, data);
    if (ret < 0) {
        dev_err(&spi->dev, "fast_read failed: ret=%d\n", ret);
        return ret;  /* 返回错误 → Core 标记绑定失败 */
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

/* 设备树匹配表：compatible = "kimi,spi-frame-observer" 的节点会进入本驱动的 probe */
static const struct of_device_id spi_frame_observer_of_match[] = {
    { .compatible = "kimi,spi-frame-observer" },
    { } /* 哨兵，表示数组结束 */
};
MODULE_DEVICE_TABLE(of, spi_frame_observer_of_match);

static struct spi_driver spi_frame_observer_driver = {
    .driver = {
        .name           = "spi_frame_observer",
        .of_match_table = spi_frame_observer_of_match,
    },
    .probe  = spi_frame_observer_probe,
    .remove = spi_frame_observer_remove,
};
/*
 * module_spi_driver() 展开为 module_init / module_exit 样板：
 * 加载时注册 spi_driver，卸载时注销。不需要手写 init/exit 函数。
 */
module_spi_driver(spi_frame_observer_driver);

MODULE_AUTHOR("Embedded Knowledge System V2026");
MODULE_DESCRIPTION("Read-only SPI framework teaching observer");
MODULE_LICENSE("GPL");
```

`probe()` 里先打印 Core 从 DTS 解析到的实际参数（片选、模式、速度、字长），确认匹配结果和预期一致。然后调用 `spi_frame_observer_read()` 读一次地址 `0x001234`，成功则打印 4 字节数据。

`module_spi_driver()` 展开为 `module_init` / `module_exit` 样板：加载时注册 `spi_driver`，卸载时注销。`MODULE_DEVICE_TABLE(of, ...)` 导出设备树匹配表，使用户空间模块自动加载机制能够识别匹配关系。它们只负责驱动生命周期，不改变 Fast Read 帧格式。


## 配套 Makefile

同一目录下新建 `Makefile`，内容如下：

```makefile
# 教学模块 Makefile：编译 spi_frame_observer.ko
obj-m := spi_frame_observer.o

# 默认使用当前运行内核的 headers；交叉编译时改成你的内核源码路径
# 例如：make KDIR=/path/to/linux-rockchip
KDIR ?= /lib/modules/$(shell uname -r)/build

all:
	$(MAKE) -C $(KDIR) M=$(PWD) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) clean
```

编译：
```bash
make                    # 生成 spi_frame_observer.ko
sudo insmod spi_frame_observer.ko   # 加载（需配套 DTS 已启用）
sudo rmmod spi_frame_observer       # 卸载
dmesg | tail -20        # 查看 probe 输出
```

交叉编译时指定内核源码路径：
```bash
make KDIR=/home/user/linux-rockchip ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu-
```

> 如果你想把这个模块编进内核镜像（built-in）而不是编 `.ko`，把 `obj-m` 改成 `obj-y`，并把 `.c` 文件放进内核源码树对应目录，重新编译内核即可。


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
