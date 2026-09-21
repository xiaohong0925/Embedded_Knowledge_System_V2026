# B-D.10.4 PCIe 进阶：Gen4/5/6、信号完整性与 AER

> 所属章节：第五部 B. 总线协议 > B-D.10 PCIe
>
> 难度：[M] Master | 预计阅读时间：45 分钟

## <span class="blue"> 本节导读

10.1~10.3 以 Gen1~Gen3 为基线，讲了 PCIe 机制恒定的部分。本篇处理"时代内容"：2017 年之后 PCIe 进入两年一代的提速期，Gen4（16 GT/s）、Gen5（32 GT/s）、Gen6（64 GT/s）接连落地。对写驱动的人来说，这些变化大部分是透明的；但对做板卡、做整机、负责 bring-up 的工程师来说，**Gen4 是一个分水岭**——从这代开始，信号完整性从硬件团队的内部事务变成每个参与者的日常议题：链路训练失败、协商降速、AER 报错刷屏，都是这条主线上的典型工单。

本篇的先修是 B-F.16.1——均衡、眼图、信道预算、抖动分解的完整机制都在那里，本篇不再重复，只讲"PCIe 如何把这些机制用起来"以及"出问题怎么定位"。读本篇的正确姿势是手里有一块真实的板子或一张真实的卡：每个方法论都落在 `lspci` 和 dmesg 的真实输出上。

本节覆盖：Gen1~Gen6 演进总览、Gen4/5 的均衡训练机制（preset 与四个 Phase）、Gen6 的三大机制变革（PAM4/FLIT/FEC）与 L0p、降速定位的完整决策树、AER 错误报告体系与 dmesg 判读、热插拔的实战面、PCIe 链路器件与线缆生态。

---

## <span class="blue"> 速率演进总览：每代到底改了什么

| 世代 | 符号率 | 编码/调制 | 关键机制变化 | 落地年份 |
|:----:|:------:|-----------|--------------|:--------:|
| Gen 1 | 2.5 GT/s | 8b/10b NRZ | 起点 | 2003 |
| Gen 2 | 5.0 GT/s | 8b/10b NRZ | 单纯提频 | 2007 |
| Gen 3 | 8.0 GT/s | 128b/130b NRZ | **编码革命**（20%→1.5% 开销）+ 引入链路均衡训练 | 2010 |
| Gen 4 | 16.0 GT/s | 128b/130b NRZ | 单纯提频，SI 压力陡增，retimer 普及 | 2017 |
| Gen 5 | 32.0 GT/s | 128b/130b NRZ | 同上，预算更紧 | 2019 |
| Gen 6 | 64.0 GT/s | **PAM4** | **三大变革**：PAM4 调制 + FLIT 定长包 + FEC 强制；新增 L0p | 2022 |

读这张表抓住两个结构性事实：

1. **Gen3 是编码的胜利，Gen4/5 是纯粹的提速，Gen6 是换了一条赛道**。Gen3~Gen5 共享同一套编码和架构，差异只在信道预算的紧张程度；Gen6 则同时换了调制方式、包格式、纠错机制——它对"经典 PCIe"知识的兼容度最低，也是本篇单列一节的原因。
2. **均衡训练从 Gen3 就已存在，但到 Gen4 才成为故障高发区**。8 GT/s 时信道余量大，训练随便过；16 GT/s 起信道预算收紧，preset 选择开始决定生死。

---

## <span class="blue"> Gen4/5：均衡训练与 preset

### 为什么训练变得关键

16 GT/s 的 Nyquist 频率是 8 GHz，规范给出的端到端插损预算约 28 dB（含义与心算方法见 F.16.1「信道预算」一节）。一块普通的 FR4 主板走线 20 cm 再加一个连接器，预算就见底了。于是 PCIe 把"发送端用多少预加重"从硬件固定参数变成了**上电时双方协商出来的结果**——这就是链路均衡训练（Link Equalization）。

### 训练的四个 Phase

训练复用 LTSSM 的 Recovery 状态完成，分四个阶段，核心逻辑是**双方轮流当对方的"眼睛"**：

