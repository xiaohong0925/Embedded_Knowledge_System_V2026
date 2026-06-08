# B-B.6.4 USB Gadget模式与ConfigFS

> 所属章节：第五部 B. 总线协议 > B-B.6 USB协议族
>
> 难度：[E] Expert | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

前面的章节我们都是站在**USB Host**的视角——Linux作为主机去驱动各种USB外设。但嵌入式设备往往还有一个重要身份：**USB Device**。当你的开发板通过USB线连接到PC时，PC是Host，你的板子就是Device。Linux内核通过**Gadget框架**让设备可以扮演各种USB角色：U盘、虚拟串口、USB网卡……配合**ConfigFS**，这一切都可以在运行时动态配置，无需重新编译内核。本节带你掌握Gadget的核心机制和ConfigFS的用法，并深入了解FunctionFS如何让用户空间程序也能实现USB功能。

<br>

---

## <span class="blue"> Gadget框架：让Linux成为USB设备 [E]

### 从Host到Device的视角转换

USB协议是主从架构的。Host掌控一切，Device被动响应。Linux内核的Gadget框架（又称USB Peripheral框架）就是让Linux设备能够**扮演USB Device角色**的完整基础设施。

Gadget框架的核心架构如下：

```
┌─────────────────────────────────────────────────────────────┐
│                    USB Gadget 框架架构                        │
├─────────────────────────────────────────────────────────────┤
│  用户空间                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ Gadget  │  │ Function│  │  libusb │  │    adb/mtp      │ │
│  │ 工具    │  │   FS    │  │gadget端 │  │   守护进程       │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘ │
├───────┼────────────┼────────────┼────────────────┼──────────┤
│ 内核 │            │            │                │          │
│      ▼            ▼            ▼                ▼          │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              USB Gadget Function Layer                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │ │
│  │  │ f_mass_  │ │  f_acm   │ │ f_rndis  │ │ f_midi  │ │ │
│  │  │ storage  │ │(虚拟串口)│ │(USB网卡) │ │(MIDI)   │ │ │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │ │
│  │       └─────────────┴─────────────┴────────────┘      │ │
│  │                         │                             │ │
│  │              ┌──────────┴──────────┐                  │ │
│  │              │   Composite层        │                  │ │
│  │              │  (g_zero/g_multi)   │                  │ │
│  │              └──────────┬──────────┘                  │ │
│  │                         │                             │ │
│  │              ┌──────────┴──────────┐                  │ │
│  │              │    Gadget层          │                  │ │
│  │              │ (drivers/usb/gadget) │                  │ │
│  │              └──────────┬──────────┘                  │ │
│  └─────────────────────────┼─────────────────────────────┘ │
│                            │                                │
│                   ┌────────┴────────┐                       │
│                   │   UDC驱动层      │                       │
│                   │(USB Device      │                       │
│                   │   Controller)   │                       │
│                   └────────┬────────┘                       │
│                            │                                │
│                   ┌────────┴────────┐                       │
│                   │   硬件USB PHY    │                       │
│                   │ (D+/D-信号线)   │                       │
│                   └─────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

理解这个分层很重要：

- **UDC驱动层**：与硬件USB控制器打交道，每个SoC的USB Device控制器都有对应的UDC驱动（如`s3c-hsudc`、`dwc2 gadget`）
- **Gadget层**：提供Gadget API，管理USB设备的枚举、端点、描述符
- **Composite层**：支持**复合设备**——一个USB设备同时提供多种功能（比如既是U盘又是网卡）
- **Function层**：具体的USB功能实现，如大容量存储、ACM串口、RNDIS网卡等
- **ConfigFS接口**：用户空间通过`/sys/kernel/config/`动态配置Gadget

> 💡 **提示**：早期的Gadget驱动是静态编译的（如`g_file_storage`、`g_serial`），一个ko只能提供一种功能，不够灵活。现在的**ConfigFS + libcomposite**方案是主流。

<br>

### ConfigFS动态配置机制

ConfigFS是Linux内核提供的一种**基于RAM的文件系统**，让用户空间可以通过创建目录和写入文件来**动态配置内核对象**。USB Gadget是ConfigFS最典型的应用之一。

ConfigFS与传统的`/sysfs`不同：`/sysfs`主要用于查看和修改已有对象的属性，而**ConfigFS可以创建和销毁内核对象**。

Gadget配置的核心流程是：

```
创建Gadget → 配置描述符 → 创建功能 → 绑定功能到配置 → 绑定UDC使能
     │           │            │            │               │
   mkdir      echo写入     mkdir        ln -s         echo UDC名
  (gadget目录) (vid/pid)  (functions)  (创建符号链接)  (绑定控制器)
