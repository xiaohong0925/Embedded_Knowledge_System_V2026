# B-B.3.5 实战：AT24C02 EEPROM 端到端读写

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] | 预计阅读时间：50 分钟

## <span class="blue"> 本节导读

本篇只回答一个问题：在 RK3568 的 I2C1 上，把 12 字节 `Hello-EEPROM` 写入一颗受控实验 EEPROM 的偏移 `0x10` 并读回时，**内核 at24/sysfs 与用户态 `/dev/i2c` 两条路径分别怎样建立对象、组织传输、处理页边界和写周期，又怎样证明结果正确**。EEPROM 是可电擦写、按字节读取且掉电保存内容的存储器；这里的“偏移”是其内部存储地址，不是 I2C 器件地址。

贯穿实例使用 Microchip AT24C02C：7 位器件地址 `0x50`，容量 256 字节，真实页大小 8 字节。`Hello-EEPROM` 不含字符串末尾的空字节 `\0`，恰好 12 字节；从 `0x10` 起写必须拆成 `0x10～0x17` 的 8 字节和 `0x18～0x1b` 的 4 字节。这个 8＋4 拆分会贯穿设备树、内核源码、shell 命令和用户态 C 程序。

参与这条链路的职责不能混在一起：硬件保存字节并执行内部擦写；设备树描述器件身份和页大小；at24 驱动把字节读写转换成 I2C 传输；regmap 把“内部地址＋数据值”转换为总线访问；NVMEM（非易失存储）子系统通过 sysfs 向用户态导出文件，sysfs 是以文件形式呈现内核设备对象和属性的虚拟文件系统；用户程序负责提供偏移、数据和验证。两条实验路径共用同一颗芯片，但不同时访问它。

| 参与者 | 在本实例中负责什么 | 本篇是否需要写代码 |
|---|---|---|
| AT24C02C | 接收内部地址与数据，执行页写和内部擦写，提供顺序读 | 否，先核对真实型号和手册 |
| 设备树与内核配置 | 声明 `0x50`、`24c02` 和 8 字节页，启用 at24/NVMEM | 需要修改板级配置 |
| at24、regmap、NVMEM | 切分页写、重试写失败、生成 I2C 消息、提供 `eeprom` 文件 | 使用内核现有实现 |
| 用户态 `/dev/i2c` 程序 | 在受控解绑后自行完成同样的页切分、写等待和读回 | 需要完整 C 示例 |

本节覆盖：实验器件与安全边界、设备树到 `eeprom` 文件的创建过程、sysfs 读写全调用链、用户态完整程序，以及解绑和重绑时软件对象与芯片内容各自怎样变化。开漏上拉和总线帧格式分别前置在 B-B.3.1、B-B.3.2；扫描、示波器观测和通用故障定位归 B-B.3.4，本篇只使用其结论，不重复展开。

> ⚠️ 以下命令输出和程序输出均为依据 Linux v6.6 源码、AT24C02C 数据手册及命令语义给出的**预期示例**，不是本机或目标板实测记录。实验必须使用可擦写的独立 EEPROM，备份原内容；不要对内存条 SPD（保存内存模组参数的 EEPROM）、量产配置区或来源不明的 `0x50` 器件执行写入。

## <span class="blue"> 先锁定器件和这笔 8＋4 写入

### 型号、地址和页大小必须分别确认

EEPROM 是可以按字节读取、可电擦写且掉电保存内容的非易失存储器。“AT24C02”常被当成一类 2 Kbit 器件的统称，但同系列不同厂商、不同后缀的页大小和写周期可能不同，所以不能只看容量就填写驱动参数。本篇依据的是 **AT24C02C** 数据手册：2 Kbit 等于 256 字节，内部地址范围 `0x00～0xff`，32 页，每页 8 字节，最大写周期 5 ms。

器件地址和内部地址承担不同任务。实验将 A2、A1、A0 三个地址选择引脚接地，得到 7 位 I2C 地址 `0x50`；它出现在总线地址帧中，用来选中芯片。`0x10` 则是写入芯片内部存储阵列的起始位置，作为后续数据字节发送。设备树 `reg = <0x50>` 描述前者，`dd` 的 `seek=16` 和 C 程序的 `mem_addr` 描述后者，两者不能拼接成一个“8 位地址”。

WP 是硬件写保护引脚。本实验按数据手册将其接到有效写入电平，并确认供电电压、SDA/SCL 上拉和电平与板卡一致；WP 接高或悬空都不是本实验的前提。总线空闲电平、START、STOP、ACK/NACK 的含义见 B-B.3.1 和 B-B.3.2。这里只需记住：ACK 表示接收方应答，NACK 表示不应答；AT24C02C 在内部擦写期间可以对后续访问不应答。

