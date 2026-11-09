"use strict";

const FILES = {
  demo: {
    path: "../code/B-B.3.6/pmbus_vout_demo.c",
    label: "pmbus_vout_demo.c",
    context: "原创教学模块。每次加载只执行 raw 或 SMBus 一条路径；未在本环境编译、运行或上板。"
  },
  dts: {
    path: "../code/B-B.3.6/rk3568-tps40422.dts",
    label: "rk3568-tps40422.dts",
    context: "原创板级 DTS 片段，不是完整板级 DTS；地址必须与 ADDR1/ADDR0 电阻配置一致。"
  },
  makefile: {
    path: "../code/B-B.3.6/Makefile",
    label: "Makefile",
    context: "外部模块构建入口。KDIR 必须指向已准备的目标内核源码树。"
  },
  smbus: {
    path: "../code/B-B.3.6/linux-v6.6/drivers/i2c/i2c-core-smbus.c",
    label: "Linux v6.6 · i2c-core-smbus.c",
    context: "SMBus 辅助函数、原生／模拟执行与低高字节组合。"
  },
  tps: {
    path: "../code/B-B.3.6/linux-v6.6/drivers/hwmon/pmbus/tps40422.c",
    label: "Linux v6.6 · tps40422.c",
    context: "TPS40422 器件能力声明与 pmbus_do_probe() 入口。"
  },
  core: {
    path: "../code/B-B.3.6/linux-v6.6/drivers/hwmon/pmbus/pmbus_core.c",
    label: "Linux v6.6 · pmbus_core.c",
    context: "pmbus_data／sensor、属性命名、页缓存、锁、读取、解码与错误传播。"
  }
};

