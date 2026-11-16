# B-B.5.6 RS-485 电气机制与 Linux 配置

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 串口
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

RS-485 规定平衡数字多点系统中驱动器与接收器的电气特性。它让多个节点共享一对差分线路，但**不规定 UART 帧、设备地址、命令或校验语义**。UART 控制器仍负责把字节变成串行位，RS-485 收发器再把逻辑侧信号转换成 A/B 总线上的电气信号。

半双工 RS-485 还增加了 UART TTL 连接中没有的问题：同一对线路既承载本节点发送，也承载其他节点发送，节点必须控制自己的驱动器何时接入总线。这个问题会一直延伸到 Linux：用户程序写了多少字节、UART 是否真正发完、驱动何时切换方向，是三个相关但不同的状态。

本节只回答一个问题：**UART 经过 RS-485 收发器后，为什么能够差分、多节点通信，半双工方向和 Linux RS-485 配置怎样影响一次正常传输？**

全文沿一笔受控原始字节传输展开。节点 A 是 RK3568 UART4 与外接半双工收发器，节点 B 是另一 RS-485 节点。A 发送 `55 00 FF 3C`，B 收到后返回 `C3 7E`。两组字节不同，便于区分对端响应与本节点自收；它们不构成 Modbus 或任何其他上层协议。

> 本节覆盖：UART 与收发器的责任线、差分与共模、多节点拓扑、终端与偏置、DE／RE 方向切换、发送完成边界、Linux v6.6 RS-485 用户空间应用编程接口（UAPI）与设备树属性、目标驱动支持检查，以及一笔可停止和恢复的传输验证。

> 🔴 当前没有取得目标板的收发器型号、原理图、设备树源文件（DTS）、实际板级支持包（BSP）驱动、对端节点资料或仪器记录。本文给出的是机制、源码核验和待执行的验证路径，不是某块板卡的直接接线指南，也不包含已经成功的目标传输。

## <span class="blue"> 同一组 UART 字节经过收发器后，谁负责哪一段

先把本例的最小全路写出来：

```text
节点 A 用户程序
→ TTY 与 serial core 接受发送字节
→ UART4 按约定帧格式输出串行位
→ 收发器 DI 接收逻辑侧输入
→ 驱动器在方向允许时驱动 A/B
→ 节点 B 收发器比较 A/B 差值
→ RO 输出逻辑侧电平
→ 节点 B 的 UART 恢复字节
→ 节点 B 用户程序取得 55 00 FF 3C
```

DI（Driver Input）是驱动器的逻辑输入，RO（Receiver Output）是接收器的逻辑输出。具体器件可能采用其他名称，但这两类方向不能互换：本机 UART TX 接收发器驱动输入，本机 UART RX 接收发器接收输出。

TTY 是 Linux 的终端设备子系统，serial core 是 UART 端口与 TTY 之间的串口核心层。它们负责字节的软件交付，不负责把单端逻辑信号直接变成差分电压。

这条路径的责任线如下：

- **UART 控制器与串口驱动**负责帧格式、速率、缓冲和收发状态。帧与采样机制已经在 B-B.5.2 讲解，普通 TTY 交付路径见 B-B.5.3。
- **RS-485 收发器**负责逻辑侧与差分总线侧之间的电气转换。DE 和 `/RE` 等方向输入由具体器件定义。
- **A/B 线路、其他节点和板级电路**共同决定负载、参考条件和模拟波形。设备树不能改变这些外部事实。
- **用户程序**负责保存和设置配置、处理短写与短读、核对受控响应并恢复原状态。它不应在不了解驱动能力时假设内核会自动控制方向。
- **节点 B 的上层行为**是独立实验条件。本篇只让它返回固定字节，不讨论它为什么返回、字节代表什么业务含义。

下图先读左侧节点 A 的 UART TX → DI 和 A/B → 节点 B 的接收器 → RO → UART RX，再读反方向的同一组角色。DE 与 `/RE` 用虚线表示它们是控制关系，不是另一路数据。图中不标物理引脚号、电阻或方向电平，因为这些只能由实际手册和原理图确定。

