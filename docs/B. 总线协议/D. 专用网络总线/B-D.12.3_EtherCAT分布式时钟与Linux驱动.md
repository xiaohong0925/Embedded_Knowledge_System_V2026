# B-D.12.3 EtherCAT 分布式时钟与 Linux 主站

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：45 分钟

## 本节导读

12.2 解决了"帧怎么跑"，本节解决"大家什么时候跑"。多轴运动控制要求所有伺服在同一时刻采样反馈、同一时刻执行输出，各从站的本地晶振频率有几十 ppm 的偏差，不同步的话每秒钟就会漂出几十微秒——一个控制周期就乱套了。EtherCAT 的答案是由 ESC 硬件实现的分布式时钟（DC），把全网对齐到亚微秒。本节前半段讲 DC 的测量、补偿与同步信号；后半段落到 Linux：CoE 应用层怎么复用 CANopen 资产，IgH 主站的内核架构与 ecrt API 的编程模型。

本篇与 12.5 的分工：12.5 是完整搭建实战（编译、组态、CSP 伺服联调），本篇讲机制与编程模型，不重复安装步骤。

本节覆盖：DC 解决的两个时钟问题（传播延迟与漂移）、初始化三步测量流程、运行期漂移补偿、SYNC0/1 同步信号、DC 与非 DC 模式的选型、CoE 与 CANopen 的对应关系、IgH Master 的内核/用户态架构、ecrt 应用的四段式结构、DC 相关故障的定位。

## DC 要解决的两个问题

从站之间的时钟差异来自两个独立来源，DC 分别处理：

1. **传播延迟**：帧从主站到第 N 个从站要经过 N 段线缆和 N−1 次 ESC 转发，第 N 个从站收到"时刻 T"时，真实时间已经过了几百纳秒。不同位置的从站延迟不同。
2. **时钟漂移**：每个从站的本地晶振频率有偏差（典型 ±20 ppm），即使某一刻对齐了，之后也会匀速漂开。20 ppm 意味着每秒漂 20 µs。

DC 的目标不是"所有从站知道真实时间"，而是**所有从站共享同一个系统时间（System Time）**，误差收敛到 100 ns 量级。控制周期对齐到这个共享时间上，轴间同步就有了地基。

## 初始化：延迟测量与偏移写入

上电组态阶段，主站完成一次全网测量：

```
 Step 1  传播延迟测量
   主站发一个特殊的广播 Datagram，帧依次穿过每个从站；
   每个 ESC 在自己端口上记录帧到达与离开的本地时间戳（t_rx, t_tx）。
   帧绕环返回后，主站收齐所有时间戳，
   结合各端口间的处理延迟（ESC 数据手册给定），
   算出每段链路的传播延迟 delay[i]。

 Step 2  偏移计算
   主站选首个支持 DC 的从站作为参考时钟（Reference Clock），
   计算每个从站本地时钟与参考时钟的偏移：
       offset[i] = t_local[i] − t_ref − delay_to[i]

 Step 3  偏移写入
   主站把 offset[i] 写进各从站的 System Time Offset 寄存器。
   此后从站读出的"系统时间" = 本地时钟 + offset，
   全网从站读出的系统时间在同一标尺上。
```

## 运行期：漂移补偿

偏移写入只解决"此刻对齐"，晶振漂移会让它持续劣化。运行期每个通信周期，主站读取参考时钟与自身时间，把差值通过 Datagram 分发给所有从站；各 ESC 内部的时间控制环路（硬件实现，近似 PI 控制器）微调本地时间的推进速度，使系统时间持续跟踪参考时钟。

```
 每周期：
   主站读参考时钟 t_ref
        │
        ▼  广播 ARMW/FRMW Datagram
   各 ESC：比较本地系统时间与 t_ref
           偏差 → 时间控制环路微调时钟推进速率
           （快了就放慢，慢了就加快——硬件闭环，无软件参与）

 收敛结果：全网系统时间偏差 < 1 µs，轴间典型 < 100 ns
```

> ARMW/FRMW（带自动增址/配置地址的多写读）：帧穿过每个从站时，从站自动把自己的时间戳写进帧内指定位置，一次往返收齐全网数据。漂移补偿用这类 Datagram 是因为它本身不产生额外的总线往返。

## SYNC0/SYNC1：从站的对齐发令枪

时钟对齐之后，还需要"动作对齐"。ESC 的 DC 单元能输出两路同步信号 SYNC0/SYNC1：在系统时间的指定时刻产生硬件脉冲，触发从站的中断或锁存。

