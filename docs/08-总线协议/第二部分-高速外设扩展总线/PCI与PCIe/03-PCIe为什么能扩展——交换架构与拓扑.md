# PCIe为什么能扩展——交换架构与拓扑

<span class="badge-b">[B]</span> <span class="badge-i">[I]</span> <span class="badge-e">[E]</span> <span class="badge-m">[M]</span>

PCIe 的扩展能力是其区别于其他高速接口的核心优势。
本章拆解 Root Complex、Switch、Endpoint 的层级结构，
并对比 PCIe 包路由与以太网帧交换的本质差异。

---

## 核心定义与价值

<span class="red">PCIe 拓扑</span> 是一棵以 Root Complex 为根的树形结构。
每个节点要么是 Switch（扩展分支），要么是 Endpoint（叶子节点）。

**拓扑的核心价值：**

- 一个 Root Port 可以通过 Switch 扩展出数十个 Endpoint
- 每个链路都是独立的点对点连接，不存在总线竞争
- 带宽可以在 Switch 内部聚合或分配（取决于 Switch 设计）
- 热插拔可以在任意层级实现（如果硬件和固件支持）

---

### 类比：公司组织架构

PCIe 拓扑像一家大型集团：

- <span class="green">Root Complex</span> = 集团总部（CEO + 财务 + 人力资源）
  - <span class="green">Root Port</span> = 总部直属的事业部入口
- <span class="green">Switch</span> = 区域分公司（承接总部指令，分发给下级）
  - <span class="green">Upstream Port</span> = 分公司向总部汇报的接口
  - <span class="green">Downstream Port</span> = 分公司向下级单位派任务的接口
  - <span class="green">内部路由表</span> = 分公司的人事档案，知道谁负责什么
- <span class="green">Endpoint</span> = 基层单位（具体干活的人：NVMe 仓库、网卡通信部、显卡设计部）

集团发文件（TLP）时，不需要"广播"给所有人，
而是按地址标签直接投递到目标单位。

---

## 核心机制原理解析

### <strong>1. Root Complex：CPU、内存与 Root Port 的统一体</strong>

<br>

```mermaid
graph TD
    A[CPU Core] --
    B[Memory Controller]
    B --
    C[Root Complex]
    C --
    D[Root Port 0]
    C --
    E[Root Port 1]
    C --
    F[Root Port N]
    D --
    G[Switch 0]
    E --
    H[NVMe SSD]
    F --
    I[GPU]
    G --
    J[Endpoint A]
    G --
    K[Endpoint B]
```

<br>

**Root Complex 的核心组成：**

| 组件 | 功能 |
|------|------|
| Host Bridge | 连接 CPU 和内存，处理 DMA 请求 |
| Root Port | PCIe 链路的起点，每个 Root Port 对应一个独立的链路 |
| I/O 和 Memory 解码 | 将 CPU 访问转换为 PCIe TLP |
| Interrupt 汇聚 | 将 MSI/MSI-X/INTx 汇聚到 CPU 中断控制器 |

<br>

**Root Port 的编号：**

- 每个 Root Port 分配一个唯一的 Bus/Device/Function 编号
- 通常是 Bus 0, Device 0/1/2...N, Function 0
- Root Port 的 _secondary bus_ 寄存器指向其下游的 Bus 编号

---

### <strong>2. Switch：Upstream Port + Downstream Port + 内部路由表</strong>

<br>

Switch 是 PCIe 扩展的核心。它在内部维护一张路由表，根据 TLP 的地址或 Bus 号决定转发到哪个 Downstream Port。

```mermaid
graph LR
    A[Upstream Port] --
    B[Switch Internal Fabric]
    B --
    C[Downstream Port 0]
    B --
    D[Downstream Port 1]
    B --
    E[Downstream Port 2]
    B --
    F[Downstream Port 3]
```

<br>

**Switch 内部结构：**

- <span class="green">Upstream Port</span>：面向 Root Complex，只有一个
- <span class="green">Downstream Port</span>：面向 Endpoint 或级联 Switch，可有多个
- <span class="green">Internal Fabric</span>：交叉开关（Crossbar）或共享总线，连接 Upstream 和所有 Downstream
- <span class="green">路由表</span>：配置空间中的 Bus Number 寄存器，记录每个 Downstream Port 的子树范围

<br>

**Switch 配置空间关键寄存器：**

| 寄存器 | 偏移 | 说明 |
|--------|------|------|
| Primary Bus Number | 0x18 [7:0] | Upstream 侧 Bus 号 |
| Secondary Bus Number | 0x19 [7:0] | 本 Port 下游 Bus 号 |
| Subordinate Bus Number | 0x1A [7:0] | 本 Port 子树最大 Bus 号 |
| Memory Base / Limit | 0x20 | 32-bit MMIO 窗口 |
| Prefetchable Base / Limit | 0x24/0x28 | 64-bit Prefetchable MMIO 窗口 |
| IO Base / Limit | 0x1C | IO 端口窗口 |

