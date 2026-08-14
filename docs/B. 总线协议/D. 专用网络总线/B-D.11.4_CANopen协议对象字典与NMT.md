# B-D.11.4 CANopen协议对象字典与NMT

> 所属章节：第五部 B. 总线协议 > B-D.11 CAN总线高级主题
>
> 难度：[E] Expert / [M] Master | 预计阅读时间：25分钟

## <span class="blue"> 本节导读

CANopen 协议的精髓在于两个字：**标准化**。不同厂商、不同功能的设备（电机驱动器、传感器、I/O模块）能够即插即用，靠的不是魔法，而是统一的数据模型——**对象字典（Object Dictionary, OD）** 和统一的生命周期管理——**NMT状态机**。本节深入OD的索引体系，解析关键条目的含义，并通过NMT状态机理解CANopen设备的启动流程。掌握这两项，你才能真正驾驭CANopen网络。

<br>

## <span class="blue"> CANopen对象字典（OD）[E][M]

对象字典是CANopen设备的核心数据库，它是一个**标准化的、有序的、可寻址的参数集合**。每个条目由一个16位索引（Index）和一个8位子索引（Sub-index）唯一标识。你可以把它想象成一本巨大的"设备说明书"，里面记录了设备类型、厂商信息、通信参数、实时数据等一切内容。

### 索引范围与分类

CiA 301 标准对对象字典的索引范围做了严格划分：

| 索引范围 | 类别 | 内容说明 | 示例条目 |
|:---------|:-----|:---------|:---------|
| 0x0000 - 0x0FFF | 数据类型定义 | 标准数据类型的定义区域 | BOOLEAN、INTEGER32、VISIBLE_STRING 等 |
| 0x1000 - 0x1FFF | **通信参数区** | 设备类型、错误寄存器、标识、SDO/PDO通信参数 | 0x1000 Device Type、0x1018 Identity、0x1400 RPDO参数 |
| 0x2000 - 0x5FFF | **制造商特定区** | 厂商自定义参数，各厂商实现不同 | 电机额定电流、传感器校准系数、私有配置 |
| 0x6000 - 0x9FFF | **标准设备参数区** | 由CiA profile定义的标准设备参数 | CiA 402运动控制：0x6064 实际位置、0x60FF 目标速度 |
| 0xA000 - 0xFFFF | 保留/扩展 | 网络变量、扩展区域 | 较少使用 |

这个分层设计非常巧妙。**通信参数区**保证了任何CANopen设备都能被识别和管理；**制造商特定区**给了厂商自由发挥的空间；**标准设备参数区**则让同类型设备（如所有符合CiA 402的伺服驱动器）的接口完全一致。

<br>

### 关键OD条目详解

以下是实际开发中最常访问的OD条目，建议熟记：

| 索引 | 子索引 | 名称 | 功能说明 | 典型值/示例 |
|:-----|:-------|:-----|:---------|:------------|
| 0x1000 | 0x00 | Device Type | 设备类型和Profile编号 | 0x00020192 = Profile 402（伺服驱动）+ 支持动态PDO |
| 0x1001 | 0x00 | Error Register | 设备错误状态位图（1字节） | bit0=通用错误, bit1=电流, bit2=电压, bit3=温度 |
| 0x1008 | 0x00 | Manufacturer Device Name | 设备名称字符串 | "EPOS4"、"iPOS4808" |
| 0x1018 | 0x01-0x04 | Identity Object | 厂商ID、产品代码、版本号、序列号 | 0x000000FB（Maxon） |
| 0x1017 | 0x00 | Producer Heartbeat Time | 心跳包发送间隔（ms） | 1000 = 每秒发送一次 |
| 0x1600-0x17FF | 可变 | RPDO Mapping | 接收PDO的数据映射配置 | 将0x6040（Controlword）映射到RPDO1字节0-1 |
| 0x1A00-0x1BFF | 可变 | TPDO Mapping | 发送PDO的数据映射配置 | 将0x6041（Statusword）映射到TPDO1字节0-1 |
| 0x1800-0x19FF | 0x01-0x06 | TPDO通信参数 | 发送PDO的COB-ID、传输类型、抑制时间 | 0x18000180 + 传输类型255（事件驱动） |

这些条目是调试CANopen设备时的"第一站"。上电后，主节点通常会先读取 0x1000 确认设备类型，再读 0x1018 确认身份信息，然后配置通信参数。

<br>

