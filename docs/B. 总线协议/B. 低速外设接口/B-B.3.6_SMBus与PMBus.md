# B-B.3.6 SMBus 与 PMBus

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] Beginner → Intermediate | 预计阅读时间：55 分钟

## <span class="blue">本节导读：不用现成框架，工作去了哪里

只用普通 I2C 读写电源芯片，再由自己的代码解析结果，完全可行。SMBus 和 PMBus 不是另一组引脚，也不要求换一套控制器寄存器。真正需要回答的是：

> **同一笔电压读取，raw I2C、SMBus 辅助函数和 Linux PMBus/hwmon 三条路径分别替我完成什么，还有什么必须由自己完成？**

本篇始终读取同一颗 TPS40422 的第二路输出：

```text
7 位地址       0x30
目标页         PAGE = 1
数据格式       VOUT_MODE = 0x17，线性模式，指数 -9
测量命令       READ_VOUT = 0x8B
线上返回       00 03，低字节在前
原始字         0x0300 = 768
电压           768 × 2^(-9) = 1.5 V
hwmon 文本     1500，单位为 mV
```

三条路径是：

- **路径 A：raw I2C。** 用 `i2c_transfer()` 构造消息，自己管理 PMBus 命令、PAGE 和电压解码。
- **路径 B：SMBus 辅助函数。** 用 `i2c_smbus_*()` 复用固定事务，PAGE 和电压解码仍由自己管理。
- **路径 C：Linux pmbus＋hwmon。** 器件驱动声明能力，通用核心处理页、读取和解码，hwmon 导出毫伏文本。

阅读本篇需要 B-B.3.2 的重复 START、读写方向，以及 B-B.3.3 的 `i2c_client`、`i2c_msg` 和 `i2c_transfer()`。Linux 对象与调用关系以 v6.6 源码为基准。`00 03` 是为讲解设定的确定性样本，不是上板实录。

---

## <span class="blue">一、先分清四层工作，再开始写代码

### I2C 负责传送字节

I2C 规定地址、START／STOP、读写方向和逐字节应答。它能从地址 `0x30` 读回两个字节，却不知道命令 `0x8B` 代表输出电压，也不知道 `00 03` 应怎样换算。

### SMBus 固定常用事务的形状

SMBus（System Management Bus）沿用两线传输，把常见操作定义为固定事务。本篇只用其中两种：

- **Byte Data**：一个命令码加一个数据字节，用于读写 PAGE、读取 VOUT_MODE。
- **Word Data**：一个命令码加两个数据字节，低字节先传，用于 READ_VOUT。

Word Data Read 的线上顺序是：

```text
S → 地址+W → 命令码 → Sr → 地址+R → 低字节 → 高字节 → P
```

`S`、`Sr`、`P` 分别是 START、重复 START、STOP。SMBus 统一了这笔事务怎样组织，仍不规定 `0x8B` 的电源语义。

### PMBus 规定命令和数据含义

PMBus（Power Management Bus）在 SMBus 事务上定义电源命令：

- `PAGE (0x00)` 选择后续页相关命令作用于哪一路；
- `VOUT_MODE (0x20)` 描述输出电压的数据格式；
- `READ_VOUT (0x8B)` 读取实测输出电压，不是目标设定值。

PMBus 允许器件支持不同命令子集，具体芯片手册仍是最终依据。不能看到一颗 I2C 电源芯片，就假定它一定支持这三个命令。

### pmbus＋hwmon 把器件语义接入系统

Linux 的 pmbus 核心复用页管理、命令读取和数据解码；hwmon（硬件监控）把结果导出为统一属性。应用读取毫伏文本，不再为每家芯片各写一套用户态解析。

因此，三条路径不是三种物理总线，而是**同一笔工作由谁实现**的三种选择。

---

## <span class="blue">二、实验前提：地址、页和测量点都不能凭空假定

### `0x30` 怎样由地址引脚得到

TPS40422 的 ADDR1、ADDR0 通过电阻选择两位八进制地址，共可配置 64 个地址。本例选择：

```text
0x30 = 48 = 060₈
ADDR1 数字 6，ADDR0 数字 0
```

手册表 8-3 对应的示例电阻分别为 `127 kΩ` 和 `11 kΩ`。所以 DTS 中的 `reg = <0x30>` 不是软件随意选号，而是对原理图和实际贴片的描述。更换电阻或复用别块板卡时，必须重新核对，不能照抄。

### PAGE 选择哪一路，也影响读命令

