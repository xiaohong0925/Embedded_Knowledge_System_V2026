# B-B.5.7 Modbus RTU 协议与传感器采集

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 串口
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

Modbus 是主站与从站之间交换线圈、离散量和寄存器数据的应用层协议。主站发起一次事务，从站按地址和功能码处理请求；Modbus RTU（Remote Terminal Unit）则用二进制字节、帧间静默和循环冗余校验（CRC）把这笔事务放到串行线路上。RS-485 可以承载这些字节，却不定义地址、寄存器或测量值含义。

本节只回答一个问题：**一组 UART 字节怎样构成一次可寻址、可校验的 Modbus 寄存器读取，并由用户程序取得和验证测量值？**

全文沿同一笔读取展开：Linux 主站从 Vaisala HMP110 的 16 位温度寄存器取得一个原始值，再把它换算为摄氏度。手册中的寄存器编号是 258，实际协议数据单元（PDU）使用的零基地址是 `0x0101`。固定教学帧返回 `0x00EB`，即十进制 235，按手册的 `°C × 10` 标度得到 23.5 °C。这个数值是主机测试输入，不是现场测量记录。

> 寄存器：Modbus 数据模型中的一个 16 位数据单元。协议负责传输其中的位模式，具体位模式代表温度、配置还是状态，要由设备手册规定。

HMP110 同时提供部分测量的 32 位格式，手册推荐使用这些 32 位寄存器。本篇为了把单寄存器读取、异常响应和有符号定点换算放在一个最小实例中，选择 16 位温度格式；这不是对测量精度或产品选型的替代建议。

> 本节覆盖：主从责任线、请求与正常／异常响应、RTU 静默边界、任意 `read()` 分块、CRC、寄存器语义、固定版本 libmodbus 采集程序、主机确定性夹具、目标验证和恢复复测。

> 🔴 当前没有实际 HMP110、目标板级接线、板级 DTS、受控对端日志或仪器记录。文中的帧、程序输出格式和测试预期均用于教学与待执行验证，不表示已经在真实传感器上采集成功。

## <span class="blue"> 一次传感器读取需要哪些角色共同完成

B-B.5.6 已经沿受控原始字节说明 RS-485 的电气转换、半双工方向和 Linux 配置。本篇从“链路上能够交付字节”继续向上：哪个节点应该响应、读哪个寄存器、怎样检查响应以及字节代表什么，由 Modbus、设备手册和用户程序回答。

同一笔读取的最小全路是：

```text
用户程序选择从机 240 和 PDU 地址 0x0101
→ libmodbus 构造 Read Holding Registers 请求并追加 CRC
→ TTY、串口驱动和 UART 发送字节
→ RS-485 收发器与链路把字节交给对应从站
→ HMP110 核对请求并返回温度寄存器
→ libmodbus 从任意读取分块中累计响应并检查完整性
→ 用户程序取得 uint16_t 原始值
→ 按手册处理特殊值、符号、比例和量程
→ 发布测量结果或明确拒绝本次结果
```

各角色的责任不能互相替代：

- **主站用户程序**选择设备和事务参数，检查库返回，验证测量语义并决定是否发布。
- **libmodbus**负责协议请求、RTU CRC、响应接收和事务核对，不知道 `0x0101` 为何是温度，也不知道现场温度是否准确。
- **TTY、串口驱动和 UART**负责字节交付与串行发送，不负责 Modbus 地址和寄存器语义。
- **RS-485 收发器和链路**负责电气传输，不负责选择从站。
- **HMP110 从站**按自身协议实现和寄存器表处理请求。只有被寻址且能够处理该请求的从站才返回本次数据。

### 先固定手册条件，而不是猜测一串常见参数

《HMP60 and HMP110 Series User Guide》M211060EN-N 表 8 给出的 Modbus 出厂配置是：19200 baud、无校验、8 数据位、2 停止位、地址 240、串行延时 0、Modbus RTU。该配置适用于订购时已经选择 Modbus 的配置选项；实际设备可以被重新配置，手册还说明通信设置变更需要重新启动设备后生效。

因此，本文使用 **19200、8N2、地址 240** 作为手册基线，不把旧稿的 9600、8N1、地址 1 继承过来，也不把默认值写成当前实物状态。HMP110 的可写配置寄存器还提供响应延时等设置，但本篇只读测量值，不通过修改配置来制造实验条件。

### 上板路径必须先通过底层支持检查

真实 RK3568 链路还需要实际原理图、设备树源文件（DTS）、板级支持包（BSP）驱动和方向硬件。B-B.5.6 已核对：v6.6 主线 `8250_dw` 没有提供 `rs485_config` 和 `rs485_supported`，不能把通用 `TIOCSRS485` 或 libmodbus 的 RS-485 模式调用写成这条路径已经可用。

本篇配套程序因此**假定实际串口与方向路径已经能够正常收发**，不把 Modbus 成功建立在这个未验证前提上。若使用 USB 转 RS-485、自动方向收发器或厂商扩展 BSP，它们是另一条需要独立验证的硬件路径，不能反证主线 `8250_dw` 已经支持自动方向。主机伪终端（PTY）夹具同样不覆盖这些底层机制。

## <span class="blue"> 把一次读取写成确定的请求与响应

Modbus 应用协议把功能码和数据组成 PDU。串行链路在 PDU 外增加从机地址和 CRC，形成 RTU 应用数据单元（ADU）。分清两层后，才能看出“寄存器编号”“PDU 地址”和“线上字节”不是三个可以混用的写法。

> PDU：Protocol Data Unit，协议数据单元。本篇读取保持寄存器时，PDU 包含功能码、起始地址和数量；响应 PDU 包含功能码、字节计数和寄存器数据。

<!-- -->

> ADU：Application Data Unit，应用数据单元。Modbus RTU 的 ADU 在 PDU 前增加从机地址，在末尾增加两字节 CRC。

HMP110 手册的寄存器编号从 1 开始，PDU 地址从 0 开始。编号 258 减 1 得到 257，写成十六进制就是 `0x0101`。直接把十进制 258 转成 `0x0102` 会读到下一个寄存器；手册也专门提醒，读错寄存器可能得到外观正确的值。

