# B-B.3.5 实战：AT24C02 EEPROM 端到端读写

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] | 预计阅读时间：60 分钟

## <span class="blue"> 本节导读

本篇只回答一个问题：**在 RK3568 的 I2C1 上，把 `Hello-EEPROM` 的 12 个字节写入 AT24C02C 的内部偏移 `0x10` 并读回时，数据为什么会拆成 8＋4，内核与用户程序分别在哪里完成切分、等待和验证？**

贯穿实例固定如下，后文不再更换器件、地址或数据：

- 器件：Microchip **AT24C02C**，容量 256 字节，32 页，每页 8 字节；本文依据 DS20006111B 手册和 Linux v6.6 源码。
- 总线与地址：RK3568 I2C1，7 位器件地址 `0x50`；EEPROM 内部起始偏移 `0x10`。
- 数据：`Hello-EEPROM`，不含 C 字符串末尾的 `\0`，共 12 字节。
- 正确写入：第一笔向 `0x10` 写 `Hello-EE` 8 字节，第二笔向 `0x18` 写 `PROM` 4 字节。
- 正确读取：从 `0x10` 一次顺序读 12 字节，再与期望内容逐字节比较。

EEPROM 是可电擦写、按字节读取且掉电保存内容的存储器。“器件地址”用来在 I2C 总线上选中芯片；“内部偏移”用来选中芯片阵列里的一个字节。前者是 `0x50`，后者从 `0x10` 开始，两者不能相加或拼接成一个所谓“8 位地址”。

正常产品优先走 **at24 → NVMEM → sysfs**：内核驱动负责页切分、失败重试和同实例互斥，NVMEM 把非易失存储统一成读写接口，sysfs 再以文件形式导出内核设备对象与属性，本例得到 `eeprom` 文件。另一条 `/dev/i2c` 路径只用于**停止业务并解绑 at24 后的受控对照**，由应用自己承担同样的责任。两条路径不同时访问芯片。

开漏、电平和时序参数前置在 B-B.3.1；START、STOP、ACK 和消息格式前置在 B-B.3.2；`i2c_client`、`i2c_msg` 和控制器框架前置在 B-B.3.3；扫描与通用故障树归 B-B.3.4。本篇把这些已有概念落到一颗真实器件和一笔完整读写上。

> ⚠️ **安全与验证边界**：只写可擦写的独立实验 EEPROM，先备份整片。不要对内存条 SPD、量产配置区或身份不明的 `0x50` 器件执行本文命令。下文 shell 与程序输出全部是依据源码、手册和命令语义构造的**预期示例，不是实测记录**。本环境未编译用户程序、未构建或部署 DTB，也未上板读写 EEPROM。

## <span class="blue"> 先读手册：这笔写入为什么是 8＋4

### 型号、封装和地址不能靠系列名猜

“AT24C02”常被当作 2 Kbit 器件的统称，但不同厂商、后缀和封装可能采用不同页大小与写保护细节。本文只讨论手册明确的 AT24C02C：2 Kbit 等于 256 字节，内部偏移范围 `0x00～0xff`，使用 8 位 word address，即 1 字节内部偏移。

若使用带 A2、A1、A0 引脚的封装，将三者接地可得到 7 位地址 `0x50`。但若使用 **SOT-23 封装**，手册明确说明 A2～A0 没有可从外部访问的引脚，而是在内部下拉；软件发送的这三个地址位必须为 `000`。因此不能看到“板上有地址脚”的旧经验，就给 SOT-23 器件虚构可配置地址。实际原理图和封装必须先核对。

WP 是硬件写保护引脚。本实验要求 WP 处于手册允许写入的电平。一个容易漏掉的边界是：**WP 为高时，AT24C02C 仍可应答器件地址、内部偏移和数据字节，但 STOP 后不启动内部写周期。**所以“所有字节都有 ACK”不等于“阵列已经改变”，任何写入最终都要读回。

### 页写只递增页内地址，跨界会回卷

一次页写并不是把任意长数据顺序铺到后续页。AT24C02C 在接收页写数据时只递增内部地址的低 3 位，高位不变；到达本页页尾后，下一个字节回到本页页首。

主实例的两笔正确传输是：

```text
第一笔：写器件 0x50，发送内部偏移 0x10，再发送 48 65 6c 6c 6f 2d 45 45
         数据： H  e  l  l  o  -  E  E       共 8 字节，落在 0x10～0x17

等待前一笔内部写周期结束，再发起第二笔

第二笔：写器件 0x50，发送内部偏移 0x18，再发送 50 52 4f 4d
         数据： P  R  O  M                   共 4 字节，落在 0x18～0x1b
```

如果错误地把 12 个数据字节塞给同一笔页写，芯片不会返回“跨页错误”，而会依次执行：

```text
先接收前 8 字节：0x10～0x17 ← H e l l o - E E
再接收后 4 字节：0x10～0x13 ← P R O M       （回卷并覆盖）
最终 0x10～0x17：P R O M o - E E
最终 0x18～0x1b：保持旧值，没有收到 P R O M
```

所以最终读回是 `PROMo-EE`，不是 `Hello-EEPROM`。软件必须在发送前切分，不能期待器件替软件报告这个逻辑错误。

页限制也不约束本次读取。手册的顺序读会持续递增内部地址，可以从 `0x17` 继续到 `0x18`；因此后文读 12 字节不再拆页。随机读的“dummy write”只发送内部偏移，不发送数据，也不发 STOP；随后用 Repeated START 接读方向地址，开始读取。