<div style="overflow-x:auto">
<svg viewBox="0 0 1200 560" xmlns="http://www.w3.org/2000/svg" style="max-width:1080px;width:100%;min-width:900px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>两个 RS-485 节点的功能级连接与责任线</title>
<defs><marker id="rs485-path-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="currentColor" stroke="none"/></marker></defs>
<text x="600" y="28" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">功能级连接：具体引脚、有效电平、终端和偏置仍须查实际资料</text>
<rect x="35" y="80" width="230" height="250" rx="8"/><text x="150" y="110" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">节点 A：UART 控制器</text>
<text x="70" y="160" fill="currentColor" stroke="none">TX：串行位输出</text><text x="70" y="230" fill="currentColor" stroke="none">RX：串行位输入</text><text x="70" y="295" fill="currentColor" stroke="none">方向状态由驱动／电路产生</text>
<rect x="365" y="60" width="250" height="290" rx="8"/><text x="490" y="90" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">节点 A：RS-485 收发器</text>
<text x="400" y="145" fill="currentColor" stroke="none">DI</text><text x="400" y="225" fill="currentColor" stroke="none">RO</text><text x="400" y="295" fill="currentColor" stroke="none">DE 与 /RE</text><text x="555" y="145" fill="currentColor" stroke="none">A/B</text>
<rect x="690" y="60" width="220" height="290" rx="8"/><text x="800" y="90" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">A/B 共享总线</text>
<text x="800" y="150" text-anchor="middle" fill="currentColor" stroke="none">一对差分线路</text><text x="800" y="220" text-anchor="middle" fill="currentColor" stroke="none">允许多个节点并接</text><text x="800" y="290" text-anchor="middle" fill="currentColor" stroke="none">同时只保留所需驱动者</text>
<rect x="965" y="80" width="200" height="250" rx="8"/><text x="1065" y="110" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">节点 B</text><text x="1065" y="155" text-anchor="middle" fill="currentColor" stroke="none">RS-485 收发器</text><text x="1065" y="220" text-anchor="middle" fill="currentColor" stroke="none">UART 控制器</text><text x="1065" y="290" text-anchor="middle" fill="currentColor" stroke="none">用户程序</text>
<line x1="265" y1="150" x2="350" y2="150" marker-end="url(#rs485-path-arrow)"/><text x="308" y="135" text-anchor="middle" fill="currentColor" stroke="none">TX → DI</text>
<line x1="350" y1="225" x2="265" y2="225" marker-end="url(#rs485-path-arrow)"/><text x="308" y="250" text-anchor="middle" fill="currentColor" stroke="none">RO → RX</text>
<line x1="265" y1="295" x2="350" y2="295" stroke-dasharray="6 4" marker-end="url(#rs485-path-arrow)"/>
<line x1="615" y1="150" x2="680" y2="150" marker-end="url(#rs485-path-arrow)"/><line x1="615" y1="185" x2="680" y2="185" marker-end="url(#rs485-path-arrow)"/>
<line x1="910" y1="150" x2="950" y2="150" marker-end="url(#rs485-path-arrow)"/><line x1="910" y1="185" x2="950" y2="185" marker-end="url(#rs485-path-arrow)"/>
<rect x="365" y="405" width="800" height="95" rx="7" stroke-dasharray="6 4"/><text x="765" y="442" text-anchor="middle" fill="currentColor" stroke="none">参考地／隔离、供电、终端、偏置和连接器属于板级设计</text><text x="765" y="476" text-anchor="middle" fill="currentColor" stroke="none">本图不代表这些条件已经由当前目标板验证</text>
</svg>
</div>

正常结果必须同时包含两个方向：B 实际取得四个请求字节，A 随后实际取得 `C3 7E`。只有本机 `write()` 返回 4，不能替代这两个观察。

## <span class="blue"> A/B 为什么用差值而不是单线对地电压判定

B-B.5.1 中的 UART TTL 链路把 TX 相对 GND 的电压直接交给 RX 判断。RS-485 收发器则使用 A、B 两个线路端子，接收器关注二者之差：

```text
Vdiff = VA - VB
```

> 差分信号：用两条线路之间的电压差表示信号状态，而不是只用其中一条线路相对地的电压。接收器的高低判决门限和逻辑对应必须查具体手册。

驱动器把 DI 的逻辑状态转换成 A/B 的规定差分状态，接收器再把满足判决条件的差值转换成 RO 电平。A 和 B 不是“发送线”和“接收线”，而是同一对双向电气路径上的两个端子；半双工时，多个节点的驱动器和接收器都连接在这对路径上。

下图用同一时间段说明差值与共模变化。先读 A、B 两条波形，再读二者同步上移的一段，最后读下方的 `Vdiff`。图中 `+Vth` 和 `-Vth` 只是接收门限的符号，不代表某个器件的固定电压值。

<div style="overflow-x:auto">
<svg viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg" style="max-width:900px;width:100%;min-width:760px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>RS-485 差分与共模变化的机制示意</title>
<text x="500" y="28" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">机制示意：不是目标板实测，也不含固定门限数值</text>
<text x="35" y="75" fill="currentColor" stroke="none">A</text>
<text x="35" y="175" fill="currentColor" stroke="none">B</text>
<path d="M80 120 H210 V65 H350 V120 H540 V60 H700 V120 H940"/>
<path d="M80 90 H210 V145 H350 V90 H540 V30 H700 V90 H940"/>
<rect x="540" y="42" width="160" height="140" stroke-dasharray="5 4"/>
<text x="620" y="202" text-anchor="middle" fill="currentColor" stroke="none">两条线路发生共同偏移</text>
<line x1="80" y1="245" x2="940" y2="245" stroke-dasharray="4 4"/>
<text x="35" y="300" fill="currentColor" stroke="none">Vdiff</text>
<path d="M80 280 H210 V230 H350 V280 H940"/>
<text x="760" y="220" fill="currentColor" stroke="none">共同偏移不直接改变差值</text>
<line x1="80" y1="360" x2="940" y2="360" stroke-dasharray="4 4"/>
<text x="45" y="350" fill="currentColor" stroke="none">+Vth</text>
<text x="45" y="390" fill="currentColor" stroke="none">-Vth</text>
<text x="500" y="455" text-anchor="middle" fill="currentColor" stroke="none">只有差值和共模都落在接收器规定条件内，才能据此推演可靠接收</text>
</svg>
</div>

如果两条线路相对各自参考点共同升高或降低，理想相减会消去这部分共同变化，这就是差分接收能够抑制共模影响的原因。它不等于“任意噪声都无效”：两条线路受到的变化可能并不相同，接收器也只在自己的共模范围和绝对额定条件内工作。

> 共模电压：两条线路共同具有的电压分量。常用 `(VA + VB) / 2` 表示其平均值；实际判读还要遵循收发器手册的定义、测试条件和允许范围。

