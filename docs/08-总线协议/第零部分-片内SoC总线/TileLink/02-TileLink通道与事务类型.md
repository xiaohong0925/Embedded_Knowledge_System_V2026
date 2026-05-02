# TileLink 通道与事务类型 **[I→E]**

> <span class="badge-i">I</span> → <span class="badge-e">E</span>

### <strong>TileLink 通道架构</strong>

<span class="badge-i">I</span>

TileLink 定义了 5 个通道，与 AXI 类似但语义不同：

| 通道 | 方向 | 作用 | 对应 AXI |
|------|------|------|----------|
| A | Master→Slave | 发起请求（读/写/获取缓存行） | AR/AW |
| B | Slave→Master | 窥探请求（一致性维护） | 无（ACE 有 snoop） |
| C | Master→Slave | 释放缓存行或响应窥探 | 无 |
| D | Slave→Master | 返回响应/数据 | R/B |
| E | Master→Slave | 确认收到 Grant | 无 |

B/C 通道是 TileLink 的特色，专门用于缓存一致性。AXI 没有独立的窥探通道，ACE 是在 AR/AW 上扩展 snoop 信号。

### <strong>TileLink 事务类型详解</strong>

<span class="badge-i">I</span>

| 事务 | 作用 | 使用场景 |
|------|------|----------|
| Get | 读数据 | 内存读取 |
| PutFullData / PutPartialData | 全字/部分写 | 内存写入 |
| ArithmeticData / LogicalData | 原子算术/逻辑操作 | RISC-V AMO 指令 |
| Acquire | 获取缓存行所有权 | 读入 cache |
| Probe | 窥探其他 Master 的 cache | 一致性维护 |
| Release | 写回并释放 cache 行 | cache eviction |
| Grant | 授权 cache 行所有权 | 响应 Acquire |

原子操作是 TileLink 的特色：AMOADD、AMOSWAP、AMOAND 等，直接对应 RISC-V 的 A 扩展指令。AXI 没有原生原子操作，需要通过锁定传输（已废弃）或自定义实现。

### <strong>TileLink 握手机制与 AXI 对比</strong>

<span class="badge-e">E</span>

TileLink 也使用 VALID/READY 握手，但通道方向与 AXI 不同：

- A 通道（Master→Slave）对应 AXI 的 AR/AW
- D 通道（Slave→Master）对应 AXI 的 R/B
- B/C 通道是 TileLink 独有的反方向窥探

时序约束相同：a_valid && a_ready 时传输发生。但 TileLink 的 B 通道可以打断 C 通道，这是缓存一致性协议的要求——当 coherence manager 发现数据过时时，必须立刻通知持有方失效。

关键差异：TileLink 的通道之间有严格的事务依赖关系（如 Grant 必须在 Acquire 之后），这由 coherence manager 保证，而不是像 AXI 那样由 Master 自己控制。
