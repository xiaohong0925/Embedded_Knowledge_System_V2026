# TileLink 缓存一致性机制 [E]

> **本章学习目标**：
> - 理解 <span class="red">TLOE（TileLink Ownership Engine）</span> 的角色
> - 掌握 <span class="red">目录式一致性协议</span> 的工作原理
> - 了解 TileLink <span class="red">缓存状态机</span>（TMO/B/M/S）的转换规则

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">TileLink 缓存一致性机制</span>诞生于 <span class="green">2016 年</span> UC Berkeley 的 <span class="green">Rocket Chip</span> 项目。<br>
随着 RISC-V 多核处理器的发展，需要一套与 AXI ACE/CHI 同等水平但完全开放的缓存一致性方案。<br>
<span class="blue">TileLink 的 TL-C 协议定义了基于目录的一致性机制，支持 MESI 的扩展状态机（TMO/B/M/S），已被 Rocket Chip、Chipyard 等开源项目广泛验证。</span><br>
如今，TileLink 缓存一致性是 <span class="green">RISC-V 多核处理器</span>的标准配置。<br>

---

## TLOE：TileLink 所有权引擎

---

### <strong>TLOE 的角色：一致性事务的仲裁者</strong>

<span class="red">TLOE（TileLink Ownership Engine）</span>是 TileLink 一致性系统的核心组件。<br>
它维护每个缓存行的<span class="blue">"所有者记录"</span>，决定哪个 Master 拥有读写权限。<br>

<span class="blue">类比理解：TLOE 如同"图书馆借阅系统"</span><br>
每本书（缓存行）有一个借阅记录（目录项）。<br>
读者（CPU 核）借书时，系统查询记录，如果书在别人手上，需要先从别人那里要回来。<br>
TLOE 就是这个借阅系统的后台数据库。<br>

TLOE 的核心职责：<br>
* 维护 <span class="green">目录表</span>：记录每个缓存行在哪个 Master 的 Cache 中<br>
* 处理 <span class="green">Acquire 请求</span>：查询并授权缓存行访问<br>
* 发送 <span class="green">广播监听</span>：通知其他 Master 状态变更<br>
* 处理 <span class="green">Release 响应</span>：接收写回数据并更新目录<br>

---

### <strong>TLOE 与 AXI CCI 的对比</strong>

| 特性 | TileLink TLOE | AXI CCI-550 |
| --- | --- | --- |
| 实现方式 | 基于 Chisel 的参数化模块 | ARM 商业 IP |
| 目录存储 | 可配置（on-chip SRAM） | 固定实现 |
| 监听延迟 | 10~30 cycle（参数化） | 20~50ns（固定） |
| 开源 | 是（Rocket Chip） | 否（ARM 授权） |
| 扩展性 | 支持 N 核（参数化） | 通常 2~8 核 |

<span class="blue">TLOE 的优势在于完全参数化和开源，可根据 SoC 规模灵活调整目录大小和监听策略。</span><br>

---

## 目录式一致性协议

---

### <strong>目录结构：缓存行的全局视图</strong>

<span class="red">目录（Directory）</span>是 TLOE 的核心数据结构。<br>
每个目录项对应一个 <span class="green">Cache line</span>（通常为 64 bytes）。<br>

| 字段 | 宽度 | 含义 |
| --- | --- | --- |
| State | 2 bit | 缓存行状态（T/M/S/I） |
| Owner | log2(N) bit | 当前所有者核 ID |
| Sharers | N bit | 位图：哪些核有共享副本 |
| Dirty | 1 bit | 是否被修改（需写回） |

<span class="blue">目录表通常存储在 on-chip SRAM 中，大小为：Cache line 数 × 目录项宽度。</span><br>

---

### <strong>目录查询流程</strong>

当 <span class="green">CPU Core 0</span> 发起 <span class="green">Acquire</span> 请求时，TLOE 执行以下步骤：<br>

<span class="orange"><strong>1. 目录查找</strong></span><br>
根据地址计算 <span class="green">Cache line 索引</span>，查询目录表。<br>
如果命中，获取当前状态和所有者。<br>

