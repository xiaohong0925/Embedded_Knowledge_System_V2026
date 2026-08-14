# B-D.11.5 CANopen PDO、SDO与Linux驱动

> 所属章节：第五部 B. 总线协议 > B-D.11 CAN总线
>
> 难度：[E] Expert / [M] Master | 预计阅读时间：45分钟

## <span class="blue"> 本节导读

上一节你了解了CAN总线的电气特性和SocketCAN编程接口。但工业现场不会直接用原始CAN帧——工程师们需要**协议**。CANopen是工业自动化领域最常用的高层协议，全球数百万台伺服驱动器、变频器、I/O模块都在用它。

本节深入CANopen最核心的两个通信对象：**PDO（实时过程数据）**和**SDO（参数配置与诊断）**。理解它们的区别与配合，是调试任何CANopen系统的基本功。最后你会看到如何用**CANopenNode**在Linux上搭建完整的控制节点，并以**汇川SV660N伺服驱动器**为例实现一个完整的位置控制闭环。

<br>

---

## <span class="blue"> 知识点335：PDO — 实时过程数据对象 [E][M]

### 为什么需要PDO？

想象一下流水线上的伺服电机：控制器每1毫秒就要下发目标位置，同时电机每1毫秒要反馈实际位置。如果用SDO（请求-应答）模式，一来一回至少2-3个CAN帧，还要等确认，带宽浪费严重。

PDO就是为了这种**高速、周期性、无需确认**的数据传输而生。一个PDO帧最高8字节数据，没有握手开销，发出去对方立刻用。

<br>

### PDO的方向：TPDO vs RPDO

| 方向 | 名称 | 数据流向 | 数量 | 典型用途 |
|:---:|:---:|:---:|:---:|:---|
| 发送 | TPDO | 从设备 → 主设备/总线 | 4路（TPDO1-4） | 实际位置、实际速度、状态字、转矩反馈 |
| 接收 | RPDO | 主设备 → 从设备 | 4路（RPDO1-4） | 目标位置、目标速度、控制字、转矩设定 |

每路PDO有独立的COB-ID。TPDO1/RPDO1优先级最高（COB-ID最小），一般用于最频繁的数据。TPDO4/RPDO4可以配置给不那么急的数据，比如温度或报警信息。

<br>

### PDO触发方式

PDO什么时候发送？CANopen定义了两种大类：**同步触发**和**异步触发**。

```
┌─────────────────────────────────────────────────────────────┐
│                     PDO 触发方式全景图                        │
├───────────────────┬─────────────────────────────────────────┤
│   同步 (SYNC)      │   异步 (ASYNC)                           │
├───────────────────┼─────────────────────────────────────────┤
│ • SYNC报文广播     │ • 事件触发 (Event)                       │
│   主站周期性发送   │   数据变化超过阈值时发送                 │
│   SYNC(0x80)       │   适合：开关量、报警信号                 │
│                    │                                         │
│ • 每个SYNC到来，   │ • 定时触发 (Timer)                       │
│   已使能的TPDO发送 │   固定间隔发送，不管数据是否变化         │
│                    │   适合：温度、慢变量                     │
├───────────────────┴─────────────────────────────────────────┤
│  同步传输类型码 (TPDO通信参数 0x1800+ 子索引2)               │
│  0:  非同步（保留）                                          │
│  1-240: 每N个SYNC周期发送一次                                │
│  254: 事件驱动                                              │
│  255: 事件或定时驱动（厂商定义）                             │
└─────────────────────────────────────────────────────────────┘
```

**同步模式的典型场景**：运动控制。主站每1ms发一个SYNC，所有伺服在SYNC到来时同步采样、同步输出，实现多轴严格同步。

**异步模式的典型场景**：温度监控。电机温度不会突变，设置事件阈值（如变化1度才发），能大幅降低总线负载。

<br>

### PDO Mapping：把对象字典"打包"进PDO

PDO的精髓在于**Mapping（映射）**。你可以把对象字典（OD）中的任意条目"打包"进一个PDO的8字节数据区里。

汇川SV660N伺服的典型PDO Mapping配置如下：

