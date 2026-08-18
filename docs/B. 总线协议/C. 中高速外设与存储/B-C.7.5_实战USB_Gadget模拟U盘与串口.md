# B-C.7.5 实战：USB Gadget 模拟 U 盘与串口 + Host 端枚举观察

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[M] | 预计阅读时间：40 分钟（含动手 60~90 分钟）

## 本节导读

前四节把 USB 的物理层、枚举协议、Host 驱动、Gadget 框架都讲完了，这一节把它们全部跑起来：把你的开发板变成一个"U 盘 + 虚拟串口"双功能 USB 设备，插到电脑上，然后从 Host 侧一步步观察枚举过程——亲眼看到 B-C.7.2 里讲的 8 步在总线上真实发生。

这个实战的价值不止是"会配 Gadget"。配完之后你手里就有了一套可重复的实验环境：以后调任何 USB 设备（不管是 Host 侧还是 Device 侧），都可以拿这套环境对照——抓包看枚举、改描述符看 Host 反应、故意制造故障看错误码。这是 USB 调试能力的训练场。

本节覆盖：实验环境准备（含无 OTG 板的替代方案）、磁盘镜像制作、双功能 Gadget 的完整配置脚本、Host 侧用 dmesg / lsusb / usbmon 对照枚举 8 步、串口与 U 盘两个功能的双向验证，以及一份"故意制造故障"的实验清单。

## 实验准备

### 硬件方案

| 方案 | 需要的硬件 | 说明 |
|------|-----------|------|
| 首选：带 OTG 口的开发板 | 树莓派 Zero/4/5、RK3399、全志 T113 等，一根 USB 数据线 | 板子的 OTG 口连 PC 的 USB 口 |
| 备选：两台 Linux 机器 | 一台有 UDC 的板子 + 任意 Linux PC | 与首选等价，只是 Host 侧也用 Linux，方便用 usbmon 抓包 |
| 兜底：无 UDC 的板子 | 一块普通板子 + 一台 PC | 做不了 Device 侧，改用 PC 上的 dummy_hcd 模拟（见文末排障） |

> 怎么确认板子有 UDC：`ls /sys/class/udc/` 有内容就是有。目录为空说明当前内核没有把任何控制器配置为 Device 模式，需要先查设备树里对应 USB 节点的 `dr_mode` 属性（`otg` 或 `peripheral` 才能当 Device，`host` 不行）。

数据线要用**能传数据的 USB 线**，不能是只能充电的电源线。判断方法：线插上后如果 Host 侧 `dmesg` 完全没反应，第一件事就是换线。

### 软件环境检查

板子端（Device 侧）需要这些内核配置：

```bash
grep -E "CONFIG_USB_GADGET|CONFIG_USB_CONFIGFS" /boot/config-$(uname -r)
```

```
CONFIG_USB_GADGET=y
CONFIG_USB_CONFIGFS=y
CONFIG_USB_CONFIGFS_MASS_STORAGE=y
CONFIG_USB_CONFIGFS_ACM=y
```

如果配置是 `=m`（模块），先 `modprobe libcomposite`。如果完全没有，需要重编内核开启这些选项——Buildroot 里在 `Kernel → Linux Kernel Configuration` 中搜索 `USB_CONFIGFS` 打开即可（内核配置方法见第 4 章）。

Host 侧（PC）需要：`lsusb`（usbutils 包）、`dmesg`、可选的 Wireshark。Host 是 Linux 时装 `tcpdump` 用于 usbmon 抓包。

## 任务一：制作 U 盘镜像

B-C.7.4 的实例直接把 eMMC 分区导出为 U 盘，那是最贴近产品的做法，但实验阶段有更安全的玩法：**用一个镜像文件当 U 盘**。不碰真实分区，随便折腾，坏了重做就是。

```bash
# 1. 创建一个 64MB 的空白镜像
dd if=/dev/zero of=/root/usbdisk.img bs=1M count=64

# 2. 格式化为 FAT32（Windows/Linux 都认）
mkfs.vfat /root/usbdisk.img
```

```
mkfs.fat 4.2 (2021-01-31)
/root/usbdisk.img has 1 head, 32 sectors per track...
```

```bash
# 3. 挂载镜像，放一个测试文件进去（让 PC 端立刻有东西可看）
mkdir -p /mnt/img
mount -o loop /root/usbdisk.img /mnt/img
echo "Hello from embedded board" > /mnt/img/README.txt
sync
umount /mnt/img
```

> loop 设备：把普通文件"包装"成块设备的内核机制。`mount -o loop` 让镜像文件可以像真实分区一样被格式化和挂载。Gadget 的 `lun.0/file` 接受块设备，也直接接受镜像文件——写文件路径即可，Gadget 内部自己建 loop 映射。

## 任务二：配置双功能 Gadget

把下面脚本存为 `/root/start_gadget.sh`，`chmod +x` 后执行：

