# B-D.11.5 CANopen PDO/SDO 与 Linux 实现

> 所属章节：第五部 B. 总线协议 > B-D.11 CAN 与 CANopen
>
> 难度：[E] Expert | 预计阅读时间：50 分钟

## <span class="blue"> 本节导读

上一节建立了 CANopen 的两个支柱——对象字典和 NMT。本节讲数据怎么真正流动：PDO 负责周期性实时数据（伺服的目标位置、实际位置），SDO 负责点对点的参数读写与诊断。两者是"管道"和"管道里的水流"的关系——PDO 的映射关系本身也是通过 SDO 写进对象字典的。后半节落到 Linux：评估裸 SocketCAN 与 CANopenNode 协议栈两条路线，并以 CiA 402 伺服控制为例串起完整流程。

本节覆盖：PDO 的方向与触发机制、传输类型编码、映射配置四步流程、CANopen 字节序（这里要纠正一个流传甚广的错误）、SDO 三种传输类型与命令字节格式、PDO/SDO 的分工边界、CANopenNode 架构与对象字典生成、CiA 402 状态机控制序列、CANopen 层排障清单。

## <span class="blue"> PDO：无确认的实时数据通道

闭环控制对通信的要求是周期确定、开销最小：主站每 1 ms 下发目标位置，伺服每 1 ms 回传实际位置。请求-应答模式一次交互至少两帧还要等确认，PDO 的做法是发出去就用、没有确认、没有重传——可靠性由 CAN 底层的 CRC 与错误帧机制兜底，实时性由无握手换来。

### 方向与默认 COB-ID

| 方向 | 名称 | 流向 | 默认 COB-ID（Node-ID = n） |
|:---|:---|:---|:---|
| TPDO1~4 | 发送 PDO | 从站 → 总线 | 0x180+n / 0x280+n / 0x380+n / 0x480+n |
| RPDO1~4 | 接收 PDO | 主站 → 从站 | 0x200+n / 0x300+n / 0x400+n / 0x500+n |

编号越小 COB-ID 越小、优先级越高，最实时的量（控制字、状态字、位置）放 PDO1。PDO 是广播语义，一个 TPDO 可以被总线上多个节点同时接收——多轴联动时从站之间直接互听位置反馈，不必经主站转发。

### 触发方式与传输类型

TPDO 何时发送，由通信参数 0x1800+x 子索引 2（transmission type）决定：

| 传输类型 | 触发方式 | 适用 |
|:---|:---|:---|
| 0 | 保留（非同步） | — |
| 1~240 | 每 N 个 SYNC 周期发送一次 | 运动控制的周期数据 |
| 252 | 收到 SYNC 后等待 RTR 请求再发 | 较少用 |
| 253 | 收到 RTR 立即发 | 主站按需轮询 |
| 254 | 事件驱动（厂商定义触发条件） | 状态突变、报警 |
| 255 | 事件/定时驱动（设备子协议定义） | 最常用的事件模式 |

同步模式是多轴协调的基础：主站周期广播 SYNC（COB-ID 0x80），所有伺服从站在同一个 SYNC 沿采样反馈量并发出 TPDO，在下一个 SYNC 沿执行新的 RPDO 设定值。整条总线的控制节拍被统一到 SYNC 周期上，轴间同步误差收敛到总线抖动量级。

异步事件模式适合慢变量：温度变化超过阈值才发，总线负载随事件稀疏度下降。

通信参数里还有两个流量控制旋钮：**抑制时间**（inhibit time，0x1800+x:03，两次 TPDO 之间的最小间隔，单位 100 µs）防止事件驱动型 PDO 在数据抖动时刷屏；**事件定时器**（event timer，0x1800+x:05）给异步 PDO 一个最长静默期，到期强制发一帧，兼作数据活性检测。

### 映射配置四步

PDO 映射条目编码（`索引|子索引|位长`）在上一节已讲，完整的配置流程固定四步，全部通过 SDO 完成：

```
 1. 写 0x1400+x:01 COB-ID（bit31=1 先禁用该 PDO），或直接写 0x1600+x:00 = 0
 2. 逐条写 0x1600+x:01..n = 映射条目
 3. 写 0x1600+x:00 = n（条目数，启用映射）
 4. 写 0x1400+x:01 COB-ID（bit31=0 使能 PDO），并按需设置 0x1400+x:02 传输类型
```

TPDO 对称，用 0x1800+x 与 0x1A00+x。映射条目数与子索引个数不匹配、总位长超过 64 位（经典 CAN），设备都会以 SDO abort 拒绝——下一节讲 abort code 怎么读。

