# D.3 等待、阻塞与事件通知

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[E] | 预计阅读时间：35 分钟
>
> 与第12/13章的分工：13.5.4 讲 wait_event 宏模板与 waitqueue 机制，12.1.4 讲 do_poll 的内核路径；本篇讲驱动作者视角——阻塞 read 的正确睡法、missed wakeup 防法、poll 的驱动侧实现、fasync 信号通知，以及三种机制的选型。模板与机制一律引用主线，本篇不重复。

## <span class="blue"> 本节导读

D.2 之后 TS502 能读温度了，但业务只有一种姿势：死循环 read 轮询。轮询烧 CPU，睡固定间隔又引入延迟——FIFO 有数据、报警触发了，业务都不知道。本篇给驱动接上三种"有数据了叫我"的机制：阻塞 read（睡到数据就绪）、poll（接入 epoll 业务模型）、fasync（发 SIGIO 信号）。<BR>
本节覆盖：阻塞 read 的睡眠姿势与 O_NONBLOCK 分支、missed wakeup 的"条件先判后睡"防法与 wake_up 配对纪律、条件标志为什么不能直接读硬件寄存器、`fops->poll` 的 poll_wait + 掩码实现、EPOLLET 边沿触发对驱动侧的要求、fasync 三件套、三种机制的选型表。

---

## <span class="blue"> 问题：轮询的代价 [I]

D.2 的 read 是"有一帧给一帧"。业务要持续采温度，只能这样：

```c
while (1) {
    n = read(fd, buf, 2);        /* 没数据也立即返回 */
    if (n > 0)
        handle(buf);
    usleep(10000);               /* 睡 10ms 再试 */
}
```

`usleep` 的数字怎么拍都是错的：睡长了，数据就绪到被读取之间的延迟白白增加；睡短了，空转烧 CPU。这是驱动没提供通知机制时业务的唯一出路。正确结构是反过来——**业务睡到条件满足，驱动在条件满足时叫醒它**。内核提供三条通道，适用面不同：

| 机制 | 业务侧 | 适用场景 |
|---|---|---|
| 阻塞 read | read 自然挂起 | 单设备、顺序消费，最简单的业务模型 |
| poll/epoll | epoll_wait 多路复用 | 同时盯多个 fd 的业务（主流服务器式写法） |
| fasync | SIGIO 信号回调 | 简单事件通知，不需要读数据的场合 |

三条通道在驱动侧共用一个地基：wait_queue。本篇逐层搭上去。

---

## <span class="blue"> 阻塞 read：睡要睡得正确 [E]

### 影子标志：条件为什么不能读硬件

阻塞 read 的核心是一个等待条件："FIFO 非空"。第一反应是直接查芯片——`FIFO_STATUS` 深度大于零。这个写法是错的，原因在 wait_event 的求值环境：**条件表达式是在持有等待队列自旋锁的情况下被检查的**（机制见 13.5.4），自旋锁临界区里禁止睡眠，而 I2C 读寄存器（`i2c_smbus_read_byte_data`）是会睡眠的慢操作。在条件里读硬件，轻则拖垮调度延迟，重则触发 "scheduling while atomic" 直接警告。

正确做法是用内存里的**影子标志**：生产者（未来是中断 handler，D.4 接入）确认硬件状态后置标志，等待条件只检查这个内存标志。给 `ts502_data` 加三个成员：

```c
struct ts502_data {
    /* …… D.1/D.2 已有成员 …… */
    wait_queue_head_t wq;       /* 等待队列头：三条通知通道的地基 */
    struct fasync_struct *fasync;
    unsigned int fifo_ready;    /* 影子标志：1 = FIFO 有数据 */
    spinlock_t flag_lock;       /* 保护标志的变更与检查 */
};

/* probe 里 */
init_waitqueue_head(&data->wq);
spin_lock_init(&data->flag_lock);
```

### 条件先判后睡：missed wakeup 防法