### 页限制约束写入，不约束这次读取

AT24C02C 的一次页写从指定内部地址开始，但页内地址计数器到达页尾后会回到本页页首，而不会自动进入下一页。若从 `0x10` 一次发送 12 个数据字节，前 8 个落在 `0x10～0x17`，后 4 个会回卷到 `0x10～0x13`，覆盖刚写入的前 4 个字节。器件不会用错误码报告这次覆盖，因此软件必须在发送前切分。

正确顺序是两笔独立传输。第一笔发送内部地址 `0x10` 和数据 `Hello-EE`，共 8 个数据字节；等器件能够再次应答后，第二笔发送内部地址 `0x18` 和数据 `PROM`，共 4 个数据字节。两笔都遵守 8 字节页边界，合起来才是完整的 `Hello-EEPROM`。

读方向没有同样的页写限制。从 `0x10` 顺序读 12 字节可以连续经过 `0x17` 到 `0x18`，所以后文内核路径和用户态路径都把读取组织成一次 12 字节顺序读。页切分与写等待只出现在写路径，不要把它们机械地复制到读路径。

## <span class="blue"> 从设备树到 eeprom 文件：对象先建立起来

### 设备树提供匹配信息和页大小

设备树源文件 DTS 描述板级硬件，编译后的 DTB 在启动时交给内核。节点应放进产品实际启用 I2C1 的板级 DTS；具体文件名由所用 BSP 决定。BSP 是板级支持包，通常包含内核源码、板级配置、构建脚本和部署工具，不能凭芯片名虚构一个所有 RK3568 板卡通用的 DTS 路径。

```dts
&i2c1 {
    status = "okay";

    eeprom@50 {
        compatible = "atmel,24c02";
        reg = <0x50>;
        pagesize = <8>;
    };
};
```

`&i2c1` 引用芯片级 DTSI 中已有的 I2C1 控制器节点，DTSI 是供板级 DTS 包含的设备树源文件；`status = "okay"` 启用该控制器。子节点中的 `reg` 是 7 位器件地址，`compatible` 是驱动匹配键。这里沿用内核匹配表中的 `atmel,24c02`，不是根据芯片表面厂商自行创造 `microchip,at24c02c`；该匹配项在 Linux v6.6 的 `drivers/misc/eeprom/at24.c` 中对应 256 字节、8 位内部地址的 `at24_data_24c02`。

`pagesize = <8>` 来自本实例的数据手册，不是 at24 驱动自动探测出来的能力。v6.6 的 `at24_probe()` 读不到该属性时把 `page_size` 设为 1：每次只写一个字节，通常只是变慢，并不会跨页回卷；反之，把真实 8 字节页错误声明成 16 字节，会允许驱动一次发送跨页数据，造成覆盖。这个属性描述硬件事实，不能为了“提高批量”调大。

仅有 DTS 还不够。at24 的 Kconfig 项 `CONFIG_EEPROM_AT24` 依赖 `I2C && SYSFS`，并选择 `NVMEM`、`NVMEM_SYSFS`、`REGMAP` 和 `REGMAP_I2C`。在目标内核源码树中检查实际用于构建的配置：

```bash
grep -E 'CONFIG_(I2C|SYSFS|EEPROM_AT24|NVMEM|NVMEM_SYSFS|REGMAP|REGMAP_I2C)=' .config
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- dtbs
```

第一条命令从 `.config` 筛选本链路所需选项；`y` 表示编入内核，`m` 表示构建为模块。若 at24 为 `m`，还须由 BSP 把与运行内核匹配的 `at24.ko` 部署到根文件系统并加载。第二条命令在内核源码树顶层交叉编译 DTB，`CROSS_COMPILE` 的前缀只是示例，应换成实际工具链；`dtbs` 只生成设备树二进制，**不等于已经部署**。将哪个 DTB 放入哪个启动分区或启动镜像、怎样更新和重启，必须按该板 BSP 的流程完成，这属于系统集成，不是 at24 驱动机制本身。

### 启动后依次创建 client、at24_data、regmap 和 NVMEM

新 DTB 生效后，I2C 核心根据节点创建 `i2c_client`。这个内核对象把控制器对应的 `i2c_adapter`、器件地址 `0x50` 和设备树节点关联起来；在 I2C1 上，它的设备名通常是 `1-0050`，其中 `1` 是总线编号，`0050` 是十六进制地址。probe 是设备与驱动匹配后执行的初始化回调，其通用规则见 B-B.3.3 与第 11 章，本篇只跟踪 at24 这条具体路径。

`compatible` 匹配成功后，内核调用 `at24_probe(client)`。v6.6 源码中的创建顺序和关系如下：

