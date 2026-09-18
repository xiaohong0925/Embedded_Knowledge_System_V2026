# B-B.3.5 实战：AT24C02 EEPROM 端到端读写

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[I] Intermediate | 预计阅读时间：40 分钟

## <span class="blue"> 本节导读

本篇把 I2C 板块前四篇的知识压进一个真实器件：AT24C02 EEPROM。从读手册提取时序要点开始，经设备树配置，分别走通两条软件路径——内核 at24 驱动的 sysfs 接口（多数场景的正解）、用户态 `/dev/i2c` 直读写（无驱动场景的原型手段）——最后实测两个经典坑：写周期与页边界。

选择 AT24C02 的原因：它是 I2C 器件里手册最薄、时序最标准的一个，同时又覆盖了"寄存器寻址、页写、写等待"这三类绝大多数 I2C 器件共有的行为。吃透它，换任何 I2C 传感器都只是换寄存器表。

本节覆盖：AT24C02 手册要点提取、设备树与内核 at24 驱动、sysfs 读写路径、`/dev/i2c` 用户态完整程序、写周期 5 ms 与页边界回卷的实测验证。

---

## <span class="blue"> 第一步：读手册

打开 AT24C02 数据手册（Microchip/Atmel），工程上需要提取的要点只有一页：

| 要点 | 参数 | 工程含义 |
|------|------|----------|
| 容量 | 2 Kbit = 256 字节 | 字节地址 0x00~0xFF，1 字节内存地址 |
| 器件地址 | `1010 A2 A1 A0` | 7 位地址 0x50~0x57，A0~A2 引脚决定 |
| 页大小 | 16 字节 | 一次页写最多 16 字节，**不得跨页** |
| 写周期 t_WR | 最大 5 ms | 写操作后器件进入内部擦写，期间 NACK 一切访问 |
| 读模式 | 当前地址读 / 随机读 / 顺序读 | 随机读 = 哑写定位 + Repeated START 读 |
| 速率 | 100 kHz / 400 kHz | 全兼容 Fast-mode |

两个帧序列是全部软件的基础（帧格式细节回看 B-B.3.2）：

```
字节写：[S][Dev+W][A][MemAddr][A][Data][A][P] → 等待 t_WR
随机读：[S][Dev+W][A][MemAddr][A][Sr][Dev+R][A][Data][N][P]
         └──── 哑写：定位内存地址 ────┘ └──── 读数据 ────┘
```

---

## <span class="blue"> 第二步：硬件接线与设备树

### 接线