```c
static ssize_t ts502_read(struct file *filp, char __user *buf,
                          size_t count, loff_t *ppos)
{
    struct ts502_data *data = filp->private_data;
    u8 frame[2];
    int ret;

    if (count < sizeof(frame))
        return -EINVAL;

    if (!READ_ONCE(data->fifo_ready)) {          /* 第一判：进来先看 */
        if (filp->f_flags & O_NONBLOCK)
            return -EAGAIN;                      /* 非阻塞：没数据就直说 */

        ret = wait_event_interruptible(data->wq,
                                       READ_ONCE(data->fifo_ready));
        if (ret)
            return ret;                          /* 被信号打断：-ERESTARTSYS */
    }

    /* 睡醒了：从 FIFO 弹出一帧 */
    ret = i2c_smbus_read_i2c_block_data(data->client, TS502_REG_FIFO_DATA,
                                        sizeof(frame), frame);
    if (ret < 0)
        return ret;

    /* FIFO 弹空了就清标志（深度查询的简化：本篇假设一帧一清） */
    spin_lock(&data->flag_lock);
    data->fifo_ready = 0;
    spin_unlock(&data->flag_lock);

    if (copy_to_user(buf, frame, sizeof(frame)))
        return -EFAULT;
    return sizeof(frame);
}
```

`wait_event_interruptible(wq, cond)` 的语义链条是：**先求值 cond → 不满足才登记睡眠 → 睡眠前再复查一次 cond**。这个"判-睡-复查"结构保证了：只要生产者按"先改条件、后 wake_up"的顺序行动，就不会出现"数据已经到了、读者却睡死了"的 missed wakeup。13.5.4 给了模板，这里强调的是驱动侧必须遵守的两条配对纪律：

1. **条件变更与 wake_up 成对出现**，且变更在前、唤醒在后——顺序反了，唤醒时条件还没成立，被唤醒者复查失败接着睡，事件丢失
2. **条件标志的写与 wake_up 之间不需要额外加锁保护"可见性"**——wake_up 内部的队列锁提供了内存屏障；但标志本身的更新要用 `READ_ONCE/WRITE_ONCE` 或锁保护，防止编译器和 CPU 乱序（13.3.3 的机制在驱动里的直接应用）

### 生产者侧（本篇的临时版本）

TS502 的数据就绪中断脚要 D.4 才接入，本篇先把生产者放在一个调试 ioctl 里——手动"踢"一下模拟数据就绪，把三条通知通道先跑通：

```c
/* 生产者：确认 FIFO 非空后的标准三动作（D.4 将整体搬进中断 handler） */
static void ts502_data_arrived(struct ts502_data *data)
{
    WRITE_ONCE(data->fifo_ready, 1);         /* ① 先改条件 */
    wake_up_interruptible(&data->wq);        /* ② 再唤醒阻塞读者 */
    kill_fasync(&data->fasync, SIGIO, POLL_IN);  /* ③ fasync 通道发信号 */
}
```

> 💡 `wait_event_interruptible` 被信号打断返回 `-ERESTARTSYS`，直接原样返回。不要自作聪明转成 `-EINTR`：VFS 会根据信号处理设置决定重试还是上传 EINTR，驱动越俎代庖会破坏 `SA_RESTART` 语义。

---

## <span class="blue"> poll：接入 epoll 业务模型 [E]

业务的现代写法是 epoll 同时盯几十个 fd（串口、socket、设备节点混在一个 epoll 集合里）。驱动侧只需实现一个 `fops->poll`：

```c
static __poll_t ts502_poll(struct file *filp, poll_table *wait)
{
    struct ts502_data *data = filp->private_data;
    __poll_t mask = 0;

    poll_wait(filp, &data->wq, wait);          /* 把本 fd 挂到等待队列 */

    if (READ_ONCE(data->fifo_ready))
        mask |= EPOLLIN | EPOLLRDNORM;         /* 当前可读就置位 */

    return mask;
}
```

