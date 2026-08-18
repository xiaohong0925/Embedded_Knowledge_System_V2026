# B-D.12.4 PROFINET 与 OPC UA

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：40 分钟

## 本节导读

12.1 的版图里，PROFINET 和 EtherNet/IP 代表"标准以太网兼容"路线，与 EtherCAT 的专用机制路线相对。本节把这条路线讲透一半——PROFINET 的三档实时等级是怎么用不同技术换确定性的，GSDML 设备描述文件怎样支撑即插即用；另一半留给信息层：OPC UA 不是现场总线，它解决的是"数据是什么意思"的语义互操作问题，并且正通过 Pub/Sub over TSN 向实时层下探。这两者的组合（PROFINET 跑控制、OPC UA 跑信息）是当前工厂自动化最常见的纵向架构。

本节覆盖：PROFINET NRT/RT/IRT 三档的实现机制与硬件要求、GSDML 文件的作用与工程流程、PROFINET 与 EtherCAT 的取舍边界、OPC UA 信息模型与配套规范、Client/Server 与 Pub/Sub 两种模式、open62541 在嵌入式 Linux 上的最小用例、控制层与信息层的选型决策。

## PROFINET：三档实时等级

PROFINET（IEC 61158 Type 10，PI 协会）的设计前提是不改以太网 MAC 层，用工程手段获得确定性。三档等级对应三种机制：

| 等级 | 周期 | 机制 | 硬件要求 |
|:---|:---|:---|:---|
| NRT | >100 ms | 标准 TCP/IP | 无 |
| RT | 1~10 ms | 以太网类型 0x8892 直发，绕开 TCP/IP；VLAN 优先级插队 | 标准网卡 + RT 协议栈 |
| IRT | ~250 µs | 周期时间片调度：IRT 窗口只传实时帧，开放窗口传其余 | ERTEC 专用芯片（交换机与控制器两端都要） |

RT 档的关键动作是把实时帧从操作系统协议栈里摘出来：发送侧直接组以太网帧，接收侧驱动层分流，0x8892 帧不进 IP 栈。这与 EtherCAT 绕开协议栈的思路一致，区别在于 PROFINET RT 的帧仍然逐站独立收发、经过交换机排队——确定性靠优先级而不是靠消灭排队，所以天花板在毫秒级。

IRT 档把时间切成确定的窗口，窗口调度由硬件执行，因此普通网卡做不了 IRT。树莓派板载网卡、Intel i219、RTL8111 这类标准网卡只能跑 RT——选型时先确认目标周期落在哪一档，再反推硬件清单。

> ⚠️
> "PROFINET 主站用普通网卡就行"只对 RT 成立。IRT 需要 ERTEC 或等效 ASIC，Linux 侧没有成熟开源 IRT 主站方案。Linux 平台上要做亚毫秒运动控制，工程上收敛到 EtherCAT（IgH/SOEM），不要在 PROFINET IRT 上耗费预研成本。

## GSDML：设备描述驱动的组态流程

每个 PROFINET 设备附带 GSDML 文件——XML 格式的设备自描述：厂商与设备标识、支持的实时等级、可插拔模块的排列、每路 IO 的数据类型与参数范围。工程工具（TIA Portal 或第三方组态软件）导入 GSDML 后，设备能力自动呈现在组态界面里，拓扑拖拽、设备名/IP 分配、配置下载一气呵成。

这个机制的工程价值在于**把集成成本转移到设备厂商侧**：厂商写一次 GSDML，所有用户的组态工具都能理解设备。同类机制在 CANopen 里叫 EDS，在 EtherCAT 里叫 ESI——三者用途相同，格式互不兼容。做设备开发时这份文件是交付物的一部分；做集成时它是排障的第一参考（模块顺序、数据长度以 GSDML 为准）。

```
 组态流程（TIA Portal 或等价工具）：
   导入 GSDML → 拓扑视图拖拽设备 → 分配设备名（DCP 协议发现）
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

## OPC UA：解决语义互操作

现场总线传的是字节，字节的意义靠人和文档对齐。Modbus 寄存器 0x0001 是温度还是压力、单位是什么、量程多少，协议本身不回答。OPC UA（IEC 62541）的核心是**信息模型**：地址空间是一棵带语义的节点树，每个节点有类型、单位、量程、访问权限，节点之间有关系引用：

```
 Objects
 └── ProductionLine_1
     └── TemperatureSensor_T1          （对象节点，类型：TemperatureSensorType）
         ├── Value       Double 125.5  （变量节点）
         ├── Unit        "°C"          （属性）
         ├── RangeMin/Max 0.0/200.0    （属性）
         └── AlarmHigh()               （方法节点，可调用的操作）