### 过去“不分页也成功”，并不推翻手册

以下情况都可能让旧代码看似没有分页也成功，但它们不能证明可以跨页：

1. 实际一次只写一个字节，每次写后重新发送偏移，自然没有页内回卷。
2. 数据虽然较长，但这次没有越过页尾；例如从 `0x10` 写 4 字节。
3. 调用的现成驱动或库已经在内部切分，调用者只看见一次高层 API。
4. 换过其他厂商、容量或型号的器件，其页规则与本例不同。

因此，判断本例是否安全要同时看**真实型号、当前内部偏移和这一次实际发送长度**，不能用“以前跑过”替代手册。

## <span class="blue"> 让硬件描述进入内核：DTS、配置与对象建链

### DTS 提供硬件事实，不提供通用板卡路径

设备树源文件 DTS 描述板级硬件，编译后的 DTB 在启动时交给内核。本篇原创片段保存为 [rk3568-at24c02c.dts](./code/B-B.3.5/rk3568-at24c02c.dts)，应合并进 BSP 中实际启用 I2C1 的板级 DTS。BSP 是板级支持包，包含内核源码、板级配置、构建和部署流程；不存在适用于所有 RK3568 板卡的固定 DTS 文件名或烧录分区。

```dts title="code/B-B.3.5/rk3568-at24c02c.dts；板级片段，不能独立部署"
&i2c1 {
    status = "okay";

    eeprom@50 {
        compatible = "atmel,24c02";
        reg = <0x50>;
        pagesize = <8>;
    };
};
```

`&i2c1` 引用芯片级 DTSI 已有的控制器节点，`status = "okay"` 启用它。子节点的 `reg` 是 7 位器件地址，`compatible` 是驱动匹配键。Linux v6.6 的 at24 匹配表和 [at24.yaml](./code/B-B.3.5/linux-v6.6/Documentation/devicetree/bindings/eeprom/at24.yaml) 都接受 `atmel,24c02`，它对应 256 字节容量和 8 位内部地址；不要根据芯片表面的 Microchip 商标虚构 `microchip,at24c02c`。

`pagesize = <8>` 来自手册，不是驱动自动测得。v6.6 `at24_probe()` 调 `device_property_read_u32(dev, "pagesize", &page_size)` 读取该属性；读取失败时把 `page_size` 设为 1，以较慢的单字节写求安全。把它错填成 16 则会允许驱动发起危险跨页传输，不能为了“批量更快”调大。

仅有 DTS 还不够。Kconfig 是描述内核配置项及其依赖、自动选择关系的机制。v6.6 [Kconfig](./code/B-B.3.5/linux-v6.6/drivers/misc/eeprom/Kconfig) 中 `EEPROM_AT24` 依赖 `I2C && SYSFS`，并选择 `NVMEM`、`NVMEM_SYSFS`、`REGMAP`、`REGMAP_I2C`。在目标内核源码树顶层用 `make menuconfig` 搜索 `EEPROM_AT24` 并启用，再检查生成配置、构建 DTB：

```bash title="在目标 BSP 内核源码树执行；工具链前缀按环境替换"
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- menuconfig
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- dtbs
grep -E 'CONFIG_(I2C|SYSFS|EEPROM_AT24|NVMEM|NVMEM_SYSFS|REGMAP|REGMAP_I2C)=' .config
```

`.config` 在这里用于核验配置结果，不建议手工编辑后跳过配置依赖计算。`y` 表示编入内核，`m` 表示模块；若为 `m`，还要部署与运行内核严格匹配的 `at24.ko`。`dtbs` 只构建 DTB，**不等于已经部署**；选择哪个 DTB、更新哪个启动镜像以及如何回滚，按具体 BSP 流程处理，这属于系统集成，不是 at24 算法。

### probe 把五个对象连成一条链

新 DTB 生效后，I2C 核心根据节点创建 `i2c_client`，将控制器对应的 `i2c_adapter`、地址 `0x50` 和设备树节点关联起来。设备名通常为 `1-0050`：`1` 是总线编号，`0050` 是十六进制地址。通用匹配规则归 B-B.3.3 与第 11 章，这里只跟 at24 的初始化。

`at24_probe(client)` 首先创建 regmap。regmap 把“寄存器地址＋值”的访问转换为具体总线操作；在本例中，“寄存器地址”就是 EEPROM 内部偏移，值是 8 位字节，偏移也是 8 位。随后创建本次绑定私有的 `at24_data`：

```c title="Linux v6.6 drivers/misc/eeprom/at24.c:71-96"
struct at24_data {
    struct mutex lock;          /* 串行化经本实例进入的读写 */
    unsigned int write_max;     /* 单次写上限；本例为 8 */
    unsigned int num_addresses;
    unsigned int offset_adj;
    u32 byte_len;               /* 容量；本例为 256 */
    u16 page_size;              /* 硬件页大小；本例为 8 */
    u8 flags;
    struct nvmem_device *nvmem; /* 注册后的 NVMEM 对象 */
    struct regulator *vcc_reg;
    void (*read_post)(unsigned int off, char *buf, size_t count);
    u8 bank_addr_shift;
    struct regmap *client_regmaps[]; /* [0] 指向本 client 的 regmap */
};
```

