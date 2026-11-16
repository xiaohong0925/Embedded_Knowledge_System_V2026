<div class="reader-b2" markdown="1">

# B-B.3.3 I2C Linux 驱动框架

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

本篇只回答一个问题：**Linux 怎样把设备树中的一颗 AT24C02 建立为可访问对象，把“读取内部地址 0x10 的一个字节”交给可替换的总线实现，再将数据或错误返回调用者？**

贯穿实例固定为 RK3568 的 I2C1、7 位地址 `0x50` 的 AT24C02 和 Linux v6.6。AT24C02 是可以通过 I2C 读写的 EEPROM，即电可擦除、掉电后仍能保存内容的小容量存储器。读取一个存储单元时，主机先写入内部偏移 `0x10`，再用重复 START 切换为读方向；重复 START 是不先发送 STOP、再次发出 START 以开始下一段消息。

先分清三个名字：

- **I2C Core** 是内核中的 I2C 公共代码，负责创建总线与外设对象、提供统一传输入口并串行化同一总线上的事务；它不理解 AT24C02 的页写规则，也不直接实现 RK3568 的寄存器时序。
- **DTS** 是可读的设备树源文件，用来描述板级硬件；编译后的 DTB 才交给内核使用。
- **SoC** 是片上系统，这里指把 CPU、I2C 控制器等模块集成在同一颗芯片里的 RK3568。

本篇与第 11 章的分工不变：第 11 章讲通用的总线、设备、驱动匹配机制，本篇只展开 I2C 特有的对象创建、传输与用户入口。SMBus 和 PMBus 归 B-B.3.6；AT24 的页写、ACK 轮询和 NVMEM（内核非易失存储器框架）的 `eeprom` 文件归 B-B.3.5。

> ⚠️ 本篇以 Linux v6.6 源码为核对基准。教学代码和交互实验室均未在本篇环境中交叉编译、运行或上板验证；页面中的 `0x5a`、日志和波形都是用于推演的样本，不是实测记录。

---

## <span class="blue"> 怎样阅读这组短页面

这组页面保留同一贯穿实例和完整源码，但把阅读任务分开。首次阅读只沿“导读与源码地图 → 启动建链 → 运行传输”走通一笔读取；用户态入口和 GPIO 替换作为第二轮分支，不妨碍先理解主线。

每页只展示当前需要的代码片段，完整函数、完整教学文件和固定版本源码用于回查。不要因为页面变短，就跳过代码来源、错误路径或验证边界。

1. **首读第 1 页：导读与源码地图**，先知道对象、文件和主调用链在哪里；
2. **首读第 2 页：启动建链**，理解 DTS 怎样变成 adapter、client 和 probe 参数；
3. **首读第 3 页：运行传输**，沿两条消息走到控制器并返回；
4. **第二轮分支：用户态入口、替换控制器**，按工作需要选读。

[开始首读：启动建链](B-B.3.3_I2C Linux驱动框架_startup.md)。

---

## <span class="blue"> 先建立全路：寄存器操作没有消失，而是换了负责人

在厂商 SDK 或裸驱动中，一份驱动可能从字符设备的 `read()`、`ioctl()` 一路做到 `readl()`、`writel()`，直接控制 SoC 的 I2C 控制器寄存器。内存映射 I/O 把寄存器窗口映射到 CPU 地址空间，`readl()`、`writel()` 通过这个窗口访问控制器；它们访问的不是 AT24C02 的内部偏移。

Linux 通用 I2C 框架把这件工作拆成可替换的两半：

```text
外设驱动：AT24C02 的内部偏移、消息方向、数据长度
    ↓ 只提交与 SoC 无关的 msgs[2]
I2C Core：找到 adapter、锁住总线、调用已登记的 algorithm
    ↓
控制器实现：RK3568 寄存器 / GPIO 位模拟
    ↓
SDA、SCL 上的真实波形
    ↓
数据和错误沿原路返回
```

因此，修改 RK3568 控制器时序仍然需要进入寄存器层，但不必在每颗外设驱动里重复做一遍。反过来，替换 AT24C02 为另一颗传感器时，控制器驱动也不需要理解新器件的内部寄存器规则。

本篇使用两条入口观察同一后半路：

```text
入口 A：内核教学驱动 demo_read_reg()
入口 B：用户态 i2c-read + /dev/i2c-1
                  ↓
           同一个 i2c_transfer()
                  ↓
       adapter->algo->master_xfer()
                  ↓
        RK3568 或 GPIO 模拟控制器
```

### 先从源码目录看 I2C 子系统：核心、控制器和外设并不都在同一个目录

阅读这套代码时，先按“对象由谁实现”找文件，不要从 `drivers/i2c/` 开始寻找所有 I2C 外设。Linux v6.6 中，本篇涉及的主要代码这样分布：

