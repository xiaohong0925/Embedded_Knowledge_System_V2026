# B-B.2.3 ADC 模数转换

> 所属章节：第五部 B. 总线协议 > B-B.2 基础外设接口
>
> 难度：[B] Beginner | 预计阅读时间：30 分钟

## <span class="blue"> 本节导读

PWM 解决的是数字控制模拟量，ADC（Analog-to-Digital Converter，模数转换器）解决反方向的问题：把连续变化的模拟电压转换成 CPU 能处理的数字。温度、压力、电池电压、光照、音频采集——所有"感知物理世界"的场景都经过 ADC。

本节覆盖：分辨率/采样率/参考电压三个核心参数及 ENOB 的实际含义、SAR 与 Σ-Δ 两种主流架构的取舍、Linux IIO 子系统的 sysfs 接口与设备树配置（以 RK3568 SARADC 为锚点），以及两个工业典型信号链：NTC 热敏电阻测温与 4-20 mA 变送器采集。

---

## <span class="blue"> ADC 核心参数

### 分辨率、采样率、参考电压

| 分辨率 | LSB @ 3.3 V 参考 | 典型适用场景 |
|--------|------------------|--------------|
| 8-bit | 12.89 mV | 电池电量指示、按键阵列 |
| 10-bit | 3.22 mV | 消费级温度/光强检测 |
| 12-bit | 0.81 mV | 工业传感器、电流采样 |
| 16-bit | 50.35 μV | 精密仪器、音频采集 |
| 24-bit | 0.20 μV | 高精度称重、医疗传感（Σ-Δ） |

LSB（Least Significant Bit）= Vref / 2ⁿ，是 ADC 能分辨的最小电压变化。但标称分辨率不等于实际精度：噪声、温漂、参考电压抖动都会吃掉有效位数。**ENOB（有效位数）**通常比标称值低 2~4 位，数据手册的 ENOB 指标比分辨率更值得看。

**采样率**（SPS）受奈奎斯特准则约束：还原信号需要至少 2 倍于信号最高频率的采样率，工程上取 5~10 倍留裕量。温度、电池电压这类慢变信号几 SPS 就够，电流环控制需要几十 kSPS。

**采样时间**是内部采样保持电容充满所需时间。信号源内阻越大，充电越慢；采样时间设得太短，电容未充满就开始转换，读数系统性偏低——高阻信号源（大阻值分压、长走线传感器）调试时的经典坑。

**参考电压 Vref** 是换算的基准：数字值 = (Vin / Vref) × 2ⁿ。Vref 漂移，所有通道的读数同比例漂移。SoC 内部参考温漂大，精密测量应使用外部基准源（如 REF3333，温漂 3 ppm/°C），Vref 引脚就近放 10 μF + 100 nF 滤波，走线远离高速信号。

> ⚠️ ADC 读数集体漂移、所有通道同方向偏移时，先怀疑 Vref 而非传感器。用精密电压源或万用表实测 Vref 引脚电压，一次测量即可定位。

### 架构选型：SAR vs Σ-Δ

| 特性 | SAR（逐次逼近） | Σ-Δ（过采样） |
|------|-----------------|---------------|
| 原理 | 二分法逐位比较 | 过采样 + 噪声整形 + 数字滤波 |
| 速度 | ~1 MSPS | ~kSPS 级 |
| 分辨率 | 8~16 bit | 16~24 bit |
| 功耗 | 低 | 中（数字滤波耗电） |
| 延迟 | 单周期，确定 | 高（滤波群延迟） |
| 典型载体 | SoC 内置 ADC | 外置精密 ADC 芯片 |

SoC 内置 ADC（RK3568 的 SARADC、i.MX 的 ADC 等）几乎全是 SAR 型：n 位分辨率经 n 次逐位比较完成转换，速度与精度均衡，覆盖嵌入式大多数场景。需要 20 bit 以上有效分辨率时（称重、精密音频）才选外置 Σ-Δ ADC——它用高延迟换精度，控制环路里要特别留意滤波延迟。

---

## <span class="blue"> Linux IIO 子系统

### 架构

内核中 ADC/DAC/各类传感器统一归 IIO（Industrial I/O）子系统管理：

```
用户态     sysfs（/sys/bus/iio/） 或字符设备（/dev/iio:deviceX）
           ↓
IIO 核心   iio_device（设备实例）/ iio_channel（通道）/ buffer / trigger
           ↓
驱动层     ADC 控制器驱动（读寄存器 → 原始值上报）
           ↓
硬件       SARADC（挂在 APB 总线上，见 B-A.1.1）
```

