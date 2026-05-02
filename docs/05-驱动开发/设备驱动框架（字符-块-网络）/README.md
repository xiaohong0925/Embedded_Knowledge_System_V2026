# 设备驱动框架（字符·块·网络）

> <span class="blue">BIEM定位：</span><span class="red">[B→I]</span> 从"能看懂驱动代码"到"能独立写一个hello-world驱动并加载运行"<br>
> <span class="blue">本章核心价值：</span>提供<span class="red">三套最小可运行驱动模板</span>（字符/块/网络），每套配齐用户态测试程序，直接可在嵌入式开发板上insmod/rmmod验证<br>
> <span class="orange"><span class="orange">前置约定：</span>03模块已详细讲解三类驱动的原理与内核数据结构，本章<span class="green">不重复原理</span>，直接上代码实战

---

## <strong>核心定义与价值</strong> <span class="red">[B]</span>

<span class="blue">定义：</span>Linux内核将设备抽象为三类文件接口——<span class="red">字符设备</span>（字节流，如GPIO、UART）、<span class="red">块设备</span>（随机存取缓存，如eMMC、SD卡）、<span class="red">网络设备</span>（包接口，如以太网、CAN总线）。驱动开发的核心工作量，是将硬件寄存器操作<span class="green">封装进这三类标准接口</span>。<br>

<span class="blue">嵌入式价值：</span>在ARM SoC上，95%的外设驱动属于字符设备（I²C/SPI/UART/GPIO），块设备负责启动介质（eMMC/NAND），网络设备决定联网能力（ETH/WiFi/CAN）。<span class="green">掌握三类驱动的hello-world模板，等于拿到了嵌入式驱动开发的通用入场券</span>。<br>

<span class="blue">与03模块的区别：</span>03讲"内核为什么要设计cdev/block_device/net_device这些结构"，本章讲"<span class="red">一行一行怎么写</span>"——从模块入口到insmod成功，再到用户态open()/write()能读到数据。

---

## <strong>技术教学与代码实战</strong> <span class="red">[I]</span>

### <strong>方向一：字符设备驱动——GPIO LED控制</strong>

<span class="blue">场景：</span>开发板上有一颗GPIO控制的LED（假设GPIO编号为 platform 设备树中定义的 `gpio-leds` 节点，或手动计算为 GPIO 号 79）。本驱动演示：<span class="green">注册字符设备 → 实现file_operations → 用户态ioctl开关LED →  sysfs节点暴露</span>。<br>

<span class="orange">1. 驱动源码：gpio_led_drv.c</span>

