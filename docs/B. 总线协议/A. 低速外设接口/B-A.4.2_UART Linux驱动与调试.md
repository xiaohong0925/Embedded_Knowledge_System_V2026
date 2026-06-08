# B-A.4.2 UART Linux驱动与调试 [知识点291-292]

> 所属章节：第五部 B. 总线协议 > B-A.4 UART串口通信
>
> 难度：[I] Intermediate | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

上一节你搞懂了UART的物理层——TX/RX怎么跳、波特率怎么算、流控怎么握手。但这些东西在硬件上只是一堆电线，真正让它在Linux里跑起来，靠的是一套**TTY子系统**。这套系统从底层的uart_driver到用户空间的/dev/ttySX，中间叠了好几层抽象，新手常常看得云里雾里。本节我们先拆解TTY子系统的结构体关系，搞清楚数据从键盘/传感器到用户空间的全路径；然后上手实操——stty查参数、minicom抓数据、回环测硬件，最后用一个**NEO-6M GPS模块**的完整实例，把设备树配置、驱动加载、NMEA数据解析串成一条线。读完这一节，你能独立调通一个UART外设，也能看懂printk从哪个口子吐出来的。

---

## <span class="blue"> 知识点291：Linux TTY子系统架构 [I]

TTY子系统是Linux里历史最悠久的子系统之一，名字来源于电传打字机（Teletype）。今天它仍然统治着所有字符终端设备——串口、USB转串口、伪终端，全都走这条Pipeline。理解它的分层架构，是你写UART驱动或排查串口问题的基本功。

### 三层核心结构体

TTY子系统的核心可以用**三个结构体**串联起来：

**1. tty_driver —— 注册入口**

`tty_driver`代表一类TTY设备，你调用`tty_register_driver()`把它挂到内核，用户空间就会出现对应的`/dev/ttySX`。它里面填充了ops指针（open/close/write/ioctl等回调），告诉内核"我的设备怎么操作"。

```c
// 关键字段
struct tty_driver {
    int     major;              // 主设备号（如TTY_MAJOR=4）
    int     minor_start;        // 次设备号起始
    int     num;                // 支持的端口数量
    const struct tty_operations *ops;  // 操作函数集
    // ...
};
```

**2. tty_port —— 硬件端口抽象**

一个`tty_port`对应一个物理UART端口（比如SOC上的UART0、UART1）。它管理端口的生命周期：打开时激活、关闭时休眠，还维护一个环形缓冲区（tty_buffer）承接从硬件中断来的数据。

```c
struct tty_port {
    struct tty_buffer *buf;     // 数据接收缓冲区链表
    int                 flags;  // ASYNC_FLAGS
    struct tty_struct  *tty;    // 关联的tty_struct
    // ...
};
```

**3. tty_struct —— 会话实例**

每次用户open一个/dev/ttySX，内核创建一个`tty_struct`，代表这次**会话**。它把tty_driver、tty_port、线路规程（ldisc）全部串在一起。数据到达时，先进入tty_port的缓冲区，再经过ldisc处理（比如把\r转成\n），最后才拷贝到用户空间的read缓冲区。

```c
struct tty_struct {
    struct tty_driver  *driver; // 指向tty_driver
    struct tty_port    *port;   // 指向tty_port
    struct tty_ldisc   *ldisc;  // 线路规程（N_TTY默认）
    struct ktermios     termios;// 当前波特率/数据位/校验等参数
    // ...
};
```

### UART驱动的专属层

TTY子系统是通用的。对于UART这种具体的硬件，Linux在TTY之上又封装了一层**UART Framework**，核心也是两个结构体：

**uart_driver** 和 **uart_port**：

