# B-C.7.4 USB Gadget 模式与 ConfigFS

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[E] | 预计阅读时间：35 分钟

## 本节导读

前面三节都站在 USB Host 视角——Linux 作为主机去驱动外设。但嵌入式设备常常有另一个身份：USB Device。开发板用 USB 线连上 PC 时，PC 是 Host，板子是 Device。Linux 的 **Gadget 框架**让设备能扮演各种 USB 角色：U 盘、虚拟串口、USB 网卡、摄像头……配合 **ConfigFS**，这些角色组合可以在运行时动态配置，不用改代码、不用重编内核。

这个能力在工业场景里用得极多：设备连 PC 导出数据（Mass Storage）、USB 线共享网络（RNDIS）、生产测试的调试通道（ACM 串口）、Android 的 ADB/MTP（FunctionFS）。本节把 Gadget 的分层架构、ConfigFS 配置流程、FunctionFS 用户态玩法讲透，最后用一个"数据采集设备导出为 U 盘"的完整实例收尾。

本节覆盖：Gadget 框架的分层（UDC/Gadget/Composite/Function）、ConfigFS 目录语义与配置五步法、三功能复合 Gadget 完整脚本、FunctionFS 的原理与用户态代码框架、T113 导出 eMMC 分区为 U 盘的实战，以及 Gadget 类问题的排查方法。

## Gadget 框架的分层

USB 是主从架构：Host 掌控一切，Device 被动应答。Gadget 框架（也叫 USB Peripheral 框架）就是让 Linux 扮演 Device 角色的基础设施，自下而上分四层：

```
┌─────────────────────────────────────────────────────────────┐
│  用户空间：ConfigFS 配置 / FunctionFS 应用（adb、mtp、自定义）   │
├─────────────────────────────────────────────────────────────┤
│  Function 层：具体功能实现                                     │
│    f_mass_storage(U盘) f_acm(串口) f_rndis(网卡) f_uvc(摄像头) │
├─────────────────────────────────────────────────────────────┤
│  Composite 层：把多个 Function 组合成一个复合 USB 设备          │
├─────────────────────────────────────────────────────────────┤
│  Gadget 层：Gadget API，管理枚举、端点、描述符                  │
├─────────────────────────────────────────────────────────────┤
│  UDC 驱动层：直接操作 USB Device 控制器硬件                     │
├─────────────────────────────────────────────────────────────┤
│  硬件：UDC 控制器 + USB PHY（D+/D- 信号线）                    │
└─────────────────────────────────────────────────────────────┘
```

> UDC（USB Device Controller）：USB 设备控制器，SoC 里负责"作为 Device 在 USB 线上收发"的硬件模块，与 Host 控制器（xHCI 那一侧）职责相对。每个 SoC 的 UDC 有对应驱动，如全志/TI 的 `musb-hdrc`、瑞芯微的 `dwc2`。`ls /sys/class/udc/` 能看到系统里有哪些 UDC。

各层职责：

- **UDC 驱动层**：唯一碰硬件寄存器的层，屏蔽各 SoC 控制器差异
- **Gadget 层**：对上提供统一 API，负责枚举响应、端点管理、描述符拼装
- **Composite 层**：支持复合设备——一个 USB 设备同时暴露多种功能（既是 U 盘又是网卡）
- **Function 层**：每种功能一个内核模块，大容量存储、ACM 串口、RNDIS 网卡等

> OTG（On-The-Go）：让同一个 USB 控制器能在 Host 和 Device 角色间切换的协议。B-C.7.1 讲过它的 ID 引脚判别机制。注意约束：**同一时刻一个控制器只能是一种角色**。板子要同时当 Host（接 U 盘）又当 Device（连 PC），需要两个独立的 USB 控制器。

早期的 Gadget 驱动是静态编译的（`g_file_storage`、`g_serial` 等），一个 ko 只提供一种功能，组合关系编译期就定死。现在的主流方案是 **ConfigFS + libcomposite**：功能组合、VID/PID、字符串全部由用户态在运行时拼装。

