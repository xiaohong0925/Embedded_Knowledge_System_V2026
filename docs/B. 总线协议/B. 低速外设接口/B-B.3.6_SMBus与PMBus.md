# B-B.3.6 SMBus 与 PMBus

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] Beginner → Intermediate | 预计阅读时间：40 分钟

## <span class="blue">本节导读：同样两根线，协议各自增加了什么

B-B.3.2 已经讲清 I2C 怎样传输地址和字节，B-B.3.3 又沿一笔 AT24C02 读取走通了 Linux I2C Core 与控制器。可到了系统管理和电源芯片资料中，同样的 SDA、SCL 又被称为 SMBus、PMBus，Linux 还同时提供 `i2c_smbus_*()` 和 pmbus 驱动。它们究竟是不是不同的硬件，软件又分别在哪一层工作？

本篇只回答一个主问题：**I2C、SMBus、PMBus 如何逐层增加约束，一笔输出电压读取又怎样从 PMBus 命令变成 hwmon 中的 1500 mV？**

先建立全文使用的责任线：

```text
I2C：两线电气基础、地址、START/STOP、逐字节收发与 ACK/NACK
  ↓ 沿用基础并增加系统管理约束
SMBus：固定事务格式、时钟低超时、时钟延展限制、可选 PEC
  ↓ 以 SMBus 事务承载电源领域命令
PMBus：PAGE、VOUT_MODE、READ_VOUT、状态与电源数据格式
  ↓ 由 Linux 驱动解码并统一导出
pmbus + hwmon：页选择与读取、数值转换、标准单位和 sysfs 文件
```

这里的箭头表示能力逐层承接，不表示所有下层设备都自动满足上层规范。普通 AT24C02 可以借用一种 SMBus 字节格式，却不会因此变成完整的 SMBus 器件；能执行 SMBus Word Data 的芯片，也不会自动理解 PMBus 的 `READ_VOUT`。

