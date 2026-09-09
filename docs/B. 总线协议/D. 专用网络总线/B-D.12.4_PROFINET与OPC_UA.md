# B-D.12.4 PROFINET 与 OPC UA

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：50 分钟

## 本节导读

12.1 的版图里，PROFINET 和 EtherNet/IP 代表"标准以太网兼容"路线，与 EtherCAT 的专用机制路线相对。本节把这条路线讲透一半——PROFINET 的三档实时等级是怎么用不同技术换确定性的，GSDML 设备描述文件怎样支撑即插即用；另一半留给信息层：OPC UA 不是现场总线，它解决的是"数据是什么意思"的语义互操作问题，并且正通过 Pub/Sub over TSN 向实时层下探。这两者的组合（PROFINET 跑控制、OPC UA 跑信息）是当前工厂自动化最常见的纵向架构。

> 本节覆盖：PROFINET NRT/RT/IRT 三档的实现机制与硬件要求、DCP 命名与 GSDML 设备描述的组态流程、PROFINET 与 EtherCAT 的七维取舍、OPC UA 信息模型（节点树/引用/配套规范）、内建安全模型、Client/Server 与 Pub/Sub 两种通信模式、open62541 最小客户端与最小服务器两个用例、嵌入式协议网关形态、控制层与信息层的组合决策、两侧排障。按"控制层怎么做实时 → 设备怎么即插即用 → 与 EtherCAT 怎么选 → 信息层怎么表达语义 → 代码长什么样 → 两层怎么组合"展开——这正是你接一个"西门子产线+上位系统"项目时的上手顺序。

读完你应该能独立完成三件事：为一个项目判定 PROFINET 档位并反推硬件清单、用 open62541 搭一个能跑的客户端或服务器、画出"控制层+网关+信息层"的纵向架构并说明每层协议的选择理由。

## PROFINET：三档实时等级

PROFINET（IEC 61158 Type 10，PI 协会）的设计前提是不改以太网 MAC 层，用工程手段获得确定性。三档等级对应三种机制：

| 等级 | 周期 | 机制 | 硬件要求 |
|:---|:---|:---|:---|
| NRT | >100 ms | 标准 TCP/IP | 无 |
| RT | 1~10 ms | 以太网类型 0x8892 直发，绕开 TCP/IP；VLAN 优先级插队 | 标准网卡 + RT 协议栈 |
| IRT | ~250 µs | 周期时间片调度：IRT 窗口只传实时帧，开放窗口传其余 | ERTEC 专用芯片（交换机与控制器两端都要） |

三档的语义分工人容易被忽略：**NRT 不是"慢的实时"，而是"不实时的部分"**——组态下载、诊断、参数读写走 NRT，它本来就不需要确定性。RT 承载周期 IO 数据。IRT 只为运动控制级别的需求存在。一个 PROFINET 网络三档同时在跑，各干各的活。

RT 档的关键动作是把实时帧从操作系统协议栈里摘出来：发送侧直接组以太网帧，接收侧驱动层分流，0x8892 帧不进 IP 栈。插队机制靠 VLAN 标签的优先级字段：

> VLAN 优先级（PCP，Priority Code Point）：802.1Q 标签里的 3 位优先级字段（0~7），交换机按它做队列调度。PROFINET RT 帧打高 PCP 值，交换机上优先转发——确定性来自"排队时插到队首"，不是来自"不排队"。这与 TSN 的 Qbv 时间门控（12.1/F.16 相关节）是两种哲学：PCP 是优先级，Qbv 是时间隔离。

这与 EtherCAT 绕开协议栈的思路一致，区别在于 PROFINET RT 的帧仍然逐站独立收发、经过交换机排队——确定性靠优先级而不是靠消灭排队，所以天花板在毫秒级。

