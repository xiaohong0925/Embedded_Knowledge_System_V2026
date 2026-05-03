<span class="badge-i">[I]</span><span class="badge-e">[E]</span>

# UART Linux 终端与调试

<span class="red">Linux 内核将 UART 抽象为 tty 设备节点，用户空间通过 termios 接口配置，内核空间通过串口驱动和 earlycon 机制将 UART 作为系统启动控制台。</span> 掌握设备节点分类、stty 诊断、bootconsole 和设备树配置，是嵌入式 Linux 调试的必备技能。

---

## Linux UART 设备节点

<span class="red">Linux 中 UART 对应三类设备节点：物理串口 /dev/ttyS*、USB 转串口 /dev/ttyUSB*、USB CDC-ACM 虚拟串口 /dev/ttyACM*。</span>

### 节点分类

| 节点 | 驱动 | 典型硬件 |
|------|------|----------|
| /dev/ttyS0 | 8250/16550 驱动 | SoC 内置 UART |
| /dev/ttyS1 | 8250/16550 驱动 | 扩展串口 |
| /dev/ttyUSB0 | usbserial / cp210x / ch341 | USB 转 TTL 模块 |
| /dev/ttyACM0 | cdc_acm | Arduino、部分开发板 |

### udev 规则与别名

USB 转串口芯片的端口顺序由插入顺序决定，重启后可能变化。通过 udev 规则绑定设备序列号（serial）可创建固定别名：

```bash
# /etc/udev/rules.d/99-usb-serial.rules
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", ATTRS{serial}=="12345", SYMLINK+="myuart"
```

重载规则后，`/dev/myuart` 始终指向目标设备。

<span class="blue">易错点：/dev/ttyS* 与 /dev/ttyUSB* 不能混用。直接操作 /dev/ttyS0 而实际插的是 USB 转串口，会导致 open 成功但读写无响应。</span>

### 串口权限问题

普通用户默认无法访问 /dev/ttyS* 和 /dev/ttyUSB*，需要加入 dialout 组：

```bash
sudo usermod -a -G dialout $USER
```

<span class="blue">易错点：加入 dialout 组后需要重新登录才会生效，直接执行 `newgrp dialout` 可立即生效但仅对当前 shell 有效。</span>

---

## stty 命令完整输出解读

<span class="red">stty（set tty）是查看和修改串口参数的命令行工具，输出包含速度、控制字符、标志位等全部信息。</span>

### 查看当前配置

```bash
$ stty -F /dev/ttyUSB0 -a
speed 115200 baud; rows 0; columns 0; line = 0;
intr = ^C; quit = ^\; erase = ^?; kill = ^U;
eof = ^D; eol = <undef>; eol2 = <undef>; swtch = <undef>;
start = ^Q; stop = ^S; susp = ^Z; rprnt = ^R; werase = ^W;
lnext = ^V; discard = ^O; min = 1; time = 0;
-parenb -parodd -cmspar cs8 -hupcl -cstopb cread clocal -crtscts
-ignbrk -brkint -ignpar -parmrk -inpck -istrip -inlcr -igncr -icrnl
-ixon -ixoff -iuclc -ixany -imaxbel -iutf8
opost -olcuc -ocrnl onlcr -onocr -onlret -ofill -ofdel nl0 cr0 tab0 bs0 vt0 ff0
isig icanon iexten echo echoe echok -echonl -noflsh -xcase -tostop
-echoprt echoctl echoke -flusho -extproc
```

### 关键字段解读

| 输出 | 含义 |
|------|------|
| speed 115200 baud | 波特率 115200 |
| cs8 | 8 位数据 |
| -parenb | 无校验 |
| -cstopb | 1 位停止位 |
| -crtscts | 无硬件流控 |
| -ixon | 无软件流控 |
| min = 1; time = 0 | 阻塞读取，至少 1 字节 |

<span class="blue">易错点：stty 默认进入规范模式（icanon），回车键发送 0x0D，驱动自动转换为 0x0A。原始模式下需手动处理换行符。</span>

### 常用 stty 设置

```bash
# 设置 115200 8N1
stty -F /dev/ttyUSB0 115200 cs8 -parenb -cstopb

# 禁用所有处理，进入原始模式
stty -F /dev/ttyUSB0 raw -echo

# 重置为默认值
stty -F /dev/ttyUSB0 sane
```

### 与 termios 的对应关系

stty 命令本质上是 termios 结构体的命令行封装。`stty raw` 等价于设置 `c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG)`，`stty 115200` 等价于 `cfsetospeed(&tty, B115200)`。

---

## UART 作为 bootconsole

<span class="red">内核启动阶段尚未挂载文件系统时，通过 earlycon 将 UART 作为最早可用的输出通道，用于打印启动日志和调试信息。</span>

