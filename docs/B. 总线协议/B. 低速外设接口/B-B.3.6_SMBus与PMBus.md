# B-B.3.6 SMBus 与 PMBus

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] Beginner → Intermediate | 预计阅读时间：50 分钟

## <span class="blue">本节导读：可以只用 I2C，但不能省掉器件协议

只用普通 I2C 读写电源芯片，再由自己的代码解析结果，当然可行。SMBus 和 PMBus 都不是绕不开的另一组引脚，也不要求换一套控制器寄存器。

真正的问题是：**省掉现成的 SMBus／PMBus 软件之后，哪些工作仍然必须有人完成？**

一笔电压读取至少包含四类工作：

1. 用 SDA、SCL 把地址、命令和字节送到芯片；
2. 按约定组合“写命令、重复 START、读数据”的事务；
3. 选择输出页，并按芯片规定解释命令和原始数据；
4. 把结果变成其他软件能够直接使用的电压读数。

I2C 提供第 1 项的传输基础，也能用消息组合承载第 2 项，但不统一器件的事务语义。SMBus 统一第 2 项的一部分事务格式，PMBus 规定第 3 项的电源命令与数据语义，Linux 的 pmbus 和 hwmon（硬件监控）则把第 3、4 项做成可复用的系统功能。

本篇用同一颗真实器件、同一路输出、同一组预期字节，把三条软件路径走通：

- **路径 A：原始 `i2c_transfer()` 加自行解析。** 自己构造每条消息，也自己处理 PAGE 和电压格式。
- **路径 B：`i2c_smbus_*()` 加自行解析。** 固定事务交给辅助函数，PAGE 和电压格式仍由自己处理。
- **路径 C：Linux pmbus 加 hwmon。** 器件驱动声明能力，pmbus 核心处理页、命令和解码，hwmon 导出毫伏值。

贯穿实例选用德州仪器（TI）TPS40422 双路直流转换器。受控实验把它的 7 位地址配置为 `0x30`，读取第 1 页，也就是第二路输出的电压。PAGE 是选择输出页的命令，VOUT_MODE 描述电压数据格式，READ_VOUT 读取实测电压。假设芯片在该时刻测得 1.5 V，则：

```text
VOUT_MODE = 0x17：线性模式，指数 -9
READ_VOUT 线上返回：00 03
软件组成原始字：0x0300 = 768
电压：768 × 2^(-9) = 1.5 V
hwmon 文本：1500，单位为 mV
```

这些数值来自 TPS40422 手册规定的格式和本例设定的测量结果，不是上板实录。阅读本篇需要 B-B.3.2 的重复 START、读写方向，以及 B-B.3.3 的 `i2c_client`、`i2c_msg` 和 `i2c_transfer()`。Linux 对象与调用关系以 v6.6 源码为核验基准。

---

## <span class="blue">一、三层协议分别替软件做什么

### I2C 把字节送到，却不规定字节代表什么

I2C 规定设备地址、START／STOP、读写方向和逐字节应答。它没有统一规定所有器件的第一个数据字节必须是命令，也不认识“输出电压”。

因此，下面这条结论只覆盖传输层：

> 控制器成功发出 `0x8b`，并从地址 `0x30` 读回两个字节。

软件仍然不知道 `0x8b` 为什么是 `READ_VOUT`，也不知道这两个字节能不能直接乘以某个固定系数。后两项属于器件协议。

### SMBus 固定事务形状，并补上管理通道的约束

SMBus（System Management Bus）沿用两线传输，把常见操作定义成固定事务。本例会用到两种：

- **Byte Data**：一个命令码加一个数据字节。本例用它读写 PAGE、读取 VOUT_MODE。
- **Word Data**：一个命令码加两个数据字节，低字节先传。本例用它读取 READ_VOUT。

以 Word Data Read 为例，线上顺序是：

```text
S → 地址+W → 命令码 → Sr → 地址+R → 低字节 → 高字节 → P
```

`S`、`Sr`、`P` 分别表示 START、重复 START、STOP。Linux 看到 `i2c_smbus_read_word_data()` 后，能据此生成或执行这笔固定事务；但它仍然不知道命令 `0x8b` 的电源语义。

SMBus 还规定了普通 I2C 没有统一规定的管理行为。`tTIMEOUT` 用于从持续拉低时钟的异常中恢复，`tLOW:SEXT` 限制从设备在一笔消息中累计延展时钟的时间。PEC（Packet Error Checking）则可在事务末尾增加 CRC-8（8 位循环冗余校验）校验字节，用于检错而不是纠错。

这些能力都不能只凭函数名推定。控制器、外设和软件配置必须共同支持；一笔 PEC 校验通过，也只能说明事务字节未被发现损坏，不能证明页选对了、电压解码正确。

### PMBus 让不同电源芯片说同一种命令语言

PMBus（Power Management Bus）把 SMBus 事务承载的内容定义成电源命令。例如：

- `PAGE (0x00)` 选择后续页相关命令作用于哪一路；
- `VOUT_MODE (0x20)` 说明输出电压数据采用哪种格式；
- `READ_VOUT (0x8b)` 读取当前测得的输出电压，而不是目标设定值。

这就是 PMBus 存在的价值：软件可以围绕标准命令和统一监控接口组织代码，而不是给每家芯片都发明一套应用层寄存器解析流程。