本例 `PAGE=0` 选择第一路，`PAGE=1` 选择第二路。手册还规定：

- `PAGE=2` 是非法选择，器件忽略该写入；
- `PAGE=3` 同时选择两路，适合需要同时作用于两路的写操作；
- 对页相关读命令，`PAGE=3` 仍只返回第一通道的数据。

因此 `PAGE=3` 不是“向总线上所有器件广播”，也不能用它一笔读回两路电压。本例固定写 `PAGE=1`，并读回确认。

### READ_VOUT 在哪里采样

手册说明 READ_VOUT 在远程检测放大器输出端采样，**不计算从该检测点到负载之间的线路压降**。若万用表接在负载端，读数与芯片遥测存在差异时，应先核对测量点、线路压降和仪器误差，不能直接判定协议或解码错误。

---

## <span class="blue">三、路径 A：用 raw I2C 自己完成整笔读取

路径 A 先建立完整基线。只有看到这里需要自己做多少事，后面的“SMBus 消除了什么”才有可比对象。

### 一条 Word Data Read 为什么需要两条消息

`demo_raw_read_word_data()` 位于本篇原创 [pmbus_vout_demo.c](./code/B-B.3.6/pmbus_vout_demo.c)。第一条消息写命令，第二条消息读两字节：

```c title="code/B-B.3.6/pmbus_vout_demo.c；raw Word Data Read 的消息主体"
u8 command_buf[1] = { command };       /* 本例 command = 0x8B */
u8 data_buf[2];
struct i2c_msg msgs[2] = {
    {
        .addr = client->addr,           /* 本例为 0x30 */
        .flags = client->flags,         /* 写方向 */
        .len = 1,
        .buf = command_buf,
    }, {
        .addr = client->addr,
        .flags = client->flags | I2C_M_RD,
        .len = 2,                       /* 接收低字节、高字节 */
        .buf = data_buf,
    },
};

ret = i2c_transfer(client->adapter, msgs, 2);
```

`I2C_M_RD` 只把第二条消息标为读。两条消息放在同一次 `i2c_transfer()` 调用中，Core 和控制器才能按复合事务用重复 START 连接它们；拆成两次独立传输就可能插入 STOP，语义不再相同。

`i2c_transfer()` 的返回值需要单独判断：

```c
ret = i2c_transfer(client->adapter, msgs, 2);
ret = demo_xfer_result(ret, 2);
if (ret < 0)
    return ret;

*value = (u16)data_buf[0] | ((u16)data_buf[1] << 8);
```

负值是控制器或 Core 返回的错误；非负值表示完成的消息数。本例必须等于 2，否则 `demo_xfer_result()` 转成 `-EIO`。只有传输成功后，缓冲区内容才可使用。`00 03` 在最后一行组成 `0x00 | (0x03 << 8) = 0x0300`。

### 完整读取不是一次函数调用，而是有序状态迁移

`demo_read_vout_raw()` 把三个 PMBus 命令组织成以下顺序：

```text
读旧 PAGE
→ 写 PAGE=1
→ 读回 PAGE，确认等于 1
→ 读 VOUT_MODE，确认等于 0x17
→ 读 READ_VOUT
→ 恢复旧 PAGE，并读回确认
→ 解码原始字
```

关键控制流如下，完整函数可在源文件或文末实验室中展开：

```c title="code/B-B.3.6/pmbus_vout_demo.c；路径 A 的页选择、读取与统一恢复"
ret = demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &old_page);
if (ret < 0)
    return ret;                       /* 尚未改页，不需要恢复 */

ret = demo_select_page_raw(client, DEMO_TARGET_PAGE);
if (ret < 0)
    goto restore_page;

ret = demo_raw_read_byte_data(client, DEMO_VOUT_MODE_CMD, &mode);
if (ret < 0)
    goto restore_page;
if (mode != DEMO_EXPECTED_MODE) {
    ret = -EOPNOTSUPP;                /* 不是本例声明支持的格式 */
    goto restore_page;
}
reading->mode = mode;

ret = demo_raw_read_word_data(client, DEMO_READ_VOUT_CMD,
                              &reading->raw);

restore_page:
restore_ret = demo_select_page_raw(client, old_page);
if (restore_ret < 0) {
    dev_err(&client->dev, "restore PAGE=%u failed: %d\n",
            old_page, restore_ret);
    if (ret == 0)
        ret = restore_ret;
}
return ret;
```

这里有两个容易漏掉的判断：

