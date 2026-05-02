# AHB 传输时序与流水线 **[I]**

> <span class="badge-i">I</span>

### <strong>基本传输时序</strong>

<span class="badge-i">I</span>

AHB 的基本传输固定为 2 周期（无等待时）：

| 周期 | 阶段 | Master 动作 | Slave 动作 |
|------|------|-------------|-----------|
| T1 | 地址阶段 | 放 HADDR、HWRITE、HSIZE、HBURST、HTRANS | 采样地址和控制 |
| T2 | 数据阶段 | 放 HWDATA（写）或接收 HRDATA（读） | 返回数据或采样写数据，拉高 HREADY |

有等待时：Slave 在 T2 拉低 HREADY，Master 保持地址/数据，直到 HREADY 拉高。

对比 AXI：AHB 也是 2 周期，但 AHB 地址和数据共用总线，不能重叠；AXI 地址和数据分通道，可以流水线重叠。

### <strong>流水线（Pipelining）机制</strong>

<span class="badge-i">I</span>

AHB 支持地址流水线：当前数据传输周期的同时，Master 可以发下一个地址。

理想情况：连续突发时，T1 发地址 A，T2 传数据 A 同时发地址 B，T3 传数据 B 同时发地址 C...每个周期都有数据传输。

实际限制：
- Slave 插入等待（HREADY 低）会打断流水线，Master 必须等 HREADY 才能发新地址
- 总线切换（一个 Master 释放，另一个 Master 获取）需要 1 个仲裁周期

与 AXI 对比：AXI 的 5 个通道天然流水，地址和数据完全并行；AHB 需要严格交替地址周期和数据周期。

### <strong>突发传输详解</strong>

<span class="badge-i">I</span>

| 突发类型 | HBURST | 行为 | 应用场景 |
|----------|--------|------|----------|
| SINGLE | 000 | 单次传输 | 寄存器访问 |
| INCR | 001 | 未定义长度递增 | 连续内存块 |
| WRAP4 | 010 | 4 beat 回卷 | cache line fill（对齐到 16B） |
| INCR4 | 011 | 4 beat 递增 | 小批量 DMA |
| INCR8 | 101 | 8 beat 递增 | 中等批量 DMA |
| INCR16 | 111 | 16 beat 递增 | 大批量 DMA |

注意：AHB 突发长度固定为 4/8/16，不像 AXI 可以 1-256 任意配置。

**HTRANS 状态机**：
```
IDLE → NONSEQ(首beat) → SEQ(后续beat) → IDLE
            ↓
         BUSY(插入等待)
```

BUSY 的作用：Master 需要额外时间准备数据（如 FIFO 空），在 burst 中间插入一个周期，告诉 Slave"我还活着但还没准备好"。