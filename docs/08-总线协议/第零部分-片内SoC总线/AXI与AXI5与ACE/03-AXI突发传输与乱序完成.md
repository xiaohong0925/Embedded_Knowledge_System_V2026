# AXI 突发传输与乱序完成 **[I→E]**

> <span class="badge-i">I</span> → <span class="badge-e">E</span>

### <strong>突发传输（Burst）机制</strong>

<span class="badge-i">I</span>

突发传输是 AXI 高效利用带宽的核心机制。Master 只需发一次地址，就可以连续传输多个数据 beat。

突发参数三件套：
- **AWLEN/ARLEN**：突发长度（0-255，实际 beat 数 = 值+1，即 1-256 beat）
- **AWSIZE/ARSIZE**：每 beat 字节数（0=1B, 1=2B, 2=4B, 3=8B...6=64B）
- **AWBURST/ARBURST**：突发类型（0=FIXED, 1=INCR, 2=WRAP）

| 突发类型 | 含义 | 应用场景 |
|----------|------|----------|
| FIXED | 地址不变 | FIFO 接口、像素缓冲 |
| INCR | 地址递增 | 内存连续访问、DMA |
| WRAP | 地址回卷 | Cache line fill（对齐到 cache line 边界） |

带宽计算：突发总字节 = (LEN+1) × 2^SIZE

典型配置：读取 1KB cache line = LEN=15, SIZE=6（64B beat）, 16 beat

### <strong>窄传输与非对齐传输</strong>

<span class="badge-i">I</span>

**窄传输（Narrow Transfer）**：Master 数据总线宽度 > 突发 SIZE。

例如 64bit 总线写 32bit 数据，WSTRB（写选通）标记有效字节位置：
```verilog
WSTRB = 8'b0000_1111  // 只写低 4 字节
WSTRB = 8'b1111_0000  // 只写高 4 字节
```

**非对齐传输（Unaligned Transfer）**：起始地址不是 beat 大小的整数倍。

AXI4 原生支持非对齐：首 beat 地址任意，后续 beat 自动对齐递增。Slave 侧需要做地址调整和数据重排。

### <strong>乱序完成（Out-of-Order）与 ID 路由</strong>

<span class="badge-e">E</span>

**问题背景**：DDR 控制器对不同 bank 的访问可以并行。Master 先发事务 A 到 bank0，后发事务 B 到 bank1。B 可能先完成——如果总线不允许乱序，Master 必须等 A 完成才能收 B，带宽浪费。

**AXI 解决方案**：AWID/ARID/WID/RID/BID。

- Master 给每个事务打标签（ID），同一 ID 的事务必须按序完成，不同 ID 可乱序
- ID 位宽通常 4-8 bit，支持 16-256 个独立事务流
- 总线矩阵（如 NIC-400）会自动扩展 ID：进来 4bit，内部扩展为 8bit（加入 Master 编号），返回时压缩还原

**示例时序**：
```
T1: Master 发 ARID=0, ARADDR=0x1000  // 事务 A
T2: Master 发 ARID=1, ARADDR=0x2000  // 事务 B
T3: Slave 返回 RID=1, RDATA=...      // 事务 B 先完成（乱序）
T4: Slave 返回 RID=0, RDATA=...      // 事务 A 后完成
```

注意：WID 在 AXI4 中已废弃（写数据必须按 AWID 顺序），只有 AXI3 需要 WID。

<span class="blue">乱序不是 chaos，是 performance。</span>