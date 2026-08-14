# B-B.2.5 实战：GPIO 按键 + PWM 呼吸灯 + ADC 电位器采集

> 所属章节：第五部 B. 总线协议 > B-B.2 基础外设接口
>
> 难度：[I] Intermediate | 预计阅读时间：35 分钟

## <span class="blue"> 本节导读

B-B.2.1 ~ B-B.2.4 分别讲了 GPIO、PWM、ADC、DAC 四件套。本篇把它们合成一个可运行的最小产品：**电位器旋钮调节 LED 呼吸灯的亮度上限，按键切换工作模式（常灭 / 呼吸 / 常亮）**。三个子系统在同一份设备树、同一个程序里协同工作，覆盖嵌入式产品最常见的"采集 → 决策 → 输出"闭环。

本节覆盖：功能定义与电路接线（RK3568 锚点）、完整设备树配置、单程序整合 libgpiod v2 按键事件 + sysfs PWM 输出 + IIO ADC 采集的代码实现、联调验证清单，以及无硬件环境下的完整模拟路径。

---

## <span class="blue"> 功能定义与电路

### 功能规格

| 输入/输出 | 器件 | 作用 |
|-----------|------|------|
| 输入 1 | 电位器（旋钮） | ADC 采集，决定呼吸灯亮度上限 |
| 输入 2 | 轻触按键 | GPIO 中断，循环切换模式：常灭 → 呼吸 → 常亮 |
| 输出 | LED | PWM 驱动，亮度由模式与电位器共同决定 |

### 接线（RK3568）

<svg viewBox="0 0 800 345" xmlns="http://www.w3.org/2000/svg" style="max-width:800px;width:100%;height:auto" font-family="sans-serif" font-size="13" stroke="currentColor" fill="none" stroke-width="1.5">
<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor" stroke="none"/></marker></defs>
<rect x="60" y="70" width="170" height="250" stroke-width="2"/>
<text x="145" y="92" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">RK3568</text>
<line x1="230" y1="100" x2="260" y2="100"/>
<text x="222" y="104" text-anchor="end" fill="currentColor" stroke="none">3V3</text>
<line x1="230" y1="150" x2="260" y2="150"/>
<text x="222" y="154" text-anchor="end" fill="currentColor" stroke="none">SARADC_VIN3</text>
<line x1="230" y1="200" x2="260" y2="200"/>
<text x="222" y="204" text-anchor="end" fill="currentColor" stroke="none">GPIO1_A0</text>
<line x1="230" y1="250" x2="260" y2="250"/>
<text x="222" y="254" text-anchor="end" fill="currentColor" stroke="none">PWM0</text>
<line x1="230" y1="300" x2="260" y2="300"/>
<text x="222" y="304" text-anchor="end" fill="currentColor" stroke="none">GND</text>
<line x1="260" y1="100" x2="520" y2="100" stroke-width="2"/>
<text x="375" y="92" text-anchor="middle" fill="currentColor" stroke="none">3.3V</text>
<line x1="520" y1="100" x2="520" y2="130"/>
<path d="M 520 130 L 513 138 L 527 146 L 513 154 L 527 162 L 513 170 L 527 178 L 520 186"/>
<line x1="520" y1="186" x2="520" y2="300"/>
<text x="535" y="122" text-anchor="start" fill="currentColor" stroke="none">电位器 10 kΩ</text>
<path d="M 260 150 L 572 150 L 572 158 L 534 158" stroke-width="2" marker-end="url(#arr)"/>
<text x="330" y="142" text-anchor="middle" fill="currentColor" stroke="none">抽头电压 0~3.3V</text>
<line x1="260" y1="200" x2="478" y2="200" stroke-width="2"/>
<circle cx="480" cy="200" r="3" fill="currentColor" stroke="none"/>
<path d="M 482 203 L 514 189"/>
<circle cx="516" cy="200" r="3" fill="currentColor" stroke="none"/>
<line x1="516" y1="200" x2="540" y2="200" stroke-width="2"/>
<text x="500" y="176" text-anchor="middle" fill="currentColor" stroke="none">轻触按键</text>
<line x1="540" y1="200" x2="540" y2="300"/>
<line x1="260" y1="250" x2="430" y2="250" stroke-width="2"/>
<text x="340" y="242" text-anchor="middle" fill="currentColor" stroke="none">PWM 驱动</text>
<path d="M 430 250 L 437 242 L 445 258 L 453 242 L 461 258 L 469 242 L 477 258 L 485 242 L 493 258 L 500 250"/>
<text x="465" y="230" text-anchor="middle" fill="currentColor" stroke="none">330 Ω</text>
<line x1="500" y1="250" x2="520" y2="250" stroke-width="2"/>
<path d="M 520 238 L 520 262 L 548 250 Z"/>
<line x1="548" y1="238" x2="548" y2="262"/>
<text x="534" y="226" text-anchor="middle" fill="currentColor" stroke="none">LED</text>
<line x1="548" y1="250" x2="580" y2="250" stroke-width="2"/>
<line x1="580" y1="250" x2="580" y2="300"/>
<line x1="260" y1="300" x2="580" y2="300" stroke-width="2"/>
<circle cx="520" cy="300" r="3" fill="currentColor" stroke="none"/>
<circle cx="540" cy="300" r="3" fill="currentColor" stroke="none"/>
<circle cx="580" cy="300" r="3" fill="currentColor" stroke="none"/>
<line x1="560" y1="300" x2="560" y2="310"/>
<line x1="548" y1="310" x2="572" y2="310"/>
<line x1="552" y1="316" x2="568" y2="316"/>
<line x1="556" y1="322" x2="564" y2="322"/>
</svg>