```c
struct uart_driver {
    struct module       *owner;
    const char          *driver_name;   // "imx-uart"
    const char          *dev_name;      // "ttymxc" → /dev/ttymxc0
    int                  major;
    int                  nr;            // 支持的最大端口数
    struct tty_driver   *tty_driver;    // 关联的tty_driver（内核自动填）
    // ...
};

struct uart_port {
    unsigned int        iobase;         // 寄存器基地址（物理）
    unsigned int        irq;            // 中断号
    unsigned int        uartclk;        // UART模块时钟频率
    unsigned int        fifosize;       // FIFO深度
    struct uart_ops    *ops;            // 硬件操作：tx/rx/config
    // ...
};
```

`uart_driver`通过`uart_register_driver()`注册，它内部会帮你调用`tty_register_driver()`。然后你用`uart_add_one_port()`把每个`uart_port`挂上去——每挂一个，用户空间就多一个`/dev/ttymxcN`。

这种**双层注册**的设计很巧妙：TTY层负责与用户空间打交道（字符设备、线路规程、termios），UART层负责与硬件打交道（寄存器、中断、FIFO）。你写驱动时只需要填好`uart_ops`里的回调（`tx_empty`/`start_tx`/`startup`/`shutdown`等），TTY层的事情内核帮你包圆了。

```
用户空间
  │  read()/write()
  ▼
/dev/ttymxc0  ──tty_driver───►  tty_struct（会话实例）
                                    │
                              tty_ldisc（线路规程）
                                    │
                               tty_port（缓冲区）
                                    │
                              uart_driver/uart_port
                                    │
                              uart_ops.start_tx()
                                    │
                                硬件TX/RX
```

### 设备树serial节点配置

现代ARM SOC的UART驱动都走Platform总线，设备树里用**serial节点**描述硬件资源。以i.MX6UL为例：

```dts
// arch/arm/boot/dts/imx6ul.dtsi
uart1: serial@02020000 {
    compatible = "fsl,imx6ul-uart", "fsl,imx21-uart";
    reg = <0x02020000 0x4000>;           // 寄存器基址+大小
    interrupts = <GIC_SPI 26 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&clks IMX6UL_CLK_UART1_IPG>,
             <&clks IMX6UL_CLK_UART1_PER>;
    clock-names = "ipg", "per";
    status = "disabled";                  // 默认关闭，板级dts开启
};
```

板级dts里开启并指定引脚：

```dts
// arch/arm/boot/dts/myboard.dts
&uart1 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_uart1>;         // TX/RX引脚配置
    status = "okay";
};

&iomuxc {
    pinctrl_uart1: uart1grp {
        fsl,pins = <
            MX6UL_PAD_UART1_TX_DATA__UART1_DCE_TX  0x1b0b1
            MX6UL_PAD_UART1_RX_DATA__UART1_DCE_RX  0x1b0b1
        >;
    };
};
```

> ⚠️ **陷阱**：`status = "okay"`容易漏写。很多新手复制了节点但忘了把status从disabled改成okay，结果内核probe时直接跳过，/dev下怎么都看不到设备。记住：**看到disabled就是关着的**。

### TTY子系统结构一览

| 结构体 | 所属层 | 职责 | 关键函数 |
|--------|--------|------|----------|
| `tty_driver` | TTY核心层 | 注册字符设备，暴露/dev节点 | `tty_register_driver()` |
| `tty_struct` | TTY核心层 | 一次open对应一个实例，管理会话 | `tty_open()`/`tty_release()` |
| `tty_port` | TTY核心层 | 硬件端口抽象，管理RX缓冲区 | `tty_port_init()`/`tty_buffer_flush()` |
| `tty_ldisc` | 线路规程层 | 数据处理（回车转换、流控字符） | `tty_set_ldisc()` |
| `uart_driver` | UART框架层 | UART驱动注册，关联tty_driver | `uart_register_driver()` |
| `uart_port` | UART框架层 | 描述一个物理UART端口的硬件参数 | `uart_add_one_port()` |
| `uart_ops` | UART驱动层 | 硬件操作回调集（tx/rx/config） | `startup()`/`shutdown()`/`start_tx()` |

---

## <span class="blue"> 知识点292：UART调试工具与方法 [I]

