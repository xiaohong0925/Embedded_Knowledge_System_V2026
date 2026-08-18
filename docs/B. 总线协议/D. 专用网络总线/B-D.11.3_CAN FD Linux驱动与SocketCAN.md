# B-D.11.3 CAN FD Linux 驱动与 SocketCAN

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：50 分钟

## 本节导读

前两节讲了 CAN FD 的物理层和协议层，本节把它落到 Linux 系统里。Linux 的 CAN 子系统（SocketCAN）把 CAN 控制器抽象成标准网络设备，用 BSD socket 接口收发 CAN 帧——`socket()`、`bind()`、`send()`、`recv()`、`epoll` 全套网络编程模型直接复用。这是与字符设备型驱动完全不同的范式，理解了这个抽象，CAN 应用开发就只剩网络编程的基本功。

本节覆盖：SocketCAN 三层架构与各层职责、`can_frame`/`canfd_frame` 结构与标志位、`ip link` 配置 CAN FD 的完整参数、can-utils 工具链的实际用法、DBC 文件与信号解析、一个同时处理 OBD-II 诊断和 J1939 广播的完整程序、SocketCAN 层的常见故障定位。

## SocketCAN 三层架构

```
 ┌────────────────────────────────────────────┐
 │ 用户空间：candump  cansend  canbusload  应用程序 │
 ├────────────────────────────────────────────┤
 │ SocketCAN 核心（net/can/）                    │
 │   af_can.c      can_proto        can_dev      │
 │   PF_CAN 地址族  RAW/BCM/ISOTP   网络设备抽象   │
 ├────────────────────────────────────────────┤
 │ 控制器驱动（drivers/net/can/）                 │
 │   m_can/   flexcan.c   mcp251xfd.c   gs_usb.c │
 │   SoC 内置   NXP SoC    SPI 外置     USB 适配器│
 ├────────────────────────────────────────────┤
 │ 硬件：CAN 控制器 + CAN 收发器                  │
 └────────────────────────────────────────────┘
```

各层职责：

- **af_can.c**：把 CAN 注册为一个协议地址族（`PF_CAN`/`AF_CAN`），提供 `sockaddr_can` 地址结构。应用层看到的是 socket，不是设备节点。
- **协议模块**：`CAN_RAW` 是原始帧收发，最常用；`CAN_BCM`（Broadcast Manager）在内核里做周期发送和消息内容变更过滤，省得应用自己起定时器；`CAN_ISOTP` 实现 ISO-TP 分段传输，UDS 诊断的基础。
- **can_dev**：把每个 CAN 控制器注册为 `net_device`（`can0`、`can1`），提供统一的位定时计算、错误帧处理、Bus-Off 恢复管理。因为是标准网络设备，`ip link`、netlink、网络命名空间全部可用。
- **控制器驱动**：对接具体硬件。SoC 内置控制器（如 i.MX 的 FlexCAN、Bosch M_CAN）、SPI 外置（MCP2517FD，走 `mcp251xfd.c`）、USB 适配器（`gs_usb.c`，如 CANable）在内核里呈现完全一致的接口。

> 💡
> SocketCAN 的多路复用是内核级的：多个进程可以同时 bind 到同一个 `can0`，各自设自己的接收过滤器，内核按过滤器分发帧。不需要自己写守护进程做帧分发。发送也是多路并发，内核排队仲裁。

## 帧结构：can_frame 与 canfd_frame

两个结构都定义在 `<linux/can.h>`：

```c
struct can_frame {              /* CAN 2.0，CAN_MTU = 16 字节 */
    canid_t can_id;             /* 32 位：ID + EFF/RTR/ERR 标志 */
    __u8    can_dlc;            /* 数据长度 0~8 */
    __u8    __pad;
    __u8    __res0;
    __u8    __res1;
    __u8    data[8] __attribute__((aligned(8)));
};

struct canfd_frame {            /* CAN FD，CANFD_MTU = 72 字节 */
    canid_t can_id;             /* 同上 */
    __u8    len;                /* 数据长度 0~64（真实字节数，不是 DLC 编码） */
    __u8    flags;              /* CANFD_BRS / CANFD_ESI */
    __u8    __res0;
    __u8    __res1;
    __u8    data[64] __attribute__((aligned(8)));
};
```