要点：电位器两端接 3.3 V/GND、抽头接 SARADC 通道 3，0~3.3 V 线性对应旋钮角度；按键一端 GPIO1_A0、一端 GND，软件启用内部上拉（低电平有效，见 B-B.2.1）；LED 阳极经 330 Ω 限流电阻接 PWM0，电流约 4 mA，在 8 mA 限额内。

> 💡 引脚分配以实际板卡原理图为准：电位器接哪个 ADC 通道、PWM 用哪个通道、按键在哪个 GPIO bank，都查本板 dts 与原理图。本节示例用 SARADC 通道 3、pwm0、GPIO1_A0（gpiochip1 offset 0），自行替换。

---

## <span class="blue"> 设备树配置

```dts
/* ADC：使能 SARADC（dtsi 默认 disabled） */
&saradc {
    vref-supply = <&vcc_3v3>;
    status = "okay";
};

/* PWM：使能 pwm0，确认 pinctrl 复用 */
&pwm0 {
    pinctrl-0 = <&pwm0m0_pins>;
    status = "okay";
};

/* 按键：注册为输入事件（也可纯用户态，见正文取舍） */
/ {
    gpio_keys: gpio-keys {
        compatible = "gpio-keys";
        button_mode: button-mode {
            label = "mode-btn";
            gpios = <&gpio1 0 GPIO_ACTIVE_LOW>;
            linux,code = <KEY_F1>;
            debounce-interval = <20>;
        };
    };
};
```

设备树烧录后先验证三件套的注册状态，再写任何应用代码：

```bash
ls /sys/bus/iio/devices/                 # 出现 iio:deviceX（saradc）
ls /sys/class/pwm/                       # 出现 pwmchipN
evtest /dev/input/event0 2>/dev/null     # 按一下按键，应看到 KEY_F1 事件
```

> ⚠️ 注册三查先于应用开发。ADC 看 `/sys/bus/iio/devices/`、PWM 看 `/sys/class/pwm/`、按键看 `/dev/input/event*` 或 `gpioinfo`。任一缺失都回到设备树，不要在应用层排查。

---

## <span class="blue"> 完整程序

单文件程序 `breath_ctrl.c`：libgpiod v2 监听按键中断，IIO sysfs 读电位器，PWM sysfs 输出呼吸波形。`poll` 统一事件源，主循环按 20 ms 节拍推进呼吸相位。