## ConfigFS：用文件系统操作配置 Gadget

> ConfigFS：一种基于 RAM 的内核文件系统，用户态通过"建目录、写文件"来**创建和配置内核对象**。它与 sysfs 的分工是：sysfs 查看和修改已有对象的属性，ConfigFS 能创建和销毁对象本身。USB Gadget 是 ConfigFS 最典型的用户。

配置一个 Gadget 的完整流程只有五步，每步对应一个文件系统操作：

```
①创建Gadget      ②写描述符        ③创建功能       ④功能挂到配置     ⑤绑定UDC使能
mkdir gadget目录  echo VID/PID等   mkdir functions  ln -s 符号链接   echo UDC名 > UDC
```

ConfigFS 目录语义一览：

| 路径 | 类型 | 用途 |
|------|------|------|
| `/sys/kernel/config/usb_gadget/` | 根目录 | Gadget 配置总入口 |
| `usb_gadget/<name>/` | 目录 | 一个 Gadget 实例，name 自定义 |
| `<name>/idVendor`、`idProduct` | 文件 | VID / PID |
| `<name>/bcdDevice`、`bcdUSB` | 文件 | 设备版本、USB 规范版本 |
| `<name>/strings/0x409/` | 目录 | 英语（语言 ID 0x409）字符串描述符 |
| `strings/0x409/serialnumber` 等 | 文件 | 序列号 / 厂商名 / 产品名 |
| `<name>/configs/c.1/` | 目录 | 一个 USB 配置 |
| `configs/c.1/MaxPower` | 文件 | 取电上限，单位 2mA（250 = 500mA） |
| `<name>/functions/<func>.<N>/` | 目录 | 一个功能实例 |
| `<name>/UDC` | 文件 | 写入 UDC 名 = 使能 Gadget；写空 = 停止 |

常用功能与目录名对照：

| 功能 | USB 类 | 目录名 | 典型场景 |
|------|--------|--------|---------|
| Mass Storage | MSC (0x08) | `mass_storage.<N>` | 设备导出内部存储为 U 盘 |
| ACM (CDC) | CDC (0x02) | `acm.<N>` | USB 虚拟串口调试通道 |
| RNDIS | CDC (0x02) | `rndis.<N>` | USB 网络共享（Windows 免驱） |
| ECM / NCM | CDC (0x02) | `ecm.<N>` / `ncm.<N>` | USB 网络（Linux Host 原生） |
| HID | HID (0x03) | `hid.<N>` | 模拟键盘/鼠标 |
| UVC | Video (0x0E) | `uvc.<N>` | 板子作为 USB 摄像头 |
| UAC1/UAC2 | Audio (0x01) | `uac1.<N>` / `uac2.<N>` | USB 声卡 |
| FunctionFS | 自定义 | `ffs.<name>` | 用户态实现协议（ADB/MTP） |

### 完整示例：三功能复合 Gadget

下面的脚本把一块嵌入式板子配置成"U 盘 + 虚拟串口 + USB 网卡"三合一设备。这是实际项目可直接改用的骨架：