两个容易踩的差异：`can_frame` 用 `can_dlc` 字段名但存的也是真实长度（0~8 时 DLC 编码与长度相同）；`canfd_frame` 的 `len` 是真实字节数，与线上 DLC 编码的换算由内核完成，应用层永远不用碰 DLC 表。

`can_id` 的高位是标志位，判断帧类型必须用掩码与运算：

| 标志 | 值 | 含义 |
|:---|:---|:---|
| `CAN_EFF_FLAG` | 0x80000000 | 扩展帧（29 位 ID） |
| `CAN_RTR_FLAG` | 0x40000000 | 远程帧 |
| `CAN_ERR_FLAG` | 0x20000000 | 错误帧（控制器回传，需显式开启） |
| `CAN_SFF_MASK` | 0x000007FF | 标准帧 ID 掩码 |
| `CAN_EFF_MASK` | 0x1FFFFFFF | 扩展帧 ID 掩码 |

```c
/* 正确：位运算判断 */
if (frame.can_id & CAN_EFF_FLAG)
    printf("EFF ID: 0x%08X\n", frame.can_id & CAN_EFF_MASK);

/* 错误：直接相等比较会把带标志位的帧漏掉 */
if (frame.can_id == 0x123) { /* 扩展帧 0x123 永远匹配不上 */ }
```

`canfd_frame.flags` 的两个应用层可见标志：`CANFD_BRS`（发送时置位，数据段切高速；不置位则整帧走仲裁速率）、`CANFD_ESI`（接收方向标志，指示发送节点处于错误被动状态，可用于健康监控）。

接收 CAN FD 帧必须在 socket 上显式开启：

```c
int enable = 1;
setsockopt(s, SOL_CAN_RAW, CAN_RAW_FD_FRAMES, &enable, sizeof(enable));
```

不开启这个选项，socket 只能收发 16 字节的 `can_frame`，FD 帧会被内核过滤。

## 接口配置：ip link

CAN 接口用 `ip link` 配置，CAN FD 需要仲裁段和数据段两组参数：

```bash
ip link set can0 down
ip link set can0 type can \
    bitrate 500000  sample-point 0.75 \
    dbitrate 2000000 dsample-point 0.70 \
    fd on
ip link set can0 up
```

四个参数必须全网一致：`bitrate`（仲裁段波特率）、`sample-point`（仲裁段采样点）、`dbitrate`（数据段波特率）、`dsample-point`（数据段采样点）。采样点不写时驱动用内核推荐值（CIA 601 推荐仲裁段 87.5% 附近、数据段 70% 附近），但异构网络里显式写出来更安全。

验证与监控：

```bash
ip -details -statistics link show can0
```

关键输出解读：

```
 can <FD> state ERROR-ACTIVE          ← FD 模式已启用，错误主动状态
 bitrate 500000 sample-point 0.750
   tq 25 prop-seg 34 phase-seg1 35 phase-seg2 20 sjw 10
 dbitrate 2000000 dsample-point 0.700
 clock 40000000                        ← 控制器时钟，位定时计算的基准
 re-started bus-errors arbit-lost error-warn error-pass bus-off
   0          0          0           0          0          0
```

`state` 字段是健康检查第一眼要看的东西：`ERROR-ACTIVE` 正常，`ERROR-WARNING`（TEC/REC 超过 96）预警，`ERROR-PASSIVE` 降级，`BUS-OFF` 已退出总线。最后一行计数器里 `bus-off` 非零说明发生过总线关闭，要查恢复策略和历史日志。