```c
/* breath_ctrl.c — 电位器调亮度上限，按键切模式：常灭→呼吸→常亮
 * 目标平台：RK3568（saradc + pwm0 + gpio1）
 * 依赖：libgpiod v2（pkg-config --modversion libgpiod 应为 2.x）
 * 编译：gcc breath_ctrl.c -o breath_ctrl -lgpiod
 */
#include <gpiod.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <math.h>

/* ---- 平台参数（按实际板卡修改） ---- */
#define GPIO_CHIP      "/dev/gpiochip1"
#define BTN_OFFSET     0                    /* GPIO1_A0 */
#define IIO_DEV        "/sys/bus/iio/devices/iio:device0"
#define ADC_CHANNEL    3                    /* 电位器所在通道 */
#define ADC_MAX        1023                 /* RK3568 SARADC 为 10-bit */
#define PWM_PATH       "/sys/class/pwm/pwmchip0/pwm0"
#define PWM_CHIP       "/sys/class/pwm/pwmchip0"
#define PWM_PERIOD_NS  100000               /* 10 kHz，防可见频闪 */

enum mode { MODE_OFF = 0, MODE_BREATH, MODE_ON, MODE_MAX };

/* ---- sysfs 小工具 ---- */
static int sysfs_write(const char *path, const char *val)
{
    int fd = open(path, O_WRONLY);
    if (fd < 0) return -1;
    int ret = write(fd, val, strlen(val));
    close(fd);
    return ret < 0 ? -1 : 0;
}

static int sysfs_read_int(const char *path)
{
    char buf[32] = {0};
    int fd = open(path, O_RDONLY);
    if (fd < 0) return -1;
    if (read(fd, buf, sizeof(buf) - 1) <= 0) { close(fd); return -1; }
    close(fd);
    return atoi(buf);
}

/* ---- ADC：读电位器，返回 0.0~1.0 ---- */
static float adc_read_ratio(void)
{
    char path[128];
    snprintf(path, sizeof(path), "%s/in_voltage%d_raw", IIO_DEV, ADC_CHANNEL);
    int raw = sysfs_read_int(path);
    if (raw < 0) return 0.0f;
    if (raw > ADC_MAX) raw = ADC_MAX;
    return (float)raw / ADC_MAX;
}

/* ---- PWM ---- */
static int pwm_init(void)
{
    char buf[32];
    sysfs_write(PWM_CHIP "/export", "0");   /* 已导出时返回-1，忽略 */
    usleep(100000);
    snprintf(buf, sizeof(buf), "%d", PWM_PERIOD_NS);
    sysfs_write(PWM_PATH "/period", buf);
    sysfs_write(PWM_PATH "/duty_cycle", "0");
    return sysfs_write(PWM_PATH "/enable", "1");
}

static void pwm_set_ratio(float ratio)      /* ratio: 0.0~1.0 */
{
    char buf[32];
    if (ratio < 0.0f) ratio = 0.0f;
    if (ratio > 1.0f) ratio = 1.0f;
    snprintf(buf, sizeof(buf), "%d", (int)(PWM_PERIOD_NS * ratio));
    sysfs_write(PWM_PATH "/duty_cycle", buf);
}

int main(void)
{
    /* ---- 按键：libgpiod v2，下降沿 + 20ms 内核防抖 ---- */
    struct gpiod_chip *chip = gpiod_chip_open(GPIO_CHIP);
    if (!chip) { perror("gpiod_chip_open"); return 1; }

    struct gpiod_line_settings *ls = gpiod_line_settings_new();
    gpiod_line_settings_set_direction(ls, GPIOD_LINE_DIRECTION_INPUT);
    gpiod_line_settings_set_bias(ls, GPIOD_LINE_BIAS_PULL_UP);
    gpiod_line_settings_set_edge_detection(ls, GPIOD_LINE_EDGE_FALLING);
    gpiod_line_settings_set_debounce_period_us(ls, 20000);

    struct gpiod_line_config *lc = gpiod_line_config_new();
    unsigned int off = BTN_OFFSET;
    gpiod_line_config_add_line_settings(lc, &off, 1, ls);

    struct gpiod_request_config *rc = gpiod_request_config_new();
    gpiod_request_config_set_consumer(rc, "breath-ctrl");

    struct gpiod_line_request *req = gpiod_chip_request_lines(chip, rc, lc);
    if (!req) { perror("request_lines"); return 1; }

    struct gpiod_edge_event_buffer *evbuf = gpiod_edge_event_buffer_new(4);

    /* ---- PWM 初始化 ---- */
    if (pwm_init() < 0) { perror("pwm_init"); return 1; }

    enum mode mode = MODE_OFF;
    float phase = 0.0f;                     /* 呼吸相位 0~2π */
    const float step = 0.15f;               /* 每 20ms 推进的相位 */
    struct pollfd pfd = {
        .fd = gpiod_line_request_get_fd(req),
        .events = POLLIN,
    };

    printf("启动：按键切模式（常灭→呼吸→常亮），旋钮调亮度上限\n");

    for (;;) {
        /* 按键事件：20ms 超时，无事件则继续推进呼吸 */
        if (poll(&pfd, 1, 20) > 0 && (pfd.revents & POLLIN)) {
            int n = gpiod_line_request_read_edge_events(req, evbuf, 4);
            for (int i = 0; i < n; i++)
                mode = (mode + 1) % MODE_MAX;
            printf("模式 → %s\n",
                   mode == MODE_OFF ? "常灭" :
                   mode == MODE_BREATH ? "呼吸" : "常亮");
        }

        float knob = adc_read_ratio();      /* 电位器：亮度上限 */

        switch (mode) {
        case MODE_OFF:
            pwm_set_ratio(0.0f);
            break;
        case MODE_ON:
            pwm_set_ratio(knob);
            break;
        case MODE_BREATH:
            /* sin² 波形近似人眼对数感知，再乘以旋钮上限 */
            phase += step;
            if (phase > 6.2832f) phase -= 6.2832f;
            float s = sinf(phase);
            pwm_set_ratio(s * s * knob);
            break;
        default:
            break;
        }
    }

    /* 到达不了；正常退出应 release request、关 PWM */
    return 0;
}
```

