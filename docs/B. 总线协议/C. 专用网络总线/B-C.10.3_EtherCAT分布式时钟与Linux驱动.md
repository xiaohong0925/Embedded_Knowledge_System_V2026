# B-C.10.3 EtherCAT分布式时钟与Linux驱动

> 所属章节：第五部 B. 总线协议 > B-C.10 EtherCAT工业以太网
>
> 难度：[E] Expert / [M] Master | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

上一节我们了解了EtherCAT的"飞读飞写"数据帧如何在百微秒内遍历整个从站网络。但工业控制有个更苛刻的需求——**多轴同步**。想象一下六轴机械臂的六个关节，如果关节1在t时刻收到指令，关节6却在t+500us才收到，机械臂的运动轨迹就会偏离预期，严重时甚至损坏设备。EtherCAT的**分布式时钟（Distributed Clock, DC）** 机制正是为了解决这个问题而生，它能将数十个从站的时钟同步到**100纳秒以内**。本节将深入DC的同步原理，并结合Linux平台上最常用的**IgH EtherCAT Master**开源协议栈，展示如何在6轴机械臂上实现1kHz的PDO周期同步控制。

<br>

## <span class="blue"> 知识点342 分布式时钟（DC）机制 [E][M]

EtherCAT的分布式时钟是整个协议中最精妙的设计之一。它让分散在网络各处的从站共享同一个"心跳节拍"，就像交响乐团中所有乐手都看着同一个指挥。

<br>

### DC同步的核心问题

在一个EtherCAT网络中，每个从站都有自己的本地时钟（通常由本地晶振驱动）。由于晶振存在ppm级的频率偏差，如果不加校正，两个从站的时钟每天可能偏差数毫秒。对于需要微秒级协同的多轴系统，这完全不可接受。

DC要解决的三个核心问题：

1. **时钟偏移（Offset）**：各从站启动时的初始时间不同
2. **时钟漂移（Drift）**：各从站晶振频率存在微小差异，导致长期累积误差
3. **传播延迟（Propagation Delay）**：同步信号在线缆中传输需要时间

<br>

### DC工作原理：从站时钟驯服术

DC同步的过程可以分为**初始化阶段**和**运行阶段**，理解这个流程是调试DC问题的基础。

**初始化阶段——三步走：**

```
Step 1: 延迟测量
═══════════════════════════════════════════════════════════════════
主站发送广播帧（ARMW = Auto Repeat Master Watchdog）
        │
        ▼
   ┌─────────┐    记录 t1（帧离开ESC的时间戳）
   │ ESC #1  │─────────────────────────────────────────┐
   └─────────┘                                         │
        │ 转发帧                                        │
        ▼                                               │
   ┌─────────┐    记录 t2（帧离开ESC的时间戳）         │
   │ ESC #2  │─────────────────────────────────────────┤
   └─────────┘                                         │
        │  转发帧                                       │
        ▼          ...                                回环
   ┌─────────┐                                         │
   │ ESC #N  │    记录 tN                              │
   └─────────┘─────────────────────────────────────────┘
        │
        ▼（帧从最后一个从站返回）
   主站收集所有 t1, t2, ... tN

Step 2: 计算各从站相对于参考时钟的偏移
   offset[i] = t[i] - t[ref] - propagation_delay[i]

Step 3: 将计算好的偏移写入各从站的DC寄存器
   ESC #1: System Time Offset ← offset[1]
   ESC #2: System Time Offset ← offset[2]
   ...
```

**运行阶段——持续微调：**

```
每个周期（如1ms）重复：
═══════════════════════════════════════════════════════════════════
1. 主站读取各从站的当前本地时间（通过寄存器0x0910-0x0917）
2. 与参考时钟比较，计算漂移量
3. 使用PI控制器计算补偿值
4. 将补偿值写入各从站的 System Time Offset 寄存器
5. 从站硬件自动将补偿值加到后续时间戳上
```

> 💡 **提示**：ARMW（Auto Repeat Master Watchdog）是EtherCAT的一种特殊读写命令，帧在穿过每个从站时会被自动复制到回环帧中，主站一次就能收集所有从站的时间戳，效率极高。

<br>

### DC同步参数详解

