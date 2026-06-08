# B-A.1.1 GPIO通用输入输出 [B]

> 所属章节：第五部 B. 总线协议 > B-A.1 低速总线协议
>
> 难度：[B] Beginner | 预计阅读时间：25分钟

## <span class="blue"> 本节导读

GPIO（General Purpose Input/Output，通用输入输出）是嵌入式开发中最基础、最常用的硬件接口。几乎每个嵌入式项目都会用到GPIO——控制LED亮灭、读取按钮状态、驱动继电器、检测传感器信号……GPIO看似简单，但用好它却需要理解硬件结构、模式配置、速度选择和中断处理等多个层面。

本节将从GPIO的硬件结构出发，详细讲解输入输出模式的工作原理，带你理解上下拉电阻的必要性、推挽与开漏输出的区别、复用功能的本质。然后深入到GPIO中断机制，掌握EXTI外部中断线的配置方法和防抖处理技巧。最后通过一个完整的工业控制实例——3个按钮输入 + 3个LED输出 + 1个继电器控制——把理论落地到实际项目中，包含完整的设备树配置和libgpiod用户空间代码。

读完本节，你将能够 confidently 配置和使用GPIO，避免常见的"浮空输入噪声误触发"等陷阱，并能在工业场景中实现可靠的GPIO控制方案。

---

## <span class="blue"> GPIO硬件结构与电气特性 [B]

### GPIO内部结构概览

现代SoC的GPIO模块内部结构可以抽象为以下几个核心部分：

```
                    +------------------+
                    |    复用功能      |
                    |  (UART/SPI/I2C)  |
                    +--------+---------+
                             |
                    +--------v---------+
    输入数据寄存器  |     GPIO模块      |  输出数据寄存器
    (IDR) <---------|  +-------------+ |--------> (ODR)
                    |  |  输出控制   | |
                    |  |  推挽/开漏  | |<-- BSRR(置位/复位寄存器)
                    |  +-------------+ |
                    |  +-------------+ |
    模拟外设 <------|  |  输入控制   | |------> 数字外设
                    |  |浮空/上拉/下拉| |
                    |  |Schmitt触发器| |
                    |  +-------------+ |
                    +--------+---------+
                             |
                    +--------v---------+
                    |    速度控制      |
                    | (OSPEEDR[1:0])  |
                    |  2/10/50/100MHz |
                    +------------------+
```

以STM32F407（Cortex-M4）为例，每个GPIO端口有：
- **MODER**（模式寄存器）：2bit/引脚，配置输入/输出/复用/模拟模式
- **OTYPER**（输出类型寄存器）：1bit/引脚，推挽(0)或开漏(1)
- **OSPEEDR**（输出速度寄存器）：2bit/引脚，Low/Medium/High/VeryHigh
- **PUPDR**（上拉/下拉寄存器）：2bit/引脚，浮空/上拉/下拉
- **IDR**（输入数据寄存器）：只读，读取引脚当前电平
- **ODR**（输出数据寄存器）：读写，设置输出电平
- **BSRR**（位设置/清除寄存器）：32bit，高16bit清除，低16bit设置

```
    BSRR寄存器操作示例（GPIOA Pin5，即LED on PA5）：

    BSRR[31:16] = 位清除（写1到BSRR[21] -> PA5输出低电平）
    BSRR[15:0]  = 位设置   （写1到BSRR[5]  -> PA5输出高电平）

    代码：GPIOA->BSRR = (1<<5);   // PA5 = HIGH
          GPIOA->BSRR = (1<<21);  // PA5 = LOW（21 = 5+16）
```

> 💡 **提示**：使用BSRR代替ODR进行位操作是**原子操作**，不会出现读-改-写竞争。在多线程或中断环境中，通过ODR修改某一引脚可能因"读ODR→修改某一位→写回ODR"的过程中被中断，导致其他引脚状态被意外改写。BSRR直接写对应位即可，无需读取当前ODR值。

每个GPIO引脚都可以独立配置为输入、输出、复用或模拟模式。理解这些模式的本质，是正确使用GPIO的第一步。

### GPIO电气参数表

GPIO的电气特性决定了它能与哪些外部设备直接连接、是否需要电平转换、能驱动多大负载。以下参数以 **STM32F407，VDD = 3.3V，TA = 25°C** 为基准（数据来源于DS8626 Rev9数据手册）。

**输入电平阈值表：**

| 参数 | 符号 | 最小值 | 典型值 | 最大值 | 单位 | 说明 |
|------|------|--------|--------|--------|------|------|
| 输入高电平阈值(CMOS) | V_IH | 0.7×VDD | - | VDD+0.3 | V | 必须 ≥ 2.31V 才认作逻辑1 |
| 输入低电平阈值(CMOS) | V_IL | VSS-0.3 | - | 0.3×VDD | V | 必须 ≤ 0.99V 才认作逻辑0 |
| 输入高电平阈值(TTL) | V_IH_TTL | 2.0 | - | 5.5 | V | TTL兼容模式 |
| 输入低电平阈值(TTL) | V_IL_TTL | -0.3 | - | 0.8 | V | TTL兼容模式 |
| Schmitt迟滞电压 | V_hys | 200 | - | - | mV | 抗噪声能力 |
| 输入漏电流 | I_leak | - | ±0.1 | ±1 | μA | 25°C时 |

> **CMOS vs TTL 阈值差异**：CMOS阈值是VDD的比例（0.3×VDD / 0.7×VDD），会随VDD变化；TTL阈值是固定电压（0.8V / 2.0V），与VDD无关。STM32的GPIO输入可以配置为CMOS或TTL兼容模式。

**输出电平与驱动电流表：**

| 速度配置 | I_OL(max) | V_OL(max@I_OL) | I_OH(max) | V_OH(min@I_OH) | 说明 |
|----------|-----------|----------------|-----------|----------------|------|
| Low(2MHz) | 8mA | 0.4V@8mA | 8mA | VDD-0.4V@8mA | 最强驱动 |
| Medium(10MHz) | 8mA | 0.4V@8mA | 8mA | VDD-0.4V@8mA | 平衡方案 |
| High(50MHz) | 8mA | 0.4V@8mA | 8mA | VDD-0.4V@8mA | 高速信号 |
| VeryHigh(100MHz)| 8mA | 0.4V@8mA | 8mA | VDD-0.4V@8mA | 超高速信号 |

> 注：上表中的8mA是**标准GPIO**在3.3V供电下的典型驱动能力。STM32F4系列的部分GPIO可以通过配置实现**源电流(Source)和灌电流(Sink)达到±12mA或±16mA**（需要查阅具体型号的数据手册）。实际应用中所有引脚的总电流受限于芯片总功耗和VDD/VSS引脚的载流能力。

```
    输出电压降与负载电流的关系（典型值）：

    V_OL = 引脚输出低电平时的实际电压（理想为0V）
    V_OH = 引脚输出高电平时的实际电压（理想为VDD）

    当 I_OL = 8mA 时，V_OL ≤ 0.4V  （NMOS导通电阻上的压降）
    当 I_OH = 8mA 时，V_OH ≥ VDD-0.4V （PMOS导通电阻上的压降）

    推算导通电阻：
    R_ON(NMOS) ≤ V_OL / I_OL = 0.4V / 8mA = 50Ω （典型约20Ω）
    R_ON(PMOS) ≤ (VDD - V_OH) / I_OH = 0.4V / 8mA = 50Ω （典型约30Ω）
```