```c
/*
 * gpio_led_drv.c
 * 字符设备驱动模板 —— GPIO LED控制
 * 适用：任何带GPIO的嵌入式Linux板（树莓派、全志、瑞芯微等）
 * 编译：make -C /lib/modules/$(uname -r)/build M=$(pwd) modules
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/fs.h>
#include <linux/cdev.h>
#include <linux/device.h>
#include <linux/gpio.h>
#include <linux/uaccess.h>

#define LED_GPIO        79          /* 根据实际板子修改，或改用设备树解析 */
#define DEVICE_NAME     "gpioled"
#define CLASS_NAME      "gpioled_class"

static int major;
static struct class *gpioled_class;
static struct cdev gpioled_cdev;

/* file_operations 原型声明 */
static int led_open(struct inode *inode, struct file *file);
static int led_release(struct inode *inode, struct file *file);
static long led_ioctl(struct file *file, unsigned int cmd, unsigned long arg);

/* 核心API：字符设备操作表 —— 用户态open/write/ioctl的入口 */
static struct file_operations fops = {
    .owner          = THIS_MODULE,
    .open           = led_open,
    .release        = led_release,
    .unlocked_ioctl = led_ioctl,
};

/* ── 打开设备 ── */
static int led_open(struct inode *inode, struct file *file)
{
    pr_info("gpioled: device opened\n");
    return 0;
}

/* ── 关闭设备 ── */
static int led_release(struct inode *inode, struct file *file)
{
    pr_info("gpioled: device closed\n");
    return 0;
}

/* 核心API：ioctl命令定义（遵循Linux内核ioctl编码规范） */
#define LED_MAGIC       'L'
#define LED_ON          _IO(LED_MAGIC, 0)
#define LED_OFF         _IO(LED_MAGIC, 1)

/* ── ioctl处理：用户态通过ioctl(fd, LED_ON/LED_OFF) 控制LED ── */
static long led_ioctl(struct file *file, unsigned int cmd, unsigned long arg)
{
    switch (cmd) {
    case LED_ON:
        gpio_set_value(LED_GPIO, 1);      /* 高电平点亮 */
        pr_info("gpioled: LED ON\n");
        break;
    case LED_OFF:
        gpio_set_value(LED_GPIO, 0);      /* 低电平熄灭 */
        pr_info("gpioled: LED OFF\n");
        break;
    default:
        return -EINVAL;
    }
    return 0;
}

/* ── 模块初始化 ── */
static int __init led_init(void)
{
    int ret;
    dev_t dev;

    /* 核心API：alloc_chrdev_region —— 动态申请主设备号 */
    ret = alloc_chrdev_region(&dev, 0, 1, DEVICE_NAME);
    if (ret < 0) {
        pr_err("gpioled: failed to allocate device number\n");
        return ret;
    }
    major = MAJOR(dev);
    pr_info("gpioled: allocated major=%d\n", major);

    /* 核心API：cdev_init + cdev_add —— 注册字符设备 */
    cdev_init(&gpioled_cdev, &fops);
    gpioled_cdev.owner = THIS_MODULE;
    ret = cdev_add(&gpioled_cdev, dev, 1);
    if (ret) {
        pr_err("gpioled: cdev_add failed\n");
        unregister_chrdev_region(dev, 1);
        return ret;
    }

    /* 核心API：class_create + device_create —— 自动创建/dev/gpioled节点 */
    gpioled_class = class_create(THIS_MODULE, CLASS_NAME);
    if (IS_ERR(gpioled_class)) {
        cdev_del(&gpioled_cdev);
        unregister_chrdev_region(dev, 1);
        return PTR_ERR(gpioled_class);
    }
    device_create(gpioled_class, NULL, dev, NULL, DEVICE_NAME);

    /* 请求GPIO（实际项目中应改用gpiod_get from设备树） */
    ret = gpio_request(LED_GPIO, "led_gpio");
    if (ret) {
        pr_warn("gpioled: gpio_request failed (already claimed?)\n");
        /* 继续，可能被其他驱动占用或设备树已配置 */
    } else {
        gpio_direction_output(LED_GPIO, 0);
    }

    pr_info("gpioled: driver loaded, /dev/%s ready\n", DEVICE_NAME);
    return 0;
}

/* ── 模块卸载 ── */
static void __exit led_exit(void)
{
    dev_t dev = MKDEV(major, 0);

    gpio_set_value(LED_GPIO, 0);
    gpio_free(LED_GPIO);
    device_destroy(gpioled_class, dev);
    class_destroy(gpioled_class);
    cdev_del(&gpioled_cdev);
    unregister_chrdev_region(dev, 1);

    pr_info("gpioled: driver unloaded\n");
}

module_init(led_init);
module_exit(led_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Embedded Dev");
MODULE_DESCRIPTION("GPIO LED Character Device Driver Demo");
```

<span class="orange">2. Makefile</span>

```makefile
# Makefile —— 内核模块编译
KDIR ?= /lib/modules/$(shell uname -r)/build

obj-m += gpio_led_drv.o

all:
	make -C $(KDIR) M=$(PWD) modules

clean:
	make -C $(KDIR) M=$(PWD) clean
```

<span class="orange">3. 用户态测试程序：led_test.c</span>

```c
/*
 * led_test.c
 * 用户态测试程序 —— 通过ioctl控制/dev/gpioled
 * 编译：gcc led_test.c -o led_test
 * 运行：sudo ./led_test [on|off]
 */
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <unistd.h>

#define LED_MAGIC       'L'
#define LED_ON          _IO(LED_MAGIC, 0)
#define LED_OFF         _IO(LED_MAGIC, 1)

int main(int argc, char *argv[])
{
    int fd;
    int cmd;

    if (argc != 2) {
        fprintf(stderr, "Usage: %s [on|off]\n", argv[0]);
        return 1;
    }

    /* 打开字符设备 */
    fd = open("/dev/gpioled", O_RDWR);
    if (fd < 0) {
        perror("open /dev/gpioled failed");
        return 1;
    }

    if (strcmp(argv[1], "on") == 0)
        cmd = LED_ON;
    else if (strcmp(argv[1], "off") == 0)
        cmd = LED_OFF;
    else {
        fprintf(stderr, "Unknown command: %s\n", argv[1]);
        close(fd);
        return 1;
    }

    /* 核心API：ioctl —— 用户态与内核驱动交互的标准系统调用 */
    if (ioctl(fd, cmd) < 0) {
        perror("ioctl failed");
        close(fd);
        return 1;
    }

    printf("LED turned %s\n", argv[1]);
    close(fd);
    return 0;
}
```