| 参数 | 功能 | 典型值 | 说明 |
|:-----|:-----|:-------|:-----|
| Cycle Time | DC同步周期 | 1000μs (1kHz) | 所有从站以此周期执行控制任务 |
| Shift Time | 同步偏移时间 | 0μs ~ Cycle Time/2 | 从站中断相对于周期起始的偏移，避免所有从站同时触发 |
| Reference Clock | 参考时钟从站 | 首个从站或主站 | 网络中所有从站以此时钟为基准 |
| Propagation Delay | 传播延迟补偿 | 自动测量（ns级） | 主站初始化时测量并自动补偿 |
| Drift Compensation | 漂移补偿PI参数 | Kp=50, Ki=1 | 控制收敛速度和稳态精度 |
| Sync Window | 同步窗口容差 | ±100ns | 超出此范围标记为同步错误 |
| PLL Bandwidth | 锁相环带宽 | 0.1Hz ~ 10Hz | 越低跟踪越慢但越稳定 |

<br>

### PDO与SDO：实时与非实时双通道

EtherCAT定义了两类数据传输机制，分别对应实时控制和非实时配置：

**PDO（Process Data Object）——实时周期性数据：**

| 特性 | 说明 |
|:-----|:-----|
| 传输时机 | 每个EtherCAT周期自动交换，无需额外协议开销 |
| 数据内容 | 实时控制量：目标位置、目标速度、力矩指令、实际控制字 |
| 数据方向 | RPDO（Receive PDO）：主站→从站；TPDO（Transmit PDO）：从站→主站 |
| 性能 | 全双工，周期抖动<1μs |
| 映射方式 | 通过对象字典条目映射到帧的特定字节偏移 |

**SDO（Service Data Object）——非实时配置数据：**

| 特性 | 说明 |
|:-----|:-----|
| 传输时机 | 按需发起，类似"邮箱通信" |
| 数据内容 | 参数设置、诊断信息、固件升级数据 |
| 协议开销 | 有完整的请求-应答机制，类似TCP |
| 性能 | 毫秒级延迟，不保证实时性 |
| 典型用途 | 上电时配置PDO映射、读取错误码、修改运行参数 |

```
数据帧结构示意（每周期一次）
═══════════════════════════════════════════════════════════
┌─────────────────────────────────────────────────────────┐
│  EtherCAT Header  │  DC Sync (8 bytes)  │  PDO Data    │
│                   │  (System Time)      │  (变长)      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ RPDO Axis#1 │  │ RPDO Axis#2 │  │ ... Axis#6      │ │
│  │ 目标位置 4B │  │ 目标位置 4B │  │ 目标位置 4B     │ │
│  │ 目标速度 4B │  │ 目标速度 4B │  │ 目标速度 4B     │ │
│  │ 控制字 2B   │  │ 控制字 2B   │  │ 控制字 2B       │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ TPDO Axis#1 │  │ TPDO Axis#2 │  │ ... Axis#6      │ │
│  │ 实际位置 4B │  │ 实际位置 4B │  │ 实际位置 4B     │ │
│  │ 实际速度 4B │  │ 实际速度 4B │  │ 实际速度 4B     │ │
│  │ 状态字 2B   │  │ 状态字 2B   │  │ 状态字 2B       │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
     ↑ 每周期全双工交换，1kHz = 每秒1000次
```

<br>

## <span class="blue"> 知识点343 CoE与IgH EtherCAT Master [E]

<br>

### CoE（CANopen over EtherCAT）

CoE是EtherCAT上最常用的应用层协议，它把CANopen成熟的对象字典体系搬到了EtherCAT的高速通道上。这意味着：

- **对象字典（OD）结构完全兼容CANopen CiA 301/402标准**
- 索引范围（0x1000通信参数、0x6000设备参数等）沿用CANopen定义
- 伺服驱动器的控制逻辑（状态机、Homing模式、CSP模式等）可以直接复用

CoE在EtherCAT上的改进：

| 对比项 | CANopen (CAN总线) | CoE (EtherCAT) |
|:-------|:------------------|:---------------|
| 波特率 | 最高1Mbps | 100Mbps |
| PDO数量 | 最多4个RPDO + 4个TPDO | 无限制（取决于帧空间） |
| PDO数据量 | 每PDO最多8字节 | 每从站可达1468字节 |
| SDO机制 | CAN帧传输，块传输慢 | 邮箱传输，支持Seg/Exp/Complete |
| 节点ID | 1-127 | 自动分配（站点顺序） |

<br>

### Linux IgH EtherCAT Master

