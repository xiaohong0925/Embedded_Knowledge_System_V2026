# B-B.5.5 实战：NEO-6M GPS 数据读取与 NMEA 解析

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 串口
>
> 难度：[B→I] Beginner → Intermediate

## <span class="blue"> 本节导读

NMEA 0183 是接收机与应用程序之间交换导航信息的一套文本语句格式。本例中的发送方是 NEO-6M，接收方是 RK3568 上的用户程序。UART 的 TX、RX 和 GND 负责承载字节；NMEA 再把连续字节组织为以 `$` 开始、以 CR/LF（回车 `0x0D` 与换行 `0x0A`）结束的语句，并用逗号分隔字段、用 `*` 后的两位十六进制数携带校验和。

GGA 是其中一种语句，携带 UTC（协调世界时）时间、经纬度、定位质量和使用卫星数等信息。本文只把 GGA 作为定位数据来源，其他合法语句可以在校验后忽略。GNSS 指全球卫星导航系统；NEO-6M 属于 GPS 接收模块，本篇不展开卫星测量与定位算法。

本节只回答一个问题：**连续且任意分块的 NMEA 字节流，怎样经过 termios 配置、流式组帧、校验和解析变成可信定位数据？**

> 流式组帧：发送和读取都不保证按语句边界切分时，接收程序保存未完成内容，从连续字节中恢复完整语句的过程。

<!-- -->

> 可信定位数据：本篇限定为结构、长度和校验合法，必需字段有效，且定位状态满足发布条件的数据。它不等于已经证明坐标的现场精度。

本节覆盖：正常接收前提、termios 备份与配置、任意 `read()` 分块、语句长度与校验、GGA 空字段和未定位处理、完整 C 程序、主机确定性测试，以及退出后的原配置恢复。UART 帧与波特率归 B-B.5.2，TTY 与 termios 内部路径归 B-B.5.3，通用分层排障归 B-B.5.4。

## <span class="blue"> 先固定正常链路和一条合法 GGA

### 原始字节基线先于定位结果

正常实例沿用 NEO-6M TX → RK3568 UART4 RX → `/dev/ttyS4` → 用户程序。设备节点映射和 9600、8N1 都是延续前文的教学配置，实际板级 DTS、连接器、模块当前协议和速率仍需分别核对。NEO-6 数据手册列出的默认值只能确定首次核对方向，不能代替当前模块转接板（breakout）的配置证据。

开始之前应满足三个条件：

1. 已按 B-B.5.1 核对实际供电、IO 电平、TX／RX 与 GND。
2. 已按 B-B.5.4 在有限窗口内取得与当前模块配置一致的原始字节，并保存配置读回和系统调用证据。
3. 已协调端口访问，没有 getty 登录终端服务、gpsd 定位数据守护进程或其他业务程序同时读取。随后停止基线采集工具，再启动本篇程序，避免两个读取者分走字节。

正常产品路径如下。从 `read()` 开始是本篇新增的用户态工作，前面的内核交付路径已经在 B-B.5.3 建立：

```text
NEO-6M → UART4 → 8250 → serial core → N_TTY
→ read() 返回任意长度字节块
→ 保存残留并恢复完整 NMEA 语句
→ 长度、CR/LF、校验和检查
→ GGA 字段、定位状态和坐标范围检查
→ 输出定位结果
→ 停止读取并恢复原 termios
```

下图只协调本篇各阶段的交接，不代表这些检查已经证明硬件正常。阅读时先沿顶部主路径向右看，再看底部三类拒绝结果分别在哪一步离开主路径。

