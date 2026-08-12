# D.12 hwmon 与 thermal 联动：从读温度到控风扇

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[E] | 预计阅读时间：30 分钟
>
> 与第15章的分工：15.4.1 讲 thermal 三层架构与 trip point/cooling device 概念，15.4.2 讲 Governor 对比与 thermal-zones 设备树配置（含完整示例），15.4.3 讲 cpufreq 协同；本篇讲主线没写的驱动侧写法——hwmon 驱动的完整注册、传感器挂接 thermal 的代码、cooling device 的自写实现（PWM 风扇）。
>
> 与11.1.1的分工：11.1.1 给 hwmon 最小示例；本篇给产品级完整写法与闭环链路。

## <span class="blue"> 本节导读

D.11 的判定表里，监控用途的传感器留 hwmon。但 hwmon 驱动写完只走完一半——读到温度之后，怎么让风扇自动转起来？这另一半是 thermal 联动：传感器挂接为 thermal zone 的温度源，风扇注册为 cooling device，内核 Governor 按 trip point 自动调速。<BR>
本节覆盖：hwmon 驱动的产品级写法（`hwmon_channel_info` + ops 三回调）、传感器挂接 thermal 的一行代码（`devm_thermal_of_zone_register`）、cooling device 自写（PWM 风扇，get/set_cur_state 三回调）、闭环验收方法。Governor 选型与 thermal-zones 的 DT 写法见 15.4.2，本篇不重复。

---

## <span class="blue"> 闭环全景 [I]

```
hwmon 驱动                thermal 核心                  cooling device
──────────────       ────────────────────────       ──────────────────
读温度寄存器    ──►   thermal_zone（温度源）   ──►    PWM 风扇驱动
hwmon_device         trip point 越界判定            set_cur_state()
register_with_info   Governor 调速（15.4.2）         pwm_apply_state()
                     thermal_core.c                  转速 ◄── 温度闭环
```

三个角色三种驱动：温度源（hwmon）、裁判（thermal 核心，内核自带）、执行者（cooling device，风扇驱动要自己写）。本篇写第一个和第三个，中间的接线在设备树里完成。

---

## <span class="blue"> hwmon 驱动的产品级写法 [E]

11.1.1 的 mysoctemp.c 展示了最小形态。产品级写法用 `hwmon_device_register_with_info`——属性文件由框架按 channel 声明自动生成，不写 `sysfs_create`：

```c
#include <linux/hwmon.h>

struct mytemp_data {
    struct i2c_client *client;
    struct mutex lock;
};

/* ① 读回调：按 channel 类型分发，单位是框架规定的毫度/毫伏/毫安 */
static int mytemp_read(struct device *dev, enum hwmon_sensor_types type,
                       u32 attr, int channel, long *val)
{
    struct mytemp_data *data = dev_get_drvdata(dev);
    int raw;

    if (type != hwmon_temp || attr != hwmon_temp_input)
        return -EOPNOTSUPP;

    mutex_lock(&data->lock);
    raw = i2c_smbus_read_word_data(data->client, 0x01);  /* 读温度寄存器 */
    mutex_unlock(&data->lock);
    if (raw < 0)
        return raw;

    *val = (raw >> 4) * 625 / 10;      /* 换算成毫摄氏度：0.0625°C/LSB */
    return 0;
}

static umode_t mytemp_is_visible(const void *drvdata,
                                 enum hwmon_sensor_types type,
                                 u32 attr, int channel)
{
    return 0444;                        /* 只读 */
}

static const struct hwmon_ops mytemp_hwmon_ops = {
    .is_visible = mytemp_is_visible,
    .read = mytemp_read,
};

/* ② channel 声明：框架据此生成 temp1_input 等标准属性 */
static const struct hwmon_channel_info * const mytemp_info[] = {
    HWMON_CHANNEL_INFO(temp, HWMON_T_INPUT),
    NULL
};

static const struct hwmon_chip_info mytemp_chip_info = {
    .ops = &mytemp_hwmon_ops,
    .info = mytemp_info,
};

/* 挂接 thermal 所需的最小 ops：把温度值透传给 thermal 框架（单位同为毫度） */
static int mytemp_get_temp(void *arg, int *temp)
{
    struct mytemp_data *data = arg;
    int raw;

    mutex_lock(&data->lock);
    raw = i2c_smbus_read_word_data(data->client, 0x01);
    mutex_unlock(&data->lock);
    if (raw < 0)
        return raw;
    *temp = (raw >> 4) * 625 / 10;
    return 0;
}

static const struct thermal_zone_of_device_ops mytemp_thermal_ops = {
    .get_temp = mytemp_get_temp,
};

static int mytemp_probe(struct i2c_client *client)
{
    struct mytemp_data *data;
    struct device *hwmon_dev;

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->client = client;
    mutex_init(&data->lock);
    i2c_set_clientdata(client, data);

    /* ③ 注册：devm 版，remove 为空 */
    hwmon_dev = devm_hwmon_device_register_with_info(&client->dev,
                                                     "mytemp", data,
                                                     &mytemp_chip_info, NULL);

    /* ④ 挂接 thermal：一行代码让本传感器成为 thermal zone 的温度源 */
    if (!IS_ERR(hwmon_dev))
        devm_thermal_of_zone_register(hwmon_dev, 0, data, &mytemp_thermal_ops);

    return PTR_ERR_OR_ZERO(hwmon_dev);
}
```

