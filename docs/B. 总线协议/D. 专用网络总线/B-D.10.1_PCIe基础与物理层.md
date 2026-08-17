# B-D.10.1 PCIe 基础与物理层

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] Entry ~ [I] Intermediate | 预计阅读时间：40 分钟

## <span class="blue"> 本节导读

PCIe 是当代计算系统内部互连的事实标准：台式机上的显卡和 NVMe SSD、服务器上的网卡和加速卡、嵌入式 SoC 上的 WiFi 模组——全部走 PCIe。嵌入式工程师和 PCIe 打交道的典型场景有三个：SoC 出了几个 PCIe 口接了什么设备、设备树里 PCIe 控制器节点怎么配、`lspci` 输出里那堆字段什么意思。这三个场景的底层是同一件事：PCIe 链路和拓扑的工作原理。

本篇是 PCIe 系列的开篇，只讲**机制恒定**的部分——拓扑、Lane、三层架构、链路训练。这些内容从 2003 年 Gen1 到今天的 Gen6 基本没有变过；Gen4 之后的速率演进、信号完整性、AER 错误处理集中在 B-D.10.4 讲。本篇以 Gen1~Gen3 为教学基线，刻意不碰高速时代的复杂性——先把骨架立起来。

不要求任何 PCIe 背景，所有术语首次出现处就地解释。物理层底层机制（SerDes、均衡、眼图）的完整展开在 B-F.16.1，本篇只在接缝处指路。

本节覆盖：PCI 为什么被取代、点对点与共享总线的本质区别、RC/Switch/Endpoint 的树形拓扑、Lane 与链路宽度、TLP/DLLP/物理层三层分工、LTSSM 链路训练状态机、各代编码与有效带宽、参考时钟与热插拔概念。

---

## <span class="blue"> 为什么 PCIe 取代 PCI：从共享马路到专线

要理解 PCIe 的每个设计决策，先看清它要解决的问题。它的前辈 PCI 是一条**共享并行总线**：32 根地址/数据线复用，主板上的所有设备挂在同一把线上。这把线的运行方式像一场需要主持人的会议——

- 同一时刻只能有一对设备通信，其他设备等着。谁先用，由总线仲裁器裁决，等待本身是延迟。
- 所有设备瓜分总带宽。133 MB/s（32 位 @33 MHz）听着不少，四块卡各传数据时各得四分之一。
- 物理上是 32 根并行线加控制线共 120 多个引脚。频率从 33 MHz 提到 66 MHz 再往上时，并行总线的三堵墙（skew、引脚数、EMI）全部撞死——这在 B-F.16.1 开篇已经完整论证，不再重复。

PCIe 的应对是把假设整个反过来：**不再共享，每对设备之间拉一条专线**。这条专线是串行的——不要 32 根数据线，只要两对差分线；也不要主持人——专线上只有两端，不需要仲裁；带宽不够就堆专线数量（x4、x8、x16），而不是把时钟往高里硬推。

点对点带来一个常被忽视的后果：**总线上没有了"大家都能听见"的介质，广播和监听不复存在，一切都变成数据包交换**。设备之间不再直接共享线路，需要一个交换和路由结构把各条专线织成网——这就是下一节的树形拓扑。

---

## <span class="blue"> PCIe 在哪里：当代应用场景地图

零基础读者容易把 PCIe 想象成"台式机显卡插槽"——那只是它最显眼的一种形态。建立下面这张地图，后面每一篇的内容你都能找到自己的岗位对应点：

| 领域 | PCIe 在干什么 | 典型形态 |
|------|---------------|----------|
| 个人电脑/工作站 | 显卡、NVMe SSD、万兆网卡 | 板边插槽（x16/x4）、M.2 |
| 服务器/数据中心 | GPU 集群互联、NVMe 背板、智能网卡；CXL 内存扩展跑在同一物理层上（10.5） | Switch 组网、MCIO 铜缆、retimer 中继（10.4） |
| 嵌入式 SoC | WiFi/蓝牙模组、4G/5G Modem、NVMe 存储、外接 FPGA 加速器 | SoC 集成 RC 出 1~2 个口，M.2 或直接板贴 |
| 仪器仪表/测试测量 | 高速采集卡、FPGA 数据处理卡——主机与卡之间的数据主动脉 | 自定义 EP 卡（10.6 的实战对象） |
| 汽车 | 中央计算平台内部的 SoC 互联、智驾域控的加速芯片接入 | 板级互联，不出机箱 |
| 衍生封装 | USB4/Thunderbolt 把 PCIe 隧道化进 Type-C（B-F.16.5）；CXL 复用电气层跑内存语义（10.5） | 同一物理层，不同协议层 |