<div style="overflow-x:auto">
<svg viewBox="0 0 1160 300" xmlns="http://www.w3.org/2000/svg" style="max-width:1080px;width:100%;min-width:900px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>NMEA 字节流到可信定位数据的处理路径</title>
<defs><marker id="nmea-path-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="currentColor" stroke="none"/></marker></defs>
<rect x="20" y="55" width="135" height="72" rx="8"/><text x="87" y="84" text-anchor="middle" fill="currentColor" stroke="none">read() 字节块</text><text x="87" y="108" text-anchor="middle" fill="currentColor" stroke="none">任意分块</text>
<rect x="190" y="55" width="135" height="72" rx="8"/><text x="257" y="84" text-anchor="middle" fill="currentColor" stroke="none">流式组帧</text><text x="257" y="108" text-anchor="middle" fill="currentColor" stroke="none">保存残留</text>
<rect x="360" y="55" width="135" height="72" rx="8"/><text x="427" y="84" text-anchor="middle" fill="currentColor" stroke="none">完整语句</text><text x="427" y="108" text-anchor="middle" fill="currentColor" stroke="none">$ … CR/LF</text>
<rect x="530" y="55" width="135" height="72" rx="8"/><text x="597" y="84" text-anchor="middle" fill="currentColor" stroke="none">长度与校验</text><text x="597" y="108" text-anchor="middle" fill="currentColor" stroke="none">先验证再使用</text>
<rect x="700" y="55" width="135" height="72" rx="8"/><text x="767" y="84" text-anchor="middle" fill="currentColor" stroke="none">GGA 字段</text><text x="767" y="108" text-anchor="middle" fill="currentColor" stroke="none">保留空字段</text>
<rect x="870" y="55" width="135" height="72" rx="8"/><text x="937" y="84" text-anchor="middle" fill="currentColor" stroke="none">定位状态</text><text x="937" y="108" text-anchor="middle" fill="currentColor" stroke="none">0 不发布坐标</text>
<rect x="870" y="190" width="270" height="65" rx="8"/><text x="1005" y="218" text-anchor="middle" fill="currentColor" stroke="none">度分转换与输出</text><text x="1005" y="242" text-anchor="middle" fill="currentColor" stroke="none">position / no_fix</text>
<line x1="155" y1="91" x2="182" y2="91" marker-end="url(#nmea-path-arrow)"/><line x1="325" y1="91" x2="352" y2="91" marker-end="url(#nmea-path-arrow)"/><line x1="495" y1="91" x2="522" y2="91" marker-end="url(#nmea-path-arrow)"/><line x1="665" y1="91" x2="692" y2="91" marker-end="url(#nmea-path-arrow)"/><line x1="835" y1="91" x2="862" y2="91" marker-end="url(#nmea-path-arrow)"/><line x1="937" y1="127" x2="937" y2="182" marker-end="url(#nmea-path-arrow)"/>
<rect x="190" y="190" width="305" height="65" rx="8" stroke-dasharray="6 4"/><text x="342" y="218" text-anchor="middle" fill="currentColor" stroke="none">未完成：继续等待后续字节</text><text x="342" y="242" text-anchor="middle" fill="currentColor" stroke="none">超长：丢弃并重新同步</text>
<rect x="530" y="190" width="305" height="65" rx="8" stroke-dasharray="6 4"/><text x="682" y="218" text-anchor="middle" fill="currentColor" stroke="none">坏校验／格式错误／无效字段</text><text x="682" y="242" text-anchor="middle" fill="currentColor" stroke="none">不计为可发布位置</text>
</svg>
</div>

组帧未完成不是错误，继续等待即可；超长、坏校验和无效字段则必须产生可区分的拒绝结果。只有穿过全部门限的 GGA 才进入坐标发布，未定位语句只产生 `no_fix` 事件。

### 同一官方样本贯穿正文和测试

贯穿输入取自 u-blox 6《Receiver Description Including Protocol Specification》的 GGA 示例。这里把不可见的 CR/LF 写成 `\r\n`，它属于协议结构标注，不是要求 C 字符串保留反斜杠文本：

```text
$GPGGA,092725.00,4717.11399,N,00833.91590,E,1,8,1.01,499.6,M,48.0,M,,0*5B\r\n
```

它是**官方协议示例和主机固定输入，不是当前 NEO-6M 的实测输出**。完成正常解析后，教学预期为：

```text
position quality=1 satellites=8 latitude=47.285233 longitude=8.565265
```

这两个坐标来自字段换算，不代表现场位置，也不能用于证明 UART4 已收到数据。目标板的真实输出需要另行记录。

## <span class="blue"> 一条 NMEA 语句要依次通过哪些检查

### 先确认边界和长度，再计算校验和

本篇解析器按 NMEA 的 82 字节上限限制一条语句，长度包含 `$` 和末尾 CR/LF。这个限制是本程序明确的输入策略；实际设备若被配置为扩展输出，应先核对协议配置，不能把所有超长输入都直接解释为 UART 硬件故障。

