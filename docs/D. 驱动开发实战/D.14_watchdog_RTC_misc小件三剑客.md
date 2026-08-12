# D.14 watchdog/RTC/misc：小件三剑客

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[I] | 预计阅读时间：35 分钟
>
> 与第12章的分工：第12章讲 VFS 与字符设备接口的通用机制（cdev、file_operations、ioctl 设计）；本篇是三个具体小框架的注册写法——watchdog core 与 RTC core 替你接管了大部分文件接口工作，misc 则收口"什么时候不用 cdev 用 misc"的判据（Part 1 D.2 留了这个问题）。

## <span class="blue"> 本节导读

几乎每块板子上都有这三样东西：看门狗保系统不死、RTC 保时间不丢、还有一堆"不知道归哪个子系统"的小功能。三者都不大，但写法各有固定套路，且都是"内核已有一个 core 层，驱动只填 ops"的典型框架化写法。<BR>
本节覆盖：watchdog/RTC/misc 的三条路判定表、watchdog_device 注册与 keepalive 语义、RTC 注册与 alarm 中断、misc 与 cdev 的选择判据、三个框架的内核源码走读、`/dev/watchdog` 与 `/sys/class/rtc` 验收。

---

## <span class="blue"> 三条路判定 [I]

| 场景 | 路径 | 理由 |
|---|---|---|
| SoC 内置看门狗 | **几乎不用写**——主流 SoC 的 WDT 驱动内核自带（imx2_wdt、sunxi_wdt、bcm2835_wdt……） | DT 里 `status = "okay"` 即可 |
| 外挂看门狗芯片（I2C/GPIO 喂狗） | 自写 watchdog_device 驱动 | 芯片型号太多，内核虽有常见型号（如 gpio_wdt、i6300esb），冷门型号要自写 |
| SoC 内置 RTC / 常见 I2C RTC（DS1307/DS3231/PCF8563/RV3028……） | **不用写**——`drivers/rtc/` 下近两百个现成驱动 | 先查 compatible，DS3231 直接用 ds1307.c |
| 冷门 RTC 芯片或自定义 RTC 行为 | 自写 rtc_device 驱动 | 只填 read_time/set_time 等 ops |
| 小功能硬件（自定义状态寄存器、一次性配置接口、产测钩子） | **misc_register** | 共享主设备号 10，一次调用拿到 /dev 节点 |
| 需要多个 minor 语义、成组设备节点、定制主设备号 | 走 cdev（第12章、D.2） | misc 只适合"单个小杂项" |

自写前第一动作永远是查现成：`drivers/watchdog/` 和 `drivers/rtc/` 合计三百多个驱动，命中率很高。本篇的自写骨架是给"查完确认没有"的场景准备的。

---

## <span class="blue"> watchdog：喂狗的语义比代码重要 [I]

### core 与驱动的分工

```
用户态（wdctl / systemd-watchdog / 业务进程）
      │  open /dev/watchdog, 定时 write
      ▼
watchdog core（drivers/watchdog/watchdog_core.c）
      │  watchdog_register_device() 注册；keepalive 兜底；nowayout 语义
      ▼
你的驱动 ops：start / stop / ping / set_timeout
      │
      ▼
硬件看门狗（超时不复位 CPU 就复位系统）
```

关键设计：**文件接口完全归 core**。`watchdog_register_device()` 内部帮你建好 `/dev/watchdogN` 字符设备和 sysfs 节点，你的驱动不出现任何 file_operations——这是框架化写法和 Part 1 裸 cdev 写法的分水岭。

### 最小骨架

以一颗 I2C 接口的看门狗芯片为例：

