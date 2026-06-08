# B-C.9.3 CAN FD Linux驱动与SocketCAN

> 所属章节：第五部 B. 总线协议 > B-C.9 CAN总线
>
> 难度：[E] Expert / [M] Master | 预计阅读时间：45分钟

## <span class="blue"> 本节导读

前面我们从电气层认识了CAN FD的物理信号，从协议层理解了帧格式与位定时。但这些都是"纸上谈兵"——真正的嵌入式工程师需要在Linux里把CAN FD用起来：收发数据、抓包分析、对接汽车ECU。

本节带你打通从内核到用户空间的完整CAN FD链路。我们会深入Linux CAN子系统的三层架构，掌握SocketCAN这套堪称完美的BSD socket兼容接口，学会用can-utils工具链调试总线，并最终实现一个**汽车OBD-II诊断程序**——用SocketCAN发送诊断请求、读取发动机转速、解析J1939协议。读完本节，你的CAN FD技能就从"知道"跃升到"能用"了。

<br>

---

## <span class="blue"> 知识点331：Linux CAN子系统与SocketCAN [E][M]

### Linux CAN子系统三层架构

Linux内核的CAN子系统设计得非常精巧，采用了清晰的三层架构，让驱动开发者、协议开发者和应用开发者各司其职：

```
┌─────────────────────────────────────────────┐
│              用户空间 (User Space)             │
│    candump  cansend  canbusload  自定义应用    │
├─────────────────────────────────────────────┤
│  SocketCAN核心层 (net/can/)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │can_proto │  │can_dev   │  │af_can.c  │   │
│  │(协议族)   │  │(网络设备) │  │(地址族)  │   │
│  └──────────┘  └──────────┘  └──────────┘   │
│       ↑              ↑             ↑          │
│  raw/bcm/isotp    net_device   PF_CAN socket │
├─────────────────────────────────────────────┤
│           CAN控制器驱动层 (Drivers)            │
│     mcp251xfd.c   flexcan.c  gs_usb.c       │
│         ↑              ↑           ↑         │
│    SPI控制器      SoC内置      USB-CAN      │
├─────────────────────────────────────────────┤
│           硬件层 (Hardware)                   │
│      MCP2517FD      i.MX RT      CANable    │
└─────────────────────────────────────────────┘
```

**can_proto** — CAN协议族实现，包括`CAN_RAW`、`CAN_BCM`、`CAN_ISOTP`等。`CAN_RAW`是最常用的原始套接字模式，让你直接收发CAN帧。`CAN_BCM`（Broadcast Manager）提供周期性发送和接收过滤，`CAN_ISOTP`实现ISO-TP传输层（用于UDS诊断）。

**can_dev** — CAN网络设备核心层。每个CAN控制器在Linux中都表现为一个`net_device`（如`can0`、`can1`），你可以用标准网络工具`ip`、`ifconfig`来配置它。`can_dev`提供了统一的`struct can_priv`私有数据结构、位定时计算函数、错误帧处理等通用逻辑。

**af_can.c** — CAN地址族实现，将CAN接口注册到BSD socket体系中，让CAN能用标准的`sockaddr_can`地址结构。

> 💡 **提示**：SocketCAN的设计哲学是"CAN即网络"。把CAN总线看成一种特殊的网络接口，你就能复用Linux网络子系统的全部基础设施——netlink、ethtool、网络命名空间，甚至tcpdump的同胞兄弟candump。

<br>

### SocketCAN：标准BSD Socket接口（PF_CAN）

SocketCAN是Linux CAN子系统最 brilliant 的设计。它让CAN通信看起来像普通的网络编程：

| 方面 | 传统CAN驱动 | SocketCAN |
|------|-----------|-----------|
| 接口风格 | read()/write() 或 ioctl | socket()/send()/recv() |
| 地址表示 | 自定义结构 | `sockaddr_can` |
| 多应用访问 | 独占设备节点 | 多进程同时bind |
| 过滤器 | 内核固定 | 用户空间动态设置 |
| 工具链 | 自己写 | candump/cansend等 |

创建CAN socket的方式和TCP/IP socket几乎一模一样：

```c
// 创建CAN RAW socket
int s = socket(PF_CAN, SOCK_RAW, CAN_RAW);

// 绑定到can0接口
struct sockaddr_can addr;
addr.can_family = AF_CAN;
addr.can_ifindex = if_nametoindex("can0");
bind(s, (struct sockaddr *)&addr, sizeof(addr));
```