这里删去了原结构体中的注释以聚焦字段，字段定义未改。`mutex` 是内核互斥锁；`u8/u16/u32` 分别是 8/16/32 位无符号整数。probe 的关键赋值顺序是：

```c title="Linux v6.6 drivers/misc/eeprom/at24.c:671-701；省略错误分支和其他字段"
regmap_config.val_bits = 8;
regmap_config.reg_bits = (flags & AT24_FLAG_ADDR16) ? 16 : 8;
regmap_config.disable_locking = true;  /* 由 at24->lock 统一保护本实例 */
regmap = devm_regmap_init_i2c(client, &regmap_config);

at24 = devm_kzalloc(dev, struct_size(at24, client_regmaps, num_addresses),
                    GFP_KERNEL);
mutex_init(&at24->lock);
at24->byte_len = byte_len;
at24->page_size = page_size;
at24->client_regmaps[0] = regmap;
at24->write_max = min_t(unsigned int, page_size, at24_io_limit);
```

`devm_kzalloc()` 分配并清零设备管理内存，`GFP_KERNEL` 是允许分配过程睡眠的普通内核内存分配标志，`struct_size()` 把尾部 `client_regmaps[]` 柔性数组所需空间一并计算。`at24_io_limit` 默认 128，与页大小 8 取小，所以 `write_max=8`。`disable_locking=true` 不是“整个驱动无锁”，而是不让 regmap 再加一把自己的锁，外层 `at24->lock` 负责同一实例的读写顺序。

接着 probe 填 `nvmem_config`，再注册 NVMEM：

```c title="Linux v6.6 drivers/misc/eeprom/at24.c:731-759；保留本例关键关系"
nvmem_config.type = NVMEM_TYPE_EEPROM;
nvmem_config.dev = dev;
nvmem_config.compat = true;
nvmem_config.base_dev = dev;
nvmem_config.reg_read = at24_read;
nvmem_config.reg_write = at24_write;
nvmem_config.priv = at24;
nvmem_config.stride = 1;
nvmem_config.word_size = 1;
nvmem_config.size = byte_len;

i2c_set_clientdata(client, at24);
at24->nvmem = devm_nvmem_register(dev, &nvmem_config);
```

`reg_read/reg_write` 是 NVMEM 调向驱动的函数指针；`priv` 是调用时原样传回的私有参数，因此 `at24_write(void *priv, ...)` 能取回这份 `at24_data`。`size=256` 限制文件容量，`compat=true` 与 `base_dev=dev` 要求在原 I2C 设备目录生成兼容文件。`i2c_set_clientdata()` 同时让正式 client 能找回这份 at24 状态。

NVMEM 核心随后执行 `nvmem_sysfs_setup_compat()`，由 `device_create_bin_file()` 创建 `eeprom`。对象关系由此闭合：

```text
设备树节点 → i2c_client（1-0050）
                 ├─ regmap：把偏移＋数据转成 I2C 访问
                 └─ at24_data：容量、页大小、锁、regmap 指针
                                      ↑
NVMEM 配置 priv ───────────────────────┘
NVMEM reg_read/reg_write → at24_read/at24_write
NVMEM compat/base_dev → /sys/bus/i2c/devices/1-0050/eeprom
```

`devm_` 前缀表示设备管理资源。probe 失败或设备解绑时，内核按登记关系释放 regmap、`at24_data` 和 NVMEM 注册；NVMEM 的 `nvmem_device_release()` 会删除兼容 `eeprom` 文件。对象创建与销毁都不直接擦除芯片阵列。

### 先检查绑定，再允许任何写入

以下命令在目标板 root shell 执行。`readlink -f` 展开驱动链接，`test -e` 检查入口，`dmesg` 查看内核日志：

```bash
readlink -f /sys/bus/i2c/devices/1-0050/driver
test -e /sys/bus/i2c/devices/1-0050/eeprom && echo "eeprom exists"
dmesg | grep -E 'at24|24c02|1-0050'
```

符合本配置的预期格式为：

```text
/sys/bus/i2c/drivers/at24
eeprom exists
at24 1-0050: 256 byte 24c02 EEPROM, writable, 8 bytes/write
```

第一行证明 client 当前绑定 at24，第二行证明 NVMEM 兼容文件存在，第三行的容量、可写状态和 8 字节单次写上限与配置一致。任何一项不符，都先核对运行 DTB、内核配置、供电和 probe 日志，**不要直接改用强制用户态访问绕过问题**。

## <span class="blue"> 先做完产品实验：备份、写读、边界比较、恢复

### 备份不足 256 字节就必须停止

`dd` 的 `if/of` 是输入与输出，`bs=1` 让 `skip/seek` 以字节计，`conv=notrunc` 避免截断输出文件，`status=none` 只隐藏统计而不屏蔽错误。`hexdump -C` 同时显示十六进制和 ASCII。下面命令在目标板的 root **Bash** 中执行，要求系统提供 `dd`、`wc`、`hexdump`、`cmp` 和 `awk`；`pipefail` 是 Bash 选项，不要直接复制到不支持它的极简 `sh`。