| 数据项 | OD索引 | 子索引 | 大小 | PDO方向 |
|:---:|:---:|:---:|:---:|:---:|
| 控制字 | 0x6040 | 0x00 | 16bit | RPDO1 |
| 目标位置 | 0x607A | 0x00 | 32bit | RPDO1 |
| 目标速度 | 0x60FF | 0x00 | 32bit | RPDO2 |
| 状态字 | 0x6041 | 0x00 | 16bit | TPDO1 |
| 实际位置 | 0x6064 | 0x00 | 32bit | TPDO1 |
| 实际速度 | 0x606C | 0x00 | 32bit | TPDO2 |

> ⚠️ **陷阱**：PDO数据采用**Motorola Big-endian**格式！对象字典中0x6064（实际位置）是32位有符号整数，映射到PDO字节0-3时，高位字节在前。如果你用Intel小端处理器直接memcpy，位置值会完全错乱！
>
> 正确做法：必须使用协议栈提供的`CO_setUint32()`/`CO_getUint32()`等大端转换函数，或者手动做字节序交换。

一个完整的TPDO1帧示例（8字节）：

```
CAN帧ID: 0x180+NodeID (如NodeID=1 → 0x181)
数据:    [0x37, 0x02, 0xA8, 0x61, 0x00, 0x00, 0x00, 0x00]
         │状态字低 │状态字高 │ 实际位置（32位大端）      │
         0x0237 = 状态字（伺服运行中，目标到达）
         0x000061A8 = 25000 counts
```

<br>

### PDO配置流程

使能PDO不是自动的，需要四步：

```
Step 1: 配置RPDO/TPDO的Communication Parameter
        → 0x1400-0x1403 (RPDO1-4通信参数)
        → 0x1800-0x1803 (TPDO1-4通信参数)
        设置COB-ID、传输类型、抑制时间

Step 2: 配置RPDO/TPDO的Mapping Parameter
        → 0x1600-0x1603 (RPDO1-4映射参数)
        → 0x1A00-0x1A03 (TPDO1-4映射参数)
        写入映射的OD索引、子索引、位长度
        （必须先禁用PDO，number_of_entries写0）

Step 3: 写number_of_entries，确认映射条目数

Step 4: 使能PDO（COB-ID的bit31清0）
        → PDO开始按配置传输
```

这四步全部通过**SDO**完成（马上讲到），这就是SDO和PDO的经典配合：SDO负责"配置管道"，PDO负责"管道里跑数据"。

<br>

---

## <span class="blue"> 知识点336：SDO — 服务数据对象 [E][M]

### SDO的角色

如果说PDO是"高速公路上的货车"，SDO就是"维修工的工具箱"。SDO用于：

- 设备初次上电时的参数配置（PDO映射、波特率、节点ID）
- 运行时读取诊断信息（错误历史、温度、累计运行时间）
- 固件升级（把新程序写入设备Flash）
- 设备状态切换（NMT命令本质上也是通过SDO风格的机制）

<br>

### SDO的两种方向

| 方向 | CANopen术语 | 操作 | 发起方 |
|:---:|:---:|:---:|:---:|
| 读 | Upload | 从设备OD读取数据到主站 | 主站 |
| 写 | Download | 从主站写入数据到设备OD | 主站 |

> 注意：Upload/Download是从**主站视角**命名的。Upload = 从设备上传数据到主站。初学者容易搞反。

<br>

### SDO传输类型

SDO有三种传输方式，根据数据量自动选择：

| 传输类型 | 最大数据量 | 使用场景 | CAN帧数量 |
|:---:|:---:|:---|:---:|
| **Expedited**（加速） | ≤4字节 | 读/写单个参数（状态字、控制字、温度值） | 2帧（请求+应答） |
| **Segmented**（分段） | ≤4GB | 读/写字符串、数组、较长配置块 | 2+N帧（握手+分段传输） |
| **Block**（块传输） | ≤4GB | 固件升级、大批量数据Dump | 最少，一次确认多个块 |

**Expited传输**（4字节以内）的典型交互：

```
主站 → 从站:  0x603 + NodeID  (SDO请求)
              数据[0x2F, 0x40, 0x60, 0x00, 0x0F, 0x00, 0x00, 0x00]
              │命令│  索引 │子索│     数据(4字节)     │
              0x2F = 写1字节 expedited
              0x6040 = 控制字OD索引
              0x00 = 子索引
              0x000F = 数据（Shutdown命令）

从站 → 主站:  0x583 + NodeID  (SDO应答)
              数据[0x60, 0x40, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00]
              0x60 = 成功响应码
              索引和子索引回声确认
```

