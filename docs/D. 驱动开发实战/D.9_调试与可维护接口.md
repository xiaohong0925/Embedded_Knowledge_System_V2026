# D.9 调试与可维护接口

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[I→E] | 预计阅读时间：30 分钟
>
> 与第11章的分工：11.5 讲 sysfs/uevent 机制（kobject 映射、属性文件怎么来）；本篇讲驱动作者怎么暴露可维护接口——打印分级与控制、sysfs 属性的设计纪律、debugfs 的寄存器 dump 与统计。ftrace/perf 等工具操作链 E 扩展。

## <span class="blue"> 本节导读

走完 D.1-D.8，TS502 是一颗功能完整的产品驱动：能读温度、能通知、能中断、能休眠唤醒。最后一个问题没回答：**出问题好不好查**——现场想看寄存器全表怎么办？FIFO 溢出了几次去哪查？中断路径上的打印怎么不刷屏？这些"可维护性"接口不是锦上添花，是驱动交付质量的一部分。<BR>
本节覆盖：dev_dbg 与 dynamic debug 的运行时开关、ratelimit 防刷屏、sysfs 属性的一值一属性纪律与 ioctl 选型、debugfs + seq_file 的寄存器 dump 与统计计数器、三级可观测接口的分工，以及 Part 1 收官的 TS502 全景回顾。

---

## <span class="blue"> 打印的艺术：dynamic debug [I→E]

`printk/dev_info` 编译进去就永远打印，`#define DEBUG` 要重编译重部署——现场调试两个都不可用。正确姿势是 **`dev_dbg()` + dynamic debug**：打印语句平时零开销躺平，需要时运行时分文件、分行打开，不用重启不用重编译：

```c
/* 代码里：按设备粒度打调试信息 */
dev_dbg(&client->dev, "FIFO depth=%d, burst=%d bytes\n", depth, ret);

/* 中断/高频路径：限频版本，一秒最多一条 */
dev_dbg_ratelimited(&client->dev, "spurious interrupt status=0x%02x\n", status);
```

现场打开（内核配置 `CONFIG_DYNAMIC_DEBUG=y`）：

```bash
mount -t debugfs none /sys/kernel/debug
echo 'file ts502.c +p' > /sys/kernel/debug/dynamic_debug/control   # 整个文件
echo 'file ts502.c line 120-135 +p' > .../control                  # 精确到行
echo 'module ts502 +p' > .../control                               # 整个模块
```

三条打印纪律：

1. **按设备打，不打裸 printk**：`dev_dbg(dev, ...)` 输出自带设备名（`i2c 1-0048`），多实例场景立刻知道是哪颗芯片；裸 `pr_debug` 在多实例驱动里等于没打
2. **高频路径必限频**：中断 handler、poll 回调里的打印用 `xxx_ratelimited` 变体——中断风暴时打印本身就是风暴放大器（打印拖慢 handler，更多中断积压）
3. **结构化输出**：状态类信息打成 `key=value` 格式（`depth=16 overflow=0`），现场 `dmesg | grep` 与日志分析脚本都能直接消费

---

## <span class="blue"> sysfs 属性：一值一属性 [I→E]

sysfs 是驱动的**正式门面**（ABI 级，写进内核文档就要维护），设计纪律只有一条：**一个属性一个值，文本形式**。

```c
/* TS502：报警阈值暴露为 sysfs 读写属性 */
static ssize_t alarm_threshold_show(struct device *dev,
                                    struct device_attribute *attr, char *buf)
{
    struct ts502_data *data = dev_get_drvdata(dev);
    int val = i2c_smbus_read_byte_data(data->client, TS502_REG_PWM_ALARM);

    if (val < 0)
        return val;
    return sysfs_emit(buf, "%d\n", val);      /* 一值一属性，换行结尾 */
}

static ssize_t alarm_threshold_store(struct device *dev,
                                     struct device_attribute *attr,
                                     const char *buf, size_t count)
{
    struct ts502_data *data = dev_get_drvdata(dev);
    int val, ret;

    ret = kstrtoint(buf, 0, &val);
    if (ret || val < 0 || val > 125)          /* 手册范围校验 */
        return -EINVAL;

    ret = i2c_smbus_write_byte_data(data->client, TS502_REG_PWM_ALARM, val);
    return ret < 0 ? ret : count;
}
static DEVICE_ATTR_RW(alarm_threshold);

static struct attribute *ts502_attrs[] = {
    &dev_attr_alarm_threshold.attr,
    NULL,
};
ATTRIBUTE_GROUPS(ts502);

/* i2c_driver.driver.dev_groups = ts502_groups; —— 核心自动建/删属性文件 */
```