功能码 `0x03` 表示 Read Holding Registers，读取一个或多个连续保持寄存器。请求中的数量是 1，正常响应的字节计数因此是 `2 × 1 = 2`。每个寄存器先发送高字节，再发送低字节。[Modbus Application Protocol V1.1b3](images/Modbus_Application_Protocol_V1_1b3.pdf) 第 15 页给出了这些字段和顺序。

### 请求怎样逐字节落到线上

| 字节位置 | 字段 | 本例值 | 本例含义 |
|---:|---|---|---|
| 0 | 从机地址 | `F0` | 十进制 240 |
| 1 | 功能码 | `03` | 读保持寄存器 |
| 2～3 | PDU 起始地址 | `01 01` | 地址 `0x0101` |
| 4～5 | 寄存器数量 | `00 01` | 读 1 个 |
| 6～7 | CRC | `C1 17` | 计算值 `0x17C1`，低字节先发送 |

完整请求是：

```text
F0 03 01 01 00 01 C1 17
```

其中前六字节参与 CRC 计算，最后两字节是计算结果。`C1 17` 不是从旧稿继承的常量，而是按本篇这六字节独立复算得到的固定测试向量。

### 正常响应怎样携带一个温度寄存器

| 字节位置 | 字段 | 本例值 | 核对方式 |
|---:|---|---|---|
| 0 | 从机地址 | `F0` | 与请求的从机一致 |
| 1 | 功能码 | `03` | 与请求功能一致 |
| 2 | 字节计数 | `02` | 一个寄存器占两字节 |
| 3～4 | 寄存器值 | `00 EB` | 组合为 `0x00EB` |
| 5～6 | CRC | `85 DE` | 计算值 `0xDE85`，低字节先发送 |

完整正常响应是：

```text
F0 03 02 00 EB 85 DE
```

请求包含寄存器地址，正常响应却**不回显这个地址**。库只能核对响应是否对应当前请求、功能码和数量是否正确；响应中的 `0x00EB` 究竟来自哪个设备内部位置，仍依赖请求构造和设备行为。这是后文“CRC 正确但寄存器选错”的入口。

### 异常响应不是另一笔测量

从站不能执行请求时，可以返回异常响应：功能码最高位置 1，数据区换成一字节异常码。以非法数据地址为例，协议层的一种合法异常帧是：

```text
请求：F0 03 01 01 00 01 C1 17
响应：F0 83 02 91 02
```

`0x83 = 0x03 + 0x80`，`0x02` 表示 Illegal Data Address，`91 02` 是这五字节中前三个字节的 CRC。它是协议正确、执行失败的响应，不是 CRC 错误，也不能把 `0x02` 换算成 0.2 °C。具体设备对某个越界地址是否返回该异常，要由设备实现和实测确认；本帧用于协议与主机错误路径教学，不宣称 HMP110 对所有错误地址都采用同一行为。

下图把三种帧按字段对齐。每行先看 CRC 前的字节，再看末尾低、高 CRC 字节；横线标出参与计算的范围。图中数值都是固定教学向量，不是总线抓包。

<div style="overflow-x:auto">
<svg viewBox="0 0 1200 620" xmlns="http://www.w3.org/2000/svg" style="max-width:1080px;width:100%;min-width:900px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>同一读取的请求、正常响应、异常响应与 CRC 覆盖范围</title>
<text x="600" y="30" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">固定教学帧：寄存器字段高字节在前，CRC 低字节在前</text>
<text x="45" y="100" fill="currentColor" stroke="none" font-size="16">请求</text>
<rect x="160" y="65" width="105" height="65" rx="5"/><text x="212" y="93" text-anchor="middle" fill="currentColor" stroke="none">地址</text><text x="212" y="119" text-anchor="middle" fill="currentColor" stroke="none">F0</text>
<rect x="265" y="65" width="105" height="65" rx="5"/><text x="317" y="93" text-anchor="middle" fill="currentColor" stroke="none">功能</text><text x="317" y="119" text-anchor="middle" fill="currentColor" stroke="none">03</text>
<rect x="370" y="65" width="180" height="65" rx="5"/><text x="460" y="93" text-anchor="middle" fill="currentColor" stroke="none">起始地址</text><text x="460" y="119" text-anchor="middle" fill="currentColor" stroke="none">01 01</text>
<rect x="550" y="65" width="150" height="65" rx="5"/><text x="625" y="93" text-anchor="middle" fill="currentColor" stroke="none">数量</text><text x="625" y="119" text-anchor="middle" fill="currentColor" stroke="none">00 01</text>
<rect x="700" y="65" width="80" height="65" rx="5"/><text x="740" y="93" text-anchor="middle" fill="currentColor" stroke="none">CRC Lo</text><text x="740" y="119" text-anchor="middle" fill="currentColor" stroke="none">C1</text>
<rect x="780" y="65" width="80" height="65" rx="5"/><text x="820" y="93" text-anchor="middle" fill="currentColor" stroke="none">CRC Hi</text><text x="820" y="119" text-anchor="middle" fill="currentColor" stroke="none">17</text>
<line x1="160" y1="50" x2="700" y2="50"/><line x1="160" y1="44" x2="160" y2="56"/><line x1="700" y1="44" x2="700" y2="56"/><text x="430" y="43" text-anchor="middle" fill="currentColor" stroke="none">CRC 计算范围</text>
<text x="45" y="245" fill="currentColor" stroke="none" font-size="16">正常响应</text>
<rect x="160" y="210" width="105" height="65" rx="5"/><text x="212" y="238" text-anchor="middle" fill="currentColor" stroke="none">地址</text><text x="212" y="264" text-anchor="middle" fill="currentColor" stroke="none">F0</text>
<rect x="265" y="210" width="105" height="65" rx="5"/><text x="317" y="238" text-anchor="middle" fill="currentColor" stroke="none">功能</text><text x="317" y="264" text-anchor="middle" fill="currentColor" stroke="none">03</text>
<rect x="370" y="210" width="125" height="65" rx="5"/><text x="432" y="238" text-anchor="middle" fill="currentColor" stroke="none">字节数</text><text x="432" y="264" text-anchor="middle" fill="currentColor" stroke="none">02</text>
<rect x="495" y="210" width="180" height="65" rx="5"/><text x="585" y="238" text-anchor="middle" fill="currentColor" stroke="none">寄存器值</text><text x="585" y="264" text-anchor="middle" fill="currentColor" stroke="none">00 EB</text>
<rect x="675" y="210" width="80" height="65" rx="5"/><text x="715" y="238" text-anchor="middle" fill="currentColor" stroke="none">CRC Lo</text><text x="715" y="264" text-anchor="middle" fill="currentColor" stroke="none">85</text>
<rect x="755" y="210" width="80" height="65" rx="5"/><text x="795" y="238" text-anchor="middle" fill="currentColor" stroke="none">CRC Hi</text><text x="795" y="264" text-anchor="middle" fill="currentColor" stroke="none">DE</text>
<line x1="160" y1="195" x2="675" y2="195"/><line x1="160" y1="189" x2="160" y2="201"/><line x1="675" y1="189" x2="675" y2="201"/><text x="417" y="188" text-anchor="middle" fill="currentColor" stroke="none">CRC 计算范围</text>
<text x="45" y="390" fill="currentColor" stroke="none" font-size="16">异常响应</text>
<rect x="160" y="355" width="105" height="65" rx="5"/><text x="212" y="383" text-anchor="middle" fill="currentColor" stroke="none">地址</text><text x="212" y="409" text-anchor="middle" fill="currentColor" stroke="none">F0</text>
<rect x="265" y="355" width="125" height="65" rx="5"/><text x="327" y="383" text-anchor="middle" fill="currentColor" stroke="none">功能＋80</text><text x="327" y="409" text-anchor="middle" fill="currentColor" stroke="none">83</text>
<rect x="390" y="355" width="160" height="65" rx="5"/><text x="470" y="383" text-anchor="middle" fill="currentColor" stroke="none">异常码</text><text x="470" y="409" text-anchor="middle" fill="currentColor" stroke="none">02</text>
<rect x="550" y="355" width="80" height="65" rx="5"/><text x="590" y="383" text-anchor="middle" fill="currentColor" stroke="none">CRC Lo</text><text x="590" y="409" text-anchor="middle" fill="currentColor" stroke="none">91</text>
<rect x="630" y="355" width="80" height="65" rx="5"/><text x="670" y="383" text-anchor="middle" fill="currentColor" stroke="none">CRC Hi</text><text x="670" y="409" text-anchor="middle" fill="currentColor" stroke="none">02</text>
<line x1="160" y1="340" x2="550" y2="340"/><line x1="160" y1="334" x2="160" y2="346"/><line x1="550" y1="334" x2="550" y2="346"/><text x="355" y="333" text-anchor="middle" fill="currentColor" stroke="none">CRC 计算范围</text>
<rect x="160" y="485" width="850" height="75" rx="7" stroke-dasharray="6 4"/><text x="585" y="516" text-anchor="middle" fill="currentColor" stroke="none">正常响应不回显寄存器地址；异常响应没有测量数据字段</text><text x="585" y="544" text-anchor="middle" fill="currentColor" stroke="none">CRC 证明帧内容一致，不证明寄存器选型或现场测量正确</text>
</svg>
</div>