`$` 只是组帧起点，不参与校验。`*` 分隔数据与校验字段，也不参与校验。程序对二者之间的每个字节执行 XOR（按位异或）：从 0 开始，每读入一个字节都与累计值异或，得到 8 位结果。逗号同样参与，最后与 `*` 后的恰好两位十六进制数比较。CR/LF 不参与 XOR，但语句必须以这两个字节结束。

上述顺序很重要：只有先找到合法 `*HH\r\n`，才能确定 XOR 的覆盖范围；只有校验通过，字段内容才值得进入业务解析。校验可以发现符合其规则的一部分传输变化，但不能证明定位真实，也不能修正错误字节。

### 空字段仍占据自己的字段位置

手册示例中的字段 0～7 依次是：

| 位置 | 示例 | 本篇用途 |
|---|---|---|
| 0 | `$GPGGA` | 识别语句类型 |
| 1 | `092725.00` | UTC 时间，本例保存字段边界但不参与位置计算 |
| 2 | `4717.11399` | 纬度，格式为度与分 |
| 3 | `N` | 北纬；`S` 表示南纬 |
| 4 | `00833.91590` | 经度，格式为度与分 |
| 5 | `E` | 东经；`W` 表示西经 |
| 6 | `1` | 定位质量 |
| 7 | `8` | 用于定位的卫星数 |

字段 8 以后还包括水平精度因子（HDOP）、海拔、大地水准面差值和差分信息。本篇不消费这些值，但切分字段时仍须保留它们的位置。末尾 `,,0` 中前一个字段为空，后一个字段为 `0`；若用会合并连续分隔符的切分方法，后续字段就会错位。

经纬度也不是普通十进制数。`4717.11399` 表示 47 度 17.11399 分，`00833.91590` 表示 8 度 33.91590 分：

```text
latitude  = 47 + 17.11399 / 60 = 47.285233166…°
longitude =  8 + 33.91590 / 60 =  8.565265000…°
```

程序还检查分钟必须小于 60、纬度不超过 90°、经度不超过 180°，以及南纬／西经的符号。字段为空、含非数字字符或超出范围时返回格式错误，不把缺失值静默转换成 0。

### 定位质量是发布门限，不是链路探针

u-blox 6 的 GGA 质量 0 表示未定位，1 和 2 分别表示普通 GPS 与差分 GPS 定位。本篇只发布质量 1／2 的坐标；质量 0 输出 `no_fix`，即使经纬度字段仍有非空内容也不发布。其他质量值单独计为 `unsupported_fix`，不在没有展开其业务模式时静默接受。

因此，`no_fix` 与“串口没有数据”是两种不同结果：前者已经收到完整、校验合法的语句，只是接收机没有可发布定位；后者连 NMEA 语义检查都还没有输入。反过来，一条 `quality=1` 也不能替代 B-B.5.4 的原始字节、计数器或仪器证据。

## <span class="blue"> 配置 UART4 前，先让原配置可以恢复

B-B.5.3 已说明 termios 同时影响 UART 硬件和 N_TTY 行为。本篇只把这些机制落到代码：先保存，再修改副本，设置成功后读回，退出时恢复。

完整设备端程序是 [`neo6m_nmea.c`](code/B-B.5.5/neo6m_nmea.c){: data-code-viewer="true" data-code-title="neo6m_nmea.c" data-code-path="本篇教学配套 · code/B-B.5.5/neo6m_nmea.c"}，流式解析接口位于 [`nmea_stream.h`](code/B-B.5.5/nmea_stream.h){: data-code-viewer="true" data-code-title="nmea_stream.h" data-code-path="本篇教学配套 · code/B-B.5.5/nmea_stream.h"}。下面的片段取自同一份程序，展示配置顺序，不是独立可编译文件：

```c
/* neo6m_nmea.c，配置片段；saved 是进入程序时的原配置 */
if (tcgetattr(fd, saved) != 0) {
    perror("tcgetattr saved configuration");
    return -1;
}
requested = *saved;
cfmakeraw(&requested);
requested.c_cflag &= ~(CSIZE | PARENB | CSTOPB | CRTSCTS);
requested.c_cflag |= CS8 | CREAD | CLOCAL;
requested.c_cc[VMIN] = 0;
requested.c_cc[VTIME] = 10;
if (cfsetispeed(&requested, B9600) != 0 ||
    cfsetospeed(&requested, B9600) != 0) {
    perror("cfsetispeed/cfsetospeed");
    return -1;
}
if (tcsetattr(fd, TCSANOW, &requested) != 0) {
    perror("tcsetattr configure");
    return -1;
}
*changed = true;
```

