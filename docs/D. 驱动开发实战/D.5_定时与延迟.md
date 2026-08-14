# D.5 定时与延迟

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[I→E] | 预计阅读时间：30 分钟
>
> 与第10章的分工：第10章讲时间子系统机制——timer_wheel 级联实现（10.5.3）、hrtimer 的红黑树与精度（10.5.4）、tickless（10.6）；本篇讲驱动里怎么用——timer_list 与 hrtimer 的选型、消抖/超时/周期采样三大范式、延时家族的边界、定时器的销毁纪律。机制一律引用主线，本篇不重复。

## <span class="blue"> 本节导读

INT 脚接管了"数据就绪"的通知，但硬件不会替驱动做另一类事：**周期性动作**和**等一等再决定**。INT 脚没接的板子要定时轮询 FIFO、消抖要等触点稳定再确认、读寄存器失败要等几毫秒重试——这些都靠内核的定时器与延时设施。<BR>
本节覆盖：timer_list 与 hrtimer 的驱动侧选型表、三大范式（mod_timer 顺延合并、超时重试、hrtimer_forward_now 无漂移周期）、TS502 的轮询后备模式（INT 缺线时 hrtimer 接管采样）、延时家族六个函数的边界、remove 里的销毁纪律（del_timer_sync 与 cancel_work_sync 的顺序）。

---

## <span class="blue"> timer_list vs hrtimer：驱动侧选型 [I→E]

| | timer_list（传统定时器） | hrtimer（高精度定时器） |
|---|---|---|
| 精度 | jiffies 粒度（HZ=250 时 4ms） | 纳秒级（实际受硬件与负载限制，微秒级可期） |
| 回调上下文 | softirq——**禁睡眠** | hardirq——**禁睡眠** |
| 开销 | 低（timer_wheel 批量管理） | 较高（红黑树 + 每回调中断） |
| 周期写法 | 回调里 `mod_timer(now + period)`，会漂移 | `hrtimer_forward_now()`，无漂移 |
| 典型用途 | 秒级超时、消抖、看门狗喂狗 | 周期采样、精确延时补偿 |

两行结论：

- **毫秒级以上、精度无所谓 → timer_list**；微秒级或严格周期 → hrtimer。选型机制层面的权衡（tick 对齐、CPU 唤醒代价）见 10.5，驱动侧照表选即可
- **两者的回调都在原子上下文**——这是驱动写法的关键约束：回调里禁止 I2C/SPI 事务、禁止 mutex、禁止 `kmalloc(GFP_KERNEL)`。定时器回调的标准动作只有一个：**置标志 / `schedule_work`，把真活儿转给 workqueue**

---

## <span class="blue"> 三大范式 [E]

### 范式一：mod_timer 顺延合并——消抖与超时类

语义是"事件再来一次，截止时间就往后顺延"——触点抖动期间反复触发，定时器一直被推迟，直到信号真正稳定才到期：

```c
/* 每次 GPIO 中断到来都执行： */
mod_timer(&data->debounce_timer, jiffies + msecs_to_jiffies(5));

/* 定时器回调：5ms 内没有新边沿，确认稳定，转 workqueue 读电平 */
```

同一个结构换个场景就是空闲超时（最后一次访问后 N 秒关设备）和喂狗超时。要点是**复用同一个 timer 反复 mod**，而不是每次 add 新的——mod_timer 对未激活的定时器等效 add，一个对象两种状态都正确。

GPIO 按键消抖的完整实战在 D.10（input 子系统），这里只立范式。消抖机制的选择（定时器 vs 状态机）见 B-B.2.1。

### 范式二：超时重试——等硬件就绪

probe 或配置序列里最常见的需求：等一个状态位，等到就继续，等不到报错。**不要手写循环**，内核有标准宏（`linux/iopoll.h`）：

```c
#include <linux/iopoll.h>

u32 val;
/* 每 100us 读一次，最多等 50ms；读到 bit0 置位为止 */
ret = read_poll_timeout(i2c_smbus_read_byte_data, val,
                        val >= 0 && (val & TS502_FIFO_OVERFLOW),
                        100, 50000, false, client, TS502_REG_FIFO_STATUS);
```

`read_poll_timeout` 把"读-判-睡-重试-超时"五件事打包，参数依次是读操作、结果变量、条件、睡眠间隔 us、总超时 us。MMIO 设备有对应的 `readl_poll_timeout`。手写 `while (retry--)` 循环的问题在于睡眠粒度与超时计算各自为政，重构成这个宏之前几乎每个驱动都有一份略有 bug 的版本。

### 范式三：hrtimer_forward_now 周期采样——无漂移

TS502 的 INT 脚在某些板子上没接线（PCB 改版前的老批次），驱动退化为轮询模式：hrtimer 按采样率周期触发，转 workqueue 读 FIFO：

