# B-D.12.3 EtherCAT 分布式时钟与 Linux 主站

> 所属章节：第五部 B. 总线协议 > B-D.12 工业以太网
>
> 难度：[E] Expert | 预计阅读时间：45 分钟

## <span class="blue"> 本节导读

12.2 解决了"帧怎么跑"，本节解决"大家什么时候跑"。多轴运动控制要求所有伺服在同一时刻采样反馈、同一时刻执行输出，各从站的本地晶振频率有几十 ppm 的偏差，不同步的话每秒钟就会漂出几十微秒——一个控制周期就乱套了。EtherCAT 的答案是由 ESC 硬件实现的分布式时钟（DC），把全网对齐到亚微秒。本节前半段讲 DC 的测量、补偿与同步信号；后半段落到 Linux：CoE 应用层怎么复用 CANopen 资产，IgH 主站的内核架构与 ecrt API 的编程模型。

本篇与 12.5 的分工：12.5 是完整搭建实战（编译、组态、CSP 伺服联调），本篇讲机制与编程模型，不重复安装步骤。

本节覆盖：DC 解决的两个时钟问题（传播延迟与漂移）、初始化三步测量流程、运行期漂移补偿、SYNC0/1 同步信号、DC 与非 DC 模式的选型、CoE 与 CANopen 的对应关系、IgH Master 的内核/用户态架构、ecrt 应用的四段式结构、DC 相关故障的定位。

## <span class="blue"> DC 要解决的两个问题

从站之间的时钟差异来自两个独立来源，DC 分别处理：

1. **传播延迟**：帧从主站到第 N 个从站要经过 N 段线缆和 N−1 次 ESC 转发，第 N 个从站收到"时刻 T"时，真实时间已经过了几百纳秒。不同位置的从站延迟不同。
2. **时钟漂移**：每个从站的本地晶振频率有偏差（典型 ±20 ppm），即使某一刻对齐了，之后也会匀速漂开。20 ppm 意味着每秒漂 20 µs。

DC 的目标不是"所有从站知道真实时间"，而是**所有从站共享同一个系统时间（System Time）**，误差收敛到 100 ns 量级。控制周期对齐到这个共享时间上，轴间同步就有了地基。

## <span class="blue"> 初始化：延迟测量与偏移写入

参考时钟的选择规则先交代：主站选**拓扑上第一个支持 DC 的从站**作为参考时钟（Reference Clock），而不是主站自己的时钟。原因有两个：参考时钟必须是 ESC 硬件时钟才能被各从站的时间控制环路跟踪（主站时钟受 OS 调度抖动污染，不配当基准）；选拓扑第一个从站是因为它的传播延迟最小且最稳定，漂移测量受的链路噪声最小。

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

## <span class="blue"> 运行期：漂移补偿

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

<!-- 【待补图】images/b-d-12-3-dc-drift-compensation.png（优先级：★必要）
图名：EtherCAT DC 漂移补偿硬件闭环
生图提示词：技术原理示意图，白底工程蓝图风格，中文标注，横版 16:9。左侧主站方框每周期读参考时钟（标注"参考时钟：拓扑首个 DC 从站"），通过 ARMW/FRMW Datagram 向右广播；右侧 3 个从站 ESC 方框，每个内部画一个闭环小图：比较器（"本地系统时间 − t_ref = 偏差"）→ 时间控制环路（标注"近似 PI，硬件实现"）→ 微调本地时钟推进速率（标注"快了就放慢，慢了就加快"）。底部横轴画两条时钟曲线：未补偿的发散曲线（红，标注"±20 ppm 每秒漂 20 µs"）与补偿后的收敛曲线（绿，标注"全网偏差 <1 µs，轴间 <100 ns"）。扁平矢量、细线条、无装饰。 -->

> ARMW/FRMW（带自动增址/配置地址的多写读）：帧穿过每个从站时，从站自动把自己的时间戳写进帧内指定位置，一次往返收齐全网数据。漂移补偿用这类 Datagram 是因为它本身不产生额外的总线往返。

