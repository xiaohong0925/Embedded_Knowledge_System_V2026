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

## <span class="blue"> 常见陷阱

> ⚠️ 设备树 status 忘了开：节点齐全但 `/dev/ttyS2` 不存在。先看 status，再看 dmesg。

> ⚠️ 二进制数据不开 raw：NMEA 里偶尔出现 0x0D、AT 模组返回 0x11 时，数据被 ldisc 静默改写/吞掉，协议解析随机失败。

> ⚠️ aliases 编号与预期不符：使能了多个 UART 后，`/dev/ttyS2` 未必对应你以为的那个物理口。以 aliases 中的 `serialN` 为准，别猜。

> ⚠️ earlycon 参数写错宽度：RK3568 是 `reg-shift=2`，earlycon 必须 `mmio32`；写成 `mmio` 则 earlycon 静默无效，表现为"早期日志全丢、console 起来后正常"。

> ⚠️ cat 读串口被工具占用：minicom/screen 没退干净（或另一个进程开着同一口），新进程 read 阻塞或读到残帧。`fuser /dev/ttyS2` 查占用者。

---

## <span class="blue"> 动手练习

1. **通路追踪**：在本机内核源码中找到 `8250_dw.c` 的 probe 函数，沿 `uart_add_one_port` 追到 `tty_register_driver`，画出注册调用链。
2. **回环二分**：开发板上做回环测试，分别验证"正常"与"拔掉跳线"两种状态下 `/proc/tty/driver/ttyS` 的 tx/rx 计数变化，理解计数器的定位意义。
3. **乱码复现**：故意用错误波特率打开调试串口观察乱码，再用正确值恢复——建立"乱码=波特率"的肌肉记忆。
4. **无硬件后备**：PC Linux 上用 `socat -d -d pty,raw,echo=0 pty,raw,echo=0` 创建一对伪终端，一端 echo 一端 cat，用 stty 配置 PTY 参数——PTY 同样走 TTY 子系统，可在无开发板时演练本节全部工具链。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| TTY 分层 | tty_driver / tty_struct / tty_port 各自职责；ldisc 的位置 |
| 双层注册 | uart_register_driver 管设备族，uart_add_one_port 管端口；TTY 对用户、UART 对硬件 |
| 设备树 | serial 节点字段含义；status、aliases、chosen/stdout-path 三处易漏点 |
| Console | stdout-path 与 earlycon 的分工；RK3568 默认 1500000 |
| 工具链 | stty 关键参数（raw 必记）；screen/picocom 一行打开 |
| 调试闭环 | 节点→回环→计数器→参数 四步二分 |

---

## <span class="blue"> 配套资源

- **内核源码**：`drivers/tty/serial/serial_core.c`（UART Framework）、`drivers/tty/serial/8250/8250_dw.c`（RK3568 所用驱动）
- **内核文档**：`Documentation/driver-api/tty.rst`
- **工具**：`apt-get install minicom picocom socat`；screen 通常自带
- **设备树参考**：`arch/arm64/boot/dts/rockchip/rk356x.dtsi` 的 uart2 节点

---

## <span class="blue"> 下一步

工具链打熟之后，UART 要向工业现场走：**B-B.5.3 RS-485 与 Modbus 协议**——差分电平、千米传输、半双工方向切换与 Modbus RTU 帧格式。随后 **B-B.5.4 实战篇** 用 NEO-6M GPS 模块把本节全部内容串起来：设备树使能、termios 编程、NMEA 解析与冷启动陷阱。

> 💡 螺旋衔接：双层注册是设备模型（第二部第 11 章 bus-device-driver）在串口子系统的具体落地；termios 的 `VMIN/VTIME` 阻塞行为与第一部进程调度章节的等待队列同源；完整 UART 驱动（uart_ops 回调实现）的写作在 D 扩展驱动专题展开，本节只需看懂分工。
