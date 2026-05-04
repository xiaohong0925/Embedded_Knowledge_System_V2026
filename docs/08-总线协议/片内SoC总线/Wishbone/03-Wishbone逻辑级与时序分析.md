# Wishbone逻辑级与时序分析

<span class="badge-i">[Intermediate]</span>

<span class="red">Wishbone</span> 是 OpenCores 社区推动的开放式片上互连标准，设计哲学是简单和可移植。

---

## <strong>基础认知</strong>

### <strong>为什么Wishbone在开源硬件中流行</strong>

<span class="blue">Wishbone 的设计目标是"最小 viable bus"</span>，只定义最基本的信号，不强制实现复杂特性，让开发者可以按需扩展。

### <strong>周期类型</strong>

| 类型 | 特点 | 适用场景 |
|------|------|----------|
| Classic | 单周期传输，最简单 | 低速外设 |
| Registered Feedback | 插入寄存器，缓解时序压力 | 高频设计 |
| Pipelined | 地址和数据流水线，提高吞吐 | 高性能内存 |

---

## <strong>原理解析</strong>

### <strong>Classic 周期时序</strong>

```
Cycle 1: Address + Data valid, STB=1
Cycle 2: ACK=1 (slave ready) 或 ERR=1 (error)
```

<span class="red">Wishbone Classic 是单握手周期</span>：Master 在 T1 放置地址和数据并置 STB=1，Slave 在 T2 返回 ACK。

### <strong>TAG 扩展机制</strong>

<span class="green">Wishbone TAG 扩展信号语义</span>，例如区分用户态/内核态访问。

| TAG 信号 | 用途 |
|----------|------|
| TGA[xx] | 地址标签（如权限级别） |
| TGD[xx] | 数据标签（如字节使能） |

---

## <strong>软硬件实战</strong>

### <strong>跨时钟域 CDC 桥</strong>

```verilog
// Wishbone Classic to Pipelined CDC Bridge
module wb_cdc (
    input  clk_src, input  rst_src,
    input  clk_dst, input  rst_dst,
    // Source interface
    input  [31:0] src_adr, input  src_stb,
    output        src_ack,
    // Destination interface
    output [31:0] dst_adr, output dst_stb,
    input         dst_ack
);
    // Two-flop synchronizer for ack
    reg ack_ff1, ack_ff2;
    always @(posedge clk_src) begin
        ack_ff1 <= dst_ack;
        ack_ff2 <= ack_ff1;
        src_ack <= ack_ff2;
    end
endmodule
```

---

## <strong>历史演进</strong>

- <span class="green">1997 年 WISHBONE 1.0</span> — OpenCores 发布，8/16/32位支持<br>
- <span class="green">2002 年 WISHBONE B.1</span> — 增加 Registered Feedback<br>
- <span class="green">2010 年 WISHBONE B.3</span> — TAG 扩展，流水线支持<br>
- <span class="green">2019 年 WISHBONE B.4</span> — _burst_ 扩展

---

## 小结与练习

**练习**

1. 比较 Wishbone Classic 和 Pipelined 在吞吐量上的差异。
2. 分析 Wishbone 跨时钟域处理的常见方案。
3. 计算 Wishbone 在 50MHz 时钟下的理论带宽（32位数据宽度）。
