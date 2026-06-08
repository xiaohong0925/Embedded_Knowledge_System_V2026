# B-A.2.3 I2C Linux驱动框架与SMBus [知识点277-278]

> 所属章节：第五部 B. 总线协议 > B-A.2 I2C总线
>
> 难度：[I][M] | 预计阅读时间：45分钟

## <span class="blue"> 本节导读

上一节我们把I2C的硬件时序啃明白了——起始位、ACK、7位地址，那些波形终于不在脑子里打架了。但有个灵魂问题还没解决：**怎么在Linux里让I2C真正跑起来？**

想象一下这个场景：你手里有一块AM335x开发板，I2C0总线上挂了EEPROM（AT24C256）和温度传感器（TMP102）。硬件连好了，上电后i2cdetect能看到地址，然后呢？怎么写驱动？怎么在用户空间读写？SMBus又是啥，跟I2C啥关系？PCA9535 GPIO扩展器怎么配设备树？

这一节我们把这些问题一网打尽。读完你会掌握：Linux I2C子系统的三层架构、核心API的使用姿势、SMBus的特性和陷阱、GPIO扩展器的配置方法，以及一个完整的EEPROM+温度传感器行业实例——从设备树到驱动代码到用户空间验证，端到端跑通。

<br>

## <span class="blue"> 知识点277 [I][M] — Linux I2C子系统三层架构

Linux的I2C子系统采用经典的三层架构设计，跟前面讲的platform驱动框架思路一脉相承。理解这三层的分工，是你写I2C驱动的第一步。

### 三层架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     用户空间 (User Space)                      │
│   /dev/i2c-0    i2c-dev    /sys/bus/i2c/devices/            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  I2C Client │  │  I2C Client │  │    I2C Client       │  │
│  │  (at24.ko)  │  │  (tmp102.ko)│  │  (pca9535.ko)       │  │
│  │  设备驱动层  │  │  设备驱动层  │  │    设备驱动层        │  │
│  ├─────────────┤  ├─────────────┤  ├─────────────────────┤  │
│  │i2c_driver{} │  │i2c_driver{} │  │   i2c_driver{}      │  │
│  │probe/remove │  │probe/remove │  │   probe/remove      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
├─────────┼────────────────┼────────────────────┼─────────────┤
│         │                I2C Core (核心层)      │             │
│  ┌──────▼────────────────▼────────────────────▼──────┐       │
│  │         i2c_transfer() / i2c_smbus_*()           │       │
│  │    i2c_adapter注册管理 / i2c_client匹配          │       │
│  │        内核路径：drivers/i2c/i2c-core.c          │       │
│  └──────────────────────┬───────────────────────────┘       │
├─────────────────────────┼───────────────────────────────────┤
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           I2C Adapter (总线控制器驱动层)               │    │
│  │                                                     │    │
│  │   i2c_adapter{} → i2c_algorithm{} → master_xfer()  │    │
│  │                                                     │    │
│  │   SoC I2C控制器驱动：omap2_i2c / i2c-bcm2835        │    │
│  │   内核路径：drivers/i2c/busses/                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                         ▼                                   │
│                    硬件 (I2C Controller)                     │
└─────────────────────────────────────────────────────────────┘
```

**核心思想**：I2C Core是中间人，对上提供统一的API给设备驱动调用，对下管理所有I2C Adapter。设备驱动不用关心底层是哪个SoC的I2C控制器，Adapter也不用关心上面挂了多少种设备。

<br>

### 三层架构详解表格

| 层级 | 职责 | 关键结构体 | 内核代码路径 | 类比 |
|------|------|-----------|-------------|------|
| **I2C Core** | 提供核心API、管理adapter/client注册、匹配device tree | 无（纯逻辑层） | `drivers/i2c/i2c-core-*.c` | 操作系统内核 |
| **I2C Adapter** | 驱动SoC的I2C控制器，实现具体的总线操作 | `struct i2c_adapter`, `struct i2c_algorithm` | `drivers/i2c/busses/` | 主板上的I2C接口芯片 |
| **I2C Client** | 驱动具体的I2C外设（EEPROM、传感器等） | `struct i2c_client`, `struct i2c_driver` | `drivers/*/`* | 插在I2C上的设备 |

> 💡 **提示**：你在写驱动时，99%的时间都在跟**I2C Client层**打交道。Adapter层一般由SoC厂商提供（TI的omap_i2c、NXP的i2c-imx等），除非你在移植新平台，否则不需要碰。

<br>

### 关键结构体详解

#### struct i2c_adapter —— 总线控制器的化身

```c
struct i2c_adapter {
    struct module *owner;
    unsigned int class;           /* 允许的设备类型 */
    const struct i2c_algorithm *algo;  /* 总线操作算法 */
    void *algo_data;
    struct device dev;            /* 内嵌device */
    int nr;                       /* 总线编号，如i2c-0 */
    char name[48];
    ...
};
```

每个SoC的I2C控制器（比如AM335x有3个I2C控制器）对应一个`i2c_adapter`实例。你在用户空间看到的`/dev/i2c-0`，就是`nr=0`的那个adapter。

#### struct i2c_algorithm —— 算法 = 实际干活的方法

```c
struct i2c_algorithm {
    /* 最重要的函数：执行I2C传输 */
    int (*master_xfer)(struct i2c_adapter *adap,
                       struct i2c_msg *msgs, int num);
    /* SMBus快速路径 */
    int (*smbus_xfer)(struct i2c_adapter *adap, u16 addr,
                      unsigned short flags, char read_write,
                      u8 command, int size, union i2c_smbus_data *data);
    /* 查询adapter支持的功能 */
    u32 (*functionality)(struct i2c_adapter *);
};
```

> 💡 **提示**：`master_xfer`是"万能函数"，理论上所有I2C操作都能通过它实现。`smbus_xfer`是可选优化路径，专门给SMBus协议用，很多传感器驱动走这条道更快。

#### struct i2c_client —— 挂在总线上的设备

```c
struct i2c_client {
    unsigned short flags;
    unsigned short addr;          /* I2C从机地址，7位 */
    char name[I2C_NAME_SIZE];
    struct i2c_adapter *adapter;  /* 所属总线 */
    struct device dev;            /* 内嵌device */
    int irq;                      /* 如果设备有中断 */
    ...
};
```

#### struct i2c_driver —— 你的设备驱动

```c
struct i2c_driver {
    int (*probe)(struct i2c_client *client,
                 const struct i2c_device_id *id);
    int (*remove)(struct i2c_client *client);
    struct device_driver driver;
    const struct i2c_device_id *id_table;
    /* 设备树匹配表 */
    const struct of_device_id *of_match_table;
};
```

<br>

### 设备树i2c节点配置

I2C总线在设备树里的配置套路很固定。看一个完整的AM335x I2C0例子：

```dts
/* arch/arm/boot/dts/am335x-boneblack.dts (节选) */

