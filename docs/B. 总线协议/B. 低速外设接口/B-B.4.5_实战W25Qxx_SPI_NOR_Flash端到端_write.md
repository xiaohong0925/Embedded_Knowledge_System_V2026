<div class="reader-b2" markdown="1">

# 备份与正常烧写：先保存原数据，再核对写入结果

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.5 实战 W25Qxx SPI NOR Flash 端到端
>
> 本组阅读：第 3 页，共 5 页

上一页已经确认 `/dev/mtd3` 是教学用的 `scratch`。

本页只回答一个问题：**怎样先保存这里的原数据，再写入一份已知内容，并确认读回来的字节确实与输入一致？**

---

## <span class="blue"> 先看本页完整流程

本页按下面的顺序操作。备份在写入之前，独立回读在写入之后，恢复则留到下一页的异常观察结束之后；任何一步结果不符合预期，都不继续下一步。

<div style="overflow-x:auto">
<svg viewBox="0 0 900 290" xmlns="http://www.w3.org/2000/svg" style="max-width:800px;width:100%;min-width:700px;height:auto" font-family="sans-serif" font-size="13" stroke="currentColor" fill="none" stroke-width="1.5" role="img" aria-labelledby="normal-flow-title">
<title id="normal-flow-title">备份、准备输入、正常烧写、独立回读、比较和恢复的完整流程</title>
<defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z" fill="currentColor" stroke="none"/></marker></defs>
<rect x="35" y="45" width="230" height="75" rx="7"/>
<text x="150" y="74" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">1. 备份整个 scratch</text>
<text x="150" y="99" text-anchor="middle" fill="currentColor" stroke="none">1 MiB → scratch-backup.bin</text>
<path d="M265 82H325" marker-end="url(#flow-arrow)"/>
<rect x="335" y="45" width="230" height="75" rx="7"/>
<text x="450" y="74" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">2. 生成三份输入</text>
<text x="450" y="99" text-anchor="middle" fill="currentColor" stroke="none">AA／55／00，各 4 KiB</text>
<path d="M565 82H625" marker-end="url(#flow-arrow)"/>
<rect x="635" y="45" width="230" height="75" rx="7"/>
<text x="750" y="74" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">3. 正常烧写 AA</text>
<text x="750" y="99" text-anchor="middle" fill="currentColor" stroke="none">flashcp aa.bin → mtd3</text>
<path d="M750 120V160" marker-end="url(#flow-arrow)"/>
<rect x="635" y="170" width="230" height="75" rx="7"/>
<text x="750" y="199" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">4. 独立回读</text>
<text x="750" y="224" text-anchor="middle" fill="currentColor" stroke="none">mtd3 → readback.bin</text>
<path d="M635 207H575" marker-end="url(#flow-arrow)"/>
<rect x="335" y="170" width="230" height="75" rx="7"/>
<text x="450" y="199" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">5. 比较输入与回读</text>
<text x="450" y="224" text-anchor="middle" fill="currentColor" stroke="none">cmp aa.bin readback.bin</text>
<path d="M335 207H275" marker-end="url(#flow-arrow)"/>
<rect x="35" y="170" width="230" height="75" rx="7"/>
<text x="150" y="196" text-anchor="middle" fill="currentColor" stroke="none" font-size="15">6. 下一页完成恢复</text>
<text x="150" y="220" text-anchor="middle" fill="currentColor" stroke="none">异常观察后写回备份</text>
<text x="150" y="238" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">再次回读并比较</text>
</svg>
</div>

不看图也要记住这条顺序：**先备份，后写入；写入后重新读一份文件，再用 `cmp` 比较原输入和这份独立回读文件。

**`flashcp` 自己也会校验，但那属于工具内部检查，不能替代这里主动执行的第二次核对。

## <span class="blue"> flashcp 和 mtd_debug 是什么

它们都属于 **mtd-utils 项目提供的开源工具**，不是本书临时编写的脚本，也不是内核函数。mtd-utils 面向 Linux 的 MTD 原始闪存设备；在直接操作 `/dev/mtdN` 分区的嵌入式 Linux 系统中，这类工具是常见的烧写和调试手段之一，但并非每个发行版都会默认安装，也不是唯一可用的工具。

- [`flashcp.c`](code/B-B.4.5/mtd-utils/flashcp.c){: data-code-viewer="true" data-code-title="flashcp.c" data-code-path="mtd-utils · flashcp.c" data-code-lines="216-541"}：先擦除容纳输入文件所需的块，再写入、回读并比较，适合用新文件完整替换分区中的旧内容。
- [`mtd_debug.c`](code/B-B.4.5/mtd-utils/mtd_debug.c){: data-code-viewer="true" data-code-title="mtd_debug.c" data-code-path="mtd-utils · mtd_debug.c" data-code-lines="337-401"}：按指定设备、偏移和长度读写原始数据。`mtd_debug write` 本身不先擦除，下一页正是利用这一点观察重复编程的结果。

这两个工具都通过 MTD 字符设备进入内核，最终仍由 spi-nor 执行实际操作。下面的输出均为与教学配置一致的**预期结果，不是当前板卡实测记录**。

## <span class="blue"> 按步骤完成备份与正常烧写

### 先把整个 scratch 读成备份文件

`mtd_debug read` 后面依次填写设备、偏移、长度和目标文件。这里从偏移 0 读取完整 1 MiB，得到 `/tmp/scratch-backup.bin`：

```bash
mtd_debug read /dev/mtd3 0 1048576 /tmp/scratch-backup.bin
```