```c
struct ts502_data {
    /* …… */
    struct hrtimer poll_timer;
    struct work_struct poll_work;
    ktime_t period;             /* 采样周期，由 ioctl 配置的 rate 换算 */
    bool int_connected;         /* 设备树声明了 interrupts 则为 true */
};

static enum hrtimer_restart ts502_poll_fn(struct hrtimer *t)
{
    struct ts502_data *data = container_of(t, struct ts502_data, poll_timer);

    schedule_work(&data->poll_work);            /* 真活儿转进程上下文 */

    hrtimer_forward_now(t, data->period);       /* 以上一理论时刻为基准顺延 */
    return HRTIMER_RESTART;
}

static void ts502_poll_work(struct work_struct *work)
{
    struct ts502_data *data = container_of(work, struct ts502_data, poll_work);
    int depth;

    depth = i2c_smbus_read_byte_data(data->client, TS502_REG_FIFO_STATUS);
    if (depth >= 0 && (depth & 0x3f) > 0)
        ts502_data_arrived(data);               /* 与 D.4 中断路径殊途同归 */
}

/* 启动轮询（INT 缺线时的后备路径）： */
hrtimer_init(&data->poll_timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
data->poll_timer.function = ts502_poll_fn;
hrtimer_start(&data->poll_timer, data->period, HRTIMER_MODE_REL);
```

`hrtimer_forward_now()` 的价值在**基准点**：它以"上一次理论上应该到期的时刻"为基准加周期，处理耗时不会累积进下一个周期。对照写法是回调里 `hrtimer_start(now + period)`——每次回调的执行延迟都滚进周期，采样率缓慢漂移，长时间运行后与标称频率明显偏离。周期类任务一律 forward_now。

注意分工：`poll_work` 读 FIFO 后的动作与 D.4 中断 handler 完全相同（`ts502_data_arrived`）——中断与轮询只是两种触发源，数据路径合一。这是驱动设计的通用原则：**触发源可换，数据路径不变**。

---

## <span class="blue"> 延时家族：忙等待与睡眠的边界 [I→E]

| 函数 | 机制 | 可用上下文 | 适用量级 |
|---|---|---|---|
| ndelay(ns) | 忙等待 | 任意（含中断） | 纳秒级，几十 ns 的芯片时序 |
| udelay(us) | 忙等待 | 任意（含中断） | 微秒级，**单次别超过 ~10us** |
| mdelay(ms) | 忙等待 | 任意（含中断） | 万不得已，几 ms 以内 |
| usleep_range(min, max) | 睡眠 | 进程上下文 | 微秒~毫秒（旧代码常见） |
| fsleep(us) | 睡眠（自动选最优机制） | 进程上下文 | 微秒~毫秒，**v6.6+ 首选** |
| msleep(ms) | 睡眠 | 进程上下文 | 毫秒级以上 |

两条边界：

1. **上下文决定能用什么**：中断/定时器回调/自旋锁内只能忙等待（udelay 家族），进程上下文优先睡眠——忙等待烧的是全体任务的 CPU
2. **时长决定该用什么**：忙等待超过几十微秒就是浪费，udelay(1000) 以上的写法基本都该换成 fsleep/msleep。反过来 msleep(1) 也睡不准——hrtimer 粒度与调度延迟让 1ms 睡眠实际可能睡 5ms，需要准的短延时用 fsleep（它内部按量级自动选 hrtimer 或 tick 睡眠）

D.1 骨架里那句 `msleep(5)`（手册上电时序）就是这套规则的实例：probe 是进程上下文、5ms 量级，msleep 正合适。`usleep_range` 在新代码里被 fsleep 取代，读老驱动认识即可。

---

## <span class="blue"> 销毁纪律：remove 里的顺序 [E]

定时器与 workqueue 都是**异步回调**——remove 返回后回调还可能被触发，访问已释放的 `ts502_data` 就是 use-after-free（rmmod 后随机 oops 的经典根因）。销毁必须"sync"，且顺序固定：

```c
static void ts502_remove(struct i2c_client *client)
{
    struct ts502_data *data = i2c_get_clientdata(client);

    hrtimer_cancel(&data->poll_timer);      /* ① 先停触发源：等正在跑的回调结束 */
    cancel_work_sync(&data->poll_work);     /* ② 再停下游：等正在跑的 work 结束 */
    /* …… 之后才能安全释放 cdev/ida 等资源 …… */
}
```

三个细节：

