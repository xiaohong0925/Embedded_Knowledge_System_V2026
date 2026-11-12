# B-B.4.5 实战：W25Qxx SPI NOR Flash 端到端

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线
>
> 难度：[B→I] Beginner → Intermediate | 预计阅读时间：45 分钟

## <span class="blue"> 本节导读

B-B.4.1～B-B.4.4 已经建立 SPI 的物理层、事务帧、Linux 框架和调试方法。本篇完成一条产品路径：**在 RK3568 SPI1＋W25Q128JV-IQ/JQ 的受控环境中，怎样通过 spi-nor→MTD 完成器件识别、专用实验分区烧写、读回校验和恢复，并理解框架怎样处理页边界与擦写忙状态？**

贯穿实例固定为 Mode 0、MSB-first、1 MHz 请求速率。器件身份为 `EF 40 18`，只适用于 IQ/JQ 后缀；IM/JM 后缀的 Device ID 不同。整片容量为 16 MiB，实验只使用末尾 1 MiB 的 `scratch` 分区：

```text
scratch：0xF00000～0xFFFFFF，对应示例中的 /dev/mtd3
正常路径：备份 → flashcp 写入 4 KiB → 回读 → cmp 一致
异常观察：先写全 AA，不擦除再写全 55 → 回读全 00
恢复路径：恢复 scratch 备份 → 回读 → cmp 一致
```

`0xAA & 0x55 = 0x00` 是受控教学推演结果，不是当前板卡实测。uboot、kernel 和 rootfs 在示例中保持只读，不用于任何烧写或擦除实验。

本节覆盖：实验边界、接线与教学分区、JEDEC/SFDP 识别链、MTD 正常烧写、页切分与 BUSY 等待、位与实验及恢复。SPI 帧细节归 B-B.4.2，SPI 对象与 DTB 构建归 B-B.4.3，spidev 底层调试归 B-B.4.4。

## <span class="blue"> 先划定实验边界与正常路径

> NOR Flash：一类可随机读取的非易失性存储器。编程通常只能把位从 1 改为 0，擦除把目标区域恢复为全 1，因此任意覆盖旧数据前通常要先擦除。

<!-- -->

> MTD：Memory Technology Devices，Linux 面向 NOR、NAND 等原始闪存设备的子系统。spi-nor 驱动识别器件后注册 MTD 设备，用户态再通过 `/dev/mtdN` 访问分区。

正常产品路径不需要另写 Flash 协议驱动。DTS 描述接线和分区，spi-nor 读取 JEDEC ID 并取得器件参数，MTD 注册分区，mtd-utils 调用字符接口完成擦写和读回：

```text
jedec,spi-nor
→ spi_nor_probe()
→ spi_nor_scan() 读取 JEDEC ID、解析参数
→ 匹配 w25q128 并注册 16 MiB MTD
→ /proc/mtd 出现 scratch
→ flashcp / mtd_debug
→ spi-nor 执行擦除、页编程、等待和读取
```

JEDEC ID 是器件身份标识。SFDP（Serial Flash Discoverable Parameters，串行 Flash 可发现参数）是器件提供的自描述参数表，驱动可据此取得容量、擦除类型和编程能力，而不是把“所有 SPI Flash”视为同一种器件。

本例只烧写 `scratch`。开始任何破坏性操作前，必须确认 `/proc/mtd` 中的实际设备编号和分区名一致；若目标板的 `scratch` 不是 `/dev/mtd3`，应停止并重新核对，不能照抄设备号。

## <span class="blue"> 从手册提取本次实验真正需要的约束

W25Q128JV 的 16 MiB 地址空间由 256 个 64 KiB 块组成，也可按 4096 个 4 KiB 扇区擦除。页编程每次发送 1～256 字节，若单条命令超过当前页剩余空间，器件会回到页首并覆盖本次已发送的数据。

这些参数对应不同的软件责任：

