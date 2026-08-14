# B-B.2.1 GPIO 通用输入输出

> 所属章节：第五部 B. 总线协议 > B-B.2 基础外设接口
>
> 难度：[B] Beginner | 预计阅读时间：30 分钟

## <span class="blue"> 本节导读

GPIO（General Purpose Input/Output）是嵌入式系统中使用频率最高的硬件接口：点亮 LED、读取按键、驱动继电器、检测传感器状态，都经 GPIO 完成。它没有帧格式、没有时序协议，GPIO 的"协议"就是电气层本身——电平阈值、驱动结构、上下拉、中断触发方式。理解这些，才谈得上正确使用它。

本节覆盖：GPIO 的四种工作模式与内部结构、推挽/开漏输出的电气差异、上下拉电阻的工程选型、ESD 保护与电平兼容、GPIO 中断与防抖机制，以及 Linux 侧的完整使用路径——设备树描述、gpiolib 框架、libgpiod v2 用户态 API 与命令行工具。

---

## <span class="blue"> GPIO 硬件结构：四种工作模式

一个 GPIO 引脚的内部结构可抽象为：

```
                 +-------------------+
                 |   复用外设         |
                 | (UART/SPI/I2C...) |
                 +--------+----------+
                          |
   输入数据寄存器  +-------v----------+   输出数据寄存器
   (读引脚电平) <--|   输入通道        |--> (写输出电平)
                 |  Schmitt 触发器   |
                 |  上拉/下拉电阻     |<-- 配置寄存器
                 |   输出驱动器       |    (模式/类型/速度/上下拉)
                 |  推挽 or 开漏      |
                 +-------+----------+
                         |
                    +----v-----+
                    |  ESD 保护 |--- 引脚 PAD
                    +----------+
```

四种工作模式的本质区别是"引脚控制权在谁手里"：

| 模式 | 引脚控制权 | 数字缓冲器 | 典型用途 |
|------|------------|------------|----------|
| 输入 | GPIO 模块（读） | 开 | 按键、开关、传感器数字输出 |
| 输出 | GPIO 模块（写） | — | LED、继电器、蜂鸣器 |
| 复用（Alternate Function） | 片上外设 | 开 | UART TX/RX、SPI、I2C、PWM |
| 模拟 | ADC/DAC | **关** | 模拟量采集、模拟输出 |

复用模式下 CPU 不再通过 GPIO 数据寄存器控制引脚，控制权交给对应外设控制器。一个引脚可复用为多种功能（AF0/AF1/…），具体映射查芯片数据手册的引脚功能表。

模拟模式必须关闭数字输入缓冲：模拟信号处于中间电平时，Schmitt 触发器输入级的两个晶体管会同时微导通，产生持续的穿通电流，既增加功耗又干扰采样精度。

---

## <span class="blue"> 输入模式：浮空、上拉、下拉

### 浮空输入

浮空输入不接任何内部电阻，引脚电平完全由外部驱动决定。输入阻抗高达数十 MΩ，外部不接驱动源时，引脚容易拾取环境电磁干扰，读到的值随机跳变——手指靠近 PCB 都可能改变读数。

> ⚠️ 除非外部电路有明确且稳定的驱动源，不要使用浮空输入。产品上因浮空引脚误触发中断导致的灵异故障，定位成本远高于一个电阻。

### 上拉输入与按钮检测

上拉输入经内部电阻（典型 30~50 kΩ）将引脚默认拉到高电平，外部把引脚短接到地才读到低电平。最经典的应用是按钮检测：

```
        VDD (3.3V)
         |
       [R_pull]   内部上拉电阻 (~40kΩ)
         |
    +----+---- GPIO 引脚
    |
   === 按钮（另一端接 GND）
    |
   GND

按钮未按下：V_GPIO = 3.3V（上拉保持，读到 1）
按钮按下：  V_GPIO = 0V（按钮短路到地，读到 0）
按下时上拉电流：I = 3.3V / 40kΩ ≈ 82μA
```

这种"未按下为高、按下为低"的接法称为低电平有效（Active Low），对应设备树里的 `GPIO_ACTIVE_LOW`。下拉输入逻辑相反，用于"触发时为高电平"的传感器。

### 上下拉与外部电路冲突