1. **写 PAGE 返回成功，不代表器件接受了页号。** `demo_select_page_raw()` 写后还会读回；不一致返回 `-EIO`。
2. **恢复也是读取的一部分。** 如果读取成功而恢复失败，调用者不能收到成功；如果读取和恢复都失败，函数保留最初的读取错误，同时用 `dev_err()` 留下恢复失败记录。

调用者只在返回 0 时使用 `reading->raw`，避免把半次读取留下的缓冲区内容当成新样本。

### `old_page` 是独立副本，PAGE 却是共享状态

`old_page` 位于本次函数调用的栈上，属于访问者自己；PAGE 位于 TPS40422 内部，同一物理地址下的访问者都能改它。保存副本并不能冻结芯片状态。

考虑两个未经协调的访问者：

```text
A：读旧 PAGE=0，old_page_A=0
A：写 PAGE=1，准备读第二路
B：写 PAGE=0，准备读第一路
A：执行 READ_VOUT，实际读到第一路
A：恢复 old_page_A=0
```

A 最后的恢复动作无法修正已经发生的错误采样。单次 `i2c_transfer()` 能保护本调用内的消息序列，却不会把“读旧页—切页—读模式—读电压—恢复”整个函数自动变成原子操作。多访问者必须共用一把锁，或暂停其他访问路径。

### 解码需要另一个命令提供指数

VOUT_MODE 的高三位表示格式，低五位表示五位补码指数。本例 `0x17 = 000 10111`：

```text
高三位 000     线性模式
低五位 10111   23 - 32 = -9
```

这与 LINEAR11 不同。LINEAR11 从同一个 16 位数据字中拆出 5 位指数和 11 位尾数；本例输出电压使用 Linux 所称的 LINEAR16 分支，完整 16 位字作为无符号尾数，指数由 VOUT_MODE 单独提供。

因此不能把 `0x0300` 直接当毫伏，也不能给它套 LINEAR11：

```text
X = 0x0300 = 768
V = X × 2^(-9) = 768 / 512 = 1.5 V
hwmon 毫伏值 = 768 × 1000 >> 9 = 1500
```

用文字完整复述这条链：线上低、高字节 `00 03` 先组成 `0x0300`，得到尾数 768；VOUT_MODE 提供指数 -9，所以电压是 **768 / 512 = 1.5 V**；再乘 1000 变成 **1500 mV**。三个数字分别属于总线数据、物理电压和 hwmon 文本，不能跳过中间步骤直接画等号。

教学函数 `demo_decode_mv()` 用整数移位完成同一计算，避免内核浮点运算。它先检查高三位，再把低五位解释成有符号指数。

TPS40422 手册的 READ_VOUT 段落还出现 `two's complement binary` 表述，而 Linux v6.6 对 `PSC_VOLTAGE_OUT` 明确执行 `(u16)sensor->data`。本篇只核验本例正数样本的共同路径，不据此宣称所有负值或异常编码行为已经验证。

到这里，路径 A 已完整实现：消息构造、页选择、模式检查、恢复、解码和错误传播。**不用 SMBus／PMBus 框架，并不等于不用实现这些协议语义。**

---

## <span class="blue">四、路径 B：SMBus 只替换固定事务，不替我管理电源语义

### 同一组操作改写成辅助函数

路径 B 的外层顺序不变，变化发生在每个 Byte／Word Data 怎样表达：

```c title="路径 B：辅助函数返回值同时承载数据和错误"
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

value = i2c_smbus_read_word_data(client, DEMO_READ_VOUT_CMD);
if (value < 0) {
    ret = value;
    goto restore_page;
}
reading->raw = (u16)value;
```

读取函数返回 `s32`，即 32 位有符号整数：负值是错误码，非负值才是数据。写函数成功返回 0，失败返回负错误。必须先检查 `value < 0`，再缩窄为 `u16`；否则负错误可能伪装成很大的原始电压。

路径 B 少写的是：

- 两条 `i2c_msg` 的初始化；
- `I2C_M_RD` 和消息数；
- 传输结果的消息数检查；
- 低、高字节组合。

它**没有**替我写旧页保存、PAGE 顺序、VOUT_MODE 判断、恢复和电压换算。`demo_read_vout_smbus()` 与路径 A 因而保留相同的外层控制流。

### 辅助函数最终仍进入同一个 I2C 控制器