两个结构性认知：**嵌入式里 PCIe 的角色是"SoC 的高速外设扩展口"**——RK3568 这类 SoC 集成的 RC 就是用来接 WiFi 模组和 SSD 的；**仪器仪表里它是"采集数据的最后一公里"**——ADC 数据经 JESD204 进 FPGA（B-F.16.4），FPGA 整理后经 PCIe 进主机内存，两代高速串行技术在采集卡上首尾相接。

---

## <span class="blue"> 拓扑结构：Root Complex、Switch 与 Endpoint

PCIe 系统的组织是一棵树。树根只有一棵，枝叶可以很多：

<svg viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" style="max-width:760px;width:100%">
<rect x="280" y="15" width="200" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="380" y="42" text-anchor="middle" font-size="13" fill="currentColor">CPU + 内存控制器</text>
<rect x="290" y="85" width="180" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="380" y="112" text-anchor="middle" font-size="13" fill="currentColor">Root Complex（RC）</text>
<line x1="380" y1="60" x2="380" y2="85" stroke="currentColor" stroke-width="1.5"/>
<rect x="60" y="170" width="130" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="125" y="190" text-anchor="middle" font-size="12" fill="currentColor">Endpoint</text>
<text x="125" y="206" text-anchor="middle" font-size="11" fill="currentColor">WiFi 模组 x1</text>
<rect x="315" y="170" width="130" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="380" y="190" text-anchor="middle" font-size="12" fill="currentColor">PCIe Switch</text>
<text x="380" y="206" text-anchor="middle" font-size="11" fill="currentColor">上行 x4 → 下行多口</text>
<rect x="570" y="170" width="130" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="635" y="190" text-anchor="middle" font-size="12" fill="currentColor">Endpoint</text>
<text x="635" y="206" text-anchor="middle" font-size="11" fill="currentColor">NVMe SSD x4</text>
<line x1="320" y1="130" x2="150" y2="170" stroke="currentColor" stroke-width="1.5"/>
<line x1="380" y1="130" x2="380" y2="170" stroke="currentColor" stroke-width="1.5"/>
<line x1="440" y1="130" x2="610" y2="170" stroke="currentColor" stroke-width="1.5"/>
<rect x="240" y="265" width="120" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="300" y="285" text-anchor="middle" font-size="12" fill="currentColor">Endpoint</text>
<text x="300" y="301" text-anchor="middle" font-size="11" fill="currentColor">FPGA 加速卡 x8</text>
<rect x="410" y="265" width="120" height="45" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="470" y="285" text-anchor="middle" font-size="12" fill="currentColor">Endpoint</text>
<text x="470" y="301" text-anchor="middle" font-size="11" fill="currentColor">万兆网卡 x4</text>
<line x1="350" y1="215" x2="310" y2="265" stroke="currentColor" stroke-width="1.5"/>
<line x1="410" y1="215" x2="450" y2="265" stroke="currentColor" stroke-width="1.5"/>
</svg>

四个角色各记一句话：

> Root Complex（RC，根联合体）：PCIe 树的根，CPU 与 PCIe 域之间的门户。CPU 读写 PCIe 设备的每一个动作都经 RC 翻译成数据包发出；设备 DMA 读写内存也经 RC 进入内存子系统。SoC 的 RC 集成在芯片内部（RK3568 就集成一个 PCIe 3.0 RC），x86 平台上 RC 在 CPU 或 PCH 里。枚举、地址分配、中断汇聚都归它管——10.2 的枚举流程和 10.3 的 DMA，主语最终都是 RC。

