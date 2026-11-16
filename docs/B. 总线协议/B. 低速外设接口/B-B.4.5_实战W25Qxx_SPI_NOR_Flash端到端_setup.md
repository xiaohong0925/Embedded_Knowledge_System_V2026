<div class="reader-b2" markdown="1">

# 准备与识别：怎样确认实验对象与可写边界

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.5 实战 W25Qxx SPI NOR Flash 端到端
>
> 本组阅读：第 2 页，共 4 页

本页只回答一个问题：**怎样把实验限制在预期的 `scratch`，并在任何写入前确认器件、接线和分区都正确？**

---

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

## <span class="blue"> 先确认识别结果，再允许进入烧写

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

---

[上一页：导读与实验地图](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端.md) · [下一页：备份与正常烧写](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_write.md)

</div>