> ⚠️
> CAN FD 模式下接口 MTU 是 72（`CANFD_MTU`），CAN 2.0 模式是 16（`CAN_MTU`）。读 socket 时用 `read()` 的返回值区分帧类型：16 字节是经典帧，72 字节是 FD 帧。缓冲区一律按 `struct canfd_frame` 分配，经典帧也能安全读进来。

## can-utils 工具链

| 命令 | 用途 | 常用形式 |
|:---|:---|:---|
| `candump` | 抓包显示 | `candump -taex can0`（绝对时间戳、扩展帧、十六进制） |
| `cansend` | 发单帧 | `cansend can0 123#11223344`；FD 帧 `cansend can0 123##3112233` |
| `cangen` | 生成测试流量 | `cangen can0 -I 0x100 -L 8 -g 10`（10 ms 周期） |
| `canbusload` | 总线负载率 | `canbusload can0@500000` |
| `cansniffer` | 按 ID 聚合、只显示变化字节 | `cansniffer can0` |
| `canfdtest` | FD 回环对测 | 双板各跑一端验证 FD 链路 |

cansend 的帧语法里 `##` 分隔符表示 FD 帧，其后第一位十六进制数是 flags：`##1` = BRS 置位，`##0` = BRS 不置位。candump 输出里 FD 帧的 DLC 后同样有这个标志位，例如 `123##3112233` 中 `##3` 表示 BRS+ESI。

> 💡
> 排时序问题用 `candump -ta`（微秒级绝对时间戳），不要用默认的相对时间戳。诊断类问题——比如"请求发出后 ECU 多久回"——有了绝对时间戳直接两帧相减。

## DBC 文件与信号解析

CAN 帧本身只是字节流，字节到物理量的映射由 DBC（CAN Database）文件描述。一段典型定义：

```
BO_ 256 EngineData: 8 ECM
 SG_ EngineSpeed : 0|16@1+ (0.25,0) [0|16383] "rpm" Vector__XXX
 SG_ EngineTemp  : 16|8@1+ (1,-40) [-40|215] "degC" Vector__XXX
```

读法：消息 `EngineData`，ID 0x100，8 字节，发送节点 ECM。信号 `EngineSpeed` 从第 0 位起 16 位，`@1` 是 Intel（小端）字节序，`+` 无符号，物理值 = 原始值 × 0.25 + 0，单位 rpm。`@0` 是 Motorola（大端）字节序——字节序看错是 DBC 解析最常见的 bug，表现为数值随真实值乱跳。

工程上不要手写位提取，用 cantools 解析：

```python
import cantools

db = cantools.database.load_file('vehicle.dbc')
msg = db.get_message_by_name('EngineData')

# 编码：物理量 → CAN 字节流
data = msg.encode({'EngineSpeed': 1758.5, 'EngineTemp': 85})
print(data.hex())          # 直接填进 can_frame.data

# 解码：CAN 字节流 → 物理量
decoded = msg.decode(bytes.fromhex('de06155d00000000'))
print(decoded)             # {'EngineSpeed': 1758.5, 'EngineTemp': 85.0}
```

## 完整实例：OBD-II 诊断 + J1939 监听

场景：车队监控终端读商用车数据，同时处理 OBD-II 诊断（11 位标准 ID）和 J1939 广播（29 位扩展 ID）。这个程序展示了 SocketCAN 的完整套路：建 socket、开 FD、bind、设过滤器、发请求、分类收帧。

OBD-II 约定：请求发到 `0x7DF`（广播），ECU 从 `0x7E8`~`0x7EF` 回复，应答模式字节 = 请求模式 + 0x40，常用 PID：0x0C 转速（`raw × 0.25` rpm）、0x0D 车速、0x05 冷却液温度（`raw − 40` °C）。

J1939 用 29 位扩展 ID，结构为「优先级 3b | 保留 1b | DP 1b | PF 8b | PS 8b | 源地址 8b」，PGN 取 ID 第 8~25 位。发动机转速在 PGN 61444（0xF004）的字节 4~5，分辨率 0.125 rpm/bit。