不过，PMBus 允许器件支持不同命令子集和数据格式，具体芯片手册仍是最终依据。不能看到一颗 I2C 电源芯片，就假设它一定支持上述三个命令。

---

## <span class="blue">二、先把同一笔读取完整展开

TPS40422 有两个 PMBus 页。手册中的 PAGE 真值表规定：`PAGE=0` 选择第一路，`PAGE=1` 选择第二路，`PAGE=3` 表示同时选择两路；本例不使用广播式的 `PAGE=3`，只写 `1`。

地址也不是芯片永远固定的 `0x30`。ADDR0、ADDR1 两个引脚通过不同电阻选择两位八进制地址，共可配置 64 个地址。本例只是约定实验硬件已经把地址配置为 `0x30`。

读取第二路电压时，软件需要完成下面这组有序操作：

1. 读取当前 PAGE，保存旧值，避免用完芯片后把别的访问者留在错误上下文；
2. 写入 `PAGE=1`，再读回 PAGE，确认选择已经生效；
3. 读取 `VOUT_MODE`，本例应得到只读值 `0x17`；
4. 读取 `READ_VOUT`，得到两字节测量值；
5. 恢复第 1 步保存的旧 PAGE；
6. 把原始字和 VOUT_MODE 一起解码为电压。

注意第 3 步和第 4 步不能合并成一个“读寄存器”概念。前者告诉软件怎样解释数据，后者才是数据本身。TPS40422 的 VOUT_MODE 固定不变，正式驱动可以在初始化时缓存；教学代码每次读出，是为了让输入和输出都能被看见。

三条路径在第 1～5 步上的责任划分如下：

- 路径 A 自己构造每一次 Byte Data、Word Data 对应的 `i2c_msg`；
- 路径 B 用 SMBus 辅助函数完成同样的总线事务，但仍自己安排上述顺序；
- 路径 C 由 pmbus 核心安排页选择、能力探测和读取，应用只读取 hwmon 属性。

所以，“不用 pmbus 驱动”并不等于“不用实现 PMBus”。它只是把 PMBus 的实现从通用驱动搬到了自己的代码里。

---

## <span class="blue">三、路径 B：SMBus 辅助函数消除了哪部分手工工作

先看本例最关键的三个调用。它们还不是完整程序，只用来把函数参数与前面的操作一一对应：

```c title="三个 SMBus 调用与 PMBus 命令的对应关系"
s32 old_page;
s32 mode;
s32 word;
int ret;

old_page = i2c_smbus_read_byte_data(client, 0x00);
/* 返回负错误；非负值就是当前 PAGE，不是“读成功”的布尔值。 */

ret = i2c_smbus_write_byte_data(client, 0x00, 1);
/* 写命令 0x00 的数据字节 1；成功返回 0，失败返回负错误。 */

mode = i2c_smbus_read_byte_data(client, 0x20);
/* 本例预期非负返回值 0x17。 */

word = i2c_smbus_read_word_data(client, 0x8b);
/* 本例预期非负返回值 0x0300；辅助函数已组合低、高字节。 */
```

这里的 `client` 是 B-B.3.3 已建立的 I2C 外设对象，内含适配器和设备地址。`s32` 是 32 位有符号整数，用来同时容纳负错误码和非负数据。不能把 `word < 0` 的检查省掉，再把负错误强转成 `u16`，否则通信故障会伪装成某个很大的原始电压。

`i2c_smbus_read_word_data()` 内部调用 `i2c_smbus_xfer()`，并传入 `I2C_SMBUS_READ` 和 `I2C_SMBUS_WORD_DATA`。这两个常量分别说明方向和事务类型。Core 随后有两条执行路径：

- 控制器驱动提供 `algo->smbus_xfer()` 时，可由它原生执行 SMBus 事务；
- 没有该方法时，Core 用 `i2c_smbus_xfer_emulated()` 构造普通 `i2c_msg`；
- 原生方法返回 `-EOPNOTSUPP`，且控制器仍有 `master_xfer` 时，也会回退到模拟路径。

因此，SMBus 辅助函数不是绕过 I2C Core 的另一套驱动。它只是把固定事务的表达和部分执行工作集中起来。对 Word Data Read，模拟路径同样形成“写命令、重复 START、读两字节”，并用 `msgbuf1[0] | (msgbuf1[1] << 8)` 组合返回值。

路径 B 比路径 A 少写的是消息数组、方向标志、返回消息数和低高字节组合。**它没有替我写 PAGE 顺序、VOUT_MODE 判断、页恢复和电压换算。** 这正是下一节完整模块要保留的部分。

---

## <span class="blue">四、把路径 A 和路径 B 放进同一个教学模块

### 设备树先创建实验要操作的 client

下面片段放进目标板实际启用 I2C 控制器的设备树。`i2c2` 只是示例标签，必须替换为板级文件中连接 TPS40422 的控制器；100 kHz 是本例选择的工作速率。

```dts title="board.dts 片段 · TPS40422 挂在 i2c2 的 0x30"
&i2c2 {
    status = "okay";
    clock-frequency = <100000>;

    pmbus@30 {
        compatible = "ti,tps40422";
        reg = <0x30>;             /* 由 ADDR0/ADDR1 电阻配置出的 7 位地址 */
    };
};
```