## <span class="blue"> SYNC0/SYNC1：从站的对齐发令枪

时钟对齐之后，还需要"动作对齐"。ESC 的 DC 单元能输出两路同步信号 SYNC0/SYNC1：在系统时间的指定时刻产生硬件脉冲，触发从站的中断或锁存。两路的分工：**SYNC0 是主节拍**——周期等于控制周期（如 1 ms），驱动从站的主控制循环（锁存编码器、执行位置环、更新输出）；**SYNC1 是 SYNC0 的整数倍慢节拍**（如 8 ms），驱动慢速任务（温度采样、参数监测），或用于需要"先采样移位再输出"的从站做时序错位。单 SYNC0 已覆盖绝大多数运动控制场景，SYNC1 是可选件。

从站工作在三档模式之一：

| 模式 | 触发源 | 精度 | 适用 |
|:---|:---|:---|:---|
| Free Run | 从站自己的定时器 | 跟随晶振漂移，无同步 | 调试用，产品不用 |
| SM Sync | 过程数据到达（SyncManager 事件） | 取决于主站发包抖动，~15 µs 级 | 无 DC 的低成本从站 |
| DC Sync | SYNC0 脉冲 | <1 µs | 运动控制的标准选择 |

CSP（周期同步位置）模式的多轴系统一律用 DC Sync：所有轴在同一个 SYNC0 沿锁存编码器、执行位置环，轴间不同步直接表现为轮廓误差，DC 把它压到不可感知的量级。

## <span class="blue"> CoE：CANopen 资产的平移

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

## <span class="blue"> IgH EtherCAT Master：Linux 侧架构

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

## <span class="blue"> ecrt 编程模型：四段式

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

DC 健康度用 `ethercat dc` 看，典型输出：

```text
# ethercat dc
Reference clock:   0:0 (EK1100), System time: 1834567890123 ns
Slave  DC state    System time diff     Delay
0:0   active       0 ns (ref)           120 ns
1:0   active       -38 ns               265 ns
2:0   active       +51 ns               410 ns
```

读法：`System time diff` 是各站系统时间与参考时钟的残差，收敛后应在 ±100 ns 内小幅波动——某一站持续偏大且漂移，多半是它的 DC 没使能（组态漏了 SYNC0 配置）或工作在 SM Sync 模式；`Delay` 是该站的传播延迟，随拓扑位置单调递增，突然变化说明链路被改动过。全部显示 `active` 且残差收敛，DC 才算真正在工作。

## <span class="blue"> 排障：DC 与主站层故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| 从站进不了 OP，停在 SAFEOP+E | PDO 映射组态与从站实际不符 | `ethercat pdos` 回读比对；核对手册的默认映射 |
| DC 同步报错、轴间不同步 | 从站工作在 SM Sync 而非 DC Sync | `ethercat dc` 看各站 DC 状态；检查组态里 SYNC0 配置 |
| 周期任务偶发超时（>1 ms） | 没打 PREEMPT_RT / 线程没提优先级 / 页错误 | cyclictest 量化系统延迟；查调度策略与 mlockall |
| WKC 周期性偏少 | 有从站处理超时（SM 看门狗） | `ethercat slaves` 找 AL 状态异常的站 |
| 换网卡后抖动恶化 | 网卡/驱动组合不在推荐列表 | 换 I210 对比；确认用的是专用补丁驱动而非 generic |
| 参考时钟漂移告警 | 主站系统时钟本身不稳（NTP 正在校时） | 实时段停 NTP 跳变，用 chrony 平滑或主站独立时钟 |

## <span class="blue"> 本节总结

