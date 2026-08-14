# B-B.5.3 RS-485 与 Modbus 协议

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 总线
>
> 难度：[I] Intermediate | 预计阅读时间：45 分钟

## <span class="blue"> 本节导读

B-B.5.1 讲过 RS-485 只是"工业主力"的一句话带过，本篇把它展开。UART 是点对点协议，工业现场一台 PLC 要挂十几个温湿度变送器、变频器、电能表，靠两条线多节点共享——这是 RS-485 的差分电气层解决的问题；而各家设备说同一种"语言"——这是 Modbus 协议解决的问题。两层叠加，构成工业串行通信的事实标准。

本节覆盖：RS-485 差分传输与共模抑制、总线拓扑与终端/偏置电阻、半双工 DE/RE 方向切换、Linux 内核 RS485 模式、Modbus RTU 帧格式与功能码、CRC16 校验、libmodbus 最小应用骨架与 485 排查流程。

---

## <span class="blue"> 差分传输与总线拓扑

RS-485 用 A/B 两条线传一对互补信号，接收端只看**差值**：

| 状态 | 差分电压（VA − VB） |
|------|---------------------|
| 逻辑 1 | +0.2 V 以上（驱动端保证 ±1.5 V 以上） |
| 逻辑 0 | −0.2 V 以下 |
| 空闲 | ≈ 0 V（靠偏置电阻拉到确定态） |

差分的价值在**共模抑制**：动力电缆在 A/B 上同时感应出 +5 V 噪声，差值几乎不变，信号完好。这是 1200 m 传输距离的根本来源。

总线拓扑——所有节点并联在同一对双绞线上：

<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" style="max-width:760px;width:100%">
<rect x="20" y="70" width="110" height="70" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="75" y="100" text-anchor="middle" font-size="13" fill="currentColor">主站</text>
<text x="75" y="118" text-anchor="middle" font-size="11" fill="currentColor">PLC/工控机</text>
<rect x="220" y="20" width="80" height="46" rx="5" fill="none" stroke="currentColor"/>
<text x="260" y="48" text-anchor="middle" font-size="12" fill="currentColor">从站 1</text>
<rect x="340" y="20" width="80" height="46" rx="5" fill="none" stroke="currentColor"/>
<text x="380" y="48" text-anchor="middle" font-size="12" fill="currentColor">从站 2</text>
<rect x="460" y="20" width="80" height="46" rx="5" fill="none" stroke="currentColor"/>
<text x="500" y="48" text-anchor="middle" font-size="12" fill="currentColor">从站 3</text>
<rect x="580" y="20" width="80" height="46" rx="5" fill="none" stroke="currentColor"/>
<text x="620" y="48" text-anchor="middle" font-size="12" fill="currentColor">从站 N</text>
<line x1="130" y1="90" x2="700" y2="90" stroke="currentColor" stroke-width="1.5"/>
<line x1="130" y1="120" x2="700" y2="120" stroke="currentColor" stroke-width="1.5"/>
<text x="712" y="94" font-size="13" fill="currentColor">A</text>
<text x="712" y="124" font-size="13" fill="currentColor">B</text>
<line x1="260" y1="66" x2="260" y2="90" stroke="currentColor"/>
<line x1="380" y1="66" x2="380" y2="90" stroke="currentColor"/>
<line x1="500" y1="66" x2="500" y2="90" stroke="currentColor"/>
<line x1="620" y1="66" x2="620" y2="90" stroke="currentColor"/>
<line x1="700" y1="90" x2="700" y2="120" stroke="currentColor" stroke-width="1.5"/>
<text x="640" y="155" font-size="11" fill="currentColor">末端 120Ω</text>
<rect x="695" y="135" width="14" height="34" fill="none" stroke="currentColor"/>
<line x1="130" y1="90" x2="130" y2="120" stroke="currentColor" stroke-width="1.5"/>
<text x="60" y="170" font-size="11" fill="currentColor">首端 120Ω</text>
<rect x="123" y="150" width="14" height="34" fill="none" stroke="currentColor"/>
<text x="330" y="190" text-anchor="middle" font-size="12" fill="currentColor">A/B 双绞线（特性阻抗约 120Ω），支线 stub 长度 &lt; 0.3 m</text>
</svg>

