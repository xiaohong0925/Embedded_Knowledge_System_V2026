<div class="reader-b2" markdown="1">

# 验证与产品移交

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 6 页，共 6 页
> 
> 本页回答：**同一笔 Fast Read 怎样完成构建、加载和观察，为什么教学模块最后必须移交 spi-nor→MTD？**

---

## <span class="blue"> 从接口选择到构建验证

第五页比较的是调用方式：手工 message 由调用者管理每个步骤，`spi_write_then_read()` 把重复步骤封装起来。<br>
无论选择哪一种，底层要验证的仍是同一笔 Fast Read，而不是另换一个问题。

本页使用第三页的手工教学模块完成收尾：先确认它能够构建、绑定并读出 `0x001234` 起的数据，再判断这次成功能证明什么。

### 先准备与目标内核一致的构建环境

外部模块必须针对目标板的内核配置和构建树编译。<br>
`KDIR` 是内核构建目录，其中需要有匹配内核的 Makefile、配置和头文件；只下载若干源码快照不能替代完整构建树。<br>
交叉编译是“在 x86_64 开发机上生成 ARM64 目标文件”的过程，需要安装相应交叉工具链。

```bash
## 本机针对正在运行的内核构建时，进入目录后执行：
make KDIR=/lib/modules/$(uname -r)/build

##为 RK3568 的 ARM64 内核交叉构建时，把 `KDIR` 换成真实内核构建树，并确认工具链前缀存在：
make KDIR=/path/to/linux-v6.6 ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu-
```

配套 [`Makefile`](code/B-B.4.3/Makefile){: data-code-viewer="true" data-code-title="Makefile" data-code-path="本篇教学配套 · code/B-B.4.3/Makefile"} 的完整内容是：

```makefile
obj-m += spi_frame_observer.o

KDIR ?= /lib/modules/$(shell uname -r)/build

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) modules

clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
```

`obj-m` 请求把源文件构建为可加载模块；`M=$(CURDIR)` 让内核构建系统回到当前外部模块目录。本机构建不覆盖内核的默认架构设置；交叉构建命令中的 `ARCH` 和 `CROSS_COMPILE` 选择目标架构与工具链，并由递归调用的内核 make 继承。


### 日志能证明什么，不能证明什么

以下命令在目标板具备匹配 DTB、模块和只读实验条件后执行：

```bash
insmod spi_frame_observer.ko
dmesg | grep -E 'spi_frame_observer|spi1.0'
ls -l /sys/bus/spi/devices/spi1.0/driver
rmmod spi_frame_observer
dmesg | grep -E 'spi_frame_observer|spi1.0'
```

若设备匹配成功且 Flash 在地址 `0x001234` 的教学假设内容为 `A7 5C 3F 19`，两次 dmesg 合起来可以看到以下格式的日志：

```text
spi_frame_observer spi1.0: matched: cs=0, mode=0x0, max_speed_hz=1000000, bits_per_word=8
spi_frame_observer spi1.0: fast_read: ret=0, addr=0x001234, data=a7 5c 3f 19
spi_frame_observer spi1.0: unbound
```


### 验证完成后，为什么移交 spi-nor→MTD

到这里，教学模块已经完成了它要证明的事情：沿 DTS、驱动匹配、message、Core 和控制器路径读到一组数据。<br>
它故意绕过上层 Flash 框架，只为让这条 SPI 路径保持可见，并不因此成为完整的 Flash 产品驱动。

实际产品中的 W25Q128JV 应优先使用内核已有的 spi-nor 驱动，由它读取 JEDEC 标准定义的制造商标识和器件标识、处理擦除和编程约束，再接入 MTD。

> MTD：Memory Technology Devices，Linux 面向 NOR、NAND 等原始闪存设备的子系统。它向上提供擦除、读写和分区等接口，不等于 SPI 控制器驱动。

因此，正式节点的 `compatible`、识别流程、分区、烧录与校验应走 B-B.4.5 的 `jedec,spi-nor → MTD` 路径。本篇教学模块不承担这些职责，也不应被复制成量产 Flash 驱动。

---

[在新窗口打开 SPI Framework Lab](./html/spi-framework-lab.html#source){: target="_blank" rel="noopener noreferrer" }。在源码工作台中回查本组使用的教学文件与完整实现。

## <span class="blue"> 本节总结

读懂 SPI Linux 驱动框架，关键不是背出三层或五个结构体，而是能沿一笔事务说清对象的交接：DTS 建出 `spi_device`，匹配得到 `spi_driver`，协议驱动把器件帧翻译成 message 和 transfer，Core 调度，控制器驱动完成位移，最后把状态和数据带回同一个调用点。

手工 message 适合展示分段、CS、缓冲区和返回路径；`spi_write_then_read()` 适合缩短小量“写后读”代码，但不会替调用者理解器件帧。教学观察可以暂时绕过上层框架，正式 W25Q 产品仍应进入 spi-nor 和 MTD，不让一个 probe 示例承担完整存储系统的职责。

**速查表**

| 对象或接口 | 在本例中的责任 | 生命期或返回约束 |
|---|---|---|
| [`spi_controller`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="521-743"} | 表示 RK3568 SPI1 及其硬件能力 | Rockchip probe 创建，控制器注销后失效 |
| [`spi_device`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="127-230"} | 表示 SPI1 CS0 上的教学设备 | Core 根据 DTS 创建并注册 |
| [`spi_driver`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="300-345"} | 理解 Fast Read 并构造传输 | 模块加载注册，卸载注销 |
| [`spi_message`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1106-1147"} | 组织一次 5＋4 字节事务 | 同步调用期间有效，记录状态与完成长度 |
| [`spi_transfer[0]`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1029-1070"} | 发送 `0B 00 12 34 00` | 长 5，丢弃同时接收的数据 |
| [`spi_transfer[1]`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="1029-1070"} | 提供时钟并接收 4 字节 | 长 4，同时移出零 |
| [`spi_sync()`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4243-4274"} | 可睡眠的同步传输 | 成功 0，失败负错误码，不返回字节数 |
| [`cs_change`](code/B-B.4.3/kernel-v6.6/include/linux/spi/spi.h){: data-code-viewer="true" data-code-title="spi.h" data-code-path="Linux v6.6 · include/linux/spi/spi.h" data-code-lines="998-1016"} | 请求改变 CS 行为 | 非末段与末段语义不同，本例保持 0 |
| [`spi_write_then_read()`](code/B-B.4.3/kernel-v6.6/drivers/spi/spi.c){: data-code-viewer="true" data-code-title="spi.c" data-code-path="Linux v6.6 · drivers/spi/spi.c" data-code-lines="4377-4430"} | 小量写后读的复制型封装 | 内部仍组 message 并调用 `spi_sync()` |
| 产品路径 | [W25Q128JV 使用 spi-nor → MTD](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端.md) | 不使用教学 compatible 作为产品绑定 |

---

## <span class="blue"> 本页自查

??? details "Q8. 为什么教学模块能读 Fast Read，却不应成为正式 W25Q128JV 产品驱动？"

    教学模块只用于观察 SPI 设备匹配和传输路径，没有实现 Flash 识别、擦除、编程、分区和上层接口。正式产品应使用已有的 spi-nor 驱动并接入 MTD，避免重复实现存储器件约束。

---

[上一页：手工与封装](B-B.4.3_SPI Linux驱动框架_api.md) · [回到 SPI Linux 驱动框架概述](B-B.4.3_SPI Linux驱动框架.md)

</div>
