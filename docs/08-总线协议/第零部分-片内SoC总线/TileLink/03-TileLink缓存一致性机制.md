# TileLink 缓存一致性机制 **[E]**

> <span class="badge-e">E</span>

### <strong>缓存一致性基础：为什么需要 TL-C</strong>

<span class="badge-i">I</span>

多核 RISC-V，各带私有 L1 cache。核 A 修改了 cache 里的变量，核 B 读内存拿到旧值——这就是缓存不一致。

TL-C（TileLink Cached Coherent）通过目录式一致性（Directory-based Coherence）解决这个问题。每个 cache 行在 L2/目录中记录：哪些核持有、是 Shared 还是 Exclusive。

### <strong>目录式一致性协议</strong>

<span class="badge-e">E</span>

TileLink 使用简化版目录状态：

| 状态 | 含义 | 行为 |
|------|------|------|
| Nothing | 没有核 cache 这行 | 内存是最新 |
| Branch | 一个或多个核只读（Shared） | 内存是最新，多核可共享读 |
| Trunk | 只有一个核可写（Exclusive） | 核的 cache 是最新，内存是旧 |
| Tip | 某个核最新修改过 | 核的 cache 是最新，内存是旧 |

事务流示例：核 A 要写地址 X
1. 核 A 发 Acquire（请求写权限）
2. Coherence manager 查目录 → 发现核 B 有 Branch 副本
3. Manager 发 Probe 给核 B → 核 B 降为 Nothing 或写回数据
4. Manager 更新目录：核 A = Tip
5. Manager 发 Grant 给核 A → 核 A 获得独占写权限

### <strong>TileLink 与 MESI 的关系</strong>

<span class="badge-e">E</span>

MESI 是单级 cache 的状态机（Modified/Exclusive/Shared/Invalid），描述一个 cache line 在单个核内的状态。

TileLink 是系统级一致性协议，定义核与核之间、核与内存之间的事务交互。

对应关系：
- Acquire → MESI 的过渡请求（如 I→E）
- Grant → 状态转换完成
- Probe → 其他核状态变更通知（如 S→I）
- Release → cache eviction（如 M→I，写回内存）

<span class="blue">MESI 是本地状态，TileLink 是全局协议。</span>