### Schmitt触发器

所有STM32 GPIO的输入通道都内置了**Schmitt触发器**（施密特触发器），它是一个具有双阈值的比较器电路。

**为什么需要Schmitt触发器？**

普通CMOS比较器只有一个阈值V_TH。当输入信号在V_TH附近缓慢变化或存在噪声时，输出会在0和1之间反复振荡，产生多个虚假翻转。

Schmitt触发器有两个阈值：
- **V_IH**（上限阈值）：输入从低→高时，必须超过此值才翻转为1
- **V_IL**（下限阈值）：输入从高→低时，必须低于此值才翻转为0

```
    Schmitt触发器迟滞特性（以STM32F407 CMOS模式为例）：

    输出(逻辑)
      1 |              +-----------+     V_IH = 0.7×VDD = 2.31V
        |             /             \    V_IL = 0.3×VDD = 0.99V
        |            /               \   V_hys = V_IH - V_IL ≈ 1.32V
        |           /                 \
        |          /                   \
      0 +---------/                     +-------- 输入(电压)
        0V    0.99V                 2.31V   3.3V

        ↑        ↑                     ↑
        |        |                     |
      输出=0  下降翻转点           上升翻转点
              (V_IL)              (V_IH)

    迟滞曲线说明：
    ──── 输入从0V上升 ────────────────────────────────────
    当 Vin < 2.31V 时，输出保持0
    当 Vin > 2.31V 时，输出翻转为1

    ──── 输入从3.3V下降 ─────────────────────────────────
    当 Vin > 0.99V 时，输出保持1
    当 Vin < 0.99V 时，输出翻转为0

    关键特性：在 0.99V < Vin < 2.31V 区间内，
    输出状态取决于"从哪个方向进入这个区间"，
    而不是当前电压值。这就是"迟滞"。
```

Schmitt触发器的**迟滞电压** V_hys = V_IH - V_IL 提供了噪声容限。对于STM32F407：

- CMOS模式：V_hys = 2.31V - 0.99V = **1.32V**（典型值，数据手册标注≥200mV保证值）
- 输入信号在0.99V~2.31V之间的噪声波动**不会**导致输出翻转

> ⚠️ **陷阱**：没有Schmitt触发器的普通CMOS输入，在输入信号缓慢变化时（如RC充电电路）会在阈值V_TH附近多次振荡。假设一个RC充电电路以τ=10ms的时间常数充电，在V_TH附近停留时间较长，噪声会导致输出产生几十个脉冲——每个脉冲都可能触发一次中断！**如果GPIO输入必须接缓慢变化的模拟信号，务必使用外部施密特触发器缓冲，或将信号接到ADC引脚用模拟方式采样。**

### 输入模式详解

**浮空输入（Floating Input）**

浮空输入模式下，引脚内部既不接上拉电阻也不接下拉电阻，Schmitt触发器输入直接连到引脚。此时引脚的电平完全由外部电路决定——外部给高电平就读到1，外部给低电平就读到0，外部什么都不接……读到的是什么？答案是：**噪声**。

浮空输入的输入阻抗极高（典型几十MΩ，漏电流≤1μA），这意味着引脚就像一根天线，很容易拾取周围的电磁干扰。如果你把手指靠近PCB上的浮空引脚，读到的值可能会随手指的靠近和远离而跳变。在实验室里这也许很有趣，但在产品中这是灾难。

> ⚠️ **陷阱**：浮空输入无上下拉电阻时，环境噪声会导致电平随机跳变，产生误触发。除非外部电路有明确且稳定的驱动源，否则**永远不要**使用浮空输入。

**上拉输入（Pull-up Input）**

上拉输入在引脚内部连接一个电阻（典型 **30~50kΩ**，STM32F4数据手册标称40kΩ±20%）到VDD。当外部电路未主动驱动引脚时，引脚被上拉电阻拉到高电平（逻辑1）。只有当外部电路将引脚拉低时，才读到逻辑0。

上拉输入最典型的应用是**按钮检测**。按钮的一端接地，另一端接GPIO引脚。按钮未按下时，上拉电阻将引脚保持在高电平；按下时，按钮将引脚短路到地，读到低电平。这种接法称为"低电平有效"。

```
        VDD (3.3V)
         |
        [R_pull]  内部上拉电阻 (~40kΩ)
         |
    +----+---- GPIO引脚（读到高电平）
    |         按钮未按下时
   === 按钮
    |
   GND

    按钮按下时等效电路：
        VDD ---[40kΩ]---+--- GPIO = 0V（被按钮短路到GND）
                        |
                       === 按钮闭合（接触电阻~100mΩ）
                        |
                       GND

    按钮未按下时：V_GPIO = VDD = 3.3V（被上拉拉高）
    按钮按下时：V_GPIO = GND = 0V（被按钮拉低）
    上拉电阻电流：I_pull = VDD / R_pull = 3.3V / 40kΩ ≈ 82.5μA
```

**下拉输入（Pull-down Input）**

下拉输入与上拉输入相反，内部电阻（同样30~50kΩ）连接到GND。引脚默认处于低电平（逻辑0），只有外部电路将引脚拉高时才读到逻辑1。

下拉输入适用于"高电平有效"的场景。比如某些传感器的输出在触发时变为高电平，此时使用下拉输入可以确保未触发时读到稳定的低电平。

> 💡 **提示**：上下拉电阻的阻值一般在30~50kΩ范围。阻值越小，抗干扰能力越强，但功耗也越大。电池供电设备需要在抗干扰和功耗之间权衡。详细功耗计算见下方"上下拉电阻深入"小节。

### 推挽输出深入

推挽输出使用一对互补的MOSFET（一个PMOS和一个NMOS）来驱动引脚。当输出逻辑1时，PMOS导通，NMOS截止，引脚被推到VDD高电平；当输出逻辑0时，PMOS截止，NMOS导通，引脚被拉到GND低电平。两个MOS管交替"推"和"挽"，因此叫推挽。

```
        VDD (3.3V)
         |
       PMOS  ← 输出0时截止，输出1时导通
         |     R_ON(PMOS) ≈ 30Ω（典型）
    +----+---- GPIO引脚
    |
   NMOS  ← 输出1时截止，输出0时导通
    |     R_ON(NMOS) ≈ 20Ω（典型）
   GND

    等效驱动电路：
    输出1时：VDD ---[30Ω]---> GPIO引脚（源电流 Source）
    输出0时：GND <---[20Ω]--- GPIO引脚（灌电流 Sink）
```

**驱动电流计算实例——LED驱动：**

假设驱动一个红色LED，正向压降V_F = 2.0V@20mA，使用限流电阻R_LED = 68Ω：