```text
include/linux/i2c.h                 内核内部的 client、adapter、driver、algorithm
include/uapi/linux/i2c.h            用户与内核共享的 i2c_msg、I2C_M_RD
include/uapi/linux/i2c-dev.h        I2C_RDWR、i2c_rdwr_ioctl_data

drivers/i2c/
├── i2c-core-base.c                 adapter/client 生命周期、加锁、通用传输
├── i2c-core-of.c                   从设备树子节点创建 client
├── i2c-dev.c                       为 adapter 提供 /dev/i2c-N 字符设备入口
├── busses/
│   ├── i2c-rk3x.c                  RK3568 等 Rockchip 控制器的寄存器状态机
│   └── i2c-gpio.c                  取得 GPIO，提供 SDA/SCL 读写操作
└── algos/
    └── i2c-algo-bit.c              用上述 GPIO 操作逐位实现 I2C 波形

drivers/misc/eeprom/at24.c           内核现成 AT24 外设驱动
drivers/gpio/gpio-pca953x.c          PCA9555 等 I2C GPIO 扩展器驱动
```

这里先把 adapter 理解为“一条可访问总线”的内核对象，把 client 理解为“挂在这条总线上的一颗外设”的对象；[启动建链](B-B.3.3_I2C Linux驱动框架_startup.md)再展开它们的字段和所有权。`probe()` 则是设备与驱动绑定后执行的初始化回调。

这棵目录树对应四种不同的代码责任：

- **接口头文件**规定对象长什么样。`include/linux/i2c.h` 面向内核驱动；`include/uapi/` 是用户空间 ABI（应用二进制接口）的一部分，用户程序也能包含后两个头文件。
- **Core** 实现所有控制器和外设可以共用的规则。它创建并关联对象，但不包含 RK3568 寄存器定义，也不决定 AT24C02 的内部地址宽度。
- **控制器实现**分为“具体硬件”和“可复用算法”。`i2c-rk3x.c` 自己实现寄存器传输；`i2c-gpio.c` 只负责操作引脚，把逐位波形交给 `i2c-algo-bit.c`。所以 GPIO 路径是两个文件协作，不是一个文件包办全部工作。
- **外设驱动按外设提供的功能归档**。AT24 提供存储能力，位于 `drivers/misc/eeprom/`；PCA9555 提供 GPIO 能力，位于 `drivers/gpio/`。它们虽然都通过 I2C 访问，却不会因此搬进 `drivers/i2c/`。

同一条主线在这些文件之间这样穿行：

```text
启动建链：
rk3568-at24-demo.dts
→ busses/i2c-rk3x.c 创建并注册 adapter
→ i2c-core-of.c 读取 eeprom@50，创建 client
→ 教学 demo_i2c.c 收到 probe(client)

内核读取：
demo_i2c.c 组织 msgs[2]
→ i2c-core-base.c 持锁并调用 adapter->algo->master_xfer()
→ busses/i2c-rk3x.c 操作寄存器、FIFO 和中断状态机

用户态读取：
i2c-read.c 调用 ioctl(I2C_RDWR)
→ i2c-dev.c 复制消息并调用同一个 i2c_transfer()
→ 仍然进入 i2c-core-base.c 和当前 adapter 的控制器实现
```

因此，`i2c-dev.c` 不是另一套总线协议栈，`i2c-algo-bit.c` 也不是另一套外设驱动。前者只增加用户入口，后者只替换波形实现；Core 的对象和传输约定保持不变。

还要区分“源码树里存在”和“目标板上存在”：各目录的 Kconfig 提供配置选择，Makefile 根据配置把源文件编进内核、编成模块或不参与本次构建；设备树再描述本板实际硬件，驱动 probe 成功后才形成可使用的运行对象。看到某个 `.c` 文件，不能直接推断当前系统已经包含它。

下面的实验室可以逐步执行启动建链和传输过程。启动与传输代码窗可切换“完整函数”和“步骤片段”：前者保留真实文件上下文与起始行号，后者只突出当前一步；SCL 时钟延展单步则需在 GPIO 模拟模式下操作。先沿正文建立对象和调用链，再用实验室观察对应步骤。

[在新窗口打开 I2C Framework Lab](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。实验室中的步骤是依据 v6.6 源码构造的模型推演，不连接真实硬件。

---

## <span class="blue"> 核验边界

本篇的结构体、宏、函数和返回语义已按 Linux v6.6 的 `include/uapi/linux/i2c.h`、`include/linux/i2c.h`、`i2c-core-of.c`、`i2c-core-base.c`、`i2c-dev.c`、`i2c-rk3x.c`、`i2c-gpio.c`、`i2c-algo-bit.c` 核对。第 11、12 章的前置链接也已检查其现有内容。

原创教学 DTS、内核模块和用户程序只是源码级核验，**尚未完成交叉编译、部署、运行和上板验证**；交互实验室展示的是源码模型，不是硬件仿真器或实测记录。

---

[下一页：启动建链](B-B.3.3_I2C Linux驱动框架_startup.md)

</div>
