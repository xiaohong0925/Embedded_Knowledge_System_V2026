# B-B.5.4 UART 调试与分层验证

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 串口
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

B-B.5.3 已经沿一个 `0x24` 建立了从 UART4、8250、serial core、N_TTY 到用户 `read()` 的正常路径。真正调试时，问题往往不是不知道这条路径，而是某项观察被赋予了超出其范围的含义：设备节点存在就被当成链路正常，`stty` 显示 9600 就被当成线上确实是 9600，回环成功就被当成 GPS 已经恢复。

本节只回答一个问题：**面对无输出、乱码、丢字节或数据被修改，怎样用正常基线、软件证据、受控回环和仪器逐层缩小故障域？**

> 正常基线：在一组明确的硬件、配置和访问者前提下，取得可复核的正常结果，作为后续对照的起点。基线必须记录实际观察，不是“按道理应该正常”。

<!-- -->

> 故障域：当前证据仍无法排除的一组故障位置。每增加一项有效观察，应当缩小这个范围，而不是直接猜中唯一根因。

正常实例沿用 NEO-6M TX → RK3568 UART4 RX → 用户态读取。板级设备树启用 UART4、`serial4 = &uart4` 对应 `/dev/ttyS4`、使用 9600、8N1，都是本节延续的教学配置；实际板卡和模块仍需分别核对。u-blox NEO-6 数据手册列出的串口默认值是 9600、8 数据位、无校验、1 停止位，但模块配置可能被修改，不能把芯片默认值当成当前模块转接板（breakout）的事实。

另一个实验是断开 GPS 后的 UART4 外部 TX-RX 回环。它使用人为构造的七字节输入，与正常 GPS 接收不是同一笔通信，也不共享“已经实测”的结论。

> 本节覆盖：正常接收基线、设备节点与配置观察、系统调用返回、UART 计数器、受控外部回环、仪器分工，以及最后的恢复复测。帧与采样机制归 B-B.5.2，完整驱动和 TTY 调用链归 B-B.5.3，完整 C 串口配置、流式组帧和 NMEA 解析归 B-B.5.5。

下图标出各类证据的观察位置。阅读时先看正常数据从左上到右下经过哪些层，再看每项工具能覆盖哪一段。外部回环只把短接点以内的路径换成已知输入，不会把 GPS 和被隔离的外部线段一并证明。

