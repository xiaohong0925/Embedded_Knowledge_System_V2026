<div class="reader-b2" markdown="1">

# 不擦除写入与恢复：怎样观察结果并还原现场

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.5 实战 W25Qxx SPI NOR Flash 端到端
>
> 本组阅读：第 5 页，共 5 页

上一页已经沿正常升级路径追到 spi-nor。这里只做一个对照实验：**保留上一笔全 `AA`，故意不擦除再写全 `55`，观察最终内容；随后用完整备份恢复 `scratch` 并验收。**

---

## <span class="blue"> 先看实验与恢复的顺序

```text
已有内容：AA
→ 不擦除写入 55
→ 独立回读
→ 与 00.bin 比较
→ 用 scratch-backup.bin 恢复
→ 再次回读并比较完整 1 MiB
```

异常实验只改变“是否先擦除”这一前提，目标仍是同一个 `scratch`。正常烧写需要任意替换旧内容时必须先擦除；这里的不擦除只用于观察增量编程结果，不是日常升级方法。

## <span class="blue"> 不擦除再写一次，观察最终内容

每条命令只对应紧随其后的预期输出，均不是当前板卡实测记录。

### 不擦除，直接写入 55.bin

```bash
mtd_debug write /dev/mtd3 0 4096 /tmp/55.bin
```

对应输出：

```text
Copied 4096 bytes from /tmp/55.bin to address 0x00000000 in flash
```

这条输出说明工具执行了写入路径，**不代表 Flash 最终内容就是全 `55`**。要得到最终内容，必须重新读回。

### 把第二次写入后的内容读回来

```bash
mtd_debug read /dev/mtd3 0 4096 /tmp/readback.bin
```

对应输出：

```text
Copied 4096 bytes from address 0x00000000 in flash to /tmp/readback.bin
```

### 用 00.bin 比较整个 4 KiB

```bash
cmp /tmp/00.bin /tmp/readback.bin
```

成功时没有任何输出，表示回读文件的 4096 字节与全 `00` 文件一致。`cmp` 检查的是完整文件，不只是下面展示的开头四字节。

### 查看回读文件的开头四字节

```bash
od -An -tx1 -N4 /tmp/readback.bin
```

对应输出：

```text
 00 00 00 00
```

正常写入 `AA=10101010` 后，再不擦除写入 `55=01010101`，每一位都只能保留两个输入中仍为 1 的位置，因此得到 `AA & 55 = 00`。`cmp` 给出全文件判据，`od` 只用于直观展示开头样式。

这不是“写前不擦除必然报错”的实验。相反，传输和写入命令都可以成功，数据却不符合第二次写入者的预期。手册给出的标准 Page Program 前提是目标位置已擦除为 `FFh`，所以把任意旧内容改成新内容时必须先擦除。本例只是在已知原有内容、每条 Page Program 都不跨页的条件下观察增量编程：已经为 0 的位保持为 0，不能把这个特定实验扩大成产品烧写可以省略擦除。