IgH EtherCAT Master是由德国IgH公司开发并开源的EtherCAT主站协议栈，是Linux平台上最成熟的选择。

**架构组成：**

```
用户空间                    内核空间
═══════════               ══════════════════════════
                          ┌─────────────────────┐
  ecrt工具集               │   ec_master.ko      │
  ├── ethercat             │   (主站核心模块)     │
  ├── ethercat slaves      │                     │
  ├── ethercat pdo         │  ┌───────────────┐  │
  ├── ethercat dc          │  │  ec_generic.ko │  │
  └── ethercat upload      │  │  (网卡驱动补丁) │  │
                          │  └───────────────┘  │
  应用程序                 │                     │
  ├── ecrt_master_create() │  ┌───────────────┐  │
  ├── ecrt_slave_config()  │  │  设备驱动      │  │
  └── ecrt_master_activate()│  │  (可选)        │  │
                          │  └───────────────┘  │
                          └─────────────────────┘
```

| IgH工具命令 | 功能 | 示例输出 |
|:------------|:-----|:---------|
| `ethercat slaves` | 列出所有从站及其状态 | `0  0:0  PREOP  +  SV660N` |
| `ethercat pdo` | 查看PDO映射配置 | 显示各从站的RPDO/TPDO条目 |
| `ethercat dc` | 查看DC同步状态 | 显示各从站的时钟偏移和漂移 |
| `ethercat upload` | 读取SDO对象字典条目 | `ethercat upload -t uint32 0x6041` |
| `ethercat download` | 写入SDO对象字典条目 | `ethercat download -t uint32 0x6040 0x000F` |
| `ethercat states` | 设置或查看主站状态 | `ethercat states OP` |
| `ethercat cstruct` | 导出从站配置为C代码结构体 | 自动生成ecrt配置代码 |
| `ethercat reg_read` | 读取ESC寄存器 | 底层调试ESC状态 |

**实时性要求：**

IgH Master的周期任务必须满足硬实时约束，这意味着：

- **必须打PREEMPT_RT实时补丁的内核**（推荐RT-PREEMPT补丁）
- 周期任务通常绑定到隔离的CPU核心（`isolcpus`）
- 使用SCHED_FIFO调度策略，优先级设为最高
- 主线程禁止发生页错误（预先锁定内存，`mlockall(MCL_CURRENT | MCL_FUTURE)`）

> ⚠️ **陷阱**：PREEMPT_RT补丁的版本必须与内核版本严格匹配。Linux 5.10需要找对应的5.10-rt补丁，混用会导致编译失败或运行时崩溃。建议直接使用内核源码中的`patch -p1 < patch-5.10.120-rt60.patch`方式打补丁。

<br>

## <span class="blue"> 行业实例：6轴机械臂EtherCAT控制

<br>

### 硬件拓扑

```
EtherCAT主站 (x86/Linux + PREEMPT_RT + IgH Master)
         │ eth0 (Intel I210 网卡, generic驱动)
         ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │ SV660N #1   │──▶│ SV660N #2   │──▶│ SV660N #3   │──▶
   │ J1: 基座    │   │ J2: 肩部    │   │ J3: 肘部    │
   │ Station 1   │   │ Station 2   │   │ Station 3   │
   └─────────────┘   └─────────────┘   └─────────────┘
                                              │
   ┌─────────────┐   ┌─────────────┐   ┌────┘
   │ SV660N #6   │◀──│ SV660N #5   │◀──│ SV660N #4   │
   │ J6: 腕旋转  │   │ J5: 腕俯仰  │   │ J4: 腕偏转   │
   │ Station 6   │   │ Station 5   │   │ Station 4   │
   └─────────────┘   └─────────────┘   └─────────────┘

线型拓扑，IN端口接上游，OUT端口接下游
线缆：标准Cat.5e以太网线，最大站间距100m（实际<10m）
```

- **主站**：x86工控机，Ubuntu 20.04 + Linux 5.10.120-rt60 + IgH Master 1.5.2
- **从站**：汇川SV660N伺服驱动器 × 6（支持DC同步，CiA 402协议栈）
- **控制周期**：1kHz（1ms周期），DC同步精度<100ns

<br>

### PDO映射配置

每个轴（从站）的PDO映射如下，数据在EtherCAT帧中的排列紧凑连续：