<div style="overflow-x:auto">
<svg viewBox="0 0 1160 510" xmlns="http://www.w3.org/2000/svg" style="max-width:1000px;width:100%;min-width:820px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>UART 正常接收与各类调试证据的覆盖范围</title>
<defs><marker id="uart-evidence-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="currentColor" stroke="none"/></marker></defs>
<text x="580" y="30" text-anchor="middle" fill="currentColor" stroke="none" font-size="17">同一接收路径上的观察点，各自只能证明一段事实</text>
<rect x="30" y="75" width="180" height="82" rx="8"/>
<text x="120" y="108" text-anchor="middle" fill="currentColor" stroke="none">NEO-6M TX</text>
<text x="120" y="136" text-anchor="middle" fill="currentColor" stroke="none">外部连线与测点</text>
<rect x="255" y="75" width="180" height="82" rx="8"/>
<text x="345" y="108" text-anchor="middle" fill="currentColor" stroke="none">UART4 RX</text>
<text x="345" y="136" text-anchor="middle" fill="currentColor" stroke="none">控制器与 pinctrl</text>
<rect x="480" y="75" width="180" height="82" rx="8"/>
<text x="570" y="108" text-anchor="middle" fill="currentColor" stroke="none">8250</text>
<text x="570" y="136" text-anchor="middle" fill="currentColor" stroke="none">serial core</text>
<rect x="705" y="75" width="180" height="82" rx="8"/>
<text x="795" y="108" text-anchor="middle" fill="currentColor" stroke="none">N_TTY</text>
<text x="795" y="136" text-anchor="middle" fill="currentColor" stroke="none">termios 处理</text>
<rect x="930" y="75" width="180" height="82" rx="8"/>
<text x="1020" y="108" text-anchor="middle" fill="currentColor" stroke="none">用户 read()</text>
<text x="1020" y="136" text-anchor="middle" fill="currentColor" stroke="none">返回与实际字节</text>
<line x1="210" y1="116" x2="247" y2="116" marker-end="url(#uart-evidence-arrow)"/>
<line x1="435" y1="116" x2="472" y2="116" marker-end="url(#uart-evidence-arrow)"/>
<line x1="660" y1="116" x2="697" y2="116" marker-end="url(#uart-evidence-arrow)"/>
<line x1="885" y1="116" x2="922" y2="116" marker-end="url(#uart-evidence-arrow)"/>
<rect x="30" y="225" width="405" height="92" rx="8" stroke-dasharray="6 4"/>
<text x="232" y="257" text-anchor="middle" fill="currentColor" stroke="none">逻辑分析仪：数字帧与位时间</text>
<text x="232" y="286" text-anchor="middle" fill="currentColor" stroke="none">示波器：测点电压与模拟形态</text>
<rect x="255" y="340" width="180" height="70" rx="8" stroke-dasharray="6 4"/>
<text x="345" y="369" text-anchor="middle" fill="currentColor" stroke="none">sysfs 与字符设备</text>
<text x="345" y="394" text-anchor="middle" fill="currentColor" stroke="none">节点对回 UART4</text>
<rect x="480" y="225" width="180" height="92" rx="8" stroke-dasharray="6 4"/>
<text x="570" y="252" text-anchor="middle" fill="currentColor" stroke="none">rx／tx 与错误计数</text>
<text x="570" y="278" text-anchor="middle" fill="currentColor" stroke="none">fe／pe／brk／oe／bo</text>
<text x="570" y="302" text-anchor="middle" fill="currentColor" stroke="none">驱动观察到的事件</text>
<rect x="705" y="225" width="180" height="92" rx="8" stroke-dasharray="6 4"/>
<text x="795" y="257" text-anchor="middle" fill="currentColor" stroke="none">stty -a</text>
<text x="795" y="286" text-anchor="middle" fill="currentColor" stroke="none">TTY 当前配置读回</text>
<rect x="930" y="225" width="180" height="92" rx="8" stroke-dasharray="6 4"/>
<text x="1020" y="257" text-anchor="middle" fill="currentColor" stroke="none">strace＋od</text>
<text x="1020" y="286" text-anchor="middle" fill="currentColor" stroke="none">系统调用返回与十六进制</text>
<rect x="255" y="435" width="855" height="48" rx="8"/>
<text x="682" y="465" text-anchor="middle" fill="currentColor" stroke="none">外部回环：只覆盖短接点以内的收发与软件路径，GPS 已断开</text>
</svg>
</div>

## <span class="blue"> 先建立可复核的正常接收基线

### 开始前先固定前提，而不是先改参数

正常路径需要同时满足以下条件：

1. 原理图和板级资料已经确认 UART4 的实际连接器、供电、IO 电平、TX／RX 与 GND。电气连接和耐压检查归 B-B.5.1，本节不重复。
2. 板级设备树已经启用 UART4，普通 TTY 路径已经注册 `/dev/ttyS4`。若实际板级使用 serdev，数据终点是内核客户端驱动，本节针对普通 TTY 的命令不能直接套用。
3. 当前没有 getty 登录终端服务、gpsd 定位数据守护进程、业务程序或另一个终端同时读取该端口。多个读取者会分走字节，不能用“偶发少数据”直接判断硬件丢字节。应先按系统服务和进程状态协调访问，不默认强制结束业务。
4. 已取得当前模块的协议与速率配置。NEO-6 数据手册中的默认值只用于确定首次核对方向，实际模块可能已经被改为其他速率或 u-blox 二进制协议 UBX 输出。
5. 目标系统提供所需工具。下文命令以 GNU Coreutils 的 `stty`、`od`、`timeout`、`dd` 和 Linux `strace` 为核对基准；BusyBox 等实现的选项和输出需要另查对应手册。