`open()` 使用 `O_RDONLY | O_NOCTTY | O_CLOEXEC`：本例只接收，不主动成为控制终端，并防止后续启动的程序继承该描述符。`cfmakeraw()` 关闭规范模式、回显、信号字符、输入输出转换和软件流控等终端处理，但不会绕过 TTY。随后明确设置 8 数据位、无校验、1 停止位、无 RTS／CTS，并使能接收、忽略调制解调器控制线。`TCSANOW` 表示立即应用这组配置。

`VMIN=0、VTIME=10` 是非规范读取条件，等待窗口为 1 秒量级。此时 `read()` 返回 0 可以表示本次超时没有字节，不是 NMEA 文件结束。程序不用忙轮询，也不把一次 0 当成硬件损坏。

`tcsetattr()` 成功后，`changed` 才登记为真。程序随后用 `tcflush(fd, TCIFLUSH)` 丢弃配置前残留的输入字节，并再次 `tcgetattr()` 读回。读回比较覆盖四组标志、控制字符和输入／输出速率，不用 `memcmp()` 比较整个结构体，从而避免把可能的填充字节当成配置差异。flush 或读回失败也会进入恢复路径。

## <span class="blue"> `read()` 只交字节，组帧器负责恢复语句

### 任意分块必须产生同一个答案

`read()` 返回的正数只表示本次实际交付多少字节。即使 NEO-6M 连续发送同一条 GGA，一次调用也可能只给 `$GPGGA,09`，下一次才给剩余部分；也可能一次包含两条完整语句和下一条的开头。

下面的示意固定同一语句，只改变交付边界。每一行从左到右表示“本次输入、完成后的事件、留给下一次的残留”，不是三次不同的 GPS 数据。

<div style="overflow-x:auto">
<svg viewBox="0 0 1120 420" xmlns="http://www.w3.org/2000/svg" style="max-width:1040px;width:100%;min-width:900px;height:auto" font-family="sans-serif" font-size="14" stroke="currentColor" fill="none" stroke-width="1.5">
<title>同一 NMEA 字节流在任意 read 分块下的组帧状态</title>
<defs><marker id="nmea-chunk-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="currentColor" stroke="none"/></marker></defs>
<text x="35" y="38" fill="currentColor" stroke="none" font-size="16">同一字节流：$GPGGA,…*5B\r\n$GPGGA,…*5B\r\n</text>
<rect x="35" y="70" width="245" height="68" rx="8"/><text x="157" y="98" text-anchor="middle" fill="currentColor" stroke="none">read() #1</text><text x="157" y="122" text-anchor="middle" fill="currentColor" stroke="none">$GPGGA,092725.00,…</text>
<rect x="435" y="70" width="245" height="68" rx="8"/><text x="557" y="98" text-anchor="middle" fill="currentColor" stroke="none">read() #2</text><text x="557" y="122" text-anchor="middle" fill="currentColor" stroke="none">…*5B\r\n$GPGGA,…</text>
<rect x="835" y="70" width="245" height="68" rx="8"/><text x="957" y="98" text-anchor="middle" fill="currentColor" stroke="none">read() #3</text><text x="957" y="122" text-anchor="middle" fill="currentColor" stroke="none">…*5B\r\n</text>
<line x1="280" y1="104" x2="427" y2="104" marker-end="url(#nmea-chunk-arrow)"/><line x1="680" y1="104" x2="827" y2="104" marker-end="url(#nmea-chunk-arrow)"/>
<rect x="35" y="205" width="245" height="85" rx="8" stroke-dasharray="6 4"/><text x="157" y="235" text-anchor="middle" fill="currentColor" stroke="none">尚不完整，不解析</text><text x="157" y="260" text-anchor="middle" fill="currentColor" stroke="none">残留：第一条前半段</text>
<rect x="435" y="205" width="245" height="85" rx="8" stroke-dasharray="6 4"/><text x="557" y="235" text-anchor="middle" fill="currentColor" stroke="none">完成第一条并校验</text><text x="557" y="260" text-anchor="middle" fill="currentColor" stroke="none">残留：第二条开头</text>
<rect x="835" y="205" width="245" height="85" rx="8" stroke-dasharray="6 4"/><text x="957" y="235" text-anchor="middle" fill="currentColor" stroke="none">完成第二条并校验</text><text x="957" y="260" text-anchor="middle" fill="currentColor" stroke="none">残留：空</text>
<rect x="245" y="340" width="625" height="52" rx="8"/><text x="557" y="372" text-anchor="middle" fill="currentColor" stroke="none">只改变 read() 边界，不改变语句内容和最终事件序列</text>
</svg>
</div>