驱动写完了，设备也 probe 了，/dev/ttymxc0 也冒出来了——接下来怎么验证它真的在工作？这一节给你一套**从软件到硬件**的调试组合拳。

### stty：查看与设置串口参数

`stty`（set tty）是Linux自带的串口配置工具，不需要安装。它可以查当前参数、改波特率、开关流控。

```bash
# 查看/dev/ttymxc0的当前配置
stty -F /dev/ttymxc0 -a

# 输出示例：
# speed 115200 baud; rows 0; columns 0; line = 0;
# intr = ^C; quit = ^\; erase = ^?; kill = ^U; eof = ^D; eol = <undef>;
# -parenb -parodd cs8 hupcl -cstopb cread clocal -crtscts
```

| 命令 | 功能 | 示例 |
|------|------|------|
| `stty -F /dev/ttySX -a` | 查看所有参数 | `stty -F /dev/ttymxc0 -a` |
| `stty -F /dev/ttySX speed` | 设置波特率 | `stty -F /dev/ttymxc0 9600` |
| `stty -F /dev/ttySX cs8` | 8位数据位 | `stty -F /dev/ttymxc0 cs8` |
| `stty -F /dev/ttySX -parenb` | 无校验 | `stty -F /dev/ttymxc0 -parenb` |
| `stty -F /dev/ttySX -cstopb` | 1位停止位 | `stty -F /dev/ttymxc0 -cstopb` |
| `stty -F /dev/ttySX crtscts` | 开启RTS/CTS流控 | `stty -F /dev/ttymxc0 crtscts` |
| `stty -F /dev/ttySX raw` | 原始模式（不处理特殊字符） | `stty -F /dev/ttymxc0 raw` |
| `stty -F /dev/ttySX echo -echo` | 开关回显 | `stty -F /dev/ttymxc0 -echo` |
| `stty sane` | 恢复为合理的默认配置 | `stty -F /dev/ttymxc0 sane` |

> 💡 **提示**：`stty raw`在调试传感器时特别有用——默认的N_TTY线路规程会把0x0D转成0x0A、处理Ctrl+C中断，这些对二进制数据是灾难性的。raw模式绕过所有转换，数据原样进出。

### minicom / picocom：串口终端工具

minicom是老派的串口通信工具，功能全面但配置略显繁琐。picocom更轻量，适合快速测试。

**minicom配置步骤：**

```bash
# 1. 以root权限启动配置
minicom -s

# 2. 选择 "Serial port setup"，依次设置：
#    A - Serial Device    : /dev/ttymxc0
#    E - Bps/Par/Bits     : 9600 8N1
#    F - Hardware Flow Control : No
#    G - Software Flow Control : No

# 3. 保存为默认配置（Save setup as dfl）
# 4. 退出配置，进入终端（Exit）
# 5. 退出minicom：Ctrl+A，再按X
```

| minicom参数 | 值 | 说明 |
|-------------|-----|------|
| Serial Device | `/dev/ttymxc0` | 目标串口设备 |
| Baudrate | `9600` | 波特率，与对端一致 |
| Data Bits | `8` | 数据位 |
| Parity | `None` | 无校验 |
| Stop Bits | `1` | 停止位 |
| HW Flow | `No` | 无硬件流控（GPS通常不需要） |
| SW Flow | `No` | 无软件流控 |

**picocom的等价操作更简洁：**

```bash
# 打开串口，9600波特率，8N1，无流控
picocom -b 9600 -d 8 -p none /dev/ttymxc0

# 退出：Ctrl+A 然后 Ctrl+X
```

> 💡 **提示**：其实还有更简单的——`screen /dev/ttymxc0 115200`。screen几乎预装在每个Linux发行版上，不需要额外安装，一行命令直接进终端，按`Ctrl+A`然后`k`再`y`退出。调试串口时它是我的首选。

### 回环测试（Loopback Test）