> ⚠️ 当前没有实际板级 DTS、连接器资料、目标命令输出或仪器记录。下文给出的是可执行的采集路径和判定方法，不把待采集内容写成已经发生的成功结果。

### 先把设备节点对回 UART4

`sysfs` 是内核导出设备对象及关系的虚拟文件系统。`readlink -f` 展开符号链接并打印最终路径，`test -c` 检查路径是否为字符设备。两项检查回答的问题不同：

```bash
readlink -f /sys/class/tty/ttyS4/device
printf 'readlink_exit=%d\n' "$?"
test -c /dev/ttyS4
printf 'char_device_exit=%d\n' "$?"
```

在教学配置下，第一条输出路径应包含 `fe680000.serial`，第二条退出状态应为 0。当前没有目标输出，这两个值是**判定目标，不是已采集结果**。若路径指向其他控制器、链接不存在或字符设备检查失败，应回到 B-B.5.3 核对别名、端口注册和 serdev 分流，不继续用回环掩盖节点问题。

即使两项都符合，也只能说明节点及其设备关系存在。它不能证明连接器已经引出、GPS 已发送或用户能够读到数据。probe 日志可以补充注册时的信息，但历史日志同样不能代替当前接收。

### 保存原配置，再设置并读回已知配置

`stty -g` 打印可供另一条 `stty` 命令恢复的完整配置。下面把返回值保存在当前 shell 变量中，同时打印出来留档；后续恢复必须在同一个 shell 中执行，或者使用这条记录手工恢复。

```bash
saved_termios=$(stty -F /dev/ttyS4 -g)
save_status=$?
printf 'saved_termios=%s\nsave_exit=%d\n' "$saved_termios" "$save_status"
```

只有 `save_exit=0` 且保存串非空时才继续。失败时先处理打开、权限和设备状态，不要把空字符串用于恢复。

随后设置 9600、8 数据位、1 停止位、无校验、无 RTS／CTS 硬件流控，并启用 raw：

```bash
stty -F /dev/ttyS4 9600 cs8 -cstopb -parenb -crtscts raw -echo
printf 'configure_exit=%d\n' "$?"
stty -F /dev/ttyS4 -a
printf 'readback_exit=%d\n' "$?"
```

GNU `stty` 的 `raw` 关闭回车／换行（CR/LF）转换、XON／XOFF、规范模式、输出后处理和信号字符等行为，并设置 `min 1 time 0`。这里额外写 `-echo` 关闭回显，写 `-crtscts` 是因为本例只有 TX／RX／GND，没有 RTS／CTS。raw 并没有删除 N_TTY 或绕过整个 TTY，机制见 B-B.5.3。

第二条命令的完整输出是配置读回，必须保留所有字段，不能只摘录 `9600`。它证明 TTY 当前报告的参数，不证明模块实际速率、分频后的精确位时间或引脚波形。若第一条失败，第二条也不能用来宣称配置已经生效。

### 在有限窗口内记录原始字节和系统调用返回

`od` 用无歧义的格式打印字节，`-An` 不打印偏移，`-tx1` 按单字节十六进制显示，`-v` 禁止用星号折叠重复行。`strace` 记录系统调用参数和返回值，`-o` 将跟踪写入文件，`-f` 继续跟踪子进程。`timeout` 负责结束持续读取，避免命令无限等待；把它放在 `strace` 跟踪范围内，可以同时记录限时工具和实际执行的 `od`。

先保存计数器快照，再开始三秒采集：