以 `i2c_smbus_read_word_data()` 为例，v6.6 的 [i2c-core-smbus.c](./code/B-B.3.6/linux-v6.6/drivers/i2c/i2c-core-smbus.c) 先把事务类型设为 `I2C_SMBUS_WORD_DATA`、方向设为 `I2C_SMBUS_READ`，再经 `i2c_smbus_xfer()` 加锁，进入 `__i2c_smbus_xfer()` 选择执行路径：

- 适配器提供 `algo->smbus_xfer()` 时，可原生执行 SMBus；
- 没有该方法时，`i2c_smbus_xfer_emulated()` 构造普通 `i2c_msg`；
- 原生方法返回 `-EOPNOTSUPP`，且适配器仍有 `master_xfer` 时，也回退到模拟路径。

模拟路径对 Word Data Read 设置一条命令写消息和一条两字节读消息，成功后执行：

```c title="Linux v6.6 i2c-core-smbus.c:493-496；模拟 SMBus 组合原始字"
case I2C_SMBUS_WORD_DATA:
case I2C_SMBUS_PROC_CALL:
    data->word = msgbuf1[0] | (msgbuf1[1] << 8);
    break;
```

这与路径 A 的关键行完全对应。SMBus 不是绕过 I2C Core 的另一套驱动，而是固定事务的表达与执行复用。

### 超时和 PEC 也不能只凭函数名推定

SMBus 还规定普通 I2C 没有统一规定的管理行为。`tTIMEOUT` 用于从持续拉低时钟的异常中恢复，`tLOW:SEXT` 限制从设备在一笔消息中累计延展时钟的时间。PEC（Packet Error Checking）可在事务末尾增加 CRC-8 校验字节，用于检错而不是纠错。

这些能力要求控制器、外设和软件配置共同支持。PEC 校验通过只能说明这笔事务未被发现字节损坏，不能证明页选对了、采样的是第二路或电压解码正确。

本篇教学模块比较的是**不带 PEC** 的消息。正式驱动解绑后可能在 client 中留下 PEC 标志，所以 probe 在受控读取期间暂时清除 `I2C_CLIENT_PEC`，读取结束恢复原标志；这不等于实现了 PEC。

---

## <span class="blue">五、A/B 实验：每次只走一条路径，分别观察证据

### DTS 先创建实验要操作的 client

原创 [rk3568-tps40422.dts](./code/B-B.3.6/rk3568-tps40422.dts) 是板级片段，应合并到 BSP 中实际连接芯片的 DTS；`i2c2` 只是示例标签：

```dts title="code/B-B.3.6/rk3568-tps40422.dts；板级片段，不能独立部署"
&i2c2 {
    status = "okay";
    clock-frequency = <100000>;

    pmbus@30 {
        compatible = "ti,tps40422";
        reg = <0x30>;       /* 必须与 ADDR1/ADDR0 的实际配置一致 */
    };
};
```

`reg` 给出 7 位地址，`compatible` 描述器件型号。I2C Core 根据可用子节点创建 `i2c_client`，client 名称可由首个 compatible 去掉厂商前缀得到 `"tps40422"`，随后与驱动的 I2C ID 表匹配。节点名 `pmbus` 只用于可读性，不参与这里的匹配。

该片段没有在本工作区编译或部署。正式项目还应按目标内核水线的设备树绑定检查整棵 DTS。

### 完整文件和构建入口

教学文件为：

- [pmbus_vout_demo.c](./code/B-B.3.6/pmbus_vout_demo.c)：完整外部模块，raw 与 SMBus 两条读取函数共用解码和错误约定；
- [Makefile](./code/B-B.3.6/Makefile)：外部模块构建入口；
- [rk3568-tps40422.dts](./code/B-B.3.6/rk3568-tps40422.dts)：板级硬件描述片段。

`KDIR` 必须指向已经为目标板配置并准备过外部模块构建的内核源码树，`ARCH` 和 `CROSS_COMPILE` 按实际工具链调整：

```bash title="在 code/B-B.3.6 目录执行"
make KDIR=/path/to/linux
```

成功后应生成 `pmbus_vout_demo.ko`。构建产物只证明代码通过了该次构建，不证明芯片已经应答。

### 解绑正式驱动，再分别加载两种模式

教学驱动与正式 `tps40422` 驱动不能同时绑定同一 client。下面命令只允许在可以暂停电源监控的测试板上执行；设备名 `2-0030` 也必须先按 `/sys/bus/i2c/devices/` 的实际情况替换：

