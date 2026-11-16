<div class="reader-b2" markdown="1">

# 框架机制、异常观察与恢复：怎样解释结果并还原现场

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.5 实战 W25Qxx SPI NOR Flash 端到端
>
> 本组阅读：第 4 页，共 4 页

本页只回答一个问题：**框架怎样避免跨页回卷并等待擦写完成，为什么成功写入仍可能得到不同数据，实验结束后又怎样恢复原内容？**

---

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

### 恢复实验前的完整备份并复核

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

---

[上一页：备份与正常烧写](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_write.md) · [回到导读与实验地图](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端.md)

</div>