| 轴号 | 从站地址 | RPDO数据（主站→驱动器） | TPDO数据（驱动器→主站） | 字节偏移(帧内) |
|:-----|:---------|:------------------------|:------------------------|:---------------|
| #1 J1 | 0x1001 | 目标位置(4B) + 目标速度(4B) + 控制字(2B) = 10B | 实际位置(4B) + 实际速度(4B) + 状态字(2B) = 10B | RPDO:0, TPDO:60 |
| #2 J2 | 0x1002 | 同上 | 同上 | RPDO:10, TPDO:70 |
| #3 J3 | 0x1003 | 同上 | 同上 | RPDO:20, TPDO:80 |
| #4 J4 | 0x1004 | 同上 | 同上 | RPDO:30, TPDO:90 |
| #5 J5 | 0x1005 | 同上 | 同上 | RPDO:40, TPDO:100 |
| #6 J6 | 0x1006 | 同上 | 同上 | RPDO:50, TPDO:110 |
| **合计** | - | **60字节** | **60字节** | **帧总计: 120字节 + 协议头** |

RPDO各字段详细说明：

| RPDO字段 | OD索引 | 数据类型 | 字节数 | 功能说明 |
|:---------|:-------|:---------|:-------|:---------|
| 目标位置 | 0x607A | INT32 | 4 | 伺服目标位置（编码器计数单位） |
| 目标速度 | 0x60FF | INT32 | 4 | 伺服目标速度（计数/秒） |
| 控制字 | 0x6040 | UINT16 | 2 | 状态机控制命令（Shutdown/Switch On/Enable Operation） |

TPDO各字段详细说明：

| TPDO字段 | OD索引 | 数据类型 | 字节数 | 功能说明 |
|:---------|:-------|:---------|:-------|:---------|
| 实际位置 | 0x6064 | INT32 | 4 | 电机当前实际位置（编码器反馈） |
| 实际速度 | 0x606C | INT32 | 4 | 电机当前实际速度 |
| 状态字 | 0x6041 | UINT16 | 2 | 状态机当前状态 + 告警位 |

<br>

### IgH Master配置代码