- **容量与后缀**决定识别答案。IQ/JQ 的 `EF 40 18` 对应 v6.6 `winbond.c` 中的 `w25q128` 项，该项要求解析 SFDP；不能把 `EF 40 18` 用于所有 W25Q128JV 后缀。
- **4 KiB 扇区**决定本例测试文件大小。`flashcp` 会按擦除块向上取整，不能把只读小文件实验写成整片擦除。
- **256 字节页**决定框架的切分方式。spi-nor 按当前地址的页偏移限制每段长度，不需要用户态自行计算每次 Page Program 的页剩余量。
- **BUSY（也常写 WIP）**表示器件内部擦写是否仍在进行。CS 拉高只结束串行命令，不表示内部编程已经完成；spi-nor 会等待器件恢复就绪。
- **速率上限**不是板级推荐值。手册普通 Read Data `0x03` 为 50 MHz，Fast Read 的最高频率随供电档位变化；本例固定 1 MHz 是受控实验配置，不是器件极限。

页编程也不是“每次写一个字节都必须先擦一页”。若目标位只需从 1 改为 0，可以直接编程；需要把 0 恢复为 1，或要任意覆盖旧内容时，才必须擦除相应区域。后文的全 `AA`→全 `55` 实验正是用来区分这两条规则。

## <span class="blue"> 接线与教学分区先服务于同一个实验

### 接线图要同时核对方向、上拉和共同地

下图先沿四根 SPI 信号线核对方向，再看 `/WP`、`/HOLD` 的上拉，最后沿图底部确认 RK3568 与 Flash 使用共同地。它是依据手册绘制的教学接线示意，不是当前板卡的实测原理图；窄屏可在图内横向滚动。

<div style="overflow-x:auto">
<svg viewBox="0 0 900 450" xmlns="http://www.w3.org/2000/svg" style="max-width:800px;width:100%;min-width:700px;height:auto" font-family="sans-serif" font-size="13" stroke="currentColor" fill="none" stroke-width="1.5">
<title>RK3568 SPI1 与 W25Q128JV 的接线、上拉和共同地</title>
<text x="450" y="22" text-anchor="middle" fill="currentColor" stroke="none">教学接线示意，不是实测原理图</text>
<rect x="55" y="55" width="215" height="245" stroke-width="2"/>
<text x="162" y="80" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">RK3568 SPI1</text>
<rect x="600" y="55" width="200" height="245" stroke-width="2"/>
<text x="700" y="80" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">W25Q128JV（SOIC-8）</text>
<line x1="270" y1="105" x2="600" y2="105" stroke-width="2"/>
<text x="260" y="110" text-anchor="end" fill="currentColor" stroke="none">CS0</text>
<text x="610" y="110" fill="currentColor" stroke="none">CS#（引脚 1）</text>
<line x1="270" y1="150" x2="600" y2="150" stroke-width="2"/>
<text x="260" y="155" text-anchor="end" fill="currentColor" stroke="none">MISO</text>
<text x="610" y="155" fill="currentColor" stroke="none">DO（引脚 2）</text>
<line x1="270" y1="195" x2="600" y2="195" stroke-width="2"/>
<text x="260" y="200" text-anchor="end" fill="currentColor" stroke="none">MOSI</text>
<text x="610" y="200" fill="currentColor" stroke="none">DI（引脚 5）</text>
<line x1="270" y1="240" x2="600" y2="240" stroke-width="2"/>
<text x="260" y="245" text-anchor="end" fill="currentColor" stroke="none">SCLK</text>
<text x="610" y="245" fill="currentColor" stroke="none">CLK（引脚 6）</text>
<line x1="800" y1="105" x2="825" y2="105"/>
<line x1="825" y1="105" x2="825" y2="40"/>
<text x="812" y="110" text-anchor="end" fill="currentColor" stroke="none">VCC（8）</text>
<line x1="800" y1="150" x2="845" y2="150"/>
<path d="M 845 150 L 845 132 L 838 124 L 852 114 L 838 104 L 852 94 L 838 84 L 852 74 L 845 66 L 845 40"/>
<text x="812" y="155" text-anchor="end" fill="currentColor" stroke="none">WP#（3）</text>
<text x="858" y="105" fill="currentColor" stroke="none">10 kΩ</text>
<line x1="800" y1="195" x2="885" y2="195"/>
<path d="M 885 195 L 885 172 L 878 164 L 892 154 L 878 144 L 892 134 L 878 124 L 892 114 L 885 106 L 885 40"/>
<text x="812" y="200" text-anchor="end" fill="currentColor" stroke="none">HOLD#（7）</text>
<text x="895" y="145" fill="currentColor" stroke="none" text-anchor="end">10 kΩ</text>
<line x1="825" y1="40" x2="885" y2="40" stroke-width="2"/>
<text x="855" y="32" text-anchor="middle" fill="currentColor" stroke="none">3.3 V</text>
<line x1="800" y1="240" x2="850" y2="240"/>
<text x="812" y="245" text-anchor="end" fill="currentColor" stroke="none">GND（4）</text>
<line x1="162" y1="300" x2="162" y2="390"/>
<line x1="162" y1="390" x2="850" y2="390"/>
<line x1="850" y1="390" x2="850" y2="240"/>
<line x1="470" y1="390" x2="470" y2="402"/>
<line x1="450" y1="402" x2="490" y2="402"/>
<line x1="456" y1="410" x2="484" y2="410"/>
<line x1="463" y1="418" x2="477" y2="418"/>
<text x="505" y="414" fill="currentColor" stroke="none">共同 GND</text>
</svg>
</div>

