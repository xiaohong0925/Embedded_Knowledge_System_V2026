# D.4 中断实战

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[E] | 预计阅读时间：35 分钟
>
> 与第10章的分工：第10章讲中断机制——GIC 与中断号映射（10.1）、顶半部/底半部模型（10.2/10.3）、request_threaded_irq 两阶段实现（10.4.2）；本篇讲驱动里怎么写——设备树声明与触发类型、handler 写法与假中断处理、底半部在驱动里的选型、中断问题的调试排查。机制一律引用主线，本篇不重复。

## <span class="blue"> 本节导读

D.3 的三条通知通道跑通了，但生产者是个假货——调试 ioctl 手动"踢"出来的数据就绪。真实的生产者是 TS502 的 INT 引脚：FIFO 有数据、报警触发时硬件拉低这根线。本篇把它接进驱动，让"数据就绪"由硬件说了算。<BR>
本节覆盖：INT 脚的设备树声明与四种触发类型的选择依据、I2C 设备的 `client->irq` 自动翻译、线程化中断 handler 的写法（RW1C 清中断源、IRQ_NONE 假中断处理）、底半部在驱动里的三选一、中断上下文三禁、`/proc/interrupts` 解读、中断风暴定位、丢事件的三种典型根因。

---

## <span class="blue"> INT 脚接入：设备树声明 [E]

TS502 手册写明 INT 引脚**开漏输出、低电平有效**——这一行硬件事实直接决定设备树怎么写：

```dts
&i2c1 {
    ts502@48 {
        compatible = "virtual,ts502";
        reg = <0x48>;
        interrupt-parent = <&gpio1>;
        interrupts = <5 IRQ_TYPE_LEVEL_LOW>;   /* GPIO1_5，低电平触发 */
    };
};
```

### 触发类型由硬件输出特性决定，不是配置偏好

| 触发类型 | 硬件输出形态 | 典型器件 |
|---|---|---|
| IRQ_TYPE_LEVEL_LOW | 开漏/开集，拉低保持到软件清中断源 | 大多数传感器 INT 脚（含 TS502） |
| IRQ_TYPE_LEVEL_HIGH | 推挽输出，拉高保持 | 部分电源管理芯片 |
| IRQ_TYPE_EDGE_FALLING | 事件发生时发一个下降沿脉冲 | 按键、卡检测 |
| IRQ_TYPE_EDGE_RISING | 事件发生时发一个上升沿脉冲 | 部分时钟/同步信号 |

选错的代价完全不对称，两个方向都是经典事故：

- **电平型写成边沿型**：器件把 INT 拉低保持（等软件清源），GPIO 只在拉低瞬间产生一个边沿。如果中断来时驱动没来得及处理（比如 probe 顺序问题），电平一直低着却永远等不到"下一个边沿"——中断彻底丢失，设备假死
- **边沿型写成电平型**：脉冲信号拉低又弹回，电平型触发器在低电平期间反复触发——中断风暴，CPU 被 handler 吃满

TS502 是开漏低有效，写 `IRQ_TYPE_LEVEL_LOW`：低电平保持期间中断控制器持续报告 pending，直到线程 handler 通过 RW1C 清掉 INT_STATUS、引脚弹回高电平。

### I2C 设备的便利：client->irq 自动翻译

platform 驱动要自己 `platform_get_irq()`，I2C 驱动不用：i2c 核心在设备注册时已经把 `interrupts` 属性翻译成 Linux 中断号，填进 `client->irq`。probe 里拿来即用：

```c
if (!client->irq)
    return dev_err_probe(&client->dev, -ENODEV, "no IRQ configured\n");
```

> 💡 老代码里的 `gpio_to_irq()` 是把 GPIO 编号换算成中断号的过渡 API，现代写法一律在设备树里声明 `interrupts` 让核心翻译。看到驱动里出现 gpio_to_irq，基本可以判断这份代码的年代（11.1.4 的 Legacy 裸驱动里就有它）。