因此，差分链路仍要处理参考地与节点间电位差。长距离或不同电源域的设备是否共地、是否使用隔离以及怎样限制共模条件，必须由板级和系统设计回答，不能从“使用差分”推出“可以不考虑参考条件”。

对软件而言，差值越过一个逻辑门限不会自动产生“RS-485 电气错误”错误码。接收端可能只是恢复出不同字节，或者因空闲状态异常形成伪造起始条件。最终仍需把实际字节、UART 状态和总线波形放在同一时间窗口中判断。

## <span class="blue"> 多节点共享后，拓扑、终端和偏置怎样影响字节交付

多个节点能够接到同一对 A/B 上，是因为未发送的驱动器可以停止主动驱动线路，让其他节点的驱动器使用总线。这是**电气上的多点连接能力**，不是自动寻址能力。哪个节点应该接收、何时回答以及回答什么，仍由上层协议或应用约定；Modbus 的地址和事务规则归 B-B.5.7。

### 一条主干为什么比随意星形分支更容易推演

推荐从一条 A/B 主干和受控的短支线理解多点连接。每个新增节点都带来接收器负载、连接电容和支线；分支过长或形成复杂反射路径时，发送端看到的不再只是一个理想集中负载。

软件人员需要把拓扑异常翻译成可观察后果：某些位置或速率下可能出现边沿变形、反射和采样错误，降低速率后现象也可能改变。但“降低速率后恢复”只是对照结果，不能单独证明某个固定长度的支线就是根因。

### 终端电阻处理线路末端，不是每个节点的默认装饰

终端是依据传输线特性和实际拓扑设置的端接网络。常见设计会在物理主干两端设置与线路特性匹配的终端，但具体阻值、位置和是否需要偏置／终端组合网络，都必须查板级原理图与器件资料。

如果中间节点也随意加入同样的终端，并联负载会增加；如果需要的末端终端缺失，反射条件会改变。两种异常都可能表现为模拟波形和接收错误变化，却不能只凭一次断电电阻读数还原整个网络，因为偏置、电阻、保护和测量路径也可能参与读数。

### 偏置与接收器失效保护不是同一个来源

当所有驱动器都不输出时，总线可能处于高阻共享状态。高阻表示驱动器不再用低阻抗路径主动把线路拉高或拉低，不等于线路具有确定的空闲电压。外部偏置网络可以在这种空闲区间建立设计规定的差分状态，避免很小的差分噪声被接收器解释为随机变化。

> 失效保护：收发器在某些异常或不确定输入条件下，让接收输出进入规定状态的能力。开路、短路和空闲总线是否分别被覆盖，必须逐项查手册，不能把其中一种保证扩展成所有情况。

一颗器件具有某种失效保护，不等于板上不需要任何偏置；反过来，旧设计中存在上拉／下拉，也不等于所有新器件都需要同样的外部网络。软件真正关心的是：没有节点发送时，RO 是否仍保持 UART 所需要的空闲状态，以及实际系统是否因此出现额外字节或帧错误。

## <span class="blue"> DE／RE 怎样让同一节点在接收与发送之间切换

半双工收发器至少要把“驱动器是否输出”和“接收器是否输出”分开控制。常见控制输入包括：

- DE（Driver Enable）：驱动器使能。有效时允许 DI 对应的差分状态驱动 A/B，无效时驱动输出按器件定义进入高阻或其他非驱动状态。
- `/RE`（Receiver Enable，低有效的常见写法）：接收器使能。名称前的斜杠或字母上的横线表示低有效，但其他器件可以使用不同命名和极性。
- 某些电路把 DE 与 `/RE` 连成一组互补控制，也有电路分别驱动，或由自动方向电路产生控制信号。是否短接只能由原理图证明。

沿本例的正常传输，方向过程应当是：

1. 节点 A 初始不驱动总线，并能够接收其他节点的数据。
2. 应用已经准备好完整请求后，A 的驱动或外部电路使能发送路径。
3. 收发器满足手册规定的使能条件后，UART 发出的位才经 DI 到达 A/B。
4. 请求的最后一位和停止位完成，A 才释放驱动器并回到接收所需状态。
5. 节点 B 只有在总线允许且自身准备完成后才返回 `C3 7E`，A 的接收路径必须已经能够接收它。

如果两个节点的驱动器同时输出不同状态，会产生总线争用。它不是普通 UART 点对点链路中的“双方各走各线”，可能改变波形并给器件带来额外应力。本篇不通过故意让多个节点争用来验证故障。

**自收是另一个需要单独拆开的条件。**如果本节点发送时接收器仍工作，并且收发器或外部连接把本机驱动内容送回 RO，本机 UART 就可能收到请求副本。是否发生取决于 `/RE`、收发器、接线和驱动接收路径，不能统一归因于“方向切换慢”。

## <span class="blue"> 为什么 `write()` 返回和 FIFO 已空都不能授权切换方向

方向切换需要一个明确的完成时刻，但软件路径中有多个“已经做完一部分”的状态。继续跟随本例的四个请求字节：

1. `write()` 把字节交给 TTY 和 serial core，返回值只表示本次接受的数量。B-B.5.3 已核对的 `uart_write()` 会把数据复制到 `uart_state->xmit` 环形缓冲区，并启动后续发送。
2. 8250 或其他 UART 驱动再从发送缓冲向硬件交付字节。TX 先进先出缓冲（FIFO）或发送保持寄存器可以接受数据，但其中为空并不必然表示移位寄存器已经输出完整帧。
3. THRE（Transmit Holding Register Empty）描述发送保持寄存器为空的硬件状态。TEMT（Transmitter Empty）用于表示发送器为空的另一类状态。二者名称相近，但不能把 FIFO／保持寄存器空直接当成最后停止位已经离开引脚。
4. 只有硬件规定的发送完成条件成立后，方向控制才允许进入释放阶段。对端是否收到、是否理解以及是否回答，又是更后面的独立事件。

