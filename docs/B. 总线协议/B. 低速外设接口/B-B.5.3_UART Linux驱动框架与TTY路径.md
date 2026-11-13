# B-B.5.3 UART Linux 驱动框架与 TTY 路径

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 串口
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

B-B.5.2 已经沿 `$` 的波形解释了 UART4 怎样恢复出 `0x24`。但这个字节还停在控制器与内核驱动之间，用户程序不能直接从 UART 寄存器里取走它。它还要经过 8250 驱动、serial core、TTY 缓冲和线路规程，最后由一次 `read()` 返回。TTY 是 Linux 的终端设备子系统；8250 则指 Linux 对 8250／16550 系列及其兼容 UART 的通用驱动支持，不是 RK3568 的芯片型号。

本节只回答一个问题：**UART4 已经恢复出的 `0x24`，怎样经过 8250、serial core 和 TTY 到达用户态 `read()`，termios 又分别改变哪些硬件与终端行为？**

全文沿用同一笔接收：板级设备树启用 UART4 后，`serial4 = &uart4` 对应 `/dev/ttyS4`，用户程序打开这个端口并设置 9600、8N1，最终读到 `0x24`。板级启用只是教学假设，当前没有取得实际板级 DTS，不能据此声称某块板卡已经存在这个节点。

> 本节覆盖：驱动族与端口注册、TTY 对象生命周期、正常接收与发送调用链、termios 生效路径、raw 与规范模式、短读与短写、serdev 和 USB 串口入口。完整排障、C 串口程序和 NMEA 解析分别归后续篇目。

## <span class="blue"> 先给全路：`0x24` 怎样从 UART4 到达 `read()`

先把完整路径缩短到能一眼看清的程度：

```text
NEO-6M TX
→ RK3568 UART4 接收中断
→ 8250 读取 RX 字节与 LSR
→ serial core 把字节插入 TTY flip buffer
→ flip buffer 工作队列交给 N_TTY
→ N_TTY 按 termios 处理输入
→ tty_read() 调用 N_TTY read
→ 用户缓冲区得到 0x24
```

LSR 是 B-B.5.2 已经介绍的线路状态寄存器。N_TTY 是默认的终端线路规程，负责在驱动交付与用户读取之间处理字符。flip buffer 是 TTY 在驱动与线路规程之间暂存接收字节及其标志的缓冲区；它把中断里的生产动作与工作队列里的消费动作分开，不能让 8250 在中断上下文中直接执行可能睡眠的用户读取路径。

下图把这条路径分成三段。阅读时先找每段负责的文件，再找段与段之间的交接函数。它不是三个可随意替换的名词层，而是同一个 `0x24` 必须经过的真实顺序。