```

下面这个表格详细列出了ConfigFS的目录结构：

| 目录/文件路径 | 类型 | 用途说明 |
|:---:|:---:|:---|
| `/sys/kernel/config/usb_gadget/` | 根目录 | Gadget配置的总入口 |
| `usb_gadget/<name>/` | 目录 | 一个Gadget实例的私有目录，name自定义 |
| `<name>/idVendor` | 文件 | USB Vendor ID（如`0x1234`） |
| `<name>/idProduct` | 文件 | USB Product ID（如`0x5678`） |
| `<name>/bcdDevice` | 文件 | 设备版本号 |
| `<name>/bcdUSB` | 文件 | 兼容的USB协议版本（如`0x0200`=USB2.0） |
| `<name>/strings/0x409/` | 目录 | 语言ID为0x409（英语）的字符串描述符 |
| `strings/0x409/serialnumber` | 文件 | 设备序列号 |
| `strings/0x409/manufacturer` | 文件 | 制造商名称 |
| `strings/0x409/product` | 文件 | 产品名称 |
| `<name>/configs/<cfg_name>/` | 目录 | 一个USB配置描述符 |
| `configs/<cfg_name>/strings/0x409/` | 目录 | 该配置的字符串描述符 |
| `configs/<cfg_name>/MaxPower` | 文件 | 最大功耗（mA/2，如250=500mA） |
| `<name>/functions/<func_name>/` | 目录 | USB功能的实例目录 |
| `functions/mass_storage.0/` | 目录 | 大容量存储功能实例 |
| `functions/acm.GS0/` | 目录 | CDC ACM虚拟串口功能实例 |
| `functions/rndis.usb0/` | 目录 | RNDIS USB网卡功能实例 |
| `<name>/UDC` | 文件 | 写入UDC驱动名使能Gadget，清空则停止 |

Gadget支持的常用功能如下表：

| 功能 | USB类 | 用途 | ConfigFS目录名 | 典型场景 |
|:---:|:---:|:---|:---|:---|
| Mass Storage | MSC (0x08) | U盘模拟 | `mass_storage.<N>` | 设备作为U盘导出内部文件 |
| ACM (CDC) | CDC (0x02) | 虚拟串口 | `acm.<N>` | USB转串口调试 |
| RNDIS | CDC (0x02) | USB网卡 | `rndis.<N>` | USB网络共享 |
| ECM | CDC (0x02) | USB网卡(Linux原生) | `ecm.<N>` | Linux-Host的USB网络 |
| NCM | CDC (0x02) | USB网卡(高速) | `ncm.<N>` | 高速USB网络 |
| MIDI | Audio (0x01) | MIDI设备 | `midi.<N>` | USB音频控制 |
| HID | HID (0x03) | 键盘/鼠标 | `hid.<N>` | USB HID设备 |
| Audio | Audio (0x01) | USB音频 | `uac1.<N>` / `uac2.<N>` | USB声卡 |
| UVC | Video (0x0E) | USB摄像头 | `uvc.<N>` | USB视频设备 |
| Printer | Printer (0x07) | USB打印机 | `printer.<N>` | 打印服务 |
| OBEX | CDC (0x02) | 文件传输 | `obex.<N>` | 旧式文件传输 |

> ⚠️ **陷阱**：**Gadget和Host不能同时使用同一个USB控制器**。大多数嵌入式SoC的USB控制器可以通过OTG（On-The-Go）协议在Host和Device模式间切换，但同一时刻只能是一种模式。如果你的板子要同时做Host（接U盘）和Device（连PC），需要SoC有**两个独立的USB控制器**，或者使用USB Hub + OTG切换器。

<br>

### 完整ConfigFS配置脚本

下面的脚本演示了如何配置一个**复合Gadget设备**：同时提供大容量存储、虚拟串口和USB网卡三个功能。

```bash
#!/bin/bash
# ============================================================
#  ConfigFS Gadget配置脚本：复合设备
#  功能：mass_storage + acm + rndis
#  适用平台：全志、瑞芯微、TI等带UDC控制器的嵌入式Linux
# ============================================================

