# B-D.11.4 CANopen 对象字典与 NMT

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：35 分钟

## 本节导读

CAN 本身只解决"帧怎么传"，不解决"帧里的字节是什么意思"。不同厂商的伺服、传感器、I/O 模块能在同一条总线上即插即用，靠的是 CANopen（CiA 301）定义的两个统一：统一的数据模型——对象字典（Object Dictionary, OD），和统一的生命周期管理——NMT 状态机。本节只讲这两件事，PDO/SDO 的具体传输机制和 Linux 主站代码在下一节展开。

本节覆盖：对象字典的索引分区、工程上最常用的 OD 条目、PDO 映射条目的编码格式、NMT 四状态与五条命令、标准启动序列、以及"SDO 能通但 PDO 没数据"这类典型问题的定位路径。

## 对象字典：设备的数据模型

对象字典是 CANopen 设备内部一张标准化的参数表，每个条目用 16 位索引 + 8 位子索引寻址（写作 `0x索引:子索引`）。设备的一切——身份、通信参数、实时过程数据、厂商私有配置——都是这张表里的条目。主站读设备就是读这张表，控制设备就是写这张表。

> 对象字典（OD）：CANopen 设备内部按索引组织的参数数据库。主站不直接访问设备寄存器，一切读写都通过 OD 条目进行，因此不同厂商的同类型设备对外呈现完全一致的接口。

CiA 301 对索引范围的分区：

| 索引范围 | 分区 | 内容 | 示例 |
|:---|:---|:---|:---|
| 0x0000~0x0FFF | 数据类型区 | 标准数据类型定义 | BOOLEAN、INTEGER32 |
| 0x1000~0x1FFF | 通信参数区 | 设备类型、错误寄存器、身份、SDO/PDO 参数 | 0x1000、0x1018、0x1800 |
| 0x2000~0x5FFF | 制造商特定区 | 厂商自定义参数 | 电机额定电流、校准系数 |
| 0x6000~0x9FFF | 标准设备参数区 | 设备子协议（CiA 4xx）定义的标准参数 | CiA 402：0x6040 控制字 |
| 0xA000~0xFFFF | 保留 | 标准化网络变量等 | 较少使用 |

分区的工程意义：通信参数区保证任何 CANopen 设备都能被统一识别和管理；标准设备参数区保证所有符合 CiA 402 的伺服驱动器用同一组索引控制——换厂商不用改应用逻辑，这是 CANopen 在运动控制领域长盛的原因。

## 高频 OD 条目

| 索引 | 子索引 | 名称 | 作用 |
|:---|:---|:---|:---|
| 0x1000 | 0 | Device Type | 设备类型与子协议号，如 0x00020192 表示 CiA 402 伺服 |
| 0x1001 | 0 | Error Register | 错误位图：bit0 通用、bit1 电流、bit2 电压、bit3 温度 |
| 0x1008 | 0 | Manufacturer Device Name | 设备名称字符串 |
| 0x1018 | 1~4 | Identity | 厂商 ID、产品代码、版本、序列号 |
| 0x1017 | 0 | Producer Heartbeat Time | 心跳周期（ms），0 = 关闭心跳 |
| 0x1200~0x127F | — | SDO 服务器参数 | SDO 的 COB-ID 配置 |
| 0x1400~0x15FF | — | RPDO 通信参数 | RPDO 的 COB-ID、传输类型 |
| 0x1600~0x17FF | — | RPDO 映射参数 | RPDO 数据域里装哪些 OD 条目 |
| 0x1800~0x19FF | — | TPDO 通信参数 | TPDO 的 COB-ID、传输类型、抑制时间、事件定时器 |
| 0x1A00~0x1BFF | — | TPDO 映射参数 | TPDO 数据域里装哪些 OD 条目 |

主站接入一个陌生设备的标准动作：先读 0x1000 确认设备类型，再读 0x1018 核对厂商与型号，然后配置 PDO 通信参数与映射，最后发 NMT Start。这个顺序在后面的启动序列里会完整走一遍。

## PDO 映射：OD 条目到 CAN 帧字节

PDO 的效率来自映射：把若干 OD 条目按字节偏移打包进一帧，一帧同时更新多个参数。映射配置本身也存在 OD 里（0x1600 段存 RPDO 映射、0x1A00 段存 TPDO 映射），主站用 SDO 写入。