### 字节序：纠正一个常见错误

> ⚠️
> CANopen 的多字节数据是**小端（Intel 格式，最低有效字节在前）**，不是大端。部分中文资料（包括本书旧稿）写成"PDO 用 Motorola 大端"是错的——那是 CAN 报文信号打包（DBC）里 Motorola 格式的概念，被误植到了 CANopen。CiA 301 明确规定 OD 条目按 LSB-first 传输。

实例验证：TPDO1 数据 `37 02 A8 61 00 00`，前 2 字节是状态字 0x0237，后 4 字节是实际位置 0x000061A8 = 25000 counts——按小端读才对。在小端主机（x86、ARM 默认小端）上可以 memcpy 直接取；在大端主机上必须逐字段字节交换。判断依据不要靠猜，用设备手册的示例帧对一遍。

## <span class="blue"> SDO：确认制的参数通道

SDO 是主站与单个从站之间的点对点请求-应答通道，上传（upload，从站→主站，读）和下载（download，主站→从站，写）两个方向从主站视角命名。默认 COB-ID：请求 0x600+n，应答 0x580+n。

### 三种传输类型

| 类型 | 数据量 | 帧数 | 适用 |
|:---|:---|:---|:---|
| Expedited（加速） | ≤4 字节 | 请求+应答 2 帧 | 读写单个参数，最常用 |
| Segmented（分段） | 任意 | 2 + N×2 | 字符串、数组 |
| Block（块） | 任意 | 最少 | 固件升级、批量 dump |

### Expedited 帧格式

下载（写）请求帧的 8 字节布局：

```
 字节0        字节1~2      字节3      字节4~7
 ┌──────────┬────────────┬─────────┬──────────────┐
 │ 命令字节  │ OD 索引    │ 子索引  │ 数据（≤4B）   │
 │ (ccs|n|e|s)│ 小端      │         │ 小端          │
 └──────────┴────────────┴─────────┴──────────────┘
```

命令字节不是四个魔法数，它有位结构——看懂了就不用背表：

```
 bit  7   6   5 │ 4  3 │  2  │ 1  0
     [   ccs   ]│[ n ] │[ e ]│[ s ]
```

| 位段 | 名称 | 含义 |
|------|------|------|
| ccs（bit 7~5） | 客户端命令符 | 1=下载请求、2=上传请求、4=中止……决定这帧要干什么 |
| n（bit 4~3） | 空字节数 | 数据区里最后几个字节无效（仅 e=1 时有效）：0=4 字节全有效、1=末 1 字节无效…… |
| e（bit 2） | expedited | 1=加速传输（本帧即全部数据）；0=分段传输起手 |
| s（bit 1） | size 指示 | 1= n 字段有效（明确声明了有效字节数） |

套一下验证：`0x2F` = 二进制 0010 1111 → ccs=001（下载）、n=11（3 字节无效）、e=1（加速）、s=1（声明长度）→ 有效数据 = 4−3 = **1 字节**。同理 `0x2B`（n=10）写 2 字节、`0x27`（n=01）写 3 字节、`0x23`（n=00）写 4 字节；`0x40` = ccs=010 上传请求。应答方向对称，命令符换成 scs（server command）：

```
 从站应答：
   下载成功：0x60 + 索引回显
   上传应答：0x4F/0x4B/0x47/0x43（对应 1~4 字节）+ 数据
   失败：0x80 + 索引回显 + 4 字节 abort code
```

写控制字 0x6040:00 = 0x000F（Enable Operation）的完整交互：

```
 主站 → 0x601  [2F 40 60 00 0F 00 00 00]
 从站 → 0x581  [60 40 60 00 00 00 00 00]   成功
```

### Abort code：SDO 失败的错误码

SDO 应答命令字节 0x80 表示中止，后 4 字节是原因码，调试时直接查表：

| Abort code | 含义 |
|:---|:---|
| 0x05030000 | toggle bit 未交替（分段传输时序错） |
| 0x06010000 | 对只读条目执行写 |
| 0x06020000 | OD 中不存在该条目 |
| 0x06090011 | 子索引不存在 |
| 0x06090030 | 数值超出范围 |
| 0x06070010 | 数据类型长度不匹配 |
| 0x08000020 | 当前状态下不允许写入（如 Operational 中改 PDO 映射） |

写 PDO 映射不报 abort 的合法路径是回 Pre-operational 再改；运行中改映射会被 0x08000020 拒绝，这是设备在保护实时链路的确定性。

### Segmented 与 toggle bit