<span class="orange"><strong>2. 权限检查</strong></span><br>
检查请求的权限（NtoT/NtoB）与当前状态是否冲突。<br>
如果冲突，需要通知当前所有者降级或写回。<br>

<span class="orange"><strong>3. 广播监听</strong></span><br>
通过 <span class="green">B 通道</span> 向所有相关 Master 发送监听请求。<br>
等待 <span class="green">C 通道</span> 的回应。<br>

<span class="orange"><strong>4. 授权响应</strong></span><br>
通过 <span class="green">D 通道</span> 向请求者发送数据和授权。<br>
更新目录表状态。<br>

```mermaid
sequenceDiagram
    participant C0 as Core 0
    participant TLOE as TLOE
    participant C1 as Core 1
    participant DDR as DDR
    
    Note over C0,DDR: Core 0 请求写入 x
    C0->>TLOE: Acquire(NtoT)
    TLOE->>TLOE: 目录查找：Core 1 有 S 状态
    TLOE->>C1: B通道：Probe（降级到 I）
    C1-->>TLOE: C通道：ReleaseData（写回 DDR）
    C1->>C1: 状态 I
    TLOE->>DDR: 写回数据
    TLOE->>C0: D通道：GrantData + T 权限
    C0-->>TLOE: E通道：GrantAck
    TLOE->>TLOE: 更新目录：Owner=C0, State=T
```

---

## 缓存状态机

---

### <strong>TMO/B/M/S：TileLink 的五状态模型</strong>

<span class="red">TileLink</span> 定义 5 种缓存行状态，扩展了传统 MESI。<br>

| 状态 | 缩写 | 含义 | 可读写 |
| --- | --- | --- | --- |
| Trunk | T | 独占写权限，无其他副本 | 可读写 |
| Branch | B | 只读权限，可能有其他副本 | 只读 |
| Modified | M | 已修改，仅本 Cache 有最新数据 | 可读写 |
| Shared | S | 共享只读，多个 Cache 有副本 | 只读 |
| Invalid | I | 无效，数据不存在或已过时 | 不可访问 |

<span class="blue">T（Trunk）和 B（Branch）是 TileLink 的扩展状态，比 MESI 更细粒度地描述权限层级。</span><br>

---

### <strong>状态转换规则</strong>

```mermaid
stateDiagram-v2
    [*] --> I: 初始状态
    I --> B: Acquire(NtoB) + GrantData
    I --> T: Acquire(NtoT) + GrantData
    B --> T: Acquire(BtoT) + Grant
    T --> M: 写入数据
    M --> I: Release(TtoN) + ReleaseAck
    B --> I: Release(BtoN) + ReleaseAck
    T --> B: Probe(BtoN) + ProbeAck
    M --> B: Probe(TtoB) + ProbeAck + 写回
```

<span class="blue">关键转换：T→M 是写入操作，M→I 需要写回 DDR；B→I 无需写回（数据未修改）。</span><br>

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| TLOE | TileLink 所有权引擎，维护目录表和仲裁一致性事务 |
| 目录表 | 记录每个 Cache line 的状态、所有者、共享者位图 |
| Trunk（T） | 独占写权限，无其他副本 |
| Branch（B） | 只读权限，可能有其他副本 |
| Acquire | 请求缓存行权限（NtoB/NtoT/BtoT） |
| Release | 释放缓存行权限（TtoN/BtoN） |
| Probe | 强制降级（TtoB/BtoN） |

---

## 练习

1. 双核系统共享变量 x，核 0 先 Acquire(NtoB) 后 Acquire(BtoT)，核 1 持有 B 状态。描述完整的事务序列。<br>
2. 为什么 TileLink 需要 Trunk 和 Branch 两种状态，而 MESI 只有 Modified 和 Shared？<br>
3. 在 Chipyard 中配置一个 4 核 RISC-V 处理器，TLOE 的目录表需要多大 SRAM？（假设 32KB L1 Cache，64-byte line）