```
    驱动电流计算公式：

    I_DRV = (VDD - V_F - V_OL) / (R_LED + R_ON)

    代入数值：
    I_DRV = (3.3V - 2.0V - 0.4V) / (68Ω + 20Ω)
          = 0.9V / 88Ω
          ≈ 10.2mA

    问题：10.2mA > I_OL(max) = 8mA！超了额定值！

    解决方案1：增大限流电阻
    R_LED = (VDD - V_F - V_OL) / I_target - R_ON
          = (3.3 - 2.0 - 0.4) / 0.008 - 20
          = 0.9 / 0.008 - 20
          = 112.5 - 20 ≈ 92Ω → 选标准值100Ω

    验证：I_DRV = 0.9V / (100Ω + 20Ω) = 0.9/120 = 7.5mA ✓ (< 8mA)
           LED亮度：7.5mA/20mA = 37.5%（实际LED在5mA就很亮了）

    解决方案2：选用高亮度LED，V_F更低或5mA就够用
    若V_F=1.8V@5mA, R_LED=270Ω:
    I_DRV = (3.3 - 1.8 - 0.4) / (270 + 20) = 1.1/290 ≈ 3.8mA ✓
```

**能驱动多少个LED的计算：**

假设每个LED需要8mA（刚好达到GPIO极限），8个GPIO各驱动一个LED：
- 单个GPIO：I_GPIO = 8mA（OK，未超限）
- 8个GPIO同时输出低：I_total_sink = 8 × 8mA = 64mA
- 需要确认芯片VSS引脚能承受64mA的总灌电流（STM32F407的VSS引脚通常可以，但要查看数据手册的绝对最大额定值）

> ⚠️ **陷阱**：两个推挽输出短接——一个输出高一个输出低，短路电流 = VDD / (R_ON_PMOS + R_ON_NMOS) ≈ 3.3V / (30Ω+20Ω) ≈ **66mA**！这远超8mA额定值，可能在微秒级时间内永久损坏GPIO的MOS管。务必确保不会有两个推挽输出引脚直接短接（包括软件bug导致一个配置为输出高、另一个输出低的情况）。

**上升时间公式：**

推挽输出的上升时间取决于负载电容和PMOS导通电阻：

```
    t_r ≈ CL × (R_ON_PMOS + R_EXT) × ln(VDD / (VDD - V_IH_target))

    其中：
    CL        = 负载电容（PCB走线电容 + 器件输入电容，单位F）
    R_ON_PMOS = PMOS导通电阻（典型30Ω）
    R_EXT     = 外部串联电阻（如LED限流电阻，单位Ω）
    V_IH_target = 目标输入高电平阈值（通常取0.9×VDD）

    简化（充电到90% VDD）：
    t_r ≈ 2.3 × CL × (R_ON_PMOS + R_EXT)

    实例：驱动一个CL=50pF的负载，无外部电阻
    t_r ≈ 2.3 × 50pF × 30Ω = 2.3 × 50×10⁻¹² × 30
        ≈ 3.45ns（VeryHigh模式下理论值）

    实际上升时间还受PCB走线电感、过孔等因素影响，
    高速信号（>50MHz）时需要仔细考虑信号完整性。
```

### 开漏输出深入

开漏输出只使用一个NMOS管。输出逻辑0时，NMOS导通，引脚被拉到低电平；输出逻辑1时，NMOS截止，引脚处于**高阻态**（不是高电平！）。如果要让引脚输出高电平，必须**外部连接上拉电阻**到VDD。

```
    开漏输出内部结构：

        VDD_external (可以是5V，实现电平转换！)
         |
        [R_pull-up]  ← 外部上拉电阻（必须！）
         |
    +----+---- 总线/GPIO引脚
    |
   NMOS  ← 输出1时截止(高阻态)，输出0时导通(拉低到GND)
    |     R_ON(NMOS) ≈ 20Ω
   GND

    输出1：NMOS截止，引脚由上拉电阻拉到VDD_external（高电平）
    输出0：NMOS导通，引脚被拉到低电平（~0.4V@8mA）
```

**上拉电阻选型公式：**

上拉电阻决定了总线从低电平恢复到高电平的上升时间。电阻越小，上升越快，但功耗越大；电阻越大，功耗越小，但上升时间可能超标。

```
    上拉电阻计算公式（基于RC充电）：

    t_r = -ln(1 - V_target/V_DD_ext) × R_pull-up × C_bus

    简化为充电到90%（常用工程近似）：
    t_r ≈ 2.3 × R_pull-up × C_bus

    整理得最大上拉电阻：
    R_pull-up(max) = t_r_required / (2.3 × C_bus)

    I2C标准给出的经验公式（充电到V_IL的30%，即~1V）：
    R_pull-up(max) = t_r / (0.8473 × C_bus)

    其中：
    t_r       = 要求的上升时间（由通信协议决定，如I2C标准模式≤1000ns）
    C_bus     = 总线总电容（PCB走线电容 + 所有器件输入电容，单位pF）
```

**上拉电阻选型实例：**

```
    场景：I2C总线（标准模式100kHz），要求t_r ≤ 300ns
          总线电容：PCB走线20pF + 2个设备各10pF = 40pF

    R_pull-up(max) = 300ns / (0.8473 × 40pF)
                   = 300×10⁻⁹ / (0.8473 × 40×10⁻¹²)
                   ≈ 8.85kΩ

    同时考虑最小电阻（NMOS导通时的电流限制）：
    I_OL(max) = 8mA（GPIO规格）
    V_OL(max) = 0.4V
    R_pull-up(min) = (VDD - V_OL) / I_OL(max)
                   = (3.3 - 0.4) / 0.008
                   = 2.9 / 0.008 = 362.5Ω

    所以：362.5Ω < R_pull-up < 8.85kΩ
    工程选择：4.7kΩ（常用I2C上拉电阻值）✓

    验证：
    上升时间：t_r = 0.8473 × 4700Ω × 40pF ≈ 159ns ✓ (< 300ns)
    灌电流：I_sink = (3.3 - 0.4) / 4700 ≈ 0.62mA ✓ (< 8mA)
```

**线与（Wired-AND）功能：**

多个开漏输出可以并联在同一条总线上，实现"线与"逻辑：

```
    设备A开漏输出 ----+
                      +---- 总线（由上拉电阻保持高电平）
    设备B开漏输出 ----+
                      |
    设备C开漏输出 ----+

    逻辑真值表：
    A输出 | B输出 | C输出 | 总线电平
    ------|-------|-------|--------
     1    |   1   |   1   |   1 (所有NMOS截止，上拉保持高)
     0    |   X   |   X   |   0 (任一NMOS导通，总线被拉低)
     X    |   0   |   X   |   0
     X    |   X   |   0   |   0

    总线电平 = A · B · C  （逻辑与，Wired-AND）
    这正是I2C总线仲裁和ACK机制的基础！
```

> ⚠️ **陷阱**：忘记接上拉电阻时，开漏输出高电平时引脚处于高阻态。此时引脚电平由PCB上的杂散电容和漏电流决定——可能是高、可能是低、可能随温度变化。程序读到的值**完全不确定**。使用开漏输出时，永远要确保有明确的上拉电阻！

### 上下拉电阻深入

**内部上下拉电阻参数：**

| 参数 | 典型值 | 范围 | 说明 |
|------|--------|------|------|
| 上拉电阻R_pull-up | 40kΩ | 30~50kΩ | VDD=3.3V时 |
| 下拉电阻R_pull-down | 40kΩ | 30~50kΩ | 与上拉对称 |
| 上拉电流I_pull | ~82μA | 66~110μA | VDD/R_pull |
| 输入阻抗R_in | >1MΩ | 几十MΩ | Schmitt输入级 |
| 漏电流I_leak | 0.1μA | ≤1μA | 25°C时 |