---

## <span class="blue"> handler 写法：线程化中断的驱动侧 [E]

两阶段模型（顶半部 + irq_thread）的机制见 10.4.2，这里只给驱动侧的完整写法：

```c
#define TS502_INT_DATA_READY  0x01
#define TS502_INT_FIFO_HALF   0x02

/* 线程 handler：在进程上下文跑，可以睡眠，可以做 I2C */
static irqreturn_t ts502_irq_thread(int irq, void *dev_id)
{
    struct ts502_data *data = dev_id;
    int status;

    /* ① 读中断状态：TS502 的 INT_STATUS 是 RW1C */
    status = i2c_smbus_read_byte_data(data->client, TS502_REG_INT_STATUS);
    if (status < 0)
        return IRQ_HANDLED;             /* I2C 错误：别再触发风暴，认下这次 */

    if (!(status & (TS502_INT_DATA_READY | TS502_INT_FIFO_HALF)))
        return IRQ_NONE;                /* 假中断：不是我们的（共享线下必须判） */

    /* ② 清中断源：写 1 清零对应位，INT 脚弹回高电平 */
    i2c_smbus_write_byte_data(data->client, TS502_REG_INT_STATUS, status);

    /* ③ 按位分发 */
    if (status & TS502_INT_DATA_READY)
        ts502_data_arrived(data);       /* D.3 的三动作整体搬到这里 */
    if (status & TS502_INT_FIFO_HALF)
        schedule_work(&data->fifo_work);/* 批量搬运丢给 workqueue（D.6 展开） */

    return IRQ_HANDLED;
}

/* probe 里注册 */
    ret = devm_request_threaded_irq(&client->dev, client->irq,
                                    NULL,                  /* 顶半部用内核默认 */
                                    ts502_irq_thread,
                                    IRQF_ONESHOT,
                                    "ts502", data);
    if (ret)
        return dev_err_probe(&client->dev, ret, "request IRQ %d failed\n",
                             client->irq);

    /* 开中断：允许数据就绪从 INT 脚输出 */
    i2c_smbus_write_byte_data(data->client, TS502_REG_INT_MASK,
                              TS502_INT_DATA_READY | TS502_INT_FIFO_HALF);
```

三个写法要点：

1. **顶半部传 NULL**：内核装一个默认顶半部，直接返回 IRQ_WAKE_THREAD（10.4.2 的 handler NULL 简化模式）。I2C 器件的中断处理必须读写寄存器、必须睡眠，顶半部本来就无事可做——这是 I2C/SPI 设备驱动的标准形态
2. **IRQF_ONESHOT**：电平触发 + 线程化的必配标志。它让中断线在线程 handler 跑完之前保持屏蔽——否则清源前的低电平会让中断控制器不断重新触发，线程还没清完源就被新中断淹没
3. **清中断源（②）在分发（③）之前**：RW1C 写完、INT 脚弹回，这段时间窗口内到达的新事件会体现在下一次 INT_STATUS 读取里。先分发后清源的写法，会把分发期间到达的事件一并清掉——丢事件的第一根因

### 假中断：IRQ_NONE 的判定义务

`IRQF_SHARED` 共享中断线时，别人的事件也会叫醒你的 handler；即使独享，电平毛刺也会产生没有对应状态位的中断。handler 必须以读到的状态位为准：**没有自家位置位，返回 IRQ_NONE 告诉内核"不是我的"**。内核统计 IRQ_NONE 的比例，连续大量无人认领的中断会触发 "nobody cared, try booting with irqpoll" 并强制关闭这条线——handler 不判状态位，就是在给这个结局铺路。

---

## <span class="blue"> 底半部在驱动里的三选一 [E]