```bash title="路径 B：SMBus 辅助函数"
echo 2-0030 > /sys/bus/i2c/drivers/tps40422/unbind
insmod pmbus_vout_demo.ko mode=0
dmesg | tail -n 20
rmmod pmbus_vout_demo
```

```bash title="路径 A：raw I2C"
insmod pmbus_vout_demo.ko mode=1
dmesg | tail -n 20
rmmod pmbus_vout_demo
```

模块参数 `mode=0` 选择 SMBus，`mode=1` 选择 raw I2C。每次加载只读取一次，避免把两个不同时刻的实时电压强制比较为相等。

若本例样本在真实板上出现，日志形式应为：

```text
path=smbus page=1 mode=0x17 wire=00 03 raw=0x0300 vout=1500 mV
```

或：

```text
path=raw page=1 mode=0x17 wire=00 03 raw=0x0300 vout=1500 mV
```

这是依据代码写出的**预期形式，不是实测日志**。真实输出电压可以不是 1.5 V；应根据实际模式、原始字和指数重新计算。若出现 NACK、短消息、PAGE 读回不一致、模式不符或恢复失败，模块返回相应负错误，不能把缓冲区中的旧值当结果。

实验结束后恢复正式绑定：

```bash
echo 2-0030 > /sys/bus/i2c/drivers/tps40422/bind
```

---

## <span class="blue">六、路径 C：现成驱动怎样创建 `in2_input`

### 器件驱动只声明这颗芯片具备什么

v6.6 已有 [tps40422.c](./code/B-B.3.6/linux-v6.6/drivers/hwmon/pmbus/tps40422.c)。`CONFIG_SENSORS_TPS40422` 提供器件模块，`CONFIG_PMBUS` 提供通用 `pmbus_core`。器件驱动的主体很短：

```c title="Linux v6.6 tps40422.c:15-30"
static struct pmbus_driver_info tps40422_info = {
    .pages = 2,
    .format[PSC_VOLTAGE_IN] = linear,
    .format[PSC_VOLTAGE_OUT] = linear,
    .format[PSC_TEMPERATURE] = linear,
    .func[0] = PMBUS_HAVE_VOUT | PMBUS_HAVE_TEMP2
        | PMBUS_HAVE_STATUS_VOUT | PMBUS_HAVE_STATUS_TEMP
        | PMBUS_HAVE_IOUT | PMBUS_HAVE_STATUS_IOUT,
    .func[1] = PMBUS_HAVE_VOUT | PMBUS_HAVE_TEMP2
        | PMBUS_HAVE_STATUS_VOUT | PMBUS_HAVE_STATUS_TEMP
        | PMBUS_HAVE_IOUT | PMBUS_HAVE_STATUS_IOUT,
};

static int tps40422_probe(struct i2c_client *client)
{
    return pmbus_do_probe(client, &tps40422_info);
}
```

`pages=2` 表示两个 PMBus 页；`format[]` 按传感器类别声明数据格式；`func[]` 按页声明可创建的命令和状态能力。两页都有 `PMBUS_HAVE_VOUT`，通用核心才会为两路输出电压创建属性。

### `pmbus_data` 和 `pmbus_sensor` 分别保存什么

[pmbus_core.c](./code/B-B.3.6/linux-v6.6/drivers/hwmon/pmbus/pmbus_core.c) 中，两个对象承担不同职责：

```c title="Linux v6.6 pmbus_core.c:33-45；一个传感器的读取上下文"
struct pmbus_sensor {
    struct pmbus_sensor *next;
    char name[PMBUS_NAME_SIZE];
    struct device_attribute attribute;
    u8 page;                    /* 要读哪一页 */
    u8 phase;
    u16 reg;                    /* 要读哪个命令 */
    enum pmbus_sensor_classes class;
    bool update;                /* 每次显示是否重新读取 */
    bool convert;
    int data;                   /* 非负为原始字，负值为读取错误 */
};
```

```c title="Linux v6.6 pmbus_core.c:81-111；整颗器件共享的运行状态"
struct pmbus_data {
    struct device *dev;
    struct device *hwmon_dev;
    /* 省略与本例无关的 regulator、debugfs 等字段 */
    int exponent[PMBUS_PAGES];  /* 每页输出电压指数 */
    const struct pmbus_driver_info *info;
    struct pmbus_sensor *sensors;
    struct mutex update_lock;
    s16 currpage;               /* 驱动认为的芯片当前页 */
    s16 currphase;
    /* 其余字段暂不展开 */
};
```