总线型意味着：任何一台设备的驱动器损坏常拉高，整条总线瘫痪。现场排查 485 故障的标准动作是逐个断开节点找出故障源。

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 传输模式 | 差分、半双工 | 一对 A/B 线，同时刻只能收或发 |
| 共模电压范围 | −7 V ~ +12 V | 接收端容忍 A/B 对地绝对电压 |
| 接收灵敏度 | ±200 mV | 差分 >+200 mV 判 1 |
| 最大节点数 | 32 / 128 / 256 | 取决于接收器单位负载（1 / 1/4 / 1/8 UL） |
| 速率 × 距离 | 反比 | 10 Mbps@12 m；100 kbps@1200 m |
| 终端电阻 | 120 Ω | **总线两端各一个**，消除末端反射 |
| 偏置电阻 | 上拉/下拉约 650 Ω | 空闲时保持 A>B（逻辑 1），防止噪声误判起始位 |

> ⚠️ 节点数超标不会立刻报错，而是信号幅度衰减、边沿变缓，表现为间歇性通信失败——看似随机，实为负载累积。32 节点以上必须选 1/4 或 1/8 单位负载的收发器（如 SP3485 系列）。

> ⚠️ 终端电阻只在两端各一个。中间设备的 120 Ω 跳线误闭合相当于并联负载，阻抗失配反而恶化信号。接线前确认每台设备的终端跳线状态。

---

## <span class="blue"> 半双工与 DE/RE 方向切换

UART 接到 RS-485 收发器（如 SP3485）上，多出一对方向控制信号：

<svg viewBox="0 0 700 200" xmlns="http://www.w3.org/2000/svg" style="max-width:700px;width:100%">
<rect x="20" y="55" width="150" height="90" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="95" y="95" text-anchor="middle" font-size="13" fill="currentColor">SoC</text>
<text x="95" y="112" text-anchor="middle" font-size="11" fill="currentColor">UART + GPIO</text>
<rect x="290" y="40" width="170" height="120" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="375" y="62" text-anchor="middle" font-size="13" fill="currentColor">RS-485 收发器</text>
<text x="375" y="80" text-anchor="middle" font-size="11" fill="currentColor">SP3485</text>
<line x1="170" y1="75" x2="290" y2="75" stroke="currentColor" stroke-width="1.5"/>
<polygon points="290,75 280,71 280,79" fill="currentColor"/>
<text x="200" y="68" font-size="11" fill="currentColor">TX → DI</text>
<line x1="290" y1="100" x2="170" y2="100" stroke="currentColor" stroke-width="1.5"/>
<polygon points="170,100 180,96 180,104" fill="currentColor"/>
<text x="200" y="94" font-size="11" fill="currentColor">RO → RX</text>
<line x1="170" y1="130" x2="290" y2="130" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5,3"/>
<polygon points="290,130 280,126 280,134" fill="currentColor"/>
<text x="185" y="124" font-size="11" fill="currentColor">GPIO → DE /RE</text>
<line x1="460" y1="70" x2="620" y2="70" stroke="currentColor" stroke-width="1.5"/>
<text x="630" y="74" font-size="13" fill="currentColor">A</text>
<line x1="460" y1="130" x2="620" y2="130" stroke="currentColor" stroke-width="1.5"/>
<text x="630" y="134" font-size="13" fill="currentColor">B</text>
<text x="500" y="180" font-size="11" fill="currentColor">DE 与 /RE 通常短接：高=发送，低=接收</text>
</svg>

切换时序是 485 最容易踩的坑：