&i2c0 {                          /* 引用SoC dtsi中定义的i2c0节点 */
    pinctrl-names = "default";
    pinctrl-0 = <&i2c0_pins>;    /* 引脚复用配置 */
    clock-frequency = <400000>;   /* 总线频率：400kHz Fast Mode */
    status = "okay";              /* 使能 */

    /* 子节点1：EEPROM */
    eeprom@50 {
        compatible = "atmel,24c256";
        reg = <0x50>;             /* I2C从机地址 */
        pagesize = <64>;          /* 页写大小：64字节 */
        size = <32768>;           /* 总容量：32KB */
        status = "okay";
    };

    /* 子节点2：温度传感器 */
    tmp102@48 {
        compatible = "ti,tmp102";
        reg = <0x48>;
        status = "okay";
    };

    /* 子节点3：GPIO扩展器 */
    pca9535@20 {
        compatible = "nxp,pca9535";
        reg = <0x20>;
        gpio-controller;          /* 声明这是一个gpio控制器 */
        #gpio-cells = <2>;        /* 引用时需要2个参数：pin+flags */
        status = "okay";
    };
};
```

> 💡 **提示**：`clock-frequency`默认100kHz（Standard Mode），如果你的设备都支持Fast Mode，改成400kHz能明显提升吞吐。但别盲目上400kHz——总线长了、上拉电阻大了，波形可能畸变。

<br>

### i2c_msg —— 一次传输的基本单元

```c
struct i2c_msg {
    __u16 addr;      /* 从机地址 */
    __u16 flags;     /* 标志位：I2C_M_RD读方向等 */
    __u16 len;       /* buf长度 */
    __u8 *buf;       /* 数据缓冲区 */
};
```

一次`i2c_transfer()`可以传多个`i2c_msg`，这在做"写寄存器地址+读数据"这种复合操作时特别有用。后面EEPROM的例子里会展示。

<br>

## <span class="blue"> 知识点278 [I] — I2C核心API与驱动注册流程

知道结构体长啥样还不够，关键是**怎么用**。这一节把最常用的API和驱动注册流程讲清楚。

### 核心API速查表

| 函数 | 功能 | 关键参数 | 返回值 |
|------|------|---------|--------|
| `i2c_transfer(adapter, msgs, num)` | 通用I2C传输（支持多msg） | `i2c_msg[]`, msg数量 | 成功返回msg数量，失败负值 |
| `i2c_master_send(client, buf, count)` | 向设备发送数据 | client指针, 数据buf, 长度 | 成功返回字节数 |
| `i2c_master_recv(client, buf, count)` | 从设备接收数据 | client指针, 接收buf, 长度 | 成功返回字节数 |
| `i2c_smbus_read_byte(client)` | SMBus读1字节（无寄存器地址） | client指针 | 成功返回0-255，失败负值 |
| `i2c_smbus_write_byte(client, value)` | SMBus写1字节 | client指针, 数据值 | 成功返回0 |
| `i2c_smbus_read_byte_data(client, cmd)` | SMBus读字节（cmd=寄存器地址） | client, 寄存器地址 | 成功返回寄存器值 |
| `i2c_smbus_write_byte_data(client, cmd, value)` | SMBus写字节 | client, 寄存器, 数据 | 成功返回0 |
| `i2c_smbus_read_word_data(client, cmd)` | SMBus读16位 | client, 寄存器 | 成功返回16位值 |
| `i2c_smbus_read_i2c_block_data(client, cmd, len, buf)` | I2C块读（最多32字节） | client, 寄存器, 长度, buf | 成功返回读取字节数 |
| `i2c_smbus_write_i2c_block_data(client, cmd, len, buf)` | I2C块写（最多32字节） | client, 寄存器, 长度, buf | 成功返回0 |
| `i2c_smbus_read_block_data(client, cmd, buf)` | SMBus块读（PEC校验，最多32字节） | client, 寄存器, buf | 成功返回字节数 |
| `i2c_check_functionality(adapter, func)` | 检查adapter是否支持某功能 | adapter, 功能标志 | 支持返回非0 |

> 💡 **提示**：简单寄存器读写优先用`smbus`系列函数——代码短、出错概率低。复杂的多阶段传输（如EEPROM的"写地址+读数据"）用`i2c_transfer()`更灵活。

<br>

### 驱动注册完整流程

```
┌──────────────────────────────────────────────────────────┐
│  ① 内核解析设备树i2c节点                                  │
│     → 为每个子节点创建 i2c_client 结构体                   │
│     → client->addr = reg属性值                             │
├──────────────────────────────────────────────────────────┤
│  ② i2c_driver注册                                         │
│     i2c_add_driver() / module_i2c_driver()                │
│     → driver->of_match_table 与 client 匹配               │
├──────────────────────────────────────────────────────────┤
│  ③ 匹配成功 → 调用 probe()                                │
│     → i2c_check_functionality() 检查adapter能力            │
│     → 初始化设备（配置寄存器等）                            │
│     → 注册字符设备 / sysfs / input子系统 等                │
├──────────────────────────────────────────────────────────┤
│  ④ 运行期：用户空间通过read/write/ioctl访问               │
│     → 驱动中调用 i2c_transfer / i2c_smbus_* 读写硬件      │
├──────────────────────────────────────────────────────────┤
│  ⑤ 卸载 → 调用 remove()                                   │
│     → 注销已注册的资源                                      │
│     → 释放内存、关闭电源                                    │
└──────────────────────────────────────────────────────────┘
```

<br>

### 驱动代码框架：probe/remove/读写

下面是一个完整的I2C设备驱动框架，以TMP102温度传感器为例：

```c
/* tmp102_demo.c — 简化的TMP102 I2C驱动框架 */
#include <linux/module.h>
#include <linux/i2c.h>
#include <linux/hwmon.h>
#include <linux/hwmon-sysfs.h>