`tcdrain(fd)` 是用户态等待已写输出完成传输的接口。Linux TTY 路径会先等待驱动缓冲中的字符排出，再经 `tty->ops->wait_until_sent` 进入 serial core 的 `uart_wait_until_sent()`，后者轮询端口的 `tx_empty()`。这说明它比一次 `write()` 返回更接近线路完成，但它仍不证明对端应用已经收到响应，也不能替不支持的驱动补上 RS-485 方向控制能力。

在启用内核 RS-485 方向管理的正常路径中，**驱动负责根据发送状态切换方向，`tcdrain()` 不是让用户程序随后手工翻转通用输入输出引脚（GPIO）的许可证**。手工 GPIO 方案还涉及系统调度、硬件状态和错误恢复，必须按实际设计单独论证，本篇不把它写成通用后备方案。

下图把正常路径与过早释放放在同一时间轴上。上方先看 `write()` 返回与真正发送不是同一点，再看正常路径把方向释放放在最后停止位之后；下方则表示提前释放可能侵入末字节。图中没有假设具体收发器延时或目标板实测数值。

<div style="overflow-x:auto">
<svg viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg" style="max-width:1000px;width:100%;min-width:850px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>RS-485 正常方向切换与过早释放对照</title>
<text x="550" y="28" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">同一请求：软件接受、控制器完成和总线响应是不同边界</text>
<text x="40" y="75" fill="currentColor" stroke="none">正常：软件</text>
<rect x="180" y="50" width="180" height="42" rx="5"/><text x="270" y="77" text-anchor="middle" fill="currentColor" stroke="none">write() 接受字节</text>
<line x1="360" y1="71" x2="850" y2="71" stroke-dasharray="5 4"/>
<text x="40" y="150" fill="currentColor" stroke="none">UART DI</text>
<path d="M180 155 H360 V120 H850 V155 H960"/>
<line x1="360" y1="105" x2="360" y2="200" stroke-dasharray="4 4"/><line x1="850" y1="105" x2="850" y2="200" stroke-dasharray="4 4"/>
<text x="605" y="190" text-anchor="middle" fill="currentColor" stroke="none">四个 UART 帧，含各自停止位</text>
<text x="40" y="245" fill="currentColor" stroke="none">DE</text>
<path d="M180 270 H330 V220 H900 V270 H960"/>
<line x1="900" y1="205" x2="900" y2="300" stroke-dasharray="4 4"/>
<text x="900" y="320" text-anchor="middle" fill="currentColor" stroke="none">最后停止位离开后释放</text>
<text x="40" y="375" fill="currentColor" stroke="none">A/B</text>
<path d="M180 380 H360 V350 H850 V380 H960"/>
<polygon points="960,380 948,374 948,386" fill="currentColor" stroke="none"/>
<text x="965" y="385" fill="currentColor" stroke="none">对端随后响应</text>
<line x1="40" y1="430" x2="1040" y2="430" stroke-dasharray="6 5"/>
<text x="40" y="480" fill="currentColor" stroke="none">异常：DE</text>
<path d="M180 515 H330 V465 H700 V515 H960"/>
<line x1="700" y1="445" x2="700" y2="565" stroke-dasharray="4 4"/>
<text x="700" y="585" text-anchor="middle" fill="currentColor" stroke="none">过早释放进入末字节窗口</text>
<text x="40" y="530" fill="currentColor" stroke="none">UART DI</text>
<path d="M180 535 H360 V500 H850 V535 H960"/>
<path d="M700 480 H850" stroke-dasharray="3 3"/>
<text x="850" y="625" text-anchor="middle" fill="currentColor" stroke="none">实际是否截断、截断多少，必须由总线波形和对端字节确认</text>
</svg>
</div>

v6.6 通用 8250 软件方向模拟提供了一个具体实现参照：`em485` 保存这套模拟所需的端口与定时器状态，`__stop_tx()` 在它有效时先检查 THRE，再检查 TEMT；只有 FIFO 与移位寄存器都进入所需状态后才调用停止发送路径。若硬件缺少可直接使用的 TEMT 条件，代码还可用 `UART_CAP_NOTEMT` 能力标志和帧时间补偿延迟释放。这个分支说明驱动必须知道自己面对的控制器能力，不能把一组固定睡眠毫秒数当成普遍正确答案。

## <span class="blue"> Linux 的 `serial_rs485` 配置怎样到达真实驱动

Linux 把 RS-485 的方向和相关能力集中到 `struct serial_rs485`。用户空间包含 `<linux/serial.h>` 取得结构体和标志，包含 `<sys/ioctl.h>` 取得 `TIOCSRS485` 与 `TIOCGRS485` 定义。ioctl 是设备特定的输入输出控制系统调用，这里用于传递串口结构体；前者请求设置，后者读取当前保存的配置。

RTS（Request To Send）在这里是驱动用于 RS-485 方向控制的 UART 硬件信号。它的逻辑电平怎样连接到 DE，以及是否还承担普通硬件流控，必须分别按当前模式和原理图判断。

### 结构体中的每组字段回答什么问题