<br>

<span class="blue">Secondary Bus Number 和 Subordinate Bus Number 是枚举的核心：
Root Port 或 Upstream Port 的 Secondary = 下游第一个 Bus，Subordinate = 下游最大 Bus。
枚举算法通过这两个寄存器确定一个 Port 的子树范围。</span>

---

### <strong>3. Endpoint：TLP 的终点与请求的发起者</strong>

<br>

Endpoint 是 PCIe 树中的叶子节点，没有下游端口。

| Endpoint 类型 | 典型设备 | 角色 |
|--------------|---------|------|
| Legacy Endpoint | 旧网卡、旧 SATA 控制器 | 仅请求者（Requester）或仅完成者（Completer） |
| Root Complex Integrated Endpoint | SoC 内部 GPU、网卡 | 集成在 Root Complex 内，跳过链路层 |
| PCIe Endpoint | NVMe SSD、现代网卡、GPU | 完整支持所有 TLP 类型 |

<br>

Endpoint 的配置空间是 Type 0（与 Switch/Bridge 的 Type 1 不同）：

| 字段 | Type 0（Endpoint） | Type 1（Switch/Bridge） |
|------|---------------------|------------------------|
| BAR0-5 | Base Address Registers | BAR0-1（可选） |
| CardBus CIS Pointer | 有 | 无 |
| Subsystem ID/Vendor | 有 | 有 |
| Expansion ROM Base | 有 | 有 |
| Primary Bus | 无 | 有（0x18） |
| Secondary Bus | 无 | 有（0x19） |
| Subordinate Bus | 无 | 有（0x1A） |
| IO/Memory Limit | 无 | 有（窗口路由） |

---

### <strong>4. TLP 路由：地址路由 vs ID 路由 vs 隐式路由</strong>

<br>

PCIe TLP 有三种路由方式：

| 路由方式 | 依据 | 适用场景 |
|---------|------|---------|
| 地址路由（Address Routing） | TLP 中的 Memory/IO 地址 | Memory Read/Write，IO Read/Write |
| ID 路由（ID Routing） | Bus/Device/Function 号 | Configuration 读写，消息路由 |
| 隐式路由（Implicit Routing） | TLP 类型本身 | Broadcast/Local/Collect to RC 消息 |

<br>

**地址路由在 Switch 中的行为：**

```
Switch 收到 Memory Write TLP（含目标地址 0xF0000000）
    ↓
查询每个 Downstream Port 的 Memory Base/Limit
    Port 0: Base=0xE0000000, Limit=0xEFFFFFFF → 不匹配
    Port 1: Base=0xF0000000, Limit=0xF0FFFFFF → 匹配！
    ↓
转发到 Port 1
```

<br>

<span class="blue">如果地址不匹配任何 Downstream Port，Switch 会将 TLP 转发到 Upstream Port（向 Root Complex 报告）。
如果 Upstream Port 也不匹配，TLP 被丢弃并记录错误。</span>

---

### <strong>5. 与以太网交换的对比</strong>

<br>

| 维度 | PCIe Switch | 以太网 Switch |
|------|-------------|---------------|
| 传输单位 | TLP（变长，最大 4096B payload） | 以太网帧（最大 1518B/9216B） |
| 路由依据 | 地址 / Bus+Dev+Func / 隐式 | MAC 地址 / IP 地址 / VLAN |
| 拓扑 | 严格树形，无环路 | 任意拓扑，STP 防环 |
| 流量控制 | 基于 Credit 的端到端流控 | 基于 Pause 帧或丢包 |
| 错误处理 | ACK/NAK + ECRC + Replay Buffer | CRC 校验 + 丢包 |
| QoS | TC（Traffic Class）0-7 + VC | 802.1p / DSCP |
| 广播能力 | 有限（消息类 TLP） | 原生支持广播/组播 |

<br>

<span class="red">PCIe 与以太网的本质差异：PCIe 是"总线协议"的进化版，保留了 CPU 视角的地址空间和请求-响应模型；以太网是"网络协议"，基于独立节点的自治和转发。</span>

---

## 技术教学与实战

### 读取 PCIe 拓扑树

```bash
# 树形显示 PCIe 拓扑
lspci -tv
-[0000:00]-+-00.0  Intel Corporation Host Bridge
           +-02.0  Intel Corporation VGA Controller
           +-14.0  Intel Corporation USB xHCI
           +-1c.0-[01]--+-00.0  Samsung NVMe Controller
           |            \-00.1  Samsung NVMe Controller
           +-1c.1-[02]----00.0  Intel WiFi 6 AX200
           +-1c.2-[03]----00.0  Realtek Ethernet
           +-1c.3-[04]--+-00.0  ASMedia SATA Controller
           |            \-00.1  ASMedia SATA Controller
```