??? details "为什么 mtd_debug 正常返回，也不能单独证明完整写入"
    MTD 字符接口会把实际读写长度返回用户态。[`mtdchar_read():127-215`](code/B-B.4.5/kernel-v6.6/drivers/mtd/mtdchar.c){: data-code-viewer="true" data-code-title="mtdchar.c" data-code-path="Linux v6.6 · drivers/mtd/mtdchar.c" data-code-lines="127-215"} 和 [`mtdchar_write():217-302`](code/B-B.4.5/kernel-v6.6/drivers/mtd/mtdchar.c){: data-code-viewer="true" data-code-title="mtdchar.c" data-code-path="Linux v6.6 · drivers/mtd/mtdchar.c" data-code-lines="217-302"} 都累计 `retlen`，写入还可能返回小于请求值的正数，所以调用者需要检查短读写，不能把一次 `write()` 调用等同于完整成功。

    [`flashcp` 的 `safe_read()`／`safe_write():143-176`](code/B-B.4.5/mtd-utils/flashcp.c){: data-code-viewer="true" data-code-title="flashcp.c" data-code-path="mtd-utils · flashcp.c" data-code-lines="143-176"} 会拒绝短读写，最终还在 [`442-479 行`](code/B-B.4.5/mtd-utils/flashcp.c){: data-code-viewer="true" data-code-title="flashcp.c" data-code-path="mtd-utils · flashcp.c" data-code-lines="442-479"} 回读并用 `memcmp()` 比较。

    本例引用的 `mtd_debug.c` 则不同：[`flash_to_file():106-169`](code/B-B.4.5/mtd-utils/mtd_debug.c){: data-code-viewer="true" data-code-title="mtd_debug.c" data-code-path="mtd-utils · mtd_debug.c" data-code-lines="106-169"} 会因短读而失败；[`file_to_flash():171-225`](code/B-B.4.5/mtd-utils/mtd_debug.c){: data-code-viewer="true" data-code-title="mtd_debug.c" data-code-path="mtd-utils · mtd_debug.c" data-code-lines="171-225"} 对 `write()` 的负返回报错，却没有拒绝小于请求值的正数短写。因此，`mtd_debug write` 正常返回不能单独证明完整 4 KiB 已写入，独立回读和全量 `cmp` 一致才是最终内容判据。本篇自有的 [`mtd_upgrade.c`](code/B-B.4.5/mtd_upgrade.c){: data-code-viewer="true" data-code-title="mtd_upgrade.c" data-code-path="本篇教学配套 · code/B-B.4.5/mtd_upgrade.c"} 则显式循环处理短读写，不能把两者混为一谈。

## <span class="blue"> 用备份恢复，并确认恢复结果

异常观察已经结束，下面不再构造新数据，而是用实验前的完整备份恢复 `scratch`，再按与正常烧写相同的独立比较方法验收。

### 用完整备份恢复 scratch

```bash
flashcp /tmp/scratch-backup.bin /dev/mtd3
```

这里使用非 verbose 形式，成功时通常不打印进度。`flashcp` 会擦除备份文件所需的块，再写入并在工具内部比较，从而用实验前的完整备份替换测试数据。

### 回读恢复后的完整分区

```bash
mtd_debug read /dev/mtd3 0 1048576 /tmp/scratch-restored.bin
```

对应输出：

```text
Copied 1048576 bytes from address 0x00000000 in flash to /tmp/scratch-restored.bin
```

### 比较实验前备份与恢复后的内容

```bash
cmp /tmp/scratch-backup.bin /tmp/scratch-restored.bin
```

成功时没有任何输出，表示恢复后的完整 1 MiB 与实验前备份逐字节一致。只有恢复校验也一致，端到端实验才结束。若恢复失败，应保留备份文件和错误现场，停止继续擦写，按板卡恢复流程处理；不能通过再跑一次异常实验掩盖失败。

**速查表**

| 阶段 | 必要判据 | 不能据此推出 |
|---|---|---|
| 识别 | 日志为 `w25q128`，`/proc/mtd` 存在预期 `scratch` | 任何分区都可以烧写 |
| 备份 | 完整 1 MiB 读取成功 | 整片 Flash 已备份 |
| 正常烧写 | flashcp、独立回读和 `cmp` 均成功 | 长期稳定或其他速率已验证 |
| 异常观察 | 全 4 KiB 与全 `00` 文件一致 | 任意产品覆盖都可以跳过擦除 |
| 页边界 | 框架按页剩余量拆成两段并分别等待 | 所有底层调用者都不会回卷 |
| 恢复 | 恢复后完整备份与回读一致 | 目标板其他分区已验证 |

## <span class="blue"> 证据来源与未验证项

器件结论依据 Winbond《W25Q128JV》Revision F：第 3.1 节用于 SOIC-8 引脚，第 4.3～4.4 节用于 `/WP` 和 `/HOLD`，第 8.1.1 节用于后缀与 ID，第 8.2.1、8.2.4、8.2.13 节用于 WEL、BUSY 和 Page Program，第 9.6 节用于频率条件。

Linux 结论依据 v6.6：`drivers/mtd/spi-nor/core.c` 的 probe、识别、注册、读写、页切分和等待路径；`drivers/mtd/spi-nor/winbond.c` 的 `EF 40 18`／`w25q128` 项；`drivers/mtd/mtdchar.c` 的读写长度返回。工具行为依据 mtd-utils 的 `flashcp.c`、`mtd_debug.c` 和 `flash_erase.c` 源码。

