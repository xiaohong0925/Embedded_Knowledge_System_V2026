# B-B.5.4 实战：NEO-6M GPS 模块 UART 数据读取与解析

> 所属章节：第五部 B. 总线协议 > B-B.5 UART 总线
>
> 难度：[I] Intermediate | 预计阅读时间：40 分钟

## <span class="blue"> 本节导读

本篇是 UART 板块的实战收口：把 B-B.5.1 的物理层知识、B-B.5.2 的驱动与工具链，落到一台真实设备上——u-blox NEO-6M GPS 模块。任务目标：RK3568 通过 UART4 接收 GPS 的 NMEA 数据流，用 C 程序解析出经纬度，并在终端实时打印定位结果。

与 I2C/SPI 实战不同，GPS 没有内核驱动路径（它不是内核管理的设备类型，就是一台往串口倒数据的外设），全程在用户态完成——这正是 UART 设备的典型形态。整个流程：读手册 → 接线与设备树 → 工具看原始流 → 理解协议 → 写解析程序 → 实测验证。

---

## <span class="blue"> 第一步：读手册

NEO-6M 是 u-blox 的高性价比 GPS 接收模块，嵌入式领域装机量极大。上电即通过 UART 持续输出 NMEA 0183 格式语句，无需任何初始化命令。

| 参数 | 规格 |
|------|------|
| 供电 | 3.3 V ~ 5 V（模块板载 LDO） |
| UART 电平 | TTL 3.3 V，可直接接 SoC |
| 默认波特率 | **9600**，8N1 |
| 协议 | NMEA 0183（可切换 UBX 二进制） |
| 冷启动定位 | 约 27 s（典型值） |
| 热启动定位 | 约 1 s（有备份电源保持 RTC/星历） |
| 定位指示 | 板载 PPS LED，定位成功后每秒闪烁 |

> ⚠️ 冷启动首次定位（TTFF）需要 30 秒以上，室内可能永远定不了位。冷启动指模块没有星历备份、没有近似位置与时间，要从头搜索卫星。第一次调试时接上电源没看到有效经纬度就改代码查接线，是最常见的误判——把模块放窗边或户外，等 30~60 秒，PPS 灯开始闪才说明定位成功。

---

## <span class="blue"> 第二步：硬件接线与设备树

UART 交叉接线：模块 TX 接 SoC RX。NEO-6M 是单向输出场景，SoC 的 TX 可以不接，但接上可用于下发 UBX 配置命令（进阶）。

<svg viewBox="0 0 700 260" xmlns="http://www.w3.org/2000/svg" style="max-width:700px;width:100%">
<rect x="30" y="50" width="220" height="160" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="140" y="80" text-anchor="middle" font-size="14" fill="currentColor">RK3568</text>
<text x="140" y="100" text-anchor="middle" font-size="11" fill="currentColor">UART4（serial@fe680000）</text>
<rect x="450" y="50" width="220" height="160" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
<text x="560" y="80" text-anchor="middle" font-size="14" fill="currentColor">NEO-6M 模块</text>
<line x1="250" y1="120" x2="450" y2="120" stroke="currentColor" stroke-width="1.5"/>
<polygon points="450,120 440,116 440,124" fill="currentColor"/>
<text x="262" y="112" font-size="12" fill="currentColor">UART4_TX</text>
<text x="395" y="112" font-size="12" fill="currentColor">→ RX</text>
<line x1="450" y1="145" x2="250" y2="145" stroke="currentColor" stroke-width="1.5"/>
<polygon points="250,145 260,141 260,149" fill="currentColor"/>
<text x="395" y="139" font-size="12" fill="currentColor">TX →</text>
<text x="262" y="157" font-size="12" fill="currentColor">UART4_RX</text>
<line x1="250" y1="170" x2="450" y2="170" stroke="currentColor" stroke-width="1.5"/>
<text x="262" y="182" font-size="12" fill="currentColor">GND</text>
<text x="395" y="182" font-size="12" fill="currentColor">GND</text>
<line x1="250" y1="195" x2="450" y2="195" stroke="currentColor" stroke-width="1.5"/>
<text x="262" y="207" font-size="12" fill="currentColor">3.3V</text>
<text x="395" y="207" font-size="12" fill="currentColor">VCC</text>
<text x="350" y="242" text-anchor="middle" font-size="11" fill="currentColor">TX/RX 交叉、必须共地；模块 TTL 电平 3.3 V 直连安全</text>
</svg>

