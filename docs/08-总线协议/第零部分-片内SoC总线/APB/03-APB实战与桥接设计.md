# APB 实战与桥接设计 **[I→E]**

> <span class="badge-i">I</span> → <span class="badge-e">E</span>

### <strong>实战 1：AHB2APB 桥设计与寄存器访问延迟分析</strong>

<span class="badge-i">I</span>

**场景**：Cortex-M4 通过 AHB 访问 APB 外设，分析每次寄存器读写的延迟来源。

**AHB2APB 桥时序拆解**：

| 周期 | AHB 侧 | APB 侧 |
|------|--------|--------|
| T1 | 地址阶段，桥采样 HADDR | - |
| T2 | 等待 | APB SETUP：PSEL 拉高 |
| T3 | 等待 | APB ENABLE：PENABLE 拉高，Slave 响应 |
| T4 | 数据阶段，HREADY 拉高 | PREADY 返回 |

**延迟来源**：AHB 地址周期(1) + APB SETUP(1) + APB ENABLE(1) + 数据返回(1) = 4 周期。

**优化**：如果 APB Slave 总是单周期响应（PREADY 固定拉高），桥可以省掉 1 个等待周期，压缩到 3 周期。

### <strong>实战 2：APB 外设寄存器标准模板设计</strong>

<span class="badge-e">E</span>

**场景**：自研 UART 外设，需要一套标准的 APB 寄存器接口。

**寄存器模板**（基址 0x4000_0000）：

| 偏移 | 名称 | 类型 | 复位值 | 说明 |
|------|------|------|--------|------|
| 0x00 | CR | R/W | 0x0000 | 控制寄存器：使能、中断开关、模式 |
| 0x04 | SR | R | 0x0001 | 状态寄存器：TXE、RXNE、ERR |
| 0x08 | DR | R/W | 0x0000 | 数据寄存器：收发缓冲 |
| 0x0C | BRR | R/W | 0x00C0 | 波特率寄存器：分频系数 |

**APB 读写权限规则**：
- 控制寄存器：可读写，写后立即生效
- 状态寄存器：只读，反映硬件状态
- 数据寄存器：读=接收缓冲，写=发送缓冲（双功能）
- 波特率寄存器：可读写，修改后下一个字符生效

**RTL 地址译码**：
```verilog
wire reg_cr_sel   = PSEL && (PADDR[3:2] == 2'b00);
wire reg_sr_sel   = PSEL && (PADDR[3:2] == 2'b01);
wire reg_dr_sel   = PSEL && (PADDR[3:2] == 2'b10);
wire reg_brr_sel  = PSEL && (PADDR[3:2] == 2'b11);
```

### <strong>实战 3：多 APB 桥层级与地址规划 **[M]**</strong>

<span class="badge-m">M</span>

**场景**：复杂 SoC 有 50+ 外设，单个 APB 桥地址空间不够。

**多级 APB 桥设计**：
```
AHB → APB Bridge 0 (0x4000_0000-0x400F_FFFF) → UART/SPI/I2C
    → APB Bridge 1 (0x4010_0000-0x401F_FFFF) → Timer/WDT/RTC
    → APB Bridge 2 (0x4020_0000-0x402F_FFFF) → GPIO/ADC/DAC
```

**地址规划原则**：
1. 同一功能组的外设放在同一桥下（如所有通信外设）
2. 考虑时钟域：Bridge 0 用 50MHz，Bridge 1 用 100MHz，Bridge 2 可关断
3. 预留 20% 地址空间给未来扩展

**功耗分区**：
- 系统运行模式：Bridge 0+1+2 全开
- 低功耗模式：Bridge 2 关断（GPIO/ADC 不用），Bridge 0+1 保持
- 休眠模式：只留 Bridge 1 的 RTC（时钟仍需要）

<span class="blue">APB 桥不是翻译器，是功耗开关。</span>
