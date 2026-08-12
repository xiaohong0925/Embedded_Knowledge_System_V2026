# D.10 input 子系统：按键与旋转编码器

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[I] | 预计阅读时间：35 分钟
>
> 与主线的分工：第22章讲子系统选型决策（选 input），本篇讲选定后的写法——现成驱动能不能用、自写 input 驱动怎么写、业务怎么收事件。中断/定时器写法引用 D.4/D.5，不重复。
>
> 与第6章的分工：6.2/6.3 是 GPIO 与 LED 框架的操作级初识；本篇是 input 框架的写法级教学。

## <span class="blue"> 本节导读

EC11 旋转编码器 + 轻触按键（旋转调音量、按下静音）是嵌入式产品最标准的输入组合。摆在你面前有三条路：内核现成驱动 `gpio-keys`/`rotary-encoder` 直接设备树声明零代码、自写 input 驱动、或者最差的——sysfs 轮询硬读 GPIO。本篇把三条路的判定标准、自写路径的完整写法、业务侧收事件的最小代码一次讲透。<BR>
本节覆盖：input 框架关系图与三条路判定表、现成驱动的设备树声明（零代码路径）、自写 input 驱动的完整案例（四状态机方向判定 + 定时器消抖 + REL/KEY 上报）、业务侧 epoll 读 evdev、evtest 验收、counter 子系统的语义分界（累计位置计数的另一条路）。

---

## <span class="blue"> 框架关系图与判定 [I]

```
你的驱动                    内核 input 核心                 用户态
─────────────         ─────────────────────         ─────────────────
gpio 中断/状态机  ──►   input_report_*()      ──►    evdev handler
input_register_device()  input core 事件队列          /dev/input/eventX
                        input_sync() 打包             read / epoll
drivers/input/input.c   drivers/input/evdev.c         libevdev / 业务
```

驱动只干两件事：注册时声明"我能产生哪些事件"，事件发生时上报。事件怎么排队、怎么分发给多个读者、怎么进 `/dev/input/eventX`，全部由 input 核心接管——这就是进框架买到的服务。

### 三条路判定表

| 场景 | 路径 | 理由 |
|---|---|---|
| 接法标准（GPIO 直连）、语义标准（按键=键值、旋钮=相对转动） | **现成驱动 + DT 声明，零代码** | `gpio-keys`/`rotary-encoder` 已覆盖，写代码是重复造轮子 |
| 需要定制消抖策略、组合键语义、非标准状态机 | 自写 input 驱动 | 现成驱动 binding 表达不了的语义 |
| 要"累计位置计数"（电机码盘、脉冲计数） | counter 子系统 | 见本篇末尾对照小节 |
| sysfs 轮询 / cdev 裸写 | **出局** | 业务层永远绑死私有接口，无法被 libinput/evtest 生态复用（11.1.4 的教训） |

判定标准一句话：**硬件接法与现成驱动的 binding 兼容，就直接设备树声明；语义需要定制时才自己写**。

---

## <span class="blue"> 路径一：现成驱动零代码 [I]

```dts
/* EC11 旋钮：rotary-encoder 现成驱动 */
rotary {
    compatible = "rotary-encoder";
    gpios = <&gpio1 10 GPIO_ACTIVE_HIGH>, <&gpio1 11 GPIO_ACTIVE_HIGH>;
    linux,axis = <REL_WHEEL>;              /* 上报为滚轮相对事件 */
    rotary-encoder,relative-axis;
    rotary-encoder,steps-per-period = <4>; /* 一个刻度 4 个电平周期 */
    wakeup-source;
};

/* 轻触按键：gpio-keys 现成驱动 */
keys {
    compatible = "gpio-keys";
    mute {
        label = "mute";
        gpios = <&gpio1 12 GPIO_ACTIVE_LOW>;
        linux,code = <KEY_ENTER>;          /* 上报回车键值 */
        debounce-interval = <5>;           /* 框架内建消抖，5ms */
    };
};
```

