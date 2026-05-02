# TileLink 基础认知与架构 [I→E]

> **本章学习目标**：
> - 理解 <span class="red">TileLink</span> 的设计哲学与 RISC-V 生态定位
> - 掌握 TileLink <span class="red">三级一致性协议</span>（TL-UL/TL-UH/TL-C）的区别
> - 建立 TileLink 在片上总线中的选型认知

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">TileLink</span> 诞生于 <span class="green">2014 年</span>，由 <span class="green">SiFive</span> 公司提出。<br>
随着 <span class="green">RISC-V</span> 开源指令集架构的兴起，需要一套与 RISC-V 哲学一致的开放总线标准。<br>
AMBA 协议受 ARM 公司版权约束，且面向 ARM 生态优化。<span class="blue">TileLink 作为完全开放的标准，由 RISC-V 基金会维护，支持缓存一致性、乱序完成、QoS 等高级特性，成为 RISC-V SoC 的事实标准。</span><br>
如今，TileLink 广泛应用于 <span class="green">Rocket Chip</span>、<span class="green">Chipyard</span>、<span class="green">Berkeley Out-of-Order Machine</span> 等开源 RISC-V 处理器。

---

## TileLink 的设计哲学与定位

---

### <strong>为什么需要 TileLink：RISC-V 的开放总线标准</strong>

<span class="red">TileLink</span> 是 RISC-V 生态的片上总线协议。<br>
其设计初衷是为 RISC-V 处理器提供一套<span class="blue">"与 ISA 同等开放"的总线标准</span>。<br>

<span class="blue">类比理解：TileLink 如同"开源社区的共享图书馆"</span><br>
AMBA 是"商业出版社的藏书"（质量高、需授权、面向特定群体）。<br>
TileLink 是"开源社区的共享图书馆"（免费开放、任何人可贡献、格式统一）。<br>
RISC-V 处理器设计者可以像借书一样免费使用 TileLink，无需担心版权和授权费用。<br>

<span class="orange"><strong>1. 完全开放：无版权约束</strong></span><br>
TileLink 规范由 <span class="green">RISC-V 基金会</span> 维护，完全免费开放。<br>
与 AMBA 的 ARM 版权约束不同，任何人可自由实现和修改。<br>

<span class="orange"><strong>2. 三级一致性：按需选择复杂度</strong></span><br>
TileLink 定义 <span class="blue">3 个一致性级别</span>：<br>
* <span class="green">TL-UL（Uncached Lightweight）</span>：无缓存，面向寄存器访问<br>
* <span class="green">TL-UH（Uncached Heavyweight）</span>：无缓存但支持突发和乱序<br>
* <span class="green">TL-C（Cached）</span>：完整缓存一致性，面向多核处理器<br>

<span class="orange"><strong>3. Chisel 原生：与 RISC-V 工具链深度融合</strong></span><br>
TileLink 的参考实现用 <span class="green">Chisel</span>（Scala DSL 硬件描述语言）编写。<br>
与 <span class="green">Rocket Chip</span> 生成器无缝集成，一行配置即可生成完整 SoC。<br>

---

### <strong>TileLink 与 AMBA 的核心差异</strong>

| 特性 | TileLink | AMBA AXI4 |
| --- | --- | --- |
| 版权 | 完全开放 | ARM 版权 |
| 一致性级别 | 3 级（UL/UH/C） | 需 ACE/CHI 扩展 |
| 通道模型 | 5 通道（A/C/D/E/B） | 5 通道（AW/W/B/AR/R） |
| 乱序完成 | 原生支持 | 原生支持 |
| 工具链 | Chisel/Rocket Chip | Verilog/SystemVerilog |
| 典型生态 | RISC-V | ARM |

<span class="blue">关键差异：TileLink 的三级一致性内建，AXI 需 ACE 扩展；TileLink 原生面向 Chisel 设计流。</span><br>

---

## TileLink 三级一致性协议

---

### <strong>TL-UL：无缓存轻量级</strong>

<span class="red">TL-UL</span> 是 TileLink 最简单的子集。<br>
面向寄存器访问和简单内存读写，<span class="blue">无缓存、无突发、无乱序</span>。<br>

| 特性 | TL-UL |
| --- | --- |
| 通道 | A（地址）+ D（数据/响应） |
| 突发 | 不支持 |
| 乱序 | 不支持 |
| 缓存 | 无 |
| 典型应用 | GPIO、UART、Timer 寄存器 |

<span class="blue">TL-UL 的信号数量和复杂度与 APB 相当，但支持更灵活的地址映射。</span><br>

---

### <strong>TL-UH：无缓存重量级</strong>

<span class="red">TL-UH</span> 在 TL-UL 基础上增加突发传输和乱序完成。<br>
面向 DMA、显存缓冲等需要高带宽但无需缓存的场景。<br>

| 特性 | TL-UH |
| --- | --- |
| 通道 | A + C + D + E |
| 突发 | 支持（最大 64 beat） |
| 乱序 | 支持（源 ID 区分） |
| 缓存 | 无 |
| 典型应用 | DMA 引擎、帧缓冲 |

---

### <strong>TL-C：完整缓存一致性</strong>

<span class="red">TL-C</span> 是 TileLink 的完整版，支持多核缓存一致性。<br>
面向多核 RISC-V 处理器和共享内存系统。<br>

| 特性 | TL-C |
| --- | --- |
| 通道 | A + B + C + D + E（全部 5 通道） |
| 突发 | 支持 |
| 乱序 | 支持 |
| 缓存 | 支持（MESI/TMO 状态机） |
| 典型应用 | 多核 RISC-V 处理器 |

```mermaid
flowchart TD
    subgraph TL_UL["TL-UL 轻量级"]
        U1["GPIO"]
        U2["UART"]
        U3["Timer"]
    end
    
    subgraph TL_UH["TL-UH 重量级"]
        H1["DMA 引擎"]
        H2["帧缓冲"]
    end
    
    subgraph TL_C["TL-C 缓存一致性"]
        C1["CPU Core 0"]
        C2["CPU Core 1"]
        C3["L2 Cache"]
    end
    
    IC["TileLink Interconnect"]
    
    U1 --> IC
    U2 --> IC
    U3 --> IC
    H1 --> IC
    H2 --> IC
    C1 --> IC
    C2 --> IC
    C3 --> IC
```

<span class="blue">TileLink Interconnect 同时连接 TL-UL/UH/C 设备，通过协议转换器自动适配。</span><br>

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| TileLink | RISC-V 开源总线标准，完全免费开放 |
| TL-UL | 无缓存轻量级，2 通道，面向寄存器 |
| TL-UH | 无缓存重量级，4 通道，支持突发和乱序 |
| TL-C | 完整缓存一致性，5 通道，面向多核 |
| Chisel | Scala DSL 硬件描述语言，TileLink 原生实现语言 |
| Rocket Chip | UC Berkeley 开源 RISC-V SoC 生成器 |

---

## 练习

1. 为什么 TileLink 选择三级一致性设计，而不是像 AXI 那样通过一个协议覆盖所有场景？<br>
2. 对比 TL-UL 和 APB4 的信号数量，说明为什么 RISC-V 芯片常用 TL-UL 替代 APB。<br>
3. 在 Chipyard 中配置一个单核 RISC-V SoC，应使用 TL-UL 还是 TL-C？说明理由。