效果：

```bash
cat /sys/bus/i2c/devices/1-0048/alarm_threshold
85
echo 90 > /sys/bus/i2c/devices/1-0048/alarm_threshold
```

与 ioctl 的选型（D.2 立过的原则在这里收口）：

| | sysfs 属性 | ioctl |
|---|---|---|
| 数据形态 | 单值、文本 | 多字段、二进制结构体 |
| 原子性 | 单值天然原子 | 多字段一次读写天然原子 |
| 使用方 | shell 脚本、运维、产测 | 业务程序 |
| ABI 维护 | 内核文档登记，强约束 | 自定义，靠 size/version 自律 |

TS502 两个都留不是冗余：阈值给运维调（sysfs），采样率+完整配置给业务调（ioctl）。**同一配置两通道要同步**——sysfs 改了阈值，ioctl GET_CFG 读到的必须一致（都落在寄存器这唯一真相上）。

---

## <span class="blue"> debugfs + seq_file：开发期的自由区 [E]

sysfs 有 ABI 纪律，多值、表格、内部状态都不适合放。这些给开发者和现场工程师的东西放 debugfs——**明确定位非 ABI**：内容随时可变，业务禁止依赖。

```c
#include <linux/debugfs.h>
#include <linux/seq_file.h>

/* 统计计数器：D.6 溢出、D.4 中断、D.8 唤醒的埋点 */
struct ts502_data {
    /* …… */
    unsigned int irq_count;
    unsigned int overflow_count;
    unsigned int wake_count;
    struct dentry *debugfs_dir;
};

/* 寄存器全表 dump：seq_file 是内核"逐行输出"的标准助手 */
static int ts502_regs_show(struct seq_file *s, void *unused)
{
    struct ts502_data *data = s->private;
    static const struct { u8 reg; const char *name; } regs[] = {
        { 0x00, "CHIP_ID" },   { 0x01, "TEMP_H" },   { 0x02, "TEMP_L" },
        { 0x04, "FIFO_STAT" }, { 0x05, "CTRL" },     { 0x06, "INT_STAT" },
        { 0x07, "INT_MASK" },  { 0x08, "PWM_ALARM" },
    };
    int i, val;

    for (i = 0; i < ARRAY_SIZE(regs); i++) {
        val = i2c_smbus_read_byte_data(data->client, regs[i].reg);
        seq_printf(s, "0x%02x %-9s = %s0x%02x\n",
                   regs[i].reg, regs[i].name,
                   val < 0 ? "<err> " : "", val < 0 ? 0 : val);
    }
    seq_printf(s, "irq_count      = %u\n", data->irq_count);
    seq_printf(s, "overflow_count = %u\n", data->overflow_count);
    seq_printf(s, "wake_count     = %u\n", data->wake_count);
    return 0;
}
DEFINE_SHOW_ATTRIBUTE(ts502_regs);   /* 宏展开：open→single_open→show 一套 */

/* probe 尾部 */
    data->debugfs_dir = debugfs_create_dir("ts502", NULL);
    debugfs_create_file("registers", 0444, data->debugfs_dir, data,
                        &ts502_regs_fops);
```

现场使用：

```bash
cat /sys/kernel/debug/ts502/registers
0x00 CHIP_ID  = 0x50
0x04 FIFO_STAT = 0x10
0x05 CTRL     = 0x09
...
irq_count      = 14237
overflow_count = 3
```

`DEFINE_SHOW_ATTRIBUTE` 把 open/seq_file 样板代码打包成一个宏——debugfs 文件几乎都是"输出一段文本"，这个宏就是标准写法。计数器的价值在趋势：overflow_count 缓慢增长说明业务消费跟不上采样，该降采样率或改 kfifo 溢出策略了（D.6 的决策有了数据支撑）。

---

## <span class="blue"> 三级接口分工与 Part 1 收官 [I→E]

| 层级 | 通道 | 内容 | ABI |
|---|---|---|---|
| 运行时事件 | dev_dbg + dynamic debug | 调试细节、错误现场 | 无 |
| 正式门面 | sysfs 属性 | 单值配置与状态 | 强约束 |
| 开发自由区 | debugfs | 寄存器 dump、统计计数器 | 无，禁业务依赖 |

### TS502 全景：九篇长成的产品驱动