看到没？唯一的区别就是`PF_CAN`替换了`PF_INET`，`AF_CAN`替换了`AF_INET`。其余的发送、接收、select/poll/epoll，全部通用。

<br>

### can_frame结构体（CAN 2.0）

CAN 2.0的帧结构定义在`<linux/can.h>`：

```c
struct can_frame {
    canid_t can_id;   /* 32-bit CAN ID + EFF/RTR/ERR标志 */
    __u8    can_dlc;  /* 数据长度码 0~8 */
    __u8    __pad;    /* 填充 */
    __u8    __res0;   /* 保留 */
    __u8    __res1;   /* 保留 */
    __u8    data[8] __attribute__((aligned(8))); /* 数据 payload */
};
```

`can_id`字段不是简单的ID，它通过位域承载了多种标志：

| 标志宏 | 值 | 含义 |
|--------|-----|------|
| `CAN_EFF_FLAG` | 0x80000000 | 扩展帧（29-bit ID） |
| `CAN_RTR_FLAG` | 0x40000000 | 远程请求帧 |
| `CAN_ERR_FLAG` | 0x20000000 | 错误帧（内核回传） |
| `CAN_SFF_MASK` | 0x000007FF | 标准帧ID掩码（11-bit） |
| `CAN_EFF_MASK` | 0x1FFFFFFF | 扩展帧ID掩码（29-bit） |

**重要**：判断帧类型时，永远用位运算检查标志，而不是直接比较`can_id`：

```c
// ✅ 正确：检查是否为扩展帧
if (frame.can_id & CAN_EFF_FLAG) {
    printf("Extended ID: 0x%08X\n", frame.can_id & CAN_EFF_MASK);
}

// ❌ 错误：直接用can_id判断
if (frame.can_id == 0x123)  /* 如果接收到扩展帧会漏掉！ */
```

<br>

### canfd_frame结构（CAN FD）

CAN FD的帧结构在`<linux/can.h>`中定义，和`can_frame`不同，它可以携带最多64字节数据：

```c
struct canfd_frame {
    canid_t can_id;   /* 32-bit CAN ID + EFF/RTR/ERR标志 */
    __u8    len;      /* 数据长度 0~64（注意不是can_dlc！） */
    __u8    flags;    /* CAN FD标志：BRS/ESI */
    __u8    __res0;   /* 保留 */
    __u8    __res1;   /* 保留 */
    __u8    data[64] __attribute__((aligned(8))); /* 数据 payload */
};
```

`flags`字段是CAN FD的关键，它决定了帧在高速段的行为：

| 标志宏 | 值 | 全称 | 功能 |
|--------|-----|------|------|
| `CANFD_BRS` | 0x01 | Bit Rate Switch | 启用数据段波特率切换（数据段用更快的速率） |
| `CANFD_ESI` | 0x02 | Error State Indicator | 发送节点处于被动错误状态 |
| `CANFD_FDF` | 0x04 | FD Format | FD格式帧标志（内核内部使用） |

> ⚠️ **陷阱**：`CANFD_BRS`标志**必须在发送时正确设置**。如果你配置了CAN FD模式（`fd on`），但发送时没设置`CANFD_BRS`，帧会以仲裁段波特率发送整个帧，对方可能无法识别这是FD帧。反过来，如果对方只支持CAN 2.0，你发了带BRS的FD帧，它会当作格式错误触发错误帧。

启用CAN FD接收需要在socket上设置选项：

```c
int enable_fd = 1;
setsockopt(s, SOL_CAN_RAW, CAN_RAW_FD_FRAMES,
           &enable_fd, sizeof(enable_fd));
```

<br>

### can-utils工具链

can-utils是一套开源的CAN调试工具，每个嵌入式Linux工程师都应该熟记于心。