```c
/* six_axis_ethercat.c - 6轴机械臂EtherCAT主站示例 */
#include <ecrt.h>
#include <stdio.h>
#include <stdint.h>
#include <pthread.h>
#include <time.h>
#include <mlock.h>

/* ========== 配置常量 ========== */
#define TASK_FREQUENCY      1000            /* 1kHz控制频率 */
#define CYCLE_TIME_NS       1000000         /* 1ms = 1,000,000ns */
#define NUM_AXES            6               /* 6个轴 */

/* 汇川SV660N的厂商ID和产品代码 */
#define VENDOR_INOVANCE     0x00000601      /* 汇川ESC Vendor ID */
#define PRODUCT_SV660N      0x00009201      /* SV660N Product Code */

/* 每个PDO条目的配置 */
typedef struct {
    uint16_t index;         /* OD索引 */
    uint8_t  subindex;      /* 子索引 */
    uint8_t  bit_length;    /* 位长度 */
} pdo_entry_cfg_t;

/* RPDO映射：目标位置 + 目标速度 + 控制字 */
static const pdo_entry_cfg_t rpdo_mapping[] = {
    {0x607A, 0x00, 32},    /* Target Position */
    {0x60FF, 0x00, 32},    /* Target Velocity */
    {0x6040, 0x00, 16},    /* Controlword */
};

/* TPDO映射：实际位置 + 实际速度 + 状态字 */
static const pdo_entry_cfg_t tpdo_mapping[] = {
    {0x6064, 0x00, 32},    /* Position Actual Value */
    {0x606C, 0x00, 32},    /* Velocity Actual Value */
    {0x6041, 0x00, 16},    /* Statusword */
};

/* ========== 全局变量 ========== */
static ec_master_t *master = NULL;
static ec_domain_t *domain = NULL;
static uint8_t *domain_pd = NULL;    /* 过程数据指针 */

/* 各轴的从站配置和PDO条目偏移 */
static ec_slave_config_t *sc_axes[NUM_AXES];
static unsigned int off_rpdo_pos[NUM_AXES];   /* RPDO: 目标位置偏移 */
static unsigned int off_rpdo_vel[NUM_AXES];   /* RPDO: 目标速度偏移 */
static unsigned int off_rpdo_ctl[NUM_AXES];   /* RPDO: 控制字偏移 */
static unsigned int off_tpdo_pos[NUM_AXES];   /* TPDO: 实际位置偏移 */
static unsigned int off_tpdo_vel[NUM_AXES];   /* TPDO: 实际速度偏移 */
static unsigned int off_tpdo_sta[NUM_AXES];   /* TPDO: 状态字偏移 */

/* ========== 初始化函数 ========== */

/**
 * ec_init() - 初始化EtherCAT主站和从站配置
 * 
 * 流程：创建主站 → 创建域 → 扫描配置各从站PDO映射 → 激活主站
 */
int ec_init(void)
{
    int i, j;
    ec_slave_config_t *sc;
    ec_pdo_entry_reg_t *pdo_regs;
    int reg_count = 0;
    int reg_idx = 0;

    /* 步骤1：请求主站实例（第0号主站） */
    master = ecrt_request_master(0);
    if (!master) {
        fprintf(stderr, "Failed to request EtherCAT master\n");
        return -1;
    }

    /* 步骤2：创建过程数据域（Domain）
     * 一个域就是一组需要周期性交换的PDO数据的集合 */
    domain = ecrt_master_create_domain(master);
    if (!domain) {
        fprintf(stderr, "Failed to create domain\n");
        return -1;
    }

    /* 计算PDO注册表需要的总条目数 */
    reg_count = NUM_AXES * (sizeof(rpdo_mapping)/sizeof(rpdo_mapping[0]) +
                            sizeof(tpdo_mapping)/sizeof(tpdo_mapping[0]));
    pdo_regs = calloc(reg_count + 1, sizeof(ec_pdo_entry_reg_t));

    /* 步骤3：为每个轴配置从站 */
    for (i = 0; i < NUM_AXES; i++) {
        /* 配置从站：位置(i+1)，厂商ID，产品代码 */
        sc = ecrt_master_slave_config(master, 0, i + 1,
                                      VENDOR_INOVANCE, PRODUCT_SV660N);
        if (!sc) {
            fprintf(stderr, "Failed to configure slave at position %d\n", i+1);
            free(pdo_regs);
            return -1;
        }
        sc_axes[i] = sc;

        /* 配置RPDO映射：把OD条目映射到RPDO */
        for (j = 0; j < 3; j++) {
            if (ecrt_slave_config_pdo_mapping_add(sc, 0x1600,  /* RPDO映射索引 */
                    rpdo_mapping[j].index,
                    rpdo_mapping[j].subindex,
                    rpdo_mapping[j].bit_length) < 0) {
                fprintf(stderr, "Failed to add RPDO mapping for axis %d\n", i+1);
                free(pdo_regs);
                return -1;
            }
        }

        /* 配置TPDO映射 */
        for (j = 0; j < 3; j++) {
            if (ecrt_slave_config_pdo_mapping_add(sc, 0x1A00,  /* TPDO映射索引 */
                    tpdo_mapping[j].index,
                    tpdo_mapping[j].subindex,
                    tpdo_mapping[j].bit_length) < 0) {
                fprintf(stderr, "Failed to add TPDO mapping for axis %d\n", i+1);
                free(pdo_regs);
                return -1;
            }
        }

        /* 配置同步管理器（SM2=输出/RPDO, SM3=输入/TPDO） */
        ecrt_slave_config_pdos(sc, EC_END, 
            /* SM2: 输出PDO（RPDO），同步类型DC模式 */
            ec_pdo_info_t[] = {
                {0x1600, 3, (ec_pdo_entry_info_t[]) {
                    {0x607A, 0x00, 32},
                    {0x60FF, 0x00, 32},
                    {0x6040, 0x00, 16},
                }},
            },
            /* SM3: 输入PDO（TPDO） */
            ec_pdo_info_t[] = {
                {0x1A00, 3, (ec_pdo_entry_info_t[]) {
                    {0x6064, 0x00, 32},
                    {0x606C, 0x00, 32},
                    {0x6041, 0x00, 16},
                }},
            }
        );

        /* 注册PDO条目到域，获取偏移地址 */
        pdo_regs[reg_idx++] = (ec_pdo_entry_reg_t){
            0, (uint16_t)(i+1), VENDOR_INOVANCE, PRODUCT_SV660N,
            0x607A, 0x00, &off_rpdo_pos[i], NULL
        };
        pdo_regs[reg_idx++] = (ec_pdo_entry_reg_t){
            0, (uint16_t)(i+1), VENDOR_INOVANCE, PRODUCT_SV660N,
            0x60FF, 0x00, &off_rpdo_vel[i], NULL
        };
        pdo_regs[reg_idx++] = (ec_pdo_entry_reg_t){
            0, (uint16_t)(i+1), VENDOR_INOVANCE, PRODUCT_SV660N,
            0x6040, 0x00, &off_rpdo_ctl[i], NULL
        };
        pdo_regs[reg_idx++] = (ec_pdo_entry_reg_t){
            0, (uint16_t)(i+1), VENDOR_INOVANCE, PRODUCT_SV660N,
            0x6064, 0x00, &off_tpdo_pos[i], NULL
        };
        pdo_regs[reg_idx++] = (ec_pdo_entry_reg_t){
            0, (uint16_t)(i+1), VENDOR_INOVANCE, PRODUCT_SV660N,
            0x606C, 0x00, &off_tpdo_vel[i], NULL
        };
        pdo_regs[reg_idx++] = (ec_pdo_entry_reg_t){
            0, (uint16_t)(i+1), VENDOR_INOVANCE, PRODUCT_SV660N,
            0x6041, 0x00, &off_tpdo_sta[i], NULL
        };

        /* 步骤4：配置DC同步参数 */
        /* 参数：AssignActivate=0x0300(汇川DC模式), 
         *        CycleTime=1000000ns, 
         *        ShiftTime=0 */
        ecrt_slave_config_dc(sc, 0x0300, CYCLE_TIME_NS, 0, 0, 0);
    }

    /* 步骤5：注册PDO条目 */
    if (ecrt_domain_reg_entries(domain, pdo_regs)) {
        fprintf(stderr, "Failed to register PDO entries\n");
        free(pdo_regs);
        return -1;
    }
    free(pdo_regs);

    /* 步骤6：激活主站（进入OP状态前必须调用） */
    if (ecrt_master_activate(master)) {
        fprintf(stderr, "Failed to activate master\n");
        return -1;
    }

    /* 步骤7：获取过程数据指针 */
    domain_pd = ecrt_domain_data(domain);
    if (!domain_pd) {
        fprintf(stderr, "Failed to get domain data pointer\n");
        return -1;
    }

    printf("EtherCAT init OK: %d axes configured, 1kHz DC sync\n", NUM_AXES);
    return 0;
}
```

