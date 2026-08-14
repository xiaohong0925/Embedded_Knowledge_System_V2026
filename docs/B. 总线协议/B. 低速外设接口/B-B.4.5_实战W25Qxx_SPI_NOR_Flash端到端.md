# B-B.4.5 实战：W25Qxx SPI NOR Flash 端到端

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线
>
> 难度：[I] Intermediate | 预计阅读时间：40 分钟

## <span class="blue"> 本节导读

本篇把 SPI 板块前四篇压进一个真实器件：W25Q128 NOR Flash。它是嵌入式系统里最经典的 SPI 器件——Bootloader、内核、设备树常常就烧在它里面。主线与 AT24C02 实战（B-B.3.5）同构：读手册 → 接线与设备树 → **现成驱动路径（spi-nor → MTD，这是正解）** → 底层协议验证（spidev 读 JEDEC ID）→ 两个经典坑实测（先擦后写、页边界）。

本节覆盖：W25Q128 手册要点提取、接线原理图与设备树（含 MTD 分区）、spi-nor/MTD 烧录校验全流程、spidev 底层读写验证、NOR Flash"只能 1→0"物理特性的实测。

---

## <span class="blue"> 第一步：读手册

W25Q128JV 手册（Winbond）需要提取的工程要点：

| 要点 | 参数 | 工程含义 |
|------|------|----------|
| 容量 | 128 Mbit = 16 MB | 24 位地址（3 字节） |
| JEDEC ID | 0xEF 0x40 0x18 | 厂商 Winbond / 容量 128Mbit，验证型号用 |
| 页（Page） | 256 字节 | Page Program 一次最多 256 字节，跨页回卷 |
| 扇区（Sector） | 4 KB | 最小擦除单位（0x20）；还有 32K/64K 块擦除 |
| 写物理特性 | 编程只能 1→0 | **写前必须先擦除**（擦除把全位置 1） |
| 模式 | Mode 0 / Mode 3 | 设备树不写模式属性即 Mode 0 |
| 速率 | 标准读 50 MHz，Fast Read 104 MHz | 设备树 spi-max-frequency 依此与走线定 |

核心命令（帧结构回看 B-B.4.2 三段式）：

| 命令 | 名称 | 帧结构 |
|------|------|--------|
| 0x9F | JEDEC ID | 命令 → 读 3 字节 |
| 0x06 | Write Enable | 单命令，写/擦除前必发 |
| 0x05 | Read Status Reg1 | bit0 = WIP 忙标志 |
| 0x03 | Read Data | 命令 + 3 字节地址 → 连读 |
| 0x02 | Page Program | 命令 + 3 字节地址 + ≤256 字节 |
| 0x20 | Sector Erase | 命令 + 3 字节地址 → 等 WIP 清零 |

---

## <span class="blue"> 第二步：接线与设备树

### 接线

