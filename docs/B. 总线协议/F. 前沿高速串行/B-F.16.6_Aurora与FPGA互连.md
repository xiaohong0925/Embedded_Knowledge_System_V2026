# B-F.16.6 Aurora 与 FPGA 互连

> 所属章节：第五部 B. 总线协议 > F. 前沿高速串行
>
> 难度：[M] | 预计阅读时间：30 分钟

## 本节导读

前面几篇讲的 SerDes 协议（PCIe、JESD204C、USB4）都有完整的标准组织和沉重的协议栈。但 FPGA 世界里还有一类完全不同的需求：两块 FPGA 之间、FPGA 与自定义板卡之间，只想**简单、低开销、低延迟地搬数据**，不需要枚举、不需要命令队列、不需要操作系统。AMD（Xilinx）的 Aurora 就是为这个场景设计的轻量级链路层协议——它大概是 SerDes 世界里"最小可用"的协议实现。

嵌入式工程师遇到 Aurora 的典型场景：高速数据采集系统（FPGA 采集后灌给另一片做处理）、雷达/声呐前端互联、自定义背板链路，以及 Zynq 这类 SoC+FPGA 器件上"PL 侧数据进 Linux"的最后一公里。

本节覆盖：Aurora 的定位与协议结构（8B/10B 与 64B/66B 两个版本）、帧与控制符、流量控制与通道绑定、Vivado 里的 IP 核配置与回环验证、与 PCIe/JESD204C 的选型对比、PL→PS 数据进 Linux 的完整路径。

先修：B-F.16.1 SerDes 通识（均衡、眼图）；B-F.16.4 JESD204C 可对照阅读。

## 定位：协议栈的"极简主义"

对比最能说明问题：

| 维度 | PCIe | JESD204C | Aurora |
|------|------|----------|--------|
| 设计目标 | 通用计算互联 | 转换器专用 | 点对点搬数据 |
| 协议层数 | 事务/数据链路/物理三层 | 链路/传输两层 | **一层链路协议** |
| 寻址与枚举 | 完整（BDF、配置空间） | 无（参数静态配置） | 无 |
| 流量控制 | 信用制 | 无 | NFC/UFC（可选） |
| 差错处理 | ACK/NAK 重传 | 无（告警） | 无（CRC 可选） |
| 实现代价 | 重（硬核或大量逻辑） | 中 | **极轻（几千 LUT）** |
| 主芯片 | AMD GT / 各家 SerDes | 同左 | 同左 |

Aurora 的哲学是：把 SerDes 物理层之上的一切裁到最少，只保留"把字节流可靠地从 A 搬到 B"所必需的东西——帧定界、时钟补偿、可选的流控。适合"链路两端都是我设计"的封闭系统；需要接第三方设备或操作系统的场景，它帮不上忙。

## 协议结构：两个版本

**Aurora 8B/10B**：经典版本，用于较低速率（≤6.6 Gbit/s/lane）的老 GT。8B/10B 编码自带丰富的控制符（K 码），协议开销 25%，但控制与定界极其简单，逻辑资源最省。

**Aurora 64B/66B**：高速版本（最高 32 Gbit/s/lane），编码开销仅 3%，控制信息改用同步头与专门的控制块传递。新设计默认选它。

> K 码（K-character）：8B/10B 编码中一类特殊码字，与数据码字（D 码）在电平上可区分，用于帧定界、时钟补偿等带外信令——接收端不需要额外信号线就能认出"这不是数据"。Aurora 8B/10B 用 `/A/`、`/R/` 等 K 码做空闲填充与对齐。

### 数据流与控制符

Aurora 把链路抽象为**连续字节流**，帧是可选的：

```
流模式（Streaming）：  data data data data data ...   （无帧结构，纯管道）
帧模式（Framing）：    /SCP/ data data ... /ECP/ /SCP/ data ... /ECP/
                       帧起始          帧结束
```

关键控制元素：

| 元素 | 作用 |
|------|------|
| SCP / ECP | 帧起始/结束定界（帧模式） |
| CC（Clock Compensation） | 周期插入的空闲序列，吸收两端晶振的 ppm 级频差 |
| UFC（User Flow Control） | 应用层信令通道（给对端发短消息） |
| NFC（Native Flow Control） | 接收端反压："我满了，暂停发" |

> 时钟补偿（Clock Compensation）：链路两端各用自己的参考时钟，标称同频但实际差几十 ppm，长期累积收发会失步。发送端周期插入 CC 序列，接收端的弹性缓冲（elastic buffer）按水位丢弃或重复这些空闲符号，把频差吸收掉。所有无时钟线的 SerDes 协议都有这一机制，Aurora 是最简单的实例。

### 通道绑定（Channel Bonding）

多 lane 时，各 lane 的走线长度差会造成 lane 间偏移（skew）。Aurora 在每个 lane 的同一时刻发一个特殊对齐序列，接收端用弹性缓冲把各 lane 重新对齐，对外呈现一条逻辑上的宽链路。这与 PCIe 的 lane-to-lane deskew 是同一原理的轻量实现。

