<div class="reader-b2" markdown="1">

# 备份与正常烧写：怎样留下独立校验证据

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.5 实战 W25Qxx SPI NOR Flash 端到端
>
> 本组阅读：第 3 页，共 4 页

本页只回答一个问题：**怎样在同一个 `scratch` 上完成可恢复的正常烧写，并用独立回读确认结果？**

---

## <span class="blue"> 在同一 scratch 上完成备份、烧写与校验

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

正常烧写已经改变 `scratch` 的内容。若不再继续异常观察，也应进入下一页完成“恢复实验前的完整备份并复核”，不要把测试数据当作实验终点。

---

[上一页：准备与识别](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_setup.md) · [下一页：框架机制、异常观察与恢复](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_mechanism.md)

</div>