```
GPIO(DE/RE)
  高 │      ┌─────┐
     │      │     │              ┌─────┐
  低 └──────┘     └──────────────┘     └───
        发送     接收                发送
        ▲       ▲
        │       └─ DE 拉低必须晚于 UART 发完最后一个 bit
        └─ DE 拉高必须早于 UART 发出第一个 bit
           （等发送保持寄存器空 TEMT，不是等 FIFO 空）
```

> ⚠️ 方向切换不及时产生**自收 echo**：发送的字节又回到自己的 RX FIFO，协议栈收到一串和发送一模一样的数据。对策是等 TEMT（发送彻底完成）再切接收，或使能驱动层的 echo 抑制。

### Linux 内核 RS485 模式（推荐）

用户态翻转 GPIO 控制 DE 有两个问题：Linux 非实时，TEMT 等待与 GPIO 翻转之间存在调度延迟；且 echo 处理全推给应用。内核 TTY 层提供了标准方案——**serial_rs485**：

```dts
&uart3 {
    status = "okay";
    rs485-rts-active-high;              // 用 RTS 引脚作 DE，发送时拉高
    linux,rs485-enabled-at-boot-time;   // 驱动 probe 时即进入 RS485 模式
    rts-gpios = <&gpio1 12 GPIO_ACTIVE_HIGH>;  // 或专用 GPIO 作 DE
};
```

```c
#include <linux/serial.h>
#include <sys/ioctl.h>

struct serial_rs485 rs485 = {0};
rs485.flags = SER_RS485_ENABLED | SER_RS485_RTS_ON_SEND;  // 发送时 RTS 拉高
ioctl(fd, TIOCSRS485, &rs485);
```

驱动在 `start_tx`/`stop_tx` 回调里自动控制 DE 时序，配合 FIFO 阈值把切换延迟压到微秒级——这比任何用户态方案都可靠。新项目优先走这条路，用户态 GPIO 翻转只在老驱动不支持时兜底。

---

## <span class="blue"> Modbus RTU 协议

Modbus 是 1979 年 Modicon（今施耐德）发布的协议，简单、开放、无许可费，工业自动化事实标准。RTU 是其二进制模式，跑在 RS-485（或 RS-232）上。

### 帧格式与边界判定

Modbus RTU 不用标志字节，靠**时间静默**划分帧：

```
  静默 ≥3.5T ┌──────┬──────┬────────┬───────┐ 静默 ≥3.5T
             │ 地址 │功能码│  数据  │ CRC16 │
             │ 1B   │ 1B   │  N B   │ 2B    │
             └──────┴──────┴────────┴───────┘
              帧内字节间隔必须 < 1.5T
```

T = 一个字符的传输时间。9600 bps 8N1 下 1 字符 = 10 bit ≈ 1.04 ms，3.5T ≈ 3.65 ms。

| 规则 | 含义 |
|------|------|
| 帧前静默 ≥3.5T | 帧开始 |
| 字节间隔 <1.5T | 属于同一帧 |
| 帧后静默 ≥3.5T | 帧结束 |

这条时间规则解释了为什么 Modbus 主站实现要保证字节间不被长时间打断——用户态程序被调度走 4 ms，从机就把半截帧当完整帧解析，CRC 必然错误。高负载系统上 Modbus 莫名 CRC 错误，先查调度延迟。

### 功能码

| 功能码 | 名称 | 典型用途 |
|--------|------|----------|
| 0x01 | 读线圈 | 继电器状态 |
| 0x02 | 读离散输入 | 开关量输入 |
| 0x03 | 读保持寄存器 | 配置参数、测量值（**最常用**） |
| 0x04 | 读输入寄存器 | ADC 采样值 |
| 0x05 | 写单个线圈 | 单个继电器（0xFF00 开 / 0x0000 关） |
| 0x06 | 写单个寄存器 | 修改单个参数 |
| 0x0F | 写多个线圈 | 批量控制 |
| 0x10 | 写多个寄存器 | 批量参数下发 |

> ⚠️ 地址 0 是**广播地址**：所有从机执行但不回复。从机地址必须从 1 开始分配——哪台设备误设成 0，它永远不会应答，表象是"这台通信不通"。