`pmbus_do_probe()` 用设备管理资源分配 `pmbus_data`，关联到 client，初始化 `update_lock`，并把 `currpage=-1`：没有可信页缓存时，第一次读取不能盲目跳过写 PAGE。各 `pmbus_sensor` 初始 `data=-ENODATA`，表示还没有有效样本。

`cat` 结束后这些对象继续存在；驱动解绑时，设备管理框架清理已注册的 hwmon 和相关资源。DTS 创建的 client 不会因一次驱动解绑自动消失。

### 为什么第二页叫 `in2_input`，不是猜出来的

`pmbus_find_attributes()` 用名称 `"in"` 处理电压属性表。表依次检查 VIN、VMON、VCAP、READ_VOUT，编号从 1 开始。TPS40422 没有声明前三种输入电压能力，所以它们不创建属性，也不消耗编号；两页 VOUT 依次得到编号 1、2。

创建函数把 page、reg 和 class 写入 sensor，并拼出属性名：

```c title="Linux v6.6 pmbus_core.c:1515-1516；把读取上下文交给传感器"
base = pmbus_add_sensor(data, name, "input", index, page, phase,
                        attr->reg, attr->class, true, true, true);
```

```c title="Linux v6.6 pmbus_core.c:1347-1366；名称、读取回调与初始状态"
if (type)
    snprintf(sensor->name, sizeof(sensor->name), "%s%d_%s",
             name, seq, type);

sensor->page = page;
sensor->reg = reg;
sensor->class = class;
sensor->update = update;
sensor->data = -ENODATA;
pmbus_dev_attr_init(a, sensor->name,
                    readonly ? 0444 : 0644,
                    pmbus_show_sensor, pmbus_set_sensor);
```

对本例第二页，`name="in"`、`seq=2`、`type="input"`，所以得到 `in2_input`。该 sensor 同时保存 `page=1`、`reg=PMBUS_READ_VOUT`、`class=PSC_VOLTAGE_OUT`，下一次读取不再需要应用提供这些参数。

hwmon 目录编号由注册顺序决定，不能写死 `hwmon2`。先按器件名查找：

```bash title="目标板：先定位 tps40422，再核对第二路标签和读数"
for d in /sys/class/hwmon/hwmon*; do
    if [ "$(cat "$d/name")" = "tps40422" ]; then
        echo "$d"
        cat "$d/in2_label"
        cat "$d/in2_input"
    fi
done
```

本例预期标签为 `vout2`。若实际遥测与设定样本一致，输入值为 `1500`；这只是预期示例，不是当前已取得的板卡输出。

---

## <span class="blue">七、跟随一次 `cat in2_input`：锁、页、原始字和错误

### sysfs 属性怎样找回传感器并串行化访问

`cat` 对属性文件发起读操作，sysfs 调用创建属性时登记的 `pmbus_show_sensor()`。完整函数只有十余行，但包含本例全部错误分界：

```c title="Linux v6.6 pmbus_core.c:1139-1155"
static ssize_t pmbus_show_sensor(struct device *dev,
                 struct device_attribute *devattr, char *buf)
{
    struct i2c_client *client = to_i2c_client(dev->parent);
    struct pmbus_sensor *sensor = to_pmbus_sensor(devattr);
    struct pmbus_data *data = i2c_get_clientdata(client);
    ssize_t ret;

    mutex_lock(&data->update_lock);
    pmbus_update_sensor_data(client, sensor);
    if (sensor->data < 0)
        ret = sensor->data;
    else
        ret = sysfs_emit(buf, "%lld\n", pmbus_reg2data(data, sensor));
    mutex_unlock(&data->update_lock);
    return ret;
}
```

`to_pmbus_sensor(devattr)` 从当前 sysfs 属性找回它所属的 sensor，因此这次调用拿到的是 `page=1` 的那个对象。`update_lock` 随后把本驱动的“切页—读原始字—更新缓存—解码”串行化。

本例 sensor 的 `update=true`，所以 `pmbus_update_sensor_data()` 每次都重新读，而不是把上一次的 `0x0300` 永久当成当前电压：

```c title="Linux v6.6 pmbus_core.c:640-645"
static void pmbus_update_sensor_data(struct i2c_client *client,
                                     struct pmbus_sensor *sensor)
{
    if (sensor->data < 0 || sensor->update)
        sensor->data = _pmbus_read_word_data(client, sensor->page,
                                             sensor->phase, sensor->reg);
}
```

