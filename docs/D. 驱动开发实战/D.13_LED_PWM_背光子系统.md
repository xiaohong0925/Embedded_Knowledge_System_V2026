# D.13 LED/PWM/背光子系统

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[I] | 预计阅读时间：30 分钟
>
> 与第6章的分工：第6章是 LED 的操作级教学（sysfs 点灯、LED 框架初识 6.3.2）；本篇是写法级——什么时候不用写驱动（现成 leds-gpio/pwm-leds），什么时候写 led_classdev 驱动、怎么写，以及背光框架与显示栈的关系。

## <span class="blue"> 本节导读

点灯是嵌入式的"Hello World"，但产品里的灯远比第6章复杂：状态灯要 heartbeat 呼吸节奏、电量灯要 PWM 调光、屏幕背光要跟显示栈联动。好消息是——**绝大多数点灯需求一行驱动代码都不用写**。本篇先给"零代码"判定，再讲需要自写的场景怎么写。<BR>
本节覆盖：LED 三条路判定表、leds-gpio/pwm-leds 零代码路径、led_classdev 自写骨架（含 brightness_set 与 brightness_set_blocking 的上下文分界）、led-trigger 机制与自写 trigger、背光框架与 pwm-backlight、`/sys/class/leds` 验收。

---

## <span class="blue"> 三条路判定 [I]

| 灯的形态 | 路径 | 理由 |
|---|---|---|
| GPIO 直连的状态灯 | **leds-gpio 零代码** | DT 声明即可，trigger 全可用 |
| PWM 调光灯（亮度/呼吸） | **pwm-leds 零代码** | 同上 |
| 专用 LED 驱动芯片（I2C/SPI 接口，多路灯、灯效协处理器） | 自写 led_classdev 驱动 | 硬件访问需要协议交互，框架外无现成 |
| 屏幕背光 | **pwm-backlight 零代码**；专用背光芯片才自写 backlight 驱动 | 背光有独立框架，见本篇末尾 |

内核 `drivers/leds/` 下已有一百多个 LED 芯片驱动（LP55xx、IS31FL 系列……），自写前先查一遍——你的芯片很可能已经有人写了。

框架分层——驱动在最底，往上一层比一层"不用写"：

```
事件源（heartbeat 定时器 / 网口活动 / 业务 echo）
        │
LED 核心（drivers/leds/led-class.c）
        │  trigger 调度：把事件翻译成亮度序列
        │  sysfs 节点：/sys/class/leds/<name>/{brightness,trigger}
        │  回调分发：brightness_set（原子）/ brightness_set_blocking（可睡眠）
        ▼
驱动层：现成驱动（leds-gpio / pwm-leds / 芯片专用）或你的 led_classdev
        ▼
硬件：GPIO / PWM 通道 / I2C·SPI LED 芯片
```

---

## <span class="blue"> 零代码路径 [I]

```dts
/* GPIO 状态灯：leds-gpio */
leds {
    compatible = "gpio-leds";
    status {
        label = "green:status";
        gpios = <&gpio1 8 GPIO_ACTIVE_HIGH>;
        linux,default-trigger = "heartbeat";   /* 上电即心跳呼吸 */
        default-state = "on";
    };
    link {
        label = "blue:link";
        gpios = <&gpio1 9 GPIO_ACTIVE_LOW>;
        linux,default-trigger = "netdev";      /* 网口活动灯 */
    };
};

/* PWM 调光灯：pwm-leds */
pwmleds {
    compatible = "pwm-leds";
    backlight_led {
        label = "white:dim";
        pwms = <&pwm2 0 50000>;               /* PWM 通道 + 周期 ns */
        max-brightness = <255>;
    };
};
```

零代码拿到的服务：`/sys/class/leds/green:status/` 全套节点、trigger 调度、亮度映射、suspend/resume 处理。验收：

```bash
cat /sys/class/leds/green:status/trigger
none [heartbeat] timer netdev mtd ...      # 方括号是当前生效的 trigger
echo timer > /sys/class/leds/green:status/trigger
echo 100 > /sys/class/leds/green:status/delay_on   # timer trigger 的占空参数
```

---

