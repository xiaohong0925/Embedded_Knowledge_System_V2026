# B-B.6.1 I3C 物理层与 I2C 演进

> 所属章节：第五部 B. 总线协议 > B-B.6 I3C 智能传感器总线
>
> 难度：[I] Intermediate | 预计阅读时间：25 分钟

## <span class="blue"> 本节导读

I3C（Improved Inter-Integrated Circuit）是 MIPI 联盟制定的传感器总线标准，设计目标是在 I2C 两根线的基础上同时解决速率、功耗、中断线与地址冲突四个痛点。DDR5 的 SPD 已从 I2C 全面切换到 I3C，主流手机 SoC、汽车 ECU 与工业 MCU 普遍集成 I3C 控制器——新设计的传感器系统需要回答的第一个问题就是：继续 I2C，还是上 I3C。

本节覆盖：I3C 与 I2C 的电气差异、开漏+推挽混合驱动机制、SDR/HDR 速率模式、电压等级选型、I3C 相对 I2C 的七大改进、混合总线拓扑与 DDR5 SPD 案例。

---

## <span class="blue"> 引脚兼容与电气差异

I3C 复用 I2C 的 SDA/SCL 两根线，上拉电阻仍在，但驱动方式已经改变：

| 参数 | I2C | I3C |
|------|-----|-----|
| 信号线 | SDA + SCL | SDA + SCL（引脚兼容） |
| 驱动方式 | 纯开漏 | 开漏 + 推挽混合，按阶段切换 |
| 最大速率 | FM+ 1 MHz | SDR 12.5 MHz / HDR 33.3 Mbps |
| 总线电容限制 | 400 pF | **50 pF** |
| 上拉电阻 | 必须 | 推挽阶段可省（降低静态功耗） |
| 中断机制 | 独立 IRQ 引脚 | **IBI 带内中断**，不占 GPIO |
| 地址 | 静态，出厂固化 | 动态分配 |

50 pF 电容限制（I2C 的 1/8）是硬约束：走线长、挂设备多都会超标。工程经验值——I3C 总线控制在 **20 cm 以内、10 个设备以内**。

---

## <span class="blue"> 混合驱动：开漏仲裁 + 推挽传输

I3C 的核心设计是**按阶段切换驱动方式**：

| 阶段 | 驱动方式 | 原因 |
|------|----------|------|
| 空闲、START、地址仲裁 | 开漏（同 I2C） | 多设备竞争需要线与逻辑，防冲突 |
| ACK 后的数据传输 | 推挽 | 主动驱动上下沿，边沿 <10 ns，速率飙升 |
| STOP 前 | 切回开漏 | 安全释放总线 |

```
I2C 纯开漏波形（SDA）                I3C 推挽波形（SDA，数据阶段）

     ___________                          ┌───┐   ┌───┐
_____|           |_____                ───┘   └───┘   └───
     <-- RC 充电 -->                         ↑  ↑
     上升沿缓慢                          陡峭边沿 <10ns

     释放后靠上拉电阻充电              主控主动拉高/拉低
```

开漏的速率瓶颈在上升沿——RC 充电时间随总线电容线性增长，这正是 I2C 限速 1 MHz 的物理原因。推挽绕开了它，但也带来新约束：两个设备同时驱动会短路，所以仲裁阶段必须回到开漏。

---

## <span class="blue"> 速率模式

| 模式 | 速率 | 编码 | 驱动 | 适用 |
|------|------|------|------|------|
| SDR | 12.5 MHz | 1 bit/clock，类 I2C | 开漏→推挽 | 常规寄存器读写，兼容 I2C 设备 |
| HDR-DDR | 25 Mbps | 双边沿采样 | 纯推挽 | 大数据量（图像传感器） |
| HDR-TSP | 33.3 Mbps | 三态编码 | 纯推挽 | 最高吞吐（仅完整版 I3C，Basic 不含） |
| HDR-TSL | 33.3 Mbps | 三态编码 | 混合 | 含 I2C legacy 的总线上跑 HDR |
| I2C FM/FM+ | 0.4/1 MHz | 标准 I2C | 开漏 | 纯 legacy 设备 |

