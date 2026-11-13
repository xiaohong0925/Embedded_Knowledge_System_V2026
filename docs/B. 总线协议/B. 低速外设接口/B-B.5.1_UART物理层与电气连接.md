# B-B.5.1 UART 物理层与电气连接

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 串口
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

UART（Universal Asynchronous Receiver Transmitter，通用异步收发器）让两个控制器用 TX、RX 和共同地交换串行数据。TX 是发送输出，RX 是接收输入，GND 是双方判断电压高低的共同参考。这里的“异步”表示没有一条由发送端持续提供给接收端的时钟线；数据怎样逐位排列、双方怎样约定接收速率，由 B-B.5.2 继续解释。

本节只回答一个问题：**NEO-6M 与 RK3568 UART4 为什么能够通过 TX／RX／GND 交换数据，软件人员怎样判断这条链路在电气上是否连接正确，以及什么时候必须增加收发器？**

全文沿一笔单向接收展开：NEO-6M 的 TxD1 向 RK3568 的 UART4_RX_M0 输出 NMEA 数据。NEO-6M 是 u-blox 的 GNSS（Global Navigation Satellite System，全球导航卫星系统）接收模块，NMEA 0183 是导航设备常用的一种文本数据格式。当前只关心信号能否安全、正确地到达接收引脚，不解析文本内容。

> 本节覆盖：实际器件与责任边界、交叉接线和共地、UART 与 TTL 电平的区别、供电与输入输出（IO）耐压、pinctrl 能改变和不能改变的事项、USB（Universal Serial Bus，通用串行总线）转串口的位置、RS-232／RS-485 为什么需要收发器，以及怎样用文档和仪器核对物理链路。

> 🔴 本文给出的是 **RK3568 与 NEO-6M 模块本体的功能级连接和手册推演**，不是某块第三方 GPS 扩展板或某块 RK3568 开发板的直接接线指南。实际动手前仍须取得双方板卡资料，确认连接器引脚、IO 电源域和模块供电。不要用本文的芯片焊球号去对应扩展板排针号。

## <span class="blue"> 先把一次接收落到 UART4 与 NEO-6M

本例包含两个真实硬件角色：

- **发送端**：u-blox NEO-6M 模块本体。数据手册把 20 脚定义为 TxD1 输出，21 脚定义为 RxD1 输入，23 脚定义为 VCC（主供电），24 脚定义为 GND；10、12、13 脚也是 GND。
- **接收端**：Rockchip RK3568 片上系统（SoC）中的 UART4 控制器。数据手册给出 UART4_M0 的接收功能位于 F18 焊球，复用名为 `UART4_RX_M0／GPIO1_A4_d`；发送功能位于 C20 焊球，复用名为 `UART4_TX_M0／GPIO1_A6_d`。这一组 IO 属于 VCCIO2 电源域。

这里出现三种容易混用的“引脚”：

1. NEO-6M 模块边缘的 20、21、23、24 脚；
2. RK3568 芯片的 F18、C20 BGA（Ball Grid Array，球栅阵列封装）焊球；
3. 第三方扩展板或开发板连接器上的排针号。

前两类可以由芯片和模块手册证明，第三类只能由实际板卡原理图证明。第三方 NEO-6M breakout 是把模块、电源和连接器集成在一起的小板，它可能增加稳压器、电平转换或其他器件；RK3568 开发板也可能没有把 UART4_M0 接到外部连接器。因此，**“NEO-6M 的 20 脚”不等于“GPS 小板排针的第 20 脚”，“F18 支持 UART4_RX_M0”也不等于“任意 RK3568 板卡都能从排针找到这个信号”。**

软件人员沿这条链路要分清三部分责任：