```bash
cat /proc/tty/driver/serial > uart4-icount.before
printf 'counter_before_exit=%d\n' "$?"
strace -f -qq -e trace=openat,read,ioctl -xx -s 128 -o uart4-read.trace timeout 3s od -An -v -tx1 /dev/ttyS4 > uart4-read.hex 2> uart4-read.stderr
capture_status=$?
printf 'capture_exit=%d\n' "$capture_status"
cat /proc/tty/driver/serial > uart4-icount.after
printf 'counter_after_exit=%d\n' "$?"
```

这次操作应完整保留五个文件或输出：原 termios 记录、`stty -a` 读回、`uart4-read.hex`、`uart4-read.stderr`、`uart4-read.trace`，以及前后两份计数器快照。当前正文不填入其中的动态内容，因为目标运行尚未执行。

`capture_exit` 的解释必须与串口数据分开：

- GNU `timeout` 在未使用 `--preserve-status` 时，超时返回 124；它只表示三秒时限到达，不表示 UART 报错。
- 125 表示 `timeout` 自身失败，126 表示命令找到但不能执行，127 表示命令未找到。
- 其他状态要结合被管理命令的结果判断，不能因为不是 124 就直接认定串口失败。
- `strace` 记录的是系统调用边界，不是 shell 退出状态。C 库还会把内核错误转换成 `read()` 的 `-1` 和 `errno`；被信号打断的调用还可能涉及内部重启过程。

正常基线的判据不是某个固定坐标，也不是 `cat` 终端“看起来有字”。应当同时满足：节点与配置检查成功，跟踪中出现符合当前读取条件的正数返回，十六进制文件确实取得字节，数据形态与当前模块配置一致，并且计数器变化能够与这次接收对齐。若模块配置为 NMEA，还需按其实际协议检查 `$`、CR/LF 等结构；未定位与无 UART 数据是两个不同问题，不能用经纬度是否有效判断串口链路。

## <span class="blue"> 正常接收失败时，先对齐节点、配置、计数器和 `read()`

### `read()` 的返回边界与 shell 状态不是一回事

B-B.5.3 已经解释了 N_TTY 的交付路径。调试时只需要把返回结果落到当前读取条件：

| 观察 | 当前可以判断什么 | 下一步要保留的证据 |
|---|---|---|
| 正数但小于请求长度 | 本次实际交付了这些字节，属于短读，不是错误 | 本次返回数、对应十六进制字节、`VMIN／VTIME` 和后续读取 |
| 返回 0 | 在非规范且 `VMIN=0、VTIME=0` 的当前无数据情形下，可表示本次没有字节；其他状态还要结合文件与挂起条件 | termios、文件非阻塞标志、是否挂断，不能只看 0 |
| `-1 EAGAIN` | 当前按非阻塞条件无法取得数据 | 文件标志和当前输入状态，不等于硬件损坏 |
| `-1 EINTR` | 用户看到本次调用被信号打断 | 信号与重试逻辑，不直接等同于线上丢字节 |
| 其他负值与 `errno` | 本次调用失败，错误种类提供了下一步方向 | 完整错误、前后 ioctl 和节点状态 |
| shell 退出状态 | 整个命令或工具如何结束 | 工具自身语义，不能替代每次 `read()` 的返回 |

`strace` 中的 `read(...) = 正数` 与实际字节可以相互印证，但它不会自动给出业务层的语句边界。NMEA 组帧归 B-B.5.5，本篇只判断字节是否到达以及是否在途中改变。

### 计数器要比较同一窗口的增量

v6.6 serial core 在 `CONFIG_PROC_FS` 下提供 `/proc/tty/driver/serial`。每行先给端口号、UART 类型、地址和中断，再在具有相应权限时输出 `tx`、`rx` 及非零错误字段。没有打印某个错误字段不等于取得了“该字段为零”的独立证据；权限不足时，相关统计可能整体不显示。