<br>

### 1kHz实时周期任务

```c
/**
 * cyclic_task() - 1kHz EtherCAT周期任务
 * 
 * 典型执行时间：<100μs（6轴，120字节数据）
 * 必须在SCHED_FIFO实时调度下运行
 */
void *cyclic_task(void *arg)
{
    struct timespec ts;
    int axis;
    int cycle_count = 0;

    /* 锁定内存，防止页错误 */
    if (mlockall(MCL_CURRENT | MCL_FUTURE) == -1) {
        perror("mlockall failed");
        return NULL;
    }

    /* 设置实时调度：SCHED_FIFO，优先级最高 */
    struct sched_param param = { .sched_priority = 99 };
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &param) != 0) {
        perror("pthread_setschedparam failed");
        return NULL;
    }

    /* 获取当前时间作为起始点 */
    clock_gettime(CLOCK_MONOTONIC, &ts);

    printf("cyclic_task started, frequency=%dHz\n", TASK_FREQUENCY);

    while (1) {
        /* ===== 计算下一周期时间点 ===== */
        ts.tv_nsec += CYCLE_TIME_NS;
        while (ts.tv_nsec >= 1000000000) {
            ts.tv_nsec -= 1000000000;
            ts.tv_sec++;
        }

        /* ===== 等待下一周期（精确睡眠） */
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, NULL);

        /* ===== Step 1: 接收数据（从站 → 主站） */
        ecrt_master_receive(master);
        ecrt_domain_process(domain);

        /* ===== Step 2: 读取TPDO（各轴实际位置/速度/状态） */
        for (axis = 0; axis < NUM_AXES; axis++) {
            int32_t actual_pos = EC_READ_S32(domain_pd + off_tpdo_pos[axis]);
            int32_t actual_vel = EC_READ_S32(domain_pd + off_tpdo_vel[axis]);
            uint16_t status = EC_READ_U16(domain_pd + off_tpdo_sta[axis]);

            /* 状态检查：bit3=Fault（故障） */
            if (status & 0x0008) {
                fprintf(stderr, "Axis %d FAULT! status=0x%04X\n", axis+1, status);
            }

            /* TODO: 将实际位置速度送入运动学控制器 */
            (void)actual_pos;
            (void)actual_vel;
        }

        /* ===== Step 3: 计算控制量（运动学+动力学控制） */
        /* 此处调用你的控制算法：
         * - 逆运动学：笛卡尔坐标 → 关节坐标
         * - 轨迹规划：S曲线/梯形速度规划
         * - PID/前馈控制器
         * 输出：target_pos[6], target_vel[6], control_word[6]
         */

        /* ===== Step 4: 写入RPDO（主站 → 从站） */
        for (axis = 0; axis < NUM_AXES; axis++) {
            /* 控制字：0x000F = Enable Operation (CSP模式) */
            uint16_t ctrl_word = 0x000F;

            /* 示例：正弦轨迹，幅值10000计数，周期2秒 */
            double t = (double)cycle_count / TASK_FREQUENCY;
            int32_t target_pos = (int32_t)(10000.0 * sin(2 * M_PI * 0.5 * t));
            int32_t target_vel = (int32_t)(10000.0 * 2 * M_PI * 0.5 
                                            * cos(2 * M_PI * 0.5 * t));

            EC_WRITE_U16(domain_pd + off_rpdo_ctl[axis], ctrl_word);
            EC_WRITE_S32(domain_pd + off_rpdo_pos[axis], target_pos);
            EC_WRITE_S32(domain_pd + off_rpdo_vel[axis], target_vel);
        }

        /* ===== Step 5: 发送数据（主站 → 从站） */
        ecrt_domain_queue(domain);
        ecrt_master_send(master);

        cycle_count++;

        /* 每1000个周期打印一次状态 */
        if ((cycle_count % 1000) == 0) {
            printf("Cycle %d: running...\n", cycle_count);
        }
    }

    return NULL;
}
```