HDR 模式通过 CCC 命令进入，进入后总线上的 I2C legacy 设备认不出 HDR 帧格式、自动静默，退出序列后才重新参与——I3C 与 I2C 设备因此可以**共存于同一总线**互不干扰。

---

## <span class="blue"> 电压等级选型

| 电压 | 典型场景 | I2C 兼容性 |
|------|----------|-----------|
| 1.0 V | 先进手机 SoC 内部传感器总线 | 不兼容，纯 I3C |
| 1.2 V | 低功耗 IoT、可穿戴 | 不兼容 |
| 1.8 V | 主流手机、汽车 ECU | 部分兼容（查各器件 Vih 上限） |
| 3.3 V | 工业、开发板、legacy 系统 | 完全兼容 |

> ⚠️ I3C 推挽驱动的满摆幅可能损坏低耐压 I2C 从设备：3.3 V 总线上挂只耐 1.8 V 的传感器，推挽阶段的信号摆幅会击穿其输入保护二极管。设计混合总线必须逐个核对 legacy 设备的 Vih(max)——不确定时统一 1.8 V 最安全。

---

## <span class="blue"> I2C → I3C：七大改进

| 维度 | I2C | I3C | 收益 |
|------|-----|-----|------|
| 峰值速率 | 1 MHz | 12.5 MHz / 33.3 Mbps | 12~33 倍 |
| 功耗 | 上拉电阻持续耗电 | 推挽阶段无上拉 | 约 −60% |
| 中断 | 每设备一根 IRQ 线 | IBI 带内中断 | 省 GPIO |
| 地址 | 静态，冲突靠飞线 | 动态分配 | 同型号可挂多个 |
| 热插拔 | 不支持 | 支持 | 在线维护 |
| 控制命令 | 厂商各自定义 | CCC 标准命令集 | 驱动统一 |
| 向后兼容 | — | 原生兼容 I2C | 渐进迁移 |

功耗一项值得展开：3.3 V 总线、1 kΩ 上拉，总线拉低期间静态电流 3.3 mA。手机上十几个传感器累积可观，推挽取消持续上拉是移动设备转向 I3C 的主要动机之一。

IBI（In-Band Interrupt）让从设备在总线空闲时主动发起仲裁"举手"，主机响应后读取事件源——加速度计、触摸屏、接近传感器不再各占一根中断 GPIO。

选型结论：**新设计优先 I3C 主控**——它能驱动 I2C 从设备（向后兼容），反过来不成立（I2C 主控不理解推挽切换与 CCC）。老设备继续用，新设备逐步换。

---

## <span class="blue"> 混合总线拓扑

实际系统通常 I3C 与 I2C 设备混挂：

<svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" style="max-width:720px;width:100%">
<rect x="280" y="15" width="160" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="360" y="36" text-anchor="middle" font-size="13" fill="currentColor">I3C 主控制器</text>
<text x="360" y="53" text-anchor="middle" font-size="11" fill="currentColor">SoC / MCU</text>
<line x1="120" y1="100" x2="600" y2="100" stroke="currentColor" stroke-width="1.5"/>
<line x1="120" y1="115" x2="600" y2="115" stroke="currentColor" stroke-width="1.5"/>
<text x="610" y="104" font-size="12" fill="currentColor">SCL</text>
<text x="610" y="119" font-size="12" fill="currentColor">SDA</text>
<text x="130" y="92" font-size="11" fill="currentColor">VIO = 1.8 V，总线 &lt; 20 cm / 50 pF</text>
<line x1="360" y1="65" x2="360" y2="100" stroke="currentColor" stroke-width="1.5"/>
<rect x="60" y="160" width="150" height="55" rx="5" fill="none" stroke="currentColor"/>
<text x="135" y="182" text-anchor="middle" font-size="12" fill="currentColor">I3C 温度传感器</text>
<text x="135" y="200" text-anchor="middle" font-size="11" fill="currentColor">动态地址 0x08</text>
<rect x="240" y="160" width="150" height="55" rx="5" fill="none" stroke="currentColor"/>
<text x="315" y="182" text-anchor="middle" font-size="12" fill="currentColor">I3C IMU（6 轴）</text>
<text x="315" y="200" text-anchor="middle" font-size="11" fill="currentColor">动态地址 0x09</text>
<rect x="420" y="160" width="150" height="55" rx="5" fill="none" stroke="currentColor"/>
<text x="495" y="182" text-anchor="middle" font-size="12" fill="currentColor">I3C DDR5 SPD</text>
<text x="495" y="200" text-anchor="middle" font-size="11" fill="currentColor">静态地址 0x50</text>
<rect x="150" y="245" width="150" height="50" rx="5" fill="none" stroke="currentColor" stroke-dasharray="5,3"/>
<text x="225" y="267" text-anchor="middle" font-size="12" fill="currentColor">I2C EEPROM</text>
<text x="225" y="285" text-anchor="middle" font-size="11" fill="currentColor">静态地址 0x50</text>
<rect x="420" y="245" width="150" height="50" rx="5" fill="none" stroke="currentColor" stroke-dasharray="5,3"/>
<text x="495" y="267" text-anchor="middle" font-size="12" fill="currentColor">I2C 环境传感器</text>
<text x="495" y="285" text-anchor="middle" font-size="11" fill="currentColor">静态地址 0x44</text>
<line x1="135" y1="115" x2="135" y2="160" stroke="currentColor"/>
<line x1="315" y1="115" x2="315" y2="160" stroke="currentColor"/>
<line x1="495" y1="115" x2="495" y2="160" stroke="currentColor"/>
<line x1="225" y1="115" x2="225" y2="245" stroke="currentColor" stroke-dasharray="5,3"/>
</svg>

图中 DDR5 SPD 与 EEPROM 同为 0x50——I3C 主机靠动态地址分配可以区分，但设计时仍应避免静态地址重叠，降低初始化复杂度。

混合总线的典型工作时序：

```
时间轴 ──────────────────────────────────────────────────>

[开漏]  START + 0x7E(W)   CCC 广播：为 I3C 设备分配动态地址
[开漏]  ACK + STOP
[开漏]  START + 0x08(W)   选中 I3C 设备
[推挽]  高速数据突发      ←→ ←→ ←→
[开漏]  STOP
[开漏]  START + 0x50(W)   选中 I2C EEPROM —— 回退 I2C 时序
[开漏]  慢速读写          ~ ~ ~ ~
[开漏]  STOP
[开漏]  IBI：从设备主动拉 SDA 请求中断 → 主机读取事件源
```

---

## <span class="blue"> 行业案例：DDR5 SPD 全面切换 I3C

DDR5 内存条的 SPD（Serial Presence Detect）存储时序参数与制造商信息。DDR4 用 I2C（SMBus）读取，DDR5 由 JEDEC 规定切换到 I3C，原因有三：

1. SPD 数据量增大（片上 ECC、更复杂的时序训练参数）；
2. 单条 DIMM 两个独立子通道需分别读取；
3. JEDEC 采用免版税的 I3C Basic，高速模式为 HDR-DDR（25 Mbps）以满足启动时间预算。

DDR5 SPD Hub 工作在 1.0 V，纯 I3C 无 I2C 兼容——DDR4 的 I2C SPD 芯片物理上也无法用于 DDR5 插槽。

---

## <span class="blue"> 设计 Checklist