<svg viewBox="0 0 800 345" xmlns="http://www.w3.org/2000/svg" style="max-width:800px;width:100%;height:auto" font-family="sans-serif" font-size="13" stroke="currentColor" fill="none" stroke-width="1.5">
<line x1="300" y1="55" x2="430" y2="55" stroke-width="2"/>
<text x="365" y="44" text-anchor="middle" fill="currentColor" stroke="none">3.3V</text>
<path d="M 300 190 L 300 152 A 9 9 0 0 1 300 128 L 300 122 L 293 114 L 307 106 L 293 98 L 307 90 L 293 82 L 307 74 L 300 66 L 300 55"/>
<text x="286" y="102" text-anchor="end" fill="currentColor" stroke="none">4.7 kΩ</text>
<path d="M 430 140 L 430 126 L 423 118 L 437 110 L 423 102 L 437 94 L 423 86 L 437 78 L 430 70 L 430 55"/>
<text x="444" y="102" text-anchor="start" fill="currentColor" stroke="none">4.7 kΩ</text>
<rect x="60" y="80" width="170" height="230" stroke-width="2"/>
<text x="145" y="106" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">RK3568</text>
<line x1="230" y1="140" x2="260" y2="140"/>
<text x="222" y="144" text-anchor="end" fill="currentColor" stroke="none">I2C1_SDA</text>
<line x1="230" y1="190" x2="260" y2="190"/>
<text x="222" y="194" text-anchor="end" fill="currentColor" stroke="none">I2C1_SCL</text>
<line x1="230" y1="240" x2="260" y2="240"/>
<text x="222" y="244" text-anchor="end" fill="currentColor" stroke="none">3V3</text>
<line x1="230" y1="290" x2="260" y2="290"/>
<text x="222" y="294" text-anchor="end" fill="currentColor" stroke="none">GND</text>
<rect x="520" y="80" width="170" height="230" stroke-width="2"/>
<text x="605" y="106" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">AT24C02</text>
<line x1="520" y1="140" x2="490" y2="140"/>
<text x="532" y="144" text-anchor="start" fill="currentColor" stroke="none">SDA（引脚 5）</text>
<line x1="520" y1="190" x2="490" y2="190"/>
<text x="532" y="194" text-anchor="start" fill="currentColor" stroke="none">SCL（引脚 6）</text>
<line x1="520" y1="240" x2="490" y2="240"/>
<text x="532" y="244" text-anchor="start" fill="currentColor" stroke="none">VCC（引脚 8）</text>
<line x1="520" y1="290" x2="490" y2="290"/>
<text x="532" y="294" text-anchor="start" fill="currentColor" stroke="none">GND（引脚 4）</text>
<line x1="690" y1="140" x2="720" y2="140"/>
<text x="678" y="144" text-anchor="end" fill="currentColor" stroke="none">A0（引脚 1）</text>
<line x1="690" y1="184" x2="720" y2="184"/>
<text x="678" y="188" text-anchor="end" fill="currentColor" stroke="none">A1（引脚 2）</text>
<line x1="690" y1="224" x2="720" y2="224"/>
<text x="678" y="228" text-anchor="end" fill="currentColor" stroke="none">A2（引脚 3）</text>
<line x1="690" y1="264" x2="720" y2="264"/>
<text x="678" y="268" text-anchor="end" fill="currentColor" stroke="none">WP（引脚 7）</text>
<line x1="260" y1="140" x2="490" y2="140" stroke-width="2"/>
<text x="385" y="132" text-anchor="middle" fill="currentColor" stroke="none">SDA</text>
<line x1="260" y1="190" x2="490" y2="190" stroke-width="2"/>
<text x="360" y="182" text-anchor="middle" fill="currentColor" stroke="none">SCL</text>
<line x1="260" y1="240" x2="490" y2="240" stroke-width="2"/>
<text x="375" y="232" text-anchor="middle" fill="currentColor" stroke="none">3.3V</text>
<line x1="260" y1="290" x2="490" y2="290" stroke-width="2"/>
<circle cx="300" cy="190" r="3" fill="currentColor" stroke="none"/>
<circle cx="430" cy="140" r="3" fill="currentColor" stroke="none"/>
<line x1="375" y1="290" x2="375" y2="302"/>
<line x1="363" y1="302" x2="387" y2="302"/>
<line x1="367" y1="308" x2="383" y2="308"/>
<line x1="371" y1="314" x2="379" y2="314"/>
<line x1="720" y1="140" x2="750" y2="140"/>
<line x1="720" y1="184" x2="750" y2="184"/>
<line x1="720" y1="224" x2="750" y2="224"/>
<line x1="720" y1="264" x2="750" y2="264"/>
<line x1="750" y1="140" x2="750" y2="308"/>
<circle cx="750" cy="140" r="3" fill="currentColor" stroke="none"/>
<circle cx="750" cy="184" r="3" fill="currentColor" stroke="none"/>
<circle cx="750" cy="224" r="3" fill="currentColor" stroke="none"/>
<circle cx="750" cy="264" r="3" fill="currentColor" stroke="none"/>
<line x1="738" y1="308" x2="762" y2="308"/>
<line x1="742" y1="314" x2="758" y2="314"/>
<line x1="746" y1="320" x2="754" y2="320"/>
<text x="768" y="316" text-anchor="start" fill="currentColor" stroke="none">GND</text>
</svg>