<div style="overflow-x:auto">
<svg viewBox="0 0 1200 600" xmlns="http://www.w3.org/2000/svg" style="max-width:1000px;width:100%;min-width:820px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>0x24 从 UART4 到用户 read 的真实接收路径</title>
<text x="600" y="28" text-anchor="middle" fill="currentColor" stroke="none" font-size="17">同一个 `0x24`：中断生产 → 工作队列交付 → 系统调用消费</text>
<rect x="45" y="60" width="320" height="460" rx="10"/>
<text x="205" y="90" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">硬件与 8250</text>
<rect x="70" y="120" width="270" height="75" rx="6"/>
<text x="205" y="149" text-anchor="middle" fill="currentColor" stroke="none">UART4 接收中断</text>
<text x="205" y="174" text-anchor="middle" fill="currentColor" stroke="none">serial8250_interrupt()</text>
<rect x="70" y="225" width="270" height="90" rx="6"/>
<text x="205" y="253" text-anchor="middle" fill="currentColor" stroke="none">8250_port.c</text>
<text x="205" y="278" text-anchor="middle" fill="currentColor" stroke="none">serial8250_rx_chars()</text>
<text x="205" y="301" text-anchor="middle" fill="currentColor" stroke="none">serial8250_read_char()</text>
<rect x="70" y="345" width="270" height="80" rx="6"/>
<text x="205" y="375" text-anchor="middle" fill="currentColor" stroke="none">字节 0x24 与 LSR 标志</text>
<text x="205" y="400" text-anchor="middle" fill="currentColor" stroke="none">读取完成，推送 flip buffer</text>
<rect x="440" y="60" width="320" height="460" rx="10"/>
<text x="600" y="90" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">serial core 与 TTY 缓冲</text>
<rect x="465" y="120" width="270" height="90" rx="6"/>
<text x="600" y="148" text-anchor="middle" fill="currentColor" stroke="none">serial_core.c</text>
<text x="600" y="173" text-anchor="middle" fill="currentColor" stroke="none">uart_insert_char()</text>
<text x="600" y="196" text-anchor="middle" fill="currentColor" stroke="none">tty_insert_flip_char()</text>
<rect x="465" y="245" width="270" height="90" rx="6"/>
<text x="600" y="273" text-anchor="middle" fill="currentColor" stroke="none">tty_buffer.c</text>
<text x="600" y="298" text-anchor="middle" fill="currentColor" stroke="none">tty_flip_buffer_push()</text>
<rect x="465" y="370" width="270" height="80" rx="6"/>
<text x="600" y="399" text-anchor="middle" fill="currentColor" stroke="none">flush_to_ldisc()</text>
<text x="600" y="424" text-anchor="middle" fill="currentColor" stroke="none">工作队列开始消费</text>
<rect x="835" y="60" width="320" height="460" rx="10"/>
<text x="995" y="90" text-anchor="middle" fill="currentColor" stroke="none" font-size="16">TTY 与用户态</text>
<rect x="860" y="120" width="270" height="90" rx="6"/>
<text x="995" y="148" text-anchor="middle" fill="currentColor" stroke="none">tty_port.c / tty_buffer.c</text>
<text x="995" y="173" text-anchor="middle" fill="currentColor" stroke="none">tty_ldisc_receive_buf()</text>
<rect x="860" y="245" width="270" height="90" rx="6"/>
<text x="995" y="273" text-anchor="middle" fill="currentColor" stroke="none">n_tty.c</text>
<text x="995" y="298" text-anchor="middle" fill="currentColor" stroke="none">n_tty_receive_buf()</text>
<rect x="860" y="370" width="270" height="80" rx="6"/>
<text x="995" y="399" text-anchor="middle" fill="currentColor" stroke="none">tty_io.c：tty_read()</text>
<text x="995" y="424" text-anchor="middle" fill="currentColor" stroke="none">n_tty_read() → copy_to_iter()</text>
<line x1="340" y1="385" x2="440" y2="385"/>
<polygon points="440,385 430,380 430,390" fill="currentColor" stroke="none"/>
<text x="390" y="368" text-anchor="middle" fill="currentColor" stroke="none">插入</text>
<line x1="760" y1="385" x2="835" y2="385"/>
<polygon points="835,385 825,380 825,390" fill="currentColor" stroke="none"/>
<text x="798" y="368" text-anchor="middle" fill="currentColor" stroke="none">交付</text>
<line x1="205" y1="195" x2="205" y2="225"/>
<polygon points="205,225 200,215 210,215" fill="currentColor" stroke="none"/>
<line x1="205" y1="315" x2="205" y2="345"/>
<polygon points="205,345 200,335 210,335" fill="currentColor" stroke="none"/>
<line x1="600" y1="210" x2="600" y2="245"/>
<polygon points="600,245 595,235 605,235" fill="currentColor" stroke="none"/>
<line x1="600" y1="335" x2="600" y2="370"/>
<polygon points="600,370 595,360 605,360" fill="currentColor" stroke="none"/>
<line x1="995" y1="210" x2="995" y2="245"/>
<polygon points="995,245 990,235 1000,235" fill="currentColor" stroke="none"/>
<line x1="995" y1="335" x2="995" y2="370"/>
<polygon points="995,370 990,360 1000,360" fill="currentColor" stroke="none"/>
<text x="600" y="565" text-anchor="middle" fill="currentColor" stroke="none">用户 read() 返回的是本次实际取得的字节数，不保证是一整条 NMEA 语句</text>
</svg>
</div>

