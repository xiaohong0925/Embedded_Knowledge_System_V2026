# D.11 IIO 子系统：传感器的标准写法

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[I→E] | 预计阅读时间：35 分钟
>
> 与主线的分工：第22章讲子系统选型决策（选 IIO 还是 hwmon），11.1.1 展示过 hwmon 写法的最小示例；本篇讲 IIO 框架的完整写法——channel 定义、sysfs 直读、buffer+trigger 连续采样，并把 TS502 改写成 IIO 版做对照。缓冲/定时器写法引用 Part 1，不重复。

## <span class="blue"> 本节导读

一颗温湿度传感器摆在面前，三条路：hwmon（11.1.1 走过）、IIO（工业 I/O 子系统）、或者 Part 1 那样自写 cdev。选错的代价真实存在：该进 IIO 的用 cdev 裸写，业务永远拿不到标准化通道和缓冲采样；该留 hwmon 的进了 IIO，thermal 框架反而挂不上。本篇把判定标准和 IIO 写法讲透。<BR>
本节覆盖：传感器三条路判定表、IIO 框架关系图、SHT3x 案例的最小骨架（channel 定义 + read_raw + indio_dev 注册）、buffer + trigger 连续采样、TS502 cdev 版 vs IIO 版一页对照、iio_info/iio_readdev 验收与 iio_dummy 无硬件后备。

---

## <span class="blue"> 场景与判定：传感器的三条路 [I]

| 需求特征 | 路径 | 理由 |
|---|---|---|
| 只读温度/电压/风扇转速，给 thermal 或监控用 | **hwmon** | 接口极简（`temp1_input`），thermal 框架原生挂接（D.12） |
| 多种物理量通道、需要连续采样/缓冲/触发、给采集业务用 | **IIO** | 标准化 channel + buffer + trigger + libiio 生态 |
| 特殊语义（自定义 FIFO、私有报警逻辑、私有协议） | cdev 自写（Part 1） | 框架表达不了的语义，但要接受业务绑死私有接口 |

判定一句话：**监控用途留 hwmon，采集用途进 IIO，框架表达不了的语义才退回 cdev**。TS502 正好卡在中间——温度通道适合 IIO，PWM 报警与 32 级 FIFO 的自定义语义 IIO 表达不全，本篇末尾的对照标本把这条边界画出来。

---

## <span class="blue"> 框架关系图 [I]

```
你的驱动                     IIO 核心                        用户态
──────────────         ─────────────────────────         ────────────────────
read_raw()        ──►   channel 定义                  ──►  sysfs 直读：
iio_buffer + trigger     indio_dev 注册                     /sys/bus/iio/devices/
                         /dev/iio:deviceX (buffer)          iio:device0/in_temp_raw
drivers/iio/             industrialio-core.c + buffer/      buffer 读取：
industrialio-*                                                /dev/iio:device0
                                                              iio_readdev / libiio
```

驱动提供两样东西：channel 定义（"我有哪些物理量、什么格式"）和 read_raw 回调（"怎么读一个原始值"）。sysfs 命名、单位换算语义、缓冲队列、触发调度全部由 IIO 核心接管。

---

## <span class="blue"> 最小骨架：SHT3x 案例 [I→E]

SHT3x：I2C 温湿度传感器，一条命令启动测量，读回 4 字节（温度 2B + 湿度 2B）。

