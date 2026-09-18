# B-B.5.2 UART Linux 驱动与调试

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 总线
>
> 难度：[I] Intermediate | 预计阅读时间：35 分钟

## <span class="blue"> 本节导读

上一节讲的是电线上发生的事：帧怎么排、波特率怎么容差。本节讲的是 Linux 内部发生的事——数据从 UART 引脚进入内核后，经过哪些结构、哪些回调，最终变成用户空间 `read()` 拿到的字节流。这条通路由 TTY 子系统与 UART Framework 两层框架搭建，理解它们的分工，串口问题才能从"玄学乱码"变成可二分定位的工程问题。

本节覆盖：TTY 子系统三层结构与 UART Framework 双层注册、RK3568 serial 设备树节点与调试 Console 配置、termios 参数模型、stty 与串口终端工具、回环测试与 `/proc/tty/driver` 统计构成的调试闭环。

---

## <span class="blue"> TTY 子系统分层

TTY 是 Linux 历史最悠久的子系统之一，串口、USB 转串口、伪终端（pts）全部走这条通路。核心由三个结构体串联：

| 结构体 | 职责 | 关键点 |
|--------|------|--------|
| `tty_driver` | 一类 TTY 设备的注册入口 | 填好 ops（open/write/ioctl…），注册后用户空间出现 `/dev/ttyX` |
| `tty_struct` | 一次 open 对应一个会话实例 | 串起 driver、port、ldisc；持有当前 termios 参数 |
| `tty_port` | 一个物理端口的抽象 | 管理生命周期与 RX 环形缓冲区，承接中断来的数据 |

三者之间还有一层**线路规程（line discipline, ldisc）**：默认 N_TTY 负责把 `\r` 转 `\n`、处理 Ctrl+C、做行缓冲。调试二进制数据时它就是"数据被悄悄改掉"的元凶，后文 `stty raw` 的作用就是绕过它。

---

## <span class="blue"> UART Framework：双层注册

TTY 层是通用字符设备框架，不认识 UART 寄存器。内核在其下再封一层 UART Framework（`drivers/tty/serial/serial_core.c`），核心同样是两个结构体：

```c
struct uart_driver {
    const char *driver_name;        // "serial8250"
    const char *dev_name;           // "ttyS" → /dev/ttyS0、ttyS1…
    int         nr;                 // 支持的端口数
    struct tty_driver *tty_driver;  // 关联的 tty_driver（框架自动创建）
};

struct uart_port {
    unsigned int  iobase;           // 寄存器基地址
    unsigned int  irq;              // 中断号
    unsigned int  uartclk;          // UART 模块时钟（波特率分频基准）
    unsigned int  fifosize;         // FIFO 深度
    const struct uart_ops *ops;     // 硬件回调：startup/start_tx/stop_rx…
};
```

注册分两步，各司其职：

1. `uart_register_driver()` —— 内部自动调用 `tty_register_driver()`，把 `/dev/ttySx` 这一族字符设备注册出去；
2. `uart_add_one_port()` —— 每挂一个 `uart_port`，用户空间多一个 `/dev/ttySx`。

分工很干净：**TTY 层对用户空间**（字符设备、termios、ldisc），**UART 层对硬件**（寄存器、中断、FIFO）。SoC 厂商写 UART 驱动只需填 `uart_ops` 回调，TTY 侧的事情内核全包。

### serdev：UART 上挂设备的内核态框架

调试控制台只是 UART 的一种用法。另一种常见形态是 **UART 上挂着一颗从设备**——蓝牙模组（HCI over UART）、GNSS 模块、4G 模组的控制通道。这类场景里 UART 不是给用户敲命令的终端，而是设备的"总线"，内核为此提供了 serdev（serial device bus，`drivers/tty/serdev/`）框架：

```dts
&uart2 {
    status = "okay";

    bluetooth {                     /* UART 的子节点 = 挂在串口上的设备 */
        compatible = "brcm,bcm43438-bt";
        max-speed = <1500000>;
    };
};
```

