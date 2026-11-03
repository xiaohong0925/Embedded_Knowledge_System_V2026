# B-B.3.3 I2C Linux 驱动框架

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] Beginner → Intermediate | 预计阅读时间：45 分钟

## <span class="blue"> 本节导读

前面两篇回答了 I2C 信号怎样在线路上传输。本篇换到 Linux 代码内部，只追踪一个问题：**RK3568 的 I2C1 上接了一片地址为 0x50 的 AT24C02，驱动要读取地址 0x10 的一个字节，这笔读取怎样从设备树和驱动初始化回调 `probe()` 走到控制器寄存器，数据又怎样返回？**

AT24C02 是通过 I2C 访问的 EEPROM，即电可擦除、掉电后仍能保存数据的小容量存储器。START 和 STOP 分别是总线事务的开始和结束条件。读取它的一片存储单元时，主机先写入一个字节的存储地址，再用重复 START 切换为读方向。重复 START 是不先结束当前事务、再次发出 START 以开始下一段消息。这个操作足够小，却能同时暴露设备树、设备对象、传输消息、Core 和控制器驱动之间的关系。

> SoC：System on Chip，片上系统。这里指把 CPU、I2C 控制器等模块集成在同一颗芯片里的主控，例如 RK3568。

<!-- -->

> I2C Core：Linux 内核提供的 I2C 公共代码。它管理总线与外设对象，提供统一传输入口，并保证同一总线上的事务不会互相穿插；它不理解 AT24C02 的存储页，也不直接实现 RK3568 的寄存器时序。

<!-- -->

> 与第 11 章的分工：第 11 章讲通用设备模型怎样匹配设备与驱动。本篇只展开 I2C 特有的对象创建和传输路径，不再重复通用匹配机制。

本篇以 Linux v6.6 源码为核对基准。本节覆盖：裸驱动与框架驱动中的寄存器操作位置、配套设备树源文件（DTS）与完整教学模块、普通 I2C 传输入口 `i2c_transfer()` 到 RK3568 收发缓冲区的真实路径、DTS 属性的消费代码、用户态入口 `/dev/i2c-N`，以及 I2C GPIO 扩展器 PCA9535 怎样复用同一框架。系统管理总线（SMBus）事务与电源管理总线（PMBus）命令独立放到 B-B.3.6 展开。

---

## <span class="blue"> 从直写寄存器到复用框架：代码责任怎样分开

在厂商 SDK（Software Development Kit，软件开发工具包）或裸驱动中，一次外设读取可能全部由一份驱动完成：通过文件读写接口暴露给应用的字符设备收到 `read()` 或 `ioctl()` 请求，驱动再用 `readl()`、`writel()` 访问 SoC 寄存器，并控制 START、地址、数据和 STOP。内存映射 I/O（Input/Output，输入输出）把寄存器窗口映射到 CPU 地址空间，`readl()`、`writel()` 则通过这块地址窗口读写寄存器；它们操作的是 SoC 内部控制器，不是 I2C 外设的存储地址。

```text
应用 read/ioctl
    → 自己的字符设备驱动
    → readl/writel 操作本 SoC 的 I2C 控制器
    → 软件或控制器状态机逐步产生波形
```

Linux 的通用 I2C 框架没有让寄存器操作消失，而是把它集中到控制器驱动中。AT24C02 驱动只表达“写存储地址 0x10，再读一个字节”；RK3568 控制器驱动才决定该写哪些寄存器、怎样等待中断、怎样从接收缓冲区取数据。控制器内部的发送和接收缓冲区采用 FIFO（First In, First Out，先进先出）方式，分别记为 TXFIFO 和 RXFIFO。

```text
AT24C02 外设驱动
    → i2c_transfer()：提交与芯片无关的消息
    → I2C Core：选定总线并串行化事务
    → RK3568 控制器驱动的 master_xfer()
    → readl/writel、TXFIFO、RXFIFO 和中断
    → 数据与错误沿原路返回
```

> master_xfer：控制器驱动登记给 Core 的普通 I2C 传输方法。外设驱动不直接调用它，Core 在取得总线锁后调用。

硬件侧的 SDA 是串行数据线，SCL 是串行时钟线，前两篇已经展开它们的波形。软件责任线则按以下方式划分：

| 责任方 | 在本例中负责什么 | 通常由谁维护 |
|:---|:---|:---|
| AT24C02 外设驱动 | 存储地址、读写长度、页边界等器件规则 | 内核已有现成驱动，特殊器件才自行编写 |
| I2C Core | 创建外设对象、提供传输入口、串行化总线事务 | Linux 内核公共代码 |
| RK3568 控制器驱动 | 寄存器、时钟分频、FIFO、中断和错误处理 | SoC 厂商及内核维护者 |
| 控制器与 AT24C02 硬件 | 产生并响应 SDA/SCL 波形 | 硬件设计决定，软件通过寄存器和协议使用 |

这张责任线解释了两条实际工程经验。标准 EEPROM 接到另一款 SoC 上时，外设驱动仍可复用，只替换控制器驱动；同一款 RK3568 改接传感器时，控制器驱动也不必重写。只有修改控制器时序、适配新 SoC 或绕过框架时，才需要直接进入控制器寄存器层。**复用现成驱动不是少写了底层的同一件事，而是让底层实现只保留一份。**

---

## <span class="blue"> 完整实验：从 DTS 到一次真实读取