> Endpoint（EP，端点）：树的叶子，真正干活的功能设备——显卡、网卡、NVMe SSD、FPGA 加速卡。EP 只响应请求和发起自己的事务，不为别人转发数据包。

**Switch（交换器）** 是树的中间节点：一个上行端口接父节点，多个下行端口接子节点，按数据包里的目标地址转发。它解决的是"RC 端口不够用"的问题——一颗 Switch 芯片把 1 个 x4 上行扩成 4 个下行口。服务器背板和多盘位扩展柜里全是它（Broadcom PEX 系列是代表）。**Bridge（桥）** 是协议转换器，用于 PCIe 接老式 PCI 设备，新设计中已经很少见。

这棵树在 Linux 里直接可见：

```text
-[0000:00]---00.0  Root Complex Host Bridge
           +-01.0-[01]----00.0  NVMe SSD
           +-02.0-[02]--+-00.0  Switch 上行口
           |            +-01.0-[03]----00.0  FPGA 加速卡
           |            +-02.0-[04]----00.0  万兆网卡
           +-03.0-[05]----00.0  WiFi 模组
```

这是 `lspci -tv` 的典型输出（10.2 会逐字段解读）：方括号里的数字是总线号，缩进即父子关系。读这棵树的能力就是把原理图、lspci 输出和驱动里的设备节点对上号。

---

## <span class="blue"> Lane 与链路宽度

> Lane：PCIe 链路的最小传输单元，由**两对**差分线组成——一对负责 A→B 方向（A 的 TX 接 B 的 RX），一对负责 B→A 方向。差分信号的原理（两根线传反相信号、接收端取差、共模噪声相消）在 B-F.16.1 讲过，这里直接用结论。

> 全双工：发送和接收各有独立的物理通道，两个方向同时传数据、互不占线。这和 CAN、RS-485 这类半双工总线（同一对线收发轮着用）形成对照——PCIe 标称的带宽数字，每个方向各自成立。

一条链路的宽度用 xN 表示：x1 是 1 条 Lane（两对差分线），x16 是 16 条 Lane（32 对差分线）。宽度在链路训练时协商，且**只取双方都支持的最大公约数**：

| 链路宽度 | 差分对数 | 典型设备 |
|:--------:|:--------:|----------|
| x1 | 2 对 | WiFi/蓝牙模组、声卡、低速扩展卡 |
| x4 | 8 对 | NVMe SSD、万兆网卡 |
| x8 | 16 对 | RAID 卡、FPGA 加速卡 |
| x16 | 32 对 | 显卡、GPU |

两个工程常识：

1. **物理插槽宽度 ≠ 实际接线宽度**。主板上一个 x16 长度的插槽，可能只接了 x4 的 Lane（省成本或 SoC 的 Lane 数不够）。x16 的卡插进去只能跑 x4 带宽。确认真实接线靠软件：`lspci -vv` 里的 `LnkCap`（插槽能力）与 `LnkSta`（协商结果），Width 一栏即真实 Lane 数。
2. **向下兼容是双向的**：x1 卡插 x16 插槽没问题（多余 Lane 悬空）；x16 卡插只接了 x4 的插槽也能工作（带宽降为四分之一）。宽度协商失败导致链路起不来的情况极少，多数"降宽度"其实是设计如此。

---

## <span class="blue"> 三层架构：TLP、DLLP 与物理层

PCIe 协议分三层，每层只跟对端设备的同一层对话。理解分层的价值在于排障定向：**故障症状落在哪一层，调查工具就指向哪一层**。

```text
┌─────────────────────────────────────────────┐
│ 事务层（Transaction Layer）                  │  ← 读写内存、读配置、发中断：TLP
├─────────────────────────────────────────────┤
│ 数据链路层（Data Link Layer）                │  ← 可靠传输：ACK/NAK 重传、流控：DLLP
├─────────────────────────────────────────────┤
│ 物理层（Physical Layer）                     │  ← 编码、串化、链路训练：SerDes
└─────────────────────────────────────────────┘
```

**事务层**是软件能直接感知的层。CPU 对设备的一切访问（读配置空间、写寄存器、设备 DMA 读写内存）都被事务层封装成数据包：

