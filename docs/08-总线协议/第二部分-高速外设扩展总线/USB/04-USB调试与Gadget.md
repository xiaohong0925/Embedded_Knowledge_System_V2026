![BIEM](https://img.shields.io/badge/BIEM-System-blue)

# USB调试与Gadget

<span class="badge-i">[I]</span> <span class="badge-e">[E]</span>


<span class="red">核心概念</span> USB调试需要同时观察主机和设备两侧的行为，Linux提供usbmon和Wireshark两个层面的抓包工具。USB Gadget则让嵌入式设备充当USB外设（而非主机），通过ConfigFS动态配置RNDIS、ACM、MSD等功能。

---

### 为什么需要 USB

<span class="red">在 USB 出现之前，每种外设都有专属接口</span>：键盘用 PS/2、鼠标用 RS-232、打印机用并口、摄像头用专有接口。<br>
接口碎片化导致主板布满各种端口，驱动开发也是重复的体力活。<br>
USB 的设计理念是**万能插座**：无论外设功能多么不同，物理上都是同一个插头，协议上都走相同的枚举流程。<br>
这种通用性将接口复杂性转移到协议层，由主机控制器消化，外设端只需实现最简单的端点响应逻辑。


## USB抓包工具：usbmon与Wireshark

<span class="red">核心概念</span> usbmon是内核提供的USB总线级抓包接口，Wireshark通过解析usbmon数据展示人类可读的USB协议细节。两者结合可以诊断枚举失败、带宽不足、协议冲突等问题。

```bash
# 加载usbmon模块并查看总线列表
$ modprobe usbmon
$ ls /sys/kernel/debug/usb/usbmon
0s  0u  1s  1u  2s  2u
```

---

`0u`表示所有总线的"Urb"格式原始数据，`1u`表示1号总线。
<span class="green">术语</span> **Urb格式**以文本形式输出每个URB的提交和完成事件，包含时间戳、地址、端点、传输类型、长度和状态。

---

```bash
# 直接读取usbmon原始数据
$ cat /sys/kernel/debug/usb/usbmon/1u
ffff8801a3b0a480 2871758295 S Ci:1:001:0 s a3 00 0000 0001 0004 4 <
ffff8801a3b0a480 2871758308 C Ci:1:001:0 0 4 = 01010000
ffff8801a3b0a480 2871762345 S Co:1:001:0 s 23 01 0014 0001 0000 0
ffff8801a3b0a480 2871762350 C Co:1:001:0 0 0
```

---

字段解读：
<br>
`S` = Submit，URB提交；`C` = Callback，URB完成
<br>
`Ci` = Control IN，`Co` = Control OUT，`Bi` = Bulk IN，`Ii` = Interrupt IN
<br>
`1:001:0` = Bus 1, Device 1, Endpoint 0
<br>
`s a3 00 0000 0001 0004` = Setup包：bmRequestType=0xa3, bRequest=0x00, wValue=0x0000, wIndex=0x0001, wLength=0x0004
<br>
`0 4 = 01010000` = 状态0（成功），长度4，数据01010000

---

Wireshark提供更友好的图形界面：
<br>
1. `sudo wireshark -i usbmon1` 捕获1号总线
<br>
2. 过滤器 `usb.device_address == 3` 只看3号设备
<br>
3. 展开SETUP包可以看到bRequestType、bRequest、wValue等字段的语义解析
<br>
4. 对Mass Storage设备，Wireshark还能解析CBW（Command Block Wrapper）和CSW结构

---

<span class="blue">结论/易错点</span> usbmon需要root权限访问debugfs，某些发行版默认不挂载debugfs到/sys/kernel/debug。
<br>
如果`/sys/kernel/debug/usb/usbmon`目录不存在，先执行`mount -t debugfs none /sys/kernel/debug`。
<br>
生产环境抓包建议在测试设备上进行，usbmon的日志量在高带宽设备上可达MB/s。

---

## USB Gadget：RNDIS/ACM/MSD

<span class="red">核心概念</span> USB Gadget是Linux的USB设备模式框架，让嵌入式板子通过USB线被PC识别为网卡（RNDIS）、串口（ACM）或U盘（MSD），实现零配置的网络共享、调试终端和文件传输。

| 功能 | 类名 | PC端识别 | 典型用途 |
|------|------|---------|---------|
| RNDIS | CDC Ethernet | USB网卡 | 共享上网、SSH调试 |
| CDC ACM | Communications | COM端口 | 串口控制台、AT命令 |
| Mass Storage | Mass Storage | 可移动磁盘 | 固件更新、数据导出 |
| MTP | Media Transfer | 媒体设备 | 图片/视频传输 |
| HID | HID | 键盘/鼠标 | 远程输入注入 |

---

ConfigFS（Configuration Filesystem）是现代Gadget的配置方式：
<br>
通过mkdir和symlink在`/sys/kernel/config/usb_gadget/`目录下创建Gadget定义，
<br>
不需要写C代码或重新编译内核。

---

```bash
# ConfigFS配置Gadget为RNDIS+ACM+MSD复合设备
$ mkdir -p /sys/kernel/config/usb_gadget/g1
$ cd /sys/kernel/config/usb_gadget/g1

# 设备描述符
$ echo 0x1d6b > idVendor    # Linux Foundation
$ echo 0x0104 > idProduct   # Multifunction Composite Gadget
$ echo 0x0100 > bcdDevice   # v1.0.0
$ echo 0x0200 > bcdUSB      # USB 2.0

# 字符串描述符
$ mkdir -p strings/0x409
$ echo "1234567890" > strings/0x409/serialnumber
$ echo "MyDevice" > strings/0x409/manufacturer
$ echo "My Gadget" > strings/0x409/product

# 配置描述符
$ mkdir -p configs/c.1/strings/0x409
$ echo "RNDIS+ACM+MSD" > configs/c.1/strings/0x409/configuration

# 添加RNDIS功能
$ mkdir -p functions/rndis.usb0
$ ln -s functions/rndis.usb0 configs/c.1/

# 添加ACM功能
$ mkdir -p functions/acm.usb0
$ ln -s functions/acm.usb0 configs/c.1/

# 添加MSD功能
$ mkdir -p functions/mass_storage.usb0
$ echo /dev/mmcblk0p1 > functions/mass_storage.usb0/lun.0/file
$ ln -s functions/mass_storage.usb0 configs/c.1/

# 绑定到USB控制器
$ echo "musb-hdrc" > UDC
```

---

绑定UDC（USB Device Controller）后，Gadget驱动接管物理控制器。
<br>
PC插入USB线后会依次枚举：Device Descriptor → Configuration Descriptor → 加载三个类驱动（RNDIS网卡、ACM串口、MSD磁盘）。
<br>
嵌入式端同时出现`usb0`网口和`/dev/ttyGS0`串口。

---

<span class="blue">结论/易错点</span> Gadget配置中最常见的错误是UDC名称不匹配。
<br>
不同芯片的USB Device控制器名称各异：全志是`musb-hdrc`，
瑞芯微是`fe800000.usb`，TI是`musb-hdrc.1`。
<br>
正确的查找方式是`ls /sys/class/udc/`，里面列出的就是可用的UDC名称。
<br>
如果Gadget已经绑定到一个UDC，必须先`echo "" > UDC`解绑，才能修改配置。

---

## 设备树usb节点

<span class="red">核心概念</span> 在ARM嵌入式Linux中，USB控制器的角色（Host/Device/OTG）通过设备树（Device Tree）的`dr_mode`属性配置，内核据此加载对应的Host或Gadget驱动。

```dts
/* 全志H3 USB OTG控制器示例 */
&usb_otg {
    dr_mode = "otg";          /* otg / host / peripheral */
    status = "okay";
};

&usbphy {
    usb0_id_det-gpios = <&pio 7 4 GPIO_ACTIVE_HIGH>; /* PH4 */
    status = "okay";
};
```

---

`dr_mode`三种模式：
<br>
`host` = 固定主机模式，只能接U盘、键盘等外设
<br>
`peripheral` = 固定设备模式，只能被PC识别为Gadget
<br>
`otg` = On-The-Go，通过ID引脚检测角色：ID接地时做Host，ID悬空时做Device

---

OTG的ID检测需要GPIO支持：
<br>
`usb0_id_det-gpios`指定检测ID引脚电平的GPIO。
<br>
当OTG线插入且对端是主机（Type-A口），ID引脚被拉低，
本端切换为Device模式，加载Gadget驱动。
<br>
当对端是U盘（Micro-A口），ID引脚悬空，本端切换为Host模式，
加载Host驱动并枚举外设。

---

<span class="green">术语</span> **DRD**（Dual-Role Device，双角色设备）是支持Host和Device两种模式的USB控制器硬件能力。
<br>
DRD控制器内部同时有Host逻辑（OHCI/EHCI/xHCI）和Device逻辑（Gadget），
<br>
通过`dr_mode`或ID引脚动态切换。
<br>
大多数现代嵌入式SoC的USB OTG控制器都是DRD。

---

## 常见故障：枚举失败、带宽不足、协议冲突

<span class="red">核心概念</span> USB调试的核心是定位问题发生在哪一层：物理层（信号/供电）、链路层（时序/CRC）、协议层（描述符/请求）、驱动层（类驱动匹配）。

**枚举失败**：
<br>
- 现象：`lsusb`看不到设备，或看到但无法分配地址
<br>
- 排查：dmesg看`device not accepting address X, error -32`，通常是Endpoint 0响应超时
<br>
- 原因：设备端 firmware未就绪、D+上拉电阻错误、Vbus供电不足、设备未正确处理SET_ADDRESS

---

**带宽不足**：
<br>
- 现象：USB摄像头花屏、USB音频断续、U盘拷贝速度远低于标称
<br>
- 排查：usbmon看NAK率（设备回NAK表示来不及处理），或看ISO传输的帧丢失
<br>
- 原因：设备固件处理不及时、Hub带宽分配不均、总线上低速设备拖累高速Hub、电缆质量差导致重传

---

**协议冲突**：
<br>
- 现象：设备枚举成功但功能异常，如U盘能识别但无法挂载
<br>
- 排查：Wireshark看Mass Storage的CBW命令和CSW状态，或CDC ACM的SET_LINE_CODING是否失败
<br>
- 原因：设备描述符声明的bInterfaceClass与固件实际行为不匹配、
端点方向声明反了（IN vs OUT）、MaxPacketSize与端点FIFO大小不一致

---

## 前沿：USB4与Thunderbolt 3兼容

<span class="red">核心概念</span> USB4是USB-IF基于Intel Thunderbolt 3协议推出的新一代标准，物理接口强制Type-C，带宽40Gbps，支持DP Alt Mode和PCIe隧道。

| 特性 | USB 3.2 | USB4 |
|------|---------|------|
| 最大带宽 | 20 Gbps | 40 Gbps |
| 接口 | Type-A/C | 仅Type-C |
| 隧道协议 | 无 | USB 3.2 + DP + PCIe |
| 拓扑 | Hub级联 | 树形拓扑 |
| 电缆要求 | 普通 | 主动式电缆(>0.8m) |

---

USB4的核心创新是隧道（Tunneling）：
<br>
USB4路由器可以把USB 3.2、DisplayPort和PCIe数据包封装到统一的USB4传输层中，
<br>
共享40Gbps带宽。
<br>
这意味着一根USB4线缆可以同时传输8K视频、NVMe SSD数据和USB外设信号。

---

对嵌入式领域的影响：
<br>
未来的开发板可能只需要一个USB4 Type-C端口，
<br>
通过扩展坞分出HDMI、USB-A、千兆网口、SD卡槽。
<br>
这对轻薄嵌入式设备（如工业平板、医疗手持终端）是福音，
<br>
但也意味着USB4控制器和PHY的成本远高于USB 2.0 OTG。

---

<span class="purple">扩展</span> USB4 Gen4（80Gbps）和USB4 v2已在2022-2023年发布，
<br>
采用PAM3信号编码实现翻倍带宽。
<br>
同时Intel正在推动Thunderbolt 5（120Gbps），
<br>
未来高端笔记本和开发板的单一Type-C端口将承担所有IO职能，
<br>
传统的HDMI、RJ45、DC电源插孔会逐步退出历史舞台。

---

## 历史演进与发展趋势

USB 由 Intel、Microsoft、IBM、Compaq 等七家公司于 1994 年联合发起，1996 年发布 USB 1.0（1.5Mbps/12Mbps）。1998 年 USB 1.1 修复了早期兼容性问题，2000 年 USB 2.0 将高速模式提升至 480Mbps，确立了 USB 作为通用外设接口的地位。2008 年 USB 3.0（后称 USB 3.1 Gen1）引入 5Gbps SuperSpeed 和全双工差分对，2013 年 USB 3.1 Gen2 达 10Gbps，2017 年 USB 3.2 支持双通道 20Gbps。2014 年 USB Type-C 连接器发布，24 针可翻转设计统一了所有 USB 形态。2019 年 USB4 基于 Thunderbolt 3 协议，支持 40Gbps 和隧道化 PCIe/DisplayPort 传输。2022 年 USB4 v2.0 达 80Gbps，引入不对称带宽分配。现代嵌入式开发中，USB OTG/Device 模式使 MCU 可以模拟 U 盘、串口、网卡等外设，USB 已成为事实上唯一的通用高速外设接口。

---

## 本章小结

| 要点 | 内容 |
|------|------|
| 分层架构 | 物理层 + 链路层 + 协议层 + 应用层（类驱动） |
| 描述符体系 | 设备 → 配置 → 接口 → 端点，四级描述符自描述设备能力 |
| 枚举流程 | 总线复位 → 分配地址 → 获取描述符 → 加载驱动 → 配置完成 |
| 电源管理 | 低功耗模式（Suspend/Resume）、Vbus 供电协商、BC 1.2 快充 |
| Gadget 模式 | ConfigFS 动态组合 UAC/MSC/CDC-ACM/RNDIS 功能 |

## 练习

1. USB 描述符（Descriptor）的层级结构是怎样的？设备描述符、配置描述符、接口描述符和端点描述符之间是什么关系？
2. USB 枚举（Enumeration）的完整流程是什么？主机如何通过 SET_ADDRESS、GET_DESCRIPTOR 等标准请求识别并配置新插入的设备？
3. USB Gadget 模式与 Host 模式的本质区别是什么？在嵌入式 Linux 中，ConfigFS 如何动态配置 USB Gadget 的功能组合（如 UAC + MSC + CDC-ACM）？