回环测试是验证UART硬件通路是否正常的**金标准**。方法简单粗暴：把TX和RX短接，自己发自己收。

```
    ┌──────────────┐
    │    CPU       │
    │  ┌────────┐  │
    │  │  TX    ├──┼──┐
    │  └────────┘  │  │  跳线短接
    │  ┌────────┐  │  │
    │  │  RX    ├──┼──┘
    │  └────────┘  │
    └──────────────┘
```

```bash
# 方法1：用stty配置 + cat读取（另一个终端）
stty -F /dev/ttymxc0 115200 cs8 -parenb -cstopb raw
echo "HELLO" > /dev/ttymxc0          # 终端1发送
cat /dev/ttymxc0                     # 终端2接收

# 方法2：用shell一次性测试
stty -F /dev/ttymxc0 115200 cs8 raw -echo
echo -n "LOOPBACK_TEST" > /dev/ttymxc0 && cat -v < /dev/ttymxc0

# 如果屏幕上打印出 LOOPBACK_TEST → 硬件通路OK
# 如果什么都没有 → 检查引脚、时钟、设备树status
```

回环测试能帮你快速定位问题层级：

| 现象 | 结论 | 下一步 |
|------|------|--------|
| 回环能收到数据 | 硬件TX/RX通路正常 | 检查对端设备 |
| 回环收不到数据 | 硬件或驱动有问题 | 查dmesg/时钟/引脚 |
| 数据乱码 | 波特率不匹配 | stty核对双方波特率 |
| 丢字节 | 缓冲区溢出 | 增大FIFO阈值/提高读取优先级 |

### /proc/tty/driver：查看驱动状态

Linux在procfs里暴露了TTY子系统的运行时信息：

```bash
# 查看UART驱动的统计信息
cat /proc/tty/driver/IMX-uart

# 输出示例：
# 0: uart:IMX mmio:0x02020000 irq:58 tx:1234 rx:5678...
# 1: uart:IMX mmio:0x021E8000 irq:59 tx:0 rx:0 CTS|DSR|CD

# 查看所有TTY设备
cat /proc/tty/drivers

# 查看当前打开的TTY会话
ls -la /proc/[pid]/fd/ | grep tty
```

`tx`和`rx`的计数器在排查"发出去没收到"这类问题时非常有用——如果tx计数器没涨，数据卡在上层；如果tx涨了但rx没涨（对端），问题在物理线路上。

---

## <span class="blue"> 行业实例：NEO-6M GPS模块UART读取与调试Console

我们来做一个完整的实战：用i.MX6UL的UART1连接**u-blox NEO-6M GPS模块**，读取NMEA协议的定位数据，同时把UART2配置为调试Console输出printk日志。

### NEO-6M模块概述

NEO-6M是u-blox出品的高性价比GPS接收模块，嵌入式领域用得极广。它上电后通过UART持续输出NMEA格式的定位语句，默认波特率**9600bps**，8N1。

| 参数 | 规格 |
|------|------|
| 供电电压 | 3.3V ~ 5V（板载LDO兼容） |
| UART电平 | TTL 3.3V（可直接接SOC） |
| 默认波特率 | 9600 bps |
| 协议 | NMEA 0183（可切换UBX二进制） |
| 冷启动定位 | ~27秒（典型） |
| 热启动定位 | ~1秒 |
| 灵敏度 | -161 dBm（追踪） |

> ⚠️ **陷阱**：NEO-6M**冷启动首次定位（TTFF，Time To First Fix）需要30秒以上**。冷启动指模块没有星历/历书备份、没有近似位置和时间——这时候它要从头搜索卫星信号。很多新手第一次调试GPS，接上电源没看到数据就开始改代码、查接线，其实根本不是代码问题。**耐心等30~60秒**，放在窗边或户外，看到模块上的PPS灯开始闪烁才说明定位成功。调试时可以用热启动（有备份电源保持RTC）缩短到1~3秒。

### 硬件接线