沿图回到同一笔读取：主站先确定“找谁、做什么、从哪里读、读多少”，从站再用相同地址和功能码回答。字节计数把后续数据长度说清楚，CRC 则覆盖整笔帧内容。只有这些检查都完成后，`00 EB` 才进入测量语义处理。

## <span class="blue"> 没有帧标志时，怎样从任意 `read()` 分块恢复一帧

NMEA 可以用 `$` 和 CR/LF 找出文本语句边界，Modbus RTU 没有这样的起止字节。它依靠发送过程中的时间关系划分帧，再把已接收字段用于确定还需要多少字节。

### 线上连续性与系统调用分块要分别处理

[Modbus Serial Line Protocol V1.02](images/Modbus_Serial_Line_V1_02.pdf) 第 13～14 页规定：帧之间至少有 3.5 个字符时间的静默，整帧应连续发送；帧内若出现超过 1.5 个字符时间的静默，接收方应把它视为不完整帧并丢弃。高于 19200 baud 时，规范建议 `t1.5 = 750 µs`、`t3.5 = 1.750 ms` 的固定值。

本例恰好是 19200、8N2。每个字符包含 1 个起始位、8 个数据位和 2 个停止位，共 11 个位时间，因此教学演算为：

```text
字符时间 = 11 / 19200 s ≈ 572.917 µs
t1.5 ≈ 859.375 µs
t3.5 ≈ 2.005 ms
```

这些数值由当前帧格式和标称波特率算出，不是实测定时，也不能套到 8N1 或其他速率。UART 的起始位、采样和波特率误差已经在 B-B.5.2 展开，这里只使用“字符占多少位时间”这一结果。

即使传感器连续发出七个响应字节，Linux 用户态也不保证一次 `read()` 取得全部七字节。下面是一种可能交付方式：

```text
线上同一响应：F0 03 02 00 EB 85 DE
read() #1：     F0 03
read() #2：           02 00
read() #3：                 EB 85
read() #4：                       DE
```

每次返回都只是当前实际交付的字节数。第一个分块不完整不是错误，直接把每次返回当成一帧才会破坏协议解析。B-B.5.3 已解释 TTY 的交付路径，B-B.5.5 已用 NMEA 展示任意分块；本篇要增加的是**由协议字段推导剩余长度**。

下图上方是线上事务，下方是同一响应的一种软件分块。两条轴只用于比较边界，不表示各段具有相同实测时长，也不把用户读取时刻当成传感器发送时刻。