这条全路也限定了本篇的责任边界：UART 控制器驱动处理寄存器和中断，serial core 统一 UART 端口，TTY 管理字符设备、缓冲和线路规程，用户程序只通过系统调用取得字节。完整的控制器驱动写作不在本篇展开。

## <span class="blue"> `/dev/ttyS4` 出现前，驱动和端口分别注册了什么

旧稿容易把“注册一次 UART”写成一步，但 v6.6 中必须区分**驱动族注册**与**具体端口注册**。

`serial8250_init()` 先调用 `uart_register_driver(&serial8250_reg)`。这里的 `serial8250_reg` 是 8250 驱动族描述，`dev_name = "ttyS"` 表示这一类设备使用的名称前缀。`uart_register_driver()` 在 serial core 中准备每路 `uart_state`，为其内嵌的 `tty_port` 调用 `tty_port_init()`，再调用 `tty_register_driver()` 把对应的 TTY 驱动族注册进去。

> `uart_driver`：一类 UART 控制器的注册描述，包含驱动名、设备名前缀、端口数量和对应的 `tty_driver`。它不是某一颗 UART4 的寄存器实例。

随后，平台设备匹配让 `dw8250_probe()` 处理 UART4。这个 probe 填充一个 `uart_8250_port` 端口模板：寄存器映射、IRQ、`baudclk`、`set_termios()`、FIFO 和 DMA 等，再调用 `serial8250_register_8250_port()`。后者把硬件端口加入 8250 驱动族，最终通过 `uart_add_one_port()` 链接 serial core 与 TTY。

`rk356x.dtsi` 中的 `serial4 = &uart4` 给这个端口提供编号 4，因此教学路径写作 `/dev/ttyS4`。`snps-dw-apb-uart.yaml` 说明 compatible、时钟和寄存器属性；`serial.yaml` 说明 `serialN` 是端口编号。它们都不能替代板级 `status = "okay"`，也不能证明板级连接器已经引出 UART4。

> `uart_port`：一个具体 UART 端口的硬件与运行描述，保存寄存器访问、时钟、FIFO、状态计数和 `uart_ops`（UART 控制器操作回调表）。`uart_state` 则保存 serial core 为该端口维护的 `tty_port` 和发送环形缓冲区，二者不是同一个对象。

注册完成后，`tty_port_register_device_attr_serdev()` 根据父设备是否存在 serdev 子设备选择普通 TTY 或 serdev 入口。serdev（serial device bus，串行设备总线）用于把 UART 上连接的设备交给内核驱动管理。没有 serdev 子设备时，才注册本节使用的普通字符设备路径。

## <span class="blue"> 端口、终端和线路规程何时建立关系

驱动族与端口注册完成后，还不能把每个对象都理解成“打开一次就新建一次”。它们的创建时机和所有者不同。

| 对象 | 何时创建或关联 | 保存什么 | 生命周期边界 |
|---|---|---|---|
| `uart_driver` | 8250 驱动族初始化 | 一族 UART 的名称、数量和 `tty_driver` | 随驱动族注册与注销 |
| `uart_state` | `uart_register_driver()` 初始化每路状态 | 内嵌 `tty_port`、发送环形缓冲区、对应 `uart_port` | 属于端口，不属于某次 open |
| `uart_port` | `dw8250_probe()` 填充并注册 | UART4 的寄存器、时钟、IRQ、FIFO、回调和统计 | 属于实际硬件端口 |
| `tty_struct` | 打开路径通过 `tty_init_dev()` 建立并安装 | `tty_port`、`tty_ldisc`、termios、`disc_data`、`driver_data` | 由引用计数管理，可对应多个 `file` |
| `tty_ldisc` 与 `n_tty_data` | 打开并设置 N_TTY 线路规程时建立 | 输入处理状态、读缓冲、规范模式状态、流控状态 | 随线路规程打开、关闭和切换 |
| `file` 与 `tty_file_private` | 每次 `open()` | 该次打开的文件状态，并指向共享的 `tty_struct` | 随该次打开关闭，不能等同于端口本身 |

