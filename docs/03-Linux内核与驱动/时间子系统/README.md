# 时间子系统

> 📊 **本章难度等级：** <span class="badge-i">**中级 (Intermediate)**</span>

---

<span class="blue">**定义**：Linux <span class="red">时间子系统</span>是内核中负责<strong>时间管理、时钟源维护、定时器调度与系统节拍</strong>的核心框架。<br></span>
它向上为用户空间提供 `nanosleep()`、`timerfd`、POSIX 定时器等接口；<br>
向下屏蔽硬件时钟差异，通过 clocksource + clockevent 两层抽象统一 ARM/x86/RISC-V 等各类架构的时钟硬件。

---

## 为什么需要时间子系统

没有统一的时间管理，内核的调度、网络超时、驱动延迟都会失控。<br>
早期内核直接操作硬件定时器，每个架构写一套<span class="red">中断处理</span>代码，<br>
重复且难以维护。<span class="red">时间子系统</span>通过抽象层把<strong>"读取当前时间"</strong>与<strong>"设置下次中断"</strong>分离，<br>
让新增架构只需注册两个驱动接口，而非重写整个时钟逻辑。

---

## 时间子系统的核心架构

Linux <span class="red">时间子系统</span>由四层构成：

```
┌─────────────────────────────────────────────────────────┐
│  用户接口层  │ nanosleep(), timerfd, POSIX timers, alarm() │
├─────────────────────────────────────────────────────────┤
│  定时器核心  │ hrtimer (红黑树) │ timer wheel (基于 jiffies) │
├─────────────────────────────────────────────────────────┤
│  时钟抽象层  │ timekeeping (维护系统时间)                    │
│              │ clocksource (读取硬件计数值)                  │
│              │ clockevent (编程下次中断)                     │
├─────────────────────────────────────────────────────────┤
│  硬件驱动层  │ arch_timer (ARM), APIC timer (x86), RISC-V timer│
└─────────────────────────────────────────────────────────┘
```

---

## clocksource：时间的"尺子"

<span class="blue">**定义**：**clocksource** 是内核中提供<strong>单调递增时间计数值</strong>的抽象对象。<br></span>
每个 clocksource 有一个 `rating`（评分），内核自动选择 rating 最高的作为当前时钟源。<br>
典型的 clocksource 包括 `arch_sys_counter`（ARM）、`tsc`（x86）、`jiffies`（兜底）。

---

### 为什么需要抽象时钟源

不同 SoC 的定时器硬件千差万别：<br>
ARM 用 `cntvct_el0`（虚拟计数器），x86 用 TSC，某些旧板子只有 jiffies。<br>
clocksource 把"读取当前纳秒数"抽象成统一接口 `timecounter_read()`，<br>
上层代码无需关心底层是寄存器还是内存映射。

---

### clocksource 的核心结构

```c
/* 定义：clocksource 结构体，kernel/time/clocksource.c */
struct clocksource {
    u64 (*read)(struct clocksource *cs);        /* 功能：读取当前计数值 */
    u64 mask;                                    /* 计数器位宽掩码 */
    u32 mult;                                    /* 乘数：计数值→纳秒 */
    u32 shift;                                   /* 右移位数 */
    u64 max_idle_ns;                             /* 指标：最大空闲时间 */
    int rating;                                  /* 指标：精度评分 */
    const char *name;
    struct list_head list;
};
```

- `mult` 和 `shift` 把硬件计数值转换为纳秒：<br>
  `ns = (cycles * mult) >> shift`<br>
  这个定点数运算避免了 64 位除法开销。

---

### 精度与评分机制

| clocksource | rating | 精度 | 特性 |
|-------------|--------|------|------|
| arch_sys_counter | 400 | ~1 ns | ARM 架构定时器，推荐 |
| tsc | 300 | ~1 ns | x86，需注意变频问题 |
| hpet | 250 | ~10 ns | 独立硬件，功耗高 |
| acpi_pm | 200 | ~300 ns | 省电但精度低 |
| jiffies | 100 | ~10 ms | 最慢，仅作兜底 |

内核在启动时遍历所有注册的 clocksource，选择 rating 最高的激活。<br>
用户可通过 <span class="green">sysfs</span> 手动切换：

```bash
# 功能：查看当前 clocksource
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
# → arch_sys_counter

# 功能：列出可用源
cat /sys/devices/system/clocksource/clocksource0/available_clocksource
# → arch_sys_counter jiffies
```

---

## clockevent：中断的"扳机"