const scenarios = {
  raw: [
    {
      title: "两条消息", file: "demo", start: "static int demo_raw_read_word_data(", focus: "struct i2c_msg msgs[2]",
      note: "第一条消息写命令 0x8B，第二条消息读两字节。它们必须在同一次 i2c_transfer() 中，才能以重复 START 连接。",
      state: { "client->addr": "0x30", "msgs[0]": "write, len=1, buf=8B", "msgs[1]": "read, len=2", "预期消息数": "2" },
      observations: ["I2C_M_RD 只标在第二条消息上。", "此时尚未读取数据，data_buf 不可当结果使用。"]
    },
    {
      title: "传输返回值", file: "demo", start: "static int demo_raw_read_word_data(", focus: "ret = i2c_transfer(client->adapter, msgs, 2);",
      note: "i2c_transfer() 返回负错误或完成消息数。非负但不足 2 条时，demo_xfer_result() 转成 -EIO。",
      state: { "总线样本返回": "2", "demo_xfer_result": "0", "data_buf": "00 03" },
      observations: ["返回 2 才表示两条消息都完成。", "返回 0 或 1 不会进入字节组合。"]
    },
    {
      title: "组合原始字", file: "demo", start: "static int demo_raw_read_word_data(", focus: "*value = (u16)data_buf[0]",
      note: "Word Data 低字节先上线，所以 00 03 组成 0x0300，而不是 0x0003。",
      state: { "data_buf[0]": "0x00（低字节）", "data_buf[1]": "0x03（高字节）", "*value": "0x0300 = 768" },
      observations: ["到这里只有原始字，还没有电压。", "解码还需要 VOUT_MODE 提供指数。"]
    },
    {
      title: "保存旧页", file: "demo", start: "static int demo_read_vout_raw(", focus: "demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &old_page)",
      note: "old_page 是本次调用的独立副本。若第一步失败，芯片页尚未被本函数修改，可以直接返回。",
      state: { "芯片 PAGE": "0", "old_page": "0", "ret": "0" },
      observations: ["保存副本不等于锁定芯片 PAGE。", "后续任何访问者仍可能改变共享页。"]
    },
    {
      title: "选择第 1 页", file: "demo", start: "static int demo_select_page_raw(", focus: "demo_raw_write_byte_data(client, DEMO_PAGE_CMD, page)",
      note: "写 PAGE=1 后再读回。写调用成功只说明事务完成，不证明器件接受了目标页。",
      state: { "写入 PAGE": "1", "读回 PAGE": "1", "ret": "0", "芯片 PAGE": "1" },
      observations: ["读回不一致会返回 -EIO。", "后续 READ_VOUT 以当前 PAGE=1 为上下文。"]
    },
    {
      title: "读取格式", file: "demo", start: "static int demo_read_vout_raw(", focus: "demo_raw_read_byte_data(client, DEMO_VOUT_MODE_CMD, &mode)",
      note: "VOUT_MODE 与 READ_VOUT 是两个命令：前者说明怎样解释数据，后者才是测量数据。",
      state: { "VOUT_MODE": "0x17", "格式": "linear", "指数": "-9", "ret": "0" },
      observations: ["模式不符走 -EOPNOTSUPP，并仍进入恢复。", "reading->mode 保存本样本的解码依据。"]
    },
    {
      title: "读取电压字", file: "demo", start: "static int demo_read_vout_raw(", focus: "demo_raw_read_word_data(client, DEMO_READ_VOUT_CMD,",
      note: "此时芯片 PAGE=1，READ_VOUT 返回第二路的确定性样本 00 03。",
      state: { "芯片 PAGE": "1", "线上数据": "00 03", "reading->raw": "0x0300", "ret": "0" },
      observations: ["这里仍是源码模型设定的样本。", "真实板的电压可以随时间变化。"]
    },
    {
      title: "恢复并核对", file: "demo", start: "static int demo_read_vout_raw(", focus: "restore_ret = demo_select_page_raw(client, old_page);",
      note: "成功和失败路径都汇合到恢复。恢复也写入并读回；读取成功而恢复失败时，最终不能返回成功。",
      state: { "old_page": "0", "恢复后 PAGE": "0", "restore_ret": "0", "函数 ret": "0" },
      observations: ["恢复不撤销已经取得的样本。", "它避免把下一位访问者留在错误页。"]
    },
    {
      title: "解码毫伏", file: "demo", start: "static int demo_decode_mv(", focus: "value = (s64)reading->raw * 1000;",
      note: "指数 -9，因此先乘 1000 再右移 9 位：768000 >> 9 = 1500。",
      state: { "raw": "768", "exponent": "-9", "millivolts": "1500", "ret": "0" },
      observations: ["1500 的单位是 mV。", "raw I2C 路径的全部 PMBus 工作至此才完成。"]
    }
  ],
  native: [
    {
      title: "SMBus 入口", file: "smbus", start: "s32 i2c_smbus_read_word_data(", focus: "return i2c_smbus_xfer(",
      note: "调用者只给 client 和命令 0x8B；辅助函数补上 READ 方向和 WORD_DATA 事务类型。",
      state: { "command": "0x8B", "read_write": "I2C_SMBUS_READ", "size": "I2C_SMBUS_WORD_DATA" },
      observations: ["这里没有 PAGE 或 VOUT_MODE 参数。", "辅助函数仍不知道电源语义。"]
    },
    {
      title: "原生方法", file: "smbus", start: "s32 __i2c_smbus_xfer(", focus: "algo->smbus_xfer",
      note: "适配器提供 algo->smbus_xfer 时，可交给控制器原生执行 SMBus 事务。",
      state: { "algo->smbus_xfer": "存在", "执行路径": "native SMBus", "返回": "0" },
      observations: ["这不是另一颗控制器或另一组引脚。", "是否原生取决于适配器驱动能力。"]
    },
    {
      title: "返回数据字", file: "smbus", start: "s32 i2c_smbus_read_word_data(", focus: "return data.word;",
      note: "原生路径成功时，data.word 已是 0x0300；失败则返回负错误。",
      state: { "data.word": "0x0300", "函数返回": "768", "外层 raw": "0x0300" },
      observations: ["s32 同时容纳负错误和非负数据。", "PAGE 保存、恢复与解码仍在外层教学函数。"]
    }
  ],
  emulated: [
    {
      title: "需要回退", file: "smbus", start: "s32 __i2c_smbus_xfer(", focus: "i2c_smbus_xfer_emulated(",
      note: "没有原生 smbus_xfer，或原生方法返回 -EOPNOTSUPP 且仍有 master_xfer 时，进入模拟路径。",
      state: { "algo->smbus_xfer": "不存在／不支持", "master_xfer": "存在", "执行路径": "emulated" },
      observations: ["回退不是调用失败。", "最终仍由普通 I2C 消息完成。"]
    },
    {
      title: "生成两条消息", file: "smbus", start: "static s32 i2c_smbus_xfer_emulated(", focus: "case I2C_SMBUS_WORD_DATA:",
      note: "模拟器为 Word Data Read 设置一条命令写消息和一条两字节读消息，与路径 A 的形状一致。",
      state: { "msg[0].len": "1（命令）", "msg[1].len": "2（数据）", "nmsgs": "2" },
      observations: ["读事务使用重复 START。", "若启用 PEC，消息末尾还会增加校验字节；本模型未启用。"]
    },
    {
      title: "检查消息数", file: "smbus", start: "static s32 i2c_smbus_xfer_emulated(", focus: "status = __i2c_transfer(adapter, msg, nmsgs);",
      note: "模拟路径同样区分负错误、短消息和完整完成。status != nmsgs 时转成 -EIO。",
      state: { "__i2c_transfer": "2", "nmsgs": "2", "status": "0", "msgbuf1": "00 03" },
      observations: ["只有完整传输后才解释 msgbuf1。", "短消息不会组合出伪造数据。"]
    },
    {
      title: "组合返回字", file: "smbus", start: "static s32 i2c_smbus_xfer_emulated(", focus: "data->word = msgbuf1[0]",
      note: "msgbuf1[0] 是低字节，msgbuf1[1] 是高字节，得到 data.word=0x0300。",
      state: { "msgbuf1": "00 03", "data->word": "0x0300", "status": "0" },
      observations: ["与 raw 路径的组合公式一致。", "模拟 SMBus 消掉的是手工消息样板，不是 PMBus 解码。"]
    }
  ],
  race: [
    {
      title: "A 保存 PAGE=0", file: "demo", start: "static int demo_read_vout_raw(", focus: "demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &old_page)",
      note: "A 的 old_page 在栈上，值是 0；芯片共享 PAGE 也是 0。",
      state: { "A.old_page": "0", "芯片 PAGE": "0", "A 目标": "第二路（1）" },
      observations: ["独立副本与共享状态此刻相同。", "但副本不会阻止下一步被其他访问者插入。"]
    },
    {
      title: "A 切到 PAGE=1", file: "demo", start: "static int demo_select_page_raw(", focus: "demo_raw_write_byte_data(client, DEMO_PAGE_CMD, page)",
      note: "A 已选择第二路，但还没有执行 READ_VOUT。",
      state: { "A.old_page": "0", "芯片 PAGE": "1", "A 下一步": "READ_VOUT" },
      observations: ["单次传输已经结束。", "整个读取函数并未被 I2C 适配器锁自动包住。"]
    },
    {
      title: "B 切到 PAGE=0", file: "demo", start: "static int demo_read_vout_smbus(", focus: "demo_select_page_smbus(client, DEMO_TARGET_PAGE)",
      note: "模型让 B 的目标是第一路，因此把共享 PAGE 改回 0。B 不知道 A 正处于两次传输之间。",
      state: { "A.old_page": "0", "芯片 PAGE": "0（被 B 改写）", "B 目标": "第一路（0）" },
      observations: ["A 的 old_page 仍是 0，没有异常提示。", "共享 PAGE 已不符合 A 的读取前提。"]
    },
    {
      title: "A 读错通道", file: "demo", start: "static int demo_read_vout_raw(", focus: "demo_raw_read_word_data(client, DEMO_READ_VOUT_CMD,",
      note: "A 发出 READ_VOUT 时，芯片 PAGE=0，所以即使事务返回成功，数据也来自第一路。",
      state: { "A 期望页": "1", "实际芯片 PAGE": "0", "A 读取结果": "第一路数据", "总线返回": "成功" },
      observations: ["总线成功不等于页语义正确。", "仅靠返回值无法发现这次交错。"]
    },
    {
      title: "恢复无法补救", file: "demo", start: "static int demo_read_vout_raw(", focus: "restore_ret = demo_select_page_raw(client, old_page);",
      note: "A 恢复 old_page=0，只能处理后续访问环境，不能把刚才的第一路样本变成第二路。",
      state: { "恢复后 PAGE": "0", "A 已存样本": "错误通道", "补救结果": "无法追溯修正" },
      observations: ["需要所有访问者共用锁，或暂停其他访问。", "各自保存 old_page 不是并发协调。"]
    }
  ],
  decode: [
    {
      title: "检查模式位", file: "demo", start: "static int demo_decode_mv(", focus: "if ((reading->mode >> 5) != 0)",
      note: "0x17 右移 5 位得到 0，表示本例支持的线性输出电压格式。",
      state: { "VOUT_MODE": "0x17 = 000 10111", "mode >> 5": "0", "格式": "linear" },
      observations: ["先看格式，再代入公式。", "非线性格式返回 -EOPNOTSUPP。"]
    },
    {
      title: "解释五位指数", file: "demo", start: "static int demo_decode_mv(", focus: "exponent = reading->mode & 0x1f;",
      note: "低五位是 10111=23；最高位为 1，按五位补码减去 32，得到 -9。",
      state: { "低五位": "10111", "无符号值": "23", "exponent": "23 − 32 = −9" },
      observations: ["指数不在 READ_VOUT 数据字中。", "这就是输出电压分支与 LINEAR11 的关键差别。"]
    },
    {
      title: "组合 16 位尾数", file: "demo", start: "static int demo_raw_read_word_data(", focus: "*value = (u16)data_buf[0]",
      note: "完整 READ_VOUT 字按无符号尾数处理：00 03 → 0x0300=768。",
      state: { "低字节": "0x00", "高字节": "0x03", "mantissa": "768" },
      observations: ["不能从高 5 位另拆 LINEAR11 指数。", "0x0300 本身不是 768 mV。"]
    },
    {
      title: "得到毫伏", file: "demo", start: "static int demo_decode_mv(", focus: "value >>= -exponent;",
      note: "先乘 1000，再右移 9 位：768×1000/512=1500。",
      state: { "计算": "768 × 1000 >> 9", "millivolts": "1500", "电压": "1.5 V" },
      observations: ["这是确定性样本的源码推算。", "实际仪器比较还需确认远程检测点与负载测量点。"]
    }
  ],
  driver: [
    {
      title: "声明两页 VOUT", file: "tps", start: "static struct pmbus_driver_info tps40422_info", end: "};",
      note: "tps40422_info.pages=2，两页 func 都包含 PMBUS_HAVE_VOUT，格式为 linear。通用核心由此知道应创建两路输出电压属性。",
      state: { "pages": "2", "format[VOLTAGE_OUT]": "linear", "func[0]": "HAVE_VOUT", "func[1]": "HAVE_VOUT" },
      observations: ["器件驱动声明能力，不逐条实现通用读取。", "VIN、VMON、VCAP 没有在这里声明。"]
    },
    {
      title: "建立器件状态", file: "core", start: "struct pmbus_data {", end: "};",
      note: "pmbus_data 保存整颗器件共享的指数、传感器链、锁和页缓存。probe 初始化 currpage=-1，表示页缓存未知。",
      state: { "currpage": "-1（未知）", "currphase": "-1", "update_lock": "已初始化", "sensors": "待创建" },
      observations: ["第一次访问不能因缓存相同而跳过写页。", "cat 不会销毁这份状态。"]
    },
    {
      title: "分配电压编号", file: "core", start: "static int pmbus_add_sensor_attrs(", focus: "index = 1;",
      note: "电压表依次检查 VIN、VMON、VCAP、READ_VOUT。TPS40422 只有两页 VOUT，所以它们依次得到 index 1、2。",
      state: { "VIN/VMON/VCAP": "不创建、不编号", "page 0 VOUT": "index=1", "page 1 VOUT": "index=2" },
      observations: ["in2_input 的 2 来自实际创建顺序。", "不是把 PAGE=1 直接加 1 的通用规则。"]
    },
    {
      title: "拼出 in2_input", file: "core", start: "static struct pmbus_sensor *pmbus_add_sensor(", focus: "snprintf(sensor->name",
      note: "name=in、seq=2、type=input 拼出 in2_input；同一 sensor 保存 page=1、reg=READ_VOUT、class=VOLTAGE_OUT。",
      state: { "sensor->name": "in2_input", "sensor->page": "1", "sensor->reg": "READ_VOUT", "sensor->data": "-ENODATA" },
      observations: ["属性名与读取上下文一起创建。", "show 回调登记为 pmbus_show_sensor。"]
    },
    {
      title: "初始化指数", file: "core", start: "static int pmbus_identify_common(", focus: "data->exponent[page] = ((s8)(vout_mode << 3)) >> 3;",
      note: "识别阶段读取每页 VOUT_MODE，低五位经有符号移位解释为指数。本例 exponent[1]=-9。",
      state: { "VOUT_MODE(page 1)": "0x17", "exponent[1]": "-9", "格式": "linear" },
      observations: ["正式驱动缓存指数，不必每次 cat 都读 VOUT_MODE。", "原始测量字仍在每次显示时重新读取。"]
    },
    {
      title: "cat 找回 sensor", file: "core", start: "static ssize_t pmbus_show_sensor(", focus: "struct pmbus_sensor *sensor = to_pmbus_sensor(devattr);",
      note: "读取 in2_input 时，to_pmbus_sensor 从当前属性找回对应 sensor，并给 update_lock 加锁。",
      state: { "当前属性": "in2_input", "sensor->page": "1", "update_lock": "locked" },
      observations: ["锁覆盖切页、读取、缓存更新和解码。", "外部 /dev/i2c-N 访问不会自动持有这把锁。"]
    },
    {
      title: "按需切页", file: "core", start: "int pmbus_set_page(", focus: "rv = i2c_smbus_write_byte_data(client, PMBUS_PAGE, page);",
      note: "currpage 不等于 1，所以写 PAGE=1、读回确认，成功后 currpage 才更新为 1。",
      state: { "旧 currpage": "-1／0", "读回 PAGE": "1", "新 currpage": "1" },
      observations: ["读回不一致返回 -EIO。", "下一次同页访问可省略重复写页。"]
    },
    {
      title: "保存原始字", file: "core", start: "static void pmbus_update_sensor_data(", focus: "sensor->data = _pmbus_read_word_data",
      note: "本例 update=true，每次 cat 都重新读取。返回 0x0300 或负错误都先写入 sensor->data。",
      state: { "sensor->data": "0x0300", "SMBus 命令": "0x8B", "原始线上数据": "00 03" },
      observations: ["负错误不会被当成新样本解码。", "成功样本仍需经过类别对应的数据转换。"]
    },
    {
      title: "选择 LINEAR16", file: "core", start: "static s64 pmbus_reg2data_linear(", focus: "if (sensor->class == PSC_VOLTAGE_OUT)",
      note: "输出电压分支从 exponent[1] 取 -9，把 sensor->data 转为 u16 尾数 768；其他线性量才从数据字拆 LINEAR11。",
      state: { "class": "PSC_VOLTAGE_OUT", "mantissa": "768", "exponent": "-9", "val": "1500" },
      observations: ["指数来源与尾数宽度都不能选错。", "本例得到毫伏值 1500。"]
    },
    {
      title: "输出并解锁", file: "core", start: "static ssize_t pmbus_show_sensor(", focus: "ret = sysfs_emit(buf, \"%lld\\n\", pmbus_reg2data(data, sensor));",
      note: "sysfs_emit 写入 1500 换行，随后解锁。对象和页缓存留待下一次读取。",
      state: { "用户看到": "1500\\n", "update_lock": "unlocked", "currpage": "1", "sensor": "继续存在" },
      observations: ["这是一次成功读取的源码模型。", "它不代表仪器测量或电源性能已经验证。"]
    }
  ],
  failure: [
    {
      title: "PAGE 读回不一致", file: "core", start: "int pmbus_set_page(", focus: "if (rv != page)",
      note: "目标页是 1，写事务成功，但读回仍为 0。pmbus_set_page 返回 -EIO，不能更新 currpage=1。",
      state: { "目标 page": "1", "写返回": "0", "读回 PAGE": "0", "返回": "-EIO", "currpage": "保持旧值" },
      observations: ["写成功不等于页选择生效。", "后续读取不能冒充第二路样本。"]
    },
    {
      title: "错误进入 sensor", file: "core", start: "static void pmbus_update_sensor_data(", focus: "sensor->data = _pmbus_read_word_data",
      note: "通用读取把 -EIO 返回到 pmbus_update_sensor_data，sensor->data 因而保存负错误。",
      state: { "_pmbus_read_word_data": "-EIO", "sensor->data": "-EIO", "有效新样本": "无" },
      observations: ["同一字段用符号区分原始字和错误。", "调用者不能把它强转成 u16 后继续显示。"]
    },
    {
      title: "cat 收到错误", file: "core", start: "static ssize_t pmbus_show_sensor(", focus: "if (sensor->data < 0)",
      note: "显示函数看到负值，跳过 pmbus_reg2data 和 sysfs_emit，解锁后返回错误。",
      state: { "sensor->data": "-EIO", "sysfs_emit": "未调用", "cat": "读取失败" },
      observations: ["不会输出由负错误转换出的巨大电压。", "也不会把旧样本伪装成本次新读数。"]
    },
    {
      title: "读取成功但恢复失败", file: "demo", start: "static int demo_read_vout_raw(", focus: "if (restore_ret < 0) {",
      note: "教学路径已取得有效样本，但恢复旧页写入或读回失败。restore_ret<0 且原 ret==0，因此最终返回恢复错误。",
      state: { "reading->raw": "0x0300（已读）", "读取 ret": "0", "restore_ret": "-EIO", "最终 ret": "-EIO" },
      observations: ["调用者不能把本次调用当完全成功。", "共享 PAGE 可能仍停留在目标页，需要排障。"]
    },
    {
      title: "原错误优先并留痕", file: "demo", start: "static int demo_read_vout_raw(", focus: "dev_err(&client->dev, \"restore PAGE=%u failed: %d\\n\",",
      note: "如果读取和恢复都失败，函数保留最初读取错误，同时 dev_err 记录恢复失败，避免第二个错误完全覆盖第一个。",
      state: { "读取 ret": "-ENXIO（示例）", "restore_ret": "-EIO", "最终 ret": "-ENXIO", "恢复错误": "已记录" },
      observations: ["错误优先级是显式设计，不是自然发生。", "返回后仍需检查并恢复共享页状态。"]
    }
  ]
};