<br>

解读：

| 行 | 含义 |
|----|------|
| `-[0000:00]` | Bus 0，Root Complex |
| `+-1c.0-[01]` | Root Port 1c.0，下游是 Bus 1 |
| `+-00.0` | Bus 1, Device 0, Function 0：NVMe |
| `\-00.1` | Bus 1, Device 0, Function 1：NVMe 的第二个 Function |

<br>

```bash
# 读取 Switch 的路由窗口
cat /sys/bus/pci/devices/0000:04:00.0/secondary_bus_number
cat /sys/bus/pci/devices/0000:04:00.0/subordinate_bus_number
```

---

## 嵌入式专属实战场景

### 场景：设计多 NVMe 的 PCIe Switch 扩展方案

某 AI 边缘设备需要连接 8 个 NVMe SSD，SoC 只有 4 个 Root Port。

方案：使用 Microchip PM8532（24-port PCIe Gen4 Switch）

```mermaid
graph TD
    A[SoC: 4×Root Port] --
    B[PM8532 Switch]
    B --
    C[NVMe 0]
    B --
    D[NVMe 1]
    B --
    E[NVMe 2]
    B --
    F[NVMe 3]
    B --
    G[NVMe 4]
    B --
    H[NVMe 5]
    B --
    I[NVMe 6]
    B --
    J[NVMe 7]
```

<br>

关键设计考量：

| 参数 | 值 | 说明 |
|------|-----|------|
| 上行带宽 | PCIe Gen4 ×16 = 32GB/s | Switch Upstream Port |
| 下行带宽 | 8 × PCIe Gen4 ×4 = 32GB/s | 理论对称 |
| 实际瓶颈 | Switch 内部 Fabric 带宽 | 查阅 PM8532 数据手册确认非阻塞 |
| 热插拔 | 需支持 Surprise Down | 需要硬件电路支持 |
| 功耗 | ~10W | Switch 本身功耗 |

<br>

<span class="blue">多 NVMe 扩展的关键不是端口数量，而是 Switch 内部 Fabric 是否为无阻塞（Non-blocking）架构。
廉价 Switch 可能在多端口同时满载时出现内部拥塞。</span>

---

## 历史演进与前沿

### PCIe Switch 的演进

| 年份 | 芯片 | 代际 | 端口数 | 意义 |
|------|------|------|--------|------|
| 2007 | PLX PEX8518 | Gen1 | 16 | 首批消费级 PCIe Switch |
| 2012 | PLX PEX8747 | Gen3 | 24 | 多 GPU 互联普及 |
| 2017 | Microchip PM8532 | Gen4 | 24 | 数据中心 NVMe 扩展 |
| 2020 | Broadcom PEX8900 | Gen5 | 32 | 首款 Gen5 Switch |
| 2023 | Microchip PM8597 | Gen5 | 24 | AI 训练集群互联 |

<br>

<span class="red">CXL Switch 是下一个战场：</span>

- CXL.io 兼容 PCIe 事务层，可以与传统 PCIe Endpoint 互通
- CXL.cache 和 CXL.memory 需要新的 Switch 路由逻辑
- 2024-2025 年，CXL 2.0/3.0 Switch 芯片开始进入量产

---

## 本章小结

| 主题 | 关键要点 |
|------|---------|
| Root Complex | CPU + 内存 + Root Port，PCIe 树的根 |
| Root Port | 每个端口独立链路，Secondary Bus 指向子树 |
| Switch | Upstream Port + N×Downstream Port + 内部 Fabric + 路由表 |
| 路由表 | Primary/Secondary/Subordinate Bus + Memory/IO 窗口 |
| TLP 路由 | 地址路由（MMIO）、ID 路由（Config）、隐式路由（Message） |
| 以太网对比 | PCIe 是树形总线进化版，以太网是网状网络 |

---

## 练习

1. 为什么 PCIe 拓扑必须是树形，而不能像以太网一样有环路？如果存在环路会发生什么？
2. Switch 的 Secondary Bus Number 和 Subordinate Bus Number 在枚举中各起什么作用？
   如果一个 Switch Port 的 Secondary=3, Subordinate=5，说明什么？
3. 某 TLP 的 Memory 地址是 0xF8000000，Switch Port 0 的 Memory Base=0xF0000000, Limit=0xF7FFFFFF；
   Port 1 的 Base=0xF8000000, Limit=0xF8FFFFFF。这个 TLP 会被转发到哪个 Port？
   如果地址是 0xFE000000 呢？
4. 对比 PCIe Switch 和以太网 Switch 的流控机制：Credit-Based 流控 vs 背压/丢包，各有什么优劣？
5. 某 AI 边缘设备要连接 16 个 NVMe SSD，SoC 提供 PCIe Gen4 ×16。
   设计 Switch 扩展方案时，需要关注 Switch 的哪些关键参数？