<span class="blue">**定义**：**clockevent**（时钟事件设备）是负责<strong>在指定未来时刻触发中断</strong>的抽象。<br></span>
它有两种模式：`periodic`（周期性）和 `oneshot`（单次触发）。<br>
高精度定时器（hrtimer）和 tickless（NO_HZ）都依赖 oneshot 模式。

---

### clockevent 设备结构

```c
/* 定义：clock_event_device，kernel/time/clockevents.c */
struct clock_event_device {
    void (*event_handler)(struct clock_event_device *);
    int (*set_next_event)(unsigned long delta, struct clock_event_device *);
    int (*set_state_oneshot)(struct clock_event_device *);
    int (*set_state_periodic)(struct clock_event_device *);
    int (*set_state_shutdown)(struct clock_event_device *);
    unsigned long min_delta_ns;                   /* 指标：最小编程间隔 */
    unsigned long max_delta_ns;                   /* 指标：最大编程间隔 */
    int rating;
    const char *name;
    int irq;
};
```

- `set_next_event()` 是核心 API：告诉硬件"在 `delta` 纳秒后打一发中断"。<br>
- 进入 tickless 模式时，CPU idle 前调用 `tick_nohz_stop_sched_tick()`，<br>
  通过 clockevent 把下次中断推迟到最近定时器到期时刻，而非固定 1ms 打断。

---

### periodic vs oneshot 模式对比

| 模式 | 行为 | 功耗 | 精度 |
|------|------|------|------|
| Periodic | 固定频率中断（如 1000 Hz）| 高 | 1/HZ |
| Oneshot | 按需编程单次中断 | 低 | 纳秒级 |

嵌入式系统强烈建议开启 `CONFIG_NO_HZ_IDLE=y`，<br>
让 CPU 在深 idle 时停止 tick，仅靠 oneshot 在需要时唤醒。

---

## timekeeping：维护系统时间

<span class="blue">**定义**：**timekeeping** 是内核中把 clocksource 的<strong>硬件计数值转换为人类可读时间</strong>（wall time / monotonic time）的子系统。<br></span>
它维护 `xtime`（墙上时间）、`monotonic`（单调时间）、`boottime`（包含挂起的单调时间）三种时钟。

---

### 时间类型辨析

| 时钟类型 | 含义 | 用途 | 是否受 NTP 调整 |
|----------|------|------|----------------|
| CLOCK_REALTIME | 墙上时间（1970 起）| 用户可见时间戳 | 是 |
| CLOCK_MONOTONIC | 系统启动后流逝时间 | 超时、延迟计算 | 否 |
| CLOCK_BOOTTIME | MONOTONIC + 挂起时间 | 包含休眠的定时器 | 否 |
| CLOCK_MONOTONIC_RAW | 硬件原始计数 | 不受 NTP/ADJ 影响 | 否 |

- `CLOCK_REALTIME` 可被 `adjtime()` / NTP 调整，不适合做定时器基准。<br>
- `CLOCK_MONOTONIC` 保证单调递增，是 `timerfd`、POSIX timer 的默认基准。<br>
- `CLOCK_BOOTTIME` 在电源管理场景很重要：suspend 期间时间仍在流逝。

---

### timekeeper 结构

```c
/* 定义：timekeeper，kernel/time/timekeeping.c */
struct timekeeper {
    struct clocksource *clock;           /* 功能：当前使用的 clocksource */
    u64 xtime_nsec;                       /* 纳秒级墙上时间 */
    u64 raw_sec;                          /* 原始秒数 */
    struct timespec64 wall_to_monotonic;  /* wall → mono 偏移 */
    struct timespec64 total_sleep_time;   /* 累计挂起时间 */
    seqcount_t seq;                       /* 顺序锁保护 */
};
```

读写 `timekeeper` 使用 seqlock：<br>
`raw_read_seqcount_begin()` → 读数据 → `read_seqcount_retry()`，<br>
保证读者无锁且能检测写者干扰。

---

## hrtimer：高精度定时器

<span class="blue">**定义**：**hrtimer**（High Resolution Timer）是内核中基于<strong>红黑树</strong>组织的纳秒级定时器框架。<br></span>
它独立于旧的 timer wheel（基于 jiffies），精度不受 HZ 限制，<br>
可达微秒甚至纳秒级。

---

### 为什么需要 hrtimer

旧的 timer wheel 精度为 `1/HZ`（如 4ms@250Hz），<br>
对音频采样、电机控制、工业总线等微秒级场景完全不够。<br>
hrtimer 通过红黑树按到期时间排序，<br>
每次只需检查最左边的节点，O(log n) 插入、O(1) 查询最早到期。