serdev 让 UART 子节点像 I2C/SPI 子节点一样参与设备模型：compatible 匹配触发对应驱动（蓝牙走 `hci_uart`、GNSS 走 `gnss` 子系统）的 probe，驱动从 serdev 拿到端口句柄直接在内核态收发——用户空间看到的不是 `/dev/ttyS2` 加一行 ldisc 魔法，而是 `/dev/ttyS2` 被驱动占用、上层出现 `hci0` 或 `/dev/gnss0` 这样的业务接口。

> 💡 新旧两条路要会区分：老做法（`btattach`/`ldattach` 用户态工具）通过 `TIOCSETD` ioctl 把 N_HCI 这类**线路规程**挂到 tty 上，配置在运行时、设备树不参与；serdev 把设备声明收进设备树，内核自动完成绑定与电源管理。新内核（蓝牙、GNSS）主推 serdev，看到 UART 节点下挂子节点就知道走的是这条路。

```
用户空间 read()/write()
  │
/dev/ttyS2 ── tty_driver ──► tty_struct（会话 + termios）
                                  │
                             tty_ldisc（N_TTY 线路规程）
                                  │
                             tty_port（RX 环形缓冲区）
                                  │
                          uart_driver / uart_port
                                  │
                          uart_ops.start_tx() / RX 中断
                                  │
                              硬件 TX/RX 引脚
```

以 RK3568 为例：其 UART 兼容 DesignWare APB UART，走内核 `8250_dw` 驱动（`drivers/tty/serial/8250/8250_dw.c`）。驱动 probe 成功后，dmesg 可见：

```
fe660000.serial: ttyS2 at MMIO 0xfe660000 (irq = 30, base_baud = 1500000) is a 16550A
```

这一行同时确认了寄存器地址、设备节点名与基准波特率——串口问题排查时先看它。

---

## <span class="blue"> 设备树 serial 节点

ARM SoC 的 UART 走 platform 总线，资源由设备树描述。RK3568 的 UART2（`rk356x.dtsi`）：

```dts
uart2: serial@fe660000 {
    compatible = "rockchip,rk3568-uart", "snps,dw-apb-uart";
    reg = <0x0 0xfe660000 0x0 0x100>;
    interrupts = <GIC_SPI 118 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&cru SCLK_UART2>, <&cru PCLK_UART2>;
    clock-names = "baudclk", "apb_pclk";
    dmas = <&dmac0 4>, <&dmac0 5>;
    pinctrl-0 = <&uart2m0_xfer>;
    pinctrl-names = "default";
    reg-io-width = <4>;
    reg-shift = <2>;
    status = "disabled";
};
```

SoC 级 dtsi 已预置寄存器、时钟、DMA 与默认引脚组（M0），板级 dts 通常只需打开：

```dts
/ {
    aliases {
        serial2 = &uart2;              // 决定 /dev/ttyS2 的编号
    };
};

&uart2 {
    status = "okay";
};
```

要换用 M1 引脚组时覆写 `pinctrl-0 = <&uart2m1_xfer>;` 即可。`aliases` 里的 `serialN` 编号直接映射到 `/dev/ttySN`——改别名比改驱动代码更常用于"让 ttyS2 变成 ttyS1"。

> ⚠️ 复制了节点忘了 `status = "okay"`：dtsi 默认 disabled，内核 probe 直接跳过，`/dev/ttyS2` 根本不会出现。设备节点缺失时先查 status，再查 dmesg 里有没有 probe 报错。

### 调试 Console：stdout-path 与 earlycon

调试串口的配置不在 serial 节点本身，而在 `chosen`：

```dts
chosen {
    stdout-path = "serial2:1500000n8";
};
```

`stdout-path` 告诉内核 printk 往哪个口吐日志，格式为 `别名:波特率校验数据位`。注意 RK3568 调试串口默认 **1500000** 波特率（B-B.5.1 已讲），串口工具按 115200 打开只会看到乱码。

内核 console 驱动注册之前的早期启动阶段（decompress 到 console init 之间）日志走 **earlycon**：

