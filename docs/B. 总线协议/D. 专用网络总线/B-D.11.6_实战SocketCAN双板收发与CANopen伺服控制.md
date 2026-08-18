# B-D.11.6 实战：SocketCAN 双板收发 + CANopen 伺服控制

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[E] | 预计阅读时间：60 分钟

## 本节导读

11.1~11.5 把 CAN FD 与 CANopen 的机制讲完了，本篇把它们全部跑起来。上半段做链路层实战：两块板通过物理 CAN FD 总线互发，从接口配置、对测工具到错误注入，把"总线通了"这件事变成可重复验证的流程；没有第二块板的读者用 vcan 虚拟接口走完全部软件路径。下半段做协议层实战：以一台 CiA 402 伺服为从站，用 SocketCAN 手工完成 NMT 启动、SDO 参数配置、PDO 周期控制的完整闭环，让电机转到指定位置。

本篇的直接先修是 11.3（SocketCAN 编程）与 11.4/11.5（CANopen 机制）；物理层接线与终端电阻规范回 11.1。

本节覆盖：vcan 无硬件验证路径、双板 CAN FD 物理链路搭建与对测、链路健康度量化（负载率/错误帧/丢包）、CANopen 伺服的最小接入序列、NMT+SDO+PDO 手工控制程序、伺服使能状态机的实操确认、全链路排障清单。

## 场景与硬件清单

```
 上半段（链路实战）：
 ┌──────────────┐   CAN_H/CAN_L 双绞   ┌──────────────┐
 │ 板 A（Linux）│ ════════════════════ │ 板 B（Linux）│
 │ can0         │  两端各 120 Ω 终端    │ can0         │
 └──────────────┘                      └──────────────┘
 两边都可以是：SoC 内置 CAN 控制器 / MCP2517FD（SPI）/ USB-CAN 适配器

 下半段（CANopen 实战）：
 ┌──────────────┐                      ┌──────────────┐
 │ Linux 主站    │ ════════════════════ │ CiA 402 伺服  │
 │ can0         │                      │ Node-ID = 1  │
 └──────────────┘                      └──────────────┘
```

硬件清单与最低要求：

| 项 | 要求 | 说明 |
|:---|:---|:---|
| CAN 接口 ×2 | 支持 SocketCAN | `ip link show` 能看到 `can0` 即满足；FD 实验要求控制器和收发器都支持 CAN FD |
| 双绞线 + 120 Ω ×2 | 终端电阻两端各一 | 没有电阻时短距离低速也可能"碰巧能通"，不要据此跳过 |
| 伺服驱动器 | CiA 402 over CANopen | 汇川 SV660N、Maxon EPOS4、Elmo 等均可；需对应 EDS 文件 |
| 伺服电机 + 24/48 V 电源 | 与驱动器匹配 | 首次实验电机空载，脱开机械负载 |

没有 CAN 硬件、没有伺服时的后备路径：vcan 虚拟接口跑上半段的全部软件流程；下半段的程序结构不变，只是收不到真实应答——代码照读，机制照学。

## 第一段：vcan 虚拟链路（无硬件路径）

vcan 是内核自带的虚拟 CAN 设备，帧在内核里回环，用来验证配置命令、程序逻辑、工具用法：

```bash
modprobe vcan
ip link add dev vcan0 type vcan
ip link set vcan0 up

candump vcan0 &                    # 终端 1 监听
cansend vcan0 123#1122334455       # 终端 2 发送
cansend vcan0 123##311223344       # FD 帧（vcan 无需 fd on，MTU 天然支持）
```

vcan 不支持波特率参数（虚拟设备没有位定时），`ip link set vcan0 type can bitrate ...` 会报错——这是预期行为，不是故障。上半段的所有 SocketCAN 程序都能在 vcan0 上先调通，再原样切到 can0。

## 第二段：双板物理链路

### 两侧对称配置

板 A 与板 B 执行完全相同的配置（仲裁 500k / 数据 2M 的 FD 网络）：

```bash
ip link set can0 down
ip link set can0 type can \
    bitrate 500000  sample-point 0.75 \
    dbitrate 2000000 dsample-point 0.70 \
    fd on restart-ms 100
ip link set can0 up
ip -details link show can0         # 两侧都确认 can <FD> state ERROR-ACTIVE
```

`restart-ms 100` 让驱动在 Bus-Off 后 100 ms 自动恢复——实验阶段用它，产品策略按 11.2 的讨论另行决定。

### 对测三步

第一步，单向通断。板 B 抓包，板 A 发：

