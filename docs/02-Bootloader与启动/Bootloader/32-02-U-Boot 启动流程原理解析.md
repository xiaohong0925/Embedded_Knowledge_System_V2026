# U-Boot 启动流程原理解析

> 📊 **本节难度等级：** <span class="badge-bi">**BI级**</span>

---

### <strong>U-Boot的启动流程是“分层初始化、逐步交权”的过程，
从硬件上电到内核启动可清晰拆分为**硬件初始化阶段**和**内核引导阶段**，
两个阶段通过“SPL到主U-Boot的跳转”衔接。整个流程的核心目标是：先让硬件“可用”（初始化DDR、存储等）
再让内核“能跑”（加载镜像、传递参数）。为了直观理解，先看完整启动流程的时序框架：</strong>


### <strong>硬件初始化阶段：ROM启动到BL1/BL2的执行逻辑</strong>

硬件初始化阶段是U-Boot启动的“基础构建期”，核心任务是让“关键硬件”从“上电未就绪”变为“可用状态”，重点是DDR内存（主U-Boot和内核要运行在DDR中）和存储设备（要从中加载后续镜像）。这个阶段的执行主体从“芯片内置ROM”逐步过渡到“U-Boot的SPL/主程序”，每一步都有明确的“权限交接”逻辑，以下按执行顺序拆解：

1.  **第一步：ROM程序启动（0-5ms）——“启动的起点，不可定制”**
    嵌入式芯片上电后，CPU会自动从芯片内置的**ROM（只读存储器）** 中读取并执行程序，这一步是硬件固化的，开发者无法修改。ROM程序的功能极其精简，仅做两件事：
    - 硬件自检：检查芯片核心电路（如CPU内核、时钟模块）是否正常，若异常则触发复位；
    - 加载BL1：从“预设存储位置”（通常是片内Flash或外接SPI NOR闪存）读取BL1镜像并验证（部分芯片支持签名验证，确保镜像合法），验证通过后跳转执行BL1。
    实际开发中，ROM阶段的唯一可见特征是“芯片复位后串口无输出”（ROM程序不打印日志），若此阶段异常（如核心电路故障），设备会处于“上电无任何反应”状态。

2.  **第二步：BL1执行（5-10ms）——“最小化硬件激活”**
    BL1（Boot Loader Stage 1）是芯片厂商提供的“基础引导程序”，通常集成在芯片的片内RAM中（无需外部存储），功能是“激活最核心的硬件”，为后续加载SPL铺路。其核心任务包括：
    - 初始化片内时钟：配置CPU主频、外设时钟的基础频率（如将CPU从复位时的低速模式切换到工作模式）；
    - 初始化片内RAM：片内RAM容量较小（通常几十KB到几百KB），但足以运行后续的SPL程序；
    - 加载SPL：从外接存储设备（如eMMC的boot分区、SPI NOR闪存）读取SPL镜像到片内RAM，跳转执行。
    部分芯片会将BL1进一步拆分为“BL1-Rom”（固化在ROM中）和“BL1-Ram”（加载到片内RAM），但核心逻辑一致。此阶段部分芯片会输出极简日志，例如NXP i.MX6ULL的BL1日志：
    ```log
    BL1: Booting BL2
    BL1: Load BL2 from eMMC @ 0x100000, size 0x8000
    ```