第一次返回后不能解析，因为还没有 LF；第二次返回先补完第一条，再把第二条开头留在同一个流对象中；第三次才完成第二条。若每次 `read()` 后都清空缓冲区，第二条开头就会丢失；若把每次返回都交给字段解析，半行就会被误判为坏语句。

### 流对象保存进度，超长状态限制内存

完整实现位于 [`nmea_stream.c`](code/B-B.5.5/nmea_stream.c){: data-code-viewer="true" data-code-title="nmea_stream.c" data-code-path="本篇教学配套 · code/B-B.5.5/nmea_stream.c"}。`struct nmea_stream` 保存当前语句、长度、是否位于语句内以及是否正在丢弃超长输入。它由调用方创建和初始化，因此测试与设备程序可以各自拥有独立状态。

下面的完整 `nmea_stream_feed()` 展示字节如何进入状态机。`data` 可以指向任意二进制缓冲区，`size_t` 类型的 `length` 来自本次 `read()`，表示这段缓冲区的字节数；输入不依赖 NUL 结尾：

```c
void nmea_stream_feed(struct nmea_stream *stream, const void *data,
                      size_t length, nmea_event_callback callback,
                      void *context)
{
    const unsigned char *bytes = data;
    size_t i;

    for (i = 0; i < length; ++i) {
        unsigned char c = bytes[i];

        if (c == '$') {
            stream->sentence[0] = '$';
            stream->length = 1u;
            stream->in_sentence = 1;
            stream->discarding = 0;
            continue;
        }
        if (!stream->in_sentence)
            continue;
        if (c == '\n') {
            if (stream->discarding) {
                emit_event(NMEA_EVENT_TOO_LONG, callback, context);
            } else {
                stream->sentence[stream->length++] = '\n';
                stream->sentence[stream->length] = '\0';
                finish_sentence(stream, callback, context);
            }
            stream->length = 0;
            stream->in_sentence = 0;
            stream->discarding = 0;
            continue;
        }
        if (stream->discarding)
            continue;
        if (stream->length >= NMEA_SENTENCE_MAX - 1u) {
            stream->discarding = 1;
            stream->length = 0;
            continue;
        }
        stream->sentence[stream->length++] = (char)c;
    }
}
```

每次遇到 `$` 都重新开始，使残句被新起点打断时能够重新同步。非 LF 字节只有在当前长度仍允许末尾再容纳 LF 时才写入；超过限制后进入 `discarding`，继续消费却不继续占用缓冲区。LF 到达后只产生一个超长事件，下一条仍可正常解析。

`finish_sentence()` 再检查 CR/LF、`*HH` 和 XOR。回调是解析器在形成一个事件时调用的上层函数；这里由它把位置、未定位或拒绝结果交给设备程序。一次输入可以触发多次回调，也可以一次都不触发。回调不会清空下一语句已经积累的内容，因为这些内容位于同一状态对象中，而不是某个临时读缓冲区里。

## <span class="blue"> 校验和字段检查共同决定能否发布坐标

### 校验覆盖范围由真实字节位置确定

`finish_sentence()` 使用 `memchr()` 找 `*`，再检查它与 CR 之间恰好有两个字符。`hex_value()` 把两位十六进制字符转成预期值；下面的循环才是实际校验范围：

```c
/* nmea_stream.c，finish_sentence() 中的校验片段 */
for (i = 1; i < star_offset; ++i) {
    unsigned char c = (unsigned char)stream->sentence[i];

    if (c < 0x20u || c > 0x7eu) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    actual ^= c;
}
expected = (unsigned char)((high << 4) | low);
if (actual != expected) {
    emit_event(NMEA_EVENT_BAD_CHECKSUM, callback, context);
    return;
}
```