<div style="overflow-x:auto">
<svg viewBox="0 0 1200 510" xmlns="http://www.w3.org/2000/svg" style="max-width:1080px;width:100%;min-width:900px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>RTU 请求响应边界与任意 read 分块的区别</title>
<text x="600" y="30" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">同一笔事务：线上按帧连续，用户态可以按任意长度取得</text>
<text x="45" y="95" fill="currentColor" stroke="none">线上主站</text>
<rect x="180" y="65" width="330" height="70" rx="6"/><text x="345" y="94" text-anchor="middle" fill="currentColor" stroke="none">连续请求，8 字节</text><text x="345" y="120" text-anchor="middle" fill="currentColor" stroke="none">F0 03 01 01 00 01 C1 17</text>
<rect x="690" y="65" width="300" height="70" rx="6"/><text x="840" y="94" text-anchor="middle" fill="currentColor" stroke="none">连续响应，7 字节</text><text x="840" y="120" text-anchor="middle" fill="currentColor" stroke="none">F0 03 02 00 EB 85 DE</text>
<line x1="510" y1="100" x2="690" y2="100" stroke-dasharray="6 4"/><text x="600" y="80" text-anchor="middle" fill="currentColor" stroke="none">帧间静默与从站处理</text><text x="600" y="128" text-anchor="middle" fill="currentColor" stroke="none">至少满足 t3.5</text>
<text x="45" y="205" fill="currentColor" stroke="none">线上从站</text>
<line x1="840" y1="145" x2="840" y2="195"/><polygon points="840,195 833,182 847,182" fill="currentColor" stroke="none"/>
<text x="45" y="285" fill="currentColor" stroke="none">read() #1</text>
<rect x="180" y="250" width="125" height="62" rx="5"/><text x="242" y="289" text-anchor="middle" fill="currentColor" stroke="none">F0 03</text>
<text x="350" y="285" fill="currentColor" stroke="none">read() #2</text>
<rect x="455" y="250" width="125" height="62" rx="5"/><text x="517" y="289" text-anchor="middle" fill="currentColor" stroke="none">02 00</text>
<text x="625" y="285" fill="currentColor" stroke="none">read() #3</text>
<rect x="730" y="250" width="125" height="62" rx="5"/><text x="792" y="289" text-anchor="middle" fill="currentColor" stroke="none">EB 85</text>
<text x="900" y="285" fill="currentColor" stroke="none">read() #4</text>
<rect x="990" y="250" width="85" height="62" rx="5"/><text x="1032" y="289" text-anchor="middle" fill="currentColor" stroke="none">DE</text>
<line x1="180" y1="350" x2="1075" y2="350" stroke-dasharray="5 4"/><text x="627" y="380" text-anchor="middle" fill="currentColor" stroke="none">累计到七字节后才交给完整性与事务检查</text>
<rect x="180" y="415" width="895" height="55" rx="6"/><text x="627" y="449" text-anchor="middle" fill="currentColor" stroke="none">分块边界不是新的 Modbus 帧，也不要求每次 read() 恰好产生图示长度</text>
</svg>
</div>

### libmodbus 怎样知道还要继续读

固定到 v3.2.0 的 [`modbus.c:365-546`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus.c){: data-code-viewer="true" data-code-title="modbus.c" data-code-path="libmodbus v3.2.0 · src/modbus.c" data-code-lines="365-546"} 中，`_modbus_receive_msg()` 先读地址和功能码，再根据功能取得元数据；读取响应时，字节计数进一步决定剩余数据和 CRC 长度。循环把每次 `recv` 底层实际返回的数量累加到 `msg_length`，同时减少 `length_to_read`，直到预期响应完整。

本例正常响应的推导是：

```text
先读地址 F0 与功能 03
→ 读响应元数据：字节计数 02
→ 还需两个数据字节 00 EB 与两个 CRC 字节 85 DE
→ 累计长度达到七字节
→ 进入 CRC 和事务核对
```

异常响应没有正常响应的“数据字节计数”语义。库在看到 `0x83` 后按异常布局取得异常码和 CRC，因此不能把 `0x02` 当成后面还有两字节的正常计数。

响应超时和字节超时也由这条接收路径使用。设置字节超时后，响应超时用于等待首字节，后续等待使用字节超时；未设置字节超时时，响应超时覆盖整个确认响应。`select()` 是等待文件描述符就绪或到达时限的系统接口，这两个值是库等待其结果的软件上限，不是对线上 `t1.5／t3.5` 已经合规的测量证明。

配套程序把响应超时设为 1 秒、字节超时设为 100 ms，只是为了给教学读取一个有限等待窗口。100 ms 明显大于本例的 `t1.5`，所以该配置不能被解释为严格硬件定时器；真实系统的调度、驱动和协议合规需要另外测量。

## <span class="blue"> CRC 通过后，为什么还要核对响应字段

CRC 的全称是循环冗余校验。Modbus RTU 使用 16 位 CRC：寄存器初始值为 `0xFFFF`，每个消息字节先与当前低字节异或，再执行八次右移；每次移出的最低位为 1 时，与反射多项式 `0xA001` 异或。处理完所有参与字节后得到 16 位结果。

CRC 覆盖从从机地址开始，到最后一个数据字节结束，不包含末尾已有的 CRC 字段，也不包含 UART 起始位、停止位或校验位。发送方把结果的低字节放在前面，接收方重新计算并比较。本篇固定向量的结果是：

```text
请求前六字节：F0 03 01 01 00 01 → CRC = 0x17C1 → 线上 C1 17
正常前五个字节：F0 03 02 00 EB → CRC = 0xDE85 → 线上 85 DE
异常前三个字节：F0 83 02       → CRC = 0x0291 → 线上 91 02
```

这些值由脚本 `tools/inspect_b_b_5_7_evidence.py` 按上述逐位算法独立复算，并与 libmodbus 的查表实现核对。测试夹具把完整帧写成固定常量，不用被测库现场生成标准答案。

v3.2.0 的 [`modbus-rtu.c:377-411`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus-rtu.c){: data-code-viewer="true" data-code-title="modbus-rtu.c" data-code-path="libmodbus v3.2.0 · src/modbus-rtu.c" data-code-lines="377-411"} 在 `_modbus_rtu_check_integrity()` 中对“除末尾两字节外的完整消息”重算 CRC，并把线上低、高字节组合后比较；不一致时设置 `EMBBADCRC`。随后还检查消息是否属于当前从机。

CRC 通过只说明接收到的内容与该校验相符，下一层仍需回答“是不是本次请求的回答”：

1. RTU 预检查比较请求和响应的从机地址，不匹配时设置 `EMBBADSLAVE`。
2. 异常路径检查响应功能码是否等于请求功能码加 `0x80`，并读取异常码。
3. 正常路径检查功能码是否相同、响应长度是否符合请求、响应数量是否等于请求数量。
4. 只有这些检查通过，读取函数才把数据写入调用方数组。