| 字段或标志 | 对当前实例的含义 | 不能据此推断什么 |
|---|---|---|
| `SER_RS485_ENABLED` | 请求启用或关闭 RS-485 模式 | 当前驱动一定实现该模式 |
| `SER_RS485_RTS_ON_SEND` | 发送期间 RTS 的逻辑电平 | 实际 DE 一定与它同相，还要看原理图和有效电平 |
| `SER_RS485_RTS_AFTER_SEND` | 发送结束后的 RTS 逻辑电平 | 最后停止位已经由仪器确认 |
| `SER_RS485_RX_DURING_TX` | 发送期间是否仍接收 | 所有自收都已消除，或所有器件都支持此行为 |
| `SER_RS485_TERMINATE_BUS` | 在驱动支持时控制终端使能 GPIO | 板上终端的位置、阻值和实际跳线已经正确 |
| `delay_rts_before_send` | RTS 方向变化到开始发送之间的请求延时，单位毫秒 | 等于收发器手册的纳秒级使能时间，或具有位级精度 |
| `delay_rts_after_send` | 数据结束到 RTS 释放之间的请求延时，单位毫秒 | 可以脱离 TEMT 和硬件状态独立保证安全 |
| `ADDRB／ADDR_RECV／ADDR_DEST` | 特定 UART 的多点寻址能力与地址字段 | Modbus 地址、功能码或寄存器语义 |

`ADDRB` 相关能力只有驱动和硬件支持时才有意义，本篇不展开，也不把它当成 Modbus 地址配置。

v6.6 serial core 会把 `delay_rts_*` 限制在其支持范围内，当前上限为 100 ms；不支持非零延时的驱动会把它清零并发出限速警告。部分不受支持的标志也可能在清理过程中被移除。因此程序需要同时保留“原本想请求什么”和“驱动最后接受什么”，不能只检查 `ioctl()` 的返回 0。

设置路径可以缩短为：

```text
ioctl(fd, TIOCSRS485, &config)
→ serial core 的 uart_ioctl()
→ uart_set_rs485_config()
→ 检查标志并按 rs485_supported 清理
→ 调用 port->rs485_config()
→ 成功后更新 port->rs485
→ 把实际配置复制回用户结构体
```

`rs485_config` 是具体 UART 驱动完成设备相关配置的回调，`rs485_supported` 则描述它支持的标志和延时。没有 `rs485_config` 时，v6.6 的设置路径返回 `-ENOTTY`，用户库通常表现为 `ioctl()` 返回 -1 且 `errno` 为 `ENOTTY`，表示当前端口不支持这个操作。这不是要求用户继续重试的暂时状态，而是需要回查驱动能力的结果。

读取路径 `TIOCGRS485` 返回端口当前保存的 `port->rs485`。它适合保存原配置和读回核对，但一次读取成功本身不等于方向控制已经工作；设置回调、实际 RTS／DE 波形和正常传输仍须分别验证。

### 配套程序为什么保留两份请求配置

下面的片段取自本篇完整程序。`wanted_rs485` 保存原始意图，`requested_rs485` 交给会回写实际配置的 ioctl，随后再用独立读取结果与原始意图比较：

```c
/* code/B-B.5.6/rs485_xfer.c，配置片段 */
    make_rs485_request(&options, &wanted_rs485);
    requested_rs485 = wanted_rs485;
    /* TIOCSRS485 writes the accepted configuration back to this object. */
    if (ioctl(fd, TIOCSRS485, &requested_rs485) < 0) {
        perror("TIOCSRS485 configure");
        goto out;
    }
    rs485_changed = true;
    memset(&actual_rs485, 0, sizeof(actual_rs485));
    if (ioctl(fd, TIOCGRS485, &actual_rs485) < 0) {
        perror("TIOCGRS485 readback");
        goto out;
    }
    print_rs485("rs485_readback", &actual_rs485);
    if (!rs485_matches_request(&actual_rs485, &wanted_rs485)) {
        print_rs485("rs485_requested", &wanted_rs485);
        fprintf(stderr, "driver did not accept the requested RS-485 settings\n");
        goto out;
    }
```

如果直接把内核回写后的 `requested_rs485` 当成比较基准，就可能把“驱动删掉了请求位”误当成请求与读回一致。保留 `wanted_rs485` 才能让这种差异显形。

### 设备树描述能力，不负责创造能力

v6.6 `rs485.yaml` 给出了半双工 UART 可用的通用属性：

- `rs485-rts-delay = <before after>`：发送前与发送后的 RTS 延时，单位毫秒；
- `rs485-rts-active-low`：发送时 RTS 使用低电平，默认高电平；
- `linux,rs485-enabled-at-boot-time`：请求启动时启用 RS-485；
- `rs485-rx-during-tx`：允许发送期间接收；
- `rs485-term-gpios` 与 `rs485-rx-during-tx-gpios`：描述终端和接收控制的 GPIO；
- `rs485-rx-active-high`：描述独立接收使能信号的极性。

通用 `serial.yaml` 还定义了 `rts-gpios`，但它只说明 UART 的 RTS 使用哪个 GPIO，不自动证明该信号已经接到收发器 DE，也不证明驱动实现了 RS-485 状态机。

这些属性必须与控制器设备树绑定（binding）、驱动源码和原理图一起使用。本篇不提供一份可直接复制到所有板卡的 DTS，也不建议在未核对回调时加入 `linux,rs485-enabled-at-boot-time`：启动路径同样会进入具体 RS-485 配置，不是“先写上、以后再处理”的无副作用标记。

## <span class="blue"> 回到 RK3568：为什么不能直接复制一份通用 DTS

B-B.5.3 已确认 RK3568 UART4 在 v6.6 `rk356x.dtsi` 中使用：