对应输出：

```text
Copied 1048576 bytes from address 0x00000000 in flash to /tmp/scratch-backup.bin
```

输出中的长度必须也是 `1048576`，这表示完整教学分区已经读成文件。若设备、权限或输出长度不符，应停止，不得进入烧写。这个备份只覆盖 `scratch`，不代表整片 Flash 都已备份。

### 生成全 AA、全 55 和全 00 三个文件

三份文件各 4 KiB，用途不同：`aa.bin` 是正常烧写输入，`55.bin` 留给下一页不擦除的第二次写入，`00.bin` 是那时预期的比较文件。它们只是本地生成的测试数据，不是固件镜像。

先用 `dd` 从 `/dev/zero` 取出 4096 个零字节，生成 `00.bin`。重定向到文件后，成功时不需要额外打印状态：

```bash
dd if=/dev/zero of=/tmp/00.bin bs=4096 count=1 2>/dev/null
```

再用 `tr` 把零字节分别替换成 `0xAA` 和 `0x55`。这里的 `\252`、`\125` 是 `tr` 使用的八进制写法，分别等于十六进制 `AA`、`55`：

```bash
tr '\000' '\252' < /tmp/00.bin > /tmp/aa.bin
```

```bash
tr '\000' '\125' < /tmp/00.bin > /tmp/55.bin
```

两条生成命令成功时都没有输出。用 `wc -c` 一次核对三份文件的长度：

```bash
wc -c /tmp/aa.bin /tmp/55.bin /tmp/00.bin
```

对应输出：

```text
 4096 /tmp/aa.bin
 4096 /tmp/55.bin
 4096 /tmp/00.bin
12288 total
```

再用 `od` 分别查看开头四字节。`aa.bin` 应当是：

```bash
od -An -tx1 -N4 /tmp/aa.bin

 aa aa aa aa
```

`55.bin` 应当是：

```bash
od -An -tx1 -N4 /tmp/55.bin

 55 55 55 55
```

`00.bin` 应当是：

```bash
od -An -tx1 -N4 /tmp/00.bin

 00 00 00 00
```

长度和内容都符合预期后才继续。这样，后面的比较结果可以由输入直接推定，不需要猜文件里原本有什么。

### 用 flashcp 把 aa.bin 正常写入 scratch

```bash
flashcp /tmp/aa.bin /dev/mtd3
```

这里使用非 verbose 形式，成功时通常不打印进度。`flashcp` 会擦除容纳这 4 KiB 文件所需的块，再写入并在工具内部回读比较。它选择先擦除，是为了让任意旧内容都能被新文件完整替换。

如果工具报告擦除、写入或比较失败，应停止后续操作并保留错误信息；不要把“命令已经执行过”当作写入成功。

??? details "可以用 dd 写入吗？可以，但擦除要另外处理"
    `dd` 是更通用的字节复制工具，很多人会比 `flashcp` 更熟悉它。它也能向 `/dev/mtd3` 写入数据，但**不会根据 NOR Flash 的要求先擦除，也不会在写完后自动回读比较**。`bs=4096` 只是本次用户态读写块大小，不是擦除命令。

    如果目标区域已经擦除，或者明确要做增量编程，可以使用 `dd`。若目标和本页一样需要用新文件完整替换旧内容，应先擦除一个 4 KiB 擦除块，再执行 `dd`：

    ```bash
    flash_erase /dev/mtd3 0 1
    dd if=/tmp/aa.bin of=/dev/mtd3 bs=4096 count=1
    ```

    `flash_erase /dev/mtd3 0 1` 表示从分区偏移 0 开始擦除 1 个擦除块；随后 `dd` 写入 4096 字节。`dd` 显示的 records 和复制长度只能说明用户态复制过程结束，仍须执行下一节的独立回读和 `cmp`，不能据此证明 Flash 内容正确。

    **两种写法二选一，不要连续执行。**本页主路径使用 `flashcp`，是因为它把正常替换所需的擦除、写入和内部比较收在一个工具里，减少漏掉擦除的风险；`dd` 路径则把各步骤显式拆开，更适合需要单独控制擦除范围的场景。

### 重新读一份独立回读文件

```bash
mtd_debug read /dev/mtd3 0 4096 /tmp/readback.bin
```

对应输出：

```text
Copied 4096 bytes from address 0x00000000 in flash to /tmp/readback.bin
```

这一步重新从 `scratch` 的开头读出 4096 字节，形成与 `aa.bin` 等长的另一份文件。它不是 `flashcp` 内部比较使用的缓冲区，而是留给下一步独立检查的文件证据。

### 用 cmp 比较原输入与独立回读

```bash
cmp /tmp/aa.bin /tmp/readback.bin
```

**成功时没有任何输出，这表示两个文件的 4096 字节逐字节一致。**若出现差异，`cmp` 会报告首个不同的位置并返回失败；此时不应继续做异常实验，而应保留文件、停止写入并按实际情况恢复备份。

到这里，正常烧写得到两层证据：`flashcp` 已完成内部擦写与比较，独立的 `mtd_debug read` 和 `cmp` 又确认了一次相同字节。正常写入已经改变 `scratch` 的内容；即使不继续下一页的异常观察，也应进入恢复步骤，把实验前的完整备份写回并复核，不能把测试数据留在分区里当作实验终点。

---

[上一页：准备与识别](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_setup.md) · [下一页：一次 MTD 写入怎样到达 Flash](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_mechanism.md)

</div>