```bash title="产品路径完整实验；任一硬检查失败即停止"
set -euo pipefail
EEPROM=/sys/bus/i2c/devices/1-0050/eeprom
BEFORE=at24c02c.before.bin
AFTER=at24c02c.after.bin
DIFF=at24c02c.diff

# 入口必须存在；整片备份必须恰好 256 字节。
test -e "$EEPROM"
dd if="$EEPROM" of="$BEFORE" bs=256 count=1 status=none
test "$(wc -c < "$BEFORE")" -eq 256 || {
    echo "backup is not 256 bytes; stop" >&2
    exit 1
}

# 写 12 字节并读回；printf 不追加换行或字符串终止符。
printf 'Hello-EEPROM' | dd of="$EEPROM" bs=1 seek=16 conv=notrunc status=none
dd if="$EEPROM" bs=1 skip=16 count=12 status=none | hexdump -C

# 再备份整片，比较实验前后，防止页回卷或越界改动其他位置。
dd if="$EEPROM" of="$AFTER" bs=256 count=1 status=none
test "$(wc -c < "$AFTER")" -eq 256
set +e
cmp -l "$BEFORE" "$AFTER" > "$DIFF"
cmp_status=$?
set -e
test "$cmp_status" -le 1 || {
    echo "cmp failed; stop" >&2
    exit "$cmp_status"
}
cat "$DIFF"
if awk 'NF && ($1 < 17 || $1 > 28) { bad=1 } END { exit bad ? 0 : 1 }' "$DIFF"; then
    echo "difference outside EEPROM offsets 0x10..0x1b; stop" >&2
    exit 1
fi
```

`set -e` 让未显式处理的命令失败立即中止，`set -u` 拒绝未定义变量，`pipefail` 则防止 `dd` 读取失败却被管道末端 `hexdump` 的成功状态掩盖。`cmp` 是例外：返回 0 表示完全相同，返回 1 表示有差异，两者都是正常执行；所以脚本暂时关闭 `set -e` 保存状态，只有大于 1 才按比较工具失败处理。`cmp -l` 的位置是**十进制、从 1 开始**，位置 17～28 才对应 EEPROM 偏移 `0x10～0x1b`。`awk` 发现范围外差异时返回 0 进入报警分支；没有发现时返回 1，但因为处于 `if` 条件中，不会被 `set -e` 当成脚本错误。

目标区域预期显示：

```text
00000000  48 65 6c 6c 6f 2d 45 45  50 52 4f 4d              |Hello-EEPROM|
0000000c
```

末尾 `0000000c` 是本次输出的 12 字节计数，不是 EEPROM 内容。整片比较允许目标区域内某些行不出现，因为原字节可能恰好与新字节相同；但不允许任何位置超出 17～28。若第二笔失败，第一笔仍可能已经写入，不能根据 `dd` 或驱动错误推断“12 字节全部未写”。

### 需要恢复时，用备份写回并再次整片比较

只有确认 `BEFORE` 是本次实验前取得的 256 字节完整备份，才执行恢复。恢复会覆盖整颗实验 EEPROM，不适用于含其他业务数据的器件：

```bash title="受控恢复；仍要求 at24 绑定且没有其他访问者"
test "$(wc -c < "$BEFORE")" -eq 256
dd if="$BEFORE" of="$EEPROM" bs=256 count=1 conv=notrunc status=none
dd if="$EEPROM" of=at24c02c.restored.bin bs=256 count=1 status=none
cmp "$BEFORE" at24c02c.restored.bin && echo "restore verified"
```

最后 `cmp` 返回 0 才打印 `restore verified`。若写入或读回失败，保留现场与日志，不要反复擦写；WP 高电平、持续 NACK、错误页大小和供电问题分别需要按手册与 B-B.3.4 的方法继续定位。

## <span class="blue"> 再拆内核路径：dd 怎样变成两笔页写

### 完整调用链和四个返回值

前面的产品实验已经给出可观察结果，现在把同一次 `dd` 写 12 字节逐层展开：

```text
dd：pos=0x10，count=12，buf="Hello-EEPROM"
→ sysfs/kernfs 找到 eeprom 二进制属性
→ bin_attr_nvmem_write()             检查容量、对齐、reg_write
→ nvmem_reg_write()                  经 priv 取回 at24_data
→ at24_write()                       持锁，循环推进 buf/off/count
→ at24_regmap_write()                调页切分，失败时等待并重试
→ at24_adjust_write_count()          第一轮 8，第二轮 4
→ regmap_bulk_write()                按 8 位值组织 bulk write
→ _regmap_raw_write_impl()           本例把内部偏移与数据线性拼接
→ regmap_i2c_write()                 i2c_master_send()
→ RK3x 控制器                        第一笔 0x10＋8B，第二笔 0x18＋4B
```

`bin_attr_nvmem_write()` 的 `pos` 是文件位置，`count` 是本次请求长度。它确认 `reg_write` 存在后调用 `nvmem_reg_write()`；probe 时登记的函数指针和 `priv` 在这里生效。它不负责页切分。

各层返回值必须分开读：

- `regmap_i2c_write()`：`i2c_master_send()` 完整发送 `count` 字节后返回 **0**，短写转成 `-EIO`。
- `at24_regmap_write()`：regmap 返回 0 后返回**本轮字节数**，第一轮 8、第二轮 4，供外层推进。
- `at24_write()`：所有轮次完成后返回 **0**，表示驱动任务成功。
- `bin_attr_nvmem_write()`：底层返回 0 后向用户返回**本次请求字节数 12**。

因此“at24 返回 0”和“dd 写入 12”不矛盾。反过来，任一层负错误会沿调用链返回，但已完成的页写不会自动回滚。

### 页切分：第一轮 8，非对齐请求还可能是 6＋2