即使不看图，也要逐项满足：CS 接 `/CS`，MOSI 接 DI，MISO 接 DO，SCLK 接 CLK，双方 GND 相连，VCC 使用器件允许的供电。标准 SPI 下 `/WP` 和 `/HOLD` 不能误落为有效低电平，本例用 10 kΩ 上拉到 3.3 V；阻值是教学示例，不是所有设计的固定答案。启用 Quad 功能后，相关引脚改为 IO2/IO3，不能继续沿用标准 SPI 的引脚解释。

`/WP` 是否锁定状态寄存器还受 SRP/SRL 配置影响，不能笼统理解成拉低就保护全部数据。`/HOLD` 在 CS 有效时拉低会暂停当前通信。排障时应核对实际原理图和状态位，而不是只看到上拉电阻就宣布写路径必然可用。

### 教学 DTS 把可写范围限制在 scratch

下面的板级片段是本篇原创教学配置，不是可独立编译的完整 DTS，也不是当前板卡实测配置。`spi-max-frequency` 为 1 MHz，`m25p,fast-read` 允许选择 `0x0B` 快速读。uboot、kernel 和 rootfs 只读，末尾 1 MiB 作为唯一可写 `scratch`。

```dts
// 板级 DTS 片段；合入实际板级文件后按 B-B.4.3 的 DTB 流程构建。
&spi1 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi1m0_cs0 &spi1m0_pins>;

    flash@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;
        spi-max-frequency = <1000000>;
        m25p,fast-read;

        partitions {
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;

            partition@0 {
                label = "uboot";
                reg = <0x0 0x100000>;
                read-only;
            };
            partition@100000 {
                label = "kernel";
                reg = <0x100000 0x800000>;
                read-only;
            };
            partition@900000 {
                label = "rootfs";
                reg = <0x900000 0x600000>;
                read-only;
            };
            partition@f00000 {
                label = "scratch";
                reg = <0xf00000 0x100000>;
            };
        };
    };
};
```

`reg = <0>` 选择 CS0，不是器件协议地址。`read-only` 给 MTD 分区增加只读约束，不等于硬件块保护，也不能代替备份。实际部署必须确认原理图、现有分区和启动方式；若现有系统占用这些地址，不能直接套用教学布局。

地址图先看整片末尾的 `scratch`，再放大一个 256 字节页。它同时回答“实验写在哪里”和“0x00F0 起写 32 字节为什么跨页”。页内细节为结构示意，不按像素等比例绘制；窄屏可在图内横向滚动。

