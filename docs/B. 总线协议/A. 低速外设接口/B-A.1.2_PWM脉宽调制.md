# B-A.1.2 PWM 脉宽调制

> 所属章节：第五部 B. 总线协议 > B-A.1 基础外设接口
>
> 难度：[B] Beginner | 预计阅读时间：25 分钟

## <span class="blue"> 本节导读

GPIO 只能输出 0 和 1 两种状态，PWM（Pulse Width Modulation，脉宽调制）用一串方波在数字引脚上合成"模拟量"：占空比 50% 的 3.3 V 方波，负载感受到的平均电压是 1.65 V。LED 调光、LCD 背光、电机调速、舵机控制、蜂鸣器发声都建立在这一个原理上。

本节覆盖：周期/占空比/极性三要素、边沿对齐与中心对齐两种计数模式、H 桥驱动的互补输出与死区时间、Linux PWM 子系统的 sysfs 接口与内核 API、设备树描述（以 RK3568 为锚点），以及背光与电机两个典型落地形态的频率选型依据。

---

## <span class="blue"> PWM 原理

### 三要素

| 参数 | 含义 | 关系式 | 典型值 |
|------|------|--------|--------|
| 周期 T | 一个完整波形的时间 | T = 1 / f | 50 μs（20 kHz） |
| 占空比 D | 有效电平时间占比 | D = t_on / T | 0%~100% |
| 分辨率 | 占空比最小调节粒度 | 定时器位宽决定 | 8/10/12/16 bit |

负载侧只看平均值：平均电压 V_avg = D × V_high。LED 亮度、电机转速、蜂鸣器音量的控制，都是对 D 的调节。

```
占空比对比（正极性，周期 T 相同）：

D = 75%   ┌───┐ ┌───┐ ┌───┐
          │   │ │   │ │   │
       ───┘   └─┘   └─┘   └──

D = 50%   ┌──┐  ┌──┐  ┌──┐
          │  │  │  │  │  │
       ───┘  └──┘  └──┘  └──

D = 25%   ┌─┐   ┌─┐   ┌─┐
          │ │   │ │   │ │
       ───┘ └───┘ └───┘ └───
       |<-- T -->|
```

### 极性

极性定义哪种电平是"有效"的：正极性（Active High）下占空比指高电平占比；负极性（Active Low）下指低电平占比。某些 LED 驱动与电机驱动芯片要求负极性输入。

> 💡 极性配反的典型症状：占空比调大亮度反而变暗。排查 PWM 行为时先确认外设数据手册要求的极性，再核对设备树中的 `PWM_POLARITY_NORMAL/INVERTED` 标志。

### 边沿对齐与中心对齐

| 模式 | 计数方式 | 波形特征 | 适用场景 |
|------|----------|----------|----------|
| 边沿对齐 | 计数器 0→ARR 后归零，单次比较翻转 | 实现简单，谐波含量高 | LED 调光、通用调速 |
| 中心对齐 | 计数器 0→ARR→0，上下行各比较一次 | 波形对称，谐波低，转矩脉动小 | 无刷电机 FOC、H 桥逆变 |

绝大多数应用用边沿对齐；电机控制类场景需要中心对齐时，确认所用 PWM 控制器是否支持（RK3568 的 PWM 支持中心对齐模式，具体见芯片手册 PWM 章节）。

### 互补输出与死区时间

驱动 H 桥/半桥时，同一桥臂上下两个 MOSFET 绝不能同时导通——同时导通即电源直通短路。PWM 控制器用两个机制保证安全：

- **互补输出**：一路 PWM 与其反相的 PWM̄ 成对输出
- **死区时间**：两路信号切换之间插入"双管全关"的时间窗（几百 ns 到几 μs）

```
PWM  (上管)   ┌──┐     ┌──┐
           ───┘  └─────┘  └───
PWM̄ (下管) ───┐  ┌─────┐  ┌───
              └──┘     └──┘
              ↑死区↑   ↑死区↑
        死区窗口内两管均关断
```

> ⚠️ 死区太短，上下管直通短路；太长，有效输出时间被吃掉，电机低速转矩不足。从 MOSFET 关断延迟数据出发计算，再用示波器核对两路波形无交叠。

---

## <span class="blue"> Linux PWM 子系统

### 框架与核心概念

内核 PWM 子系统把各厂控制器的差异收敛为统一抽象：

- **pwmchip**：一个 PWM 控制器，管理若干通道，sysfs 下呈现为 `/sys/class/pwm/pwmchipN/`
- **pwm_state**：通道状态三元组——`period`（周期，ns）、`duty_cycle`（有效时间，ns）、`polarity` + `enabled`。v6.6 内核中该结构定义于 `include/linux/pwm.h:59`

注意单位：Linux PWM 子系统全程使用**纳秒**，不是赫兹。20 kHz 要写 `period = 50000`。