**功耗计算：**

```
    单个上拉电阻功耗：
    P = VDD² / R_pull = (3.3V)² / 40kΩ = 10.89 / 40000 ≈ 0.27mW

    32个GPIO全部配置内部上拉：
    P_total = 32 × 0.27mW ≈ 8.7mW

    对比100kΩ外部上拉（同32个GPIO）：
    P_total_ext = 32 × (3.3² / 100k) = 32 × 0.109mW ≈ 3.5mW

    电池供电场景（假设1000mAh电池，3.3V）：
    40kΩ内部上拉总电流：32 × 82.5μA = 2.64mA
    续航减少：1000mAh / 2.64mA ≈ 379小时（约16天持续消耗）

    改用100kΩ外部上拉：
    总电流：32 × 33μA = 1.06mA
    续航减少：1000mAh / 1.06mA ≈ 943小时（约39天）

    如果GPIO只在需要时使能上下拉（动态配置）：
    实际消耗接近于零 → 低功耗设计的关键策略！
```

**上下拉电阻与外部驱动源冲突：**

```
    危险场景分析：

    外部驱动器：强上拉10kΩ到5V
    内部配置：下拉40kΩ到GND

         5V (外部驱动)
          |
        [10kΩ]
          |
    +-----+----- GPIO引脚(3.3V容忍？)
          |
        [40kΩ] (内部下拉)
          |
         GND

    引脚实际电压 = 5V × (40k / (10k + 40k)) = 5V × 0.8 = 4.0V

    如果GPIO不是5V容忍引脚：
    4.0V > VDD + 0.3V = 3.6V → ESD二极管导通 → 可能永久损坏！
```

> ⚠️ **陷阱**：上下拉电阻与外部驱动源冲突时，引脚实际电压由**分压决定**。外部驱动为强上拉10kΩ到5V，内部下拉40kΩ到GND——引脚实际电压 = 5V × 40k/(10k+40k) = 4.0V，可能超过3.3V GPIO的VDD容限！如果GPIO引脚**不是5V容忍(FT)**类型，ESD保护二极管将导通，大电流可能烧毁保护电路。在设计中必须确保内部上下拉与外部电路的阻抗匹配，或禁用内部上下拉。

### GPIO速度等级与上升时间

GPIO速度（Speed）控制的是输出驱动器的**栅极充电电流**——速度越高，MOS管栅极充电/放电越快，输出边沿越陡峭，可以驱动更高的开关频率，但同时也会带来更多的电磁干扰（EMI）和信号过冲。

**完整的速度参数表（STM32F407, CL=30pF, VDD=3.3V）：**

| 速度配置 | 寄存器值 | 最大翻转频率 | 典型上升时间t_r | 典型下降时间t_f | 驱动电流 | 适用场景 |
|----------|----------|------------|----------------|----------------|---------|---------|
| Low (2MHz) | 00b | 2MHz | ~10ns | ~8ns | 8mA | LED、继电器、低速控制 |
| Medium (10MHz) | 01b | 10MHz | ~4ns | ~3ns | 8mA | SPI低速、一般数字信号 |
| High (50MHz) | 10b | 50MHz | ~2ns | ~1.5ns | 8mA | SPI高速、SDIO |
| VeryHigh(100MHz)| 11b | 100MHz | ~1ns | ~0.8ns | 8mA | 以太网RMII、高速通信 |

**上升时间与负载电容的关系公式：**

```
    基本关系式：
    t_r [ns] ≈ (CL [pF] × ΔV [V]) / I_DRV [mA]

    其中：
    CL    = 负载电容（PCB走线电容 + 器件输入电容）
    ΔV    = 电压摆幅（通常等于VDD = 3.3V）
    I_DRV = 驱动电流（GPIO输出级峰值电流，约8mA）

    实例1：CL = 30pF（轻负载）
    t_r ≈ (30 × 3.3) / 8 = 12.4ns
    结论：Low speed(2MHz, t_r~10ns)已经足够

    实例2：CL = 50pF（中等负载，含PCB走线）
    t_r ≈ (50 × 3.3) / 8 = 20.6ns
    结论：需要Medium speed(10MHz, t_r~4ns)或更高

    实例3：CL = 150pF（重负载，多设备并联）
    t_r ≈ (150 × 3.3) / 8 = 61.9ns
    结论：需要High speed(50MHz, t_r~2ns)

    最大负载电容限制（以VeryHigh模式为例）：
    CL_max = t_r_allowed × I_DRV / ΔV
    若协议要求t_r ≤ 5ns：
    CL_max = 5 × 8 / 3.3 ≈ 12pF
    超过此值需要外部驱动器（如74LVC245）
```

> ⚠️ **陷阱**：GPIO速度选太高，驱动长PCB走线时，快速边沿（ns级上升时间）包含的高频分量（f ≈ 0.35/t_r，1ns边沿≈350MHz！）会引起EMI辐射和信号过冲。只选够用速度是硬件设计黄金法则——如果你只是控制一个LED，选Low Speed就够了。选太高的速度只会增加EMI和功耗，还可能因为信号过冲导致系统不稳定。只有当你驱动高速数字接口（如SPI Flash、SD卡）时，才需要用到High或Very High速度。

### ESD保护结构

每个GPIO引脚内部都有ESD（静电放电）保护电路，核心是两个钳位二极管：

```
    GPIO引脚内部ESD保护结构：

          VDD (3.3V)
           |
          -+-
          / \  正向钳位二极管
         /   \ (引脚电压>VDD+0.3V时导通)
          \ /
          -+-
           |
    +------+------ GPIO引脚(PAD)
           |
          -+-
          / \  负向钳位二极管
         /   \ (引脚电压<-0.3V时导通)
          \ /
          -+-
           |
          VSS (GND)

    正常工作范围：VSS - 0.3V < V_GPIO < VDD + 0.3V
```

**钳位二极管的工作原理：**

- 正常工作时（0V < V_GPIO < 3.3V）：两个二极管均截止，保护电路不影响信号
- 正向过压时（V_GPIO > VDD + 0.3V ≈ 3.6V）：上方二极管导通，将电流引导到VDD
- 负向过压时（V_GPIO < -0.3V）：下方二极管导通，将电流引导到VSS

> ⚠️ **陷阱**：钳位二极管只能承受**几mA的持续电流**！它设计用于吸收静电放电的瞬间能量（纳秒级），而不是持续过载。如果5V信号通过10kΩ串联电阻接到3.3V GPIO，二极管导通电流 = (5V - 3.6V) / 10kΩ = 0.14mA，在可承受范围内。但如果直接连接（无串联电阻），二极管电流可能 > 10mA，持续功耗导致二极管烧毁，进而损坏GPIO内部CMOS电路。

**5V容忍引脚（5V-Tolerant, FT）：**

STM32系列中，部分引脚标为**FT（5V-Tolerant）**，其内部ESD结构没有连接到VDD的钳位二极管：