3.  **第三步：SPL执行（10-50ms）——“U-Boot的‘先锋队’，核心定制点”**
    SPL（Secondary Program Loader，二级引导程序）是U-Boot的“精简版”，也是开发者第一个可定制的环节（源码在`spl/`目录）。为什么需要SPL？因为主U-Boot镜像体积较大（通常几MB），而ROM/BL1能访问的存储和RAM空间有限，无法直接加载主U-Boot，SPL的作用就是“搭建桥梁”——用最小的代码量初始化关键硬件，再加载主U-Boot。其核心任务（也是移植时的重点修改内容）包括：
    - 初始化DDR内存：这是SPL最核心的任务！主U-Boot要加载到DDR中运行，SPL会通过“DDR训练”（后续章节详解）配置DDR的时序参数，确保DDR可用。初始化完成后，SPL会打印类似日志：
      ```log
      SPL: Initializing DDR...
      SPL: DDR initialized (1024MB)
      ```
    - 初始化存储设备：根据硬件设计，初始化eMMC、SPI NOR或UFS等存储设备，确保能读取主U-Boot镜像。例如eMMC初始化日志：
      ```log
      SPL: Initializing eMMC...
      SPL: eMMC found, device ID: 0x150100514531334d
      ```
    - 加载主U-Boot：从存储设备的指定分区（如eMMC的boot0分区）读取主U-Boot镜像，加载到DDR的预设地址（如ARM架构通常是0x87800000），加载完成后打印：
      ```log
      SPL: Loading U-Boot from eMMC @ 0x200000, size 0x800000
      SPL: U-Boot loaded to 0x87800000
      ```
    SPL的代码体积严格控制（通常小于128KB），只保留核心初始化逻辑，不包含命令行、网络等复杂功能——这是它与主U-Boot的核心区别。

4.  **第四步：主U-Boot初始化（50-80ms）——“硬件全面激活”**
    当SPL将主U-Boot加载到DDR并完成跳转后，主U-Boot开始执行，此阶段会“全面激活”所有硬件，为后续加载内核做准备。核心任务包括：
    - 外设初始化：初始化串口、网卡、USB、显示屏等所有需要用到的外设（源码在`drivers/`目录），例如串口初始化完成后会打印主U-Boot版本信息：
      ```log
      U-Boot 2023.04 (Nov 25 2025 - 10:00:00 +0800)
      CPU:   ARMv7 Processor [410fc075]
      Board: NXP i.MX6ULL EVK
      DRAM:  1 GiB
      MMC:   FSL_SDHC: 0, FSL_SDHC: 1
      ```
    - 环境变量加载：从存储设备（如eMMC的env分区）加载U-Boot环境变量（如`bootcmd`启动命令、`ipaddr`IP地址等），若未找到则使用默认值。
    至此，硬件初始化阶段结束——此时DDR、存储、串口、网卡等关键硬件均已可用，主U-Boot进入“命令行等待”或“自动执行启动命令”状态。<br>

### <strong>内核引导阶段：从镜像加载到传递参数的完整链路</strong>

内核引导阶段是U-Boot的“核心使命期”，核心任务是“找到内核镜像→加载到内存→告诉内核怎么跑→交权给内核”。这个阶段的执行逻辑可通过U-Boot的`bootcmd`环境变量控制（新手可通过修改`bootcmd`自定义引导行为），以下拆解关键步骤：

1.  **第一步：镜像加载——“把内核和设备树请到DDR里”**
    Linux内核镜像（如`zImage`）和设备树文件（如`imx6ull.dtb`）通常存放在eMMC、UFS或SPI闪存中，也可通过网络加载（如TFTP）。主U-Boot通过“存储设备驱动”或“网络驱动”读取这些文件，加载到DDR的指定地址（地址需与内核编译时的链接地址匹配）。
    常见的加载方式有两种，对应实际开发中高频使用的命令：
    - 本地存储加载（以eMMC为例）：通过`mmc read`命令读取镜像，例如将eMMC第1个分区的内核加载到0x80800000地址：
      ```bash
      # U-Boot命令行执行
      mmc dev 0 1  # 切换到eMMC设备0的分区1
      mmc read 0x80800000 0x100 0x2000  # 从扇区0x100读取0x2000扇区到0x80800000
      ```
      执行成功后会打印：
      ```log
      reading from eMMC device 0, partition 1, sector 0x100, count 0x2000
      8192 sectors read, 4096 KiB loaded
      ```
    - 网络加载（以TFTP为例）：通过`tftp`命令从TFTP服务器加载镜像，适合开发调试（无需反复烧录存储设备）：
      ```bash
      # U-Boot命令行执行
      setenv ipaddr 192.168.1.100  # 开发板IP
      setenv serverip 192.168.1.200  # TFTP服务器IP
      tftp 0x80800000 zImage  # 加载内核到0x80800000
      tftp 0x83000000 imx6ull.dtb  # 加载设备树到0x83000000
      ```
      执行成功后会打印：
      ```log
      Using FEC1 device
      TFTP from server 192.168.1.200; our IP address is 192.168.1.100
      Download Filename 'zImage'.
      Download to address: 0x80800000
      Downloaded 4608000 bytes in 1.2 seconds (37.3 MiB/s)
      ```
    加载时需注意：内核和设备树的加载地址不能重叠（如上述示例中内核0x80800000和设备树0x83000000间隔足够），否则会导致镜像被覆盖而启动失败。