<br>

### 验证步骤

按**三步验证法**依次执行，确保每一步通过后再进入下一步：

> 💡 **提示**：先用`ethercat slaves`确认所有从站在线 → 再配PDO → 最后开DC。三步验证法是排DC问题的黄金法则，跳过步骤会让调试难度成倍增加。

**Step 1 — 确认所有从站在线：**

```bash
$ sudo ethercat slaves
0  0:0  PREOP  E  601:9201 SV660N        # J1 基座
1  0:1  PREOP  E  601:9201 SV660N        # J2 肩部
2  0:2  PREOP  E  601:9201 SV660N        # J3 肘部
3  0:3  PREOP  E  601:9201 SV660N        # J4 腕偏转
4  0:4  PREOP  E  601:9201 SV660N        # J5 腕俯仰
5  0:5  PREOP  E  601:9201 SV660N        # J6 腕旋转
```

- `PREOP` = 预操作状态（可以读写SDO）
- 看到6个`SV660N`说明物理连接正常
- 如果某个从站缺失，检查网线连接和电源

**Step 2 — 查看PDO映射：**

```bash
$ sudo ethercat pdo
Slave 1: (SV660N)
  SM2: outputs (RPDO)
    addr b   index  sub  bitl  name
    0x00.0  0x607A 0x00 32    Target Position
    0x04.0  0x60FF 0x00 32    Target Velocity
    0x08.0  0x6040 0x00 16    Controlword
  SM3: inputs (TPDO)
    addr b   index  sub  bitl  name
    0x00.0  0x6064 0x00 32    Position Actual
    0x04.0  0x606C 0x00 32    Velocity Actual
    0x08.0  0x6041 0x00 16    Statusword
```

- 确认PDO映射与代码中的`rpdo_mapping`和`tpdo_mapping`一致
- `addr`列显示各字段在域中的字节偏移

**Step 3 — 查看DC同步状态：**

```bash
$ sudo ethercat dc
Destination  DC time [ns]    Diff [ns]   Drift [ppm]
0            1693821456789   -12         0.001
1            1693821456787   -14         0.002
2            1693821456790   -11         0.001
3            1693821456788   -13         0.003
4            1693821456791   -10         0.001
5            1693821456788   -13         0.002
```

- `Diff`列：各从站时钟与参考时钟的偏差，正常应<100ns
- `Drift`列：时钟漂移率，应稳定在0.001ppm量级
- 如果`Diff`持续增大，说明DC同步未收敛，检查`CycleTime`配置