## Vivado 实战：IP 核配置与回环验证

Aurora 在 Vivado 里是现成 IP 核（`Aurora 8B/10B` / `Aurora 64B/66B`），典型配置项：

```
Core:
  Lane width      : 4 bytes（数据路径宽度，影响内部时钟频率）
  Line rate       : 10.3125 Gbps
  Reference clock : 156.25 MHz（板载晶振）
  Lanes           : 4
  Data flow       : Duplex（全双工）/ Simplex-TX / Simplex-RX
  Framing         : Streaming 或 Framing（AXI4-Stream 接口）
  Flow control    : None / UFC / NFC
  CRC             : 可选
```

用户侧接口是标准的 AXI4-Stream（`s_axis_tx_tdata/tvalid/tready` 发，`m_axis_rx_*` 收），FPGA 逻辑把数据往 TX 口一推就走，门槛极低。

**回环验证三板斧**：

1. **IP 核自带 example design**：右键 IP → Open IP Example Design，Vivado 自动生成带测试激励的完整工程，含帧发生器与校验器，上板即跑
2. **近端回环（near-end loopback）**：GT 内部把 TX 环回 RX，不经过外部信道，验证逻辑与配置正确
3. **IBERT 眼图扫描**：换用 IBERT IP（集成误码率测试仪）对真实信道扫眼图、测 BER——B-F.16.1 的眼图知识在这里直接用上

状态信号里 `channel_up`（链路就绪）和 `lane_up[n]`（各 lane 就绪）是调试入口：`channel_up` 不亮，先查参考时钟有无、GT 复位时序、线路极性（P/N 反接是经典错误，GT 大多支持极性翻转修复）。

## PL 数据进 Linux：Zynq/MPSoC 的最后一公里

常见系统拓扑：Aurora 从远端板卡收高速数据进 FPGA（PL），PL 经 DMA 写入 PS（ARM 核）的 DDR，Linux 应用读走。

```
远端板卡 ──Aurora──► FPGA(PL) ──AXI DMA──► DDR ──► Linux 应用
                        │                    ▲
                        └── 中断：帧/块完成 ──┘
```

Linux 侧的两种做法：

- **UIO 方式**（快糙猛）：设备树声明 DMA 与中断，用户态 `mmap` UIO 节点直接读写 DMA 寄存器与缓冲区。适合原型验证
- **正经字符驱动**：probe 里 `dma_alloc_coherent` 分配环形缓冲，中断里推生产指针，用户态 `read/poll` 取数据——结构与 B-D.10.3 PCIe DMA 驱动完全同构，只是数据来源从 PCIe 链路换成了 PL 侧 AXI

性能要点：AXI 总线位宽（64/128bit）× 频率决定 PL→PS 的上限，算带宽账时把它和 Aurora 链路带宽一起列——瓶颈在窄的那一段。

## 选型：什么时候用 Aurora

| 需求 | 选择 |
|------|------|
| 两端都是自家 FPGA/板卡，纯搬数据 | **Aurora**（最省逻辑、最低延迟） |
| 接 ADC/DAC 芯片 | JESD204C（芯片只认这个） |
| 需要操作系统/驱动生态、接标准外设 | PCIe |
| 多板卡交换式互联（不常用） | Serial RapidIO |
| 标准化背板互联 | PCIe 或以太网（10G/25G 用 FPGA GT 跑） |

Aurora 的护城河就是"轻"：逻辑资源省一个数量级、延迟是确定的百纳秒级、协议简单到可以整个读懂。代价是生态为零——换家 FPGA 厂（Intel/Altera）就得换实现（Transceiver Native PHY + 自定义协议，或用开源的 Aurora 兼容实现），跨厂商互联不要用 Aurora。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 定位 | 用"轻/重"维度对比 Aurora 与 PCIe/JESD204C，说出各自适用边界 |
| 协议结构 | 解释 SCP/ECP/CC/UFC/NFC 各自作用，说明 CC 吸收的物理问题 |
| 多 lane | 解释通道绑定与 deskew 的原理 |
| 工具链 | 在 Vivado 配出 Aurora IP，用 example design + IBERT 完成回环与眼图验证 |
| 系统路径 | 画出 Aurora→PL→AXI DMA→DDR→Linux 的完整数据通路并找出带宽瓶颈 |
| 排障 | `channel_up` 不亮时按时钟→复位→极性→参考源的顺序排查 |

## 配套资源

- AMD 官方文档：PG046（Aurora 8B/10B）、PG074（Aurora 64B/66B）
- IBERT 文档：PG132（集成误码率测试仪）
- Vivado IP Example Design（右键 IP 核自动生成，最快上手路径）
- AXI DMA 驱动参考：`drivers/dma/xilinx/`