> ⚠️ 部分 GPS 模块标称 5 V 供电时 TX/RX 也是 5 V 电平——直连会损伤 SoC 的 3.3 V IO。确认模块丝印或手册的 IO 电平；5 V 电平的模块中间加电平转换（TXS0102）或分压电阻。

设备树使能 UART4（SoC 级 dtsi 已预置寄存器/时钟/DMA/默认引脚组）：

```dts
/ {
    aliases {
        serial2 = &uart2;      // 调试 console（已有）
        serial4 = &uart4;      // GPS
    };
};

&uart4 {
    status = "okay";
};
```

重启后确认：

```bash
dmesg | grep fe680000
# fe680000.serial: ttyS4 at MMIO 0xfe680000 (irq = 32, base_baud = 1500000) is a 16550A
ls -l /dev/ttyS4
```

`base_baud = 1500000` 是 UART 的基准时钟能力，与 GPS 的 9600 工作波特率无关——后者由用户态 termios 设置。

---

## <span class="blue"> 第三步：先用工具看原始数据流

写代码之前，先确认硬件层有数据——这是 B-B.5.2 调试闭环的应用：

```bash
stty -F /dev/ttyS4 9600 cs8 -parenb -cstopb raw -echo
cat /dev/ttyS4
```

模块上电即有输出（未定位时也发，只是字段为空）：

```
$GPGGA,123519,4807.038,N,01131.324,E,1,08,0.9,545.4,M,46.9,M,,*47
$GPRMC,123519,A,4807.038,N,01131.324,E,022.4,084.4,230394,003.1,W*6A
$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39
$GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,07,344,39*4A
```

看到滚动的 `$GP...` 行 = 物理层与串口配置全部正确，剩下的纯软件。看不到则回到 B-B.5.2 的四步排查：节点 → 回环 → 计数器 → 参数。

---

## <span class="blue"> 第四步：NMEA 0183 协议速览

NMEA 语句以 `$` 开头、`\r\n` 结尾，逗号分隔字段，`*` 后两字符 HEX 是校验和（`$` 与 `*` 之间所有字符逐字节 XOR）。

| 语句 | 内容 | 实战价值 |
|------|------|----------|
| `$GPGGA` | UTC 时间、经纬度、**定位质量**、卫星数、海拔 | 定位数据主来源 |
| `$GPRMC` | 最小定位信息：时间、状态、经纬度、速度、航向、日期 | 速度/航向场景 |
| `$GPGSA` | 参与定位的卫星编号、PDOP/HDOP/VDOP | 精度评估 |
| `$GPGSV` | 可见卫星的仰角/方位角/信噪比 | 天线摆放诊断 |

`$GPGGA` 字段布局（解析程序按此取字段）：

```
$GPGGA,123519,4807.038,N,01131.324,E,1,08,0.9,545.4,M,46.9,M,,*47
       │      │         │ │          │ │  │  │   │
       │      │         │ │          │ │  │  │   └─ 海拔 545.4 m
       │      │         │ │          │ │  │  └─ HDOP 水平精度因子
       │      │         │ │          │ │  └─ 卫星数 08
       │      │         │ │          │ └─ 定位质量：0=未定位 1=GPS 2=DGPS
       │      │         │ │          └─ 经度半球 E/W
       │      │         │ └─ 经度 dddmm.mmmm
       │      │         └─ 纬度半球 N/S
       │      └─ 纬度 ddmm.mmmm
       └─ UTC 时间 hhmmss.ss
```

坐标格式注意：NMEA 的 `4807.038` 是 **48 度 07.038 分**，不是 48.07038 度。换算：度 + 分/60。

> 💡 程序必须先判定位质量字段：值为 0 时经纬度字段无效（可能是空或旧值），直接丢弃。拿未定位的数据当位置用，是 GPS 应用最常见的逻辑错误。