| 命令 | 功能 | 语法 | 示例 |
|------|------|------|------|
| `candump` | 实时抓包显示 | `candump [选项] <接口>` | `candump -ta -x can0` |
| `cansend` | 发送单帧 | `cansend <接口> <ID>#<数据>` | `cansend can0 123#DEADBEEF` |
| `cangen` | 生成测试流量 | `cangen [选项] <接口>` | `cangen -e -I 0x100 -L 8 -v can0` |
| `canbusload` | 计算总线负载 | `canbusload <接口>@<波特率>` | `canbusload can0@500000` |
| `cansniffer` | 差分嗅探（仅变化显示） | `cansniffer <接口>` | `cansniffer can0` |
| `cansequence` | 发送递增序列帧 | `cansequence [选项] <接口>` | `cansequence -p can0` |

> 💡 **提示**：`candump -ta -x can0`是排查时序问题的利器。`-t a`显示绝对时间戳（带微秒），`-x`以十六进制显示，加上`-e`可以显示扩展帧。组合成`candump -taex can0`，你就能看到**精确到微秒**的收发时序——这在排查CAN总线仲裁冲突或诊断超时问题时 invaluable。

**candump输出格式解读**：

```bash
$ candump -ta -x can0
 (1715623456.123456)  can0  RX -   123   [8]  DE AD BE EF 01 02 03 04
 (1715623456.234567)  can0  TX -   7DF   [8]  02 01 0C 00 00 00 00 00
#  ↑时间戳(秒.微秒)    ↑接口  ↑方向  ↑ID  ↑len ↑数据(HEX)
```

<br>

---

## <span class="blue"> 知识点332：CAN FD配置与dbc文件解析 [E]

### ip link配置CAN FD

在Linux中，CAN接口就是网络接口，用`ip link`命令配置。CAN FD需要设置两个波特率：仲裁段波特率（`bitrate`）和数据段波特率（`dbitrate`）。

```bash
# 关闭接口
ip link set can0 down

# 配置CAN FD：仲裁段500kbps，数据段2Mbps，启用FD模式
ip link set can0 type can bitrate 500000 dbitrate 2000000 fd on

# 启动接口
ip link set can0 up
```

**CAN FD采样点配置**（精确到位定时）：

```bash
# 自定义采样点（推荐仲裁段75%、数据段70%）
ip link set can0 type can \
    bitrate 500000 sample-point 0.75 \
    dbitrate 2000000 dsample-point 0.70 \
    fd on
```

验证配置：

```bash
$ ip -details link show can0
2: can0: <NOARP,UP,LOWER_UP,ECHO> mtu 72 qdisc pfifo_fast state UP
    link/can  promiscuity 0 minmtu 0 maxmtu 0
    can <FD> state ERROR-ACTIVE
    bitrate 500000 sample-point 0.750
    tq 25 prop-seg 34 phase-seg1 35 phase-seg2 20 sjw 10
    mcp251xfd: tseg1 2..256 tseg2 1..128 sjw 1..128
    dbitrate 2000000 dsample-point 0.700
    dtq 25 dprop-seg 7 dphase-seg1 8 dphase-seg2 4 dsjw 4
    mcp251xfd: dtseg1 1..32 dtseg2 1..16 dsjw 1..16
    clock 40000000   ← 确认CAN控制器时钟频率
    re-started bus-errors arbit-lost error-warn error-pass bus-off
    0          0          0          0          0          0
    RX: bytes  packets  errors  dropped  overrun  mcast
    128        16       0       0        0        0
    TX: bytes  packets  errors  dropped  carrier  collsns
    64         8        0       0        0        0
```

关键字段解读：`can <FD> state ERROR-ACTIVE`确认FD模式已启用；`ERROR-ACTIVE`表示节点处于主动错误状态，可以正常收发。如果看到`ERROR-PASSIVE`或`BUS-OFF`，说明总线有严重问题。

> 🔴 **危险**：CAN接口的MTU在CAN FD模式下是**72字节**（标准CAN是16字节）。这个MTU包含了`struct canfd_frame`的全部空间。如果你用CAN FD socket但没设置正确的MTU，内核会截断或拒绝大于8字节的数据帧。

<br>

### dbc文件解析（CAN Database）

DBC文件是CAN网络的数据库描述文件，定义了每条CAN消息的信号名称、起始位、长度、缩放因子、偏移量等。 automotive工程师几乎天天和dbc打交道。

一个典型的DBC片段：

```
BO_ 100 EngineData: 8 ECM
 SG_ EngineSpeed : 0|16@1+ (0.25,0) [0|16383] "rpm" Vector__XXX
 SG_ EngineTemp  : 16|8@1+ (1,-40) [-40|215] "degC" Vector__XXX
```