### 异常响应

从机无法执行时，功能码最高位置 1（+0x80），数据域放异常码：

| 异常码 | 含义 |
|--------|------|
| 0x01 | 非法功能码 |
| 0x02 | 非法数据地址 |
| 0x03 | 非法数据值 |
| 0x04 | 从机设备故障 |
| 0x06 | 从机忙 |

```
请求:  01 03 00 03 00 01 CRC     读 1 号从机保持寄存器 0x0003
响应:  01 83 02 CRC              0x83 = 0x03|0x80，异常码 0x02 非法地址
```

### CRC16

Modbus CRC16：多项式 `x^16+x^15+x^2+1`（反射形式 0xA001），初始值 0xFFFF，**低字节在前**发送。

```
帧 01 03 00 01 00 02 的 CRC = 0xCB95
线上字节序: 01 03 00 01 00 02 CB 95
                              └低  └高
```

调试时先用在线 CRC 计算器核对；抓到的 CRC 与计算值不符，先查字节序再怀疑硬件。

---

## <span class="blue"> 实例骨架：libmodbus 读温湿度变送器

工业场景典型连接：PLC 或嵌入式网关作主站，RS-485 挂温湿度变送器（地址拨码 = 1，9600 8N1，寄存器 0x0001 = 温度 ×0.1 °C，0x0002 = 湿度 ×0.1 %RH）。接线三原则：A→A、B→B、**GND 必须共地**；总线两端各 120 Ω。

libmodbus 最小应用骨架：

```c
#include <modbus/modbus.h>

modbus_t *ctx = modbus_new_rtu("/dev/ttyS3", 9600, 'N', 8, 1);
modbus_set_slave(ctx, 1);                       // 从机地址
modbus_set_response_timeout(ctx, 1, 0);         // 1 秒响应超时
modbus_connect(ctx);

uint16_t reg[2];
int rc = modbus_read_registers(ctx, 0x0001, 2, reg);   // 功能码 0x03
if (rc == 2) {
    printf("温度 %.1f°C  湿度 %.1f%%RH\n", reg[0] / 10.0, reg[1] / 10.0);
}

modbus_close(ctx);
modbus_free(ctx);
```

多从机轮询就是循环里 `modbus_set_slave()` 换地址再读，设备间留约 50 ms 间隔避免总线争抢。完整工程代码（错误重试、断线重连、CRC 验证演示）在扩展篇实战项目展开，这里掌握调用顺序即可。

抓包定位用 socat 做中间人，不抢占主程序的串口：

```bash
socat -x /dev/ttyS3,raw,echo=0,b9600 PTY,link=/dev/virtual_tty0
# 主程序改连 /dev/virtual_tty0，socat 的 -x 输出全量十六进制流量
```

---

## <span class="blue"> 排查锚点

RS-485 通信异常的标准排查流程，按序执行：

1. **量空闲电压**：万用表测 A−B，空闲应 >+200 mV（偏置正常）；接近 0 V 说明偏置缺失或总线无驱动；
2. **查终端电阻**：断电测总线 A-B 间电阻，两端各 120 Ω 并联应约 60 Ω；约 120 Ω 说明少一端，约 40 Ω 说明中间设备误接；
3. **核对参数**：地址、波特率、校验位三方一致（主站、从机、文档）；
4. **socat 抓包**：看物理层有没有数据、帧边界对不对；
5. **逐字节对 CRC**：帧在但 CRC 错，查字节序与调度延迟。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 差分总线 | 千米级、抗共模、多节点；代价是半双工管理、终端/偏置工程量 |
| 内核 RS485 模式 | DE 时序微秒级可靠；代价是依赖驱动支持，老平台需移植 |
| 用户态 GPIO 控 DE | 不挑驱动；代价是调度延迟不可控，echo 自己处理 |
| Modbus RTU | 帧紧凑、实现简单；代价是靠时间定帧边界，对主站实时性有要求 |
| Modbus TCP | 摆脱时序约束、走以太网；代价是协议栈重、现场需布网 |