先把实验需要的文件一次配齐。教学驱动使用专用设备树匹配字符串 `compatible`，避免与内核现成的 AT24 驱动争用同一设备；它只用于受控测试，不是产品驱动。后文再单独切换回 `"atmel,24c02"`，观察现成驱动怎样消费写页大小属性 `pagesize`。

### 板级 DTS：启用 I2C1 并声明测试设备

RK3568 的 `rk356x.dtsi` 已经描述 I2C1 控制器。`.dtsi` 是供其他设备树源文件包含的公共描述。以下是 Linux v6.6 源码节选，中断、时钟和引脚复用属性在此省略：

```dts title="源码节选 · rk356x.dtsi"
i2c1: i2c@fe5a0000 {
    compatible = "rockchip,rk3568-i2c", "rockchip,rk3399-i2c";
    reg = <0x0 0xfe5a0000 0x0 0x1000>;
    #address-cells = <1>;
    #size-cells = <0>;
    status = "disabled";
};
```

这段控制器描述包含四类信息：

- **`reg`**：CPU 访问 I2C1 控制器寄存器的物理地址窗口。`0xfe5a0000` 由 Rockchip 的芯片设计决定，`0x1000` 是窗口长度，不能由板级作者随意编造。
- **`#address-cells` 与 `#size-cells`**：前者为 1，表示子节点用一个 32 位单元写地址；后者为 0，表示子节点不写地址空间长度。
- **`i2c1`**：节点标签，板级文件用 `&i2c1` 修改这个既有节点。
- **`status = "disabled"`**：SoC 默认不启用该控制器，因为并非每块 RK3568 板卡都会把 I2C1 接出。

在板级 DTS 中加入：

```dts title="板级示例 · rk3568-at24-demo.dts"
&i2c1 {
    status = "okay";                    /* 本板启用 I2C1 */
    clock-frequency = <400000>;         /* 目标 SCL：400 kHz */

    eeprom@50 {
        compatible = "demo,at24c02-reader"; /* 只匹配本篇教学驱动 */
        reg = <0x50>;                       /* AT24C02 的 7 位 I2C 地址 */
    };
};
```

板级节点各自回答一个问题：

- **访问哪颗外设**：**`reg = <0x50>`** 会被写入外设对象的 `addr` 字段，用于在线路上选择 AT24C02。它不是前面控制器节点的寄存器地址；节点名中的 `@50` 应与它一致。
- **由哪个驱动处理**：**`compatible`** 提供匹配字符串。这里的专用字符串使现成 AT24 驱动不会匹配这个测试节点。
- **是否启用总线**：**`status = "okay"`** 覆盖 dtsi 的默认值，明确本板启用 I2C1。

> 🔴 这个节点会真实访问 0x50。只在确认该地址确实是可测试的 AT24C02 时使用；不要把示例 `compatible` 写进生产设备，也不要用它抢占正在工作的外设。

DTS 是可读的设备树源文件，DTB 是编译后交给内核的二进制设备树。测试前需要让新 DTB 在板卡上生效，并确保模块针对板卡正在运行的内核配置构建。在内核源码树中构建 DTB 的命令为：

```bash title="构建 DTB"
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- dtbs
```

### 完整教学模块：`probe()` 真正调用读取函数

保存为 `demo_i2c.c`。这是本篇原创的完整教学文件，不是内核源码节选；代码接口按 Linux v6.6 核对，但本篇环境未进行交叉编译和上板运行。

```c title="完整教学文件 · demo_i2c.c"
// SPDX-License-Identifier: GPL-2.0
#include <linux/errno.h>        /* EOPNOTSUPP、EIO 等错误码 */
#include <linux/i2c.h>          /* client、driver、msg 与传输 API */
#include <linux/module.h>       /* 模块声明、加载与卸载 */
#include <linux/of.h>           /* 设备树匹配表 */

#define DEMO_REG_ADDR 0x10      /* 本例读取的 AT24C02 存储地址 */

/* 1. 一次同步复合读取：先写存储地址，再读一个字节。 */
static int demo_read_reg(struct i2c_client *client, u8 reg, u8 *value)
{
    struct i2c_msg msgs[2] = {
        {
            .addr = client->addr, /* 第一条消息仍访问这颗 AT24C02 */
            .flags = 0,           /* 未设置 I2C_M_RD：写方向 */
            .len = 1,             /* 只发送一个存储地址字节 */
            .buf = &reg,          /* 待发送内容就是 0x10 */
        },
        {
            .addr = client->addr, /* 重复 START 后访问同一外设 */
            .flags = I2C_M_RD,    /* 第二条消息切换为读方向 */
            .len = 1,             /* 只接收一个字节 */
            .buf = value,         /* 控制器驱动把数据写到这里 */
        },
    };
    int ret;

    /* 两条消息属于同一笔事务，整组结束后才发 STOP。 */
    ret = i2c_transfer(client->adapter, msgs, 2);
    if (ret < 0)
        return ret;               /* 保留总线或控制器返回的错误 */

    if (ret != 2)
        return -EIO;              /* 没完成两条消息按 I/O 失败处理 */

    return 0;                     /* 数据已通过 value 返回 */
}

/* 2. 匹配成功后，Core 把已经创建的 client 交给本驱动。 */
static int demo_probe(struct i2c_client *client)
{
    u8 value;
    int ret;

    /* 确认控制器支持普通 I2C 消息，而不只支持某类 SMBus 事务。 */
    if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))
        return -EOPNOTSUPP;

    ret = demo_read_reg(client, DEMO_REG_ADDR, &value);
    if (ret) {
        dev_err(&client->dev, "read reg 0x%02x failed: %d\n",
                DEMO_REG_ADDR, ret);
        return ret;               /* 负值使本次 probe 失败 */
    }

    dev_info(&client->dev, "reg 0x%02x = 0x%02x, addr = 0x%02x\n",
             DEMO_REG_ADDR, value, client->addr);
    return 0;                     /* 通信与初始化均成功，允许绑定 */
}

static void demo_remove(struct i2c_client *client)
{
    dev_info(&client->dev, "remove demo device\n");
}

/* 3. 声明本驱动支持的设备树型号。 */
static const struct of_device_id demo_of_match[] = {
    { .compatible = "demo,at24c02-reader" },
    { }                            /* 空元素表示匹配表结束 */
};
MODULE_DEVICE_TABLE(of, demo_of_match); /* 导出模块自动加载别名 */

static struct i2c_driver demo_driver = {
    .driver = {
        .name = "demo_i2c",
        .of_match_table = demo_of_match, /* 与 DTS compatible 比较 */
    },
    .probe = demo_probe,          /* v6.6：只接收 client 一个参数 */
    .remove = demo_remove,
};
module_i2c_driver(demo_driver);   /* 加载注册驱动，卸载注销驱动 */

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("I2C combined-read teaching example");
```

