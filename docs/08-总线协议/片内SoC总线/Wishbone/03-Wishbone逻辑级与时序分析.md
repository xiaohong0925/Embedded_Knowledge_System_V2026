# Wishbone逻辑级与时序分析

<span class="badge-i">[Intermediate]</span>

<span class="red">Wishbone</span> 是 OpenCores 社区推动的开放式片上互连标准，设计哲学是简单和可移植。

---

## <strong>基础认知</strong>

### <strong>周期类型</strong>

| 类型 | 特点 |
|------|------|
| Classic | 单周期传输，最简单 |
| Registered Feedback | 插入寄存器，缓解时序压力 |
| Pipelined | 地址和数据流水线，提高吞吐 |

### <strong>TAG机制</strong>

<span class="green">Wishbone TAG 扩展信号语义</span>，例如区分用户态/内核态访问。

---

## <strong>小结与练习</strong>

**练习**

1. 比较 Wishbone Classic 和 Pipelined 在吞吐量上的差异。
2. 分析 Wishbone 跨时钟域处理的常见方案。
3. 计算 Wishbone 在 50MHz 时钟下的理论带宽（32位数据宽度）。