- **顺序不能反**：先 cancel_work 后 hrtimer_cancel，中间窗口里定时器回调还能 `schedule_work` 把 work 重新排上——先掐触发源，再收下游
- **timer_list 对应 `del_timer_sync`**（新内核别名 `timer_delete_sync`）：等正在执行的回调返回才返回。普通 `del_timer` 不等待，remove 里禁用
- **sync 版不能在回调自身里调用**：回调里 `del_timer_sync(自己)` 是死锁——回调要等自己结束。回调内部只能"不再 rearm"，销毁动作永远在外部上下文做

devm 党也逃不过这条：`devm_kzalloc` 的释放发生在 remove **之后**，而 hrtimer/work 的 sync 取消必须在 remove **之中**完成——托管内存不代表托管回调的生命周期。

---

## <span class="blue"> Trade-off 表格 [I→E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 定时器 | timer_list | hrtimer | timer_list 开销低但精度 4ms 起；hrtimer 精确但每回调一次中断 |
| 周期实现 | hrtimer_forward_now | 回调里重新 start | forward_now 无漂移；重新 start 实现简单但延迟滚雪球 |
| 等寄存器 | read_poll_timeout | 手写重试循环 | 宏打包睡眠与超时；手写灵活但五件事各可能错 |
| 触发源 | INT 中断 | 定时器轮询 | 中断实时省电；轮询兜底 INT 缺线，数据路径必须合一 |
| 短延时 | fsleep | usleep_range | fsleep 自动选机制且语义清晰（v6.6+）；range 只在老内核用 |

---

## <span class="blue"> 常见陷阱 [I→E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 回调里做 I2C | "scheduling while atomic" | 定时器回调是原子上下文 | 回调只 schedule_work，真活儿转进程上下文 |
| 卸载后回调访问已释放内存 | rmmod 后随机 oops | remove 里漏 del_timer_sync/cancel_work_sync | 先停触发源再收下游，全 sync 版 |
| 周期漂移 | 标称 100Hz 实测越跑越慢 | 回调里 now+period，执行耗时滚入周期 | hrtimer_forward_now |
| 忙等待过长 | probe 卡几百毫秒拖慢启动 | mdelay 等硬件就绪 | read_poll_timeout，或延迟到 workqueue |
| msleep(1) 睡不准 | 短延时实际睡 5ms+ | tick 粒度与调度延迟 | 短延时用 fsleep，精度需求高用 hrtimer |
| 回调里 sync 销毁自己 | 死锁 | del_timer_sync 等待回调结束，而调用者就是回调 | 回调里只标记不 rearm，销毁在外部做 |

---

## <span class="blue"> 动手练习

1. 把 TS502 设备树的 `interrupts` 属性删掉，让驱动走 hrtimer 轮询后备路径，`cat /proc/timer_list | grep -A3 ts502`（或 debugfs 的 timer 统计）确认定时器在跑；改回 interrupts，验证两条触发路径的数据殊途同归。
2. 把 `hrtimer_forward_now` 改成回调里 `hrtimer_start(now + period)`，连续运行 10 分钟，用 FIFO 深度增长速率推算实际采样率，与标称值对比漂移量。
3. 在 remove 里注释掉 `cancel_work_sync`，写一个测试脚本反复 insmod/rmmod 并在加载期间保持采样运行，观察偶发 oops；恢复后把"先停源、后收下游、全 sync"写成自己驱动的 remove 检查清单。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 选型 | 毫秒级粗精度 timer_list，微秒级/严格周期 hrtimer | 精度需求想清楚了吗 |
| 原子上下文 | 两种定时器回调都禁睡眠，真活儿转 workqueue | 回调里有 I2C/mutex 吗 |
| 顺延合并 | mod_timer 复用同一对象，事件再来就推迟 | 消抖/空闲超时用了范式一吗 |
| 超时重试 | read_poll_timeout 打包读-判-睡-超时 | 还在手写 retry 循环吗 |
| 无漂移周期 | hrtimer_forward_now 以理论时刻为基准 | 回调里是不是 now+period |
| 延时家族 | 上下文决定能否睡眠，时长决定忙等/睡眠，fsleep 新首选 | udelay 超过 10us 了吗 |
| 销毁纪律 | hrtimer_cancel → cancel_work_sync，顺序固定全 sync | remove 检查清单有这两条吗 |

---

## <span class="blue"> 下一步

定时器接管了周期触发，FIFO 半满时的批量搬运也已经在 D.4 埋下了 work 钩子——但批量数据往哪放、怎么高效搬给用户态，还没有答案。下一篇（D.6 内存与 DMA）讲 kfifo 环形缓冲、kmalloc 的 GFP 选型、DMA 两种映射与 cache 一致性，以及 mmap 直通——"野路子 mmap"的正统形态。

螺旋衔接：定时器——第10.5章时间子系统机制（理解级）→ 本篇（写法级）→ D.10 input 消抖实战（应用级）。★第2次出现（写法级）