### sysfs 接口

`/sys/bus/iio/devices/iio:deviceX/` 下的关键文件：

| 文件 | 含义 | 示例值 |
|------|------|--------|
| `name` | 设备名 | `fe720000.saradc` |
| `in_voltageY_raw` | 通道 Y 原始读数 | `2047` |
| `in_voltageY_scale` | 缩放系数（mV/LSB） | `0.805664062` |
| `in_voltageY_offset` | 偏移 | `0` |

换算公式（IIO 约定）：

```
电压(mV) = (raw + offset) × scale
```

命令行直接读：

```bash
cat /sys/bus/iio/devices/iio:device0/in_voltage0_raw
cat /sys/bus/iio/devices/iio:device0/in_voltage0_scale
```

### 设备树配置（RK3568 锚点）

RK3568 的 SARADC 节点（`rk356x.dtsi:1553`）：

```dts
saradc: saradc@fe720000 {
    compatible = "rockchip,rk3568-saradc", "rockchip,rk3399-saradc";
    reg = <0x0 0xfe720000 0x0 0x100>;
    interrupts = <GIC_SPI 93 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&cru CLK_SARADC>, <&cru PCLK_SARADC>;
    clock-names = "saradc", "apb_pclk";
    #io-channel-cells = <1>;
    status = "disabled";
};
```

板级使能并为通道指定参考电压：

```dts
&saradc {
    vref-supply = <&vcc_3v3>;    /* 参考电压来源 */
    status = "okay";
};
```

`#io-channel-cells = <1>` 表示消费方引用时给一个通道号参数。按键、电压监测等消费方用 `io-channels = <&saradc N>` 接入通道 N。RK3568 的 SARADC 为 10-bit，注意前文 LSB 表中 10-bit 档的精度边界。

---

## <span class="blue"> 信号链实例一：NTC 热敏电阻测温

### 电路与原理

```
     3.3V (Vref)
        │
      [R_fix = 10kΩ]
        │
        +───────→ ADC 通道 0
        │
      [R_ntc]   10kΩ@25°C，B=3950
        │
       GND

R_ntc(T) = R25 × exp(B × (1/T − 1/T25))
ADC 读数 = 4095 × R_ntc / (R_fix + R_ntc)
```

### 温度-ADC 对照（12-bit 换算展示，10-bit 同理右移 2 位）

| 温度 (°C) | ADC 值 | NTC 电阻 (Ω) |
|-----------|--------|--------------|
| -40 | 3995 | 401,860 |
| -20 | 3740 | 105,385 |
| 0 | 3156 | 33,621 |
| 25 | 2047 | 10,000 |
| 50 | 1081 | 3,588 |
| 85 | 401 | 1,087 |
| 100 | 267 | 698 |

NTC 的非线性非常明显：25 °C 附近 1 °C 对应约 60 LSB，-40 °C 时只有约 7 LSB——低温段的有效分辨率急剧恶化。**工程做法是查表 + 线性插值**，比现算指数公式快且精度可控。查找表用脚本在编译期生成：

```python
# gen_ntc_table.py — NTC 10k/B3950 查找表生成器
import math

R25, B, T25 = 10000, 3950, 273.15 + 25
VCC, R_FIX, ADC_MAX = 3.3, 10000, 4095

def adc_of(t):
    T = t + 273.15
    R = R25 * math.exp(B * (1/T - 1/T25))
    return int(R / (R_FIX + R) * ADC_MAX)

print("static const uint16_t ntc_adc_table[] = {")
vals = [adc_of(t) for t in range(-40, 101)]
for i in range(0, len(vals), 10):
    print("    " + ", ".join(f"{v:4d}" for v in vals[i:i+10]) + ",")
print("};")
```

生成的前几行（已校验，-40 °C=3995，25 °C=2047，100 °C=267）：

```c
static const uint16_t ntc_adc_table[] = {
    3995, 3988, 3980, 3972, 3963, 3954, 3944, 3934, 3923, 3912,  /* -40~-31°C */
    3900, 3887, 3874, 3859, 3845, 3829, 3813, 3796, 3778, 3759,  /* -30~-21°C */
    3740, 3719, 3698, 3676, 3653, 3629, 3604, 3578, 3551, 3523,  /* -20~-11°C */
    /* … 全表 141 项，由脚本生成 … */
};
```

查表换算（读 raw → 温度）：