```text
Phase 0  下行设备（EP）按上行端口（RC）在 TS 序列里广播的初始 preset 起步
Phase 1  双方交换 TS1，各自粗调接收端，建立可用但未必最优的链路
Phase 2  EP 评估收到的信号质量，向 RC 请求调整 RC 发送端的 preset——
         "你换 P7 发一次我看看" 如此反复，直到 EP 的眼图最优
Phase 3  角色互换：RC 评估并指挥 EP 的发送端 preset
```

> preset：PCIe Gen3+ 标准化的 11 组发送端均衡参数（P0~P10），每组是 de-emphasis（去加重）与 pre-shoot（预冲）的不同组合。它们就是 F.16.1 讲的 FFE 在 PCIe 里的具体形态——训练过程本质是"试遍若干组 FFE 参数，选对方眼图最好的一组"。

训练的产物完全软件可见：PHY/控制器的链路状态寄存器里有每 Lane 选定的 preset 值与均衡成功标志，原厂工具和部分 `lspci -vvvv` 扩展可以读出。**训练失败（Equalization Timeout / Phase 卡死）的直接后果就是降速**——双方退回上一代速率重新训练，这引出了本篇的核心方法论。

### 均衡状态的软件观测

Gen3+ 设备的 PCIe Capability 里有一组专门记录均衡结果的字段，`lspci -vvvv` 的 `LnkSta2` 行就是它们的解码：

```text
LnkCap2: Supported Link Speeds: 2.5-16.0GT/s ...
LnkSta2: Current De-emphasis Level: -6dB, EqualizationComplete+,
         EqualizationPhase1+, EqualizationPhase2+, EqualizationPhase3+,
         LinkEqualizationRequest-
```

逐字段读法：

| 字段 | 含义 | 异常形态 |
|------|------|---------|
| `Current De-emphasis Level` | 当前生效的发送去加重档位（preset 换算结果） | 与对端期望档位不符，说明训练没走完就"将就"了 |
| `EqualizationComplete+/-` | 四个 Phase 是否全部完成 | `-` = 均衡没做完，链路处于"能通但非最优"状态 |
| `EqualizationPhase1/2/3+/-` | 每个 Phase 各自的成功标志 | 某个 Phase 为 `-` 可定位卡在哪一段（Phase2 挂=RC 发送端方向信道差，Phase3 挂=EP 方向） |
| `LinkEqualizationRequest` | 有一方正在请求重新均衡 | 偶发置位正常，频繁置位=信道不稳 |

这组字段把"降速了"细分成三种性质不同的情况：**Phase 全 + 但速率低**——训练完成了但双方主动选了低速率（初始协商就降级，查 LnkCap2 的支持列表与固件限速配置）；**某个 Phase 为 -**——训练中途失败退回，信道问题实锤；**EqualizationComplete- 且速率正常**——均衡被跳过（部分平台为省启动时间），链路工作在非最优状态，高温/老化后可能出问题。

> ⚠️ `LnkSta2` 需要 `lspci -vvvv`（四个 v）才显示，且只对 Gen3 及以上设备有意义。Gen1/Gen2 链路没有均衡训练，这些位不存在。

---

## <span class="blue"> Gen6：三个不得不做的变革

Gen4→Gen5 的老路（单纯提频）在 64 GT/s 走不通了：32 GHz 的 Nyquist 频率下，现有板材和连接器的损耗大到没有任何均衡组合能补回来。Gen6 的解法是同时动三处手术：

### PAM4：频率不动，每个符号多带一倍

64 GT/s 的 PAM4 实际波特率是 32 GBd——和 Gen5 的 NRZ 同频率，但每个符号用 4 个电平带 2 bit，带宽翻倍。代价在 F.16.1 已定量讲过：相邻电平间距缩到 1/3，信噪比预算损失约 9.5 dB，**裸误码率恶化到 10⁻⁴ 量级**——这在 NRZ 时代是不可工作的，于是引出第二个变革。

### FLIT：定长包格式

