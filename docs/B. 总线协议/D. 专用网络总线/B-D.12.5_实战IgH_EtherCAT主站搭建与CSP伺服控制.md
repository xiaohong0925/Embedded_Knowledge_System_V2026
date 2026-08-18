# B-D.12.5 实战：IgH EtherCAT 主站搭建与 CSP 伺服控制

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[M] | 预计阅读时间：70 分钟

## 本节导读

12.1~12.4 把工业以太网的版图、EtherCAT 协议、DC 时钟和 IgH 的编程模型讲完了，本篇从零搭一个能控制真实伺服的主站系统：装 PREEMPT_RT 内核、编译 IgH Master、用命令行确认从站组态、写一个 1 kHz 周期的 CSP（周期同步位置）模式控制程序，让电机按梯形速度规划走到目标位置。整个过程按"每一步都可验证"组织——每一步做完都有明确的确认手段，不通就先排障再往下走。

本篇直接依赖 12.3 的 ecrt 四段式模型与 DC 机制；系统实时性调优的系统方法在 B-E.15.6 展开，本篇只用结论。

本节覆盖：硬件选型与检查清单、PREEMPT_RT 内核获取与验证、IgH Master 编译安装与网卡驱动绑定、命令行组态确认流程、CSP 模式 ecrt 控制程序逐段讲解、梯形轨迹生成、联调排障全清单。

## 硬件与环境清单

| 项 | 推荐 | 说明 |
|:---|:---|:---|
| 主站 | x86 工控机或开发板 | ARM 也可，但 x86 + I210 组合资料最多 |
| 网卡 | Intel I210（独立网口专用于 EtherCAT） | 消费级 Realtek 可用 generic 驱动起步，实时性靠实测 |
| 从站 | 支持 CoE + DC 的 CiA 402 伺服 | 汇川 SV660N、禾川、松下 MINAS 等；要 ESI 文件 |
| 电机 | 与驱动器匹配，空载 | 首次联调脱开机械负载 |
| 系统 | Ubuntu 22.04 / Debian 12 | 内核版本决定 rt 补丁选择 |
| IgH 版本 | stable-1.5 分支 | 文档与命令行输出以 1.5 为准 |

> ⚠️
> EtherCAT 网口必须专用：不接交换机、不跑 IP、不让 NetworkManager 碰它。把网口从系统网络管理里摘出来（`nmcli device set enp2s0 managed no` 或 netplan 里剔除），否则链路状态翻转和 IP 配置动作会干扰实时帧调度。

## 第一步：PREEMPT_RT 内核

Ubuntu 22.04 起可以直接装官方实时内核，免去手工打补丁：

```bash
apt install linux-image-realtime        # Ubuntu Pro 提供；无订阅则自行打 rt 补丁
uname -r                                # 确认内核带 -rt 后缀
```

验证实时性基线（装好 rt 内核后再继续，否则后面全是假问题）：

```bash
apt install rt-tests
cyclictest -m -p 99 -i 1000 -l 100000
```

看 max 延迟：x86 + rt 内核典型 20~60 µs；超过 150 µs 就先到 B-E.15.6 调 BIOS（关 C-states、关超线程、隔离核），不要带病进入下一步。

## 第二步：编译安装 IgH Master

```bash
git clone -b stable-1.5 https://gitlab.com/etherlab.org/ethercat.git
cd ethercat
./bootstrap
./configure --prefix=/opt/etherlab \
            --enable-generic \
            --with-linux-dir=/lib/modules/$(uname -r)/build
make -j$(nproc)
make install
depmod
```

关键配置项：`--enable-generic` 是兜底驱动（走协议栈，任何网卡可用）；有 igb/e1000e/r8169 网卡时加 `--enable-igb` 等专用驱动，绕过协议栈，延迟更低。

绑定网卡。编辑 `/etc/etherlab/ethercat.conf`（configure 前缀决定路径）：

```
MASTER0_DEVICE="aa:bb:cc:dd:ee:ff"    # EtherCAT 网口的 MAC
DEVICE_MODULES="generic"              # 或 igb / e1000e
```

加载并启动：