| 字段 | v6.6 中的事件位置 | 能怎样帮助定位 |
|---|---|---|
| `rx`／`tx` | 8250 读取接收字节、处理发送字节时累计 | 比较测试前后增量，判断驱动是否观察到收发活动 |
| `fe` | LSR 报告帧错误 | 提示停止位检查失败，继续核对速率、帧格式和波形 |
| `pe` | LSR 报告校验错误 | 只在当前校验配置下解释，不能用于无校验链路的所有错误 |
| `brk` | LSR 报告 Break | 说明检测到 Break 条件，不等于收到普通 `0x00` |
| `oe` | LSR 报告硬件溢出 | 说明控制器取字节未能跟上，不能直接等同于用户程序读慢 |
| `bo` | `uart_insert_char()` 向 flip buffer 插入失败，或溢出标志插入失败 | 指向 TTY 缓冲交付位置，与 `oe` 的硬件位置不同 |

这些计数属于端口运行期间的累计状态，不应把一次绝对值当成本次测试的次数。有效做法是先确认其他访问者已经排除，再比较同一窗口前后的差值，并与 `read()` 返回和测点波形对齐。计数器没有增加也不能证明全链路没有丢失，因为不同位置、权限和驱动能力会影响可见性。

例如，`rx` 增加而用户没有取得数据时，故障域已经移到 8250 接收之后：继续检查 N_TTY 的输入处理、另一个读取者及用户读取条件。相反，RX 测点有正确波形而 `rx` 不增，才应回查 pinctrl、控制器接收和驱动路径。

## <span class="blue"> 断开 GPS 做受控外部回环

正常基线失败后，如果节点、配置和返回值仍不能区分外设与本机路径，可以把 GPS 的连续且可能变化的数据换成一组已知字节。外部回环的意义是改变实验条件，不是给原故障找一个看起来成功的替代结果。

> 🔴 先断电，再断开 GPS 并确认模块 TX 不会与 RK3568 TX 同时驱动。只短接原理图确认的 UART4 TX／RX 测试点，不短接供电。没有实际引脚资料时不得凭丝印猜测，也不在带电状态下移动短接线。

### 先让测试输入本身可核对

下面的测试文件包含七字节：`0x24` 延续前文实例，`0x0D／0x0A` 用于观察换行处理，`0x11／0x13` 用于观察软件流控字符，`0x80` 用于观察高位是否保留，`0x55` 提供交替位波形。

```bash
printf '\x24\x0d\x0a\x11\x13\x80\x55' > uart-loopback.bin
printf 'create_exit=%d\n' "$?"
od -An -v -tx1 uart-loopback.bin
printf 'od_exit=%d\n' "$?"
```

当前写作环境已在普通文件上执行 `od`，得到的文件内容如下。它只证明测试输入构造正确，不涉及 UART、TTY 或目标板：

```text
 24 0d 0a 11 13 80 55
od_exit=0
```

### 两个终端分别记录接收与发送

保持前面的 raw 配置，先保存本次实验的计数器起点，再在终端 A 启动接收。五秒只是采集窗口，不是“必须五秒内修复”的判据：

```bash
cat /proc/tty/driver/serial > uart4-loopback-icount.before
printf 'loopback_counter_before_exit=%d\n' "$?"
strace -f -qq -e trace=openat,read,ioctl -xx -s 128 -o uart4-loopback-read.trace timeout 5s od -An -v -tx1 /dev/ttyS4 > uart4-loopback-read.hex 2> uart4-loopback-read.stderr
printf 'loopback_read_exit=%d\n' "$?"
```

确认终端 A 已经启动后，在终端 B 写入测试文件。`dd` 的 `bs=7 count=1` 表示最多按一个七字节块处理，`status=none` 关闭 GNU `dd` 的统计摘要，系统调用细节仍保存在跟踪文件中：

```bash
strace -qq -e trace=openat,read,write,close -xx -s 128 -o uart4-loopback-write.trace dd if=uart-loopback.bin of=/dev/ttyS4 bs=7 count=1 status=none
printf 'loopback_write_exit=%d\n' "$?"
```

接收窗口结束后，保存本次实验的计数器终点：