> FLIT（Flow Control Unit，流控单元）：Gen6 起 PCIe 传输的固定长度（256 字节）数据单元。变长 TLP 被打包装进定长 FLIT 里传输。改定长的原因很实际：FEC 纠错需要一个固定的纠错块边界，让 CRC 和纠错码以可预测的粒度工作；同时定长单元大幅简化了链路层的流控与重传设计。

对软件的可见影响几乎为零——事务层的 TLP 语义原样保留，配置空间、BAR、MSI 全部不变。FLIT 是物理/链路层的内部封装，这正是"驱动模型对速率代次无感"的又一次验证。

### FEC：从可选到必选

NRZ 时代 PCIe 裸误码率低于 10⁻¹²，CRC 校验加链路层重传（10.1 的 ACK/NAK）足够兜底。PAM4 的 10⁻⁴ 裸误码率下重传会变成常态、带宽被重传吃掉，所以 Gen6 引入前向纠错：每个 FLIT 附带纠错码，接收端实时纠正零星误码，残余误码率压回 10⁻¹² 目标线以下。FEC 引入固定延迟，这也是 Gen6 链路延迟略高于 Gen5 的原因。

### L0p：宽度随负载伸缩

> L0p：Gen6 新增的低功耗机制，链路**保持 L0 工作态的同时动态收窄宽度**——空闲时 x16 链路降到 x8 甚至 x1 省电，负载来了再扩回去，全程不需要回到 Recovery 重新训练。此前的低功耗状态（L0s/L1，见 10.1）都是整条链路一起睡，L0p 第一次实现"只关一半车道"。

---

## <span class="blue"> 降速定位：一套完整的决策树

「Gen4 的卡跑在 Gen2」是 PCIe 板卡工程师最常见的工单。定位流程按下面的决策树走，每一步都有明确的证据来源：

```text
发现降速（lspci: LnkSta < LnkCap）
│
├─ ① 宽度降了（Width x4 → x1）？
│     ├─ 是 → 查布线/ bifurcation：主板插槽实际接线、BIOS 的链路拆分配置
│     │       （x16 拆 4×x4）、设备树/固件的 Lane 映射——Lane 断一根就是宽度减半
│     └─ 否 → ②
│
├─ ② 速率降了（Speed 16GT/s → 8GT/s）？
│     ├─ 看 dmesg 有没有 equalization timeout / link retrain 记录 → 均衡训练失败实锤
│     ├─ 查参考时钟：REFCLK 频率、精度、SSC 两端是否匹配（F.16.1 软件把手之一）
│     ├─ 查 AER 计数（下一节）：Corrected Error 持续上涨 = 信道质量差的旁证
│     └─ 对照信道预算：走线长度、连接器数量、板材——超出预算则靠 retimer 补救
│
└─ ③ 偶发降速（重启后恢复）？
      └─ 供电与温度：PHY 供电纹波、高温下 jitter 恶化——间歇性降速的经典根源
```

三个要点：

1. **LnkCap 是"能力"，LnkSta 是"现状"**——降速判断的唯一入口是这两者对比，任何性能类工单先看这对字段。
2. **降速是协议的保护动作，不是故障本身**——均衡训练谈不拢的双方退而求其次。接受"能跑就行"等于掩盖 SI 问题，量产老化后故障率会找上门。
3. **降速与误码是同因异果**——信道差的时候，协商阶段表现为降速，工作阶段表现为 AER 误码计数上涨。两者一起看才是完整的信道健康画像。

### 实战案例：Gen4 采集卡协商到 Gen3

一块自研 FPGA 采集卡（Gen4 x4）在某客户主板上只协商出 Gen3 x4，带宽从约 8 GB/s 掉到 4 GB/s。按决策树走一遍：

```bash
# 第一步：确认现状与能力的差距
lspci -s 03:00.0 -vv | grep -E "LnkCap:|LnkSta:"
```

```text
LnkCap: Port #0, Speed 16.0GT/s, Width x4, ASPM L0s L1 ...
LnkSta: Speed 8.0GT/s (downgraded), Width x4 (OK)
```

宽度 OK、速率降了一代——进决策树分支②。`downgraded` 字样本身就是协议在告诉你"我试过更高速率，没谈拢"。