```bash
modprobe ec_master
modprobe ec_generic
systemctl start ethercat              # 或 /opt/etherlab/etc/init.d/ethercat start
ethercat master                       # 应显示主站 0 与链路状态
```

## 第三步：命令行确认从站组态

伺服上电、网线接好后，先不写代码，用命令行把组态事实全部确认：

```bash
ethercat slaves
# 预期：0  0:0  PREOP  +  SV660N  （位置 0，AL 状态 PREOP）

ethercat pdos -p 0
# 回读从站 0 的 SM 与 PDO 映射，把输出存下来——
# 代码里的 PDO 条目注册必须与此一致

ethercat upload -p 0 -t uint8 0x6060 0    # 读当前模式
ethercat download -p 0 -t uint8 0x6060 0 8   # 写 8 = CSP 模式
ethercat cstruct -p 0
# 导出 ec_slave_config 相关的 C 结构体，直接作为代码参考
```

这一步的价值：PDO 映射以设备实际为准，不以文档为准。不同固件版本的默认映射可能不同，程序跑不起来时第一嫌疑就是映射不一致——而你已经提前把真实映射拿到手了。

> 💡
> 若 `ethercat slaves` 显示从站停在 `PREOP +`（带 `+` 号表示有错误）或 `SAFEOP+E`，用 `ethercat slaves -v` 看详细状态字，绝大多数是 PDO 映射组态与设备固件不匹配，拿 `ethercat pdos` 的真实输出修代码里的映射表。

## 第四步：CSP 控制程序

CSP（Cyclic Sync Position，0x6060 = 8）是 EtherCAT 伺服的标准用法：主站每周期下发目标位置，从站的位置环在 SYNC0 沿同步执行。程序分四段：组态、激活、实时循环、退出。