| 检查项 | 标准 |
|--------|------|
| 走线长度 | < 20 cm |
| 总线电容 | < 50 pF（含线缆与设备输入电容） |
| legacy 设备耐压 | Vih(max) ≥ 总线 VIO |
| 上拉电阻 | 匹配总线电容（1.8 V 典型 1k~4.7 kΩ） |
| 主控能力 | 确认支持所需 HDR 模式 |
| 地址规划 | I2C 静态地址不与 I3C 静态/动态地址冲突 |

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| I3C vs I2C | 速率/功耗/中断/地址全面占优；代价是主控与器件可选范围仍小于 I2C，布线约束更严 |
| 推挽驱动 | 边沿陡、速率高、省电；代价是 50 pF 电容预算与电压缩摆风险 |
| 动态地址 | 免冲突、即插即用；代价是地址运行时可变，软件不能硬编码 |
| 混合总线 | 保护 I2C 存量投资；代价是时序复杂（开漏/推挽切换、legacy 静默管理） |
| HDR 模式 | 吞吐极限；代价是调试工具链支持弱（多数逻辑分析仪不支持 HDR 解码） |

---

## <span class="blue"> 常见陷阱

> ⚠️ 把 I2C 的布线习惯带到 I3C：长排线 + 多设备，总线电容超 50 pF，SDR 模式边沿退化、误码。I3C 走线按高速信号对待。

> ⚠️ 混合总线电压没核对：推挽满摆幅击穿低耐压 I2C 器件，且损伤是累积性的——初期"能用"，数月后失效。

> ⚠️ 软件硬编码动态地址：设备重枚举后地址可能变化，硬编码地址的驱动间歇性失联。动态地址要在枚举阶段从主机获取。

> ⚠️ 以为 I3C 主控能随便带 I2C 设备：I2C legacy 设备如果支持时钟拉伸或需要 400 pF 电容预算，仍可能拖垮整条总线。混挂前查 legacy 器件的时序特性。

---

## <span class="blue"> 动手练习

1. **波形对比**：示波器分别抓 I2C（400 kHz 开漏）与 I3C（SDR 推挽）的 SDA 上升沿，量测上升时间差异，理解 RC 瓶颈。
2. **电容估算**：查本板 I3C 器件数据手册的输入电容，累加走线寄生（约 1~2 pF/cm），核对 50 pF 预算。
3. **无硬件后备**：无 I3C 控制器时，在 I2C 总线上做对照实验——分别用 10 kΩ 与 1 kΩ 上拉抓上升沿，观察 RC 充电对速率的限制，这正是推挽要解决的问题。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 电气差异 | 混合驱动、50 pF、速率档位与 I2C 的对比表 |
| 驱动切换 | 仲裁开漏 / 数据推挽的阶段划分及原因 |
| 速率模式 | SDR 与三种 HDR 的速率、编码、适用场景 |
| 电压选型 | 混合总线 1.8 V 优先；推挽摆幅风险 |
| 七大改进 | 能逐条说出收益（速率/功耗/IBI/动态地址/热插拔/CCC/兼容） |
| 混合拓扑 | legacy 设备静默机制；地址规划原则 |

---

## <span class="blue"> 配套资源

- **规范**：MIPI I3C Specification v1.1.1；JEDEC JESD300-5A（DDR5 SPD）
- **内核文档**：`Documentation/driver-api/i3c/`（内核源码树）
- **器件资料**：NXP i.MX 8/9 系列 I3C 控制器手册；STM32H5 I3C 应用笔记 AN5407

---

## <span class="blue"> 下一步

物理层之后是协议层：**B-B.6.2 I3C 协议层与 CCC 命令**——7E 广播地址与动态地址分配流程、广播/定向 CCC 命令集、IBI 带内中断时序、HDR 进入/退出序列。

> 💡 螺旋衔接：开漏与推挽的对比回看 B-B.2.1 GPIO 的输出模式配置（同一对晶体管的两种用法）；IBI 带内中断与 B-B.3 I2C 的 SMBus Alert（B-B.3.3）是同一问题的两代答案；动态地址分配与 B-C 板块 CAN 的仲裁机制在"总线上如何唯一标识设备"这一点上互为参照。