```text
compatible = "rockchip,rk3568-uart", "snps,dw-apb-uart"
```

对应驱动是 `drivers/tty/serial/8250/8250_dw.c`。本篇继续核对该驱动的 probe 路径：`dw8250_probe()` 设置寄存器访问、时钟、中断、termios 和直接内存访问（DMA）等端口能力，但没有设置 `port.rs485_config` 或 `port.rs485_supported`。`serial8250_register_8250_port()` 会从调用方端口复制这些 RS-485 字段，因此通用 8250 注册不会凭空补上缺失的方向回调。

所以，**对本文核对的 Linux v6.6 主线 `8250_dw` 路径，不能把 `TIOCSRS485` 写成已经可用的 RK3568 自动方向功能**。按照 serial core 的检查，设置时会因为缺少回调而失败。即使 DTS 属性被通用注册路径读取，也不等于硬件支持已经实现。

这条结论只覆盖所核对的 v6.6 主线源码。实际产品可能使用带厂商扩展的 BSP、其他 UART 控制器、独立方向电路或自动收发模块，必须继续读取该系统的真实驱动和原理图。若这些资料未取得，正常路径就在支持性检查处停止，不进入“配置成功”和“对端已收到”的叙述。

这也是本篇不把旧稿 `&uart3`、固定 `rts-gpios` 和几行 `TIOCSRS485` 代码直接继承为目标方案的原因。通用 UAPI 的教学价值在于解释接口与责任边界，不是掩盖目标驱动缺口。

## <span class="blue"> 一笔受控传输怎样配置、读回、停止并恢复

只有在实际驱动和接线资料支持时，才进入下面的操作路径。配套程序 [`rs485_xfer.c`](code/B-B.5.6/rs485_xfer.c){: data-code-viewer="true" data-code-title="rs485_xfer.c" data-code-path="本篇教学配套 · code/B-B.5.6/rs485_xfer.c"} 把完整流程放在同一个 C 文件中，构建入口为 [`Makefile`](code/B-B.5.6/Makefile){: data-code-viewer="true" data-code-title="Makefile" data-code-path="本篇教学配套 · code/B-B.5.6/Makefile"}。

### 程序固定了哪些实验条件

程序发送 `55 00 FF 3C`，要求受控对端回答 `C3 7E`。它不解析协议字段，也不计算循环冗余校验（CRC）；固定响应只是让正常响应、自收和错误字节具有可区分结果。

程序依次执行：

1. 打开设备，保存原 termios 和 `serial_rs485`；
2. 配置 raw、8 数据位、无校验、1 停止位（8N1）、无 RTS／CTS 硬件流控，并从命令行设置双方已经约定的波特率；
3. 读回 termios，比较四组标志、控制字符和输入／输出速率；
4. 请求启用 RS-485，明确 RTS 在发送与发送后的逻辑电平，并按需设置两个毫秒延时和发送期间接收；
5. 独立读回 RS-485，确认驱动实际接受的配置与原始请求一致；
6. 清除实验前残留输入输出，处理短写并发送四个请求字节；
7. 调用 `tcdrain()` 等待输出路径完成，再累计短读，直到取得两个响应字节或达到当前读取窗口；
8. 无论正常完成还是中途失败，都进入统一清理段，恢复原 RS-485、恢复原 termios、分别读回并关闭设备。

这里的 raw 表示关闭规范行模式、回显和输入输出转换等终端处理，使程序取得未经这些规则改写的字节；它不会绕过 TTY 或 serial core，机制见 B-B.5.3，完整 C 配置方法也与 B-B.5.5 一致。

`VMIN=0、VTIME=10` 让一次无数据 `read()` 在当前配置下形成约 1 秒量级的等待窗口。程序累计五次无数据读取后按超时失败，不把某一次返回 0 当成硬件损坏。`EINTR` 表示调用被信号打断，`EAGAIN／EWOULDBLOCK` 表示当前读取条件下暂时没有数据；程序分别处理这些返回，不用一个笼统的“通信失败”覆盖全部原因。

### 先构建，再按实际硬件选择参数

在 `code/B-B.5.6/` 目录执行：

```bash
make clean
make
```

交叉编译时清理本机产物，并指定目标工具链：

```bash
make clean
make CC=aarch64-linux-gnu-gcc
```

以下运行命令使用 `/dev/ttyS4`、115200、8N1 和发送时 RTS 高电平作为**教学配置**，不是目标板默认值：

```bash
./rs485_xfer /dev/ttyS4 115200
printf 'transfer_exit=%d\n' "$?"
```

只有原理图证明发送时 RTS 应为低电平时，才增加 `--rts-active-low`。需要验证发送期间接收时使用 `--rx-during-tx`。`--before-ms N` 与 `--after-ms N` 只传入驱动支持的毫秒延时，不代替收发器使能时间和发送完成分析。

如果驱动原样接受上述教学请求、对端按夹具回答且恢复成功，正常路径的**预期输出格式**如下。它不是当前板卡的运行记录：

```text
rs485_readback flags=0x00000003 rts_on_send=1 rts_after_send=0 rx_during_tx=0 before_ms=0 after_ms=0
device=/dev/ttyS4 baud=115200
request 55 00 ff 3c
write_accepted=4
tcdrain=complete; this is not a bus-response proof
response c3 7e
PASS: controlled response verified
transfer_exit=0
```

实际读回不同、出现 `ENOTTY`、发生短写、读取超时或响应不符时，程序都会以非零状态退出并尝试恢复。`write_accepted=4` 只说明四个请求字节已被接受，`tcdrain=complete` 只说明等待路径返回，二者都不能替代 `response c3 7e`。