```c
/* csp_demo.c — IgH ecrt：CSP 模式单轴梯形轨迹控制
 * 编译：gcc -O2 -o csp_demo csp_demo.c -I/opt/etherlab/include \
 *          -L/opt/etherlab/lib -lethercat -lrt
 * 运行：sudo ./csp_demo
 */
#include <ecrt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <time.h>
#include <sys/mman.h>
#include <sched.h>

#define CYCLE_NS        1000000          /* 1 ms */
#define RUN_SEC         10
#define VENDOR_ID       0x00000601       /* 以 ethercat cstruct 实际输出为准 */
#define PRODUCT_CODE    0x00009201

static ec_master_t   *master;
static ec_domain_t   *domain;
static uint8_t       *pd;                /* 过程数据镜像 */
static unsigned int   off_ctrl, off_tgt; /* 输出：控制字、目标位置 */
static unsigned int   off_stat, off_act; /* 输入：状态字、实际位置 */
static volatile sig_atomic_t quit;

static void on_sigint(int s) { (void)s; quit = 1; }

/* PDO 条目注册：偏移、条目必须与 ethercat pdos 实测一致 */
static ec_pdo_entry_reg_t regs[] = {
    { 0, 0, VENDOR_ID, PRODUCT_CODE, 0x6040, 0, &off_ctrl },
    { 0, 0, VENDOR_ID, PRODUCT_CODE, 0x607A, 0, &off_tgt  },
    { 0, 0, VENDOR_ID, PRODUCT_CODE, 0x6041, 0, &off_stat },
    { 0, 0, VENDOR_ID, PRODUCT_CODE, 0x6064, 0, &off_act  },
    {}
};

/* CiA 402 使能状态机：按状态字决定下一个控制字 */
static uint16_t next_controlword(uint16_t sw)
{
    if ((sw & 0x004F) == 0x0008) return 0x0080;        /* Fault → Fault Reset */
    if ((sw & 0x004F) == 0x0040) return 0x0006;        /* Switch On Disabled → Shutdown */
    if ((sw & 0x006F) == 0x0021) return 0x0007;        /* Ready → Switch On */
    if ((sw & 0x006F) == 0x0023) return 0x000F;        /* Switched On → Enable Op */
    return 0x000F;                                     /* 保持使能 */
}

/* 梯形速度规划：返回当前周期目标位置（counts） */
static int32_t trapezoid(double t, int32_t p0, int32_t p1,
                         double vmax, double acc)
{
    double dist = (double)(p1 - p0);
    double dir  = dist >= 0 ? 1.0 : -1.0;
    dist *= dir;
    double t_acc = vmax / acc;
    double d_acc = 0.5 * acc * t_acc * t_acc;
    double d_flat = dist - 2 * d_acc;
    double pos;
    if (d_flat < 0) {                    /* 距离太短，三角形轨迹 */
        t_acc = __builtin_sqrt(dist / acc);
        d_flat = 0; d_acc = dist / 2;
    }
    double t_flat = d_flat / vmax;
    if (t < t_acc)            pos = 0.5 * acc * t * t;
    else if (t < t_acc + t_flat) pos = d_acc + vmax * (t - t_acc);
    else if (t < 2 * t_acc + t_flat) {
        double td = t - t_acc - t_flat;
        pos = d_acc + d_flat + vmax * td - 0.5 * acc * td * td;
    } else pos = dist;
    return p0 + (int32_t)(dir * pos);
}

int main(void)
{
    signal(SIGINT, on_sigint);

    /* 实时三件套：锁内存、提优先级、（可选）绑核 */
    mlockall(MCL_CURRENT | MCL_FUTURE);
    struct sched_param sp = { .sched_priority = 90 };
    if (sched_setscheduler(0, SCHED_FIFO, &sp) < 0)
        perror("sched_setscheduler（需 root）");

    master = ecrt_request_master(0);
    if (!master) { fprintf(stderr, "request_master 失败\n"); return 1; }
    domain = ecrt_master_create_domain(master);

    ec_slave_config_t *sc =
        ecrt_master_slave_config(master, 0, 0, VENDOR_ID, PRODUCT_CODE);
    if (!sc) { fprintf(stderr, "slave_config 失败\n"); return 1; }

    /* CSP 模式 + DC：SYNC0 周期 1 ms */
    if (ecrt_slave_config_sdo8(sc, 0x6060, 0, 8))
        fprintf(stderr, "警告：CSP 模式 SDO 预配置失败，运行期再确认\n");
    ecrt_slave_config_dc(sc, 0x0300, CYCLE_NS, 0, 0, 0);

    if (ecrt_domain_reg_pdo_entry_list(domain, regs)) {
        fprintf(stderr, "PDO 注册失败——拿 ethercat pdos 输出核对映射\n");
        return 1;
    }
    if (ecrt_master_activate(master)) {
        fprintf(stderr, "activate 失败\n"); return 1;
    }
    if (!(pd = ecrt_domain_data(domain))) {
        fprintf(stderr, "domain 数据指针为空\n"); return 1;
    }

    int32_t home = 0, target_pos;
    double t = 0;
    struct timespec wake;
    clock_gettime(CLOCK_MONOTONIC, &wake);

    for (long cycle = 0; cycle < RUN_SEC * 1000 && !quit; cycle++) {
        wake.tv_nsec += CYCLE_NS;
        while (wake.tv_nsec >= 1000000000) { wake.tv_nsec -= 1000000000; wake.tv_sec++; }
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &wake, NULL);

        ecrt_master_receive(master);
        ecrt_domain_process(domain);

        uint16_t sw = EC_READ_U16(pd + off_stat);
        if (cycle == 0) home = EC_READ_S32(pd + off_act);  /* 当前位置为起点 */

        uint16_t cw = next_controlword(sw);
        int enabled = (sw & 0x006F) == 0x0027;             /* Operation Enabled */

        if (enabled) {
            t += 0.001;
            /* 目标：从 home 前进 100000 counts，vmax=20000 counts/s，acc=100000 */
            target_pos = trapezoid(t, home, home + 100000, 20000, 100000);
        } else {
            target_pos = EC_READ_S32(pd + off_act);        /* 未使能时跟随当前位置 */
        }

        EC_WRITE_U16(pd + off_ctrl, cw);
        EC_WRITE_S32(pd + off_tgt, target_pos);

        if (cycle % 1000 == 0)
            printf("t=%lds 状态字=0x%04X 实际位置=%d 目标=%d\n",
                   cycle / 1000, sw, EC_READ_S32(pd + off_act), target_pos);

        ecrt_domain_queue(domain);
        ecrt_master_send(master);
    }

    EC_WRITE_U16(pd + off_ctrl, 0x0002);                   /* 退出前 Quick Stop */
    ecrt_domain_queue(domain);
    ecrt_master_send(master);
    ecrt_master_release(master);
    return 0;
}
```

