from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "docs" / "00-模板" / "framework-lab-template"
OUT = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口" / "html"

normal = [
    {
        "label": "注册驱动族",
        "path": "drivers/tty/serial/serial_core.c · uart_register_driver()",
        "code": "int uart_register_driver(struct uart_driver *drv)\n{\n\tstruct tty_driver *normal;\n\tint i, retval = -ENOMEM;\n\n\tBUG_ON(drv->state);",
        "startLine": 2756,
        "line": 2761,
        "full": {"key": "uartRegisterDriver", "needle": "BUG_ON(drv->state);"},
        "states": {"serial8250_reg": "8250 驱动族", "uart_state": "每路端口状态已准备", "tty_driver": "即将注册", "return": "尚未返回"},
        "observations": ["dev_name = ttyS", "uart_state 不属于某次 open"],
        "note": "先注册驱动族，再注册具体 UART4。这里准备的是一类端口共享的 serial core 与 TTY 结构。",
    },
    {
        "label": "注册 UART4",
        "path": "drivers/tty/serial/8250/8250_dw.c · dw8250_probe()",
        "code": "\tdata->data.line = serial8250_register_8250_port(up);\n\tif (data->data.line < 0)\n\t\treturn data->data.line;",
        "startLine": 663,
        "line": 663,
        "full": {"key": "dw8250Probe", "needle": "data->data.line = serial8250_register_8250_port(up);"},
        "states": {"uart_port": "UART4 硬件描述已填充", "serial4": "端口编号 4", "data.line": "注册成功时为 4", "return": "继续 probe"},
        "observations": ["compatible 匹配 DesignWare UART", "普通 TTY 与 serdev 尚未分流"],
        "note": "这里才把 UART4 的寄存器、时钟、IRQ、FIFO 和回调加入 8250 驱动族。板级 disabled 时不会走到这一步。",
    },
    {
        "label": "打开端口",
        "path": "drivers/tty/serial/serial_core.c · uart_open()",
        "code": "static int uart_open(struct tty_struct *tty, struct file *filp)\n{\n\tstruct uart_state *state = tty->driver_data;\n\tint retval;\n\n\tretval = tty_port_open(&state->port, tty, filp);\n\tif (retval > 0)\n\t\tretval = 0;",
        "startLine": 1941,
        "line": 1946,
        "full": {"key": "uartOpen", "needle": "retval = tty_port_open(&state->port, tty, filp);"},
        "states": {"file": "本次 open 的文件对象", "tty_struct": "关联 uart_state", "tty_port.count": "增加 1", "return": "0"},
        "observations": ["file 不等于一套新 UART4", "首次打开可启动硬件，再次打开可共享端口"],
        "note": "uart_open 通过 tty_port_open 建立打开关系并管理计数，不是每次复制一套控制器。",
    },
    {
        "label": "读取 0x24",
        "path": "drivers/tty/serial/8250/8250_port.c · serial8250_read_char()",
        "code": "\t\t} else if (lsr & UART_LSR_PE)\n\t\t\tflag = TTY_PARITY;\n\t\telse if (lsr & UART_LSR_FE)\n\t\t\tflag = TTY_FRAME;\n\t}\n\tif (uart_prepare_sysrq_char(port, ch))\n\t\treturn;\n\n\tuart_insert_char(port, lsr, UART_LSR_OE, ch, flag);",
        "startLine": 1760,
        "line": 1768,
        "full": {"key": "serial8250ReadChar", "needle": "uart_insert_char(port, lsr, UART_LSR_OE, ch, flag);"},
        "states": {"ch": "0x24", "flag": "TTY_NORMAL", "icount.rx": "本次正常接收", "return": "继续批量接收"},
        "observations": ["RX 已读出 0x24", "没有帧、校验、溢出或 Break 标志"],
        "note": "8250 已从 RX 和 LSR 取得正常数据。下一步把字节与类别交给 serial core，而不是直接复制到用户空间。",
    },
    {
        "label": "插入 flip buffer",
        "path": "drivers/tty/serial/serial_core.c · uart_insert_char()",
        "code": "void uart_insert_char(struct uart_port *port, unsigned int status,\n\t\t      unsigned int overrun, u8 ch, u8 flag)\n{\n\tstruct tty_port *tport = &port->state->port;\n\n\tif ((status & port->ignore_status_mask & ~overrun) == 0)\n\t\tif (tty_insert_flip_char(tport, ch, flag) == 0)\n\t\t\t++port->icount.buf_overrun;",
        "startLine": 3487,
        "line": 3493,
        "full": {"key": "uartInsertChar", "needle": "if (tty_insert_flip_char(tport, ch, flag) == 0)"},
        "states": {"ch": "0x24", "flag": "TTY_NORMAL", "flip buffer": "已接收 0x24", "buf_overrun": "未增加"},
        "observations": ["字节进入 port->state->port 的缓冲", "硬件 overrun 与 buf_overrun 是不同位置"],
        "note": "正常字符由 tty_insert_flip_char 写入。插入失败才增加 buf_overrun，不能与 UART FIFO 溢出混为一项。",
    },
    {
        "label": "调度交付工作",
        "path": "drivers/tty/tty_buffer.c · tty_flip_buffer_push()",
        "code": "void tty_flip_buffer_push(struct tty_port *port)\n{\n\tstruct tty_bufhead *buf = &port->buf;\n\n\ttty_flip_buffer_commit(buf->tail);\n\tqueue_work(system_unbound_wq, &buf->work);\n}",
        "startLine": 529,
        "line": 534,
        "full": {"key": "ttyFlipBufferPush", "needle": "queue_work(system_unbound_wq, &buf->work);"},
        "states": {"tail.commit": "当前已用长度已提交", "buf.work": "已排队", "用户缓冲": "仍未复制"},
        "observations": ["flip buffer 生产端已提交", "N_TTY 尚未消费"],
        "note": "这里只调度工作队列。queue_work 完成的是交付安排，不是用户 read 的返回。",
    },
    {
        "label": "消费 flip buffer",
        "path": "drivers/tty/tty_buffer.c · flush_to_ldisc()",
        "code": "\t\trcvd = receive_buf(port, head, count);\n\t\thead->read += rcvd;\n\t\tif (rcvd < count)\n\t\t\tlookahead_bufs(port, head);\n\t\tif (!rcvd)\n\t\t\tbreak;",
        "startLine": 495,
        "line": 495,
        "full": {"key": "flushToLdisc", "needle": "rcvd = receive_buf(port, head, count);"},
        "states": {"head.read": "前进 1 字节", "client_ops": "普通 TTY receive_buf", "return": "继续处理剩余数据"},
        "observations": ["工作队列开始消费已提交数据", "普通 TTY 与 serdev 使用不同 client_ops"],
        "note": "receive_buf 由端口的 client_ops 决定。本例使用普通 TTY 默认路径，serdev 则改交内核客户端。",
    },
    {
        "label": "交给 N_TTY",
        "path": "drivers/tty/tty_buffer.c · tty_ldisc_receive_buf()",
        "code": "size_t tty_ldisc_receive_buf(struct tty_ldisc *ld, const u8 *p, const u8 *f,\n\t\t\t     size_t count)\n{\n\tif (ld->ops->receive_buf2)\n\t\tcount = ld->ops->receive_buf2(ld->tty, p, f, count);\n\telse {\n\t\tcount = min_t(size_t, count, ld->tty->receive_room);\n\t\tif (count && ld->ops->receive_buf)\n\t\t\tld->ops->receive_buf(ld->tty, p, f, count);\n\t}\n\treturn count;\n}",
        "startLine": 383,
        "line": 386,
        "full": {"key": "ttyLdiscReceiveBuf", "needle": "if (ld->ops->receive_buf2)"},
        "states": {"ld": "N_TTY", "p": "指向 0x24", "f": "TTY_NORMAL", "return": "已处理 1 字节"},
        "observations": ["N_TTY 优先使用 receive_buf2", "termios 开始影响输入解释"],
        "note": "这里进入线路规程。raw 不删除这一步，只改变 N_TTY 对字节和标志的处理。",
    },
    {
        "label": "N_TTY 接收",
        "path": "drivers/tty/n_tty.c · n_tty_receive_buf()",
        "code": "static void n_tty_receive_buf(struct tty_struct *tty, const u8 *cp,\n\t\t\t      const u8 *fp, size_t count)\n{\n\tn_tty_receive_buf_common(tty, cp, fp, count, false);\n}",
        "startLine": 1771,
        "line": 1774,
        "full": {"key": "nTtyReceiveBuf", "needle": "n_tty_receive_buf_common(tty, cp, fp, count, false);"},
        "states": {"disc_data": "N_TTY 私有读缓冲", "raw": "本场景为 1", "icanon": "0", "read_buf": "包含 0x24"},
        "observations": ["0x24 作为普通输入字节保存", "raw 下不经过规范行处理"],
        "note": "N_TTY 仍保留读缓冲和读取规则。raw 只是改变解释方式，不会删除 N_TTY 或 flip buffer。",
    },
    {
        "label": "read 返回 1",
        "path": "drivers/tty/tty_io.c · tty_read() / iterate_tty_read()",
        "code": "\tdo {\n\t\tssize_t size = min(count, sizeof(kernel_buf));\n\n\t\tsize = ld->ops->read(tty, file, kernel_buf, size, &cookie, offset);\n\t\tif (!size)\n\t\t\tbreak;",
        "startLine": 855,
        "line": 858,
        "full": {"key": "iterateTtyRead", "needle": "size = ld->ops->read(tty, file, kernel_buf, size, &cookie, offset);"},
        "states": {"read()": "返回 1", "用户缓冲[0]": "0x24", "NMEA 语句": "尚不能据此判断完整", "returnTone": "good"},
        "observations": ["本次只交付一个字节", "返回值不是 UART 帧或 NMEA 语句边界"],
        "note": "iterate_tty_read 调用 N_TTY 的 read 并复制到用户迭代器。返回 1 只说明本次取得 0x24。",
    },
]