const sources = {};
let activeScenario = "raw";
let activeStep = 0;
let showFullFunction = false;
let activeSource = "demo";

const $ = (id) => document.getElementById(id);

function matchingBrace(text, openIndex) {
  let depth = 0;
  let state = "normal";
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1] || "";
    if (state === "lineComment") {
      if (c === "\n") state = "normal";
      continue;
    }
    if (state === "blockComment") {
      if (c === "*" && n === "/") { state = "normal"; i++; }
      continue;
    }
    if (state === "string" || state === "char") {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if ((state === "string" && c === '"') || (state === "char" && c === "'")) state = "normal";
      continue;
    }
    if (c === "/" && n === "/") { state = "lineComment"; i++; continue; }
    if (c === "/" && n === "*") { state = "blockComment"; i++; continue; }
    if (c === '"') { state = "string"; continue; }
    if (c === "'") { state = "char"; continue; }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("找不到函数结束大括号");
}

function extractRegion(step) {
  const text = sources[step.file];
  if (!text) throw new Error(`源码尚未加载：${step.file}`);
  const start = text.indexOf(step.start);
  if (start < 0) throw new Error(`找不到源码起点：${step.start}`);
  let end;
  if (step.end) {
    end = text.indexOf(step.end, start);
    if (end < 0) throw new Error(`找不到源码终点：${step.end}`);
    end += step.end.length;
  } else {
    const open = text.indexOf("{", start);
    if (open < 0) throw new Error("找不到函数起始大括号");
    end = matchingBrace(text, open) + 1;
  }
  const content = text.slice(start, end);
  const startLine = text.slice(0, start).split("\n").length;
  return { content, startLine, endLine: startLine + content.split("\n").length - 1 };
}