这些分支位于 [`modbus.c:578-731`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus.c){: data-code-viewer="true" data-code-title="modbus.c" data-code-path="libmodbus v3.2.0 · src/modbus.c" data-code-lines="578-731"}。因此，应用不需要对已经转换成 `uint16_t` 的目标数组再次计算 CRC，而需要检查调用是否成功、返回多少寄存器以及失败时的 `errno`。

| 观察 | 当前可以判断 | 不能据此发布测量值的原因 |
|---|---|---|
| CRC 不匹配 | 帧完整性检查失败 | 数据不应进入语义解析 |
| CRC 正确，功能码为请求值＋`0x80` | 收到协议异常响应 | 异常码不是寄存器数据 |
| 地址、功能、长度和数量均匹配 | 当前事务的协议检查通过 | 寄存器是否选对、测量是否有效仍未解决 |
| 读到另一从机地址 | 响应不是所请求从机的正常回答 | 当前事务不成立 |
| 响应功能码或数量不匹配 | 响应与请求不一致 | 不能把数据当作本请求的寄存器结果 |

## <span class="blue"> 寄存器值怎样变成可以发布的测量值

协议检查通过后，[`modbus.c:1550-1592`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus.c){: data-code-viewer="true" data-code-title="modbus.c" data-code-path="libmodbus v3.2.0 · src/modbus.c" data-code-lines="1550-1592"} 的 `read_registers()` 把响应中的高、低字节组合到 `uint16_t dest[]`。`uint16_t` 是 C 标准定义的 16 位无符号整数类型，数组由调用方提供：

```c
/* libmodbus v3.2.0，read_registers() 中的数据转换片段 */
dest[i] = (rsp[offset + 2 + (i << 1)] << 8) |
          rsp[offset + 3 + (i << 1)];
```

对正常帧而言，`dest[0] = 0x00EB`。数组元素已经按主机可使用的 16 位字保存，不再包含响应地址、功能码、字节计数或 CRC。

### 先识别特殊编码，再解释符号和比例

HMP110 手册表 55 给 16 位有符号整数保留了特殊含义：

| 原始值 | 手册含义 | 配套程序处理 |
|---|---|---|
| `0x8000` | 值不可用 | 输出 `value_unavailable`，拒绝发布 |
| `0x7FFF` | 值为 32767 或更大 | 输出饱和状态，不当作 3276.7 °C |
| `0x8001` | 值为 −32767 或更小 | 输出饱和状态，不当作 −3276.7 °C |
| 其他值 | 普通有符号数或二进制补码负值 | 转换后再检查量程 |

普通负值不能直接当作正数除以 10。配套解码器先处理特殊值，再用显式减法恢复二进制补码负数，避免把超出有符号范围的 `uint16_t` 到 `int16_t` 转换依赖编译器实现：

```c
/* hmp110_temperature.c，解码片段 */
signed_value = (raw & 0x8000u) ? (int32_t)raw - 65536 : (int32_t)raw;
if (signed_value < -400 || signed_value > 800)
    return HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE;
*tenths_c = (int)signed_value;
```

这里的 `signed_value` 以 0.1 °C 为单位，所以 −400～800 对应手册表 30 的 −40～+80 °C 测量范围。`0x00EB` 恢复为 235，最终输出 23.5 °C；`0xFFC9` 恢复为 −55，输出 −5.5 °C。超出量程或特殊无效值不会被静默改成 0，也不会沿用上一次测量。

### 四个结论必须分别取得证据

- **CRC 正确**：当前帧通过完整性检查。
- **寄存器语义正确**：手册、请求地址、数据类型、比例和特殊值处理一致。
- **测量值可信**：设备处于有效测量状态，数值在允许范围内，没有使用过期结果，并满足应用需要的更新条件。
- **物理量现场准确**：还需要合适的参考仪器、安装条件、稳定时间和校准／比对证据。

HMP110 手册特别提醒，读错寄存器可能得到外观正确的值。正常响应又不回显寄存器地址，所以 CRC 和字段检查无法独自发现“读到了一个合法但错误的寄存器”。需要用请求帧、手册、已知测试寄存器或独立参考条件把这一层补齐。

## <span class="blue"> 用固定版本 libmodbus 完成同一笔读取

前面沿一笔帧完成了手工机制基线，现在把相同工作交给库。配套程序 [`modbus_sensor.c`](code/B-B.5.7/modbus_sensor.c){: data-code-viewer="true" data-code-title="modbus_sensor.c" data-code-path="本篇教学配套 · code/B-B.5.7/modbus_sensor.c"} 使用 **libmodbus v3.2.0**，温度语义解码位于 [`hmp110_temperature.c`](code/B-B.5.7/hmp110_temperature.c){: data-code-viewer="true" data-code-title="hmp110_temperature.c" data-code-path="本篇教学配套 · code/B-B.5.7/hmp110_temperature.c"} 和 [`hmp110_temperature.h`](code/B-B.5.7/hmp110_temperature.h){: data-code-viewer="true" data-code-title="hmp110_temperature.h" data-code-path="本篇教学配套 · code/B-B.5.7/hmp110_temperature.h"}。

程序读取实际链接库导出的版本号，不是 3.2.0 就停止，避免正文核对的 API 与运行库悄然不同。固定版本证据来自官方同标签 `src/modbus.h`、`src/modbus.c`、`src/modbus-rtu.c` 和对应文档，不使用 `master` 分支行为补齐结论。

### 上下文从创建到释放各保存什么