```
         i.MX6UL                       NEO-6M模块
    ┌─────────────┐              ┌──────────────┐
    │   UART1_TX  ├─────────────►│ RX           │
    │   UART1_RX  │◄─────────────┤ TX           │
    │   GND       ├──────────────┤ GND          │
    │   3.3V      ├──────────────┤ VCC          │
    └─────────────┘              └──────────────┘
```

记住UART的**交叉接线**：TX接RX，RX接TX。GND必须共地，否则电平参考不一致导致乱码。如果模块是5V供电但TX/RX是5V电平，中间要加电平转换芯片（如TXS0102）或直接用电阻分压，避免烧坏SOC的3.3V GPIO。

### 完整设备树配置

```dts
// arch/arm/boot/dts/myboard.dts

/ {
    aliases {
        serial0 = &uart1;    // UART1用于GPS通信
        serial1 = &uart2;    // UART2用于调试console
    };

    chosen {
        stdout-path = "serial1:115200n8";    // 内核printk输出到UART2
    };
};

// ========== UART1：GPS通信 ==========
&uart1 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_uart1>;
    status = "okay";
};

&iomuxc {
    pinctrl_uart1: uart1grp {
        fsl,pins = <
            MX6UL_PAD_UART1_TX_DATA__UART1_DCE_TX    0x1b0b1
            MX6UL_PAD_UART1_RX_DATA__UART1_DCE_RX    0x1b0b1
        >;
    };
};

// ========== UART2：调试Console ==========
&uart2 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_uart2>;
    status = "okay";
};

&iomuxc {
    pinctrl_uart2: uart2grp {
        fsl,pins = <
            MX6UL_PAD_UART2_TX_DATA__UART2_DCE_TX    0x1b0b1
            MX6UL_PAD_UART2_RX_DATA__UART2_DCE_RX    0x1b0b1
        >;
    };
};
```

> 💡 **提示**：`chosen`节点的`stdout-path`是**早期printk**的关键配置。内核在真正的console驱动注册之前（decompress阶段），就靠这个字符串知道往哪个UART吐日志。格式是`"设备别名:波特率校验位数据位"`，比如`serial1:115200n8`表示115200波特率、无校验、8数据位。如果启动时内核卡死看不到信息，首先检查这里有没有配对。

### 内核配置

确保内核开启了以下配置：

```bash
# 通用TTY层
CONFIG_TTY=y

# i.MX UART驱动
CONFIG_SERIAL_IMX=y          # 或 =m 编译为模块

# Console支持（必须=Y，不能是模块）
CONFIG_CONSOLE_TRANSLATIONS=y
CONFIG_VT=y

# 早期printk（调试启动卡死必备）
CONFIG_DEBUG_LL=y
CONFIG_EARLY_PRINTK=y
```

### 用户空间读取NMEA数据

模块上电后，用minicom或直接用cat就能看到原始NMEA数据流：

```bash
# 先配置串口参数
stty -F /dev/ttymxc0 9600 cs8 -parenb -cstopb raw -echo

# 直接cat查看原始输出
cat /dev/ttymxc0

# 你会看到类似这样的数据流（一行一行滚动）：
# $GPGGA,123519,4807.038,N,01131.324,E,1,08,0.9,545.4,M,46.9,M,,*47
# $GPRMC,123519,A,4807.038,N,01131.324,E,022.4,084.4,230394,003.1,W*6A
# $GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39
```

### NMEA句子格式解析

NMEA 0183协议以`$`开头、`\r\n`结尾，每条语句（sentence）最多82字符。逗号分隔字段，最后一个字段是校验和（`*`后面的两字符HEX）。