1. `devm_regmap_init_i2c()` 为 client 创建 regmap。regmap 是内核的“寄存器地址＋值”访问抽象；在本器件上，寄存器地址就是 EEPROM 内部偏移，值为 8 位，偏移也是 8 位。它负责把 at24 的读写作业转成 I2C 消息。
2. `devm_kzalloc()` 创建并清零 `at24_data`，这是 at24 对本次绑定保存的运行状态。`byte_len=256` 限定容量，`page_size=8` 决定切页，`write_max` 限制单次写入，`client_regmaps[0]` 保存上面的 regmap，`lock` 串行化经由这个 at24 实例进入的读写。
3. probe 填写 `nvmem_config`：`reg_read=at24_read`、`reg_write=at24_write` 提供回调，`priv=at24` 让回调取回这份状态，`size=byte_len` 声明容量，`compat=true` 和 `base_dev=dev` 要求生成兼容 sysfs 文件。
4. `devm_nvmem_register()` 创建 `nvmem_device`。NVMEM 是 Linux 的非易失存储子系统，它把不同驱动提供的存储统一成读写接口。NVMEM 核心随后调用 `nvmem_sysfs_setup_compat()`，再由 `device_create_bin_file()` 在原 I2C 设备目录创建名为 `eeprom` 的二进制属性文件。

因此，`/sys/bus/i2c/devices/1-0050/eeprom` 不是芯片上原本存在的文件，也不是磁盘文件。它是 NVMEM 挂在 `1-0050` 设备对象上的内核入口，文件位置 `pos` 最终会成为 EEPROM 内部偏移。`devm_` 前缀表示设备管理资源：设备解绑或 probe 失败时，内核按资源登记关系执行释放，不要求驱动在每个错误分支手工销毁所有对象。

启动后可观察绑定结果。以下命令在目标板 root shell 执行，`readlink -f` 展开驱动链接，`test -e` 检查文件存在性，`dmesg` 读取内核日志：

```bash
readlink -f /sys/bus/i2c/devices/1-0050/driver
test -e /sys/bus/i2c/devices/1-0050/eeprom && echo "eeprom exists"
dmesg | grep -E 'at24|24c02|1-0050'
```

符合本配置的预期格式是：

```text
/sys/bus/i2c/drivers/at24
eeprom exists
at24 1-0050: 256 byte 24c02 EEPROM, writable, 8 bytes/write
```

第一行证明 client 当前绑定到 at24，第二行证明兼容 NVMEM 文件已创建，第三行的 `256 byte` 来自匹配表容量，`writable` 表示驱动未声明只读，`8 bytes/write` 来自页大小和驱动的单次 I/O 上限。只有这三项与配置一致，才适合继续写实验；若文件不存在，应回头核对运行中的 DTB、内核配置和 probe 日志，而不是直接改用强制访问。

## <span class="blue"> 路径一：sysfs 写入怎样变成两笔 I2C 传输

### 先建立从 dd 到控制器的完整路线

shell 中的 `dd` 打开 `eeprom` 并调用写接口，sysfs 把文件位置和字节数交给 NVMEM。对本实例，完整写路径是：

```text
dd：pos=0x10，count=12
→ bin_attr_nvmem_write()
→ nvmem_reg_write()
→ at24_write()
→ at24_regmap_write()
→ at24_adjust_write_count()
→ regmap_bulk_write()
→ regmap-i2c：i2c_master_send()
→ I2C 控制器发出“内部地址＋数据”
→ 第一笔 8 字节，等待/重试后第二笔 4 字节
```

`bin_attr_nvmem_write()` 是 NVMEM 二进制文件的写回调，先检查偏移、容量和写回调是否存在；`nvmem_reg_write()` 再调用 probe 时登记的 `at24_write()`，从而把文件操作接到前面建立的 `at24_data`。这条链上每个返回值表达的对象不同：regmap-i2c 在一次完整发送后返回 0；`at24_regmap_write()` 把 0 转换成本次完成的字节数；`at24_write()` 循环完成全部数据后返回 0；`bin_attr_nvmem_write()` 再把 0 转换成用户这次请求的字节数 12。因而“at24_write 返回 0”和“dd 写入 12 字节”并不矛盾，不能把不同层的返回值混为一谈。

### at24 在何处切页、在何处等待

v6.6 的 `at24_write()` 先检查 `off + count` 是否超过 256，再对 `at24_data.lock` 加锁，随后循环推进缓冲区、偏移和剩余长度。下面是与本实例直接相关的源码节选，来源为 `drivers/misc/eeprom/at24.c` 第 493～503 行；错误分支在文中单独解释：

```c
while (count) {
    ret = at24_regmap_write(at24, buf, off, count);
    if (ret < 0) {
        /* 解锁、释放运行时电源引用并返回错误，此处略 */
    }
    buf += ret;
    off += ret;
    count -= ret;
}
```