要点：A0~A2 全接地 → 7 位地址 0x50；WP 接地 = 允许写入，接高电平则整片只读；SDA/SCL 各经 4.7 kΩ 上拉到 3.3 V（开漏必需，回看 B-B.3.1）。

### 设备树（板级 dts）

```dts
&i2c1 {
    status = "okay";
    clock-frequency = <400000>;

    eeprom@50 {
        compatible = "atmel,24c02";
        reg = <0x50>;
        pagesize = <16>;        /* at24 驱动按此限制单次写入跨度 */
    };
};
```

`pagesize` 不是可选项——at24 驱动靠它把用户的大块写入切成不跨页的多次页写。

---

## <span class="blue"> 第三步：路径一——内核 at24 驱动（正解）

AT24C 全系列在内核里有现成驱动 `drivers/misc/eeprom/at24.c`。**这是本实战最重要的教学点：标准 EEPROM 不需要自己写驱动**，设备树 `compatible` 匹配成功后，驱动把 EEPROM 导出为 sysfs 二进制文件。

### 验证绑定

```bash
ls /sys/bus/i2c/devices/1-0050/
# 应有 eeprom 文件；此时 i2cdetect 在 0x50 显示 UU（驱动已占用）

cat /sys/bus/i2c/devices/1-0050/name
# at24 或 24c02
```

### 读写测试

```bash
# 读全部 256 字节
hexdump -C /sys/bus/i2c/devices/1-0050/eeprom

# 写入（dd 指定偏移，if 为数据文件）
echo -n "Hello-EEPROM" > /tmp/data.bin
dd if=/tmp/data.bin of=/sys/bus/i2c/devices/1-0050/eeprom bs=1 seek=32

# 读回验证
dd if=/sys/bus/i2c/devices/1-0050/eeprom bs=1 skip=32 count=12 | hexdump -C
```

at24 驱动在内部处理了写周期等待与页边界切分——这就是"用现成驱动"省掉的全部工作量。

---

## <span class="blue"> 第四步：路径二——用户态 /dev/i2c 直读写

没有内核驱动（或评估新器件）时，用 `/dev/i2c-1` 直接收发。**注意与路径一互斥**：at24 已绑定时需先解绑。

```bash
echo 1-0050 > /sys/bus/i2c/drivers/at24/unbind    # 解绑内核驱动
i2cdetect -y -r 1                                  # 0x50 从 UU 变回 50
```

### 完整程序