| 句子 | 字段说明 | 示例 |
|------|----------|------|
| `$GPGGA` | UTC时间、纬度、经度、定位质量、卫星数、HDOP、海拔 | `$GPGGA,123519,4807.038,N,01131.324,E,1,08,0.9,545.4,M,46.9,M,,*47` |
| `$GPRMC` | 推荐最小定位信息：UTC时间、状态、经纬度、速度、航向、日期、磁偏角 | `$GPRMC,123519,A,4807.038,N,01131.324,E,022.4,084.4,230394,,,*43` |
| `$GPGSA` | 当前使用的卫星编号、定位模式、PDOP/HDOP/VDOP | `$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39` |
| `$GPGSV` | 可见卫星信息（编号、仰角、方位角、信噪比） | `$GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,07,344,39*4A` |

> 💡 **提示**：`$GPGGA`的第6个字段是**定位质量指示**：0=未定位，1=GPS定位，2=DGPS定位。你的程序应该先检查这个字段，值为0时后面的经纬度都是无效数据，别拿来用。

### NMEA解析代码（提取$GPGGA的经纬度）

下面是一段C代码，演示如何打开串口、读取NMEA数据、解析`$GPGGA`语句并提取经纬度信息：

```c
/*
 * gps_nmea_parser.c
 * 编译：gcc -o gps_parser gps_nmea_parser.c
 * 运行：./gps_parser /dev/ttymxc0
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <errno.h>

#define BUFFER_SIZE  256
#define NMEA_MAX_LEN 82

/* 配置串口：9600 8N1，原始模式 */
int setup_uart(const char *device)
{
    int fd = open(device, O_RDWR | O_NOCTTY | O_NDELAY);
    if (fd < 0) {
        perror("open");
        return -1;
    }

    struct termios tty;
    memset(&tty, 0, sizeof(tty));

    if (tcgetattr(fd, &tty) != 0) {
        perror("tcgetattr");
        close(fd);
        return -1;
    }

    /* 9600波特率 */
    cfsetispeed(&tty, B9600);
    cfsetospeed(&tty, B9600);

    /* 8N1 */
    tty.c_cflag &= ~PARENB;         // 无校验
    tty.c_cflag &= ~CSTOPB;         // 1位停止位
    tty.c_cflag &= ~CSIZE;
    tty.c_cflag |= CS8;             // 8数据位
    tty.c_cflag |= CREAD | CLOCAL;  // 使能接收，忽略Modem控制线

    /* 原始模式：不做任何输入输出处理 */
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);
    tty.c_iflag &= ~(IXON | IXOFF | IXANY | ICRNL | INLCR | IGNCR);
    tty.c_oflag &= ~OPOST;

    tty.c_cc[VMIN]  = 0;   // 非阻塞读
    tty.c_cc[VTIME] = 5;   // 500ms超时

    if (tcsetattr(fd, TCSANOW, &tty) != 0) {
        perror("tcsetattr");
        close(fd);
        return -1;
    }

    tcflush(fd, TCIOFLUSH);   // 清空残留数据
    return fd;
}

/* 计算NMEA校验和（$和*之间的所有字符XOR） */
int nmea_checksum(const char *sentence)
{
    unsigned char checksum = 0;

    while (*sentence && *sentence != '*') {
        checksum ^= *sentence;
        sentence++;
    }
    return checksum;
}

/* 解析$GPGGA语句，提取经纬度
 * 格式：$GPGGA,hhmmss.ss,lat,NS,lon,EW,fix,sats,hdop,alt,alt_unit,...
 */
int parse_gpgga(const char *sentence, double *latitude, double *longitude,
                int *fix_quality, int *num_satellites)
{
    char buf[NMEA_MAX_LEN];
    strncpy(buf, sentence, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    /* 先校验 */
    char *star = strchr(buf, '*');
    if (!star) return -1;

    int checksum;
    sscanf(star + 1, "%2x", &checksum);
    *star = '\0';
    if (nmea_checksum(buf + 1) != checksum) {
        fprintf(stderr, "Checksum mismatch!\n");
        return -1;
    }

    /* 解析字段 */
    char *token = strtok(buf, ",");
    if (!token || strcmp(token, "$GPGGA") != 0) return -1;

    char *utc_time   = strtok(NULL, ",");   // hhmmss.ss
    char *lat_str    = strtok(NULL, ",");   // ddmm.mmmm
    char *ns         = strtok(NULL, ",");   // N/S
    char *lon_str    = strtok(NULL, ",");   // dddmm.mmmm
    char *ew         = strtok(NULL, ",");   // E/W
    char *fix_str    = strtok(NULL, ",");   // fix quality
    char *sats_str   = strtok(NULL, ",");   // num satellites

    if (!lat_str || !lon_str || !ns || !ew || !fix_str) return -1;

    *fix_quality    = atoi(fix_str);
    *num_satellites = sats_str ? atoi(sats_str) : 0;

    /* NMEA坐标格式：ddmm.mmmm → 十进制度数 */
    double lat_deg, lat_min, lon_deg, lon_min;
    sscanf(lat_str, "%2lf%lf", &lat_deg, &lat_min);
    sscanf(lon_str, "%3lf%lf", &lon_deg, &lon_min);

    *latitude  = lat_deg + lat_min / 60.0;
    *longitude = lon_deg + lon_min / 60.0;

    if (ns[0] == 'S') *latitude  = -*latitude;
    if (ew[0] == 'W') *longitude = -*longitude;

    return 0;
}

int main(int argc, char *argv[])
{
    const char *device = (argc > 1) ? argv[1] : "/dev/ttymxc0";

    printf("Opening GPS device: %s\n", device);
    int fd = setup_uart(device);
    if (fd < 0) return 1;

    printf("Waiting for GPS fix... (cold start may take 30-60s)\n");
    printf("Place module near window or outdoors for best signal.\n\n");

    char buffer[BUFFER_SIZE];
    char line[NMEA_MAX_LEN];
    int line_pos = 0;

    while (1) {
        int n = read(fd, buffer, sizeof(buffer) - 1);
        if (n < 0) {
            if (errno == EAGAIN) continue;
            perror("read");
            break;
        }
        buffer[n] = '\0';

        /* 逐字节处理，提取完整NMEA行 */
        for (int i = 0; i < n; i++) {
            if (buffer[i] == '$') {
                line_pos = 0;           // 新语句开始
            }
            if (line_pos < sizeof(line) - 1) {
                line[line_pos++] = buffer[i];
            }
            if (buffer[i] == '\n' && line_pos > 0) {
                line[line_pos] = '\0';

                /* 解析$GPGGA */
                if (strncmp(line, "$GPGGA", 6) == 0) {
                    double lat, lon;
                    int fix, sats;

                    if (parse_gpgga(line, &lat, &lon, &fix, &sats) == 0) {
                        printf("[Fix=%d, Sats=%2d] Lat=%.6f°, Lon=%.6f°\n",
                               fix, sats, lat, lon);
                        if (fix == 0) {
                            printf("  → No fix yet. Keep waiting...\n");
                        }
                    }
                }
                line_pos = 0;
            }
        }
    }

    close(fd);
    return 0;
}
```