/* TMP102寄存器定义 */
#define TMP102_REG_TEMP         0x00    /* 温度寄存器（只读） */
#define TMP102_REG_CONFIG       0x01    /* 配置寄存器 */

struct tmp102_data {
    struct i2c_client *client;
    struct mutex lock;
};

/* ───── probe() ───── */
static int tmp102_probe(struct i2c_client *client,
                        const struct i2c_device_id *id)
{
    struct tmp102_data *data;
    int ret;

    /* Step 1: 检查adapter能力 — 这是好习惯 */
    if (!i2c_check_functionality(client->adapter,
                                 I2C_FUNC_SMBUS_READ_WORD_DATA)) {
        dev_err(&client->dev, "SMBus read word not supported\n");
        return -EIO;
    }

    /* Step 2: 分配私有数据结构 */
    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;

    mutex_init(&data->lock);
    data->client = client;
    i2c_set_clientdata(client, data);

    /* Step 3: 验证设备ID — 读配置寄存器 */
    ret = i2c_smbus_read_word_data(client, TMP102_REG_CONFIG);
    if (ret < 0) {
        dev_err(&client->dev, "Failed to read config: %d\n", ret);
        return ret;
    }
    dev_info(&client->dev, "TMP102 config = 0x%04x\n", ret);

    /* Step 4: 注册hwmon子系统（温度传感器标准接口） */
    /* 实际驱动中这里会注册hwmon_device_register_with_groups() */
    /* 简化示例省略此步骤 */

    dev_info(&client->dev, "TMP102 probed at 0x%02x\n", client->addr);
    return 0;
}

/* ───── remove() ───── */
static int tmp102_remove(struct i2c_client *client)
{
    struct tmp102_data *data = i2c_get_clientdata(client);

    /* 清理资源 — devm_kzalloc分配的内存自动释放 */
    mutex_destroy(&data->lock);
    dev_info(&client->dev, "TMP102 removed\n");
    return 0;
}

/* ───── 读取温度函数 ───── */
static int tmp102_read_temperature(struct i2c_client *client)
{
    int ret;

    /* TMP102温度寄存器：12bit有符号，LSB = 0.0625°C */
    ret = i2c_smbus_read_word_data(client, TMP102_REG_TEMP);
    if (ret < 0)
        return ret;

    /* TMP102是小端格式，需要交换字节 */
    ret = swab16(ret);

    /* 右移4位取12bit有效值，然后乘625得到毫摄氏度 */
    ret >>= 4;
    if (ret & 0x800)  /* 负数处理 */
        ret -= 4096;

    return ret * 625 / 100;  /* 返回毫摄氏度 */
}

/* ───── 设备树匹配表 ───── */
static const struct of_device_id tmp102_of_match[] = {
    { .compatible = "ti,tmp102" },
    { },
};
MODULE_DEVICE_TABLE(of, tmp102_of_match);

/* ───── i2c_device_id表（非设备树平台用） ───── */
static const struct i2c_device_id tmp102_id[] = {
    { "tmp102", 0 },
    { }
};
MODULE_DEVICE_TABLE(i2c, tmp102_id);

/* ───── i2c_driver结构体 ───── */
static struct i2c_driver tmp102_driver = {
    .driver = {
        .name = "tmp102",
        .of_match_table = tmp102_of_match,
    },
    .probe = tmp102_probe,
    .remove = tmp102_remove,
    .id_table = tmp102_id,
};

/* 自动注册宏 */
module_i2c_driver(tmp102_driver);