超过 4 字节走分段：初始化握手约定总长，随后每段 7 字节数据 + 1 个 toggle 位（0/1 交替），接收方按 toggle 位检测丢段或重复段。固件升级场景（OD 0x1F50 区域）数据量大，用 Block 传输把逐段确认改成按块确认，帧数降一个量级。

## <span class="blue"> PDO 与 SDO 的分工

| 维度 | PDO | SDO |
|:---|:---|:---|
| 交互模式 | 无确认、广播 | 请求-应答、点对点 |
| 单帧数据 | ≤8 字节（FD 下 ≤64） | 任意（分段/块） |
| 典型周期 | 125 µs ~ 10 ms | 非周期，按需 |
| 可靠性 | CAN 底层检错，不重传 | 逐帧确认 + abort code |
| 角色 | 运行时实时数据 | 配置、诊断、固件 |

工程边界一句话：配置走 SDO，运行走 PDO；运行期再发 SDO 会挤占 PDO 带宽并引入不确定延迟，量产系统的运行环路只发 PDO 和 SYNC。

## <span class="blue"> Linux 实现路线：裸 SocketCAN 还是 CANopenNode

三条路线的取舍先摆开：

| 路线 | 做什么 | 适合 | 不适合 |
|------|--------|------|--------|
| 裸 SocketCAN | 自己组装 SDO/解析 PDO/管 NMT 与心跳 | 学习协议、一次性诊断脚本、只收发少量固定帧的极简场景 | 产品主站——分段 SDO、心跳超时表、EMCY 处理全是自己维护的债 |
| CANopenNode（开源） | 完整协议栈：NMT/HB/SYNC/SDO/PDO/EMCY，从站与主站（v4+）都行 | 产品级主站与从站，机器人/运动控制主流选择 | 需要集成学习的初期投入 |
| 商业协议栈（如 port、HMS） | 同 CANopenNode，附认证与技术支持 | 有认证需求（医疗、轨交）的产品 | 成本敏感项目 |

裸 SocketCAN 手写 CANopen 主站，意味着自己实现 SDO 帧组装、分段 toggle 逻辑、NMT 状态跟踪、心跳超时表、PDO 映射解析。做一次能深刻理解协议，但产品里没人维护这份代码。

CANopenNode（github.com/CANopenNode）是纯 C、零依赖的开源协议栈，Linux 下跑在 SocketCAN 之上，既能把本机做成 CANopen 节点（从站），也带主站管理功能（v4 起提供 LSS、NMT master、SDO client API）：

```
 应用（控制算法、状态机）
 ─────────────────────────────
 CANopenNode 核心：NMT / HB / SYNC / SDO / PDO / EMCY
 ─────────────────────────────
 对象字典：objdictedit 生成的 OD.c（索引、默认值、映射权限）
 ─────────────────────────────
 CO_driver：SocketCAN 收发适配
 ─────────────────────────────
 Linux SocketCAN → CAN 控制器 → 总线
```

对象字典不用手写：objdictgen 目录下的 objdictedit（Python GUI）可视化编辑索引、类型、默认值、PDO 映射权限，导出 OD.c；厂商设备的 EDS（电子数据表）文件可直接导入查看完整字典。CANopenNode 各版本 API 变化较大（v1/v2 的 `CO_init()` 一把梭，v4 拆成 `CO_new()` → `CO_CANinit()` → `CO_CANopenInit()` → 主循环 `CO_process()`），写代码时以所用版本的 `CANopen.h` 注释和 examples 目录为准，不要照抄跨版本教程。

v4 主站侧的最小骨架（以 CANopenNode v4 的 CANopenLinux 为例，细节随版本变动，以 examples 为准）：

```c
/* 主循环骨架：初始化 → NMT 启动从站 → 周期处理 */
CO_t *CO = CO_new(NULL, NULL);
CO_CANinit(CO, can_if, 0);                       /* 绑 SocketCAN 接口 */
CO_CANopenInit(CO, NULL, NULL, OD, NULL,
               NMT_CONTROL, node_id, node_id,
               true, &reset_flag);               /* 本机作为节点上线 */

/* 主站功能：NMT 管理 + SDO 客户端 */
CO_NMT_sendCommand(CO->NMT, CO_NMT_ENTER_OPERATIONAL, 0);  /* 广播 Start */

CO_SDOclient_t *sdo;
CO_SDOclient_setup(CO->SDOclient, 0, 0, target_node_id);   /* 对节点 2 建 SDO 通道 */

for (;;) {
    CO_process(CO, false, 1000, NULL);           /* 1 ms 节拍：处理收发/心跳/SYNC */
    /* SDO 读写示例：上传从站 0x1000:00 设备类型 */
    uint32_t dev_type;
    CO_SDOclient_upload(sdo, 0x1000, 0x00, (uint8_t *)&dev_type,
                        sizeof(dev_type), NULL, NULL);
    usleep(1000);
}
```