阅读本篇需要 B-B.3.2 的重复 START 和读写方向，以及 B-B.3.3 的 `i2c_client`、`i2c_msg`、`i2c_transfer()`。规范边界参考 [SMBus 3.3.1](https://smbus.org/specs/SMBus_3_3_1_20241020.pdf) 与 [PMBus 1.3.1 Part II](https://pmbus.org/wp-content/uploads/2022/01/PMBus-Specification-Rev-1-3-1-Part-II-20150313.pdf)，Linux 调用链以本地 v6.6 源码为核对基准。

---

## <span class="blue">第一层：I2C 传字节，但不统一字节含义

I2C 规定设备地址怎样上线、数据按什么节拍传输、接收方怎样应答，却没有统一规定所有器件的第一个数据字节必须是“命令”，也没有统一命令字后面的数据长度和数值格式。

以 AT24C02 为例，软件先写存储地址 `0x10`，再用重复 START 读一个字节。这里的 `0x10` 是 EEPROM 内部位置，是 AT24C02 自己规定的含义。换一颗传感器，同一个线上字节可能表示配置寄存器；换一颗电源芯片，它又可能表示 PMBus 命令码。

因此，“I2C 读成功”只说明地址、方向和字节传输完成。至于读回的是 EEPROM 内容、温度原始值还是输出电压编码，需要由更上层的器件协议解释。

SMBus 和 PMBus 正是在这个空缺上工作：SMBus 先统一一批事务形状，PMBus 再规定电源设备使用哪些命令、命令返回什么电源语义。

---

## <span class="blue">第二层：SMBus 把系统管理事务固定下来

### 命令码不是设备地址

SMBus 的许多事务在设备地址之后发送一个 Command Code，本文译为命令码。它用于选择从设备内部的操作，与 I2C 地址承担的任务不同：

- **设备地址**选择总线上的哪颗芯片。
- **命令码**选择这颗芯片要执行的哪项操作。
- **数据字节**承载该操作的输入或输出。

以 SMBus Byte Data Read 为例，线上顺序为：

```text
S → 设备地址+W → Command Code → Sr → 设备地址+R → Data → NACK → P
```

`S`、`Sr`、`P` 分别是 START、重复 START、STOP。第一段写告诉从设备“接下来要读哪个命令”，第二段再切换方向取回一个字节。它与 B-B.3.2 的寄存器读取形状一致，所以普通 I2C 控制器可以在不提供专用 SMBus 硬件方法时实现它。

常见事务的差别不能只看函数名：

| 事务 | 命令码后的数据形状 | 读取时谁决定长度 |
|---|---|---|
| Byte | 没有独立命令码，只收发一个字节 | 固定为 1 字节 |
| Byte Data | 一个命令码加一个字节 | 固定为 1 字节 |
| Word Data | 一个命令码加两个字节，低字节在前 | 固定为 2 字节 |
| SMBus Block | 数据前有 Count，最多 32 字节 | Block Read 由从设备返回 Count |
| I2C Block | 没有 SMBus 的 Count 字段，Linux 接口同样最多 32 字节 | 调用方在读取前指定长度 |

最后两行尤其容易混淆。SMBus Block Read 的线上数据包含长度字节，I2C Block Read 则按调用方预定长度接收；把二者只当作同一函数的两个别名，会直接导致缓冲区长度和字节解释错误。

### 超时和延展限制让异常总线能够恢复

普通 I2C 允许主设备在事务中暂停，也允许从设备通过时钟延展争取处理时间，但 I2C 本身没有与 SMBus 相同的统一恢复时限。若系统管理设备永久拉住 SCL，整个管理通道可能无法继续工作。

SMBus 3.3.1 为事务中的时钟行为增加了明确约束：

- `tTIMEOUT` 的检测窗口为 25～35 ms。检测到时钟异常持续拉低的设备应复位通信接口，并在规定时间内恢复接收新 START 的能力。
- `tLOW:TEXT` 限制从设备在一笔消息中累计延展时钟的时间，上限为 25 ms。它约束正常延展的总时长，与检测异常低电平的 `tTIMEOUT` 不是同一个参数。

现行规范列出 100 kHz、400 kHz、1 MHz 三类最高总线速率，事务中的最低工作频率为 10 kHz；总线空闲时不打时钟不属于违规。早期资料中的“10～100 kHz”只覆盖早期速率等级，不能概括现行规范。

这些差异也提醒我们：I2C 与 SMBus 共享基本波形，不等于任意两类器件混挂就一定兼容。仍需检查电平、灌电流、速率、延展和超时条件，不能只检查引脚名称。

### PEC 给整笔事务增加检错，但不负责纠错

PEC（Packet Error Checking）是在事务末尾附加的 CRC-8 校验字节。CRC-8 是 8 位循环冗余校验，接收方根据地址、命令和数据重新计算校验值，再与收到的 PEC 比较，从而发现传输内容是否改变。

PEC 有三个边界：

1. 它检错，不把错误位自动改正确，也不能替代电源或通信故障处理。
2. 它是可选能力，需要器件和主机实现共同支持并启用，不能由软件单方面向不支持 PEC 的器件追加一个字节。
3. 它保护的是一笔事务的字节完整性，不保证命令本身合法，也不保证读取时的 PAGE 选择正确。

Linux 用 `I2C_FUNC_SMBUS_PEC` 表示适配器的 PEC 能力，用 client 的 `I2C_CLIENT_PEC` 标志启用该外设的校验。pmbus 核心还会结合器件 `CAPABILITY` 的返回结果决定是否设置这个标志。

---

## <span class="blue">SMBus 接口在 Linux 中怎样落回普通 I2C

### 普通 I2C EEPROM 为什么能借用 Byte Data

AT24C02 的“先写存储地址，再读一个字节”与 SMBus Byte Data Read 的字节形状一致，因此可以使用 `i2c_smbus_read_byte_data()`。这里复用的是**事务格式**，不是宣称 AT24C02 支持 SMBus 的全部超时、PEC 和系统管理规则。

沿用 B-B.3.3 的教学模块，可以把读取辅助函数替换为下面的版本，并把 `probe()` 中的能力检查改为 `I2C_FUNC_SMBUS_BYTE_DATA`：

```c title="教学代码 · 替换 B-B.3.3 的读取辅助函数"
static int demo_read_reg_smbus(struct i2c_client *client,
                               u8 reg, u8 *value)
{
    s32 ret;                   /* 负错误，或 0～255 的数据字节 */

    ret = i2c_smbus_read_byte_data(client, reg);
    if (ret < 0)
        return ret;            /* 负数不能当作寄存器值 */

    *value = (u8)ret;          /* 非负返回值才是一字节数据 */
    return 0;                  /* 本辅助函数用 0 表示成功 */
}
```

`client` 提供器件地址和所属适配器，`reg` 在本例是 `0x10`，`value` 是调用者提供的接收位置。`u8` 是 8 位无符号整数，`s32` 则能同时表示负错误码和一字节非负数据。

这与 `i2c_transfer()` 的成功返回值不同：后者返回完成的消息数，本例手工构造两条消息时成功为 2；`i2c_smbus_read_byte_data()` 的非负返回值本身就是数据。能力检查只说明适配器能实现该事务，仍须由器件手册确认这种格式是否适用于外设。

### 原生与模拟是两条软件路径，不是两组引脚

Linux v6.6 的 `drivers/i2c/i2c-core-smbus.c` 中，上述辅助函数把地址、方向和事务类型交给 `i2c_smbus_xfer()`：

```c title="源码节选 · i2c_smbus_read_byte_data()"
status = i2c_smbus_xfer(client->adapter, client->addr, client->flags,
                        I2C_SMBUS_READ, command,
                        I2C_SMBUS_BYTE_DATA, &data);
return (status < 0) ? status : data.byte;
```

`I2C_SMBUS_READ` 表示读，`I2C_SMBUS_BYTE_DATA` 表示“命令码加一字节数据”。随后 Core 根据控制器方法表选择路径：

```text
                           ┌─ algo->smbus_xfer()
i2c_smbus_xfer() ──────────┤    控制器原生执行 SMBus 事务
                           │
                           └─ i2c_smbus_xfer_emulated()
                                → 构造普通 i2c_msg
                                → __i2c_transfer()
                                → master_xfer()
```

原生路径由控制器驱动直接处理 SMBus 事务；模拟路径由 Core 拆成普通 I2C 消息。两条路径最终都到同一控制器和同一组 SDA、SCL，但原生 `smbus_xfer()` 不应被误写成又调用普通 `master_xfer()`。

对 Byte Data Read，模拟路径准备两条消息：第一条写命令码，第二条读一个字节。相关源码片段为：

```c title="源码节选 · i2c_smbus_xfer_emulated()"
int nmsgs = read_write == I2C_SMBUS_READ ? 2 : 1;
struct i2c_msg msg[2] = {
    { .addr = addr, .flags = flags, .len = 1, .buf = msgbuf0 },
    { .addr = addr, .flags = flags | I2C_M_RD,
      .len = 0, .buf = msgbuf1 },
};
msgbuf0[0] = command;

case I2C_SMBUS_BYTE_DATA:
    if (read_write == I2C_SMBUS_READ)
        msg[1].len = 1;
    break;

status = __i2c_transfer(adapter, msg, nmsgs);
```

`msgbuf0[0]` 保存本例的 `0x10`，`msgbuf1` 接收数据。`I2C_M_RD` 是普通 I2C 消息的读方向标志，`__i2c_transfer()` 是调用者已经持锁时使用的内部入口。于是，B-B.3.3 手写的两条消息与这里的模拟路径在线上形成相同的“写、重复 START、读”结构。

选择接口时先看器件手册的字节序列，再看函数长短。固定 Byte Data、Word Data 等格式适合 `i2c_smbus_*()`；自定义组合、较长 EEPROM 连续读或不符合固定事务的格式仍使用 `i2c_transfer()`。

---

## <span class="blue">第三层：PMBus 给命令赋予电源语义

SMBus 能可靠地读回两个字节，却不会仅凭 Word Data 告诉软件“这是哪一路输出电压”“两个字节怎样换算成伏特”。PMBus（Power Management Bus）继续定义电源设备的命令码、页、状态和数据格式。

本篇使用一个受控的假设实例：一颗双路输出 PMBus 转换器挂在 7 位地址 `0x30`，要读取第 1 页的输出电压。实例不是某块板卡的实测记录，具体设备是否支持这些命令及格式仍须以芯片手册为准。

完整过程分为四项操作：

| 顺序 | 操作 | 使用的事务 | 本例得到什么 |
|---|---|---|---|
| 1 | `PAGE (0x00) ← 0x01` | SMBus Write Byte Data | 选择第 1 路输出 |
| 2 | 读 `VOUT_MODE (0x20)` | SMBus Read Byte Data | 返回 `0x14`，表示 ULINEAR16、指数 -12 |
| 3 | 读 `READ_VOUT (0x8B)` | SMBus Read Word Data | 依次返回低字节 `0x00`、高字节 `0x18` |
| 4 | 驱动解码并导出 | pmbus → hwmon | 原始字 `0x1800` 转为 1500 mV |

`VOUT_MODE` 通常在初始化时读取，不需要每次电压读取都重复执行。单页器件也可能不需要切页；表中把它显式列出，是为了看清多路器件的完整语义链。

### PAGE 是芯片里的共享状态，不是 READ_VOUT 的参数

`PAGE` 用来选择同一物理地址下的命令上下文，不是 EEPROM 的存储页。发送 `PAGE=1` 后，后续的页相关命令作用于第 1 页，直到页选择被再次改变或设备按自身规则复位。

假设两个访问者共享同一颗转换器：

1. 访问者 A 写入 `PAGE=0`，准备读第 0 路电压。
2. 访问者 B 在 A 发出 `READ_VOUT` 之前写入 `PAGE=1`。
3. A 随后的 `READ_VOUT` 仍只带命令码 `0x8B`，并不携带“我要第 0 页”的信息，因此可能读到 B 选中的第 1 路。

这说明切页与读取必须作为一组受协调的操作。Linux pmbus 核心在 `pmbus_set_page()` 中按需写页、读回核对，并保存 `data->currpage` 作为软件缓存；同一驱动的传感器访问通过 `update_lock` 串行化，避免本驱动的另一次读取插入切页和取值之间。

但驱动内的锁不能协调绕过它的访问。另一个进程若经 `/dev/i2c-N` 直接修改 PAGE，驱动缓存和芯片实际页可能失去一致。调试多页 PMBus 器件时，不能一边让 pmbus 驱动工作，一边无协调地用手工命令切页。

`pmbus_read_word_data()` 展示了页选择位于读取之前：

```c title="源码节选 · pmbus_read_word_data()"
rv = pmbus_set_page(client, page, phase);
if (rv < 0)
    return rv;

return i2c_smbus_read_word_data(client, reg);
```

`page` 是驱动希望访问的逻辑通道，`reg` 在这里是 `PMBUS_READ_VOUT`。失败时先返回负错误，不会把旧数据当成新通道的结果。

### READ_VOUT 的两个字节怎样变成 1.5 V

本例 `VOUT_MODE=0x14`。其高三位为 `000`，选择 ULINEAR16；低五位 `10100` 是五位补码形式的 -12。ULINEAR16 把 `READ_VOUT` 返回的完整 16 位字作为无符号整数 `X`，指数 `N` 则由 `VOUT_MODE` 单独提供：

```text
实际电压 Y = X × 2^N
```

PMBus Word Data 按低字节在前传输，所以线上收到 `0x00`、`0x18` 后，软件组合为：

```text
X = 0x00 | (0x18 << 8) = 0x1800 = 6144
```

再代入 `N=-12`：

```text
Y = 6144 × 2^(-12)
  = 6144 / 4096
  = 1.5 V
```

`READ_VOUT` 返回的是实际测量值，不是 `VOUT_COMMAND` 中保存的目标值。其他输出电压命令还可能使用 DIRECT、VID、IEEE 半精度等模式，不能看到两个字节就一律套用 ULINEAR16。若器件还有比例换算或厂商特定要求，也应按手册和对应驱动处理。

### LINEAR11 为什么不能套在本例上

LINEAR11 是另一种 16 位编码：高 5 位是有符号指数，低 11 位是有符号尾数，两者都包含在这一个原始字中。以 `0xF803` 为例：

```text
高 5 位：11111 → N = -1
低 11 位：00000000011 → X = 3
Y = 3 × 2^(-1) = 1.5
```

它与 ULINEAR16 的关键区别不是公式外形，而是**指数存在哪里**：LINEAR11 的指数在原始字高 5 位，ULINEAR16 的指数来自独立的 `VOUT_MODE`。许多电流、温度等非输出电压测量使用 LINEAR11；本例输出电压则由 `VOUT_MODE` 明确选择 ULINEAR16，不能混用解码方式。

---

## <span class="blue">Linux 怎样把原始字交给 hwmon

hwmon 是 Linux 的硬件监控子系统。pmbus 核心负责 PMBus 命令、页选择、状态缓存和格式转换，hwmon 再通过 sysfs 中的 `/sys/class/hwmon/` 属性文件提供统一读数。sysfs 是内核向用户空间导出设备对象和属性的虚拟文件系统，这里的 `in1_input` 就是电压输入属性。

pmbus 更新传感器时先经过内部辅助函数 `_pmbus_read_word_data()`：器件若有专用读函数，它优先走该函数，否则落到上面展示的 `pmbus_read_word_data()`。前者是多了一层器件分派，不是另一套总线协议。

对本例的 sysfs 读取，可以把调用链与数据流放在一起看：

```text
读取 in1_input
→ pmbus 更新传感器数据
→ _pmbus_read_word_data(..., PMBUS_READ_VOUT)
→ pmbus_read_word_data()：本例进入通用读取
→ pmbus_set_page()：必要时选择并核对页
→ i2c_smbus_read_word_data()：执行 SMBus Read Word Data
→ 控制器完成 I2C 波形传输
→ 原始字 0x1800 写入 sensor->data
→ pmbus_reg2data_linear()：按 VOUT_MODE 的指数换算
→ sysfs 输出毫伏值 1500
```

v6.6 的转换分支明确区分输出电压与其他线性数据：

```c title="源码节选 · pmbus_reg2data_linear()"
if (sensor->class == PSC_VOLTAGE_OUT) {    /* LINEAR16 */
    exponent = data->exponent[sensor->page];
    mantissa = (u16)sensor->data;
} else {                                  /* LINEAR11 */
    exponent = ((s16)sensor->data) >> 11;
    mantissa = ((s16)((sensor->data & 0x7ff) << 5)) >> 5;
}

val = mantissa;
if (sensor->class != PSC_FAN)
    val = val * 1000LL;                   /* 转为毫单位 */

if (exponent >= 0)
    val <<= exponent;
else
    val >>= -exponent;
```

在本例中，`sensor->data=0x1800`，`exponent=-12`，电压属于毫单位，所以计算为 `6144 × 1000 >> 12 = 1500`。`>> 12` 是右移 12 位，在本例等价于除以 4096；`u16` 强制把输出电压原始字按无符号 16 位值解释。

假设驱动已把第 1 页输出映射为 `hwmon0/in1_input`，目标板上的读取命令为：

```bash
cat /sys/class/hwmon/hwmon0/in1_input
```

对应的**预期文本示例**为：

```text
1500
```

`hwmon0` 和 `in1_input` 的编号依赖设备注册顺序与驱动通道映射，不能跨板卡硬编码。实际系统应先查看 `/sys/class/hwmon/hwmon*/name` 和各属性标签，确认文件确实对应该 PMBus 通道。

到这里，四层各自的结果已经分清：I2C 负责把字节送到，SMBus 规定这笔 Word Data 怎样传，PMBus 规定命令、页和数值格式，pmbus/hwmon 把最终结果变成其他软件可直接使用的标准读数。

---

## <span class="blue">出问题时，先判断错在哪一层

同一现象“读不到正确电压”可能来自不同层，不能用重复执行同一命令代替定位：

1. **地址阶段 NACK**：先检查设备地址、供电、电气与总线占用，属于 I2C 和硬件接入层。
2. **事务长度或 Count 不符**：核对 Byte Data、Word Data、SMBus Block 与 I2C Block，属于 SMBus 事务格式层。
3. **原始字合理但通道错误**：检查 PAGE 是否被其他访问者改变，属于 PMBus 共享状态层。
4. **原始字稳定但物理量错误**：检查 VOUT_MODE、低字节在前、LINEAR16/LINEAR11 和器件比例参数，属于 PMBus 数据解释层。
5. **总线读取成功但 hwmon 没有文件**：检查 pmbus 驱动匹配、probe 和属性注册，属于 Linux 系统集成层。

逻辑分析仪能证明线上字节正确，却不能单独证明页选择和数值解码正确；hwmon 显示 1500 也不是电气波形已经合格的证据。排障时应保留每一层的输入和输出，避免跨层猜测。

---

## <span class="blue">本节总结

I2C、SMBus、PMBus 不是三组互相替代的引脚。I2C 提供两线传输基础，SMBus 固定系统管理事务并增加超时、延展限制和可选 PEC，PMBus 再定义电源命令、共享页状态和数值格式。普通 I2C 外设可以借用某种 SMBus 格式，但借用格式不等于完整遵守 SMBus 规范。

Linux 中的分界也同样清楚：`i2c_smbus_*()` 可以经控制器原生方法或普通 I2C 消息完成事务；pmbus 驱动选择页、发出命令并解码；hwmon 用统一文件和单位导出结果。本例的完整链路是 `PAGE=1`、`VOUT_MODE=0x14`、`READ_VOUT` 返回 `00 18`，最终得到 `0x1800 → 1.5 V → 1500 mV`。

---

## <span class="blue">本节自查 Q&A

??? details "Q1. 普通 AT24C02 使用 `i2c_smbus_read_byte_data()` 后，是否就成为 SMBus 器件？"
    不会。这里只是 AT24C02 的“存储地址加一字节读取”与 SMBus Byte Data Read 格式一致，Linux 可以复用该事务接口。器件是否满足 SMBus 的电气、超时、延展、PEC 等规范是另一组问题。

??? details "Q2. SMBus 与 PMBus 分别解决了 I2C 的哪两个空白？"
    I2C 统一传输方式，但不统一所有器件的事务形状和命令语义。SMBus 固定 Byte Data、Word Data、Block 等事务并增加管理所需的超时和校验规则；PMBus 再用这些事务承载电源命令，定义 PAGE、READ_VOUT、状态和数据编码。

??? details "Q3. 原生 SMBus 与 SMBus emulation 在哪里分岔，是否使用不同物理总线？"
    Core 根据适配器是否提供 `smbus_xfer()` 选择原生路径；没有该方法时，由 `i2c_smbus_xfer_emulated()` 构造普通 `i2c_msg`，再经 `__i2c_transfer()` 和 `master_xfer()` 执行。两者最终使用同一控制器和同一组 SDA、SCL，不是两套物理总线。

??? details "Q4. SMBus Block Read 与 I2C Block Read 为什么不能只换函数名？"
    SMBus Block Read 由从设备先返回 Count，调用方按 Count 接收数据；I2C Block Read 由调用方预先指定长度，线上没有这个 Count。Linux 两组接口都最多 32 字节，但长度来源和线上格式不同。

??? details "Q5. 为什么 PAGE 与 READ_VOUT 之间不能被其他访问者插入切页操作？"
    READ_VOUT 只携带命令码，不携带目标页。若访问者 A 选择 PAGE=0 后，访问者 B 改为 PAGE=1，A 随后的读取就可能落到第 1 页。pmbus 驱动用锁和页缓存协调自身访问，但无法约束绕过驱动的手工切页。

??? details "Q6. 本例为什么先收到 `0x00`、`0x18`，最后却是 1500？"
    PMBus Word Data 低字节在前，所以原始字为 `0x1800=6144`。`VOUT_MODE=0x14` 指定 ULINEAR16、指数 -12，电压为 `6144×2^(-12)=1.5 V`。hwmon 电压输入文件使用毫伏，因此输出 1500。

??? details "Q7. 为什么不能用 LINEAR11 解码所有 PMBus 两字节数据？"
    LINEAR11 把 5 位指数和 11 位尾数都放在原始字中；ULINEAR16 则把完整原始字作为无符号整数，指数另由 VOUT_MODE 给出。输出电压还可能使用 DIRECT、VID 或 IEEE 模式，必须先确认命令和器件规定的数据格式。

??? details "Q8. PEC 校验通过后，能否证明电压值和页选择都正确？"
    不能。PEC 只检查一笔事务中的字节是否发生传输错误，不判断命令是否适用于设备，也不证明读取前选中了正确 PAGE，更不负责把原始字解释成正确物理量。