`at24_write()` 在循环外加锁，每轮由实际完成量推进三个状态：

```c title="Linux v6.6 drivers/misc/eeprom/at24.c:491-509"
mutex_lock(&at24->lock);
while (count) {
    ret = at24_regmap_write(at24, buf, off, count);
    if (ret < 0) {
        mutex_unlock(&at24->lock);
        pm_runtime_put(dev);
        return ret;
    }
    buf += ret;
    off += ret;
    count -= ret;
}
mutex_unlock(&at24->lock);
pm_runtime_put(dev);
return 0;
```

`buf` 指向下一批待写数据，`off` 是下一笔 EEPROM 内部偏移，`count` 是剩余长度。主实例第一轮返回 8 后，三者分别前进到 `PROM`、`0x18` 和 4，第二轮自然只写 4。`pm_runtime_get_sync()/put()` 管理设备运行时电源引用，不是 EEPROM 写周期计时。

每轮写多少由下面的函数决定：

```c title="Linux v6.6 drivers/misc/eeprom/at24.c:371-386"
static size_t at24_adjust_write_count(struct at24_data *at24,
                                      unsigned int offset, size_t count)
{
    unsigned int next_page;

    if (count > at24->write_max)
        count = at24->write_max;

    next_page = roundup(offset + 1, at24->page_size);
    if (offset + count > next_page)
        count = next_page - offset;

    return count;
}
```

`roundup(x, 8)` 把 `x` 向上对齐到 8 的倍数。若请求从 `0x12` 写 8 字节，`offset+1=0x13`，下一页边界为 `0x18`，第一轮只能写 `0x18-0x12=6`；外层推进后，第二轮从 `0x18` 写剩余 2 字节。切分不是把总长度机械除以 8，而是每轮根据**当前偏移**重新计算。

### RK3568 上为什么是“线性化回退”

regmap 的 gather write 尝试把“内部偏移”和“数据”作为两条消息交给控制器，其中第二条消息需要 `I2C_M_NOSTART`：即接着前一条继续发送，不再另发 START；控制器用 `I2C_FUNC_NOSTART` 声明是否支持这种能力。但 [rk3x_i2c_func()](./code/B-B.3.5/linux-v6.6/drivers/i2c/busses/i2c-rk3x.c) 只返回 `I2C_FUNC_I2C | I2C_FUNC_SMBUS_EMUL | I2C_FUNC_PROTOCOL_MANGLING`，不包含 `I2C_FUNC_NOSTART`；所以 [regmap_i2c_gather_write()](./code/B-B.3.5/linux-v6.6/drivers/base/regmap/regmap-i2c.c) 在本例返回 `-ENOTSUPP`。这是能力协商，不是 EEPROM NACK。

regmap 核心收到 `-ENOTSUPP` 后分配连续缓冲区，把内部偏移与数据复制在一起，再调用 `map->write`：

```c title="Linux v6.6 drivers/base/regmap/regmap.c:1769-1781"
if (ret == -ENOTSUPP) {
    len = map->format.reg_bytes + map->format.pad_bytes + val_len;
    buf = kzalloc(len, GFP_KERNEL);
    if (!buf)
        return -ENOMEM;

    memcpy(buf, map->work_buf, map->format.reg_bytes);
    memcpy(buf + map->format.reg_bytes + map->format.pad_bytes,
           val, val_len);
    ret = map->write(map->bus_context, buf, len);
    kfree(buf);
}
```

本例 `reg_bytes=1`，第一笔 `val_len=8`，所以连续缓冲区是 `0x10 + Hello-EE`，共 9 字节；第二笔是 `0x18 + PROM`，共 5 字节。`kfree()` 只释放内核临时缓冲区，不影响已经交付控制器的传输。

### 写周期：失败后重试，不是成功后固定睡 5 ms

AT24C02C 的最大写周期是 5 ms，ACK Polling 是重复发送 START＋写方向器件地址，等器件结束内部擦写后重新应答。v6.6 at24 不采用“每次成功发送后固定睡 5 ms”的写法，而是在 `regmap_bulk_write()` 失败时睡眠约 1～1.5 ms，再重试同一笔：

```c title="Linux v6.6 drivers/misc/eeprom/at24.c:397-415"
timeout = jiffies + msecs_to_jiffies(at24_write_timeout);
do {
    write_time = jiffies;
    ret = regmap_bulk_write(regmap, offset, buf, count);
    if (!ret)
        return count;
    usleep_range(1000, 1500);
} while (time_before(write_time, timeout));
return -ETIMEDOUT;
```

`jiffies` 是内核计时计数，`time_before()` 处理其回绕比较；默认 `at24_write_timeout=25` ms。前一笔页写后的暂时 NACK可能由这个重试环恢复。若第二笔 `PROM` 持续失败并最终超时，第一笔 `Hello-EE` 已写入的部分仍保留，驱动只解锁、释放运行时电源引用并返回错误，**没有事务回滚**。

### 读取：两条消息，一次顺序读 12 字节

读路径经 `bin_attr_nvmem_read() → nvmem_reg_read() → at24_read() → at24_regmap_read() → regmap_bulk_read()`，与写路径使用同一个 `at24_data` 和同一把锁。`at24_read()` 完成全部请求后返回 0，NVMEM 文件回调再返回读取字节数。

regmap-i2c 把随机读组织成两个 `i2c_msg`：