function snippetFor(step, region) {
  if (showFullFunction || !step.focus) return region;
  const lines = region.content.split("\n");
  const index = lines.findIndex((line) => line.includes(step.focus));
  if (index < 0) return region;
  const before = step.file === "core" || step.file === "smbus" ? 5 : 4;
  const after = 9;
  const from = Math.max(0, index - before);
  const to = Math.min(lines.length, index + after);
  return {
    content: lines.slice(from, to).join("\n"),
    startLine: region.startLine + from,
    endLine: region.startLine + to - 1
  };
}

function renderState(state) {
  $("state-grid").replaceChildren();
  Object.entries(state).forEach(([key, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = value;
    $("state-grid").append(dt, dd);
  });
}

function renderStep() {
  const steps = scenarios[activeScenario];
  const step = steps[activeStep];
  $("step-counter").textContent = `${activeStep + 1} / ${steps.length}`;
  $("step-prev").disabled = activeStep === 0;
  $("step-next").disabled = activeStep === steps.length - 1;
  $("step-note").textContent = step.note;
  $("step-full-toggle").textContent = showFullFunction ? "步骤片段" : "完整函数／定义";
  $("step-full-toggle").setAttribute("aria-pressed", String(showFullFunction));
  renderState(step.state);
  $("step-observations").replaceChildren();
  step.observations.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    $("step-observations").append(li);
  });
  document.querySelectorAll(".step-dot").forEach((button, index) => {
    button.classList.toggle("is-active", index === activeStep);
    button.classList.toggle("is-done", index < activeStep);
    button.setAttribute("aria-current", index === activeStep ? "step" : "false");
  });
  try {
    const region = snippetFor(step, extractRegion(step));
    $("step-code").textContent = region.content;
    $("step-code").classList.remove("error-text");
    $("step-code-path").textContent = `${FILES[step.file].label}:${region.startLine}-${region.endLine}`;
  } catch (error) {
    $("step-code").textContent = String(error);
    $("step-code").classList.add("error-text");
    $("step-code-path").textContent = FILES[step.file].label;
  }
}