| 责任方 | 决定什么 | 本篇怎样使用这条边界 |
|---|---|---|
| 原理图、器件和接线 | 信号接到哪里、双方是否共地、电平是否兼容 | 本篇核对的重点 |
| UART 控制器与驱动 | 选择引脚复用、启用控制器并处理收发 | 只在 pinctrl 一节建立概念，细节归 B-B.5.3 |
| 用户程序 | 配置串口并读取、解释数据 | 归 B-B.5.3～B-B.5.5，本篇不提前展开 |

手册依据分别见 [NEO-6 Data Sheet](images/NEO-6_DataSheet_GPS.G6-HW-09005.pdf) 第 12～15 页和 [RK3568 Datasheet](images/RK3568_datasheet_V2.4.pdf) 第 34 页。Linux v6.6 的 `rk356x.dtsi` 还列出了 `uart4: serial@fe680000` 和默认的 `uart4m0_xfer`，但节点默认 `status = "disabled"`；这只能证明 SoC 控制器和默认复用组存在，不能证明某块板卡已经启用或引出它。

## <span class="blue"> 发送端的 TX 为什么必须接接收端的 RX

TX 和 RX 描述的是**各自设备的数据方向**。NEO-6M 的 TxD1 是模块输出，必须进入 RK3568 的接收输入 UART4_RX_M0。若把两端 TX 接在一起，两个输出都可能主动驱动线路，却没有一个引脚承担本例所需的接收输入。

下图先读中间实线：模块 20 脚 TxD1 到 RK3568 F18 的 UART4_RX_M0。再读虚线：只有需要向模块发送配置时，才增加 C20 的 UART4_TX_M0 到模块 21 脚 RxD1。最后读底部：双方 GND 必须形成共同参考，VCC 则是另一条独立的供电路径。图中编号来自模块和芯片手册，不是第三方小板排针号。

<div style="overflow-x:auto">
<svg viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg" style="max-width:800px;width:100%;min-width:720px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>NEO-6M 与 RK3568 UART4_M0 的功能级连接</title>
<text x="450" y="28" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">功能级连接：不是第三方 breakout 或开发板排针图</text>
<rect x="55" y="65" width="270" height="270" rx="8"/>
<text x="190" y="98" text-anchor="middle" fill="currentColor" stroke="none" font-size="17">NEO-6M 模块本体</text>
<text x="85" y="145" fill="currentColor" stroke="none">TxD1，20 脚，输出</text>
<text x="85" y="225" fill="currentColor" stroke="none">RxD1，21 脚，输入</text>
<text x="85" y="292" fill="currentColor" stroke="none">VCC，23 脚：2.7～3.6 V</text>
<text x="85" y="322" fill="currentColor" stroke="none">GND，24 脚</text>
<text x="585" y="98" text-anchor="middle" fill="currentColor" stroke="none" font-size="17">RK3568 UART4_M0</text>
<rect x="585" y="65" width="270" height="270" rx="8"/>
<text x="615" y="145" fill="currentColor" stroke="none">UART4_RX_M0，F18</text>
<text x="615" y="172" fill="currentColor" stroke="none">GPIO1_A4_d，VCCIO2</text>
<text x="615" y="225" fill="currentColor" stroke="none">UART4_TX_M0，C20</text>
<text x="615" y="252" fill="currentColor" stroke="none">GPIO1_A6_d，VCCIO2</text>
<text x="615" y="305" fill="currentColor" stroke="none">本例推演前提：VCCIO2＝3.3 V</text>
<line x1="325" y1="140" x2="570" y2="140"/>
<polygon points="585,140 570,134 570,146" fill="currentColor" stroke="none"/>
<text x="450" y="124" text-anchor="middle" fill="currentColor" stroke="none">本例正常接收路径</text>
<line x1="585" y1="220" x2="340" y2="220" stroke-dasharray="7,5"/>
<polygon points="325,220 340,214 340,226" fill="currentColor" stroke="none"/>
<text x="450" y="205" text-anchor="middle" fill="currentColor" stroke="none">需要配置模块时才增加</text>
<line x1="190" y1="335" x2="190" y2="390"/>
<line x1="720" y1="335" x2="720" y2="390"/>
<line x1="190" y1="390" x2="720" y2="390"/>
<line x1="435" y1="390" x2="475" y2="390"/>
<line x1="445" y1="390" x2="445" y2="410"/>
<line x1="465" y1="390" x2="465" y2="410"/>
<line x1="432" y1="410" x2="478" y2="410"/>
<line x1="438" y1="418" x2="472" y2="418"/>
<line x1="445" y1="426" x2="465" y2="426"/>
<text x="495" y="418" fill="currentColor" stroke="none">共同 GND</text>
<text x="190" y="465" text-anchor="middle" fill="currentColor" stroke="none">10、12、13 脚也为 GND</text>
<text x="650" y="465" text-anchor="middle" fill="currentColor" stroke="none">实际板级连接器仍须查原理图</text>
</svg>
</div>