```bash
#!/bin/bash
# 复合 Gadget：mass_storage + acm + rndis
# 平台：带 UDC 的嵌入式 Linux（全志/瑞芯微/TI 等）

GADGET_NAME="my_composite"
CONFIGFS_ROOT="/sys/kernel/config/usb_gadget"
UDC_NAME="musb-hdrc"    # 按平台修改，查看方法：ls /sys/class/udc/
                        # 全志 A20/T113: musb-hdrc
                        # 瑞芯微: ff400000.dwc2 之类

# 1. 挂载 ConfigFS（若未挂载）
[ -d "$CONFIGFS_ROOT" ] || mount -t configfs none /sys/kernel/config

# 2. 创建 Gadget 实例
mkdir -p "$CONFIGFS_ROOT/$GADGET_NAME"
cd "$CONFIGFS_ROOT/$GADGET_NAME"

# 3. 设备描述符
echo 0x1234 > idVendor        # 测试用 VID；正式产品需申请或用户态 ID
echo 0x5678 > idProduct
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB

# 4. 字符串描述符
mkdir -p strings/0x409
echo "1234567890ABCDEF" > strings/0x409/serialnumber
echo "MyEmbeddedCompany"  > strings/0x409/manufacturer
echo "MyCompositeDevice"  > strings/0x409/product

# 5. USB 配置
mkdir -p configs/c.1/strings/0x409
echo "Composite Config" > configs/c.1/strings/0x409/configuration
echo 250 > configs/c.1/MaxPower     # 500mA

# 6. mass_storage 功能：把 /dev/mmcblk0p3 导出为 U 盘
mkdir -p functions/mass_storage.0
echo 1 > functions/mass_storage.0/stall
echo 0 > functions/mass_storage.0/lun.0/removable
echo "/dev/mmcblk0p3" > functions/mass_storage.0/lun.0/file
ln -s functions/mass_storage.0 configs/c.1/

# 7. acm 功能：虚拟串口（PC 端出现 COM 口 / /dev/ttyACM0）
mkdir -p functions/acm.GS0
ln -s functions/acm.GS0 configs/c.1/

# 8. rndis 功能：USB 网卡
mkdir -p functions/rndis.usb0
echo "42:63:65:13:34:56" > functions/rndis.usb0/dev_addr
echo "42:63:65:13:34:57" > functions/rndis.usb0/host_addr
ln -s functions/rndis.usb0 configs/c.1/

# 9. 绑定 UDC，Gadget 开始枚举
echo "$UDC_NAME" > UDC

# 10. 给设备端 usb0 配 IP（与 PC 端同网段）
ifconfig usb0 192.168.7.2 netmask 255.255.255.0 up 2>/dev/null

echo "Gadget 已启动：U盘(mmcblk0p3) + 串口(ttyGS0) + 网卡(usb0)"
```

停止脚本（顺序相反，先解绑 UDC，再拆符号链接、删目录）：

```bash
#!/bin/bash
GADGET_NAME="my_composite"
cd "/sys/kernel/config/usb_gadget/$GADGET_NAME"

echo "" > UDC                        # 先解绑 UDC
rm configs/c.1/mass_storage.0        # 移除符号链接（rm 删的是链接）
rm configs/c.1/acm.GS0
rm configs/c.1/rndis.usb0
rmdir functions/mass_storage.0       # 删除功能实例
rmdir functions/acm.GS0
rmdir functions/rndis.usb0
rmdir configs/c.1/strings/0x409 configs/c.1
rmdir strings/0x409
cd .. && rmdir "$GADGET_NAME"
echo "Gadget 已停止"
```

四个容易踩的点：

1. **UDC 名必须逐字符匹配**——`ls /sys/class/udc/` 列出的才是合法值，写错则绑定静默失败
2. **mass_storage 的 `lun.0/file` 必须是块设备或磁盘镜像文件**——普通目录不行；想导出一个目录的内容，先用 `dd` 做镜像、`mkfs.vfat` 格式化、挂载写入文件后再导出镜像
3. **操作顺序不能乱**——先建功能目录，再 `ln -s` 挂到配置，最后写 UDC 使能；使能之后再改描述符不生效，要先写空 UDC 停用
4. **RNDIS 需要一对 MAC**——设备端和主机端各一个，用本地管理地址段（第 1 字节的 bit1=1，如 `42:` 开头）避免与真实网卡冲突

## FunctionFS：把 USB 功能搬到用户态

内核 Function（`f_mass_storage`、`f_acm` 等）稳定高效，但功能逻辑固化在内核里：想实现一个新协议（ADB、MTP、产品私有协议），改一次就要动内核。**FunctionFS（FFS）** 的思路是把协议逻辑搬到用户态：内核只负责底层传输和端点管理，协议解析、状态机、业务逻辑全由用户态程序完成。

