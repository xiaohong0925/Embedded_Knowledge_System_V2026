<div class="reader-b2" markdown="1">

# 构建与观察：教学模块怎样验证并移交产品路径

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架
>
> 本组阅读：第 6 页，共 6 页

本页只回答一个问题：**怎样构建、加载并观察同一笔事务，为什么正式 W25Q 产品仍应进入 spi-nor 和 MTD？**

---

## <span class="blue"> 构建、加载与观察同一笔事务

### 先准备与目标内核一致的构建环境

外部模块必须针对目标板的内核配置和构建树编译。`KDIR` 是内核构建目录，其中需要有匹配内核的 Makefile、配置和头文件；只下载若干源码快照不能替代完整构建树。交叉编译是“在 x86_64 开发机上生成 ARM64 目标文件”的过程，需要安装相应交叉工具链。

本机针对正在运行的内核构建时，进入配套目录后执行：

```bash
cd "docs/B. 总线协议/B. 低速外设接口/code/B-B.4.3"
make KDIR=/lib/modules/$(uname -r)/build
```

为 RK3568 的 ARM64 内核交叉构建时，把 `KDIR` 换成真实内核构建树，并确认工具链前缀存在：

```bash
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

教学 DTS 片段需要合入实际板级 DTS，再使用完整内核或 BSP（Board Support Package，板级支持包）构建树重编 DTB。DTB 是 DTS 编译得到的二进制设备树，启动时由内核读取。通用内核树可以在合入后执行：

```bash
make -C /path/to/linux-v6.6 ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- dtbs
```

实际部署应只更新目标板对应 DTB，保留可恢复的原启动配置，并按板卡方式重新启动使新节点生效。随后确认 `spi1.0` 没有被 spi-nor 或其他驱动占用，再加载教学模块。

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

**这只是预期输出样式，不是本项目实板日志。** `mode=0x0` 对应未设置额外模式位；`ret=0` 说明 SPI 事务在软件层面成功；`data=...` 是本次从接收缓冲区读到的内容。`/sys/bus/spi/devices/spi1.0/driver` 的链接目标可以核对当前绑定驱动；第二次 dmesg 中的 `unbound` 对应 rmmod 触发的 remove 路径。

即使出现上述日志，也只能说明该次软件事务完成并返回了字节，不能单独证明全部电气裕量、长期稳定性或其他地址内容。若返回负错误码，应保留错误值并沿“设备是否创建、驱动是否匹配、传输是否提交、控制器是否报错”分层定位；具体 spidev 命令、逻辑分析仪设置和示波器测量由 B-B.4.4 展开。

### 正式产品不沿用教学绑定

教学驱动故意绕过上层 Flash 框架，只为看清 SPI 对象与传输路径。实际产品中的 W25Q128JV 应优先使用内核已有的 spi-nor 驱动，由它读取 JEDEC 标准定义的制造商标识和器件标识、处理擦除和编程约束，再接入 MTD。

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
| `spi_controller` | 表示 RK3568 SPI1 及其硬件能力 | Rockchip probe 创建，控制器注销后失效 |
| `spi_device` | 表示 SPI1 CS0 上的教学设备 | Core 根据 DTS 创建并注册 |
| `spi_driver` | 理解 Fast Read 并构造传输 | 模块加载注册，卸载注销 |
| `spi_message` | 组织一次 5＋4 字节事务 | 同步调用期间有效，记录状态与完成长度 |
| `spi_transfer[0]` | 发送 `0B 00 12 34 00` | 长 5，丢弃同时接收的数据 |
| `spi_transfer[1]` | 提供时钟并接收 4 字节 | 长 4，同时移出零 |
| `spi_sync()` | 可睡眠的同步传输 | 成功 0，失败负错误码，不返回字节数 |
| `cs_change` | 请求改变 CS 行为 | 非末段与末段语义不同，本例保持 0 |
| `spi_write_then_read()` | 小量写后读的复制型封装 | 内部仍组 message 并调用 `spi_sync()` |
| 产品路径 | W25Q128JV 使用 spi-nor → MTD | 不使用教学 compatible 作为产品绑定 |

---

## <span class="blue"> 本页自查

??? details "Q8. 为什么教学模块能读 Fast Read，却不应成为正式 W25Q128JV 产品驱动？"

    教学模块只用于观察 SPI 设备匹配和传输路径，没有实现 Flash 识别、擦除、编程、分区和上层接口。正式产品应使用已有的 spi-nor 驱动并接入 MTD，避免重复实现存储器件约束。

---

[上一页：便捷封装的边界](B-B.4.3_SPI Linux驱动框架_api.md) · [回到导读与责任地图](B-B.4.3_SPI Linux驱动框架.md)

</div>