GADGET_NAME="my_composite_gadget"
CONFIGFS_ROOT="/sys/kernel/config/usb_gadget"
UDC_NAME="musb-hdrc"    # 根据实际平台修改：
                        # 全志A20: "musb-hdrc"
                        # 瑞芯微: "ff400000.dwc2"
                        # TI AM335x: "musb-hdrc"
                        # 查看方法：ls /sys/class/udc/

# 1. 挂载ConfigFS（如果未挂载）
if [ ! -d "$CONFIGFS_ROOT" ]; then
    mount -t configfs none /sys/kernel/config
fi

# 2. 创建Gadget实例目录
mkdir -p "$CONFIGFS_ROOT/$GADGET_NAME"
cd "$CONFIGFS_ROOT/$GADGET_NAME"

# 3. 设置USB设备描述符
echo 0x1234 > idVendor      # 自定义Vendor ID（测试用）
echo 0x5678 > idProduct     # 自定义Product ID
echo 0x0100 > bcdDevice     # 设备版本 v1.0
echo 0x0200 > bcdUSB        # 声明为USB 2.0设备

# 4. 设置字符串描述符（英语）
mkdir -p strings/0x409
echo "1234567890ABCDEF" > strings/0x409/serialnumber
echo "MyEmbeddedCompany"  > strings/0x409/manufacturer
echo "MyCompositeDevice"  > strings/0x409/product

# 5. 创建USB配置
CONFIG_NAME="c.1"
mkdir -p "configs/$CONFIG_NAME"
mkdir -p "configs/$CONFIG_NAME/strings/0x409"
echo "Composite Config" > "configs/$CONFIG_NAME/strings/0x409/configuration"
echo 250 > "configs/$CONFIG_NAME/MaxPower"   # 500mA最大功耗

# 6. 创建 mass_storage 功能（U盘模式）
mkdir -p functions/mass_storage.0
echo 1 > functions/mass_storage.0/stall
echo 0 > functions/mass_storage.0/lun.0/removable
echo 0 > functions/mass_storage.0/lun.0/cdrom
# 将设备内部的/mnt/data分区导出为U盘（先确保是块设备或镜像文件）
echo "/dev/mmcblk0p3" > functions/mass_storage.0/lun.0/file
ln -s functions/mass_storage.0 configs/$CONFIG_NAME/

# 7. 创建 acm 功能（虚拟串口）
mkdir -p functions/acm.GS0
ln -s functions/acm.GS0 configs/$CONFIG_NAME/

# 8. 创建 rndis 功能（USB网卡）
mkdir -p functions/rndis.usb0
echo "42:63:65:13:34:56" > functions/rndis.usb0/dev_addr   # 设备MAC
echo "42:63:65:13:34:57" > functions/rndis.usb0/host_addr  # 主机MAC
ln -s functions/rndis.usb0 configs/$CONFIG_NAME/

# 9. 绑定UDC控制器使能Gadget
echo "$UDC_NAME" > UDC

# 10. 设置RNDIS网卡IP（如果内核未自动设置）
ifconfig usb0 192.168.7.2 netmask 255.255.255.0 up 2>/dev/null

# 11. 创建ACM串口的tty设备节点符号链接（如果udev未自动创建）
# ACM设备通常自动出现在 /dev/ttyGS0

echo "Gadget '$GADGET_NAME' 已启动"
echo "  - Mass Storage: /dev/mmcblk0p3 作为U盘导出"
echo "  - ACM Serial:   /dev/ttyGS0"
echo "  - RNDIS Net:    usb0 (192.168.7.2)"