```bash
#!/bin/sh
# 双功能 Gadget：U盘(mass_storage) + 虚拟串口(acm)

CONFIGFS="/sys/kernel/config/usb_gadget"
GADGET="lab_gadget"
UDC=$(ls /sys/class/udc/ | head -1)    # 自动取第一个 UDC

mount -t configfs none /sys/kernel/config 2>/dev/null

cd $CONFIGFS
mkdir $GADGET
cd $GADGET

# --- 设备描述符：故意用测试 VID/PID，方便在 lsusb 里一眼认出 ---
echo 0x1209 > idVendor     # pid.codes（开源社区保留 VID）
echo 0x0001 > idProduct
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB

mkdir strings/0x409
echo "LAB0001"           > strings/0x409/serialnumber
echo "EmbeddedLab"       > strings/0x409/manufacturer
echo "USB Lab Gadget"    > strings/0x409/product

# --- 配置 ---
mkdir configs/c.1
mkdir configs/c.1/strings/0x409
echo "MSC + ACM" > configs/c.1/strings/0x409/configuration
echo 250 > configs/c.1/MaxPower

# --- 功能 1：U盘，指向任务一做的镜像 ---
mkdir functions/mass_storage.0
echo 1 > functions/mass_storage.0/lun.0/removable
echo "/root/usbdisk.img" > functions/mass_storage.0/lun.0/file
ln -s functions/mass_storage.0 configs/c.1/

# --- 功能 2：虚拟串口 ---
mkdir functions/acm.GS0
ln -s functions/acm.GS0 configs/c.1/

# --- 使能：写 UDC 名的瞬间，枚举开始 ---
echo $UDC > UDC
echo "UDC=$UDC，Gadget 已使能"
```

执行后用 USB 线把板子连到 PC。检查点：`dmesg | tail -5` 应看到 Gadget 绑定日志；`cat /sys/kernel/config/usb_gadget/lab_gadget/UDC` 应回显 UDC 名。

## 任务三：Host 侧观察枚举（本节的核心）

现在切到 PC（Host 侧）。以下命令以 Linux PC 为例；Windows 用设备管理器 + USBView 也能看到等价信息。

### 第一步：dmesg 看枚举实况

插线的瞬间，Host 的 `dmesg -w` 输出：

```
usb 1-2: new high-speed USB device number 12 using xhci_hcd
usb 1-2: New USB device found, idVendor=1209, idProduct=0001, bcdDevice= 1.00
usb 1-2: New USB device strings: Mfr=1, Product=2, SerialNumber=3
usb 1-2: Product: USB Lab Gadget
usb 1-2: Manufacturer: EmbeddedLab
usb 1-2: SerialNumber: LAB0001
usb-storage 1-2:1.0: USB Mass Storage device detected
scsi host0: usb-storage 1-2:1.0
cdc_acm 1-2:1.2: ttyACM0: USB ACM device
scsi 0:0:0:0: Direct-Access  Linux  File-Stor Gadget  ... 
sd 0:0:0:0: [sda] Attached SCSI removable disk
```

对照 B-C.7.2 的 8 步逐行读这段日志：`new high-speed device` 是 ①②③（连接、复位、地址分配完成）；`New USB device found` 是 ④（设备描述符读到了）；`strings` 三行是 ⑦；`usb-storage ... detected` 和 `ttyACM0` 是 ⑧（配置激活、驱动按接口绑定）。**注意同一个物理设备绑了两个驱动**——usb-storage 绑接口 1.0，cdc_acm 绑接口 1.2，这正是"驱动绑接口不绑设备"的现场演示。

### 第二步：lsusb 看设备身份

```bash
lsusb -d 1209:0001
```

```
Bus 001 Device 012: ID 1209:0001 Generic pid.codes Test PID
```

```bash
lsusb -v -d 1209:0001 | grep -E "bInterfaceClass|bNumInterfaces|iProduct"
```

```
    bNumInterfaces          3
    bInterfaceClass         8 Mass Storage
    bInterfaceClass         2 Communications
    bInterfaceClass        10 CDC Data
```

一个配置、三个接口：Mass Storage + CDC 控制 + CDC 数据。这正是你在 ConfigFS 里挂的两个功能（ACM 一个功能占两个接口）在描述符里的样子。

### 第三步：usbmon 抓包，对照三阶段握手

Linux PC 上抓枚举全过程（Windows 可用 Wireshark + USBPcap）：

```bash
modprobe usbmon
# 找到设备所在总线号（lsusb 输出里的 Bus 001）
tcpdump -i usbmon1 -w /tmp/enum.pcap &
# 板子端重新使能 Gadget 触发一次新枚举：
#   echo "" > UDC; sleep 1; echo musb-hdrc > UDC
```