MODULE_AUTHOR("Your Name");
MODULE_DESCRIPTION("TMP102 Temperature Sensor Driver (Demo)");
MODULE_LICENSE("GPL");
```

<br>

> 💡 **提示**：`i2c_check_functionality()`不是摆设！它能在probe阶段就告诉你adapter支不支持SMBus word read。如果返回不支持，早点返回`-EIO`比后面莫名其妙地`EIO`要强一百倍。常用的功能标志还有`I2C_FUNC_I2C`（基础I2C）、`I2C_FUNC_SMBUS_BYTE_DATA`（字节读写）、`I2C_FUNC_SMBUS_I2C_BLOCK`（块传输）。

<br>

## <span class="blue"> SMBus vs I2C差异与应用 [I]

SMBus（System Management Bus）是从I2C衍生出来的子集，由Intel在1995年定义。它加了些规则让通信更可靠，但也限制了一些灵活性。在PC和服务器领域，SMBus无处不在。

### SMBus与I2C对比表

| 维度 | SMBus | I2C | 差异说明 |
|------|-------|-----|---------|
| **电气规范** | 基于I2C，逻辑阈值固定 | 有多种逻辑电平 | SMBus要求固定Vil=0.8V,Vih=2.1V |
| **时钟频率** | 10-100kHz | 100kHz-3.4MHz+ | SMBus最高100kHz，I2C可更快 |
| **超时限制** | **35ms时钟低电平超时** | 无强制超时 | SMBus从机必须在35ms内释放时钟 |
| **数据保持** | 规定最小300ns | 无强制要求 | SMBus保证更稳定的数据采样 |
| **PEC校验** | **可选CRC-8校验** | 无 | SMBus命令可用PEC检测传输错误 |
| **块传输** | **Block Read/Write**，最大32字节 | 协议上无限制 | SMBus块传有长度字节+PEC |
| **ALERT#** | **专用中断线** | 无 | SMBus设备可通过ALERT发中断 |
| **Address Resolution** | 支持SMBus ARP | 无 | 动态地址分配 |
| **应用场景** | PC温度传感器、电池管理、电源管理 | 通用嵌入式外设 | SMBus偏系统管理，I2C更通用 |

> ⚠️ **陷阱**：SMBus的35ms超时是**硬性规定**。如果你的I2C从机在时钟低电平时拉低超过35ms，SMBus控制器会判定超时并终止传输。这在调试EEPROM写周期时要特别注意——AT24C256的页写周期最大5ms，没问题，但有些Flash EEPROM写周期可能长达10ms，得确认清楚。

<br>

### SMBus协议操作码

SMBus定义了固定的协议格式，Linux内核里每个都有对应的API：

```
┌─────────────────────────────────────────────────────────────┐
│  Quick Command      : S|Addr+R/W|Ack|P                     │
│  i2c_smbus_xfer(client, 0, 0, read_write, 0, I2C_SMBUS_QUICK, NULL)
│                                                             │
│  Send/Recv Byte     : S|Addr|Ack|Data|Ack|P               │
│  i2c_smbus_read_byte() / i2c_smbus_write_byte()            │
│                                                             │
│  Read/Write Byte    : S|Addr|Ack|Cmd|Ack|Data|Ack|P       │
│  i2c_smbus_read_byte_data() / i2c_smbus_write_byte_data()  │
│                                                             │
│  Read/Write Word    : S|Addr|Ack|Cmd|Ack|DataL|Ack|DataH|Ack|P
│  i2c_smbus_read_word_data() / i2c_smbus_write_word_data()  │
│                                                             │
│  Block Read         : S|Addr|Ack|Cmd|Ack|Count|Data[0..N]|PEC|P
│  i2c_smbus_read_block_data()  ← 带PEC校验                  │
│  i2c_smbus_read_i2c_block_data()  ← 不带PEC，I2C块读       │
│                                                             │
│  Block Write        : S|Addr|Ack|Cmd|Ack|Count|Data[0..N]|PEC|P
│  i2c_smbus_write_block_data() / i2c_smbus_write_i2c_block_data()
└─────────────────────────────────────────────────────────────┘
```

<br>

### SMBus在实际产品中的应用

1. **PC主板温度监控**：LM75/TMP75等温度传感器挂在SMBus上，BIOS通过SMBus读CPU温度决定风扇转速。
2. **笔记本电池管理（Smart Battery）**：符合Smart Battery Specification的电池，通过SMBus跟主板通信——报告电量、电压、充放电状态。
3. **服务器电源管理**：PSU（电源）通过PMBus（SMBus的扩展）报告功率、温度、风扇转速。

> ⚠️ **陷阱**：SMBus Block Read最大只支持**32字节**——这是SMBus协议规定的硬限制。如果你需要读超过32字节的数据（比如从EEPROM读一页64字节），不要用`smbus_read_block_data()`，它会失败。正确做法是用`i2c_transfer()`构造两个`i2c_msg`：第一个msg写内存地址，第二个msg读数据，长度自由设定。

<br>

## <span class="blue"> I2C GPIO扩展器 [I]

做嵌入式开发最尴尬的事之一：GPIO引脚不够用了。I2C GPIO扩展器是性价比极高的解决方案——两根线（SDA/SCL）扩展出8个甚至16个GPIO，代价仅仅是I2C总线上多了几十微秒的延迟。

### 常见I2C GPIO扩展器对比

| 型号 | 位数 | I2C地址 | 特点 | 内核驱动 | 典型应用 |
|------|------|---------|------|---------|---------|
| **PCF8574** | 8 | 0x20-0x27（3位A引脚） | 准双向IO，无上拉电阻配置，最简单 | `gpio-pcf857x` | 简单LED/按键扩展 |
| **PCF8574A** | 8 | 0x38-0x3F | 同上，地址范围不同 | `gpio-pcf857x` | 地址冲突时备选 |
| **PCA9535** | 16 | 0x20-0x27 | 真正双向IO，独立方向寄存器，可配置上拉 | `gpio-pca953x` | 复杂IO需求 |
| **PCA9555** | 16 | 0x20-0x27 | 类似PCA9535，推挽输出 | `gpio-pca953x` | 需要强驱动输出 |
| **MCP23017** | 16 | 0x20-0x27 | 带中断输出(INT)，可配上升/下降沿 | `gpio-mcp23s08` | 需要IO中断的场景 |

> 💡 **提示**：选GPIO扩展器的核心决策点是——**需要中断吗？** 如果扩展的GPIO需要响应中断（比如按键），选带`INT`引脚的MCP23017。如果只是控制LED或者输出信号，PCA9535性价比最高。

<br>

### PCA9535设备树配置

```dts
&i2c1 {
    pinctrl-names = "default";
    pinctrl-0 = <&i2c1_pins>;
    clock-frequency = <400000>;
    status = "okay";

    pca9535: gpio@20 {
        compatible = "nxp,pca9535";
        reg = <0x20>;
        gpio-controller;
        #gpio-cells = <2>;        /* <pin_number flags> */
        gpio-line-names = "LED_R", "LED_G", "LED_B", "BTN_1",
                          "BTN_2", "RELAY_1", "RELAY_2", "BUZZER",
                          "IO_8", "IO_9", "IO_10", "IO_11",
                          "IO_12", "IO_13", "IO_14", "IO_15";

        /* 中断配置（可选，PCA9535有INT引脚） */
        interrupt-parent = <&gpio0>;
        interrupts = <27 IRQ_TYPE_EDGE_FALLING>;
        interrupt-controller;
        #interrupt-cells = <2>;

        /* 用扩展GPIO控制的其他设备 */
        status = "okay";
    };
};