这段骨架可以按“数据、返回值、注册”三条线阅读。

**数据：谁保存设备，谁保存本次传输**

- `struct i2c_client` 代表挂在总线上的一颗外设。本例的 **`client->addr`** 是 0x50，**`client->adapter`** 指向它所属的 I2C1 总线对象。
- `struct i2c_msg` 只描述一次传输。写消息的 `buf` 提供待发送字节，读消息的 `buf` 提供接收位置。
- `u8` 是 8 位无符号整数，恰好容纳一个 I2C 数据字节。

两条消息和 `reg` 都位于栈上。`i2c_transfer()` 是同步调用，返回时传输已经结束，所以这些缓冲区在硬件使用期间一直有效。

**返回值：怎样判断方向、能力与错误**

- `I2C_M_RD`：读方向标志，方向不拼进 7 位地址。
- `I2C_FUNC_I2C`：普通 I2C 消息的能力位。`i2c_check_functionality()` 返回非零，才表示控制器具备该能力。
- `EIO` 与 `EOPNOTSUPP`：分别表示通用 I/O 错误、当前操作不受支持。
- `dev_err()` 与 `dev_info()`：分别记录带设备身份的错误与普通信息，之后可用 `dmesg` 查看。

**注册：加载、自动加载与实际匹配各做什么**

- `module_i2c_driver()`：在 v6.6 中，模块加载时调用 `i2c_add_driver()`，卸载时调用 `i2c_del_driver()`，所以本例不需要另写模块入口函数。
- `MODULE_DEVICE_TABLE()`：导出设备别名，帮助系统自动加载模块。
- `of_match_table`：保存在驱动中，参与设备与驱动的实际匹配。

### 构建、加载与预期结果

在同一个目录保存源码后，生成内核模块构建规则文件 Makefile，并选择一种构建方式。`obj-m` 表示把 `demo_i2c.c` 构建为可加载模块 `demo_i2c.ko`；`M="$PWD"` 告诉内核构建系统，模块源码位于当前目录。

```bash title="Makefile 与模块构建命令"
cat > Makefile <<'EOF'
obj-m += demo_i2c.o
EOF

# 本机构建：只验证与当前主机内核头文件能否一起构建。
make -C "/lib/modules/$(uname -r)/build" M="$PWD" modules

# RK3568 交叉构建：替换源码路径和工具链前缀；不要与上一条重复执行。
# make -C /path/to/rk3568-kernel ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- M="$PWD" modules
```

命令中的路径和目标可以这样对应：

- `make -C`：先进入内核构建目录。
- `$(uname -r)`：取得当前主机内核版本。
- `$PWD`：指向模块所在目录。
- `ARCH=arm64`：选择 64 位 ARM 目标。
- `CROSS_COMPILE`：指定交叉工具链前缀。

本机构建成功只证明代码与主机头文件兼容，不能证明它能访问 RK3568 硬件。

把与新 DTB、运行内核相匹配的 `demo_i2c.ko` 复制到测试板，执行：

```bash title="加载、查看日志并卸载模块"
insmod demo_i2c.ko
dmesg | grep demo_i2c
rmmod demo_i2c
dmesg | grep demo_i2c
```

`insmod` 加载模块，`rmmod` 卸载模块，`dmesg` 读取内核环形日志，管道后的 `grep demo_i2c` 只筛选本例相关信息。

假设 0x10 中保存的字节为 0x5a，日志形状为：

```text title="预期日志示例 · 0x5a 仅为样本值"
demo_i2c 1-0050: reg 0x10 = 0x5a, addr = 0x50
demo_i2c 1-0050: remove demo device
```

先看输出字段：`1-0050` 是由总线编号和外设地址组成的设备名，这里表示总线 1、地址 0x50。0x5a 只是样本，真实结果取决于 EEPROM 内容，不能把其他合法数值当成故障。

再按日志判断执行到了哪里：

- **没有读取日志**：驱动已注册，但没有匹配到测试节点。
- **日志包含负错误码**：`probe()` 已执行，但通信失败。

仅看到 `insmod` 成功，不能证明外设可读。