关键认知是节拍模型：CANopenNode 不是事件回调框架，而是一个要你以固定周期（通常 1 ms）驱动 `CO_process()` 的协作式内核——协议栈的心跳发送、SYNC 节拍、PDO 触发都在这个周期里推进。把它放进一个实时线程（配合 B-E.15.6 的 PREEMPT_RT 调度），节拍精度就是总线节拍精度。

运动控制的完整接线与调通流程属于实战内容，在 `B-D.11.6` 展开；这里给出协议层面的控制序列。

## <span class="blue"> CiA 402 伺服控制序列

CiA 402 定义了驱动器的状态机，主站通过控制字（0x6040）驱动状态转换，通过状态字（0x6041）确认当前状态：

```
 控制字命令（0x6040）              状态字特征位（0x6041）
  0x0006 Shutdown        →        xxxx xxxx x01x 0001  Ready to Switch On
  0x0007 Switch On       →        xxxx xxxx x011 0011  Switched On
  0x000F Enable Operation→        xxxx xxxx x011 0111  Operation Enabled
  0x0002 Quick Stop      →        急停，回 Quick Stop Active
  bit7=1  Fault Reset    →        故障复位
```

位置模式的完整协议序列（假设 PDO 映射已按 11.4 的方法配好：RPDO1 = 控制字+目标位置 0x607A，TPDO1 = 状态字+实际位置 0x6064，传输类型 1 即每 SYNC 一次）：

```
 1. NMT Reset → 等 Boot-up → 确认 Pre-operational
 2. SDO 写 0x6060:00 = 1            设为位置模式（Profile Position）
 3. NMT Start → Operational
 4. 主站开 SYNC 周期发送（1 ms）
 5. RPDO1 依次写控制字 0x06 → 0x07 → 0x0F
    每步读 TPDO1 状态字确认到位再发下一步
 6. RPDO1 写目标位置 0x607A + 控制字 bit4 上升沿触发运动
 7. 循环：TPDO1 读实际位置，到位置后状态字 bit10（Target Reached）置位
 8. 异常：读 0x603F 错误码 → 控制字 Fault Reset → 重新使能
```

状态机跳跃是伺服调试的高频坑：不从 Shutdown 逐级走到 Enable Operation，直接写 0x0F 会被驱动器忽略，状态字停在原处——看到"控制字写了电机不动"，先读状态字对 CiA 402 状态图。

<!-- 【待补图】images/b-d-11-5-cia402-state-machine.png（优先级：★必要）
图名：CiA 402 驱动器状态机
生图提示词：技术状态机图，白底工程蓝图风格，中文标注，横版 16:9。状态圆角框：Not Ready to Switch On（灰）→ Switch On Disabled（橙，标注"上电停这里"）→ Ready to Switch On → Switched On → Operation Enabled（绿，标注"电机真正使能"），另画 Fault（红）与 Quick Stop Active（橙）。转换箭头标注控制字命令：0x06 Shutdown、0x07 Switch On、0x0F Enable Operation、0x02 Quick Stop、bit7=1 Fault Reset，每个状态框下小字标注状态字特征位（x01x0001/x0110011/x0110111）。扁平矢量、细线条、无装饰。 -->

## <span class="blue"> 排障：PDO/SDO 层故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| SDO 写映射报 0x08000020 | 节点在 Operational，运行中禁改映射 | NMT 回 Pre-operational 再写 |
| SDO 写报 0x06090030 | 数值越界（如传输类型写了 256） | 查 EDS/手册该条目取值域 |
| SDO 写报 0x06020000 | 索引不存在，厂商实现裁剪过 OD | SDO 读 0x1000 确认 profile；对照 EDS |
| PDO 数值解析全错 | 按大端读了（应为小端） | 拿手册示例帧比对字节顺序 |
| 多轴位置不同步 | 没用 SYNC 同步传输，各轴各发各的 | 传输类型改 1，主站开 SYNC |
| 事件型 TPDO 刷屏、PDO 延迟变大 | 抑制时间未设，数据抖动触发风暴 | 写 0x1800+x:03 抑制时间 |
| 状态字不变、电机不动 | CiA 402 状态机跳跃，控制字序列错 | 逐级 0x06→0x07→0x0F，每步核对状态字 |
| 分段 SDO 传一半中止 0x05030000 | toggle 位未交替，重传逻辑有 bug | candump 看分段帧序列 |