```bash
# 第二步：看均衡训练四 Phase 的完成情况
lspci -s 03:00.0 -vvvv | grep LnkSta2
```

```text
LnkSta2: Current De-emphasis Level: -6dB, EqualizationComplete-,
         EqualizationPhase1+, EqualizationPhase2+, EqualizationPhase3-
```

Phase 1/2 成功、**Phase 3 失败、整体未完成**——卡在"RC 指挥 EP 调发送端"那一段，即采集卡→主机方向的信道质量不达标。

```bash
# 第三步：看 AER 旁证（当前跑在 Gen3 也掩盖不住信道劣化）
cat /sys/bus/pci/devices/0000:03:00.0/aer_dev_correctable
```

```text
RxErr+ 1523
BadTLP+ 87
```

Corrected 计数已上万次量级（RxErr 是接收端物理层错误）——链路连 Gen3 都跑得不安稳。

```bash
# 第四步：看 dmesg 有没有训练失败记录
dmesg | grep -iE "equalization|retrain|link"
```

```text
pcieport 0000:00:02.0: pciehp: ... 
pci 0000:03:00.0: 8.0 GT/s: link retrained after equalization failure
```

四方证据齐了：Phase 3 失败 + AER 计数上涨 + retrain 日志 + 降速。结论指向**采集卡发送方向到 RC 接收方向的信道**——查这张卡的金手指触点、连接器插损、以及主板上这段走线的预算。本例最终定位是客户主板该插槽走线过长且无 retimer，换带 retimer 的插槽（或降频接受 Gen3）二选一。

这个案例的方法论价值在于：**四个证据源（LnkSta / LnkSta2 / AER / dmesg）互相印证**，任何一个单独看都可能误判——只看 LnkSta 会说"降速了"，加上 LnkSta2 才知道卡在哪个 Phase，加上 AER 才知道劣化程度，加上 dmesg 才确认是训练失败而非主动限速。

---

## <span class="blue"> AER：PCIe 的错误报告体系

> AER（Advanced Error Reporting）：PCIe 的高级错误报告机制，定义在 Extended Capability 区（10.2 的扩展能力链表）。设备把检测到的错误按严重程度分级上报，Linux 由 pcieport 驱动的 AER 服务统一收编到 dmesg——它是链路健康监控的官方通道，远比"网卡掉线了"这类表象信息精确。

### 三级错误

| 级别 | 含义 | 系统反应 |
|------|------|----------|
| Correctable（可纠正） | 硬件自行恢复：CRC 错触发重传、Bad TLP/DLLP 等 | 无感继续工作，但计数上涨是信道劣化的前兆 |
| Uncorrectable Non-Fatal（不可纠正·非致命） | 本次事务失败但不危及其他设备：Poisoned TLP、Completion Timeout | 事务层报错，设备可恢复 |
| Uncorrectable Fatal（致命） | 链路级故障：训练失败、链路down | 设备下线，需复位恢复 |

### dmesg 判读实例

一条真实的 Corrected Error 报告：

```text
pcieport 0000:00:1c.0: AER: Corrected error received: 0000:01:00.0
nvme 0000:01:00.0: PCIe Bus Error: severity=Corrected, type=Data Link Layer, (Receiver ID)
        device [144d:a808] error status/mask=00000040/0000e000
        [ 6] Bad TLP
```

逐段拆开：第一行是收集该错误的下游端口（RC 的 Root Port）；第二行给出严重级别与错误大类（Data Link Layer = 链路层 CRC/重传类问题）；`error status/mask=00000040` 的 0x40 = bit 6，对应最后一行的 `[ 6] Bad TLP`——收到损坏的事务层包。位号与错误名的对应表在内核 `include/uapi/linux/pci_regs.h` 的 `PCI_ERR_COR_*` 宏里。

判读策略一句话：**Corrected 看趋势，Uncorrectable 看现场**。偶发几条 Corrected 无需动作；计数持续上涨说明信道在劣化，回到上一节的决策树查 SI。出现 Uncorrectable（尤其 Fatal）时，AER 报告里的设备 BDF 和错误位就是事故现场的完整快照。