逐段对照 12.3 的四段式模型：

1. **组态段**（非实时上下文）：`request_master` 拿主站、`create_domain` 建过程数据域、`slave_config` 按"别名+位置+厂商 ID+产品代码"锁定从站、`config_sdo8` 预置 CSP 模式、`config_dc` 打开 SYNC0、`reg_pdo_entry_list` 注册条目到域偏移。
2. **激活段**：`activate` 把组态下发给主站核心，此后组态不可再改；`domain_data` 拿到过程数据镜像指针。
3. **实时循环**：`receive → domain_process → 读状态字/算控制律 → 写控制字与目标 → queue → send`。使能状态机按状态字逐级推进，未使能时目标位置跟随实际位置——这是防"使能瞬间飞车"的标准做法：CSP 下目标位置跳变等于指令电机瞬时位移。
4. **退出**：先发 Quick Stop 再释放主站。

> ⚠️
> CSP 模式的第一安全约束：使能前后目标位置必须连续。程序里 `target_pos = 实际位置` 的跟随分支就是干这个的。删掉它，电机在 Enable Operation 的瞬间会以最快速度冲向寄存器里的旧目标值——真机上这是撞机事故的标准成因。

## 第五步：联调验证

按顺序确认，每步有明确判据：

```bash
# 1. 程序跑起来后另开终端：
ethercat slaves
# 判据：0  0:0  OP  +  SV660N   （OP 且无错误标记）

ethercat dc
# 判据：各从站 DC 使能，offset/drift 数值稳定不增长

# 2. 电机行为：先慢速小幅（把程序里 100000 改成 5000）确认方向与安全，
#    再恢复全行程

# 3. 实时性统计：程序结束打印 cyclictest 式的周期抖动
#    判据：周期 max < 1.2 ms（1 ms 周期下留 20% 余量）
```

## 排障：实战全清单

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| `request_master` 返回 NULL | ec_master 未加载、网卡未绑定 | `ethercat master`；查 ethercat.conf 的 MAC |
| PDO 注册失败 | 条目与设备实际映射不符 | `ethercat pdos -p 0` 输出逐项比对 regs 表 |
| 从站停 SAFEOP+E | 映射组态被拒绝 | 同上；确认用的是 RxPDO/TxPDO 条目而非反向 |
| 使能后电机啸叫/抖动 | 控制周期抖动大、伺服增益未整定 | 周期统计；伺服侧先做刚性整定 |
| 使能瞬间猛冲 | 目标位置未跟随当前位置 | 检查跟随分支；candump 式地看 target 跳变 |
| 周期超时（>1 ms） | 实时三件套缺项 | 核 SCHED_FIFO/mlockall/rt 内核；cyclictest 复测 |
| 运行中 WKC 报错 | 线缆松动、从站掉电 | `ethercat slaves` 找掉线的站 |
| 方向反了 | 伺服侧方向参数或编码器极性 | SDO 0x607E（极性）或驱动器面板参数 |

## 本节自查

读完本篇，你应能独立完成以下动作：

- 从零搭出 rt 内核 + IgH + 专用网口的主站环境，并用 cyclictest 证明实时基线
- 用 `ethercat slaves/pdos/cstruct` 拿到设备真实组态并转成代码里的注册表
- 写出带 CiA 402 使能状态机的 ecrt 实时循环，说明"未使能时目标跟随实际"的原因
- 实现梯形速度规划并在 CSP 模式下驱动电机走指定行程
- 用 `ethercat dc` 验证 DC 同步生效
- 按排障表定位"注册失败""SAFEOP+E""使能飞车"三类经典故障

## 参考资料

- IgH EtherCAT Master 1.5 文档与 examples（gitlab.com/etherlab.org/ethercat）
- rt-tests / cyclictest：wiki.linuxfoundation.org/realtime
- CiA 402 — CSP 模式对象定义（0x6060/0x607A/0x6040/0x6041/0x6064）
- 所用伺服的 EtherCAT 手册与 ESI 文件（默认 PDO 映射以它为准）
