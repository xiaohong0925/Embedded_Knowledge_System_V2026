# D.2 字符设备与用户态数据通道

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[I→E] | 预计阅读时间：35 分钟
>
> 与第12章的分工：12.1.4 讲 cdev 三层注册 API、fops 方法语义与 ioctl 命令编码（内核侧视角：open 时 fops 怎么被替换）；本篇讲驱动作者视角的实战写法——read/write 的边界条件、产品级 ioctl ABI 的版本演进、per-fd 状态管理。注册流程与编码规则一律引用 12.1.4，本篇不重复。

## <span class="blue"> 本节导读

D.1 的 TS502 骨架能 probe、能验明正身，但用户空间摸不到它——没有 `/dev` 节点，业务代码无从下手。本篇给它接上字符设备接口：板子上出现 `/dev/ts502-0`，`cat` 能读到温度原始值，ioctl 能配采样率和报警阈值。<BR>
本节覆盖：TS502 的 cdev 接入全过程（ida 编号 + cdev + device_create）、read 的三类实战边界（`copy_to_user` 返回值语义、`*ppos` 推进、短读合法性）、ioctl 的 ABI 版本演进设计（size/version payload）与 `compat_ioctl`、open/release 的 per-fd 状态与 llseek 四种取值。读完能写出"敢发出去给业务用、且三年后还能兼容"的设备接口。

---

## <span class="blue"> TS502 的拼图：长出 /dev/ts502-0 [I]

在 D.1 骨架基础上，本篇给 `ts502_data` 加三个成员，probe 尾部加四步：

```c
struct ts502_data {
    struct i2c_client *client;
    struct cdev cdev;           /* D.2 新增 */
    int minor;                  /* D.2 新增：ida 分配的实例编号 */
    struct mutex lock;          /* D.2 新增：保护寄存器配置序列 */
};

static DEFINE_IDA(ts502_ida);
static dev_t ts502_devt;                 /* 驱动级唯一：主设备号 */
static struct class *ts502_class;

/* probe 尾部（CHIP_ID 验证与 devm_kzalloc 之后）追加： */
    mutex_init(&data->lock);

    data->minor = ida_alloc(&ts502_ida, GFP_KERNEL);
    if (data->minor < 0)
        return data->minor;

    cdev_init(&data->cdev, &ts502_fops);
    data->cdev.owner = THIS_MODULE;
    ret = cdev_add(&data->cdev, MKDEV(MAJOR(ts502_devt), data->minor), 1);
    if (ret)
        goto err_ida;

    if (IS_ERR(device_create(ts502_class, &client->dev,
                             MKDEV(MAJOR(ts502_devt), data->minor),
                             NULL, "ts502-%d", data->minor))) {
        ret = -ENODEV;
        goto err_cdev;
    }
    return 0;

err_cdev:
    cdev_del(&data->cdev);
err_ida:
    ida_free(&ts502_ida, data->minor);
    return ret;
```

remove 里按逆序对称回收（D.1 的对称释放原则在这里第一次真正用上）：

```c
static void ts502_remove(struct i2c_client *client)
{
    struct ts502_data *data = i2c_get_clientdata(client);

    device_destroy(ts502_class, MKDEV(MAJOR(ts502_devt), data->minor));
    cdev_del(&data->cdev);
    ida_free(&ts502_ida, data->minor);
}
```

模块入口注册一次主设备号（`alloc_chrdev_region` 三层 API 的细节见 12.1.4）：

```c
static int __init ts502_init(void)
{
    int ret = alloc_chrdev_region(&ts502_devt, 0, 8, "ts502");
    if (ret)
        return ret;
    ts502_class = class_create("ts502");
    if (IS_ERR(ts502_class)) {
        unregister_chrdev_region(ts502_devt, 8);
        return PTR_ERR(ts502_class);
    }
    return i2c_add_driver(&ts502_driver);
}
```

> 💡 这三步（ida/cdev/device_create）不能用 `devm_kzalloc` 式的托管一笔带过：它们不是"申请资源"而是"对外发布接口"，发布就必须有明确的撤销动作。产品驱动里常用 `devm_add_action_or_reset()` 把撤销动作挂进 devm 链，保持 remove 为空的目标状态（D.1 的取舍结论）。

加载后验证：

```bash
insmod ts502.ko
ls -l /dev/ts502-0
crw------- 1 root root 244, 0 ... /dev/ts502-0
```

---

## <span class="blue"> read 的三类实战边界 [I→E]

