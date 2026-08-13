# B-D.13.3 CHI 与 UCIe：Chiplet 互连

> 所属章节：第五部 B. 总线协议 > B-D.13 片内总线认知
>
> 难度：[I] Intermediate / [M] Master | 预计阅读时间：30 分钟

## <span class="blue"> 本节导读

前两篇的范围是单颗 SoC 内部。本篇跨出两条边界：一是多核规模化——核数上到几十上百后，AXI/ACE 的广播式一致性撑不住，ARM 的答案是 CHI；二是单芯片的物理边界——光罩面积与良率逼着芯片拆成 Chiplet，封装内互连的标准答案是 UCIe。

对嵌入式工程师，这一层看似遥远，实则正在下沉：多 Die 服务器 SoC 已进入边缘计算场景，Chiplet 也开始出现在高端车载与 AI 芯片里。本节覆盖：ACE 广播一致性的瓶颈与 CHI 的分层架构、CHI 节点角色与目录式一致性、缓存一致性对驱动开发（DMA）的实际约束、Chiplet 的驱动因素与封装形态、UCIe 标准演进（1.0→3.0）、多 Die 系统的软件拓扑发现与 NUMA 实践。

---

## <span class="blue"> 从 AXI/ACE 到 CHI

### ACE 的广播瓶颈

ACE 在多核簇内维护缓存一致性的方式是**广播嗅探（snoop）**：一个核对某地址的操作，要向簇内所有核广播询问"你缓存了吗"。核数少时可行，核数上升后广播流量按核数平方级增长，一致性流量本身就把互连带宽吃掉了。

### CHI 的分层架构

AMBA 5 CHI（2014 年随 AMBA 5 引入，此后 A→G 持续演进）把互连改造成面向一致性的包交换协议，分四层：

| 层 | 职责 | 类比对象 |
|----|------|----------|
| 协议层 | 一致性事务语义（读、写、失效、监听） | — |
| 网络层 | 包的路由与节点寻址 | NoC 的路由层 |
| 链路层 | 流控（credit 机制）、重试 | 类似 PCIe 链路层 |
| 物理层 | 信道与电气 | — |

关键角色由节点类型定义：

| 节点 | 全称 | 角色 |
|------|------|------|
| RN-F | Request Node Full | 带一致性缓存的请求方：CPU 核、DSU 内的小核 |
| RN-I / RN-D | Request Node I/O / DMA | 不带缓存的请求方：DMA、外设 |
| HN-F | Home Node Full | 一致性"管家"：管理 L3/SLC，内置**目录**记录每行数据被谁缓存 |
| HN-I | Home Node I/O | 普通从设备的归属点 |
| SN-F | Slave Node Full | 终端存储：DDR 控制器 |

一致性机制从广播改为**目录式**：HN-F 的目录记录每个 cache line 的缓存者清单，需要失效时按清单点对点发送，不再全网广播。这是 CHI 能扩展到上百核的根本原因。

产业落点：ARM DynamIQ 时代的 DSU（DynamIQ Shared Unit）内部用 CHI 连接大核小核与 L3；服务器级的 CMN 网状网络同样跑 CHI。13.2 提到的 CMN PMU 事件（`arm_cmn_*`）统计的就是 CHI 层的事务。

### 软件视角：一致性不是免费的

多核一致性由硬件保证"核与核之间"的数据可见，但**外设 DMA 不在一致性域内**（或只在部分 SoC 上以 IO-coherent 方式挂入）。这正是内核 DMA API 存在的物理原因：

| API | 一致性处理 | 适用场景 |
|-----|------------|----------|
| `dma_map_single()` / `dma_unmap_single()` | 驱动在映射/解除时做 cache 清理与失效 | 流式 DMA：收发缓冲区 |
| `dma_alloc_coherent()` | 分配时直接给非缓存（或硬件一致）映射 | 长期共享：描述符环 |
| 硬件 IO-coherent（如挂入 ACE/CHI 的 DMA） | 无需软件维护 | 部分高端 SoC 的特定主设备 |

> 💡 "DMA 读完的数据是旧值"几乎总是 cache 维护问题：CPU 写入的数据还在 cache 里，DMA 直接从 DDR 读走了旧内容。第 11 章与 D 扩展的 DMA 篇会反复用到本篇这条根因链。

---

## <span class="blue"> Chiplet：单芯片的物理边界

### 为什么拆

三个硬约束把单芯片设计逼到墙角：

1. **光罩极限**：光刻机单次曝光面积约 858 mm²（26×33 mm），芯片不能无限做大
2. **良率**：缺陷密度固定时，die 面积越大良率越低，大芯片的成本随面积超线性上涨
3. **工艺混搭**：计算逻辑需要先进工艺，IO/模拟单元在成熟工艺上反而更好——单芯片被迫全部用先进工艺，浪费

Chiplet 方案：把大芯片拆成多个小 die（计算 die、IO die、缓存 die），各自用最合适的工艺流片，再在封装内互连成一个系统。

### 封装形态