```
    5V-Tolerant引脚内部结构（简化）：

    普通GPIO：            5V-Tolerant GPIO：
          VDD                (无VDD二极管)
           |                    |
          -+-                  开路
          \ /  有VDD二极管
           |                    |
    +------+------          +---+--- FT引脚
           |                    |
          -+-                  -+-
          \ /  有VSS二极管     \ /  仅有VSS二极管
           |                    |
          VSS                  VSS

    FT引脚可以承受最高5.5V的输入电压（只要配置为输入模式）。
    注意：FT只限输入！输出时仍然是3.3V电平（因为PMOS连接的是VDD=3.3V）。
```

> 🔴 **危险**：不要假设所有GPIO引脚都是5V容忍！STM32F407中，大部分GPIO是FT的，但**PA0（复位后用于BOOT0）、PA13/PA14（SWD调试接口）等可能不是**。接5V信号前务必查阅数据手册的引脚定义表，确认目标引脚是否有"FT"标记。如果引脚标为"TC"（3.3V容忍），接5V必烧！

### 不同VDD下的电平兼容性

嵌入式系统中经常需要3.3V MCU与不同电压的外部设备通信。理解电平兼容性可以避免昂贵的返工。

**电平兼容性矩阵（3.3V GPIO ↔ 外部设备）：**

| 外部设备电压 | 3.3V GPIO输入 | 3.3V GPIO输出 | 兼容性 | 解决方案 |
|------------|-------------|-------------|--------|---------|
| 5V TTL | V_IH_TTL=2.0V < 3.3V → ✅ | V_OH=3.3V > 2.4V → ✅ | **完全兼容** | 可直接连接 |
| 5V CMOS | V_IH_CMOS=3.5V > 3.3V → ❌ | V_OH=3.3V > 3.5V? → ❌ | **不兼容** | 5V容忍GPIO或电平转换器 |
| 3.3V CMOS | V_IH=2.31V < 3.3V → ✅ | V_OH=3.3V > 2.31V → ✅ | **完全兼容** | 可直接连接 |
| 2.5V CMOS | V_IH=1.75V < 3.3V → ✅ | V_OH=3.3V > 2.5V → ⚠️ | **单向兼容** | 3.3V输出可能过压损坏2.5V设备 |
| 1.8V CMOS | V_IH=1.26V < 3.3V → ✅ | V_OH=3.3V > 1.8V → ❌ | **不兼容** | 需要电平转换器 |
| 1.8V CMOS输入 | 1.8V设备读3.3V | - | 可能损坏 | 分压电阻或专用转换芯片 |

> 💡 **提示**：5V TTL设备（如老旧的74LS系列逻辑门）与3.3V CMOS GPIO**可以直接连接**——TTL的输出高电平最低只要2.4V，3.3V GPIO完全可以识别；TTL的输入高电平阈值只有2.0V，3.3V GPIO输出的3.3V高电平也远超此值。但5V CMOS设备（如74HC系列）的高电平阈值是0.7×5V=3.5V，3.3V输出无法满足，必须使用电平转换器或5V容忍GPIO加上拉电阻。

**3.3V → 1.8V 电平转换的分压方案：**

```
    低成本方案：电阻分压

    GPIO 3.3V输出 ---[R1=10kΩ]---+--- 1.8V设备输入
                                  |
                                [R2=12kΩ]
                                  |
                                 GND

    V_out = V_GPIO × R2 / (R1 + R2)
          = 3.3V × 12k / (10k + 12k)
          = 3.3 × 12 / 22
          ≈ 1.8V ✓

    注意事项：
    1. 分压电阻会限制信号速度（RC延迟），不适合>1MHz信号
    2. 需要确保1.8V设备的输入阻抗远大于R2（通常满足）
    3. 双向通信需要更复杂的方案（如专用电平转换芯片TXB0108）
```

### 复用功能与模拟模式

**复用功能（Alternate Function）**

GPIO引脚通常是"多任务"的——除了作为通用输入输出，还可以复用为UART的TX/RX、SPI的MOSI/MISO、I2C的SDA/SCL、TIM的PWM输出等。当引脚配置为复用功能模式时，GPIO模块将引脚的控制权交给对应的外设模块，CPU不再通过GPIO的数据寄存器直接控制引脚。

每个GPIO引脚可能有多个复用功能（AF0, AF1, AF2...），具体映射需要查阅芯片数据手册。例如STM32F4系列中，PA9可以复用为USART1_TX（AF7）或TIM1_CH2（AF1）等。

**模拟模式（Analog Mode）**

模拟模式下，GPIO的数字输入输出电路被完全断开（包括Schmitt触发器），引脚直接连接到芯片内部的ADC（模数转换器）或DAC（数模转换器）。此时引脚不能进行任何数字操作，只能用于模拟信号的采集或输出。

配置为模拟模式时，**必须关闭数字输入缓冲器**——如果数字输入缓冲器还开着，当模拟信号处于中间电平（如1.65V）时，Schmitt触发器的上下两个晶体管可能同时微导通，造成额外的功耗甚至芯片损坏。

> 💡 **提示**：在STM32中，将引脚配置为模拟模式的正确步骤：
> 1. MODER寄存器设为11b（模拟模式）
> 2. PUPDR寄存器设为00b（禁止上下拉）
> 3. OTYPER/OSPEEDR在该模式下无效
> 这样Schmitt触发器被关闭，ADC可以直接采样引脚电压。

### GPIO模式总结

| 模式 | 说明 | 使用场景 | 注意事项 |
|------|------|----------|----------|
| 浮空输入 | 无上下拉，Schmitt输入直连 | 外部有明确驱动源 | 避免使用，除非外部有稳定驱动 |
| 上拉输入 | 内部40kΩ电阻拉到VDD | 按钮（低电平有效）、开关 | 确认上拉电阻与外部阻抗匹配 |
| 下拉输入 | 内部40kΩ电阻拉到GND | 传感器（高电平有效） | 同上，注意功耗(82μA/引脚) |
| 推挽输出 | PMOS+NMOS主动驱动高低电平 | LED、蜂鸣器、继电器 | 注意驱动电流不超过8mA/引脚 |
| 开漏输出 | 仅NMOS，需外部上拉 | I2C总线、电平转换、继电器 | 必须接外部上拉电阻 |
| 复用功能 | 引脚交给外设控制 | UART/SPI/I2C/PWM | 查阅数据手册确认AF映射 |
| 模拟模式 | 连接ADC/DAC，断开数字电路 | 模拟信号采集/输出 | 关闭Schmitt触发器，减少功耗 |

### GPIO模式选择决策树

```
                    你需要用GPIO做什么？
                           |
           +---------------+---------------+
           |                               |
        读取信号                        输出信号
           |                               |
    +------+------+              +---------+---------+
    |             |              |                   |
  数字信号     模拟信号        驱动LED等          驱动继电器/I2C
    |             |              |                   |
  外部有        连接ADC       需要高电平        需要线与/电平转换
  稳定驱动?       |           主动驱动?              |
    |          模拟模式          |              开漏输出
  是/否          |           是/否                   |
    |             |              |                   |
  浮空输入    (关闭Schmitt)  推挽输出         外部上拉必须！
    |                            |
  外部是                        |
  高/低有效?                    |
    |                            |
  高->下拉输入                  |
  低->上拉输入                  |
```

---