`tty_struct` 的 `driver_data` 指向 serial core 的 `uart_state`，`disc_data` 指向 N_TTY 的私有数据。两个指针名字相近，却分别服务 UART 核心与线路规程，不能混写。

首次 `uart_open()` 通过 `tty_port_open()` 增加端口打开计数，关联 `tty_struct` 与 `tty_port`，并在端口尚未初始化时启动硬件。再次打开可以增加计数并共享端口，而不是重新复制一套 UART4。最后关闭时，`tty_port_close()` 结束打开计数、刷新线路规程并按条件关闭硬件；`tty_struct` 和各私有对象则按各自引用与销毁路径释放。

因此，**“一次 open 对应一个独立 `tty_struct`”不是可接受的概括**。准确说法是：每次 open 都有一个 `file`，TTY 核心按设备与引用关系管理 `tty_struct` 和 `tty_port` 的共享及生命周期。

## <span class="blue"> `tcsetattr()` 怎样改变 UART4 与 N_TTY

用户程序通过 `tcsetattr()` 请求终端参数。C 库最终用 `TCSETS` 等输入输出控制（ioctl）命令进入 `drivers/tty/tty_ioctl.c`，这里的 `set_termios()` 把用户格式转换成内核 `ktermios`，再调用 `tty_set_termios()`。完整 C 配置和备份恢复归 B-B.5.5，本节只跟随参数怎样生效。

`tty_set_termios()` 先保存旧值、更新 `tty->termios`，然后沿两个方向通知：

1. `tty->ops->set_termios` 指向 serial core 的 `uart_set_termios()`。它检查哪些参数确实改变，再经 `uart_change_line_settings()` 调用 `uport->ops->set_termios`。
2. 对 DesignWare UART4，该回调是 `dw8250_set_termios()`。它按目标波特率的 16 倍请求并设置 `baudclk`，再调用 `dw8250_do_set_termios()` 完成通用 8250 帧格式和分频配置。
3. 同一 `tty_set_termios()` 还取得线路规程，调用 N_TTY 的 `set_termios`，让输入处理、raw 状态和控制字符映射随新参数更新。

也就是说，**termios 不是只写给 UART 寄存器的配置，也不是只存在于 TTY 的软件状态**。它同时包含硬件帧格式、流控、终端输入输出处理和读取行为，具体哪一部分生效必须沿对应回调核对。

## <span class="blue"> 接收中断里的 `0x24` 怎样进入 flip buffer

现在回到正常接收。8250 中断入口 `serial8250_interrupt()` 通过 `port->handle_irq()` 进入当前端口，随后 `serial8250_handle_irq()` 判断接收条件并调用 `serial8250_rx_chars()`。后者循环读取 RX 与 LSR，逐字节调用 `serial8250_read_char()`。

`serial8250_read_char()` 做三件事：

- 从 RX 读取当前字节，本例是 `0x24`；
- 根据 LSR 判断是正常数据、帧错误、校验错误、Break 还是溢出，并更新对应计数；
- 把字节和 TTY 标志交给 `uart_insert_char()`。

下面是 serial core 的完整插入函数。`status` 包含硬件状态，`overrun` 单独标出溢出位，`ch` 是数据字节，`flag` 是交给 TTY 的数据类别。

```c
/* drivers/tty/serial/serial_core.c，v6.6，第 3487～3503 行，完整函数 */
void uart_insert_char(struct uart_port *port, unsigned int status,
		      unsigned int overrun, u8 ch, u8 flag)
{
	struct tty_port *tport = &port->state->port;

	if ((status & port->ignore_status_mask & ~overrun) == 0)
		if (tty_insert_flip_char(tport, ch, flag) == 0)
			++port->icount.buf_overrun;

	/*
	 * Overrun is special.  Since it's reported immediately,
	 * it doesn't affect the current character.
	 */
	if (status & ~port->ignore_status_mask & overrun)
		if (tty_insert_flip_char(tport, 0, TTY_OVERRUN) == 0)
			++port->icount.buf_overrun;
}
```