IRT 档把时间切成确定的窗口（红相只传 IRT 实时帧、绿相开放传其余流量），窗口调度由硬件执行，因此普通网卡做不了 IRT。树莓派板载网卡、Intel i219、RTL8111 这类标准网卡只能跑 RT——选型时先确认目标周期落在哪一档，再反推硬件清单。

> ⚠️
> "PROFINET 主站用普通网卡就行"只对 RT 成立。IRT 需要 ERTEC 或等效 ASIC，Linux 侧没有成熟开源 IRT 主站方案。Linux 平台上要做亚毫秒运动控制，工程上收敛到 EtherCAT（IgH/SOEM），不要在 PROFINET IRT 上耗费预研成本。

<!-- 【待补图】PROFINET 三档实时等级机制对比图（★必要，建议生图）
生图提示词：技术对比图，白底工程蓝图风格，中文标注，横版 16:9。画面分三行，每行画一档的机制示意：第一行 NRT（灰色，画标准 TCP/IP 协议栈方块，标注">100ms，组态/诊断用"）；第二行 RT（蓝色，画以太网帧绕过 TCP/IP 栈直发的箭头路径，标注"EtherType 0x8892+VLAN PCP 优先级插队，1~10ms"，旁边画交换机队列示意高优先级帧插队）；第三行 IRT（绿色，画一条时间轴切成红绿交替窗口，红窗标注"只传 IRT 帧"、绿窗标注"开放流量"，标注"~250µs，需 ERTEC 专用芯片"）。右侧统一标注硬件要求。风格：扁平矢量、细线条、蓝绿灰三色区分档位、无装饰。-->

## GSDML：设备描述驱动的组态流程

每个 PROFINET 设备附带 GSDML 文件——XML 格式的设备自描述：厂商与设备标识、支持的实时等级、可插拔模块的排列、每路 IO 的数据类型与参数范围。工程工具（TIA Portal 或第三方组态软件）导入 GSDML 后，设备能力自动呈现在组态界面里，拓扑拖拽、设备名/IP 分配、配置下载一气呵成。

这个机制的工程价值在于**把集成成本转移到设备厂商侧**：厂商写一次 GSDML，所有用户的组态工具都能理解设备。同类机制在 CANopen 里叫 EDS，在 EtherCAT 里叫 ESI——三者用途相同，格式互不兼容。做设备开发时这份文件是交付物的一部分；做集成时它是排障的第一参考（模块顺序、数据长度以 GSDML 为准）。

组态流程里有一个 PROFINET 特有的环节：设备寻址靠**名字**而不是 IP——

> DCP（Discovery and Configuration Protocol）：PROFINET 的链路层发现与配置协议，直接在以太网层跑（不经过 IP）。组态软件用 DCP 广播"谁叫 IO-Device-03"， matching 的设备应答并认领这个名字；之后的 RT 通信以设备名为锚。PLC 下载组态时按名字找设备——**设备名没分配或重名，设备就不上线**，这是 PROFINET 现场集成最常见的第一步故障。

```text
 组态流程（TIA Portal 或等价工具）：
   导入 GSDML → 拓扑视图拖拽设备 → 分配设备名（DCP 发现与命名）
   → 编译下载到 PLC → RT 周期通信建立
        │
        ▼ 运行期
   PLC ══ RT 帧（0x8892，1~10 ms）══ IO 设备
   PLC ══ NRT（TCP/UDP）══════════ HMI / 诊断终端
```

## PROFINET 与 EtherCAT 的取舍

| 维度 | PROFINET | EtherCAT |
|:---|:---|:---|
| 运动控制适配 | RT 不够、IRT 需专用硬件且 Linux 生态弱 | 原生设计，100 µs 周期成熟 |
| IT/OT 混网 | 天然支持，同网线跑摄像头/办公流量 | 实时段须物理隔离 |
| 存量改造 | 可在现有交换网络上叠加 | 需独立布线 |
| 主站成本 | RT：标准网卡 + 协议栈 | 标准网卡即可（IgH 免费） |
| 从站芯片 | RT：标准 MAC；IRT：ERTEC | 必须 ESC |
| 生态中心 | 西门子 TIA 体系 | ETG/倍福系，主站开源 |
| Linux 友好度 | 弱（无开源主站） | 强（IgH/SOEM 双开源） |