本例只观察模块到 RK3568 一路，所以最少需要 TxD1、UART4_RX_M0 和共同 GND。是否连接 VCC 取决于实际模块板和供电设计，不能从“只有一路数据”推出“可以不给模块供电”，也不能从信号线取电。

> 全双工：发送与接收使用各自独立的数据路径，双方可以同时收发。UART4 的 TX／RX 分工支持这种形态。

<!-- -->

> 单工：数据只沿一个方向传输。本例暂时只观察 NEO-6M 到 RK3568 的方向，是在全双工接口上使用一条接收路径，不表示 UART 控制器失去了发送能力。

<!-- -->

> 半双工：双方共用一条通信通道，需要轮流决定谁发送。RS-485 收发器常涉及这种方向管理，不能与 UART 控制器具有 TX、RX 两个引脚混为一谈。

## <span class="blue"> UART 与 TTL 为什么不是同义词

UART 描述控制器怎样发送和接收串行数据，电平标准描述这些位在线路上怎样表现为电压。把两者分开，才能解释为什么同样标着“串口”的设备可能不能直接连接。

> TTL 电平：本文沿用“USB 转 TTL”这一工程叫法，指 UART 控制器一侧的单端逻辑电平。它不代表固定为 5 V，也不代替具体器件的输入门限和耐压说明。

一个有效连接必须分别回答三件事：

1. **发送端能输出什么**：高、低电平在最不利规定条件下分别保证达到什么范围；
2. **接收端能识别什么**：高于哪个电压才保证判为高，低于哪个电压才保证判为低；
3. **接收端能承受什么**：引脚长期允许施加的电压范围是多少，是否允许超过当前 IO 电源。

前两项决定逻辑是否兼容，第三项决定连接是否安全。一个电压可能足以被识别为高，却已经超出接收引脚允许范围；也可能没有损坏器件，却落在高低判决之间的不确定区。

NEO-6M 手册给出的数字 IO 条件与其 VCC 相关：低输入上限为 `0.2 × VCC`，高输入下限为 `0.7 × VCC`；在规定的 4 mA 条件下，低输出不高于 0.4 V，高输出不低于 `VCC - 0.4 V`。RK3568 在 3.3 V 通用输入输出（GPIO）模式下，低输入不高于 0.8 V，高输入不低于 2.0 V。

把本例收窄为一个明确条件：VCCIO2 实际供电为 3.3 V，NEO-6M 的 VCC 为 3.0 V，只检查 NEO-6M TxD1 到 RK3568 RX 的方向。下表中，`VOL` 和 `VOH` 分别表示输出低、高电平，`VIL` 和 `VIH` 分别表示输入低、高电平。

| 检查项 | 手册给出的边界 | 对本例的意义 |
|---|---|---|
| 低电平 | NEO-6M `VOL ≤ 0.4 V`；RK3568 `VIL ≤ 0.8 V` | 发送端保证的低电平落在接收端低电平识别范围内 |
| 高电平 | NEO-6M `VOH ≥ 2.6 V`；RK3568 `VIH ≥ 2.0 V` | 发送端保证的高电平达到接收端高电平识别要求 |
| 电源域 | 本例 VCCIO2＝3.3 V | 不能把同一结论直接搬到 VCCIO2＝1.8 V 的板级配置 |