<div style="overflow-x:auto">
<svg viewBox="0 0 900 380" xmlns="http://www.w3.org/2000/svg" style="max-width:800px;width:100%;min-width:700px;height:auto" font-family="sans-serif" font-size="13" stroke="currentColor" fill="none" stroke-width="1.5">
<title>16 MiB 教学分区与单页边界</title>
<text x="60" y="35" fill="currentColor" stroke="none" font-size="15">整片 16 MiB：只有末尾 1 MiB 可写</text>
<rect x="60" y="60" width="42.5" height="65"/>
<rect x="102.5" y="60" width="340" height="65"/>
<rect x="442.5" y="60" width="255" height="65"/>
<rect x="697.5" y="60" width="42.5" height="65" stroke-width="3"/>
<text x="81" y="96" text-anchor="middle" fill="currentColor" stroke="none">uboot</text>
<text x="272" y="96" text-anchor="middle" fill="currentColor" stroke="none">kernel 8 MiB</text>
<text x="570" y="96" text-anchor="middle" fill="currentColor" stroke="none">rootfs 6 MiB</text>
<text x="718" y="90" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">scratch</text>
<text x="718" y="107" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">1 MiB</text>
<text x="60" y="150" fill="currentColor" stroke="none">0x000000</text>
<text x="740" y="150" text-anchor="end" fill="currentColor" stroke="none">0xFFFFFF</text>
<text x="690" y="180" text-anchor="end" fill="currentColor" stroke="none">0xF00000</text>
<line x1="718" y1="125" x2="718" y2="205" stroke-dasharray="5 4"/>
<path d="M 710 197 L 718 207 L 726 197"/>
<text x="60" y="225" fill="currentColor" stroke="none" font-size="15">放大：0x00F0 起写 32 字节，框架分成两段</text>
<rect x="60" y="250" width="620" height="65"/>
<rect x="680" y="250" width="100" height="65"/>
<rect x="620" y="250" width="60" height="65" stroke-width="3"/>
<rect x="680" y="250" width="60" height="65" stroke-width="3"/>
<text x="340" y="288" text-anchor="middle" fill="currentColor" stroke="none">当前页前 240 字节</text>
<text x="650" y="278" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">16 B</text>
<text x="650" y="297" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">0xF0～FF</text>
<text x="710" y="278" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">16 B</text>
<text x="710" y="297" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">0x00～0F</text>
<text x="60" y="345" fill="currentColor" stroke="none">第一段：当前页尾 16 字节</text>
<text x="420" y="345" fill="currentColor" stroke="none">第二段：下一页首 16 字节</text>
<text x="60" y="370" fill="currentColor" stroke="none">不是把 32 字节作为一条跨页 Page Program 命令交给器件</text>
</svg>
</div>

不用图也能推演：`0xF0` 距页尾还有 16 字节，因此前 16 字节落在当前页 `0xF0～0xFF`，后 16 字节属于下一页 `0x00～0x0F`。spi-nor 分别执行两段编程；只有绕过框架、把 32 字节塞进一条跨页命令时，器件才会回到当前页首覆盖。

## <span class="blue"> 先确认识别结果，再备份和烧写

### 识别日志和分区表各自证明什么

以下命令只读，不修改 Flash。执行前已按实际板卡合入教学 DTS、完成 DTB 构建并启动到匹配系统。

```bash
dmesg | grep 'spi-nor spi1.0'
printf 'id_log_filter_exit=%d\n' "$?"
cat /proc/mtd
printf 'proc_mtd_exit=%d\n' "$?"
```

与教学配置一致的完整预期输出如下，**不是当前板卡实测日志**：

```text
spi-nor spi1.0: w25q128 (16384 Kbytes)
id_log_filter_exit=0
dev:    size   erasesize  name
mtd0: 00100000 00001000 "uboot"
mtd1: 00800000 00001000 "kernel"
mtd2: 00600000 00001000 "rootfs"
mtd3: 00100000 00001000 "scratch"
proc_mtd_exit=0
```

`w25q128` 来自 v6.6 `winbond.c` 中 `EF 40 18` 对应的器件项，`16384 Kbytes` 是 16 MiB。`id_log_filter_exit=0` 是 grep 找到匹配行的状态，不能代替完整的驱动注册检查。`/proc/mtd` 依次给出设备号、分区大小、擦除大小和名称；这里同时确认 `mtd3` 的名称为 `scratch`，才允许继续。

若日志出现 unrecognized JEDEC、读取失败或设备未注册，应停止并沿 B-B.4.3、B-B.4.4 检查设备创建、绑定和总线事务。没有预期日志时，不能继续烧写来“试试看”。