```
bootargs = "earlycon=uart8250,mmio32,0xfe660000,1500000 console=ttyS2,1500000n8";
```

`reg-shift = <2>` 对应 `mmio32` 访问宽度。内核启动卡死、console 无输出时，加上 earlycon 往往能看到真正的 panic 信息。printk 输出级别由 `/proc/sys/kernel/printk` 控制（`echo 8 > /proc/sys/kernel/printk` 放开到 DEBUG）。

---

## <span class="blue"> termios：用户态的参数模型

`stty` 背后是一套 `termios` 结构，用户程序用 `tcgetattr()/tcsetattr()` 读写它：波特率（`cfsetispeed/cfsetospeed`）、数据位/校验/停止位（`c_cflag`）、输入处理（`c_iflag`）、行规程行为（`c_lflag`）、读超时（`c_cc[VMIN/VTIME]`）。串口应用编程的固定套路是：open → tcgetattr 备份 → 改参数 → tcsetattr → tcflush 清空残留。

完整的 termios 配置代码与 GPS NMEA 数据解析实例在 **B-B.5.4 实战篇** 展开，本节先把工具链打熟。

---

## <span class="blue"> stty 与终端工具

`stty` 是系统自带的串口参数工具，无需安装：

| 命令 | 功能 |
|------|------|
| `stty -F /dev/ttyS2 -a` | 查看全部参数 |
| `stty -F /dev/ttyS2 115200` | 设置波特率 |
| `stty -F /dev/ttyS2 cs8 -parenb -cstopb` | 8N1 无校验 |
| `stty -F /dev/ttyS2 crtscts` | 开启硬件流控 |
| `stty -F /dev/ttyS2 raw` | 原始模式，绕过 ldisc 的一切转换 |
| `stty -F /dev/ttyS2 -echo` | 关闭回显 |
| `stty -F /dev/ttyS2 sane` | 恢复合理默认值（救砖用） |

> 💡 与传感器、GPS 这类输出原始字节的设备通信时，`raw` 是必选项——默认 N_TTY 会把 0x0D 转 0x0A、吞掉 0x11/0x13 流控字符，二进制数据被静默修改。

终端工具三选一，按场景取：

| 工具 | 打开方式 | 特点 | 退出 |
|------|----------|------|------|
| screen | `screen /dev/ttyS2 1500000` | 发行版自带，一行命令 | Ctrl+A, K, Y |
| picocom | `picocom -b 9600 /dev/ttyS2` | 轻量，参数直白 | Ctrl+A, Ctrl+X |
| minicom | `minicom -s` 配置后进入 | 功能全，可存配置 | Ctrl+A, X |

临时抓数据首选 screen；要给设备发 AT 指令交互调试用 picocom/minicom。

---

## <span class="blue"> 回环测试：硬件通路的金标准

把本端 TX 与 RX 短接，自发自收：

<svg viewBox="0 0 560 180" xmlns="http://www.w3.org/2000/svg" style="max-width:560px;width:100%">
<rect x="40" y="50" width="180" height="80" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="130" y="95" text-anchor="middle" font-size="14" fill="currentColor">SoC UART2</text>
<rect x="330" y="35" width="60" height="24" rx="4" fill="none" stroke="currentColor"/>
<text x="420" y="51" font-size="13" fill="currentColor">TX 引脚</text>
<line x1="220" y1="47" x2="330" y2="47" stroke="currentColor" stroke-width="1.5"/>
<rect x="330" y="121" width="60" height="24" rx="4" fill="none" stroke="currentColor"/>
<text x="420" y="137" font-size="13" fill="currentColor">RX 引脚</text>
<line x1="220" y1="133" x2="330" y2="133" stroke="currentColor" stroke-width="1.5"/>
<path d="M 360 47 L 360 85 Q 360 90 365 90 L 415 90 Q 420 90 420 95 Q 420 100 415 100 L 365 100 Q 360 100 360 105 L 360 133" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="420" y="94" font-size="12" fill="currentColor">跳线短接</text>
</svg>