所有命令输出、分区表和 `AA & 55 = 00` 均为**源码与手册推演的教学预期，不是当前板卡实测**。教学 DTS/DTB 构建为 `not_verified`，mtd-utils 的目标版本与构建为 `not_verified`，自有 `mtd_upgrade.c` 的本机与交叉编译均为 `not_verified`，目标板识别、备份、烧写、回读、恢复和仪器测量均为 `not_verified`，交互 HTML 的桌面浏览器交互为 `not_verified（待统一桌面验收）`。

## <span class="blue"> 本节总结 [B→I]

这条端到端路径的关键不是把若干烧录命令连起来，而是先限定可写对象，再让识别、备份、烧写、独立校验和恢复都落在同一个 `scratch` 上。uboot、kernel 和 rootfs 不参与实验，避免把教学操作变成系统损坏。

spi-nor→MTD 已经承担 JEDEC/SFDP 识别、页切分、Write Enable、BUSY 等待和错误返回。任意覆盖旧内容时先擦除；`AA→55` 只说明已知原内容、每条 Page Program 不跨页时的增量编程结果，不能推广为产品烧写省略擦除。框架按页拆分也不意味着绕过框架的调用者自动安全。恢复正常数据并再次校验，才是完整实验的终点。

## <span class="blue"> 本节自查

??? details "Q1. 为什么本篇把实验限制在 `scratch`，而不是沿用 kernel 或 rootfs 分区？"
    `flashcp` 和显式擦写会改变目标分区内容，教学异常实验还故意产生与第二次输入不同的结果。专用分区把影响限制在可恢复范围内，并允许先备份、后恢复；生产启动和根文件系统分区不应承担这种实验。

??? details "Q2. `flashcp` 已经完成内部校验，为什么仍要独立回读并执行 `cmp`？"
    `flashcp` 成功返回表示工具完成了内部擦写和比较。独立回读与 `cmp` 则用另一组明确输入、长度和判据复核相同字节，避免把工具内部结论当成唯一证据。比较文件必须同长，成功时 `cmp` 不输出内容。

??? details "Q3. 为什么 `0x00F0` 起写 32 字节在 spi-nor 路径下不会覆盖当前页首？"
    当前页只剩 16 字节。框架先写当前页尾的 16 字节，等待 BUSY 清除，再把后 16 字节写到下一页首，而不是把 32 字节作为一条跨页 Page Program 命令交给器件。

??? details "Q4. 全 `AA` 后不擦除再写全 `55`，为什么回读是全 `00`，而不是全 `55`？"
    NOR 编程只能把位从 1 改为 0。`AA=10101010` 与 `55=01010101` 在每个位上都没有共同的 1，因此位与结果为 `00000000`。命令成功不代表第二次写入的数据成为最终内容。

??? details "Q5. 手册以已擦除位置为 Page Program 前提，为什么本例 `AA→55` 又不擦除？"
    正常产品烧写需要任意覆盖旧内容，所以 `flashcp` 先擦除。本例是已知原内容、每条 Page Program 不跨页的受控增量观察，只考察已经为 0 的位是否保持为 0；它不能证明任意未擦除区域都能按第二次输入得到预期内容，也不用来替代正常烧写流程。

??? details "Q6. `/proc/mtd` 已出现 `scratch`，为什么不能据此直接开始烧写？"
    还要核对设备编号、分区名、地址、实际板卡用途和备份状态。教学 DTS 不是当前板卡实测配置，若目标系统的分区布局不同，直接照抄 `/dev/mtd3` 可能写错对象。

??? details "Q7. 为什么恢复备份后还要再做一次完整 `cmp`？"
    `flashcp` 返回成功只说明恢复命令及其内部校验完成，独立回读和完整比较用于确认实验前的 1 MiB 内容确实恢复。没有这一步，端到端实验不能算收尾。

---

[上一页：一次 MTD 写入怎样到达 Flash](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_mechanism.md) · [回到导读与实验地图](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端.md)

</div>