### 先备份整个 scratch

`mtd_debug read` 的三个位置参数依次是设备、偏移和长度，最后是目标文件。这里先读取完整 1 MiB，后续才能恢复：

```bash
mtd_debug read /dev/mtd3 0 1048576 /tmp/scratch-backup.bin
printf 'backup_exit=%d\n' "$?"
```

完整预期输出：

```text
Copied 1048576 bytes from address 0x00000000 in flash to /tmp/scratch-backup.bin
backup_exit=0
```

`backup_exit=0` 表示读取命令成功。若设备、权限、长度或返回结果不符，应停止，不得进入烧写。备份只覆盖教学分区，不代表已备份整片 Flash。

### 生成三个可判定的 4 KiB 测试文件

下面分别生成全 `AA`、全 `55` 和全 `00` 文件。`dd` 产生零字节，`tr` 用八进制值把前两份内容替换为 `0xAA=0o252`、`0x55=0o125`；`od` 检查三份文件的开头内容，`wc -c` 核对文件长度。命令使用 `&&` 串联，前一步失败则不生成后续结果。

```bash
dd if=/dev/zero bs=4096 count=1 2>/dev/null > /tmp/00.bin && \
tr '\000' '\252' < /tmp/00.bin > /tmp/aa.bin && \
tr '\000' '\125' < /tmp/00.bin > /tmp/55.bin && \
od -An -tx1 -N4 /tmp/aa.bin && \
od -An -tx1 -N4 /tmp/55.bin && \
od -An -tx1 -N4 /tmp/00.bin && \
wc -c /tmp/aa.bin /tmp/55.bin /tmp/00.bin
printf 'pattern_files_exit=%d\n' "$?"
```

完整预期输出：

```text
 aa aa aa aa
 55 55 55 55
 00 00 00 00
 4096 /tmp/aa.bin
 4096 /tmp/55.bin
 4096 /tmp/00.bin
12288 total
pattern_files_exit=0
```

只有长度和内容都符合预期，后续 `cmp` 才有确定答案。这里的文件是本地生成的教学输入，不是固件镜像。

### 用 flashcp 完成正常烧写，再独立复核

`flashcp` 会先擦除容纳输入文件所需的块，再写入、回读并逐块比较。以下使用非 verbose 形式，成功时工具本身不打印进度，shell 打印其退出状态：

```bash
flashcp /tmp/aa.bin /dev/mtd3
printf 'flashcp_exit=%d\n' "$?"
mtd_debug read /dev/mtd3 0 4096 /tmp/readback.bin
printf 'readback_exit=%d\n' "$?"
cmp /tmp/aa.bin /tmp/readback.bin
printf 'cmp_exit=%d\n' "$?"
```

完整预期输出：

```text
flashcp_exit=0
Copied 4096 bytes from address 0x00000000 in flash to /tmp/readback.bin
readback_exit=0
cmp_exit=0
```

三个结论必须分开：`flashcp_exit=0` 表示工具完成擦写和内部校验；`readback_exit=0` 表示独立回读完成；`cmp_exit=0` 表示输入与回读的 4096 字节逐字节一致。`cmp` 成功时不打印文件内容，失败时报告首个差异并返回非零。任一步失败都停止后续异常实验，并按实际情况恢复备份。

## <span class="blue"> 框架怎样处理页边界和忙状态

v6.6 `spi_nor_write()` 对每次调用先取得 `page_size`，再计算当前地址的 `page_offset`。本次长度取“当前页剩余量”和“调用者剩余长度”的较小值：

```text
page_remain = min(page_size - page_offset, len - i)
```

随后框架执行 Write Enable，写入这一段，调用 `spi_nor_wait_till_ready()`，等待 BUSY 清除后才增加已写长度并处理下一段。对前面的 `0x00F0`＋32 字节例子，第一段 16 字节在当前页尾，第二段 16 字节在下一页首，因此不会发生器件页内回卷。

