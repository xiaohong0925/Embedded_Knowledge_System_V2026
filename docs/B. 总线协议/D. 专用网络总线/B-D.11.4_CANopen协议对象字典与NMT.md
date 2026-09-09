# B-D.11.4 CANopen 对象字典与 NMT

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：50 分钟

## 本节导读

CAN 本身只解决"帧怎么传"，不解决"帧里的字节是什么意思"。不同厂商的伺服、传感器、I/O 模块能在同一条总线上即插即用，靠的是 CANopen（CiA 301）定义的两个统一：统一的数据模型——对象字典（Object Dictionary, OD），和统一的生命周期管理——NMT 状态机。本节只讲这两件事，PDO/SDO 的具体传输机制和 Linux 主站代码在下一节展开。

> 本节覆盖：CANopen 帧 ID 的分配规则（COB-ID）、对象字典的索引分区与高频条目、PDO 映射条目的编码格式与改写流程、NMT 四状态与五条命令、心跳在线监控、CiA 402 伺服的完整启动序列（含 candump 逐帧解读）、典型排障路径。按"帧怎么认 → 设备长什么样 → 数据怎么打包 → 状态怎么管 → 一台伺服怎么从零跑起来"展开——这正是你接手一条带 CANopen 伺服的产线或机器人关节时的上手顺序。

读完你应该能独立完成三件事：对着 candump 输出认出每一帧的类型并解码 SDO 应答、手写 PDO 映射并用 SDO 完成"禁用-改写-启用"流程、把一台陌生 CiA 402 伺服从上电带到 Operational 并让它开始周期性上报位置。

## 先认帧：COB-ID 的分配规则

candump 里的每一行 CANopen 帧，身份全写在 ID 里，先建立这张映射表，后面的内容才有附着点：

> COB-ID（Communication Object Identifier）：CANopen 给每类通信对象预分配的 11 位帧 ID 规则，结构是"4 位功能码 + 7 位 Node-ID"。功能码决定帧的用途，Node-ID（1~127）标识节点——所以同类帧在不同节点间按 ID 自然分开，互不干扰。

| COB-ID | 对象 | 方向 | 说明 |
|:---|:---|:---|:---|
| 0x000 | NMT 命令 | 主站 → 全网 | 无 Node-ID 字段，数据里带目标节点号 |
| 0x080 | SYNC | 主站 → 全网 | 同步 PDO 的节拍帧 |
| 0x080 + ID | EMCY 急停报文 | 节点 → 主站 | 节点故障时主动上报错误码 |
| 0x180/0x280/0x380/0x480 + ID | TPDO1~4 | 节点 → 主站 | 过程数据上传 |
| 0x200/0x300/0x400/0x500 + ID | RPDO1~4 | 主站 → 节点 | 过程数据下发 |
| 0x600 + ID | SDO 请求 | 主站 → 节点 | 读写对象字典 |
| 0x580 + ID | SDO 应答 | 节点 → 主站 | 返回读值或写确认 |
| 0x700 + ID | 心跳/Boot-up | 节点 → 主站 | 在线状态，1 字节 NMT 状态码 |

两个直觉要记住：ID 越小优先级越高（CAN 仲裁规则，见 11.1），所以 NMT/SYNC 占了最低 ID——控制命令永远能插队到过程数据前面；`0x600 + ID` 这类"基址 + 节点号"的写法意味着同一台设备在 candump 里会同时出现在好几个 ID 段上，看流量时按功能码分段统计。

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

0x1001 错误寄存器还有一条主动上报通路：节点检测到故障（过流、过压、超温）时会自发一帧 EMCY 急停报文（COB-ID = 0x080 + Node-ID），数据里是 2 字节错误码 + 1 字节错误寄存器值 + 5 字节厂商特定信息。candump 里突然冒出的 `081#...` 帧就是伺服在喊救命——先读 EMCY 错误码查手册，再读 0x1001 看错误类别，最后读厂商区的详细故障码（常见如 0x2xxx 段），三层信息各管一段。

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

映射配好了，帧什么时候发由**传输类型**决定，存在 PDO 通信参数的子索引 2（0x1800:02 这一格）：