**Segmented传输**（超过4字节）的典型交互：

```
阶段1 - 初始化握手（2帧）
主站: 请求下载/上传，指明总数据长度
从站: 确认或拒绝

阶段2 - 分段传输（N帧）
主站 → 从站: 数据段1 + toggle-bit(0)
从站 → 主站: 确认 + toggle-bit(0)
主站 → 从站: 数据段2 + toggle-bit(1)
从站 → 主站: 确认 + toggle-bit(1)
...交替直到传输完成
```

toggle-bit的设计是为了确保分段传输的顺序可靠。如果主机发了toggle=0的帧但没收到确认，会重发同一帧，从机通过toggle-bit检测重复。

<br>

### PDO vs SDO 全面对比

| 对比维度 | PDO | SDO | 说明 |
|:---:|:---:|:---:|:---|
| **实时性** | 高（无确认） | 低（请求-应答） | PDO适合闭环控制 |
| **数据量** | 最多8字节/帧 | 最多4GB | SDO适合大参数块 |
| **可靠性** | 不保证送达 | 逐帧确认 | SDO保证配置写入成功 |
| **方向** | 单向广播 | 点对点 | PDO可被多个节点接收 |
| **配置复杂度** | 需先SDO配置Mapping | 直接使用OD索引 | 经典"鸡生蛋"问题 |
| **典型周期** | 125μs ~ 10ms | 非周期，按需 | |
| **总线负载** | 可控（固定周期） | 突发高负载 | 大量SDO会挤占PDO带宽 |

<br>

---

## <span class="blue"> 知识点337：Linux CANopen — CANopenNode框架 [E]

### 为什么不用裸SocketCAN？

直接用SocketCAN收发CAN帧当然可行，但你得自己：

- 解析/组装每个SDO帧的8字节格式（命令字节、索引、子索引、数据）
- 处理分段传输的toggle-bit和重传逻辑
- 维护对象字典的数据结构和一致性
- 实现NMT状态机、心跳报文、PDO映射和SYNC处理
- 处理CAN错误恢复、节点守护、紧急报文

这相当于自己实现TCP/IP协议栈——能写，但没必要。CANopenNode帮你把这些都做好了。

<br>

### CANopenNode架构

```
┌──────────────────────────────────────────────┐
│           应用程序层                          │
│  (位置控制算法 / 状态机 / 设备逻辑)           │
├──────────────────────────────────────────────┤
│           CANopen 核心层                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │   NMT   │ │  Heartbeat │ │  SYNC   │       │
│  │ 管理    │ │  心跳     │ │ 同步    │        │
│  └─────────┘ └─────────┘ └─────────┘        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │   SDO   │ │   PDO   │ │Emergency│        │
│  │ 服务端  │ │ TPDO/RPDO│ │ 紧急报文 │       │
│  │ 客户端  │ │         │ │         │        │
│  └─────────┘ └─────────┘ └─────────┘        │
├──────────────────────────────────────────────┤
│           对象字典 (OD)                       │
│  ┌──────────────────────────────────────┐   │
│  │  自动生成的 OD 结构体 (C代码)         │   │
│  │  包含所有COB-ID、映射、默认值          │   │
│  └──────────────────────────────────────┘   │
├──────────────────────────────────────────────┤
│           CAN驱动适配层                       │
│  (SocketCAN接口 / CAN帧收发缓冲区)            │
├──────────────────────────────────────────────┤
│           Linux SocketCAN                     │
│  (can0 → 物理CAN控制器 → 总线)               │
└──────────────────────────────────────────────┘
```

CANopenNode用纯C编写，零依赖（除SocketCAN外），可以在Linux、RT-Linux、甚至裸机上运行。它是开源的，GitHub上有活跃的维护。

<br>

### 对象字典编辑器 objdictedit

CANopenNode最省心的地方是**对象字典自动生成**。你不需要手写那个巨大的OD结构体。

**objdictedit**是一个Python GUI工具（在CANopenNode源码的`objdictgen/`目录下），操作步骤：