<span class="orange">4. 加载与验证步骤</span>

```bash
# 1. 编译驱动
make

# 2. 加载内核模块
sudo insmod gpio_led_drv.ko

# 3. 确认设备节点已创建
ls -l /dev/gpioled          # 应显示 crw------- 1 root root  major,minor

# 4. 编译并运行用户态程序
gcc led_test.c -o led_test
sudo ./led_test on          # LED点亮，dmesg查看内核日志
sudo ./led_test off         # LED熄灭

# 5. 卸载驱动
sudo rmmod gpio_led_drv
```

---

### <strong>方向二：块设备驱动——RAM Disk模拟eMMC分区</strong>

<span class="blue">场景：</span>没有eMMC硬件时，用内存模拟块设备，演示<span class="green">块设备注册 → 请求队列处理 → 分区表识别 → 用户态mkfs挂载</span>的完整流程。代码可直接替换为真实eMMC/SD驱动的基础骨架。<br>

<span class="orange">1. 驱动源码：ramdisk_blk.c</span>

```c
/*
 * ramdisk_blk.c
 * 块设备驱动模板 —— RAM Disk（模拟eMMC/SD卡基础骨架）
 * 适用：学习块设备请求队列处理，或作为真实eMMC驱动的起点
 * 编译：make -C /lib/modules/$(uname -r)/build M=$(pwd) modules
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/fs.h>
#include <linux/genhd.h>
#include <linux/blkdev.h>
#include <linux/blk-mq.h>
#include <linux/spinlock.h>
#include <linux/bio.h>

#define RAMDISK_SIZE    (8 * 1024 * 1024)   /* 8MB RAM Disk */
#define SECTOR_SIZE     512
#define SECTORS         (RAMDISK_SIZE / SECTOR_SIZE)

static int major;
static u8 *ramdisk_data;                /* 块设备数据缓冲区 */
static struct gendisk *ramdisk_disk;
static struct request_queue *ramdisk_queue;

/* 核心API：blk_mq_ops —— 多队列块设备操作表（现代内核≥5.0标准） */
static struct blk_mq_ops ramdisk_mq_ops;

/* ── 处理单个BIO请求（读/写数据拷贝） ── */
static void ramdisk_process_bio(struct bio *bio)
{
    struct bio_vec bvec;
    struct bvec_iter iter;
    sector_t sector = bio->bi_iter.bi_sector;
    unsigned int offset = sector * SECTOR_SIZE;
    int rw = bio_data_dir(bio);     /* READ=0, WRITE=1 */

    bio_for_each_segment(bvec, bio, iter) {
        void *buf = page_address(bvec.bv_page) + bvec.bv_offset;
        unsigned int len = bvec.bv_len;

        if (offset + len > RAMDISK_SIZE) {
            pr_err("ramdisk: out-of-bounds access\n");
            continue;
        }

        if (rw == WRITE)            /* 用户态 → RAM Disk */
            memcpy(ramdisk_data + offset, buf, len);
        else                        /* RAM Disk → 用户态 */
            memcpy(buf, ramdisk_data + offset, len);

        offset += len;
    }
}

/* 核心API：blk_mq_request_fn —— 请求队列入口，内核在此派发读写请求 */
static blk_status_t ramdisk_queue_rq(struct blk_mq_hw_ctx *hctx,
                                     const struct blk_mq_queue_data *bd)
{
    struct request *rq = bd->rq;

    blk_mq_start_request(rq);

    /* 处理REQ_TYPE_FS类型的文件系统请求 */
    if (req_op(rq) == REQ_OP_READ || req_op(rq) == REQ_OP_WRITE) {
        struct req_iterator iter;
        struct bio *bio;

        rq_for_each_segment(bio, rq, iter) {
            ramdisk_process_bio(bio);
        }
    }

    blk_mq_end_request(rq, BLK_STS_OK);
    return BLK_STS_OK;
}

static struct blk_mq_ops ramdisk_mq_ops = {
    .queue_rq = ramdisk_queue_rq,
};

/* ── 模块初始化 ── */
static int __init ramdisk_init(void)
{
    int ret;

    /* 分配8MB数据缓冲区 */
    ramdisk_data = kzalloc(RAMDISK_SIZE, GFP_KERNEL);
    if (!ramdisk_data)
        return -ENOMEM;

    /* 核心API：register_blkdev —— 申请块设备主设备号 */
    major = register_blkdev(0, "ramdisk");
    if (major < 0) {
        pr_err("ramdisk: register_blkdev failed\n");
        kfree(ramdisk_data);
        return major;
    }

    /* 核心API：blk_mq_init_sq_queue —— 初始化单队列块设备（学习用） */
    /* 生产环境用 blk_mq_init_queue + tag_set，此处简化 */
    ramdisk_queue = blk_mq_init_sq_queue(&ramdisk_mq_ops, 128, NUMA_NO_NODE,
                                          BLK_MQ_F_SHOULD_MERGE);
    if (IS_ERR(ramdisk_queue)) {
        ret = PTR_ERR(ramdisk_queue);
        goto err_unregister;
    }

    blk_queue_logical_block_size(ramdisk_queue, SECTOR_SIZE);
    blk_queue_physical_block_size(ramdisk_queue, SECTOR_SIZE);

    /* 核心API：alloc_disk + set_capacity —— 注册gendisk结构 */
    ramdisk_disk = alloc_disk(1);       /* 1 = 支持1个分区表项 */
    if (!ramdisk_disk) {
        ret = -ENOMEM;
        goto err_cleanup_queue;
    }

    ramdisk_disk->major = major;
    ramdisk_disk->first_minor = 0;
    ramdisk_disk->fops = &ramdisk_block_ops;    /* 可补充open/release */
    ramdisk_disk->queue = ramdisk_queue;
    sprintf(ramdisk_disk->disk_name, "ramdisk");
    set_capacity(ramdisk_disk, SECTORS);

    add_disk(ramdisk_disk);
    pr_info("ramdisk: /dev/ramdisk registered, %d sectors (%dMB)\n",
            SECTORS, RAMDISK_SIZE / (1024 * 1024));
    return 0;

err_cleanup_queue:
    blk_cleanup_queue(ramdisk_queue);
err_unregister:
    unregister_blkdev(major, "ramdisk");
    kfree(ramdisk_data);
    return ret;
}

/* ── 模块卸载 ── */
static void __exit ramdisk_exit(void)
{
    del_gendisk(ramdisk_disk);
    put_disk(ramdisk_disk);
    blk_cleanup_queue(ramdisk_queue);
    unregister_blkdev(major, "ramdisk");
    kfree(ramdisk_data);
    pr_info("ramdisk: driver unloaded\n");
}

module_init(ramdisk_init);
module_exit(ramdisk_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Embedded Dev");
MODULE_DESCRIPTION("RAM Disk Block Device Driver Demo");
```