TS502 的 read 语义定为：**一次 read 返回一帧温度（2 字节，TEMP_H/TEMP_L 原始格式）**。实现只有十几行，但三处边界一处都不能错：

```c
static ssize_t ts502_read(struct file *filp, char __user *buf,
                          size_t count, loff_t *ppos)
{
    struct ts502_data *data = filp->private_data;
    u8 frame[2];
    int ret;

    if (*ppos > 0)
        return 0;                       /* 只有一帧，重读返回 EOF */

    if (count < sizeof(frame))
        return -EINVAL;                 /* 缓冲区放不下完整一帧 */

    ret = i2c_smbus_read_i2c_block_data(data->client, TS502_REG_TEMP_H,
                                        sizeof(frame), frame);
    if (ret < 0)
        return ret;                     /* I2C 错误原样上传 */

    if (copy_to_user(buf, frame, sizeof(frame)))
        return -EFAULT;

    *ppos += sizeof(frame);
    return sizeof(frame);
}
```

### copy_to_user 的返回值语义

`copy_to_user()` 返回**未拷贝的字节数**，不是错误码。`if (copy_to_user(...))` 非零即失败、返回 `-EFAULT` 是唯一正确写法。两个错误变体都真实存在于产品代码里：当成 `int` 错误码直接 `return copy_to_user(...)`——返回的是字节数，业务拿到一个莫名其妙的正数当长度；完全不检查——用户传了非法地址也不知道，数据悄悄丢了。

### *ppos 必须正确推进

`*ppos` 是这次读写在文件里的位置。read 成功读了多少字节，`*ppos` 就加多少。忘记推进的后果：业务 `read()` 循环读日志类设备时永远停在同一偏移，反复读到同一段数据，CPU 打满。TS502 利用 `*ppos > 0 返回 0` 实现"cat 读一次就结束"——这是字符设备模拟"小文件"行为的惯用手法。

### 短读是合法行为

read 返回值小于 count 不是错误：表示"当前只有这么多"。驱动有权返回短读，业务必须按返回值处理。反过来，驱动**不应该**为了凑满 count 而在 read 里死等数据——该睡不睡是 D.3 的主题；TS502 本篇的语义是"有一帧给一帧"，count 放不下完整一帧时直接 `-EINVAL`，不给截断帧，避免业务解析半个温度值。

> 💡 write 的语义由设备自己定义。纯输出型传感器不接受 write 完全合法（返回 `-EINVAL`）；TS502 的配置全走 ioctl，fops 里不写 `.write`，内核默认返回 `-EINVAL`。不要为了"接口对称"硬加一个无意义的 write。

---

## <span class="blue"> ioctl 设计学：ABI 要用很多年 [E]

read/write 解决"数据流"，配置与控制走 ioctl。ioctl 的难点从来不在写一个 `switch`，而在**这个 ABI 一旦发出去就收不回来**——业务二进制可能三年不更新，驱动升级后老业务必须还能跑。

### 命令定义（编码规则引用 12.1.4）

```c
struct ts502_cfg {
    __u32 size;         /* 入参：用户填入 sizeof(struct ts502_cfg) */
    __u32 version;      /* 出参：驱动支持的 ABI 版本，当前为 1 */
    __u32 sample_rate;  /* 0:1Hz 1:10Hz 2:100Hz */
    __s32 alarm;        /* 报警阈值，单位 °C */
};

#define TS502_IOC_MAGIC   't'
#define TS502_IOC_SET_CFG _IOW(TS502_IOC_MAGIC, 0x01, struct ts502_cfg)
#define TS502_IOC_GET_CFG _IOR(TS502_IOC_MAGIC, 0x02, struct ts502_cfg)
```

### 版本演进：payload 带 size/version

最常见的 ABI 事故：v1 结构体三个字段，v2 直接在尾部加第四个字段，命令号不变——老业务按 24 字节拷贝，新驱动按 32 字节读，越界读到栈垃圾。防御写法是把结构体大小本身变成协议的一部分：