> 传输类型（Transmission Type）：TPDO 的触发规则。255（异步/事件驱动）= 数据变化或事件定时器到期就发；1~240（同步）= 每收到 N 个 SYNC 帧发一次；254/253（RTR 应答等）较少用。实时控制环路常用"SYNC + 同步型 PDO"让全网节点在同一节拍采样和上报；分散的状态量用 255 事件驱动。

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

<!-- 【待补图】NMT 状态机转换图（★必要，建议生图）
生图提示词：技术状态机图，白底工程蓝图风格，中文标注，横版 16:10。四个状态圆角方块：Initialization（灰色，标注"上电自动进入"）、Pre-operational（蓝色重点框，标注"SDO ✓ PDO ✗ 配置阶段"）、Operational（绿色，标注"SDO ✓ PDO ✓ 正常工作"）、Stopped（红色，标注"仅响应 NMT/心跳"）。转换箭头标注命令码：Pre-op → Operational 标"0x01 Start"，Operational → Stopped 标"0x02 Stop"，Operational → Pre-op 标"0x80 Enter Pre-op"，任意状态 → Initialization 画一条汇总虚线箭头标"0x81 Reset Node / 0x82 Reset Communication"。Initialization → Pre-op 画自动箭头标"上电自动"。风格：扁平矢量、细线条、蓝绿灰红四色区分状态、无装饰。-->

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

对应 candump 实际抓到的样子（已注释解码，注意字节序）：

```text
# candump can0
  can0  000  [2]  81 00                    ← NMT Reset 广播（命令码 81，目标 0=全网）
  can0  701  [1]  00                       ← 节点 1 Boot-up，进入 Pre-operational
  can0  701  [1]  7F                       ← 心跳：状态码 0x7F = Pre-operational
  can0  601  [8]  40 00 10 01 00 00 00 00  ← SDO 读请求：40=读，0010 小端=0x1000，01=子索引
  can0  581  [8]  43 00 10 01 92 01 02 00  ← SDO 应答：43=4 字节返回值，
                                             数据小端还原 = 0x00020192：
                                             低 16 位 0x0192 = 402 → CiA 402 伺服子协议
  can0  000  [2]  01 01                    ← NMT Start Node 1
  can0  701  [1]  05                       ← 心跳状态变 0x05 = Operational ★
  can0  181  [6]  50 06 34 12 00 00        ← TPDO1：状态字 0x0650 + 位置 0x00001234
```

读法三要点：SDO 帧字节 0 是命令符（`0x40` 发起读、`0x43` 应答 4 字节数据、`0x2B/0x2F` 发起 2/1 字节写），字节 1~2 是**小端**索引、字节 3 是子索引；心跳帧的数据字节直接就是 NMT 状态码，`7F→05` 的跳变就是 Start 命令生效的证据；PDO 帧没有协议头，字节含义完全由映射配置决定——所以读 PDO 之前必须先知道映射表长什么样。

还有一个伺服特有的坑要单独点名：NMT 进 Operational 只代表通信就绪，**电机还没使能**。CiA 402 有自己的一层状态机（Shutdown → Switch on → Operation Enable），藏在 0x6040 控制字里——典型使能序列是 PDO 或 SDO 写 `0x6040 = 0x06 → 0x07 → 0x0F`，每步对应状态字 0x6041 里相应位置位。"通信全通、命令照发、电机纹丝不动"时，九成是 CiA 402 状态机卡在 Switch on disabled——读 0x6041 对照 CiA 402 状态机图定位卡在哪一步。