```
用户态应用（adbd / mtpd / 自定义程序）
    │  open/read/write/ioctl
    ▼
/dev/usb-ffs/<name>/ep0   （控制端点：收 SETUP 请求、回描述符）
/dev/usb-ffs/<name>/ep1   （IN 数据端点）
/dev/usb-ffs/<name>/ep2   （OUT 数据端点）
    │
    ▼
内核 f_fs.ko —— 注册为 Gadget Function，管理端点与传输调度
    │
    ▼
UDC 驱动 → USB PHY → D+/D-
```

工作流程：加载 `f_fs.ko` → 挂载 functionfs（`mount -t functionfs mydev /dev/usb-ffs/mydev`）→ 应用打开 `ep0` 并**写入端点描述符和字符串**（告诉内核"我这个功能长什么样"）→ 之后应用通过 `ep0` 接收控制请求事件、通过 `ep1/ep2` 收发数据。

用户态程序骨架（关键步骤全在注释里）：

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/mount.h>
#include <linux/usb/functionfs.h>

#define FFS_MOUNTPOINT  "/dev/usb-ffs/mydev"
#define EP0_PATH        FFS_MOUNTPOINT "/ep0"
#define EP1_IN_PATH     FFS_MOUNTPOINT "/ep1"
#define EP2_OUT_PATH    FFS_MOUNTPOINT "/ep2"

/* 端点描述符：FS/HS 各一对 BULK 端点（EP1-IN / EP2-OUT） */
static const struct {
    struct usb_functionfs_descs_head_v2 header;
    __le32 full_speed_count;
    __le32 high_speed_count;
    struct usb_endpoint_descriptor_no_audio fs_ep1;
    struct usb_endpoint_descriptor_no_audio fs_ep2;
    struct usb_endpoint_descriptor_no_audio hs_ep1;
    struct usb_endpoint_descriptor_no_audio hs_ep2;
} __attribute__((packed)) ffs_descs = {
    .header = {
        .magic = cpu_to_le32(FUNCTIONFS_DESCRIPTORS_MAGIC_V2),
        .length = cpu_to_le32(sizeof(ffs_descs)),
        .flags = cpu_to_le32(FUNCTIONFS_HAS_FS_DESC | FUNCTIONFS_HAS_HS_DESC),
    },
    .full_speed_count = cpu_to_le32(2),
    .high_speed_count = cpu_to_le32(2),
    .fs_ep1 = {
        .bLength = USB_DT_ENDPOINT_SIZE,
        .bDescriptorType = USB_DT_ENDPOINT,
        .bEndpointAddress = 1 | USB_DIR_IN,
        .bmAttributes = USB_ENDPOINT_XFER_BULK,
        .wMaxPacketSize = cpu_to_le16(64),
    },
    .fs_ep2 = {
        .bLength = USB_DT_ENDPOINT_SIZE,
        .bDescriptorType = USB_DT_ENDPOINT,
        .bEndpointAddress = 2 | USB_DIR_OUT,
        .bmAttributes = USB_ENDPOINT_XFER_BULK,
        .wMaxPacketSize = cpu_to_le16(64),
    },
    .hs_ep1 = {
        .bLength = USB_DT_ENDPOINT_SIZE,
        .bDescriptorType = USB_DT_ENDPOINT,
        .bEndpointAddress = 1 | USB_DIR_IN,
        .bmAttributes = USB_ENDPOINT_XFER_BULK,
        .wMaxPacketSize = cpu_to_le16(512),
    },
    .hs_ep2 = {
        .bLength = USB_DT_ENDPOINT_SIZE,
        .bDescriptorType = USB_DT_ENDPOINT,
        .bEndpointAddress = 2 | USB_DIR_OUT,
        .bmAttributes = USB_ENDPOINT_XFER_BULK,
        .wMaxPacketSize = cpu_to_le16(512),
    },
};