当前写作环境没有 GCC、Clang、Make 或 AArch64 交叉编译器，因此上述构建和运行命令均未实际执行。程序的目标输出、目标恢复和真实对端响应都保持未验证。

## <span class="blue"> 方向与电气异常怎样在同一笔实验中显出不同证据

正常路径成立后，每次只改变一个条件，并保留同一时间窗口内的配置、字节和波形。异常实验不是故意把系统留在错误状态，而是为了观察机制边界并验证恢复。

### 方向过早释放与末字节截断要按时刻判断

在确定性教学模型中，可以把方向释放分别放在最后停止位之后、末字节内部和更早的位置，观察 A/B 何时停止跟随 DI。真实硬件若要对照，需要使用设计支持的测试方向控制或可编程测试设备，不在产品驱动中随意加入未经审查的延时和 GPIO 翻转。

判据来自两处共同证据：总线波形显示最后一个 UART 帧在哪一点失去有效驱动，对端软件则记录实际收到 `55 00 FF 3C` 的哪一段。提前释放不保证每次都产生相同截断结果，因为释放时刻、收发器禁用时间、总线保持和对端采样共同决定现象。

### 自收实验要同时看 `/RE` 和驱动接收状态

可以在驱动和硬件明确支持时，比较允许与禁止发送期间接收的两种配置。记录 `SER_RS485_RX_DURING_TX` 读回、`/RE` 实际电平以及本机读到的字节。

如果本机出现与请求相同的内容，应先确认它是否来自本机接收路径，再与对端 `C3 7E` 区分。配套正常程序会把不符合固定响应的输入判为失败；若要完整记录自收序列，应改用保留所有接收字节的受控采集工具，而不是让正常程序只取前两字节后代替全部观察。

### 偏置与终端对照必须回到实际电路

偏置实验选择“所有节点都不驱动”的空闲窗口，比较设计规定的正常状态与受控测试状态，观察 A/B 差值、RO 空闲电平和 UART 是否产生额外活动。更改电阻网络前按板级要求断电，不在带电总线上移动跳线。

终端实验只操作板上已有且资料明确的测试跳线，分别记录设计正确、缺少所需末端终端和中间节点误加终端的条件。示波器用于比较差分幅度、边沿和反射，软件用于记录同一请求下的接收结果。不能预写“断电一定测得 60 Ω、120 Ω或 40 Ω”，因为完整直流网络和测量条件尚未取得。

每项异常结束后，都恢复原方向配置、原终端／偏置状态、原 RS-485 和 termios，再重复一次正常请求／响应。只有恢复读回与新的正常传输都成立，才能说实验条件已经撤销。

## <span class="blue"> 逻辑分析仪与示波器分别证明到哪一层

仪器必须接到与问题对应的测点。DI、RO、DE／`/RE` 和 A/B 不是可以相互替代的同一种信号。

### 逻辑分析仪跟随数字活动与方向关系

在逻辑侧，逻辑分析仪可以按自身门限观察 DI 的 UART 位段、RO 是否出现对应数据，以及 DE／`/RE` 相对数据的先后。解码配置必须使用本实验真实约定的速率和 8N1，不通过反复调整参数来迎合预期字节。

这类证据能够回答“本机方向变化是否早于数据”“对端 RO 是否出现请求”“本机是否出现请求副本”。它不能证明 A/B 的模拟幅度、共模和反射合格，也不能证明 Linux 用户程序已经取得相同字节。

### 示波器检查差分总线的真实电压与时间

在总线侧，示波器用于观察 `VA - VB`、各测点的共模条件、边沿、过冲、反射，以及最后停止位期间驱动是否仍然有效。应使用适合被测系统的差分探头，或按仪器和板级安全要求使用双通道数学运算；不能把接地夹随意接到可能处于不同电位的线路端子上。

逻辑侧 UART 波形正常，只证明该测点的 UART 信号正常。A/B 差分波形存在，也不证明用户态已收到正确响应。完整证据链仍需把仪器记录与同窗口的读写返回和实际字节对齐。

| 观察 | 能支持的结论 | 仍需补充的证据 |
|---|---|---|
| `write()` 接受四字节 | 内核接受了本次发送数据 | 控制器、总线和对端接收 |
| RS-485 配置读回一致 | 驱动保存了所请求的配置 | 实际 RTS／DE 与方向时序 |
| DI 与 DE 的逻辑分析仪记录 | 数字数据和方向的相对顺序 | A/B 模拟条件与用户交付 |
| 示波器中的 `VA - VB` | 总线差分幅度、边沿和部分时序 | 对端 UART 恢复与软件字节 |
| 对端收到请求、本机收到响应 | 当前配置下这笔端到端传输成立 | 其他速率、负载和长期条件 |

当前没有取得任何上述目标仪器记录。文中的图均为机制或实验设计示意，不是示波器截图，也不是测量结果。

## <span class="blue"> 证据来源与未验证项

本篇核对了以下资料：