```

行业配套规范（Companion Specification）把信息模型再标准化一层：ISA-95 定义企业-控制集成的对象，PackML 定义包装机械的状态机，机器人有 OPC 40001。两家厂商都实现同一配套规范时，上位软件无需人工点表就能理解数据——这是 OPC UA 相对"私有协议 + 点表"模式的代差。

安全是内建的：X.509 证书双向认证、AES/RSA 加密、消息签名、审计日志，全部在协议层定义。部署时唯一要记住的是**不要关它**：调试时为省事接受所有证书，等于把产线数据明文开放，量产后必须恢复证书验证。

## Client/Server 与 Pub/Sub

| 模式 | 机制 | 时延 | 适用 |
|:---|:---|:---|:---|
| Client/Server | TCP 连接上的请求-响应（Read/Write/Browse/Call/Subscribe） | 10 ms 级以上 | 配置、诊断、MES/云集成——当前绝对主流 |
| Pub/Sub + MQTT Broker | 发布到消息代理，多方订阅 | 取决于 Broker | 云边协同、一对多分发 |
| Pub/Sub + UDP 多播 | 无连接直发 | µs 级（配合 TSN） | 下一代实时架构（OPC UA FX） |

C/S 模式里的 Subscription/MonitoredItem 机制值得单独知道：客户端订阅变量后，服务器在数值变化超阈值时主动推送——不是轮询，事件驱动，带宽和时延都比周期 Read 好。嵌入式网关采集场景优先用订阅而不是循环读。

Pub/Sub over UDP 配合 TSN 是 OPC UA FX（Field eXchange）的方向：把语义层直接压到控制层，长期看可能统一现场层与信息层。当前处于早期，跟踪即可，不要在新产品设计里押注它替代 EtherCAT。

## open62541 最小用例

open62541 是 C99 开源 OPC UA 栈（MPL v2），ARM Linux 上广泛验证。最小客户端：连接、读一个变量、断开。

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

嵌入式网关的经典形态：libmodbus 读现场设备 + open62541 起服务器把数据挂进信息模型，向上对 MES/云暴露 OPC UA 接口。这一组合把"协议网关"做成几十行胶水代码，是 OPC UA 在边缘侧落地最多的姿势。

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
| RT 通信周期不达标 | 网段里有大流量冲击优先级队列 | 交换机端口镜像抓包，确认 VLAN 优先级生效 |
| OPC UA 客户端连不上 | 证书被拒、端点 URL 的命名空间/IP 不一致 | 服务器日志看证书拒绝记录；先关安全策略定位再恢复 |
| 读到的变量类型与预期不符 | 信息模型里该节点是 String/Int 而非 Double | Browse 节点确认 DataType，不要按文档猜 |
| 订阅无推送 | 发布间隔或死区（deadband）配置过滤了变化 | 调 MonitoredItem 的 samplingInterval 与 deadband |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出 PROFINET 三档的周期、机制、硬件要求，并判定给定项目该落在哪一档
- 解释 GSDML 在组态流程中的角色，并举出它在 CANopen/EtherCAT 里的对应物
- 为一个"西门子 PLC + 国产 IO 模块"的集成项目列出开工顺序
- 画出 OPC UA 信息模型节点树，说明节点与"裸寄存器"的本质差异
- 在 Client/Server 订阅、Pub/Sub MQTT、Pub/Sub UDP 之间为三个不同场景选型
- 用 open62541 写出"连接-读值-断开"的最小客户端，并说明嵌入式网关的典型组合
- 解释为什么量产的 OPC UA 服务不能关闭证书验证

## 参考资料

- IEC 61158 Type 10 — PROFINET；PI 组织系统描述文档
- IEC 62541 — OPC UA 系列标准；Part 14（Pub/Sub）
- open62541：open62541.org（文档含服务器/客户端/PubSub 教程）
- OPC 基金会配套规范库（ISA-95、PackML、OPC 40001 等）
- TSN：IEEE 802.1AS/802.1Qbv；OPC UA FX 进展见 OPC 基金会 FLC 工作组