这表示：消息ID 0x100（"EngineData"），8字节，发送节点ECM。包含两个信号：
- `EngineSpeed`：从bit 0开始，16位，Intel字节序（`@1`），无符号（`+`），缩放因子0.25，偏移0，单位rpm
- `EngineTemp`：从bit 16开始，8位，缩放因子1，偏移-40，单位degC

**物理值计算公式**：`物理值 = 原始值 × 缩放因子 + 偏移量`

用Python解析dbc文件（基于cantools库）：

```python
#!/usr/bin/env python3
"""dbc文件解析示例 — OBD-II诊断数据"""
import cantools
import struct

# 加载DBC文件
db = cantools.database.load_file('obd2.dbc')

# 查找PID 0x0C (发动机转速)的消息定义
msg = db.get_message_by_name('OBD2_EngineSpeed')
print(f"Message: {msg.name}, ID=0x{msg.frame_id:X}, DLC={msg.length}")
for sig in msg.signals:
    print(f"  Signal: {sig.name}, start={sig.start}, len={sig.length}, "
          f"scale={sig.scale}, offset={sig.offset}, unit={sig.unit}")

# 解码CAN帧数据
# 假设收到OBD-II响应: 0x7E8  [04 41 0C 1B 56 00 00 00]
# 其中 0x41=模式01应答, 0x0C=PID, 0x1B56=转速原始值
can_data = bytes([0x04, 0x41, 0x0C, 0x1B, 0x56, 0x00, 0x00, 0x00])

# 手动解析（对应OBD-II PID 0x0C）
raw_value = struct.unpack('>H', can_data[3:5])[0]  # big-endian 16-bit
engine_speed_rpm = raw_value * 0.25  # OBD-II标准缩放因子
print(f"\nEngine Speed = {raw_value} * 0.25 = {engine_speed_rpm:.1f} rpm")
```

<br>

### Bus Load计算

CAN总线负载率是衡量总线健康状况的核心指标。计算方法：

$$\text{Bus Load} = \frac{\text{实际传输位数}}{\text{总线时间} \times \text{波特率}} \times 100\%$$

用`canbusload`实时监控：

```bash
$ canbusload can0@500000
can0@500000  125  1000  5000  12.5%  ████
#           ↑帧/s ↑bits/s ↑max  ↑负载  ↑柱状图
```

**CAN FD帧的位长度计算**（影响bus load精确计算）：

| 帧部分 | 仲裁段（500k） | 数据段（2M，BRS启用） |
|--------|--------------|-------------------|
| SOF + ID + RTR | 固定长度 | — |
| Control Field | 固定位 | 固定位（含FDF/BRS/ESI） |
| Data Field | — | 每字节8位（2M下更快） |
| CRC Field | — | 根据数据长度变化（17或21位） |
| ACK + EOF | 固定长度 | — |

> 💡 **提示**：CAN FD的bus load通常比CAN 2.0低，因为数据段用更快的波特率传输。一段64字节的CAN FD帧，虽然数据量是CAN 2.0的8倍，但传输时间可能只增加30-40%。这就是为什么汽车网络升级FD后，带宽提升远超64/8=8倍。

<br>

---

## <span class="blue"> 行业实例：汽车OBD-II CAN FD数据读取 + J1939协议解析

### 场景描述

你正在开发一个**车队远程监控终端**，需要读取商用车的发动机数据并通过4G上传云端。车辆同时支持OBD-II诊断（CAN FD 500k/2M）和J1939重型车辆协议。终端硬件是i.MX8M + MCP2517FD CAN控制器。

**接线**：
- MCP2517FD SPI接口 → i.MX8M SPI3
- CANH/CANL → 车辆OBD-II端口（Pin 6: CANH, Pin 14: CANL）
- 终端电阻 120Ω（车辆端通常已内置）

<br>

### OBD-II诊断协议

OBD-II（On-Board Diagnostics II）是汽车标准诊断协议，通过CAN总线访问ECU。