零代码拿到的功能：中断注册、消抖、事件上报、`/dev/input/eventX` 节点、唤醒源——全部来自现成驱动。源码走读（看它替你做了什么）：`drivers/input/misc/rotary_encoder.c` 的 probe 解析 `gpios`/`linux,axis` 属性、注册 threaded IRQ、handler 里读两相电平判定方向后 `input_report_rel()`；`drivers/input/keyboard/gpio-keys.c` 的 `debounce-interval` 用 `mod_timer` 顺延合并（D.5 范式一的框架内建版）。

---

## <span class="blue"> 路径二：自写 input 驱动 [I→E]

语义定制场景举例：旋钮要区分"慢转微调 / 快转粗调"两档键值——现成驱动没有这种语义，自己写。

### 四状态机：方向判定

EC11 两相输出是正交编码：A 相超前 B 相 90° 是一个方向，反之为另一方向。把 (A,B) 电平对看作状态 `0b00~0b11`，合法转换构成格雷码环，非法跳变（抖动）直接丢弃：

```
        顺时针                     逆时针
   00 → 01 → 11 → 10 → 00    00 → 10 → 11 → 01 → 00

   判定规则：新旧状态拼成 4bit 索引查表
   { 旧<<2 | 新 } → -1 / 0 / +1（方向×步进）
```

### 完整驱动骨架

```c
#include <linux/module.h>
#include <linux/platform_device.h>
#include <linux/input.h>
#include <linux/gpio/consumer.h>
#include <linux/interrupt.h>
#include <linux/timer.h>
#include <linux/of.h>

struct ec11_data {
    struct input_dev *input;
    struct gpio_desc *phase_a, *phase_b, *key;
    int irq_a, irq_b, irq_key;
    struct timer_list debounce;     /* D.5 范式一：顺延合并 */
    unsigned int last_state;        /* (A<<1)|B */
    int acc;                        /* 状态机累计步进，满 4 步报一格 */
};

/* 四状态机转换表：索引 = (旧态<<2)|新态，值 = 步进（0=非法/抖动）
 * 顺时针环 00→01→11→10→00 对应索引 0x1/0x7/0xe/0x8，同向必须同号 */
static const s8 ec11_table[16] = {
    [0x1] = +1, [0x7] = +1, [0xe] = +1, [0x8] = +1,   /* 顺时针 */
    [0x2] = -1, [0x4] = -1, [0xb] = -1, [0xd] = -1,   /* 逆时针 */
};

static irqreturn_t ec11_phase_irq(int irq, void *dev_id)
{
    struct ec11_data *data = dev_id;
    unsigned int state;
    int step;

    state = (gpiod_get_value(data->phase_a) << 1) |
             gpiod_get_value(data->phase_b);
    step = ec11_table[(data->last_state << 2) | state];
    data->last_state = state;
    if (!step)
        return IRQ_HANDLED;             /* 抖动：非法转换丢弃 */

    data->acc += step;
    if (data->acc >= 4 || data->acc <= -4) {   /* 一个完整刻度 */
        input_report_rel(data->input, REL_WHEEL, data->acc > 0 ? 1 : -1);
        input_sync(data->input);        /* 每组上报后同步（陷阱表第一行） */
        data->acc = 0;
    }
    return IRQ_HANDLED;
}

/* 按键：中断里不直接上报，mod_timer 顺延 5ms 后确认（D.4/D.5 结论复用） */
static irqreturn_t ec11_key_irq(int irq, void *dev_id)
{
    struct ec11_data *data = dev_id;

    mod_timer(&data->debounce, jiffies + msecs_to_jiffies(5));
    return IRQ_HANDLED;
}

static void ec11_key_confirm(struct timer_list *t)
{
    struct ec11_data *data = container_of(t, struct ec11_data, debounce);
    int pressed = gpiod_get_value(data->key);   /* ACTIVE_LOW 已换算 */

    input_report_key(data->input, KEY_ENTER, pressed);
    input_sync(data->input);
}

static int ec11_probe(struct platform_device *pdev)
{
    struct ec11_data *data;
    int ret;

    data = devm_kzalloc(&pdev->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;

    data->phase_a = devm_gpiod_get(&pdev->dev, "phase-a", GPIOD_IN);
    data->phase_b = devm_gpiod_get(&pdev->dev, "phase-b", GPIOD_IN);
    data->key     = devm_gpiod_get(&pdev->dev, "key", GPIOD_IN);
    if (IS_ERR(data->phase_a) || IS_ERR(data->phase_b) || IS_ERR(data->key))
        return dev_err_probe(&pdev->dev, -ENODEV, "missing gpios\n");

    /* ① 分配并声明能力：我能产生 REL_WHEEL 和 KEY_ENTER */
    data->input = devm_input_allocate_device(&pdev->dev);
    if (!data->input)
        return -ENOMEM;
    data->input->name = "ec11-volume";
    data->input->phys = "ec11/input0";
    input_set_capability(data->input, EV_REL, REL_WHEEL);
    input_set_capability(data->input, EV_KEY, KEY_ENTER);

    /* ② 中断注册（边沿触发：电平跳变即事件，见 D.4 触发类型表） */
    data->irq_a = gpiod_to_irq(data->phase_a);
    data->irq_b = gpiod_to_irq(data->phase_b);
    data->irq_key = gpiod_to_irq(data->key);
    ret = devm_request_threaded_irq(&pdev->dev, data->irq_a, NULL,
                                    ec11_phase_irq,
                                    IRQF_TRIGGER_BOTH | IRQF_ONESHOT,
                                    "ec11_a", data);
    if (ret)
        return dev_err_probe(&pdev->dev, ret, "irq_a failed\n");
    /* irq_b、irq_key 同理，省略 */

    timer_setup(&data->debounce, ec11_key_confirm, 0);
    data->last_state = (gpiod_get_value(data->phase_a) << 1) |
                        gpiod_get_value(data->phase_b);

    /* ③ 注册进 input 核心：此后事件才会流向 /dev/input/eventX */
    ret = input_register_device(data->input);
    if (ret)
        return dev_err_probe(&pdev->dev, ret, "input register failed\n");

    platform_set_drvdata(pdev, data);
    return 0;
}

static void ec11_remove(struct platform_device *pdev)
{
    struct ec11_data *data = platform_get_drvdata(pdev);

    timer_delete_sync(&data->debounce);         /* D.5 销毁纪律 */
}
```