### 代码要点解读

1. **三路资源一个事件循环**：按键走 `poll`（20 ms 超时），超时即节拍源，省去独立定时器线程；ADC 与 PWM 都是普通文件读写
2. **防抖在内核完成**：`gpiod_line_settings_set_debounce_period_us(20000)`，应用层不再写延时确认循环（B-B.2.1 的 v2 差异点在此落地）
3. **sin² 呼吸曲线**：人眼对亮度是对数感知（B-B.2.2 的对数表同理），线性三角波呼吸在高亮段显得"顿"，sin² 平滑且计算便宜
4. **PWM 单位是纳秒**：duty = period × ratio，`duty ≤ period` 的写入约束由 `pwm_set_ratio` 的钳位保证

---

## <span class="blue"> 联调验证清单

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 三查注册（iio/pwm/input） | 三件套节点齐全 |
| 2 | 运行程序，不碰任何输入 | LED 灭，终端打印"模式 →"等待 |
| 3 | 按键一次 | 切到呼吸模式，LED 平滑明暗循环 |
| 4 | 旋转电位器 | 呼吸峰值亮度跟随变化 |
| 5 | 再按两次键 | 常亮（亮度=旋钮位置）→ 常灭 |
| 6 | 快速连按 10 次 | 无丢模式、无多跳（防抖生效） |
| 7 | `cat /sys/class/pwm/pwmchip0/pwm0/duty_cycle` | 数值随呼吸节拍变化 |

---

## <span class="blue"> 无硬件路径

无开发板时在 PC 上完整演练：

1. **GPIO**：内核 `CONFIG_GPIO_SIM`（gpio-sim）经 configfs 虚拟 gpiochip，libgpiod 程序原样运行，用 `gpioset` 模拟按键触发
2. **PWM**：`CONFIG_PWM_SIM`（pwm-sim）虚拟 PWM 控制器，sysfs 四文件操作与真机一致
3. **ADC**：IIO dummy 框架（`drivers/iio/dummy/`）提供虚拟采样通道
4. **纯逻辑验证**：把 `adc_read_ratio` / `pwm_set_ratio` 换成读写普通文件的桩，呼吸算法与模式机在 PC 上单元测试

