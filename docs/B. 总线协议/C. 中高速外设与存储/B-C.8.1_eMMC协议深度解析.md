# B-C.8.1 eMMC协议深度解析

> 所属章节：第五部 B. 总线协议 > B-C.8 eMMC与SD卡
>
> 难度：[I] Intermediate | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

你用过手机里的存储芯片吗？那块焊在主板上、黑乎乎的小芯片，很可能就是eMMC——Embedded MultiMediaCard。它是嵌入式领域最主流的板载闪存方案，从早期的4.3版本到如今的5.1，eMMC撑起了无数设备的存储需求。与SD卡不同，eMMC是**焊死**在板子上的，没有插拔、没有写保护开关，它天生就是为嵌入式设备设计的。

本节我们从物理层面切入，搞懂eMMC的引脚定义和分区结构，再深入到命令集和EXT_CSD寄存器的世界。读完这一节，你会明白为什么你的Bootloader能安全存放在eMMC里，RPMB分区又是怎么保护你的指纹数据的。

---

## <span class="blue"> eMMC硬件架构与分区结构 [I][M]

### eMMC物理引脚

eMMC采用BGA（Ball Grid Array）封装，标准的153-ball封装尺寸只有11.5mm x 13mm。但真正和主控通信的，其实只有**11根信号线**。这跟SD卡的4-bit数据线相比，eMMC的8-bit数据线让它在同等频率下拥有翻倍的理论带宽。

```
                     eMMC 153-ball BGA 顶视图（信号引脚）
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │    VDD(4) ─┐                              ┌─ VDD(22)   │
    │            │                              │            │
    │    VSS(3) ─┤     ╔══════════════╗        ├─ VDDQ(20)  │
    │            │     ║  Controller  ║        │            │
    │    CLK(5) ─┤     ║   + NAND     ║        ├─ VSSQ(21)  │
    │            │     ║   Flash Die  ║        │            │
    │    CMD(3) ─┤     ╚══════════════╝        ├─ DAT0(7)   │
    │            │                              │            │
    │    DAT7(10)─┘                              └─ DAT1(8)   │
    │                                                         │
    │    电源域: VDD=3.3V/1.8V (核心)                        │
    │             VDDQ=3.3V/1.8V/1.2V (IO)                   │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

**eMMC信号引脚定义（共11根）：**

```
    ┌────────────┬────────┬────────────────────────────────────────┐
    │  引脚名称   │  方向   │              功能说明                   │
    ├────────────┼────────┼────────────────────────────────────────┤
    │  CLK       │  Input │  时钟信号，所有数据传输由CLK同步          │
    │  CMD       │  I/O   │  命令通道，双向，用于发送命令和接收响应   │
    │  DAT0-DAT7 │  I/O   │  8-bit数据总线，双向                    │
    │  VDD       │  Power │  核心供电 (3.3V/1.8V)                  │
    │  VDDQ      │  Power │  IO口供电 (3.3V/1.8V/1.2V HS200/HS400) │
    │  VSS/VSSQ  │  GND   │  地线                                  │
    │  RST_n     │  Input │  硬件复位引脚（可选，eMMC4.41+）        │
    │  DS        │  Output│  数据选通信号（仅HS400模式使用）         │
    └────────────┴────────┴────────────────────────────────────────┘