`reg` 给出地址，`compatible` 描述器件型号。v6.6 的 `of_i2c_register_devices()` 遍历可用子节点，`of_i2c_get_board_info()` 读取这两个属性，`i2c_new_client_device()` 创建 `i2c_client`。其中 client 名称会从首个 compatible 去掉厂商前缀，得到 `"tps40422"`，后续可与驱动的 I2C ID 表匹配。

节点名 `pmbus` 只用于可读性，不参与这里的驱动匹配。正式项目仍应使用目标内核水线对应的设备树绑定规则检查整棵 DTS，不能只凭本片段认定已通过绑定验证。

### 完整模块：两种总线写法，共用同一套 PMBus 语义

把下面内容保存为 `pmbus_vout_demo.c`。它以 Linux v6.6 的外部模块接口为上下文，通过 `i2c_driver` 在 probe 中完成读取。代码只读监测命令，不写 `VOUT_COMMAND`，不改变输出电压设定。

```c title="pmbus_vout_demo.c · 路径 A/B 对照教学模块"
// SPDX-License-Identifier: GPL-2.0
#include <linux/device.h>
#include <linux/err.h>
#include <linux/i2c.h>
#include <linux/module.h>
#include <linux/types.h>

/* 三个命令码来自 TPS40422 手册，不依赖 pmbus 驱动的内部头文件。 */
#define DEMO_PAGE_CMD       0x00
#define DEMO_VOUT_MODE_CMD  0x20
#define DEMO_READ_VOUT_CMD  0x8b
#define DEMO_TARGET_PAGE    1
#define DEMO_EXPECTED_MODE  0x17    /* TPS40422 的只读 VOUT_MODE */

struct demo_reading {
    u8 mode;                    /* VOUT_MODE 返回的一个字节 */
    u16 raw;                    /* READ_VOUT 组合后的 16 位原始字 */
};

/* i2c_transfer() 返回完成的消息数；短消息也按失败处理。 */
static int demo_xfer_result(int ret, int expected)
{
    if (ret < 0)
        return ret;             /* 保留控制器/Core 给出的负错误码 */

    return ret == expected ? 0 : -EIO;
}

/* ---------- 路径 B：SMBus 辅助函数 ---------- */

static int demo_select_page_smbus(struct i2c_client *client, u8 page)
{
    s32 check;
    int ret;

    ret = i2c_smbus_write_byte_data(client, DEMO_PAGE_CMD, page);
    if (ret < 0)
        return ret;

    check = i2c_smbus_read_byte_data(client, DEMO_PAGE_CMD);
    if (check < 0)
        return check;

    /* 写调用返回 0 不代表芯片一定接受了页号，所以读回核对。 */
    return check == page ? 0 : -EIO;
}

static int demo_read_vout_smbus(struct i2c_client *client,
                                struct demo_reading *reading)
{
    s32 old_page;
    s32 value;
    int ret;
    int restore_ret;

    /* old_page 位于本次调用的栈上，是访问者自己的副本。 */
    old_page = i2c_smbus_read_byte_data(client, DEMO_PAGE_CMD);
    if (old_page < 0)
        return old_page;

    ret = demo_select_page_smbus(client, DEMO_TARGET_PAGE);
    if (ret < 0)
        goto restore_page;

    value = i2c_smbus_read_byte_data(client, DEMO_VOUT_MODE_CMD);
    if (value < 0) {
        ret = value;
        goto restore_page;
    }
    reading->mode = (u8)value;

    value = i2c_smbus_read_word_data(client, DEMO_READ_VOUT_CMD);
    if (value < 0) {
        ret = value;
        goto restore_page;
    }

    /* 只有非负返回值才是数据；此时才能安全缩窄为 u16。 */
    reading->raw = (u16)value;
    ret = 0;

restore_page:
    /* 成功和失败路径都恢复原页，避免把共享状态留在第 1 页。 */
    restore_ret = i2c_smbus_write_byte_data(client, DEMO_PAGE_CMD,
                                            (u8)old_page);
    if (restore_ret < 0 && ret == 0)
        ret = restore_ret;      /* 读取虽成功，恢复失败也不能静默忽略 */

    return ret;
}

/* ---------- 路径 A：手工构造等价 i2c_msg ---------- */

static int demo_raw_write_byte_data(struct i2c_client *client,
                                    u8 command, u8 value)
{
    u8 buf[2] = { command, value };
    struct i2c_msg msg = {
        .addr = client->addr,
        .flags = client->flags,
        .len = 2,
        .buf = buf,
    };
    int ret;

    /* 一条写消息包含命令码和数据；成功时完成消息数为 1。 */
    ret = i2c_transfer(client->adapter, &msg, 1);
    return demo_xfer_result(ret, 1);
}

static int demo_raw_read_byte_data(struct i2c_client *client,
                                   u8 command, u8 *value)
{
    u8 command_buf[1] = { command };
    u8 data_buf[1];
    struct i2c_msg msgs[2] = {
        {
            .addr = client->addr,
            .flags = client->flags,
            .len = 1,
            .buf = command_buf,
        },
        {
            .addr = client->addr,
            .flags = client->flags | I2C_M_RD,
            .len = 1,
            .buf = data_buf,
        },
    };
    int ret;

    /* 两条消息之间由 Core 生成重复 START，而不是先发 STOP。 */
    ret = i2c_transfer(client->adapter, msgs, 2);
    ret = demo_xfer_result(ret, 2);
    if (ret < 0)
        return ret;

    *value = data_buf[0];
    return 0;
}

static int demo_raw_read_word_data(struct i2c_client *client,
                                   u8 command, u16 *value)
{
    u8 command_buf[1] = { command };
    u8 data_buf[2];
    struct i2c_msg msgs[2] = {
        {
            .addr = client->addr,
            .flags = client->flags,
            .len = 1,
            .buf = command_buf,
        },
        {
            .addr = client->addr,
            .flags = client->flags | I2C_M_RD,
            .len = 2,
            .buf = data_buf,
        },
    };
    int ret;

    ret = i2c_transfer(client->adapter, msgs, 2);
    ret = demo_xfer_result(ret, 2);
    if (ret < 0)
        return ret;

    /* Word Data 低字节先上线：00 03 在这里组成 0x0300。 */
    *value = (u16)data_buf[0] | ((u16)data_buf[1] << 8);
    return 0;
}

static int demo_select_page_raw(struct i2c_client *client, u8 page)
{
    u8 check;
    int ret;

    ret = demo_raw_write_byte_data(client, DEMO_PAGE_CMD, page);
    if (ret < 0)
        return ret;

    ret = demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &check);
    if (ret < 0)
        return ret;

    return check == page ? 0 : -EIO;
}

static int demo_read_vout_raw(struct i2c_client *client,
                              struct demo_reading *reading)
{
    u8 old_page;
    int ret;
    int restore_ret;

    ret = demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &old_page);
    if (ret < 0)
        return ret;

    ret = demo_select_page_raw(client, DEMO_TARGET_PAGE);
    if (ret < 0)
        goto restore_page;

    ret = demo_raw_read_byte_data(client, DEMO_VOUT_MODE_CMD,
                                  &reading->mode);
    if (ret < 0)
        goto restore_page;

    ret = demo_raw_read_word_data(client, DEMO_READ_VOUT_CMD,
                                  &reading->raw);

restore_page:
    restore_ret = demo_raw_write_byte_data(client, DEMO_PAGE_CMD, old_page);
    if (restore_ret < 0 && ret == 0)
        ret = restore_ret;

    return ret;
}

/* ---------- 两条路径共用：PMBus 输出电压解码 ---------- */

static int demo_decode_mv(const struct demo_reading *reading, s64 *millivolts)
{
    int exponent;
    s64 value;

    /* 高三位为 000 才是本例的线性输出电压格式。 */
    if ((reading->mode >> 5) != 0)
        return -EOPNOTSUPP;

    /* 低五位是五位补码指数：10111 表示 23 - 32 = -9。 */
    exponent = reading->mode & 0x1f;
    if (exponent & 0x10)
        exponent -= 0x20;

    /* 先乘 1000 变为毫伏，再按指数缩放，避免内核浮点运算。 */
    value = (s64)reading->raw * 1000;
    if (exponent >= 0)
        value <<= exponent;
    else
        value >>= -exponent;

    *millivolts = value;
    return 0;
}

static int pmbus_vout_demo_probe(struct i2c_client *client)
{
    struct demo_reading smbus_reading = { 0 };
    struct demo_reading raw_reading = { 0 };
    s64 millivolts;
    int ret;

    /* 本实验同时演示两种接口，因此要求适配器两者都能提供。 */
    if (!i2c_check_functionality(client->adapter,
                                 I2C_FUNC_I2C |
                                 I2C_FUNC_SMBUS_BYTE_DATA |
                                 I2C_FUNC_SMBUS_WORD_DATA))
        return -EOPNOTSUPP;

    ret = demo_read_vout_smbus(client, &smbus_reading);
    if (ret < 0) {
        dev_err(&client->dev, "SMBus read failed: %d\n", ret);
        return ret;
    }

    ret = demo_read_vout_raw(client, &raw_reading);
    if (ret < 0) {
        dev_err(&client->dev, "raw I2C read failed: %d\n", ret);
        return ret;
    }

    /* 两次实时测量可能自然变化；相等才说明本例对照完全吻合。 */
    if (smbus_reading.mode != raw_reading.mode ||
        smbus_reading.raw != raw_reading.raw) {
        dev_err(&client->dev,
                "readings differ: SMBus %02x/%04x, raw %02x/%04x\n",
                smbus_reading.mode, smbus_reading.raw,
                raw_reading.mode, raw_reading.raw);
        return -EIO;
    }

    /* 先核对手册规定的固定模式，再允许进入本例的解码路径。 */
    if (smbus_reading.mode != DEMO_EXPECTED_MODE) {
        dev_err(&client->dev, "unexpected VOUT_MODE: 0x%02x\n",
                smbus_reading.mode);
        return -ENODEV;
    }

    ret = demo_decode_mv(&smbus_reading, &millivolts);
    if (ret < 0)
        return ret;

    dev_info(&client->dev,
             "page=%d mode=0x%02x wire=%02x %02x raw=0x%04x vout=%lld mV\n",
             DEMO_TARGET_PAGE, smbus_reading.mode,
             smbus_reading.raw & 0xff, smbus_reading.raw >> 8,
             smbus_reading.raw, millivolts);
    return 0;
}

/* client 名称 "tps40422" 与此 ID 匹配，于是进入上面的 probe。 */
static const struct i2c_device_id pmbus_vout_demo_id[] = {
    { "tps40422", 0 },
    { }
};
MODULE_DEVICE_TABLE(i2c, pmbus_vout_demo_id);

static struct i2c_driver pmbus_vout_demo_driver = {
    .driver = {
        .name = "pmbus_vout_demo",
    },
    .probe = pmbus_vout_demo_probe,
    .id_table = pmbus_vout_demo_id,
};

/* 模块加载时注册驱动，卸载时注销；本例没有额外持久资源要释放。 */
module_i2c_driver(pmbus_vout_demo_driver);

MODULE_DESCRIPTION("TPS40422 PMBus read: SMBus helpers versus raw I2C");
MODULE_LICENSE("GPL");
```