> 💡 三个注册期要点：`input_set_capability()` 声明事件能力是上报的前提——没声明的事件类型上报了也会被核心丢弃；`devm_input_allocate_device()` 托管设备内存但 `input_register_device()` 后的 unregister 由 input 核心在 device 释放链里处理（devm 版在 remove 后自动 `input_unregister_device`）；`timer_delete_sync` 是 `del_timer_sync` 的新名字（6.15+），老内核写 `del_timer_sync`。

### 业务侧：epoll 读 evdev（最小代码）

```c
int fd = open("/dev/input/event2", O_RDONLY | O_NONBLOCK);
struct epoll_event ee = { .events = EPOLLIN, .data.fd = fd };
epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ee);

struct input_event ev;
while (read(fd, &ev, sizeof(ev)) == sizeof(ev)) {   /* drain 到 EAGAIN */
    if (ev.type == EV_REL && ev.code == REL_WHEEL)
        volume_adjust(ev.value);
    if (ev.type == EV_KEY && ev.code == KEY_ENTER)
        mute_toggle(ev.value);
}
```

业务侧深入（多设备管理、grab 独占、事件注入）链 A.3。

---

## <span class="blue"> counter 对照：累计位置计数的另一条路 [I]

input 的 REL_WHEEL 是"相对增量事件"——业务收到 +1/-1 自己累加。另一类需求是"绝对位置计数"：电机码盘走了多少脉冲、累计圈数，业务想直接读一个计数器。这个语义属于 **counter 子系统**（`drivers/counter/`）：`counter_count` 注册、sysfs 读 count 值、支持预设上限报警。分界一句话：**人机交互的"转了一下"用 input，工业计量的"一共转了多少"用 counter**。EC11 做人机旋钮选 input 是正确答案；同一个硬件拿去测电机位置就该选 counter。