```

> 💡 **提示**：HS200和HS400是eMMC 5.0/5.1引入的高速模式。HS200使用单沿采样、最高200MHz；HS400使用双沿采样+Data Strobe信号，理论速率直接翻倍到400MB/s（8-bit x 200MHz x 2）。但HS400对PCB走线等长要求极高，Layout时DAT0-DAT7和DS的长度差要控制在±1mm以内。

CLK时钟线是整个总线的心脏。eMMC协议规定了四种速度模式：Legacy（0-26MHz）、High Speed SDR（0-52MHz）、HS200（0-200MHz）和HS400（0-200MHz DDR）。每次上电后，eMMC默认以Legacy模式工作，主控需要通过**CMD6**切换到更高速度。

### JEDEC标准演进

eMMC由JEDEC固态技术协会制定标准，各版本的关键特性如下：

| 版本 | 发布年份 | 最大容量 | 最高速度模式 | 关键特性 |
|:---:|:---:|:---:|:---:|:---|
| v4.3 | 2009 | 16GB | 52MHz HS | 引入RST_n复位引脚 |
| v4.4/v4.41 | 2010 | 128GB | 52MHz HS | 增加Cache功能、Boot分区增强 |
| v4.5 | 2011 | 2TB | 200MHz HS200 | 引入HS200、缓存命令队列 |
| v5.0 | 2013 | 2TB | HS400 | 引入HS400 DDR模式、Data Strobe |
| **v5.1** | **2015** | **128TB** | **HS400** | **现场固件更新(FFU)、增强Cache、寿命监测** |

目前（2024年初）市场上主流的是**JESD84-B51**（eMMC 5.1），它定义了完整的HS400模式、增强的缓存机制，以及我们今天要重点讲的分区管理和寿命监测功能。

### eMMC分区结构详解

这是一张eMMC分区的全景图。出厂时，eMMC的闪存空间就被划分成四个独立区域：

```
    ┌─────────────────────────────────────────────────────────────┐
    │                    eMMC Flash 物理分区                        │
    ├─────────────────────────────────────────────────────────────┤
    │  Boot Area Partition 1  │  4MB / 8MB / 16MB (可配置)         │
    │  ───────────────────────┼────────────────────────────────   │
    │  Boot Area Partition 2  │  4MB / 8MB / 16MB (可配置)         │
    │  ───────────────────────┼────────────────────────────────   │
    │  Replay Protected       │  4MB / 8MB / 16MB (与Boot同尺寸)   │
    │  Memory Block (RPMB)    │                                   │
    │  ───────────────────────┼────────────────────────────────   │
    │                         │  剩余全部容量                      │
    │  User Data Area         │  (如 4GB / 8GB / 16GB / 32GB...)  │
    │                         │  ← GPT/MBR分区表在此划分           │
    ├─────────────────────────────────────────────────────────────┤
    │  GPP: General Purpose Partitions (可选，EXT_CSD配置)          │
    │  Enhanced User Data Area (可选，SLC/pSLC模式)                 │
    └─────────────────────────────────────────────────────────────┘
```

#### 分区详细说明

| 分区 | 典型大小 | 用途 | 访问方式 | 特点 |
|:---:|:---:|:---|:---|:---|
| Boot1 | 4MB | 存放第一阶段Bootloader（如SPL/Primary Boot） | 通过CMD6设置`PARTITION_CONFIG`后读写 | 硬件可配置为启动分区，独立擦写保护 |
| Boot2 | 4MB | 存放备份Bootloader，或第二阶段Loader | 同上 | 与Boot1形成双Boot冗余 |
| RPMB | 4MB | 安全存储：指纹模板、密钥、防回滚计数器 | 需要认证密钥+写计数器，只能按512B帧写 | 防重放攻击，写认证密钥只能烧录一次 |
| User Data Area | 剩余全部 | 存放内核、根文件系统、用户数据 | 正常块设备读写 | 默认eMMC暴露给系统的区域，GPT/MBR在此划分 |

Boot分区的存在，让嵌入式设备可以**不依赖任何外部存储就能启动**。主控芯片上电后，如果配置为eMMC启动，它会自动从eMMC的Boot分区读取Bootloader——这个过程甚至不需要eMMC驱动参与，是eMMC控制器硬件完成的。

> 💡 **提示**：eMMC的Boot分区有独立使能位 → `BOOT_PARTITION_ENABLE`（EXT_CSD偏移[179]的bit[5:3]`）→ 决定从哪个Boot分区启动。设置为`0x1`从Boot1启动，`0x2`从Boot2启动，`0x7`从User Area启动。这个值通常由uboot或fastboot工具来修改。做OTA升级时，可以交替写入Boot1和Boot2，然后切换使能位来实现**原子性切换**，回滚时立刻切回去。

#### RPMB：重放保护的秘密

RPMB（Replay Protected Memory Block）是eMMC中最特殊的分区。它存在的唯一目的，就是**防止数据被回滚到旧版本**。