MTD 字符接口再把实际读写长度返回用户态。`mtdchar_read()` 和 `mtdchar_write()` 都累计 `retlen`，写入还可能返回小于请求值的正数，所以工具必须检查短读写，不能把一次 `write()` 调用等同于完整成功。mtd-utils 的 `flashcp` 用 `safe_read()`、`safe_write()` 和最终 `memcmp()` 处理这些路径。

这也解释了正常路径与底层调试的分工：产品烧写使用 spi-nor→MTD，框架负责页切分、WEL、BUSY 和错误返回；需要直接观察 `0x9F` 等原始命令时才使用 B-B.4.4 的受控 spidev 方法，不在已绑定的产品节点上随意换驱动。

## <span class="blue"> 受控观察“只能 1→0”，然后恢复

正常路径已经完成，下面的第二次写入故意不擦除，只用于观察位与结果。目标仍是同一 `scratch`，输入仍为刚生成的 4 KiB 文件。

```bash
mtd_debug write /dev/mtd3 0 4096 /tmp/55.bin
printf 'write_55_exit=%d\n' "$?"
mtd_debug read /dev/mtd3 0 4096 /tmp/readback.bin
printf 'readback_55_exit=%d\n' "$?"
cmp /tmp/00.bin /tmp/readback.bin
printf 'cmp_00_exit=%d\n' "$?"
od -An -tx1 -N4 /tmp/readback.bin
printf 'od_exit=%d\n' "$?"
```

完整预期输出：

```text
Copied 4096 bytes from /tmp/55.bin to address 0x00000000 in flash
write_55_exit=0
Copied 4096 bytes from address 0x00000000 in flash to /tmp/readback.bin
readback_55_exit=0
cmp_00_exit=0
 00 00 00 00
od_exit=0
```

正常写入 `AA=10101010` 后，再不擦除写入 `55=01010101`，每一位都只能保留两个输入中仍为 1 的位置，因此得到 `AA & 55 = 00`。`cmp_00_exit=0` 检查整个 4 KiB，而不只是前四字节；`od` 只用于展示开头样式。

这不是“写前不擦除必然报错”的实验。相反，传输和写入命令都可以成功，数据却不符合第二次写入者的预期。需要把任意旧内容改成新内容时，必须先擦除；只需把某些位从 1 改为 0 时，则不必为了形式而多擦一次。

最后恢复实验前的完整备份，并独立回读比较：

```bash
flashcp /tmp/scratch-backup.bin /dev/mtd3
printf 'restore_exit=%d\n' "$?"
mtd_debug read /dev/mtd3 0 1048576 /tmp/scratch-restored.bin
printf 'restore_read_exit=%d\n' "$?"
cmp /tmp/scratch-backup.bin /tmp/scratch-restored.bin
printf 'restore_cmp_exit=%d\n' "$?"
```

完整预期输出：

```text
restore_exit=0
Copied 1048576 bytes from address 0x00000000 in flash to /tmp/scratch-restored.bin
restore_read_exit=0
restore_cmp_exit=0
```

只有恢复校验也一致，端到端实验才结束。若恢复失败，应保留备份文件和错误现场，停止继续擦写，按板卡恢复流程处理；不能通过再跑一次异常实验掩盖失败。

**速查表**

| 阶段 | 必要判据 | 不能据此推出 |
|---|---|---|
| 识别 | 日志为 `w25q128`，`/proc/mtd` 存在预期 `scratch` | 任何分区都可以烧写 |
| 备份 | 完整 1 MiB 读取成功 | 整片 Flash 已备份 |
| 正常烧写 | flashcp、独立回读和 `cmp` 均成功 | 长期稳定或其他速率已验证 |
| 异常观察 | 全 4 KiB 与全 `00` 文件一致 | 每次 Page Program 前都必须擦除 |
| 页边界 | 框架按页剩余量拆成两段并分别等待 | 所有底层调用者都不会回卷 |
| 恢复 | 恢复后完整备份与回读一致 | 目标板其他分区已验证 |

## <span class="blue"> 证据来源与未验证项

器件结论依据 Winbond《W25Q128JV》Revision F：第 3.1 节用于 SOIC-8 引脚，第 4.3～4.4 节用于 `/WP` 和 `/HOLD`，第 8.1.1 节用于后缀与 ID，第 8.2.1、8.2.4、8.2.13 节用于 WEL、BUSY 和 Page Program，第 9.6 节用于频率条件。