```c
/* ntc_lookup：二分定位 + 线性插值，输入 raw，输出 °C */
#define NTC_T_MIN  (-40)
#define NTC_T_MAX  (100)

float ntc_lookup(uint16_t adc)
{
    int n = NTC_T_MAX - NTC_T_MIN;          /* 表长 141，下标 0..140 */
    if (adc >= ntc_adc_table[0]) return NTC_T_MIN;
    if (adc <= ntc_adc_table[n]) return NTC_T_MAX;

    for (int i = 0; i < n; i++) {
        if (adc <= ntc_adc_table[i] && adc >= ntc_adc_table[i + 1]) {
            float span = ntc_adc_table[i] - ntc_adc_table[i + 1];
            float frac = span > 0 ? (ntc_adc_table[i] - adc) / span : 0;
            return NTC_T_MIN + i + frac;
        }
    }
    return -999.0f;                          /* 不可能到达 */
}
```

---

## <span class="blue"> 信号链实例二：4-20 mA 工业变送器

4-20 mA 电流环是工业传感器的事实标准：电流信号对线路阻抗不敏感，抗干扰，适合百米级传输；4 mA 零点设计还能区分"真零值"与"断线"（断线时电流为 0）。接收端用精密采样电阻把电流转成电压。

### 量程匹配：先算再上板

以 3.3 V 参考的 ADC 为例，选 150 Ω 采样电阻：

| 电流 | 电压（×150Ω） | ADC 值（12-bit, Vref=3.3V） | 量程百分比 |
|------|---------------|------------------------------|------------|
| 4 mA | 0.60 V | 745 | 0% |
| 8 mA | 1.20 V | 1489 | 25% |
| 12 mA | 1.80 V | 2234 | 50% |
| 16 mA | 2.40 V | 2978 | 75% |
| 20 mA | 3.00 V | 3723 | 100% |

> ⚠️ 用 250 Ω 采样电阻配 3.3 V ADC 是选型期错误：20 mA × 250 Ω = 5 V 直接超量程，满量程段全部削顶为 4095。要么换 150 Ω 电阻（20 mA→3.0 V，留 0.3 V 裕量），要么选 5 V 量程的 ADC。量程匹配必须在原理图阶段算清，软件无法补救削顶。

### 换算代码

```c
/* 4-20mA → 物理量：以 0~1.6 MPa 压力变送器为例 */
#define SHUNT_OHM   150.0f
#define VREF        3.3f
#define ADC_MAX     4095.0f
#define MA_MIN      4.0f
#define MA_MAX      20.0f
#define PRES_MIN    0.0f
#define PRES_MAX    1.6f

float adc_to_pressure(int raw)
{
    float v  = raw * VREF / ADC_MAX;              /* ① ADC → 电压 */
    float ma = v / SHUNT_OHM * 1000.0f;           /* ② 电压 → 电流 */

    if (ma < MA_MIN - 1.0f)
        return -1.0f;                             /* 断线告警：电流远低于 4mA */

    float pct = (ma - MA_MIN) / (MA_MAX - MA_MIN);/* ③ 电流 → 百分比 */
    if (pct < 0.0f) pct = 0.0f;
    if (pct > 1.0f) pct = 1.0f;
    return PRES_MIN + pct * (PRES_MAX - PRES_MIN);/* ④ 百分比 → 物理量 */
}
```

第 ② 步后的断线判断是 4-20 mA 的特有红利：电流低于 3 mA 左右基本可判定线路断开或变送器失电，这是纯电压信号给不了的诊断能力。

---

## <span class="blue"> 调试与排查

| 命令/工具 | 用途 |
|-----------|------|
| `ls /sys/bus/iio/devices/` | 确认 IIO 设备注册 |
| `cat .../in_voltageY_raw` | 读原始值 |
| `iio_info`（libiio） | 查看设备完整属性与通道 |
| `iio_readdev -b 128 iio:device0` | 批量采集验证稳定性 |
| `dmesg \| grep -i adc` | 驱动加载日志 |
| 万用表/示波器 | 量 ADC 引脚实际电压与噪声 |

ADC 读数异常时，第一排查手段是**用两个已知电压点校准读数链**：输入接地读一次（应接近 0）、输入接 Vref 读一次（应接近满量程）。两点都对，问题在模拟前端（分压、采样电阻、传感器）；两点不对，问题在数字侧（通道号错、scale 用错、Vref 本身不对）。这一步能在十分钟内把"硬件还是软件"的争论终结。

---

## <span class="blue"> 方案对比（Trade-off）