---

### hrtimer 核心 API

```c
/* 功能：初始化高精度定时器 */
hrtimer_init(&timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
timer.function = my_callback;

/* 功能：启动定时器，500 µs 后触发 */
hrtimer_start(&timer, ns_to_ktime(500000), HRTIMER_MODE_REL);

/* 功能：取消定时器 */
hrtimer_cancel(&timer);
```

---

### hrtimer 的红黑树结构

```
        hrtimer 红黑树（按到期时间排序）
        
            [expires: 100ns]
           /              \
    [expires: 200ns]  [expires: 300ns]
       /                    \
 [expires: 250ns]      [expires: 400ns]
```

- 所有 CPU 拥有独立的 `hrtimer_clock_base`（ per-CPU ）。<br>
- 插入新定时器时，若新节点成为最左节点，立即通过 clockevent 重新编程下次中断。<br>
- 中断到来时，遍历最左节点直到 `expires > now`，把过期节点移入 `cb_pending` 链表，<br>
  在 HRTIMER_SOFTIRQ 上下文中执行回调。

---

## tick 与 tickless（NO_HZ）

<span class="blue">**定义**：**tick** 是内核周期性中断（默认 100-1000 Hz），用于调度、计时、记账。<br></span>
**tickless**（NO_HZ）模式在 CPU 空闲时停止周期性 tick，<br>
按需通过 oneshot clockevent 触发下次事件，显著降低功耗。

---

### 三种 tick 模式对比

| 模式 | 配置 | tick 行为 | 功耗 | 适用场景 |
|------|------|-----------|------|----------|
| Periodic tick | `HZ=1000` | 固定 1ms 中断 | 高 | 服务器 |
| NO_HZ_IDLE | `CONFIG_NO_HZ_IDLE=y` | idle 时停 tick | 中 | 桌面 |
| NO_HZ_FULL | `CONFIG_NO_HZ_FULL=y` | 仅一个 CPU 跑 tick | 低 | HPC/实时 |

---

### tickless 的嵌入式价值

在电池供电设备中，CPU 可能有 90% 时间处于 idle。<br>
每秒 1000 次 tick 中断会频繁唤醒 CPU，<br>
每次进出 C-State 都有功耗开销。<br>
启用 `CONFIG_NO_HZ_IDLE` 后，idle CPU 不再被 tick 打断，<br>
只在真正的定时器到期或 I/O 事件时唤醒。

```bash
# 功能：查看是否启用 tickless
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
grep CONFIG_NO_HZ /boot/config-$(uname -r)
```

---

## tick broadcast：解决深睡眠时钟失效

<span class="blue">**定义**：**tick broadcast** 是当某个 CPU 的本地 clockevent 在深睡眠（C3+）下停止工作时，<br></span>
由另一个始终运行的时钟设备（如 always-on timer、LPTIM）代为唤醒该 CPU 的机制。

---

### 为什么需要 broadcast

ARM SoC 常有这样的设计：<br>
- CPU0 的 arch_timer 在 C3 下继续工作（always-on）。<br>
- CPU1-3 的 timer 进入 C3 后停止计数，无法触发中断。

如果 CPU1 进入 idle 并设置了 hrtimer，但它的 clockevent 在深睡眠下失效，<br>
那么 CPU1 将永远睡下去，定时器不会触发。<br>
tick broadcast 框架检测到这种情况后，<br>
把 CPU1 的下次到期时间注册到 CPU0（或一个全局 always-on timer），<br>
由 CPU0 在到期时通过 IPI（处理器间中断）唤醒 CPU1。

---

### broadcast 设备注册

```c
/* 定义：tick broadcast 注册，kernel/time/tick-broadcast.c */
clockevents_notify(CLOCK_EVT_NOTIFY_BROADCAST_ON, &cpumask);

/* 功能：注册 broadcast 设备 */
void tick_broadcast_setup_oneshot(struct clock_event_device *dev)
{
    /* 把 dev 标记为 broadcast 源 */
    tick_broadcast_device.evtdev = dev;
}
```

---

## 时间子系统的初始化流程

```
start_kernel()                                  /* init/main.c */
  └── time_init()                               /* arch/arm/kernel/time.c */
        └── of_clk_init()                       /* 解析设备树时钟 */
        └── clocksource_of_init()               /* 注册 arch_timer */
        └── clockevents_of_init()               /* 注册 clockevent */
        └── tick_init()                         /* kernel/time/tick-common.c */
              └── tick_periodic_setup()         /* 初始 periodic tick */
              └── tick_nohz_init()              /* 若启用 NO_HZ */
                    └── hrtimer_switch_to_hres()/* 切换到高精度 */
```