## <span class="blue"> GPIO中断机制 [B]
GPIO不仅能轮询读取状态，还支持中断触发——当引脚电平发生变化时，自动跳转到中断服务程序执行。中断方式相比轮询，CPU占用率更低，响应也更及时。

### 中断触发方式

GPIO中断可以配置为以下几种触发方式：

| 触发方式 | 说明 | 适用场景 | 防抖建议 |
|----------|------|----------|----------|
| 上升沿触发 | 低电平→高电平跳变时触发 | 脉冲检测、事件启动 | 必须配合硬件/软件防抖 |
| 下降沿触发 | 高电平→低电平跳变时触发 | 按钮释放检测、故障告警 | 同上 |
| 双边沿触发 | 上升沿和下降沿都触发 | 电平变化监测、状态翻转 | 抖动期可能触发两次 |
| 高电平触发 | 引脚持续为高时触发 | 紧急停止信号、过压告警 | 必须确保信号源稳定 |
| 低电平触发 | 引脚持续为低时触发 | 复位信号、电源异常检测 | 同上 |

对于按钮这类机械开关，**推荐使用下降沿触发**（假设按钮接法为上拉输入、按下时为低电平）。因为按钮按下时机械触点的抖动会产生多个上升沿和下降沿，双边沿触发会导致一次按键触发多次中断。

### EXTI外部中断线

在ARM Cortex-M系列MCU中，外部中断通过**EXTI（External Interrupt/Event Controller）**模块管理。每个GPIO引脚都可以映射到一条EXTI线上（EXTI0~EXTI15对应GPIOx0~GPIOx15）。需要注意的是，**相同编号的引脚共享一条EXTI线**——比如PA0、PB0、PC0不能同时作为外部中断源，同一时间只能选择一个。

```
    PA0 ----+----> EXTI0 ----+
    PB0 ----+                 |
    PC0 ----+                 +----> NVIC ----> CPU中断处理
    ...                       |       (中断控制器)
    PAn ----+----> EXTI_n ---+
```

EXTI线的映射通过**SYSCFG**模块配置。在Linux设备树中，这通常通过`interrupts`和`interrupt-parent`属性来描述。

### 中断回调函数编写

在用户空间使用libgpiod处理中断时，代码结构如下：

```c
#include <gpiod.h>
#include <stdio.h>
#include <unistd.h>

// 中断回调处理函数
void button_event_callback(struct gpiod_line *line)
{
    struct gpiod_line_event event;

    // 读取事件详情
    if (gpiod_line_event_read(line, &event) == 0) {
        if (event.event_type == GPIOD_LINE_EVENT_FALLING_EDGE) {
            printf("按钮被按下！时间戳: %llu\n", event.ts.tv_sec);
            // 在这里执行按钮按下后的操作
        } else if (event.event_type == GPIOD_LINE_EVENT_RISING_EDGE) {
            printf("按钮被释放！\n");
        }
    }
}

int main()
{
    struct gpiod_chip *chip;
    struct gpiod_line *button_line;
    struct pollfd pfd;
    int ret;

    // 打开GPIO控制器
    chip = gpiod_chip_open("/dev/gpiochip0");
    button_line = gpiod_chip_get_line(chip, BUTTON_GPIO);

    // 请求中断（下降沿触发）
    ret = gpiod_line_request_falling_edge_events(button_line, 
                                                  "button-handler");

    // 获取文件描述符用于poll
    pfd.fd = gpiod_line_event_get_fd(button_line);
    pfd.events = POLLIN;

    while (1) {
        ret = poll(&pfd, 1, -1);  // 等待中断事件
        if (ret > 0 && (pfd.revents & POLLIN)) {
            button_event_callback(button_line);
        }
    }

    gpiod_chip_close(chip);
    return 0;
}
```

### 防抖处理：硬件vs软件

机械按钮在按下和释放时，触点会因为弹性而产生多次快速的通断——这就是"按键抖动"（Bounce）。抖动持续时间通常为5~20ms，如果不处理，一次按键会被识别为多次触发。

**硬件防抖：RC滤波电路**

最可靠的防抖方式是在硬件层面解决。在按钮两端并联一个RC低通滤波电路：

```
    VDD
     |
    [R1]  上拉电阻 (10kΩ)
     |
    +----+---- GPIO引脚
    |    |
   ===  [C]  电容 (100nF)
    |    |
   GND  GND
    按钮
```

RC电路的时间常数 τ = R × C，选择适当的值使得 τ > 20ms（比如 10kΩ × 100nF = 1ms，对于一般按钮已经足够，如果是特别差的机械开关可以用47kΩ × 10μF ≈ 47ms）。电容在按钮按下时通过按钮快速放电，按钮释放时通过上拉电阻缓慢充电，平滑了抖动期间的电压跳变。

**软件防抖：延时检测**

硬件防抖需要额外的元件，在成本敏感或空间受限的场景，可以用软件实现：

```c
/* 软件防抖：检测到边沿后，延时10ms再次确认 */
void debounced_button_handler(struct gpiod_line *line)
{
    struct gpiod_line_event event;
    struct timespec ts = {0, 10 * 1000 * 1000}; // 10ms
    int current_value;

    if (gpiod_line_event_read(line, &event) < 0)
        return;

    if (event.event_type == GPIOD_LINE_EVENT_FALLING_EDGE) {
        // 延时10ms后再次检测电平
        nanosleep(&ts, NULL);
        current_value = gpiod_line_get_value(line);

        // 如果延时后仍然是低电平，说明确实是按钮按下
        if (current_value == 0) {
            printf("有效按键！执行操作...\n");
            // 执行按键对应的操作
        }
        // 否则只是噪声，忽略
    }
}
```

> 💡 **提示**：工业场景务必用**硬件防抖（RC电路）+ 软件防抖（10ms延时）双保险**。单独的软件防抖在强电磁干扰环境下可能失效，而硬件防抖可以有效滤除大部分噪声。双保险策略下，即使软件因为任务调度延迟未及时防抖，硬件层面的RC滤波已经帮你挡掉了一大部分抖动。

---

## <span class="blue"> 行业实例：工业按钮输入 + LED输出 + 继电器控制 [B]

### 场景描述

这是一个典型的工业控制面板场景：3个按钮分别控制3个LED的亮灭状态，同时第3个按钮还控制一个继电器（用于大功率设备如电机或加热器的通断）。按钮使用GPIO上拉输入，LED使用GPIO推挽输出，继电器使用GPIO开漏输出。

### 接线方案

```
    +-----------------+          +------------------+
    |   工业控制面板   |          |    被控设备       |
    |                 |          |                  |
    |  [BTN1]------PA0|--------->|LED1 (绿色状态灯)  |
    |  [BTN2]------PA1|--------->|LED2 (黄色告警灯)  |
    |  [BTN3]------PA2|--------->|LED3 (红色运行灯)  |
    |                 |          |                  |
    |  PA3 ----------+--------->|继电器线圈         |
    |  (开漏输出)      |         |  - 常开触点       |
    |  外部上拉到5V   |         |  - 控制220V设备    |
    |                 |          |                  |
    +-----------------+          +------------------+
```

**按钮接线**：每个按钮一端接GPIO引脚，另一端接GND。GPIO配置为上拉输入，按下时读到低电平。