/* 字符串描述符 */
static const struct {
    struct usb_functionfs_strings_head header;
    struct {
        __le16 code;
        const char str1[16];
    } __attribute__((packed)) lang0;
} __attribute__((packed)) ffs_strings = {
    .header = {
        .magic = cpu_to_le32(FUNCTIONFS_STRINGS_MAGIC),
        .length = cpu_to_le32(sizeof(ffs_strings)),
        .str_count = cpu_to_le32(1),
        .lang_count = cpu_to_le32(1),
    },
    .lang0 = {
        .code = cpu_to_le16(0x0409),
        .str1 = "MyFFSDevice",
    },
};

int main(void)
{
    /* 1. 挂载 FunctionFS */
    mkdir(FFS_MOUNTPOINT, 0755);
    if (mount("mydev", FFS_MOUNTPOINT, "functionfs", 0, NULL) < 0
        && errno != EBUSY) {
        perror("mount functionfs");
        return 1;
    }

    /* 2. 打开 ep0，先写端点描述符、再写字符串（顺序固定） */
    int ep0 = open(EP0_PATH, O_RDWR);
    if (ep0 < 0) { perror("open ep0"); return 1; }
    if (write(ep0, &ffs_descs, sizeof(ffs_descs)) < 0) {
        perror("write descriptors"); return 1;
    }
    if (write(ep0, &ffs_strings, sizeof(ffs_strings)) < 0) {
        perror("write strings"); return 1;
    }

    /* 3. 描述符就绪后才能打开数据端点 */
    int ep1 = open(EP1_IN_PATH, O_RDWR);
    int ep2 = open(EP2_OUT_PATH, O_RDWR);
    if (ep1 < 0 || ep2 < 0) { perror("open data eps"); return 1; }

    printf("FunctionFS 就绪，等待 Host 连接...\n");

    /* 4. 主循环：ep0 收事件，ep1/ep2 传数据 */
    while (1) {
        struct usb_functionfs_event event;
        char buf[4096];
        fd_set rfds;

        FD_ZERO(&rfds);
        FD_SET(ep0, &rfds);
        FD_SET(ep2, &rfds);
        if (select((ep0 > ep2 ? ep0 : ep2) + 1, &rfds, NULL, NULL, NULL) < 0) {
            if (errno == EINTR) continue;
            break;
        }

        if (FD_ISSET(ep0, &rfds)) {
            if (read(ep0, &event, sizeof(event)) < 0) break;
            switch (event.type) {
            case FUNCTIONFS_BIND:    printf("已绑定\n"); break;
            case FUNCTIONFS_UNBIND:  printf("已解绑\n"); break;
            case FUNCTIONFS_ENABLE:  printf("配置使能\n"); break;
            case FUNCTIONFS_DISABLE: printf("配置禁用\n"); break;
            case FUNCTIONFS_SETUP:
                /* Host 发来控制请求，按 bRequest 解析并应答；
                   不支持的请求要回 STALL */
                printf("SETUP bRequest=0x%02x\n", event.u.setup.bRequest);
                if (event.u.setup.bRequestType & USB_DIR_IN)
                    read(ep0, NULL, 0);
                else
                    write(ep0, NULL, 0);
                break;
            case FUNCTIONFS_SUSPEND: printf("挂起\n"); break;
            case FUNCTIONFS_RESUME:  printf("恢复\n"); break;
            }
        }

        if (FD_ISSET(ep2, &rfds)) {
            /* 收到 Host 数据：本例原样 echo 回去 */
            int n = read(ep2, buf, sizeof(buf));
            if (n > 0) {
                printf("收到 %d 字节\n", n);
                write(ep1, buf, n);
            }
        }
    }

    close(ep0); close(ep1); close(ep2);
    umount(FFS_MOUNTPOINT);
    return 0;
}
```

FunctionFS 的典型应用：

| 应用 | 说明 |
|------|------|
| Android ADB | `adbd` 守护进程经 FFS 实现 ADB 协议，是 FFS 最完整的工业级参考实现 |
| Android MTP | `mtpd` 经 FFS 实现媒体传输，PC 识别为便携设备 |
| 产品私有协议 | 自定义命令集 + 数据通道，内核零改动，协议迭代只需更新用户态程序 |
| 固件升级通道 | ACM 做命令通道 + Mass Storage 传固件包，Composite 组合 |

> 💡 ConfigFS 是运行时配置，调试期可以随时改功能组合、换 VID/PID 快速迭代；但量产时务必把稳定配置固化成启动脚本（systemd service 或 rcS），保证每次开机能自动拉起。

## 实战：T113 数据采集设备导出为 U 盘

场景：全志 T113 工业数据采集设备，eMMC 里的数据分区（`/dev/mmcblk0p3`，FAT32）需要在 USB 线连上 PC 时直接变成 U 盘，用户免工具导出数据。

### 内核与 UDC 确认

```bash
# 内核配置检查
grep CONFIG_USB_CONFIGFS /boot/config-$(uname -r)
```

```
CONFIG_USB_CONFIGFS=y
CONFIG_USB_CONFIGFS_MASS_STORAGE=y
CONFIG_USB_CONFIGFS_F_FS=y
CONFIG_USB_CONFIGFS_ACM=y
CONFIG_USB_CONFIGFS_RNDIS=y
```

```bash
# 确认 UDC 存在
ls /sys/class/udc/
```

```
musb-hdrc
```

### 配置脚本

```bash
#!/bin/sh
# /usr/local/bin/usb_mass_storage.sh —— T113 导出数据分区为 U 盘