每轮实际写多少，由 `at24_regmap_write()` 中的 `at24_adjust_write_count()` 决定。该函数先用 `write_max` 限制长度，再计算下一页边界。本例 `write_max=8`，所以第一轮的 12 先缩短为 8；第一轮完成后 `buf` 前进 8 字节、`off` 从 `0x10` 变为 `0x18`、`count` 从 12 变为 4，第二轮自然只写 4 字节。

页边界计算本身位于同文件第 371～386 行：

```c
next_page = roundup(offset + 1, at24->page_size);
if (offset + count > next_page)
    count = next_page - offset;
```

`roundup(x, 8)` 把 `x` 向上对齐到 8 的倍数。若请求从 `0x12` 写 8 字节，`offset + 1 = 0x13`，下一页边界为 `0x18`，本轮最多写 `0x18 - 0x12 = 6` 字节；剩余 2 字节由下一轮从 `0x18` 写入。它不是按“总请求长度除以 8”机械切块，而是同时考虑起始偏移。

每次 `at24_regmap_write()` 调用 `regmap_bulk_write()` 时，regmap 将 8 位内部地址和本段数据组织成一次写传输。以线性写实现为例，`regmap_i2c_write()` 把内部地址与数据放进连续缓冲区，再调用 `i2c_master_send()`；regmap 也可按控制器能力选择分段写实现，但不改变本例的两笔页写划分。第一笔线上载荷因此是 `0x10＋8 字节数据`，第二笔是 `0x18＋4 字节数据`。

写周期处理也在 `at24_regmap_write()` 内，但它不是“每次成功后固定睡 5 ms”。v6.6 默认 `at24_write_timeout=25` ms；当 `regmap_bulk_write()` 返回错误时，函数用 `usleep_range(1000, 1500)` 睡眠约 1～1.5 ms，再重试同一笔，直到本次写操作的默认 25 ms 重试窗口结束。前一笔页写后的内部擦写若使下一笔暂时 NACK，这个重试环负责恢复；持续失败最终返回 `-ETIMEDOUT`。

如果第一笔 8 字节已经成功、第二笔 4 字节最终失败，`at24_write()` 会沿原调用链返回错误，但**不会撤销第一笔**。因此失败不能解释为“12 字节一个都没写”，成功后也要读回目标区域，而不能只看命令退出状态。

### 一次实际写读实验应观察什么

先备份整颗实验器件，再写目标区域。shell 变量 `EEPROM` 保存设备路径以避免重复输入；`dd` 的 `if` 是输入、`of` 是输出，`bs=1` 让 `seek` 和 `skip` 以字节计，`conv=notrunc` 防止输出文件被截断，`status=none` 只隐藏 dd 的状态统计而不屏蔽错误。`wc -c` 统计备份字节数，`hexdump -C` 同时显示十六进制和 ASCII，`cmp -l` 用 1 起始的十进制位置列出差异。命令需要目标板上的 `dd`、`hexdump`、`cmp` 和足够的文件权限。

```bash
EEPROM=/sys/bus/i2c/devices/1-0050/eeprom

dd if="$EEPROM" of=at24c02c.before.bin bs=256 count=1 status=none
wc -c at24c02c.before.bin

printf 'Hello-EEPROM' | dd of="$EEPROM" bs=1 seek=16 conv=notrunc status=none
dd if="$EEPROM" bs=1 skip=16 count=12 status=none | hexdump -C

dd if="$EEPROM" of=at24c02c.after.bin bs=256 count=1 status=none
cmp -l at24c02c.before.bin at24c02c.after.bin
```

备份文件应为 256 字节。读回区域的预期显示为：

```text
00000000  48 65 6c 6c 6f 2d 45 45  50 52 4f 4d              |Hello-EEPROM|
0000000c
```

`48 65 6c 6c 6f` 是 `Hello`，`2d` 是连字符，后 6 字节是 `EEPROM`；末尾 `0000000c` 表示本次输出共 12 字节，不是 EEPROM 内容。`printf` 不追加换行，所以这里验证的是 12 个可见字节，没有写入 `\0` 或 `\n`。

最后的整片比较用于检查边界外是否被改动。`cmp -l` 若报告差异，位置只能落在十进制 17～28，因为位置 17 对应偏移 `0x10`，位置 28 对应 `0x1b`；若原位置的字节已经与新字节相同，相应行可以不出现。出现范围外差异说明实验假设或写入路径有问题，应停止继续写并依据备份追查。`cmp` 返回 0 表示完全相同、1 表示有差异，两者都不能单独代替上述位置检查。