**LED接线**：LED阳极通过限流电阻（330Ω）接GPIO引脚，阴极接GND。GPIO配置为推挽输出，输出高电平时LED点亮。

**继电器接线**：继电器线圈一端接外部5V电源，另一端接GPIO引脚（开漏输出）。GPIO输出低电平时线圈通电，继电器吸合；GPIO输出高阻态时线圈断电，继电器释放。继电器线圈两端并联续流二极管（1N4007），防止线圈断电时的反向感应电压击穿GPIO。

### 完整设备树配置

```dts
/ {
    // gpio-keys: 3个按钮输入
    gpio_keys: gpio-keys {
        compatible = "gpio-keys";
        #address-cells = <1>;
        #size-cells = <0>;
        autorepeat;

        button_start: button@0 {
            label = "Start Button";
            gpios = <&gpioa 0 GPIO_ACTIVE_LOW>;
            linux,code = <KEY_F1>;
            debounce-interval = <20>;      // 20ms软件防抖
            wakeup-source;
        };

        button_stop: button@1 {
            label = "Stop Button";
            gpios = <&gpioa 1 GPIO_ACTIVE_LOW>;
            linux,code = <KEY_F2>;
            debounce-interval = <20>;
            wakeup-source;
        };

        button_reset: button@2 {
            label = "Reset Button";
            gpios = <&gpioa 2 GPIO_ACTIVE_LOW>;
            linux,code = <KEY_F3>;
            debounce-interval = <20>;
            wakeup-source;
        };
    };

    // gpio-leds: 3个LED输出
    gpio_leds: gpio-leds {
        compatible = "gpio-leds";

        led_status: led@0 {
            label = "status:green";
            gpios = <&gpioa 4 GPIO_ACTIVE_HIGH>;
            default-state = "on";
            linux,default-trigger = "heartbeat";  // 心跳灯
        };

        led_warning: led@1 {
            label = "warning:yellow";
            gpios = <&gpioa 5 GPIO_ACTIVE_HIGH>;
            default-state = "off";
        };

        led_running: led@2 {
            label = "running:red";
            gpios = <&gpioa 6 GPIO_ACTIVE_HIGH>;
            default-state = "off";
            linux,default-trigger = "none";
        };
    };

    // 继电器输出 (通过sysfs/gpio控制)
    relay_control: relay-control {
        compatible = "gpio-relay";
        gpios = <&gpioa 3 GPIO_ACTIVE_LOW>;
        default-state = "off";
    };
};
```

### libgpiod读写代码

```c
/* gpio_industrial_control.c - 工业GPIO控制示例 */
#include <gpiod.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <poll.h>
#include <string.h>

#define CHIP_PATH       "/dev/gpiochip0"
#define GPIO_BTN_START  0
#define GPIO_BTN_STOP   1
#define GPIO_BTN_RESET  2
#define GPIO_RELAY      3
#define GPIO_LED_STATUS 4
#define GPIO_LED_WARN   5
#define GPIO_LED_RUN    6

struct gpiod_chip *chip;
struct gpiod_line *btn_lines[3];
struct gpiod_line *led_lines[3];
struct gpiod_line *relay_line;

/* 初始化所有GPIO */
int gpio_init(void)
{
    chip = gpiod_chip_open(CHIP_PATH);
    if (!chip) {
        perror("打开GPIO控制器失败");
        return -1;
    }

    // 获取按钮引脚，配置为上拉输入
    btn_lines[0] = gpiod_chip_get_line(chip, GPIO_BTN_START);
    btn_lines[1] = gpiod_chip_get_line(chip, GPIO_BTN_STOP);
    btn_lines[2] = gpiod_chip_get_line(chip, GPIO_BTN_RESET);

    for (int i = 0; i < 3; i++) {
        gpiod_line_request_input(btn_lines[i], "industrial-ctrl");
        gpiod_line_set_config(btn_lines[i], GPIOD_LINE_REQUEST_DIRECTION_INPUT,
                              GPIOD_LINE_REQUEST_FLAG_BIAS_PULL_UP, 1);
    }

    // 获取LED引脚，配置为推挽输出
    led_lines[0] = gpiod_chip_get_line(chip, GPIO_LED_STATUS);
    led_lines[1] = gpiod_chip_get_line(chip, GPIO_LED_WARN);
    led_lines[2] = gpiod_chip_get_line(chip, GPIO_LED_RUN);

    for (int i = 0; i < 3; i++) {
        gpiod_line_request_output(led_lines[i], "industrial-ctrl", 0);
    }

    // 获取继电器引脚，配置为开漏输出
    relay_line = gpiod_chip_get_line(chip, GPIO_RELAY);
    gpiod_line_request_output(relay_line, "industrial-ctrl", 0);
    // 开漏输出：0=继电器吸合（线圈通电），1=继电器释放

    printf("GPIO初始化完成\n");
    return 0;
}

/* LED控制函数 */
void led_set(int led_index, int state)
{
    if (led_index >= 0 && led_index < 3) {
        gpiod_line_set_value(led_lines[led_index], state);
        printf("LED%d 设置为 %s\n", led_index, state ? "ON" : "OFF");
    }
}

/* 继电器控制函数 */
void relay_set(int state)
{
    // 开漏输出，低电平有效：0=吸合(ON)，1=释放(OFF)
    gpiod_line_set_value(relay_line, state ? 0 : 1);
    printf("继电器 %s\n", state ? "吸合(ON)" : "释放(OFF)");
}

/* 读取按钮状态（带软件防抖） */
int button_read_debounced(struct gpiod_line *line)
{
    int val1 = gpiod_line_get_value(line);
    usleep(10000);              // 10ms防抖延时
    int val2 = gpiod_line_get_value(line);

    // 两次读取一致才确认
    return (val1 == val2) ? val1 : -1;
}

/* 主循环：轮询检测按钮 */
void main_loop_poll(void)
{
    int prev_state[3] = {1, 1, 1};  // 上拉输入，默认高电平
    int curr_state;

    printf("\n=== 轮询模式运行中 ===\n");
    printf("按Ctrl+C退出\n\n");

    while (1) {
        for (int i = 0; i < 3; i++) {
            curr_state = button_read_debounced(btn_lines[i]);
            if (curr_state < 0) continue;  // 抖动，忽略

            // 检测到下降沿（按下）
            if (prev_state[i] == 1 && curr_state == 0) {
                printf("按钮%d 被按下\n", i + 1);

                switch (i) {
                case 0:  // Start按钮 -> 点亮运行LED，吸合继电器
                    led_set(2, 1);
                    relay_set(1);
                    break;
                case 1:  // Stop按钮 -> 熄灭运行LED，释放继电器
                    led_set(2, 0);
                    relay_set(0);
                    break;
                case 2:  // Reset按钮 -> 告警LED闪烁3次
                    for (int j = 0; j < 3; j++) {
                        led_set(1, 1);
                        usleep(200000);
                        led_set(1, 0);
                        usleep(200000);
                    }
                    break;
                }
            }
            prev_state[i] = curr_state;
        }
        usleep(5000);  // 5ms轮询间隔
    }
}

/* 中断模式处理 */
void main_loop_interrupt(void)
{
    struct pollfd pfds[3];

    // 为每个按钮请求下降沿中断
    for (int i = 0; i < 3; i++) {
        gpiod_line_request_falling_edge_events(btn_lines[i], "btn-irq");
        pfds[i].fd = gpiod_line_event_get_fd(btn_lines[i]);
        pfds[i].events = POLLIN;
    }

    printf("\n=== 中断模式运行中 ===\n");

    while (1) {
        int ret = poll(pfds, 3, -1);
        if (ret < 0) continue;

        for (int i = 0; i < 3; i++) {
            if (pfds[i].revents & POLLIN) {
                struct gpiod_line_event event;
                gpiod_line_event_read(btn_lines[i], &event);

                // 10ms软件防抖确认
                usleep(10000);
                if (gpiod_line_get_value(btn_lines[i]) == 0) {
                    printf("按钮%d 中断触发（已防抖确认）\n", i + 1);
                    // 执行对应操作...
                    led_set(i, !gpiod_line_get_value(led_lines[i]));
                }
                // 重新消费事件
                gpiod_line_event_read_fd(pfds[i].fd, &event);
            }
        }
    }
}

int main(int argc, char *argv[])
{
    if (gpio_init() < 0)
        return -1;

    // 默认使用中断模式，传入-poll参数使用轮询模式
    if (argc > 1 && strcmp(argv[1], "-poll") == 0)
        main_loop_poll();
    else
        main_loop_interrupt();

    // 清理
    gpiod_chip_close(chip);
    return 0;
}
```