正常 `0x24` 以 `TTY_NORMAL` 插入。若插入失败，`buf_overrun` 增加，这与 UART 硬件 FIFO 的 `overrun` 不是同一个计数位置。发生硬件溢出时，函数还尝试插入一个 `TTY_OVERRUN` 标志，但不把当前数据字节简单改写成零。

`serial8250_rx_chars()` 处理完当前批次后调用 `tty_flip_buffer_push()`。这个函数只提交当前尾部并调度工作：

```c
/* drivers/tty/tty_buffer.c，v6.6，第 529～535 行，完整函数 */
void tty_flip_buffer_push(struct tty_port *port)
{
	struct tty_bufhead *buf = &port->buf;

	tty_flip_buffer_commit(buf->tail);
	queue_work(system_unbound_wq, &buf->work);
}
```

这里发生了一个关键交接：8250 已经把字节放入 flip buffer，但 N_TTY 尚未消费。`queue_work()` 安排的是后续交付，不是把字节直接复制到用户空间。

## <span class="blue"> flip buffer 的字节怎样被 N_TTY 交付

`buf.work` 在 `tty_buffer_init()` 时绑定到 `flush_to_ldisc()`。工作队列运行后，该函数沿缓冲区链表找到已经提交但尚未读取的数据，通过端口的 `client_ops->receive_buf` 交付。

普通 TTY 端口使用 `tty_port_default_client_ops`。其 `tty_port_default_receive_buf()` 从 `port->itty` 找到当前 `tty_struct`，取得线路规程引用，再调用 `tty_ldisc_receive_buf()`。

`tty_ldisc_receive_buf()` 优先使用线路规程的 `receive_buf2`；否则限制为 `receive_room`，再调用 `receive_buf`。N_TTY 同时提供 `receive_buf2` 和 `receive_buf`，本例最终进入 `n_tty_receive_buf_common()`，按当前 termios 处理 `0x24`：

- raw 输入下，它作为普通数据进入 N_TTY 读缓冲；
- 启用软件流控时，控制字符会先经过流控判断；
- 启用错误标记时，帧、校验、Break 和溢出标志会影响交付方式；
- 规范模式下，数据还要形成一行后才按规范读取语义交付。

这里也能看出，`raw` 并没有让 flip buffer 或 N_TTY 消失。它改变的是 N_TTY 对输入和终端行为的处理，数据仍沿同一交付路径到达读取端。

下面的 Framework Lab 把同一笔接收和一次 termios 配置拆成可前进、后退和复位的步骤。每一步都对应上面的源码路径，完整函数与源码工作台用于恢复上下文；模型不连接真实硬件。

<div class="interactive-demo">
  <iframe
    src="../html/uart-framework-lab.html"
    title="B-B.5.3 UART Framework Lab"
    loading="lazy"
    style="width:100%;height:960px;border:0;"
  ></iframe>
</div>

[在新窗口打开 UART Framework Lab](./html/uart-framework-lab.html){: target="_blank" rel="noopener noreferrer" }。正文已经给出完整论证，实验室只用于对照步骤、完整函数和同源文件。

## <span class="blue"> `raw`、规范模式和 `read()` 结果有什么不同

用户调用 `read()` 后，`tty_read()` 取得线路规程引用，进入 `iterate_tty_read()`。后者循环调用线路规程的 `read`，把内核缓冲中的数据复制到用户迭代器。N_TTY 的 `n_tty_read()` 决定当前能交付多少、是否等待以及何时返回。

### termios 分组不能混为一件事