读取走的是另一条回调组合，但仍使用同一批对象：`bin_attr_nvmem_read()` 根据 `pos=16` 和 `count=12` 调用 `nvmem_reg_read()`，再进入 `at24_read()`。at24 加同一把锁，经 `at24_regmap_read()` 调用 `regmap_bulk_read()`；regmap-i2c 构造两个 `i2c_msg`，第一个写内部地址 `0x10`，第二个带 `I2C_M_RD` 读 12 字节，并以一次 `i2c_transfer(..., 2)` 提交。两条消息之间使用 Repeated START，中间没有 STOP，从而先定位再读取。读成功后，NVMEM 文件回调返回 12，shell 才得到上面的 12 字节。

## <span class="blue"> 路径二：解绑后用 /dev/i2c 自己完成同一笔写入

### 为什么先解绑，锁又保护了谁

`/dev/i2c-1` 是 i2c-dev 为 I2C1 控制器提供的字符设备。打开它得到的文件描述符起初只关联控制器；执行 `I2C_SLAVE` 后，i2c-dev 为这次打开保存一个匿名 `i2c_client`，记录后续 `read()`、`write()` 使用的器件地址。`I2C_RDWR` 的消息自身带地址，可以直接提交给控制器。字符设备、匿名 client 和 at24 的正式 client 是不同对象。

两条路径不能在本实验中同时操作同一芯片。用两个具体操作序列看状态差异：进程 A 经 sysfs 写 8 字节时持有 `at24_data.lock`，进程 B 经 sysfs 读 12 字节会在同一把锁上等待，A 解锁后 B 才继续；若进程 C 经 `/dev/i2c-1` 直接发消息，它使用匿名 client，不持有也不知道这把锁，驱动无法替它排序。多主访问和并发风险不能靠“先解绑”凭空消失，本实验因此只允许一个进程、一条路径访问。

先结束所有 `eeprom` 文件读写，再在目标板 root shell 解绑：

```bash
echo 1-0050 > /sys/bus/i2c/drivers/at24/unbind
test ! -e /sys/bus/i2c/devices/1-0050/eeprom && echo "at24 interface removed"
```

解绑触发设备管理资源回收：NVMEM 核心移除兼容 `eeprom` 文件并注销 `nvmem_device`，at24 的 `at24_data`、锁和 regmap 随设备资源释放，正式 client 与 at24 的绑定关系解除。设备树描述的 client 并未从硬件世界消失，所以之后还能重新绑定。不要使用 `I2C_SLAVE_FORCE` 绕过占用检查与仍绑定的驱动并发访问。

### 完整 C 程序：页切分、写等待、复合读和返回值

下面程序是本篇原创的完整用户态示例，不是内核源码节选。它保存为 `at24c02c_rw.c`，在与前文相同的受控条件下运行：总线 `/dev/i2c-1`、器件 `0x50`、页大小 8、偏移 `0x10`、数据 12 字节。程序先用 `open()` 和 `O_RDWR` 以读写方式打开总线并设置 `I2C_SLAVE`，每轮计算当前页剩余空间，调用页写函数，再做 ACK 轮询；全部写完后用 `I2C_RDWR` 复合读回并逐字节比较。代码中的 `uint8_t` 是无符号 8 位字节，`size_t` 表示缓冲区长度，`ssize_t` 则能同时表示非负返回长度和负错误。

ACK 轮询是在写周期内重复尝试器件写地址，收到应答就认为内部擦写结束。这里用零长度 `write()` 产生探测：i2c-dev 的写路径会进入 `i2c_master_send()`，成功与否仍取决于控制器是否支持零长度消息。若返回 `EINVAL`（参数或消息形式不被接受）或 `EOPNOTSUPP`（操作不受支持），程序无法据此判断器件状态，明确回退为等待数据手册的最大写周期 5 ms；其他失败在 25 ms 总上限内重试，超时返回错误。这个时间上限包含传输和调度耗时，不是“100 次睡眠精确等于 5 ms”。