这段代码故意把路径 A 写得很完整。对照后可以看到，原始 `i2c_transfer()` 并没有让 PMBus 消失：两条读取函数仍然要保存和恢复 PAGE、读取 VOUT_MODE、发出 READ_VOUT、检查错误并解码。变化只发生在总线事务怎样表达。

`demo_xfer_result()` 还区分了三种结果：负错误直接向上传递；完成消息数符合预期才成功；返回非负但消息数不足时转换为 `-EIO`。`EIO` 是通用 I/O 错误，`EOPNOTSUPP` 表示请求的能力或格式不受支持，`ENODEV` 在这里表示器件返回的模式不符合本例前提。`I2C_M_RD` 则把第二条消息标为读方向。

本例把 PAGE 的写和读回封装成 `demo_select_page_*()`，目的是让“页选择是否生效”成为可检查的一步，而不是看到写函数返回 0 就继续。两个读取函数都通过 `goto restore_page` 汇合恢复路径，避免中途读 VOUT_MODE 失败时漏掉恢复。

原始消息对照没有加入 PEC。如果启用了 PEC，线上还会多出校验字节，两条路径就不能只按这里的消息长度机械比较。正式 pmbus 核心会在器件 CAPABILITY 和适配器能力都允许时设置 `I2C_CLIENT_PEC`，这是系统集成的一部分，不是本教学模块已经实现的功能。

