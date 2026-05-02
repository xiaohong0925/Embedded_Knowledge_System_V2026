# 第零部分：片内 SoC 总线

> <span class="badge-b">B</span> → <span class="badge-i">I</span> → <span class="badge-e">E</span> → <span class="badge-m">M</span>

片内总线是 SoC 的骨架。本部分覆盖 AMBA 家族（AXI/AHB/APB）和开源替代方案（TileLink/Wishbone），建立"选对总线、理解时序、能动手设计"的全链路能力。

---

## 章节导航

| 章节 | 难度 | 定位 | 核心内容 |
|------|------|------|----------|
| [AMBA 总线协议族（总览）](AMBA总线协议族（总览）/01-基础认知.md) | [B→I] | 导引 | AMBA 家族全貌、演进路线、选择决策树 |
| [AXI 与 AXI5 与 ACE](AXI与AXI5与ACE/01-AXI协议基础与架构.md) | [I→E] | 核心 | 5 通道架构、突发/乱序/QoS、ACE 缓存一致性 |
| [AHB](AHB/01-AHB基础认知与架构.md) | [B→I] | 轻量替代 | 流水线传输、多主仲裁、AHB-Lite 简化版 |
| [APB](APB/01-APB基础认知与架构.md) | [B→I] | 寄存器专用 | 极简时序、低功耗时钟门控、桥接设计 |
| [TileLink](TileLink/01-TileLink基础认知与架构.md) | [I→E] | RISC-V 生态 | 三级一致性、目录式协议、Chipyard 实战 |
| [Wishbone](Wishbone/01-Wishbone基础认知与架构.md) | [B→I] | FPGA/教学 | 最简开源总线、外设 RTL、FPGA→ASIC 迁移 |

---

## 选择速查

```
商业 ARM SoC → AMBA（AXI + AHB + APB 三级总线）
RISC-V 芯片 → TileLink（TL-C 一致性 + TL-UH 加速器）
FPGA 原型/教学 → Wishbone（极简 RTL + OpenCores IP 生态）
```

---

## 学习路径

| 读者 | 阅读顺序 | 目标 |
|------|----------|------|
| **小白 (B)** | AMBA 总览 → AHB → APB → Wishbone | 看懂 SoC 框图里的总线，理解为什么分三级 |
| **高手 (I→E)** | AXI 全部 → TileLink 全部 → AHB 仲裁 → APB 桥接 | 能配通 DDR AXI 接口，分析带宽瓶颈 |
| **大师 (E→M)** | ACE/CHI → TileLink 一致性源码 → Wishbone 桥接器 → 自研 RTL | 能设计总线从机，规划多核一致性架构 |

---

<span class="red">本部分属于硬件层 [B→E]，侧重信号/时序/架构，软件驱动内容放轻。</span>