收敛规则一句话：控制周期 ≤1 ms 且多轴同步 → EtherCAT；西门子/罗克韦尔存量生态内的过程控制 → 跟随生态；信息层集成 → 下一节的 OPC UA。

这条规则的推论也要说破：**选型的第一变量往往不是技术参数，而是产线存量生态**——客户车间全是西门子 PLC，你带 EtherCAT 方案去是缘木求鱼；全新设计的机器人控制器，PROFINET 的 IRT 硬件成本和 Linux 生态短板又让它出局。技术表格服务于存量约束，不是反过来。

同一路线里还有一个名字经常出现：EtherNet/IP（罗克韦尔/AB 系，CIP 协议跑在标准以太网上）。它与 PROFINET RT 同档竞争——同样标准网卡、同样毫秒级、同样有设备描述文件（EDS 的另一种格式）。本节只展开 PROFINET 是因为它在欧洲与中国存量更大、IRT 档的对比更有代表性；遇到罗克韦尔存量项目时，把本节的 NRT/RT 框架平移过去即可，差别在组态工具（Studio 5000）和报文细节，哲学相同。

## OPC UA：解决语义互操作

现场总线传的是字节，字节的意义靠人和文档对齐。Modbus 寄存器 0x0001 是温度还是压力、单位是什么、量程多少，协议本身不回答。OPC UA（IEC 62541）的核心是**信息模型**：地址空间是一棵带语义的节点树，每个节点有类型、单位、量程、访问权限，节点之间有关系引用：

```text
 Objects
 └── ProductionLine_1
     └── TemperatureSensor_T1          （对象节点，类型：TemperatureSensorType）
         ├── Value       Double 125.5  （变量节点）
         ├── Unit        "°C"          （属性）
         ├── RangeMin/Max 0.0/200.0    （属性）
         └── AlarmHigh()               （方法节点，可调用的操作）
```

节点树有两个细节决定你能不能读懂别人的服务器：

- **NodeClass（节点类别）**：节点分对象（Object）、变量（Variable）、方法（Method）、类型定义（Type）等八类——上例注释里的分类就是它。Browse 一个陌生服务器时按 NodeClass 过滤能快速建立地图。
- **引用（Reference）**：节点间的边有类型——`Organizes`（目录式组织）、`HasComponent`（组成部分）、`HasTypeDefinition`（是什么类型）。"TemperatureSensor_T1 是一个 TemperatureSensorType 的实例"这条边，就是上位软件能自动生成界面的依据。
- **命名空间（Namespace）**：节点 ID 形如 `ns=2;s=TemperatureSensor_T1.Value`，ns 序号区分"标准定义"与"厂商自定义"——跨厂商对接时先对齐命名空间表。

行业配套规范（Companion Specification）把信息模型再标准化一层：ISA-95 定义企业-控制集成的对象，PackML 定义包装机械的状态机，机器人有 OPC 40001。两家厂商都实现同一配套规范时，上位软件无需人工点表就能理解数据——这是 OPC UA 相对"私有协议 + 点表"模式的代差。

安全是内建的：X.509 证书双向认证、AES/RSA 加密、消息签名、审计日志，全部在协议层定义。部署时唯一要记住的是**不要关它**：调试时为省事接受所有证书，等于把产线数据明文开放，量产后必须恢复证书验证。工控安全事件里"调试配置带进量产"是反复出现的根因。

## Client/Server 与 Pub/Sub

