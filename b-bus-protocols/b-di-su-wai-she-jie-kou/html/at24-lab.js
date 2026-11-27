(() => {
  "use strict";

  const PROBE_OBJECTS = `regmap_config.val_bits = 8;
regmap_config.reg_bits = (flags & AT24_FLAG_ADDR16) ? 16 : 8;
regmap_config.disable_locking = true;

regmap = devm_regmap_init_i2c(client, &regmap_config);
if (IS_ERR(regmap))
	return PTR_ERR(regmap);

at24 = devm_kzalloc(dev, struct_size(at24, client_regmaps, num_addresses),
		    GFP_KERNEL);
if (!at24)
	return -ENOMEM;

mutex_init(&at24->lock);
at24->byte_len = byte_len;
at24->page_size = page_size;
at24->client_regmaps[0] = regmap;`;

  const PROBE_NVMEM = `nvmem_config.type = NVMEM_TYPE_EEPROM;
nvmem_config.dev = dev;
nvmem_config.read_only = !writable;
nvmem_config.root_only = !(flags & AT24_FLAG_IRUGO);
nvmem_config.owner = THIS_MODULE;
nvmem_config.compat = true;
nvmem_config.base_dev = dev;
nvmem_config.reg_read = at24_read;
nvmem_config.reg_write = at24_write;
nvmem_config.priv = at24;
nvmem_config.stride = 1;
nvmem_config.word_size = 1;
nvmem_config.size = byte_len;`;

  const NVMEM_FILE = `nvmem->eeprom.private = &nvmem->dev;
nvmem->base_dev = config->base_dev;

rval = device_create_bin_file(nvmem->base_dev, &nvmem->eeprom);
if (rval) {
	dev_err(&nvmem->dev,
		"Failed to create eeprom binary file %d\\n", rval);
	return rval;
}`;

  const NVMEM_REQUEST = `if (pos + count > nvmem->size)
	count = nvmem->size - pos;

count = round_down(count, nvmem->word_size);

if (!nvmem->reg_write)
	return -EPERM;

rc = nvmem_reg_write(nvmem, pos, buf, count);

if (rc)
	return rc;

return count;`;

  const AT24_LOCK_LOOP = `ret = pm_runtime_get_sync(dev);
if (ret < 0) {
	pm_runtime_put_noidle(dev);
	return ret;
}

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
}`;

  const AT24_ADVANCE = `while (count) {
	ret = at24_regmap_write(at24, buf, off, count);
	if (ret < 0) {
		mutex_unlock(&at24->lock);
		pm_runtime_put(dev);
		return ret;
	}
	buf += ret;
	off += ret;
	count -= ret;
}`;

  const AT24_ERROR = `while (count) {
	ret = at24_regmap_write(at24, buf, off, count);
	if (ret < 0) {
		mutex_unlock(&at24->lock);
		pm_runtime_put(dev);
		return ret;
	}`;

  const ADJUST = `/* write_max is at most a page */
if (count > at24->write_max)
	count = at24->write_max;

/* Never roll over backwards, to the start of this page */
next_page = roundup(offset + 1, at24->page_size);
if (offset + count > next_page)
	count = next_page - offset;

return count;`;

  const GATHER = `/* If the I2C controller can't do a gather tell the core, it
 * will substitute in a linear write for us.
 */
if (!i2c_check_functionality(i2c->adapter, I2C_FUNC_NOSTART))
	return -ENOTSUPP;`;

  const RK3X_FUNC = `static u32 rk3x_i2c_func(struct i2c_adapter *adap)
{
	return I2C_FUNC_I2C | I2C_FUNC_SMBUS_EMUL | I2C_FUNC_PROTOCOL_MANGLING;
}`;

  const LINEAR = `/* If that didn't work fall back on linearising by hand. */
if (ret == -ENOTSUPP) {
	len = map->format.reg_bytes + map->format.pad_bytes + val_len;
	buf = kzalloc(len, GFP_KERNEL);
	if (!buf)
		return -ENOMEM;

	memcpy(buf, map->work_buf, map->format.reg_bytes);
	memcpy(buf + map->format.reg_bytes + map->format.pad_bytes,
	       val, val_len);
	ret = map->write(map->bus_context, buf, len);`;

  const REGMAP_DONE = `ret = regmap_bulk_write(regmap, offset, buf, count);
dev_dbg(regmap_get_device(regmap), "write %zu@%d --> %d (%ld)\\n",
	count, offset, ret, jiffies);
if (!ret)
	return count;`;

  const RETRY = `do {
	/*
	 * The timestamp shall be taken before the actual operation
	 * to avoid a premature timeout in case of high CPU load.
	 */
	write_time = jiffies;

	ret = regmap_bulk_write(regmap, offset, buf, count);
	dev_dbg(regmap_get_device(regmap), "write %zu@%d --> %d (%ld)\\n",
		count, offset, ret, jiffies);
	if (!ret)
		return count;

	usleep_range(1000, 1500);
} while (time_before(write_time, timeout));

return -ETIMEDOUT;`;

  const NVMEM_RETURN = `rc = nvmem_reg_write(nvmem, pos, buf, count);

if (rc)
	return rc;

return count;`;

  const REGMAP_READ = `xfer[0].addr = i2c->addr;
xfer[0].flags = 0;
xfer[0].len = reg_size;
xfer[0].buf = (void *)reg;

xfer[1].addr = i2c->addr;
xfer[1].flags = I2C_M_RD;
xfer[1].len = val_size;
xfer[1].buf = val;

ret = i2c_transfer(i2c->adapter, xfer, 2);
if (ret == 2)
	return 0;`;

  const USER_SPLIT = `while (done < total) {
	size_t pos = START_ADDR + done;
	size_t page_left = PAGE_SIZE - (pos % PAGE_SIZE);
	size_t chunk = total - done;

	if (chunk > page_left)
		chunk = page_left;

	if (at24_write_page(fd, (uint8_t)pos, data + done, chunk) < 0) {
		perror("page write");
		goto out;
	}
	printf("page write: addr=0x%02zx, data bytes=%zu\\n", pos, chunk);
	done += chunk;
}`;

  const USER_WAIT = `ssize_t ret = write(fd, NULL, 0);
int64_t now;

if (ret >= 0)
	return 0;
if (errno == EINVAL || errno == EOPNOTSUPP)
	return sleep_ns(WRITE_CYCLE_NS);`;

  const USER_READ = `struct i2c_msg msgs[2] = {
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
};`;

  const USER_SELECT = `if (ioctl(fd, I2C_SLAVE, DEV_ADDR) < 0) {
	perror("ioctl I2C_SLAVE");
	goto out;
}`;

  const RELEASE = `if (nvmem->flags & FLAG_COMPAT)
	device_remove_bin_file(nvmem->base_dev, &nvmem->eeprom);

nvmem_device_remove_all_cells(nvmem);
nvmem_layout_put(nvmem->layout);
device_unregister(&nvmem->dev);`;

  const LAB_CONFIG = {
    title: "AT24 Framework Lab · 12 字节怎样变成 8＋4",
    kicker: "B-B.3.5 · SOURCE-GROUNDED EEPROM",
    subtitle: "从 at24/sysfs 产品路径到解绑后的 /dev/i2c 对照，逐步核对对象、页边界、返回值与持久内容。",
    transaction: ["0x10", "Hello-EE · 8B", "0x18", "PROM · 4B", "read 12B"],
    modelBasis: "依据 Linux v6.6 与 AT24C02C DS20006111B 构造的状态模型；未连接硬件",
    scenarios: {
      normal: [
        {
          label: "probe 建立对象",
          path: "drivers/misc/eeprom/at24.c · at24_probe()",
          code: PROBE_OBJECTS, startLine: 671, line: 675,
          full: { key: "at24Probe", needle: "regmap = devm_regmap_init_i2c(client, &regmap_config);" },
          states: { "client": "1-0050 · 来自 DT", "regmap": "reg=8bit · val=8bit", "at24_data": "新分配并清零", "at24.lock": "已初始化", "page_size / write_max": "8 / 8" },
          observations: ["regmap 关联的是正式 client", "at24_data 保存本次绑定的运行状态"],
          note: "devm_ 登记设备管理资源。这里先建立 client→regmap 与 at24_data→regmap 两条关系，再初始化锁；还没有创建 eeprom 文件。"
        },
        {
          label: "登记 NVMEM 回调",
          path: "drivers/misc/eeprom/at24.c · at24_probe()",
          code: PROBE_NVMEM, startLine: 731, line: 738,
          full: { key: "at24Probe", needle: "nvmem_config.reg_read = at24_read;" },
          states: { "reg_read": "at24_read", "reg_write": "at24_write", "priv": "刚创建的 at24_data", "size": "256", "compat / base_dev": "true / client.dev" },
          observations: ["NVMEM 经 priv 找回同一份 at24_data", "compat 与 base_dev 决定兼容文件挂在哪里"],
          note: "配置不是文件本身。它把 NVMEM 的统一读写请求转接到 at24 回调，并把容量、权限和挂载父设备一起登记。"
        },
        {
          label: "创建 eeprom 文件",
          path: "drivers/nvmem/core.c · nvmem_sysfs_setup_compat()",
          code: NVMEM_FILE, startLine: 386, line: 389,
          full: { key: "nvmemCompat", needle: "rval = device_create_bin_file(nvmem->base_dev, &nvmem->eeprom);" },
          states: { "nvmem_device": "已注册", "base_dev": "1-0050", "attr.name": "eeprom", "attr.size": "256", "return": "0 · 文件创建成功", "returnTone": "good" },
          observations: ["路径是 /sys/bus/i2c/devices/1-0050/eeprom", "它是内核二进制属性，不是磁盘文件"],
          note: "device_create_bin_file 把 NVMEM 的兼容属性挂到原 I2C 设备目录。到这一步，用户态入口和内核回调才闭合成一条可用路径。"
        },
        {
          label: "dd 交付 pos=16,count=12",
          path: "drivers/nvmem/core.c · bin_attr_nvmem_write()",
          code: NVMEM_REQUEST, startLine: 281, line: 289,
          full: { key: "nvmemWrite", needle: "rc = nvmem_reg_write(nvmem, pos, buf, count);" },
          states: { "pos": "16 = 0x10", "count": "12", "buffer": "Hello-EEPROM", "reg_write": "at24_write", "return": "进入 nvmem_reg_write" },
          observations: ["文件位置成为 EEPROM 内部偏移", "NVMEM 尚未按页拆分 12 字节"],
          note: "NVMEM 做容量、对齐和回调检查，再把请求交给驱动。页边界是 at24 的职责，不应误以为 sysfs 或 dd 已经拆成 8＋4。"
        },
        {
          label: "at24 持锁进入循环",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: AT24_LOCK_LOOP, startLine: 481, line: 491,
          full: { key: "at24Write", needle: "mutex_lock(&at24->lock);" },
          states: { "priv": "at24_data", "off / count": "0x10 / 12", "at24.lock": "A 已持有", "pm_runtime": "已获取引用", "return": "等待第一轮 at24_regmap_write" },
          observations: ["同一 at24 实例的读写会串行", "12 字节仍由循环统一推进"],
          note: "锁从整个写循环之前持有到完成之后，因此另一路 sysfs 访问不能插进 8＋4 之间；它不能约束其他 I2C 主控或 /dev/i2c 匿名访问。"
        },
        {
          label: "第一轮缩短为 8",
          path: "drivers/misc/eeprom/at24.c · at24_adjust_write_count()",
          code: ADJUST, startLine: 376, line: 381,
          full: { key: "at24Adjust", needle: "next_page = roundup(offset + 1, at24->page_size);" },
          states: { "input": "offset=0x10 · count=12", "write_max": "8", "next_page": "0x18", "output count": "8", "data": "Hello-EE" },
          observations: ["write_max 先把 12 限为 8", "0x10＋8 正好停在页尾 0x17"],
          note: "roundup(offset+1,8) 求下一页边界。主实例第一轮已经由 write_max 截成 8；非对齐场景才能看到 next_page 继续截短的另一层作用。"
        },
        {
          label: "RK3568 拒绝 gather",
          path: "drivers/base/regmap/regmap-i2c.c · regmap_i2c_gather_write()",
          code: GATHER, startLine: 147, line: 150,
          full: { key: "regmapI2cGather", needle: "if (!i2c_check_functionality(i2c->adapter, I2C_FUNC_NOSTART))" },
          states: { "adapter": "RK3x I2C1", "I2C_FUNC_NOSTART": "未提供", "return": "-ENOTSUPP", "returnTone": "error", "wire": "尚未发送" },
          observations: ["这是能力协商，不是 EEPROM NACK", "regmap 核心将执行线性化回退"],
          note: "rk3x_i2c_func 只声明 I2C_FUNC_I2C、SMBUS_EMUL 和 PROTOCOL_MANGLING。因此本例不是“可能”，而是按该源码能力集合走回退。"
        },
        {
          label: "拼成地址＋8 字节",
          path: "drivers/base/regmap/regmap.c · _regmap_raw_write_impl()",
          code: LINEAR, startLine: 1769, line: 1776,
          full: { key: "regmapRawWriteImpl", needle: "if (ret == -ENOTSUPP) {" },
          states: { "reg_bytes": "1", "val_len": "8", "linear buffer": "[10] + Hello-EE", "map->write": "regmap_i2c_write", "expected wire": "9 字节写消息" },
          observations: ["内部地址与数据进入同一连续缓冲区", "没有跨到下一页的 0x18"],
          note: "回退不是再拆一页，而是把已经确定的这一页变成 regmap_i2c_write 能一次发送的连续数据。缓冲区随后由 regmap 核心释放。"
        },
        {
          label: "第一笔返回 8",
          path: "drivers/misc/eeprom/at24.c · at24_regmap_write()",
          code: REGMAP_DONE, startLine: 406, line: 410,
          full: { key: "at24RegmapWrite", needle: "ret = regmap_bulk_write(regmap, offset, buf, count);" },
          states: { "regmap_i2c_write": "完整发送后返回 0", "regmap_bulk_write": "0", "at24_regmap_write": "8", "returnTone": "good", "EEPROM": "0x10～0x17 已接收页写" },
          observations: ["底层 0 被转换成本轮完成字节数 8", "成功发送后这里没有固定睡 5 ms"],
          note: "返回值的含义随层级改变。at24_write 需要推进多少字节，所以这一层返回 8；若后续暂时 NACK，失败重试会在下一次写调用中发生。"
        },
        {
          label: "推进并写第二笔 4",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: AT24_ADVANCE, startLine: 493, line: 500,
          full: { key: "at24Write", needle: "buf += ret;" },
          states: { "after first": "buf+=8 · off=0x18 · count=4", "second chunk": "PROM · 4B", "second regmap return": "0", "second at24_regmap return": "4", "loop count": "0 · 解锁" },
          observations: ["第二笔从下一页页首开始", "两轮完成后 at24_write 返回 0"],
          note: "第一轮的 8 同时推进用户缓冲区、EEPROM 偏移和剩余长度。第二轮仍走同一 regmap 回退，只是线上变为 0x18＋4 字节。"
        },
        {
          label: "NVMEM 返回 12",
          path: "drivers/nvmem/core.c · bin_attr_nvmem_write()",
          code: NVMEM_RETURN, startLine: 289, line: 294,
          full: { key: "nvmemWrite", needle: "return count;" },
          states: { "at24_write": "0 · 全部完成", "nvmem_reg_write": "0", "file callback return": "12", "returnTone": "good", "dd": "12 字节写入请求完成" },
          observations: ["驱动 0 与 dd 12 不矛盾", "仍须读回，不能仅凭返回值证明阵列内容"],
          note: "NVMEM 文件回调把底层成功 0 转为用户请求的字节数。WP 高时器件可能仍 ACK 但不启动写周期，所以读回是独立必要验证。"
        },
        {
          label: "一次顺序读回 12",
          path: "drivers/base/regmap/regmap-i2c.c · regmap_i2c_read()",
          code: REGMAP_READ, startLine: 181, line: 191,
          full: { key: "regmapI2cRead", needle: "ret = i2c_transfer(i2c->adapter, xfer, 2);" },
          states: { "msg[0]": "write [0x10]", "msg[1]": "I2C_M_RD · len=12", "i2c_transfer": "返回 2", "readback": "Hello-EEPROM", "read page split": "不需要" },
          observations: ["写偏移与读数据之间是 Repeated START", "顺序读可从 0x17 继续到 0x18"],
          note: "页内回卷是页写规则，不限制这里的顺序读。两条消息都完成才由 regmap-i2c 返回 0，随后 at24 与 NVMEM 再交付 12 字节。"
        }
      ],
      secondFail: [
        {
          label: "第一笔已经落盘",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: AT24_ADVANCE, startLine: 493, line: 500,
          full: { key: "at24Write", needle: "buf += ret;" },
          states: { "first chunk": "Hello-EE · 成功", "off": "0x18", "count": "4", "at24.lock": "仍持有" },
          observations: ["0x10～0x17 已有新内容", "第二次循环尚未完成"],
          note: "失败场景从第一笔成功之后开始。后续错误只能停止推进，不能把芯片里的前 8 字节恢复成实验前内容。"
        },
        {
          label: "第二笔持续失败",
          path: "drivers/misc/eeprom/at24.c · at24_regmap_write()",
          code: RETRY, startLine: 399, line: 406,
          full: { key: "at24RegmapWrite", needle: "ret = regmap_bulk_write(regmap, offset, buf, count);" },
          states: { "offset / count": "0x18 / 4", "regmap_bulk_write": "负错误 · 故障模型", "sleep": "每次失败后约 1～1.5 ms", "timeout": "默认 25 ms 窗口" },
          observations: ["重试的是同一笔 PROM", "第一笔没有被重新发送"],
          note: "暂时 NACK 可能在写周期结束后恢复；本场景刻意让错误持续到超时。具体负错误由底层决定，at24 最终统一报告超时。"
        },
        {
          label: "超时返回",
          path: "drivers/misc/eeprom/at24.c · at24_regmap_write()",
          code: RETRY, startLine: 399, line: 415,
          full: { key: "at24RegmapWrite", needle: "return -ETIMEDOUT;" },
          states: { "return": "-ETIMEDOUT", "returnTone": "error", "second chunk": "未完成", "at24_write": "即将收到负值" },
          observations: ["不能把 PROM 当作已写", "也不能把 Hello-EE 当作未写"],
          note: "超时只描述当前写操作在窗口内没有成功。它不提供整笔 12 字节事务语义，更不推断芯片每个地址的最终电平和内容。"
        },
        {
          label: "解锁但不回滚",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: AT24_ERROR, startLine: 493, line: 495,
          full: { key: "at24Write", needle: "pm_runtime_put(dev);\n\t\t\treturn ret;" },
          states: { "at24.lock": "释放", "pm_runtime": "放下引用", "EEPROM 0x10～0x17": "Hello-EE 保留", "EEPROM 0x18～0x1b": "须读回判断", "user": "收到错误" },
          observations: ["软件错误路径只清理运行资源", "恢复整片内容必须依靠实验前备份"],
          note: "正确验证是读取目标区域并与 before/after 比较。若需恢复，应重新走受控写流程写入备份，而不是假定失败自动撤销。"
        }
      ],
      unaligned: [
        {
          label: "0x12 第一轮为 6",
          path: "drivers/misc/eeprom/at24.c · at24_adjust_write_count()",
          code: ADJUST, startLine: 376, line: 381,
          full: { key: "at24Adjust", needle: "next_page = roundup(offset + 1, at24->page_size);" },
          states: { "input": "offset=0x12 · count=8", "next_page": "0x18", "first count": "0x18-0x12 = 6", "first range": "0x12～0x17" },
          observations: ["起始偏移不在页首", "write_max=8 还不足以保证不跨页"],
          note: "先按 write_max 限制后，还要按下一页边界截短。这证明切分不是把总长度机械除以 8，而是每轮重新看当前 offset。"
        },
        {
          label: "推进 6 字节",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: AT24_ADVANCE, startLine: 493, line: 500,
          full: { key: "at24Write", needle: "off += ret;" },
          states: { "first return": "6", "off": "0x18", "count": "2", "buf": "前进 6 字节" },
          observations: ["下一轮从页首开始", "剩余长度由同一循环保存"],
          note: "推进值来自 at24_regmap_write 的实际完成量，不是调用者预先猜测的 8。这样对齐和非对齐请求共用一套循环。"
        },
        {
          label: "第二轮只写 2",
          path: "drivers/misc/eeprom/at24.c · at24_adjust_write_count()",
          code: ADJUST, startLine: 376, line: 385,
          full: { key: "at24Adjust", needle: "return count;" },
          states: { "second offset": "0x18", "second count": "2", "second range": "0x18～0x19", "total": "6＋2 = 8" },
          observations: ["两笔都不越过自己的页尾", "最终长度仍是请求的 8 字节"],
          note: "第二轮 count=2 已小于 write_max，也不会越过 next_page=0x20，所以保持 2。页切分与字节顺序共同保证没有回卷覆盖。"
        }
      ],
      locking: [
        {
          label: "A：sysfs 写并持锁",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: AT24_LOCK_LOOP, startLine: 481, line: 491,
          full: { key: "at24Write", needle: "mutex_lock(&at24->lock);" },
          states: { "participant A": "dd 写 eeprom", "at24.lock": "A 持有", "A sequence": "第一笔 8 → 第二笔 4", "participant B": "准备读同一 eeprom" },
          observations: ["A 的两笔页写处于同一锁区间", "B 使用同一个 at24_data"],
          note: "共享状态必须落到同一个对象：A 与 B 都从 NVMEM 的 priv 取回这份 at24_data，因此看到的是同一把 lock，而不是各建一把。"
        },
        {
          label: "B：sysfs 读等待",
          path: "drivers/misc/eeprom/at24.c · at24_read()",
          code: `mutex_lock(&at24->lock);

for (i = 0; count; i += ret, count -= ret) {
	ret = at24_regmap_read(at24, buf + i, off + i, count);`,
          startLine: 444, line: 444,
          full: { key: "at24Read", needle: "mutex_lock(&at24->lock);" },
          states: { "participant B": "dd 读 eeprom", "at24.lock": "A 持有 · B 阻塞", "B sequence": "尚未发读消息", "EEPROM": "A 正在完成 8＋4" },
          observations: ["B 不会读到 A 两笔之间的中间状态", "等待发生在访问 regmap 之前"],
          note: "A 未解锁时，B 停在 mutex_lock。只有 A 的循环完成或出错并解锁后，B 才推进到 at24_regmap_read；这就是共享锁带来的顺序。"
        },
        {
          label: "A 解锁，B 才读",
          path: "drivers/misc/eeprom/at24.c · at24_write()",
          code: `mutex_unlock(&at24->lock);

pm_runtime_put(dev);

return 0;`,
          startLine: 505, line: 505,
          full: { key: "at24Write", needle: "return 0;" },
          states: { "A": "写完成 · 解锁 · 返回 0", "at24.lock": "B 获得", "B": "从 0x10 读 12 字节", "expected B result": "Hello-EEPROM" },
          observations: ["A/B 的操作顺序由同一互斥锁串行化", "锁释放不代表销毁 at24_data"],
          note: "这把锁保护的是本 at24 实例的读写序列，不是 EEPROM 的全局事务协议。A 完成后 B 才访问，是软件调度结果，仍需硬件读回验证内容。"
        },
        {
          label: "C：/dev/i2c 不经过此锁",
          path: "code/B-B.3.5/at24c02c_rw.c · main()",
          code: USER_SELECT, startLine: 165, line: 165,
          full: { key: "userMain", needle: "if (ioctl(fd, I2C_SLAVE, DEV_ADDR) < 0) {" },
          states: { "participant C": "用户程序 · 匿名 client", "I2C_SLAVE": "只选择 0x50", "at24.lock": "C 未持有也不知道", "A/B": "可能仍经 sysfs 访问", "safe experiment": "先停业务并解绑" },
          observations: ["匿名 client 与正式 client 是不同对象", "I2C 总线锁不能替代 at24 语义锁"],
          note: "C 的后续 write/I2C_RDWR 直接进入 i2c-dev 和控制器，不调用 at24_write/at24_read。要防止 C 与 A/B 交错，必须实验隔离，而不是希望 at24.lock 自动生效。"
        }
      ],
      pollFallback: [
        {
          label: "零长度探测被拒绝",
          path: "code/B-B.3.5/at24c02c_rw.c · at24_wait_ready()",
          code: USER_WAIT, startLine: 64, line: 64,
          full: { key: "userWait", needle: "ssize_t ret = write(fd, NULL, 0);" },
          states: { "fd": "已 I2C_SLAVE 到 0x50", "write(fd,NULL,0)": "-1", "errno": "EINVAL 或 EOPNOTSUPP · 模型", "return": "进入固定等待回退" },
          observations: ["平台拒绝消息形式不等于 EEPROM 正在忙", "不能用这次失败推断 ACK/NACK"],
          note: "零长度消息是否可用要经过 i2c-dev 和控制器。此场景只演示源码回退，没有声称 RK3568 实板一定返回这两个错误。"
        },
        {
          label: "固定等待 5 ms",
          path: "code/B-B.3.5/at24c02c_rw.c · at24_wait_ready()",
          code: `if (errno == EINVAL || errno == EOPNOTSUPP)
	return sleep_ns(WRITE_CYCLE_NS);`,
          startLine: 70, line: 71,
          full: { key: "userWait", needle: "return sleep_ns(WRITE_CYCLE_NS);" },
          states: { "WRITE_CYCLE_NS": "5 ms · 手册最大写周期", "other errors": "不进入此回退", "return": "sleep_ns 的结果", "next": "仍须读回" },
          observations: ["只有不支持零长度消息才固定等待", "NACK 等其他失败仍受 25 ms 上限约束"],
          note: "固定等待牺牲 ACK Polling 可能提前完成的优势，换取不支持探测时的保守行为。它不证明擦写成功，也不掩盖其他传输错误。"
        },
        {
          label: "读回才是验证",
          path: "code/B-B.3.5/at24c02c_rw.c · at24_read()",
          code: USER_READ, startLine: 117, line: 117,
          full: { key: "userRead", needle: ".flags = I2C_M_RD," },
          states: { "msg[0]": "写内部地址 0x10", "msg[1]": "读 12 字节", "I2C_RDWR": "必须返回 2", "memcmp": "必须 12 字节一致" },
          observations: ["回退之后仍执行复合读", "返回长度与内容比较分别检查"],
          note: "即使固定等待已经结束，WP 高电平也可能让器件仍 ACK 却没有写。只有读回并比较目标内容，才能判断本例数据是否符合预期。"
        }
      ],
      rebind: [
        {
          label: "解绑删除旧接口",
          path: "drivers/nvmem/core.c · nvmem_device_release()",
          code: RELEASE, startLine: 1041, line: 1043,
          full: { key: "nvmemRelease", needle: "device_remove_bin_file(nvmem->base_dev, &nvmem->eeprom);" },
          states: { "old nvmem": "引用释放", "old eeprom": "device_remove_bin_file", "old at24_data/lock/regmap": "设备管理资源回收", "chip content": "不清除" },
          observations: ["/1-0050/eeprom 消失", "设备树描述的正式 client 可保留"],
          note: "解绑撤销的是软件注册关系与运行对象。EEPROM 是非易失存储，没有哪一行 release 代码会把 0x10～0x1b 自动擦除。"
        },
        {
          label: "重绑创建新对象",
          path: "drivers/misc/eeprom/at24.c · at24_probe()",
          code: PROBE_OBJECTS, startLine: 671, line: 679,
          full: { key: "at24Probe", needle: "at24 = devm_kzalloc(dev, struct_size(at24, client_regmaps, num_addresses)," },
          states: { "client": "同一正式 1-0050", "at24_data": "新地址 · 新分配", "lock": "新初始化", "regmap": "新创建", "old lock": "已销毁 · 不继承" },
          observations: ["重绑再次执行 at24_probe", "不会复活旧 at24_data"],
          note: "设备树仍描述硬件，所以 client 可再次匹配驱动；但本次 probe 的运行状态重新建立。新锁不知道旧锁历史，也不需要知道。"
        },
        {
          label: "重新出现 eeprom",
          path: "drivers/nvmem/core.c · nvmem_sysfs_setup_compat()",
          code: NVMEM_FILE, startLine: 386, line: 389,
          full: { key: "nvmemCompat", needle: "rval = device_create_bin_file(nvmem->base_dev, &nvmem->eeprom);" },
          states: { "new nvmem": "注册成功", "new eeprom": "重新创建", "priv": "指向新 at24_data", "return": "0", "returnTone": "good" },
          observations: ["相同路径对应新的软件注册关系", "文件回调接到新对象"],
          note: "路径相同不代表内核对象相同。新的 NVMEM 配置再次携带 compat/base_dev，于是同一路径重新出现，但 priv 已指向新实例。"
        },
        {
          label: "内容跨重绑保留",
          path: "code/B-B.3.5/at24c02c_rw.c · at24_read()",
          code: USER_READ, startLine: 117, line: 117,
          full: { key: "userRead", needle: ".nmsgs = 2," },
          states: { "software objects": "全部为新实例", "EEPROM 0x10～0x1b": "模型：Hello-EEPROM", "verification": "重新读回 12 字节", "conclusion": "持久的是芯片内容，不是旧锁" },
          observations: ["读回验证非易失内容", "不能据此声称旧对象仍存在"],
          note: "这里用同类两条消息表示重新定位并读取。实际重绑后应走新的 sysfs eeprom；本步骤代码只帮助回顾读消息结构，不代表混用路径。"
        }
      ]
    },
    sourceFiles: [
      { name: "at24c02c_rw.c", kind: "原创完整教学程序 · 未编译", url: "../code/B-B.3.5/at24c02c_rw.c", context: "解绑后的受控 /dev/i2c 对照：8＋4 页写、ACK 轮询与 5 ms 回退、复合读和逐字节验证。仅源码审阅。" },
      { name: "rk3568-at24c02c.dts", kind: "原创 DTS 片段 · 未编译", url: "../code/B-B.3.5/rk3568-at24c02c.dts", context: "合并进实际启用 I2C1 的板级 DTS；不是完整板级文件，不能单独当作通用 RK3568 DTB。" },
      { name: "Makefile", kind: "原创交叉构建入口 · 未执行", url: "../code/B-B.3.5/Makefile", context: "需要匹配目标系统的 AArch64 工具链、C 库和 Linux UAPI 头文件。当前环境没有可用编译器。" },
      { name: "at24.c", kind: "Linux v6.6 官方源码", url: "../code/B-B.3.5/linux-v6.6/drivers/misc/eeprom/at24.c", context: "at24_data、probe、NVMEM 配置、页切分、写失败重试和读写的权威实现。" },
      { name: "nvmem/core.c", kind: "Linux v6.6 官方源码", url: "../code/B-B.3.5/linux-v6.6/drivers/nvmem/core.c", context: "bin_attr_nvmem_read/write、兼容 eeprom 文件创建，以及设备管理注销与对象释放。" },
      { name: "regmap.c", kind: "Linux v6.6 官方源码", url: "../code/B-B.3.5/linux-v6.6/drivers/base/regmap/regmap.c", context: "bulk write 和 raw write。重点阅读 -ENOTSUPP 后把内部偏移与数据线性拼装的回退。" },
      { name: "regmap-i2c.c", kind: "Linux v6.6 官方源码", url: "../code/B-B.3.5/linux-v6.6/drivers/base/regmap/regmap-i2c.c", context: "线性写、gather write 与随机读。完整发送返回 0；读事务必须完成两条消息才返回 0。" },
      { name: "i2c-rk3x.c", kind: "Linux v6.6 官方源码", url: "../code/B-B.3.5/linux-v6.6/drivers/i2c/busses/i2c-rk3x.c", context: "rk3x_i2c_func 不含 I2C_FUNC_NOSTART，因此本例 regmap gather write 返回 -ENOTSUPP 并由核心线性化。" },
      { name: "at24.yaml", kind: "Linux v6.6 DT binding", url: "../code/B-B.3.5/linux-v6.6/Documentation/devicetree/bindings/eeprom/at24.yaml", context: "核对 atmel,24c02 匹配项和 pagesize 默认值；pagesize 描述硬件事实，不是性能调节值。" },
      { name: "Kconfig", kind: "Linux v6.6 内核配置", url: "../code/B-B.3.5/linux-v6.6/drivers/misc/eeprom/Kconfig", context: "EEPROM_AT24 依赖 I2C && SYSFS，并选择 NVMEM、NVMEM_SYSFS、REGMAP 和 REGMAP_I2C。" }
    ]
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pad = (value) => String(value).padStart(2, "0");
  const listen = (id, event, handler) => $(id).addEventListener(event, handler);

  function renderCode(element, source, currentLine = -1, startLine = 1) {
    element.replaceChildren();
    source.replace(/\n$/, "").split("\n").forEach((line, index) => {
      const absoluteLine = startLine + index;
      const row = document.createElement("span");
      row.className = "code-line";
      if (absoluteLine === currentLine) row.classList.add("is-current");

      const number = document.createElement("span");
      number.className = "line-no";
      number.textContent = String(absoluteLine);
      number.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "line-text";
      text.textContent = line || " ";
      row.append(number, text);
      element.appendChild(row);
    });

    const current = element.querySelector(".is-current");
    const windowElement = element.parentElement;
    if (current) {
      const top = current.offsetTop - windowElement.clientHeight / 2;
      windowElement.scrollTop = Math.max(0, top);
    } else {
      windowElement.scrollTop = 0;
    }
  }

  function makeFullView(step) {
    if (!step.full) return null;
    const { key, needle } = step.full;
    if (!key || !needle) throw new Error("步骤 full 必须同时提供 key 和 needle");
    const assets = window.LAB_FULL_CODE || {};
    const asset = assets[key];
    if (!asset) throw new Error(`完整代码 key 不存在：${key}`);
    if (typeof asset.code !== "string" || !Number.isInteger(asset.startLine) || asset.startLine < 1) {
      throw new Error(`完整代码 ${key} 必须包含 code 和从 1 开始的整数 startLine`);
    }
    const offset = asset.code.indexOf(needle);
    if (offset < 0) throw new Error(`完整代码 ${key} 中找不到 needle：${needle}`);
    if (offset !== asset.code.lastIndexOf(needle)) {
      throw new Error(`完整代码 ${key} 中 needle 不唯一：${needle}`);
    }
    const highlightLine = asset.startLine + asset.code.slice(0, offset).split("\n").length - 1;
    return {
      path: asset.path || key,
      code: asset.code,
      startLine: asset.startLine,
      highlightLine
    };
  }

  Object.values(LAB_CONFIG.scenarios).forEach((steps) => {
    steps.forEach((step) => {
      step.fullView = makeFullView(step);
    });
  });

  let scenario = "normal";
  let stepIndex = 0;
  let codeViewMode = "snippet";
  let updateStepStrip = () => {};

  function currentSteps() {
    return LAB_CONFIG.scenarios[scenario];
  }

  function makeStepStrip() {
    const container = $("step-strip");
    container.replaceChildren();
    currentSteps().forEach((step, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "step-chip";
      const number = document.createElement("span");
      number.textContent = pad(index + 1);
      button.append(number, document.createTextNode(step.label));
      button.addEventListener("click", () => {
        stepIndex = index;
        renderStep();
      });
      container.appendChild(button);
    });

    updateStepStrip = () => {
      $$(".step-chip", container).forEach((button, index) => {
        button.classList.toggle("is-active", index === stepIndex);
        button.classList.toggle("is-done", index < stepIndex);
        if (index === stepIndex) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    };
  }

  function renderStates(states) {
    const grid = $("state-grid");
    grid.replaceChildren();
    Object.entries(states).forEach(([name, value]) => {
      if (name === "returnTone") return;
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = name;
      detail.textContent = value;
      if (name === "return" && states.returnTone) detail.classList.add(`is-${states.returnTone}`);
      wrapper.append(term, detail);
      grid.appendChild(wrapper);
    });
  }

  function renderCodeView() {
    const step = currentSteps()[stepIndex];
    const toggle = $("step-full-toggle");
    if (codeViewMode === "full" && !step.fullView) codeViewMode = "snippet";
    const showFull = codeViewMode === "full" && step.fullView;

    toggle.disabled = !step.fullView;
    toggle.textContent = showFull ? "步骤片段" : "完整函数";
    toggle.setAttribute("aria-pressed", String(Boolean(showFull)));
    toggle.title = step.fullView ? "在当前步骤片段与其完整来源之间切换" : "本步骤没有登记完整代码，已禁用切换";

    if (showFull) {
      $("step-code-path").textContent = `${step.fullView.path} · 起始行 ${step.fullView.startLine}`;
      renderCode($("step-code"), step.fullView.code, step.fullView.highlightLine, step.fullView.startLine);
    } else {
      $("step-code-path").textContent = `${step.path} · 步骤片段`;
      renderCode($("step-code"), step.code, step.line, step.startLine || 1);
    }
  }

  function renderStep() {
    const steps = currentSteps();
    const step = steps[stepIndex];
    $("step-counter").textContent = `${pad(stepIndex + 1)} / ${pad(steps.length)}`;
    $("step-note").textContent = step.note;
    renderCodeView();
    renderStates(step.states);

    const observations = $("step-observations");
    observations.replaceChildren();
    step.observations.forEach((observation) => {
      const item = document.createElement("li");
      item.textContent = observation;
      observations.appendChild(item);
    });

    $("step-prev").disabled = stepIndex === 0;
    $("step-next").disabled = stepIndex === steps.length - 1;
    updateStepStrip();
  }

  listen("step-full-toggle", "click", () => {
    codeViewMode = codeViewMode === "full" ? "snippet" : "full";
    renderCodeView();
  });
  listen("step-prev", "click", () => {
    stepIndex = Math.max(0, stepIndex - 1);
    renderStep();
  });
  listen("step-next", "click", () => {
    stepIndex = Math.min(currentSteps().length - 1, stepIndex + 1);
    renderStep();
  });
  listen("step-reset", "click", () => {
    stepIndex = 0;
    renderStep();
  });
  listen("scenario-mode", "change", (event) => {
    scenario = event.target.value;
    stepIndex = 0;
    makeStepStrip();
    renderStep();
  });

  const sourceCache = new Map();
  let selectedSource = LAB_CONFIG.sourceFiles[0].name;
  let sourceRequest = 0;

  function renderSourceButtons() {
    const nav = $("source-files");
    nav.replaceChildren();
    LAB_CONFIG.sourceFiles.forEach((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source-file-button";
      button.classList.toggle("is-active", file.name === selectedSource);
      button.setAttribute("aria-pressed", String(file.name === selectedSource));
      const name = document.createElement("code");
      name.textContent = file.name;
      const detail = document.createElement("small");
      detail.textContent = file.kind;
      button.append(name, detail);
      button.addEventListener("click", () => loadSource(file.name));
      nav.appendChild(button);
    });
  }

  async function loadSource(name) {
    const file = LAB_CONFIG.sourceFiles.find((candidate) => candidate.name === name);
    if (!file) return;
    selectedSource = name;
    const request = ++sourceRequest;
    renderSourceButtons();
    $("source-path").textContent = file.url.replace(/^\.\//, "");
    $("source-context").textContent = file.context;
    $("source-download").href = file.url;
    $("source-download").setAttribute("download", file.name);
    $("copy-source").disabled = true;

    if (sourceCache.has(name)) {
      renderCode($("source-code"), sourceCache.get(name));
      $("source-status").textContent = `已从缓存读取 ${name} · 与首次加载内容相同`;
      $("copy-source").disabled = false;
      return;
    }

    $("source-code").textContent = "正在加载…";
    $("source-status").textContent = `请求 ${file.url}`;
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const content = await response.text();
      sourceCache.set(name, content);
      if (request !== sourceRequest) return;
      renderCode($("source-code"), content);
      $("source-status").textContent = `加载成功：${name} · 请按文件说明判断其验证状态`;
      $("copy-source").disabled = false;
    } catch (error) {
      if (request !== sourceRequest) return;
      $("source-code").textContent = `无法加载 ${name}\n${error.message}\n\n请通过 HTTP 打开本页面，或使用“下载文件”直接访问源文件。`;
      $("source-status").textContent = "源码加载失败：file:// 通常会阻止 fetch；请经 MkDocs、GitHub Pages 或其他 HTTP 服务访问。";
    }
  }

  listen("copy-source", "click", async () => {
    const content = sourceCache.get(selectedSource);
    if (!content) return;
    try {
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(content);
          copied = true;
        } catch {
          /* 页面未聚焦时剪贴板 API 可能被拒绝，继续尝试兼容路径。 */
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("浏览器拒绝复制");
      }
      $("source-status").textContent = `已复制 ${selectedSource}`;
    } catch (error) {
      $("source-status").textContent = `复制失败：${error.message}。可在代码区全选，或使用下载文件。`;
    }
  });

  const views = ["mechanism", "source"];
  let activeView = "mechanism";

  function switchView(view, updateHash = true) {
    if (!views.includes(view)) view = "mechanism";
    activeView = view;
    views.forEach((name) => {
      $(`view-${name}`).classList.toggle("is-active", name === view);
    });
    $$(".rail-item").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (updateHash && window.location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }
    if (view === "source" && !sourceCache.has(selectedSource)) loadSource(selectedSource);
    document.title = `${LAB_CONFIG.title} · ${view}`;
  }

  $$(".rail-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  window.addEventListener("hashchange", () => switchView(window.location.hash.slice(1), false));

  document.addEventListener("keydown", (event) => {
    if (activeView !== "mechanism" || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    stepIndex = Math.max(0, Math.min(currentSteps().length - 1, stepIndex + direction));
    renderStep();
    event.preventDefault();
  });

  $("lab-title").textContent = LAB_CONFIG.title;
  $("lab-kicker").textContent = LAB_CONFIG.kicker;
  $("lab-subtitle").textContent = LAB_CONFIG.subtitle;
  $("model-basis").textContent = LAB_CONFIG.modelBasis;
  const tag = $("transaction-tag");
  LAB_CONFIG.transaction.forEach((item, index) => {
    if (index > 0) {
      const arrow = document.createElement("b");
      arrow.textContent = "→";
      tag.appendChild(arrow);
    }
    const value = document.createElement("span");
    value.textContent = item;
    tag.appendChild(value);
  });

  makeStepStrip();
  renderStep();
  renderSourceButtons();
  $("copy-source").disabled = true;
  switchView(views.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "mechanism", false);
})();