### sysfs 接口

```
/sys/class/pwm/pwmchip0/
    ├── npwm          # 通道数
    ├── export        # 导出通道：echo 0 > export
    └── pwm0/
        ├── period        # 周期（ns）
        ├── duty_cycle    # 有效时间（ns）
        ├── polarity      # normal / inversed
        └── enable        # 1=输出，0=停止
```

完整操作流程：

```bash
echo 0 > /sys/class/pwm/pwmchip0/export      # 导出通道 0
echo 50000 > /sys/class/pwm/pwmchip0/pwm0/period
echo 25000 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle   # 50%
echo 1 > /sys/class/pwm/pwmchip0/pwm0/enable
```

> ⚠️ 写入顺序有约束：`duty_cycle` 不能超过 `period`，否则返回 `-EINVAL`。改频率时应先降占空比、改周期、再重设占空比。

### 设备树描述（RK3568 锚点）

RK3568 的 PWM 控制器节点（`rk356x.dtsi:458`）：

```dts
pwm0: pwm@fdd70000 {
    compatible = "rockchip,rk3568-pwm", "rockchip,rk3328-pwm";
    reg = <0x0 0xfdd70000 0x0 0x10>;
    clocks = <&pmucru CLK_PWM0>, <&pmucru PCLK_PWM0>;
    clock-names = "pwm", "pclk";
    pinctrl-0 = <&pwm0m0_pins>;
    pinctrl-names = "default";
    #pwm-cells = <3>;
    status = "disabled";
};
```

`#pwm-cells = <3>` 表示引用方要给三个参数：通道号、周期（ns）、极性。使用方以背光为例：

```dts
backlight: backlight {
    compatible = "pwm-backlight";
    pwms = <&pwm0 0 50000 0>;    /* 控制器 通道 周期ns 极性 */
    brightness-levels = <0 16 32 64 96 128 160 192 224 255>;
    default-brightness-level = <5>;
    status = "okay";
};

&pwm0 {
    status = "okay";             /* dtsi 默认 disabled，板级开启 */
};
```

`pwm-backlight` 是内核现成驱动（`drivers/video/backlight/pwm_bl.c`），注册后用户态经 `/sys/class/backlight/backlight/brightness` 调亮度，一行 PWM 代码都不用写。

### 内核 API（驱动侧）

内核驱动经 PWM Consumer API 控制通道（以下均对 v6.6 `include/linux/pwm.h` 核对）：

```c
#include <linux/pwm.h>

struct pwm_device *pwm;
struct pwm_state state;

pwm = devm_pwm_get(&pdev->dev, NULL);        /* pwm.h:406 */
if (IS_ERR(pwm))
    return PTR_ERR(pwm);

pwm_get_state(pwm, &state);                  /* 读出设备树默认状态 */
state.period = 50000;
state.duty_cycle = 25000;
state.enabled = true;
pwm_apply_state(pwm, &state);                /* pwm.h:312 */
```

> 💡 `pwm_apply_state()` 在 v6.8 起更名为 `pwm_apply_might_sleep()`——新名字明示该函数可能睡眠，禁止在中断/原子上下文调用。v6.6 内核中仍是 `pwm_apply_state`，但语义相同，跨版本移植时注意。

---

## <span class="blue"> 两个落地形态与频率选型

### LCD 背光

人眼对 60 Hz 以下的闪烁敏感，手机相机对光时频闪表现为滚动条纹。背光 PWM 频率取 ≥20 kHz，远超人眼与常见相机的感知范围。设备树用 `pwm-backlight`（上节示例），亮度级别表 `brightness-levels` 按人眼对数感知特性取非线性间隔，低亮段密、高亮段疏。

### 直流电机调速

电机经 H 桥驱动芯片（TB6612/L298N 类）接 PWM。频率低于 10 kHz 时，PWM 脉冲驱动线圈产生的音频谐波落在人耳范围，表现为高频啸叫；频率过高则 MOSFET 开关损耗上升、发热加剧。折中区间 10~20 kHz。

转速突变对驱动器与机械结构都是冲击，控制侧常用加减速曲线（每步限幅变化 + 固定步进间隔），把占空比的阶跃变成斜坡。

### 频率选型表（Trade-off）

| 负载 | 推荐频率 | 下限依据 | 上限依据 |
|------|----------|----------|----------|
| LCD 背光 | ≥20 kHz | 人眼频闪、相机条纹 | 驱动芯片开关损耗 |
| 直流有刷电机 | 10~20 kHz | 音频啸叫 | MOSFET 发热 |
| 舵机 | 50 Hz（周期 20 ms） | 舵机协议规定 | 协议规定 |
| 蜂鸣器（无源） | 音频范围内变化 | 目标音调 | — |
| LED 指示灯 | ≥1 kHz | 可见频闪 | 无特殊约束 |