抓完后用 Wireshark 打开 `enum.pcap`，过滤器输入 `usb.bDescriptorType`，你会依次看到 B-C.7.2 讲过的每一笔控制传输：`SET_ADDRESS`、`GET_DESCRIPTOR (DEVICE)`、`GET_DESCRIPTOR (CONFIGURATION)`、`GET_DESCRIPTOR (STRING)`、`SET_CONFIGURATION`。点开任意一笔，展开看 Setup/Data/Status 三个阶段——课本上的时序图变成了真实抓包。

到这里，枚举从"文档里的流程"变成"你亲眼抓到的包"。这个对照体验是后续所有 USB 排障的底气。

## 任务四：验证两个功能

### U 盘功能

Host 侧应出现新磁盘（Linux：`/dev/sda`；Windows：此电脑里的新盘符）。打开能看到任务一放进去的 `README.txt`。在 PC 上新建一个文件、安全弹出，然后回到板子端：

```bash
# 板子端停用 Gadget
cd /sys/kernel/config/usb_gadget/lab_gadget
echo "" > UDC

# 重新挂载镜像，检查 PC 写入的文件是否在
mount -o loop /root/usbdisk.img /mnt/img
ls /mnt/img
```

PC 写入的文件出现在镜像里——数据双向流动验证完成。

### 串口功能

板子端（Device 侧）的串口节点是 `/dev/ttyGS0`，Host 侧是 `/dev/ttyACM0`（Windows 是 COM 口）。

板子端开一个接收：

```bash
cat /dev/ttyGS0
```

PC 端发送：

```bash
echo "hello gadget" > /dev/ttyACM0
```

板子端 `cat` 应打印出 `hello gadget`。反向同理：板子端 `echo hi > /dev/ttyGS0`，PC 端 `cat /dev/ttyACM0`（或 minicom 打开双向交互）。

> ⚠️ 串口不通时最常见的原因：板子端没有任何进程打开 `/dev/ttyGS0` 时，Gadget 侧的端点是关闭的，Host 发来的数据会被丢弃（不是缓存）。先 `cat /dev/ttyGS0` 占住端口再发。另一个坑是 Host 端打开 ttyACM0 时默认带流控/回显配置，用 `stty -F /dev/ttyACM0 raw -echo` 关掉。

## 任务五：故意制造故障，训练排障直觉

环境搭好后，做三个"破坏实验"，把 B-C.7.2 排障节的错误码亲眼看一遍：

| 实验 | 做法 | 预期现象 | 对应知识 |
|------|------|---------|---------|
| 只充电线 | 换一根无数据线的 USB 线 | Host dmesg 完全无输出 | 物理层：D+/D- 不通则无连接检测 |
| 坏镜像 | `lun.0/file` 指向不存在的文件后使能 | 板子 dmesg 报 mass_storage 错误，Host 只能枚举出串口 | 功能级失败不影响其他接口枚举 |
| 重复绑定 | 不写空 UDC 直接再次 `echo $UDC > UDC` | `echo: write error: Device or resource busy` | UDC 同时只能绑一个 Gadget |

每个实验做完，恢复原配置，确认功能回来。这个过程练的是"症状 → 定位"的肌肉记忆。

## 排障速查

| 症状 | 第一怀疑 | 验证手段 |
|------|---------|---------|
| `ls /sys/class/udc/` 为空 | 设备树 `dr_mode = "host"` | 查设备树 USB 节点，改 `otg`/`peripheral` |
| 写 UDC 报错 `No such device` | UDC 名拼错 | `ls /sys/class/udc/` 逐字符比对 |
| PC 无任何反应 | 电源线 / ID 引脚 / VBUS | 换线；查 OTG 配置；量 VBUS 电压 |
| PC 只看到串口没有盘 | 镜像路径或权限 | 板端 `cat functions/mass_storage.0/lun.0/file` |
| 盘能识别打不开 | 镜像未格式化 | 板端重新 `mkfs.vfat` |
| 无 UDC 板子想做实验 | 硬件限制 | PC 上 `modprobe dummy_hcd` 后用 `g_serial` 等本机模拟 |

## 本节总结

| 自查项 | 完成本实战你应能独立做到 |
|--------|------------------------|
| 环境确认 | 判断一块板子能否做 USB Device（UDC 存在 + dr_mode 正确） |
| 镜像制作 | 用 dd + mkfs.vfat + loop 挂载制作可导出的 U 盘镜像 |
| Gadget 配置 | 不看脚本配出"存储 + 串口"双功能 Gadget |
| 枚举观察 | 在 Host dmesg 里指出枚举 8 步对应的日志行，用 usbmon 抓到 SET_CONFIGURATION |
| 功能验证 | 双向验证 U 盘文件读写和串口收发 |
| 故障复现 | 复现三类典型故障并从症状反推根因 |

## 配套资源

- pid.codes（开源硬件 VID/PID 申请）：https://pid.codes
- 内核 ConfigFS Gadget 文档：`Documentation/usb/gadget_configfs.rst`
- Wireshark USB 抓包指南：https://wiki.wireshark.org/CaptureSetup/USB
- Windows 侧 USB 分析工具：USBView（Windows SDK 自带）