写法要点三个：

1. **单位是框架契约**：hwmon 规定温度输出毫摄氏度、电压毫伏、电流毫安——`temp1_input` 读出的 `23750` 表示 23.75°C。换算在驱动里做完，用户态（lm-sensors、telegraf 等）全部按标准单位消费
2. **channel 声明生成属性**：`HWMON_CHANNEL_INFO(temp, HWMON_T_INPUT)` 声明后框架自动建 `temp1_input`，声明 `HWMON_T_MAX` 就有 `temp1_max` 及对应写回调——声明即接口
3. **`devm_thermal_of_zone_register` 是联动开关**：挂上之后，设备树 `thermal-zones` 里以本传感器为 `thermal-sensors` 引用的 zone 就能拿到温度。不挂这一行，sensor 只是 sensor，闭环断路

---

## <span class="blue"> cooling device 自写：PWM 风扇 [E]

thermal 核心调速时，调用的是 cooling device 的 `set_cur_state`——这个回调的实现就是风扇驱动的核心。三个回调构成全部接口：

```c
#include <linux/thermal.h>
#include <linux/pwm.h>

struct fan_data {
    struct pwm_device *pwm;
    struct thermal_cooling_device *cdev;
    unsigned long max_state;            /* 档位总数 - 1，如 4 档 */
};

static int fan_get_max_state(struct thermal_cooling_device *cdev,
                             unsigned long *state)
{
    struct fan_data *data = cdev->devdata;

    *state = data->max_state;
    return 0;
}

static int fan_get_cur_state(struct thermal_cooling_device *cdev,
                             unsigned long *state)
{
    struct fan_data *data = cdev->devdata;
    struct pwm_state p;

    pwm_get_state(data->pwm, &p);
    *state = p.duty_cycle * data->max_state / p.period;   /* 占空比→档位 */
    return 0;
}

static int fan_set_cur_state(struct thermal_cooling_device *cdev,
                             unsigned long state)
{
    struct fan_data *data = cdev->devdata;
    struct pwm_state p;

    if (state > data->max_state)
        return -EINVAL;

    /* 档位 → PWM 占空比：线性映射，档 0 停转 */
    pwm_get_state(data->pwm, &p);
    p.duty_cycle = state ? p.period * state / data->max_state : 0;
    p.enabled = state > 0;
    return pwm_apply_state(data->pwm, &p);
}

static const struct thermal_cooling_device_ops fan_cooling_ops = {
    .get_max_state = fan_get_max_state,
    .get_cur_state = fan_get_cur_state,
    .set_cur_state = fan_set_cur_state,
};

static int fan_probe(struct platform_device *pdev)
{
    struct fan_data *data;

    data = devm_kzalloc(&pdev->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->max_state = 4;                                  /* 5 档调速 */
    data->pwm = devm_pwm_get(&pdev->dev, NULL);
    if (IS_ERR(data->pwm))
        return dev_err_probe(&pdev->dev, PTR_ERR(data->pwm), "no pwm\n");

    /* 注册为 cooling device：名字 "pwm-fan" 与 DT 的 cooling-device 引用对应 */
    data->cdev = devm_thermal_cooling_device_register(&pdev->dev, "pwm-fan",
                                                      data, &fan_cooling_ops);
    return PTR_ERR_OR_ZERO(data->cdev);
}
```

内核已有现成 `pwm-fan` 驱动（`drivers/thermal/pwm_fan.c`，支持转速计反馈与完整 DT binding）——本篇这个简化版是教学骨架，**产品里先用现成驱动，判定逻辑与 D.10 相同**：binding 兼容就 DT 声明零代码。

设备树接线（结构示意，字段详解见 15.4.2）：

