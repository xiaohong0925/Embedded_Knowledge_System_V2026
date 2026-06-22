# 嵌入式 Linux 知识体系 V2026

> 嵌入式 Linux 全栈知识库 —— 从硬件到应用，从入门到精通

## 体系概览

本知识系统覆盖嵌入式 Linux 开发全链路，按 **B→I→E→M** 四级递进编排。
点击下方模块可展开查看各章节完成状态。

---
??? details "第一部 系统启动与运行  <span class="tag tag-done">完成</span> <span class="meta">最后更新： 2026年6月10日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第1章 认识你的开发板 | 板子上有什么？ | 能识别SoC、存储、串口 | <span class="tag tag-done">完成</span> | 是 | 2026年5月13日 |
    | 第2章 交叉编译与工具链 | 怎么在PC上编译板子程序？ | 有能用的交叉编译器 | <span class="tag tag-done">完成</span> | 是 | 2026年5月14日 |
    | 第3章 Bootloader：系统的第一段代码 | 上电后谁加载内核？ | U-Boot能运行，网络启动就绪 | <span class="tag1 tag-done">完成</span> | 是 | 2026年5月22日 |
    | 第4章 内核配置与编译 | 怎么让内核支持我的板子？ | 编译出可启动的内核 | <span class="tag1 tag-done">完成</span> | 是 | 2026年6月15日 |
    | 第5章 根文件系统与初始化 | 内核启动后怎么得到shell？ | BusyBox rootfs，看到#提示符 | <span class="tag tag-done">完成</span> | AI复检完成 | 2026年6月18日 |
    | 第6章 第一个外设：点亮LED | 怎么让软件控制硬件？ | LED亮灭，理解驱动概念 | <span class="tag tag-done">完成</span> | AI复检完成 | 2026年6月18日 |

    **[→ 进入第一部目录](01-系统启动与运行/README.md)**

??? details "第二部 核心机制深度解析  <span class="tag tag-done">完成</span> <span class="meta">最后更新： 2026年6月10日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | 理解BootROM→SPL→U-Boot→Kernel→init的完整链路 | <span class="tag tag-done">完成</span> | 否 | 2026年5月22日 |
    | 第8章 进程与调度 | 内核如何管理任务与分配CPU？ | 掌握task_struct、CFS、RT调度、cgroups与EAS | <span class="tag tag-done">完成</span> | 否 | 2026年5月22日 |
    | 第9章 内存管理 | 内核如何管理物理与虚拟内存？ | 掌握伙伴系统、SLUB、CMA、OOM | <span class="tag tag-done">完成</span> | 否 | 2026年5月22日 |
    | 第10章 中断与时间 | 硬件中断如何变成软件事件？ | 掌握GIC、顶半部/底半部、hrtimer、tickless | <span class="tag tag-done">完成</span> | 否 | 2026年5月22日 |
    | 第11章 设备模型 | 内核如何抽象和匹配设备？ | 掌握kobject、sysfs、bus/device/driver、platform | <span class="tag tag-done">完成</span> | 否 | 2026年5月22日 |
    | 第12章 文件系统 | 内核如何管理和访问文件？ | 掌握VFS、页缓存、ext4/SquashFS、io_uring | <span class="tag tag-done">完成</span> | 否 | 2026年5月22日 |
    | 第13章 并发与同步 | 内核如何处理多核并发？ | 掌握spinlock/mutex、RCU、原子操作、lockdep/KASAN | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |
    | 第14章 网络子系统 | 内核如何处理网络数据包？ | 掌握sk_buff、Netfilter、NAPI、XDP/eBPF | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |
    | 第15章 电源管理 | 嵌入式设备如何省电？ | 掌握Runtime PM、cpuidle/cpufreq、Thermal、Suspend | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |

    **[→ 进入第二部目录](02-核心机制深度解析/README.md)**

