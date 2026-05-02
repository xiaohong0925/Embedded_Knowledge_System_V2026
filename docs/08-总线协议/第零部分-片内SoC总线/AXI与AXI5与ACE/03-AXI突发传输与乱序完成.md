# AXI 突发传输与乱序完成 [E]

> **本章学习目标**：
> - 理解 <span class="red">AXI 突发传输</span> 的带宽优化原理
> - 掌握 <span class="red">乱序完成（Out-of-Order）</span> 的事务 ID 机制
> - 学会计算 AXI 总线的理论带宽与实际利用率

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">AXI 突发传输</span>诞生于 <span class="green">AMBA 3</span> 规范（2003 年）。<br>
在此之前，总线传输每次都需要一次地址握手，<span class="blue">地址开销占比高达 50%</span>。<br>
突发传输允许一次地址握手后连续传输多笔数据，将地址开销降至 5% 以下。<br>
如今，突发传输是所有高性能总线（AXI、<span class="green">AHB</span>、<span class="green">TileLink</span>）的标配机制，<br>
广泛应用于 DDR 控制器、视频编解码器、<span class="green">DMA</span> 引擎等大数据量场景。<br>

---

## 突发传输：提升带宽的核心机制

---

### <strong>突发传输的带宽增益原理</strong>

<span class="red">突发传输（Burst）</span>允许在一次地址握手后连续传输多笔数据。<br>
相比单 beat 传输，<span class="blue">减少了地址通道的握手开销</span>。<br>

<span class="blue">类比理解：突发传输如同"快递批量发货"</span><br>
单 beat 传输 = 每件包裹单独填单、单独发货（效率低）<br>
突发传输 = 一次填单，连续发送 16 件包裹（效率高）<br>
地址握手就是"填单"，每单都要花时间，批量填单大幅提高效率。<br>

假设数据宽度 <span class="green">64 bit（8 byte）</span>，时钟 <span class="green">200 MHz</span>：<br>

| 传输模式 | 每事务 beat 数 | 地址开销占比 | 有效带宽 |
| --- | --- | --- | --- |
| 单 beat | 1 | 50%（2 cycle 地址 + 1 cycle 数据） | 267 MB/s |
| INCR-8 | 8 | 11%（2 cycle 地址 + 8 cycle 数据） | 640 MB/s |
| INCR-16 | 16 | 6%（2 cycle 地址 + 16 cycle 数据） | 712 MB/s |

<span class="blue">突发长度越长，地址开销占比越低，带宽越接近理论峰值。</span><br>

---

### <strong>三种突发类型的硬件实现差异</strong>

| 类型 | 地址行为 | Slave 实现复杂度 | 典型场景 |
| --- | --- | --- | --- |
| FIXED | 地址不变 | 简单（单一寄存器/FIFO） | GPIO 批量配置、DMA 环形缓冲 |
| INCR | 地址递增 | 中等（地址计数器） | DDR 连续读写、帧缓冲 |
| WRAP | 地址环绕（对齐边界） | 复杂（边界检测 + 环绕） | Cache line 填充、环形队列 |

<span class="blue">WRAP 突发的地址计算：当地址到达对齐边界（如 4KB）时自动回绕到边界起点。</span><br>

```verilog
// WRAP 突发地址生成器（Verilog）
module wrap_addr_gen (
  input  [31:0] start_addr,
  input  [7:0]  len,           // burst length
  input  [2:0]  size,           // bytes per beat
  output [31:0] next_addr
);
  wire [11:0] boundary = (len + 1) << size;  // 环绕边界
  wire [31:0] mask = ~(boundary - 1);         // 对齐掩码
  assign next_addr = (addr + (1 << size)) & mask | (start_addr & ~mask);
endmodule
```

---

### <strong>WSTRB 与字节使能：非对齐写控制</strong>

<span class="red">WSTRB（Write Strobe）</span>信号控制写数据中哪些字节有效。<br>
每 bit 对应 WDATA 的一个字节。<br>

| WDATA 宽度 | WSTRB 宽度 | 示例 |
| --- | --- | --- |
| 32 bit | 4 bit | WSTRB=4'b0001 仅最低字节有效 |
| 64 bit | 8 bit | WSTRB=8'b1111_0000 仅高 4 字节有效 |
| 128 bit | 16 bit | WSTRB=16'h00FF 仅第 1~2 字节有效 |

<span class="blue">WSTRB 允许在 64-bit 总线上只更新 1 个字节，避免读-改-写操作。</span><br>

---

## 乱序完成：事务 ID 与 QoS

---

### <strong>为什么需要乱序完成：多事务并行优化</strong>

<span class="red">乱序完成（Out-of-Order）</span>允许 Slave 先完成耗时短的事务，<br>
再完成耗时长的事务。<br>

假设 CPU 同时发起两个读请求：<br>
* 事务 A：读 DDR（耗时 100ns，cache miss）<br>
* 事务 B：读 SRAM（耗时 10ns，cache hit）<br>

如果强制顺序完成，CPU 必须等待 100ns 才能拿到 B 的数据。<br>
<span class="blue">乱序完成让 B 先返回，CPU 10ns 后继续执行，A 的数据稍后到达。</span><br>

---

### <strong>AXI ID 机制：ARID/AWID/RID/BID 的匹配规则</strong>