## <span class="blue"> 自写路径：led_classdev 骨架 [I→E]

以一颗 I2C 十六路 LED 驱动芯片（IS31FL 风格）为例，每路注册一个 led_classdev：

```c
#include <linux/leds.h>

struct myled_data {
    struct i2c_client *client;
    struct mutex lock;
};

struct myled_channel {
    struct myled_data *chip;
    struct led_classdev cdev;
    int channel;                            /* 0-15 */
};

/* I2C 芯片的写寄存器会睡眠——必须用 blocking 版回调 */
static int myled_brightness_set(struct led_classdev *cdev,
                                enum led_brightness brightness)
{
    struct myled_channel *ch = container_of(cdev, struct myled_channel, cdev);
    int ret;

    mutex_lock(&ch->chip->lock);
    ret = i2c_smbus_write_byte_data(ch->chip->client,
                                    0x10 + ch->channel, brightness);
    mutex_unlock(&ch->chip->lock);
    return ret;
}

static int myled_probe(struct i2c_client *client)
{
    struct myled_data *data;
    int i, ret;

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->client = client;
    mutex_init(&data->lock);

    for (i = 0; i < 16; i++) {
        struct myled_channel *ch;

        ch = devm_kzalloc(&client->dev, sizeof(*ch), GFP_KERNEL);
        if (!ch)
            return -ENOMEM;
        ch->chip = data;
        ch->channel = i;

        ch->cdev.name = devm_kasprintf(&client->dev, GFP_KERNEL,
                                       "myled:ch%d", i);
        ch->cdev.max_brightness = 255;
        ch->cdev.brightness_set_blocking = myled_brightness_set;
        ch->cdev.flags = LED_CORE_SUSPENDRESUME;   /* 挂起恢复时框架重放亮度 */

        ret = devm_led_classdev_register(&client->dev, &ch->cdev);
        if (ret)
            return dev_err_probe(&client->dev, ret, "ch%d register failed\n", i);
    }
    return 0;
}
```

最关键的一个写法决策——**两个回调的上下文分界**：

| 回调 | 调用上下文 | 适用 |
|---|---|---|
| `brightness_set` | **原子上下文**（可能从定时器/软中断路径调用） | GPIO/MMIO 写寄存器这类不睡眠的操作 |
| `brightness_set_blocking` | 进程上下文（框架内部经 workqueue 转一道） | I2C/SPI 芯片——会睡眠的硬件访问 |

I2C LED 芯片错挂 `brightness_set` 是经典事故：heartbeat trigger 由定时器驱动，每次心跳都在原子上下文调你的回调——`i2c_smbus_write_byte_data` 一睡眠，"scheduling while atomic" 立刻现身。**硬件访问会睡眠就挂 blocking 版**，这一条不出错，LED 驱动就没什么可错的了。

### trigger：事件到灯效的翻译层

trigger 是 LED 框架的灵魂：把"系统事件"翻译成"亮度序列"，驱动本身完全不用参与。内核自带 heartbeat（心跳）、timer（定时闪烁）、netdev（网口活动）、mtd（存储活动）、cpu（CPU 占用）等。自写 trigger 的场合（如"收到报警事件快闪三下"）：

```c
static void mytrigger_activate(struct led_classdev *cdev)
{
    led_trigger_event(&data->trigger, LED_FULL);    /* 推一个事件 */
}
led_trigger_register(&data->trigger);   /* 之后 DT/sysfs 即可引用 */
```

业务侧还有一条零驱动的路：`echo 1 > /sys/class/leds/x/brightness` 直接控制——产测与调试的常用手段（第6章的操作级路径）。

---

## <span class="blue"> 背光：与显示栈的关系 [I]

背光有独立框架（`backlight_device`），因为它天然属于显示链路而非状态指示：

```dts
/* 零代码路径：pwm-backlight */
backlight {
    compatible = "pwm-backlight";
    pwms = <&pwm1 0 50000>;
    brightness-levels = <0 64 128 192 255>;   /* 非线性亮度表 */
    default-brightness-level = <3>;
    power-supply = <&vcc_bl>;
};
/* 显示节点引用：panel/drm 侧 enable 时自动带起背光 */
&dsi_panel { backlight = <&backlight>; };
```