<span class="orange">2. 用户态测试：格式化与挂载</span>

```bash
# 1. 编译加载
make
sudo insmod ramdisk_blk.ko

# 2. 确认块设备出现
lsblk                       # 应看到 ramdisk 8MB 设备
ls -l /dev/ramdisk

# 3. 创建文件系统（模拟eMMC格式化）
sudo mkfs.ext4 /dev/ramdisk

# 4. 挂载并读写
sudo mkdir -p /mnt/ramdisk
sudo mount /dev/ramdisk /mnt/ramdisk
echo "hello embedded" | sudo tee /mnt/ramdisk/test.txt
sudo umount /mnt/ramdisk
sudo mount /dev/ramdisk /mnt/ramdisk
cat /mnt/ramdisk/test.txt   # 输出 hello embedded

# 5. 卸载驱动
sudo rmmod ramdisk_blk
```

---

### <strong>方向三：网络设备驱动——虚拟工业传感器网卡</strong>

<span class="blue">场景：</span>工业网关需要将传感器数据（温度、压力）通过<span class="green">虚拟网络接口</span>送入网络协议栈，用户态可用标准socket读取。本驱动演示：<span class="green">注册net_device → 实现ndo_start_xmit → 模拟硬件中断收包 → 用户态TCP/UDP测试</span>。<br>

<span class="orange">1. 驱动源码：sensor_netdev.c</span>