| 调用 | 当前任务 | 返回与生命周期边界 |
|---|---|---|
| `modbus_new_rtu(device, baud, parity, data_bits, stop_bits)` | 分配 `modbus_t` 和 RTU 后端数据，保存设备与帧参数 | 成功返回上下文指针，失败返回 `NULL`；此时尚未连接 |
| `modbus_set_slave(ctx, slave)` | 在上下文中保存 RTU 从机地址 | 本篇使用单播 1～247，不用广播地址读测量 |
| `modbus_set_response_timeout()` | 设置响应等待条件 | 成功返回 0，失败返回 −1 |
| `modbus_set_byte_timeout()` | 设置后续字节等待条件 | 两个参数都为 0 才禁用；本例明确设为 100 ms |
| `modbus_connect(ctx)` | 打开并配置串口 | 成功返回 0，失败返回 −1 并设置 `errno` |
| `modbus_read_registers(ctx, 0x0101, 1, &raw)` | 完成一次功能码 `0x03` 事务 | 成功返回读取寄存器数 1，失败返回 −1；不是返回响应字节数 |
| `modbus_close(ctx)` | 关闭连接，并沿 RTU 后端尝试恢复原串口设置 | 返回类型为 `void`，不能用返回值证明恢复成功 |
| `modbus_free(ctx)` | 释放后端数据和上下文 | 在成功创建后，无论后续哪一步失败都要执行 |

`modbus_close()` 的恢复边界必须如实保留。v3.2.0 [`modbus-rtu.c:1164-1206`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus-rtu.c){: data-code-viewer="true" data-code-title="modbus-rtu.c" data-code-path="libmodbus v3.2.0 · src/modbus-rtu.c" data-code-lines="1164-1206"} 会尝试恢复进入时保存的串口设置，但公共 `modbus_close()` 没有返回值。目标验证若需要证明恢复，仍须按 B-B.5.4／B-B.5.5 的方法读回配置，不能把“调用了 close”写成“恢复已经确认”。

程序也不自动调用 `modbus_rtu_set_serial_mode()`。该 API 在 RTU 后端通过 `TIOCGRS485／TIOCSRS485` 请求内核 RS-485 模式，仍受真实驱动支持约束。需要它的系统必须先完成 B-B.5.6 的支持与恢复验证；在 v6.6 主线 `8250_dw` 缺口下，库调用不会创造缺失的驱动回调。

### 正常调用先通过每一个配置门限

下面的配置片段取自完整程序。`ctx` 只有创建成功后才能进入后续调用，任何错误都转到统一释放路径：

```c
/* modbus_sensor.c，上下文与串口配置片段 */
ctx = modbus_new_rtu(device, baud, parity, data_bits, stop_bits);
if (ctx == NULL) {
    fprintf(stderr, "modbus_new_rtu: %s\n", modbus_strerror(errno));
    goto out;
}
if (modbus_set_slave(ctx, slave) != 0) {
    fprintf(stderr, "modbus_set_slave: %s\n", modbus_strerror(errno));
    goto out;
}
if (modbus_set_response_timeout(ctx, 1, 0) != 0) {
    fprintf(stderr, "modbus_set_response_timeout: %s\n", modbus_strerror(errno));
    goto out;
}
if (modbus_set_byte_timeout(ctx, 0, 100000) != 0) {
    fprintf(stderr, "modbus_set_byte_timeout: %s\n", modbus_strerror(errno));
    goto out;
}
if (modbus_connect(ctx) != 0) {
    fprintf(stderr, "modbus_connect %s: %s\n", device, modbus_strerror(errno));
    goto out;
}
connected = 1;
```

`modbus_strerror(errno)` 把库自定义异常和系统错误转换成可读文本。程序在调用失败后立即保存或读取 `errno`，不让其他无关调用覆盖本次原因。

### 读取返回与测量发布是两个门限

```c
/* modbus_sensor.c，读取与错误分类片段 */
errno = 0;
rc = modbus_read_registers(ctx, HMP110_TEMPERATURE_ADDRESS,
                           HMP110_TEMPERATURE_COUNT, &raw);
if (rc < 0) {
    int error = errno;

    fprintf(stderr, "read_failed class=%s error=%d message=%s\n",
            read_error_class(error), error, modbus_strerror(error));
    goto out;
}
if (rc != HMP110_TEMPERATURE_COUNT) {
    fprintf(stderr, "read_failed expected=%d registers actual=%d\n",
            HMP110_TEMPERATURE_COUNT, rc);
    goto out;
}
```

`read_error_class()` 把超时、CRC、异常响应、错误从机和事务数据不匹配分别打印。它不把 `ETIMEDOUT` 直接翻译成“传感器损坏”，也不把 `EMBXILADD` 当成传输干扰。错误文本用于定位当前失败类别，根因仍需结合链路证据。

读取成功后，程序才调用 `hmp110_decode_temperature()`。特殊值、量程异常和空输出参数都有独立结果；解码失败时同样进入清理，不打印新的 `measurement` 行。

程序默认不启用 libmodbus 的自动错误恢复。v3.2.0 的默认模式是 `MODBUS_ERROR_RECOVERY_NONE`，应用需要控制错误处理；本例一次命令只完成一次读取，恢复判据是修正一个条件后重新取得正常结果，而不是让库在后台无限重连或重发。

## <span class="blue"> 从主机夹具走到真实传感器，每一步证明什么

完整构建入口是 [`Makefile`](code/B-B.5.7/Makefile){: data-code-viewer="true" data-code-title="Makefile" data-code-path="本篇教学配套 · code/B-B.5.7/Makefile"}，测试位于 [`test_modbus_sensor.c`](code/B-B.5.7/test_modbus_sensor.c){: data-code-viewer="true" data-code-title="test_modbus_sensor.c" data-code-path="本篇教学配套 · code/B-B.5.7/test_modbus_sensor.c"}。测试程序直接链接同一个 libmodbus，并使用 Linux 伪终端对（PTY）：假传感器在一端核对请求、写入固定响应，真实 `modbus_read_registers()` 在另一端读取。

PTY 是内核提供的成对终端设备，本例用它获得可控串口软件入口。它不包括 UART 控制器、8250、RS-485 收发器或 HMP110，也不模拟电气波形。

### 先验证语义，再验证真实库事务

九组语义测试覆盖：23.5 °C、−5.5 °C、0 °C、不可用、高低饱和、低于量程、高于量程和空输出指针。每组都检查状态；被拒绝的输入还必须把输出清零，防止旧值残留。

十四组 PTY 集成测试覆盖：