这里的 `VIH ≥ 2.0 V` 表示输入高电平规格从 2.0 V 起，不是“高于 2.0 V 就一定超过耐压”。耐压必须另查绝对最大额定值和板级 IO 供电，不能用识别门限代替。

反向发送也要单独计算。RK3568 在 3.3 V 模式下的高输出保证值不低于 2.4 V；NEO-6M 在 VCC＝3.0 V 时，高输入要求不低于 2.1 V，手册上具备兼容依据。但若 NEO-6M 的 VCC 改为 3.6 V，其高输入要求变为不低于 2.52 V，RK3568 的 2.4 V 最低保证值就不足以覆盖整个条件范围。**接通一个方向，不能自动证明另一个方向也在全条件下兼容。**

以上是由 [NEO-6 Data Sheet](images/NEO-6_DataSheet_GPS.G6-HW-09005.pdf) 第 15 页和 [RK3568 Datasheet](images/RK3568_datasheet_V2.4.pdf) 第 56～57 页做出的静态手册推演，不是实测波形或信号完整性结论。

## <span class="blue"> 供电电压、IO 电平与共地为什么要分别检查

NEO-6M 模块本体的 VCC 工作范围是 2.7～3.6 V，典型值为 3.0 V；其 UART 输入输出电平参考 VCC。这个结论不能改写成“所有 NEO-6M 小板的 VCC 都只能接 3.3 V”，也不能改写成“支持 5 V 供电的小板，其 TX 一定是 5 V”。

> IO 电平：芯片输入输出引脚使用的电压条件。模块供电输入、稳压器输出和 UART 信号电平是三个相关但不同的检查对象。

第三方 breakout 可能加入 LDO。LDO（Low Dropout Regulator，低压差线性稳压器）把较高的输入电压降为器件所需电压，但它是否存在、输出多少、信号是否另经转换，都必须由该小板原理图证明。商品页面写“支持 3.3～5 V”时，还要追问这句话指供电、信号，还是仅仅指某个转接芯片的工作范围。

共地的作用是让双方用同一个参考判断电压。NEO-6M 的高输出 `VCC - 0.4 V` 是相对其 GND 而言，RK3568 的输入门限是相对其 GND 而言。缺少共同参考时，两个电压数值不再具有可直接比较的关系。

> 🔴 绝对最大额定值不是推荐工作点。NEO-6M 手册明确说明，超过额定值可能永久损伤器件，器件并不因此获得全面的过压或反接保护。不要为验证“5 V 是否也能工作”而故意过压，先停止接线并核对供电与 IO。

正常核对顺序应当是：

- 先查模块本体和 breakout 的供电路径，再决定 VCC 接什么；
- 再查 TX／RX 信号参考哪个电源域，再决定能否直连；
- 最后检查所有需要的 GND 是否相连，不能把共地误解为必须连接双方所有电源正极。

[LEA-6／NEO-6／MAX-6 Hardware Integration Manual](images/LEA-NEO-MAX-6_HIM_UBX-14054794.pdf) 第 8 页把 VCC、备用电源和 USB 供电分开说明，第 10 页又说明 UART 电平为 0 V 到 VCC，正体现了这种分别核对的必要性。

## <span class="blue"> 哪些问题能由 pinctrl 修，哪些只能改接线

pinctrl 是引脚复用配置：同一个 SoC 焊球可以承担多种内部功能，软件需要选择与原理图一致的功能组。RK3568 的 F18 同时可以复用为音频接口、通用 IO 或 UART4_RX_M0 等功能，配置为 UART4_RX_M0 后，它才承担本例的 UART 接收功能。

但 pinctrl 只处理 SoC 内部的功能选择，不能改变外部事实：