```c
/*
 * sensor_netdev.c
 * 网络设备驱动模板 —— 虚拟工业传感器网卡
 * 适用：理解ndo_open/start_xmit/set_config等网络设备ops
 * 编译：make -C /lib/modules/$(uname -r)/build M=$(pwd) modules
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/netdevice.h>
#include <linux/etherdevice.h>
#include <linux/ip.h>
#include <linux/skbuff.h>
#include <linux/interrupt.h>
#include <linux/workqueue.h>

#define DRV_NAME        "sensor0"
#define SENSOR_MTU      1500

static struct net_device *sensor_dev;
static struct work_struct sensor_rx_work;
static int sensor_packet_count;

/* ── 模拟硬件发送 ── */
static int sensor_start_xmit(struct sk_buff *skb, struct net_device *dev)
{
    /* 真实驱动此处写DMA寄存器，启动网卡发送 */
    dev->stats.tx_packets++;
    dev->stats.tx_bytes += skb->len;

    /* 释放skb（虚拟驱动无真实硬件，直接释放） */
    dev_kfree_skb(skb);
    return NETDEV_TX_OK;
}

/* ── 模拟硬件接收（工作队列模拟中断底半部） ── */
static void sensor_rx_packet(struct work_struct *work)
{
    struct sk_buff *skb;
    unsigned char data[] = "SENSOR:42.5C,1013hPa";   /* 模拟传感器数据帧 */
    int len = sizeof(data);

    if (!netif_running(sensor_dev))
        return;

    skb = dev_alloc_skb(len + NET_IP_ALIGN);
    if (!skb)
        return;

    skb_reserve(skb, NET_IP_ALIGN);
    memcpy(skb_put(skb, len), data, len);

    skb->dev = sensor_dev;
    skb->protocol = htons(ETH_P_IP);
    skb->ip_summed = CHECKSUM_UNNECESSARY;

    /* 填充伪以太网头（真实驱动从DMA缓冲区读取） */
    eth_type_trans(skb, sensor_dev);

    sensor_dev->stats.rx_packets++;
    sensor_dev->stats.rx_bytes += len;

    /* 核心API：netif_rx —— 将数据包注入内核网络协议栈 */
    netif_rx(skb);
}

/* ── 打开/关闭网络接口 ── */
static int sensor_open(struct net_device *dev)
{
    netif_start_queue(dev);          /* 允许内核开始发送数据包 */
    schedule_work(&sensor_rx_work);  /* 启动模拟接收 */
    pr_info("%s: interface opened\n", dev->name);
    return 0;
}

static int sensor_stop(struct net_device *dev)
{
    netif_stop_queue(dev);           /* 停止发送队列 */
    cancel_work_sync(&sensor_rx_work);
    pr_info("%s: interface closed\n", dev->name);
    return 0;
}

/* 核心API：net_device_ops —— 网络设备操作表 */
static const struct net_device_ops sensor_netdev_ops = {
    .ndo_open       = sensor_open,
    .ndo_stop       = sensor_stop,
    .ndo_start_xmit = sensor_start_xmit,
    .ndo_set_mac_address = eth_mac_addr,
    .ndo_validate_addr   = eth_validate_addr,
};

/* ── 模块初始化 ── */
static void __init sensor_setup(struct net_device *dev)
{
    ether_setup(dev);                /* 初始化以太网默认值 */

    dev->netdev_ops = &sensor_netdev_ops;
    dev->flags |= IFF_NOARP;         /* 无ARP协议（点对点传感器链路） */
    dev->features |= NETIF_F_HW_CSUM_MASK;
    dev->mtu = SENSOR_MTU;

    /* 设置MAC地址 00:53:45:4E:53:00 = "SENS" */
    eth_hw_addr_set(dev, (u8[]){0x00, 0x53, 0x45, 0x4E, 0x53, 0x00});
}

static int __init sensor_init(void)
{
    int ret;

    /* 核心API：alloc_netdev —— 分配网络设备结构体 */
    sensor_dev = alloc_netdev(0, DRV_NAME, NET_NAME_UNKNOWN, sensor_setup);
    if (!sensor_dev)
        return -ENOMEM;

    INIT_WORK(&sensor_rx_work, sensor_rx_packet);

    ret = register_netdev(sensor_dev);
    if (ret) {
        pr_err("sensor_netdev: register_netdev failed\n");
        free_netdev(sensor_dev);
        return ret;
    }

    pr_info("sensor_netdev: %s registered, MAC=%pM\n",
            sensor_dev->name, sensor_dev->dev_addr);
    return 0;
}

static void __exit sensor_exit(void)
{
    cancel_work_sync(&sensor_rx_work);
    unregister_netdev(sensor_dev);
    free_netdev(sensor_dev);
    pr_info("sensor_netdev: driver unloaded\n");
}

module_init(sensor_init);
module_exit(sensor_exit);
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Embedded Dev");
MODULE_DESCRIPTION("Virtual Industrial Sensor Network Device Driver");
```

