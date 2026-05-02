# AXI 性能优化与 QoS **[E]**

> <span class="badge-e">E</span>

### <strong>AXI 性能指标与瓶颈分析</strong>

<span class="badge-e">E</span>

有效带宽 = 理论峰值带宽 × 握手效率 × 协议开销比例

理论峰值容易算：AXI 总线宽度 × 时钟频率。例如 128bit AXI @ 800MHz = 12.8GB/s。但实际永远达不到这个数。

**瓶颈常见位置：**

1. **DDR 控制器侧**：
   - Bank conflict：两个事务命中同一 bank 的不同 row，需要 precharge + activate，延迟突增 20-30 周期
   - Refresh 周期：DDR 每 7.8μs 需要刷新一行，刷新期间不可访问
   - Row miss：访问的 row 不在 sense amplifier 中，需要 activate（约 15ns）

2. **总线矩阵侧**：
   - 多主争用同一 Slave，仲裁等待
   - 地址/数据通道握手间隔大，流水线不连续

3. **Master 侧**：
   - 突发长度太短（如 LEN=0），地址开销占比高
   - 连续事务之间插入 IDLE 周期

**定位工具：**
- AXI 性能监控单元（PMU）：记录每个通道的握手率、等待周期数
- DDR 控制器计数器：bank hit rate、refresh 占比、row hit rate

### <strong>QoS（服务质量）机制</strong>

<span class="badge-e">E</span>

AWQOS/ARQOS：4bit 优先级标记（0-15），数值越高优先级越高。

典型分配策略：
| Master | QoS | 理由 |
|--------|-----|------|
| CPU 读 | 15 | 指令/数据 fetch 不能等 |
| GPU | 12 | 帧缓冲读取，延迟敏感 |
| DMA | 8 | 批量传输，可以容忍延迟 |
| 调试 | 0 | 最低优先级，不影响业务 |

总线矩阵仲裁策略：
- **固定优先级**：简单，但低优先级可能饿死
- **轮询**：公平，但延迟不确定
- **加权公平队列（WFQ）**：折中，按权重分配带宽

注意：**QoS 只在总线矩阵有效**。点对点 AXI（如 CPU 直连 DDR 控制器）没有仲裁，QoS 信号被 Slave 忽略。

### <strong>AXI4 新增特性</strong>

<span class="badge-e">E</span>

- **AWREGION/ARREGION**（4bit）：16 个区域划分，支持 NUMA 风格的内存分区。例如 region0 指向 DDR0，region1 指向 DDR1。
- **AWCACHE/ARCACHE**（4bit）：缓存策略提示。bit0=bufferable，bit1=modifiable，bit2=read allocate，bit3=write allocate。CPU cache 控制器根据这些提示决定是否预取、是否写回。
- **AWUSER/ARUSER/WUSER/RUSER/BUSER**：自定义侧带信号，厂商扩展。例如某些 AI 加速器用 USER 信号传递 tensor 维度信息。

<span class="blue">QoS 不是万能药，它只是仲裁器的提示。真正的带宽靠突发长度和访问模式优化。</span>