| PID | 名称 | 数据格式 | 单位 | 计算公式 |
|-----|------|----------|------|----------|
| 0x0C | 发动机转速 | 2字节无符号 | rpm | `(A*256+B) * 0.25` |
| 0x0D | 车速 | 1字节无符号 | km/h | `A` |
| 0x05 | 冷却液温度 | 1字节有符号 | °C | `A - 40` |
| 0x2F | 燃油液位 | 1字节无符号 | % | `A * 100/255` |
| 0x5C | 机油温度 | 1字节有符号 | °C | `A - 40` |
| 0x4F | 燃油系统状态 | 位域 | - | 详见标准 |
| 0x5B | 混合气续航里程 | 2字节无符号 | km | `(A*256+B)` |

OBD-II标准CAN ID：
- **请求ID**: `0x7DF`（广播给所有ECU）
- **ECU响应ID**: `0x7E8` ~ `0x7EF`（各ECU单独回复）

请求帧格式：`[数据长度] [模式] [PID] [填充]`
- 模式`01` = 当前数据请求
- 模式`02` = 冻结帧数据

<br>

### J1939协议简介

J1939是商用车辆（卡车、工程机械）的CAN应用层协议，使用**29位扩展ID**：

```
J1939 29-bit标识符结构：
┌─────────┬─────────┬───────┬──────────┬────────┐
│ Priority│  Rsvd   │  DP   │ PDU Fmt  │ PDU Sp │
│ 3 bits  │  1 bit  │ 1 bit │  8 bits  │ 8 bits │
├─────────┴─────────┴───────┴──────────┴────────┤
│                   Source Address (8 bits)       │
└─────────────────────────────────────────────────┘
                          ↓
PGN = (PDU Format << 8) | (PDU Specific)  （对于PDU1格式，不含目标地址）
```

常见J1939 PGN：

| PGN | 名称 | 数据内容 | 更新频率 |
|-----|------|----------|----------|
| 61444 (0xF004) | Electronic Engine Controller 1 | 转速、扭矩 | 10ms |
| 61443 (0xF003) | Electronic Engine Controller 2 | 油门百分比 | 10ms |
| 65262 (0xFEEE) | Engine Temperature 1 | 温度 | 1s |
| 65271 (0xFEF7) | Vehicle Electrical Power | 电压、电流 | 1s |

<br>

### 完整SocketCAN代码