<span class="orange">2. 用户态测试：原始套接字读取传感器数据</span>

```c
/*
 * sensor_read.c
 * 用户态测试 —— 通过原始套接字读取虚拟传感器网卡数据
 * 编译：gcc sensor_read.c -o sensor_read
 * 运行：sudo ./sensor_read
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <arpa/inet.h>
#include <linux/if_packet.h>

int main(void)
{
    int sock;
    char buf[2048];
    struct sockaddr_ll sll;
    struct ifreq ifr;

    /* 核心API：socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL)) —— 原始套接字 */
    sock = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (sock < 0) {
        perror("socket");
        return 1;
    }

    /* 绑定到 sensor0 接口 */
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, "sensor0", IFNAMSIZ - 1);
    ioctl(sock, SIOCGIFINDEX, &ifr);

    memset(&sll, 0, sizeof(sll));
    sll.sll_family = AF_PACKET;
    sll.sll_ifindex = ifr.ifr_ifindex;
    sll.sll_protocol = htons(ETH_P_ALL);
    bind(sock, (struct sockaddr *)&sll, sizeof(sll));

    printf("Listening on sensor0...\n");
    for (int i = 0; i < 5; i++) {
        int len = recvfrom(sock, buf, sizeof(buf), 0, NULL, NULL);
        if (len < 0) {
            perror("recvfrom");
            break;
        }
        /* 跳过14字节以太网头，打印传感器载荷 */
        if (len > 14)
            printf("Packet %d: %.*s\n", i + 1, len - 14, buf + 14);
    }

    close(sock);
    return 0;
}
```

<span class="orange">3. 加载与验证步骤</span>

```bash
# 1. 编译加载
make
sudo insmod sensor_netdev.ko

# 2. 确认网络接口出现
ip link show sensor0          # 应显示 sensor0 接口，状态 DOWN

# 3. 启动接口
sudo ip link set sensor0 up

# 4. 运行用户态接收程序
sudo gcc sensor_read.c -o sensor_read
sudo ./sensor_read            # 应收到 SENSOR:42.5C,1013hPa 等模拟数据

# 5. 查看统计
cat /sys/class/net/sensor0/statistics/rx_packets

# 6. 卸载
sudo rmmod sensor_netdev
```

---

## <strong>嵌入式专属实战场景</strong> <span class="red">[I→E]</span>

### <strong>场景一：工业LED阵列控制面板（字符设备组合）</strong>

<span class="blue">背景：</span>工业HMI面板上有8颗LED指示灯（运行/故障/通信/电源等），通过8路GPIO控制。需求：<span class="green">用户态程序一次性控制全部LED状态</span>，而非每次ioctl单颗操作。<br>

<span class="orange">设计思路：</span>扩展字符设备驱动，支持<code>write()</code>写入位掩码——1字节控制8颗LED，bit0对应LED0，bit1对应LED1，以此类推。<br>

```c
/* 扩展 write() 处理函数 —— 用户态 write(fd, &mask, 1) 控制8颗LED */
static ssize_t led_write(struct file *file, const char __user *buf,
                         size_t count, loff_t *ppos)
{
    u8 mask;
    int i;

    if (copy_from_user(&mask, buf, 1))
        return -EFAULT;

    for (i = 0; i < 8; i++) {
        gpio_set_value(gpio_base + i, (mask >> i) & 1);
    }

    return 1;
}

/* 用户态控制示例 */
u8 led_mask = 0x05;            /* LED0和LED2亮，其余灭 */
write(fd, &led_mask, 1);       /* 原子操作，8颗LED同时更新 */
```

<span class="blue">价值：</span>工业场景要求<span class="red">状态同步更新</span>，避免逐颗切换造成的视觉闪烁或逻辑竞态。<br>

<span class="orange">验证命令：</span>

```bash
# 全亮
printf '\xff' | sudo tee /dev/gpioled >/dev/null
# 全灭
printf '\x00' | sudo tee /dev/gpioled >/dev/null
# 跑马灯
for i in 1 2 4 8 16 32 64 128; do printf "\\x$(printf '%02x' $i)" | sudo tee /dev/gpioled >/dev/null; sleep 0.2; done
```

---

### <strong>场景二：SPI显示屏帧缓冲（块设备思路扩展）</strong>