```bash
cat /proc/tty/driver/serial > uart4-loopback-icount.after
printf 'loopback_counter_after_exit=%d\n' "$?"
```

判定需要同时检查：

1. 写跟踪中的实际 `write()` 返回是否接受了预期字节数。`dd` 退出 0 只表示工具成功结束，`write()` 返回也不证明对端应用已经收到。
2. 接收十六进制是否与 `24 0d 0a 11 13 80 55` 逐字节一致。短读需要结合多次返回累计判断，不能要求一次 `read()` 必然返回七字节。
3. `tx／rx` 增量是否与本次窗口相符，`fe／pe／brk／oe／bo` 是否出现新的记录。
4. 若接入仪器，线上字节是否与用户发送缓冲区一致。TX 计数增加仍不等于最后一个停止位已经离开引脚。

**回环一致的结论只到达短接点。**它支持当前配置下控制器、8250、TTY 和用户收发路径可工作，不证明 GPS、被隔离的外部线段、其他速率或长期运行正常。若回环失败，也只能把故障域缩到短接点以内，仍需结合配置、计数和波形继续分层。

## <span class="blue"> 用逻辑分析仪与示波器补齐引脚证据

软件证据无法解释线上差异时，再把仪器接入同一实验。测点必须写清楚：模块 TX、RK3568 RX 附近和回环短接点看到的不是同一段链路，不能用其中一个测点替代另一个。

### 逻辑分析仪核对数字帧，不负责证明软件已经交付

逻辑分析仪按自身数字门限采样高低电平。UART 解码需要与当前实验一致的速率、8N1 和位序，不能反复调整解码参数直到文本“看起来合理”。B-B.5.2 已说明 `0x24` 的正反位图案相同，因此不能靠它单独证明 LSB-first；这里关注起始位、各数据位的时刻、停止位和实际位时间。

在正常 GPS 实验中，仪器结果要与同一窗口的 `rx` 增量和用户十六进制对齐。在线上能解码出正确字节而用户数据不同，故障域偏向驱动之后；线上已经出现异常位时间或帧结构，则先回到 5.2 的机制及物理链路。

仪器在自己的门限和采样条件下解码成功，不证明接收端具有相同的识别结果，也不证明模拟裕量充分。逻辑分析仪截图若没有实际采集，就只能写“应观察的项目”，不能写“测得”。

### 示波器检查模拟条件，不负责解释 NMEA

示波器保留电压随时间变化的形态。UART 特有的观察点包括空闲电平、起始位宽度、数据位时间、停止位是否达到有效高电平，以及边沿、过冲、下冲和毛刺是否可能造成接收端误判。

判读必须使用当前器件的输入门限、IO 耐压和仪器测量条件。逻辑分析仪能够解码不代表这些模拟条件合格，波形外观整齐也不代表用户程序取得了正确字节。当前没有取得 RK3568 接收端、模块 TX 或回环点的示波器记录，正文不设固定实测数值。

若降低速率后恢复，只能说明故障表现与频率或时间窗口相关。下一步仍要用数字帧区分配置与协议问题，用模拟波形检查电平和边沿，不能直接宣布根因就是走线或某个固定电气参数。

## <span class="blue"> 把四种症状收回同一证据链

### 无输出：先比较 `read()`、`rx` 和 RX 测点

先保留打开、配置和读取的错误，不用连续换参数制造更多变量。随后按测点和计数增量缩小范围：

- 模块 TX 有波形而 RK3568 RX 测点无波形，优先检查两个测点之间的连接。
- RK3568 RX 测点有波形而 `rx` 不增，回查 pinctrl、控制器接收和驱动路径。
- `rx` 增加而没有有效用户读取，检查 N_TTY 处理、其他读取者和读取条件。
- `read()` 返回负值时先解释 `errno`，不把所有错误都翻译成“没有波形”。

若节点本身不存在或映射错误，前面的链路比较还没有可靠入口，应先回 B-B.5.3 处理注册与对象关系。