| 参数组 | 代表字段或标志 | 对当前路径的影响 |
|---|---|---|
| UART 帧与硬件 | `CS8`、`PARENB`、`CSTOPB`、输入／输出速率、`CRTSCTS` | 经 `uart_set_termios()` 和 `dw8250_set_termios()` 改变 UART4 配置 |
| 输入处理 | `ICRNL`、`IGNBRK`、`BRKINT`、`PARMRK`、`INPCK`、`IXON／IXOFF` | 影响换行、Break／校验标记、软件流控和控制字符 |
| 输出处理 | `OPOST`、`ONLCR` | 影响写向设备前的输出转换 |
| 终端与作业控制 | `ICANON`、`ECHO`、`ISIG`、`IEXTEN` | 影响行组织、回显、特殊字符和信号行为 |
| 控制字符与读取 | `c_cc[]`、`VMIN`、`VTIME` | 决定特殊字符含义及非规范模式的读取条件 |

`n_tty_set_termios()` 会根据这些字段更新 `raw`、`real_raw`、`icanon` 和 `char_map`。`char_map` 标记哪些字符需要特殊处理，raw 状态则改变 N_TTY 对数据的解释。`real_raw` 还要求 Break／校验错误处理标志与驱动 `TTY_DRIVER_REAL_RAW` 能力同时满足，不能与 raw 混为一谈。它们都不是绕过 serial core、flip buffer 或整个 TTY 的开关。

### 同一个 `0x24` 可以怎样返回

规范模式（`ICANON` 有效）以行组织输入。`$` 本身不是换行，所以只收到它时，通常还不能把一整行交给用户。非规范模式不等待行边界，`n_tty_read()` 会按当前数据和 `VMIN／VTIME` 决定返回。

即使一次 NMEA 语句连续到达，用户选择的长度、当前已交付数据和非阻塞设置也会改变结果：

- 返回 `1`，用户缓冲区只有 `0x24`：本次只读到一个字节，不代表出错；
- 返回较小正数：本次取得部分数据，下一字节的 NMEA 内容仍需继续读取；
- 返回 `0`：在非规范且 `VMIN = 0、VTIME = 0` 的当前无数据情形下，可以表示当前没有字节可读；其他模式下还要结合文件状态判断；
- 返回负值：需要按错误码区分，不能把设备无数据、被信号打断和真正的 I/O 错误混为一谈。

因此，**`read()` 的返回边界是本次系统调用实际交付的字节数，不是 UART 帧边界，更不是 NMEA 语句边界**。流式组帧、校验和字段解析归 B-B.5.5。

## <span class="blue"> `write()` 沿相反方向怎样到达 TX

发送路径可以沿同一个端口反向跟随，但不需要另建一个数据实例。`tty_write()` 经 `file_tty_write()` 和 `iterate_tty_write()` 调用 N_TTY 的 `write`，N_TTY 按输出处理规则处理后进入 serial core 的 `uart_write()`。

`uart_write()` 从 `tty->driver_data` 找到 `uart_state`，把数据复制到 `state->xmit` 环形缓冲区，并推进 `head`。下面这段原文显示，写入返回前还有缓冲区是否存在和剩余空间的判断：

```c
/* drivers/tty/serial/serial_core.c，v6.6，第 598～620 行，节选 */
	port = uart_port_lock(state, flags);
	circ = &state->xmit;
	if (!circ->buf) {
		uart_port_unlock(port, flags);
		return 0;
	}

	while (port) {
		c = CIRC_SPACE_TO_END(circ->head, circ->tail, UART_XMIT_SIZE);
		if (count < c)
			c = count;
		if (c <= 0)
			break;
		memcpy(circ->buf + circ->head, buf, c);
		circ->head = (circ->head + c) & (UART_XMIT_SIZE - 1);
		buf += c;
		count -= c;
		ret += c;
	}

	__uart_start(state);
	uart_port_unlock(port, flags);
	return ret;
```