```c
/* at24c02_rw.c — 用户态通过 /dev/i2c 读写 AT24C02 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <linux/i2c.h>
#include <linux/i2c-dev.h>

#define DEV_ADDR    0x50
#define PAGE_SIZE   16
#define WRITE_CYCLE_US  5000    /* t_WR 上限 5ms */

/* 随机读：哑写定位 + Repeated START 读（对应 B-B.3.2 复合消息） */
static int at24_read(int fd, unsigned char mem_addr,
                     unsigned char *buf, int len)
{
    struct i2c_msg msgs[2];
    struct i2c_rdwr_ioctl_data rdwr;

    msgs[0].addr  = DEV_ADDR;       /* msg1：写内存地址（哑写） */
    msgs[0].flags = 0;
    msgs[0].len   = 1;
    msgs[0].buf   = &mem_addr;

    msgs[1].addr  = DEV_ADDR;       /* msg2：读数据 */
    msgs[1].flags = I2C_M_RD;
    msgs[1].len   = len;
    msgs[1].buf   = buf;

    rdwr.msgs  = msgs;
    rdwr.nmsgs = 2;
    /* 两 msg 间由内核生成 Repeated START，无 STOP */
    return ioctl(fd, I2C_RDWR, &rdwr) == 2 ? 0 : -1;
}

/* 页写：单页内写入，随后等待写周期 */
static int at24_write_page(int fd, unsigned char mem_addr,
                           const unsigned char *data, int len)
{
    unsigned char buf[PAGE_SIZE + 1];
    buf[0] = mem_addr;              /* 首字节 = 内存地址 */
    memcpy(buf + 1, data, len);

    if (write(fd, buf, len + 1) != len + 1)
        return -1;

    usleep(WRITE_CYCLE_US);         /* 等待内部擦写完成 */
    return 0;
}

int main(int argc, char *argv[])
{
    const char *bus = "/dev/i2c-1";
    unsigned char wbuf[] = "Hello-EEPROM";
    unsigned char rbuf[sizeof(wbuf)];
    int fd, ret = 1;

    fd = open(bus, O_RDWR);
    if (fd < 0) { perror("open"); return 1; }

    if (ioctl(fd, I2C_SLAVE, DEV_ADDR) < 0) {
        perror("I2C_SLAVE");        /* 若报 EBUSY：内核驱动未解绑 */
        goto out;
    }

    /* 跨页写入循环：写周期等待 + 页边界切分，两大经典坑都在这里 */
    int written = 0, total = sizeof(wbuf);
    unsigned char addr = 32;        /* 从内存地址 32 开始写 */
    while (written < total) {
        int page_off  = (addr + written) % PAGE_SIZE;
        int chunk = PAGE_SIZE - page_off;             /* 本页剩余 */
        if (chunk > total - written)
            chunk = total - written;

        if (at24_write_page(fd, addr + written, wbuf + written, chunk) < 0) {
            perror("write_page");
            goto out;
        }
        written += chunk;
    }

    memset(rbuf, 0, sizeof(rbuf));
    if (at24_read(fd, addr, rbuf, total) < 0) {
        perror("read");
        goto out;
    }

    if (memcmp(wbuf, rbuf, total) == 0) {
        printf("verify OK: %s\n", rbuf);
        ret = 0;
    } else {
        printf("verify FAILED\n");
    }
out:
    close(fd);
    return ret;
}
```

编译与运行：

```bash
aarch64-linux-gnu-gcc -o at24c02_rw at24c02_rw.c    # 交叉编译
scp at24c02_rw root@<板子IP>:/tmp/
# 板子上：
/tmp/at24c02_rw
```

### 程序要点对照

| 代码位置 | 对应手册/协议知识 |
|----------|-------------------|
| `msgs[0]` 哑写内存地址 | 随机读的"定位"阶段（手册 Figure：Random Read） |
| `I2C_RDWR` 两 msg | Repeated START 复合消息（B-B.3.2） |
| `usleep(5000)` | t_WR 写周期：期间器件 NACK 一切访问 |
| 页边界切分循环 | 页写不得跨 16 字节页，跨页回卷到页首覆盖 |

---

## <span class="blue"> 第五步：实测两个经典坑

### 坑一：写周期 t_WR

写入后立刻读（或立刻写下一页），器件处于内部擦写，全部 NACK：

```bash
i2cset -y 1 0x50 0x10 0xAB && i2cget -y 1 0x50 0x10
# 连续执行大概率第二个命令报 "Read failed"
```

对策两种：固定 `usleep(5000)`（简单），或 **ACK 轮询**（手册推荐，更快）——写完后反复发"START + 器件地址 + W"，收到 ACK 即表示擦写完成，通常 1~3 ms 就结束，不必等满 5 ms。

ACK 轮询的用户态实现（利用 `I2C_SLAVE` + 零长度写探测应答）：

```c
/* 写完一页后调用：反复探测直到器件应答（擦写完成）或超时 */
static int at24_wait_ready(int fd)
{
    for (int i = 0; i < 100; i++) {         /* 最多 100×50μs = 5ms 兜底 */
        if (write(fd, NULL, 0) == 0)        /* 零长度写 = 只发地址帧看 ACK */
            return 0;
        usleep(50);
    }
    return -1;                              /* 超时：器件异常 */
}
```

> 💡 `write(fd, NULL, 0)` 在 i2c-dev 下只产生"START + 地址 + W + STOP"，正是手册 ACK Polling 时序的软件落地。内核对它的支持依赖具体 Adapter 的零长度消息处理，个别控制器不支持时退回固定延时。