function renderStepStrip() {
  $("step-strip").replaceChildren();
  scenarios[activeScenario].forEach((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "step-dot";
    button.textContent = `${index + 1}. ${step.title}`;
    button.title = step.title;
    button.addEventListener("click", () => { activeStep = index; renderStep(); });
    $("step-strip").append(button);
  });
}

function selectScenario(value) {
  activeScenario = value;
  activeStep = 0;
  showFullFunction = false;
  renderStepStrip();
  renderStep();
}

function showView(name) {
  document.querySelectorAll(".rail-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === name));
  document.querySelectorAll(".lab-view").forEach((view) => view.classList.toggle("is-active", view.id === `view-${name}`));
}

function selectSource(key) {
  activeSource = key;
  const file = FILES[key];
  document.querySelectorAll(".source-file").forEach((button) => button.classList.toggle("is-active", button.dataset.file === key));
  $("source-path").textContent = file.path;
  $("source-context").textContent = file.context;
  $("source-download").href = file.path;
  $("source-download").download = file.path.split("/").pop();
  $("source-code").textContent = sources[key] || "源码加载失败或尚未完成。";
  $("source-code").classList.toggle("error-text", !sources[key]);
  $("source-status").textContent = sources[key] ? `${sources[key].split("\n").length} 行 · 完整文件` : "请通过 MkDocs／HTTP 打开，而不是 file://。";
}

function renderSourceFiles() {
  $("source-files").replaceChildren();
  Object.entries(FILES).forEach(([key, file]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-file";
    button.dataset.file = key;
    button.textContent = file.label;
    button.addEventListener("click", () => selectSource(key));
    $("source-files").append(button);
  });
  selectSource(activeSource);
}

async function loadSources() {
  const results = await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    try {
      const response = await fetch(file.path);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return [key, await response.text(), null];
    } catch (error) {
      return [key, null, error];
    }
  }));
  results.forEach(([key, text, error]) => {
    if (text !== null) sources[key] = text;
    else console.error(`加载 ${FILES[key].path} 失败`, error);
  });
  renderSourceFiles();
  renderStepStrip();
  renderStep();
}

$("scenario-mode").addEventListener("change", (event) => selectScenario(event.target.value));
$("step-prev").addEventListener("click", () => { if (activeStep > 0) { activeStep--; renderStep(); } });
$("step-next").addEventListener("click", () => { if (activeStep < scenarios[activeScenario].length - 1) { activeStep++; renderStep(); } });
$("step-reset").addEventListener("click", () => { activeStep = 0; showFullFunction = false; renderStep(); });
$("step-full-toggle").addEventListener("click", () => { showFullFunction = !showFullFunction; renderStep(); });
document.querySelectorAll(".rail-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("copy-source").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(sources[activeSource] || "");
    $("source-status").textContent = "已复制当前完整文件。";
  } catch {
    $("source-status").textContent = "浏览器未允许剪贴板访问，请手动选择代码复制。";
  }
});
document.addEventListener("keydown", (event) => {
  if (!$("view-mechanism").classList.contains("is-active")) return;
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
  if (event.key === "ArrowLeft") $("step-prev").click();
  if (event.key === "ArrowRight") $("step-next").click();
});

renderStepStrip();
renderStep();
loadSources();