---

## <span class="blue"> `client` 从哪里来：设备树字段怎样进入对象

完整模块从 `probe(client)` 开始工作，但这个指针并不是教学驱动分配的。Linux v6.6 的创建路径为：

```text
rk3x_i2c_probe()
    → i2c_add_adapter()
    → i2c_register_adapter()
    → of_i2c_register_devices()
    → of_i2c_register_device()
    → i2c_new_client_device()
    → device_register(&client->dev)
    → 通用设备模型完成匹配
    → i2c_device_probe()
    → demo_probe(client)
```

`struct i2c_adapter` 代表一条可由 Core 访问的 I2C 总线，本例对应 I2C1。RK3568 控制器在 `drivers/i2c/busses/i2c-rk3x.c` 的 `rk3x_i2c_probe()` 中分配并初始化自己的状态，映射控制器寄存器，再注册适配器。以下只保留与当前路径有关的行：

```c
i2c_parse_fw_timings(&pdev->dev, &i2c->t, true);
i2c->adap.algo = &rk3x_i2c_algorithm;
i2c->adap.dev.of_node = np;
i2c->regs = devm_platform_ioremap_resource(pdev, 0);
/* 时钟、中断等初始化省略 */
ret = i2c_add_adapter(&i2c->adap);
```

这几行分别建立三项关系：

- `devm_platform_ioremap_resource()`：把平台设备的寄存器窗口映射为内核可访问地址，并由设备资源管理机制在设备生命周期结束时释放。
- `algo`：保存控制器收发方法表，是适配器最重要的字段之一。
- `of_node`：让 Core 知道这个适配器对应哪个设备树控制器节点。

Core 在 `drivers/i2c/i2c-core-of.c` 中扫描可用的子节点。处理 `eeprom@50` 时，关键取值与创建过程是：

```c title="源码合并节选 · of_i2c_get_board_info() 与 of_i2c_register_device()"
struct i2c_board_info info;

ret = of_property_read_u32(node, "reg", &addr);
/* 错误与地址标志处理省略 */
info.addr = addr;
info.of_node = node;
/* ... */
client = i2c_new_client_device(adap, &info);
```

随后，`drivers/i2c/i2c-core-base.c` 的 `i2c_new_client_device()` 保存总线和地址，并把设备注册进设备模型：

```c
client = kzalloc(sizeof *client, GFP_KERNEL);
/* 分配失败处理省略 */
client->adapter = adap;
client->addr = info->addr;
/* OF 节点及其他字段初始化省略 */
status = device_register(&client->dev);
```

这里有两个 Core 内部动作：

- `of_property_read_u32()`：从 DTS 节点读取一个 32 位无符号整数属性，这里读出的就是 **`reg = <0x50>`**。
- `kzalloc()`：分配并清零内核内存；`GFP_KERNEL` 表示分配发生在可睡眠的进程上下文中。

它们只负责说明 client 如何诞生。教学驱动不要再次分配 client，只接收已经建立好总线和地址关系的对象。

到这里，DTS 中的 **`reg`** 已经沿着 `addr → info.addr → client->addr` 进入对象。设备模型再比较节点的 **`compatible`** 与驱动的 `of_match_table`；匹配成功后，`i2c_device_probe()` 最终执行 `driver->probe(client)`。通用匹配细节归第 11 章，本篇只需守住这条 I2C 特有的数据来源链。

适配器由控制器驱动注册，并在控制器移除时通过 `i2c_del_adapter()` 注销；client 由 Core 创建，设备注销时由 Core 撤销；教学驱动只使用 client，不在 `remove()` 中释放它。`remove()` 解除的是设备与驱动的绑定，不等于删除设备树节点。

---

## <span class="blue"> 沿 `i2c_transfer()` 进入 RK3568：消息怎样变成数据

现在回到 `demo_read_reg()`。两条消息已经填好，接下来每一段代码都能定位到同一个输入：地址 0x50、存储地址 0x10、读取一个字节。

### Core 先锁定总线，再调用控制器方法

`drivers/i2c/i2c-core-base.c` 中，公开入口先检查能力并锁定总线：

```c
ret = __i2c_lock_bus_helper(adap);
if (ret)
    return ret;

ret = __i2c_transfer(adap, msgs, num);
i2c_unlock_bus(adap, I2C_LOCK_SEGMENT);
return ret;
```

`__i2c_transfer()` 是要求调用者已经持锁的内部入口。它最终通过适配器的方法表调用控制器：

```c
if (i2c_in_atomic_xfer_mode() && adap->algo->master_xfer_atomic)
    ret = adap->algo->master_xfer_atomic(adap, msgs, num);
else
    ret = adap->algo->master_xfer(adap, msgs, num);
```

这里先判断执行环境，再选择传输方法：

- `I2C_LOCK_SEGMENT`：解锁当前总线段，与前面的加锁配对，防止多个传输交叉占用同一条物理总线。
- `i2c_in_atomic_xfer_mode()`：判断当前是否处于不能睡眠的原子场景。如果驱动提供了 `master_xfer_atomic`，Core 就改用不能睡眠的轮询传输。

本例在 `probe()` 的进程上下文中执行，走普通的 `master_xfer`。

`struct i2c_algorithm` 是控制器提供的方法集合。RK3568 所在的 rk3x 驱动把它实现为静态对象：