### 坑二：页边界回卷

AT24C02 页大小 16 字节。从地址 0x0C 开始连续写 8 字节：前 4 字节落在 0x0C~0x0F，后 4 字节**回卷到页首 0x00~0x03**，覆盖旧数据且无声无息。这就是上面程序里页边界切分循环存在的原因——at24 驱动靠 `pagesize` 属性做同样的事。

<!-- 【待补图】images/b-b-3-5-page-wrap.png（优先级：★必要）
图名：AT24C02 页边界回卷示意图
生图提示词：存储布局示意图，上方一排 16 个方格表示一页（页 0：地址 0x00~0x0F，格内标注地址），下方第二排表示页 1（0x10~0x1F）。一条红色箭头从 0x0C 出发：前 4 个箭头落在 0x0C→0x0D→0x0E→0x0F（标注"前 4 字节正常落位"），第 5 个箭头画成弯曲回卷指向页首 0x00（红色高亮，标注"回卷！覆盖 0x00~0x03 旧数据"），0x00~0x03 四个格子用斜纹底纹表示"被覆盖的旧数据"。旁边放一个对比小框：正确做法是把 8 字节切成 4+4 两笔页写，绿色箭头示意两笔分别落在页 0 尾部和页 1 首部。扁平技术插画风，白底，红色警示+绿色正确对比，中文标注，比例 16:9。 -->

读方向有类似行为值得知道：顺序读越过器件末尾 0xFF 后会回卷到 0x00 继续读——这是地址计数器溢出，不是故障，但一次性长读时要心里有数。

验证：跨页写入一段递增值，再 hexdump 全景，观察回卷覆盖现象。

---

## <span class="blue"> 联调验证清单

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 量 SDA/SCL 空闲电平 | ≈3.3 V |
| 2 | `i2cdetect -y -r 1` | 0x50 应答（或 UU） |
| 3 | 加载 at24，`ls /sys/bus/i2c/devices/1-0050/eeprom` | 文件存在 |
| 4 | sysfs 写入 + hexdump 读回 | 数据一致 |
| 5 | 解绑 at24，编译运行用户态程序 | `verify OK` |
| 6 | 跨页写 + 全景 dump | 观察到页边界切分生效（或回卷现象） |
| 7 | 写后立即读 | 复现 NACK，验证写周期处理 |

---

## <span class="blue"> 无硬件路径

1. 通读内核 `drivers/misc/eeprom/at24.c` 的 `at24_write()`：定位页边界切分与写周期等待的实现，与本篇用户态程序逐段对照——同一个器件，内核驱动与裸用户态如何处理相同的两件事。
2. 用 QEMU/虚拟机无 EEPROM 时，改为通读手册 Byte Write / Page Write / Random Read / Sequential Read 四个时序图，手工写出每个的帧序列。

---

## <span class="blue"> 方案取舍（Trade-off）

| 维度 | 评价 |
|------|------|
| 内核 at24 驱动 | 零开发、页边界/写周期全托管、多进程安全；代价是需要设备树与内核配置 |
| /dev/i2c 用户态 | 无驱动依赖、验证快；代价是写周期与页边界要自己处理、无并发保护 |
| ACK 轮询 | 写等待最优（1~3 ms）；代价是多几行代码与总线流量 |
| 固定延时 5 ms | 最简单；代价是吞吐损失（对频繁写场景明显） |
| EEPROM 存参数 | 掉电保存、10 万次擦写寿命；代价是写慢、容量小，频繁更新场景应选 Flash 方案 |

---

## <span class="blue"> 排障速查