### 内核命令行配置

```
console=ttyS0,115200n8 earlycon=uart8250,mmio32,0xff190000,115200n8
```

| 参数 | 含义 |
|------|------|
| console=ttyS0,115200n8 | 主控制台绑定到 UART0 |
| earlycon | 早期控制台，在 printk 初始化前即可输出 |
| uart8250 | 使用 8250 驱动早期输出 |
| mmio32 | 32 位 MMIO 访问 |
| 0xff190000 | UART 寄存器基地址 |

### 设备树中的 chosen 节点

```dts
/ {
    chosen {
        stdout-path = "serial0:115200n8";
    };
};
```

<span class="blue">结论：没有 bootconsole 时，内核 panic 的调用栈信息无法输出，调试极为困难。所有嵌入式 Linux 项目都应优先配置串口控制台。</span>

### earlycon 与 console 的区别

earlycon 在内核解压后就可用，比 console 更早。earlycon 使用轮询方式输出，不依赖中断和 DMA；console 初始化后使用中断驱动，支持更丰富的功能（如 printk 缓冲区、控制台切换）。

---

## 设备树 serial 节点配置

<span class="red">设备树（Device Tree）描述硬件拓扑，serial 节点定义 UART 外设的寄存器、中断、时钟和默认波特率。</span>

### 典型节点示例

```dts
uart0: serial@ff190000 {
    compatible = "snps,dw-apb-uart";
    reg = <0xff190000 0x100>;
    interrupts = <GIC_SPI 55 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&cru SCLK_UART0>, <&cru PCLK_UART0>;
    clock-names = "baudclk", "apb_pclk";
    status = "okay";
    current-speed = <115200>;
};
```

### 关键属性

| 属性 | 作用 |
|------|------|
| compatible | 匹配内核驱动（如 "snps,dw-apb-uart"） |
| reg | 寄存器基地址和长度 |
| interrupts | 中断号和触发方式 |
| clocks | 时钟源引用 |
| status | "okay" 启用，"disabled" 关闭 |
| current-speed | 默认波特率 |

<span class="blue">易错点：忘记设置 status = "okay" 时，设备树节点存在但驱动不会 probe，/dev/ttyS* 不会出现。</span>

### 多串口映射

设备树别名（aliases）定义逻辑编号到物理节点的映射：

```dts
aliases {
    serial0 = &uart0;
    serial1 = &uart1;
    serial2 = &uart2;
};
```

内核按 aliases 顺序创建 /dev/ttyS0、/dev/ttyS1、/dev/ttyS2。

---

## 常见问题诊断

<span class="red">UART 调试中最常见的问题是"能看到设备节点但收不到数据"，需要系统性排查物理层到应用层的每个环节。</span>

### 波特率不匹配

症状：收到乱码或完全无输出。<br>
诊断：用逻辑分析仪捕获 TX 波形，测量起始位宽度，反推实际波特率。或用 `stty` 确认两端配置一致。<br>
解决：统一波特率；检查晶振频率是否正确；确认未使用波特率倍增模式。

### 流控冲突

症状：发送少量数据正常，大数据量时卡住。<br>
诊断：`stty -a` 检查 -crtscts / -ixon 状态。用示波器查看 RTS/CTS 电平。<br>
解决：两端流控配置一致（都开或都关）；硬件流控时确保 RTS/CTS 物理连接。

### DMA 丢包

症状：高速连续传输时偶发丢字节。<br>
诊断：查看 `/proc/interrupts` 中 UART 中断计数，若 RX 中断持续增长而 DMA 计数不增，说明 DMA 未启用或配置错误。<br>
解决：检查设备树 DMA 通道配置；增大 DMA buffer 大小；启用 UART 的 DMA 模式位。

| 现象 | 根因 | 排查命令 |
|------|------|----------|
| 全乱码 | 波特率错误 | `stty -F /dev/ttyS0` |
| 发完卡住 | 流控开启但无连线 | 示波器测 CTS |
| 丢零散字节 | FIFO 阈值/超时问题 | `dmesg \| grep tty` |
| 高负载丢包 | DMA 未启用 | `cat /proc/interrupts` |

---

## 小节

- /dev/ttyS* 是物理串口，/dev/ttyUSB* 和 /dev/ttyACM* 是 USB 虚拟串口。
- stty 是调试串口参数的首选工具，理解 -a 输出中的每个标志。
- bootconsole 是内核调试的生命线，设备树 chosen 节点必须正确配置。
- 波特率、流控、DMA 是三大高频故障点，排查时从物理层逐层向上。
- 串口控制台不仅是调试工具，更是现场运维的唯一入口，配置时应保留硬件和软件两套回退方案。