```bash
stty -F /dev/ttyS2 115200 cs8 -parenb -cstopb raw -echo
echo -n "LOOPBACK" > /dev/ttyS2 &
cat -v /dev/ttyS2
# 屏幕打印 LOOPBACK → 硬件通路 OK
```

回环结果直接二分问题域：

| 现象 | 结论 | 下一步 |
|------|------|--------|
| 收到原样数据 | 本端硬件与驱动正常 | 查对端设备与连线 |
| 什么都收不到 | 本端问题 | dmesg / status / 时钟 / 引脚复用 |
| 收到但乱码 | 波特率不匹配 | 核算双方波特率（B-B.5.1 排查锚点） |
| 收到但丢字节 | 读取不及时或溢出 | 查 FIFO 阈值、读线程优先级 |

---

## <span class="blue"> /proc/tty/driver：驱动侧计数器

8250 驱动在 procfs 暴露运行时统计：

```bash
cat /proc/tty/driver/ttyS
# 2: uart:16550A mmio:0xFE660000 irq:30 tx:1240 rx:861 RTS|CTS|DTR|DSR|CD
```

`tx`/`rx` 计数器是"发出去没收到"类问题的定位器：

- **tx 不涨** → 数据卡在内核上层（open 的设备节点不对、写入失败）；
- **tx 涨、对端无反应** → 问题在线路或对端（量 TX 波形确认）；
- **rx 涨、应用读不到** → 检查 ldisc（是否 raw）、读取超时参数（VMIN/VTIME）。

配合 `dmesg | grep ttyS` 看 probe 日志、`ls -l /dev/ttyS*` 确认节点存在，构成完整的软件侧检查链。

---

## <span class="blue"> 排查锚点

串口"不通"的软件侧二分流程，按序执行：

1. **节点存在吗**：`ls /dev/ttyS*` + `dmesg | grep serial`——没有节点回到设备树 status；
2. **回环通吗**：TX/RX 短接自测——不通是本端硬件/驱动，通则问题在对端或连线；
3. **计数器涨吗**：`/proc/tty/driver/ttyS` 看 tx/rx——定位数据卡在哪一层；
4. **参数一致吗**：`stty -a` 核对波特率/8N1/raw——B-B.5.1 的排查锚点（先确认波特率）在这一步收口。

四步走完仍不通，才轮到逻辑分析仪上硬件波形。

> 💡 无开发板时，PC 上 `socat -d -d pty,raw,echo=0 pty,raw,echo=0` 创建一对互通的伪终端（PTY），一端写一端读——PTY 同样走 TTY 子系统，stty、回环逻辑、计数器观察都能在这对虚拟口上预演。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| TTY+UART 双层框架 | 厂商只写硬件回调，用户态接口统一；代价是抽象层深、初次读源码绕 |
| ldisc 行处理 | 终端场景省心；二进制场景是坑，必须 raw 绕过 |
| screen vs minicom | screen 零配置零安装；minicom 可存多套配置，功能全但上手繁琐 |
| 回环测试 | 一条跳线二分硬件/软件；代价是需物理接触引脚 |
| earlycon | 启动早期日志的唯一来源；代价是参数（mmio32/reg-shift）要配对 SoC |

---

## <span class="blue"> 排障速查

| 症状 | 根因 | 定位动作 |
|------|------|----------|
| 节点齐全但 `/dev/ttyS2` 不存在 | 设备树 `status` 未改 "okay"（dtsi 默认 disabled） | 先查 status，再看 dmesg probe 报错 |
| 协议解析随机失败、数据被改写 | 二进制数据未开 raw，N_TTY 转换 0x0D/吞 0x11/0x13 | `stty raw` 或 termios 关输入处理 |
| `/dev/ttyS2` 不是你以为的那个物理口 | 多 UART 使能后编号漂移 | 以 aliases 中 `serialN` 为准，不猜编号 |
| 早期日志全丢、console 起来后正常 | earlycon 宽度写错（RK3568 须 `mmio32` 配 `reg-shift=2`） | 核对 earlycon 参数与 dtsi 的 reg-shift |
| 新进程 read 阻塞或读到残帧 | minicom/screen 没退干净，端口被占用 | `fuser /dev/ttyS2` 查占用者 |
| UART 上蓝牙/GPS 设备不工作 | 走了 serdev 的设备被当普通 tty 用（或反之） | 查 UART 节点下有无子节点，确认绑定路径 |