| 现象 | pinctrl 能否解决 | 原因 |
|---|---|---|
| F18 被配置成通用 IO 而不是 UART4_RX_M0 | 可以改为与原理图一致的复用 | 属于 SoC 内部功能选择 |
| 模块 TX 实际接到了另一个连接器 | 不能 | 外部信号没有进入当前接收引脚 |
| TX 与 TX 相连 | 不能 | 引脚方向和外接关系错误 |
| 双方没有共同 GND | 不能 | 电压参考缺失 |
| VCCIO2 为 1.8 V，却按 3.3 V 逻辑分析 | 不能靠复用名称解决 | 电源域和电气条件不同 |
| 需要 RS-232／RS-485，却直接连接 UART TTL | 不能 | 缺少对应电气收发器 |

所以，**设备树与驱动配置正确和外部链路连接正确必须分别取证**。后续 B-B.5.3 会解释设备树和驱动怎样启用这条路径，本篇不写一个假设适用于所有板卡的设备树源文件（DTS）片段。

## <span class="blue"> USB 转串口在链路中替换了什么

PC 的 USB 接口与 NEO-6M、RK3568 的 UART 引脚不是同一种电气接口。USB 转串口器件负责把 USB 主机侧的通信转换为某种串行接口，但真正能否接入目标设备，要看它输出的是哪一种电气形式。

| 转接器类型 | 输出侧出现什么 | 与本例 UART TTL 的关系 |
|---|---|---|
| USB 转 TTL UART | 单端逻辑 TX／RX 和 GND，具体电压由转接器决定 | 在 IO 电压兼容时可以连接 |
| USB 转 RS-232 | RS-232 线路及连接器 | 不能直接接 UART TTL，需要对应的 RS-232 收发器 |
| USB 转 RS-485 | 差分 A／B 等现场总线信号 | 不能直接接 UART TTL，需要 RS-485 收发器 |

换言之，USB 转 TTL UART 才直接提供本例所讨论的单端逻辑信号；USB 转 RS-232 和 USB 转 RS-485 分别落在另外两种电气接口上，必须经由对应收发器才能接入 UART 逻辑侧。

因此，“USB 转串口”只说明了 USB 一侧，未说明目标一侧。购买或接线时应继续确认输出电平、连接器定义和是否需要独立供电，而不是只看商品名中的“串口”。

第 1 章的 1.4.1 已介绍转串口芯片识别与驱动安装，1.4.2 已介绍首次终端连接。本篇只补充它在物理链路中的位置；`/dev/ttyUSBx` 怎样由 Linux 创建归 B-B.5.3，USB 枚举归 B-C.7。

## <span class="blue"> 同是 UART，为什么 RS-232 与 RS-485 都需要收发器

UART 控制器输出的是逻辑侧信号，RS-232 和 RS-485 则规定不同的线路电气形式。收发器是位于两类信号之间的转换电路，既完成电气转换，也保持数据方向上的对应关系。

### RS-232：电压与逻辑表示都发生变化

RS-232 使用单端线路和正负电压表示逻辑状态。以 Texas Instruments（TI）MAX3232 为例，UART 逻辑侧使用 DIN（驱动输入）和 ROUT（接收输出），RS-232 线路侧使用 DOUT（驱动输出）和 RIN（接收输入）。其驱动真值表显示 DIN 高对应 DOUT 低，DIN 低对应 DOUT 高，因此不能只看“都是高低变化”就省略转换。

也不要把所有 RS-232 输出都写成固定的 ±12 V。MAX3232 使用电荷泵产生正负电源。电荷泵是利用电容和开关变换、抬升或反转电压的电路。其手册在规定负载条件下给出的典型驱动输出约为 ±5.4 V；u-blox 手册则用 ±12 V 说明可通过电平转换实现 RS-232 接口。这些材料共同说明的是**电气标准和逻辑关系不同，具体幅度必须看收发器及其工作条件**。