编译并运行：

```bash
# 在开发板上交叉编译
${CC} -o gps_parser gps_nmea_parser.c

# 运行
./gps_parser /dev/ttymxc0

# 输出示例（冷启动后约40秒）：
# Waiting for GPS fix... (cold start may take 30-60s)
# [Fix=0, Sats= 0] Lat=0.000000°, Lon=0.000000°
#   → No fix yet. Keep waiting...
# [Fix=0, Sats= 3] Lat=0.000000°, Lon=0.000000°
#   → No fix yet. Keep waiting...
# [Fix=1, Sats= 8] Lat=31.230416°, Lon=121.473701°
```

### 调试串口Console（UART2）

把UART2配置为console后，内核启动日志、printk输出、U-Boot交互全都走这个口。接线是TX→USB转串口模块的RX，RX→TX，GND共地。

```
    PC (USB转TTL)                    i.MX6UL
    ┌──────────────┐              ┌─────────────┐
    │  USB-TTL_RX  │◄─────────────┤ UART2_TX    │
    │  USB-TTL_TX  ├─────────────►│ UART2_RX    │
    │  GND         ├──────────────┤ GND         │
    └──────────────┘              └─────────────┘
         │
    [minicom/Putty]
    115200 8N1
```

**U-Boot交互**：上电时按任意键进入U-Boot命令行，通过UART2可以刷固件、改环境变量、调试启动参数。