```c title="Linux v6.6 drivers/base/regmap/regmap-i2c.c:181-197"
xfer[0].addr = i2c->addr;
xfer[0].flags = 0;
xfer[0].len = reg_size;
xfer[0].buf = (void *)reg;

xfer[1].addr = i2c->addr;
xfer[1].flags = I2C_M_RD;
xfer[1].len = val_size;
xfer[1].buf = val;

ret = i2c_transfer(i2c->adapter, xfer, 2);
if (ret == 2)
    return 0;
else if (ret < 0)
    return ret;
else
    return -EIO;
```

第一条写消息只携带内部偏移 `0x10`，第二条带 `I2C_M_RD` 读 12 字节。两条消息在同一次 `i2c_transfer(..., 2)` 中提交，中间是 Repeated START，没有 STOP。返回值 2 是完成的消息数，不是读了两字节；少于 2 的非负值会转成 `-EIO`。顺序读可以从 `0x17` 到 `0x18`，不需要 8＋4。

## <span class="blue"> 对照路径：解绑后用 /dev/i2c 自己负责

### 解绑与锁：用 A、B、C 三个参与者推演

`/dev/i2c-1` 是 i2c-dev 为控制器提供的字符设备。打开后执行 `I2C_SLAVE`，i2c-dev 为这次打开保存匿名 `i2c_client`，记录后续 `write()` 使用的器件地址；`I2C_RDWR` 的消息则自己携带地址。匿名 client、正式 `1-0050` client 和 at24 的 `at24_data` 是不同对象。

锁的边界用三个具体操作序列看：

- 进程 A 经 sysfs 写 12 字节：进入 `at24_write()` 后持有 `at24_data.lock`，完成 8＋4 才解锁。
- 进程 B 经 sysfs 读 12 字节：经同一 NVMEM `priv` 找到同一 `at24_data`，在 `at24_read()` 的同一把锁上等待；A 解锁后 B 才进入 regmap 读。
- 进程 C 经 `/dev/i2c-1` 写：只使用匿名 client 和 i2c-dev，不调用 `at24_write()`，不持有也不知道 A/B 的锁，可能与二者在器件内部偏移和写周期上交错。

I2C 总线锁只约束控制器上的传输调度，不理解 EEPROM 的页和写周期，不能替代上述协调。本实验因此先停止所有业务读写，再解绑，且只允许一个进程、一条路径访问：

```bash title="目标板 root shell；不要用 I2C_SLAVE_FORCE 代替隔离"
echo 1-0050 > /sys/bus/i2c/drivers/at24/unbind
test ! -e /sys/bus/i2c/devices/1-0050/eeprom && echo "at24 interface removed"
```

解绑后 NVMEM 删除 `eeprom`，`at24_data`、锁和 regmap 随设备管理资源释放；正式 client 与 at24 的绑定解除，但设备树描述的 client 可保留，芯片内容不会清除。

### 完整程序从哪里来，怎样构建

本篇原创 [at24c02c_rw.c](./code/B-B.3.5/at24c02c_rw.c) 是完整用户态程序，不是内核模块，也不需要改写厂商控制器驱动。它使用 Linux UAPI 头文件中的 `I2C_SLAVE`、`I2C_RDWR`、`struct i2c_msg` 和 `struct i2c_rdwr_ioctl_data`，在具备 AArch64 工具链、匹配 C 库与头文件的构建机上编译，再到目标板运行。

同目录 [Makefile](./code/B-B.3.5/Makefile) 集中保存构建参数：

```bash title="在源码目录执行；CC 可替换为实际 AArch64 编译器"
make clean
make CC=aarch64-linux-gnu-gcc
scp at24c02c_rw root@<板子IP>:/tmp/
```

`-std=c11` 选择 C11，`-Wall -Wextra` 启用常用警告，`-Werror` 把警告当错误。当前文档环境没有这些交叉工具，因此这里只交代可复现入口，不声称已经编译成功。

### main()：从总长度计算本轮页内余量

程序的固定参数为 `/dev/i2c-1`、`0x50`、`0x10`、页大小 8 和 `Hello-EEPROM`。`uint8_t` 是无符号 8 位字节，`size_t` 表示缓冲区长度，`ssize_t` 可同时表示非负返回长度和负错误。完整 `main()` 的写循环如下：

```c title="code/B-B.3.5/at24c02c_rw.c:150-187；完整错误出口见源文件"
static const uint8_t data[] = "Hello-EEPROM";
const size_t total = sizeof(data) - 1;  /* 排除字面量末尾 '\0' */

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
```

`pos % 8` 是当前页内偏移，`page_left` 是本页剩余空间。第一轮 `pos=0x10`、余量 8、剩余 12，所以 `chunk=8`；`done` 变为 8 后，第二轮 `pos=0x18`、余量 8、剩余 4，所以 `chunk=4`。这与内核路径得到相同拆分，但责任现在在应用。

### at24_write_page()：线上长度包含内部偏移

页写函数把内部偏移放在缓冲区首字节，数据紧随其后：

```c title="code/B-B.3.5/at24c02c_rw.c:86-112"
buf[0] = mem_addr;
memcpy(buf + 1, data, len);

do {
    ret = write(fd, buf, len + 1);
} while (ret < 0 && errno == EINTR);

if (ret < 0)
    return -1;
if ((size_t)ret != len + 1) {
    errno = EIO;
    return -1;
}
return at24_wait_ready(fd);
```

