# UART历史演进与替代方案

<span class="badge-i">[Intermediate]</span>

<span class="red">UART（Universal Asynchronous Receiver/Transmitter）</span> 是最古老的串行通信接口之一，至今仍是调试和低速通信的主力。

---

## <strong>历史演进</strong>

- <span class="green">1960s RS-232</span> — EIA 标准，±15V 电平，DB25/DB9<br>
- <span class="green">1980s 微控制器集成</span> — 8051 内置 UART<br>
- <span class="green">1990s USB-CDC</span> — USB 模拟串口，替代物理 COM<br>
- <span class="green">2000s TTL UART</span> — 3.3V/5V 电平，嵌入式标准<br>
- <span class="green">2010s USB-C</span> — CC 引脚检测，USB-PD 供电<br>

## <strong>与SPI/I2C的互补关系</strong>

| 场景 | 选择 | 理由 |
|------|------|------|
| 调试输出 | UART | 简单、可靠、长距离 |
| 传感器阵列 | I2C | 多从设备、地址寻址 |
| 高速外设 | SPI | 全双工、高速 |
| 无线模块 | UART | AT 指令标准接口 |

## <strong>未来趋势</strong>

<span class="blue">UART 不会被淘汰</span>，原因：

- 调试console不可替代<br>
- AT指令生态成熟（蓝牙、WiFi、4G模块）<br>
- 极简实现（仅需GPIO+定时器）<br>
- IrDA、RS-485 工业变体持续活跃

---

## <strong>小结与练习</strong>

**练习**

1. 计算 115200bps UART 的理论最大传输距离（RS-232标准电缆）。
2. 比较 UART 和 USB-CDC 在嵌入式bootloader中的优劣。
3. 分析为什么USB-C时代UART调试口反而更普及。