# ============================================================
# 停止Gadget的脚本（保存为 stop_gadget.sh）
# ============================================================
: << 'STOP_SCRIPT'
#!/bin/bash
GADGET_NAME="my_composite_gadget"
CONFIGFS_ROOT="/sys/kernel/config/usb_gadget"
cd "$CONFIGFS_ROOT/$GADGET_NAME"
echo "" > UDC                     # 解绑UDC
rm configs/c.1/mass_storage.0     # 解绑功能
rm configs/c.1/acm.GS0
rm configs/c.1/rndis.usb0
rmdir functions/mass_storage.0    # 删除功能
rmdir functions/acm.GS0
rmdir functions/rndis.usb0
rmdir configs/c.1/strings/0x409   # 删除配置
rmdir configs/c.1
rmdir strings/0x409
rmdir "$CONFIGFS_ROOT/$GADGET_NAME"
echo "Gadget stopped"
STOP_SCRIPT
```

这个脚本是实际项目的核心参考。关键点：

1. **UDC名称必须正确**——不同SoC的UDC驱动名不同，用`ls /sys/class/udc/`查看
2. **mass_storage的file必须是块设备或磁盘镜像文件**——普通文件不可直接挂载为U盘，需要先用`dd`创建镜像或用loop设备
3. **符号链接`ln -s`的顺序不能错**——必须先创建功能目录，再链接到配置目录
4. **RNDIS需要MAC地址**——设备端和主机端各需要一个，建议用本地管理地址（02:xx:xx:xx:xx:xx或42:xx:xx:xx:xx:xx）

<br>

---

## <span class="blue"> FunctionFS：用户空间实现USB功能 [E]

### FunctionFS的设计思想

Gadget的内核功能（如`f_mass_storage`、`f_acm`）虽然稳定高效，但有一个局限：**功能逻辑在内核中，不够灵活**。如果你的产品需要一个全新的USB功能（如Android的ADB协议、MTP媒体传输），每次修改都要重新编译内核，调试也麻烦。

**FunctionFS（FFS）** 的解决思路是：**USB功能的核心逻辑搬到用户空间**。内核只负责底层的USB传输，协议解析、状态机、业务逻辑全部由用户空间程序处理。

```
┌─────────────────────────────────────────────────────────────┐
│                    FunctionFS 架构                            │
├─────────────────────────────────────────────────────────────┤
│  用户空间                                                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              你的应用程序 (adb/mtpd/自定义)             │  │
│  │  open("/dev/usb-ffs/adb/ep0")                         │  │
│  │  read(ep0, 接收USB控制请求)                            │  │
│  │  write(ep0, 回复控制请求)                              │  │
│  │  read/write(ep1/ep2, 数据传输)                        │  │
│  │  处理USB协议 + 业务逻辑                                │  │
│  └─────────────────────────┬─────────────────────────────┘  │
│                            │ ioctl/read/write              │
├────────────────────────────┼───────────────────────────────┤
│  内核                      ▼                               │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              FunctionFS 文件系统                        │ │
│  │  /dev/usb-ffs/<name>/ep0   (控制端点)                  │ │
│  │  /dev/usb-ffs/<name>/ep1   (IN端点)                    │ │
│  │  /dev/usb-ffs/<name>/ep2   (OUT端点)                   │ │
│  └─────────────────────────┬─────────────────────────────┘ │
│                            │                                │
│  ┌─────────────────────────┴─────────────────────────────┐ │
│  │         Gadget Function层 (f_fs.ko)                    │ │
│  │  注册为Gadget功能 → 内核管理端点描述符和传输调度          │ │
│  └─────────────────────────┬─────────────────────────────┘ │
│                            │                                │
│  ┌─────────────────────────┴─────────────────────────────┐ │
│  │         UDC驱动 → USB PHY → D+/D-信号                 │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

FunctionFS的工作流程：

1. 内核加载`f_fs.ko`，注册一个FunctionFS类型的Gadget功能
2. 用户空间挂载FunctionFS文件系统（`mount -t functionfs adb /dev/usb-ffs/adb`）
3. 应用程序打开`ep0`端点，**写入USB描述符**（设备描述符、配置描述符、字符串描述符等）
4. 应用程序通过`ep0`接收标准USB控制请求（如`GET_DESCRIPTOR`、`SET_INTERFACE`）
5. 应用程序通过`ep1/ep2`等数据端点进行实际的USB数据传输
6. 所有USB协议的解析和业务逻辑都在用户空间完成

<br>

### FunctionFS用户空间代码框架

下面的代码展示了如何用FunctionFS实现一个自定义USB功能的用户空间程序框架：