调用前的检查要求 `len` 非零、不超过 8，并且 `(mem_addr % 8) + len` 不越页。`EINTR` 表示系统调用被信号中断，可重试；`errno` 保存失败原因，`perror()` 据此打印。部分完成没有可靠的新 `errno`，所以显式转成 `EIO`。注意成功返回值必须是 `len+1`，因为其中包含 1 字节内部偏移，不是只写入了 `len` 个数据字节。

### at24_wait_ready()：ACK 探测不可用时才固定等待

用户态 ACK 轮询用零长度 `write()` 尝试器件写地址。它仍会经过 i2c-dev、`i2c_master_send()` 和控制器，平台可能拒绝零长度消息：

```c title="code/B-B.3.5/at24c02c_rw.c:57-82"
for (;;) {
    ssize_t ret = write(fd, NULL, 0);
    int64_t now;

    if (ret >= 0)
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
```

`CLOCK_MONOTONIC` 测量经过时间，不受系统日历调整影响。成功的零长度调用接受任意非负返回值，不误写成“只有 0 才成功”。只有 `EINVAL` 或 `EOPNOTSUPP` 表示消息形式不可用时，才固定等待手册最大写周期 5 ms；其他错误在 25 ms 总上限内重试，最终转成 `ETIMEDOUT`。RK3568 实板对零长度消息的行为本篇未上板验证，所以两种路径都必须保留，最终也都必须读回。

### at24_read()：两条消息和两种成功判断

```c title="code/B-B.3.5/at24c02c_rw.c:117-148；省略前面的声明语句"
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
if (ret != 2) {
    errno = EIO;
    return -1;
}
```

`addr` 是 7 位器件地址，`flags=0` 表示写，`I2C_M_RD` 表示读，`len` 是本消息长度，`buf` 指向发送或接收缓冲区。`rdwr.msgs` 指向消息数组，`nmsgs=2` 表示两条消息；放在同一次 `I2C_RDWR` 才能用 Repeated START 连接。

程序最后还要用 `memcmp(data, readback, total)` 比较 12 字节。于是三个判断分别回答不同问题：`write()==chunk+1` 证明页写消息完整提交，`ioctl()==2` 证明复合读两条消息完成，`memcmp()==0` 才证明读回内容符合期望。

确认已经解绑且没有其他访问者后，在目标板运行：

```bash
/tmp/at24c02c_rw
echo $?
```

预期输出为：

```text
page write: addr=0x10, data bytes=8
page write: addr=0x18, data bytes=4
readback: 48 65 6c 6c 6f 2d 45 45 50 52 4f 4d
verify OK: Hello-EEPROM
0
```

前两行显示应用切分，第三行显示读回，第四行只在逐字节一致后出现，最后的 `0` 是进程退出状态。若第二笔失败，程序同样不回滚第一笔；应读取目标区域并依据备份处理，而不是重复运行直到“看起来成功”。

## <span class="blue"> 用源码工作台跟随完整函数和状态变化

正文保留理解所需的关键段；完整定义、错误分支、原始行号和上下文统一放在本篇源码工作台。实验室可切换正常 8＋4、第二笔失败、非对齐 6＋2、A/B/C 锁顺序、零长度探测回退以及解绑重绑。每一步都能在“步骤片段”和“完整函数”之间切换，源码视图加载同目录保存的原始文件。

<div class="interactive-demo">
  <iframe
    src="../html/at24-lab.html"
    title="B-B.3.5 AT24C02 端到端读写交互实验室"
    loading="lazy"
    style="width:100%;height:960px;border:0;"
  ></iframe>
</div>

[在新标签页打开 AT24 Framework Lab](./html/at24-lab.html){: target="_blank" rel="noopener noreferrer" }。页面是**源码状态模型，不是 EEPROM 硬件仿真**；它帮助核对代码位置和状态推演，不证明已经编译、运行、产生波形或上板读写。源码快照与验证边界另见 [SOURCES](./code/B-B.3.5/SOURCES.md)。

## <span class="blue"> 重绑：新软件对象，旧芯片内容

用户程序 `close(fd)` 后，本次打开对应的匿名 client 和文件描述符生命周期结束，控制器与正式 client 不因这次关闭而注销。停止用户态访问后重新绑定：

```bash title="目标板 root shell；重绑后走新的 sysfs 接口"
echo 1-0050 > /sys/bus/i2c/drivers/at24/bind
test -e /sys/bus/i2c/devices/1-0050/eeprom && echo "at24 interface restored"
dd if=/sys/bus/i2c/devices/1-0050/eeprom bs=1 skip=16 count=12 status=none | hexdump -C
```

bind 再次执行 `at24_probe()`，创建**新的** regmap、`at24_data`、锁和 NVMEM 注册关系，`eeprom` 路径也重新出现。旧锁不会继续存在，旧运行状态不会继承给新实例；设备树 client 可以仍是同一个。

但 EEPROM 阵列是非易失存储，软件对象销毁不清除 `0x10～0x1b`。最后若仍读到 `Hello-EEPROM`，证明的是“内容跨解绑／重绑保留”，不是“旧驱动对象仍然存在”。产品路径与对照路径也在这里收清：标准器件长期使用 at24/NVMEM；只有明确隔离访问的实验才由 `/dev/i2c` 应用自行承担页切分、写等待和结果验证。

## <span class="blue"> 本节总结