| 夹具 | 断言 |
|---|---|
| 正常响应的六个可能两段切分点 | 六种分段写入都返回一个寄存器，原始值为 `0x00EB`，换算为 23.5 °C |
| 坏 CRC | 返回 −1，`errno = EMBBADCRC` |
| 非法数据地址异常 | 返回 −1，`errno = EMBXILADD`，不产生测量 |
| 另一从机地址 | 返回 −1，`errno = EMBBADSLAVE` |
| 功能码与请求不符 | 返回 −1，`errno = EMBBADDATA` |
| 字节计数与请求数量不符 | 返回 −1，`errno = EMBBADDATA` |
| CRC 正确但数据改成 `0x0000` | 库返回一个寄存器，说明协议检查无法替业务识别错误来源 |
| 负温度响应 | 原始值 `0xFFC9` 换算为 −5.5 °C |
| 对端不响应 | 在有限窗口内返回 −1，`errno = ETIMEDOUT` |

分段写入只证明库能够正确处理这些分段交付结果。内核可能合并相邻写入，所以测试不断言每次 `read()` 必须返回某个固定长度，也不把六个切分点宣传为已经穷举内核调度。

所有 CRC 都由独立逐位算法预先复算并写成固定帧。夹具不会调用被测库生成自己的预期 CRC，避免同一个错误同时出现在输入与标准答案中。

### 构建与主机测试命令

需要 Linux C 编译环境、Make、libmodbus v3.2.0 开发头文件与库；`pkg-config` 用于取得编译和链接参数，未提供时 Makefile 回退到 `-lmodbus`。PTY 测试使用 `openpty()` 和 `fork()`，因此它不是 Windows 或裸机测试。

在 `code/B-B.5.7/` 目录执行：

```bash
make clean
make
make test
```

交叉编译设备程序时先清理本机产物，再指定工具链：

```bash
make clean
make CC=aarch64-linux-gnu-gcc
```

`make test` 只应在与当前主机匹配的本机构建后执行，不能用交叉编译产物代替。若工具链支持，可再执行 `make sanitize`，用 AddressSanitizer 和 UndefinedBehaviorSanitizer 检查测试路径；它仍不涉及真实串口硬件。

二十三组测试全部通过时的**预期输出结尾**是：

```text
PASS: 9 semantic groups
PASS: 14 PTY integration groups
PASS: 23 deterministic groups; no UART, RS-485 or sensor hardware was used
```

当前写作环境没有 GCC、Clang、Make、AArch64 交叉编译器或 pkg-config，因此上述编译、主机测试和 Sanitizer 均未实际执行。这些命令与输出是待执行判据，不是已经取得的通过记录。

### 真实串口与传感器运行

先按 B-B.5.6 核对实际板级资料、方向控制和受控原始字节收发，再协调其他端口访问者，确认传感器当前地址与串口配置。使用手册默认配置且实际设备仍保持该配置时，可以执行：

```bash
./modbus_sensor /dev/ttyS4
printf 'reader_exit=%d\n' "$?"
```

若使用已经独立验证的 USB 转 RS-485 路径，设备节点应换成实际节点，不能把 `/dev/ttyUSB0` 的成功归到 RK3568 的 `8250_dw`。参数与手册默认值不同时，按程序使用说明传入当前配置；`-d` 可打开库的协议调试输出，用于保留实际请求和响应字节。

一次正常读取的**预期输出格式**如下，其中设备路径和温度只是本例教学值：

```text
libmodbus=3.2.0 device=/dev/ttyS4 baud=19200 format=8N2 slave=240
request function=0x03 address=0x0101 count=1
measurement temperature=23.5 C raw=0x00EB registers_read=1
reader_exit=0
```

这不是目标运行日志。真实运行必须保存实际标准输出、标准错误和退出状态；温度随现场变化，不应为了匹配教学值修改程序或记录。

## <span class="blue"> 同一笔读取失败时，程序怎样收口并恢复

异常实验都从正常帧出发，每次只改变一个条件。当前程序遇到读取或语义错误时不发布测量，调用已建立连接的关闭路径并释放上下文；下一轮是否恢复，要由新的正常读取证明。

### 超时只说明等待窗口内没有完成响应

无响应、响应尚未开始或响应未完成都可能在当前配置下表现为超时。保留 `ETIMEDOUT`、响应／字节超时设置和调试帧，再检查端口访问者、实际地址、链路收发和传感器响应延时。不能只看一次超时就宣布某根线损坏。

恢复时先消除当前已知原因，再重新发起同一合法读取。若仍有旧字节或另一笔事务残留，应根据固定版本库接口和系统状态评估清理，不把盲目 flush 当成恢复成功的证据。

### 异常响应要修正请求或设备条件，不是重算 CRC

`EMBXILADD` 表示从站返回非法数据地址异常。先核对手册编号与 PDU 零基地址、功能码和读取数量。异常帧 CRC 可以正确，因此降低波特率或更换 CRC 实现并不针对这个错误类别。

修正后重新读取原温度寄存器。只有取得正常功能码、正确数量并通过语义检查，才回到正常路径。

### CRC 错误要保留原帧，不用业务值掩盖

`EMBBADCRC` 表示接收帧与计算值不一致。保留实际响应字节、同窗口 UART 状态和必要的仪器记录，再区分帧内中断、字节改变、残留拼接或链路异常。错误帧中的 `00 EB` 即使外观熟悉，也不能进入测量发布。

夹具恢复只需把坏 CRC 换回正常帧；真实链路则要移除已经确认的测试条件，并用一笔新的完整响应复测。不能简单沿用错误发生前保存的温度。

### 错误寄存器与错误从机地址不是同一种失败

读错一个不存在或不允许的寄存器可能得到异常；读到另一个实际存在的寄存器也可能得到完全合法的正常响应。后者只能依靠请求检查、手册映射、已知值或独立参考发现，不能指望 CRC 报错。

选错从机地址时，总线上可能没有响应，也可能出现其他节点活动。库若取得另一从机地址的响应会设置 `EMBBADSLAVE`，但“任何错误地址都必然超时”不是可靠结论。恢复时核对实际地址并重新完成目标从机的正常读取。

### 仪器和参考测量分别补齐不同证据

逻辑分析仪可在逻辑侧观察请求与响应字节、帧内间隔和帧间静默，并与程序调试输出对齐。示波器若用于 A/B 差分、幅度、边沿或方向时序，属于 B-B.5.6 的电气证据范围，不能代替 Modbus 字段解析。