### 编译、加载和观察结果

把 Makefile 与源文件放在同一目录。`KDIR` 指向已经为目标板配置并准备过外部模块构建的内核源码树，`ARCH` 和 `CROSS_COMPILE` 按工具链调整。

```makefile title="Makefile · 与 pmbus_vout_demo.c 放在同一目录"
obj-m += pmbus_vout_demo.o

KDIR ?= /path/to/linux
ARCH ?= arm64
CROSS_COMPILE ?= aarch64-linux-gnu-

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) ARCH=$(ARCH) \
		CROSS_COMPILE=$(CROSS_COMPILE) modules

clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) ARCH=$(ARCH) \
		CROSS_COMPILE=$(CROSS_COMPILE) clean
```

执行构建：

```bash
make KDIR=/path/to/linux
```

成功后应生成 `pmbus_vout_demo.ko`。这只是模块构建产物，不表示芯片已经应答。

**教学驱动和正式 `tps40422` 驱动不能同时绑定同一个 client。** 如果正式驱动已经绑定，下面的实验只允许在可以暂停电源监控的测试板上进行。设备名 `2-0030` 对应本例的 i2c2 和地址 `0x30`，实际板卡应先从 `/sys/bus/i2c/devices/` 确认。

```bash title="目标板 · 暂停正式驱动，加载教学模块"
echo 2-0030 > /sys/bus/i2c/drivers/tps40422/unbind
insmod pmbus_vout_demo.ko
dmesg | tail -n 20
```

若 SMBus 与原始消息两次读取都得到本例设定的 1.5 V，预期日志示例为：

```text
pmbus_vout_demo 2-0030: page=1 mode=0x17 wire=00 03 raw=0x0300 vout=1500 mV
```

如果输出电压正在变化，两次 READ_VOUT 可能不完全相等，模块会打印 `readings differ` 并返回 `-EIO`。这不是两种事务格式必然不等价，而是实时测量值发生了变化；验证时可以保持输出稳定，或改为分别记录并比较事务轨迹，不要求两次采样绝对相同。

实验结束后卸载教学模块，再让正式驱动重新绑定：

```bash
rmmod pmbus_vout_demo
echo 2-0030 > /sys/bus/i2c/drivers/tps40422/bind
```

若目标系统把正式驱动配置为模块，也可以用符合该系统部署流程的方式重新加载。上述命令没有在本工作区对应的真实板卡上执行，输出只是依据代码和本例数据写出的预期形式。

---

## <span class="blue">五、PAGE 共享状态：为什么“各自读一下”仍会互相干扰

PAGE 存在 TPS40422 芯片内部，是同一物理地址下多个访问者共享的状态。`old_page` 则保存在某一次函数调用的栈上，是每个访问者自己的副本。两者不能混为一谈。

用访问者 A 和 B 的具体操作推演。初始 `PAGE=0`，A 想读第 1 页，B 想读第 0 页：