## 排障：NMT 与 OD 相关故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| SDO 能通、PDO 无数据 | 节点停在 Pre-operational，漏发 NMT Start | candump 看心跳数据字节是 0x7F 还是 0x05 |
| SDO 也无响应 | Node-ID 不对、节点未上电、波特率不匹配 | candump 看有无 0x70x 心跳；核对拨码开关 |
| 上电后立刻又"消失" | 心跳周期过长或应用层误判超时 | SDO 读 0x1017；调整主站超时为 2.5 倍心跳周期 |
| PDO 数据全是 0 或不变 | PDO 映射未生效（写映射顺序错）、传输类型为同步型但无 SYNC | SDO 读回 0x1600/0x1A00 比对；确认传输类型 0x1800:02 |
| 写入 OD 报 abort 0x06090030 | 写入值超出该条目的数值范围 | 查设备手册该条目的取值域 |
| 多节点网络启动后总线负载暴增 | NMT Start 广播后所有 TPDO 同时开闸 | 分批 Start；调大 TPDO 抑制时间 0x1800:03 |
| 总线冒出 0x08x 帧 | 节点故障主动上报 EMCY | 解码 EMCY 错误码；读 0x1001 与厂商故障码 |
| 通信正常但电机不动 | CiA 402 状态机未走完使能序列 | 读 0x6041 状态字，对照 0x6040 使能序列（0x06→0x07→0x0F） |

## 本节总结

CANopen 把"不同厂商的设备怎么对话"这个开放问题收敛成了两张表：**对象字典**统一了数据模型——任何设备都是一张按索引寻址的参数表，0x1000 段管身份与通信、0x6000 段起按设备子协议标准化，CiA 402 伺服因此可以换厂商不换代码；**NMT 状态机**统一了生命周期——上电停在 Pre-operational 只允许配置，主站按"复位 → SDO 配置 → Start"的黄金顺序把节点带进 Operational，PDO 才开始流动。工程动作也随之标准化：认帧看 COB-ID 的功能码段，改 PDO 先禁用再写映射再启用，节点在不在看 0x70x 心跳字节，节点喊救命看 0x08x 的 EMCY。最后记住 CANopen 特有的两层状态机分工：NMT 管"通信通不通"，CiA 402 管"电机动不动"——"通信正常电机不动"这类问题，答案永远在 0x6041 状态字里。

| 关键结论 | 一句话记忆 |
|:---|:---|
| COB-ID | 4 位功能码 + 7 位 Node-ID；ID 越小优先级越高，NMT/SYNC 占最低段 |
| 对象字典 | 设备 = 一张索引表；通信区统一识别，CiA 402 区统一伺服控制 |
| 接入标准动作 | 读 0x1000 认类型 → 读 0x1018 核厂商 → 配 PDO → NMT Start |
| PDO 映射 | 条目 = 索引+子索引+位长打包 32 位；改映射先禁用再写再启用 |
| 传输类型 | 255 事件驱动；1~240 跟着 SYNC 节拍发 |
| NMT 黄金顺序 | 复位 → SDO 配置 → Start；上电默认 Pre-op，PDO 关着 |
| 在线监控 | 心跳 0x70x + 状态码（7F=Pre-op、05=Op、00=Boot-up） |
| 两层状态机 | NMT 管通信；CiA 402（0x6040/0x6041）管电机使能 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出 COB-ID 的结构与主要功能码段，从 candump 输出中认出 NMT、心跳、SDO、PDO、EMCY 五类帧
- 说出对象字典四个分区的索引范围和各自的工程意义
- 解码一条 SDO 应答帧（命令符、小端索引、子索引、数据），并读回设备类型
- 手写一条 PDO 映射条目（给定索引、子索引、位长），并说明"先禁用再写映射再启用"的顺序原因
- 画出 NMT 四状态转换图，标出每条转换的命令码，并解释上电停在 Pre-operational 的工程意图
- 对"SDO 通、PDO 不通"与"通信正常电机不动"两类故障分别给出第一排查动作
- 完整写出一个伺服节点从上电到 Operational 再到电机使能的主站侧命令序列

## 参考资料

- CiA 301 — CANopen 应用层与通信规范
- CiA 402 — 伺服驱动与运动控制设备子协议（状态机与 0x6040/0x6041 定义）
- CiA 1301 — CANopen FD（FD 物理层上的 CANopen）
- CANopenNode 开源协议栈：github.com/CANopenNode/CANopenNode
- 内核文档：`Documentation/networking/can.rst`
- 本书关联：11.1（CAN 物理层与仲裁——ID 越小越优先的依据）、11.2（CAN FD）、11.3（SocketCAN 与 can-utils）、11.5（Linux CANopen 主站实战）、E.15.3（机器人关节伺服组网）