---

### 关键初始化顺序

1. **clocksource 注册**：`arch_timer_of_init()` 读取<span class="red">设备树</span> `arm,armv8-timer` 节点，<br>
   注册 rating=400 的 clocksource。<br>
2. **clockevent 注册**：注册本地 timer 为 per-CPU clockevent。<br>
3. **tick 启动**：初始为 periodic 模式（100 Hz），<br>
   在第一个 TIMER_SOFTIRQ 中检查条件后切换到 hres（高精度）。<br>
4. **timekeeping 初始化**：`timekeeping_init()` 使用当前 clocksource 设置初始 wall time。

---

## 实战：排查定时器精度问题

---

### 场景：hrtimer 延迟异常

现象：`timerfd_settime()` 实际触发延迟达 1-15 ms，预期 < 10 µs。

排查步骤：

```bash
# 1. 功能：查看当前 clocksource
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
# → 若输出 "jiffies"，说明精度只有 10ms，立刻更换

# 2. 功能：检查 clocksource 启动日志
dmesg | grep -i "clocksource.*switch\|unstable"
# → "arch_sys_counter: mark unstable due to frequency drift in C3"

# 3. 功能：查看 timer 列表
head -50 /proc/timer_list
# → 检查 expires_next - now 差值是否突变

# 4. 功能：检查 tickless 状态
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
cat /sys/devices/system/clockevents/broadcast/current_device
```

---

### 根因分析

| 现象 | 根因 | 修复 |
|------|------|------|
| clocksource 为 jiffies | 固件未写 `cntfrq_el0` | U-Boot 修复 |
| "unstable due to frequency drift" | CPU C3 下 timer 暂停 | 设备树加 `always-on;` |
| expires_next 突变 | tick broadcast 失效 | 启用 always-on LPTIM |
| 负差值频繁出现 | timekeeper 未同步 | 启用 `CONFIG_CLOCKSOURCE_VALIDATE_ALWAYS` |

---

### 修复：设备树补丁

```dts
/* 功能：确保 timer 在深睡眠下继续工作 */
&timer {
    compatible = "arm,armv8-timer";
    clock-frequency = <24000000>;
    always-on;                              /* 核心API：防止 C3 暂停 */
};
```

---

## 时间子系统与实时内核

<span class="blue">**定义**：PREEMPT_RT 补丁将<span class="red">时间子系统</span>中的多个关键路径从硬中断上下文移到线程上下文，<br></span>
使 hrtimer 回调、tick 处理均可被抢占，<br>
从而将调度延迟从毫秒级压到微秒级。

---

### RT 中的关键改动

| 组件 | 主线内核 | PREEMPT_RT |
|------|----------|------------|
| hrtimer 回调 | 硬中断 / softirq | 专用内核线程 `ksoftirqd` |
| tick 处理 | `timer_interrupt()` | `hrtimer_interrupt()` 线程化 |
| 调度器 | `schedule()` 在 tick 中 | `schedule()` 可在任意抢占点 |
| 延迟 | ~1 ms | < 100 µs |

---

## 总结

<span class="blue">**定义**：Linux <span class="red">时间子系统</span>通过 **clocksource**（读时间）+ **clockevent**（设中断）+ **timekeeping**（维护系统时间）+ **hrtimer**（纳秒定时器）四层架构，<br></span>
统一了所有硬件平台的时间管理。

---

| 组件 | 职责 | 关键文件 |
|------|------|----------|
| clocksource | 提供单调递增计数值 | `kernel/time/clocksource.c` |
| clockevent | 编程下次中断时刻 | `kernel/time/clockevents.c` |
| timekeeping | wall/mono/boot 时间维护 | `kernel/time/timekeeping.c` |
| hrtimer | 纳秒级红黑树定时器 | `kernel/time/hrtimer.c` |
| tick | 周期性/按需节拍 | `kernel/time/tick-common.c` |
| tick broadcast | 深睡眠唤醒代理 | `kernel/time/tick-broadcast.c` |

---

对于嵌入式开发者，掌握<span class="red">时间子系统</span>意味着：<br>
能在低功耗与高精度之间做出正确权衡，<br>
能排查 "定时器漂移"、"tick 精度不足"、"深睡眠无法唤醒" 等典型问题，<br>
能为实时应用选择正确的时钟基准与 tick 模式。