/* 在其他设备树位置引用扩展GPIO */
&some_other_device {
    reset-gpios = <&pca9535 6 GPIO_ACTIVE_LOW>;   /* PCA9535的IO6 */
};
```

<br>

## <span class="blue"> 行业实例：AT24C256 EEPROM + TMP102温度传感器

这个实例端到端演示：设备树配置 → 驱动probe → 用户空间读写 → 命令行验证。假设平台为AM335x BeagleBone Black，I2C0总线。

### 硬件接线

```
BeagleBone Black (P9 Header)
┌─────────────────────────────┐
│  P9_17 (I2C1_SCL) ──┬──────┼──→ AT24C256 SCL
│  P9_18 (I2C1_SDA) ──┼──┬───┼──→ AT24C256 SDA
│  3.3V  ─────────────┼──┼───┼──→ VCC (两设备)
│  GND   ─────────────┼──┼───┼──→ GND (两设备)
│                     │  │   │
│                     │  │   └── TMP102 SDA
│                     │  └────── TMP102 SCL
│                     └───────── 4.7KΩ上拉电阻 → 3.3V
└─────────────────────────────┘

AT24C256: A0=A1=A2=GND → 地址 = 0b1010000 = 0x50
TMP102:   ADDR=GND     → 地址 = 0b1001000 = 0x48
```

<br>

### 完整设备树配置

```dts
/* am335x-boneblack-custom.dts */

#include "am335x-boneblack.dts"

&i2c1 {                          /* BeagleBone的I2C1 = P9_17/18 */
    pinctrl-names = "default";
    pinctrl-0 = <&i2c1_pins>;
    clock-frequency = <100000>;   /* EEPROM用100kHz更稳 */
    status = "okay";

    /* AT24C256 EEPROM: 32KB, 64字节页, 地址0x50 */
    eeprom@50 {
        compatible = "atmel,24c256";
        reg = <0x50>;
        pagesize = <64>;          /* 关键参数！AT24C256每页64字节 */
        size = <32768>;           /* 32KB = 256Kbit */
        address-width = <16>;     /* 内存地址用16位 */
        status = "okay";
    };

    /* TMP102温度传感器: 12bit, 地址0x48, SMBus兼容 */
    tmp102@48 {
        compatible = "ti,tmp102";
        reg = <0x48>;
        status = "okay";
    };
};
```

> 💡 **提示**：`at24`驱动是**内核自带的**（`drivers/misc/eeprom/at24.c`），你**不需要写任何驱动代码**！只要在设备树里配好compatible、pagesize、size、address-width，内核启动时at24驱动会自动probe，并在sysfs里创建`/sys/bus/i2c/devices/1-0050/eeprom`文件。直接读这个文件就行。这是设备树+驱动分离思想的典型体现。

<br>

### EEPROM驱动读写代码（教学用，演示i2c_transfer用法）

虽然at24驱动已内置，但为了理解底层机制，看一个手动读写AT24C256的示例：

```c
/* at24_demo.c — 演示AT24C256的手动读写 */
#include <linux/module.h>
#include <linux/i2c.h>
#include <linux/fs.h>
#include <linux/cdev.h>
#include <linux/uaccess.h>

#define AT24_PAGE_SIZE   64
#define AT24_TOTAL_SIZE  32768
#define DEVICE_NAME      "at24demo"

struct at24_data {
    struct i2c_client *client;
    struct cdev cdev;
    dev_t devno;
};

/* ───── 核心读写函数 ───── */