**内核日志排查：**

```bash
# 查看IgH Master内核日志
$ sudo dmesg | grep ec_
[   12.345] ec_master: Master 0 initialized, 6 slaves found
[   13.123] ec_master: Domain 0: PDO entries = 36
[   14.567] ec_master: DC activated, reference clock = slave 0

# 实时监控
$ sudo dmesg -w | grep ec_
```

<br>

### DC同步常见问题

> ⚠️ **陷阱**：**DC同步需要所有从站支持DC**。如果你的网络中混入了不支持DC的从站（如某些简易I/O模块），整个网络将无法进行DC同步，主站会报`DC not supported by all slaves`错误。解决方案有两种：
>
> 1. **混合同步模式**：将不支持DC的从站配置为自由运行（FreeRun）模式，仅对支持DC的从站启用同步
> 2. **全部更换**：统一使用支持DC的从站设备
>
> 混合同步的代价是：非DC从站的数据更新会有抖动（通常±1个周期），对实时性要求不高的I/O可以接受，但伺服轴必须全部支持DC。

另一个常见问题是**DC初始化超时**。如果主站日志中出现`DC configuration timeout`，通常是以下原因：

- `CycleTime`设置与从站能力不匹配（尝试改为2000μs即500Hz）
- 网线质量差或长度过长导致信号衰减
- 从站固件版本不支持所选的`AssignActivate`码

<br>

## <span class="blue"> 本节总结

| 主题 | 关键要点 | 实践建议 |
|:-----|:---------|:---------|
| DC同步原理 | 主站通过ARMW测量各从站延迟，PI补偿偏移和漂移 | 初始化时确保所有从站上电稳定后再启动主站 |
| DC同步精度 | 典型<100ns，满足多轴协同需求 | 使用示波器测量SYNC0信号验证 |
| PDO | 周期性实时数据（位置/速度/力矩），每个EtherCAT周期自动交换 | 映射紧凑排列，减少帧长度和周期抖动 |
| SDO | 非实时配置数据，请求-应答模式 | 仅在PREOP状态下配置，OP状态避免SDO |
| CoE | CANopen对象字典移植到EtherCAT，兼容CiA 402 | 利用对象字典标准化，跨厂商设备替换更容易 |
| IgH Master | `ecrt_` API + `ethercat` CLI工具 + `ec_master.ko` | 版本1.5.2+推荐，打PREEMPT_RT补丁 |
| 实时要求 | 必须PREEMPT_RT内核 + SCHED_FIFO + 内存锁定 | 绑定隔离CPU，关闭无关中断 |
| 三步验证法 | slaves在线 → pdo映射正确 → dc同步收敛 | 每步通过后再下一步，避免连锁调试 |

<br>

## <span class="blue"> 下一步

下一节 **B-C.10.4 PROFINET与OPC UA**，我们将把目光转向西门子主导的工业以太网生态。PROFINET IRT如何实现与EtherCAT DC相媲硬的同步精度？OPC UA如何成为工业4.0时代统一的"数据语言"？当EtherCAT遇上IT/OT融合趋势，这些协议如何互补共存？敬请期待。

<br>

## <span class="blue"> 配套资源

**推荐资料：**
- [ETG.1000.2 EtherCAT技术规范] — DC同步章节（DC系统描述）
- [IgH EtherCAT Master文档] — `ecrt.h` API参考手册
- [CiA 301 CANopen应用层规范] — 对象字典详细定义
- [CiA 402 伺服驱动Profile] — 运动控制状态机和PDO定义
- [汇川SV660N用户手册] — 具体的AssignActivate码和DC配置参数

**动手实验：**
- 实验1：用`ethercat slaves`扫描网络，记录各从站的AL状态和DC能力
- 实验2：修改`ec_init()`中的`CYCLE_TIME_NS`为500μs（2kHz），观察系统稳定性
- 实验3：拔掉中间一根网线，观察EtherCAT链路冗余是否自动恢复（需硬件支持）
- 实验4：用示波器同时测量两个从站的SYNC0引脚，验证DC同步精度

**代码仓库：**
- IgH EtherCAT Master源码：https://gitlab.com/etherlab.org/ethercat
- Linux RT-PREEMPT补丁：https://wiki.linuxfoundation.org/realtime/start