| 症状 | 根因 | 定位动作 |
|------|------|----------|
| 数据静默损坏，页首旧数据被覆盖 | 跨页写未切分，回卷覆盖且器件不报错 | 按 pagesize 切分写入；hexdump 全景确认落位 |
| "偶发写失败"，第二笔 NACK | 写后未等写周期，器件内部擦写中 | 固定延时 5 ms 或 ACK 轮询；示波器可看到 NACK |
| 用户态 `I2C_SLAVE` 报 EBUSY | at24 内核驱动已绑定（UU） | 先 `unbind`；不要用 FORCE 与驱动并发读写 |
| 驱动下大块写入仍跨页回卷 | 设备树漏写 `pagesize`，驱动按默认页切分 | 补上 `pagesize = <16>` 与手册核对 |
| 写入偶发失败、无规律 | WP 引脚悬空，电平不确定 | WP 明确接地或接 GPIO 受控 |

---

## <span class="blue"> 本节总结

这个实战的真正主角不是 AT24C02，而是两条软件路径的分工判断：内核已有 at24 驱动时，设备树三行声明换来页边界切分、写周期等待、多进程安全的全托管——标准器件不写驱动是工程正解；`/dev/i2c` 用户态则是新器件评估和原型验证的快速通道，代价是手册里的每个坑都要自己填。判断依据不在技术偏好，在器件有没有现成驱动、产品阶段允不允许依赖内核配置。

两个经典坑值得超出 EEPROM 范围地记住，因为它们是整类 I2C 器件的通病：写周期 NACK 教会你"器件有内部状态机，总线沉默不等于总线空闲"，ACK 轮询是与这类状态机握手的通用手法；页边界回卷教会你"器件手册的限制条件必须在软件里显式处理，器件自己不会报错"。换到 SPI Flash（B-B.4.5）、换到任何带页/扇区结构的存储器件，这两个坑会换个名字再出现一次。

**速查表**

| 项 | 要点 |
|----|------|
| 手册四要素 | 地址（0x50~0x57，A0~A2 决定）、页大小 16B、t_WR ≤5ms、随机读=哑写+Sr |
| 设备树 | `compatible="atmel,24c02"` + `reg=<0x50>` + `pagesize=<16>` 三者缺一不可 |
| 路径一 | at24 驱动 → sysfs `eeprom` 文件；页边界/写周期全托管；UU 表示已绑定 |
| 路径二 | `/dev/i2c` + `I2C_RDWR` 复合消息；先 unbind；坑自己填 |
| 写周期 | 写后 NACK 一切访问；固定 5ms 延时或 ACK 轮询（1~3ms） |
| 页边界 | 写跨页回卷页首静默覆盖；顺序读过 0xFF 回卷 0x00 |
| WP 引脚 | 接地=可写，接高=整片只读，禁止悬空 |

**本节自查**

1. 随机读为什么要"哑写"？它在帧序列里对应哪几拍？
2. 内核已有 at24 驱动时，用户态 `/dev/i2c` 访问前要做什么？为什么？
3. ACK 轮询相比固定 5 ms 延时赢在哪？它的总线流量代价是什么？
4. 从 0x0E 起写 8 字节，数据实际落在哪些地址？
5. 设备树 `pagesize` 漏写会导致什么后果？驱动为什么需要它？
6. 把 AT24C02 换成 W25Qxx SPI Flash，"写周期"和"页边界"两个坑会以什么形式重现？

---

## <span class="blue"> 下一步

I2C 板块到此闭环：物理层（3.1）→ 协议层（3.2）→ 驱动框架（3.3）→ 调试（3.4）→ 实战（3.5）。下一条总线是 **B-B.4 SPI**：同样是板级低速总线的主力，但走全双工、四线、片选的路子——物理层四种模式（4.1）、协议与时序（4.2）、驱动框架（4.3）、调试与选型（4.4），实战篇用 W25Qxx SPI NOR Flash 收尾（4.5）。

> 💡 螺旋衔接：本篇的复合消息正是 B-B.3.2 Repeated START 的代码落地；排查手段全部来自 B-B.3.4 决策树；"compatible 匹配即有现成驱动"的机制回看 B-B.3.3 与第 11 章设备模型。写驱动的完整方法论（如果这个器件没有现成驱动）在 D 扩展驱动专题。