---

## <span class="blue"> 第五步：termios 配置与 NMEA 解析程序

完整程序：配置串口 9600 8N1 raw → 逐字节组帧 → 校验和验证 → 解析 `$GPGGA` 提取经纬度。

```c
/* gps_nmea_parser.c
 * 交叉编译：${CC} -o gps_parser gps_nmea_parser.c
 * 运行：./gps_parser /dev/ttyS4
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
static int setup_uart(const char *device)
{
    int fd = open(device, O_RDWR | O_NOCTTY | O_NDELAY);
    if (fd < 0) { perror("open"); return -1; }

    struct termios tty;
    memset(&tty, 0, sizeof(tty));
    if (tcgetattr(fd, &tty) != 0) { perror("tcgetattr"); close(fd); return -1; }

    cfsetispeed(&tty, B9600);
    cfsetospeed(&tty, B9600);

    tty.c_cflag &= ~PARENB;              /* 无校验 */
    tty.c_cflag &= ~CSTOPB;              /* 1 位停止位 */
    tty.c_cflag &= ~CSIZE;
    tty.c_cflag |= CS8;                  /* 8 数据位 */
    tty.c_cflag |= CREAD | CLOCAL;       /* 使能接收，忽略 Modem 控制线 */

    /* 原始模式：绕过 ldisc 的一切输入/输出处理 */
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);
    tty.c_iflag &= ~(IXON | IXOFF | IXANY | ICRNL | INLCR | IGNCR);
    tty.c_oflag &= ~OPOST;

    tty.c_cc[VMIN]  = 0;                 /* 非阻塞读 */
    tty.c_cc[VTIME] = 5;                 /* 500 ms 超时 */

    if (tcsetattr(fd, TCSANOW, &tty) != 0) { perror("tcsetattr"); close(fd); return -1; }

    tcflush(fd, TCIOFLUSH);              /* 丢弃配置前进入的残留字节 */
    return fd;
}

/* NMEA 校验：$ 与 * 之间所有字符 XOR */
static int nmea_checksum(const char *sentence)
{
    unsigned char checksum = 0;
    while (*sentence && *sentence != '*') {
        checksum ^= *sentence++;
    }
    return checksum;
}

/* 解析 $GPGGA，输出经纬度（十进制度）、定位质量、卫星数 */
static int parse_gpgga(const char *sentence, double *latitude, double *longitude,
                       int *fix_quality, int *num_satellites)
{
    char buf[NMEA_MAX_LEN];
    strncpy(buf, sentence, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    /* 先验校验和，数据在链路上出错时直接丢弃 */
    char *star = strchr(buf, '*');
    if (!star) return -1;

    int checksum;
    sscanf(star + 1, "%2x", &checksum);
    *star = '\0';
    if (nmea_checksum(buf + 1) != checksum) return -1;

    /* 按逗号切字段 */
    char *token = strtok(buf, ",");
    if (!token || strcmp(token, "$GPGGA") != 0) return -1;

    strtok(NULL, ",");                          /* UTC 时间，本例不用 */
    char *lat_str  = strtok(NULL, ",");         /* ddmm.mmmm */
    char *ns       = strtok(NULL, ",");         /* N/S */
    char *lon_str  = strtok(NULL, ",");         /* dddmm.mmmm */
    char *ew       = strtok(NULL, ",");         /* E/W */
    char *fix_str  = strtok(NULL, ",");         /* 定位质量 */
    char *sats_str = strtok(NULL, ",");         /* 卫星数 */

    if (!lat_str || !lon_str || !ns || !ew || !fix_str) return -1;

    *fix_quality    = atoi(fix_str);
    *num_satellites = sats_str ? atoi(sats_str) : 0;

    /* ddmm.mmmm → 十进制度：度 + 分/60 */
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
    const char *device = (argc > 1) ? argv[1] : "/dev/ttyS4";

    printf("Opening GPS device: %s\n", device);
    int fd = setup_uart(device);
    if (fd < 0) return 1;

    printf("Waiting for GPS fix (cold start may take 30-60s)...\n\n");

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

        /* 逐字节组帧：$ 开始，\n 结束；read 不保证按行返回 */
        for (int i = 0; i < n; i++) {
            if (buffer[i] == '$') line_pos = 0;         /* 新语句起点 */
            if (line_pos < (int)sizeof(line) - 1) line[line_pos++] = buffer[i];

            if (buffer[i] == '\n' && line_pos > 0) {
                line[line_pos] = '\0';

                if (strncmp(line, "$GPGGA", 6) == 0) {
                    double lat, lon;
                    int fix, sats;
                    if (parse_gpgga(line, &lat, &lon, &fix, &sats) == 0) {
                        printf("[Fix=%d, Sats=%2d] Lat=%.6f, Lon=%.6f\n",
                               fix, sats, lat, lon);
                        if (fix == 0) printf("  -> no fix yet, keep waiting\n");
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

三个实现要点：

1. **组帧必须自己做**：`read()` 返回的字节数与 NMEA 行边界无关（可能半行、可能多行），所以逐字节找 `$` 起点和 `\n` 终点。用 `fgets` 按行读串口是新手常见错误。
2. **raw 模式不可省**：少了 `c_iflag` 那一行，数据里的 0x0D 被转成 0x0A、0x11/0x13 被当流控字符吞掉，校验和验证就会间歇性失败。
3. **校验和先行**：先验 XOR 再解析字段，链路毛刺产生的坏帧在第一步就被丢弃，不会污染位置数据。

---

## <span class="blue"> 第六步：编译运行与实测

```bash
${CC} -o gps_parser gps_nmea_parser.c
./gps_parser /dev/ttyS4
```

冷启动实测输出（约 40 秒完成首次定位）：

```
Opening GPS device: /dev/ttyS4
Waiting for GPS fix (cold start may take 30-60s)...

