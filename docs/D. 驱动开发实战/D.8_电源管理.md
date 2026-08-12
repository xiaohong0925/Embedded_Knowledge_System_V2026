# D.8 电源管理

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[E→M] | 预计阅读时间：30 分钟
>
> 与第15章的分工：第15章讲电源管理机制——Runtime PM 引用计数模型与注册用法（15.1.2）、suspend 流程与 dpm_list 设备顺序（15.1.2/15.5）；本篇讲驱动作者在 suspend/resume 回调里写什么——上下文保存恢复清单、唤醒源配置、全链路验证。Runtime PM 的注册流程引用 15.1.2，本篇不重复。

## <span class="blue"> 本节导读

产品有夜间待机场景：屏幕灭了、CPU 睡了，TS502 还在以 100Hz 采样耗电。suspend/resume 不是"内核自动搞定的事"——内核只负责按 dpm_list 顺序逐个叫驱动的回调，回调里做什么，驱动自己负责。<BR>
本节覆盖：suspend/resume 回调的实现骨架、寄存器上下文清单的编制方法（哪类要存、哪类不管、硬件状态怎么决策）、`enable_irq_wake` 与 DT `wakeup-source` 声明、`/sys/power/wakeup_count` 验证、TS502 "停采样→休眠→INT 唤醒→恢复"全链路演练。

---

## <span class="blue"> suspend/resume 回调实现 [E]

```c
static int ts502_suspend(struct device *dev)
{
    struct ts502_data *data = dev_get_drvdata(dev);

    mutex_lock(&data->lock);

    /* ① 保存会丢失的寄存器上下文（片内 RAM 掉电即失） */
    data->saved_ctrl = i2c_smbus_read_byte_data(data->client, TS502_REG_CTRL);
    data->saved_int_mask = i2c_smbus_read_byte_data(data->client, TS502_REG_INT_MASK);
    data->saved_alarm = i2c_smbus_read_byte_data(data->client, TS502_REG_PWM_ALARM);

    /* ② 停业务：关采样使能（bit0 清零），保留阈值等静态配置 */
    i2c_smbus_write_byte_data(data->client, TS502_REG_CTRL,
                              data->saved_ctrl & ~0x01);

    /* ③ 唤醒源处理：声明了 wakeup-source 的板子，把 IRQ 转唤醒模式 */
    if (device_may_wakeup(dev))
        enable_irq_wake(data->client->irq);

    mutex_unlock(&data->lock);
    return 0;
}

static int ts502_resume(struct device *dev)
{
    struct ts502_data *data = dev_get_drvdata(dev);

    mutex_lock(&data->lock);

    if (device_may_wakeup(dev))
        disable_irq_wake(data->client->irq);   /* 与 suspend 严格对称 */

    /* ① 恢复寄存器上下文（顺序：先静态配置，后使能采样） */
    i2c_smbus_write_byte_data(data->client, TS502_REG_INT_MASK, data->saved_int_mask);
    i2c_smbus_write_byte_data(data->client, TS502_REG_PWM_ALARM, data->saved_alarm);
    i2c_smbus_write_byte_data(data->client, TS502_REG_CTRL, data->saved_ctrl);

    /* ② 清一遍残留中断状态，避免 suspend 期间的积压事件误触发 */
    i2c_smbus_write_byte_data(data->client, TS502_REG_INT_STATUS, 0xff);

    mutex_unlock(&data->lock);
    return 0;
}

static DEFINE_SIMPLE_DEV_PM_OPS(ts502_pm_ops, ts502_suspend, ts502_resume);

static struct i2c_driver ts502_driver = {
    .driver = {
        .name = "ts502",
        .of_match_table = ts502_of_match,
        .pm = pm_sleep_ptr(&ts502_pm_ops),   /* 未开 CONFIG_PM_SLEEP 时编译为空 */
    },
    /* …… */
};
```

三个写法要点：

