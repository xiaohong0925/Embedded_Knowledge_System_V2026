# TileLink 基础认知与架构 **[B→I]**

> <span class="badge-b">B</span> → <span class="badge-i">I</span>

### <strong>TileLink 核心定义与价值</strong>

<span class="badge-b">B</span>

TileLink 是 RISC-V 社区推出的开源片上总线协议，由 SiFive 主导设计。它不是 ARM 的标准，但在 RISC-V SoC 中已经成为事实标准。

为什么 RISC-V 需要自己的总线？
- ARM 的 AMBA 需要授权，RISC-V 追求开放生态，TileLink 完全开源
- 设计目标：简单 enough 能用手写 RTL 实现，强大 enough 支持服务器级多核

<span class="blue">TileLink 是 RISC-V 世界里的 AMBA，但更年轻、更开放。</span>

典型芯片中的 TileLink：
- **SiFive U74**：双核 RISC-V 通过 TileLink 连接 L2 cache、DDR 控制器、外设
- **香山（XiangShan）处理器**：中科院开源 RISC-V 高性能核，使用 TileLink 作为片内总线

### <strong>TileLink 与 AMBA 的定位差异</strong>

<span class="badge-b">B</span>

| 维度 | TileLink | AMBA |
|------|----------|------|
| 出身 | RISC-V / SiFive 开源生态 | ARM 商业生态 |
| 一致性 | 原生支持（TL-C） | 通过 ACE/CHI 扩展 |
| 协议复杂度 | 中（3 个一致性级别） | 高（AXI+ACE+CHI 多层） |
| 开源实现 | Rocket Chip、Chipyard 全开源 | ARM CoreLink 闭源，只有 spec 公开 |
| 典型用户 | RISC-V 芯片公司、学术界 | ARM SoC 厂商 |

不做优劣对比，只说明：ARM 生态选 AMBA，RISC-V 生态选 TileLink。

### <strong>TileLink 三级一致性架构</strong>

<span class="badge-i">I</span>

TileLink 定义了三个一致性级别，对应不同的应用场景：

| 级别 | 名称 | 功能 | 对标 AMBA |
|------|------|------|-----------|
| TL-UL | Uncached Lightweight | 无缓存，寄存器访问 | APB |
| TL-UH | Uncached Heavyweight | 无缓存，支持原子和突发 | AHB |
| TL-C | Cached Coherent | 全缓存一致性 | AXI+ACE |

设计选择：外设接 TL-UL，DMA/加速器接 TL-UH，CPU 集群接 TL-C。