/* 写AT24C256：需要先发2字节内存地址，再发数据 */
static int at24_write_page(struct at24_data *at24, u16 mem_addr,
                           const u8 *buf, size_t len)
{
    struct i2c_client *client = at24->client;
    u8 txbuf[AT24_PAGE_SIZE + 2];  /* 2字节地址 + 数据 */
    struct i2c_msg msg;
    int ret;

    if (len > AT24_PAGE_SIZE)
        len = AT24_PAGE_SIZE;

    /* 组装：高地址字节 + 低地址字节 + 数据 */
    txbuf[0] = (mem_addr >> 8) & 0xFF;
    txbuf[1] = mem_addr & 0xFF;
    memcpy(&txbuf[2], buf, len);

    msg.addr = client->addr;
    msg.flags = 0;              /* 写方向 */
    msg.len = len + 2;
    msg.buf = txbuf;

    ret = i2c_transfer(client->adapter, &msg, 1);
    if (ret != 1)
        return (ret < 0) ? ret : -EIO;

    /* AT24C256需要5ms内部写周期 */
    msleep(5);
    return len;
}

/* 读AT24C256：写2字节地址 → 重启 → 读数据 */
static int at24_read_data(struct at24_data *at24, u16 mem_addr,
                          u8 *buf, size_t len)
{
    struct i2c_client *client = at24->client;
    u8 addr_buf[2];
    struct i2c_msg msgs[2];

    /* msg[0]: 写内存地址 */
    addr_buf[0] = (mem_addr >> 8) & 0xFF;
    addr_buf[1] = mem_addr & 0xFF;
    msgs[0].addr = client->addr;
    msgs[0].flags = 0;          /* 写方向 */
    msgs[0].len = 2;
    msgs[0].buf = addr_buf;

    /* msg[1]: 读数据 */
    msgs[1].addr = client->addr;
    msgs[1].flags = I2C_M_RD;   /* 读方向 */
    msgs[1].len = len;
    msgs[1].buf = buf;

    return (i2c_transfer(client->adapter, msgs, 2) == 2) ? len : -EIO;
}

/* ───── probe/remove ───── */
static int at24_probe(struct i2c_client *client,
                      const struct i2c_device_id *id)
{
    struct at24_data *at24;

    if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))
        return -EIO;

    at24 = devm_kzalloc(&client->dev, sizeof(*at24), GFP_KERNEL);
    if (!at24)
        return -ENOMEM;

    at24->client = client;
    i2c_set_clientdata(client, at24);

    /* 简单测试：读前4字节 */
    u8 test_buf[4];
    if (at24_read_data(at24, 0, test_buf, 4) == 4)
        dev_info(&client->dev, "EEPROM first 4 bytes: %*ph\n", 4, test_buf);

    dev_info(&client->dev, "AT24C256 ready (32KB @ 0x%02x)\n", client->addr);
    return 0;
}

static int at24_remove(struct i2c_client *client)
{
    dev_info(&client->dev, "AT24C256 removed\n");
    return 0;
}

static const struct of_device_id at24_of_match[] = {
    { .compatible = "atmel,24c256" },
    { }
};
MODULE_DEVICE_TABLE(of, at24_of_match);

static const struct i2c_device_id at24_id[] = {
    { "24c256", 0 },
    { }
};
MODULE_DEVICE_TABLE(i2c, at24_id);

static struct i2c_driver at24_driver = {
    .driver = {
        .name = "at24demo",
        .of_match_table = at24_of_match,
    },
    .probe = at24_probe,
    .remove = at24_remove,
    .id_table = at24_id,
};

module_i2c_driver(at24_driver);
MODULE_LICENSE("GPL");
```

<br>

### 用户空间代码：读写EEPROM + 读取温度

```c
/* i2c_user_demo.c — 用户空间I2C操作示例 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>

#define I2C_BUS     "/dev/i2c-1"
#define EEPROM_ADDR 0x50
#define TMP102_ADDR 0x48

/* ───── 通用I2C读写函数 ───── */
int i2c_read_reg(int fd, unsigned char addr, unsigned char reg,
                 unsigned char *buf, size_t len)
{
    struct i2c_msg msgs[2];
    struct i2c_rdwr_ioctl_data xfer;

    msgs[0].addr = addr;
    msgs[0].flags = 0;
    msgs[0].len = 1;
    msgs[0].buf = &reg;

    msgs[1].addr = addr;
    msgs[1].flags = I2C_M_RD;
    msgs[1].len = len;
    msgs[1].buf = buf;

    xfer.msgs = msgs;
    xfer.nmsgs = 2;

    return ioctl(fd, I2C_RDWR, &xfer);
}

int i2c_write_reg(int fd, unsigned char addr, unsigned char reg,
                  unsigned char *buf, size_t len)
{
    /* 简单写：1字节寄存器地址 + 数据 */
    unsigned char txbuf[33];  /* 1 + 最多32字节 */
    struct i2c_msg msg;
    struct i2c_rdwr_ioctl_data xfer;

    txbuf[0] = reg;
    memcpy(&txbuf[1], buf, len);

    msg.addr = addr;
    msg.flags = 0;
    msg.len = len + 1;
    msg.buf = txbuf;

    xfer.msgs = &msg;
    xfer.nmsgs = 1;

    return ioctl(fd, I2C_RDWR, &xfer);
}