1. A 读 PAGE，在自己的 `old_page` 中保存 `0`；
2. A 写 `PAGE=1`，芯片当前页变为 1；
3. 在 A 发出 READ_VOUT 之前，B 写 `PAGE=0`，芯片当前页又变为 0；
4. A 发出 `READ_VOUT (0x8b)`。该命令本身不携带页号，所以读到的是当前第 0 页；
5. A 按自己的计划恢复 `old_page=0`。恢复动作成功，却不能把第 4 步已经读错的数据变正确。

READ_VOUT 没有“顺便告诉芯片我要第几页”的参数，这正是切页与读取必须协调的原因。I2C 适配器锁能保护单条消息的传输，却不会自动把应用的一整组“切页、读格式、读电压、恢复”合并成一个业务临界区。

Linux pmbus 核心用两种方式协调**经过同一个 pmbus 驱动实例**的访问：

- `pmbus_data.currpage` 缓存驱动认为芯片当前使用的页，避免不必要的重复写页；
- `data->update_lock` 让传感器更新和 sysfs 显示等路径串行执行，防止本驱动另一次访问插入切页与取值之间。

`pmbus_set_page()` 在多页器件且目标页不同于缓存时，先写 PAGE，再读回核对，成功后才更新 `currpage`。如果读回值不对，它返回 `-EIO`，不会继续把另一页的数据冒充目标数据。

这里的 `phase` 又是另一层选择：它用于多相输出中的相，不是 TPS40422 双路 PAGE 的同义词。通用读取接口用 `0xff` 表示不选择特定 phase；本例只讨论 PAGE，不把两者混写。

驱动内的锁和缓存仍约束不了绕过驱动的访问者。一个进程若通过 `/dev/i2c-N` 直接写 PAGE，pmbus 的 `currpage` 不会同步更新。于是“软件缓存为 1、芯片实际为 0”就可能发生。调试多页器件时，不应让正式驱动和手工切页命令无协调地同时工作。

---

## <span class="blue">六、两个字节怎样成为 1500 mV

### 先判断格式，再代入数值

TPS40422 的 VOUT_MODE 固定为 `0x17`，写成二进制是 `00010111`：

- 高三位 `000` 选择线性输出电压模式；
- 低五位 `10111` 是五位补码。无符号值为 23，五位补码范围为 -16～15，所以实际指数是 `23-32=-9`。

READ_VOUT 返回的 16 位原始字则全部作为尾数。设原始字为 `X`，指数为 `N`，实际电压为：

```text
Y = X × 2^N
```

本例线上先收到低字节 `0x00`，再收到高字节 `0x03`：

```text
X = 0x00 | (0x03 << 8)
  = 0x0300
  = 768

Y = 768 × 2^(-9)
  = 768 / 512
  = 1.5 V
```

hwmon 的电压输入属性以毫伏为文本单位，所以最终显示 `1500`。教学代码中的 `demo_decode_mv()` 按相同顺序先乘 1000，再右移 9 位：`768000 >> 9 = 1500`。

### 为什么不能把 LINEAR11 套到 READ_VOUT

LINEAR11 把 5 位有符号指数和 11 位有符号尾数一起放进一个 16 位字。许多电流、温度等 PMBus 数据采用这种格式。

本例输出电压采用的线性格式则把完整 16 位字作为无符号尾数，指数由另一个命令 VOUT_MODE 提供。Linux pmbus 源码把前者称为 LINEAR11，把本例输出电压分支标为 LINEAR16；有些规范文字也会用 ULINEAR16 强调其无符号性质。

区别不只是公式，而是**指数从哪里来**。如果把 `0x0300` 的高 5 位误当 LINEAR11 指数，就会得到另一套解释。正式驱动在 `pmbus_identify_common()` 中读取 VOUT_MODE 并保存每页指数，在 `pmbus_reg2data_linear()` 中按传感器类别选择解码分支，就是为了避免这种混用。

此外，READ_VOUT 是测量值，VOUT_COMMAND 才是目标设定命令。两者即使使用相同数据格式，也不能互相替代。要验证实际输出是否符合目标，还需要把目标值、遥测值和必要的万用表测量放在一起比较。

---

## <span class="blue">七、路径 C：现成驱动怎样把同一笔读取接入 hwmon

### 创建阶段：每个对象从哪里来

路径 C 不需要另写一颗 TPS40422 的通用监测驱动。v6.6 已有 `drivers/hwmon/pmbus/tps40422.c`，Kconfig 项为 `CONFIG_SENSORS_TPS40422`；通用核心由 `CONFIG_PMBUS` 提供。

沿创建顺序看，各对象承担的工作不同：

1. **DTS 节点 → `i2c_client`。** I2C Core 创建地址为 `0x30`、名称为 `"tps40422"` 的 client。
2. **`i2c_client` → TPS40422 驱动。** v6.6 的该驱动没有显式 OF 匹配表，但 I2C 匹配最后会用 `i2c_match_id()` 比较 client 名称和 `tps40422_id[]`，因此仍可进入 `tps40422_probe()`。
3. **器件能力 → `pmbus_driver_info`。** `tps40422_info.pages=2`，两页的 `func[]` 都包含 `PMBUS_HAVE_VOUT`，告诉通用核心“有两个页，两页都可读输出电压”。
4. **`pmbus_do_probe()` → `pmbus_data`。** 通用核心用 `devm_kzalloc()` 分配运行状态，用 `i2c_set_clientdata()` 把它关联到 client，初始化 `update_lock`，并把 `currpage`、`currphase` 设为 -1，表示还没有可信的页缓存。
5. **识别结果 → 传感器属性。** `pmbus_init_common()` 和识别路径探测 PEC、VOUT_MODE 等能力，`pmbus_find_attributes()` 按器件能力创建属性集合。
6. **属性集合 → hwmon 设备。** `devm_hwmon_device_register_with_groups()` 注册 hwmon，sysfs 因而出现可读取的属性文件。