```
ts502.c（约 400 行）                      出自
├── 注册胶水 + of_match/id 表              D.1
├── probe：CHIP_ID 验证 + devm 骨架        D.1
├── probe：DT 属性读取                     D.7
├── cdev + ida + device_create             D.2
├── fops：read（阻塞/非阻塞+kfifo）        D.2/D.3/D.6
├── fops：ioctl（size/version ABI）        D.2
├── fops：poll / fasync / no_llseek        D.3
├── irq_thread：读状态→清源→分发           D.4
├── hrtimer 轮询后备 + work                D.5
├── kfifo 批量缓冲与溢出策略               D.6
├── suspend/resume + wakeup 三步           D.8
└── sysfs 属性 + debugfs dump/计数器       D.9
```

每一行都能追溯到某一篇的一个决策——这就是 Part 1 想交付的：不是九堆API笔记，是一条可复用的驱动生长路径。换一颗真实芯片，从 D.1 的骨架出发重走一遍即可。

---

## <span class="blue"> Trade-off 表格 [I→E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 调试打印 | dev_dbg + dynamic debug | dev_info 常驻 | dynamic debug 零开销可控；常驻打印刷屏且暴露内部信息 |
| 配置通道 | sysfs | ioctl | sysfs 单值文本运维友好；ioctl 多字段原子业务友好 |
| 内部状态 | debugfs | sysfs 多值属性 | debugfs 无 ABI 约束；sysfs 塞多值违反一值一属性 |
| 高频打印 | ratelimited | 裸打 | 限频防打印放大故障；裸打在风暴路径上雪上加霜 |
| 计数器 | seq_file 汇总 | 每计数器一个文件 | 汇总一次看全；单文件适合脚本监控单项 |

---

## <span class="blue"> 常见陷阱 [I→E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 中断路径裸 dev_info | 故障时日志爆炸、系统更卡 | 高频路径无限频 | dev_dbg_ratelimited |
| sysfs 输出表格 | ABI 审查被拒、脚本解析碎裂 | 一值一属性纪律被破坏 | 多值内容移去 debugfs |
| 业务依赖 debugfs | 内核升级业务崩 | debugfs 非 ABI 定位被误用 | 业务数据通道走 cdev/sysfs |
| 两通道配置不一致 | sysfs 改完 ioctl 读到旧值 | 配置有第二处缓存真相 | 唯一真相在寄存器，两通道都读写它 |
| dynamic debug 没开 | echo 后无输出 | 内核缺 CONFIG_DYNAMIC_DEBUG | 检查配置，或退回 dev_info 临时验证 |
| show 里慢 I2C 不节制 | cat 属性卡顿被高频调用放大 | show 每次实时读硬件 | 接受（值不贵）或缓存影子值 |

---

## <span class="blue"> 动手练习

1. 确认内核 `CONFIG_DYNAMIC_DEBUG=y`，现场用 control 文件分别按文件/按行打开 TS502 的调试打印，采样时观察输出格式与设备名前缀。
2. 通过 sysfs 改 alarm_threshold，再用 ioctl GET_CFG 读回，验证两通道一致性；然后用示波器/逻辑分析仪或计数寄存器确认阈值真的生效。
3. 写一个 10 行 shell 监控脚本：每秒读一次 debugfs 的 overflow_count，采样率调 100Hz 同时业务只每 2 秒读一次，记录溢出增长曲线，给出降采样或改溢出策略的建议。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| dynamic debug | dev_dbg 平时零开销，运行时分文件分行打开 | 现场能不用重编译开打印吗 |
| ratelimit | 高频路径必限频，打印不能放大故障 | 中断 handler 里的打印限频了吗 |
| sysfs 纪律 | 一值一属性、文本、ABI 级维护 | 属性里有多值表格吗 |
| ioctl vs sysfs | 多字段原子走 ioctl，单值运维走 sysfs，真相唯一在寄存器 | 两通道同步吗 |
| debugfs | 非 ABI 自由区：dump/统计，禁业务依赖 | 业务有没有 cat debugfs |
| seq_file | 逐行输出标准助手，DEFINE_SHOW_ATTRIBUTE 打包样板 | 还在手写 open 样板吗 |

---

## <span class="blue"> 下一步

Part 1 九篇至此收官：TS502 从空骨架长成了约 400 行的产品级驱动。Part 2 换一条线——进框架：同一颗芯片，什么时候不该自己实现 cdev，而是注册进 input/IIO/hwmon 这些子系统。下一篇（D.10 input 子系统：按键与旋转编码器）从最常见的输入设备开始，给"用现成驱动 vs 自己写"的判定标准。

螺旋衔接：可观测接口——11.5 sysfs 机制（理解级）→ 本篇（写法级）→ E 扩展 ftrace/perf 工具链（实操级）。★第2次出现（写法级）