### 编译与运行

```bash
# 交叉编译（假设目标为ARM平台）
$ arm-linux-gnueabihf-gcc gpio_industrial_control.c \
    -o gpio_industrial_control -lgpiod

# 或者直接编译（如果工具链已配置）
$ gcc gpio_industrial_control.c -o gpio_industrial_control -lgpiod

# 运行（需要root权限访问GPIO）
$ sudo ./gpio_industrial_control
=== 中断模式运行中 ===
按钮1 中断触发（已防抖确认）
LED0 设置为 ON
按钮2 中断触发（已防抖确认）
LED1 设置为 ON
按钮3 中断触发（已防抖确认）
LED2 设置为 OFF

# 轮询模式
$ sudo ./gpio_industrial_control -poll
```

### 验证步骤

| 步骤 | 操作 | 预期结果 | 备注 |
|------|------|----------|------|
| 1 | 编译代码并部署到目标板 | 编译无错误，可执行文件生成 | 确保libgpiod已安装 |
| 2 | 检查设备树节点是否加载 | `ls /sys/class/leds/` 看到status:green等 | 设备树配置正确才会显示 |
| 3 | 运行程序，按下按钮1 | 红色运行LED点亮，继电器吸合 | 用万用表测继电器触点通断 |
| 4 | 运行程序，按下按钮2 | 运行LED熄灭，继电器释放 | 确认继电器指示灯变化 |
| 5 | 快速连续按按钮3 | 黄色告警LED闪烁3次 | 测试防抖是否有效 |
| 6 | 用示波器观察按钮信号 | 有RC滤波的平滑下降沿 | 若无RC滤波会有明显抖动 |

> 💡 **提示**：验证时用示波器观察按钮信号是最直观的调试方式。如果按钮波形在按下时有明显毛刺（多个上升/下降沿），说明RC防抖不够或者根本没有硬件防抖。一个好的硬件防抖设计，按钮波形应该像"台阶"一样干净利落地下降。

---

## <span class="blue"> 本节总结

| 主题 | 核心要点 | 关键数字/参数 |
|------|----------|---------------|
| 输入模式 | 上拉/下拉/浮空三种输入模式 | 上拉电阻30~50kΩ，浮空输入容易受噪声干扰 |
| 输出模式 | 推挽输出驱动能力强，开漏输出支持线与 | 推挽可主动驱动高低电平，开漏必须外接上拉 |
| 复用功能 | 引脚控制权交给外设（UART/SPI等） | 同一引脚可能有多个AF编号，查数据手册确认 |
| 模拟模式 | 连接ADC/DAC，断开数字电路 | 必须关闭数字输入缓冲器，否则功耗异常 |
| GPIO速度 | 2/10/50/100MHz四个等级 | 够用就好，高速带来EMI和功耗问题 |
| 中断触发 | 上升沿/下降沿/双边沿/电平触发 | 按钮推荐下降沿触发，双边沿可能重复触发 |
| EXTI线 | GPIOx_n映射到EXTI_n，同编号共享 | PA0/PB0/PC0不能同时中断 |
| 硬件防抖 | RC滤波电路，τ = R×C > 20ms | 典型值：10kΩ + 100nF = 1ms（需根据按钮调整） |
| 软件防抖 | 检测到边沿后延时10ms再次确认 | 双保险策略：硬件+软件防抖 |
| 工业接线 | 按钮上拉输入、LED推挽输出、继电器开漏 | 继电器必须加续流二极管保护 |

### GPIO模式选择决策树

```
                    你需要用GPIO做什么？
                           |
           +---------------+---------------+
           |                               |
        读取信号                        输出信号
           |                               |
    +------+------+              +---------+---------+
    |             |              |                   |
  数字信号     模拟信号        驱动LED等          驱动继电器/I2C
    |             |              |                   |
  外部有        连接ADC       需要高电平        需要线与/电平转换
  稳定驱动?       |           主动驱动?              |
    |          模拟模式          |              开漏输出
  是/否          |           是/否                   |
    |             |              |                   |
  浮空输入    (关闭数字缓冲)  推挽输出         外部上拉必须！
    |                            |
  外部是                        |
  高/低有效?                    |
    |                            |
  高->下拉输入                  |
  低->上拉输入                  |
```

---

## <span class="blue"> 下一步

你已经掌握了GPIO的硬件结构、模式配置和中断处理。下一节「B-A.1.2 PWM脉宽调制」将学习如何用GPIO的复用功能输出PWM信号，实现LED调光、电机调速、舵机控制等模拟效果。PWM是GPIO从"数字开关"到"模拟控制"的桥梁，也是嵌入式系统中最常用的控制手段之一。

---

## <span class="blue"> 配套资源

**推荐阅读**

- STM32参考手册（RM0090）第8章：GPIO和AFIO — 最权威的GPIO寄存器级描述
- 《Linux设备驱动开发详解》第14章：GPIO驱动 — 深入理解内核GPIO子系统
- libgpiod官方文档：https://libgpiod.readthedocs.io/ — 用户空间GPIO编程的权威参考

**推荐工具**

- `gpioset`/`gpioget`/`gpiomon`：libgpiod自带的命令行工具，快速测试GPIO
- 示波器：调试按钮抖动和输出波形的不二之选
- 万用表：验证上拉/下拉电阻和电平状态

**思考题**

1. 为什么开漏输出不能直接输出高电平？如果不接上拉电阻会怎样？
2. 推挽输出模式下，如果两个GPIO引脚一个输出高、一个输出低，不小心短接在一起会发生什么？
3. 设计一个GPIO控制蜂鸣器的方案：蜂鸣器一端接GPIO，一端接VCC，应该选用什么输出模式？
4. 在电池供电的低功耗设备中，GPIO上下拉电阻的选择需要额外考虑什么因素？