| | threaded_fn（irq_thread） | workqueue | tasklet |
|---|---|---|---|
| 上下文 | 内核线程，可睡眠 | 内核线程，可睡眠 | softirq，**不可睡眠** |
| 延迟 | 微秒级（SCHED_FIFO/50） | 毫秒级（调度排队） | 微秒级 |
| 需要做 I2C/SPI | ✅ 可以 | ✅ 可以 | ❌ 禁止 |
| 状态 | 主流写法 | 辅助角色 | 已废弃，仅认知 |

选型结论按场景一句话：

- **默认 threaded_fn**：中断驱动的底半部，能放这里的都放这里。TS502 的"读状态、清源、置标志、唤醒"全在 irq_thread 里
- **重活、批量活转 workqueue**：FIFO 半满要一次搬 16 帧（D.6 的批量读），这种耗时操作别堵在 irq_thread 里拖延迟，`schedule_work` 转出去
- **tasklet 只读不写**：维护老驱动时认识它即可，新代码禁用（softirq 上下文不能睡眠，与现代驱动必做的 I2C 事务天然冲突，10.3.3 有它的墓志铭）

无论哪条路径，硬中断上下文（顶半部）的三条禁令都要背下来：**禁睡眠**（mutex、I2C、kmalloc(GFP_KERNEL) 全出局）、**禁耗时**（超过几微秒的循环搬去底半部）、**禁用户态拷贝**（`copy_to_user` 会触发缺页睡眠——数据先存 kfifo，底半部或 read 时再拷，D.6 给完整模式）。

---

## <span class="blue"> 中断调试：/proc/interrupts 是第一现场 [E]

```bash
cat /proc/interrupts | grep -E "CPU|ts502"
            CPU0       CPU1       CPU2       CPU3
  89:      14237          0          0          0  gpio1     5  Edge      ts502
```

三个读法：

- **计数涨不涨**：计数不动 = 中断根本没来，往前查设备树声明、INT_MASK、硬件连线；计数疯涨 = 风暴，往下查
- **触发类型列**：显示 `Edge` 而器件是电平型开漏输出，说明 GIC/GPIO 控制器的触发配置与设备树声明不符——类型写反的事故在这里一眼可见
- **CPU 分布列**：全部压在 CPU0 是默认行为；网络类高吞吐中断才需要动它

### 中断风暴定位

现象：`top` 里 ksoftirqd 或 irq/N 线程吃满 CPU，计数每秒涨几万。排查顺序：

1. 先怀疑**触发类型写反**（电平/边沿错位，占风暴事故的大多数）——对照手册与设备树
2. 再查**清源时序**：handler 是否真把 INT_STATUS 清掉了？RW1C 写成"读清"或写错寄存器，源永远清不掉，电平型中断原地风暴
3. 还查不到就开 irqsoff tracer 或 `perf top` 看时间花在哪个 handler（方法论见第23章，工具操作链 E.1）

### smp_affinity：把中断绑到指定 CPU

```bash
echo 2 > /proc/irq/89/smp_affinity     # 二进制掩码 0010：绑到 CPU1
cat /proc/irq/89/smp_affinity
```

实时系统里把高速中断从跑关键业务的 CPU 上挪走（互链 10.6.3 NO_HZ_FULL 与 C.06 实时化专题）；多队列网卡的亲和性配置见 14.6.2。普通传感器中断不值得动。

### 丢事件的三种典型根因

| 根因 | 机理 | 对策 |
|---|---|---|
| 清源在分发之后 | 分发期间到达的事件被一并清掉 | 先 RW1C 清源，再处理分发 |
| 边沿合并 | 处理期间来了两个边沿，控制器只记一个 pending | 电平触发，或 handler 里循环读到无数据为止 |
| drain 不及时 | 业务读得慢，FIFO 溢出标志置位 | poll/epoll 契约 + 查 FIFO_STATUS 溢出位报警 |

---

