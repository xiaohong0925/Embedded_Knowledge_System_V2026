# JTAG历史演进与替代方案

<span class="badge-i">[Intermediate]</span>

<span class="red">JTAG（Joint Test Action Group）</span> 即 IEEE 1149.1，是最广泛使用的边界扫描和芯片调试标准。

---

## <strong>历史演进</strong>

- <span class="green">1990 年 IEEE 1149.1</span> — JTAG标准发布，5线接口<br>
- <span class="green">2001 年 IEEE 1149.7</span> — cJTAG，2线替代方案<br>
- <span class="green">2013 年 IEEE P1687</span> — IJTAG，内部扫描网络<br>
- <span class="green">2020 年 ARM SWD普及</span> — 2线调试成为Cortex-M标配

## <strong>JTAG与SWD的竞争</strong>

| 特性 | JTAG | SWD |
|------|------|-----|
| 线数 | 4-5 | 2 |
| 速度 | 高 | 中高 |
| 边界扫描 | 支持 | 不支持 |
| ARM生态 | 通用 | Cortex-M专用 |

<span class="blue">SWD 在嵌入式MCU领域基本替代JTAG</span>，但FPGA和复杂SoC仍依赖JTAG的边界扫描能力。

### <strong>边界扫描的未来</strong>

<span class="red">边界扫描在芯片测试和板上编程（ISP）中不可替代</span>，JTAG将继续存在。

---

## 小结与练习

**练习**

1. 比较 JTAG 和 SWD 在引脚占用和调试能力上的取舍。
2. 分析 cJTAG 为什么未能大规模普及。
3. 设计一个同时支持JTAG和SWD的调试接口板。