1. **suspend 顺序是"先保存、再停机"**——先读出会丢的寄存器，再关采样。顺序反了，保存的就是停机后的状态
2. **resume 顺序是"先恢复配置、再使能"**——CTRL（采样使能）最后写，恢复期间不采样
3. **suspend/resume 里可以做 I2C**：suspend 回调在进程上下文跑（机制见 15.5），可以睡眠、可以 I2C 事务。真正的约束是**父设备可能已经先睡**——I2C 控制器驱动按 dpm_list 顺序在子设备之后 suspend（叶子先睡，15.1.2 的 dpm_list），所以子设备 suspend 里做 I2C 是安全的；反过来 resume 顺序父先子后，同样安全

---

## <span class="blue"> 上下文保存恢复清单：编制方法 [E]

不是"所有寄存器都保存一遍"。按三类归档：

| 类别 | 特征 | 处置 | TS502 实例 |
|---|---|---|---|
| 驱动配置过、掉电丢失 | 复位值 ≠ 期望值 | **必须保存恢复** | CTRL（采样率）、INT_MASK、PWM_ALARM |
| 复位值即预期 | 驱动从没改过，或复位值恰好正确 | 不管 | CHIP_ID（只读） |
| 硬件状态机内容 | FIFO 数据、内部计数器 | **显式决策**，不许默认 | FIFO 内容：丢弃（陈旧数据无意义） |

最容易漏的是第三类——FIFO 里存着休眠前的采样，resume 后业务读到的"新数据"其实是几小时前的。TS502 的决策是 resume 时软清 FIFO（写 CTRL 复位 FIFO 位），并在驱动注释里写明这个决策。**决策内容可以讨论，不做决策不可以**。

---

## <span class="blue"> 唤醒源：从"能被叫醒"到"验证过能叫醒" [E]

三步缺一不可：

```dts
/* ① 设备树声明（D.7 已备） */
    wakeup-source;
```

```c
/* ② probe 里使能设备的唤醒能力 */
    device_init_wakeup(&client->dev, true);
```

```c
/* ③ suspend/resume 里对称开关 IRQ 唤醒（见上文回调代码） */
```

`/sys` 侧的可验证痕迹：

```bash
cat /sys/class/wakeup/wakeup*/name          # ts502 对应的 wakeup 设备应出现
echo mem > /sys/power/state                 # 进休眠（串口另一个终端执行）
# …… 触发 TS502 报警，系统被唤醒 ……
cat /sys/power/wakeup_count                 # 计数 +1：唤醒事件被记录
pm_debug_messages? 不必，dmesg | grep -i wake
```

`wakeup_count` 是验收标准：休眠前记一个数，INT 唤醒后再看，**计数没涨说明唤醒路径没走通**——查 device_init_wakeup 是否调用、enable_irq_wake 是否对称、INT_MASK 在 suspend 后是否还允许报警中断输出。

---

## <span class="blue"> 全链路演练：TS502 停采样 → 唤醒 → 恢复 [E]

| 步骤 | 动作 | 验收点 |
|---|---|---|
| 1 | 配置采样率 10Hz、报警阈值 30°C，`echo mem > /sys/power/state` | 串口日志出现 ts502_suspend，无 I2C 错误 |
| 2 | 休眠中用万用表/功耗仪测 TS502 供电轨 | 采样关闭，电流下降到静态值 |
| 3 | 用手捂住传感器升温超过 30°C | INT 拉低 → 系统唤醒，wakeup_count +1 |
| 4 | resume 后读温度 | 数值正常更新（采样已恢复） |
| 5 | 读 PWM_ALARM 对应报警状态 | 阈值还是 30°C（上下文恢复成功） |
| 6 | 连续 suspend/resume 50 次 | 无寄存器错乱、无中断泄漏、无内存增长 |

第 6 步是回归测试的核心：单跑一次对的电源管理不算对，**反复休眠唤醒才会暴露保存清单漏项**（某次配置没恢复）和对称性漏洞（enable_irq_wake 泄漏导致第二次 suspend 后无法唤醒）。

### Runtime PM 的边界（用法引用 15.1.2）