```c
#include <linux/module.h>
#include <linux/i2c.h>
#include <linux/iio/iio.h>

#define SHT3X_CMD_MEASURE  0x2400   /* 单次测量，高重复性 */

struct sht3x_data {
    struct i2c_client *client;
    struct mutex lock;
};

/* ① channel 定义：每个物理量一条，info_mask 声明能读什么 */
static const struct iio_chan_spec sht3x_channels[] = {
    {
        .type = IIO_TEMP,
        .info_mask_separate = BIT(IIO_CHAN_INFO_RAW) |
                              BIT(IIO_CHAN_INFO_SCALE) |
                              BIT(IIO_CHAN_INFO_OFFSET),
    }, {
        .type = IIO_HUMIDITYRELATIVE,
        .info_mask_separate = BIT(IIO_CHAN_INFO_RAW) |
                              BIT(IIO_CHAN_INFO_SCALE),
    },
};

/* ② read_raw：框架按 channel + mask 回调进来 */
static int sht3x_read_raw(struct iio_dev *indio_dev,
                          struct iio_chan_spec const *chan,
                          int *val, int *val2, long mask)
{
    struct sht3x_data *data = iio_priv(indio_dev);
    u8 buf[4];
    int ret;
    s16 raw;

    switch (mask) {
    case IIO_CHAN_INFO_RAW:
        mutex_lock(&data->lock);
        ret = i2c_smbus_write_word_data(data->client, 0, SHT3X_CMD_MEASURE);
        if (ret < 0)
            goto out;
        msleep(15);                     /* 手册：高重复性测量耗时 15ms */
        ret = i2c_master_recv(data->client, buf, sizeof(buf));
        if (ret < 0)
            goto out;
        raw = (chan->type == IIO_TEMP) ? (buf[0] << 8 | buf[1])
                                       : (buf[2] << 8 | buf[3]);
        *val = raw;
        ret = IIO_VAL_INT;              /* 返回值类型：整数 */
out:
        mutex_unlock(&data->lock);
        return ret;

    case IIO_CHAN_INFO_SCALE:
        /* 手册换算公式拆成整数+小数两部分返回 */
        if (chan->type == IIO_TEMP) {
            *val = 175;  *val2 = 65535;     /* T = raw * 175/65535 - 45 */
        } else {
            *val = 100;  *val2 = 65535;     /* RH = raw * 100/65535 */
        }
        return IIO_VAL_FRACTIONAL;

    case IIO_CHAN_INFO_OFFSET:
        *val = -45;                         /* 温度偏移 */
        return IIO_VAL_INT;
    }
    return -EINVAL;
}

static const struct iio_info sht3x_info = {
    .read_raw = sht3x_read_raw,
};

/* ③ 注册 */
static int sht3x_probe(struct i2c_client *client)
{
    struct iio_dev *indio_dev;
    struct sht3x_data *data;

    indio_dev = devm_iio_device_alloc(&client->dev, sizeof(*data));
    if (!indio_dev)
        return -ENOMEM;

    data = iio_priv(indio_dev);
    data->client = client;
    mutex_init(&data->lock);

    indio_dev->name = "sht3x";
    indio_dev->channels = sht3x_channels;
    indio_dev->num_channels = ARRAY_SIZE(sht3x_channels);
    indio_dev->info = &sht3x_info;
    indio_dev->modes = INDIO_DIRECT_MODE;      /* 仅直读，无 buffer */

    return devm_iio_device_register(&client->dev, indio_dev);
}
```

效果——用户态拿到的是**标准化、带单位语义**的接口：

```bash
cat /sys/bus/iio/devices/iio:device0/in_temp_raw
23456
cat /sys/bus/iio/devices/iio:device0/in_temp_scale
175/65535（实际显示为内核换算后的数值形式）
cat /sys/bus/iio/devices/iio:device0/in_temp_offset
-45
```

三个骨架要点：

1. **read_raw 的返回值不是数据，是"数据怎么解释"**：`IIO_VAL_INT` 表示 *val 就是值；`IIO_VAL_FRACTIONAL` 表示 值 = val/val2——SCALE/OFFSET 的换算语义由这套返回类型承载，写错类型用户态算出的物理量全错
2. **channel 声明与 read_raw 分支必须一一对应**：info_mask 声明了 SCALE 而 read_raw 的 switch 没写这个分支，用户态读到 -EINVAL——声明即契约
3. **`devm_iio_device_alloc/register`**：全 devm 形态，remove 为空（D.1 原则在框架内的延续）

---

## <span class="blue"> buffer + trigger：连续采样 [E]

直读模式（INDIO_DIRECT_MODE）只解决"问一次答一次"。采集业务的真实需求是**按节奏连续采样、批量取走**——IIO 的答案是 buffer + trigger：