```bash
# 1. 安装依赖
cd CANopenNode/objdictgen
pip install -r requirements.txt

# 2. 启动编辑器
python objdictedit.py

# 3. GUI操作
#    File → New → 选择设备模板（如DS301_slave）
#    在对象字典树中：
#    - 右键 → Add → 添加自定义对象
#    - 双击 → 修改索引、类型、默认值、PDO映射权限
#    - 勾选 "PDO mapping" 让条目可被映射到PDO

# 4. 导出
gcc → my_project/OD.c    # 自动生成OD结构体
```

> 💡 **提示**：objdictedit也可以打开设备厂商提供的EDS文件（电子数据表），直接导入设备的完整对象字典定义。汇川SV660N的EDS文件可以从官网下载，导入后能看到每个OD条目的详细说明。

<br>

---

## <span class="blue"> 行业实例：汇川SV660N伺服驱动器CANopen控制

### 硬件接线

```
┌─────────────────┐                  ┌──────────────────┐
│   Linux工控机    │                  │  汇川 SV660N     │
│  (CANopen主站)   │                  │  (CANopen从站)   │
│                 │                  │                  │
│  can0 (SocketCAN)│                  │  CN3 (CAN_H/L)   │
│  接线:           │                  │                  │
│  CAN_H  ────────┼──────────────────┤ CAN_H            │
│  CAN_L  ────────┼──────────────────┤ CAN_L            │
│  GND    ────────┼──────────────────┤ GND              │
│                 │                  │                  │
│  USB转CAN适配器  │    终端电阻      │  内置120Ω终端    │
│  或原生CAN口    │    120Ω两端      │  拨码开关使能    │
└─────────────────┘                  └──────────────────┘

NodeID设置: SV660N前面板拨码开关
SW1/SW2 = ON, SW3-SW8 = NodeID二进制码
例如 NodeID=1: SW3=ON, SW4-SW8=OFF

波特率: 对象字典0x2001设置，默认1Mbps
```

<br>

### 控制流程

```
┌────────────────────────────────────────────────────────────┐
│                     位置控制完整流程                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. NMT启动                                                │
│     主站 → 0x000: [0x01, 0x01]  (Start Remote Node, ID=1) │
│     从站 → 状态: Pre-Operational → Operational             │
│                                                            │
│  2. PDO映射配置 (通过SDO)                                   │
│     ┌─────────────────────────────────────────────┐       │
│     │ RPDO1: 0x6040(控制字) + 0x607A(目标位置)    │       │
│     │ TPDO1: 0x6041(状态字) + 0x6064(实际位置)    │       │
│     └─────────────────────────────────────────────┘       │
│                                                            │
│  3. 状态机切换 (CiA-402)                                   │
│     写 0x6040: 0x0006 → 0x0007 → 0x000F                   │
│     (Shutdown → Switch On → Enable Operation)              │
│                                                            │
│  4. 位置控制循环 (1ms周期)                                  │
│     ┌────────┐    RPDO1     ┌────────┐    TPDO1     ┌───┐ │
│     │ 主站    │ ────────────→│ 伺服   │ ────────────→│主站│ │
│     │ 目标位  │  (0x607A)    │ 执行   │  (0x6064)    │反馈│ │
│     └────────┘              └────────┘              └───┘ │
│                                                            │
│  5. 急停处理                                               │
│     写 0x6040: 0x0002 (Quick Stop)                        │
│     读 0x603F 确认错误码                                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

<br>

### CANopenNode对象字典配置

```c
/*
 * 对象字典关键条目 — 汇川SV660N伺服控制
 * 由 objdictedit 生成的 OD.c 片段
 */

/* 0x1400 - RPDO1 通信参数 */
OD_ENTRY_t OD_entry_RPDO1_communication = {
    .index = 0x1400,
    .subIndex = 2,              /* transmission_type */
    .attribute = ODA_SDO_RW,
    .dataLength = 1,
    .pData = &RPDO1_trans_type  /* =1: 每个SYNC触发一次 */
};