```c
static long ts502_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
{
    struct ts502_data *data = filp->private_data;
    struct ts502_cfg cfg;
    int ret = 0;

    switch (cmd) {
    case TS502_IOC_SET_CFG:
        if (copy_from_user(&cfg, (void __user *)arg, sizeof(cfg)))
            return -EFAULT;
        if (cfg.size != sizeof(cfg))    /* 大小不符：新旧版本不匹配 */
            return -EINVAL;
        if (cfg.sample_rate > 2)
            return -EINVAL;

        mutex_lock(&data->lock);
        ret = i2c_smbus_write_byte_data(data->client, TS502_REG_CTRL,
                                        cfg.sample_rate << 2 | 0x01);
        mutex_unlock(&data->lock);
        return ret;

    case TS502_IOC_GET_CFG:
        memset(&cfg, 0, sizeof(cfg));
        cfg.size = sizeof(cfg);
        cfg.version = 1;
        if (copy_to_user((void __user *)arg, &cfg, sizeof(cfg)))
            return -EFAULT;
        return 0;

    default:
        return -ENOTTY;                 /* 不认识的命令：标准返回值 */
    }
}
```

演进规则三条：

1. **结构体只增不改**：已有字段的偏移、类型、语义永远不动；新功能在尾部加字段，同时 `version` 加一
2. **size 校验分新旧**：`size == v1 大小` 按 v1 语义处理，`size == v2 大小` 按 v2 处理，其余 `-EINVAL`——一个驱动同时服务三代业务二进制就靠这个分支
3. **未知命令返回 -ENOTTY**：不是 `-EINVAL`。glibc 的 ioctl 封装和 strace 对 ENOTTY 有专门语义（"这个 fd 不支持此命令"）

### compat_ioctl：32 位业务跑在 64 位内核

ARM64 产品里跑着 32 位 ARM 业务是常态（历史业务没重编译）。`unsigned long` 和指针在两种位宽下大小不同，结构体里含有它们时，32 位业务的内存布局与 64 位驱动预期不一致。fops 里挂 `.compat_ioctl` 处理这条路径：

```c
static const struct file_operations ts502_fops = {
    .owner          = THIS_MODULE,
    .open           = ts502_open,
    .release        = ts502_release,
    .read           = ts502_read,
    .unlocked_ioctl = ts502_ioctl,
    .compat_ioctl   = ts502_ioctl,      /* 结构体无指针/long 时可直接复用 */
    .llseek         = no_llseek,
};
```

TS502 的 `ts502_cfg` 全部是定长类型（`__u32`/`__s32`），两种位宽下布局一致，`.compat_ioctl` 直接复用主函数。设计 ABI 时主动只用定长类型，是最省心的 compat 策略——结构体里出现指针，就要写真正的转换函数了。

---

## <span class="blue"> open/release 与 per-fd 状态 [I→E]

### open 里做什么

```c
static int ts502_open(struct inode *inode, struct file *filp)
{
    struct ts502_data *data =
        container_of(inode->i_cdev, struct ts502_data, cdev);

    filp->private_data = data;
    return nonseekable_open(inode, filp);
}
```

两件事：一是从 `inode->i_cdev` 反推出实例（`container_of` 是 cdev 内嵌进实例结构体的标准取法——12.1.4 的 fops 替换链走到这里）；二是挂 `filp->private_data`。后续 read/ioctl 全部从 `filp->private_data` 拿实例，不碰全局变量（D.1 的多实例原则在 fops 层的延续）。

### per-fd 还是 per-device

`filp->private_data` 是**每次 open 一份**的：两个进程同时 open 同一个 `/dev/ts502-0`，各自持有独立的 filp。当前 TS502 把实例指针直接挂上去，per-fd 状态借用 per-device 结构——够用的前提是 read/ioctl 不修改"只属于这次打开"的状态。一旦出现 per-fd 需求（比如每进程独立的读取偏移语义、事件订阅掩码），open 里就要 `kzalloc` 一份 per-fd 结构体，release 里释放。判断标准一句话：**状态属于"这颗芯片"还是"这次打开"**——前者进 `ts502_data`，后者进 per-fd 结构体。

### release 对称

```c
static int ts502_release(struct inode *inode, struct file *filp)
{
    /* 本篇无 per-fd 分配，无事可做；若 open 里 kzalloc 了 per-fd 状态，在此 kfree */
    return 0;
}
```

### llseek 的四种取值

| 取值 | 语义 | 适用 |
|---|---|---|
| `no_llseek` | lseek 返回 -ESPIPE | 流式设备：温度帧、日志、FIFO（TS502 用这个） |
| `noop_llseek` | lseek 成功但不改变任何东西 | 位置无意义但业务爱调用的设备 |
| `default_llseek` | 按文件大小正常定位 | 有明确"文件长度"语义的设备 |
| `fixed_size_llseek` | 定位范围固定为给定大小 | 寄存器窗口类设备（D.6 mmap 直通会用） |