<span class="blue">背景：</span>嵌入式设备常用SPI接口LCD屏（如ILI9341 320×240）。虽然本质上是字符设备（SPI），但帧缓冲（Framebuffer）子系统将显存抽象为<span class="green">内存映射的块区域</span>，用户态直接mmap写像素。<br>

<span class="orange">关键代码片段：Framebuffer注册</span>

```c
/* 简化的 framebuffer 注册 —— 真实驱动见 drivers/video/fbdev/ */
static struct fb_ops sensor_fb_ops = {
    .owner      = THIS_MODULE,
    .fb_fillrect= sys_fillrect,      /* 内核提供的通用绘制函数 */
    .fb_copyarea= sys_copyarea,
    .fb_imageblit= sys_imageblit,
};

static int __init fb_init(void)
{
    struct fb_info *info;
    u32 *vram;

    info = framebuffer_alloc(0, NULL);
    vram = kzalloc(320 * 240 * 4, GFP_KERNEL);   /* RGBA，320×240 */

    info->fbops = &sensor_fb_ops;
    info->screen_base = vram;
    info->fix.smem_start = virt_to_phys(vram);
    info->fix.smem_len = 320 * 240 * 4;
    info->var.xres = 320;
    info->var.yres = 240;
    info->var.bits_per_pixel = 32;

    register_framebuffer(info);      /* 注册后 /dev/fb0 出现 */
    return 0;
}
```

<span class="blue">用户态使用：</span>

```c
int fd = open("/dev/fb0", O_RDWR);
u32 *screen = mmap(NULL, 320*240*4, PROT_WRITE, MAP_SHARED, fd, 0);
screen[100 * 320 + 150] = 0xFF0000;   /* (150,100) 像素置红 */
```

---

### <strong>场景三：CAN总线工业网关（网络设备实战）</strong>

<span class="blue">背景：</span>工厂自动化中，PLC与传感器通过<span class="red">CAN总线</span>通信。Linux将CAN设备抽象为网络设备（非TCP/IP，而是<code>AF_CAN</code>协议族），用户态用标准socketcan接口读写帧。<br>

<span class="orange">驱动关键：CAN网络设备注册</span>

```c
/* 简化的 CAN 设备注册骨架 —— 真实驱动见 drivers/net/can/ */
static const struct net_device_ops can_netdev_ops = {
    .ndo_open       = can_open,
    .ndo_stop       = can_stop,
    .ndo_start_xmit = can_tx,
    .ndo_change_mtu = can_change_mtu,
};

static void can_setup(struct net_device *dev)
{
    dev->netdev_ops = &can_netdev_ops;
    dev->mtu = CAN_MTU;              /* 经典CAN：16字节；CAN FD：72字节 */
}

/* 用户态发送CAN帧（标准socketcan程序） */
```

<span class="orange">用户态测试程序：can_send.c</span>

```c
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <net/if.h>
#include <linux/can.h>
#include <linux/can/raw.h>

int main(void)
{
    int s;
    struct sockaddr_can addr;
    struct can_frame frame;
    struct ifreq ifr;

    s = socket(PF_CAN, SOCK_RAW, CAN_RAW);   /* AF_CAN 协议族 */

    strcpy(ifr.ifr_name, "can0");
    ioctl(s, SIOCGIFINDEX, &ifr);

    addr.can_family = AF_CAN;
    addr.can_ifindex = ifr.ifr_ifindex;
    bind(s, (struct sockaddr *)&addr, sizeof(addr));

    frame.can_id = 0x123;            /* CAN ID */
    frame.can_dlc = 8;               /* 数据长度码 */
    memcpy(frame.data, "\x01\x02\x03\x04\x05\x06\x07\x08", 8);

    write(s, &frame, sizeof(frame));
    printf("CAN frame sent to can0\n");

    close(s);
    return 0;
}
```

---

## <strong>进阶技巧与排错</strong> <span class="red">[E]</span>

### <strong>调试三板斧：printk / proc / sysfs</strong>

<span class="orange">1. 动态日志级别（无需重新编译）</span>

```bash
# 查看当前驱动日志级别
cat /proc/sys/kernel/printk          # 输出示例：4 4 1 7

# 临时开启所有printk（包含DEBUG级别）
echo 8 > /proc/sys/kernel/printk     # 8 = 最低级别，所有日志都输出

# 仅开启本驱动的动态调试（如果驱动使用了pr_debug + dynamic debug）
echo 'file gpio_led_drv.c +p' > /sys/kernel/debug/dynamic_debug/control
```

<span class="orange">2. procfs自定义节点（运行时查看驱动状态）</span>