`devm_*` 表示资源由设备管理框架跟踪，在驱动解绑或设备销毁时自动清理。通用核心不需要每个器件驱动各写一套释放链表；TPS40422 驱动只负责声明“这颗芯片有哪些 PMBus 能力”。

### 使用阶段：读取 `in2_input` 时发生什么

hwmon 是 Linux 的硬件监控子系统。sysfs 是它向用户空间导出文本属性的接口，`in` 表示电压输入，`input` 表示当前输入值。

v6.6 的电压属性按已声明能力依次编号。TPS40422 没有声明 VIN、VMON、VCAP，只声明两页 VOUT，因此：

- 第 0 页生成 `in1_input`，配套标签为 `vout1`；
- 第 1 页生成 `in2_input`，配套标签为 `vout2`。

本例应读取 `in2_input`，不是第 0 页的 `in1_input`。hwmon 目录编号仍由注册顺序决定，所以用下面的命令先找 `name` 为 `tps40422` 的目录：

```bash
for h in /sys/class/hwmon/hwmon*; do
    printf '%s: ' "$h"
    cat "$h/name"
done
```

假设找到 `hwmon2`，再确认标签并读取：

```bash
cat /sys/class/hwmon/hwmon2/in2_label
cat /sys/class/hwmon/hwmon2/in2_input
```

本例预期文本为：

```text
vout2
1500
```

一次 `cat in2_input` 在内核中的完整链路是：

```text
pmbus_show_sensor()
→ 持有 update_lock
→ pmbus_update_sensor_data()
→ _pmbus_read_word_data(..., PMBUS_READ_VOUT)
→ pmbus_read_word_data()                 # 本例走通用读取
→ pmbus_set_page(client, 1, 0xff)
→ 必要时写 PAGE=1，并读回核对
→ i2c_smbus_read_word_data(client, 0x8b)
→ 原生 SMBus 或普通 I2C 消息完成线上事务
→ sensor->data 保存原始字 0x0300
→ pmbus_reg2data_linear() 使用第 1 页指数 -9
→ sysfs_emit() 输出文本 1500
```

`_pmbus_read_word_data()` 开头的下划线表示它是 pmbus 核心内部的分派辅助函数：器件若有专用读取方法就先分派，否则调用通用 `pmbus_read_word_data()`。它不是另一种总线协议。

到这里，路径 C 的收益已经落到具体代码：应用不必自己保存 PAGE、判断 VOUT_MODE 或拼写电压公式；电源监控、风扇控制和其他管理软件也不必理解每家芯片的用户态解析细节。

### 销毁与失败路径分别由谁处理

`cat` 结束后，sysfs 只完成一次文本读取，不会销毁 client 或 pmbus_data。设备仍然存在，页缓存和锁也继续为下一次读取服务。

驱动解绑时，设备管理框架回收 pmbus_data 并注销 hwmon，但 DTS 创建的 i2c_client 仍可继续存在，等待其他驱动绑定；只有设备从系统移除时，I2C Core 才另外注销 client。若 probe 中途失败，`devm_*` 资源同样按设备管理规则清理，不会把“已注册一半”的 hwmon 留给应用。

如果某次总线读取返回负错误，`pmbus_show_sensor()` 不会把旧的 `sensor->data` 解码成新值输出，而是把错误返回给读取方。页选择、错误传播和资源生命周期因此都是机制的一部分，不是代码之外的附加注意事项。

---

## <span class="blue">八、三条路径怎样选择，出问题时先查哪一层

**路径 A 适合确实需要自己控制消息序列的场景。** 例如器件使用不符合固定 SMBus 事务的厂商格式，或教学、排障需要逐条观察消息。代价是 PAGE 协调、数据格式、错误恢复和后续系统集成都由自己维护。

**路径 B 适合事务形状吻合、但仍需自定义器件逻辑的场景。** 它减少消息构造和字节组合工作，又不会迫使软件采用完整 pmbus 框架。使用 AT24C02 的“地址加一字节读取”也可以借用 Byte Data 格式，但这只表示事务兼容，不表示 EEPROM 变成了完整 SMBus 器件。

**路径 C 适合内核已经支持、目标又是标准化电源监控的器件。** 它把通用 PMBus 工作和 hwmon 集成复用起来。若芯片有厂商扩展命令，仍可能需要专用驱动补充，不能为了“统一”而忽略器件手册。

出现“读不到正确电压”时，按数据流定位，而不是只看最终文件：