依据见 [MAX3232 datasheet](images/MAX3232_TI.pdf) 第 10～11 页和 [NEO-6 Hardware Integration Manual](images/LEA-NEO-MAX-6_HIM_UBX-14054794.pdf) 第 10 页。

### RS-485：用差分线路传输，并增加方向管理

RS-485 收发器把逻辑侧 UART 信号转换成 A／B 两条线路上的差分信号。接收端根据两条线路之间的差值判决，而不是把某一条线的电压直接当作 UART TTL 输入。

以 MaxLinear SP3485 为例，它是一款半双工 RS-485 收发器，逻辑侧包含 RO（接收输出）、DI（驱动输入）、DE（驱动使能）和 `/RE`（接收使能，低有效），线路侧包含 A、B。DE 控制驱动器是否向总线输出，说明电气层还加入了“此刻谁可以发送”的管理。终端、偏置、多节点、共模和方向切换时序由 B-B.5.6 展开，本篇只确认为什么需要这颗收发器。依据见 [SP3485 datasheet](images/SP3485_MaxLinear.pdf) 的说明与引脚定义。

### 三层关系不能混写

```text
UART 控制器：决定串行数据怎样收发
逻辑侧 IO：用具体电源域的高、低电平表示数据
可选收发器：把逻辑侧信号转换成 RS-232、RS-485 等线路形式
```

USB 转串口器件则位于更前面，把 PC 的 USB 通信接到其中一种串行接口。它并不自动替代目标设备所需的电平兼容检查。

## <span class="blue"> 回到 UART4：怎样证明物理链路已经就绪

物理链路应按不破坏设备的顺序核对，每一步只回答自己能够回答的问题。

### 先由文档排除不能连接的条件

1. 取得目标板原理图，确认 UART4_M0 是否真正到达连接器，记录连接器编号和排针号。
2. 取得 GPS breakout 资料，区分 NEO-6M 模块引脚与小板排针，确认供电和 IO 路径。
3. 确认 VCCIO2 的实际电压，再按发送端输出和接收端门限核对本例方向。
4. 需要反向配置模块时，另算 RK3568 TX 到 NEO-6M RX 的兼容条件。
5. 若接口实际是 RS-232 或 RS-485，停止按 TTL 直连，改用对应收发链路。

文档没有回答的排针号和电压不能靠猜测补齐。当前没有取得目标板连接器和第三方 breakout 的原理图，因此本文不提供这两部分的确定性接线答案。

### 再由仪器确认实际状态

- **断电检查**：按原理图核对 TX→RX 与 GND，排除错口、错排针和漏地。导通检查只证明连接关系，不证明上电后的电平合法。
- **上电测供电**：用万用表核对模块供电和必要的 IO 电源域。测得 VCC 正确，不等于 TX 电平已经验证。
- **观察接收端信号**：模块输出数据时，在实际 RK3568 RX 测试点观察波形。逻辑分析仪可以确认数字活动并在配置正确时协助解码，示波器用于检查真实高低电平、过冲和边沿。
- **回到接收路径**：只有文档、供电和信号都指向同一个 UART4_RX_M0，才能把“模块在发送”与“信号进入预期接收引脚”连起来。

逻辑分析仪自己的门限能够解码，不等于接收端具有充分模拟裕量；示波器显示电压正常，也不等于 pinctrl 已选中 UART4。后续 B-B.5.2 解释帧和位宽，B-B.5.4 再把这些物理证据与驱动、用户态证据对齐。

## <span class="blue"> 证据来源与未验证项

本篇使用的手册事实来自：