```c
static const struct i2c_algorithm rk3x_i2c_algorithm = {
    .master_xfer        = rk3x_i2c_xfer,
    .master_xfer_atomic = rk3x_i2c_xfer_polling,
    .functionality      = rk3x_i2c_func,
};
```

于是本例的函数指针调用落到 `rk3x_i2c_xfer(adap, msgs, 2)`。五个对象在这次调用中各提供一项信息：

- `struct i2c_driver`：外设语义。
- `struct i2c_client`：外设地址和所属总线。
- `struct i2c_msg`：本次传输的数据与方向。
- `struct i2c_adapter`：总线对象。
- `struct i2c_algorithm`：控制器方法。

它们是在这条执行路径上相遇的，不是五份互不相关的定义。

### RK3568 识别出“短写＋读”的组合事务

`rk3x_i2c_xfer()` 进入 `rk3x_i2c_xfer_common()`，后者调用 `rk3x_i2c_setup()`。本例第一条消息长度小于 4、方向为写，第二条方向为读，命中控制器专门支持的寄存器读取分支：

```c
if (num >= 2 && msgs[0].len < 4 &&
    !(msgs[0].flags & I2C_M_RD) && (msgs[1].flags & I2C_M_RD)) {
    u32 reg_addr = 0;

    for (i = 0; i < msgs[0].len; ++i) {
        reg_addr |= msgs[0].buf[i] << (i * 8);
        reg_addr |= REG_MRXADDR_VALID(i);
    }

    i2c->msg = &msgs[1];
    i2c->mode = REG_CON_MOD_REGISTER_TX;
    i2c_writel(i2c, addr | REG_MRXADDR_VALID(0), REG_MRXADDR);
    i2c_writel(i2c, reg_addr, REG_MRXRADDR);
    ret = 2;
}
```

这段代码先组装地址，再选择工作模式，最后记录已处理的消息数。

**1. 组装寄存器地址**

- `u32`：32 位无符号整数。
- 循环：把短写消息的字节装入 `reg_addr`。
- `REG_MRXADDR_VALID(i)`：标记第 i 个寄存器地址字节有效。

**2. 设置控制器状态**

- `REG_CON_MOD_REGISTER_TX`：选择控制器的“寄存器地址发送”模式。
- 第一条消息中的 0x10 被写入 `REG_MRXRADDR`，外设地址写入 `REG_MRXADDR`。`i2c_writel()` 是该驱动对寄存器写操作的封装。
- `i2c->msg` 指向第二条读消息，后续接收处理因此知道数据该写到哪里。

**3. 理解局部返回值**

`ret = 2` 在这里只表示“本次设置已覆盖两条消息”，不是最终传输已经成功。启动、等待和错误检查仍由 `rk3x_i2c_xfer_common()` 完成。

> FIFO：First In, First Out，先进先出缓冲区。RK3568 驱动把待发送字节放入发送 FIFO，并从接收 FIFO 取回外设数据，CPU 不必逐位驱动 SDA/SCL。

### RXFIFO 的字节最终写入 `msgs[1].buf`

传输启动后，rk3x 驱动等待硬件中断。接收处理函数 `rk3x_i2c_handle_read()` 从 RXBUFFER 取数据：

```c
if (len > 32)
    len = 32;                 /* 每次最多处理 32 字节 */

for (i = 0; i < len; ++i) {
    if (i % 4 == 0)
        val = i2c_readl(i2c, RXBUFFER_BASE + (i / 4) * 4);

    byte = (val >> ((i % 4) * 8)) & 0xff;
    i2c->msg->buf[i2c->processed++] = byte;
}
```

`RXBUFFER_BASE` 是接收 FIFO 寄存器窗口的起始偏移。一个 32 位寄存器可以容纳 4 个字节，所以每读取一个新寄存器后，代码用 `(i % 4) * 8` 移位，依次取出第 0、1、2、3 个字节；`i2c->processed` 记录已经写回当前消息的字节数。

本例 `len` 为 1，只循环一次。由于 `i2c->msg` 已指向 `msgs[1]`，关键赋值等价于：

```c
msgs[1].buf[0] = 从 RXFIFO 取出的字节;
```

这正是教学驱动中 `value` 的内存位置。**读回的数据不经过 `i2c_transfer()` 的返回值传递，而是写入调用者提供的 `buf`。**

硬件结束后，`rk3x_i2c_xfer_common()` 检查超时和控制器错误；没有错误时返回 `num`，否则返回负错误：

```c
if (timeout == 0) {
    /* 强制 STOP、恢复状态等处理省略 */
    ret = -ETIMEDOUT;
    break;
}

if (i2c->error) {
    ret = i2c->error;
    break;
}
/* ... */
return ret < 0 ? ret : num;
```

`ETIMEDOUT` 是超时错误码，前面的负号把它变成内核约定的负错误返回值。本例成功时返回 2，Core 把这个结果原路交给 `demo_read_reg()`。教学代码再把“完成两条消息”转换为 0；负错误继续返回给 `probe()`；若出现非 2 的非负结果，则转换为 `-EIO`。至此，输入、缓冲区变化和返回值形成完整闭环。

### 两个外设共享一条总线时，什么独立、什么共享

假设另一个传感器也挂在 I2C1 上，两个驱动几乎同时发起读取：