下标从 1 开始，所以 `$` 被排除；终点是 `star_offset`，所以 `*` 被排除。CR/LF 尚未进入循环。ASCII 是本例文本所用的字节编码；可打印范围检查同时排除不属于语句数据区的控制字节。坏校验与格式错误分别产生事件，便于测试和运行统计区分。

### 字段切分不能用会吞掉空字段的接口

`split_fields()` 按逗号记录每个字段的指针和长度。它在逗号或正文结尾都保存一段，即使这段长度为 0：

```c
/* nmea_stream.c，完整字段切分函数 */
static size_t split_fields(char *body, size_t body_length,
                           struct field *fields, size_t capacity)
{
    size_t count = 0;
    size_t start = 0;
    size_t i;

    for (i = 0; i <= body_length; ++i) {
        if (i != body_length && body[i] != ',')
            continue;
        if (count == capacity)
            return 0;
        fields[count].data = body + start;
        fields[count].length = i - start;
        ++count;
        start = i + 1;
    }
    return count;
}
```

因此 `a,,b` 会得到长度分别为 1、0、1 的三个字段。程序先检查 GGA 类型，再读取字段 6 和 7。类型不同且校验合法的语句计入 `ignored`，不因字段数量较少而误报为损坏 GGA。

`parse_unsigned()` 要求整个字段都是十进制数字；`parse_coordinate()` 分别读取固定宽度的度和两位以上的分，再处理可选小数。它们都使用字段长度，不依赖 `atoi()` 的静默转换，也不把 `sscanf()` 的部分匹配当成完整成功。

质量 0 直接回调 `no_fix`，坐标字段不会被使用。质量 1／2 才继续解析字段 2～5；空坐标、非法半球或越界值都产生 `malformed`，不会更新位置输出。

## <span class="blue"> 完整程序怎样收口正常、异常与恢复路径

设备程序与解析器之间只有一次交接：`read()` 的正数返回被原样交给 `nmea_stream_feed()`。读取返回值使用 `ssize_t`，不能用可能截断的 `int` 保存：

```c
/* neo6m_nmea.c，读取循环片段 */
while (!stop_requested) {
    unsigned char buffer[256];
    ssize_t count = read(fd, buffer, sizeof(buffer));

    if (count > 0) {
        nmea_stream_feed(&stream, buffer, (size_t)count, print_event,
                         &stats);
    } else if (count == 0) {
        continue;
    } else if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
        continue;
    } else {
        perror("read");
        goto out;
    }
}
exit_code = EXIT_SUCCESS;
```

正数可能小于 256，仍然全部交给组帧器；0 在当前 `VMIN／VTIME` 下继续等待。EINTR 表示调用被信号打断，EAGAIN／EWOULDBLOCK 表示当前条件下暂时不能取得数据，三者都回到循环；其他错误保留 `errno` 错误码文本并退出循环。程序分别统计位置、未定位、不支持状态、忽略语句、坏校验、格式错误和超长输入。

SIGINT 处理函数只把停止标志置 1，不在信号上下文里打印或调用 termios。`sig_atomic_t` 是适合在主程序与信号处理函数之间保存这类标志的整数类型，`volatile` 要求每次实际访问该对象。`sigaction()` 不设置表示自动重启系统调用的 `SA_RESTART`，使阻塞读取可以被信号打断；若当前实现稍后从读取超时返回，循环条件同样会结束读取。

所有已打开路径最终进入同一个 `out` 清理段：

```c
/* neo6m_nmea.c，集中恢复与关闭片段 */
out:
    if (changed && restore_port(fd, &saved) != 0)
        exit_code = EXIT_FAILURE;
    if (close(fd) != 0) {
        perror("close");
        exit_code = EXIT_FAILURE;
    }
```

`restore_port()` 先恢复最初保存的完整 termios，再读回核对。配置尚未成功时不执行恢复；配置成功后，即使后续 flush、读回或读取失败，也会尝试恢复。恢复或关闭失败都会让最终退出状态保持非零。

完整交付还包括 [`test_nmea_stream.c`](code/B-B.5.5/test_nmea_stream.c){: data-code-viewer="true" data-code-title="test_nmea_stream.c" data-code-path="本篇教学配套 · code/B-B.5.5/test_nmea_stream.c"} 和 [`Makefile`](code/B-B.5.5/Makefile){: data-code-viewer="true" data-code-title="Makefile" data-code-path="本篇教学配套 · code/B-B.5.5/Makefile"}。正文片段、设备入口和测试均引用这些文件，不另维护一份行为不同的简化实现。