内部上下拉阻值大（40 kΩ 级），属于"弱"上下拉。当外部存在强驱动（如外部 10 kΩ 上拉到 5 V），引脚实际电压由分压决定：

```
外部 5V --[10kΩ]--+-- GPIO 引脚
                  |
              [40kΩ]  内部下拉（配置错误时）
                  |
                 GND

引脚实际电压 = 5V × 40k / (10k + 40k) = 4.0V
```

4.0 V 已超出 3.3 V 引脚的耐受上限（VDD+0.3 V = 3.6 V），可能击穿 ESD 保护二极管。配置上下拉前必须核算外部电路的等效阻抗。

---

## <span class="blue"> 输出模式：推挽与开漏

### 推挽输出

推挽输出用一对互补 MOSFET 驱动引脚：输出 1 时 PMOS 导通把引脚推向 VDD，输出 0 时 NMOS 导通把引脚拉向 GND。两个管子交替工作，两个方向都能主动驱动。

关键参数（以 3.3 V 供电的典型 SoC GPIO 为例，具体数值以本芯片数据手册为准）：

| 参数 | 典型值 | 含义 |
|------|--------|------|
| 驱动电流 I_OL / I_OH | 8 mA | 单引脚拉/灌电流上限 |
| 导通电阻 R_ON | 20~50 Ω | 满载时产生 0.3~0.4 V 压降 |
| 总电流 | 受 VDD/VSS 引脚限制 | 多引脚同时驱动需合计核算 |

> ⚠️ 两个推挽输出引脚短接，一个输出高、一个输出低，短路电流 ≈ VDD / (R_ON_PMOS + R_ON_NMOS) ≈ 3.3V / 50Ω ≈ 66 mA，远超额定值，可在微秒级损坏输出级。软件配置错误（两个驱动抢同一引脚、一个配输出高一个配输出低）同样会制造这个场景。

### 开漏输出

开漏输出只有一个 NMOS：输出 0 时导通拉低，输出 1 时截止、引脚进入**高阻态**——注意，高阻态不是高电平。要高电平必须靠外部上拉电阻。

```
     VDD_ext（可以是 5V，实现电平转换）
      |
    [R_pull-up]   外部上拉（必须）
      |
  ----+---- 总线/引脚
  |
 NMOS      输出1=截止(高阻)，输出0=导通(拉低)
  |
 GND
```

开漏的两个不可替代的价值：

1. **线与（Wired-AND）**：多个开漏输出并在一根线上，任一设备拉低则总线为低，全部释放才为高。I2C 的总线仲裁与 ACK 机制就建立在这个电气特性上（详见 B-B.3.1）
2. **电平转换**：上拉电阻接到 5 V，3.3 V 的 GPIO 就能输出 5 V 逻辑

上拉电阻选型是速度与功耗的权衡：

```
上升时间（工程近似，充电至 30% 阈值）：
R_pull-up(max) = t_r / (0.8473 × C_bus)

电流下限（NMOS 导通时不超驱动能力）：
R_pull-up(min) = (VDD - V_OL) / I_OL(max)

I2C 标准模式示例：t_r ≤ 300ns，总线电容 40pF
R(max) = 300ns / (0.8473 × 40pF) ≈ 8.85kΩ
R(min) = (3.3 - 0.4) / 8mA ≈ 363Ω
工程取值 4.7kΩ：t_r ≈ 159ns ✓，灌电流 ≈ 0.62mA ✓
```

> ⚠️ 开漏输出忘了接上拉电阻，引脚在输出 1 时是悬浮的高阻态，读数随杂散电容与漏电流漂移，完全不可预期。开漏必配上拉，这是硬性前提。

### 速度等级与 EMI

GPIO 的速度档位控制输出驱动器的栅极充放电电流：速度越高，输出边沿越陡，能驱动的翻转频率越高，代价是 EMI 辐射与信号过冲加剧——1 ns 级边沿包含的高频分量可达数百 MHz。

选型原则是够用就好：驱动 LED/继电器用最低档，高速数字接口（SPI Flash、SDIO、RMII）才需要高档位。给低速负载配高速档位，只有 EMI 和功耗的代价，没有收益。

---

## <span class="blue"> ESD 保护与电平兼容

### 钳位二极管

每个 GPIO 引脚内部有两个 ESD 钳位二极管：引脚电压超过 VDD+0.3 V 时上方二极管导通泄流到 VDD，低于 -0.3 V 时下方二极管导通泄流到 VSS。