> 💡 各设备的 AER 计数可在 sysfs 直接查看：`/sys/bus/pci/devices/0000:01:00.0/aer_dev_correctable`（各类可纠正错误的累计数）。巡检脚本定时读它，就能在"降速"发生之前发现信道劣化。

---

## <span class="blue"> 热插拔的实战面

10.1 讲了热插拔的概念与 PRSNT#/PERST# 机制，这里补工程现实的三件事：

1. **受控热插拔**的流程是：操作系统经热插拔控制器（`pciehp`）给插槽断电、移除设备节点；插入时反向走一遍。Linux 桌面/服务器上 `dmesg` 里 `pciehp` 的插拔日志即此链路。
2. **意外移除（surprise removal）**是另一回事：线被碰掉、背板接触不良。设备侧表现是所有配置读返回全 1（`0xFFFFFFFF`——10.2 讲的"无设备应答读回全 1"在这里复现），内核将通道标记为 offline，注册的 `pci_error_handlers.error_detected` 回调被调用。**健壮的驱动必须实现这套错误处理回调**，否则意外拔卡后内核可能带着半死的设备继续跑。
3. **PERST# 时序是 bring-up 经典坑**：复位释放到链路训练有最小间隔要求；复位与上电顺序反了，设备可能进入不确定状态，枚举阶段报训练错误。设备树里 `reset-gpios` 的延迟参数不是装饰。

---

## <span class="blue"> 链路器件与线缆生态

PCIe 出板卡之后的物理形态，是 PCIe 卡工程师的日常接触面：

| 形态 | 连接器/器件 | 场景 |
|------|-------------|------|
| 板级延伸 | PCIe **retimer**（协议感知，参与均衡训练）/ redriver | 主板到背板、长走线补救；机制与选型见 F.16.1 器件谱系 |
| 机箱内铜缆 | **MCIO**（SFF-TA-1016）、SlimSAS | 服务器主板到 NVMe 背板的主流方案 |
| 机箱间铜缆 | **OCuLink**（SFF-8611）、外置 PCIe 线缆 | 扩展坞、外接显卡、测试夹具 |
| 存储直连 | U.2 / U.3（SFF-8639） | 企业级 NVMe 盘的热插拔接口形态 |

retimer 在 PCIe 里的特殊性值得强调：它不是透明中继，而是**作为链路的一个真实参与者**加入均衡训练（两端各自与 retimer 训练一段）。这也是 Gen4+ 主板选型 retimer 时必须确认协议代次的原因——一颗只支持 Gen4 的 retimer 会把 Gen5 链路钉死在 Gen4。

> redriver vs retimer：两种"信号中继"器件的本质差别在是否理解协议。redriver 是纯模拟器件——把衰减的波形放大、加重均衡后原样送出，不解析比特内容，便宜但只能补偿固定信道；retimer 内部有完整的 SerDes 收发对——把信号完整接收、重新定时、再以全新波形发出，参与 PCIe 均衡训练协商。redriver 对协议代次无感，retimer 有代次上限。信道预算差一点点用 redriver 补，差得多或链路本身要分段训练就必须 retimer。

> 💡 光模块/AOC/DAC 那套数通谱系（F.16.1 的链路延伸器件表）在 PCIe 世界几乎不出现——PCIe 的战场在机箱内，介质是 PCB 与铜缆。需要跨机箱互联时，主流答案是换成以太网（或 CXL 的前沿形态，见 10.5），而不是给 PCIe 拉光纤。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 提频（Gen4/5 路线） | 架构不动、软件透明；代价是信道预算骤紧、retimer 成本、降速故障高发 |
| PAM4（Gen6 路线） | 频率不动带宽翻倍；代价是 FLIT 重构、FEC 强制延迟、均衡复杂度上升 |
| 均衡自动训练 | 免人工调参、适配每块板子的实际信道；代价是训练失败只剩降速一条路，且失败原因需要从旁证推断 |
| AER 全量上报 | 信道健康可视化、劣化可预警；代价是 Corrected 刷屏时噪音大，需要按趋势而非单条判读 |
| retimer vs 重新布板 | 几百元器件救回一块板 vs 根治但周期长——量产后期前者的性价比碾压 |

