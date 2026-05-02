# 第七部分：调试与跟踪专用总线

> **难度等级**：I → M
> 
003e 本部分覆盖<span class="red">芯片调试和系统跟踪</span>的专用接口。
003e 
003e 从 JTAG 的边界扫描到 SWD 的串行调试，从 CoreSight 的片上跟踪到 ETM 的程序流追踪，
003e 这些协议是嵌入式开发者的"X光"和"显微镜"。

---

## 本部分大章概览

| 大章 | 难度 | 核心内容 | 典型场景 |
| --- | --- | --- | --- |
| JTAG | I → E | TAP 状态机、IR/DR、边界扫描 | 芯片测试、FPGA 下载 |
| SWD | B → I | 2-pin 调试、DAP、AP/DP | Cortex-M 调试、烧录 |
| CoreSight/ETM | E → M | ETMv4、ITM、TPIU、SWO | 实时跟踪、性能分析 |

---

## 学习路径建议

**路径 A（MCU 开发者）**：
SWD → ITM/SWO → 串口调试

**路径 B（SoC 开发者）**：
JTAG → CoreSight → ETM → TPIU

**路径 C（全栈调试）**：
SWD → JTAG → CoreSight（覆盖 99% 场景）

---

## 选型速查表

| 场景 | 推荐接口 | 原因 |
| --- | --- | --- |
| Cortex-M 调试/烧录 | SWD | 2 根线，省引脚 |
| 多核 ARM 调试 | JTAG + CoreSight | 支持多 TAP、边界扫描 |
| 实时程序流跟踪 | ETM + TPIU | 不中断程序执行 |
| 打印调试 | ITM/SWO | 1 根线输出 printf |
| FPGA 下载 | JTAG | 标准配置接口 |
| 芯片量产测试 | JTAG 边界扫描 | 测试所有引脚连通性 |

---

## 速率对比

| 接口 | 引脚数 | 时钟 | 用途 |
| --- | --- | --- | --- |
| JTAG | 4~5 (TCK/TMS/TDI/TDO/TRST) | 10~50 MHz | 通用调试/测试 |
| SWD | 2 (SWCLK/SWDIO) | 10~100 MHz | Cortex-M 专用 |
| SWO | 1 (可选) | 与 SWD 同 | ITM 跟踪输出 |
| ETM | 1~16 (并行) | 与 CPU 同频 | 指令/数据跟踪 |
| TPIU | 1~4 (并行/串行) | — | 跟踪数据输出 |