```bash
# 板 B
candump -taex can0

# 板 A
cansend can0 123#1122334455667788                      # 经典帧
cansend can0 123##3112233445566778899AABBCCDDEEFF00    # FD 帧，BRS=1
```

板 B 应在秒级看到两帧，FD 帧带 `##3` 标志。看不到时按 11.1 排障表走：先断电测终端电阻（≈60 Ω），再核对两侧四组位定时参数。

第二步，FD 链路专项对测。`canfdtest` 是 can-utils 里的 FD 回环测试，一端做回声、一端发校验：

```bash
# 板 B（回声端）
canfdtest -v can0 &      # 实际用法：canfdtest 需要两侧配合
# 板 A（发起端）：发送递增 FD 帧并校验回声
```

`canfdtest` 的精确用法因版本略有差异，通用替代是两侧各开 `cangen` + `candump` 统计收发计数比对。

第三步，负载与错误统计。板 A 灌流量，板 B 量化：

```bash
# 板 A：10 ms 周期发 64 字节 FD 帧
cangen can0 -I 0x100 -L 64 -g 10 -e -f

# 板 B
canbusload can0@500000              # 负载率
ip -details -statistics link show can0   # 错误计数与 bus-off 次数
```

把周期从 10 ms 逐步压到 1 ms，观察负载率曲线与是否出现错误帧——这条曲线就是这条物理链路的实际容量边界，比理论计算可靠。

### 错误注入：眼见状态机

物理层故障不可怕，可怕的是没见过故障长什么样。主动制造一次：

1. 板 B 正常 `candump -taex can0`。
2. 拔掉板 B 端的终端电阻（或拧松一端）。
3. 观察板 A 侧 `ip -details link show can0`：发送帧开始丢失应答，TEC 爬升，state 从 `ERROR-ACTIVE` → `ERROR-WARNING` → `ERROR-PASSIVE`。
4. 插回电阻，看计数器回落、状态恢复。
5. 进阶：板 A 改成错误波特率（`bitrate 250000`）再 up，全网会迅速 Bus-Off——体会"参数不一致"的破坏力，然后改回恢复。

这套演练做完，11.2 的错误状态机就从表格变成了手感。

## 第三段：CANopen 伺服接入

### 开工前确认三件事

1. **Node-ID 与波特率**：伺服默认 Node-ID 和波特率查手册（常见默认 Node-ID=1、500 kbps 或 1 Mbps）。拨码/面板改的 Node-ID 与程序里的一致。
2. **EDS 文件**：从厂商官网下载该型号的 EDS，用文本编辑器或 objdictedit 打开，确认 0x6040/0x6041/0x6060/0x607A/0x6064 这些 CiA 402 条目都在——它们决定程序里能用什么。
3. **链路已通**：先做 `cansend can0 000#8100`（Reset 广播）然后 `candump`，看到 `701#00`（Boot-up）说明伺服在总线上且能通信。看不到就回到第二段，别往下走。

### 最小控制策略

伺服的默认 PDO 映射（CiA 402 设备出厂通常已配好）：RPDO1（0x200+n）装控制字 0x6040，TPDO1（0x180+n）装状态字 0x6041。最小可用控制路径：

- 模式与目标值：走 SDO（0x6060 设模式、0x607A 写目标位置）——非实时但够用
- 使能与触发：走 RPDO1 写控制字——实时
- 状态确认：收 TPDO1 读状态字，必要时 SDO 读 0x6064 实际位置

这个"SDO 配参数、PDO 跑控制"的分工正是 11.5 的分工原则，先用手工帧把它跑通，再谈协议栈。

### 完整控制程序