它们的设计目的是吸收静电放电的纳秒级瞬态能量，**只能承受几 mA 的持续电流**。把 5 V 信号经 10 kΩ 串联电阻接到 3.3 V 引脚，二极管导通电流约 0.14 mA，尚可承受；直连则电流超 10 mA，保护电路烧毁，继而损坏内部 CMOS 电路。

### 5V 容忍引脚（FT）

部分引脚标记为 FT（5V-Tolerant）：内部去掉了接 VDD 的钳位二极管，输入模式可承受最高 5.5 V。注意两点：FT 只限输入（输出高电平仍是 VDD 电平）；是否 FT 必须逐个引脚查数据手册，不能按"这个系列大部分引脚是 FT"推断。

### 电平兼容矩阵

| 外部设备 | 3.3V GPIO 读它 | 3.3V GPIO 驱动它 | 结论 |
|----------|----------------|-------------------|------|
| 5V TTL | 输出 2.4V 即可被识别 ✓ | 3.3V > TTL 阈值 2.0V ✓ | 直接连 |
| 5V CMOS | 输出 3.5V，3.3V 读不了 ✗ | 3.3V < 3.5V 阈值 ✗ | 需电平转换 |
| 1.8V CMOS | 1.8V > 阈值 2.31V? ✗ 不可靠 | 3.3V 会过压 ✗ | 需电平转换 |

低速单向场景可用电阻分压做 3.3V→1.8V 的降级（R1=10kΩ/R2=12kΩ 分压出约 1.8 V），但 RC 延迟不适用于 MHz 级信号，双向通信应使用 TXS0108E/TXB0108 类专用电平转换芯片。

---

## <span class="blue"> GPIO 中断与防抖

### 触发方式

| 触发方式 | 语义 | 适用场景 |
|----------|------|----------|
| 上升沿 | 低→高跳变触发 | 脉冲检测 |
| 下降沿 | 高→低跳变触发 | 按键（低电平有效接法） |
| 双边沿 | 两个方向都触发 | 电平变化监测、编码器 |
| 高/低电平 | 电平持续期间触发 | 告警类信号 |

机械按键推荐单边沿（下降沿）触发：按下瞬间触点抖动会产生多次双边跳变，双边沿触发会把一次按键计成多次。

### 从 MCU 的 EXTI 到 Linux 的中断链

MCU 裸机开发中，外部中断由 EXTI 模块管理，同编号引脚共享一条 EXTI 线（PA0/PB0/PC0 互斥）。到 Linux 下，这条链路由三层组成：

1. GPIO 控制器本身注册为中断控制器（设备树中带 `interrupt-controller` 属性），把引脚边沿转换为中断
2. 中断经 `interrupt-parent` 上报到 GIC（ARM）或 PLIC（RISC-V）
3. 驱动经 `gpiod_to_irq()` / 设备树 `interrupts` 属性获得 Linux 中断号，注册处理函数——第 10 章的完整中断机制在此衔接

RK3568 的 GPIO 控制器节点（`rk356x.dtsi` 摘录）：

```dts
gpio1: gpio@fe740000 {
    compatible = "rockchip,gpio-bank";
    reg = <0x0 0xfe740000 0x0 0x100>;
    interrupts = <GIC_SPI 66 IRQ_TYPE_LEVEL_HIGH>;
    gpio-controller;
    #gpio-cells = <2>;
    interrupt-controller;
    #interrupt-cells = <2>;
};
```

`gpio-controller` 与 `interrupt-controller` 双重身份，正是"GPIO 既能当数据引脚又能当中断源"在设备树里的表达。

### 防抖：硬件与软件

机械触点抖动持续 5~20 ms。两级防线：

- **硬件防抖**：按钮并联 RC 滤波（如 10 kΩ + 100 nF，τ=1 ms；劣质开关加大到几十 ms），物理上抹平抖动
- **软件防抖**：检测到边沿后延时 10 ms 再确认电平；Linux 设备树可直接用 `debounce-interval = <20>`（单位 ms）让 gpio-keys 驱动在内核态完成防抖

> 💡 工业场景采用硬件 RC + 软件延时双保险。单独软件防抖在强电磁干扰环境下不可靠；单独硬件防抖在元件老化后裕量下降。

