(() => {
  "use strict";

  const USER_MESSAGES = `write_buf[0] = (unsigned char)offset;
memset(msgs, 0, sizeof(msgs));
msgs[0].addr = (__u16)address;
msgs[0].flags = 0;
msgs[0].len = sizeof(write_buf);
msgs[0].buf = write_buf;
msgs[1].addr = (__u16)address;
msgs[1].flags = I2C_M_RD;
msgs[1].len = sizeof(read_buf);
msgs[1].buf = read_buf;

rdwr.msgs = msgs;
rdwr.nmsgs = 2;
ret = ioctl(fd, I2C_RDWR, &rdwr);`;

  const USER_RESULT = `ret = ioctl(fd, I2C_RDWR, &rdwr);
if (ret < 0) {
    fprintf(stderr, "I2C_RDWR 失败：%s\\n", strerror(errno));
    goto out;
}
if (ret != 2) {
    fprintf(stderr, "事务不完整：只完成 %d/2 条消息，丢弃读缓冲区\\n", ret);
    goto out;
}

printf("offset 0x%02lx:", offset);
for (i = 0; i < READ_LENGTH; i++)
    printf(" 0x%02x", read_buf[i]);
putchar('\\n');`;

  const USER_BUSY = `/* 与 i2ctransfer 默认行为一致：先拒绝已由内核驱动占用的地址。 */
if (ioctl(fd, I2C_SLAVE, address) < 0) {
    fprintf(stderr, "选择地址 0x%02lx 失败：%s\\n", address,
        strerror(errno));
    goto out;
}`;

  const USER_CLOSE = `out:
if (fd >= 0 && close(fd) < 0) {
    fprintf(stderr, "关闭 %s 失败：%s\\n", device_path, strerror(errno));
    status = EXIT_FAILURE;
}
return status;`;

  const OPEN_CLIENT = `adap = i2c_get_adapter(minor);
if (!adap)
    return -ENODEV;

client = kzalloc(sizeof(*client), GFP_KERNEL);
if (!client) {
    i2c_put_adapter(adap);
    return -ENOMEM;
}
snprintf(client->name, I2C_NAME_SIZE, "i2c-dev %d", adap->nr);

client->adapter = adap;
file->private_data = client;`;

  const IOCTL_RDWR = `case I2C_RDWR: {
    struct i2c_rdwr_ioctl_data rdwr_arg;
    struct i2c_msg *rdwr_pa;

    if (copy_from_user(&rdwr_arg,
               (struct i2c_rdwr_ioctl_data __user *)arg,
               sizeof(rdwr_arg)))
        return -EFAULT;

    if (!rdwr_arg.msgs || rdwr_arg.nmsgs == 0)
        return -EINVAL;

    if (rdwr_arg.nmsgs > I2C_RDWR_IOCTL_MAX_MSGS)
        return -EINVAL;

    rdwr_pa = memdup_user(rdwr_arg.msgs,
                  rdwr_arg.nmsgs * sizeof(struct i2c_msg));
    if (IS_ERR(rdwr_pa))
        return PTR_ERR(rdwr_pa);

    return i2cdev_ioctl_rdwr(client, rdwr_arg.nmsgs, rdwr_pa);
}`;

  const IOCTL_BUSY = `switch (cmd) {
case I2C_SLAVE:
case I2C_SLAVE_FORCE:
    if ((arg > 0x3ff) ||
        (((client->flags & I2C_M_TEN) == 0) && arg > 0x7f))
        return -EINVAL;
    if (cmd == I2C_SLAVE && i2cdev_check_addr(client->adapter, arg))
        return -EBUSY;
    /* REVISIT: address could become busy later */
    client->addr = arg;
    return 0;`;

  const RDWR_COPY = `res = 0;
for (i = 0; i < nmsgs; i++) {
    /* Limit the size of the message to a sane amount */
    if (msgs[i].len > 8192) {
        res = -EINVAL;
        break;
    }

    data_ptrs[i] = (u8 __user *)msgs[i].buf;
    msgs[i].buf = memdup_user(data_ptrs[i], msgs[i].len);
    if (IS_ERR(msgs[i].buf)) {
        res = PTR_ERR(msgs[i].buf);
        break;
    }
    /* memdup_user allocates with GFP_KERNEL, so DMA is ok */
    msgs[i].flags |= I2C_M_DMA_SAFE;
}`;

  const CORE_LOCK = `ret = __i2c_lock_bus_helper(adap);
if (ret)
    return ret;

ret = __i2c_transfer(adap, msgs, num);
i2c_unlock_bus(adap, I2C_LOCK_SEGMENT);`;

  const CORE_MSGS = `if (static_branch_unlikely(&i2c_trace_msg_key)) {
    int i;
    for (i = 0; i < num; i++)
        if (msgs[i].flags & I2C_M_RD)
            trace_i2c_read(adap, &msgs[i], i);
        else
            trace_i2c_write(adap, &msgs[i], i);
}

/* Retry automatically on arbitration loss */
orig_jiffies = jiffies;
for (ret = 0, try = 0; try <= adap->retries; try++) {
    if (i2c_in_atomic_xfer_mode() && adap->algo->master_xfer_atomic)
        ret = adap->algo->master_xfer_atomic(adap, msgs, num);
    else
        ret = adap->algo->master_xfer(adap, msgs, num);`;

  const CORE_RESULT = `if (static_branch_unlikely(&i2c_trace_msg_key)) {
    int i;
    for (i = 0; i < ret; i++)
        if (msgs[i].flags & I2C_M_RD)
            trace_i2c_reply(adap, &msgs[i], i);
    trace_i2c_result(adap, num, ret);
}

return ret;`;

  const RDWR_RETURN = `res = i2c_transfer(client->adapter, msgs, nmsgs);
while (i-- > 0) {
    if (res >= 0 && (msgs[i].flags & I2C_M_RD)) {
        if (copy_to_user(data_ptrs[i], msgs[i].buf,
                 msgs[i].len))
            res = -EFAULT;
    }
    kfree(msgs[i].buf);
}
kfree(data_ptrs);
kfree(msgs);
return res;`;

  const RELEASE = `static int i2cdev_release(struct inode *inode, struct file *file)
{
    struct i2c_client *client = file->private_data;

    i2c_put_adapter(client->adapter);
    kfree(client);
    file->private_data = NULL;

    return 0;
}`;

  const LAB_CONFIG = {
    title: "i2c-dev Lab · 一笔读取怎样穿过用户态与内核",
    kicker: "B-B.3.4 · SOURCE-GROUNDED DEBUGGING",
    subtitle: "沿 AT24C02 的同一笔读取，逐步核对代码位置、匿名 client、消息缓冲区、锁与返回值。",
    transaction: ["/dev/i2c-1", "w1@0x50 0x10", "r4", "ret = 2", "Hell"],
    modelBasis: "依据 Linux v6.6 与 i2c-tools v4.4 构造的模型；未连接硬件",
    scenarios: {
      normal: [
        {
          label: "组织两条消息",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_MESSAGES,
          startLine: 88,
          line: 99,
          full: { key: "userMain", needle: "write_buf[0] = (unsigned char)offset;" },
          states: { "msgs[0]": "addr=0x50 · flags=0 · len=1 · buf=[10]", "msgs[1]": "addr=0x50 · flags=I2C_M_RD · len=4", "rdwr.nmsgs": "2", "return": "尚未 ioctl" },
          observations: ["第一条消息只写内部偏移 0x10", "第二条消息从同一地址读 4 字节"],
          note: "rdwr.nmsgs=2 是两条消息，不是读两字节。两个描述符进入同一次 I2C_RDWR，中间应是重复 START。"
        },
        {
          label: "打开并创建匿名 client",
          path: "drivers/i2c/i2c-dev.c · i2cdev_open()",
          code: OPEN_CLIENT,
          startLine: 591,
          line: 602,
          full: { key: "deviceOpen", needle: "client = kzalloc(sizeof(*client), GFP_KERNEL);" },
          states: { "adap": "i2c-1 · 引用计数 +1", "anonymous client": "已分配并清零", "client.adapter": "指向 adap", "file.private_data": "指向匿名 client", "registered 1-0050": "没有创建" },
          observations: ["打开文件不会重新创建控制器", "匿名 client 不注册进设备模型"],
          note: "kzalloc 建立的是本次打开私有的寻址状态。adapter 关系与 file.private_data 关系建立后，后续 ioctl 才能找回这两个对象。"
        },
        {
          label: "复制 ioctl 参数",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl()",
          code: IOCTL_RDWR,
          startLine: 434,
          line: 453,
          full: { key: "deviceIoctl", needle: "case I2C_RDWR: {" },
          states: { "rdwr_arg.nmsgs": "2", "rdwr_pa": "两条 i2c_msg 的内核副本", "msgs[i].buf": "此刻仍是用户指针", "return": "进入 i2cdev_ioctl_rdwr" },
          observations: ["空指针、零消息和超过 42 条会在传输前失败", "消息数组已复制，数据缓冲区尚未逐条复制"],
          note: "copy_from_user 先复制外层 rdwr 参数，memdup_user 再复制消息数组。此时尚未访问 SDA/SCL。"
        },
        {
          label: "复制两条数据缓冲区",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_COPY,
          startLine: 247,
          line: 256,
          full: { key: "deviceRdwr", needle: "msgs[i].buf = memdup_user(data_ptrs[i], msgs[i].len);" },
          states: { "data_ptrs[0/1]": "保存原用户 buf 地址", "msgs[0].buf": "内核副本 · 1 字节 [10]", "msgs[1].buf": "内核副本 · 4 字节", "I2C_M_DMA_SAFE": "两条消息均设置", "return": "res=0 · 准备传输" },
          observations: ["原用户地址没有丢失", "控制器后续只接触内核缓冲区"],
          note: "每条消息先保存用户指针，再把 buf 替换为内核副本。若长度、复制或内存检查失败，会清理已分配对象并返回，总线尚未执行。"
        },
        {
          label: "Core 持锁",
          path: "drivers/i2c/i2c-core-base.c · i2c_transfer()",
          code: CORE_LOCK,
          startLine: 2279,
          line: 2283,
          full: { key: "coreTransfer", needle: "ret = __i2c_lock_bus_helper(adap);" },
          states: { "adapter lock": "已持有", "msgs": "写偏移 + 读数据", "return": "进入 __i2c_transfer" },
          observations: ["同一适配器的软件传输不会交错", "锁不理解 AT24C02 的内部偏移"],
          note: "总线锁保护一笔传输的调度边界，不替代 at24 与用户工具之间的占用协调。调用返回前必须解锁。"
        },
        {
          label: "控制器执行两条消息",
          path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()",
          code: CORE_MSGS,
          startLine: 2207,
          line: 2222,
          full: { key: "coreUnlocked", needle: "ret = adap->algo->master_xfer(adap, msgs, num);" },
          states: { "trace request": "#0 write [10] · #1 read len=4", "master_xfer": "RK3568 控制器实现", "wire model": "S → A0 → 10 → Sr → A1 → 4字节 → P", "return": "正常场景即将得到 2" },
          observations: ["请求事件先于控制器执行记录", "正常场景模型：两条消息都完成"],
          note: "trace 证明软件提交了什么，master_xfer 才进入具体控制器。线上 ACK 与电平仍需仪器验证，不能由这段代码直接推出。"
        },
        {
          label: "Core 返回完成数 2",
          path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()",
          code: CORE_RESULT,
          startLine: 2230,
          line: 2235,
          full: { key: "coreUnlocked", needle: "trace_i2c_result(adap, num, ret);" },
          states: { "ret": "2", "returnTone": "good", "trace reply": "#1 [48 65 6c 6c]", "trace result": "i2c-1 n=2 ret=2", "adapter lock": "返回 i2c_transfer 后释放" },
          observations: ["n=2 是提交数，ret=2 是完成数", "读回复包含 Hell 的四个字节"],
          note: "只有完成且为读方向的消息才记录 reply。主实例 ret=2 才表示两条消息完整完成。"
        },
        {
          label: "回写读数据并释放内核副本",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_RETURN,
          startLine: 297,
          line: 300,
          full: { key: "deviceRdwr", needle: "res = i2c_transfer(client->adapter, msgs, nmsgs);" },
          states: { "res": "2", "returnTone": "good", "user read_buf": "[48 65 6c 6c]", "kernel msg buffers": "全部 kfree", "data_ptrs / msgs": "全部 kfree" },
          observations: ["只有读消息需要 copy_to_user", "成功与失败都要释放内核缓冲区"],
          note: "copy_to_user 使用 data_ptrs 中保存的原用户地址。当前 res=2 且复制成功，所以最终仍返回 2。"
        },
        {
          label: "用户态验证并打印",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_RESULT,
          startLine: 101,
          line: 106,
          full: { key: "userMain", needle: "ret = ioctl(fd, I2C_RDWR, &rdwr);" },
          states: { "ioctl ret": "2", "returnTone": "good", "read_buf": "48 65 6c 6c", "stdout": "offset 0x10: 0x48 0x65 0x6c 0x6c", "program status": "即将 EXIT_SUCCESS" },
          observations: ["ret<0 与 ret!=2 都没有进入打印分支", "只有完整事务才把读缓冲区当成结果"],
          note: "用户态 ioctl 返回 -1 时要看 errno；非负值则是完成消息数。教学程序用 ret==2 防止短事务被当成成功。"
        },
        {
          label: "关闭并销毁匿名 client",
          path: "drivers/i2c/i2c-dev.c · i2cdev_release()",
          code: RELEASE,
          startLine: 615,
          line: 620,
          full: { key: "deviceRelease", needle: "i2c_put_adapter(client->adapter);" },
          states: { "adapter reference": "已放下", "anonymous client": "已释放", "file.private_data": "NULL", "formal 1-0050 / adapter": "不因本次 close 注销", "return": "用户程序 EXIT_SUCCESS", "returnTone": "good" },
          observations: ["本次打开的对象生命周期结束", "正式设备对象与控制器仍存在"],
          note: "close 只释放匿名 client 和适配器引用。它不是解绑 at24，也不是删除 /dev/i2c-1。"
        }
      ],
      busy: [
        {
          label: "默认占用检查",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_BUSY,
          startLine: 81,
          line: 82,
          full: { key: "userMain", needle: "if (ioctl(fd, I2C_SLAVE, address) < 0)" },
          states: { "formal client": "1-0050 · at24 已绑定", "anonymous client": "本次 open 创建", "request": "I2C_SLAVE · addr=0x50", "I2C_RDWR": "尚未执行" },
          observations: ["两个 client 是不同的对象", "默认路径先检查地址占用"],
          note: "busy 场景与正常读取使用同一地址，但 at24 已绑定。此处不是用 force 绕过，而是执行默认 I2C_SLAVE。"
        },
        {
          label: "内核返回 EBUSY",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl()",
          code: IOCTL_BUSY,
          startLine: 400,
          line: 407,
          full: { key: "deviceIoctl", needle: "if (cmd == I2C_SLAVE && i2cdev_check_addr(client->adapter, arg))" },
          states: { "i2cdev_check_addr": "发现地址已绑定", "kernel return": "-EBUSY", "returnTone": "error", "client.addr": "未写入新地址", "I2C_RDWR": "不会执行" },
          observations: ["UU 对应的是跳过探测与占用，不是 NACK", "失败发生在任何总线传输之前"],
          note: "检查失败直接返回，client->addr 赋值和后续 I2C_RDWR 都不发生。强制选项只会绕过这个检查，不能协调两个访问者的器件状态。"
        },
        {
          label: "用户态拒绝访问",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_BUSY,
          startLine: 81,
          line: 83,
          full: { key: "userMain", needle: "if (ioctl(fd, I2C_SLAVE, address) < 0)" },
          states: { "ioctl ret": "-1", "errno": "EBUSY", "returnTone": "error", "read_buf": "保持初始 00 00 00 00 · 不打印", "next": "goto out" },
          observations: ["不会提交两条消息", "不会把读缓冲区当成 Hell"],
          note: "libc 把内核 -EBUSY 转成用户态 ioctl=-1、errno=EBUSY。程序进入统一清理出口。"
        },
        {
          label: "关闭本次打开",
          path: "drivers/i2c/i2c-dev.c · i2cdev_release()",
          code: RELEASE,
          startLine: 615,
          line: 620,
          full: { key: "deviceRelease", needle: "i2c_put_adapter(client->adapter);" },
          states: { "anonymous client": "已释放", "at24 formal client": "仍绑定", "program status": "EXIT_FAILURE", "returnTone": "error" },
          observations: ["清理匿名对象不等于解绑 at24", "失败路径也没有遗留本次打开的对象"],
          note: "正确的下一步是停止业务并按系统集成流程处理绑定，而不是把 -f 当作常规修复。"
        }
      ],
      nack: [
        {
          label: "消息已复制",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_COPY,
          startLine: 247,
          line: 256,
          full: { key: "deviceRdwr", needle: "msgs[i].buf = memdup_user(data_ptrs[i], msgs[i].len);" },
          states: { "msgs": "两条内核消息已准备", "wire assumption": "模型：地址字节 0xA0 后收到 NACK", "return": "即将进入 Core" },
          observations: ["参数和内存检查已通过", "NACK 只能由执行阶段发现"],
          note: "这里把同一笔读取放到地址无应答的模型中。软件结构完全正确，也可能在线上寻址失败。"
        },
        {
          label: "控制器返回负错误码",
          path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()",
          code: CORE_MSGS,
          startLine: 2207,
          line: 2222,
          full: { key: "coreUnlocked", needle: "ret = adap->algo->master_xfer(adap, msgs, num);" },
          states: { "wire model": "0xA0 → NACK", "master_xfer ret": "负值（示例模型 -EIO）", "returnTone": "error", "second message": "未完成" },
          observations: ["寻址失败与读数据 NACK 不是同一位置", "具体 errno 由控制器实现与错误路径决定"],
          note: "-EIO 只是本场景示例，不是所有控制器对 NACK 的统一映射。真实定位要对齐控制驱动、trace 与抓包。"
        },
        {
          label: "记录失败结果",
          path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()",
          code: CORE_RESULT,
          startLine: 2230,
          line: 2235,
          full: { key: "coreUnlocked", needle: "trace_i2c_result(adap, num, ret);" },
          states: { "ret": "负值", "returnTone": "error", "trace reply": "没有完成读消息可记录", "trace result": "n=2 · ret<0", "adapter lock": "返回后释放" },
          observations: ["请求事件仍可能存在", "没有完整读回复，不能伪造 Hell"],
          note: "reply 循环只走到 ret；负值时不会记录正常读回复。result 仍保留整组失败结果。"
        },
        {
          label: "跳过回写但执行清理",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_RETURN,
          startLine: 297,
          line: 299,
          full: { key: "deviceRdwr", needle: "res = i2c_transfer(client->adapter, msgs, nmsgs);" },
          states: { "res": "负值", "returnTone": "error", "copy_to_user": "条件 res>=0 不成立 · 跳过", "kernel buffers": "仍然全部释放" },
          observations: ["错误不会泄漏内核消息缓冲区", "用户读缓冲区没有收到有效数据"],
          note: "跳过 copy_to_user 不等于跳过 kfree。错误路径的清理与结果判断必须分别跟踪。"
        },
        {
          label: "用户态报告失败",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_RESULT,
          startLine: 101,
          line: 102,
          full: { key: "userMain", needle: "ret = ioctl(fd, I2C_RDWR, &rdwr);" },
          states: { "ioctl ret": "-1", "errno": "正值错误号", "returnTone": "error", "stdout": "不打印读取结果", "program status": "EXIT_FAILURE" },
          observations: ["程序报告 I2C_RDWR 失败", "下一步查地址、供电、连接和器件状态"],
          note: "不能只看缓冲区是否全 0 或全 ff。失败结论来自返回值，硬件根因还需 trace 与逻辑分析仪对齐。"
        }
      ],
      short: [
        {
          label: "控制器只完成 1 条",
          path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()",
          code: CORE_RESULT,
          startLine: 2230,
          line: 2235,
          full: { key: "coreUnlocked", needle: "trace_i2c_result(adap, num, ret);" },
          states: { "num": "2", "ret": "1", "returnTone": "error", "completed": "写偏移消息完成 · 读消息未完成", "trace result": "n=2 ret=1" },
          observations: ["非负不自动等于完全成功", "主实例预期数是 2"],
          note: "短事务模型使用 ret=1。它不是负 errno，但也不满足本次两条消息的成功约定。"
        },
        {
          label: "非负结果仍可能回写",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_RETURN,
          startLine: 297,
          line: 299,
          full: { key: "deviceRdwr", needle: "res = i2c_transfer(client->adapter, msgs, nmsgs);" },
          states: { "res": "1", "returnTone": "error", "copy_to_user": "res>=0 且读标志成立 · 源码会执行", "kernel buffers": "随后全部释放" },
          observations: ["用户缓冲区出现字节不能证明事务完整", "必须再看完成消息数"],
          note: "这是 v6.6 源码容易漏看的分支：res 非负时会回写读消息，即使 ret 小于 nmsgs。调用者不能省略第二次检查。"
        },
        {
          label: "用户态拒绝短事务",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_RESULT,
          startLine: 101,
          line: 106,
          full: { key: "userMain", needle: "if (ret != 2) {" },
          states: { "ioctl ret": "1", "returnTone": "error", "branch": "ret != 2 为真", "read_buf": "明确丢弃", "program status": "EXIT_FAILURE" },
          observations: ["输出“只完成 1/2 条消息”", "不会打印 Hell 或部分字节作为成功"],
          note: "完整程序把 ret==2 作为唯一可打印条件，防止残留或部分数据造成假成功。"
        },
        {
          label: "关闭并保留失败状态",
          path: "code/B-B.3.4/i2c-rdwr-read.c · main()",
          code: USER_CLOSE,
          startLine: 119,
          line: 124,
          full: { key: "userMain", needle: "if (fd >= 0 && close(fd) < 0)" },
          states: { "fd": "关闭", "anonymous client": "由 release 释放", "program status": "EXIT_FAILURE", "returnTone": "error" },
          observations: ["资源清理不改变短事务结论", "下一步对齐 trace 与控制器行为"],
          note: "status 初始为失败，只有完整读取才改为成功。统一出口不会把短事务意外覆盖成 0。"
        }
      ],
      efault: [
        {
          label: "硬件事务已完成",
          path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()",
          code: CORE_RESULT,
          startLine: 2230,
          line: 2235,
          full: { key: "coreUnlocked", needle: "trace_i2c_result(adap, num, ret);" },
          states: { "Core ret": "2", "returnTone": "good", "kernel read buffer": "[48 65 6c 6c]", "user read pointer": "故障模型：不可写地址", "hardware": "两条消息已经执行" },
          observations: ["总线阶段已经成功", "故障发生在结果返回用户态阶段"],
          note: "本场景故意把读消息的用户目标地址设为不可写，用来推演 copy_to_user 失败；正文教学 C 程序使用有效数组，不会主动制造此错误。"
        },
        {
          label: "copy_to_user 失败",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_RETURN,
          startLine: 297,
          line: 302,
          full: { key: "deviceRdwr", needle: "res = -EFAULT;" },
          states: { "res before": "2", "copy_to_user": "返回非 0", "res after": "-EFAULT", "returnTone": "error", "hardware": "已经执行，不能回滚" },
          observations: ["最终结果从完成数变成用户地址错误", "EFAULT 不等于设备 NACK"],
          note: "copy_to_user 在 i2c_transfer 之后才执行，因此失败只改变结果交付状态，不会撤销已经发生的 START、读写与 STOP。"
        },
        {
          label: "清理内核对象",
          path: "drivers/i2c/i2c-dev.c · i2cdev_ioctl_rdwr()",
          code: RDWR_RETURN,
          startLine: 297,
          line: 304,
          full: { key: "deviceRdwr", needle: "kfree(msgs[i].buf);" },
          states: { "res": "-EFAULT", "returnTone": "error", "msg buffers": "kfree", "data_ptrs / msgs": "kfree", "kernel return": "-EFAULT" },
          observations: ["结果交付失败仍完成内存清理", "不能把有效内核读缓冲区继续当作用户结果"],
          note: "while 逆序处理每条消息，kfree 不受 copy_to_user 失败影响。释放后函数把 -EFAULT 返回给 ioctl 分派层。"
        },
        {
          label: "用户态看到 EFAULT",
          path: "code/B-B.3.4/i2c-rdwr-read.c · 同类调用者判断",
          code: USER_RESULT,
          startLine: 101,
          line: 102,
          full: { key: "userMain", needle: "if (ret < 0) {" },
          states: { "ioctl ret": "-1", "errno": "EFAULT", "returnTone": "error", "stdout": "不打印成功结果", "next debug": "检查用户缓冲区地址与生命周期" },
          observations: ["排查重点是用户内存，不是先换 EEPROM", "若需确认线上行为，应对齐已经产生的 trace 或抓包"],
          note: "用户态同样表现为 ioctl=-1，但 errno 与发生时序指向不同层。模型步骤不代表已在教学程序中实际注入故障。"
        }
      ]
    },
    sourceFiles: [
      {
        name: "i2c-rdwr-read.c",
        kind: "原创完整教学程序 · 未编译",
        url: "../code/B-B.3.4/i2c-rdwr-read.c",
        context: "Linux 用户态完整示例：固定读取 4 字节，含参数解析、能力检查、默认占用检查、完整错误清理。仅源码核验，未编译、未运行、未上板。"
      },
      {
        name: "trace-i2c-read.sh",
        kind: "原创 trace 闭环脚本 · bash -n 通过",
        url: "../code/B-B.3.4/trace-i2c-read.sh",
        context: "需要 root、tracefs 与 i2c-tools。保存并恢复开关，保留主命令状态；已通过 Shell 语法检查，未在目标系统执行。"
      },
      {
        name: "i2ctransfer.c",
        kind: "i2c-tools v4.4 官方源码",
        url: "../code/B-B.3.4/i2c-tools-v4.4/tools/i2ctransfer.c",
        context: "官方 v4.4 标签，提交 c20cd0b4be78e7b84104452b7fc9c570f00f92bf。用于核对描述符解析、默认占用检查、I2C_RDWR 和输出语义。"
      },
      {
        name: "i2c-dev.c",
        kind: "Linux v6.6 官方源码",
        url: "../code/B-B.3.4/linux-v6.6/drivers/i2c/i2c-dev.c",
        context: "用户态字符设备接口。实验室完整函数与起始行由本文件直接提取；快照用于源码阅读，未在本篇环境编译内核。"
      },
      {
        name: "i2c-core-base.c",
        kind: "Linux v6.6 官方源码",
        url: "../code/B-B.3.4/linux-v6.6/drivers/i2c/i2c-core-base.c",
        context: "I2C Core 传输、锁与 tracepoint 调用路径。用于核对 __i2c_transfer() 和 i2c_transfer()，未在本篇环境编译或运行。"
      },
      {
        name: "i2c.h（UAPI）",
        kind: "Linux v6.6 用户接口定义",
        url: "../code/B-B.3.4/linux-v6.6/include/uapi/linux/i2c.h",
        context: "struct i2c_msg、I2C_M_RD 与 I2C_FUNC_I2C 的权威定义；普通消息与标志位以本文件为准。"
      },
      {
        name: "i2c-dev.h（UAPI）",
        kind: "Linux v6.6 用户接口定义",
        url: "../code/B-B.3.4/linux-v6.6/include/uapi/linux/i2c-dev.h",
        context: "I2C_SLAVE、I2C_RDWR、struct i2c_rdwr_ioctl_data 与消息数量上限的权威定义；用于核对用户态控制命令。"
      },
      {
        name: "trace/events/i2c.h",
        kind: "Linux v6.6 trace 格式定义",
        url: "../code/B-B.3.4/linux-v6.6/include/trace/events/i2c.h",
        context: "i2c_write、i2c_read、i2c_reply、i2c_result 的字段与 TP_printk 格式。正文 trace 是据此构造的预期示例，不是实测。"
      }
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