```c
/* servo_pp_demo.c — SocketCAN 手工 CANopen：CiA 402 位置模式
 *
 * 流程：NMT Start → SDO 设位置模式 → 控制字三级使能 →
 *       SDO 写目标位置 → 触发运动 → TPDO1 监视状态
 *
 * 依赖：伺服默认 PDO 映射（RPDO1=0x6040，TPDO1=0x6041）
 * 编译：gcc -O2 -o servo_demo servo_pp_demo.c
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <linux/can.h>
#include <linux/can/raw.h>

#define NODE        1
#define COB_NMT     0x000
#define COB_SDO_TX  (0x600 + NODE)     /* 主站 → 伺服 */
#define COB_SDO_RX  (0x580 + NODE)     /* 伺服 → 主站 */
#define COB_RPDO1   (0x200 + NODE)
#define COB_TPDO1   (0x180 + NODE)

static int s;

static void send_frame(canid_t id, const uint8_t *data, uint8_t len)
{
    struct can_frame f = { 0 };
    f.can_id  = id;
    f.can_dlc = len;
    memcpy(f.data, data, len);
    if (write(s, &f, sizeof(f)) != sizeof(f))
        perror("write");
}

/* SDO expedited 下载：写 ≤4 字节到 OD 条目，小端 */
static int sdo_write(uint16_t idx, uint8_t sub, uint32_t val, uint8_t bytes)
{
    static const uint8_t cs[5] = { 0, 0x2F, 0x2B, 0x27, 0x23 }; /* 1/2/3/4 字节 */
    uint8_t req[8] = { cs[bytes], idx & 0xFF, idx >> 8, sub,
                       val & 0xFF, (val >> 8) & 0xFF,
                       (val >> 16) & 0xFF, (val >> 24) & 0xFF };
    send_frame(COB_SDO_TX, req, 8);

    struct can_frame f;
    for (int retry = 0; retry < 50; retry++) {          /* 500 ms 内等应答 */
        int n = read(s, &f, sizeof(f));
        if (n == sizeof(f) && f.can_id == COB_SDO_RX) {
            if (f.data[0] == 0x60)
                return 0;                                /* 成功 */
            uint32_t abort = f.data[4] | (f.data[5] << 8) |
                             ((uint32_t)f.data[6] << 16) | ((uint32_t)f.data[7] << 24);
            fprintf(stderr, "SDO 写 0x%04X:%02X abort 0x%08X\n", idx, sub, abort);
            return -1;
        }
        usleep(10000);
    }
    fprintf(stderr, "SDO 写 0x%04X:%02X 超时\n", idx, sub);
    return -1;
}

/* RPDO1 写控制字（默认映射：0x6040 在前 2 字节，小端） */
static void write_controlword(uint16_t cw)
{
    uint8_t d[2] = { cw & 0xFF, cw >> 8 };
    send_frame(COB_RPDO1, d, 2);
}

/* 收 TPDO1 状态字并解码（后台循环用） */
static void decode_statusword(uint16_t sw)
{
    const char *state;
    if ((sw & 0x4F) == 0x00)      state = "Not Ready";
    else if ((sw & 0x4F) == 0x40) state = "Switch On Disabled";
    else if ((sw & 0x6F) == 0x21) state = "Ready to Switch On";
    else if ((sw & 0x6F) == 0x23) state = "Switched On";
    else if ((sw & 0x6F) == 0x27) state = "Operation Enabled";
    else if ((sw & 0x4F) == 0x0F) state = "Quick Stop";
    else if ((sw & 0x4F) == 0x08) state = "Fault";
    else                          state = "未知";
    printf("[TPDO1] 状态字 0x%04X → %s%s\n", sw, state,
           (sw & 0x0400) ? "（到位）" : "");
}

int main(void)
{
    s = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (s < 0) { perror("socket"); return 1; }

    struct ifreq ifr = { 0 };
    strncpy(ifr.ifr_name, "can0", IFNAMSIZ - 1);
    if (ioctl(s, SIOCGIFINDEX, &ifr) < 0) { perror("SIOCGIFINDEX"); return 1; }

    struct sockaddr_can addr = { 0 };
    addr.can_family  = AF_CAN;
    addr.can_ifindex = ifr.ifr_ifindex;
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }

    /* 过滤器：SDO 应答 + TPDO1 */
    struct can_filter rf[2] = {
        { .can_id = COB_SDO_RX, .can_mask = CAN_SFF_MASK },
        { .can_id = COB_TPDO1,  .can_mask = CAN_SFF_MASK },
    };
    setsockopt(s, SOL_CAN_RAW, CAN_RAW_FILTER, rf, sizeof(rf));

    /* 1. NMT：进 Operational（伺服上电默认停在 Pre-operational） */
    send_frame(COB_NMT, (uint8_t[]){ 0x01, NODE }, 2);
    usleep(200000);

    /* 2. SDO：位置模式（0x6060:00 = 1，Profile Position） */
    if (sdo_write(0x6060, 0x00, 1, 1) < 0) return 1;

    /* 3. 使能三级跳：Shutdown → Switch On → Enable Operation */
    write_controlword(0x0006); usleep(100000);
    write_controlword(0x0007); usleep(100000);
    write_controlword(0x000F); usleep(100000);

    /* 4. 写目标位置并触发（bit4 上升沿 = New Set-point） */
    if (sdo_write(0x607A, 0x00, 50000, 4) < 0) return 1;   /* 50000 counts */
    write_controlword(0x001F); usleep(20000);               /* bit4 = 1 */
    write_controlword(0x000F);                              /* bit4 回 0，完成上升沿 */

    /* 5. 监视 TPDO1 状态字 5 秒 */
    printf("监视状态字 5 s（伺服 TPDO 若为事件驱动会持续上报）…\n");
    struct can_frame f;
    for (int i = 0; i < 500; i++) {
        int n = read(s, &f, sizeof(f));
        if (n == sizeof(f) && f.can_id == COB_TPDO1 && f.can_dlc >= 2) {
            static uint16_t last;
            uint16_t sw = f.data[0] | (f.data[1] << 8);
            if (sw != last) { decode_statusword(sw); last = sw; }
        }
        usleep(10000);
    }
    close(s);
    return 0;
}
```