即使线上帧和程序结果一致，也只能证明当前协议与语义路径。要判断现场温度是否准确，还需独立温度参考、合理安装和稳定条件。当前没有任何目标仪器或参考测量记录，正文不预设其读数。

## <span class="blue"> 证据来源与未验证项

本篇的协议、器件和库依据如下：

- [Modbus Application Protocol V1.1b3](images/Modbus_Application_Protocol_V1_1b3.pdf) 第 15 页：功能码 `0x03`、零基地址、读取数量、正常响应字节计数、寄存器高字节在前和异常功能码；第 47 页：异常响应结构。
- [Modbus Serial Line Protocol V1.02](images/Modbus_Serial_Line_V1_02.pdf) 第 7～8 页：主从、单播与广播；第 12～14 页：RTU 字符格式、`t1.5／t3.5`、CRC 覆盖和低字节在前；附录 B：CRC 算法。
- [HMP60 and HMP110 Series User Guide M211060EN-N](images/HMP60_HMP110_M211060EN-N.pdf) 第 39 页：Modbus 出厂配置；第 110 页：HMP110 温度范围；第 126～131 页：功能码、16 位特殊值、寄存器编号、测量和配置寄存器。在线文档以 Vaisala 同一文档代码的当前页面为准。
- libmodbus v3.2.0 [`modbus-rtu.c`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus-rtu.c){: data-code-viewer="true" data-code-title="modbus-rtu.c" data-code-path="libmodbus v3.2.0 · src/modbus-rtu.c"}：RTU 请求 CRC、接收完整性、从机过滤、串口连接与关闭。
- libmodbus v3.2.0 [`modbus.c`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus.c){: data-code-viewer="true" data-code-title="modbus.c" data-code-path="libmodbus v3.2.0 · src/modbus.c"}：分步接收、响应与字节超时、异常和事务核对、寄存器转换、上下文公共接口。
- libmodbus v3.2.0 [`modbus.h`](code/B-B.5.7/libmodbus-v3.2.0/src/modbus.h){: data-code-viewer="true" data-code-title="modbus.h" data-code-path="libmodbus v3.2.0 · src/modbus.h"}：公共函数签名、版本号、协议异常和库错误码。

当前只完成规范与手册核对、固定帧独立复算、库源码静态跟随和配套代码整理。教学代码编译、PTY 主机测试、目标运行、真实 HMP110 采集、配置恢复和仪器测量均未执行；浏览器检查留待统一桌面验收。任何后续单项通过都不能代替其余层级或人工教学判断。

## <span class="blue"> 本节总结 [B→I]

一次 Modbus RTU 采集不是“打开串口后读到两个温度字节”，而是主站构造可寻址请求、从站返回可识别响应、库从任意交付分块中恢复预期长度，再依次通过 CRC、事务字段和设备语义门限。RTU 静默描述线上帧，`read()` 描述软件交付，两者不能混为同一种边界。

本篇最值得保留的是证据分层：CRC 正确不保证寄存器选对，寄存器换算正确不保证测量有效，测量有效也不代表现场精度已经验证。真实上板还要先过 RS-485 驱动与方向路径的支持闸门；主机夹具和 Modbus 示例不能掩盖底层尚未验证的事实。

## <span class="blue"> 本节自查

??? details "Q1. HMP110 手册中的寄存器编号 258，为什么在请求里写成 `01 01`？"
    手册编号从 1 开始，PDU 地址从 0 开始。编号 258 减 1 得到 257，即 `0x0101`，在线路上按高字节、低字节写成 `01 01`。直接换算 258 会得到错误的 `0x0102`。

??? details "Q2. 为什么一次 `read()` 返回 `F0 03` 不能判定为坏帧？"
    `read()` 只交付当前可用的两个字节，不负责 Modbus 帧边界。接收程序需要保存进度，按功能码、字节计数和 CRC 继续累计，直到取得完整预期响应。

??? details "Q3. 19200、8N2 下，为什么本例的字符时间约为 572.917 µs？"
    每个字符包含一个起始位、八个数据位和两个停止位，共 11 个位时间。`11 / 19200 s ≈ 572.917 µs`，再分别乘以 1.5 和 3.5 可得到本例的 `t1.5` 与 `t3.5` 教学值。

??? details "Q4. 请求中的起始地址和数量按高字节在前，为什么 CRC 却写成 `C1 17`？"
    Modbus 寄存器字段先发送高字节，而 RTU CRC 规定低字节先发送。请求前六字节计算得到 `0x17C1`，所以线上末尾依次是低字节 `C1`、高字节 `17`。

??? details "Q5. `F0 83 02 91 02` 为什么不能按正常响应解析成测量值？"
    `0x83` 是请求功能码 `0x03` 加 `0x80`，表示异常响应；`0x02` 是异常码，不是正常响应的数据字节计数。该帧可以 CRC 正确，但没有可发布的温度数据。

??? details "Q6. 为什么 CRC 正确仍可能读错寄存器？"
    CRC 只检查帧内容是否一致。正常响应不回显寄存器地址，如果请求选错了一个实际存在的寄存器，响应仍可能地址、功能、数量和 CRC 全部合法，因此还要核对请求、手册和已知语义。

??? details "Q7. `modbus_read_registers()` 返回 −1 和返回 1 分别要求程序做什么？"
    返回 −1 时立即保存并解释 `errno`，不读取或发布目标值；返回 1 表示取得请求的一个寄存器，之后仍需处理 HMP110 的特殊值、符号、比例和量程。它不是返回一个响应字节。

??? details "Q8. 为什么配套程序不自动调用 `modbus_rtu_set_serial_mode()` 来掩盖 RK3568 的支持问题？"
    该 API 最终仍依赖内核 RS-485 配置和真实驱动回调。v6.6 主线 `8250_dw` 没有提供已核对所需的支持字段，实际 BSP 与方向硬件必须另行验证，库调用不能创造底层能力。

??? details "Q9. PTY 测试全部通过后，还不能证明哪些内容？"
    它只能证明固定输入下的语义逻辑和真实库的软件事务路径，不包括 UART 控制器、8250、RS-485 电气与方向、真实 HMP110 响应、目标配置恢复或现场温度精度。