2.  **第二步：启动参数传递——“告诉内核‘怎么配置硬件’”**
    内核启动时需要知道“硬件配置信息”（如根文件系统在哪里、串口波特率多少、是否开启调试日志），这些信息由U-Boot通过“启动参数”传递，核心是`bootargs`环境变量。U-Boot会将`bootargs`的内容写入DDR的指定地址（如ARM架构的0x80000100），内核启动后会从该地址读取参数并解析。
    一个典型的`bootargs`配置示例：
    ```bash
    # U-Boot命令行配置
    setenv bootargs 'console=ttymxc0,115200 root=/dev/mmcblk0p2 rootfstype=ext4 rw init=/linuxrc'
    ```
    各参数含义解析：
    - `console=ttymxc0,115200`：指定内核控制台为串口ttymxc0，波特率115200（确保内核日志能输出到串口）；
    - `root=/dev/mmcblk0p2`：指定根文件系统在eMMC的第2个分区；
    - `rootfstype=ext4 rw`：指定根文件系统类型为ext4，且以读写模式挂载；
    - `init=/linuxrc`：指定内核启动后执行的第一个初始化程序为`/linuxrc`。
    U-Boot在传递参数前会验证参数地址的有效性，确保内核能正确读取。

3.  **第三步：内核跳转——“完成引导交权，U-Boot使命结束”**
    镜像和参数都准备好后，U-Boot通过“跳转命令”将CPU控制权交给内核。不同内核镜像格式对应不同的跳转命令，最常用的是`bootz`（用于压缩的zImage镜像）和`bootm`（用于uImage镜像）：
    ```bash
    # 加载完成后执行跳转（内核0x80800000，设备树0x83000000）
    bootz 0x80800000 - 0x83000000
    ```
    命令中“-”表示没有ramdisk（根文件系统镜像），若有则需填写ramdisk的加载地址。执行跳转后，U-Boot会打印最后一条日志，随后内核开始执行：
    ```log
    ## Booting Linux kernel with ramdisk disabled
    ## Loading Device Tree to 82ffc000, end 82ffffe8 ... OK
    Starting kernel ...

    [    0.000000] Booting Linux on physical CPU 0x0
    [    0.000000] Linux version 5.15.71 (root@ubuntu) (arm-linux-gnueabihf-gcc (GCC) 10.2.1 20210110, GNU ld (GNU Binutils for Ubuntu) 2.36.1) #1 SMP PREEMPT Wed Nov 25 10:05:00 CST 2025
    ```
    至此，U-Boot的引导任务全部完成，后续系统运行由Linux内核接管。<br>

### <strong>关键跳转节点：SPL到主U-Boot的切换机制与条件</strong>

SPL到主U-Boot的跳转是整个启动流程的“关键衔接点”，也是新手移植时容易出现问题的环节（如跳转后主U-Boot崩溃）。这个跳转的核心是“地址正确+硬件就绪+数据传递”，以下拆解切换机制和故障排查思路：

1.  **切换的核心条件——“硬件就绪是前提”**
    SPL只有完成两项核心初始化后，才能执行跳转：
    - DDR内存必须初始化完成：主U-Boot镜像要加载到DDR中运行，若SPL未初始化DDR，加载的主U-Boot会存放在“无效内存”中，跳转后直接崩溃（串口无任何主U-Boot日志）；
    - 主U-Boot镜像验证通过：SPL会检查主U-Boot的镜像头部（如是否有正确的魔术字0x27051956），若验证失败则不执行跳转，打印类似错误日志：
      ```log
      SPL: U-Boot image header check failed
      SPL: Boot failed, resetting...
      ```