- [NEO-6 Data Sheet，GPS.G6-HW-09005-E](images/NEO-6_DataSheet_GPS.G6-HW-09005.pdf)：UART 配置、模块引脚、供电和数字 IO 条件；
- [LEA-6／NEO-6／MAX-6 Hardware Integration Manual，UBX-14054794](images/LEA-NEO-MAX-6_HIM_UBX-14054794.pdf)：供电与 UART 接口说明；
- [RK3568 Datasheet Rev 2.4](images/RK3568_datasheet_V2.4.pdf)：UART4_M0 焊球、复用功能、电源域及 GPIO 电气条件；
- [TI MAX3232 datasheet，SLLS410O](images/MAX3232_TI.pdf)：UART 逻辑侧与 RS-232 线路侧、真值表及收发器作用；
- [MaxLinear SP3485 datasheet](images/SP3485_MaxLinear.pdf)：半双工 RS-485 收发器和方向控制引脚。

当前没有取得实际 RK3568 板卡连接器原理图和第三方 GPS breakout 资料，未在目标板运行，也未执行万用表、逻辑分析仪或示波器测量。文中的兼容结论限于明确给出的 VCCIO2＝3.3 V 和模块供电条件，不表示当前硬件已经验证。

## <span class="blue"> 本节总结

UART 只说明串行数据怎样收发，不能单独回答外部线路能否直接连接。沿 NEO-6M TxD1 到 RK3568 UART4_RX_M0 这条路径，必须先确认器件和连接器，再分别检查方向、共地、供电、IO 门限与耐压，最后才进入帧和软件配置。pinctrl 能选择 SoC 内部功能，却不能修复外部错接；RS-232、RS-485 和各种 USB 转串口器件也必须按实际电气形式核对，而不能仅凭“串口”名称判断。

## <span class="blue"> 本节自查

??? details "Q1. 为什么 NEO-6M 的 TxD1 要接 RK3568 的 UART4_RX_M0，而不是 UART4_TX_M0？"
    TxD1 是 NEO-6M 的输出，UART4_RX_M0 才是 RK3568 的接收输入。两个 TX 都是输出，连接后不能形成本例所需的一发一收路径；若两端同时主动驱动，还可能产生争用。

??? details "Q2. 一块 NEO-6M breakout 标明支持 5 V 供电，为什么不能据此判断它的 TX 可以接 5 V 容忍的 IO？"
    供电输入和 UART IO 是不同对象。breakout 可能通过 LDO 给模块降压，也可能对信号另作处理。必须查该小板原理图，确认 TX 实际由哪个器件输出、参考哪个电源域，不能由 VCC 支持范围推断信号电平。

??? details "Q3. 在 VCCIO2＝3.3 V、NEO-6M VCC＝3.0 V 的条件下，怎样用门限判断模块到 RK3568 的方向？"
    NEO-6M 低输出不高于 0.4 V，低于 RK3568 的 0.8 V 低输入上限；高输出不低于 `3.0 - 0.4 = 2.6 V`，高于 RK3568 的 2.0 V 高输入下限。这个推演只覆盖手册规定的静态条件和当前方向，不代替实板测量或反向兼容判断。

??? details "Q4. 为什么把 F18 配置成 UART4_RX_M0 后，仍不能保证用户程序收到 NMEA 数据？"
    pinctrl 只改变 SoC 内部功能选择。还要确认模块 TX 确实到达 F18 对应的板级连接点、双方共地、IO 电气兼容、模块正常供电，并在后续启用 UART 控制器和正确配置用户态读取路径。

??? details "Q5. USB 转 RS-232 为什么不能直接替代 USB 转 TTL 接 NEO-6M？"
    两者只在 USB 一侧相似，目标侧的电气形式不同。RS-232 使用不同的电压与逻辑表示，NEO-6M 的 UART IO 参考 VCC，直接连接不符合接口条件。应使用输出电平兼容的 USB 转 TTL，或在 UART 与 RS-232 之间加入合适的收发器。

??? details "Q6. 逻辑分析仪已经在 RX 上解码出数据，为什么还不能宣布整条链路验证完成？"
    解码说明分析仪在自己的门限和配置下识别了数字数据，不证明接收端 IO 的模拟裕量、pinctrl、控制器配置和用户态交付都正确。还需要按问题补充示波器、电源域、设备配置和后续软件路径证据。