Linux 结论依据 v6.6：`drivers/mtd/spi-nor/core.c` 的 probe、识别、注册、读写、页切分和等待路径；`drivers/mtd/spi-nor/winbond.c` 的 `EF 40 18`／`w25q128` 项；`drivers/mtd/mtdchar.c` 的读写长度返回。工具行为依据 mtd-utils 的 `flashcp.c`、`mtd_debug.c` 和 `flash_erase.c` 源码。

所有命令输出、分区表和 `AA & 55 = 00` 均为**源码与手册推演的教学预期，不是当前板卡实测**。教学 DTS/DTB 构建为 `not_verified`，mtd-utils 的目标版本与构建为 `not_verified`，目标板识别、备份、烧写、回读、恢复和仪器测量均为 `not_verified`。本篇没有新增需要编译的 C 示例，教学代码编译为 `not_applicable`。

## <span class="blue"> 本节总结 [B→I]

这条端到端路径的关键不是把若干烧录命令连起来，而是先限定可写对象，再让识别、备份、烧写、独立校验和恢复都落在同一个 `scratch` 上。uboot、kernel 和 rootfs 不参与实验，避免把教学操作变成系统损坏。

spi-nor→MTD 已经承担 JEDEC/SFDP 识别、页切分、Write Enable、BUSY 等待和错误返回。需要任意覆盖旧内容时先擦除，只需把 1 改为 0 时不必多擦；框架按页拆分并不意味着绕过框架的调用者也自动安全。恢复正常数据并再次校验，才是完整实验的终点。

## <span class="blue"> 本节自查

??? details "Q1. 为什么本篇把实验限制在 `scratch`，而不是沿用 kernel 或 rootfs 分区？"
    `flashcp` 和显式擦写会改变目标分区内容，教学异常实验还故意产生与第二次输入不同的结果。专用分区把影响限制在可恢复范围内，并允许先备份、后恢复；生产启动和根文件系统分区不应承担这种实验。

??? details "Q2. `flashcp_exit=0` 已经成功，为什么仍要独立回读并执行 `cmp`？"
    退出 0 表示工具完成其内部擦写和校验，独立回读与 `cmp` 则用另一组明确输入、长度和判据复核相同字节，避免把工具成功当成唯一证据。两者缺一不可，且比较文件必须同长。

??? details "Q3. 为什么 `0x00F0` 起写 32 字节在 spi-nor 路径下不会覆盖当前页首？"
    当前页只剩 16 字节。框架先写当前页尾的 16 字节，等待 BUSY 清除，再把后 16 字节写到下一页首，而不是把 32 字节作为一条跨页 Page Program 命令交给器件。

??? details "Q4. 全 `AA` 后不擦除再写全 `55`，为什么回读是全 `00`，而不是全 `55`？"
    NOR 编程只能把位从 1 改为 0。`AA=10101010` 与 `55=01010101` 在每个位上都没有共同的 1，因此位与结果为 `00000000`。命令成功不代表第二次写入的数据成为最终内容。

??? details "Q5. “写前必须先擦除”为什么不是每次 Page Program 都必须执行的形式流程？"
    如果目标位只需从 1 改为 0，可以直接编程；只有需要把 0 恢复为 1，或希望任意覆盖旧内容时，才必须先擦除。`flashcp` 选择先擦除，是为了让任意输入都能完整替换旧内容。

??? details "Q6. `/proc/mtd` 已出现 `scratch`，为什么不能据此直接开始烧写？"
    还要核对设备编号、分区名、地址、实际板卡用途和备份状态。教学 DTS 不是当前板卡实测配置，若目标系统的分区布局不同，直接照抄 `/dev/mtd3` 可能写错对象。

??? details "Q7. 为什么恢复备份后还要再做一次完整 `cmp`？"
    `flashcp` 返回成功只说明恢复命令及其内部校验完成，独立回读和完整比较用于确认实验前的 1 MiB 内容确实恢复。没有这一步，端到端实验不能算收尾。