1. AT24C02 驱动在自己的栈上构造 `msgs_a[2]` 和缓冲区 `value_a`。
2. 传感器驱动在自己的栈上构造 `msgs_b[2]` 和缓冲区 `value_b`。
3. 两者的 client 不同，`addr` 可以不同；两者的 `client->adapter` 却指向同一个 I2C1 适配器。
4. Core 让一笔事务完成并释放总线锁后，另一笔事务才进入控制器，避免两组 START、地址和数据在线路上穿插。
5. RK3568 在每一轮设置中让 `i2c->msg` 指向当前消息，数据分别写回 `value_a` 或 `value_b`。

消息数组和数据缓冲区彼此独立，适配器、控制器寄存器与物理总线共享。Core 的串行化只保护总线事务，不理解外设业务状态；若两个访问者会修改同一芯片的配置，仍需由驱动统一协调。

---

## <span class="blue"> DTS 属性不能停在“给谁看”：继续跟到生效代码

前面的 `reg` 已经完成从 DTS 到 `client->addr` 的追踪。另外两个属性分别进入控制器分频和 AT24 写页边界，它们展示了设备树属性真正影响代码的方式。

### `clock-frequency` 怎样变成 RK3568 的分频设置

`rk3x_i2c_probe()` 调用 `i2c_parse_fw_timings()`。Core 在 `drivers/i2c/i2c-core-base.c` 中读取属性：

```c
i2c_parse_timing(dev, "clock-frequency", &t->bus_freq_hz,
                 I2C_MAX_STANDARD_MODE_FREQ, u);
```

`I2C_MAX_STANDARD_MODE_FREQ` 是属性缺失时可采用的 100 kHz 缺省频率，布尔参数 `u` 表示是否允许在属性缺失时采用缺省值；它不保存频率。本例显式给出 400000，因此板级 DTS 的 **`clock-frequency = <400000>`** 被保存为 `i2c->t.bus_freq_hz`。`rk3x_i2c_adapt_div()` 再让具体 SoC 的计算函数求出高低电平分频值，并写入寄存器：

```c
ret = i2c->soc_data->calc_timings(clk_rate, t, &calc);
/* 并发保护与 CON 设置省略 */
i2c_writel(i2c, (calc.div_high << 16) | (calc.div_low & 0xffff),
           REG_CLKDIV);
```

属性链为：**DTS 数值 → `t.bus_freq_hz` → `calc_timings()` → `REG_CLKDIV`**。400 kHz 是目标值，实际结果仍受控制器输入时钟、支持的模式和计算约束影响，不能用 DTS 数值绕过硬件能力。

### `pagesize` 怎样限制 AT24 单次写入

现在把教学节点换成使用内核现成 AT24 驱动的正式描述。它与前面的教学 `compatible` 是两种互斥选择，不要让两个驱动同时争用同一节点：

```dts title="正式节点示例 · 使用内核现成 AT24 驱动"
eeprom@50 {
    compatible = "atmel,24c02";
    reg = <0x50>;
    pagesize = <16>;
};
```

AT24C02 一页为 16 字节。若一次页写越过页尾，器件可能回绕到本页开头并覆盖已有数据，所以 **`pagesize`** 是硬件事实，不是性能调优值。binding 是设备树绑定规范，用来约定某类节点的属性和含义；Linux 的 `Documentation/devicetree/bindings/eeprom/at24.yaml` 规定该属性表示写页长度，未提供时驱动使用保守值 1。

`drivers/misc/eeprom/at24.c` 的 `at24_probe()` 读取并保存它：

```c
err = device_property_read_u32(dev, "pagesize", &page_size);
if (err)
    page_size = 1;            /* 未提供时退化为逐字节写 */
/* 其他资源初始化省略 */
at24->page_size = page_size;
```

`device_property_read_u32()` 是从设备固件描述中读取一个 32 位无符号属性的内核接口，成功返回 0，失败返回负错误。随后，`at24_adjust_write_count()` 在每次写入前缩短跨界部分：

```c
next_page = roundup(offset + 1, at24->page_size);
if (offset + count > next_page)
    count = next_page - offset;
```

`roundup(x, n)` 把 x 向上取整到 n 的整数倍。例如从页内偏移 14 写 4 字节，`roundup(14 + 1, 16)` 得到下一页边界 16，本次 `count` 被缩短为 2。剩余字节由后续写入处理，不会在同一次页写中回绕。属性链因此是：**`pagesize = <16>` → `device_property_read_u32()` → `at24->page_size` → 缩短跨界写入。**

现成 AT24 驱动的读取路径还经过 regmap。regmap 是内核为寄存器型设备提供的统一访问层，可处理总线差异、寄存器格式和缓存。本例相关路径为：

```text
at24_read()
    → at24_regmap_read()
    → regmap_bulk_read()
    → regmap_i2c_read()
    → i2c_transfer()
```

`drivers/base/regmap/regmap-i2c.c` 中的 `regmap_i2c_read()` 同样构造“写寄存器地址＋读数据”两条消息，并要求 `i2c_transfer()` 返回 2。教学驱动是为了展示框架而手写的简化入口，现成 AT24 驱动则在其上继续使用 regmap；两者不能混为同一份实现。

---

## <span class="blue"> `/dev/i2c-N`：从用户态交叉验证同一笔读取

并非每次寄存器验证都值得先写内核驱动。`i2c-dev` 可以把适配器导出为字符设备 `/dev/i2c-N`，让普通程序通过文件接口访问总线。N 是适配器编号，不能脱离具体板卡硬编码。

> 用户态：运行普通应用程序和命令行工具的环境。应用通过系统调用进入内核，而不是直接操作 SoC 的 I2C 控制器寄存器。