GADGET="t113_mass_storage"
CONFIGFS="/sys/kernel/config/usb_gadget"
UDC="musb-hdrc"

mount -t configfs none /sys/kernel/config 2>/dev/null

cd $CONFIGFS
mkdir -p $GADGET
cd $GADGET

# 用 Linux Foundation 的复合 Gadget 测试 ID
echo 0x1d6b > idVendor
echo 0x0104 > idProduct
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB

mkdir -p strings/0x409
echo "T113DATA0001"     > strings/0x409/serialnumber
echo "AllwinnerT113"    > strings/0x409/manufacturer
echo "Data Logger Disk" > strings/0x409/product

mkdir -p configs/c.1/strings/0x409
echo "Mass Storage" > configs/c.1/strings/0x409/configuration
echo 250 > configs/c.1/MaxPower

mkdir -p functions/mass_storage.0
echo 0 > functions/mass_storage.0/stall
echo 1 > functions/mass_storage.0/lun.0/removable
echo 0 > functions/mass_storage.0/lun.0/ro

# 关键：绑定数据分区
echo "/dev/mmcblk0p3" > functions/mass_storage.0/lun.0/file

ln -s functions/mass_storage.0 configs/c.1/
echo "$UDC" > UDC

echo "Mass Storage 已启动：/dev/mmcblk0p3 导出为 U 盘"
```

### 验证

设备端：

```bash
# Gadget 目录结构完整
ls /sys/kernel/config/usb_gadget/t113_mass_storage/

# UDC 已绑定
cat /sys/kernel/config/usb_gadget/t113_mass_storage/UDC

# LUN 指向正确分区
cat /sys/kernel/config/usb_gadget/t113_mass_storage/functions/mass_storage.0/lun.0/file

