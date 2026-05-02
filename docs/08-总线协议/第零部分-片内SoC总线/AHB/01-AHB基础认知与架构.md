# AHB 基础认知与架构 **[B→I]**

> <span class="badge-b">B</span> → <span class="badge-i">I</span>

### <strong>AHB 核心定义与价值</strong>

<span class="badge-b">B</span>

AHB（Advanced High-performance Bus）是 AMBA2 时代定义的高性能总线，1999 年推出。它是单通道共享总线：地址和数据共用一组信号线，分时复用。

为什么还需要 AHB？AXI 不是更好吗？
- **面积/功耗敏感**：AHB 接口比 AXI 小 30-40%，低功耗 MCU 用 AHB 更省面积
- **复杂度适中**：不需要乱序完成的场景，AHB 足够且更容易验证
- **Legacy 生态**：大量 ARM9、Cortex-M 系列 SoC 仍使用 AHB，维护需求持续存在

<span class="blue">AHB 是 AXI 的"经济适用房"，不是豪华别墅，但住得舒服。</span>

典型芯片中的 AHB：
- **STM32F4/F7/H7**：Cortex-M4/M7 内核通过 AHB 总线矩阵连接 SRAM、Flash、DMA、APB 桥
- **i.MX6ULL**：Cortex-A7 的 L2 cache 控制器后接 AHB 总线矩阵到各类外设

### <strong>AHB 与 AXI 的本质差异</strong>

<span class="badge-b">B</span>

| 特性 | AHB | AXI4 |
|------|-----|------|
| 通道数 | 1（地址+数据复用） | 5（读写分离） |
| 读写并发 | 半双工，分时 | 全双工，并发 |
| 突发长度 | 4/8/16 beat（固定） | 1-256 beat（灵活） |
| 乱序完成 | 不支持 | 支持（ID 路由） |
| 等待周期 | HREADY 插入等待 | 每个通道独立握手 |
| 面积 | 小 | 大 |

选择逻辑：带宽需求 < 200MB/s + 无需乱序 + 面积敏感 → AHB；否则 → AXI。

### <strong>AHB 总线信号速览</strong>

<span class="badge-i">I</span>

| 信号 | 方向 | 作用 |
|------|------|------|
| HCLK | 系统 | 总线时钟 |
| HRESETn | 系统 | 异步复位，低有效 |
| HADDR[31:0] | Master→Slave | 32 位地址 |
| HWDATA / HRDATA | Master↔Slave | 写数据 / 读数据 |
| HWRITE | Master→Slave | 1=写，0=读 |
| HSIZE[2:0] | Master→Slave | 传输大小（0=Byte, 1=Halfword, 2=Word...） |
| HBURST[2:0] | Master→Slave | 突发类型（SINGLE/INCR/WRAP4...） |
| HTRANS[1:0] | Master→Slave | 传输类型（IDLE/BUSY/NONSEQ/SEQ） |
| HREADY | Slave→Master | 1=就绪，0=插入等待 |
| HRESP[1:0] | Slave→Master | 响应（OKAY/ERROR/RETRY/SPLIT） |

**HTRANS 信号是 AHB 的特色**：
- IDLE：总线空闲
- BUSY：Master 忙，插入等待（burst 中间插一脚）
- NONSEQ：突发第一个 beat 或单次传输
- SEQ：突发后续 beat，地址自动递增