| 模式 | 机制 | 时延 | 适用 |
|:---|:---|:---|:---|
| Client/Server | TCP 连接上的请求-响应（Read/Write/Browse/Call/Subscribe） | 10 ms 级以上 | 配置、诊断、MES/云集成——当前绝对主流 |
| Pub/Sub + MQTT Broker | 发布到消息代理，多方订阅 | 取决于 Broker | 云边协同、一对多分发 |
| Pub/Sub + UDP 多播 | 无连接直发 | µs 级（配合 TSN） | 下一代实时架构（OPC UA FX） |

C/S 模式里的 Subscription/MonitoredItem 机制值得单独知道：客户端订阅变量后，服务器在数值变化超阈值时主动推送——不是轮询，事件驱动，带宽和时延都比周期 Read 好。推送节奏由两个参数控制：`samplingInterval`（服务器多久采一次该变量）与 `publishingInterval`（多久把攒下的变化打包发一次）——采样 100 ms、发布 500 ms 意味着一次推送最多带 5 个变化点，网关调优时这两个值要和上游消费周期对齐。推送还有一层过滤：死区（deadband）配置"变化超过多少才推"，温度信号 0.1 °C 的抖动就不该触发推送——嵌入式网关采集场景优先用订阅而不是循环读，配上合理的死区。

Pub/Sub over UDP 配合 TSN 是 OPC UA FX（Field eXchange）的方向：把语义层直接压到控制层，长期看可能统一现场层与信息层。当前处于早期，跟踪即可，不要在新产品设计里押注它替代 EtherCAT。

## open62541 最小用例

open62541 是 C99 开源 OPC UA 栈（MPL v2），ARM Linux 上广泛验证。先看最小客户端：连接、读一个变量、断开。

```c
/* ua_client_min.c — 读温度变量
 * 编译：gcc -o ua_client ua_client_min.c -lopen62541
 */
#include <open62541/client_config_default.h>
#include <open62541/client_highlevel.h>
#include <stdio.h>

int main(void)
{
    UA_Client *client = UA_Client_new();
    UA_ClientConfig_setDefault(UA_Client_getConfig(client));

    if (UA_Client_connect(client, "opc.tcp://192.168.1.100:4840") != UA_STATUSCODE_GOOD) {
        fprintf(stderr, "连接失败\n");
        return 1;
    }

    UA_Variant value;
    UA_Variant_init(&value);
    UA_StatusCode rc = UA_Client_readValueAttribute(client,
        UA_NODEID_STRING(1, "TemperatureSensor_T1.Value"), &value);
    if (rc == UA_STATUSCODE_GOOD &&
        UA_Variant_hasScalarType(&value, &UA_TYPES[UA_TYPES_DOUBLE]))
        printf("温度 = %.2f °C\n", *(UA_Double *)value.data);
    UA_Variant_clear(&value);

    UA_Client_disconnect(client);
    UA_Client_delete(client);
    return 0;
}
```

网关形态需要的是另一侧——服务器。最小服务器把本地变量挂进信息模型，对外暴露：

```c
/* ua_server_min.c — 挂一个温度节点，对外服务
 * 编译：gcc -o ua_server ua_server_min.c -lopen62541
 */
#include <open62541/server_config_default.h>
#include <open62541/server.h>

int main(void)
{
    UA_Server *server = UA_Server_new();
    UA_ServerConfig_setDefault(UA_Server_getConfig(server));

    /* 在 Objects 下挂一个 Double 变量节点 */
    UA_VariableAttributes attr = UA_VariableAttributes_default;
    UA_Double temp = 25.0;
    UA_Variant_setScalar(&attr.value, &temp, &UA_TYPES[UA_TYPES_DOUBLE]);
    attr.description = UA_LOCALIZEDTEXT("zh-CN", "温度");
    UA_Server_addVariableNode(server,
        UA_NODEID_STRING(1, "TemperatureSensor_T1.Value"),   /* 节点 ID */
        UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER),        /* 父节点 */
        UA_NODEID_NUMERIC(0, UA_NS0ID_ORGANIZES),            /* 引用类型 */
        UA_QUALIFIEDNAME(1, "TemperatureSensor_T1.Value"),
        UA_NODEID_NUMERIC(0, UA_NS0ID_BASEDATAVARIABLETYPE),
        attr, NULL, NULL);

    UA_Server_run_until_interrupt(server);   /* 监听 4840 端口直到 Ctrl-C */
    UA_Server_delete(server);
    return 0;
}
```