# 内核日志确认枚举
dmesg | grep -i "mass_storage\|gadget\|udc"
```

PC 端（Linux）：

```bash
lsusb | grep 1d6b
lsblk                       # 出现新的 sdX 设备
mkdir -p /mnt/t113_data
mount /dev/sdb /mnt/t113_data
ls /mnt/t113_data           # 看到设备数据分区的内容
```

Windows 端打开"此电脑"会出现一个新 U 盘（卷标 Data Logger Disk），直接读写。

> 🔴 mass_storage 导出 `/dev/mmcblk0p3` 期间，**设备端 Linux 绝不能同时挂载这个分区**。两个系统同时读写同一个文件系统必然导致数据损坏——设备端看到的数据是缓存过的，PC 的写入不会反映到设备端缓存里。正确流程：设备端先 `umount`，再启动导出；PC 安全弹出后，设备端停用 Gadget 再重新挂载。只允许只读共享的场景就设 `lun.0/ro = 1`。

## 排障：Gadget 常见问题

调试命令：

| 命令 | 用途 |
|------|------|
| `ls /sys/class/udc/` | 有哪些 UDC 控制器 |
| `cat /sys/class/udc/<name>/state` | UDC 状态（not attached / configured / suspended） |
| `cat /sys/class/udc/<name>/current_speed` | 当前协商速度 |
| `cat .../usb_gadget/<name>/UDC` | Gadget 绑定的 UDC（空 = 未使能） |
| `dmesg -w` 插线观察 | 枚举全过程日志 |
| PC 端 `lsusb -v -d <vid>:<pid>` | 从 Host 侧看设备报出的描述符 |

四类典型问题：

**Gadget 使能后 PC 毫无反应。** 按序查：UDC 名是否与 `ls /sys/class/udc/` 输出逐字符一致 → OTG ID 引脚电平是否让控制器处于 Device 模式（很多板子要靠设备树 `dr_mode = "peripheral"` 或 extcon 强制）→ USB 线是否是只能充电的"电源线"（没有 D+/D-）→ `dmesg | grep -i "gadget\|udc"` 有无报错。

**PC 看到 U 盘但打不开/挂载失败。** `lun.0/file` 是否指向有效块设备 → 设备端是否已 `umount` 该分区（双重挂载）→ 分区格式 PC 是否支持（FAT32/exFAT/NTFS，ext4 在 Windows 下不可见）→ `dmesg` 有无 I/O 错误（eMMC 健康问题）。

**RNDIS 网卡不通。** Windows 需要识别 RNDIS 驱动（设备管理器里看有无感叹号，必要时手动选"远程 NDIS 兼容设备"）→ 设备端和 PC 端 IP 是否同网段 → `ping` 通不通、`tcpdump -i usb0` 抓包看包到了哪一环 → 防火墙。

**ACM 串口没有 /dev/ttyGS0。** 内核 `CONFIG_USB_CONFIGFS_ACM` 是否开启 → `dmesg` 有无 `acm` probe 日志 → udev 是否拦截了节点创建 → 应急手动建节点 `mknod /dev/ttyGS0 c 253 0`（主设备号以 `cat /proc/devices` 里 ttyGS 实际值为准）。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 框架分层 | 画出 UDC → Gadget → Composite → Function 四层并说清各层职责 |
| ConfigFS 流程 | 按"建 Gadget → 写描述符 → 建功能 → 挂配置 → 绑 UDC"五步配出任意功能组合 |
| 复合设备 | 改写示例脚本，配出"串口 + 网卡"双功能 Gadget 并在 PC 端验证 |
| FunctionFS | 说出 FFS 与内核 Function 的分工，解释描述符为什么要先写 ep0 |
| 存储导出 | 把一个 eMMC 分区安全地导出为 U 盘，并说清为什么不能双重挂载 |
| 排障 | 对"PC 无反应 / 盘打不开 / 网卡不通 / 串口没节点"四类问题各自给出排查路径 |

## 配套资源

- 内核文档：`Documentation/usb/gadget_configfs.rst`、`Documentation/usb/gadget.rst`
- 内核源码：`drivers/usb/gadget/`（Function 实现都在 `function/` 子目录）
- 头文件：`include/linux/usb/composite.h`、`include/linux/usb/functionfs.h`
- Android ADB 源码 `system/core/adb/`：FunctionFS 的工业级完整实现
- USB-IF 规范文档：https://www.usb.org/documents