---

## <span class="blue"> Linux 中的 GPIO：gpiolib 与用户态

### gpiolib 框架

内核 GPIO 子系统（gpiolib）的分层：

```
用户态        libgpiod / 命令行工具
              ↓ ioctl
字符设备      /dev/gpiochip0, /dev/gpiochip1, ...
              ↓
gpiolib       gpio_chip（控制器抽象）→ gpio_desc（引脚描述符）
              ↓
驱动层        gpio-keys / gpio-leds / gpio-hog / 各外设驱动
              ↓
硬件          GPIO 控制器（APB 总线上的寄存器块，见 B-A.1.1）
```

每个 GPIO 控制器对应一个 `/dev/gpiochipN`，芯片内的引脚用**偏移号（offset）**标识，不再是 sysfs 时代的全局编号。

### sysfs 接口已退场

旧的 `/sys/class/gpio` 导出接口自内核 4.8 起标记废弃，新内核（6.x）发行版大多已不再编译 `CONFIG_GPIO_SYSFS`。用户态的标准路径是 GPIO 字符设备 + libgpiod。存量脚本里的 `echo N > /sys/class/gpio/export` 写法，迁移到 `gpioset`/`gpioget` 或设备树方案。

> ⚠️ libgpiod 的 1.x 与 2.x API 互不兼容。1.x 的 `gpiod_line_request_input()` 等接口在 2.x 中全部移除，2.x 改为"配置对象 + 请求对象"模型。Debian Trixie / Ubuntu 24.10 起仓库默认 2.x；本节后文代码均为 v2 API。维护旧系统时注意区分。

### 命令行工具速查

```bash
gpiodetect                          # 列出所有 gpiochip 及引脚数
gpioinfo                            # 查看每个引脚的占用者、方向、电平
gpioget gpiochip1 8                 # 读 gpiochip1 偏移 8 的电平
gpioset gpiochip1 8=1               # 置高（进程退出即释放，引脚复位）
gpioset -c gpiochip1 8=1            # 守护模式：保持输出直到 Ctrl+C
gpiomon --falling gpiochip1 8       # 监听下降沿事件，带时间戳
```

GPIO 行为异常时，第一排查手段是 `gpioinfo`：确认目标引脚当前被谁占用（`used` 列显示消费者名）、方向是否符合预期、电平是否随外部操作变化。占用者不是你——八成是设备树里另一个节点（如 `gpio-hog`、某个外设驱动）先拿了；方向不对——回到设备树查 `gpios` 属性。

### 设备树描述

不需要写驱动就能用 GPIO 的三个内核现成的驱动：

```dts
/ {
    // 按键：注册为输入事件（/dev/input/eventX）
    gpio_keys: gpio-keys {
        compatible = "gpio-keys";

        button_start: button-start {
            label = "start";
            gpios = <&gpio1 8 GPIO_ACTIVE_LOW>;
            linux,code = <KEY_F1>;
            debounce-interval = <20>;   // 内核态 20ms 防抖
        };
    };

    // LED：注册到 /sys/class/leds/
    gpio_leds: gpio-leds {
        compatible = "gpio-leds";

        led_status: led-status {
            label = "status:green";
            gpios = <&gpio1 9 GPIO_ACTIVE_HIGH>;
            default-state = "on";
            linux,default-trigger = "heartbeat";   // 心跳灯
        };
    };
};
```

`gpio-keys` 把按键变成标准输入事件（业务程序读 `/dev/input/eventX`，可用 epoll 监听——第 11 章 input 子系统的入口）；`gpio-leds` 把 LED 交给 LED 子系统，`heartbeat` 触发器由内核自动闪烁，一行用户态代码都不用写。

### libgpiod v2 代码示例

按键中断监听 + LED 控制的最小完整程序（v2 API）：