`__uart_start()` 最终启动端口发送，8250 通过 `serial8250_start_tx()` 和 `serial8250_tx_chars()` 把环形缓冲区中的字节写入 TX FIFO。`uart_write()` 返回 `ret` 表示本次接受的字节数，可能小于请求长度。

所以，**短写表示当前只接受到缓冲区中的一部分，发送完成则要求后续数据真正离开硬件**。不能用一次 `write()` 返回值推断对端已经收到，更不能用 FIFO 已空推断最后一个停止位已经离开 TX 引脚。发送完成的系统观察归 B-B.5.4，RS-485 的方向切换边界归 B-B.5.6。

## <span class="blue"> UART 一定给用户态暴露 TTY 吗：serdev 与 USB 串口

### serdev 把同一 UART 变成内核设备的接入总线

有些 UART 上连接的不是供人读写的终端，而是需要由内核驱动管理的设备。设备树在 UART 节点下声明带 compatible 的子节点时，`tty_port_register_device_attr_serdev()` 会先尝试 serdev 注册，成功时不再为该端口创建普通 TTY 字符设备。

`serdev/core.c` 为子节点创建 `serdev_device` 并与控制器关联，`serdev-ttyport.c` 则把 TTY 端口操作转换成 serdev 控制器操作。打开时，`ttyport_open()` 初始化 TTY 端口并设置一组已知的串口参数；接收时，端口的 `client_ops` 不再走普通 `tty_port_default_receive_buf()`，而是由 `ttyport_receive_buf()` 调用 `serdev_controller_receive_buf()`，把字节交给内核中的 serdev 客户端驱动。

这条路径仍可复用 8250 和 flip buffer，但数据终点变成内核设备驱动，而不是用户态 `read()`。通用 `serial.yaml` 也规定蓝牙、GNSS 等串口子节点应位于宿主 UART 节点下。

本节的 NEO-6M 实例默认走普通 TTY。只有实际板级 DTS 和驱动明确采用 serdev 时，才改走这条分支，不能看到 GPS 就自动宣称使用 serdev。

### USB 串口换的是硬件入口，不是全部上层路径

USB 转串口设备不经过 `dw8250_probe()`。`drivers/usb/serial/usb-serial.c` 的 `usb_serial_probe()` 负责 USB 接口与端口的建立，驱动族则单独通过 `tty_register_driver()` 注册。USB 枚举、设备匹配和节点命名归 B-C.7。

对用户程序来说，open、read、write 和 termios 仍属于 TTY 接口；对硬件适配层来说，数据来源已从 SoC 内存映射 UART 换成 USB 批量传输。不能把 USB 串口描述成“绕过 TTY 的另一套接口”，也不能把 DesignWare 的寄存器路径套到它上面。

## <span class="blue"> 证据来源与未验证项

本篇沿正常路径核对的 v6.6 文件包括：

- `arch/arm64/boot/dts/rockchip/rk356x.dtsi`：`serial4 = &uart4`、UART4 compatible、时钟、DMA、pinctrl 和默认 `disabled`；
- `Documentation/devicetree/bindings/serial/snps-dw-apb-uart.yaml`：DesignWare UART 的 compatible、时钟、寄存器和 DMA 属性；
- `Documentation/devicetree/bindings/serial/serial.yaml`：`serialN` 与串口子节点规则；
- `drivers/tty/serial/8250/8250_core.c`：驱动族初始化、8250 中断入口和端口注册；
- `drivers/tty/serial/8250/8250_dw.c`：UART4 probe、时钟和 DesignWare 配置；
- `drivers/tty/serial/8250/8250_port.c`：正常 RX／TX、LSR 和错误路径；
- `drivers/tty/serial/serial_core.c`：`uart_state`、`uart_port`、注册、读写和 `uart_insert_char()`；
- `drivers/tty/tty_buffer.c`、`tty_port.c`：flip buffer 工作队列、普通端口交付和打开／关闭；
- `drivers/tty/tty_io.c`、`tty_ioctl.c`：TTY 打开、读取、写入和 termios；
- `drivers/tty/n_tty.c`：N_TTY 输入、输出、raw 和 `n_tty_read()`；
- `drivers/tty/serdev/core.c`、`serdev-ttyport.c`：serdev 注册与内核客户端交付；
- `drivers/usb/serial/usb-serial.c`：USB 串口独立 probe 与 TTY 驱动注册。