```c
/* ============================================================
 * FunctionFS 用户空间代码框架
 * 功能：自定义USB设备，用户空间处理所有USB请求
 * 编译：gcc ffs_demo.c -o ffs_demo
 * ============================================================
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <linux/usb/functionfs.h>

#define FFS_MOUNTPOINT  "/dev/usb-ffs/mydev"
#define EP0_PATH        FFS_MOUNTPOINT "/ep0"
#define EP1_IN_PATH     FFS_MOUNTPOINT "/ep1"
#define EP2_OUT_PATH    FFS_MOUNTPOINT "/ep2"

/* USB描述符定义（需要根据实际功能定制） */
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
    /* 全速端点描述符 */
    .fs_ep1 = {
        .bLength = USB_DT_ENDPOINT_SIZE,
        .bDescriptorType = USB_DT_ENDPOINT,
        .bEndpointAddress = 1 | USB_DIR_IN,   // EP1 IN
        .bmAttributes = USB_ENDPOINT_XFER_BULK,
        .wMaxPacketSize = cpu_to_le16(64),
    },
    .fs_ep2 = {
        .bLength = USB_DT_ENDPOINT_SIZE,
        .bDescriptorType = USB_DT_ENDPOINT,
        .bEndpointAddress = 2 | USB_DIR_OUT,  // EP2 OUT
        .bmAttributes = USB_ENDPOINT_XFER_BULK,
        .wMaxPacketSize = cpu_to_le16(64),
    },
    /* 高速端点描述符 */
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
        .code = cpu_to_le16(0x0409),  // 英语
        .str1 = "MyFFSDevice",
    },
};

int main(int argc, char *argv[])
{
    int ep0, ep1, ep2;
    int ret;

    /* 步骤1：创建挂载点 */
    mkdir(FFS_MOUNTPOINT, 0755);

    /* 步骤2：挂载FunctionFS */
    ret = mount("mydev", FFS_MOUNTPOINT, "functionfs", 0, NULL);
    if (ret < 0 && errno != EBUSY) {
        perror("mount functionfs failed");
        return 1;
    }

    /* 步骤3：打开ep0，写入描述符 */
    ep0 = open(EP0_PATH, O_RDWR);
    if (ep0 < 0) {
        perror("open ep0 failed");
        return 1;
    }

    ret = write(ep0, &ffs_descs, sizeof(ffs_descs));
    if (ret < 0) {
        perror("write descriptors failed");
        return 1;
    }

    ret = write(ep0, &ffs_strings, sizeof(ffs_strings));
    if (ret < 0) {
        perror("write strings failed");
        return 1;
    }

    /* 步骤4：打开数据端点 */
    ep1 = open(EP1_IN_PATH, O_RDWR);
    ep2 = open(EP2_OUT_PATH, O_RDWR);
    if (ep1 < 0 || ep2 < 0) {
        perror("open data endpoints failed");
        return 1;
    }

    printf("FunctionFS就绪，等待USB Host连接...\n");

    /* 步骤5：主循环——处理USB事件和数据传输 */
    while (1) {
        struct usb_functionfs_event event;
        char buf[4096];
        fd_set rfds;

        FD_ZERO(&rfds);
        FD_SET(ep0, &rfds);
        FD_SET(ep2, &rfds);

        ret = select((ep0 > ep2 ? ep0 : ep2) + 1, &rfds, NULL, NULL, NULL);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        /* 处理控制端点事件 */
        if (FD_ISSET(ep0, &rfds)) {
            ret = read(ep0, &event, sizeof(event));
            if (ret < 0) break;

            switch (event.type) {
            case FUNCTIONFS_BIND:
                printf("Event: USB绑定\n");
                break;
            case FUNCTIONFS_UNBIND:
                printf("Event: USB解绑\n");
                break;
            case FUNCTIONFS_ENABLE:
                printf("Event: USB配置使能\n");
                break;
            case FUNCTIONFS_DISABLE:
                printf("Event: USB配置禁用\n");
                break;
            case FUNCTIONFS_SETUP:
                /* 处理标准USB控制请求 */
                printf("Event: SETUP请求 bRequest=0x%02x\n",
                       event.u.setup.bRequest);
                /* 这里需要实现具体的控制请求处理 */
                /* 对于不处理的请求，需要回复STALL */
                {
                    struct usb_ctrlrequest *ctrl = &event.u.setup;
                    /* 示例：回复一个零长度的ACK */
                    if (ctrl->bRequestType & USB_DIR_IN)
                        read(ep0, NULL, 0);   // 准备接收数据阶段
                    else
                        write(ep0, NULL, 0);  // 发送零长度状态包
                }
                break;
            case FUNCTIONFS_SUSPEND:
                printf("Event: USB挂起\n");
                break;
            case FUNCTIONFS_RESUME:
                printf("Event: USB恢复\n");
                break;
            }
        }

        /* 处理OUT端点数据（从Host接收） */
        if (FD_ISSET(ep2, &rfds)) {
            ret = read(ep2, buf, sizeof(buf));
            if (ret > 0) {
                printf("收到 %d 字节数据\n", ret);
                /* 业务逻辑：处理接收到的数据 */

                /* 示例：echo回复——将数据写回IN端点 */
                write(ep1, buf, ret);
            }
        }
    }

    close(ep0);
    close(ep1);
    close(ep2);
    umount(FFS_MOUNTPOINT);
    return 0;
}
```