<svg viewBox="0 0 830 390" xmlns="http://www.w3.org/2000/svg" style="max-width:830px;width:100%;height:auto" font-family="sans-serif" font-size="13" stroke="currentColor" fill="none" stroke-width="1.5">
<rect x="60" y="70" width="170" height="280" stroke-width="2"/>
<text x="145" y="94" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">RK3568</text>
<line x1="230" y1="120" x2="260" y2="120"/>
<text x="222" y="124" text-anchor="end" fill="currentColor" stroke="none">SPI1_CS0</text>
<line x1="230" y1="160" x2="260" y2="160"/>
<text x="222" y="164" text-anchor="end" fill="currentColor" stroke="none">SPI1_MISO</text>
<line x1="230" y1="200" x2="260" y2="200"/>
<text x="222" y="204" text-anchor="end" fill="currentColor" stroke="none">SPI1_MOSI</text>
<line x1="230" y1="240" x2="260" y2="240"/>
<text x="222" y="244" text-anchor="end" fill="currentColor" stroke="none">SPI1_SCLK</text>
<line x1="100" y1="350" x2="100" y2="366"/>
<text x="100" y="382" text-anchor="middle" fill="currentColor" stroke="none">3V3</text>
<line x1="170" y1="350" x2="170" y2="362"/>
<line x1="158" y1="362" x2="182" y2="362"/>
<line x1="162" y1="368" x2="178" y2="368"/>
<line x1="166" y1="374" x2="174" y2="374"/>
<rect x="520" y="70" width="180" height="280" stroke-width="2"/>
<text x="610" y="94" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">W25Q128（SOIC-8）</text>
<line x1="520" y1="120" x2="490" y2="120"/>
<text x="532" y="124" text-anchor="start" fill="currentColor" stroke="none">CS#（引脚 1）</text>
<line x1="520" y1="160" x2="490" y2="160"/>
<text x="532" y="164" text-anchor="start" fill="currentColor" stroke="none">DO/MISO（引脚 2）</text>
<line x1="520" y1="200" x2="490" y2="200"/>
<text x="532" y="204" text-anchor="start" fill="currentColor" stroke="none">DI/MOSI（引脚 5）</text>
<line x1="520" y1="240" x2="490" y2="240"/>
<text x="532" y="244" text-anchor="start" fill="currentColor" stroke="none">CLK（引脚 6）</text>
<line x1="700" y1="120" x2="730" y2="120"/>
<text x="688" y="124" text-anchor="end" fill="currentColor" stroke="none">VCC（引脚 8）</text>
<line x1="700" y1="160" x2="730" y2="160"/>
<text x="688" y="164" text-anchor="end" fill="currentColor" stroke="none">WP#（引脚 3）</text>
<line x1="700" y1="200" x2="730" y2="200"/>
<text x="688" y="204" text-anchor="end" fill="currentColor" stroke="none">HOLD#（引脚 7）</text>
<line x1="700" y1="240" x2="730" y2="240"/>
<text x="688" y="244" text-anchor="end" fill="currentColor" stroke="none">GND（引脚 4）</text>
<line x1="260" y1="120" x2="490" y2="120" stroke-width="2"/>
<text x="375" y="112" text-anchor="middle" fill="currentColor" stroke="none">CS</text>
<line x1="260" y1="160" x2="490" y2="160" stroke-width="2"/>
<text x="375" y="152" text-anchor="middle" fill="currentColor" stroke="none">MISO</text>
<line x1="260" y1="200" x2="490" y2="200" stroke-width="2"/>
<text x="375" y="192" text-anchor="middle" fill="currentColor" stroke="none">MOSI</text>
<line x1="260" y1="240" x2="490" y2="240" stroke-width="2"/>
<text x="375" y="232" text-anchor="middle" fill="currentColor" stroke="none">SCLK</text>
<line x1="730" y1="120" x2="760" y2="120"/>
<text x="766" y="124" text-anchor="start" fill="currentColor" stroke="none">3.3V</text>
<line x1="730" y1="160" x2="755" y2="160"/>
<path d="M 755 160 L 755 152 L 749 146 L 761 138 L 749 130 L 761 122 L 749 116 L 755 110 L 755 104"/>
<text x="767" y="136" text-anchor="start" fill="currentColor" stroke="none">10 kΩ</text>
<text x="755" y="96" text-anchor="middle" fill="currentColor" stroke="none">3.3V</text>
<line x1="730" y1="200" x2="795" y2="200"/>
<path d="M 795 200 L 795 192 L 789 186 L 801 178 L 789 170 L 801 162 L 789 156 L 795 150 L 795 144"/>
<text x="807" y="176" text-anchor="start" fill="currentColor" stroke="none">10 kΩ</text>
<text x="795" y="136" text-anchor="middle" fill="currentColor" stroke="none">3.3V</text>
<line x1="730" y1="240" x2="760" y2="240"/>
<line x1="760" y1="240" x2="760" y2="252"/>
<line x1="748" y1="252" x2="772" y2="252"/>
<line x1="752" y1="258" x2="768" y2="258"/>
<line x1="756" y1="264" x2="764" y2="264"/>
</svg>

要点：标准 SPI 模式下 WP# 与 HOLD# 必须上拉（10 kΩ 到 3.3 V）——WP# 低电平会写保护状态寄存器，HOLD# 低电平会暂停通信，两个引脚悬空是"偶发失败"的经典来源；四根信号线推挽直连，无需上拉（B-B.4.1）；3.3V/GND 共地供电。

### 设备树（板级 dts）

```dts
&spi1 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi1m0_cs0 &spi1m0_pins>;

    flash@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;                          /* 片选 0 */
        spi-max-frequency = <50000000>;
        m25p,fast-read;                     /* 支持 0x0B Fast Read */

        partitions {                        /* MTD 分区表（可选） */
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;

            partition@0 {
                label = "uboot";
                reg = <0x0 0x100000>;       /* 1 MB */
                read-only;
            };
            partition@100000 {
                label = "kernel";
                reg = <0x100000 0x800000>;  /* 8 MB */
            };
            partition@900000 {
                label = "rootfs";
                reg = <0x900000 0x700000>;  /* 7 MB */
            };
        };
    };
};
```

---

## <span class="blue"> 第三步：spi-nor → MTD 路径（正解）

内核 `spi-nor` 子系统认识全部主流 NOR Flash，设备树匹配后自动注册为 MTD 设备。**不用写任何驱动。**