跑起来后用任意 OPC UA 客户端（UaExpert、`opcua-client` 命令行）连 `opc.tcp://<板子IP>:4840`，就能 Browse 到这个节点。真实网关的循环体是在节点挂好之后，周期把 libmodbus 读到的现场值写回 `UA_Server_writeValue`——**几十行胶水代码把 Modbus 现场总线翻译成 OPC UA 信息模型**，这是 OPC UA 在边缘侧落地最多的姿势。

嵌入式网关的经典形态由此完整：libmodbus 读现场设备 + open62541 起服务器把数据挂进信息模型，向上对 MES/云暴露 OPC UA 接口。

<!-- 【待补图】控制层-信息层纵向架构与网关位置图（△可选，建议生图）
生图提示词：技术架构图，白底工程蓝图风格，中文标注，横版 12:10。画面自上而下三层：顶层"MES/SCADA/云"（灰色云形框，标注"OPC UA 客户端"）；中层"边缘网关"（蓝色重点框，内部标注"libmodbus 读现场 + open62541 起服务器，几十行胶水代码"）；底层"现场设备"（PLC/IO 模块/伺服驱动三个方框，标注"EtherCAT/PROFINET/Modbus 控制回路"）。层间连线标注协议：底层↔中层标注"现场总线（控制层，ms 级）"，中层↔顶层标注"OPC UA（信息层，语义互操作）"。网关框用红色虚线圈出并标注"嵌入式工程师价值最大的位置：两头都要懂"。风格：扁平矢量、细线条、蓝色系为主，无装饰。-->

## 控制层与信息层的组合决策

| 需求 | 收敛方案 |
|:---|:---|
| 多轴运动控制（≤1 ms） | EtherCAT（控制层），OPC UA 做上位信息接口 |
| 西门子产线集成（10 ms 级 IO） | PROFINET RT，信息层走 OPC UA |
| 纯信息集成（MES/云/跨厂商） | OPC UA C/S，不引入新现场总线 |
| 新架构预研 | 跟踪 OPC UA FX over TSN；车载方向看 D.14.1 |

纵向看，一座现代化工厂的典型栈是：EtherCAT/PROFINET 跑控制回路 → 边缘网关把过程数据挂进 OPC UA 信息模型 → MES/SCADA/云以 OPC UA 客户端消费。嵌入式工程师在网关这一层价值最大——两头都要懂。

## 排障：PROFINET 与 OPC UA 常见故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| PROFINET 设备组态后不上线 | 设备名未分配（DCP 命名是 PROFINET 寻址前提） | 组态软件里"分配设备名"后核对 MAC 对应关系 |
| 多台同型号设备互相抢上线 | 设备名重名（DCP 以名为锚） | 逐台下电隔离，重命名后再组网 |
| RT 通信周期不达标 | 网段里有大流量冲击优先级队列 | 交换机端口镜像抓包，确认 VLAN PCP 生效 |
| OPC UA 客户端连不上 | 证书被拒、端点 URL 的命名空间/IP 不一致 | 服务器日志看证书拒绝记录；先关安全策略定位再恢复 |
| 读到的变量类型与预期不符 | 信息模型里该节点是 String/Int 而非 Double | Browse 节点确认 DataType，不要按文档猜 |
| 订阅无推送 | 发布间隔或死区（deadband）配置过滤了变化 | 调 MonitoredItem 的 samplingInterval 与 deadband |
| 网关数据更新慢 | 用循环 Read 而非 Subscription | 改订阅模式并配置死区 |