## <span class="blue"> Trade-off 表格 [E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 底半部 | threaded_fn | workqueue | threaded_fn 延迟低、与中断一对一；workqueue 适合批量重活，可复用已有队列 |
| 顶半部 | NULL（默认） | 自写顶半部 | I2C/SPI 设备默认即可；MMIO 设备需在顶半部快速屏蔽/确认时自写 |
| 触发获取 | 设备树声明 | irq_set_irq_type 代码强制 | DT 是硬件事实的正确归属；代码强制只在 workaround 硬件 bug 时用 |
| 共享中断 | IRQF_SHARED | 独占 | 共享省中断线但 handler 必须判状态位；独享简单但硬件未必允许 |
| 中断 CPU | 默认（CPU0） | smp_affinity 绑核 | 默认够用；实时/高吞吐场景才值得绑 |

---

## <span class="blue"> 常见陷阱 [E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 触发类型写反 | 中断全丢或原地风暴 | 电平/边沿与硬件输出形态不匹配 | 照手册输出形态选类型，/proc/interrupts 复核 |
| 忘 IRQF_ONESHOT | 电平型中断风暴 | 清源前中断线未屏蔽，重复触发 | 电平 + 线程化必配 ONESHOT |
| 中断里做 I2C | "scheduling while atomic" | 顶半部/softirq 里调用会睡眠的接口 | 读写寄存器全部放 irq_thread |
| handler 不判状态位 | 共享线下误处理、nobody cared | 没读 INT_STATUS 就当自家事件 | 无自家位置位返回 IRQ_NONE |
| 先分发后清源 | 偶发丢事件 | 分发窗口内的事件被清掉 | RW1C 清源在分发之前 |
| INT_MASK 忘开 | 中断永远不来 | 器件侧中断输出没使能 | probe 末尾开 INT_MASK，验证计数 |

---

## <span class="blue"> 动手练习

1. 设备树把 `IRQ_TYPE_LEVEL_LOW` 改成 `IRQ_TYPE_EDGE_FALLING`，加载后 `watch -n1 cat /proc/interrupts` 观察计数行为差异，再改回来——亲手制造一次"类型写反"。
2. 在 `ts502_irq_thread` 里把清源（②）和分发（③）对调，用 FIFO 高速率档压测，统计丢帧率；改回来对比，验证丢事件根因表的第一行。
3. `cat /proc/interrupts` 找到 ts502 行，`echo 2 > /proc/irq/N/smp_affinity` 绑到 CPU1，观察计数列迁移；思考为什么默认全压 CPU0 通常不是问题。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 触发类型 | 由硬件输出形态决定：开漏保持→电平，脉冲→边沿 | 类型与手册输出形态对得上吗 |
| client->irq | I2C 核心自动翻译 interrupts 属性 | 还在用 gpio_to_irq 吗 |
| 线程 handler | 读状态→清源（RW1C）→分发；可睡眠 | 清源在分发之前吗 |
| IRQF_ONESHOT | 电平 + 线程化必配，清源前保持屏蔽 | 电平型驱动配了吗 |
| IRQ_NONE | 无自家状态位必须返回 IRQ_NONE | 共享线判状态位了吗 |
| 底半部 | 默认 threaded_fn，重活转 workqueue，tasklet 禁用 | irq_thread 里有耗时批量活吗 |
| 三禁 | 硬中断禁睡眠/禁耗时/禁用户态拷贝 | copy_to_user 出现在 handler 里吗 |
| 调试 | /proc/interrupts 看计数/类型/分布；风暴先查触发类型 | 计数和类型列会读吗 |

---

## <span class="blue"> 下一步

INT 脚接管了"数据就绪"的通知，但还有一类事件硬件不会主动报告：周期性的动作——定时读一次温度写进 FIFO、给消抖定时器超时确认。下一篇（D.5 定时与延迟）讲 timer_list 与 hrtimer 的驱动用法、周期采样的正确实现、忙等待与睡眠的边界。

螺旋衔接：GPIO/中断——第6章 sysfs 操作（操作级）→ 第10章中断机制（理解级）→ 本篇（写法级）→ 第22章驱动架构决策（设计级）。★第3次出现（写法级）