DC 的本质是把"时间"变成全网共享的硬件资源。两个物理问题分别用两套机制解决：传播延迟靠初始化时的三步测量（记录时间戳、算偏移、写寄存器）一次性标定，时钟漂移靠运行期每个周期的 ARMW/FRMW Datagram + ESC 内部硬件闭环持续收敛——漂移补偿必须由硬件做而不是主站软件逐个纠正，因为软件环路本身就被 OS 调度抖动污染，硬件环路才有把偏差压到 100 ns 的响应速度。参考时钟选拓扑首个 DC 从站而不是主站，也是同一逻辑：基准必须干净。时钟对齐之上，SYNC0 把"动作"也对齐到同一沿——CSP 多轴系统里，轴间不同步直接就是轮廓误差，DC Sync 是运动控制的标配而非可选。

Linux 侧的认知收敛为两层：IgH 架构的关键决策是帧绕过网络协议栈直取网卡，抖动预算因此只在主站 OS 一侧，用 PREEMPT_RT + SCHED_FIFO + mlockall + isolcpus 四件套管住；ecrt 编程模型把主站交互收敛成"读写一块过程数据镜像内存"——`receive → process → 读写镜像 → queue → send` 五步循环，帧组装与 WKC 校验全在主站核心里。排障时 `ethercat dc` 的 System time diff 残差是 DC 健康度的体温计：±100 ns 内小幅波动为正常，某站持续偏大先去查它的 SYNC0 组态。

速查：

| 要点 | 结论 |
|:---|:---|
| DC 解决的两问题 | 传播延迟（初始化标定）+ 时钟漂移（运行期硬件闭环） |
| 参考时钟 | 拓扑首个 DC 从站；主站时钟被 OS 抖动污染不配当基准 |
| 漂移补偿载体 | 每周期 ARMW/FRMW Datagram，不产生额外总线往返 |
| SYNC0/SYNC1 分工 | SYNC0 主节拍驱动控制环；SYNC1 整数倍慢节拍，可选 |
| 三档模式 | Free Run 调试 / SM Sync ~15 µs / DC Sync <1 µs，运动控制用 DC Sync |
| CoE 复用 | 对象字典/CiA 402 原样继承，换的只是承载层（邮箱+过程数据） |
| IgH 实时四件套 | PREEMPT_RT + SCHED_FIFO + mlockall + isolcpus |
| ecrt 五步循环 | receive → process → 读写镜像 → queue → send |
| DC 观测 | `ethercat dc`：diff ±100 ns 内收敛为正常，delay 随拓扑递增 |

## <span class="blue"> 本节自查

读完本节，你应能独立完成以下动作：

- 说出 DC 要补偿的两个物理量，以及初始化三步各自解决哪一个
- 解释为什么漂移补偿必须由 ESC 硬件闭环而不是主站软件逐个纠正
- 区分 Free Run / SM Sync / DC Sync 三档从站模式，并给运动控制场景选型
- 说明 CoE 与 CANopen 的复用边界：哪些原样继承、哪些换了承载
- 写出 ecrt 应用的四段结构，指出每段的实时上下文属性
- 给出 ecrt 实时循环的三项系统配置（PREEMPT_RT/SCHED_FIFO/mlockall）及各自防的是什么
- 用 `ethercat dc` 和 `ethercat slaves` 定位一例 DC 不同步故障

## <span class="blue"> 下一步

`B-D.12.4 PROFINET 与 OPC UA` 转向另一个阵营：PROFINET 的 RT/IRT 双档机制、GSDML 设备描述、以及 OPC UA 作为跨协议语义层的角色——12.1 版图里的另外两大板块在这里展开成机制。

> 💡
> 深入阅读：ETG.1020（DC 机制细节）、ETG.2000（从站信息规范）、IgH EtherCAT Master 1.5 文档（etherlab.org，ecrt API 参考与推荐网卡列表）、所用伺服型号的 CiA 402 over EtherCAT 手册。本节的实时性四件套系统化讨论在 `B-E.15.6 PREEMPT_RT 与总线实时性调优`，完整搭建实战在 `B-D.12.5`。