---

## <span class="blue"> 本节总结

串口子系统的双层框架回答的是一个边界问题：TTY 层管"用户空间看到的字符设备长什么样"（节点、termios、线路规程），UART Framework 管"硬件寄存器怎么动"（uart_ops 回调、FIFO、中断）。SoC 厂商只填回调，应用开发者只碰 termios，中间的分层各司其职——所以排查时的第一层二分就是"问题在 TTY 层（参数/ldisc/占用）还是 UART 层（节点/时钟/引脚）"，回环测试加 `/proc/tty/driver` 计数器正好卡在这个分界上。

serdev 值得单独记住，因为它代表 UART 角色的转变：从"给人用的控制台"变成"给设备用的总线"。看到 UART 节点下挂着 bluetooth/gnss 子节点，这条串口就是设备树管理的内核资源，不再是可以随手 `cat` 的调试口——这和老做法 `btattach` 挂线路规程是新旧两代机制，新内核主推前者。工具层面带走三件：`stty raw` 是二进制通信的保命参数，回环是一条跳线换一半故障域的最高性价比操作，earlycon 是启动卡死时唯一的日志来源（宽度参数必须配 SoC）。

**速查表**

| 项 | 要点 |
|----|------|
| TTY 分层 | tty_driver（族）/ tty_struct（会话）/ tty_port（端口+RX 缓冲）；ldisc 默认 N_TTY |
| 双层注册 | `uart_register_driver()` 管设备族 + `uart_add_one_port()` 管端口 |
| 设备树 | status 必改 okay；aliases 定 ttySN 编号；chosen/stdout-path 定 console |
| earlycon | `earlycon=uart8250,mmio32,0xADDR,1500000`；宽度配 reg-shift |
| serdev | UART 子节点挂设备（蓝牙/GNSS）；内核态绑定，区别于用户态 btattach |
| stty | `raw` 二进制必选；`sane` 救砖；`-crtscts` 查流控 |
| 回环 | TX/RX 短接自发自收；通=本端无恙，不通=查本端 |
| 计数器 | `/proc/tty/driver/ttyS` 的 tx/rx：不涨=卡上层，涨=查对端 |
| 排查四步 | 节点 → 回环 → 计数器 → 参数（stty -a） |

**本节自查**

1. TTY 层和 UART Framework 的分工边界在哪？SoC 厂商的驱动代码落在哪一层？
2. 默认 N_TTY 线路规程会对二进制数据做哪两类破坏？怎么绕过？
3. serdev 和 `btattach` 挂 N_HCI 线路规程是同一个目的的哪两代机制？设备树上怎么区分？
4. earlycon 和 console 各覆盖启动的哪段时期？RK3568 的 earlycon 为什么要写 `mmio32`？
5. 回环测试收到乱码，故障域在哪一侧？下一步查什么？
6. `/proc/tty/driver/ttyS` 显示 tx 不涨，说明数据卡在哪一层？怎么确认？

---

## <span class="blue"> 下一步

工具链打熟之后，UART 要向工业现场走：**B-B.5.3 RS-485 与 Modbus 协议**——差分电平、千米传输、半双工方向切换与 Modbus RTU 帧格式。随后 **B-B.5.4 实战篇** 用 NEO-6M GPS 模块把本节全部内容串起来：设备树使能、termios 编程、NMEA 解析与冷启动陷阱。

> 💡 螺旋衔接：双层注册是设备模型（第二部第 11 章 bus-device-driver）在串口子系统的具体落地；termios 的 `VMIN/VTIME` 阻塞行为与第一部进程调度章节的等待队列同源；完整 UART 驱动（uart_ops 回调实现）的写作在 D 扩展驱动专题展开，本节只需看懂分工。