背光与显示栈的联动（panel prepare → backlight enable 的时序、DRM 侧的属性暴露）属于显示专题，链 G.1/G.2；专用背光芯片（I2C 调光、电流槽配置）才需要自写 `backlight_ops`（`update_status`/`get_brightness`）驱动，骨架与 led_classdev 同构。

---

## <span class="blue"> 调试与验收 [I]

```bash
ls /sys/class/leds/                          # 所有已注册 LED
echo 128 > /sys/class/leds/white:dim/brightness   # 手动调光
cat /sys/class/leds/green:status/max_brightness   # 核对亮度范围
cat /sys/class/leds/green:status/uevent           # OF_FULLNAME 等 DT 来源信息
```

无硬件后备：任何开发板都有 LED（第6章点过），零代码路径与 trigger 切换可完整演练。

---

## <span class="blue"> Trade-off 表格 [I]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 实现路径 | leds-gpio/pwm-leds 零代码 | 自写 led_classdev | 绝大多数灯零代码；专用芯片才自写 |
| 回调版本 | brightness_set | brightness_set_blocking | 不睡眠挂前者；I2C/SPI 必须 blocking |
| 灯效实现 | 自写 trigger | 业务写 brightness | trigger 内核自治、业务零负担；业务控制灵活但要常驻 |
| 亮度映射 | 线性 max-brightness | brightness-levels 查表 | 人眼对亮度非线性，查表更舒服但要标定 |
| 背光归属 | backlight 框架 | 当普通 LED 处理 | 显示链路联动必须 backlight；指示灯才归 LED |

---

## <span class="blue"> 常见陷阱 [I]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| I2C 芯片挂 brightness_set | "scheduling while atomic" | 原子上下文回调里做 I2C | 换 brightness_set_blocking |
| 忘 max_brightness | 亮度范围错乱 | 框架默认 255 与芯片不符 | 按芯片位宽显式设置 |
| trigger 名拼错 | DT 声明后灯不闪 | linux,default-trigger 与内核 trigger 名不符 | `cat trigger` 核对可选列表 |
| 挂起后灯状态丢失 | resume 后灯全灭 | 没设 LED_CORE_SUSPENDRESUME | 框架重放亮度标志补上 |
| 背光写成 LED | 显示栈管不到背光 | 用错框架 | 屏背光走 backlight + phandle 引用 |

---

## <span class="blue"> 动手练习

1. 零代码路径：给板载 LED 加 gpio-leds 声明，依次切 heartbeat/timer/netdev trigger，`cat trigger` 核对生效项。
2. 有 I2C LED 芯片的板子跑自写骨架；故意把回调挂成 `brightness_set`，开 heartbeat trigger 复现原子上下文睡眠告警，改回 blocking 修复。
3. 写一个三行 trigger 练习：`echo timer > trigger` 后调 `delay_on/delay_off`，用示波器或手机慢动作验证占空比与理论值一致。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 判定 | GPIO/PWM 灯零代码，专用芯片才自写 | 内核已有驱动查过了吗 |
| 回调分界 | 会睡眠的硬件访问挂 brightness_set_blocking | I2C 芯片挂对版本了吗 |
| trigger | 事件到灯效的翻译层，驱动零参与 | 灯效是内核自治还是业务在刷 |
| suspend | LED_CORE_SUSPENDRESUME 重放亮度 | 挂起恢复测过吗 |
| 背光 | 独立框架，与显示栈 phandle 联动 | 背光没塞进 LED 框架吧 |
| 验收 | /sys/class/leds 三件套 | trigger 列表核对了吗 |

---

## <span class="blue"> 下一步

灯点完了，轮到三个"小但每块板都有"的框架：watchdog、RTC、misc。下一篇（D.14 watchdog/RTC/misc：小件三剑客）给三个框架的最小骨架，并收口 misc 与 cdev 的选择判据——Part 1 留了这个问题。

螺旋衔接：LED——第6.2章 sysfs 点灯（操作级）→ 6.3.2 框架初识（认知级）→ 本篇（框架级）→ 第22章选型（设计级）。★第3次出现（框架级）