```c
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define I2C_BUS             "/dev/i2c-1"
#define DEV_ADDR            0x50
#define START_ADDR          0x10
#define PAGE_SIZE           8
#define WRITE_TIMEOUT_NS    (25LL * 1000 * 1000)
#define WRITE_CYCLE_NS      (5LL * 1000 * 1000)
#define POLL_INTERVAL_NS    (200LL * 1000)

static int64_t monotonic_ns(void)
{
    struct timespec ts;

    if (clock_gettime(CLOCK_MONOTONIC, &ts) < 0)
        return -1;
    return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

static int sleep_ns(long ns)
{
    struct timespec req = {
        .tv_sec = ns / 1000000000L,
        .tv_nsec = ns % 1000000000L,
    };

    while (nanosleep(&req, &req) < 0) {
        if (errno != EINTR)
            return -1;
    }
    return 0;
}

/* 成功返回 0；零长度消息不可用时固定等待 5 ms；失败返回 -1。 */
static int at24_wait_ready(int fd)
{
    int64_t start = monotonic_ns();

    if (start < 0)
        return -1;

    for (;;) {
        ssize_t ret = write(fd, NULL, 0);
        int64_t now;

        if (ret >= 0)       /* 零长度探测的成功返回值不保证是 0 */
            return 0;
        if (errno == EINVAL || errno == EOPNOTSUPP)
            return sleep_ns(WRITE_CYCLE_NS);

        now = monotonic_ns();
        if (now < 0)
            return -1;
        if (now - start >= WRITE_TIMEOUT_NS) {
            errno = ETIMEDOUT;
            return -1;
        }
        if (sleep_ns(POLL_INTERVAL_NS) < 0)
            return -1;
    }
}

/* 写一页内的 len 字节；线上还要先发送 1 字节内部地址。 */
static int at24_write_page(int fd, uint8_t mem_addr,
                           const uint8_t *data, size_t len)
{
    uint8_t buf[PAGE_SIZE + 1];
    ssize_t ret;

    if (len == 0 || len > PAGE_SIZE ||
        (mem_addr % PAGE_SIZE) + len > PAGE_SIZE) {
        errno = EINVAL;
        return -1;
    }

    buf[0] = mem_addr;
    memcpy(buf + 1, data, len);

    do {
        ret = write(fd, buf, len + 1);
    } while (ret < 0 && errno == EINTR);

    if (ret < 0)
        return -1;
    if ((size_t)ret != len + 1) {
        errno = EIO;        /* 部分完成不能使用可能陈旧的 errno */
        return -1;
    }
    return at24_wait_ready(fd);
}

/* 随机读：写内部地址 + Repeated START + 读 len 字节。 */
static int at24_read(int fd, uint8_t mem_addr, uint8_t *buf, uint16_t len)
{
    struct i2c_msg msgs[2] = {
        {
            .addr = DEV_ADDR,
            .flags = 0,
            .len = 1,
            .buf = &mem_addr,
        },
        {
            .addr = DEV_ADDR,
            .flags = I2C_M_RD,
            .len = len,
            .buf = buf,
        },
    };
    struct i2c_rdwr_ioctl_data rdwr = {
        .msgs = msgs,
        .nmsgs = 2,
    };
    int ret;

    do {
        ret = ioctl(fd, I2C_RDWR, &rdwr);
    } while (ret < 0 && errno == EINTR);

    if (ret < 0)
        return -1;
    if (ret != 2) {         /* 成功值是完成的消息数，不是读取字节数 */
        errno = EIO;
        return -1;
    }
    return 0;
}

int main(void)
{
    static const uint8_t data[] = "Hello-EEPROM";
    const size_t total = sizeof(data) - 1;  /* 明确排除末尾 '\0' */
    uint8_t readback[sizeof(data) - 1];
    size_t done = 0;
    size_t i;
    int fd;
    int status = 1;

    fd = open(I2C_BUS, O_RDWR);
    if (fd < 0) {
        perror("open " I2C_BUS);
        return 1;
    }
    if (ioctl(fd, I2C_SLAVE, DEV_ADDR) < 0) {
        perror("ioctl I2C_SLAVE");  /* EBUSY：先检查是否忘记解绑 */
        goto out;
    }

    while (done < total) {
        size_t pos = START_ADDR + done;
        size_t page_left = PAGE_SIZE - (pos % PAGE_SIZE);
        size_t chunk = total - done;

        if (chunk > page_left)
            chunk = page_left;

        if (at24_write_page(fd, (uint8_t)pos, data + done, chunk) < 0) {
            perror("page write");
            goto out;
        }
        printf("page write: addr=0x%02zx, data bytes=%zu\n", pos, chunk);
        done += chunk;
    }

    if (at24_read(fd, START_ADDR, readback, total) < 0) {
        perror("compound read");
        goto out;
    }

    printf("readback:");
    for (i = 0; i < total; i++)
        printf(" %02x", readback[i]);
    putchar('\n');

    if (memcmp(data, readback, total) != 0) {
        fprintf(stderr, "verify failed: readback differs\n");
        goto out;
    }

    printf("verify OK: %.*s\n", (int)total, (const char *)readback);
    status = 0;

out:
    if (close(fd) < 0 && status == 0) {
        perror("close");
        status = 1;
    }
    return status;
}
```