想象一下这个攻击场景：你的手机系统升级后修补了一个安全漏洞，攻击者想降级系统来利用旧漏洞。如果没有RPMB，攻击者可以直接刷入旧版固件。但有了RPMB，系统可以在RPMB里存储一个**单调递增的版本计数器**，每次启动时验证这个计数器——如果计数器比上次小，说明有人搞鬼，拒绝启动。

RPMB的读写流程是这样的：

```
    主控 (SoC)                          eMMC (RPMB)
       │                                    │
       │── 1. 写请求 + 签名(HMAC-SHA256) ──>│
       │                                    │
       │<─ 2. 返回当前写计数器 (Read Counter)─│
       │                                    │
       │── 3. 确认写 + 新签名  ────────────>│
       │   (签名覆盖: 数据+计数器+地址)       │
       │                                    │
       │<─ 4. 返回写结果 (成功/认证失败) ─────│
       │                                    │
```

> ⚠️ **陷阱**：RPMB写操作需要写入**认证密钥（RPMB Key）** → 这个密钥只能写一次 → 写错永久无法使用RPMB！在生产线上烧录RPMB Key时，务必确保：1) 写入的Key值正确且已备份；2) 写入过程中不能断电；3) 建议先在测试板上验证Key的生成流程，再切换到量产线。某些方案（如OP-TEE）支持Secure Storage派生RPMB Key，这样Key本身不会离开安全世界。

RPMB的分区大小虽然只有4MB，但它按**512字节帧**组织读写。每个帧包含：256字节数据 + 8字节随机数（nonce）+ 2字节写计数器 + 2字节地址 + 32字节HMAC-SHA256认证码。这个结构保证了每一次写操作都不可伪造、不可重放。

在实际产品中，OP-TEE（开源可信执行环境）通常负责管理RPMB Key和认证流程。Linux内核本身不直接访问RPMB，而是通过TEE Supplicant将请求转发给Secure World处理。

#### Enhanced User Data Area 和 GPP

除了四个强制分区，eMMC 5.1还支持两种可选的高级分区：

- **Enhanced User Data Area**：把User Data Area的一部分配置为SLC（Single Level Cell）模式。SLC相比MLC/TLC更可靠、寿命更长、读写更稳定，适合存放关键系统数据。
- **General Purpose Partitions (GPP)**：最多可划分4个通用分区，每个可独立配置大小和增强属性。这相当于在User Data Area内部再做细粒度划分。

> 💡 **提示**：配置Enhanced Area和GPP是一个**破坏性的操作**，需要满足三个条件：1) eMMC处于传输状态（Tran state）；2) 通过CMD6设置对应的EXT_CSD位；3) 执行**分区重配命令**（POWER-ON RESET后生效）。配置会擦除User Data Area的全部数据，生产线上通常在烧录固件前完成这一步。

---

## <span class="blue"> eMMC命令集与EXT_CSD寄存器 [I][M]

### 核心命令集

eMMC的命令集和SD卡有很大重叠（毕竟师出同门），但eMMC有一些专属命令和扩展功能。下面的表格列出了最核心、最常用的命令：

| 命令 | 名称 | 功能 | 典型使用场景 |
|:---:|:---|:---|:---|
| CMD0 | GO_IDLE_STATE | 软件复位，eMMC进入Idle状态 | 上电后第一条命令，或出错后复位 |
| CMD1 | SEND_OP_COND | 发送操作条件，协商电压和工作模式 | 初始化流程中查询eMMC就绪状态 |
| CMD2 | ALL_SEND_CID | 获取CID（Card Identification），128位卡唯一标识 | 初始化时读取芯片型号、生产日期等 |
| CMD3 | SET_RELATIVE_ADDR | 分配/获取RCA（Relative Card Address） | 初始化时给eMMC分配总线地址 |
| CMD6 | SWITCH | 切换速度模式、分区选择、或写EXT_CSD | 切HS200/HS400、切Boot分区、修改EXT_CSD |
| CMD8 | SEND_EXT_CSD | 读取512字节EXT_CSD寄存器 | 初始化后读取eMMC能力信息 |
| CMD13 | SEND_STATUS | 查询当前状态 | 操作完成后轮询状态 |
| CMD17 | READ_SINGLE_BLOCK | 读单个512B块 | 正常数据读取 |
| CMD18 | READ_MULTIPLE_BLOCK | 读多个连续块 | 大批量数据读取 |
| CMD24 | WRITE_BLOCK | 写单个512B块 | 正常数据写入 |
| CMD25 | WRITE_MULTIPLE_BLOCK | 写多个连续块 | 大批量数据写入 |
| CMD35/CMD36 | ERASE_GROUP_START/END | 设置擦除范围 | 数据擦除操作 |