这条路径只绕过具体外设驱动，不绕过 Core 和控制器驱动：

1. `open("/dev/i2c-1", ...)` 选择 I2C1 适配器。
2. `ioctl(fd, I2C_SLAVE, 0x50)` 给后续访问设置 7 位外设地址。ioctl 是对设备文件执行特定控制操作的系统调用。
3. 需要“写存储地址后重复 START 再读”时，用 `I2C_RDWR` 一次提交两条 `i2c_msg`。普通 `write()` 后再 `read()` 是两次独立事务，中间会出现 STOP。

i2c-tools 是一组用户态 I2C 检测与访问工具，包括 `i2cdetect`、`i2cget` 等。在已知只连接可安全扫描器件的测试总线上，可以用它观察绑定前后的差别：

```bash
i2cdetect -y 1
insmod demo_i2c.ko
i2cdetect -y 1
```

绑定前，0x50 所在格可能显示 `50`；教学驱动绑定后，通常变为 `UU`。`UU` 表示该地址已有内核驱动占用，不是“芯片消失”。下面是只保留相关行的输出形状示例：

```text
# 绑定前
50: 50

# 绑定后
50: UU
```

若要在教学驱动未绑定时用 `i2cget` 读取同一地址，可执行：

```bash
rmmod demo_i2c
i2cget -y 1 0x50 0x10
```

输出形状为 `0x5a`，实际值仍取决于 EEPROM 内容。不要在内核驱动已经占用地址时强行绕过忙错误：Core 能串行化单笔总线事务，却不能保证应用和驱动对芯片状态的假设互不破坏。

B-B.3.4 展开 i2c-tools 和抓包排查，B-B.3.5 给出 `/dev/i2c-N`、`I2C_SLAVE`、`I2C_RDWR` 的完整 AT24C02 程序。本篇只确定用户态入口在框架中的位置及其与内核驱动的边界。

---

## <span class="blue"> GPIO 扩展器：I2C 驱动怎样把能力交给另一个子系统

到这里可以检查框架理解是否真正闭环。假设 SoC 原生 GPIO 已用完，但板上还需要一个外设复位脚。PCA9535 能通过 I2C 提供 16 路可配置输入或输出的引脚，软件不应让每个使用复位脚的驱动都直接读写 PCA9535 寄存器。

> GPIO：General-Purpose Input/Output，通用输入输出引脚。软件可把它配置为读取电平的输入，或输出高低电平。

<!-- -->

> GPIO 扩展器：通过另一套总线增加 GPIO 数量的芯片。主控先用 I2C 修改扩展器寄存器，扩展器再改变对应引脚电平。

pca953x 是 Linux 中支持 PCA9535 等同系列芯片的现成驱动。它在 `probe()` 中注册 `gpiochip`，也就是内核对“一组 GPIO”的统一描述；注册完成后，其他设备驱动通过 GPIO 子系统申请和控制引脚，不必知道它来自 SoC 还是 I2C 扩展器。

设备树先声明扩展器本身：

```dts
#include <dt-bindings/gpio/gpio.h>

&i2c1 {
    status = "okay";

    pca9535: pca9535@20 {
        compatible = "nxp,pca9535";
        reg = <0x20>;
        gpio-controller;
        #gpio-cells = <2>;
    };
};
```

这个节点同时进入 I2C 和 GPIO 两套框架：

- **`compatible` 与 `reg`**：仍走前面的 I2C 对象创建与匹配机制。
- **`gpio-controller`**：表示这个节点还能作为 GPIO 提供方被其他节点引用。
- **`#gpio-cells = <2>`**：每次引用要提供两个参数，即扩展器内的引脚编号和标志。
- **`pca9535`**：供其他节点引用的标签。

假设 PCA9535 的 P1_6 接某外设复位脚，该外设节点的 binding 又支持 `reset-gpios`，引用写成：

```dts
reset-gpios = <&pca9535 14 GPIO_ACTIVE_LOW>;
```

编号 14 来自两组各 8 路的排列：P0_0～P0_7 对应 0～7，P1_0～P1_7 对应 8～15，所以 P1_6 是 14。`GPIO_ACTIVE_LOW` 表示逻辑上的“有效”对应低电平；它不表示引脚永远输出低。驱动请求“使能有效”和“解除有效”时，GPIO 框架会按这个标志映射实际电平。

当另一个驱动操作复位脚时，调用链变成：

1. 外设驱动向 GPIO 子系统请求设置复位状态。
2. GPIO 子系统根据描述符找到 PCA9535 注册的 `gpiochip`。
3. pca953x 驱动修改方向或输出寄存器，经 I2C Core 和控制器驱动完成传输。
4. PCA9535 改变 P1_6 电平，目标外设看到复位状态变化。

一次电平操作要经过 I2C 传输，可能等待总线和调度，不能像内存映射的原生 GPIO 那样用于不能睡眠的执行上下文。pca953x 的 `gpio_chip.can_sleep` 正因这一点设为真。需要高频翻转或严格定时的信号，不应默认改用 I2C 扩展器。

> 不能睡眠的执行上下文：运行到此处时不能等待调度或可能阻塞的 I/O，例如部分硬中断处理路径。调用可能睡眠的 GPIO 操作会破坏内核调度约束。

PCA9535 还提供可选的 INT 引脚，即中断告警输出。需要把扩展输入的变化通知 SoC 时，还要在设备树和驱动中接入中断控制器路径；只使用低速输入输出时，不必额外配置这条路径。