---

## <span class="blue"> 常见陷阱

> ⚠️ DE 切换早于 TEMT：最后一个字节被截断或自收 echo。等发送保持寄存器空再切方向，或用内核 RS485 模式。

> ⚠️ 中间设备闭合 120 Ω 跳线：总线电阻实测约 40 Ω 即此问题。终端电阻只在物理两端。

> ⚠️ GND 不共地：A/B 是差分但共模范围只有 −7~+12 V，两地电位差超限直接烧收发器。长线系统必须带信号地线或加隔离收发器（如 ADM2483）。

> ⚠️ 从机地址设成 0：广播地址不应答，表象为单机"通信不通"，批量配置时极易踩。

> ⚠️ 用户态 Modbus 主站高负载下 CRC 错误频发：进程调度延迟撑破 1.5T 字节间隔。提高进程优先级（SCHED_FIFO）或移入内核态。

---

## <span class="blue"> 动手练习

1. **波形观察**：逻辑分析仪抓一段 Modbus RTU 通信，标出 3.5T 静默、地址、功能码、CRC 各字段，手工核对 CRC。
2. **终端电阻实验**：总线两端有/无 120 Ω 两种情况下对比示波器波形振铃，理解反射。
3. **内核模式验证**：设备树加 `rs485-rts-active-high` 后用 TIOCSRS485 使能，示波器量 DE 引脚与 TX 的时序关系。
4. **无硬件后备**：PC 上用 socat 建 PTY 对，一端跑 pymodbus 从机模拟器（或 diagslave），另一端用 libmodbus/pymodbus 主站读写寄存器——完整走通 RTU 帧收发与 CRC 验证，不需要任何 485 硬件。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 差分原理 | 看差值不看对地；共模抑制的意义 |
| 总线工程 | 两端 120 Ω、偏置保空闲态、stub<0.3 m、节点数与单位负载 |
| 方向切换 | DE/RE 时序要求；echo 成因；TEMT 等待 |
| 内核 RS485 | 设备树属性 + TIOCSRS485；优于用户态翻转 |
| Modbus 帧 | 3.5T/1.5T 静默定界；地址/功能码/数据/CRC 布局 |
| 功能码 | 03 读保持寄存器最常用；异常响应 +0x80 规则 |
| CRC16 | 0xA001 反射多项式、初值 0xFFFF、低字节在前 |
| 排查流程 | 电压→电阻→参数→抓包→CRC 五步法 |

---

## <span class="blue"> 配套资源

- **协议规范**：Modbus over Serial Line v1.02（施耐德）、TIA/EIA-485-A
- **库**：libmodbus（https://libmodbus.org）、pymodbus（含从机模拟）
- **内核源码**：`drivers/tty/serial/serial_core.c` 的 RS485 支持、`Documentation/driver-api/serial/serial-rs485.rst`
- **工具**：socat（中间人抓包）、diagslave（从机模拟器）、在线 CRC 计算器
- **器件手册**：SP3485（收发器）、ADM2483（隔离收发器）

---

## <span class="blue"> 下一步

UART 板块到此收尾：**B-B.5.4 实战篇** 用 NEO-6M GPS 模块把 4.1~4.3 串成完整项目——设备树使能、termios 编程、NMEA 解析与冷启动陷阱。之后进入 **B-B.6 I3C**：MIPI 联盟如何用两根线做到 12.5 MHz、带内中断与动态地址分配，低速传感器总线的现代化演进。

> 💡 螺旋衔接：内核 RS485 模式的 `rts-gpios` 与 B-B.2.1 的 GPIO 子系统直接衔接；Modbus 的寄存器读写模型与 B-B.3 I2C 的 regmap 抽象（内核 `regmap-mmio`/`regmap-i2c`）是同一种"地址-值"思维；TEMT 等待涉及的 FIFO 状态在 B-B.5.2 的 uart_port 结构里有对应字段。