```c
/* gpio_demo.c — libgpiod v2：按键(中断,20ms防抖) 翻转 LED */
#include <gpiod.h>
#include <stdio.h>
#include <poll.h>

#define CHIP       "/dev/gpiochip1"
#define BTN_OFFSET  8
#define LED_OFFSET  9

int main(void)
{
    /* 1. 打开控制器 */
    struct gpiod_chip *chip = gpiod_chip_open(CHIP);
    if (!chip) { perror("gpiod_chip_open"); return 1; }

    /* 2. 按键配置：输入 + 上拉 + 双边沿 + 20ms 防抖 */
    struct gpiod_line_settings *btn_set = gpiod_line_settings_new();
    gpiod_line_settings_set_direction(btn_set, GPIOD_LINE_DIRECTION_INPUT);
    gpiod_line_settings_set_bias(btn_set, GPIOD_LINE_BIAS_PULL_UP);
    gpiod_line_settings_set_edge_detection(btn_set, GPIOD_LINE_EDGE_BOTH);
    gpiod_line_settings_set_debounce_period_us(btn_set, 20000);

    /* 3. LED 配置：输出，初始灭 */
    struct gpiod_line_settings *led_set = gpiod_line_settings_new();
    gpiod_line_settings_set_direction(led_set, GPIOD_LINE_DIRECTION_OUTPUT);
    gpiod_line_settings_set_output_value(led_set, GPIOD_LINE_VALUE_INACTIVE);

    /* 4. 打包请求 */
    struct gpiod_line_config *line_cfg = gpiod_line_config_new();
    unsigned int btn_off = BTN_OFFSET, led_off = LED_OFFSET;
    gpiod_line_config_add_line_settings(line_cfg, &btn_off, 1, btn_set);
    gpiod_line_config_add_line_settings(line_cfg, &led_off, 1, led_set);

    struct gpiod_request_config *req_cfg = gpiod_request_config_new();
    gpiod_request_config_set_consumer(req_cfg, "gpio-demo");

    struct gpiod_line_request *req =
        gpiod_chip_request_lines(chip, req_cfg, line_cfg);
    if (!req) { perror("request_lines"); return 1; }

    /* 5. 事件循环：poll 等待边沿事件，翻转 LED */
    struct gpiod_edge_event_buffer *evbuf = gpiod_edge_event_buffer_new(16);
    struct pollfd pfd = {
        .fd = gpiod_line_request_get_fd(req),
        .events = POLLIN,
    };
    enum gpiod_line_value led = GPIOD_LINE_VALUE_INACTIVE;

    printf("等待按键...\n");
    while (poll(&pfd, 1, -1) > 0) {
        int n = gpiod_line_request_read_edge_events(req, evbuf, 16);
        for (int i = 0; i < n; i++) {
            struct gpiod_edge_event *ev =
                gpiod_edge_event_buffer_get_event(evbuf, i);
            if (gpiod_edge_event_get_line_offset(ev) != BTN_OFFSET)
                continue;
            if (gpiod_edge_event_get_event_type(ev) ==
                GPIOD_EDGE_EVENT_FALLING_EDGE) {
                led = (led == GPIOD_LINE_VALUE_ACTIVE)
                    ? GPIOD_LINE_VALUE_INACTIVE : GPIOD_LINE_VALUE_ACTIVE;
                gpiod_line_request_set_value(req, LED_OFFSET, led);
                printf("按键按下，LED -> %s\n",
                       led == GPIOD_LINE_VALUE_ACTIVE ? "亮" : "灭");
            }
        }
    }

    gpiod_line_request_release(req);
    gpiod_chip_close(chip);
    return 0;
}
```

编译与运行：

```bash
gcc gpio_demo.c -o gpio_demo -lgpiod
./gpio_demo
```

与 1.x 时代的差异要点：不再有"逐引脚 request"，改为一次请求一组引脚；防抖、上下拉、边沿都收进 `gpiod_line_settings`，其中防抖经内核 `GPIO_V2_LINE_ATTR_DEBOUNCE` 落到底层——**设备支持时由内核/硬件完成，不再依赖用户态延时循环**。

---

## <span class="blue"> 方案对比（Trade-off）

| 需求 | 方案 | 代价 | 何时不选 |
|------|------|------|----------|
| 按键输入 | `gpio-keys` + input 事件 | 零代码，事件进标准输入子系统 | 需要微秒级响应时（走中断驱动） |
| 状态灯 | `gpio-leds` + trigger | 零代码，heartbeat/mmc 等现成触发器 | 需要复杂灯效逻辑 |
| 快速验证 | `gpioset`/`gpioget`/`gpiomon` | 进程退出即释放，状态不保持 | 需要持续保持电平（用 `-c` 或写程序） |
| 用户态产品代码 | libgpiod v2 + poll/epoll | 性能低于内核驱动（μs 级延迟） | 高频翻转（>10kHz）必须内核态 |
| 高频/硬实时 | 内核驱动 + 中断（D 扩展 GPIO 子系统篇） | 开发成本高 | 简单场景杀鸡用牛刀 |