复合读的 `struct i2c_msg` 字段分别承担明确任务：`addr` 是 7 位器件地址，`flags=0` 表示写、`I2C_M_RD` 表示读，`len` 是本消息字节数，`buf` 指向发送或接收缓冲区。`struct i2c_rdwr_ioctl_data` 的 `msgs` 指向这两条消息的数组，`nmsgs=2` 告诉 `ioctl()` 消息数量；把两条消息放在同一次 `I2C_RDWR` 中，内核才会用 Repeated START 连接它们。

程序中的三个长度判断对应三种不同结果。页写的 `write()` 必须返回 `chunk + 1`，因为返回值包含内部地址字节；复合读的 `ioctl()` 必须返回 2，因为提交了两条消息；最后的 `memcmp()` 只比较 `sizeof(data)-1` 即 12 字节，避免把字符串字面量的终止符写进 EEPROM。`errno` 是 C 库保存失败原因的错误码，`perror()` 据此打印错误；`EINTR` 表示调用被信号中断并可重试，部分完成被显式转成 `EIO` 输入/输出错误，轮询超时被转成 `ETIMEDOUT`，地址仍被驱动占用时可能出现 `EBUSY`。这样就不会用 `perror()` 打印与本次失败无关的旧错误。

`at24_wait_ready()` 用 `CLOCK_MONOTONIC` 计算经过时间，避免系统日历调整影响超时。零长度探测在 i2c-dev 中经 `i2c_master_send()` 返回底层结果，所以代码接受任意非负值，而不是误写成只有返回 0 才成功。固定 5 ms 回退只覆盖“控制器拒绝零长度消息”这一情况；它不是对所有传输错误的统一掩盖，25 ms 超时和最终读回仍然保留。

交叉编译需要 ARM 64 位（AArch64）工具链和 Linux 用户空间 API（UAPI）头文件，工具链使用的 C 库与头文件须和目标系统匹配。`I2C_SLAVE`、`I2C_RDWR`、`struct i2c_msg` 和 `struct i2c_rdwr_ioctl_data` 都由这些头文件声明。以下命令在构建机执行，编译选项启用 C11、优化和常用警告，`-Werror` 把警告当作错误，`-o` 指定输出文件；`scp` 把程序复制到目标板，地址和路径按实际环境替换：

```bash
aarch64-linux-gnu-gcc -std=c11 -O2 -Wall -Wextra -Werror \
    -o at24c02c_rw at24c02c_rw.c
scp at24c02c_rw root@<板子IP>:/tmp/
```

确认 at24 已解绑后，在目标板运行：

```bash
/tmp/at24c02c_rw
echo $?
```

符合本实例的预期输出为：

```text
page write: addr=0x10, data bytes=8
page write: addr=0x18, data bytes=4
readback: 48 65 6c 6c 6f 2d 45 45 50 52 4f 4d
verify OK: Hello-EEPROM
0
```

前两行直接证明软件把 12 字节拆成 8＋4，第三行是实际读回值，第四行只在 12 字节全部一致后出现，最后的 `0` 是进程退出状态。若第二笔失败，第一笔可能已写入，程序同样不会回滚；此时不能只根据退出状态推断芯片内容，仍须读取目标区域并参考实验前备份。

## <span class="blue"> 重绑并区分软件状态与存储内容

用户程序 `close(fd)` 后，这次打开对应的匿名 client 和文件描述符生命周期结束，I2C 控制器及设备树中的正式 client 仍然存在。重新绑定 at24：

```bash
echo 1-0050 > /sys/bus/i2c/drivers/at24/bind
test -e /sys/bus/i2c/devices/1-0050/eeprom && echo "at24 interface restored"
dd if=/sys/bus/i2c/devices/1-0050/eeprom bs=1 skip=16 count=12 status=none | hexdump -C
```

bind 让 at24 再次执行 probe，创建的是一份**新的** `at24_data`、锁、regmap 和 NVMEM 注册关系，`eeprom` 文件也随之重新出现。旧锁不会在解绑后继续保护什么，旧驱动状态也不会传给新实例；但 EEPROM 阵列是非易失存储，软件对象销毁不会擦除 `0x10～0x1b`。最后一次读取若仍为 `Hello-EEPROM`，验证的是“内容跨解绑/重绑保留”，而不是“旧驱动对象仍然存在”。

这也收清了两条路径的边界：at24/sysfs 的页切分、写失败重试和同实例互斥由内核完成，适合产品长期访问；`/dev/i2c` 把这些责任交还给应用，适合受控原型验证。机制层面，本篇用 v6.6 源码逐段核对对象、调用链和返回值；系统集成层面，只给出 DTS/DTB 构建与 BSP 部署的衔接点，没有虚构某种 RK3568 板卡的固定烧录路径。扫描、仪器波形和更广泛的故障树仍由 B-B.3.4 承担。

## <span class="blue"> 本节总结

