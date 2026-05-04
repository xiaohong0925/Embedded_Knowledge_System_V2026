# PROFIBUS历史演进与迁移

<span class="badge-i">[Intermediate]</span>

<span class="red">PROFIBUS（Process Field Bus）</span> 是德国西门子等公司主导的工业现场总线标准，正逐步向PROFINET迁移。

---

## <strong>基础认知</strong>

### <strong>为什么需要PROFIBUS</strong>

<span class="blue">工业自动化中，传感器和执行器需要可靠、实时的通信。</span> PROFIBUS 定义了从现场设备到控制器的完整通信协议栈，支持过程数据交换、参数配置和诊断。

<span class="green">PROFIBUS 有三种变体</span>：

| 变体 | 用途 | 物理层 |
|------|------|--------|
| PROFIBUS-DP | 工厂自动化，高速循环数据 | RS-485，12Mbps |
| PROFIBUS-PA | 过程自动化，本质安全 | IEC 61158-2，31.25kbps |
| PROFIBUS-FMS | 通用通信（已淘汰） | RS-485 |

---

## <strong>原理解析</strong>

### <strong>DP-V0/V1/V2 演进</strong>

<span class="red">PROFIBUS-DP 经历了三个主要版本演进：</span>

| 版本 | 关键特性 | 应用场景 |
|------|----------|----------|
| DP-V0 | 循环数据交换，诊断 | 简单I/O控制 |
| DP-V1 | 非循环参数读写，报警 | 智能设备配置 |
| DP-V2 | 等时同步，从从通信 | 运动控制 |

### <strong>从PROFIBUS到PROFINET</strong>

```mermaid
graph LR
    A[PROFIBUS-DP] -->|以太网替代RS-485| B[PROFINET IO]
    A -->|保留投资| C[PROFIBUS 集成设备]
    B -->|实时扩展| D[PROFINET IRT]
    D -->|TSN融合| E[PROFINET TSN]
```

<span class="blue">PROFINET 不是简单的协议替换，而是架构升级。</span> 它保留了 PROFIBUS 的设备模型和工程工具，同时引入以太网的带宽和灵活性。

---

## <strong>技术教学</strong>

### <strong>GSD 文件与设备描述</strong>

```ini
; 示例 GSD 片段
GSD_Revision = "5"
Vendor_Name = "Siemens"
Model_Name = "ET200S"
Protocol_Ident = 0
Station_Type = 0
FMS_supp = 0
Hardware_Release = "1.0"
Software_Release = "1.0"
```

<span class="green">GSD（General Station Description）</span> 是 PROFIBUS 设备的电子数据表，定义了设备的通信能力、I/O 模块配置和参数。

---

## <strong>软硬件实战</strong>

### <strong>场景：PROFIBUS 网络诊断</strong>

```bash
# 使用 pyprofibus 进行总线扫描
python -m pyprofibus -d /dev/ttyUSB0 --scan
# Found device at address 3: ET200S IM151-1
# Found device at address 5: S7-300 CPU315-2DP
```

---

## <strong>历史演进</strong>

- <span class="green">1989 年 PROFIBUS FMS</span> — 通用通信协议<br>
- <span class="green">1993 年 PROFIBUS DP</span> — 分布式外设高速协议<br>
- <span class="green">1995 年 PROFIBUS PA</span> — 过程自动化，本质安全<br>
- <span class="green">2003 年 PROFINET IO</span> — 基于工业以太网，替代DP<br>
- <span class="green">2015 年 PROFINET IRT</span> — 等时实时，<1μs抖动<br>
- <span class="green">2020 年 TSN 融合</span> — IEEE 802.1AS 时间同步

## <strong>工业4.0中的角色</strong>

<span class="blue">PROFINET 集成 OPC UA 和 TSN</span>，成为工业4.0的统一通信骨干。

---

## 小结与练习

| 要点 | 说明 |
|------|------|
| 核心概念 | PROFIBUS 三种变体（DP/PA/FMS），DP-V0/V1/V2 演进 |
| 关键技能 | GSD 配置、DP-V1 非循环通信、IRT 等时同步 |
| 常见误区 | 混淆 DP 和 PA 的物理层；忽视 GSD 版本兼容性 |

**练习**

1. 比较 PROFIBUS-DP 和 PROFINET IO 在布线成本上的差异。
2. 分析为什么过程自动化（PA）领域PROFIBUS仍有生命力。
3. 设计一个从PROFIBUS到PROFINET的渐进迁移方案。