两个动作缺一不可：`poll_wait` 登记（让 wake_up 能叫醒 epoll_wait 里的业务），返回掩码报告当前状态。内核侧 do_poll 怎么轮询、怎么睡眠见 12.1.4，驱动侧不需要关心。

### 掩码语义与 EPOLLET 的要求

- 可读置 `EPOLLIN | EPOLLRDNORM`（两个都置是惯例，部分老业务只查 POLLRDNORM）；设备异常置 `EPOLLERR`——不要在不认识的场景发明掩码
- 业务用 `EPOLLET`（边沿触发）时，对驱动有一条隐含契约：**事件到来后，数据必须"读到 EAGAIN 才算读完"**。如果驱动的 read 一次只给一帧、不清标志，边沿模式下业务读完一帧就走了，剩下的帧永远没有新边沿通知，数据滞留。TS502 的处理是 read 弹空 FIFO 才清 `fifo_ready`——标志清零对应" drain 完成"，下一批数据到来产生新边沿。写驱动文档（或自测）时必须明确：边沿模式下业务代码应该 `while (read(...) > 0);`

---

## <span class="blue"> fasync：SIGIO 信号通道 [I→E]

第三条通道最老也最简单：业务 `fcntl(fd, F_SETFL, O_ASYNC)` 之后，数据就绪时驱动发 SIGIO，业务在信号 handler 里收到通知。驱动侧三件套：

```c
static int ts502_fasync(int fd, struct file *filp, int on)
{
    struct ts502_data *data = filp->private_data;

    return fasync_helper(fd, filp, on, &data->fasync);
}

static int ts502_release(struct inode *inode, struct file *filp)
{
    ts502_fasync(-1, filp, 0);      /* 注销本 fd 的异步通知，防野信号 */
    return 0;
}

/* fops 里挂 .fasync = ts502_fasync */
/* 数据就绪时（见 ts502_data_arrived 第③步）：kill_fasync(&data->fasync, SIGIO, POLL_IN) */
```

release 里那句 `ts502_fasync(-1, filp, 0)` 不能省：fd 关了但 fasync 链表里还挂着，kill_fasync 会向已关闭的 filp 发信号，轻则警告重则 use-after-free。

### 选型结论

新代码默认 poll/epoll 路线。fasync 的合理场景是"通知即全部"的极简业务（按键守护进程收到 SIGIO 就知道该干活了）；它的短板是信号不携带数据、多 fd 时分不清来源、信号 handler 里能做的事受异步信号安全限制——需要读数据的场景最终还是要回到 read，那不如一开始就用 poll。

---

## <span class="blue"> 三种机制选型表 [I→E]

| 维度 | 阻塞 read | poll/epoll | fasync |
|---|---|---|---|
| 业务模型 | 单设备顺序消费 | 多 fd 事件循环 | 单设备极简通知 |
| 业务代码复杂度 | 最低 | 中（epoll 框架） | 低（信号 handler） |
| 超时支持 | wait_event_*_timeout | epoll_wait 超时参数 | 无内建，需 timerfd |
| 多路复用 | 不支持 | 核心能力 | 不支持 |
| 驱动侧成本 | wait_queue | poll_wait + 掩码 | fasync 三件套 |
| 典型用户 | 产测脚本、简单采集 | 服务器式业务主循环 | 按键/告警守护进程 |

三者不互斥：TS502 三条通道全部实现，业务按自己的架构选——这也是内核字符设备驱动的惯例（三者都提供，成本很低）。

---

## <span class="blue"> Trade-off 表格 [E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 等待方式 | 阻塞 read | poll + 非阻塞 | 阻塞简单直接；poll 支持多路与超时，业务架构自由 |
| 事件通知 | poll | fasync | poll 生态好（epoll/边沿电平可选）；fasync 适合"通知即全部" |
| 打断语义 | interruptible | 不可中断睡眠 | 可中断对业务友好；不可中断只在"睡到一半会出硬件事故"时用 |
| 条件实现 | 内存影子标志 | 条件里直接读硬件 | 影子标志安全快速；条件读硬件违反原子上下文约束 |
| 唤醒范围 | wake_up（全部） | wake_up_interruptible_nr（限个数） | 惊群效应明显时才需要限个数，默认全部唤醒 |