```
trigger（hrtimer/数据就绪中断）──► 触发采样 ──► 驱动把一帧数据推入 buffer
                                                      │
用户态 ◄── read /dev/iio:device0 ◄── kfifo 式缓冲 ◄──┘
```

驱动侧增量三步：

```c
/* ① 声明扫描元素：连续采样时每帧包含哪些 channel */
static const struct iio_chan_spec sht3x_scan_channels[] = {
    { .type = IIO_TEMP,
      .scan_index = 0,
      .scan_type = { .sign = 's', .realbits = 16, .storagebits = 16,
                     .endianness = IIO_BE, }, },
    /* 湿度 scan_index=1，时间戳通道由框架自动追加 */
};

/* ② trigger handler：触发到来时读一帧推入 buffer */
static irqreturn_t sht3x_trigger_handler(int irq, void *p)
{
    struct iio_poll_func *pf = p;
    struct iio_dev *indio_dev = pf->indio_dev;
    /* …… 读传感器 → iio_push_to_buffers_with_timestamp() …… */
    return IRQ_HANDLED;
}

/* ③ probe 里挂缓冲 */
    indio_dev->modes = INDIO_DIRECT_MODE | INDIO_BUFFER_SOFTWARE;
    ret = devm_iio_triggered_buffer_setup(&client->dev, indio_dev,
                                          NULL, sht3x_trigger_handler, NULL);
```

trigger 来源三选一：数据就绪中断脚（最省 CPU）、hrtimer 软触发（`iio-trig-hrtimer`，周期精确）、sysfs 软触发（`iio-trig-sysfs`，调试手动踢）。概念与 D.4/D.5 的中断/定时器一一对应，只是调度权移交给了 IIO 核心。

> 💡 trigger handler 运行在**中断线程上下文**（trigger 是中断时）或软中断路径——里面做 I2C 测量（15ms）会拖垮实时性。正确姿势和 D.4/D.5 相同：handler 只启动转换，数据就绪中断（或第二个 trigger）里再取数推 buffer。

---

## <span class="blue"> TS502 对照标本：cdev 版 vs IIO 版 [E]

把 Part 1 的 TS502 改写成 IIO 版，一页看清两条路的差异：

| | Part 1 cdev 版 | IIO 改写版 |
|---|---|---|
| 用户态接口 | `/dev/ts502-0` read/ioctl/poll | `in_temp_raw/scale/offset` + `/dev/iio:device0` |
| 配置通道 | 自定义 ioctl（size/version ABI） | sysfs 标准属性（sampling_frequency 等） |
| 业务兼容 | 业务绑死私有 ABI | libiio/iio_readdev/python-iio 直接可用 |
| 驱动代码量 | ~460 行（附录总装） | 温度通道部分 ~150 行 |
| 连续采样 | 自己写 kfifo + hrtimer + poll | buffer + trigger 框架接管 |
| FIFO 自定义语义 | 完整表达 | 勉强映射（buffer 抽象挡在中间） |
| PWM 报警 | ioctl 配置 | IIO events（阈值事件）能表达，但 PWM 输出形态表达不了 |

结论不是"IIO 更好"而是**按语义归属拆分**：TS502 的温度采集进 IIO（拿标准化和缓冲），PWM 报警这种私有语义留 cdev/ioctl 或 IIO events——真实产品里"主功能进框架、私有功能开小口"是常态。判定回到本篇开头那张表。

---

## <span class="blue"> 调试与验收 [I→E]

```bash
iio_info                          # 列出所有 iio 设备、channel、trigger（libiio 工具）
iio_readdev iio:device0           # 从 buffer 连续读采样帧
echo 10 > /sys/bus/iio/devices/iio:device0/sampling_frequency   # 配采样率
cat /sys/bus/iio/devices/iio:device0/buffer/enable              # buffer 开关状态
```