```c
/* ============================================================================
 * obd2_canfd_reader.c — OBD-II CAN FD诊断数据读取程序
 *
 * 功能：
 *   1. 创建CAN FD socket，绑定到can0
 *   2. 发送OBD-II诊断请求（模式01，PID 0x0C转速）
 *   3. 接收ECU响应，解析发动机转速
 *   4. 同时监听J1939 PGN 61444（发动机控制信息）
 *
 * 编译：gcc -o obd2_reader obd2_canfd_reader.c
 * 运行：sudo ./obd2_reader
 * ============================================================================ */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <linux/can.h>
#include <linux/can/raw.h>

/* OBD-II标准ID定义 */
#define OBD2_REQ_ID     0x7DF   /* OBD-II诊断请求（广播） */
#define OBD2_RESP_ECU1  0x7E8   /* ECU #1 响应 */

/* J1939优先级掩码 */
#define J1939_PRIORITY_MASK  0x1C000000
#define J1939_PGN_MASK       0x03FFFF00
#define J1939_SA_MASK        0x000000FF

static void print_hex(const char *label, const __u8 *data, __u8 len)
{
    printf("%s [%d] ", label, len);
    for (int i = 0; i < len; i++)
        printf("%02X ", data[i]);
    printf("\n");
}

/* 发送OBD-II诊断请求 */
static int send_obd2_request(int sock, __u8 mode, __u8 pid)
{
    struct canfd_frame tx;

    memset(&tx, 0, sizeof(tx));
    tx.can_id = OBD2_REQ_ID;
    tx.len = 8;           /* OBD-II固定8字节 */
    tx.flags = CANFD_BRS; /* 启用数据段高速率 */

    /* OBD-II单帧格式：长度 + 模式 + PID + 填充 */
    tx.data[0] = 0x02;    /* 实际有效数据长度（不含填充） */
    tx.data[1] = mode;    /* 诊断模式 */
    tx.data[2] = pid;     /* PID编号 */
    /* data[3..7] 保持0x00（填充） */

    int nbytes = write(sock, &tx, sizeof(tx));
    if (nbytes != sizeof(tx)) {
        perror("write");
        return -1;
    }

    printf("[TX] OBD2 Request: Mode 0x%02X, PID 0x%02X\n", mode, pid);
    return 0;
}

/* 解析OBD-II响应数据 */
static void parse_obd2_response(const struct canfd_frame *rx)
{
    __u8 resp_len = rx->data[0];       /* 响应数据长度 */
    __u8 resp_mode = rx->data[1];      /* 应答模式（请求模式+0x40） */
    __u8 resp_pid = rx->data[2];       /* PID */

    /* 模式01应答 = 0x41 */
    if (resp_mode != 0x41) {
        printf("  Unknown response mode: 0x%02X\n", resp_mode);
        return;
    }

    switch (resp_pid) {
    case 0x0C: {  /* 发动机转速 */
        unsigned raw = (rx->data[3] << 8) | rx->data[4];
        double rpm = raw * 0.25;
        printf("  [PID 0x0C] Engine Speed = %.1f rpm (raw=%d)\n", rpm, raw);
        break;
    }
    case 0x0D: {  /* 车速 */
        printf("  [PID 0x0D] Vehicle Speed = %d km/h\n", rx->data[3]);
        break;
    }
    case 0x05: {  /* 冷却液温度 */
        int temp = (int)rx->data[3] - 40;
        printf("  [PID 0x05] Coolant Temp = %d °C\n", temp);
        break;
    }
    default:
        printf("  [PID 0x%02X] Data: ", resp_pid);
        for (int i = 3; i < 3 + resp_len - 2; i++)
            printf("%02X ", rx->data[i]);
        printf("\n");
    }
}

/* 解析J1939帧 */
static void parse_j1939_frame(const struct canfd_frame *rx)
{
    /* 检查是否为扩展帧 */
    if (!(rx->can_id & CAN_EFF_FLAG))
        return;

    canid_t id = rx->can_id & CAN_EFF_MASK;
    __u8 priority = (id >> 26) & 0x07;
    __u32 pgn = (id >> 8) & 0x03FFFF;
    __u8 sa = id & 0xFF;

    /* 我们只关心PGN 61444 (0xF004) - Engine Controller 1 */
    if (pgn != 0xF004)
        return;

    /* J1939-71 定义：Engine Speed在字节4-5，0.125 rpm/bit */
    if (rx->len >= 6) {
        unsigned raw = (rx->data[3] << 8) | rx->data[4];  /* bytes 4-5 */
        /* 特殊值 0xFFFF = 无效 */
        if (raw != 0xFFFF) {
            double rpm = raw * 0.125;
            printf("[J1939 PGN 0xF004] SA=0x%02X Engine Speed = %.3f rpm\n",
                   sa, rpm);
        }
    }
}

int main(int argc, char *argv[])
{
    const char *ifname = "can0";
    int sock;
    struct sockaddr_can addr;
    struct ifreq ifr;
    struct can_filter rfilter[2];

    printf("=== OBD-II CAN FD Diagnostic Reader ===\n");
    printf("Interface: %s\n\n", ifname);

    /* 1. 创建CAN FD socket */
    sock = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (sock < 0) {
        perror("socket");
        return 1;
    }

    /* 2. 启用CAN FD模式 */
    int enable_fd = 1;
    if (setsockopt(sock, SOL_CAN_RAW, CAN_RAW_FD_FRAMES,
                   &enable_fd, sizeof(enable_fd)) < 0) {
        perror("setsockopt CAN_RAW_FD_FRAMES");
        close(sock);
        return 1;
    }

    /* 3. 绑定到can0接口 */
    memset(&addr, 0, sizeof(addr));
    addr.can_family = AF_CAN;
    strncpy(ifr.ifr_name, ifname, IFNAMSIZ - 1);
    if (ioctl(sock, SIOCGIFINDEX, &ifr) < 0) {
        perror("ioctl SIOCGIFINDEX");
        close(sock);
        return 1;
    }
    addr.can_ifindex = ifr.ifr_ifindex;

    if (bind(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(sock);
        return 1;
    }

    /* 4. 设置接收过滤器（减少用户空间负载） */
    /* 过滤器0：接收OBD-II响应 0x7E8 */
    rfilter[0].can_id   = OBD2_RESP_ECU1 | CAN_EFF_FLAG;
    rfilter[0].can_mask = (CAN_EFF_MASK | CAN_RTR_FLAG | CAN_EFF_FLAG);
    /* 过滤器1：接收J1939扩展帧（PGN 0xF004, SA任意）*/
    rfilter[1].can_id   = (0x18F00400 | CAN_EFF_FLAG); /* priority=3 */
    rfilter[1].can_mask = (CAN_EFF_MASK & ~0x000000FF); /* 不过滤SA */

    if (setsockopt(sock, SOL_CAN_RAW, CAN_RAW_FILTER,
                   rfilter, sizeof(rfilter)) < 0) {
        perror("setsockopt CAN_RAW_FILTER");
        /* 非致命错误，继续运行（接收所有帧） */
        printf("Warning: Failed to set filter, receiving all frames\n");
    }

    /* 5. 发送OBD-II诊断请求 */
    printf("--- Sending OBD-II requests ---\n");
    send_obd2_request(sock, 0x01, 0x0C);  /* 发动机转速 */
    usleep(100000);  /* 等待ECU响应（100ms） */
    send_obd2_request(sock, 0x01, 0x0D);  /* 车速 */
    usleep(100000);
    send_obd2_request(sock, 0x01, 0x05);  /* 冷却液温度 */

    /* 6. 持续接收响应和J1939广播 */
    printf("\n--- Listening for responses (Ctrl+C to stop) ---\n");
    struct canfd_frame rx;
    while (1) {
        int nbytes = read(sock, &rx, sizeof(rx));
        if (nbytes < 0) {
            perror("read");
            break;
        }

        /* 判断收到的是can_frame还是canfd_frame */
        if (nbytes == CAN_MTU) {
            /* CAN 2.0 frame (16 bytes) */
            printf("\n[RX] CAN 2.0 ID=0x%03X  ", rx.can_id & CAN_SFF_MASK);
        } else if (nbytes == CANFD_MTU) {
            /* CAN FD frame (72 bytes) */
            printf("\n[RX] CAN FD  ID=0x%08X  flags=%02X  ",
                   rx.can_id & CAN_EFF_MASK, rx.flags);
        }

        print_hex("", rx.data, rx.len);

        /* 按ID分类处理 */
        canid_t eff_id = rx.can_id & CAN_EFF_MASK;
        if ((eff_id >= 0x7E8 && eff_id <= 0x7EF) && !(rx.can_id & CAN_ERR_FLAG)) {
            parse_obd2_response(&rx);
        } else if (rx.can_id & CAN_EFF_FLAG) {
            parse_j1939_frame(&rx);
        }
    }

    close(sock);
    return 0;
}
```