<br>

### FunctionFS的典型应用

| 应用 | 功能说明 | 实现方式 |
|:---|:---|:---|
| **Android ADB** | Android调试桥 | 用户空间`adbd`守护进程通过FunctionFS实现ADB协议 |
| **Android MTP** | 媒体传输协议 | `mtpd`通过FunctionFS实现MTP，PC端识别为相机设备 |
| **自定义USB协议** | 产品私有协议 | 用户空间程序实现，内核不参与协议解析 |
| **USB充电+通信** | 充电时同时数据交互 | RNDIS/ACM提供通信，VBUS提供电源，Composite组合 |
| **USB调试接口** | 生产调试、固件升级 | ACM串口做命令通道，Mass Storage做固件传输 |

> 💡 **提示**：ConfigFS是**运行时动态配置**的，不需要重新编译内核，也不需要重启设备。这在**调试阶段是神器**——你可以随时修改USB功能组合、Vendor ID、Product ID，快速迭代测试。但生产环境建议把稳定的配置写成启动脚本，确保每次开机自动配置。

<br>

---

## <span class="blue"> 行业实例：嵌入式设备作为USB大容量存储

### 场景描述

一款基于全志T113的工业数据采集设备，内部使用eMMC存储采集数据。用户需要通过USB线将设备连接到Windows PC，PC自动识别为一个U盘，用户可以像操作普通U盘一样浏览和导出数据文件。

### 硬件连接

```
  ┌─────────────────────┐                    ┌───────────────┐
  │  全志T113 开发板     │                    │   Windows PC  │
  │                     │    USB Type-A      │               │
  │  ┌───────────────┐  │◄─────数据线──────►│ USB Host      │
  │  │   USB OTG      │  │   (D+/D- 差分)   │ 控制器        │
  │  │   控制器       │  │    VBUS供电       │               │
  │  │ (musb-hdrc)   │  │                  │               │
  │  └───────┬───────┘  │                  │               │
  │          │          │                  │               │
  │  ┌───────┴───────┐  │                  │               │
  │  │   eMMC 8GB     │  │                  │               │
  │  │  /dev/mmcblk0  │  │                  │               │
  │  │               │  │                  │               │
  │  │ 分区:          │  │                  │               │
  │  │ p1: boot      │  │                  │               │
  │  │ p2: rootfs    │  │                  │               │
  │  │ p3: data(FAT32)│ │◄── 导出为U盘 ────│               │
  │  └───────────────┘  │                  │               │
  └─────────────────────┘                  └───────────────┘
```

### ConfigFS配置步骤

**Step 1：确认内核支持**

```bash
# 检查内核是否开启了必要的配置
grep CONFIG_USB_CONFIGFS /boot/config-$(uname -r)
# 应该看到：
# CONFIG_USB_CONFIGFS=y
# CONFIG_USB_CONFIGFS_MASS_STORAGE=y
# CONFIG_USB_CONFIGFS_F_FS=y
# CONFIG_USB_CONFIGFS_ACM=y
# CONFIG_USB_CONFIGFS_RNDIS=y

# 确认UDC控制器存在
ls /sys/class/udc/
# 输出示例：musb-hdrc
```

**Step 2：完整配置脚本**

```bash
#!/bin/sh
# /usr/local/bin/usb_mass_storage.sh
# 配置T113为USB大容量存储设备

GADGET="mass_storage_gadget"
CONFIGFS="/sys/kernel/config/usb_gadget"
UDC="musb-hdrc"   # T113的OTG控制器
echo "UDC控制器: $UDC"
# 挂载ConfigFS
mount -t configfs none /sys/kernel/config 2>/dev/null

# 创建Gadget
cd $CONFIGFS
mkdir -p $GADGET
cd $GADGET

# 设置USB VID/PID（使用Linux Foundation的测试ID）
echo 0x1d6b > idVendor   # Linux Foundation
echo 0x0104 > idProduct  # Multifunction Composite Gadget
echo 0x0100 > bcdDevice  # v1.0
echo 0x0200 > bcdUSB     # USB 2.0

# 设置字符串描述符
mkdir -p strings/0x409
echo "T113DATA0001"    > strings/0x409/serialnumber
echo "AllwinnerT113"   > strings/0x409/manufacturer
echo "Data Logger Disk" > strings/0x409/product

# 创建配置
mkdir -p configs/c.1
mkdir -p configs/c.1/strings/0x409
echo "Mass Storage" > configs/c.1/strings/0x409/configuration
echo 250 > configs/c.1/MaxPower

# 创建mass_storage功能
mkdir -p functions/mass_storage.0

# 配置LUN（逻辑单元）
echo 0 > functions/mass_storage.0/stall
echo 1 > functions/mass_storage.0/lun.0/removable
echo 0 > functions/mass_storage.0/lun.0/cdrom
echo 0 > functions/mass_storage.0/lun.0/ro   # 非只读，可读写

# 关键：将data分区绑定到mass_storage
echo "/dev/mmcblk0p3" > functions/mass_storage.0/lun.0/file

# 绑定功能到配置
ln -s functions/mass_storage.0 configs/c.1/

# 使能Gadget
echo "$UDC" > UDC

echo "USB Mass Storage已启动，/dev/mmcblk0p3作为U盘导出"
```

