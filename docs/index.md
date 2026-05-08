# 嵌入式 Linux 知识体系 V2026

> 嵌入式 Linux 全栈知识库 —— 从硬件到应用，从入门到精通

## 体系概览

本知识系统覆盖嵌入式 Linux 开发全链路，按 **B→I→E→M** 四级递进编排。
点击下方模块可展开查看各章节完成状态。

---

??? details "第一部 系统启动与运行  <span class="tag tag-done">完成</span> <span class="meta">最后更新：2026年5月8日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第1章 认识你的开发板 | 板子上有什么？ | 能识别SoC、存储、串口 | <span class="tag tag-done">完成</span> | 否 | / |
    | 第2章 交叉编译与工具链 | 怎么在PC上编译板子程序？ | 有能用的交叉编译器 | <span class="tag tag-done">完成</span> | 否 | / |
    | 第3章 Bootloader：系统的第一段代码 | 上电后谁加载内核？ | U-Boot能运行，网络启动就绪 | <span class="tag tag-done">完成</span> | 否 | / |
    | 第4章 内核配置与编译 | 怎么让内核支持我的板子？ | 编译出可启动的内核 | <span class="tag tag-done">完成</span> | 否 | / |
    | 第5章 根文件系统与初始化 | 内核启动后怎么得到shell？ | BusyBox rootfs，看到#提示符 | <span class="tag tag-done">完成</span> | 否 | / |
    | 第6章 第一个外设：点亮LED | 怎么让软件控制硬件？ | LED亮灭，理解驱动概念 | <span class="tag tag-done">完成</span> | 否 | / |

    **[→ 进入第一部目录](01-系统启动与运行/README.md)**

??? details "第二部 核心机制深度解析  <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：2026年5月8日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | 理解BootROM→SPL→U-Boot→Kernel→init的完整链路 | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 第8章 进程与调度 | 内核如何管理任务与分配CPU？ | 掌握task_struct、CFS、RT调度、cgroups与EAS | <span class="tag tag-wip">建设中</span> | 否 | / |

    **[→ 进入第二部目录](02-核心机制深度解析/README.md)**

??? details "第三部：系统设计与决策 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新：2026年5月4日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | 理解BootROM→SPL→U-Boot→Kernel→init的完整链路 | <span class="tag tag-wip">建设中</span> | 否 | / |

    **[→ 进入第三部目录](03-系统设计与决策/README.md)**

??? details "第四部：系统思维与全链路实战 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新：2026年5月4日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | 理解BootROM→SPL→U-Boot→Kernel→init的完整链路 | <span class="tag tag-wip">建设中</span> | 否 | / |

    **[→ 进入第四部目录](04-系统思维与全链路实战/README.md)**

??? details "第五部：前沿技术与行业视野 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新：2026年5月4日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第31章 嵌入式Linux行业全景 | - | - | <span class="tag tag-wip">建设中</span> | 否 | / |

    **[→ 进入第五部目录](05-前沿技术与行业视野/第31章_嵌入式Linux行业全景.md)**

??? details "A. 应用层编程 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新：2026年5月4日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | 理解BootROM→SPL→U-Boot→Kernel→init的完整链路 | <span class="tag tag-wip">建设中</span> | 否 | / |

    **[→ 进入A扩展目录](A.%20应用层编程/README.md)**

??? details "B. 总线协议 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新：2026年5月4日</span>"
    | 章节 | 核心问题 | 关键产出 | 状态 | 是否人工复检 | 最后修改日期 |
    |:---|:---|:--- |:--- |:---|:---:|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | 理解BootROM→SPL→U-Boot→Kernel→init的完整链路 | <span class="tag tag-wip">建设中</span> | 否 | / |

    **[→ 进入B扩展目录](B.%20总线协议/README.md)**

??? details "C. 专用技术与前沿趋势  <span class="tag tag-15">建设中</span> <span class="meta">最后更新：2026年5月7日</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 10.0 模块概览与学习路径 [E] | [前沿趋势](C.%20专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-done">建设完成</span> | 否 | 2026年5月7日 |
    | 10.1 边缘 AI 推理 [E→M] | [边缘AI](C.%20专用技术与前沿趋势/01-边缘AI推理/README.md) | <span class="tag tag-l3">L3阶段</span> | 是 | 2026年5月4日 |
    | 10.2 异构多核通信 [E→M] | [异构多核](C.%20专用技术与前沿趋势/02-异构多核通信/README.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月6日 |
    | 10.3 虚拟化混合关键系统 [E→M] | [虚拟化](C.%20专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 10.4 RISC-V 生态与开放 ISA 实践 [E→M] | [RISC-V](C.%20专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 10.5 Linux 长期演进与技术路线图 [E→M] | [演进路线](C.%20专用技术与前沿趋势/05-Linux长期演进与技术路线图/README.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月7日 |
    | 10.6 嵌入式Linux实时化技术 [E→M] | [实时化](C.%20专用技术与前沿趋势/06-嵌入式Linux实时化技术/01-Linux实时性基础.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月7日 |

---

> **GitHub**: [github.com/xiaohong0925/Embedded_Knowledge_System_V2026](https://github.com/xiaohong0925/Embedded_Knowledge_System_V2026)