2.  **切换的执行逻辑——“地址跳转+数据继承”**
    跳转的本质是CPU执行“分支指令”，将程序计数器（PC）指向主U-Boot在DDR中的起始地址。但跳转不是“凭空切换”，SPL会将关键硬件信息传递给主U-Boot，避免重复初始化，核心是通过**全局数据结构（gd_t）** 实现：
    - gd_t结构定义在`include/asm-generic/global_data.h`中，存储了DDR容量、存储设备信息、环境变量地址等关键数据；
    - SPL在初始化过程中填充gd_t结构，将其放在DDR的固定地址（如0x877ff000）；
    - 主U-Boot启动后会先读取该地址的gd_t数据，基于这些信息继续初始化，避免重复配置DDR、存储等硬件。
    这种“数据继承”机制大幅减少了启动时间，也是U-Boot启动效率优化的关键设计。

3.  **常见跳转故障排查——“日志+命令双验证”**
    新手遇到跳转失败时，可按以下步骤排查：
    - 第一步：检查SPL日志，确认DDR和存储初始化是否成功（关键看“DRAM: 1 GiB”和“eMMC found”等日志）；
    - 第二步：用SPL的`md`命令验证主U-Boot是否正确加载到DDR（如加载地址0x87800000）：
      ```bash
      # SPL命令行执行（部分SPL支持简化命令）
      md 0x87800000 0x10  # 查看0x87800000开始的16字节数据
      ```
      若输出数据全为0或乱码，说明加载失败，需检查存储设备地址或分区配置；
    - 第三步：检查主U-Boot的编译配置，确认其链接地址与SPL的加载地址一致（链接地址在`include/configs/[板型].h`的`CONFIG_SYS_TEXT_BASE`中定义）。<br>

### <strong>U-Boot的启动流程能适配“千差万别的嵌入式硬件”，核心依赖三大技术点的支撑：SPL解决“小ROM场景的引导难题”，DDR训练保障“内存的稳定运行”，设备树交互实现“硬件信息与代码的解耦”。这三个技术点是后续移植、定制的高频操作对象，理解其原理是从“会用”到“会改”的关键。</strong>


### <strong>SPL的作用：小容量ROM场景下的初始化价值</strong>

SPL（Secondary Program Loader，二级引导程序）是U-Boot为解决“芯片内置ROM容量有限”问题而设计的核心组件，新手常困惑“为什么不能直接让主U-Boot启动”，本质是未理解嵌入式硬件的“ROM容量约束”——多数中低端嵌入式芯片的内置ROM容量仅512KB~1MB，而主U-Boot镜像体积通常3MB~5MB，无法直接被ROM加载。SPL的核心价值就是“用最小体积的代码完成‘关键硬件初始化’，为加载主U-Boot铺路”。<br>

### <strong>DDR训练的时机：硬件初始化阶段的关键环节</strong>

DDR（双倍速率同步动态随机存储器）是嵌入式系统的“运行内存”，主U-Boot和Linux内核都需在DDR中运行。但DDR并非上电即可用，需通过“DDR训练”配置时序参数（如时钟周期、读写延迟），使其与CPU、主板的硬件特性匹配——这一步是硬件初始化阶段的“生死线”，训练失败会导致后续所有操作崩溃。<br>

### <strong>设备树的交互：与内核设备树的衔接逻辑</strong>

设备树（Device Tree，DTS）是“硬件信息描述文件”，用于替代传统的“硬编码”方式传递硬件信息（如外设地址、中断号）。U-Boot与Linux内核的设备树交互，核心是“U-Boot辅助适配，内核最终解析”——U-Boot不修改设备树的核心硬件信息，仅根据启动场景做“动态调整”，确保内核能识别当前硬件状态。<br>

---