---

## <span class="blue"> 常见陷阱

> ⚠️ 浮空输入当传感器接口。外部无驱动源时引脚拾取干扰随机跳变，中断被反复误触发。输入模式必须明确上下拉，或确认外部有稳定驱动。

> ⚠️ 开漏忘接上拉。输出高电平时引脚处于高阻态，读数完全不确定。开漏与上拉电阻是成套的。

> ⚠️ 用 `gpioset` 验证后程序里却控制不了。`gpioset` 退出即释放引脚，引脚回到默认输入态——现象是"命令行能点亮，程序里不行"或"程序退出灯就灭"。需要保持电平的场景用 `gpioset -c` 或常驻程序持有请求。

> ⚠️ 照搬 libgpiod 1.x 教程代码在 2.x 系统上编译。`gpiod_line_request_input` 等符号全部不存在。确认目标系统版本：`pkg-config --modversion libgpiod`。

> ⚠️ 假设所有引脚都 5V 容忍。接入 5V 信号前逐引脚查数据手册的 FT 标记；标 TC/TT 的引脚接 5V 必烧 ESD 结构。

---

## <span class="blue"> 动手练习

1. **占用者排查**：开发板上执行 `gpiodetect` 与 `gpioinfo`，找出已被内核占用的引脚（LED、按键、复位信号），对照设备树找出占用它们的节点。
2. **命令行点灯**：用 `gpioset -c` 点亮一颗板载 LED，另一个终端执行 `gpioinfo` 观察该引脚的消费者与方向变化，随后 Ctrl+C 观察引脚释放。
3. **事件监听**：用 `gpiomon --falling --num-events=5` 监听按键引脚，连续按 5 次，记录内核报出的时间戳，估算你的按键抖动是否被 20 ms 防抖完全覆盖。
4. **无硬件后备**：内核配置 `CONFIG_GPIO_SIM`（gpio-sim 模块）可在无真实硬件的机器上虚拟出 gpiochip，用 `configfs` 定义引脚与连线后，上述全部命令照常可用——本节的 libgpiod 程序不改一行即可在 PC 虚拟环境跑通。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 四种模式 | 输入/输出/复用/模拟的控制权归属与缓冲器状态 |
| 推挽 vs 开漏 | 驱动能力、高阻态、线与、电平转换；开漏必配上拉 |
| 上下拉 | 40kΩ 弱拉、82μA 量级功耗、与外部电路的分压冲突 |
| 电气边界 | 驱动电流、ESD 二极管、5V 容忍、电平兼容矩阵 |
| 中断防抖 | 触发方式选择、Linux 中断链、`debounce-interval` |
| Linux 路径 | gpiolib 分层、gpio-keys/gpio-leds 零代码方案、libgpiod v2 API、sysfs 已废弃 |
| 排查锚点 | GPIO 异常第一查 `gpioinfo`（占用者/方向/电平） |

---

## <span class="blue"> 配套资源

- **libgpiod 官方文档与源码**：https://git.kernel.org/pub/scm/libs/libgpiod/libgpiod.git
- **内核文档**：`Documentation/driver-api/gpio/`、`Documentation/devicetree/bindings/gpio/`
- **本书锚点硬件**：RK3568 GPIO 节点见配套源码缓存 `help-docs/kernel-src-v6.6/rk356x.dtsi`

---

## <span class="blue"> 下一步

下一节 **B-B.2.2 PWM 脉宽调制**：GPIO 只能输出 0 和 1，PWM 用占空比在数字引脚上合成"模拟量"——LED 调光、电机调速、舵机控制都建立在它之上。完成基础外设四篇后，**B-B.2.5 实战篇**会把本节的按键中断、PWM 呼吸灯、ADC 采集合并成一个完整的代码级产品案例。

> 💡 螺旋衔接：本节的 `gpio-keys` 走 input 子系统，正是第 11 章设备模型的标准落地形态；中断链细节回接第 10 章；而用户态写驱动的完整写法体系在 D 扩展的 GPIO/中断子系统篇展开。