<br>

### 验证步骤

**步骤1：确认CAN接口状态**

```bash
# 查看接口详情（确认FD模式和波特率）
ip -details link show can0

# 预期输出包含：can <FD> state ERROR-ACTIVE
```

**步骤2：用candump抓包**

```bash
# 终端1：抓所有CAN帧（带时间戳、十六进制、扩展帧显示）
sudo candump -taex can0

# 预期输出：
# (1715623456.123456)  can0  TX - -  7DF   [8]  02 01 0C 00 00 00 00 00
# (1715623456.234567)  can0  RX - -  7E8   [8]  04 41 0C 1B 56 00 00 00
#                     ↑请求          ↑响应: 0x1B56*0.25=1758.5rpm
```

**步骤3：用cansend手动测试**

```bash
# 发送OBD-II发动机转速请求（模拟OBD2_reader的行为）
sudo cansend can0 7DF#02010C0000000000

# 如果是CAN FD接口，发送FD帧（带BRS标志）
sudo cansend -b can0 7DF##10210C0000000000
#              ↑-b = 启用CAN FD BRS
```

**步骤4：监控总线负载**

```bash
# 实时监控can0的总线负载
sudo canbusload can0@500000

# 预期：正常OBD-II诊断流量负载 < 5%
# 如果持续 > 70%，检查是否有设备在广播大数据量帧
```

**步骤5：确认收到的数据**

```bash
# 只过滤OBD-II响应ID
sudo candump -ta can0,7E8:7FF

# 只过滤J1939 PGN 0xF004（发动机数据）
sudo candump -ta can0,18F00400:D0FFFF00
```

<br>

---

## <span class="blue"> SocketCAN API速查表