| 需求 | 方案 | 代价/限制 |
|------|------|-----------|
| 慢变信号（温度/电压） | SoC 内置 SARADC + sysfs 读 | 精度受内部参考限制，10~12 bit |
| 精密测量（称重/医疗） | 外置 Σ-Δ ADC（I2C/SPI 接口） | 成本高，滤波延迟大，驱动归 B-B.3/B-B.4 |
| 多通道高速采集 | ADC + DMA + IIO buffer/trigger | 驱动复杂度高，归 D 扩展 IIO 写法篇 |
| 非线性传感器 | 查表 + 插值 | 占用 Flash，表生成脚本入版本库 |
| 长距离工业信号 | 4-20 mA 电流环 | 需采样电阻与量程核算 |

---

## <span class="blue"> 常见陷阱

> ⚠️ 采样时间不足导致高阻信号源读数偏低。前端有大阻值分压或 RC 滤波时，按数据手册加大采样周期；症状是读数稳定但系统性偏小。

> ⚠️ NTC 低温段分辨率崩塌仍按全量程报精度。查表之外，选型时让常用温度区间落在 NTC 斜率最大的区段（分压电阻取 NTC 在常用温度点的阻值附近）。

> ⚠️ 4-20 mA 量程削顶。采样电阻 × 20 mA 超过 Vref 的部分全部读 4095，软件看到的是"卡死的最大值"。原理图阶段完成量程核算。

> ⚠️ 把 IIO 的 raw 值直接当电压。raw 必须经 `(raw + offset) × scale` 换算；不同设备的 scale 不同（10-bit SARADC 与 12-bit 差 4 倍），硬编码系数换板即错。

> ⚠️ 忽略 Vref 依赖。用 3.3 V 电源轨兼作 Vref 时，电源波动直接变成测量误差。电池供电场景尤其明显——电量下降时"测出来的电压"跟着造假。比例式测量（传感器与 ADC 共用同一 Vref）可抵消这类误差。

---

## <span class="blue"> 动手练习

1. **sysfs 读链**：在开发板找 `iio:deviceX` 下的 `in_voltage*_raw` 与 `scale`，手算一次 `(raw+offset)×scale`，与万用表实测该引脚电压对比。
2. **两点校准**：通道接地、接 Vref 各读一次，验证第一排查手段的判断逻辑。
3. **NTC 复现**：运行本节的 `gen_ntc_table.py`，确认 -40/25/100 °C 三点与正文对照表一致，再用 `ntc_lookup` 反查 2047 应得 25.0 °C。
4. **无硬件后备**：内核 IIO 自带 dummy 框架（`drivers/iio/dummy/`，`CONFIG_IIO_DUMMY_EVGEN` 等），可虚拟出带通道的 IIO 设备；或在 PC 上用 Python 复现 NTC/4-20 mA 的完整换算链（公式都在正文），验证代码逻辑后再上板。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 三参数 | LSB 计算；ENOB 与标称分辨率的差距；采样时间与信号源内阻的关系 |
| 架构 | SAR 与 Σ-Δ 的速度/精度/延迟取舍 |
| IIO | sysfs 文件语义；`(raw+offset)×scale` 换算；设备树 `#io-channel-cells` |
| NTC 链 | 分压电路、非线性、查表+插值的工程理由 |
| 4-20 mA 链 | 采样电阻量程核算、4 mA 零点的断线诊断价值 |
| 排查锚点 | 两点校准法（接地/接 Vref）先分硬件侧与数字侧 |

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/iio/`、`Documentation/devicetree/bindings/iio/adc/`
- **工具库**：libiio（https://github.com/analogdevicesinc/libiio）
- **锚点硬件**：RK3568 SARADC 节点见配套源码缓存 `help-docs/kernel-src-v6.6/rk356x.dtsi:1553`

---

## <span class="blue"> 下一步

下一节 **B-B.2.4 DAC 与基础外设选型**：ADC 的反向操作——把数字值变回模拟电压，以及 GPIO/PWM/ADC/DAC 四件套在真实项目中的选型方法。随后 **B-B.2.5 实战篇**把 GPIO 按键、PWM 呼吸灯、ADC 采集合成一个完整代码案例。

> 💡 螺旋衔接：本节只讲了 IIO 的消费侧（怎么读），IIO 驱动的写法（`iio_device` 注册、buffer、trigger）归 D 扩展；传感器挂到 I2C/SPI 总线上的场景，接 B-B.3/B-B.4 两篇。
