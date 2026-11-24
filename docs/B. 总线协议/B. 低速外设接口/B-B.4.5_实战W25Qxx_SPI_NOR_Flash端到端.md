<div class="reader-b2" markdown="1">

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

---

## <span class="blue"> 怎样阅读这组短页面

这组页面始终使用同一个 RK3568 SPI1＋W25Q128JV-IQ/JQ 实例，但把板级准备、正常烧写、机制解释和异常恢复分开。首读按顺序前进；已经准备好实验环境的读者，可以直接进入正常烧写页。任何异常观察都必须与恢复步骤一起完成。

1. **导读与实验地图**：固定实验对象、可写边界和完整路径；
2. **准备与识别**：核对器件约束、接线、DTS、分区和识别结果；
3. **备份与正常烧写**：完成备份、写入、独立回读和比较；
4. **一次 MTD 写入到达 Flash**：用自有 `mtd_upgrade.c` 追踪用户态到 spi-nor 的调用链、页切分与 BUSY；
5. **不擦除写入与恢复**：观察位与结果，再恢复原始数据并完整比较。

[开始阅读：准备与识别](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_setup.md)。

---

[下一页：准备与识别](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_setup.md)

</div>
