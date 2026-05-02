# AXI5 与 ACE 缓存一致性 **[E→M]**

> <span class="badge-e">E</span> → <span class="badge-m">M</span>

### <strong>AXI5 新增特性</strong>

<span class="badge-e">E</span>

AXI5 不是 AXI4 的替代，而是面向特定领域（汽车、功能安全、AI）的扩展集。

**Trace 信号（ATB 集成）**：
- 集成 ARM CoreSight 调试追踪接口，ETM（Embedded Trace Macrocell）可以直接通过 AXI 总线输出指令/数据追踪流
- 不需要额外的 ATB 总线接口，节省引脚

**PMU 信号（性能监控）**：
- 新增事件计数信号，总线矩阵内置性能计数器
- 可统计：每 Master 的读/写事务数、平均延迟、突发长度分布
- 对嵌入式性能调优极其有用，不再需要外挂逻辑分析仪

**安全扩展**：
- TrustZone 信号细化：NSAID（Non-Secure Access ID）扩展，更细粒度的安全域划分
- 部分信号冗余建议：关键控制信号双采样，防 SEU（单粒子翻转）

**汽车功能安全**：
- 部分实现建议参考 ISO 26262 ASIL-B/D 等级
- ECC 保护：数据通道增加校验位

### <strong>ACE：缓存一致性扩展</strong>

<span class="badge-m">M</span>

**问题背景**：双核 Cortex-A53，各带 32KB L1 I-cache 和 32KB L1 D-cache。核 A 执行 `str r0, [0x1000]` 修改了地址 0x1000 的 cache line。核 B 执行 `ldr r1, [0x1000]` 时，如果直接从内存读，拿到的是旧值。

**ACE 在 AXI4 基础上增加的信号**：
- 缓存域标记：Inner Shareable（核内共享）、Outer Shareable（芯片内共享）、Non-shareable（私有）
- 窥探事务（Snoop）：AR/AW 通道增加 snoop 请求，通知其他核的 cache 状态变更
- 脏写回（Dirty Writeback）：cache eviction 时把修改过的数据写回内存，保证内存最新

**ACE 事务类型**：

| 事务 | 作用 | 对应场景 |
|------|------|----------|
| ReadNoSnoop | 不窥探，直接读 | 非共享内存（如帧缓冲） |
| ReadOnce | 读一次，不缓存 | DMA 读设备寄存器 |
| ReadShared | 读入 Shared 状态 | 多核读共享数据 |
| ReadUnique | 读入 Exclusive，使其他核失效 | 锁操作前获取 |
| MakeInvalid | 使其他核 cache 失效 | 信号量释放后 |

**典型实现：CCI-550**

ARM CoreLink CCI-550（Cache Coherent Interconnect）连接 4 个 ACE Master（CPU 核）到 DDR：
- 每个 Master 有独立的 snoop 端口
- CCI 内部维护目录（Directory）：记录每个 cache line 被哪些核持有
- 收到 ReadUnique 时，CCI 查目录 → 发 Probe 给持有核 → 对方 Invalidate → 数据返回请求核

### <strong>CHI 与 ACE 的未来替代 **[M]**</strong>

<span class="badge-m">M</span>

CHI（Coherent Hub Interface）是 ARM 新一代一致性协议，定位取代 ACE。

| 维度 | ACE | CHI |
|------|-----|-----|
| 基础协议 | AXI4 扩展 | 独立包协议 |
| 传输方式 | 信号级握手 | 包级传输（类似 PCIe TLP） |
| 拓扑支持 | 单芯片多核 | 多插芯、多节点互联 |
| 延迟 | 较低 | 稍高（包解析开销） |
| 扩展性 | 最多 4-8 核 | 支持数百核 |

**嵌入式选择建议**：
- 双核/四核 Cortex-A（手机、车载、工业）→ ACE + CCI-550 足够
- 八核以上或服务器级（ARM Neoverse）→ CHI + CMN-700
- CHI 的学习成本明显高于 ACE，嵌入式领域短期（5 年内）ACE 仍是主流

<span class="red">ACE 不是选项，是多核 AMBA SoC 的必选项。</span>