## <span class="blue"> 本节总结

CANopen 的数据面就两条通道，分工一句话：**配置走 SDO，运行走 PDO**。PDO 用无确认的广播换实时性，靠 SYNC 把多轴节拍对齐到同一个周期；SDO 用逐帧确认换可靠性，承载所有参数读写与诊断。两者不是并列关系而是层叠关系——PDO 的映射配置本身就是通过 SDO 写进对象字典的，SDO 是地基，PDO 是地基上跑的车。

两个细节值得单独记住。第一，SDO 命令字节不是四个要背的魔法数，它是 `ccs|n|e|s` 的位结构，看懂位段之后 `0x2F`、`0x2B`、`0x40` 都是自己算出来的，遇到没见过的命令字节也能反解。第二，CANopen 全线小端，"PDO 是大端"是把 DBC 信号打包的 Motorola 格式误植过来的错误，在小端主机上 memcpy 直取即可，在大端主机上必须逐字段交换——拿设备手册的示例帧对一遍，永远是最快的验证手段。

工程落地时守住两条纪律：映射改动回 Pre-operational 再做，Operational 下改映射会被 0x08000020 拒绝，这是协议在保护实时链路的确定性；CiA 402 使能必须逐级走 `0x06 → 0x07 → 0x0F`，每步核对状态字再发下一步，跳步驱动器直接忽略。Linux 侧的选型结论也很直接：学习和一次性诊断用裸 SocketCAN，产品主站用 CANopenNode——SDO 分段、心跳超时表、EMCY 处理这些坑，没必要自己再踩一遍。

速查：

| 要点 | 结论 |
|:---|:---|
| 默认 COB-ID 规律 | TPDO1 = 0x180+n，RPDO1 = 0x200+n，SDO 请求 0x600+n / 应答 0x580+n |
| 多轴同步 | 传输类型 1 + 主站周期 SYNC（0x80），节拍统一到 SYNC 周期 |
| 映射配置四步 | 禁 PDO → 写映射条目 → 写条目数 → 使能 PDO（Pre-operational 下做） |
| 命令字节位段 | ccs（bit7~5，干什么）/ n（bit4~3，无效字节数）/ e（bit2，加速）/ s（bit1，长度有效） |
| 字节序 | 小端 LSB-first；大端主机必须逐字段字节交换 |
| 高频 abort code | 0x06020000 无此条目 / 0x06090030 越界 / 0x08000020 状态不允许 |
| CiA 402 使能序列 | 0x06 → 0x07 → 0x0F，每步核对状态字特征位 |
| Linux 路线 | 学习诊断用裸 SocketCAN，产品用 CANopenNode（v4 起带主站功能） |

## <span class="blue"> 本节自查

读完本节，你应能独立完成以下动作：

- 说出 TPDO/RPDO 的默认 COB-ID 规律和"编号越小优先级越高"的设计原因
- 为一个三轴伺服系统设计 SYNC 同步方案：SYNC 周期、各 PDO 传输类型、抑制时间
- 手写一帧 SDO expedited 下载请求（给定索引、子索引、数据），并解读应答
- 根据 abort code 定位 SDO 失败原因
- 指出"CANopen 数据是大端"这一说法的错误，并用示例帧验证正确字节序
- 写出 CiA 402 从 Not Ready 到 Operation Enabled 的控制字序列及每步预期状态字
- 评估项目该用裸 SocketCAN 还是 CANopenNode，并说明理由

## <span class="blue"> 下一步

`B-D.11.6 实战 SocketCAN 双板收发与 CANopen 伺服控制` 把本节和前两节的协议知识落到实物：两块板卡通过 CAN 收发器互连，先用 SocketCAN 工具链打通原始帧收发，再用 CANopenNode 驱动一台真实伺服完成 CiA 402 使能与位置运动，最后 candump 抓帧对照本节学的 PDO/SDO 格式逐字节验证。

> 💡
> 本节用到的底层能力：CAN 帧的收发路径与 SocketCAN 接口在 `B-D.11.3`，对象字典与 NMT 状态机在 `B-D.11.4`，1 ms 节拍线程的实时性保障在 `B-E.15.6 PREEMPT_RT`。深入阅读可参考 CiA 301（通信对象与传输协议）、CiA 402（驱动器状态机位定义）与 CANopenNode 仓库的 examples 目录。
