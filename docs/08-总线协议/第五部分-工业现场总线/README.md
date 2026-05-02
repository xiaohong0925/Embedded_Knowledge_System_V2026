# 第五部分：工业现场总线

> **难度等级**：I → E
> 
> 本部分覆盖<span class="red">工业自动化领域</span>的经典现场总线。
> 
003e 从 Modbus 的寄存器映射到 PROFIBUS 的令牌环，从 EtherCAT 的"飞读飞写"到工业以太网的融合，
003e 这些协议定义了工厂车间的"数据高速公路"。

---

## 本部分大章概览

| 大章 | 难度 | 核心内容 | 典型场景 |
| --- | --- | --- | --- |
| Modbus | B → I | RTU/ASCII/TCP、寄存器映射、CRC | PLC、传感器、变频器 |
| PROFIBUS | I → E | DP/V0/V1、令牌环、GSD | 西门子生态、过程控制 |
| EtherCAT | E → M | EtherCAT帧结构、从站ESC、分布时钟 | 伺服控制、机器人 |

---

## 学习路径建议

**路径 A（快速入门）**：
Modbus → Modbus TCP

**路径 B（西门子生态）**：
Modbus → PROFIBUS DP → PROFINET

**路径 C（高性能运动控制）**：
Modbus → EtherCAT → CiA402

---

## 选型速查表

| 场景 | 推荐总线 | 原因 |
| --- | --- | --- |
| 简单传感器/仪表 | Modbus RTU | 最简单，RS-485即可 |
| 跨车间通信 | Modbus TCP | 走以太网，距离不受限 |
| 西门子 PLC 系统 | PROFIBUS DP | 原生支持，GSD 配置 |
| 高速伺服同步 | EtherCAT | 1000 轴同步，μs 级周期 |
| 机器人多轴控制 | EtherCAT + CiA402 | DS402 伺服协议栈 |

---

## 速率对比

| 总线 | 速率 | 拓扑 | 介质 |
| --- | --- | --- | --- |
| Modbus RTU | 115.2 Kbps | 主从总线 | RS-485 |
| Modbus TCP | 100 Mbps | 主从星型 | 以太网 |
| PROFIBUS DP | 12 Mbps | 令牌环总线 | RS-485 |
| EtherCAT | 100 Mbps | 菊花链 | 以太网 |
| PROFINET IRT | 100 Mbps | 星型/环型 | 以太网 |