| 形态 | 互连介质 | 凸点间距 | 代表技术 |
|------|----------|----------|----------|
| 2D（基板走线） | 有机基板 | ~110 μm | 传统 MCM |
| 2.5D（硅中介层） | 硅转接板/桥 | 40~55 μm | TSMC CoWoS、Intel EMIB |
| 3D（垂直堆叠） | 混合键合直连 | <10 μm | TSMC SoIC、Intel Foveros Direct |

间距每缩小一个量级，互连的带宽密度和能耗就改善一个量级——这是封装技术竞争的核心指标。

<!-- 【待补图】images/13.3-chiplet封装形态对比.png（优先级：★必要）
图名：Chiplet 三种封装形态截面对比图
生图提示词：技术剖面示意图风格，横向三联对比排版。左图"2D 基板"：两个方形 die 并排放在有机基板（绿色矩形）上，标注凸点间距约110μm；中图"2.5D 硅中介层"：两个 die 下方垫一层灰色硅转接板，die 间经转接板内走线连接，标注凸点间距40~55μm，标注"CoWoS/EMIB"；右图"3D 堆叠"：两个 die 垂直叠放，标注混合键合间距<10μm，标注"SoIC/Foveros Direct"。每图下方标注带宽密度趋势箭头递增。配色：浅灰背景、芯片用深蓝色、基板绿色、转接板灰色，工程蓝图风格，扁平矢量，无渐变阴影，中文标注。比例 16:9。 -->

### UCIe：封装内互连的开放标准

UCIe（Universal Chiplet Interconnect Express）联盟 2022 年 3 月由 AMD、Arm、Google、Intel、Meta、微软、高通、三星、台积电、日月光等发起，目标是为封装内 die-to-die 互连建立开放标准，让不同厂商的 Chiplet 能互插。

| 版本 | 时间 | 关键内容 |
|------|------|----------|
| UCIe 1.0 | 2022 | die-to-die 物理层 + 适配层；协议层映射 PCIe/CXL/自定义流；分 UCIe-S（标准 2D）与 UCIe-A（先进 2.5D） |
| UCIe 2.0 | 2024 | 系统级管理能力（DFx：可测、可调试、遥测），3D 封装支持 |
| UCIe 3.0 | 2025-08 | 速率翻倍至 48/64 GT/s；运行时重校准；边带通道延伸至 100 mm；Raw 模式支持 ADC/DAC 类连续传输；MTP 标准化早期固件下载；优先级边带包；快速节流与紧急关机 |

两点值得注意：

- **协议层直接映射 PCIe/CXL**——这意味着 B-C.11 的 PCIe 知识在 Chiplet 时代依然是通用语言，die 间通信复用同一套事务模型
- **3.0 的管理面增强**（早期固件下载、遥测、紧急关机）直接对应多 die 系统的固件启动与运维需求

产业实例：AMD EPYC 的 CCD+IOD 结构（Infinity Fabric 封装内互连）、Apple M1 Ultra 的 UltraFusion（2.5 TB/s 中介层）、Intel Meteor Lake/Ponte Vecchio（EMIB+Foveros）。NVIDIA Blackwell 用自研 NV-HBI，概念同族。

---

## <span class="blue"> 软件视角：多 Die 系统的拓扑与启动

Chiplet 对软件不是透明的。三个直接影响：

### NUMA 拓扑显形

多 die 各有本地 DDR 控制器，CPU 访问本地 die 内存与远端 die 内存的延迟、带宽明显不同。内核经 ACPI SRAT/SLIT 表获知拓扑，呈现为多个 NUMA 节点：

```bash
numactl --hardware
```

典型输出（双 die 服务器）：

```
available: 2 nodes (0-1)
node 0 cpus: 0-63
node 0 size: 128000 MB
node 1 cpus: 64-127
node 1 size: 128000 MB
node distances:
node   0   1
  0:  10  21
  1:  21  10
```

`node distances` 里 10 与 21 的差距，物理来源就是 die 间互连的转发延迟。性能敏感服务绑核绑内存（`numactl --cpunodebind --membind`）的收益由它决定。

### 固件启动序列

多 die 系统的固件要处理"谁先起、谁等谁"：主 die 完成自身初始化后，经 die 间链路为从 die 下载早期固件（UCIe 3.0 的 MTP 把这一步标准化）、协商链路参数、交换拓扑信息，然后才把完整系统呈现给 OS。启动日志里 die 间链路训练相关的条目，就属于这一阶段。

### 遥测与运维

UCIe 2.0/3.0 的 DFx 与管理面让 die 间链路像 PCIe 链路一样可观测：链路状态、误码、降速事件可经带外通道上报。排查多 die 系统的间歇性性能问题时，die 间链路降速是一个独立嫌疑对象。

多 die 系统出现"同型号机器性能不一致"或"迁移后性能掉档"时，第一排查手段是 `numactl --hardware` / `lstopo` 核对拓扑与内存本地性——进程漂到了远端 NUMA 节点，比代码问题常见得多。

---

## <span class="blue"> 一致性方案与互连代际（Trade-off）