---

## <span class="blue"> 调试与验收 [I]

```bash
cat /proc/bus/input/devices          # 找到 ec11-volume 对应的 eventN
evtest /dev/input/event2             # 交互式看事件流：旋转/按下实时打印
udevadm info /dev/input/event2       # 查看设备属性与 udev 规则挂接
```

无硬件后备：任何开发板自带的按键都已走 gpio-keys，`evtest` 直接可用——先练业务侧收事件，再回头补驱动侧。

---

## <span class="blue"> Trade-off 表格 [I]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 实现路径 | 现成驱动 + DT | 自写 input 驱动 | 现成零代码但语义固定；自写可控但需维护 |
| 消抖 | 框架内建 debounce-interval | 自写 mod_timer 状态机 | 内建够用；定制语义才自写（D.5 范式一） |
| 事件类型 | REL（相对增量） | ABS（绝对位置） | 旋钮/鼠标用 REL；摇杆/触摸用 ABS，选错业务解码全错 |
| 旋钮语义 | input REL_WHEEL | counter count | 人机交互用 input；工业计量用 counter |
| 中断触发 | IRQF_TRIGGER_BOTH | 单边沿 + 轮询另一相 | 双边沿判定完整；单边沿省一半中断但丢快速旋转 |

---

## <span class="blue"> 常见陷阱 [I]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 忘记 input_sync | 业务收到残缺事件包 | 上报后未发同步事件 | 每组上报后 `input_sync()` |
| 消抖定时器泄漏 | rmmod 后内核 oops | 卸载时未 del_timer_sync | remove 里 timer_delete_sync |
| REL/ABS 混淆 | 业务按相对量解码绝对量 | 事件类型语义选错 | 旋钮用 REL，摇杆/触摸用 ABS |
| evdev 独占 | 业务读不到事件 | 另一进程 EVIOCGRAB 了设备 | 排查 grab；多读者设计 |
| 能力未声明 | 上报的事件凭空消失 | 没 input_set_capability | 注册前声明全部事件类型 |

---

## <span class="blue"> 动手练习

1. 用现成驱动路径：设备树加 gpio-keys 声明板载按键，`evtest` 抓到 KEY 事件——零代码路径全程 15 分钟。
2. 有 EC11 的板子跑自写驱动，对比 `rotary-encoder` 现成驱动与自写版的事件输出；故意把 `input_sync` 注释掉，用 evtest 观察事件打包的变化。
3. 制造一次消抖失效：把 `debounce-interval` 改成 0（或自写版去掉 mod_timer 直接上报），快速旋转/抖动按键，统计误报事件数。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 判定 | 接法标准语义标准→现成驱动零代码；语义定制→自写 | 这次需求真的需要写代码吗 |
| 框架服务 | 注册声明能力 + 事件上报，队列与分发全由核心接管 | 还在自己维护事件队列吗 |
| 四状态机 | 格雷码环合法转换表，非法跳变丢弃即消抖 | 状态表覆盖全部 16 种转换吗 |
| input_sync | 每组上报后同步，残缺事件包的根源 | 每个上报分支后都调了吗 |
| counter 分界 | 人机交互用 input REL，工业计量用 counter | 需求是"转了一下"还是"转了多少" |
| 验收 | /proc/bus/input/devices + evtest | evtest 事件流符合预期吗 |

---

## <span class="blue"> 下一步

按键旋钮进了 input，传感器该进哪个框架？下一篇（D.11 IIO 子系统：传感器的标准写法）以 SHT3x 温湿度传感器为案例，讲 channel 定义、buffer+trigger 连续采样，并把 Part 1 的 TS502 cdev 驱动改写成 IIO 版——同一颗芯片两种写法一页对照。

螺旋衔接：GPIO 输入——第6章 sysfs 操作（操作级）→ 第10章中断机制（理解级）→ D.4 中断写法（写法级）→ 本篇进框架（框架级）→ 第22章子系统选型（设计级）。★第4次出现（框架级）
