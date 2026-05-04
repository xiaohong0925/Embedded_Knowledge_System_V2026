# 片内SoC总线

<span class="badge-b">[Beginner]</span>

<span class="red">片内SoC总线</span> 是嵌入式Linux系统中 SoC内部IP互联 的重要组成部分。

---

## <strong>模块概览</strong>

<span class="green">片内SoC总线</span> 涵盖以下总线类型：

- <span class="green">AMBA</span> — ARM总线架构标准族<br>
- <span class="green">AXI</span> — 高性能片上互连<br>
- <span class="green">AHB</span> — 高性能总线，中等复杂度<br>
- <span class="green">APB</span> — 低功耗外设总线<br>
- <span class="green">TileLink</span> — RISC-V开源总线<br>
- <span class="green">Wishbone</span> — 开源IP互联标准

---

## <strong>BIEM 学习路径</strong>

| 级别 | 目标 | 推荐文件 |
|------|------|----------|
| <span class="badge-b">B</span> | 建立直觉，看懂总线在干什么 | `01-*` 基础认知文件 |
| <span class="badge-i">I</span> | 理解实现机制，能跟读时序/协议 | `02-03*` 原理解析文件 |
| <span class="badge-e">E</span> | 掌握设计权衡，能调试排错 | `04-*` 实战与故障排查 |
| <span class="badge-m">M</span> | 洞察演进趋势，参与标准制定 | `05-*` 历史演进与前沿 |

---

## <strong>总线选型速查表</strong>

| 总线 | 速率 | 距离 | 拓扑 | 适用场景 |
|------|------|------|------|----------|
| AXI | 高 | 片上 | 交叉开关 | 高性能处理器、DMA |
| AHB | 中高 | 片上 | 总线矩阵 | 内存控制器、DMA |
| APB | 低 | 片上 | 点对点 | 寄存器、UART、GPIO |
| TileLink | 高 | 片上 | 交叉开关 | RISC-V SoC、缓存一致性 |
| Wishbone | 中 | 片上 | 点对点 | 开源IP、FPGA |

---

## <strong>认知流导航</strong>

```mermaid
graph LR
    A[基础认知] --> B[原理解析]
    B --> C[技术教学]
    C --> D[软硬件实战]
    D --> E[历史演进]
    E --> F[小结与练习]
```

---

## <strong>小结与练习</strong>

| 要点 | 说明 |
|------|------|
| 核心概念 | 片内SoC总线 的协议分层与选型原则 |
| 关键技能 | 根据场景选择合适总线、读懂时序图 |
| 常见误区 | 忽视电气特性、混淆主从模式 |

**练习**

1. 比较 片内SoC总线 中两种总线的速率、距离和适用场景差异。
2. 如何在嵌入式系统中同时管理多条 片内SoC总线？
3. 分析 片内SoC总线 中某条总线的历史演进与未来趋势。

---

## 学习路径

- **小白**：从 `01-*` 基础认知开始，理解每条总线的核心用途。
- **高手**：深入 `02-03*` 原理解析，掌握时序与协议细节。
- **专家**：研究 `04-*` 实战案例与 `05-*` 历史演进，参与社区贡献。