### 验证识别

```bash
dmesg | grep -i spi
# spi-nor spi1.0: w25q128 (16384 Kbytes)
# 3 fixed-partitions partitions found on MTD device spi1.0

cat /proc/mtd
# mtd0: 00100000 00001000 "uboot"
# mtd1: 00800000 00001000 "kernel"
# mtd2: 00700000 00001000 "rootfs"
```

### 烧录与校验

```bash
# 读原始内容
hexdump -C /dev/mtd1 | head

# 烧录内核镜像（flashcp = 擦除 + 写入 + 校验一把梭）
flashcp -v zImage /dev/mtd1

# 整分区擦除
flash_erase /dev/mtd2 0 0

# 精确读取校验
mtd_debug read /dev/mtd1 0 4096 /tmp/readback.bin
md5sum zImage /tmp/readback.bin
```

`flashcp` 内部完成了"擦除→编程→回读比对"三步——第四步会看到这三步在协议层的真实形态。

---

## <span class="blue"> 第四步：底层验证（spidev 读 JEDEC ID）

框架之下，spi-nor 做的就是把 B-B.4.2 的帧发到总线上。用 spidev 绕过框架直接发命令，验证理解（需设备树挂 spidev 节点，或临时解绑 spi-nor 后用 `SPI_IOC`）：

```c
/* w25q_id.c — spidev 读 W25Q128 JEDEC ID 与状态寄存器 */
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/spi/spidev.h>

static int xfer(int fd, unsigned char *tx, unsigned char *rx, int len)
{
    struct spi_ioc_transfer tr = {
        .tx_buf = (unsigned long)tx,
        .rx_buf = (unsigned long)rx,
        .len = len,
    };
    return ioctl(fd, SPI_IOC_MESSAGE(1), &tr);
}

int main(void)
{
    int fd = open("/dev/spidev1.0", O_RDWR);
    if (fd < 0) { perror("open"); return 1; }

    unsigned char mode = SPI_MODE_0, bits = 8;
    unsigned int speed = 10000000;
    ioctl(fd, SPI_IOC_WR_MODE, &mode);
    ioctl(fd, SPI_IOC_WR_BITS_PER_WORD, &bits);
    ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed);

    /* 0x9F JEDEC ID：1 字节命令 + 3 字节读（全双工同帧） */
    unsigned char tx[4] = { 0x9F, 0, 0, 0 }, rx[4] = { 0 };
    xfer(fd, tx, rx, 4);
    printf("JEDEC ID: %02X %02X %02X  %s\n", rx[1], rx[2], rx[3],
           (rx[1] == 0xEF && rx[3] == 0x18) ? "(W25Q128JV OK)" : "(型号不符!)");

    /* 0x05 状态寄存器：bit0 WIP 应为 0（空闲） */
    unsigned char tx2[2] = { 0x05, 0 }, rx2[2] = { 0 };
    xfer(fd, tx2, rx2, 2);
    printf("Status Reg1: 0x%02X (WIP=%d)\n", rx2[1], rx2[1] & 1);

    close(fd);
    return 0;
}
```

```bash
aarch64-linux-gnu-gcc -o w25q_id w25q_id.c
./w25q_id
# JEDEC ID: EF 40 18  (W25Q128JV OK)
# Status Reg1: 0x00 (WIP=0)
```

帧级对照：`tx` 数组前 1 字节是命令、后 3 字节是占位时钟——SPI 全双工，"读 3 字节"就是"边发 3 个无关字节边收 3 字节"，这正是 B-B.4.2 三段式帧在代码里的样子。

---

## <span class="blue"> 第五步：实测两个经典坑

### 坑一：写前不擦除

NOR Flash 编程只能把位从 1 写成 0。对已含 0x00 的区域直接写入 0xFF，结果仍是 0x00——**无报错，数据静默不变**。

实测：向某扇区写入 0xAA，不擦除直接改写成 0x55，读回——得到的不是 0x55 而是 `0xAA & 0x55 = 0x00`。位与关系验证了"只能 1→0"。正确流程永远是：**Write Enable → Sector Erase → 等 WIP → Page Program → 等 WIP**。

### 坑二：页边界回卷

与 AT24C02 同构（B-B.4.2 已预告）：从地址 0x00F0 起 Page Program 32 字节，前 16 字节落在 0xF0~0xFF，后 16 字节回卷到页首 0x00~0x0F。spi-nor 驱动按 256 字节切分所以框架路径不会踩；自己发命令时必须切分。

---