每个事务携带唯一的 <span class="green">ID</span>，Slave 用 ID 区分不同事务。<br>

| 通道 | ID 信号 | 方向 | 作用 |
| --- | --- | --- | --- |
| AW | AWID | Master→Slave | 标识写事务 |
| AR | ARID | Master→Slave | 标识读事务 |
| W | WID（AXI3） | Master→Slave | AXI4 已废弃，用 AWID 匹配 |
| R | RID | Slave→Master | 读响应携带原 ARID |
| B | BID | Slave→Master | 写响应携带原 AWID |

<span class="blue">相同 ID 的事务必须按顺序完成，不同 ID 的事务可乱序完成。</span><br>

```verilog
// Slave 乱序响应逻辑（简化）
reg [3:0] txn_queue [0:15];  // 事务队列
reg [3:0] txn_priority [0:15]; // 优先级

// 当高优先级事务（SRAM 读）完成时先返回
always @(posedge ACLK) begin
  for (i = 0; i < 16; i = i + 1) begin
    if (txn_ready[i] && txn_priority[i] == HIGH) begin
      RID  <= txn_id[i];
      RDATA <= txn_data[i];
      RVALID <= 1'b1;
    end
  end
end
```

---

### <strong>QoS 信号：AXI4 的优先级调度</strong>

<span class="red">QoS（Quality of Service）</span>信号是 <span class="green">AXI4</span> 新增的 4-bit 字段。<br>
<span class="blue">数值越大，优先级越高。</span><br>

| QoS 值 | 典型使用者 | 调度策略 |
| --- | --- | --- |
| 0xF | CPU（实时取指） | 绝对优先，可抢占低优先级事务 |
| 0x8 | GPU（帧渲染） | 高优先级，保障 60fps |
| 0x4 | DMA（批量拷贝） | 中等优先级，CPU 空闲时运行 |
| 0x0 | 调试接口 | 最低优先级，不干扰正常运行 |

<span class="blue">Interconnect 根据 QoS 决定仲裁 winner，高 QoS 事务可中断低 QoS 事务的 burst。</span><br>

---

## 带宽计算与实战优化

---

### <strong>理论带宽与实际利用率</strong>

<span class="red">理论带宽</span> = 数据宽度 × 时钟频率。<br>
实际带宽受突发长度、地址开销、握手等待影响。<br>

```verilog
// 带宽计算公式
// 理论带宽 = 64 bit × 200 MHz = 12.8 Gbit/s = 1.6 GB/s
// 实际带宽 = 1.6 GB/s × (1 - 地址开销占比) × (1 - 等待占比)
//          = 1.6 GB/s × 0.89 × 0.95
//          ≈ 1.35 GB/s
```

<span class="blue">嵌入式 SoC 中，AXI 总线利用率通常只有 60%~80%，因为 CPU 存在访存停顿周期。</span><br>

---

### <strong>嵌入式专属优化：DMA 的突发对齐</strong>

<span class="orange"><strong>1. 地址对齐原则</strong></span><br>

DMA 突发起始地址必须对齐到 <span class="green">突发长度 × 数据宽度</span> 的边界。<br>
不对齐会导致 Slave 拆分事务，<span class="blue">带宽下降 30%~50%</span>。<br>

```c
// 错误：起始地址不对齐
uint32_t *src = (uint32_t *)0x8000_0001;  // 1-byte 偏移
// DMA 会拆分为：0x8000_0000（前 3 字节）+ 0x8000_0004（后 1 字节）
// 两次 AW 握手，地址开销翻倍

// 正确：4-byte 对齐
uint32_t *src = (uint32_t *)0x8000_0000;  // 对齐
// 一次 AW 握手 + 连续 W 传输，带宽最大化
```

<span class="orange"><strong>2. 突发长度选择</strong></span><br>

| 场景 | 推荐突发长度 | 原因 |
| --- | --- | --- |
| DDR 连续读写 | 16 beat（最大） | 地址开销最低 |
| Cache line 填充 | 8 beat（64-byte line / 8-byte beat） | 精确匹配 Cache line |
| 小数据包（网络） | 4 beat | 避免长突发阻塞低优先级事务 |
| 寄存器批量配置 | 1 beat（单拍） | 寄存器访问无需突发 |

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| 突发传输 | 一次地址握手后连续传输多笔数据，减少地址开销 |
| INCR | 地址递增，最常用，适合内存连续访问 |
| WRAP | 地址环绕，适合 Cache line 和环形缓冲 |
| WSTRB | 字节使能，控制写数据中哪些字节有效 |
| 乱序完成 | 不同 ID 的事务可乱序完成，提升多事务并行度 |
| QoS | AXI4 优先级信号，高数值可抢占低优先级事务 |
| 带宽优化 | 对齐地址 + 最大突发长度 + 减少等待周期 |

---

## 练习

1. 计算 128-bit AXI @ 300MHz 的 INCR-16 突发理论带宽和实际带宽（假设地址开销 10%、等待周期 5%）。<br>
2. 为什么 WRAP 突发需要地址边界检测，而 INCR 不需要？<br>
3. 在 Linux DMA 驱动中，如何确保 DMA 缓冲区的地址对齐到 AXI 突发边界？