无硬件后备：内核自带 `iio_dummy` 虚拟传感器驱动（`drivers/iio/dummy/`，CONFIG_IIO_SIMPLE_DUMMY），无需任何硬件即可演练 channel 定义、buffer、trigger 全流程——先拿它把工具链跑通，再回真实芯片。

---

## <span class="blue"> Trade-off 表格 [I→E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 传感器框架 | IIO | hwmon | IIO 有缓冲与触发但复杂；hwmon 简单但只读监控 |
| 采样模式 | 直读（DIRECT） | buffer + trigger | 直读简单低频；buffer 支持连续采集但要管触发链 |
| trigger 来源 | 数据就绪中断 | hrtimer 软触发 | 中断省电实时；hrtimer 无需中断脚但周期唤醒有代价 |
| 私有语义 | IIO events 表达 | cdev 小口并存 | events 标准化但表达力有限；私有 ioctl 灵活但绑死业务 |
| 换算语义 | SCALE/OFFSET 拆返回 | 驱动里算好直接给 | 拆返回保留精度给业务选择；算好简单但丢原始值 |

---

## <span class="blue"> 常见陷阱 [I→E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| mask 分支缺失 | 用户态读 SCALE 返回 -EINVAL | info_mask 声明与 read_raw 分支不对应 | 声明即契约，逐 channel 核对 |
| 返回类型写错 | 用户态物理量全错 | IIO_VAL_INT 与 FRACTIONAL 混用 | 换算公式拆 val/val2 后核对类型 |
| trigger handler 里做慢 I2C | 采样卡顿、系统延迟告警 | 中断上下文里执行 15ms 测量 | 转换与取数分两阶段 |
| scan_type 与帧格式不符 | buffer 读出的数据错位 | realbits/storagebits/endianness 声明错 | 对照 datasheet 帧格式逐项核 |
| buffer 忘加时间戳 | 业务无法对齐多传感器 | 没用 iio_push_to_buffers_with_timestamp | 推帧必带时间戳 |
| 进 IIO 后 thermal 挂不上 | 风扇闭环断裂 | thermal-of 需要 hwmon 设备 | 监控通道留 hwmon 或加 of-thermal 挂接（D.12） |

---

## <span class="blue"> 动手练习

1. 编译启用 iio_dummy，`iio_info` 观察虚拟设备的 channel 与 trigger，给 Part 2 的工具链热身。
2. 写 SHT3x 最小骨架（无硬件时把测量部分换成固定返回值），`cat in_temp_raw` 验证 sysfs 直读；故意删掉 SCALE 分支观察用户态报错。
3. 把 TS502 IIO 版列一个改写清单：哪些功能进 channel、哪些进 buffer、PWM 报警怎么办——写成一页设计文档，与 Part 1 附录的 cdev 版对照。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 三条路判定 | 监控→hwmon，采集→IIO，私有语义→cdev | 需求语义想清楚了吗 |
| channel 契约 | info_mask 声明与 read_raw 分支一一对应 | 声明的每个 mask 都有分支吗 |
| 返回类型 | read_raw 返回"数据怎么解释"，不是数据本身 | SCALE 的 val/val2 拆对了吗 |
| buffer+trigger | 连续采样的框架方案；handler 禁慢操作 | handler 里有 15ms 级 I2C 吗 |
| TS502 对照 | 主功能进框架，私有语义开小口 | 拆分边界画出来了吗 |
| 验收 | iio_info / iio_readdev / iio_dummy 后备 | 没硬件也练过了吗 |

---

## <span class="blue"> 下一步

IIO 解决了"采集"，但监控那条路还没走完——hwmon 读到温度之后，怎么让风扇自动转起来？下一篇（D.12 hwmon 与 thermal 联动：从读温度到控风扇）讲 thermal zone 绑定、cooling device 注册与调速策略，形成"传感器 → 热区 → 风扇"的完整闭环。

螺旋衔接：传感器接口——11.1.1 hwmon 最小示例（认知级）→ 本篇 IIO 写法（框架级）→ D.12 thermal 闭环（系统级）→ 第22章选型决策（设计级）。★第2次出现（框架级）