/* 0x1600 - RPDO1 映射参数 (2个条目，共6字节) */
OD_entry_t OD_entry_RPDO1_mapping[] = {
    {   /* 映射条目1: 控制字 0x6040, 16bit */
        .index = 0x1600, .subIndex = 1,
        .attribute = ODA_SDO_RW,
        .dataLength = 4,
        .pData = &(uint32_t)0x60400010  /* index=0x6040, sub=0x00, len=16bit */
    },
    {   /* 映射条目2: 目标位置 0x607A, 32bit */
        .index = 0x1600, .subIndex = 2,
        .attribute = ODA_SDO_RW,
        .dataLength = 4,
        .pData = &(uint32_t)0x607A0020  /* index=0x607A, sub=0x00, len=32bit */
    },
    {   /* 映射条目数 */
        .index = 0x1600, .subIndex = 0,
        .attribute = ODA_SDO_RW,
        .dataLength = 1,
        .pData = &(uint8_t)2  /* 2个映射条目 */
    }
};

/* 0x1A00 - TPDO1 映射参数 (2个条目，共6字节) */
OD_entry_t OD_entry_TPDO1_mapping[] = {
    {   /* 映射条目1: 状态字 0x6041, 16bit */
        .index = 0x1A00, .subIndex = 1,
        .pData = &(uint32_t)0x60410010  /* index=0x6041, sub=0x00, len=16bit */
    },
    {   /* 映射条目2: 实际位置 0x6064, 32bit */
        .index = 0x1A00, .subIndex = 2,
        .pData = &(uint32_t)0x60640020  /* index=0x6064, sub=0x00, len=32bit */
    }
};

/* 0x6040 - 控制字 (RPDO映射) */
OD_entry_t OD_entry_control_word = {
    .index = 0x6040, .subIndex = 0x00,
    .attribute = ODA_SDO_RW | ODA_RPDO_MAP,
    .dataLength = 2,
    .pData = &control_word  /* uint16_t */
};

/* 0x607A - 目标位置 (RPDO映射) */
OD_entry_t OD_entry_target_position = {
    .index = 0x607A, .subIndex = 0x00,
    .attribute = ODA_SDO_RW | ODA_RPDO_MAP,
    .dataLength = 4,
    .pData = &target_position  /* int32_t */
};

/* 0x6064 - 实际位置 (TPDO映射) */
OD_entry_t OD_entry_actual_position = {
    .index = 0x6064, .subIndex = 0x00,
    .attribute = ODA_SDO_R | ODA_TPDO_MAP,
    .dataLength = 4,
    .pData = &actual_position  /* int32_t */
};
```

<br>

### NMT启动 + 位置控制循环（完整C代码）

```c
/*
 * canopen_servo_control.c
 * 基于 CANopenNode + SocketCAN 控制汇川SV660N伺服
 * 
 * 编译: gcc -o canopen_servo canopen_servo_control.c \
 *           -I/path/to/CANopenNode \
 *           /path/to/CANopenNode/CO_driver.c \
 *           /path/to/CANopenNode/stack/*.c \
 *           -lpthread
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <signal.h>
#include <sys/socket.h>
#include <linux/can.h>
#include <linux/can/raw.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include "CANopen.h"

/* ===== 配置参数 ===== */
#define SERVO_NODE_ID       1       /* 伺服节点ID */
#define CAN_INTERFACE       "can0"  /* SocketCAN接口 */
#define SYNC_INTERVAL_US    1000    /* SYNC周期: 1ms = 1000Hz */
#define POSITION_RANGE      100000  /* 目标位置范围: ±100000 counts */

/* CiA-402 控制字命令 */
#define CW_SHUTDOWN         0x0006
#define CW_SWITCH_ON        0x0007
#define CW_ENABLE_OP        0x000F
#define CW_QUICK_STOP       0x0002
#define CW_DISABLE          0x0000

/* 全局变量 */
static CO_t *CO = NULL;
static volatile int g_running = 1;
static int32_t g_actual_position = 0;
static uint16_t g_status_word = 0;

/* 信号处理 */
static void sig_handler(int sig)
{
    (void)sig;
    g_running = 0;
}