```c
/* obd2_j1939_reader.c — OBD-II 诊断请求 + J1939 广播监听
 * 编译：gcc -O2 -o obd2_reader obd2_j1939_reader.c
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <linux/can.h>
#include <linux/can/raw.h>

#define OBD2_REQ_ID    0x7DF
#define OBD2_RESP_BASE 0x7E8

static void send_obd2_request(int sock, __u8 mode, __u8 pid)
{
    struct canfd_frame tx = { 0 };

    tx.can_id = OBD2_REQ_ID;
    tx.len    = 8;
    tx.flags  = CANFD_BRS;          /* 数据段切高速 */
    tx.data[0] = 0x02;              /* ISO-TP 单帧：2 字节有效 */
    tx.data[1] = mode;
    tx.data[2] = pid;

    if (write(sock, &tx, sizeof(tx)) != sizeof(tx))
        perror("write");
}

static void parse_obd2_response(const struct canfd_frame *rx)
{
    if (rx->len < 5 || rx->data[1] != 0x41)   /* 模式 01 应答 = 0x40+0x01 */
        return;

    switch (rx->data[2]) {
    case 0x0C: {
        unsigned raw = (rx->data[3] << 8) | rx->data[4];
        printf("[OBD2] Engine Speed = %.1f rpm\n", raw * 0.25);
        break;
    }
    case 0x0D:
        printf("[OBD2] Vehicle Speed = %u km/h\n", rx->data[3]);
        break;
    case 0x05:
        printf("[OBD2] Coolant Temp = %d C\n", (int)rx->data[3] - 40);
        break;
    }
}

static void parse_j1939(const struct canfd_frame *rx)
{
    if (!(rx->can_id & CAN_EFF_FLAG))
        return;

    canid_t id  = rx->can_id & CAN_EFF_MASK;
    __u32   pgn = (id >> 8) & 0x3FFFF;
    __u8    sa  = id & 0xFF;

    if (pgn == 0xF004 && rx->len >= 6) {      /* EEC1：发动机转速 */
        unsigned raw = (rx->data[4] << 8) | rx->data[3];  /* 字节 4-5，小端 */
        if (raw != 0xFFFF)
            printf("[J1939] SA=0x%02X Engine Speed = %.3f rpm\n",
                   sa, raw * 0.125);
    }
}

int main(void)
{
    int s = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (s < 0) { perror("socket"); return 1; }

    int enable = 1;
    if (setsockopt(s, SOL_CAN_RAW, CAN_RAW_FD_FRAMES, &enable,
                   sizeof(enable)) < 0) {
        perror("setsockopt CAN_RAW_FD_FRAMES"); return 1;
    }

    struct ifreq ifr = { 0 };
    strncpy(ifr.ifr_name, "can0", IFNAMSIZ - 1);
    if (ioctl(s, SIOCGIFINDEX, &ifr) < 0) {
        perror("SIOCGIFINDEX"); return 1;
    }

    struct sockaddr_can addr = { 0 };
    addr.can_family  = AF_CAN;
    addr.can_ifindex = ifr.ifr_ifindex;
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind"); return 1;
    }

    /* 内核级过滤：只收 OBD-II 响应和 J1939 EEC1，其余帧不进用户态 */
    struct can_filter rfilter[2];
    rfilter[0].can_id   = OBD2_RESP_BASE;
    rfilter[0].can_mask = CAN_SFF_MASK & ~0x7;   /* 0x7E8~0x7EF */
    rfilter[1].can_id   = 0x18F00400 | CAN_EFF_FLAG;
    rfilter[1].can_mask = (CAN_EFF_MASK & ~0xFF) | CAN_EFF_FLAG;
    setsockopt(s, SOL_CAN_RAW, CAN_RAW_FILTER, rfilter, sizeof(rfilter));

    send_obd2_request(s, 0x01, 0x0C);
    send_obd2_request(s, 0x01, 0x0D);

    struct canfd_frame rx;
    for (;;) {
        int n = read(s, &rx, sizeof(rx));
        if (n < 0) { perror("read"); break; }

        if (rx.can_id & CAN_ERR_FLAG) {
            fprintf(stderr, "[ERR] error frame, class=0x%08X\n",
                    rx.can_id & CAN_ERR_MASK);
            continue;
        }
        if (n == CAN_MTU)                       /* 经典帧 */
            parse_obd2_response(&rx);
        else                                    /* FD 帧，72 字节 */
            parse_j1939(&rx);
    }
    close(s);
    return 0;
}
```