> TLP（Transaction Layer Packet，事务层数据包）：PCIe 数据交换的基本单位，由头部（类型、地址、长度）、可选数据载荷、可选 CRC 组成。TLP 分两大类——**Posted**（投递型，发完就走，不需要对方回应，如 Memory Write）和 **Non-Posted**（非投递型，必须等对方回一个 Completion TLP，如 Memory Read）。设备发起 DMA 写内存是 Posted，驱动读设备寄存器是 Non-Posted。

这层有两个排障时极有用的认知。其一，**Non-Posted 事务必然有回程包**——所以"驱动读寄存器卡死"意味着 Completion 没回来，问题在对端设备或链路，不在 CPU 侧代码。其二，中断也是 TLP：MSI/MSI-X 的本质是设备向一个特定内存地址发一个 Memory Write TLP——没有物理中断线，中断就是一笔写内存事务（寄存器配置面在 10.2，驱动代码面在 10.3）。

**数据链路层**解决一个朴素问题：串行线上传 TLP 会出错怎么办。它给每个 TLP 加序列号和 CRC，接收方校验无误回 ACK，出错回 NAK，发送方从**重传缓冲区（replay buffer）**里取出原包重发。这一切对事务层透明——事务层看到的是一个"不会丢包"的链路。

> DLLP（Data Link Layer Packet）：数据链路层自己使用的控制包，不传用户数据，只传 ACK/NAK 和流控信用。

> 流控信用（Flow Control Credit）：PCIe 防"发得比收得快"的机制。接收方事先把自己的缓冲空间折算成"信用数"（一个信用对应一个单位量的包，按包头/数据分开计），通过 DLLP 持续通告给发送方；发送方每发一个 TLP 就扣掉相应信用，信用扣光就必须停发，等对方消化缓冲后补充信用再继续。它与以太网的 PAUSE 帧思路相反——PAUSE 是"堵了才喊停"（被动刹车，喊出时已有丢包风险），信用制是"没额度就不许发"（主动配额，溢出在协议上不可能发生）。这层流控对软件完全透明，但理解它能解释一个现象：PCIe 链路永远不会因为"对端来不及收"而丢 TLP，性能下降的唯一形态是等信用。

这层的关键认知是：**链路层重传掩盖的是物理层误码**。当物理层误码率上升（信号完整性恶化），表现不是"数据出错"（CRC 拦住了），而是链路悄悄降速或延迟抖动——`lspci` 里的误码计数器和降速现象是同一枚硬币的两面（判读方法在 10.4）。

**物理层**负责把字节变成线上的串行比特：编码（下节）、串并转换、链路训练（LTSSM，下下节）。它的底层就是 SerDes，完整机制见 B-F.16.1。

---

## <span class="blue"> LTSSM：链路训练状态机

PCIe 链路不是上电就能用的。两端从"互不相识"到"全速传数据"，要走过一个自动化的状态机——**LTSSM（Link Training and Status State Machine）**。它由硬件独立完成，软件不干预，但它的状态直接决定了"设备认没认到"这类问题的调查方向。

```text
Detect ──► Polling ──► Configuration ──► L0（正常工作）
  ▲          │              │              │
  │          ▼              ▼              ▼
  └──── Recovery ◄──── L0s / L1（低功耗）
```

| 状态 | 在做什么 | 卡在这里意味着什么 |
|:----:|----------|--------------------|
| Detect | 发送端改变输出阻抗、探测对端是否有接收器接上 | 物理层没连接：没插卡、供电没上、PERST# 没释放 |
| Polling | 双方互发训练序列（TS1/TS2 有序集），完成位锁定与符号锁定，协商速率 | 信号质量问题：时钟不对、差分线断一根、速率协商不拢 |
| Configuration | 协商 Lane 数量、Lane 编号映射、极性翻转自动纠正 | 布线/映射问题：Lane 接错序 |
| L0 | 链路全通，TLP/DLLP 正常交换 | ——正常状态 |
| Recovery | 链路出错或需改变速率/宽度时，从 L0 回到这里重新训练 | 偶发 Recovery 是误码上升的征兆 |
| L0s/L1 | 省电状态：L0s 浅睡微秒级唤醒，L1 深睡省电更多、唤醒更慢 | 低功耗引起的延迟毛刺常源于此 |