config = [
    {
        "label": "更新 termios",
        "path": "drivers/tty/tty_ioctl.c · tty_set_termios()",
        "code": "\tdown_write(&tty->termios_rwsem);\n\told_termios = tty->termios;\n\ttty->termios = *new_termios;\n\tunset_locked_termios(tty, &old_termios);\n\t/* Reset any ADDRB changes, ADDRB is changed through ->rs485_config() */\n\ttty->termios.c_cflag ^= (tty->termios.c_cflag ^ old_termios.c_cflag) & ADDRB;\n\n\tif (tty->ops->set_termios)\n\t\ttty->ops->set_termios(tty, &old_termios);\n\telse\n\t\ttty_termios_copy_hw(&tty->termios, &old_termios);\n\n\tld = tty_ldisc_ref(tty);\n\tif (ld != NULL) {\n\t\tif (ld->ops->set_termios)\n\t\t\tld->ops->set_termios(tty, &old_termios);\n\t\ttty_ldisc_deref(ld);\n\t}\n\tup_write(&tty->termios_rwsem);\n\treturn 0;",
        "startLine": 346,
        "line": 353,
        "full": {"key": "ttySetTermios", "needle": "if (tty->ops->set_termios)"},
        "states": {"请求": "9600、8N1、raw", "tty->termios": "已更新", "tty->ops": "通知 serial core", "ld->ops": "随后通知 N_TTY"},
        "observations": ["底层驱动与线路规程都收到新参数", "不是只写 UART 寄存器"],
        "note": "tty_set_termios 同时承担硬件与线路规程通知。先进入 uart_set_termios，再进入 N_TTY 的 set_termios。",
    },
    {
        "label": "进入 UART 配置",
        "path": "drivers/tty/serial/serial_core.c · uart_set_termios()",
        "code": "\tif ((cflag ^ old_termios->c_cflag) == 0 &&\n\t    tty->termios.c_ospeed == old_termios->c_ospeed &&\n\t    tty->termios.c_ispeed == old_termios->c_ispeed &&\n\t    ((tty->termios.c_iflag ^ old_termios->c_iflag) & iflag_mask) == 0 &&\n\t    !sw_changed) {\n\t\tgoto out;\n\t}\n\n\tuart_change_line_settings(tty, state, old_termios);",
        "startLine": 1672,
        "line": 1680,
        "full": {"key": "uartSetTermios", "needle": "uart_change_line_settings(tty, state, old_termios);"},
        "states": {"c_ospeed": "9600", "c_cflag": "CS8，无校验，1 停止位", "uport->ops": "dw8250_set_termios", "return": "继续硬件配置"},
        "observations": ["帧格式和速率确实变化，不能提前退出", "下一步调用 uport->ops->set_termios"],
        "note": "uart_set_termios 先比较变化，再通过 uart_change_line_settings 调用实际硬件回调。",
    },
    {
        "label": "配置 UART4",
        "path": "drivers/tty/serial/8250/8250_dw.c · dw8250_set_termios()",
        "code": "\tunsigned long newrate = tty_termios_baud_rate(termios) * 16;\n\tstruct dw8250_data *d = to_dw8250_data(p->private_data);\n\tlong rate;\n\tint ret;\n\n\tclk_disable_unprepare(d->clk);\n\trate = clk_round_rate(d->clk, newrate);\n\tif (rate > 0) {\n\t\t/*\n\t\t * Note that any clock-notifer worker will block in\n\t\t * serial8250_update_uartclk() until we are done.\n\t\t */\n\t\tret = clk_set_rate(d->clk, newrate);\n\t\tif (!ret)\n\t\t\tp->uartclk = rate;\n\t}\n\tclk_prepare_enable(d->clk);\n\n\tdw8250_do_set_termios(p, termios, old);",
        "startLine": 355,
        "line": 367,
        "full": {"key": "dw8250SetTermios", "needle": "ret = clk_set_rate(d->clk, newrate);"},
        "states": {"newrate": "153600 Hz", "baudclk": "由时钟框架设置", "uartclk": "保存实际返回速率", "下一步": "通用 8250 帧配置"},
        "observations": ["目标波特率 9600 × 16 = 153600", "实际 uartclk 仍需目标系统确认"],
        "note": "DesignWare 先设置 baudclk，再执行通用 8250 配置。这里只证明代码路径，不证明当前板卡返回了 153600 Hz。",
    },
    {
        "label": "更新 raw 状态",
        "path": "drivers/tty/n_tty.c · n_tty_set_termios()",
        "code": "\t} else {\n\t\tldata->raw = 1;\n\t\tif ((I_IGNBRK(tty) || (!I_BRKINT(tty) && !I_PARMRK(tty))) &&\n\t\t    (I_IGNPAR(tty) || !I_INPCK(tty)) &&\n\t\t    (tty->driver->flags & TTY_DRIVER_REAL_RAW))\n\t\t\tldata->real_raw = 1;\n\t\telse\n\t\t\tldata->real_raw = 0;\n\t}",
        "startLine": 1855,
        "line": 1856,
        "full": {"key": "nTtySetTermios", "needle": "ldata->raw = 1;"},
        "states": {"raw": "1", "icanon": "0", "real_raw": "还取决于错误标志与驱动能力", "N_TTY": "仍参与交付"},
        "observations": ["raw 改变输入解释", "flip buffer、read 和 N_TTY 没有消失"],
        "note": "raw 与 real_raw 不是同一状态。即便 raw 为 1，real_raw 还要满足错误处理标志和 TTY_DRIVER_REAL_RAW 条件。",
    },
]