当前没有取得实际板级 DTS、设备节点、probe 日志、用户态 `read()` 或仪器记录。实验室和正文中的对象状态是依据源码构造的教学模型，不是目标运行结果。完整命令输出、回环和故障定位归 B-B.5.4，不能用 PTY 代替 UART4／8250 的真实路径验证。

## <span class="blue"> 本节总结

`0x24` 从 UART4 到用户态的路径可以归纳为三次交接：8250 从硬件取出字节并插入 flip buffer，工作队列把字节交给 N_TTY，用户 `read()` 再通过 N_TTY 取得数据。驱动族注册、具体端口注册和一次 open 是不同生命周期动作，`uart_state`、`uart_port`、`tty_struct` 与 `file` 也不能混为一个对象。

termios 同时落到 UART 硬件和 N_TTY 两条路径，raw 只改变终端处理，不会删除 TTY。理解这一点后，短读、短写、serdev 和 USB 串口就不再是另一套难以记忆的知识，而是同一全路在不同入口、不同终点和不同返回条件下的变化。

## <span class="blue"> 本节自查

??? details "Q1. `uart_register_driver()` 与 `serial8250_register_8250_port()` 分别完成什么？"
    前者注册 8250 驱动族并准备每路 `uart_state` 和 `tty_driver`，后者把 `dw8250_probe()` 填好的具体 UART 端口加入该驱动族，最终经 `uart_add_one_port()` 建立 serial core 与 TTY 的端口关系。

??? details "Q2. 为什么不能把每次 open 都写成创建一个独立 `tty_struct` 和一套 UART4 端口？"
    每次 open 都有自己的 `file`，但 TTY 核心会按设备与引用关系管理共享的 `tty_struct` 和 `tty_port`。端口用打开计数管理首次启动和最后关闭，不能为每次打开复制一套硬件状态。

??? details "Q3. `0x24` 进入 flip buffer 后，`tty_flip_buffer_push()` 是否已经把它复制到用户空间？"
    没有。该函数只提交当前尾部并调度 `buf.work`。随后 `flush_to_ldisc()` 经普通 TTY 的 `receive_buf` 和 `tty_ldisc_receive_buf()` 交给 N_TTY，用户 `read()` 再通过 `iterate_tty_read()` 和 `n_tty_read()` 取得数据。

??? details "Q4. `tcsetattr()` 为什么既会改变 UART4，也会改变 N_TTY？"
    `tty_set_termios()` 先更新 `tty->termios`，再调用底层驱动的 `set_termios`，最终进入 `dw8250_set_termios()` 配置时钟和帧格式；同时还调用线路规程的 `set_termios`，更新 raw、规范模式和控制字符映射。

??? details "Q5. raw 是否绕过整个 TTY 和 N_TTY？"
    不是。raw 改变 N_TTY 的输入、输出、回显、规范模式和控制字符处理，数据仍经 8250、serial core、flip buffer 和 N_TTY 交付。

??? details "Q6. 用户 `read()` 返回 1 且缓冲区为 `0x24`，是否表示已经收到一条完整 NMEA 语句？"
    不能。返回值只表示本次系统调用交付了一个字节，不对应 UART 帧或 NMEA 语句边界。后续内容仍需继续读取，流式组帧由 B-B.5.5 处理。

??? details "Q7. 普通 TTY 与 serdev 在哪一步发生分流，serdev 字节最终交给谁？"
    `tty_port_register_device_attr_serdev()` 先尝试 serdev 注册，成功时不创建普通 TTY 字符设备。接收时 `ttyport_receive_buf()` 调用 `serdev_controller_receive_buf()`，把字节交给内核中的 serdev 客户端驱动，而不是用户态 `read()`。