---

## <span class="blue"> 常见陷阱 [E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| missed wakeup | read 永远睡死，数据其实已到 | 先睡眠后检查条件，或先 wake 后改条件 | wait_event"判-睡-复查" + 先改条件后唤醒 |
| 条件里读硬件 | "scheduling while atomic" 警告 | 条件求值在自旋锁内，I2C 操作会睡眠 | 用内存影子标志，硬件状态由生产者读取 |
| O_NONBLOCK 死等 | 非阻塞 fd 被挂起 | 没判断 f_flags 就走了阻塞路径 | 先判 O_NONBLOCK 返回 -EAGAIN |
| EPOLLET 数据滞留 | 边沿模式下业务漏数据 | read 没 drain 干净，无新边沿 | 读到 EAGAIN 为止；文档写明契约 |
| release 漏注销 fasync | 关 fd 后内核警告/崩溃 | fasync 链表残留已关闭 filp | release 里 `fasync(-1, filp, 0)` |
| 信号打断被吞 | Ctrl+C 杀不掉业务 | 用不可中断睡眠或吞掉 -ERESTARTSYS | interruptible 版 + 原样返回 |

---

## <span class="blue"> 动手练习

1. 在调试 ioctl 里加 `TS502_IOC_KICK` 调用 `ts502_data_arrived()`，跑通三条通道：阻塞 read 挂住 → KICK 后返回一帧；`select()` demo 挂住 → KICK 后返回可读；O_ASYNC + SIGIO handler → KICK 后信号到达。
2. 制造一次 missed wakeup：把 `ts502_data_arrived` 里①②顺序对调（先 wake_up 后改标志），用阻塞 read 高并发压测，观察偶发的"叫不醒"——然后改回来，理解顺序为什么重要。
3. 用 python + select.epoll（EPOLLET）写业务侧，KICK 两次只读一帧，观察第二次事件"丢"了；改成 read 到 EAGAIN 后修复，体会边沿触发契约。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 影子标志 | 等待条件查内存标志，禁止在条件里读硬件 | 条件求值环境能睡眠吗 |
| 判-睡-复查 | wait_event 先判条件再睡，睡醒复查 | 生产者先改条件还是先 wake |
| 配对纪律 | 条件变更在前、wake_up 在后，成对出现 | 有没有只 wake 不改条件的路径 |
| O_NONBLOCK | 非阻塞 fd 没数据返回 -EAGAIN，不许睡 | f_flags 判了吗 |
| poll | poll_wait 登记 + 掩码报告，两个动作缺一不可 | EPOLLIN 和 EPOLLRDNORM 都置了吗 |
| EPOLLET | 边沿模式要求"读到 EAGAIN"契约 | read drain 干净才清标志吗 |
| fasync | 三件套 + release 注销 | 关 fd 后会发野信号吗 |
| 选型 | 三条通道都提供，业务自选 | 通道语义写进驱动文档了吗 |

---

## <span class="blue"> 下一步

三条通知通道的地基（wait_queue）搭好了，但生产者还是个手动"踢"的假货——真实的生产者是 TS502 的 INT 中断脚。下一篇（D.4 中断实战）把 INT 脚接进来：设备树声明、edge/level 触发、假中断处理、底半部选型，让"数据就绪"这件事由硬件说了算。

螺旋衔接：等待与通知——第13.5.4章 waitqueue 机制（理解级）→ 12.1.4 do_poll 内核路径（理解级）→ 本篇（写法级）→ A.3 epoll 业务架构（应用级）。★第3次出现（写法级）