### 预期现象与验证

1. 程序运行后，candump 另一终端应看到：`000#0101`（NMT Start）、`601#2F60600001...`（SDO 设模式）、`201#0600`/`0700`/`0F00`（使能序列）、`601#237A600050C30000`（目标位置 50000，小端 0x0000C350）。
2. 电机从当前位置转到目标位置，程序输出状态字从 `Switch On Disabled` 逐级变到 `Operation Enabled`，运动完成时出现 `（到位）`（bit10）。
3. 状态字停在 `Fault`：SDO 读 0x603F 拿错误码（程序里加一个 `sdo_read` 即可，命令字节 0x40），处理后控制字写 bit7=1 做 Fault Reset 再重新使能。
4. 状态字一直停在 `Switch On Disabled` 不动：说明 0x6040 没生效——查 PDO 是否使能（节点是否在 Operational）、RPDO1 映射是否真的是 0x6040（用 SDO 读 0x1600:01 回读确认）。

### 从手工帧到协议栈

手工帧的价值是把每个字节的来龙去脉看清楚；产品代码请切换到 CANopenNode（11.5 已述）：SDO 分段、心跳监控、SYNC 同步、多轴调度都是协议栈该干的活。切换时机很明确——控制周期进入 1 ms 量级、轴数超过两个、或需要 SDO 分段/块传输时，手工帧的维护成本立刻超过协议栈的学习成本。

## 排障：全链路速查

| 症状 | 定位层 | 动作 |
|:---|:---|:---|
| 两侧都发不出帧（write 报 ENOBUFS） | 物理层 | 终端电阻 ≈60 Ω 检查；总线上是否两个节点都在 |
| candump 无输出但发送无报错 | 物理层 | 核对两侧四组位定时参数逐字符一致 |
| 只有经典帧通、FD 帧不通 | 物理层 | 收发器 FD 支持确认；降 dbitrate 到 2M 验证 |
| `701#00` 看不到 | CANopen 层 | 伺服 Node-ID/波特率核对；确认伺服 CAN 口使能 |
| SDO 全部超时 | CANopen 层 | candump 确认请求帧 0x601 在线；核对 COB-ID 是否为 0x600+Node |
| SDO abort 0x08000020 | CANopen 层 | 节点在 Operational，先回 Pre-op 再改通信参数 |
| 状态字停 Switch On Disabled | 应用层 | 回读 0x1600 确认 RPDO1 映射；确认 NMT Start 已发 |
| 运动一半 Fault | 应用层 | SDO 读 0x603F；常见于超程/跟随误差/使能时序过快 |
| 周期运行下偶发丢 PDO | 系统层 | canbusload 查负载率；TPDO 加抑制时间；核负载率 <70% |

## 本节自查

读完本篇，你应能独立完成以下动作：

- 在没有硬件的情况下用 vcan 调通 SocketCAN 程序，再切换到物理 can0
- 搭建双板 CAN FD 链路并用量测（终端电阻、canbusload、错误计数）证明链路健康
- 通过拔终端电阻制造故障，观察并复述 TEC 爬升与状态降级过程
- 手工发帧完成伺服的上电确认（Boot-up）、NMT Start、模式设置、三级使能、位置触发
- 用状态字位掩码判定 CiA 402 当前状态，并按状态机给出下一步命令
- 说明手工帧方案与 CANopenNode 的切换判据

## 参考资料

- can-utils：github.com/linux-can/can-utils（candump/cansend/cangen/canbusload/canfdtest）
- 内核文档：`Documentation/networking/can.rst`（vcan 配置）
- CiA 301 / CiA 402 — SDO 命令字节、控制字/状态字位定义
- 伺服厂商 EDS 文件与手册（默认 PDO 映射以所用型号为准）