/* ===== 线程1: CAN接收线程 ===== */
static void *thread_receive(void *arg)
{
    (void)arg;
    struct can_frame frame;
    
    while (g_running) {
        /* 从SocketCAN读取帧 */
        int nbytes = read(CO->CANmodule->fd, &frame, sizeof(frame));
        if (nbytes < 0) {
            usleep(100);
            continue;
        }
        
        /* 交给CANopenNode协议栈处理 */
        CO_CANreceive(CO->CANmodule, &frame);
        
        /* 检查是否有TPDO数据更新 */
        /* CANopenNode会在回调中更新OD变量 */
    }
    return NULL;
}

/* ===== 线程2: SYNC发送线程 ===== */
static void *thread_sync(void *arg)
{
    (void)arg;
    struct can_frame sync_frame = {
        .can_id = 0x080,    /* SYNC COB-ID */
        .can_dlc = 0,       /* SYNC无数据 */
    };
    
    while (g_running) {
        /* 发送SYNC报文，触发所有同步PDO传输 */
        write(CO->CANmodule->fd, &sync_frame, sizeof(sync_frame));
        usleep(SYNC_INTERVAL_US);
    }
    return NULL;
}

/* ===== 主函数 ===== */
int main(int argc, char **argv)
{
    pthread_t tid_rx, tid_sync;
    CO_ReturnError_t err;
    uint32_t heapMemoryUsed;
    CO_NMT_reset_cmd_t reset = CO_RESET_NOT;
    
    (void)argc; (void)argv;
    
    printf("=== SV660N CANopen 位置控制演示 ===\n");
    
    /* 捕获Ctrl+C */
    signal(SIGINT, sig_handler);
    
    /* 步骤1: 初始化CANopen协议栈 */
    err = CO_init(CO, 0, SERVO_NODE_ID);  /* 0=第一个CAN口 */
    if (err != CO_ERROR_NO) {
        fprintf(stderr, "CANopen初始化失败: %d\n", err);
        return 1;
    }
    printf("[1/5] CANopen协议栈初始化完成\n");
    
    /* 步骤2: 设置CAN波特率1Mbps并启动 */
    CO_CANsetBitrate(CO->CANmodule, 1000000);  /* 1Mbps */
    CO_CANmodule_enable(CO->CANmodule);
    printf("[2/5] CAN接口 %s @ 1Mbps 已启动\n", CAN_INTERFACE);
    
    /* 步骤3: NMT启动伺服 (发送NMT Start Remote Node) */
    CO_sendNMTcommand(CO, CO_NMT_ENTER_OPERATIONAL, SERVO_NODE_ID);
    printf("[3/5] NMT: 节点%d已进入Operational模式\n", SERVO_NODE_ID);
    sleep(1);  /* 等待状态切换 */
    
    /* 步骤4: 配置PDO映射 (通过SDO预配置，实际项目中可通过objdictedit生成) */
    /* 这里假设OD已在初始化时配置好映射关系 */
    printf("[4/5] PDO映射已配置 (RPDO1:控制字+目标位置, TPDO1:状态字+实际位置)\n");
    
    /* 创建接收和SYNC线程 */
    pthread_create(&tid_rx, NULL, thread_receive, NULL);
    pthread_create(&tid_sync, NULL, thread_sync, NULL);
    
    /* 步骤5: CiA-402状态机切换 → 使能伺服 */
    /* 注意: 实际的控制字写入需要通过RPDO或SDO */
    /* 这里使用SDO方式演示状态机切换 */
    
    CO_ODF_t *OD_control_word = CO_findOD(CO, 0x6040);
    CO_ODF_t *OD_status_word  = CO_findOD(CO, 0x6041);
    CO_ODF_t *OD_target_pos   = CO_findOD(CO, 0x607A);
    CO_ODF_t *OD_actual_pos   = CO_findOD(CO, 0x6064);
    
    /* 状态机: Shutdown → Switch On → Enable Operation */
    printf("[5/5] CiA-402状态机切换...\n");
    
    /* Shutdown */
    *(uint16_t *)OD_control_word->pData = CW_SHUTDOWN;
    CO_process(CO, SYNC_INTERVAL_US, NULL);
    usleep(500000);
    printf("      → Shutdown (0x%04X)\n", CW_SHUTDOWN);
    
    /* Switch On */
    *(uint16_t *)OD_control_word->pData = CW_SWITCH_ON;
    CO_process(CO, SYNC_INTERVAL_US, NULL);
    usleep(500000);
    printf("      → Switch On (0x%04X)\n", CW_SWITCH_ON);
    
    /* Enable Operation */
    *(uint16_t *)OD_control_word->pData = CW_ENABLE_OP;
    CO_process(CO, SYNC_INTERVAL_US, NULL);
    usleep(500000);
    printf("      → Enable Operation (0x%04X) ✓\n", CW_ENABLE_OP);
    
    printf("\n=== 位置控制循环启动 (1kHz, Ctrl+C退出) ===\n");
    
    /* ===== 主控制循环 ===== */
    int cycle = 0;
    int32_t target_pos = 0;
    
    while (g_running) {
        /* 生成正弦波目标位置 */
        /* 注意: 单位是counts，取决于SV660N编码器分辨率 */
        /* SV660N 17位编码器: 131072 counts/rev */
        /* 先用SDO读0x6064确认单位和当前零点位置! */
        target_pos = (int32_t)(50000.0 * sin(2.0 * M_PI * cycle / 1000.0));
        
        /* 写入目标位置 → 通过RPDO1自动发送 */
        *(int32_t *)OD_target_pos->pData = target_pos;
        
        /* 触发PDO发送 */
        CO_process(CO, SYNC_INTERVAL_US, NULL);
        
        /* 读取实际位置反馈 (TPDO1更新) */
        g_actual_position = *(int32_t *)OD_actual_pos->pData;
        g_status_word = *(uint16_t *)OD_status_word->pData;
        
        /* 每100ms打印一次 */
        if (cycle % 100 == 0) {
            printf("[Cycle %6d] 目标位置: %8d | 实际位置: %8d | "
                   "状态字: 0x%04X | 跟随误差: %d\n",
                   cycle, target_pos, g_actual_position, g_status_word,
                   target_pos - g_actual_position);
            
            /* 检查伺服报警 */
            if ((g_status_word & 0x0008) != 0) {  /* Fault位 */
                fprintf(stderr, "⚠ 伺服报警！状态字=0x%04X\n", g_status_word);
                break;
            }
        }
        
        cycle++;
        usleep(SYNC_INTERVAL_US);
    }
    
    /* ===== 优雅退出 ===== */
    printf("\n=== 停止伺服 ===\n");
    
    /* Quick Stop */
    *(uint16_t *)OD_control_word->pData = CW_QUICK_STOP;
    CO_process(CO, SYNC_INTERVAL_US, NULL);
    usleep(500000);
    
    /* Disable */
    *(uint16_t *)OD_control_word->pData = CW_DISABLE;
    CO_process(CO, SYNC_INTERVAL_US, NULL);
    
    /* NMT Stop */
    CO_sendNMTcommand(CO, CO_NMT_ENTER_PRE_OPERATIONAL, SERVO_NODE_ID);
    
    g_running = 0;
    pthread_join(tid_rx, NULL);
    pthread_join(tid_sync, NULL);
    
    CO_delete(CO);
    printf("已安全关闭。\n");
    
    return 0;
}
```

<br>

### 调试命令

```bash
# ===== 1. 查看CAN总线原始帧 =====
# 开启新终端，实时监控
$ candump can0