三个对嵌入式工程师最有用的要点：

1. **速率协商发生在 Polling，宽度协商发生在 Configuration**。两端各自报能力，取交集——所以 x16 卡插在只接了 x4 的插槽上能正常工作，是状态机按规则谈出来的结果。
2. **Recovery 是链路的自我保护**。误码率高到一定程度，链路自动回 Recovery 重新训练；你在日志里看到链路速率从 Gen4 掉到 Gen2，往往就是反复 Recovery 后双方"退而求其次"的结果。
3. **软件可见的落点**：LTSSM 的细节藏在硬件里，但协商结果完全透明——`lspci -vv` 的 `LnkCap`/`LnkSta` 就是状态机的最终成绩单。Gen4 的卡跑在 Gen2 不是"协议脾气"，是训练失败的实锤（降速定位的完整方法论在 10.4）。

---

## <span class="blue"> 编码与有效带宽：Gen1~Gen3 基线

链路的原始速率和实际能用的带宽之间隔着编码开销。符号率（GT/s）与比特率（Gbps）的区别及编码开销的来历在 B-F.16.1 的「符号率与比特率」卡片里已展开，这里直接给 PCIe 各代对照表：

| 世代 | 符号率 | 编码 | 开销 | 每 Lane 有效带宽（单向） | x16 总带宽（单向） | 推出年份 |
|:----:|:------:|:----:|:----:|:----------------------:|:----------------:|:--------:|
| Gen 1 | 2.5 GT/s | 8b/10b | 20% | ~250 MB/s | ~4 GB/s | 2003 |
| Gen 2 | 5.0 GT/s | 8b/10b | 20% | ~500 MB/s | ~8 GB/s | 2007 |
| Gen 3 | 8.0 GT/s | 128b/130b | 1.5% | ~1 GB/s | ~16 GB/s | 2010 |
| Gen 4 | 16.0 GT/s | 128b/130b | 1.5% | ~2 GB/s | ~32 GB/s | 2017 |
| Gen 5 | 32.0 GT/s | 128b/130b | 1.5% | ~4 GB/s | ~64 GB/s | 2019 |

教学基线要理解的两件事：

**Gen1/2 的 8b/10b**：每 8 bit 数据编成 10 bit 发送，用 20% 的税率换来跳变密度和直流平衡（机制见 F.16.1）。所以 Gen1 的 2.5 GT/s 实际数据率只有 2 Gbps，折算约 250 MB/s。

**Gen3 的关键一跳**：速率从 5 GT/s 提到 8 GT/s（只提了 60%），但有效带宽**翻倍**——因为编码从 8b/10b 换成 128b/130b，税率从 20% 降到 1.5%。Gen3 用"更聪明的编码"而不是"更快的信号"拿到了大部分提升，这是 PCIe 演进史上性价比最高的一步。Gen4/5 则是纯粹的符号率翻倍，代价全压在信号完整性上——那是 10.4 的故事。

带宽估算口诀：**每 Lane 每代约 250/500/1000/2000/4000 MB/s**，乘 Lane 数即可。一张 NVMe SSD 标称读速 3.5 GB/s，跑在 Gen3 x4（约 4 GB/s）上刚好打满，插到 Gen2 x4（约 2 GB/s）上立刻腰斩——SSD 性能不达标先查协商速率，是性价比最高的一步排查。

---

## <span class="blue"> 参考时钟、复位与热插拔

数据 Lane 之外，一条 PCIe 链路还有几根低速但关键的边带信号：

| 信号 | 方向 | 作用 |
|:----:|:----:|------|
| REFCLK± | 两端各自输入 | 100 MHz 差分参考时钟，SerDes 的 PLL 以它为基准倍频出 GHz 发送时钟。精度要求 ±300 ppm，常带扩频（SSC）——时钟配置错误是链路训练失败的经典原因（F.16.1 的软件把手一节） |
| PERST# | RC → 设备 | 全局复位，低有效。设备必须在 PERST# 释放后才进入 Detect——复位时序不满足会导致设备偶发认不到 |
| WAKE# | 设备 → RC | 低功耗状态下请求唤醒链路 |
| PRSNT1#/2# | 插槽检测 | 卡存在检测，热插拔的物理基础 |