---

## <span class="blue"> 方案取舍（Trade-off）

| 决策点 | 本篇选择 | 替代方案 | 取舍理由 |
|--------|----------|----------|----------|
| 按键实现 | libgpiod v2 用户态中断 | `gpio-keys` + input 事件 | 功能简单时 input 子系统零代码；本篇要演示中断链路故用 libgpiod，生产场景两者皆可 |
| 事件模型 | poll 超时兼作节拍 | 多线程 / epoll | 三路资源一个循环最省心智；业务复杂后升级 epoll |
| 呼吸波形 | sin² 软件计算 | 定时器中断 / DMA 波形表 | 20 ms 节拍足够平滑；硬实时波形归内核驱动（D 扩展） |
| ADC 读取 | sysfs 单次读 | IIO buffer 连续采集 | 旋钮是慢变信号；高速采集才上 buffer |

---

## <span class="blue"> 常见陷阱

> ⚠️ 设备树没生效就调程序。三查注册（iio/pwm/input）有任何一项缺失，应用层再怎么改都是白费。先验证注册，再写代码。

> ⚠️ ADC 通道号张冠李戴。`in_voltage3_raw` 的 3 是 IIO 通道号，不是原理图网络名。用万用表量电位器抽头电压并对照 raw 值换算结果，一次即可确认通道映射。

> ⚠️ 防抖缺失导致一次按键跳多个模式。机械按键抖动 5~20 ms，没开 `debounce` 时 mode 会连跳 2~3 格——这是本篇程序最容易观察到的"配置效应"。

> ⚠️ PWM 引脚被复用冲突。程序运行无报错但 LED 不亮：查 pinctrl 是否真正把引脚配到 PWM 功能、`gpioinfo` 看引脚是否被当 GPIO 占用（与 B-B.2.2 的四查呼应）。

> ⚠️ 把 10-bit 当 12-bit 换算。RK3568 SARADC 是 10-bit（满量程 1023），套 12-bit 的 4095 上限，亮度上限直接丢失四分之三。换平台先查 ADC 位宽。

---

## <span class="blue"> 动手练习

1. **完整复现**：按本篇接线、烧设备树、编译运行，走完联调清单 7 步。
2. **改造 1**：把按键改为 `gpio-keys` + input 事件实现（读 `/dev/input/eventX`），对比与 libgpiod 方案的代码量与延迟差异。
3. **改造 2**：把 sin² 换成线性三角波，肉眼对比呼吸观感差异，理解对数感知修正的意义。
4. **无硬件**：在 PC 上用 gpio-sim + pwm-sim + IIO dummy 搭全套虚拟环境，程序不改一行跑通。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 系统结构 | 采集→决策→输出闭环的三路资源协同 |
| 设备树 | saradc/pwm0/gpio-keys 三个使能点与 vref/pinctrl 依赖 |
| 代码骨架 | poll 统一事件源；libgpiod v2 防抖；sysfs PWM/ADC 读写 |
| 工程细节 | sin² 曲线、纳秒单位、duty≤period 钳位、10-bit 位宽 |
| 验证方法 | 三查注册先行；联调清单逐项过 |
| 无硬件路径 | gpio-sim / pwm-sim / IIO dummy 三件套 |

---

## <span class="blue"> 下一步

基础外设板块（B-B.2）到此完整闭环。下一篇进入 I2C 系列——**B-B.3.1 I2C 物理层与电气特性**：两线制、开漏与上拉、线与仲裁，理解 B-B.2.1 埋下的"开漏必配上拉"在真实总线上如何变成完整的通信协议。

> 💡 螺旋衔接：本篇的"采集→决策→输出"闭环是嵌入式产品的最小骨架——B-B.3/B-B.4 的 I2C/SPI 实战篇（AT24C02、W25Qxx）会把输入源换成总线器件，骨架不变；按键中断的完整内核态写法（request_threaded_irq + input 上报）归 D 扩展中断篇，与第 10 章中断机制对接。