## <span class="blue"> 联调验证清单

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 核 WP#/HOLD# 上拉、四线连接 | 万用表通断确认 |
| 2 | `dmesg \| grep spi-nor` | 报 `w25q128 (16384 Kbytes)` |
| 3 | spidev 读 JEDEC ID | `EF 40 18` |
| 4 | `flashcp -v` 烧录测试文件 | 校验通过 |
| 5 | 回读 md5 比对 | 一致 |
| 6 | 不擦除改写实测 | 观察到位与现象 |
| 7 | 跨页写入实测 | 观察到回卷覆盖 |

---

## <span class="blue"> 无硬件路径

1. 阅读内核 `drivers/mtd/spi-nor/` 中 winbond.c 的 W25Q128 参数表与 core.c 的 probe 路径，理解 JEDEC ID 如何匹配到参数。
2. 手推三笔操作的完整帧序列：读 ID（0x9F）、扇区擦除（0x20）、页编程（0x02），标注每笔的 CS 边界与字节数。

---

## <span class="blue"> 方案取舍（Trade-off）

| 维度 | 评价 |
|------|------|
| spi-nor/MTD 路径 | 零驱动、分区/烧录工具链完整；代价是框架抽象掉协议细节（本篇第四步补回） |
| spidev 直发命令 | 协议级可控、验证直接；代价是一切自己管（WIP 轮询、页切分、先擦后写） |
| NOR Flash 存固件 | XIP 可读执行、可靠性高；代价是写慢（ms 级）、擦除粒度 4 KB |
| 分区表写死 dts | 简单稳定；代价是改分区要改设备树，量产可用 U-Boot 环境变量方案 |

---

## <span class="blue"> 常见陷阱

> ⚠️ WP#/HOLD# 悬空。电平漂移到有效电平即写保护/通信暂停，表现为偶发失败。固定上拉。

> ⚠️ 写前不擦除。无报错、数据不变或位与混叠，最隐蔽的 Flash 错误。流程铁律：WE → Erase → WIP → Program → WIP。

> ⚠️ 跨页编程不切分。回卷覆盖页首，静默损坏。

> ⚠️ 不等 WIP 就发下一笔。内部擦写期间器件忽略命令，操作丢失。每笔写/擦除后查状态寄存器 bit0。

> ⚠️ spi-max-frequency 照抄 104 MHz。那是 Fast Read 上限且假定良好布线；飞线环境先 10 MHz 验证（B-B.4.4 三原则）。

---

## <span class="blue"> 动手练习

1. **ID 验证**：编译运行本篇程序，读 JEDEC ID 与状态寄存器；把命令换成 0x90（Read Manufacturer/Device ID）对比返回差异。
2. **位与实测**：spidev 或 mtd_debug 完成"写 0xAA → 不擦除写 0x55 → 读回"实验，验证 1→0 约束。
3. **烧录全流程**：`flash_erase` + `flashcp` + 回读 md5，把一个小文件落进空闲分区。
4. **无硬件后备**：在 W25Q128JV 手册指令表中找到 0x0B Fast Read 的 dummy 字节定义，画出它与 0x03 标准读的帧差异。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 手册要点 | 16 MB/页 256B/扇区 4KB/JEDEC 0xEF4018 |
| 接线 | WP#/HOLD# 必上拉；四线推挽直连 |
| MTD 路径 | dmesg 识别、/proc/mtd、flashcp/flash_erase |
| 底层帧 | 0x9F/0x05 的 spidev 帧级理解（全双工占位字节） |
| 两个坑 | 先擦后写（位与实测）、页边界回卷 |
| 排障 | 全流程可回 B-B.4.4 三原则 |

---

## <span class="blue"> 配套资源

- **手册**：Winbond W25Q128JV datasheet（指令表 + AC 特性）
- **内核源码**：`drivers/mtd/spi-nor/`（core.c、winbond.c）
- **工具**：mtd-utils（flashcp/flash_erase/mtd_debug）、spidev_test

---

## <span class="blue"> 下一步

SPI 板块闭环：物理层（3.1）→ 协议层（3.2）→ 驱动框架（3.3）→ 调试选型（3.4）→ 实战（3.5）。下一条总线是 **B-B.5 UART**：没有时钟线的异步串行——物理层与波特率误差（4.1）、Linux TTY 与串口调试（4.2）、RS-485 与 Modbus（4.3），实战篇用 GPS 模块走通数据解析（4.4）。

> 💡 螺旋衔接：本篇与 B-B.3.5 AT24C02 是"同一方法论、两条总线"的对照组——手册→设备树→现成驱动→底层验证→经典坑，两篇的结构一致性就是这套方法论的可迁移性证据。帧结构细节在 B-B.4.2；MTD 与文件系统的关系留待第 12 章。