```c
#include <linux/watchdog.h>

#define MYWDT_TIMEOUT_DEFAULT  30       /* 默认超时 30 秒 */

struct mywdt_data {
    struct i2c_client *client;
    struct watchdog_device wdd;
};

static int mywdt_start(struct watchdog_device *wdd)
{
    struct mywdt_data *data = watchdog_get_drvdata(wdd);
    /* bit0: 使能 */
    return i2c_smbus_write_byte_data(data->client, 0x00, 0x01);
}

static int mywdt_ping(struct watchdog_device *wdd)
{
    struct mywdt_data *data = watchdog_get_drvdata(wdd);
    /* 芯片约定：向 0x01 写任意值即喂狗 */
    return i2c_smbus_write_byte(data->client, 0x01);
}

static int mywdt_set_timeout(struct watchdog_device *wdd, unsigned int t)
{
    struct mywdt_data *data = watchdog_get_drvdata(wdd);
    int ret = i2c_smbus_write_byte_data(data->client, 0x02, t);
    if (!ret)
        wdd->timeout = t;               /* 成功才更新框架侧状态 */
    return ret;
}

static const struct watchdog_info mywdt_info = {
    .identity = "mywdt",
    .options  = WDIOF_SETTIMEOUT | WDIOF_KEEPALIVEPING | WDIOF_MAGICCLOSE,
};

static const struct watchdog_ops mywdt_ops = {
    .owner       = THIS_MODULE,
    .start       = mywdt_start,
    .ping        = mywdt_ping,
    .set_timeout = mywdt_set_timeout,
};

static int mywdt_probe(struct i2c_client *client)
{
    struct mywdt_data *data;

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->client = client;

    data->wdd.info       = &mywdt_info;
    data->wdd.ops        = &mywdt_ops;
    data->wdd.min_timeout = 1;
    data->wdd.max_timeout = 255;
    data->wdd.timeout     = MYWDT_TIMEOUT_DEFAULT;
    watchdog_set_drvdata(&data->wdd, data);

    /* 内核没人喂狗时，core 的 hrtimer 按 timeout/2 代喂（可选） */
    watchdog_set_ping_ratio(&data->wdd, 2);

    return devm_watchdog_register_device(&client->dev, &data->wdd);
}
```

源码走读（以内核 6.x 为准）：`devm_watchdog_register_device()` → `watchdog_register_device()`（`drivers/watchdog/watchdog_core.c`）做三件事：校验 info/ops 与 timeout 区间 → `watchdog_dev_register()` 创建 cdev 并挂到 watchdog_dev 的 file_operations → 若设了 ping 兜底（`watchdog_set_ping_ratio`）则启动 core 自己的 hrtimer 喂狗线程。**你的 ops 只在 core 需要时才被回调**，驱动本身没有运行实体。

### 三条容易踩错的语义

1. **open 即开狗**：`/dev/watchdog` 被打开，core 就调 `start()`。用户态打开设备后若不喂狗，超时复位如期而至——产测程序误开 watchdog 节点导致整机复位是经典事故。
2. **magic close**：向 `/dev/watchdog` 写入字符 `V` 再 close，core 才调 `stop()` 真正停狗；否则即使 close 了狗照样跑（防止喂狗进程崩溃后系统"裸奔"）。`WDIOF_MAGICCLOSE` 声明你支持这一语义。
3. **nowayout**：DT 或模块参数设 `nowayout=1` 后，狗一旦开启永不停止，`stop()` 不会被调用。安全攸关产品用它防"停狗逃逸"。

> 💡 内核还有一层"hrtimer 兜底喂狗"：用户态进程调度延迟超过 timeout/2 时，core 的内核线程可以代喂，避免业务抖动引发误复位。代价是用户态真挂死时狗也死不了——要不要兜底，取决于你防的是"误复位"还是"真挂死"。

---

## <span class="blue"> RTC：注册一张时间表 [I]

RTC 框架同样接管全部文件接口（`/dev/rtcN`、`/sys/class/rtc/rtcN/`、alarm 中断分发），驱动只填"读写时间、读写闹钟"几个回调：

```c
#include <linux/rtc.h>

static int myrtc_read_time(struct device *dev, struct rtc_time *tm)
{
    struct myrtc_data *data = dev_get_drvdata(dev);
    u8 regs[7];
    int ret;

    ret = i2c_smbus_read_i2c_block_data(data->client, 0x00, 7, regs);
    if (ret < 0)
        return ret;

    tm->tm_sec  = bcd2bin(regs[0] & 0x7f);
    tm->tm_min  = bcd2bin(regs[1] & 0x7f);
    tm->tm_hour = bcd2bin(regs[2] & 0x3f);
    tm->tm_mday = bcd2bin(regs[4] & 0x3f);
    tm->tm_mon  = bcd2bin(regs[5] & 0x1f) - 1;    /* tm_mon 从 0 起 */
    tm->tm_year = bcd2bin(regs[6]) + 100;         /* 芯片基准 2000 年 */
    return 0;
}

static int myrtc_set_time(struct device *dev, struct rtc_time *tm)
{
    struct myrtc_data *data = dev_get_drvdata(dev);
    u8 regs[7];

    regs[0] = bin2bcd(tm->tm_sec);
    regs[1] = bin2bcd(tm->tm_min);
    regs[2] = bin2bcd(tm->tm_hour);
    regs[4] = bin2bcd(tm->tm_mday);
    regs[5] = bin2bcd(tm->tm_mon + 1);
    regs[6] = bin2bcd(tm->tm_year - 100);
    return i2c_smbus_write_i2c_block_data(data->client, 0x00, 7, regs);
}

static const struct rtc_class_ops myrtc_ops = {
    .read_time = myrtc_read_time,
    .set_time  = myrtc_set_time,
};

static int myrtc_probe(struct i2c_client *client)
{
    struct myrtc_data *data;
    struct rtc_device *rtc;

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->client = client;
    i2c_set_drvdata(client, data);

    rtc = devm_rtc_allocate_device(&client->dev);   /* 两步注册：先分配 */
    if (IS_ERR(rtc))
        return PTR_ERR(rtc);
    data->rtc = rtc;

    rtc->ops = &myrtc_ops;
    rtc->range_min = RTC_TIMESTAMP_BEGIN_2000;
    rtc->range_max = RTC_TIMESTAMP_END_2099;

    return devm_rtc_register_device(rtc);           /* 再注册，失败自动回收 */
}
```