```c
#include <linux/proc_fs.h>
#include <linux/seq_file.h>

static void *led_seq_start(struct seq_file *s, loff_t *pos)
{
    return (*pos < 1) ? pos : NULL;
}

static int led_seq_show(struct seq_file *s, void *v)
{
    seq_printf(s, "LED GPIO: %d\n", LED_GPIO);
    seq_printf(s, "LED State: %d\n", gpio_get_value(LED_GPIO));
    return 0;
}

static const struct seq_operations led_seq_ops = {
    .start = led_seq_start,
    .next  = NULL,          /* 简化：单条记录 */
    .stop  = NULL,
    .show  = led_seq_show,
};

/* 创建 /proc/gpioled/status */
proc_create_seq("gpioled/status", 0, NULL, &led_seq_ops);
```

<span class="orange">3. sysfs属性（标准驱动暴露接口的首选方式）</span>

```c
#include <linux/sysfs.h>

/* 驱动类属性：/sys/class/gpioled_class/gpioled/led_state */
static ssize_t led_state_show(struct device *dev,
                              struct device_attribute *attr, char *buf)
{
    return sprintf(buf, "%d\n", gpio_get_value(LED_GPIO));
}

static ssize_t led_state_store(struct device *dev,
                               struct device_attribute *attr,
                               const char *buf, size_t count)
{
    int val;
    if (kstrtoint(buf, 10, &val) == 0)
        gpio_set_value(LED_GPIO, val);
    return count;
}

static DEVICE_ATTR(led_state, 0664, led_state_show, led_state_store);
/* 注册：device_create_file(gpioled_device, &dev_attr_led_state); */
```

---

### <strong>常见问题排查清单</strong>

| 现象 | 诊断命令 | 根因与修复 |
|------|--------|-----------|
| `insmod` 失败，`dmesg` 无输出 | `insmod ./gpio_led_drv.ko 2>&1` | 内核版本与模块不匹配，或缺少`CONFIG_GPIO_SYSFS` |
| `/dev/gpioled` 未创建 | `ls /sys/class/gpioled_class/` | `device_create()` 失败，检查`alloc_chrdev_region`返回值 |
| `open()` 返回 Permission denied | `ls -l /dev/gpioled` | udev规则未生效，手动`chmod 666 /dev/gpioled`或写udev规则 |
| `ioctl` 返回 EINVAL | 核对`LED_ON`宏定义 | 用户态与内核态`_IO()`宏参数不一致，或cmd未在switch中处理 |
| 块设备`mkfs` 卡住 | `dmesg \| grep ramdisk` | `ramdisk_queue_rq` 未正确调用`blk_mq_end_request()` |
| 网络设备`ifconfig` 无统计 | `cat /proc/net/dev` | `ndo_start_xmit` 未更新`dev->stats`，或`netif_rx`未调用 |

---

### <strong>性能优化：从polling到中断</strong>

<span class="blue">进阶方向：</span>本章字符设备示例使用简单GPIO输出（主动写），真实传感器驱动通常需要<span class="red">中断触发读</span>。以GPIO按键/中断为例：<br>

```c
#include <linux/interrupt.h>

static irqreturn_t sensor_irq_handler(int irq, void *dev_id)
{
    /* 顶半部：快速标记事件，调度底半部 */
    schedule_work(&sensor_rx_work);
    return IRQ_HANDLED;
}

/* 模块初始化中注册中断 */
request_irq(gpio_to_irq(SENSOR_GPIO), sensor_irq_handler,
            IRQF_TRIGGER_FALLING, "sensor_irq", NULL);
```

<span class="blue">关键原则：</span>中断处理程序（顶半部）<span class="green">禁止睡眠</span>，耗时操作放入工作队列或tasklet（底半部）。配合`wait_queue_head_t`可实现用户态<span class="red">阻塞读</span>——`read()` 无数据时挂起，中断到达后唤醒。<br>

---

> <span class="blue">本章交付物清单：</span><br>
> * `gpio_led_drv.c` + `Makefile` + `led_test.c` —— 字符设备完整可运行套件<br>
> * `ramdisk_blk.c` + `Makefile` + 用户态格式化脚本 —— 块设备完整可运行套件<br>
> * `sensor_netdev.c` + `sensor_read.c` —— 网络设备完整可运行套件<br>
> * 3个嵌入式专属场景（LED阵列/SPI屏/CAN网关）的扩展代码片段<br>
> * 调试三板斧（printk/procfs/sysfs）与排错清单