### 乱码：把配置读回与实际位时间分开

`stty -a` 只证明软件配置，逻辑分析仪才能观察测点的数字位时间，示波器再检查模拟形态。若线上按已知配置解码正确而用户字节不同，故障域偏向 TTY 或用户程序；若线上位时间和帧结构已经异常，才优先回查速率、分频和电气路径。

一次改成其他速率后“变得可读”只是对照结果，还需要恢复原参数复现、再改回有效参数复测，并核对模块真实配置。不能把一次碰巧可读当成根因证明。

### 丢字节：对齐同一窗口，而不是把短读当丢失

有效比较需要同一时间段内的线上字节、`rx` 增量、用户各次正数返回之和以及 `oe／bo` 增量。短读只改变每次交付边界，不自动等于数据丢失；另一个读取者分走数据也不是 UART 硬件溢出。

`oe` 增加指向控制器硬件溢出，`bo` 增加指向 flip buffer 插入失败。二者可以帮助选择下一步，但仍不能脱离时间窗口和软件状态指定唯一根因。计数没有变化时，也不能排除测点之前或未被当前驱动统计覆盖的丢失。

### 数据被修改：比较发送缓冲区、线上和用户缓冲区

回环的七字节输入提供了已知答案。若写缓冲区正确、线上已经多出或改变字节，先查输出处理、控制器和物理路径；若线上与发送一致而用户结果改变，再查输入处理、流控字符、高位处理和用户读取。

例如，`0x0D／0x0A` 用来观察换行转换，`0x11／0x13` 用来观察 XON／XOFF，`0x80` 用来检查高位是否被剥离。具体结果必须来自当前实验，不能预先写成“某标志一定是唯一原因”。raw 配置下这些处理应处于已核对的关闭状态，若仍出现变化，应重新检查配置是否真正生效以及是否被其他进程修改。

## <span class="blue"> 移除测试条件，恢复正常接收并复测

回环结束后先断电，移除 TX-RX 短接并恢复 NEO-6M 与 UART4 的正确连接。上电后重新使用正常基线配置，重复前面的有限窗口读取、系统调用记录和计数器快照。

只有重新取得与当前模块配置一致的正常字节流，才能说本次调试回到了正常接收基线。回环成功但 GPS 复测失败时，故障域仍在被隔离的外设或外部路径，不能宣布调试完成。

链路基线恢复后，再还原进入实验前的 termios：

```bash
stty -F /dev/ttyS4 "$saved_termios"
printf 'restore_exit=%d\n' "$?"
stty -F /dev/ttyS4 -a
printf 'restore_readback_exit=%d\n' "$?"
```

`restore_exit=0` 只表示恢复命令成功，完整读回还要与最初保存的记录对照。若已经退出原 shell，应使用最初打印的保存串，而不是用 `stty sane` 代替原配置。最后再按系统原状态恢复业务访问；业务程序的完整接收与 NMEA 解析验证归 B-B.5.5。

## <span class="blue"> 证据来源与未验证项

本篇机制与工具语义核对了以下资料：

- Linux v6.6 `drivers/tty/serial/8250/8250_port.c:1711-1792`：接收字节、`rx`、Break、校验、帧错误、硬件溢出及 flip buffer 提交。
- Linux v6.6 `drivers/tty/serial/serial_core.c:1986-2068`：`/proc` 输出字段及权限边界；同文件 `3487-3503`：`buf_overrun` 的插入失败位置。
- Linux v6.6 `drivers/tty/n_tty.c:2212-2330`：非规范读取、`VMIN／VTIME`、非阻塞、信号和短读返回路径。
- GNU Coreutils 手册：`stty` 的 `-F／-a／-g`、raw 和退出状态，`od` 的 `-An／-tx1／-v`，`timeout` 的 124～127 等状态，`dd` 的块与输出控制。
- `strace(1)` 手册：系统调用参数、返回值、错误文本、`-f`、`-e trace`、`-o`、`-s` 和 `-xx` 的含义。
- u-blox《NEO-6 Data Sheet》Table 15：串口默认 9600、8N1 及启动时启用的 NMEA 消息。默认值不等于当前模块配置。

