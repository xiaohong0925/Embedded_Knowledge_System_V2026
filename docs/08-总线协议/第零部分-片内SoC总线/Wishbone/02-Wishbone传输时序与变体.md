# Wishbone 传输时序与变体 **[I]**

> <span class="badge-i">I</span>

### <strong>标准传输时序</strong>

<span class="badge-i">I</span>

Wishbone 只有一种传输模式：单周期握手（类似 APB 的简化版）。

标准周期：
- T1：Master 放 ADR/DAT/WE/SEL/STB/CYC，Slave 采样
- T2：Slave 返回 ACK + DAT（读时），Master 看到 ACK 后撤 STB

有等待时：Slave 拉低 ACK，Master 保持所有信号，直到 ACK 拉高。

对比 APB：Wishbone 和 APB 都是单周期握手，但 Wishbone 有 CYC 信号支持 burst，APB 没有突发。

### <strong>突发传输变体</strong>

<span class="badge-i">I</span>

- **单次传输**：CYC=1，STB=1，ACK=1，完成
- **块传输（Block Transfer）**：CYC 保持拉高，STB 每个周期重新拉高，连续多个 beat
- **循环突发（Cycle Burst）**：地址自动递增，类似 AXI INCR burst，但 Master 自己算地址：`next_adr = adr + (1 << granularity)`

Wishbone 规范不强制突发，但推荐 Master 支持递增地址模式。

### <strong>Wishbone 变体：经典 vs 流水线 vs 交叉开关</strong>

<span class="badge-i">I</span>

| 变体 | 特点 | 应用场景 |
|------|------|----------|
| 经典 Wishbone | 标准时序，地址和数据周期不分离 | 简单外设 |
| 流水线 Wishbone | 地址和数据周期分离，类似 AXI 流水 | 高性能通路 |
| 交叉开关 | 多主多从，通过仲裁器实现 | 多核系统 |

选择：简单外设用经典，高性能通路用流水线，多核系统用交叉开关。OpenCores 有开源的 Wishbone Crossbar IP。