## <span class="blue"> 先用确定性主机输入验证软件逻辑

测试程序不打开 UART，而是直接调用同一个 `nmea_stream_feed()`。这样可以把分块位置和错误字节固定下来，并让同一输入每次得到相同事件序列。

| 夹具 | 断言 |
|---|---|
| 合法 GGA 整句 | 产生一个位置事件，质量、卫星数和坐标精确匹配 |
| 半行后补齐 | 前半段零事件，补齐后只产生一个位置事件 |
| 每个可能切分点 | 所有两段切分结果都与整句一致 |
| 逐字节与固定不规则分块 | 结果仍与整句一致 |
| 多行粘连与块尾残留 | 位置、`no_fix`、忽略语句和下一位置按顺序出现 |
| 坏校验 | 只产生 `bad_checksum`，不产生位置 |
| 空字段与未定位 | 连续逗号不移动字段；质量 0 不发布坐标；质量 1 的空坐标被拒绝 |
| 超长后接合法语句 | 先产生 `too_long`，后续合法语句仍能解析 |
| LF-only 与新 `$` 重同步 | 格式错误被区分，残句不会阻止下一条合法 GGA |
| 未完成输入与南／西半球 | 未完成不解析；南纬和西经得到负号 |

这些固定夹具的校验值独立复算后写入测试文件，测试不调用被测校验函数生成自己的标准答案。每个切分点、每个预期事件和数值容差都由断言检查，不能靠肉眼查看一行大致正常的坐标代替。

在 `code/B-B.5.5/` 目录执行：

```bash
make clean
make
make test
```

`make` 分别构建设备程序和测试程序，`make test` 只运行后者。十组测试全部通过时的**预期输出**为：

```text
PASS: 10 deterministic test groups
```

交叉编译使用另一条独立构建，避免沿用本机已有产物：

```bash
make clean
make CC=aarch64-linux-gnu-gcc
```

若主机支持 GCC 或 Clang 的 Sanitizer，可再执行 `make sanitize`，用 AddressSanitizer 和 UndefinedBehaviorSanitizer 检查测试路径。它仍然只是主机软件验证。

当前写作环境没有提供 GCC、Make 或 AArch64 交叉编译器，因此上述编译和测试是**待执行命令，不是已取得的通过结果**。主机测试即使通过，也只证明组帧、校验和解析逻辑，不证明 UART4、8250、真实 GPS 或目标恢复路径已经运行。

## <span class="blue"> 上板运行、停止并恢复原配置

实际板卡仍需先完成原始字节基线，再交叉编译并部署与目标系统 C 库匹配的程序。运行命令为：

```bash
./neo6m_nmea /dev/ttyS4
printf 'reader_exit=%d\n' "$?"
```

程序启动后会报告读取设备和停止方式。运行期间应保存真实标准输出、标准错误和最终退出状态，不预先填入坐标、卫星数或定位时间。可按以下边界判读：

- 取得原始字节但没有完整语句：检查组帧输入、CR/LF 和当前模块协议，不能马上归咎于卫星信号。
- 出现坏校验或格式错误：保留对应计数及原始字节证据，必要时回 B-B.5.4 对齐链路观察。
- 出现 `no_fix`：NMEA 语句已经通过结构和校验检查，只表示接收机没有可发布定位。
- 出现 `position`：说明程序按本篇门限发布了一个位置，坐标现场精度仍需独立验证。
- 无任何输出：先检查进程是否仍在等待、是否有其他读取者以及真实字节是否到达，不用固定等待秒数代替证据。

按 Ctrl+C 停止后，程序应恢复原 termios、读回核对并关闭描述符。`reader_exit=0` 只表示正常停止和清理均成功；若恢复、读回或关闭失败，程序返回非零。此时保留错误文本，并使用进入实验前按 B-B.5.4 保存的配置记录执行恢复，不用 `stty sane` 猜测业务原状态。

目标运行、真实 NMEA 输出、定位结果和恢复读回目前均未取得，正文不把它们写成实测结论。逻辑分析仪或示波器如需加入，只用于补齐 UART 链路证据，不负责验证 NMEA 字段或坐标语义。

## <span class="blue"> 证据来源与未验证项