### PDO Mapping：从对象字典到CAN帧的映射

PDO（Process Data Object）的精髓是**映射**——把对象字典中的条目映射到CAN帧的特定字节位置。这样，一次PDO传输就能同时更新或读取多个OD条目。

**PDO Mapping 配置示例：**

```
RPDO1 Mapping（从设备接收：主站 → 从设备）
═══════════════════════════════════════════════
对象字典条目              PDO字节偏移      长度
───────────────────────────────────────────────
0x6040 Controlword    →  字节 0-1          2 bytes
0x60FF Target Velocity →  字节 2-5          4 bytes
0x6060 Modes of Op   →  字节 6            1 byte
───────────────────────────────────────────────
总数据长度：                                    7 bytes
（CAN帧数据域最大8字节，还剩1字节可用）
```

```
TPDO1 Mapping（从设备发送：从设备 → 主站）
═══════════════════════════════════════════════
对象字典条目              PDO字节偏移      长度
───────────────────────────────────────────────
0x6041 Statusword    →  字节 0-1          2 bytes
0x6064 Pos Actual    →  字节 2-5          4 bytes
0x606C Vel Actual    →  字节 6-7          2 bytes
───────────────────────────────────────────────
总数据长度：                                    8 bytes
（刚好填满CAN帧数据域）
```

实际配置时，你需要通过**SDO下载**来写入映射条目。例如配置RPDO1 Mapping：

```c
// 先禁RPDO1（将0x1600子索引0设为0）
SDO_download(node_id, 0x1600, 0x00, 0x00);  // 条目数设为0，禁用

// 写入映射条目
SDO_download(node_id, 0x1600, 0x01, 0x60400010);  // 0x6040, 16位
SDO_download(node_id, 0x1600, 0x02, 0x60FF0020);  // 0x60FF, 32位
SDO_download(node_id, 0x1600, 0x03, 0x60600008);  // 0x6060, 8位

// 最后启用RPDO1（写入实际映射条目数）
SDO_download(node_id, 0x1600, 0x00, 0x03);  // 3个映射条目
```

每个映射条目的编码格式为 `0xAAAABBCC`，其中 `AAAA` = OD索引，`BB` = 子索引，`CC` = 位长度。上例中 `0x60400010` 表示索引0x6040、子索引0x00、16位长度。

<br>

> ⚠️ **陷阱**：NMT命令是**广播**的（COB-ID 0x000），一条NMT命令会被网络上所有从设备同时接收和执行。在大型网络中频繁发送NMT命令会造成总线拥塞，且所有节点同时响应可能引发不可预知的时序问题。建议在初始化阶段集中发送NMT命令，正常运行时避免高频NMT操作。

<br>

## <span class="blue"> NMT状态机：设备生命周期管理 [E][M]

NMT（Network Management）是CANopen的网络管理协议，定义了每个节点的生命周期状态。理解NMT状态机，是排查"设备上了CAN总线却不干活"这类问题的关键。

### NMT状态与通信能力

每个CANopen节点上电后都会经历一系列状态转换：

| 状态 | SDO通信 | PDO通信 | 允许的命令 | 转换条件/说明 |
|:-----|:--------|:--------|:-----------|:--------------|
| **Initialization** | ❌ 不可用 | ❌ 不可用 | 无 | 上电后自动进入，完成内部初始化 |
| ↓ Init→Pre-op | — | — | 自动转换 | 初始化完成后自动进入Pre-operational |
| **Pre-operational** | ✅ 可用 | ❌ 不可用 | SDO、NMT、心跳/守护 | 可通过SDO读写OD，但无实时PDO通信 |
| **Operational** | ✅ 可用 | ✅ 可用 | 全部 | 正常工作的状态，SDO+PDO全开 |
| **Stopped** | ❌ 不可用 | ❌ 不可用 | NMT、心跳/守护 | 最低功耗状态，仅响应NMT命令 |

<br>

### NMT状态转换图