`_pmbus_read_word_data()` 经通用读取入口调用 `pmbus_set_page()` 和 `i2c_smbus_read_word_data()`。返回的原始字或负错误都写入 `sensor->data`；显示函数检查符号，负值直接作为错误返回，不进入解码。

### 页缓存为什么能减少写页，又为什么怕外部绕过

`pmbus_set_page()` 不是每次机械写页：

```c title="Linux v6.6 pmbus_core.c:169-182；缓存不命中才写页并读回"
if (!(data->info->func[page] & PMBUS_PAGE_VIRTUAL) &&
    data->info->pages > 1 && page != data->currpage) {
    rv = i2c_smbus_write_byte_data(client, PMBUS_PAGE, page);
    if (rv < 0)
        return rv;

    rv = i2c_smbus_read_byte_data(client, PMBUS_PAGE);
    if (rv < 0)
        return rv;

    if (rv != page)
        return -EIO;
}
data->currpage = page;
```

`currpage` 与目标相同就省略重复写页；不同才写入并读回，成功后才更新缓存。正式驱动也不像教学函数那样每次恢复旧页，而是在锁内保留当前页，让下一次访问按需切换。

这把锁和这份缓存只约束愿意配合的访问者。若调试程序通过 `/dev/i2c-N` 直接写 PAGE：

- 它不会持有 `pmbus_data.update_lock`；
- 它不会同步修改 `pmbus_data.currpage`；
- pmbus 核心可能看到缓存已等于目标页而跳过写页，实际芯片却已被调试程序切走。

所以正式驱动工作期间，不应无协调地手工切页。需要调试时，应暂停正式访问，或使用与驱动协调的接口。

### `0x0300` 怎样在正式驱动中成为 `1500`

初始化阶段，`pmbus_identify_common()` 读取 VOUT_MODE，用 `((s8)(vout_mode << 3)) >> 3` 取得低五位的有符号指数，并保存到 `data->exponent[page]`。本例第 1 页因此保存 `-9`。

显示阶段按传感器类别选择公式：

```c title="Linux v6.6 pmbus_core.c:718-739；输出电压与其他 LINEAR11 数据分支不同"
if (sensor->class == PSC_VOLTAGE_OUT) {    /* LINEAR16 */
    exponent = data->exponent[sensor->page];
    mantissa = (u16)sensor->data;
} else {                                  /* LINEAR11 */
    exponent = ((s16)sensor->data) >> 11;
    mantissa = ((s16)((sensor->data & 0x7ff) << 5)) >> 5;
}

val = mantissa;
if (sensor->class != PSC_FAN)
    val = val * 1000LL;
if (exponent >= 0)
    val <<= exponent;
else
    val >>= -exponent;
```

本例 `class=PSC_VOLTAGE_OUT`，所以走第一分支：

```text
sensor->page = 1
sensor->data = 0x0300
exponent[1] = -9
val = 768 × 1000 >> 9 = 1500
sysfs_emit() 写入 "1500\n"
```

若总线读取或 PAGE 读回失败，`sensor->data` 是负错误，`pmbus_show_sensor()` 在解锁后把错误返回读取方。`cat` 因而表现为读取失败，而不是输出一个由错误码转换来的虚假电压。

至此，完整读取链可以独立复述为：

```text
cat in2_input
→ pmbus_show_sensor() 找到 page=1 的 sensor 并加锁
→ pmbus_update_sensor_data() 发起新的 Word Data Read
→ pmbus_set_page() 按需写 PAGE=1、读回并更新 currpage
→ i2c_smbus_read_word_data() 取得 0x0300，或负错误
→ sensor->data 保存结果
→ 非负时按 exponent[1]=-9 解码
→ sysfs_emit() 输出 1500；负值则向 cat 返回错误
→ 解锁，对象留待下一次读取
```

---

## <span class="blue">八、交互实验室：把三条路径放到同一个确定性模型中

正文已经独立给出机制；实验室用于逐步核对代码位置、对象状态和返回值。可切换 raw、原生／模拟 SMBus、PAGE 交错、解码、正式驱动以及 PAGE 读回失败等场景，并在“步骤片段／完整函数”之间切换。

<div class="interactive-demo">
  <iframe
    src="../html/pmbus-lab.html"
    title="B-B.3.6 SMBus 与 PMBus 交互实验室"
    loading="lazy"
    style="width:100%;height:980px;border:0;"
  ></iframe>
</div>