本篇协议与配置结论核对了以下资料：

- u-blox《NEO-6 Data Sheet》Table 15：串口默认 9600、8N1 和启动时启用的 NMEA 消息。默认值不等于当前 breakout 的实际配置。
- u-blox 6《Receiver Description Including Protocol Specification》GPS.G6-SW-10018-F：NMEA GGA 结构、官方示例、字段位置、定位质量及经纬度格式。
- NMEA 0183 的语句边界、XOR 校验和 82 字节输入限制；本程序把该限制作为明确解析策略，不据此推断所有扩展设备配置。
- Linux v6.6 `include/uapi/asm-generic/termbits.h`、`drivers/tty/tty_ioctl.c` 和 `drivers/tty/n_tty.c`：termios 字段、VMIN／VTIME、设置路径及非规范读取返回。

旧 GPS 稿只作为待核验素材。原程序中的 `strtok()`、未检查的数值转换、超长截断、缺少原配置恢复和未定位仍输出坐标等路径均未继承；旧日志、坐标、冷启动时间与地图精度也没有迁入本篇。

当前已完成手册核对、固定夹具校验值复算、源码静态跟随和 MkDocs 严格构建。教学代码编译、主机测试、目标运行和仪器测量均未执行；浏览器检查留待统一桌面验收。文档构建与这些验证分别登记，不相互替代。

## <span class="blue"> 本节总结 [B→I]

UART 实战的关键不是把一次 `read()` 当成一行，而是让字节交付与语句解析各自承担清晰责任。termios 提供未经终端改写的字节，流对象保存任意分块之间的进度，长度和校验门限拒绝不完整或损坏语句，定位质量再决定坐标能否发布。

正常路径先从一个合法 GGA 得到确定结果，再用分块和异常夹具证明同一逻辑在不同输入边界下仍然成立。主机测试不能替代真实串口，定位字段也不能替代链路证据；程序退出时恢复最初配置并读回核对，才完成一次可重复的实践。

## <span class="blue"> 本节自查

??? details "Q1. 为什么一次 `read()` 返回半行不是错误，直接清空组帧缓冲却会出错？"
    `read()` 只交付当前可用的一段字节，不负责 NMEA 语句边界。半行需要保存在流对象中，等后续字节补齐；若每次返回都清空缓冲，跨调用的前半句就会丢失。

??? details "Q2. 一条 GGA 的 `quality=1` 为什么不能同时证明 UART 链路完全正常？"
    它只说明这条语句的字段表达了有效定位。链路验证还需要原始字节、系统调用、计数器或仪器等证据；一个业务字段不能覆盖这些观察面。

??? details "Q3. NMEA 校验为什么要排除 `$`、`*` 和 CR/LF，却保留逗号？"
    校验范围是 `$` 与 `*` 之间的语句正文，分隔正文的逗号属于正文。`*` 是校验字段的起点，CR/LF 是语句终止符，它们都不在 XOR 范围内。

??? details "Q4. 为什么不能用会合并连续逗号的字段切分方式解析 `a,,b`？"
    中间空字段仍然占据一个字段位置。合并逗号会把 `b` 前移，后续按位置读取的质量、坐标或其他字段就可能错位。

??? details "Q5. 质量 0 的 GGA 中仍有非空经纬度，程序为什么也不能发布？"
    质量 0 表示接收机当前未定位，非空字段可能是旧值或占位内容。本篇把定位质量作为发布门限，只输出 `no_fix`，不换算或更新坐标。

??? details "Q6. 超长输入为什么不能只停止写入，然后继续把后续字节当成新语句？"
    停止写入只能防止越界，不能说明当前语句在哪里结束。程序还要丢弃到 LF，或在新的 `$` 处重新同步，否则残句尾部可能污染下一条语句。

??? details "Q7. 为什么 SIGINT 处理函数不直接恢复 termios？"
    信号上下文能安全调用的操作受到限制，stdio 和 termios 不适合放在其中。处理函数只设置停止标志，主循环退出后沿统一清理路径恢复、读回并关闭描述符。

??? details "Q8. 主机确定性测试全部通过后，还不能宣称哪些内容已经验证？"
    它只证明固定输入下的组帧、校验和字段解析。真实 UART4、8250、NEO-6M 输出、目标定位、现场精度以及板上的配置恢复都需要独立的目标或仪器证据。