```
                         ┌─────────────────┐
                         │   上电/复位      │
                         └────────┬────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │    Initialization       │
                    │    （初始化状态）        │
                    │  SDO✗ PDO✗ NMT✗        │
                    └────────────┬────────────┘
                                 │ 初始化完成
                                 ▼
                    ┌─────────────────────────┐
     ┌─────────────▶│   Pre-operational       │◀─────────────┐
     │    NMT Stop  │   （预操作状态）         │   NMT Enter  │
     │              │   SDO✓ PDO✗ NMT✓        │   Pre-op     │
     │              └────────────┬─────────────┘              │
     │                           │ NMT Start                   │
     │                           ▼                             │
     │              ┌─────────────────────────┐                │
     │    NMT Stop  │     Operational         │   NMT Enter  │
     └─────────────▶│     （操作状态）         │◀─────────────┘
                    │   SDO✓ PDO✓ NMT✓        │
                    └────────────┬─────────────┘
                                 │ NMT Stop
                                 ▼
                    ┌─────────────────────────┐
                    │       Stopped           │
                    │      （停止状态）        │
                    │   SDO✗ PDO✗ NMT✓        │
                    └─────────────────────────┘
                                 ▲
            ┌────────────────────┼────────────────────┐
            │                    │                    │
            │  NMT Reset Node   │  NMT Reset Comm    │  NMT Start/
            │  (回到Init)       │  (回到Init后       │  Enter Pre-op
            │                   │   保持Node-ID)      │
            └────────────────────┴────────────────────┘
```

<br>

### NMT命令格式

NMT命令使用**CAN标准帧**，COB-ID固定为 `0x000`（最高优先级），数据域固定2字节：

```
NMT命令帧格式：
┌─────────────┬─────────────┬─────────────────────────────┐
│  COB-ID     │  DLC        │  数据（8字节）               │
├─────────────┼─────────────┼─────────────────────────────┤
│  0x000      │  2          │  [0] = 命令代码              │
│             │             │  [1] = 目标节点ID（0=广播）  │
└─────────────┴─────────────┴─────────────────────────────┘
```

| 命令 | 代码 | 参数 | 效果 |
|:-----|:-----|:-----|:-----|
| Start Remote Node | 0x01 | Node-ID（0=全部节点） | 目标节点进入 Operational 状态，PDO开始通信 |
| Stop Remote Node | 0x02 | Node-ID（0=全部节点） | 目标节点进入 Stopped 状态，SDO和PDO均停止 |
| Enter Pre-operational | 0x80 | Node-ID（0=全部节点） | 目标节点进入 Pre-operational 状态，仅SDO可用 |
| Reset Node | 0x81 | Node-ID（0=全部节点） | 复位目标节点，回到 Initialization 后自动到 Pre-op |
| Reset Communication | 0x82 | Node-ID（0=全部节点） | 仅复位通信层，Node-ID保持不变，重新初始化SDO/PDO |

**典型启动流程示例：**

```c
// 假设网络中有3个从节点：Node-ID 2, 3, 4

// 步骤1：复位所有节点（确保干净状态）
can_send(0x000, {0x81, 0x00});  // Reset Node, 广播
msleep(100);  // 等待初始化完成

// 步骤2：通过SDO配置各节点的OD参数
// （此时节点在Pre-operational，SDO可用）
SDO_config_node(2);  // 配置Node 2的PDO映射等
SDO_config_node(3);  // 配置Node 3的PDO映射等
SDO_config_node(4);  // 配置Node 4的PDO映射等

// 步骤3：启动所有节点进入Operational
can_send(0x000, {0x01, 0x00});  // Start, 广播

// 现在PDO通信开始，实时数据开始传输
```

<br>

> 💡 **提示**：上电后CANopen节点**默认进入 Pre-operational 状态**，此时PDO通信是禁用的！很多初学者困惑"为什么SDO能通但PDO没数据"，答案就是**忘记发送NMT Start命令**（`0x01`）。这是CANopen开发中最常见的新手错误之一。记住口诀：**先配OD，再发Start**。

<br>

### 行业实例：伺服电机驱动器的CANopen启动序列

以 **Maxon EPOS4** 伺服驱动器（广泛应用于机器人关节、自动化设备）为例，完整的上电启动流程：