sources = [
    "8250_core.c", "8250_dw.c", "8250_port.c", "serial_core.c", "tty_buffer.c",
    "tty_port.c", "tty_io.c", "tty_ioctl.c", "n_tty.c", "core.c", "serdev-ttyport.c", "usb-serial.c",
]
source_files = []
for name in sources:
    if name == "core.c":
        display = "drivers/tty/serdev/core.c"
        url_name = "serdev-core.c"
    else:
        display = f"drivers/tty/{name}" if not name.startswith("8250") and name != "serial_core.c" and name != "usb-serial.c" else (
            f"drivers/tty/serial/8250/{name}" if name.startswith("8250") else f"drivers/tty/serial/{name}" if name == "serial_core.c" else f"drivers/usb/serial/{name}"
        )
        url_name = name
    source_files.append({
        "name": display,
        "kind": "Linux v6.6 源码",
        "url": f"../code/B-B.5.3/{url_name}",
        "context": "逐字来自 Linux v6.6 缓存，仅用于源码跟随。未作为独立教学程序编译、运行或上板验证。",
    })

config_data = {
    "title": "UART Framework Lab",
    "kicker": "B-B.5.3 / LINUX V6.6",
    "subtitle": "沿 0x24 的接收与配置路径，核对代码、对象和返回值。",
    "transaction": ["0x24", "uart_state", "flip buffer", "N_TTY", "read()"],
    "modelBasis": "v6.6 源码模型；不连接 RK3568 或 NEO-6M，不代表目标运行结果",
    "scenarios": {"normal": normal, "config": config},
    "sourceFiles": source_files,
}