源码走读：`devm_rtc_allocate_device()` 只是分配并挂 devm 回收；真正的注册在 `devm_rtc_register_device()`（`drivers/rtc/class.c`）→ `rtc_device_register()` → `rtc_dev_register()` 建 `/dev/rtcN` 与 cdev，同时挂入 rtc_class。**两步式注册**的原因：旧接口 `rtc_device_register()` 无法让框架在注册前修改 range_min/max 等属性，新版把"分配"和"生效"拆开。写新驱动一律用两步式。

闹钟与唤醒：芯片 alarm 引脚接到 SoC 的可唤醒中断时，驱动里加 `set_alarm`/`alarm_irq_enable` ops，DT 声明 `wakeup-source`，用户态就能 `rtcwake -m mem -s 3600` 让整机睡一小时后自醒——电池产品的定时唤醒就靠这条路。

---

## <span class="blue"> misc：cdev 的极简版，判据收口 [I]

Part 1 D.2 用 cdev 写了完整字符设备（alloc_chrdev_region → cdev_init → cdev_add → device_create 四步）。misc 把这四步压成一步：

```c
#include <linux/miscdevice.h>

static const struct file_operations mymisc_fops = {
    .owner          = THIS_MODULE,
    .read           = mymisc_read,
    .write          = mymisc_write,
    .unlocked_ioctl = mymisc_ioctl,
};

static struct miscdevice mymisc_dev = {
    .minor = MISC_DYNAMIC_MINOR,    /* 动态分配次设备号 */
    .name  = "mymisc",              /* 得到 /dev/mymisc */
    .fops  = &mymisc_fops,
};

/* probe 里： */
misc_register(&mymisc_dev);
/* remove 里： */
misc_deregister(&mymisc_dev);
```

源码走读：`misc_register()`（`drivers/char/misc.c`）内部是共享主设备号 10 的一个大 cdev——所有 misc 设备共用一个字符设备号，靠次设备号分发到各自的 fops。所以 misc 省掉的正是"主设备号管理"这件事。

选择判据（本篇的收口结论）：

| 维度 | 用 misc | 用 cdev |
|---|---|---|
| 设备数量 | 单个杂项 | 一组同类设备，要主设备号归类语义 |
| minor 需求 | 动态分一个就够 | 要自己编码 minor（如通道号、bank 号） |
| 代码量 | 一步注册 | 四步，但可控性完整 |
| 典型 | 产测钩子、一次性配置口、小状态寄存器 | TS502 这类多 ioctl 数据通道设备（D.2） |

> 💡 判不准时的经验：这个设备五年后会不会长出第二个节点？不会，misc；会，cdev。

---

## <span class="blue"> 调试与验收 [I]

```bash
cat /sys/class/watchdog/watchdog0/identity     # 确认是你的驱动
cat /sys/class/watchdog/watchdog0/timeout      # 当前超时
wdctl /dev/watchdog0                           # busybox 自带，看状态与 flags

cat /sys/class/rtc/rtc0/name                   # 确认 RTC 来源
hwclock -r                                     # 读硬件时间，对比 date
echo 0 > /sys/class/rtc/rtc0/wakealarm         # 清旧闹钟
echo +120 > /sys/class/rtc/rtc0/wakealarm      # 120 秒后闹钟

ls /sys/class/misc/                            # misc 设备的 sysfs 家
cat /proc/misc                                 # 次设备号分配总表
```

无硬件后备：watchdog 有 `softdog` 纯软件模块（`modprobe softdog`），用内核定时器模拟超时，配 `wdctl` 可完整演练 open/喂狗/magic close 语义；RTC 可用 QEMU 虚机的 rtc0 演练 wakealarm；misc 骨架不碰硬件寄存器即可注册跑通。