- Linux v6.6 `include/uapi/linux/serial.h:110-166`：`serial_rs485`、标志、毫秒延时、地址字段以及设置／读取接口；
- Linux v6.6 `include/uapi/asm-generic/ioctls.h`：`TIOCGRS485`、`TIOCSRS485` 和 `TIOCSER_TEMT` 定义；
- Linux v6.6 `drivers/tty/serial/serial_core.c:1300-1477`：标志检查、配置清理、延时范围、设置回调、配置保存与读回；同文件 `1764-1825`：`uart_wait_until_sent()` 的 `tx_empty()` 等待；同文件 `3557-3631`：设备树属性读取；
- Linux v6.6 `drivers/tty/tty_ioctl.c:181-207`：TTY 等待缓冲排出并调用 `wait_until_sent`；
- Linux v6.6 `drivers/tty/serial/8250/8250_port.c:1462-1517`：通用 8250 方向模拟中的 THRE、TEMT、发送完成和补偿延时；
- Linux v6.6 `drivers/tty/serial/8250/8250_dw.c:511-665`：DesignWare 端口初始化与注册，未设置 `rs485_config`／`rs485_supported`；
- Linux v6.6 `drivers/tty/serial/8250/8250_core.c:1035-1079`：8250 注册时复制 RS-485 回调与支持字段，并读取设备树模式；
- Linux v6.6 `Documentation/devicetree/bindings/serial/rs485.yaml` 与 `serial.yaml`：RS-485 属性、通用 RTS GPIO 和适用边界；
- Linux v6.6 `Documentation/driver-api/serial/serial-rs485.rst`：驱动回调、支持掩码及用户态配置路径；
- Linux man-pages `tcdrain(3)`：等待已写输出完成传输及返回值的接口语义。

B-B.5.1 曾用 SP3485 说明为什么需要半双工收发器，但该手册不能证明本篇目标板也使用 SP3485。本篇没有继承旧稿中的固定接线、收发器型号、偏置／终端数值、通用 DTS 成功结论、日志或 Modbus 内容。

当前只完成源码、UAPI、binding 和配套代码的静态整理。配套 C 程序未编译，目标运行、受控对端响应、配置恢复和仪器测量均未执行；这些状态不能用文档构建或源码核对替代。

## <span class="blue"> 本节总结 [B→I]

RS-485 把 UART 的逻辑位流放进一对可被多个节点共享的差分线路，但电气共享同时带来方向、负载、参考和空闲状态问题。DE／RE 管的是收发器此刻是否输出，终端与偏置管的是总线在不同工作区间的电气条件，它们都不能由上层协议或设备树名称代替。

一笔正常传输必须把 `write()` 接受、UART 真正发完、方向释放、对端接收和响应交付分开。Linux `serial_rs485` 为支持它的驱动提供统一配置入口，但 v6.6 主线 `8250_dw` 的支持缺口说明：先核对实际驱动和原理图，再谈配置成功；最后还要恢复原配置并用新的正常传输证明恢复。

## <span class="blue"> 本节自查

??? details "Q1. 多个节点接上同一对 A/B 后，为什么还不能直接称为具有地址的通信协议？"
    RS-485 提供的是多点电气连接，未定义节点地址、命令或应答规则。哪个节点处理数据、何时回答，仍由上层协议或应用约定；Modbus 的地址语义归 B-B.5.7。

??? details "Q2. 差分接收为什么能抑制共同变化，却不能据此取消共模和参考地检查？"
    接收器利用 A/B 差值判决，理想的共同偏移在相减时抵消。但两条线路受到的实际变化可能不同，接收器也只在自己的共模和绝对额定条件内工作，因此参考条件与节点间电位差仍需核对。

??? details "Q3. 收发器具有失效保护，为什么还不能直接断言板上不需要偏置？"
    失效保护只覆盖手册明确规定的输入条件，开路、短路和所有驱动器关闭的空闲状态不一定都被覆盖。板上是否需要外部偏置，要把器件保证与真实总线状态一起核对。

??? details "Q4. 为什么 `write()` 返回 4 和 TX FIFO 已空都不能授权立即释放 DE？"
    `write()` 返回只表示内核接受了四字节，数据还可能经过发送缓冲、FIFO／保持寄存器和移位寄存器。FIFO 或保持寄存器为空也不必然表示最后停止位已经离开，方向释放必须使用硬件和驱动支持的发送完成边界。

??? details "Q5. `tcdrain()` 成功后，为什么仍要等待并核对对端响应？"
    `tcdrain()` 处理的是本机输出完成等待，不证明对端已经接收、理解或回答。本例只有实际读到与请求不同的 `C3 7E`，才完成受控端到端验证。

??? details "Q6. 为什么配套程序要同时保存 `wanted_rs485` 和 `requested_rs485`？"
    `TIOCSRS485` 会把驱动接受的配置写回传入对象，驱动还可能清理不支持的位或延时。`wanted_rs485` 保留原始意图，独立读回与它比较，才能发现请求没有原样生效。

??? details "Q7. 为什么不能在 RK3568 的通用主线教学中直接复制旧稿 DTS 和 `TIOCSRS485` 示例？"
    已核对的 v6.6 `8250_dw` probe 没有提供 `rs485_config` 和 `rs485_supported`，serial core 在缺少设置回调时会返回 `ENOTTY`。DTS 属性不会创造这个回调，实际 BSP 或其他方向硬件必须另行核验。

??? details "Q8. 自收和末字节截断为什么不能合并成同一个“方向切换不对”结论？"
    自收需要发送期间存在可用的接收回送路径，与 `/RE`、接线和驱动接收状态有关；末字节截断则与驱动器释放是否侵入尚未完成的帧有关。二者需要不同的测点和配置证据。

??? details "Q9. 异常实验结束后，为什么恢复命令成功还不够？"
    还要读回确认原 RS-485 与 termios，恢复终端、偏置和方向测试条件，并重新完成一笔正常请求／响应。配置命令返回成功不能代替链路已经恢复的证据。