```
主站（Linux + SocketCAN）          EPOS4（Node-ID = 1）
═══════════════════════════════════════════════════════════

  │                                        │
  │  ── NMT Reset Node ──▶  0x000, [81 00] │  复位所有节点
  │                                        │  （EPOS4 LED闪烁）
  │  ◀── 心跳包 ─────────  0x701, [7F 01] │  Pre-operational
  │                                        │
  │  ── SDO读 0x1000 ───▶  0x601          │  确认设备类型
  │  ◀── 应答 ───────────  0x581, [43 00 10 01 92 02 00 00]
  │                                        │  （确认是CiA 402伺服）
  │  ── SDO写 0x1600 ───▶  0x601          │  配置RPDO1映射
  │     （映射 Controlword + Target Velocity）  │
  │  ── SDO写 0x1A00 ───▶  0x601          │  配置TPDO1映射
  │     （映射 Statusword + Actual Position） │
  │  ── SDO写 0x1800 ───▶  0x601          │  配置TPDO1传输类型
  │     （传输类型255，事件驱动）              │
  │                                        │
  │  ── NMT Start ──────▶  0x000, [01 01] │  ★ 进入Operational！
  │                                        │  （LED常亮绿色）
  │  ◀── TPDO1 ─────────  0x181, [...]    │  开始发送状态字+位置
  │  ── RPDO1 ──────────▶  0x201, [...]    │  接收控制字+目标速度
  │                                        │
  │         ★ 伺服进入实时闭环控制 ★        │
```

**接线要点：**
- CAN_H ↔ CAN_H，CAN_L ↔ CAN_L，GND ↔ GND（单点接地）
- 总线两端各接 120Ω 终端电阻
- EPOS4 默认Node-ID = 1（可通过硬件拨码或OD 0x2000区修改）

<br>

### 调试命令与工具

| 工具/命令 | 用途 | 示例 |
|:----------|:-----|:-----|
| `candump can0` | 监听所有CAN帧 | 观察NMT命令响应、PDO数据 |
| `cansend can0 000#8101` | 发送NMT Reset Node到Node 1 | 复位特定节点 |
| `cansend can0 000#0101` | 发送NMT Start到Node 1 | 启动特定节点 |
| `cansend can0 601#40001801` | SDO上传请求0x1018:01 | 读取厂商ID |
| `canopencomm -i can0 -n 1 start` | canopencomm工具启动节点 | 简化NMT操作 |
| `cat /proc/net/can/stats` | 查看CAN接口统计 | 检查错误帧计数 |

**调试技巧：** 如果PDO没有数据，按以下顺序排查：
1. `candump` 看是否有心跳包（COB-ID = 0x700 + Node-ID）→ 确认节点在线
2. 检查是否发送了NMT Start → 最常见原因
3. 检查PDO映射是否配置正确 → 用SDO读回0x1600/0x1A00验证
4. 检查PDO传输类型 → 异步传输（类型255）需触发条件
5. 用示波器抓CAN波形 → 确认物理层无问题（波特率、终端电阻）

<br>

## <span class="blue"> 本节总结

| 要点 | 内容 |
|:-----|:-----|
| **对象字典核心思想** | 标准化参数模型，Index + Sub-index 唯一标识每个参数 |
| **三大索引区域** | 0x1000-0x1FFF通信参数 / 0x2000-0x5FFF厂商自定义 / 0x6000-0x9FFF标准设备参数 |
| **必记关键条目** | 0x1000设备类型、0x1001错误寄存器、0x1018身份信息、0x1600-0x17FF RPDO映射、0x1A00-0x1BFF TPDO映射 |
| **PDO Mapping** | 通过SDO配置OD条目到CAN帧字节偏移的映射，实现高效实时数据传输 |
| **NMT四个状态** | Initialization → Pre-operational → Operational → Stopped |
| **最关键命令** | NMT Start (0x01) — 上电后必须手动发送才能启用PDO |
| **启动黄金顺序** | 复位 → SDO配置OD → NMT Start → PDO通信 |
| **NMT帧格式** | COB-ID 0x000, 2字节数据：[命令码, Node-ID] |

<br>

## <span class="blue"> 下一步

下一节 **B-D.11.5 CANopen PDO/SDO与Linux驱动**，我们将把理论付诸实践：在Linux系统上使用SocketCAN + CANopen用户空间库（如CANopenNode或libcanfestival）实现完整的CANopen主站，编写PDO/SDO的读写代码，并展示如何在用户空间驱动一个真实的伺服电机。如果你正打算在嵌入式Linux平台上集成CANopen设备，那节内容将直接帮到你。

<br>

## <span class="blue"> 配套资源

- CiA 301 应用层和通信规范（CAN in Automation官网）
- CiA 402 伺服驱动和运动控制子协议
- CANopenNode 开源协议栈：https://github.com/CANopenNode/CANopenNode
- Linux SocketCAN 文档：`Documentation/networking/can.rst`
- 推荐书籍：《CANopen 轻松入门》—— 广州致远电子