---

## <span class="blue"> 本节总结

Gen4 之后的 PCIe 演进可以压成一条因果链：速率翻倍 → 信道预算见底 → 均衡训练从"随便过"变成"决定生死" → 训练失败就以降速的形式浮出水面。所以本篇的方法论核心不是记住每个 Phase 的细节，而是建立**证据链思维**：`LnkSta` 告诉你降没降，`LnkSta2` 的四个 Phase 位告诉你卡在哪段，AER 计数告诉你劣化到什么程度，dmesg 的 retrain 日志确认是训练失败而非主动限速——四个证据源互相印证，任何一个单独看都可能误判。

Gen6 的三大变革也要记因果而不是记名词：换 PAM4 是因为频率提不动了，换 FLIT 是因为 FEC 需要定长块边界，上 FEC 是因为 PAM4 把裸误码率恶化到了不可工作的量级——改调制方式这一件事，被迫牵动了包格式和纠错机制两处。对软件开发者的好消息是这一切都被封装在物理/链路层之下：TLP 语义、配置空间、BAR、MSI 原样保留，驱动模型对速率代次无感。

工程纪律两句话：降速是协议的保护动作不是故障本身，"能跑就行"等于把 SI 问题留给量产老化；Corrected 看趋势、Uncorrectable 看现场，巡检脚本定时读 `aer_dev_correctable` 就能在降速发生之前发现信道劣化。

### 速查表

| 项 | 要点 |
|----|------|
| 演进结构 | Gen3 编码胜利、Gen4/5 纯提频、Gen6 换赛道（PAM4+FLIT+FEC） |
| 均衡训练 | 四 Phase 轮流当对方眼睛，产物是 preset（FFE 在 PCIe 的具体形态） |
| 软件观测 | `lspci -vvvv` 的 LnkSta2：EqualizationComplete/Phase1-3 四位 |
| 降速入口 | `LnkSta` vs `LnkCap` 对比；`downgraded` 字样=协商降级实锤 |
| AER 判读 | Corrected 看趋势、Uncorrectable 看现场；sysfs `aer_dev_*` 巡检 |
| Gen6 三变 | PAM4（频率不动带宽翻倍）→ FLIT（FEC 要定长块）→ FEC（裸误码 10⁻⁴ 不可工作） |
| L0p | L0 态下动态收窄宽度，不用回 Recovery——"只关一半车道" |
| 中继选型 | redriver 模拟放大无协议感知；retimer 数字重定时参与训练但有代次上限 |

### 本节自查

1. Gen3 到 Gen5 共享同一套编码，为什么 Gen4 才开始把信号完整性变成每个人的问题？
2. `LnkSta2` 显示 `EqualizationPhase3-`，说明链路的哪个方向信道质量差？
3. Gen6 为什么改了 PAM4 就必须同时改包格式和纠错机制？
4. 一块卡偶尔协商到 Gen3、重启又恢复 Gen4，决策树指向哪类根源？
5. 选型时什么情况下 redriver 够用、什么时候必须 retimer？

## <span class="blue"> 下一步

下一篇 **B-D.10.5 CXL 与 PCIe 生态扩展**：PCIe 的物理层和链路层正在被另一种语义复用——CXL 在同一套电气层上跑内存协议，让"内存扩展"和"缓存一致性互联"成为可能。它是理解 2026 年服务器架构的必修课（选读）。

> 💡 本篇的全部物理层概念（均衡、眼图、信道预算、抖动分解、retimer/redriver 器件谱系）的机制底座在 B-F.16.1，那里讲"为什么"，本篇讲"PCIe 怎么用、坏了怎么定位"。AER 的内核实现在 `drivers/pci/pcie/aer.c`，错误位宏定义在 `include/uapi/linux/pci_regs.h`；背板信道预算的分配实战见 B-E.15.5 数通仪器仪表整机架构。