`.llseek` 留空的后果不是"不能 seek"：内核回退到 `default_llseek`，业务 `lseek(fd, 0, SEEK_SET)` 会"成功"并改变 `*ppos`，驱动对此毫无察觉——流式设备必须显式写 `no_llseek`。

---

## <span class="blue"> Trade-off 表格 [I→E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 配置接口 | ioctl | read 里夹带控制语义 | ioctl 职责清晰；read 夹带控制会让业务解析逻辑畸形 |
| ABI 演进 | size/version payload | 新增命令号 | payload 方式一个命令号服务多版本；新命令号简单但命令表随版本膨胀 |
| compat 策略 | 全定长结构体 | 结构体含指针 + 转换函数 | 定长零成本；含指针灵活但每种命令都要写转换 |
| 实例状态 | per-device 借用 | open 时 kzalloc per-fd | 借用零开销但无 per-fd 语义；per-fd 灵活但要管释放 |
| 实例编号 | ida 动态分配 | 设备树别名固定 | ida 简单自动回收；固定编号便于业务写死路径 |

---

## <span class="blue"> 常见陷阱 [I→E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| copy_to_user 返回值误用 | read 返回一个大的正数"长度" | 把未拷贝字节数当错误码返回 | 非零即返回 -EFAULT |
| *ppos 不推进 | 业务循环读卡死、CPU 打满 | 读成功但位置不动，永远重读同一段 | 返回前 `*ppos += 实际读出的字节数` |
| 结构体改字段炸 ABI | 升级驱动后老业务读出乱码 | v2 直接改 v1 结构体布局 | 只增不改 + size/version 分版本处理 |
| 忘 compat_ioctl | 32 位业务 ioctl 全失败 | 64 位内核没挂 compat 路径 | 全定长结构体 + `.compat_ioctl` 复用 |
| .llseek 留空 | lseek"成功"但语义错误 | 内核回退 default_llseek 改了 *ppos | 流式设备显式 no_llseek |
| device_create 失败不回收 | 加载失败后再次 insmod 报编号冲突 | 错误路径漏 cdev_del/ida_free | 错误路径严格逆序回收 |

---

## <span class="blue"> 动手练习

1. 加载 D.2 版 TS502，`cat /dev/ts502-0 | hexdump` 验证一帧 2 字节；连续两次 `cat` 都能拿到数据（每次 open 重置 *ppos），`dd if=/dev/ts502-0 bs=1 count=1` 验证 -EINVAL 路径。
2. 写三行业务代码：`lseek(fd, 0, SEEK_SET)` 观察返回值——先把 `.llseek` 从 fops 里删掉重试一次，对比两种行为，理解 default_llseek 的回退。
3. 模拟 ABI 演进：把 `ts502_cfg` 加一个 `__u32 flags` 字段、version 升 2，驱动里按 `cfg.size` 分两版处理；用没重编译的老业务二进制跑一遍，确认 v1 路径仍工作。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| cdev 接入 | ida 编号 + cdev_add + device_create，remove 逆序回收 | 错误路径回收链完整吗 |
| copy_to_user | 返回未拷贝字节数，非零即 -EFAULT | 有没有当成错误码直接 return |
| *ppos | 读多少推进多少；`*ppos > 0 返回 0` 实现一次性小文件 | 业务循环读会卡死吗 |
| 短读 | 返回值 < count 合法；不给截断帧 | 业务会拿到半个温度值吗 |
| ioctl ABI | 结构体只增不改、size/version 分版本、未知命令 -ENOTTY | 三年前的业务二进制还能跑吗 |
| compat_ioctl | 全定长结构体可直接复用 | 32 位业务测过吗 |
| per-fd | 状态属于芯片还是属于这次打开 | 两个进程同时 open 会互相干扰吗 |
| llseek | 流式设备显式 no_llseek，防 default_llseek 回退 | lseek 的行为符合设备语义吗 |

---

## <span class="blue"> 下一步

TS502 现在能读温度了，但业务只能死循环轮询——FIFO 有数据、报警触发了都不知道。下一篇（D.3 等待、阻塞与事件通知）给它接上三种通知机制：阻塞 read 睡到数据就绪、poll 接入 epoll 业务模型、fasync 发信号，并讲透 missed wakeup 的"条件先判后睡"写法。

螺旋衔接：字符设备接口——第5.4章设备节点（操作级）→ 12.1.4 fops 机制（理解级）→ 本篇（写法级）→ 第22章接口设计决策（设计级）。★第3次出现（写法级）