---

## <span class="blue"> 调试与排查

常用命令：

```bash
ls /sys/class/pwm/                                # 所有控制器
cat /sys/class/pwm/pwmchip0/npwm                  # 通道数
cat /sys/class/pwm/pwmchip0/pwm0/{period,duty_cycle,enable,polarity}
dmesg | grep -i pwm
```

PWM 无输出时，第一排查手段是核对四件事：**控制器 status 是否 "okay"、pinctrl 是否把引脚复用到 PWM 功能、sysfs 三件套（period/duty_cycle/enable）是否生效、`gpioinfo` 确认引脚没有被当 GPIO 占用**。四项全对仍无波形，再上示波器量引脚——量到波形异常（过冲、振铃）是布线/吸收问题，量不到任何波形则是复用或时钟问题。其中"pinctrl 没配、引脚还在 GPIO 模式"是现场最高频的根因。

---

## <span class="blue"> 常见陷阱

> ⚠️ 频率选错两头受罪：过低（<100 Hz 背光 / <10 kHz 电机）频闪、啸叫；过高开关损耗发热。按上表区间取值后，满载测驱动芯片温升。

> ⚠️ 极性配反。负极性外设配成正极性，占空比逻辑整体反转。症状迷惑性强，先查极性再查代码。

> ⚠️ `duty_cycle > period` 写入失败。改频率时必须先降占空比再改周期，顺序错了 sysfs 返回 EINVAL 而脚本不报错。

> ⚠️ pinctrl 未复用。设备树里 PWM 控制器 status okay、sysfs 操作全部成功，引脚上却没有波形——引脚还在 GPIO 功能上。用 `gpioinfo` 或 `cat /sys/kernel/debug/pinctrl/.../pinmux-pins` 确认。

> ⚠️ 线性占空比 ≠ 线性亮度。人眼对亮度是对数感知，线性步进在低亮段变化剧烈、高亮段几乎无感。背光/指示灯的亮度表按对数曲线取点。

---

## <span class="blue"> 动手练习

1. **sysfs 全流程**：找一路空闲 PWM 通道，完成导出 → 设 20 kHz → 50% → 使能 → 示波器（或接 LED 肉眼观察）验证；再改 12.5% 观察变化。
2. **背光路径**：若开发板有 `pwm-backlight`，经 `/sys/class/backlight/*/brightness` 写不同值，同时用 `cat /sys/class/pwm/pwmchip*/pwm*/duty_cycle` 观察内核如何把亮度级别换算成占空比。
3. **失败注入**：先写 `duty_cycle=60000` 再写 `period=50000`，观察 `echo $?` 的返回值与 dmesg，理解写入顺序约束。
4. **无硬件后备**：内核 `CONFIG_PWM_SIM`（pwm-sim 模块，`drivers/pwm/pwm-sim.c`）可虚拟出 PWM 控制器，sysfs 全流程在 PC 虚拟环境原样可练；配合内核文档 `Documentation/testing/pwm-sim.rst`。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 三要素 | 周期/占空比/分辨率的关系；平均电压 = D × V_high |
| 极性 | 正负极性语义；配反的症状与排查 |
| 对齐模式 | 边沿对齐通用、中心对齐用于电机 FOC |
| 死区 | H 桥直通风险、死区的定义与调试方法 |
| Linux 接口 | sysfs 四文件操作流；纳秒单位；duty≤period 约束 |
| 设备树 | `#pwm-cells` 三参数；`pwm-backlight` 零代码路径 |
| 内核 API | `devm_pwm_get` / `pwm_get_state` / `pwm_apply_state`（v6.6 核对） |
| 排查锚点 | 无输出四查：status / pinctrl / sysfs 三件套 / GPIO 占用 |

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/devicetree/bindings/pwm/pwm.yaml`、`Documentation/testing/pwm-sim.rst`
- **内核源码**：`drivers/pwm/core.c`、`include/linux/pwm.h`（v6.6）、`drivers/video/backlight/pwm_bl.c`
- **锚点硬件**：RK3568 PWM 节点见配套源码缓存 `help-docs/kernel-src-v6.6/rk356x.dtsi:458`

---

## <span class="blue"> 下一步

PWM 解决的是"数字控制模拟量"，反方向的问题是把模拟信号读进来——温度、电池电压、光照强度。下一节 **B-A.1.3 ADC 模数转换**，讲 SAR 型 ADC 的采样原理与 Linux IIO 子系统。到 **B-A.1.5 实战篇**，GPIO 按键、PWM 呼吸灯、ADC 采集将合并为一个完整的产品级代码案例。

> 💡 螺旋衔接：本节的内核 API 只给了最小用法，PWM 控制器驱动（pwm_chip 注册、`->apply` 实现）的完整写法归 D 扩展子系统篇；呼吸灯与按键的端到端组合归 B-A.1.5。
