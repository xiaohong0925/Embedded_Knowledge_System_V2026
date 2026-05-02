# APB 传输时序与低功耗 **[I]**

> <span class="badge-i">I</span>

### <strong>APB 状态机与传输时序</strong>

<span class="badge-i">I</span>

APB 只有 3 个状态，极简：

```
IDLE → SETUP → ENABLE → IDLE
```

固定 2 周期传输（无等待时）：

| 周期 | 状态 | Master 动作 | Slave 动作 |
|------|------|-------------|-----------|
| T1 | SETUP | PSEL 拉高、PADDR/PWRITE/PWDATA 有效 | 采样地址和控制 |
| T2 | ENABLE | PENABLE 拉高 | 返回 PRDATA（读）或采样 PWDATA（写），PREADY 返回 |

有等待时：PREADY 拉低，ENABLE 状态延长，直到 PREADY 拉高。

对比 AHB：APB 和 AHB 都是 2 周期，但 APB 不支持流水线，每传输之间至少 1 个 IDLE 周期。AHB 支持地址流水线，连续传输可以重叠。

### <strong>APB3 与 APB4 的演进</strong>

<span class="badge-i">I</span>

- **APB2**（1999）：最原始版本，无 PREADY/PSLVERR，Slave 必须单周期响应。实现最简单，但灵活性差。
- **APB3**（2003）：增加 PREADY（允许 Slave 慢响应）和 PSLVERR（错误报告）。现在最普及的版本。
- **APB4**（2010）：增加 PPROT（TrustZone/特权访问标记）和 PSTRB（字节选通，支持窄传输）。用于需要安全扩展的汽车/IoT 芯片。

嵌入式现状：APB3 占 80% 以上，APB4 主要用于支持 TrustZone 的 Cortex-M23/M33 系列。

### <strong>低功耗设计：APB 的杀手锏</strong>

<span class="badge-i">I</span>

APB 的低功耗优势来自三个层面：

**1. 时钟门控**
PCLK 可以单独关闭，整个 APB 总线和所有外设进入静态。ARM 的 PCKGEN（时钟门控单元）支持按外设开关时钟。

**2. 外设分区分组**
一组 GPIO 在 Bank A，另一组在 Bank B，可以分别开关。例如系统休眠时只保留 Bank A（唤醒引脚），Bank B 完全关断。

**3. 自动唤醒**
中断信号从 APB 外设（如 GPIO 中断）直接连到 NVIC/GIC，不依赖 APB 时钟。外设时钟关断时，中断线仍能唤醒系统。

功耗数据对比（典型 40nm 工艺）：
| 总线 | 动态功耗（mW/MHz） | 静态漏电（μW） |
|------|-------------------|---------------|
| AXI4（128bit） | 0.8 | 50 |
| AHB（32bit） | 0.3 | 20 |
| APB（32bit） | 0.15 | 8 |

<span class="blue">APB 的功耗是 AXI 的 1/5，这就是它永远不被淘汰的原因。</span>