/* ───── AT24C256 读写 ───── */
int eeprom_read(int fd, unsigned short mem_addr,
                unsigned char *buf, size_t len)
{
    unsigned char addr_buf[2];
    struct i2c_msg msgs[2];
    struct i2c_rdwr_ioctl_data xfer;

    addr_buf[0] = (mem_addr >> 8) & 0xFF;
    addr_buf[1] = mem_addr & 0xFF;

    msgs[0].addr = EEPROM_ADDR;
    msgs[0].flags = 0;
    msgs[0].len = 2;
    msgs[0].buf = addr_buf;

    msgs[1].addr = EEPROM_ADDR;
    msgs[1].flags = I2C_M_RD;
    msgs[1].len = len;
    msgs[1].buf = buf;

    xfer.msgs = msgs;
    xfer.nmsgs = 2;

    if (ioctl(fd, I2C_RDWR, &xfer) < 0)
        return -1;
    return len;
}

int eeprom_write_page(int fd, unsigned short mem_addr,
                      unsigned char *buf, size_t len)
{
    unsigned char txbuf[66];  /* 2字节地址 + 64字节数据 */
    struct i2c_msg msg;
    struct i2c_rdwr_ioctl_data xfer;

    if (len > 64) len = 64;  /* AT24C256页大小64字节 */

    txbuf[0] = (mem_addr >> 8) & 0xFF;
    txbuf[1] = mem_addr & 0xFF;
    memcpy(&txbuf[2], buf, len);

    msg.addr = EEPROM_ADDR;
    msg.flags = 0;
    msg.len = len + 2;
    msg.buf = txbuf;

    xfer.msgs = &msg;
    xfer.nmsgs = 1;

    if (ioctl(fd, I2C_RDWR, &xfer) < 0)
        return -1;

    usleep(5000);  /* 等待内部写周期完成 */
    return len;
}

/* ───── TMP102 读温度 ───── */
float tmp102_read_temp(int fd)
{
    unsigned char buf[2];
    short temp_raw;

    /* 读温度寄存器 (0x00) */
    if (i2c_read_reg(fd, TMP102_ADDR, 0x00, buf, 2) < 0)
        return -999.0;

    /* TMP102输出格式：12bit有符号，MSB在前 */
    temp_raw = ((buf[0] << 8) | buf[1]) >> 4;

    if (temp_raw & 0x800)  /* 负数 */
        temp_raw -= 4096;

    return (float)(temp_raw * 0.0625);  /* LSB = 0.0625°C */
}

/* ───── main ───── */
int main(void)
{
    int fd;
    unsigned char buf[64];
    int i;

    fd = open(I2C_BUS, O_RDWR);
    if (fd < 0) {
        perror("Failed to open I2C bus");
        return 1;
    }

    printf("=== I2C用户空间演示 ===\n\n");

    /* 1) 读取EEPROM前16字节 */
    memset(buf, 0, sizeof(buf));
    if (eeprom_read(fd, 0, buf, 16) == 16) {
        printf("EEPROM[0x0000-0x000F]: ");
        for (i = 0; i < 16; i++)
            printf("%02X ", buf[i]);
        printf("\n");
    }

    /* 2) 向EEPROM写入测试数据 */
    unsigned char test_data[] = "Hello I2C World!";
    if (eeprom_write_page(fd, 0x0040, test_data, sizeof(test_data)) > 0)
        printf("Written '%s' to EEPROM[0x0040]\n", test_data);

    /* 读回来验证 */
    memset(buf, 0, sizeof(buf));
    if (eeprom_read(fd, 0x0040, buf, sizeof(test_data)) == sizeof(test_data))
        printf("Read back: '%s'\n", buf);

    /* 3) 读TMP102温度 */
    printf("\nTMP102 Temperature: %.2f C\n", tmp102_read_temp(fd));

    close(fd);
    return 0;
}
```

编译运行：

```bash
# 交叉编译
$ arm-linux-gnueabihf-gcc i2c_user_demo.c -o i2c_user_demo

# 拷贝到板子执行
$ ./i2c_user_demo
=== I2C用户空间演示 ===
EEPROM[0x0000-0x000F]: 00 FF 00 FF 00 FF 00 FF 00 FF 00 FF 00 FF 00 FF
Written 'Hello I2C World!' to EEPROM[0x0040]
Read back: 'Hello I2C World!'
TMP102 Temperature: 24.75 C
```

<br>

### 调试命令与验证步骤

```bash
# === 第1步：扫描I2C总线，确认设备在线 ===
$ i2cdetect -y 1
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:          -- -- -- -- -- -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- UU -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
40: -- -- -- -- -- -- -- -- UU -- -- -- -- -- -- --
50: UU -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
60: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- --

# UU = 内核驱动已占用  |  数字 = 检测到设备  |  -- = 空
# 0x48 = TMP102, 0x50 = AT24C256 ✓


# === 第2步：用i2cdump查看EEPROM内容 ===
$ i2cdump -y 1 0x50 i          # i = I2C块读模式
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f    0123456789abcdef
00: 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff    ................
10: 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff 00 ff    ................
...
40: 48 65 6c 6c 6f 20 49 32 43 20 57 6f 72 6c 64 21    Hello I2C World!


# === 第3步：用i2cget读取TMP102温度 ===
$ i2cget -y 1 0x48 0x00 w     # 读温度寄存器(0x00), word
0x1940

# TMP102数据：0x1940 → 0x0194 → 右移4位 = 0x19 = 25
# 实际上 0x1940 小端转换后 raw = 0x4019 >> 4 = 0x0401 = 1025
# 1025 * 0.0625 = 64.06°C? 不对！
#
# 等等——i2cget读出的字节序取决于实现
# 正确的做法：读2字节后，交换字节位置
# buf[0]=0x19, buf[1]=0x40 → swab16 → 0x4019 >> 4 = 0x0401
# 嗯，这个值看起来偏高...  实际室温下应该是 0x0Cxx 级别