```dts
thermal-zones {
    soc_thermal {
        thermal-sensors = <&mytemp 0>;      /* 温度源：hwmon 传感器 */
        trips {
            trip0 { temperature = <60000>; type = "active"; };
            trip1 { temperature = <75000>; type = "active"; };
        };
        cooling-maps {
            map0 { trip = <&trip0>; cooling-device = <&fan 1 1>; };
            map1 { trip = <&trip1>; cooling-device = <&fan 2 4>; };
        };
    };
};
```

`cooling-maps` 里 `<&fan 1 1>` 的两个数字是该 trip 触发时风扇被允许运行的档位区间——60°C 挂 1 档，75°C 允许 2-4 档，Governor 在区间内选档（策略对比见 15.4.2）。

---

## <span class="blue"> 闭环验收 [E]

```bash
ls /sys/class/thermal/                          # thermal_zoneX 与 cooling_deviceX 都出现
cat /sys/class/thermal/thermal_zone0/temp       # 温度源在报数
cat /sys/class/thermal/thermal_zone0/policy     # 当前 Governor
echo 3 > /sys/class/thermal/cooling_device0/cur_state   # 手动调速验证风扇
```

闭环测试三招：手捂/热风枪加热传感器看 `cur_state` 随温度自动上升；堵住进风口慢速升温验证 trip 逐级触发；`echo step_wise > policy` 与 `fair_share` 切换观察调速行为差异（策略语义见 15.4.2）。

---

## <span class="blue"> Trade-off 表格 [E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 风扇驱动 | 现成 pwm-fan | 自写 cooling device | 现成支持转速计；自写只在语义定制时 |
| 传感器框架 | hwmon + of_zone 挂接 | IIO + iio-channel 挂接 | 监控用途 hwmon 路径最顺（D.11 判定表） |
| 调速档位 | 线性映射 | 查表（温度-转速曲线） | 线性简单；查表匹配风扇特性但需实测标定 |
| 闭环位置 | 内核 thermal 框架 | 用户态守护进程调速 | 内核闭环断业务也能保命；用户态灵活但依赖业务存活 |
| 温度单位 | 驱动内换算毫度 | 直出原始值 | hwmon 契约要求毫度，原始值破坏所有上层工具 |

---

## <span class="blue"> 常见陷阱 [E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 忘挂 of_zone | thermal_zone 的 temp 永远是 0 | 只注册 hwmon 没调 devm_thermal_of_zone_register | 注册成功后立即挂接 |
| 单位搞错 | 上层显示 23000°C | 输出原始值没换算毫摄氏度 | 按 hwmon 单位契约换算 |
| 档位区间写反 | 越热风扇越慢 | cooling-maps 的 min/max 填反 | trip 越高允许档位越高 |
| set_cur_state 不校验 | Governor 设置超范围档位 | 没查 state > max_state | 超界返回 -EINVAL |
| 档 0 不停转 | 最低档风扇还在嗡嗡转 | duty_cycle=0 但没 disable PWM | state 0 时 enabled=false |

---

## <span class="blue"> 动手练习

1. 在有 PWM 风扇的板子上声明现成 `pwm-fan` 驱动 + thermal-zones，手动 `echo N > cur_state` 听转速变化，验证 cooling device 侧。
2. 给 D.11 的 SHT3x（或 iio_dummy 外的任一 hwmon 传感器）加 `devm_thermal_of_zone_register`，配一个 trip point，用热风枪验证闭环。
3. 把 `policy` 在 step_wise 与 fair_share 之间切换，固定热源记录 cur_state 曲线，对照 15.4.2 的策略语义解释差异。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| hwmon 写法 | channel 声明生成属性，单位契约毫度/毫伏/毫安 | 换算做了吗 |
| thermal 挂接 | devm_thermal_of_zone_register 是联动开关 | 注册后挂了吗 |
| cooling device | get_max/get_cur/set_cur 三回调即全部接口 | set 里校验超界了吗 |
| 接线在 DT | thermal-sensors 引用 + cooling-maps 档位区间 | 区间随 trip 递增吗 |
| 判定 | pwm-fan 现成优先，语义定制才自写 | 真的需要自写吗 |
| 验收 | /sys/class/thermal 三件套 + 加热闭环测试 | 闭环实测过吗 |

---

## <span class="blue"> 下一步

监控与闭环讲完了，回到最简单也最常见的需求：点灯。第6章用 sysfs 点过 LED，下一篇（D.13 LED/PWM/背光子系统）讲 led_classdev 写法、led-trigger 机制与 pwm-leds 现成驱动——什么时候点灯也不用写驱动。

螺旋衔接：温度监控——11.1.1 hwmon 最小示例（认知级）→ 本篇闭环写法（框架级）→ 15.4 thermal 机制（理解级）→ 第28章功耗全链路（系统级）。★第2次出现（框架级）