| 函数 | 功能 | 关键参数 | 示例 |
|------|------|----------|------|
| `socket()` | 创建CAN socket | `PF_CAN, SOCK_RAW, CAN_RAW` | `socket(PF_CAN, SOCK_RAW, CAN_RAW)` |
| `setsockopt()` | 启用FD模式 | `CAN_RAW_FD_FRAMES` | 见上方代码 |
| `setsockopt()` | 设置接收过滤器 | `CAN_RAW_FILTER` | `struct can_filter`数组 |
| `setsockopt()` | 设置环回 | `CAN_RAW_LOOPBACK` | 禁用自发自收 |
| `bind()` | 绑定到接口 | `sockaddr_can` + ifindex | `if_nametoindex("can0")` |
| `write()`/`send()` | 发送CAN帧 | `struct canfd_frame` | 返回发送字节数 |
| `read()`/`recv()` | 接收CAN帧 | `struct canfd_frame` | 返回帧大小判断类型 |
| `select()`/`poll()` | 多路复用 | fd + timeout | 标准网络编程模式 |
| `ioctl(SIOCGIFINDEX)` | 获取接口索引 | `struct ifreq` | 替代`if_nametoindex` |
| `ioctl(SIOCSCANBAUDRATE)` | 设置波特率 | `struct can_bittiming` | 旧接口，推荐ip link |

<br>

---

## <span class="blue"> 本节总结

| 主题 | 核心要点 | 易错点 |
|------|----------|--------|
| CAN子系统架构 | can_proto + can_dev + af_can三层；CAN即网络设备 | 不要把CAN当字符设备用open/read |
| CAN vs CAN FD帧 | `can_frame` data[8] / `canfd_frame` data[64] | `can_frame`用can_dlc，`canfd_frame`用len |
| CAN FD flags | `CANFD_BRS`启用高速段；`CANFD_ESI`错误状态 | 不设置BRS会导致FD帧以低速发送 |
| SocketCAN编程 | PF_CAN + setsockopt启用FD + bind接口 | 忘记CAN_RAW_FD_FRAMES选项 |
| OBD-II诊断 | 请求0x7DF，响应0x7E8+；PID 0x0C读转速 | 响应模式是请求模式+0x40 |
| J1939协议 | 29-bit扩展ID，PGN标识消息类型 | PGN提取时注意PDU1/PDU2格式区别 |
| dbc解析 | 物理值 = 原始值 × scale + offset | 字节序（Intel/Motorola）搞反 |
| 调试工具 | candump/cansend/canbusload三剑客 | candump不加-ta丢失时间信息 |

<br>

---

## <span class="blue"> 下一步

掌握了SocketCAN编程和OBD-II诊断，你已经能读取车辆数据了。但在工业自动化领域，CAN总线还有一套更成熟的协议栈——**CANopen**。

下一节 **B-C.9.4 CANopen协议对象字典与NMT**，我们将学习：

- CANopen的对象字典（OD）概念与SDO/PDO通信
- NMT节点管理（启动/停止/复位）
- PDO映射：如何用SocketCAN实现CANopen主站
- 工业伺服电机控制实例：CiA 402设备配置文件

CANopen是工业CAN网络的"操作系统"，理解它，你的CAN技能就覆盖了汽车和工业两大领域。

<br>

---

## <span class="blue"> 配套资源

**推荐阅读**
- Linux内核文档：`Documentation/networking/can.rst`
- SocketCAN用户手册：`https://github.com/linux-can/can-docs`
- OBD-II标准：SAE J1979（诊断服务定义）
- J1939标准：SAE J1939-21（数据链路层）、J1939-71（应用层）
- CiA 1301：CAN FD协议规范

**推荐工具安装**
```bash
# can-utils工具链
sudo apt-get install can-utils

# Python CAN库 + dbc解析
pip install python-can cantools

# 交互式CAN总线分析
pip install canalyser
```

**调试命令速查卡**
```bash
# 接口配置
ip link set can0 down
ip link set can0 type can bitrate 500000 dbitrate 2000000 fd on
ip link set can0 up

# 抓包与监控
candump -taex can0              # 全功能抓包
candump -ta can0,123:7FF        # 按ID过滤
canbusload can0@500000          # 总线负载

# 发送测试帧
cansend can0 123#DEADBEEF       # 标准CAN
cansend -b can0 123##1AABBCCDD  # CAN FD + BRS

# 生成流量
cangen -e -I 0x100 -L 8 -v can0  # 扩展帧，ID 0x100，8字节
```
