# PROFIBUS 诊断与配置 [E]

> **本章学习目标**：
> - 理解 <span class="red">GSD 文件</span> 的结构与设备描述解析方法
> - 掌握网络诊断的指示灯规则与诊断字节含义
> - 了解总线参数（Tslot、Ttr、G）的计算与优化

---

## GSD 文件解析

---

### <strong>GSD 文件结构</strong>

<span class="badge-e">E</span><br>
<span class="red">GSD（General Station Description）</span> 是 PROFIBUS 设备的电子数据表，以纯文本形式描述设备能力与通信参数。<br>

<span class="blue">GSD 如同设备的"简历"——制造商、技能（I/O 能力）、工作偏好（波特率、时隙）一应俱全，主站"面试"前先读简历。</span><br>

```
; GSD 文件片段示例
; 设备：Siemens ET200S
#Profibus_DP
GSD_Revision       = 5
Vendor_Name        = "Siemens"
Model_Name         = "IM 151-1 HF"
Protocol_Ident     = 0
Station_Type       = 0                  ; 0=DP 从站
FMS_supp           = 0                  ; 不支持 FMS
Hardware_Release   = "A1.0"
Software_Release   = "V1.0"
Ident_Number       = 0x81D8            ; 设备标识号
```

**表 3-1：GSD 关键字段**

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| Vendor_Name | 制造商名称 | "Siemens" |
| Model_Name | 设备型号 | "IM 151-1 HF" |
| Ident_Number | 设备唯一标识 | 0x81D8 |
| Protocol_Ident | 协议标识 | 0=DP |
| Station_Type | 站类型 | 0=从站, 1=主站 |
| MaxTsdr_9.6 | 9.6k 下最大响应延迟 | 60 bit times |
| MaxTsdr_12M | 12M 下最大响应延迟 | 800 bit times |
| MaxDiagDataLen | 最大诊断数据长度 | 6~244 Byte |

<span class="orange"><strong>1. 模块配置段</strong></span><br>
* Module 段描述从站支持的 I/O 模块类型与参数。<br>
* 每个 Module 行定义一个可插槽位的功能。<br>

```
; GSD 模块段示例
Module = "2DI DC24V" 0x11,0x81
    EndModule
Module = "2DO DC24V/0.5A" 0x21,0xC1
    EndModule
Module = "4AI U (I + -)" 0x51,0xC4,0x00,0x00
    EndModule
```

<span class="orange"><strong>2. 用户参数段</strong></span><br>
* UserPrmData 定义模块的可配置参数，如量程、滤波、诊断使能。<br>
* 主站通过 DPV1_Write 将用户参数下发至从站。<br>

---

## 网络诊断

---

### <strong>诊断机制与字节定义</strong>

<span class="badge-e">E</span><br>
<span class="red">PROFIBUS 诊断</span> 通过周期性诊断帧与事件型报警帧两种机制实现。<br>

**表 3-2：诊断字节结构（标准 6 Byte）**

| 字节 | 位域 | 含义 |
| --- | --- | --- |
| Byte 0 | Bit 0~2 | Station_Status_1: 主站找到/参数化/配置 |
| Byte 0 | Bit 3~7 | Ext_Diag/Diag_Not_Supported/... |
| Byte 1 | Bit 0~7 | Station_Status_2: 响应/超出/外部诊断 |
| Byte 2 | Bit 0~7 | Station_Status_3: 保留 |
| Byte 3 | Bit 0~7 | Master_Add: 参数化主站地址 |
| Byte 4~5 | Bit 0~7 | Ident_Number: 设备标识号 |

<span class="orange"><strong>3. 诊断指示灯规则</strong></span><br>

| LED | 状态 | 含义 |
| --- | --- | --- |
| BF (Bus Fault) | 红色常亮 | 总线物理层故障 |
| BF | 红色闪烁 | 配置错误/从站丢失 |
| SF (System Fault) | 红色常亮 | 模块/通道故障 |
| SF | 红色闪烁 | 诊断报警未确认 |
| ON | 绿色常亮 | 正常运行 |
| RUN | 绿色闪烁 | 数据交换中 |

<span class="blue">BF+SF 双灯如同医院的急诊与门诊——BF 是"急救信号"（总线断了），SF 是"专科会诊"（设备内部故障）。</span><br>

---

## 总线参数

---

### <strong>关键定时参数</strong>

<span class="badge-e">E</span><br>
<span class="red">PROFIBUS 总线参数</span> 决定了网络时序、轮询效率与容错能力。<br>

**表 3-3：核心总线参数**

| 参数 | 符号 | 说明 | 典型值 |
| --- | --- | --- | --- |
| Tslot | 时隙时间 | 主站等待响应的最长时间 | 主站根据波特率计算 |
| Ttr | 目标轮询时间 | 所有从站轮询一圈的目标时间 | 用户设定 |
| G | 间隙时间 | 主站轮询间隙，供非周期通信 | Ttr 的 1%~5% |
| MinTSDR | 最小响应延迟 | 从站最小响应时间 | 11 bit times |
| MaxTSDR | 最大响应延迟 | 从站最大响应时间 | GSD 定义 |

<span class="orange"><strong>4. Tslot 计算</strong></span><br>
* Tslot 必须 ≥ 从站最大响应时间 + 线路传播延迟 + 安全余量。<br>
* 计算公式：Tslot = MaxTSDR + 2 × 线路延迟 + 余量。<br>
* 线路延迟 ≈ 5 ns/m × 总线长度（m）。<br>

<span class="orange"><strong>5. Ttr 优化</strong></span><br>
* Ttr 设置过小：主站 CPU 负载高，但实时性好。<br>
* Ttr 设置过大：实时性下降，非周期通信带宽增加。<br>
* 推荐：Ttr = Σ(各从站数据交换时间) × 1.2 ~ 1.5。<br>

---

## 本章小结

| 小节 | 核心要点 |
| --- | --- |
| GSD 文件解析 | Vendor/Model/Ident_Number/Module 段，设备能力电子描述 |
| 网络诊断 | Station_Status 字节 + Ext_Diag，BF/SF 指示灯规则 |
| 总线参数 | Tslot ≥ MaxTSDR + 传播延迟，Ttr 权衡实时性与负载 |

---

## 练习

1. **GSD 解析**：给定 GSD 片段中 MaxTsdr_1.5M = 400，某主站波特率 1.5 Mbps，总线长度 200 m。计算 Tslot 最小值（余量取 50 bit times）。

2. **诊断分析**：某从站诊断字节 Byte0=0x0C（二进制 00001100），分析各标志位含义及可能的故障原因。

3. **参数优化**：某 PROFIBUS 网络有 10 个从站，每站平均交换 16 Byte 输入 + 16 Byte 输出，波特率 500 kbps。计算最小 Ttr 并给出 G 间隙建议值。