lab_js = (TEMPLATE / "lab.js").read_text(encoding="utf-8")
suffix = lab_js[lab_js.index("  const $ ="):]
new_js = "(() => {\n  \"use strict\";\n\n  const LAB_CONFIG = " + json.dumps(config_data, ensure_ascii=False, indent=2) + ";\n\n" + suffix
(OUT / "uart-framework-lab.js").write_text(new_js, encoding="utf-8")

html = (TEMPLATE / "lab.html").read_text(encoding="utf-8")
html = html.replace("Framework Lab Template", "UART Framework Lab")
html = html.replace("REUSABLE TEACHING TEMPLATE", "B-B.5.3 / LINUX V6.6")
html = html.replace("让代码、状态和观察结果在同一步骤里出现。", "沿 0x24 的接收与配置路径，核对代码、对象和返回值。")
html = html.replace("占位：正常路径", "0x24 正常接收")
html = html.replace("占位：失败路径", "9600、8N1 与 raw 配置")
html = html.replace('value="failure"', 'value="config"')
html = html.replace("占位模型：请替换为已核验的机制依据", config_data["modelBasis"])
html = html.replace('href="lab.css"', 'href="uart-framework-lab.css"')
html = html.replace('src="fullcode.js"', 'src="uart-framework-lab-fullcode.js"')
html = html.replace('src="lab.js"', 'src="uart-framework-lab.js"')
html = html.replace('href="./code/example.c"', 'href="../code/B-B.5.3/8250_port.c"')
html = html.replace('download="example.c"', 'download="8250_port.c"')
(OUT / "uart-framework-lab.html").write_text(html, encoding="utf-8")
print(OUT / "uart-framework-lab.js")
print(OUT / "uart-framework-lab.html")