## 本节总结

本节的两半由一条主线贯穿：**控制层要的是确定性，信息层要的是语义**——两套问题用两套协议解。PROFINET 的三档（NRT 组态诊断、RT 周期 IO、IRT 运动控制）对应三种确定性机制，RT 靠 0x8892 直发+VLAN 优先级、IRT 靠 ERTEC 硬件时间片；Linux 平台做亚毫秒控制收敛到 EtherCAT，PROFINET IRT 没有成熟开源路径。GSDML 把集成成本转移到厂商侧，DCP 命名是 PROFINET 特有的寻址前提（设备不上线先查名字）。OPC UA 的信息模型（节点树+引用+命名空间+配套规范）解决"字节是什么意思"，内建安全不可关；通信上 C/S 订阅优先于轮询，Pub/Sub over TSN（OPC UA FX）是跟踪方向不是押注对象。open62541 两侧最小用例都有了：客户端读值、服务器挂点，几十行胶水代码就是边缘网关。组合决策一句话：控制层跟随存量生态或选 EtherCAT，信息层统一 OPC UA，网关层是嵌入式工程师的价值高地。

| 关键结论 | 一句话记忆 |
|:---|:---|
| PROFINET 三档 | NRT 组态/RT 周期 IO/IRT 运动控制；三档同网并存各干各活 |
| RT 机制 | 0x8892 直发绕协议栈 + VLAN PCP 插队；天花板毫秒级 |
| IRT 硬件 | ERTEC 专用芯片两端都要；Linux 无开源 IRT 主站，别预研 |
| GSDML/DCP | 设备描述=厂商侧集成成本；设备名是寻址锚，不上线先查名 |
| 选型第一变量 | 产线存量生态，不是技术参数 |
| OPC UA 核心 | 信息模型=带语义的节点树；配套规范免点表 |
| 安全 | 证书验证不可关；"调试配置带进量产"是工控安全高频根因 |
| 通信模式 | C/S 订阅优先轮询；Pub/Sub+TSN（OPC UA FX）跟踪不押注 |
| 网关形态 | libmodbus + open62541 服务器；几十行胶水代码 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出 PROFINET 三档的周期、机制、硬件要求，并判定给定项目该落在哪一档
- 解释 VLAN PCP 优先级与 TSN Qbv 时间门控两种确定性哲学的差异
- 解释 GSDML 在组态流程中的角色，并举出它在 CANopen/EtherCAT 里的对应物（EDS/ESI）
- 用 DCP 命名机制解释"设备不上线先查设备名"，并为一个"西门子 PLC + 国产 IO 模块"的集成项目列出开工顺序
- 画出 OPC UA 信息模型节点树，用 NodeClass/引用/命名空间三要素说明节点与"裸寄存器"的本质差异
- 在 Client/Server 订阅、Pub/Sub MQTT、Pub/Sub UDP 之间为三个不同场景选型，并解释死区配置的作用
- 用 open62541 写出"连接-读值-断开"的最小客户端与"挂节点-服务"的最小服务器，并说明嵌入式网关的典型组合
- 解释为什么量产的 OPC UA 服务不能关闭证书验证

## 参考资料

- IEC 61158 Type 10 — PROFINET；PI 组织系统描述文档
- IEC 62541 — OPC UA 系列标准；Part 14（Pub/Sub）
- open62541：open62541.org（文档含服务器/客户端/PubSub 教程）
- OPC 基金会配套规范库（ISA-95、PackML、OPC 40001 等）
- TSN：IEEE 802.1AS/802.1Qbv；OPC UA FX 进展见 OPC 基金会 FLC 工作组
- 本书关联：12.1（工业以太网版图与三分类）、12.2/12.3（EtherCAT 机制）、12.5（IgH 主站实战）、E.15.1（工厂自动化整机架构）