从站工作在三档模式之一：

| 模式 | 触发源 | 精度 | 适用 |
|:---|:---|:---|:---|
| Free Run | 从站自己的定时器 | 跟随晶振漂移，无同步 | 调试用，产品不用 |
| SM Sync | 过程数据到达（SyncManager 事件） | 取决于主站发包抖动，~15 µs 级 | 无 DC 的低成本从站 |
| DC Sync | SYNC0 脉冲 | <1 µs | 运动控制的标准选择 |

CSP（周期同步位置）模式的多轴系统一律用 DC Sync：所有轴在同一个 SYNC0 沿锁存编码器、执行位置环，轴间不同步直接表现为轮廓误差，DC 把它压到不可感知的量级。

## CoE：CANopen 资产的平移

CoE（CANopen over EtherCAT）把 CiA 301 的对象字典、SDO、PDO 原样搬进 EtherCAT 邮箱和过程数据通道。D.11.4~11.5 的知识全部有效，只有承载层不同：

| 维度 | CANopen on CAN | CoE on EtherCAT |
|:---|:---|:---|
| 承载 | CAN 帧（8 字节） | EtherCAT 邮箱（SDO）/ 过程数据（PDO） |
| PDO 数量 | 4×RPDO + 4×TPDO | 取决于 SyncManager 与帧空间，宽松得多 |
| 单 PDO 数据 | ≤8 字节 | 单帧过程数据可到 KB 级 |
| SDO 传输 | expedited/segmented | 邮箱协议，分段效率高一个量级 |
| 节点标识 | Node-ID 1~127 | 配置站地址（扫描分配） |
| CiA 402 行规 | 原样 | 原样（0x6040/0x6041/0x6060…不变） |

实践推论：一台同时有 CAN 和 EtherCAT 两个型号的伺服（很多厂商的产品线如此），上位控制代码的对象字典访问部分可以原样复用，换的只是通信驱动。紧急报文（EMCY）在 CoE 里同样存在，走邮箱通道。

## IgH EtherCAT Master：Linux 侧架构

IgH（EtherLab）是 Linux 上最成熟的开源主站，分内核与用户态两部分：

```
 用户空间
   ┌────────────────────────────────────────┐
   │ 实时应用（你的控制程序，libecrt.so）      │
   │ ethercat 命令行工具（slaves/pdos/…）     │
   └───────────────┬────────────────────────┘
                   │ IOCTL
 内核空间          ▼
   ┌────────────────────────────────────────┐
   │ ec_master.ko   主站核心                  │
   │   帧调度 / Datagram 状态机 / CoE 邮箱    │
   │   DC 管理 / FMMU·SM 组态                │
   ├────────────────────────────────────────┤
   │ 网卡驱动层                              │
   │   ec_generic.ko（通用，走协议栈）        │
   │   或专用补丁驱动（e1000e/igb/r8169，     │
   │   绕过协议栈直取帧，延迟更低）           │
   └────────────────────────────────────────┘
                   │
                eth0 ── EtherCAT 网段
```

关键设计：EtherCAT 帧不经过 Linux 网络协议栈（Ethertype 0x88A4 本来也不走 IP），专用驱动直接把帧交给主站核心，省掉协议栈排队抖动。网卡选择因此是实时性的第一变量——Intel I210 是事实标准推荐，普通消费级网卡能用但抖动表现要实测。

## ecrt 编程模型：四段式

IgH 的用户态库 libecrt 把主站编程收敛为固定四段：