| 维度 | ACE（广播嗅探） | CHI（目录式） | 备注 |
|------|-----------------|---------------|------|
| 一致性机制 | 全网广播询问 | HN-F 目录点对点 | 目录占用少量片内存储 |
| 可扩展核数 | 个位数~十位数 | 上百 | — |
| 互连结构 | 总线/Crossbar | 包交换 NoC | — |
| 典型载体 | Cortex-A53/A72 时代 CCI/CCN | DSU、CMN | — |
| 软件可见性 | 基本透明 | PMU 事件、NUMA | — |

| 维度 | 单芯片 SoC | Chiplet（UCIe） |
|------|------------|------------------|
| die 间带宽 | —（片内互连） | 3.0 达 48/64 GT/s/pin |
| 内存一致性 | 片内完成 | 跨 die 需协议保证（CXL.cache 等） |
| 启动复杂度 | 单固件序列 | 多 die 分级启动、MTP 固件下载 |
| 软件拓扑 | 平铺 | NUMA 显形 |
| 运维观测 | PMU | + die 间链路遥测 |

---

## <span class="blue"> 常见陷阱

> ⚠️ 认为硬件一致性覆盖 DMA。多数嵌入式 SoC 的 DMA 主设备不在一致性域内，`kmalloc` 的 buffer 直接交给 DMA 必然出旧数据问题。一律走 `dma_map_single` 或 `dma_alloc_coherent`，由 API 决定要不要做 cache 维护。

> ⚠️ 在多 NUMA 系统上凭单节点经验调优。绑核不绑内存（或相反）等于没绑：CPU 在节点 0、内存在节点 1，所有访存都跨 die。`numactl` 的 `--cpunodebind` 与 `--membind` 要成对使用。

> ⚠️ 把 Chiplet 当成纯硬件话题。die 间链路训练失败、固件版本不匹配、拓扑上报错误，最终都以"系统起不来"或"性能异常"的形式落到软件工程师桌上。

> ⚠️ 混淆 UCIe 与 PCIe 的层次关系。UCIe 是 die 间物理/链路/适配层标准，PCIe/CXL 是它承载的协议之一；说"这个 die 间接口是 UCIe 还是 PCIe"，多数场景下答案是"UCIe 承载 PCIe 协议"，两者不互斥。

---

## <span class="blue"> 动手练习

1. **拓扑查看**：在任意多路服务器或双 die 主机上执行 `numactl --hardware` 与 `lscpu`，记录 NUMA 节点数与 node distances；单 die 开发板对照观察"单节点"形态。
2. **NUMA 实验**：多节点机器上用 `numactl --membind=1 --cpunodebind=0` 人为制造跨节点访存，跑 `tinymembench` 对比绑定本地的带宽与延迟差。
3. **一致性代码审计**：在第 11 章或 D 扩展任一 DMA 驱动代码中找出 `dma_map_single`/`dma_alloc_coherent` 的每一处调用，说明各自对应本篇哪一类一致性处理。
4. **无硬件后备**：QEMU 支持 NUMA 模拟：`qemu-system-x86_64 -smp 4 -m 4G -numa node,nodeid=0,cpus=0-1,mem=2G -numa node,nodeid=1,cpus=2-3,mem=2G ...`，启动后在 guest 内完成练习 1；另读 UCIe 联盟官网的 3.0 白皮书，列出 MTP 与优先级边带包各自解决什么问题。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| CHI 动因 | 能说明 ACE 广播为何不可扩展、目录式一致性如何解决 |
| CHI 角色 | RN-F/HN-F/SN-F 的职责划分 |
| DMA 一致性 | 两类 DMA API 的区别与选错的症状 |
| Chiplet 动因 | 光罩极限、良率、工艺混搭三条约束 |
| UCIe | 版本演进主线、与 PCIe/CXL 的承载关系、3.0 的管理面增强 |
| 软件拓扑 | NUMA 显形的物理来源；`numactl` 绑核绑内存的实践 |

---

## <span class="blue"> 配套资源

- **规范**：AMBA CHI Architecture Specification（ARM）；UCIe 联盟官网规范与白皮书（uciexpress.org）
- **内核文档**：`Documentation/admin-guide/mm/numa_memory_policy.rst`
- **延伸阅读**：AMD Infinity Fabric、Intel EMIB/Foveros、TSMC CoWoS/SoIC 官方技术资料

---

## <span class="blue"> 下一步

板块 1 片内总线认知到此收尾。三篇建立了完整链条：**13.1 地图**（设备在哪）→ **13.2 机制**（事务与属性怎么工作）→ **13.3 边界**（多核与多 die 时会发生什么）。

下一站进入板块 2 低速外设接口，从最基础的 **B-A.1.1 GPIO 通用输入输出** 开始——片内总线将退到幕后，但每接一个外设时"它挂在哪条总线、地址多少"的第一反应，来自这个板块。

> 💡 螺旋衔接：本篇的 DMA 一致性根因链，会在 D 扩展的 DMA 子系统写法篇落到具体代码；多 die NUMA 实践则在 B-E.14.5 数通仪器仪表整机架构中直接复用。