[Fix=0, Sats= 0] Lat=0.000000, Lon=0.000000
  -> no fix yet, keep waiting
[Fix=0, Sats= 3] Lat=0.000000, Lon=0.000000
  -> no fix yet, keep waiting
[Fix=1, Sats= 8] Lat=31.230416, Lon=121.473701
```

卫星数从 0 爬到 3 再到 8、Fix 从 0 跳 1——这个序列就是冷启动搜星过程的可视化。拿到的经纬度可以贴进地图软件验证落点。

---

## <span class="blue"> 联调验证清单

| 步骤 | 验证手段 | 通过标准 |
|------|----------|----------|
| 设备节点 | `dmesg \| grep fe680000`、`ls /dev/ttyS4` | probe 日志存在、节点存在 |
| 原始数据流 | `stty raw` + `cat` | `$GP...` 语句持续滚动 |
| 校验和 | 程序不打印但吞帧（可加计数） | 坏帧率接近 0 |
| 定位状态 | Fix 字段 | 户外 60 s 内 Fix=1 |
| 坐标正确性 | 输出贴进地图 | 落点与实际位置偏差 <50 m |

---

## <span class="blue"> 无硬件路径

没有 GPS 模块也能跑通整个软件链路：socat 建伪终端对，一端循环灌 NMEA 样例文本，解析程序读另一端：

```bash
socat -d -d pty,raw,echo=0,link=/tmp/gps_in pty,raw,echo=0,link=/tmp/gps_out &

# 构造样例数据（含一行故意改坏的校验和）
printf '$GPGGA,123519,4807.038,N,01131.324,E,1,08,0.9,545.4,M,46.9,M,,*47\r\n' > nmea_sample.txt
printf '$GPGGA,123519,4807.038,N,01131.324,E,0,03,0.9,545.4,M,46.9,M,,*42\r\n' >> nmea_sample.txt

# 循环灌入
while true; do cat nmea_sample.txt > /tmp/gps_in; sleep 2; done &