这笔 12 字节写入的关键不是记住两个工具命令，而是看清同一条约束在两个实现中的落点：真实 8 字节页使传输必须拆成 8＋4，写周期使下一笔可能需要等待或重试，读回与边界比较才构成结果验证。标准器件优先使用 at24/NVMEM；只有在明确隔离驱动访问的受控环境中，才由 `/dev/i2c` 程序自行承担这些责任。解绑和重绑改变的是内核对象及其接口，不会自动改变芯片里的字节。

## <span class="blue"> 本节自查

??? details "Q1. 为什么从 `0x10` 写 `Hello-EEPROM` 必须拆成 8＋4，而不能声明 16 字节页一次写完？"
    AT24C02C 的真实页大小是 8 字节。第一页写从 `0x10` 到页尾 `0x17` 正好容纳 8 字节，剩余 4 字节必须从下一页的 `0x18` 另起一笔。若一次发送 12 字节，后 4 字节会回卷到 `0x10～0x13`；把设备树页大小错写成 16 会让 at24 允许这种危险传输。漏写 `pagesize` 在 v6.6 中则退为每次 1 字节，通常是慢而不是回卷。

??? details "Q2. `eeprom` 文件从哪里来？client、`at24_data`、regmap 和 NVMEM 怎样关联？"
    I2C 核心根据设备树创建 `i2c_client`，匹配后调用 `at24_probe()`。probe 先创建与 client 关联的 regmap，再创建保存容量、页大小、锁和 regmap 指针的 `at24_data`，随后把 `at24_read`、`at24_write` 和 `priv=at24` 填进 NVMEM 配置。`devm_nvmem_register()` 创建 NVMEM 设备，NVMEM 核心通过 `device_create_bin_file()` 在 `1-0050` 目录生成 `eeprom`，所以文件位置能沿回调进入 at24 并变成内部偏移。

??? details "Q3. 一次 sysfs 写 12 字节时，各层返回值分别是什么意思？若第二笔失败能否认为全部未写？"
    regmap-i2c 完整发送后返回 0，`at24_regmap_write()` 返回本笔完成字节数，`at24_write()` 全部循环完成后返回 0，NVMEM 文件回调最终向用户返回 12。第二笔失败时错误沿原链返回，但第一笔 8 字节已经可能永久写入，驱动不提供整笔 12 字节的事务回滚，所以必须读回判断实际内容。

??? details "Q4. at24 是在每次成功写后固定等待 5 ms 吗？写周期与页切分分别位于哪里？"
    不是。`at24_adjust_write_count()` 在每次 `at24_regmap_write()` 前按当前偏移和页大小缩短本笔长度，`at24_write()` 再推进偏移和剩余长度。写失败时，`at24_regmap_write()` 睡眠约 1～1.5 ms 并重试同一笔，默认窗口为 25 ms；成功发送后不额外固定睡 5 ms。这个重试环处理前一笔内部擦写导致的暂时 NACK。

??? details "Q5. 为什么这次读 12 字节不需要按 8 字节拆页？内核和用户态怎样完成定位与读取？"
    页边界是页写时内部地址计数器回卷的限制，顺序读可以从 `0x17` 继续到 `0x18`。两条读路径都先发一条写消息设置内部地址 `0x10`，再以 Repeated START 接一条 12 字节读消息。内核由 regmap-i2c 构造两个 `i2c_msg` 并调用 `i2c_transfer(..., 2)`，用户态由 `I2C_RDWR` 提交同类消息组。

??? details "Q6. at24 的锁能否保护 `/dev/i2c` 的匿名访问？解绑和重绑分别改变什么？"
    不能。两个 sysfs 参与者会经同一 `at24_data.lock` 串行化，而 `/dev/i2c` 的匿名 client 不持有这把锁。解绑会移除 `eeprom`、注销 NVMEM 并释放 at24 运行状态，关闭用户文件描述符会结束对应匿名 client；重绑会重新 probe 并创建新状态。设备树 client 可以保留，EEPROM 内容也不会因这些软件对象销毁而清除，所以实验必须隔离并发，重绑后仍应能读到原数据。

??? details "Q7. 用户态程序为什么分别检查 `chunk + 1`、2 和 12 字节？ACK 轮询有哪些平台边界？"
    页写 `write()` 的返回长度包含 1 字节内部地址，所以应等于 `chunk + 1`；复合读 `ioctl()` 返回完成的消息数，两条消息应返回 2；最终内容比较只针对 12 个有效数据字节，不包含 `\0`。零长度 ACK 探测仍要经过 `i2c_master_send()` 和控制器，若平台以 `EINVAL` 或 `EOPNOTSUPP` 拒绝零长度消息，程序固定等待 5 ms 作为回退，并保留 25 ms 错误上限和最终读回验证。