# 更可靠的方法：用i2cget读两个字节
$ i2cget -y 1 0x48 0x00       # 读1字节
0x19
$ i2cget -y 1 0x48 0x00 w     # word读
0x1940
# 手动计算：(0x1940 >> 4) = 0x0194?  字节序混乱了
# 正确做法： (buf[0] << 4) | (buf[1] >> 4)
# 0x19 = 0001 1001, 0x40 = 0100 0000
# 12bit值 = (0x19 << 4) | (0x40 >> 4) = 0x190 | 0x04 = 0x194
# 0x194 = 404, 404 * 0.0625 = 25.25°C


# === 第4步：查看内核日志 ===
$ dmesg | grep i2c
[    2.345678] omap_i2c 4802a000.i2c: bus 1 rev0.11 at 100 kHz
[    3.123456] at24 1-0050: 32768 byte 24c256 EEPROM, writable, 64 bytes/write
[    3.234567] tmp102 1-0048: TMP102 probed at 0x48
[    3.345678] pca953x 1-0020: probed

# 如果probe失败，dmesg会显示具体错误


# === 第5步：用dev_dbg查看详细I2C传输（需要开启）===
$ echo 'file drivers/i2c/i2c-core-base.c +p' > /sys/kernel/debug/dynamic_debug/control
$ dmesg -w
[i2c i2c-1] i2c_transfer: msgs[0]: addr=0x50, flags=0x00, len=2
[i2c i2c-1] i2c_transfer: msgs[1]: addr=0x50, flags=0x01, len=16
```

<br>

### 常见问题排查

```bash
# 问题：i2cdetect看不到设备
# 排查1: 确认I2C总线使能
$ ls /dev/i2c*
/dev/i2c-0  /dev/i2c-1  # 应该有对应的设备节点

# 排查2: 检查设备树status是否为"okay"
# 排查3: 用示波器看SDA/SCL波形
#   - 空闲时是否都为高（上拉电阻正常）
#   - 起始位是否SDA从高到低时SCL高
#   - 设备是否回ACK（第9个时钟SDA被拉低）

# 排查4: 检查地址是否冲突
$ i2cdetect -y 1 -r         # -r用读字节扫描，更准确

# 问题：读写返回EIO
# 排查1: 检查设备地址（7位 vs 8位混淆？）
# 排查2: 检查写周期等待时间
# 排查3: 降低总线频率测试

# 问题：TMP102温度读数异常
# 排查: 确认字节序（TMP102 MSB在前，但API可能返回小端）
```

<br>

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|------|---------|
| **I2C三层架构** | Core层统一API + Adapter层驱动控制器 + Client层驱动外设，设备驱动只关心Client层 |
| **关键结构体** | `i2c_adapter`（总线控制器）、`i2c_algorithm`（操作方法）、`i2c_client`（设备实例）、`i2c_driver`（设备驱动） |
| **核心API** | 简单寄存器用`smbus`系列，复杂传输用`i2c_transfer()`，probe里先`check_functionality()` |
| **设备树配置** | `compatible`匹配驱动、`reg`填I2C地址、`pagesize`/`size`/`address-width`给at24驱动 |
| **SMBus差异** | 比I2C多了PEC校验、35ms超时、ALERT信号、块传输限制32字节，偏向PC/服务器系统管理 |
| **SMBus陷阱** | Block Read超32字节会PEC失败，换`i2c_transfer()`做I2C Block Read |
| **GPIO扩展器** | PCA9535（16位真双向）适合复杂IO，PCF8574（8位准双向）适合简单场景，MCP23017带中断 |
| **AT24C256** | 内核at24驱动自带，配好设备树即可，通过sysfs的`eeprom`文件读写 |
| **TMP102** | 12bit温度传感器，SMBus兼容，用`smbus_read_word_data()`读，注意字节序转换 |
| **调试工具** | `i2cdetect`扫描、`i2cdump`查看、`i2cget`读寄存器、`dmesg`看内核日志 |

<br>

## <span class="blue"> 下一步

这一节把I2C的Linux驱动框架和SMBus讲透了。但你可能还不过瘾——I2C调试还有哪些趁手工具？怎么分析波形？1-Wire总线又是怎么回事，跟I2C什么关系？下一节 **B-A.2.4 I2C调试工具与1-Wire** 会覆盖：

- `i2c-tools`全家桶深度用法（i2ctransfer等高级工具）
- 逻辑分析仪抓取I2C波形实战
- 1-Wire总线协议详解：ROM命令、功能命令、DS18B20温度传感器
- 1-Wire在Linux下的驱动框架（w1子系统）

<br>

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/i2c/smbus-protocol.rst` — SMBus协议的权威描述
- **AT24C256数据手册**：Atmel/Microchip AT24C256 Datasheet — EEPROM的电气特性时序
- **TMP102数据手册**：TI TMP102 Datasheet (SBOS397) — 寄存器定义详解
- **SMBus规范**：System Management Bus Specification v3.0 — Intel
- **PCA9535数据手册**：NXP PCA9535 Datasheet — GPIO扩展器寄存器
- **工具**：`apt-get install i2c-tools` — i2cdetect/i2cdump/i2cget等

<br>

> 💡 **提示**：如果你是第一次调试I2C设备，强烈建议先写用户空间代码验证（通过`/dev/i2c-N`和`ioctl`），确认硬件没问题再写内核驱动。用户空间调试成本低、反馈快，内核开发板挂了还得重启。