每个映射条目是一个 32 位值，编码为 `索引(16b) | 子索引(8b) | 位长度(8b)`：

```
 映射条目 0x60400010：
   0x6040  = OD 索引（Controlword 控制字）
   0x00    = 子索引
   0x10    = 16 位长度

 一个典型的 RPDO1 映射（主站 → 伺服）：
   条目1  0x60400010  Controlword      → PDO 字节 0~1
   条目2  0x60FF0020  Target Velocity  → PDO 字节 2~5
   条目3  0x60600008  Modes of Operation→ PDO 字节 6
   合计 7 字节（经典 CAN 帧上限 8 字节）

 对应的 TPDO1 映射（伺服 → 主站）：
   条目1  0x60410010  Statusword        → PDO 字节 0~1
   条目2  0x60640020  Position Actual   → PDO 字节 2~5
   条目3  0x606C0020  Velocity Actual   → PDO 字节 6~9（超 8 字节，需拆到 TPDO2 或用 CAN FD）
```

写映射的固定流程——先清零条目数（禁用），再逐条写映射，最后写回条目数（启用）。顺序反了设备会拒绝或产生未定义行为：

```
 SDO 写 0x1600:00 = 0           禁用 RPDO1
 SDO 写 0x1600:01 = 0x60400010  映射 Controlword
 SDO 写 0x1600:02 = 0x60FF0020  映射 Target Velocity
 SDO 写 0x1600:00 = 2           启用，2 个条目
```

> ⚠️
> 经典 CAN 的 PDO 最多 8 字节，CiA 402 伺服一套完整状态（状态字 + 实际位置 + 实际速度 + 实际转矩）轻松超过这个上限。三个解法：拆到多个 TPDO（TPDO1 发位置、TPDO2 发转矩）；只映射当前模式真正需要的量；底层换 CAN FD，单 PDO 可到 64 字节（CANopen FD，CiA 1301）。选型时先算清楚实时数据的字节预算。

## NMT 状态机

NMT（Network Management）管理每个节点的生命周期。四个状态，通信能力各不相同：

| 状态 | SDO | PDO | 说明 |
|:---|:---:|:---:|:---|
| Initialization | ✗ | ✗ | 上电后自动进入，完成后自动转 Pre-operational |
| Pre-operational | ✓ | ✗ | 可读写 OD，但无实时通信——配置在这个阶段做 |
| Operational | ✓ | ✓ | 正常工作状态 |
| Stopped | ✗ | ✗ | 只响应 NMT 命令和心跳/节点守护 |

状态转换由 NMT 命令驱动。NMT 命令是 COB-ID 0x000 的标准帧（总线最高优先级），数据固定 2 字节：字节 0 是命令码，字节 1 是目标 Node-ID（0 表示广播到全网）：

| 命令 | 命令码 | 效果 |
|:---|:---:|:---|
| Start Remote Node | 0x01 | 进入 Operational，PDO 开始传输 |
| Stop Remote Node | 0x02 | 进入 Stopped |
| Enter Pre-operational | 0x80 | 退回 Pre-operational，PDO 停止 |
| Reset Node | 0x81 | 整节点复位，回 Initialization |
| Reset Communication | 0x82 | 只复位通信栈，Node-ID 不变 |

```
 上电
   │
   ▼
 Initialization ──自动──→ Pre-operational ──0x01──→ Operational
                              ▲   │                    │
                              │   │ 0x02              │ 0x02
                              │   ▼                    ▼
                              └─── 0x80 ──────── Stopped
 0x81 Reset Node：任何状态 → Initialization
 0x82 Reset Communication：复位 SDO/PDO 通道后回 Pre-operational
```

上电默认停在 Pre-operational 是 CANopen 最重要的一条行为规则：PDO 此时是关的，"SDO 能读写、但 PDO 一直没数据"几乎可以断定是漏发了 NMT Start。启动的黄金顺序固定为：复位 → SDO 配置 OD（PDO 映射、传输类型、心跳）→ NMT Start → PDO 通信开始。

> 💡
> NMT 命令是广播语义，Node-ID 写 0 时全网所有节点同时执行。初始化阶段用广播（Reset All、Start All）没问题；运行期不要高频发 NMT——全网节点同时切状态会造成 PDO 流量的阶跃变化，实时环路的控制周期会被打乱。

## 节点在线监控：心跳与节点守护

主站需要知道从站活着没有。两种机制：