系统级 suspend 之上还有运行时级：设备几分钟没人用就自动断电。注册与引用计数的用法见 15.1.2，本篇只给驱动侧的投入建议：**访问频繁、空闲即断电收益明确的设备（显示、存储、传感器集线器）值得上 Runtime PM**；TS502 这类毫瓦级 I2C 传感器，省电收益盖不过 get/put 配对的复杂度，系统级 suspend 就够了。I2C 子设备的 Runtime PM 实际由控制器父设备的电源域托管，别把两层混为一谈。

---

## <span class="blue"> Trade-off 表格 [E→M]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| FIFO 内容 | resume 时清空 | 保留继续读 | 清空语义干净；保留省数据但业务要分辨陈旧样本 |
| 上下文保存 | 读寄存器保存 | 用驱动侧影子值 | 读寄存器拿到真实状态；影子值省 I2C 但可能与硬件漂移 |
| 唤醒中断 | enable_irq_wake | 整路电源保持 | IRQ 唤醒精细省电；保持电源简单但漏电 |
| 省电层级 | 仅系统 suspend | 加 Runtime PM | 小功耗设备系统级足够；Runtime PM 复杂度换空闲省电 |
| 验证标准 | 手动跑一遍 | 50 次循环回归 | 单次验证漏间歇性问题；循环回归纳入产测 |

---

## <span class="blue"> 常见陷阱 [E→M]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 保存顺序反了 | resume 后配置全错 | 先停机后保存，存的是停机态 | 先读寄存器保存，再关采样 |
| 阈值寄存器漏恢复 | 唤醒后报警永远不触发 | 保存清单漏项 | 按三分类法编制清单，回归测试兜底 |
| enable_irq_wake 不对称 | 第二次 suspend 后唤不醒 | suspend enable 了，resume 忘 disable | 与 device_may_wakeup 配对检查 |
| FIFO 陈旧数据 | resume 后业务读到休眠前样本 | 硬件状态机没做决策 | resume 软清 FIFO 并写明注释 |
| wakeup_count 不验证 | 以为能唤醒实际不能 | 只写了代码没走通链路 | 计数变化是验收标准 |
| suspend 里怕做 I2C | 用 workqueue 绕路保存状态 | 误以为 suspend 是原子上下文 | 进程上下文可睡眠；约束在父设备顺序 |

---

## <span class="blue"> 动手练习

1. 按全链路演练表跑一遍 TS502 的 suspend/resume，记录 wakeup_count 变化与供电轨电流变化，把验收截图/日志存进项目资料库。
2. 从保存清单里故意删掉 PWM_ALARM，重复演练第 5 步，观察报警失效——体会清单漏项的症状，再改回来。
3. 注释掉 resume 里的 `disable_irq_wake`，连续 suspend/resume 两次，观察第二次无法唤醒；用 `/sys/kernel/debug/suspend_stats` 佐证对称性漏洞。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| suspend 顺序 | 先保存上下文，再停业务 | 保存的是停机前的状态吗 |
| resume 顺序 | 先恢复配置，最后使能采样 | 使能写在最后吗 |
| 清单三分类 | 配置过且会丢→存；复位值即预期→不管；硬件状态→显式决策 | FIFO 内容做决策了吗 |
| I2C 可行性 | suspend/resume 是进程上下文，可 I2C；父设备顺序由 dpm_list 保证 | 还在绕 workqueue 吗 |
| 唤醒三步 | DT wakeup-source + device_init_wakeup + enable_irq_wake 对称 | 三步齐了吗 |
| 验收 | wakeup_count 变化 + 50 次循环回归 | 只跑过一次吗 |

---

## <span class="blue"> 下一步

TS502 至此是一颗功能完整、能休眠唤醒的产品驱动——但"出问题好不好查"还没回答：寄存器全表怎么看、采样统计在哪暴露、打印怎么控制。下一篇（D.9 调试与可维护接口）讲 dynamic debug、sysfs 属性与 debugfs + seq_file，给驱动装上可观测性，也是 Part 1 的收官篇。

螺旋衔接：电源管理——第15章机制（理解级）→ 本篇（写法级）→ 第28章功耗全链路（系统级）。★第2次出现（写法级）