这笔读写的核心不是背两条命令，而是把同一硬件约束落到两个实现里：8 字节真实页使 12 字节从 `0x10` 起必须拆成 8＋4；内部写周期使下一笔可能需要等待或重试；页写回卷不会返回错误，WP 高电平还可能“仍 ACK 但不写”，所以读回和整片边界比较不可缺少。

at24/sysfs 路径由内核对象和回调完成这些工作，`/dev/i2c` 对照路径则由完整 C 程序自行完成。解绑和重绑改变的是 client 与驱动、NVMEM、regmap、锁和文件入口的关系，不会自动改变芯片里的字节。机制验证依赖 Linux v6.6 源码和 AT24C02C 手册；DTS 部署、工具链构建和真实读写仍是目标板系统集成工作。

## <span class="blue"> 本节自查 Q&A

??? details "Q1. 为什么一次写 12 字节会得到 `PROMo-EE`，而不是简单写到下一页？"
    AT24C02C 页写只递增内部地址低 3 位。前 8 字节先写 `0x10～0x17 = Hello-EE`，后 4 字节回卷到 `0x10～0x13 = PROM`，覆盖前 4 字节；`0x18～0x1b` 没收到新数据。因此前 8 字节最终是 `PROMo-EE`。正确做法是第一笔 8 字节后等待，再从 `0x18` 发起第二笔 4 字节。

??? details "Q2. 所有字节都 ACK，为什么仍可能一个字节也没写？"
    手册规定 WP 为高时，器件仍 ACK 器件地址、内部偏移和数据，但 STOP 后不启动内部写周期。控制器只能证明传输得到应答，不能据此证明阵列已改变。必须确认 WP 电平，并读回目标区域；整片比较还要确认没有改动边界外内容。

??? details "Q3. 漏写 `pagesize` 与错写 `pagesize=16`，风险为何不同？"
    v6.6 at24 读不到 `pagesize` 时保守设为 1，每次只写一个字节，通常只是慢，不发生本例的跨页回卷。真实页是 8 却声明 16，会让驱动允许一次发送跨页数据，回卷覆盖又不产生错误码。该属性是硬件事实，不是吞吐调节参数。

??? details "Q4. `eeprom` 文件如何把文件位置传到 at24？"
    probe 创建 regmap 和 `at24_data`，再把 `at24_read/at24_write` 与 `priv=at24` 登记进 NVMEM。`compat/base_dev` 使 NVMEM 在 `1-0050` 目录创建 `eeprom`。写文件时 `bin_attr_nvmem_write()` 收到 `pos=16,count=12`，经 `nvmem_reg_write()` 和 `priv` 调进同一份 `at24_data`，`pos` 因而成为 EEPROM 内部偏移。

??? details "Q5. 为什么本例 regmap 会先出现 `-ENOTSUPP`，这表示 EEPROM 坏了吗？"
    不是。RK3x 能力回调不含 `I2C_FUNC_NOSTART`，所以 regmap-i2c 的 gather write 返回 `-ENOTSUPP`，请求核心改用线性写。核心把 1 字节内部偏移和本页数据复制到连续缓冲区，再由 `regmap_i2c_write()` 一次发送。这是软件能力协商，尚未表示器件应答失败。

??? details "Q6. 从 `0x12` 写 8 字节为什么拆成 6＋2？读 12 字节又为何不拆？"
    写路径每轮用 `roundup(offset+1,page_size)` 找下一页边界。`0x12` 到 `0x18` 只剩 6 字节，所以先写 6，再从 `0x18` 写 2。页回卷是页写规则；顺序读可以连续经过页边界，所以从 `0x10` 读 12 字节可由一次复合事务完成。

??? details "Q7. 各层的 0、8、4、12 和 2 分别表示什么？第二笔失败能否认为全未写？"
    regmap-i2c 完整发送后返回 0；at24 的单轮写函数返回本轮 8 或 4；`at24_write()` 全部完成后返回 0；NVMEM 文件回调再向用户返回 12。复合读 `i2c_transfer()` 返回 2 表示两条消息完成。第二笔失败时第一笔可能已永久写入，没有跨两笔的回滚，只能读回并按备份处理。

??? details "Q8. A/B 同走 sysfs、C 走 `/dev/i2c`，三者会怎样排序？"
    A 写和 B 读经同一 NVMEM `priv` 找到同一 `at24_data`，所以在同一把锁上串行：A 完成或出错解锁后，B 才继续。C 使用匿名 client，不经过 at24 回调，不受该锁约束。实验必须先停止 A/B 并解绑，再让 C 独占访问，不能用强制寻址假装完成协调。

??? details "Q9. 零长度 ACK 探测不可用时，程序为什么既能继续又不算验证完成？"
    `EINVAL/EOPNOTSUPP` 只说明平台不接受这种消息形式，程序据此固定等待手册最大写周期 5 ms；其他错误仍在 25 ms 窗口内重试。固定等待不提供器件完成应答，更不能发现 WP 导致的假成功，所以之后仍要复合读回、检查返回 2，并逐字节比较 12 字节。

??? details "Q10. 重绑后路径相同，为什么不能说旧驱动状态恢复了？"
    解绑删除旧 `eeprom` 并释放旧 NVMEM、regmap、`at24_data` 和锁。重绑重新 probe，所有运行对象都是新创建的；相同 sysfs 路径来自新的注册关系。能跨重绑保留的是 EEPROM 的非易失内容，不是旧锁、旧指针或旧运行时电源状态。