---

## <span class="blue"> Trade-off 表格 [I]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 喂狗责任 | 用户态喂狗（systemd-watchdog） | core hrtimer 兜底 | 前者能发现用户态挂死；后者防误复位但掩盖真挂死 |
| 关狗语义 | 允许 magic close 停狗 | nowayout 永不停 | 调试期要前者；量产安全件用后者 |
| RTC 注册 | 旧式 rtc_device_register 一步到位 | 两步式 allocate + register | 新驱动一律两步式，旧接口设不了时间范围 |
| 闹钟实现 | 驱动自管中断 | 走 RTC core alarm + wakeup-source | core 接管 /dev/rtcN 与休眠唤醒链路，自管等于重造 |
| 小件接口 | misc_register 一步 | cdev 四步 | 单杂项用 misc；多 minor 语义用 cdev |

---

## <span class="blue"> 常见陷阱 [I]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 忘调 start 语义 | 加载驱动狗不跑 | 框架约定 open 才 start，probe 不启动 | 需要上电即跑就显式调 watchdog_start_on_boot 路径或在 probe 里 start |
| set_timeout 先改状态 | 框架记录的 timeout 与硬件不符 | 硬件写失败也更新了 wdd->timeout | 先写硬件，成功才更新框架状态 |
| RTC BCD 没转换 | 时间乱跳（秒读成 0x59=89） | RTC 芯片寄存器是 BCD 码 | bcd2bin/bin2bcd，别直接搬 |
| tm_year 基准错 | 年份差 1900 或 100 | tm_year 从 1900 起算，芯片多从 2000 起 | 读 +100，写 -100，并对 range_min/max |
| misc 里做大事 | 一个 misc 设备塞十几个 ioctl | 该归子系统或 cdev 的硬塞 misc | 回看本篇判据表，超标就换框架 |
| 外挂 WDT 与内置 WDT 同时跑 | 双重复位、超时打架 | 没禁用 SoC 内置 WDT | DT 里内置节点 status = "disabled" |

---

## <span class="blue"> 动手练习

1. softdog 演练：`modprobe softdog nowayout=0`，用 wdctl 看状态；写一个小程序 open 后每 10 秒喂一次（timeout 设 20），然后 Ctrl+C 杀掉程序，观察 close 未写 `V` 时系统是否如期"复位"（softdog 只打印告警）。
2. RTC：给 QEMU/开发板的 rtc0 设 `wakealarm` 120 秒后闹钟，`cat /proc/driver/rtc` 看 alarm_IRQ 状态；`hwclock -w` 写入系统时间后断电重启验证保持。
3. misc 判据：把 D.2 的 TS502 cdev 版本改写成 misc 版（改动集中在 probe/remove），对比两种写法代码量；然后回答——如果产品要出 TS502 四通道版，哪种写法更合适，为什么。
4. 冷门芯片模拟：找一颗内核没有驱动的 I2C watchdog 芯片手册，按本篇骨架补齐 set_timeout 换算表，在无硬件的板子上注册成功即可（ops 返回 -EIO 也算流程走通）。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| watchdog 框架 | core 接管文件接口，驱动只填 start/ping/set_timeout | 你的驱动里有 file_operations 吗（不该有） |
| 喂狗语义 | open 即开狗、magic close 停狗、nowayout 防逃逸 | 产测程序会误开 /dev/watchdog 吗 |
| RTC 注册 | 两步式 allocate + register，时间范围必须先设 | BCD 转换和 tm_year 基准对了吗 |
| RTC 唤醒 | alarm ops + wakeup-source → rtcwake 定时唤醒 | 芯片 alarm 脚接到可唤醒中断了吗 |
| misc | 共享主设备号 10 的一步注册 | 这个设备五年后会长出第二个节点吗 |
| 验收 | /sys/class/watchdog、/sys/class/rtc、/proc/misc | 三个 sysfs 家都看过吗 |

---

## <span class="blue"> 下一步

三剑客收工，Part 2 已覆盖输入、传感、温控、灯效、小件。下一篇（D.15 regmap 与资源三件套）回到写法本身：把 TS502 的裸 i2c_smbus 调用升级成 regmap 版，同时收口 clk/regulator/pinctrl 这三个"每个驱动都要消费、但不属于任何子系统"的资源框架——这是从"能写驱动"到"写得像内核驱动"的一步。

螺旋衔接：看门狗——第5.4章设备节点（操作级）→ 本篇 watchdog core（框架级）→ 第22章可靠性设计中的 WDT 策略（设计级）。★第2次出现（框架级）