配套验证流程：

```bash
ip -details link show can0                  # 确认 can <FD> state ERROR-ACTIVE
candump -taex can0                          # 终端 1：抓包
cansend can0 7DF#02010C0000000000           # 终端 2：手动发转速请求
cansend can0 123##30210C                    # 发 FD 帧（BRS=0）
canbusload can0@500000                      # 负载率，诊断流量应 <5%
```

## 排障：SocketCAN 层故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| 程序收到空流量 | 接口未 up、波特率不匹配、过滤器设错 | `ip link show can0` 看 state；临时去掉过滤器再收 |
| 只收到经典帧收不到 FD 帧 | 漏设 `CAN_RAW_FD_FRAMES`，或接口没开 `fd on` | 检查 setsockopt 返回值；`ip -details link show` 确认 `<FD>` |
| read() 返回 16 但以为是 FD | 对端发的本来就是经典帧（BRS=0 的 FD 帧也是 72 字节） | candump 对比帧格式标志 |
| 帧 ID 解析全错 | 没用掩码去标志位 | 打印 `can_id` 原始值确认 EFF/RTR/ERR 标志 |
| DBC 解码数值乱跳 | 字节序（Intel/Motorola）或起始位理解错 | 用 cantools 的 encode/decode 交叉验证 |
| 发送报 ENOBUFS | 发送队列满：对端不应答导致帧堵在控制器里 | `ip -statistics` 看 TX dropped；candump 确认总线有节点应答 |
| 周期性出现错误帧 | 与 11.1/11.2 的物理层、协议层故障表交叉定位 | 开错误帧接收（`CAN_RAW_ERR_FILTER`）分析错误类别 |

接收错误帧是 SocketCAN 调试的进阶手段：默认错误帧不上送，用 `setsockopt(CAN_RAW_ERR_FILTER)` 打开后，用户态能拿到错误类别（位错误/填充错误/CRC 错误等）和出错位置，配合 11.2 的错误类型表可以直接定位到协议层哪一环。

## 本节自查

读完本节，你应能独立完成以下动作：

- 画出 SocketCAN 三层架构并说明每层职责，解释"CAN 是网络设备不是字符设备"带来的能力
- 写一个最小程序：开 socket、启用 FD、bind can0、发一帧带 BRS 的 64 字节 FD 帧
- 用 `ip link` 配出仲裁 500k/数据 2M、采样点 0.75/0.70 的 FD 接口，并从 `ip -details` 输出确认配置生效
- 用 cansend 的 `##` 语法发 FD 帧，用 candump 输出判断 BRS/ESI 状态
- 用 cantools 完成一次 DBC 编码和解码，指出字节序错误的表现
- 开 `CAN_RAW_ERR_FILTER` 接收错误帧，并把错误类别对应到五种协议错误

## 参考资料

- 内核文档：`Documentation/networking/can.rst`
- 内核源码：`include/uapi/linux/can.h`、`net/can/`、`drivers/net/can/mcp251xfd.c`
- 工具：can-utils（github.com/linux-can/can-utils）、python-can、cantools
- SAE J1979（OBD-II 诊断服务）、SAE J1939-21/71（商用车应用层）