??? details "第三部：系统设计与决策 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新： -</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第16-30章 待规划 | 系统设计方法论与工程决策 | - | <span class="tag tag-hold">搁置</span> | - | - |

    **[→ 进入第三部目录](03-系统设计与决策/README.md)**

??? details "第四部：系统思维与全链路实战 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新： -</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 待规划 | 全链路实战项目 | - | <span class="tag tag-hold">搁置</span> | - | - |

    **[→ 进入第四部目录](04-系统思维与全链路实战/README.md)**

??? details "第五部：前沿技术与行业视野 <span class="tag tag-done">完成</span> <span class="meta">最后更新： 2026年5月9日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第31章 嵌入式Linux行业全景 | 嵌入式Linux行业生态是怎样的？ | 全面了解行业格局与发展方向 | <span class="tag tag-done">完成</span> | 否 | 2026年5月9日 |
    | 第32-33章 机器人与赛博义体 | 嵌入式Linux在机器人领域如何应用？ | 理解机器人OS架构与赛博义体技术栈 | <span class="tag tag-done">完成</span> | 否 | 2026年5月8日 |

    **[→ 进入第五部目录](05-前沿技术与行业视野/第31章_嵌入式Linux行业全景.md)**

??? details "A. 应用层编程 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新： -</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 待规划 | 应用层编程范式与框架 | - | <span class="tag tag-hold">搁置</span> | - | - |

    **[→ 进入A扩展目录](A.%20应用层编程/README.md)**

??? details "B. 总线协议 <span class="tag tag-done">完成</span> <span class="meta">最后更新： 2026年6月8日</span>"
    | 章节 | 快速链接 | 状态 | 是否人工复检 | 最后修改日期 |
    |------|---------|------|------------|------------|
    | A. 低速外设接口 | GPIO/PWM/ADC/DAC、I2C、SPI、UART、I3C | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |
    | B. 中高速外设与存储 | USB、eMMC/UFS、MIPI CSI/DSI | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |
    | C. 专用网络总线 | CAN/CANopen、EtherCAT、PCIe、I2S | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |
    | D. 片内总线认知 | APB/AHB/AXI/TileLink | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |
    | E. 综合实战 | 机械臂多总线协同、AGV总线方案 | <span class="tag tag-done">完成</span> | 否 | 2026年6月8日 |

    **[→ 进入B扩展目录](B.%20总线协议/README.md)**

??? details "C. 专用技术与前沿趋势  <span class="tag tag-15">建设中</span> <span class="meta">最后更新：2026年5月7日</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 10.0 模块概览与学习路径 [E] | [前沿趋势](C.%20专用技术与前沿趋势/README.md) | <span class="tag tag-done">建设完成</span> | 否 | 2026年5月7日 |
    | 10.1 边缘 AI 推理 [E→M] | [边缘AI](C.%20专用技术与前沿趋势/01-边缘AI推理/README.md) | <span class="tag tag-l3">L3阶段</span> | 是 | 2026年5月4日 |
    | 10.2 异构多核通信 [E→M] | [异构多核](C.%20专用技术与前沿趋势/02-异构多核通信/README.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月6日 |
    | 10.3 虚拟化混合关键系统 [E→M] | [虚拟化](C.%20专用技术与前沿趋势/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 10.4 RISC-V 生态与开放 ISA 实践 [E→M] | [RISC-V](C.%20专用技术与前沿趋势/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 10.5 Linux 长期演进与技术路线图 [E→M] | [演进路线](C.%20专用技术与前沿趋势/05-Linux长期演进与技术路线图/README.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月7日 |
    | 10.6 嵌入式Linux实时化技术 [E→M] | [实时化](C.%20专用技术与前沿趋势/06-嵌入式Linux实时化技术/01-Linux实时性基础.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月7日 |

---
> **GitHub**: [github.com/xiaohong0925/Embedded_Knowledge_System_V2026](https://github.com/xiaohong0925/Embedded_Knowledge_System_V2026)