- **心跳（Heartbeat，推荐）**：从站按 0x1017 配置的周期主动发一帧，COB-ID = 0x700 + Node-ID，数据 1 字节为当前 NMT 状态码（0x00 Boot-up、0x04 Stopped、0x05 Operational、0x7F Pre-operational）。主站对每个节点维护超时计数，连续两个周期没收到心跳即判离线。节点上电进入 Pre-operational 时会自发一帧 Boot-up（状态码 0x00），这是主站发现新节点的信号。
- **节点守护（Node Guarding，旧机制）**：主站发 RTR 远程帧轮询，从站应答状态。RTR 帧与数据帧的 ID 冲突处理在 FD 网络里有额外约束，新设计一律用心跳。

candump 里看到 `701#7F` 就是节点 1 在 Pre-operational 发心跳，`701#00` 是它刚上电的 Boot-up——诊断"节点在不在"只要一行 `candump can0 | grep 70`。

## 完整启动序列：伺服驱动器实例

以一台 CiA 402 伺服（Node-ID = 1）为例，主站（Linux + SocketCAN）的完整启动交互：

```
 主站                                  伺服（Node 1）
  │  0x000 [81 00]  Reset Node（广播）  →  │  复位
  │  ← 0x701 [00]   Boot-up              │  进 Pre-operational
  │  ← 0x701 [7F]   心跳（Pre-op）       │
  │  0x601 SDO 读 0x1000:00            →  │  确认设备类型
  │  ← 0x581 应答 [.. 92 02 00 00]       │  0x00000192 = CiA 402
  │  0x601 SDO 写 0x1600（RPDO1 映射）  →  │  映射 Controlword+Target Velocity
  │  0x601 SDO 写 0x1A00（TPDO1 映射）  →  │  映射 Statusword+Position Actual
  │  0x601 SDO 写 0x1800:02 = 255       →  │  TPDO1 事件驱动
  │  0x000 [01 01]  Start Node 1        →  │  ★ 进 Operational
  │  ← 0x181 TPDO1  [状态字|位置]        │  PDO 通信开始
  │  0x201 RPDO1  [控制字|目标速度]     →  │
```

用 can-utils 手动复现这个序列（SDO 快速请求的帧格式在下一节详解，此处先建立整体感）：

```bash
cansend can0 000#8100            # Reset 广播
candump can0 &                   # 观察 701#00 Boot-up
cansend can0 601#4000100100000000  # SDO 上传 0x1000:00
cansend can0 000#0101            # Start Node 1
```

## 排障：NMT 与 OD 相关故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| SDO 能通、PDO 无数据 | 节点停在 Pre-operational，漏发 NMT Start | candump 看心跳数据字节是 0x7F 还是 0x05 |
| SDO 也无响应 | Node-ID 不对、节点未上电、波特率不匹配 | candump 看有无 0x70x 心跳；核对拨码开关 |
| 上电后立刻又"消失" | 心跳周期过长或应用层误判超时 | SDO 读 0x1017；调整主站超时为 2.5 倍心跳周期 |
| PDO 数据全是 0 或不变 | PDO 映射未生效（写映射顺序错）、传输类型为同步型但无 SYNC | SDO 读回 0x1600/0x1A00 比对；确认传输类型 0x1800:02 |
| 写入 OD 报 abort 0x06090030 | 写入值超出该条目的数值范围 | 查设备手册该条目的取值域 |
| 多节点网络启动后总线负载暴增 | NMT Start 广播后所有 TPDO 同时开闸 | 分批 Start；调大 TPDO 抑制时间 0x1800:03 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出对象字典四个分区的索引范围和各自的工程意义
- 从 candump 输出中认出 NMT 命令、心跳、SDO 应答三类帧
- 手写一条 PDO 映射条目（给定索引、子索引、位长），并说明"先禁用再写映射再启用"的顺序原因
- 画出 NMT 四状态转换图，标出每条转换的命令码
- 对"SDO 通、PDO 不通"的故障给出第一排查动作
- 完整写出一个伺服节点从上电到 Operational 的主站侧命令序列

## 参考资料

- CiA 301 — CANopen 应用层与通信规范
- CiA 402 — 伺服驱动与运动控制设备子协议
- CiA 1301 — CANopen FD（FD 物理层上的 CANopen）
- CANopenNode 开源协议栈：github.com/CANopenNode/CANopenNode
- 内核文档：`Documentation/networking/can.rst`