# 解析程序读另一端
./gps_parser /tmp/gps_out
```

PTY 同样走 TTY 子系统，termios 配置、组帧、校验、解析逻辑与真实硬件完全一致——差别只是数据源。第二条语句 Fix=0，可顺便验证"未定位丢弃"的分支逻辑。

---

## <span class="blue"> 方案取舍（Trade-off）

| 维度 | 评价 |
|------|------|
| NMEA 文本协议 | 人类可读、解析简单；代价是带宽浪费，1 Hz 更新率 |
| UBX 二进制协议 | 紧凑、可配置模块（改波特率/更新率/输出语句）；代价是需要 u-blox 协议文档与二进制解析 |
| 用户态轮询读 | 实现最简；代价是 CPU 占用与延迟，高频数据建议 `poll()`/`epoll` 阻塞等待 |
| gpsd 守护进程 | 成熟方案，统一接口、支持热插拔与 PPS 对时；代价是引入系统服务，学习协议本身的环节被封装掉 |

---

## <span class="blue"> 常见陷阱

> ⚠️ 室内调试等不到定位：GPS 信号穿不过钢筋混凝土。现象是 Sats 一直 0~2、Fix 恒 0——不是代码问题。模块放窗边或引出天线。

> ⚠️ 忘记 raw 模式：间歇性校验和失败、偶发字段错位，查半天以为是天线问题。`stty -a` 输出里看到 `icrnl` `ixon` 就是没开 raw。

> ⚠️ 用 read 返回值当行边界：一次 read 拿到半行就解析，字段错乱。必须按 `$`/`\n` 自行组帧。

> ⚠️ 拿 ddmm.mmmm 当十进制度：`4807.038` 直接当 48.07038 度，位置偏差几十公里。先拆分度与分。

> ⚠️ 程序里硬编码波特率 115200：NEO-6M 默认 9600，cat 全是乱码。UART 设备第一动作永远是查手册默认波特率（B-B.5.1 排查锚点）。

---

## <span class="blue"> 动手练习

1. **校验和破坏实验**：无硬件路径中故意把样例语句改一个字符不重算校验和，确认程序正确丢弃该帧。
2. **GPRMC 扩展**：给程序增加 `$GPRMC` 解析，输出速度与航向（字段 7、8）。
3. **poll 改造**：把轮询 `read` 改为 `poll()` 阻塞等待，对比 CPU 占用。
4. **断电重啟对比**：记录冷启动与热启动（断电 1 分钟内重上电）的 TTFF 差异，理解星历备份的作用。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 硬件 | 交叉接线、共地、电平匹配；uart4 设备树使能 |
| 工具验证 | stty raw + cat 先看到 `$GP` 流再写代码 |
| NMEA | `$GPGGA` 字段布局；ddmm.mmmm 坐标换算；Fix 质量字段先行判断 |
| termios | 9600 8N1 + raw 的标志位组合；VMIN/VTIME 语义 |
| 解析 | 自行组帧（$/\n）、XOR 校验先行、strtok 切字段 |
| 调试 | TTFF 冷启动耐心；乱码回 B-B.5.1 波特率锚点 |

---

## <span class="blue"> 配套资源

- **u-blox 文档**：《NEO-6 Data Sheet》《u-blox 6 Receiver Description》（NMEA/UBX 协议全集）
- **协议规范**：NMEA 0183 v4.x
- **工具**：socat（无硬件模拟）、gpsd/gpsmon（成熟方案对照）、GPSTest（手机 App 交叉验证定位）
- **内核文档**：`Documentation/driver-api/tty.rst`

---

## <span class="blue"> 下一步

UART 板块至此完整收口：物理层（4.1）→ 驱动与调试（4.2）→ RS-485/Modbus（4.3）→ 本实战。接下来 **B-B.6 I3C** 看低速传感器总线的现代化演进——同样两根线，12.5 MHz、带内中断、动态地址分配，I2C 的正式接班人。

> 💡 螺旋衔接：本篇的 termios 编程模型会在 B-C 板块的 CAN（SocketCAN 的 socket 模型）与 B-E 综合实战中对照重现——Linux 对每类总线都给了一套"open-配置-读写"的用户态范式；poll/epoll 阻塞读与 D 扩展驱动专题的阻塞 IO 实现（等待队列）互为表里；GPS 的 PPS 对时能力在精密授时场景与 NTP/PTP（B-C 网络时间协议）衔接。