```bash
# U-Boot里查看和修改console
=> printenv console
console=ttymxc1,115200

=> setenv console ttymxc1,115200n8
=> saveenv
```

**内核printk级别控制**：

```bash
# 查看当前printk级别
cat /proc/sys/kernel/printk
# 输出：7 4 1 7   （控制台级别、默认、最小、boot默认）

# 让所有日志都输出到console（包括DEBUG级别）
echo 8 > /proc/sys/kernel/printk

# 在内核命令行里加（永久生效）
# console=ttymxc1,115200n8 loglevel=7 debug
```

---

## <span class="blue"> 本节总结

| 主题 | 核心内容 | 关键点 |
|------|----------|--------|
| TTY子系统分层 | tty_driver → tty_struct → tty_port → uart_driver → uart_port | 双层注册：TTY层对用户空间，UART层对硬件 |
| 设备树配置 | serial节点 + pinctrl指定TX/RX引脚 + status="okay" | 别忘开status，别忘配chosen stdout-path |
| stty调试 | 查看/设置波特率、数据位、校验、流控 | `stty -F /dev/ttySX raw`用于二进制数据 |
| 终端工具 | minicom（功能全）、picocom（轻量）、screen（最方便） | screen /dev/ttySX 波特率，一行搞定 |
| 回环测试 | TX短接RX，自发自收验证硬件 | 收不到查硬件/驱动，收到但乱码查波特率 |
| NEO-6M GPS | 9600bps NMEA输出，$GPGGA/$GPRMC解析 | 冷启动30秒+，看fix quality判断是否有效 |
| Console配置 | chosen stdout-path + U-Boot console env | 早期printk靠它，启动卡死时救命 |

**常用调试速查：**

```bash
# 1. 快速验证串口存在
ls -la /dev/ttymxc*

# 2. 查看驱动是否probe成功
dmesg | grep -i uart
dmesg | grep -i imx-uart

# 3. 查看当前串口参数
stty -F /dev/ttymxc0 -a

# 4. 回环测试
stty -F /dev/ttymxc0 115200 cs8 raw -echo
echo -n "TEST" > /dev/ttymxc0 && cat -v < /dev/ttymxc0

# 5. 用screen快速打开串口
screen /dev/ttymxc0 9600

# 6. 查看驱动统计
cat /proc/tty/driver/IMX-uart

# 7. 清空串口缓冲区
tcflush(fd, TCIOFLUSH)   // 代码中
stty -F /dev/ttymxc0 sane // 命令行重置
```

---

## <span class="blue"> 下一步

下一节 **B-A.4.3 RS-485与Modbus协议**，我们把UART从点对点通信扩展到总线型拓扑——RS-485的差分信号如何实现1200米长距离传输、半双工的总线仲裁怎么做、Modbus RTU的帧格式和CRC校验如何写。如果你做工业控制、传感器网络，那是必会的一课。

---

## <span class="blue"> 配套资源

- **NMEA 0183协议规范**：u-blox官方文档《NEO-6 Data Sheet》+ 《NMEA Protocol Specification》
- **Linux TTY子系统文档**：内核源码 `Documentation/driver-api/tty.rst`
- **UART Framework源码**：`drivers/tty/serial/serial_core.c`
- **i.MX UART驱动**：`drivers/tty/serial/imx.c`
- **工具安装**：`apt-get install minicom picocom screen`
- **GPS测试**：GPSTest Android App（对比验证NEO-6M输出准确性）
- **回环测试工具**：`busybox stty`（嵌入式环境通常自带）