```c
/* 段 1：创建主站与从站组态（非实时上下文，初始化阶段做） */
ec_master_t *master = ecrt_request_master(0);
ec_domain_t *domain = ecrt_master_create_domain(master);

ec_slave_config_t *sc =
    ecrt_master_slave_config(master, 0, 0,            /* 别名, 位置 */
                             0x00000601, 0x00009201); /* VendorID, ProductCode */

/* PDO 映射注册：把从站的 PDO 条目绑到 domain 偏移 */
static ec_pdo_entry_reg_t domain_regs[] = {
    { 0, 0, 0x00000601, 0x00009201, 0x607A, 0, &off_target_pos },
    { 0, 0, 0x00000601, 0x00009201, 0x6040, 0, &off_ctrl_word },
    { 0, 0, 0x00000601, 0x00009201, 0x6064, 0, &off_act_pos  },
    { 0, 0, 0x00000601, 0x00009201, 0x6041, 0, &off_stat_word },
    {}
};
ecrt_domain_reg_pdo_entry_list(domain, domain_regs);
ecrt_slave_config_dc(sc, 0x0300, 1000000, 0, 0, 0);  /* DC 使能，SYNC0 周期 1 ms */

/* 段 2：激活（组态下发、进 OP 的准备完成） */
ecrt_master_activate(master);
uint8_t *domain_pd = ecrt_domain_data(domain);       /* 过程数据镜像指针 */

/* 段 3：实时循环（SCHED_FIFO + mlockall + CPU 隔离，1 ms 周期） */
for (;;) {
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &wakeup, NULL);

    ecrt_master_receive(master);                     /* 收帧 */
    ecrt_domain_process(domain);                     /* 解析进镜像 */

    uint16_t sw = EC_READ_U16(domain_pd + off_stat_word);
    /* …控制律计算… */
    EC_WRITE_U16(domain_pd + off_ctrl_word, cw);
    EC_WRITE_S32(domain_pd + off_target_pos, target);

    ecrt_domain_queue(domain);                       /* 排队发送 */
    ecrt_master_send(master);                        /* 发帧 */
}

/* 段 4：退出时 ecrt_master_release(master) */
```

模型的要点：应用看到的是一块**过程数据镜像内存**（domain_pd），读写它就等于读写全网从站的 PDO；帧的组装、发送、解析、WKC 校验由主站核心在 `receive/send` 两个调用里完成。`EC_READ_U16/EC_WRITE_S32` 这些宏处理字节序，应用不直接解帧。

实时性是应用自己的责任：内核打 PREEMPT_RT、实时线程 `SCHED_FIFO` 高优先级、`mlockall(MCL_CURRENT|MCL_FUTURE)` 防换页、`isolcpus` 隔离核跑控制循环。缺任何一项，1 ms 周期的抖动就会超标——这套配置的系统化讨论在 `B-E.15.6`，12.5 的实战会完整走一遍。

IgH 命令行是排障主力：`ethercat slaves`（各站 AL 状态）、`ethercat pdos`（映射回读）、`ethercat upload/download`（SDO 读写）、`ethercat reg_read`（ESC 寄存器）、`ethercat cstruct`（把扫到的组态导出成 ecrt 配置 C 代码，直接贴进应用）。

## 排障：DC 与主站层故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| 从站进不了 OP，停在 SAFEOP+E | PDO 映射组态与从站实际不符 | `ethercat pdos` 回读比对；核对手册的默认映射 |
| DC 同步报错、轴间不同步 | 从站工作在 SM Sync 而非 DC Sync | `ethercat dc` 看各站 DC 状态；检查组态里 SYNC0 配置 |
| 周期任务偶发超时（>1 ms） | 没打 PREEMPT_RT / 线程没提优先级 / 页错误 | cyclictest 量化系统延迟；查调度策略与 mlockall |
| WKC 周期性偏少 | 有从站处理超时（SM 看门狗） | `ethercat slaves` 找 AL 状态异常的站 |
| 换网卡后抖动恶化 | 网卡/驱动组合不在推荐列表 | 换 I210 对比；确认用的是专用补丁驱动而非 generic |
| 参考时钟漂移告警 | 主站系统时钟本身不稳（NTP 正在校时） | 实时段停 NTP 跳变，用 chrony 平滑或主站独立时钟 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出 DC 要补偿的两个物理量，以及初始化三步各自解决哪一个
- 解释为什么漂移补偿必须由 ESC 硬件闭环而不是主站软件逐个纠正
- 区分 Free Run / SM Sync / DC Sync 三档从站模式，并给运动控制场景选型
- 说明 CoE 与 CANopen 的复用边界：哪些原样继承、哪些换了承载
- 写出 ecrt 应用的四段结构，指出每段的实时上下文属性
- 给出 ecrt 实时循环的三项系统配置（PREEMPT_RT/SCHED_FIFO/mlockall）及各自防的是什么
- 用 `ethercat dc` 和 `ethercat slaves` 定位一例 DC 不同步故障

## 参考资料

- ETG.1020 — EtherCAT 协议增强（DC 机制细节）；ETG.2000 — EtherCAT 从站信息规范
- IgH EtherCAT Master 1.5 文档：etherlab.org（ecrt API 参考、网卡驱动列表）
- PREEMPT_RT：kernel.org 的 rt 补丁系列与本丛书 B-E.15.6
- CiA 402 over EtherCAT 驱动器手册（以所用伺服型号为准）