# 预期输出（位置控制运行时）：
# can0  000   [2]  01 01              ← NMT启动节点1
# can0  081   [0]                      ← SYNC报文
# can0  201   [6]  0F 00 10 27 00 00  ← RPDO1: 控制字0x0F + 目标位置0x2710(10000)
# can0  181   [6]  37 02 08 27 00 00  ← TPDO1: 状态字 + 实际位置反馈
# can0  181   [6]  37 02 0F 27 00 00  ← TPDO1: 实际位置持续变化...

# ===== 2. 手动发送SDO读取 =====
# 读取实际位置 0x6064
cansend can0 601#4064600000000000

# 读取状态字 0x6041
cansend can0 601#4060410000000000

# 读取编码器分辨率（counts/rev）0x608F sub1
cansend can0 601#408F600100000000

# ===== 3. 使用CANopenNode工具 =====
# 读取对象字典
co_canopen -i can0 -n 1 -r 0x6064 0
# 输出: 0x6064[0x00] = 0x00002710 (10000)

# 写入目标位置
co_canopen -i can0 -n 1 -w 0x607A 0 0x00004E20

# ===== 4. 查看CAN总线统计 =====
ip -s link show can0
# 会看到RX/TX帧计数、错误计数

# ===== 5. 检测总线负载 =====
candump can0 -t z -c 1000 | tail -1
# 统计1000帧的时间，推算总线负载百分比