当前只有测试文件的普通主机 `od` 输出已经执行。所有 `/dev/ttyS4`、termios、`strace`、计数器、回环、恢复复测和仪器内容均为**验证方法，不是目标实测**。文档构建、浏览器、目标运行和仪器测量分别登记，不能用其中一项替代另一项。

## <span class="blue"> 本节总结 [B→I]

UART 调试从正常基线开始，而不是从猜测根因开始。节点、termios、系统调用、计数器、回环和仪器分别位于不同观察面，只有时间窗口、测点和数据能够对齐时，它们才共同缩小故障域。

外部回环用已知输入替换 GPS，但结论停在短接点；逻辑分析仪与示波器补充数字和模拟证据，也不能代替用户交付验证。最后移除测试条件并重新取得正常 GPS 字节流，才完成一次可恢复的调试闭环。

## <span class="blue"> 本节自查

??? details "Q1. 为什么 `test -c /dev/ttyS4` 成功和 `stty -a` 显示 9600 还不能构成正常接收基线？"
    字符设备检查只证明节点类型，配置读回只证明 TTY 当前报告的参数。正常基线还需要节点对回 UART4、有限窗口内实际取得与模块配置一致的字节，并保存系统调用和计数器证据。

??? details "Q2. `timeout` 返回 124、`read()` 返回 0 和 `read()` 返回 `-1 EAGAIN` 分别说明什么？"
    124 表示 GNU `timeout` 的时限到达。非规范且 `VMIN=0、VTIME=0` 时，返回 0 可以表示当前没有字节；`EAGAIN` 表示按当前非阻塞条件无法取得数据。三者都不是 UART 硬件故障的充分证据。

??? details "Q3. `rx` 增加而用户没有读到数据时，为什么不应继续盲目检查 GPS 接线？"
    `rx` 在 8250 读取接收字节时已经增加，说明驱动观察到了接收活动。下一步应检查 N_TTY 输入处理、其他读取者和用户读取条件；继续更换 GPS 接线不能解释交付之后的问题。

??? details "Q4. `oe` 与 `bo` 的位置有什么不同，为什么不能只看一次绝对值？"
    `oe` 来自 LSR 报告的硬件溢出，`bo` 来自向 flip buffer 插入数据或溢出标志失败。计数器是累计状态，只有排除其他访问者并比较同一窗口前后的增量，才能与本次故障对齐。

??? details "Q5. 外部回环七字节一致能证明什么，为什么还必须恢复 GPS 复测？"
    它证明短接点以内、当前配置下的控制器、8250、TTY 和用户收发路径能够交付已知数据。GPS 和被隔离的外部线段不在证据范围内，只有恢复正常连接并重新取得正常字节流，才能确认回到产品链路。

??? details "Q6. 逻辑分析仪已经解码出正确 NMEA，为什么不能直接宣布串口链路完全正常？"
    解码只反映仪器门限和采样条件下的数字结果，不证明 RK3568 的模拟识别裕量，也不证明 8250、N_TTY 和用户读取正确。还需与示波器、计数器和用户字节分别对齐。

??? details "Q7. 回环时 `write()` 返回 7，为什么不能据此认定用户已经收到七字节？"
    `write()` 返回表示本次接受的发送字节数，不等于线上发送完成或接收端交付。还要检查实际 `read()` 返回、累计接收字节、计数器和必要的仪器证据。

??? details "Q8. 为什么恢复阶段不能只用 `stty sane` 代替最初保存的配置？"
    `sane` 是工具定义的一组通用设置，不一定是进入实验前的业务配置。应使用 `stty -g` 保存的原始字符串恢复，再完整读回对照；链路基线和业务配置恢复是两个需要分别验证的状态。