CMD6 是eMMC中最灵活的命令，它有两个完全不同的用途：

1. **模式切换**（Set Bits）：切换总线宽度、速度模式、上电状态。例如切到HS200：`CMD6[31:16]=0x03B9`（设置HS_TIMING=0x01, BUS_WIDTH=0x02）。
2. **写EXT_CSD**（Write Byte）：直接修改EXT_CSD寄存器中的某一个字节。例如修改启动分区：`CMD6[31:16]=0x03B3, CMD6[15:8]=0x38`（向偏移179写入0x38，即从Boot2启动）。

CMD6的返回值是一个**状态响应**（R1b），表明命令是否被接受。真正的切换是否成功，需要轮询`SWITCH_ERROR`位（EXT_CSD[502] bit7）。

### eMMC初始化流程

eMMC上电后有一套严格的握手流程，主控必须按顺序发送命令，eMMC才能进入正常工作状态。下面是完整的初始化流程：

```
    上电
     │
     ▼
  ┌─────────────┐     CMD0(参数=0x00000000)      ┌──────────┐
  │   Power-On   │ ─────────────────────────────> │  Idle   │
  │   State      │         (软件复位)              │  状态   │
  └─────────────┘                                └────┬─────┘
                                                      │
                     CMD1(参数=0x40FF8000)            │
                     查询OCR寄存器，协商电压           ▼
                    <────────────────────────────  ┌──────────┐
                     R3响应(包含OCR)                │ Ready   │
                                                    │  状态   │
                     轮询CMD1直到                    └────┬─────┘
                     Power Up Status(bit31)=1            │
                     ────────────────────────────>       │
                                                        │
                     CMD2                                │
                     获取CID(128位卡识别号)              ▼
                    <───────────────────────────  ┌──────────┐
                     R2响应(136位，含CID)          │Identification│
                                                   │    状态     │
                                                        │
                     CMD3(参数=RCA)                     │
                     分配相对地址                        ▼
                    <───────────────────────────  ┌──────────┐
                     R1响应                         │ Stand-by │
                                                    │   状态   │
                                                        │
                     CMD9                                │
                     获取CSD寄存器                       │
                    <───────────────────────────         │
                     R2响应                               │
                                                        │
                     CMD7(参数=RCA)                      ▼
                     选中eMMC                       ┌──────────┐
                    <───────────────────────────   │ Transfer │
                     R1b响应                        │   状态   │
                                                   └────┬─────┘
                                                        │
                     CMD8                                │
                     读取EXT_CSD(512字节)                │
                    <───────────────────────────         │
                     R1 + 数据块                          │
                                                        │
                     CMD6                                │
                     切换速度模式(如HS200)               │
                    ───────────────────────────>        │
                     轮询STATUS[7:6]=Tran               │
                                                        │
                     CMD6                                ▼
                     切换总线宽度(8-bit)            ┌──────────┐
                    ───────────────────────────>   │  Ready   │
                                                   │  就绪   │
                                                   └──────────┘
                                                        │
                     后续: CMD17/18读, CMD24/25写        │
                     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

这个流程有几个关键点需要注意：

1. **CMD1必须轮询**：上电后eMMC需要时间初始化内部NAND Flash控制器，主控要不断发CMD1，直到OCR寄存器的bit31（power up status）变为1。
2. **RCA由主控分配**：eMMC不像SD卡那样自己选一个RCA（SD卡是发送CMD3请求RCA），而是主控直接指定。通常主控会给eMMC分配RCA=0x0001。
3. **进入Transfer状态后才能读写数据**：CMD7是"选中/取消选中"命令，参数中的RCA匹配时选中，参数=0x0000时取消选中。

### EXT_CSD寄存器（512字节）

EXT_CSD是eMMC的"能力清单"和"配置中心"。它是一个512字节的寄存器，通过CMD8读取、通过CMD6修改。EXT_CSD分为三段：

| 偏移范围 | 名称 | 说明 |
|:---:|:---:|:---|
| [0-191] | Properties Segment | 只读属性，描述eMMC的固定能力 |
| [192-301] | Attributes Segment | 可读写属性，运行时配置 |
| [302-511] | Vendor/Reserved | 厂商自定义和保留区域 |

下面是EXT_CSD中最常用、最重要的寄存器：

| 偏移 | 名称 | 功能 | 典型值 |
|:---:|:---|:---|:---:|
| [0] | Reserved | (制造商预留，如三星/闪迪的标识) | 0x00 |
| [13] | BOOT_INFO | Boot分区信息：支持的Boot模式 | 0x07 (HS+DDR+HS200) |
| [14] | BOOT_PARTITION_SIZE | 每个Boot分区大小 = 128KB × 此值 | 0x20 (4MB) |
| [53] | SEC_COUNT[31:24] | 扇区数（User Area大小/512B） | 0x00 |
| [54] | SEC_COUNT[23:16] | （同上） | 0x00 |
| [55] | SEC_COUNT[15:8] | （同上） | 0x01 |
| [56] | SEC_COUNT[7:0] | （同上） | 0x00 |
| [63] | BOOT_SECTOR_SIZE | Boot分区扇区大小 | 0x00 (512B) |
| [125] | BOOT_CONFIG_PROT | Boot配置写保护 | 0x00 (未保护) |
| [126] | BOOT_BUS_CONDITIONS | Boot总线模式配置 | 0x01 (x8, HS) |
| [179] | PARTITION_CONFIG | 分区访问配置 + 启动分区选择 | 0x38 (Boot2启动) |
| [183] | RST_n_FUNCTION | RST_n引脚功能 | 0x01 (使能) |
| [185] | H/W_RESET_FUNCTION | 硬件复位功能 | 0x01 (临时使能) |
| [187] | BUS_WIDTH | 当前总线宽度 | 0x02 (8-bit) |
| [192] | CMD_SET_REV | 支持的命令集修订版本 | 0x05 (5.1) |
| [196] | CARD_TYPE | 支持的速度类型位图 | 0x57 (HS400等) |
| [231] | POWER_OFF_RRV[23:0] | 断电通知参数 | 0x00000A |
| [241] | LIFE_TIME_EST_A | Boot1/Boot2寿命估计 | 0x01 (0-10%损耗) |
| [242] | LIFE_TIME_EST_B | User Area寿命估计 | 0x01 (0-10%损耗) |
| [247] | VENDOR_HEALTH_REPORT | 厂商自定义健康报告 | 厂商定义 |
| [254] | POWER_OFF_LONG_TIME | 掉电保护时间 | 0x1E |
| [262] | HS_TIMING | 高速时序配置 | 0x01 (HS200) / 0x03 (HS400) |
| [496] | PARTITION_SWITCH_TIME | 分区切换所需时间 | 0x01 (10ms) |
| [501] | CORRECTLY_PRG_SECTORS | 成功编程扇区数统计 | 动态变化 |
| [502] | BKOPS_STATUS | 后台操作状态 + SWITCH错误 | 0x00 |

#### 寿命监测：LIFE_TIME_EST_A/B

EXT_CSD[241]和[242]是两个特别有价值的寄存器，它们反映了NAND Flash的健康状况：

| 值 | 含义 | 操作建议 |
|:---:|:---|:---|
| 0x00 | 未定义 | 设备刚出厂或信息不可用 |
| 0x01 | 0-10%已用寿命 | 健康状态良好 |
| 0x02 | 10-20%已用寿命 | 正常使用 |
| 0x03 | 20-30%已用寿命 | 正常使用 |
| 0x04-0x0A | 30-100% | 寿命逐渐消耗 |
| 0x0B | 已超过额定寿命 | ⚠️ 强烈建议更换，数据丢失风险 |

> 💡 **提示**：LIFE_TIME_EST_A反映Boot1和Boot2分区的磨损，LIFE_TIME_EST_B反映User Data Area的磨损。在IoT设备运维中，可以定期（如每月）通过`CMD8`读取这两个寄存器，将数据上报到云端进行预测性维护。当值超过0x08时触发预警，让运维人员提前介入。

#### PARTITION_CONFIG（偏移179）的位定义

这个寄存器是分区管理的核心，它的位定义如下：

```
  PARTITION_CONFIG (EXT_CSD[179])
  ┌─────────────────────────────────────────┐
  │ bit[7:6] │ bit[5:3]     │ bit[2:0]      │
  │ ACK      │ BOOT_PARTITION│ PARTITION_ACCESS│
  │ (R/W)    │ _ENABLE (R/W)│ (R/W)          │
  ├─────────────────────────────────────────┤
  │ 00=无    │ 000=不使能    │ 000=不访问    │
  │ 01=手动  │ 001=Boot1     │ 001=Boot1     │
  │ 10=自动  │ 010=Boot2     │ 010=Boot2     │
  │ 11=保留  │ 011=User Area │ 011=RPMB      │
  │          │ 111=User Area │ 100-111=GPP0-3│
  │          │               │               │
  │ ACK: Boot确认信号 │ BOOT_PARTITION_ENABLE: │
  │ 在boot期间发送    │ 决定上电时从哪个分区   │
  │ BOOT-ACK        │ 加载boot代码           │
  └─────────────────────────────────────────┘