[在新标签页打开 PMBus Lab](./html/pmbus-lab.html){: target="_blank" rel="noopener noreferrer" }。页面是**源码状态模型，不是 TPS40422 硬件仿真**；确定性样本用于验证理解，不证明已经编译、运行、产生波形或上板读取。源码快照与验证边界另见 [SOURCES](./code/B-B.3.6/SOURCES.md)。

---

## <span class="blue">九、怎样选择路径，怎样判断验证到了哪一层

**路径 A** 适合需要逐条控制消息、处理非标准厂商事务或排障观察的场景。代价是 PAGE 协调、格式、恢复和系统集成都由自己维护。

**路径 B** 适合器件使用标准 SMBus 事务，但产品只需少量自有命令处理的场景。它减少消息样板代码，却不减少器件协议责任。

**路径 C** 适合芯片已有可靠 Linux 驱动、系统需要标准监控接口的场景。应优先复用并核对现有实现，而不是在用户态重新发明一套页管理和解码。

验证时应分开回答：

1. **总线是否成功**：地址是否应答，消息数和返回值是否符合预期；
2. **事务是否符合 SMBus**：命令写、重复 START、低高字节和可选 PEC 是否正确；
3. **PMBus 语义是否正确**：目标 PAGE、VOUT_MODE 和 READ_VOUT 是否匹配；
4. **系统导出是否正确**：`in2_label/in2_input`、指数缓存、错误返回是否符合源码；
5. **实际电压是否可信**：遥测采样点与仪器测量点是否一致，线路压降和测量误差是否已考虑；
6. **电源性能是否合格**：还需目标设定、负载、纹波、动态响应等专门测试，不能由一次 `cat` 代替。

---

## <span class="blue">本节自查 Q&A

??? details "Q1. 只用 i2c_transfer()，是否就不用管 PMBus？"
    不是。`i2c_transfer()` 只承载字节传输。要读取 TPS40422，仍须保存并选择 PAGE、读取 VOUT_MODE、发出 READ_VOUT、恢复页并按器件规则解码。协议工作只是从通用框架搬到了自己的代码。

??? details "Q2. i2c_smbus_read_word_data() 返回 0x0300，是否已经知道电压是 1.5 V？"
    不知道。该函数负责 Word Data 事务和低高字节组合，不知道 `0x8B` 的电源含义，也不知道 VOUT_MODE 给出的指数。1.5 V 还需要 PMBus 语义层计算。

??? details "Q3. A 已把 old_page 保存在栈上，B 为什么仍能让 A 读错通道？"
    old_page 是 A 的独立副本，READ_VOUT 读取的却是芯片内共享 PAGE。A 写入 PAGE=1 后，B 可在 A 读取前改成 PAGE=0；A 随后得到第一路数据，最后恢复旧页也无法修正这次采样。

??? details "Q4. 00 03 和 0x17 为什么最终得到 1500？"
    Word Data 低字节先传，所以原始字是 `0x0300=768`。`0x17` 指定线性模式和五位补码指数 `-9`，因此电压为 `768/512=1.5 V`；hwmon 电压输入以毫伏为文本单位，输出 `1500`。

??? details "Q5. 三条路径各自消除了哪部分工作？"
    路径 A 全部自己实现；路径 B 复用固定 SMBus 事务，但仍自己处理 PMBus 语义；路径 C 再复用器件能力声明、页管理、读取、解码和 hwmon 导出。三者最终都经过同一个 I2C 控制器。

??? details "Q6. 为什么第二页是 in2_input？"
    电压属性从编号 1 开始，依次检查 VIN、VMON、VCAP、READ_VOUT。TPS40422 只声明两页 VOUT，前三种不消耗编号；第 0 页得到 `in1_input`，第 1 页得到 `in2_input`。sensor 中同时保存 `page=1` 和 `reg=READ_VOUT`。

??? details "Q7. update_lock 和 currpage 能防止 /dev/i2c-N 手工切页吗？"
    不能。它们只协调使用同一 `pmbus_data` 的访问者。外部调试不写 `currpage`，也不持有 `update_lock`，可能让缓存与芯片实际页不一致。应暂停正式访问或使用协调接口。

??? details "Q8. in2_input 出现并读到 1500，能证明什么，不能证明什么？"
    属性出现支持 probe 和属性注册已走到相应阶段；一次合理读数支持本次通信、页选择和解码判断。它不能单独证明每次通信都正确，也不能证明仪器测量点一致，更不能证明纹波、动态响应等实际电源性能合格。