---

## <span class="blue"> 本节总结

Linux I2C 框架的关键不是记住对象名单，而是能沿一笔读取说明状态放在哪里：`client` 保存外设地址和所属总线，消息保存本次数据与方向，适配器通过方法表找到控制器，RXFIFO 的字节最终写回调用者缓冲区。裸驱动中的寄存器操作并未消失，而是由控制器驱动集中实现，外设驱动因此可以复用。

设备树属性也必须跟到消费代码才有意义：地址进入 client，频率进入分频计算，页大小进入写边界。`/dev/i2c-N` 适合受控验证，产品功能则应由统一驱动协调外设状态。普通 I2C 外设怎样复用 SMBus 事务，以及 PMBus 怎样解释电源数据，继续在 B-B.3.6 展开。

**速查表**

| 项目 | 应抓住的含义 |
|:---|:---|
| `i2c_adapter` | 一条可访问的 I2C 总线，保存控制器方法与编号 |
| `i2c_client` | 一颗外设对象，`addr` 找设备，`adapter` 找总线 |
| `i2c_driver` | 处理外设的代码，含匹配表、`probe()`、`remove()` |
| `i2c_msg` | 一段同地址、同方向的数据消息；复合事务可含多条 |
| `i2c_algorithm` | 控制器提供的方法表，普通传输进入 `master_xfer()` |
| 控制器 `reg` | SoC 内部寄存器物理地址窗口，由厂商 dtsi 提供 |
| 外设 `reg` | 7 位 I2C 地址，经 Core 进入 `client->addr` |
| `i2c_transfer()` | 返回负错误或完成消息数；本例两条消息成功返回 2 |
| `clock-frequency` | 经 `i2c_parse_fw_timings()` 和分频计算进入控制器设置 |
| `pagesize` | 经 `at24->page_size` 限制单次写不跨页 |
| `/dev/i2c-N` | i2c-dev 用户态入口；复合事务用 `I2C_RDWR` |
| PCA9535 | 16 路 I2C GPIO 扩展；注册 `gpiochip`，操作可能睡眠 |

---

## <span class="blue"> 本节自查

??? details "Q1. 裸驱动中的寄存器操作，在 Linux 通用 I2C 框架里去了哪里？"
    寄存器操作集中到控制器驱动。AT24C02 驱动只提交“写存储地址再读数据”的消息，Core 经适配器的方法表调用 RK3568 的 `rk3x_i2c_xfer()`，后者再操作寄存器、FIFO 和中断。外设驱动不需要包含 RK3568 的寄存器细节。

??? details "Q2. `reg = <0x50>` 怎样变成教学驱动中的 `client->addr`？"
    `of_i2c_register_devices()` 扫描控制器子节点，`of_property_read_u32(node, "reg", &addr)` 读取 0x50，先保存到 `info.addr`，再由 `i2c_new_client_device()` 写入 `client->addr`。匹配成功后，Core 把这个 client 传给 `demo_probe()`。

??? details "Q3. 为什么本例要用一次两条消息的 `i2c_transfer()`，不能拆成一次写和一次读？"
    两条消息在同一次传输中通过重复 START 切换方向，并在整组结束后才发 STOP。拆成两个独立接口会形成两笔事务，中间出现 STOP，不再等同于 AT24C02 要求的复合读取。

??? details "Q4. 从 `rk3x_i2c_setup()` 到 `demo_read_reg()` 返回，数据和返回值分别怎样流动？"
    `rk3x_i2c_setup()` 识别短写加读，让 `i2c->msg` 指向第二条消息；`rk3x_i2c_handle_read()` 从 RXFIFO 取字节并写入 `i2c->msg->buf`，即教学驱动的 `value`。`rk3x_i2c_xfer_common()` 成功返回消息数 2，Core 原路返回 2，教学代码据此返回 0；负错误则直接向上传播。

??? details "Q5. 两个外设同时访问 I2C1 时，哪些状态独立，哪些状态共享？"
    两个驱动各自拥有消息数组和数据缓冲区，各自的 client 保存自己的地址；它们共享同一个适配器、控制器寄存器和物理总线。Core 串行化两笔事务，避免波形穿插，但不会替两个访问者协调同一芯片的业务状态。

??? details "Q6. `pagesize = <16>` 为什么能防止 AT24C02 页写回绕？"
    `at24_probe()` 用 `device_property_read_u32()` 读取 16 并保存到 `at24->page_size`。`at24_adjust_write_count()` 根据它计算下一页边界并缩短跨界写入，例如从页内偏移 14 写 4 字节时，本次只写 2 字节，剩余部分留到后续写入。

??? details "Q7. `i2cdetect` 中地址从 `50` 变成 `UU` 表示什么？为什么不能强行让应用与驱动同时操作？"
    `50` 表示扫描时该地址有响应，`UU` 表示地址已有内核驱动占用。Core 只能串行化单笔总线事务，不能理解应用与驱动各自对芯片状态的假设；强行并行访问仍可能破坏配置和数据一致性。

??? details "Q8. 其他驱动使用 PCA9535 的复位脚时，为什么还要经过 I2C？调用上下文有什么限制？"
    其他驱动只向 GPIO 子系统提交逻辑电平请求，pca953x 再把请求转换成扩展器寄存器读写，所以底层仍要发起 I2C 事务。总线访问可能阻塞和睡眠，因此这类 GPIO 不能用于不允许睡眠的执行上下文，也不适合高频严格定时信号。