**Step 3：验证步骤**

设备端（Linux shell执行）：

```bash
# 1. 查看Gadget状态
ls /sys/kernel/config/usb_gadget/mass_storage_gadget/
# 应有：UDC, bcdDevice, bcdUSB, configs, functions, idProduct, idVendor, strings

# 2. 确认UDC已绑定
cat /sys/kernel/config/usb_gadget/mass_storage_gadget/UDC
# 输出：musb-hdrc

# 3. 查看mass_storage的LUN状态
cat /sys/kernel/config/usb_gadget/mass_storage_gadget/functions/mass_storage.0/lun.0/file
# 输出：/dev/mmcblk0p3

# 4. 查看内核日志
dmesg | grep -i "mass_storage\|gadget\|udc"
# 应看到Gadget绑定和枚举成功的日志
```

PC端（Windows/Linux）：

```bash
# Linux PC：插入USB线后查看识别的USB设备
lsusb | grep "Allwinner\|Linux Foundation"
# 输出示例：Bus 001 Device 045: ID 1d6b:0104 Linux Foundation Multifunction Composite Gadget

# 查看生成的磁盘设备
lsblk
# 应出现新的sdb或sdX设备

# 挂载查看
mkdir -p /mnt/t113_data
mount /dev/sdb1 /mnt/t113_data
ls /mnt/t113_data   # 看到T113的data分区内容
```

Windows端：打开"此电脑"，会看到一个新的U盘图标（卷标为Data Logger Disk），可以像普通U盘一样读写文件。

> 🔴 **危险**：当mass_storage正在导出`/dev/mmcblk0p3`时，**Linux设备自身不能再挂载该分区**。两个系统（设备端的Linux和PC端的Windows）同时访问同一个文件系统会导致**严重的数据损坏**。正确的做法是：设备端先`umount /dev/mmcblk0p3`，再启动mass_storage导出。或者使用`ro=1`配置为只读模式。

<br>

---

## <span class="blue"> 调试技巧与常见问题

### Gadget调试命令速查

| 命令 | 用途 |
|:---|:---|
| `ls /sys/class/udc/` | 查看系统有哪些UDC控制器 |
| `cat /sys/class/udc/<name>/state` | 查看UDC当前状态（not attached/configured/suspended） |
| `cat /sys/class/udc/<name>/current_speed` | 查看当前USB速度（low/full/high/super） |
| `ls /sys/kernel/config/usb_gadget/` | 查看已创建的Gadget实例 |
| `cat /sys/kernel/config/usb_gadget/<name>/UDC` | 查看Gadget绑定的UDC |
| `ls /sys/kernel/config/usb_gadget/<name>/functions/` | 查看Gadget已注册的功能 |
| `ls /sys/kernel/config/usb_gadget/<name>/configs/<cfg>/` | 查看配置中绑定的功能 |
| `dmesg \| grep -i "gadget\|udc\|configfs"` | 查看Gadget相关的内核日志 |
| `dmesg -w` | 实时跟踪内核日志 |
| `lsusb -v -d <vid>:<pid>` | PC端查看USB设备详细描述符 |
| `usb-devices` | PC端列出所有USB设备信息 |
| `cat /sys/kernel/debug/usb/devices` | 查看USB设备树 |

### 常见问题排查

**问题1：Gadget启动后PC端无反应**