1. **地址阶段 NACK**：检查供电、地址电阻、总线占用和电气连接，这还在 I2C 层。
2. **SMBus 辅助函数失败而原始消息成功**：检查适配器能力、原生 SMBus 实现和模拟回退，不要先改电压公式。
3. **原始字合理但通道错误**：保留 PAGE 的写入、读回和并发访问记录，检查共享状态。
4. **原始字稳定但物理量错误**：检查低字节在前、VOUT_MODE、LINEAR11／LINEAR16，以及器件专属比例。
5. **总线读取成功但没有 hwmon 文件**：检查 `CONFIG_PMBUS`、器件驱动配置、client 匹配、probe 错误和属性注册。
6. **hwmon 数值存在但不符合实际电源**：确认读的是测量值还是目标值，再用仪器验证实际电压；sysfs 有文件不等于模拟输出已经正确。

本篇的教学模块用于核对两条软件事务路径和 PMBus 解码机制，正式驱动部分说明的是 Linux 系统集成。它们都不能替代 SMBus 电气符合性、信号完整性或真实电源性能测试；那些实验需要相应仪器和硬件条件。

---

## <span class="blue">本节总结

只用普通 I2C 并由应用层解析完全可行，但这并没有绕过 SMBus 所表达的事务约定，也没有绕过 PMBus 的 PAGE、命令和数据格式。只是把通用实现换成了自己的实现。

三条路径在同一笔 TPS40422 读取上的分界是：原始 `i2c_transfer()` 自己构造消息，`i2c_smbus_*()` 复用固定事务，pmbus 加 hwmon 再复用页管理、解码和标准导出。三者最终都经过同一个 I2C 控制器，不是三条不同的物理总线。

本例完整数据链为：`PAGE=1`，`VOUT_MODE=0x17` 给出指数 -9，`READ_VOUT` 返回 `00 03`，组成 `0x0300=768`，换算为 1.5 V，最后由 `in2_input` 输出 `1500` mV。

---

## <span class="blue">本节自查 Q&A

??? details "Q1. 如果不用 SMBus 辅助函数和 pmbus 驱动，只用 i2c_transfer()，是否就不用管 PMBus？"
    不是。`i2c_transfer()` 只替代总线事务的表达。要读取 TPS40422，代码仍须选择并恢复 PAGE、读取 VOUT_MODE、发出 READ_VOUT，并按 PMBus 和器件手册解码。这些工作只是从通用驱动搬到了自己的代码。

??? details "Q2. 既然 i2c_smbus_read_word_data() 已返回 0x0300，它是否也已经知道结果是 1.5 V？"
    不知道。该函数负责 Word Data 事务以及低、高字节组合。它不知道命令 0x8b 代表输出电压，也不知道 VOUT_MODE 给出的指数是 -9。1.5 V 是 PMBus 语义层继续解码的结果。

??? details "Q3. 三条路径是否要求三种不同的控制器或三组 SDA、SCL？"
    不要求。原始消息和 SMBus 辅助函数最终都由同一个 I2C 适配器完成波形；pmbus 又建立在 SMBus／I2C 接口之上。差别在软件分工，不在物理引脚数量。

??? details "Q4. 为什么教学代码在写入 PAGE=1 后还要读回，并在结束后恢复原页？"
    写函数返回 0 只表示写事务完成，不等于芯片接受了预期页号，所以读回用于验证选择。PAGE 又是芯片内共享状态，恢复原页可以减少本次访问对其他使用者的影响。恢复不能修正已经发生的并发错页，因此正式驱动还需要锁和页缓存协调。

??? details "Q5. A 已把 old_page 保存在自己的栈上，为什么 B 仍能令 A 读错通道？"
    old_page 只是 A 的独立副本，READ_VOUT 读取的是芯片内共享的当前 PAGE。若 A 写 PAGE=1 后，B 在 A 的 READ_VOUT 前改写 PAGE=0，A 随后读到第 0 页。A 最后恢复 old_page 也无法回头修正这次错误采样。

??? details "Q6. 本例为什么是 00 03 组成 0x0300，并最终显示 1500？"
    Word Data 低字节先传，所以 00 是低字节、03 是高字节，原始字为 0x0300=768。VOUT_MODE=0x17 指定线性模式、指数 -9，因此电压为 768/512=1.5 V。hwmon 电压输入使用毫伏文本单位，所以输出 1500。

??? details "Q7. 正式驱动已经管理 PAGE 后，还能否用 /dev/i2c-N 手工切页来调试？"
    不应无协调地同时操作。手工写 PAGE 不会改变 pmbus_data.currpage，也不会持有同一把 update_lock，可能使缓存和芯片实际页不一致。需要调试时应先暂停正式访问，或使用与驱动协调的接口。

??? details "Q8. hwmon 中出现 in2_input，是否就证明 PMBus 通信和实际输出电压都正确？"
    都不能单独证明。属性出现主要说明驱动 probe 和注册走到了相应阶段；一次合理读数支持通信与解码判断，但仍需结合原始命令、错误返回和仪器测量验证。实际电源性能更不是 sysfs 文件存在所能覆盖的。

??? details "Q9. 什么时候值得继续使用路径 A，而不是一律改用 pmbus？"
    当事务格式不符合 SMBus、需要厂商专属序列，或实验目的就是逐条控制消息时，路径 A 更合适。选择它不是因为它一定更底层、更快，而是因为通用抽象不覆盖该需求；同时必须接受自行维护协议语义、并发和错误恢复的成本。