**热插拔（Hot Plug）**在 PCIe 设计之初就是一等公民：服务器换盘、换网卡不关机。硬件上靠 PRSNT# 引脚检测插拔，软件上由操作系统的热插拔控制器（Linux 的 `pciehp` 驱动）完成断电、移除设备节点、重新枚举这一套流程。概念层面记住一点就够：**热插拔在协议上是"受控的链路消失与重建"**——LTSSM 回 Detect，再走一遍训练流程。意外移除（链路突然断掉）对驱动是另一回事，10.4 再讲。

---

## <span class="blue"> 与 PCI 的软件兼容性：为什么二十年前的驱动还能用

PCIe 最精妙的设计决策是：**硬件完全不同，软件模型原样保留**。PCI 时代的三样东西——BDF 地址（总线:设备:功能号）、256 字节配置空间、BAR 寄存器——在 PCIe 里全部保留，枚举流程、地址分配、驱动匹配方式一脉相承。一个 2003 年写的 PCI 网卡驱动，原则上不加修改就能驱动今天的 PCIe 网卡。

实现这一点靠的正是三层架构的分工：配置空间访问、BAR 读写这些"软件看得见"的操作，被事务层统一封装成 TLP 在串行链路上传输——**软件模型不变，底层传输换掉**。这也让 PCIe 的知识结构清晰分层：本篇讲的链路/拓扑是新东西，10.2 讲的枚举与配置空间则是 PCI 时代传下来的老模型，两者拼在一起才是完整的 PCIe。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 点对点 vs 共享总线 | 无仲裁、带宽独享、可堆 Lane 扩展；代价是需要 Switch 组网、引脚转向高速 SerDes 的模拟复杂度 |
| 串行 vs 并行 | 引脚/skew/EMI 全胜（F.16.1 论证）；代价是把问题转移给信道与均衡 |
| 8b/10b vs 128b/130b | 简单成熟 vs 税率 20%→1.5%；Gen3 带宽翻倍的主要来源 |
| 宽度扩展 vs 提频 | x1→x16 线性扩展、SI 压力不变；提频带宽翻倍但信道预算骤紧（10.4 的主线矛盾） |
| 硬件自动训练 vs 软件干预 | 训练快且标准化；代价是出问题时软件只能看结果（LnkSta）不能改过程，定位依赖经验方法论 |

---

## <span class="blue"> 本节总结

| 自查项 | 读完应能独立完成的动作 |
|--------|------------------------|
| 取代动因 | 说清共享总线的仲裁/带宽/引脚三个局限，以及点对点串行如何一次性解决 |
| 拓扑 | 给一段 `lspci -tv` 输出，指出 RC、Switch、EP 各是谁，说出树形父子关系 |
| Lane 与宽度 | 解释 x4 卡插 x16 槽、x16 卡插 x4 布线各会发生什么；区分物理插槽宽度与实际接线 |
| 三层架构 | 说出 TLP/DLLP/物理层各管什么；解释"读寄存器卡死"为什么问题在对端 |
| 中断形态 | 说清 MSI 的本质是一笔 Memory Write TLP，没有物理中断线 |
| LTSSM | 说出主干状态顺序；根据"卡在 Detect / Polling / Configuration"分别给出第一怀疑对象 |
| 带宽 | 用口诀估算任意 Gen/宽度组合的有效带宽；判断 SSD 性能不达标是否源于降速 |
| 边带信号 | 说出 REFCLK/PERST# 的作用及各自出错时的症状方向 |

---

## <span class="blue"> 配套资源

- **规范**：PCIe Base Specification（PCI-SIG 官网，Physical Layer / Transaction Layer 章节）
- **内核文档**：`Documentation/PCI/`（内核源码树）
- **工具**：`lspci -tv`（拓扑）、`lspci -vv`（LnkCap/LnkSta）、`setpci`（寄存器读写）——10.2 逐段解读输出
- **衔接**：B-F.16.1（SerDes/均衡/眼图的完整机制）；B-D.10.2（枚举与配置空间）；B-D.10.4（Gen4+ 演进与降速定位）