排查步骤：
1. 确认UDC名称正确：`ls /sys/class/udc/` 列出的名称必须与写入UDC文件的匹配
2. 确认USB OTG ID引脚状态：Gadget模式需要ID引脚为高电平（或接特定电平）
3. 检查内核日志：`dmesg \| grep -i "gadget\|udc"`，看是否有错误
4. 确认USB线支持数据传输（不是只有电源线的充电线）

**问题2：mass_storage在PC端显示但无法挂载**
1. 确认`lun.0/file`指向的是一个有效的块设备（不是挂载点或普通文件）
2. 确认设备端已经`umount`了该分区（避免双重挂载）
3. 确认分区格式是PC支持的（FAT32/exFAT/NTFS）
4. 检查`dmesg`中是否有I/O错误——可能是eMMC健康问题

**问题3：RNDIS网卡不工作**
1. 确认PC端已安装RNDIS驱动（Windows可能需要手动选择）
2. 检查IP地址配置：设备和PC应在同一网段
3. 用`ping`测试连通性，用`tcpdump -i usb0`抓包分析
4. 检查防火墙是否阻止了USB网络接口的通信

**问题4：ACM串口没有`/dev/ttyGS0`设备**
1. 确认内核启用了`CONFIG_USB_CONFIGFS_ACM`
2. 检查`dmesg`中是否有`gs_console`相关的probe日志
3. 确认udev规则没有拦截tty设备节点的创建
4. 手动创建节点：`mknod /dev/ttyGS0 c 253 0`（主设备号可能不同）

<br>

---

## <span class="blue"> 本节总结

```
┌─────────────────────────────────────────────────────────────────┐
│                      USB Gadget 核心要点                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Gadget框架让Linux设备可以作为USB Device连接到Host              │
│  2. ConfigFS通过文件系统接口实现运行时动态配置，无需重编译内核        │
│  3. Composite支持多Function组合（U盘+网卡+串口同时工作）            │
│  4. FunctionFS将USB功能逻辑搬到用户空间，灵活实现自定义协议          │
│  5. 同一USB控制器不能同时做Host和Device，需要OTG切换或双控制器       │
└─────────────────────────────────────────────────────────────────┘
```

**关键知识回顾表：**

| 知识点 | 核心内容 |
|:---|:---|
| Gadget分层架构 | UDC驱动 → Gadget层 → Composite层 → Function层 |
| ConfigFS配置流程 | 创建gadget → 设置描述符 → 创建功能 → 绑定到config → 写入UDC使能 |
| 常用Gadget功能 | mass_storage(U盘)、acm(串口)、rndis(网卡)、midi(音频)、uvc(摄像头) |
| FunctionFS | 用户空间通过ep0/ep1/ep2等端点实现自定义USB功能，内核只做传输 |
| 调试要点 | ls /sys/class/udc/、dmesg \| grep gadget、lsusb -v |

**快速参考：Gadget启动/停止**

```bash
# 一键启动（mass_storage + acm + rndis）
./composite_gadget.sh start

# 一键停止
./composite_gadget.sh stop

# 查看状态
cat /sys/kernel/config/usb_gadget/*/UDC
ls /sys/kernel/config/usb_gadget/*/functions/
```

<br>

---

## <span class="blue"> 下一步

USB Gadget模式让嵌入式设备可以灵活地扮演各种USB角色，但我们关注的不仅是协议本身，更是数据如何可靠地存储。下一节 **B-B.7.1 eMMC协议深度解析** 将带你深入了解嵌入式设备最主要的内部存储介质——eMMC。我们会详细讲解eMMC的物理接口、命令协议、EXT_CSD寄存器，以及如何在Linux中通过MMC子系统驱动eMMC设备，理解它与SD卡的区别和联系。

<br>

---

## <span class="blue"> 配套资源

**官方文档**
- Linux内核文档：`Documentation/usb/gadget_configfs.rst`
- Linux内核文档：`Documentation/usb/gadget.rst`
- USB-IF官方规范：https://www.usb.org/documents

**推荐阅读**
- `drivers/usb/gadget/` 内核源码目录
- `include/linux/usb/composite.h` —— Composite API头文件
- `include/linux/usb/functionfs.h` —— FunctionFS头文件
- Android ADB源码：`system/core/adb/`（FunctionFS的完整工业级实现参考）

**调试工具安装**
```bash
# Debian/Ubuntu
apt-get install usbutils   # lsusb
apt-get install tcpdump    # 网络抓包

# 嵌入式设备
tcpdump -i usb0 -nn        # 抓取RNDIS USB网卡数据
```