# ===== 6. 示波器调试要点 =====
# • CH1: CAN_H, CH2: CAN_L → 差分信号幅值应为2V
# • 检查位时间: 1Mbps = 1μs/bit
# • SYNC报文(0x080)应严格等间隔
# • TPDO1和RPDO1应在SYNC后几μs内出现
```

<br>

### TPDO/RPDO 配置速查表

| PDO | COB-ID | OD通信参数 | OD映射参数 | 本例映射内容 | 触发方式 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| RPDO1 | 0x200 + NodeID | 0x1400 | 0x1600 | 控制字(16bit) + 目标位置(32bit) | SYNC同步 |
| RPDO2 | 0x300 + NodeID | 0x1401 | 0x1601 | 目标速度(32bit) | 未使用 |
| TPDO1 | 0x180 + NodeID | 0x1800 | 0x1A00 | 状态字(16bit) + 实际位置(32bit) | SYNC同步 |
| TPDO2 | 0x280 + NodeID | 0x1801 | 0x1A01 | 实际速度(32bit) | 未使用 |

<br>

---

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|:---|:---|
| **PDO本质** | 高速、无确认的周期性数据通道，最多8字节/帧，适合实时控制 |
| **TPDO/RPDO** | 4路发送/4路接收，独立COB-ID，TPDO1/RPDO1优先级最高 |
| **触发方式** | 同步(SYNC)用于多轴同步运动，异步(事件/定时)用于慢变量监控 |
| **PDO Mapping** | 将OD条目映射到PDO字节，8字节内自由组合；注意**大端字节序** |
| **SDO本质** | 请求-应答式参数通道，可靠但慢，用于配置和诊断 |
| **SDO传输类型** | Expedited(≤4B)最常用，Segmented用于长数据，Block用于固件升级 |
| **SDO/PDO配合** | SDO"铺设管道"（配置映射），PDO"管道跑数据"（实时传输） |
| **CANopenNode** | Linux下开源CANopen协议栈，objdictedit生成OD，SocketCAN驱动 |
| **调试顺序** | candump看原始帧 → 确认NMT状态 → 检查PDO Mapping → SDO读单位 → 启动控制 |

<br>

---

## <span class="blue"> 下一步

CANopen的PDO/SDO机制在工业自动化中已经非常成熟，但当系统需要**更高的带宽**和**亚微秒级同步精度**时，CAN总线本身的物理层成为瓶颈。

在下一节**`B-D.12.2 EtherCAT协议深度解析`**中，你将了解到：
- **EtherCAT**如何用"飞读飞写"机制实现1000轴同步
- 分布式时钟（DC）如何做到50ns的同步精度
- Linux下的IgH EtherCAT Master配置
- 同样是汇川伺服，EtherCAT版本（SV660P）与CANopen版本有何异同

<br>

---

## <span class="blue"> 配套资源

**参考阅读**：
- CiA 301: CANopen Application Layer and Communication Profile
- CiA 402: CANopen Device Profile for Drives and Motion Control
- CANopenNode GitHub: https://github.com/CANopenNode/CANopenNode
- 汇川SV660N用户手册 — CANopen通信篇

**推荐工具**：

| 工具 | 用途 | 获取方式 |
|:---|:---|:---|
| `can-utils` (candump/cansend) | CAN帧监控与发送 | apt install can-utils |
| `objdictedit` | 对象字典可视化编辑 | CANopenNode源码 |
| `Wireshark` | CANopen协议解析 | apt install wireshark |
| `CANalyzer` (Vector) | 专业CANopen分析 | 商业软件，评估版可用 |
| `BUSMASTER` | 开源CAN总线分析 | SourceForge免费下载 |

**延伸阅读**：
- 本节示例完整代码：`examples/canopen_sv660n/` 目录
- CiA-402状态机详解：见**B-D.11.6 CiA-402运动控制状态机**
- CANopen Bootloader固件升级：见**B-D.11.7 CANopen网络管理与诊断**