```

**读写Boot分区的实际操作**：

1. 先写EXT_CSD[179]的bit[2:0]=001，设置分区访问目标为Boot1。
2. 然后正常用CMD17/CMD24读写数据——此时读写的就是Boot1分区。
3. 读写完成后，写EXT_CSD[179]的bit[2:0]=000，切回User Data Area。

> ⚠️ **陷阱**：忘记切回User Data Area会导致后续读写操作**误入Boot分区**，轻则数据写到错误位置，重则破坏Bootloader导致设备变砖！在Linux驱动中，`mmc_select_partition()`函数会处理这个切换逻辑，但如果你在裸机代码中直接操作，务必在Boot分区操作后显式切回。

---

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|:---|:---|
| **物理接口** | 11根信号线：CLK+CMD+DAT0-7+RST_n+DS，8-bit总线宽度是eMMC的核心优势 |
| **JEDEC标准** | eMMC 5.1 (JESD84-B51) 是当前主流，HS400最高400MB/s |
| **分区结构** | 四大强制分区：Boot1/Boot2/RPMB/User Area，出厂即固定划分 |
| **Boot分区** | 双Boot冗余机制，`BOOT_PARTITION_ENABLE`控制启动选择 |
| **RPMB安全** | 认证密钥只能写一次，HMAC-SHA256签名保护，配合OP-TEE使用 |
| **核心命令** | CMD0复位→CMD1就绪→CMD2获取CID→CMD3分配RCA→CMD6切换→CMD8读EXT_CSD |
| **EXT_CSD** | 512字节配置寄存器，包含速度模式、分区配置、寿命监测等全部能力信息 |
| **寿命监测** | `LIFE_TIME_EST_A/B`实时反馈NAND磨损，可用于预测性维护 |

---

## <span class="blue"> 下一步

**B-C.8.2 eMMC Linux驱动与SD卡** —— 本节我们搞懂了eMMC的硬件和协议。下一节我们将进入Linux内核，看看`mmc`子系统是如何同时支持eMMC和SD卡的。你会学到`mmc_host`、`mmc_card`、`mmc_request`这些核心数据结构，了解设备树中`&mmc1`节点的配置方法，还会搞清楚为什么同一个MMC控制器既能接eMMC又能接SD卡——以及它是如何自动检测的。最后我们会写一个完整的用户空间读写程序，通过`/dev/mmcblk0`和`/dev/mmcblk0boot1`来操作eMMC的不同分区。

---

## <span class="blue"> 配套资源

1. **JEDEC JESD84-B51**：eMMC 5.1标准官方文档（需JEDEC会员资格）
2. **Linux内核源码**：`drivers/mmc/core/` —— `mmc_ops.c`、`mmc.c`中的初始化流程
3. **U-Boot源码**：`drivers/mmc/mmc.c` —— 裸机eMMC初始化代码
4. **OP-TEE文档**：`https://optee.readthedocs.io/` —— RPMB Key管理和安全存储
5. **推荐阅读**：Micron eMMC 5.1 Product Manual（公开文档，含详细时序图）
