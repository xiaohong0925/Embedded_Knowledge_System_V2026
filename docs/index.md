# 嵌入式 Linux 知识体系 V2026

> 嵌入式 Linux 全栈知识库 —— 从硬件到应用，从入门到精通

## 体系概览

本知识系统覆盖嵌入式 Linux 开发全链路，按 **B→I→E→M** 四级递进编排。
点击下方模块可展开查看各章节完成状态。

> 📖 **[→ 不知道从哪里开始？先看《如何阅读本书》](00-阅读指南/如何阅读本书.md)**
> 
> 根据你的经验水平（初学者 / 3年经验 / 5年+经验），选择最适合你的阅读路径。含能力盘点表、个性化路线图、螺旋学习策略。

## 当前阅读基线（2026-11-24）

最新复检更关注读者能否沿同一实例走完整条理解链：先明确主问题，再核对手册与源码证据，跟随代码或命令完成验证，并看清正常路径、错误边界和恢复方式。机制追踪与操作实验可以按阅读任务拆页；命令与输出一一对应；自有教学代码提供完整实现和详细注释；图示只在确实降低理解成本时使用。

**近期 B-B.3 I2C 与 B-B.4 SPI 已按这套方式做了较多优化，读起来更连贯，也更容易跟随。**其他章节仍以首页状态和实际正文为准，不把这两组的变化扩大成全站已经完成。

状态表分别记录旧规则基线、新规则复检和人工复检；三者不能互相替代。

---
??? details "第一部 系统启动与运行  <span class="tag tag-wip">完成</span> <span class="meta">最后更新： 2026年6月10日</span>"
    | 章节 | 核心问题 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 第1章 认识你的开发板 | 板子上有什么？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 是 | 2026年5月13日 |
    | 第2章 交叉编译与工具链 | 怎么在PC上编译板子程序？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 是 | 2026年5月14日 |
    | 第3章 Bootloader：系统的第一段代码 | 上电后谁加载内核？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 是 | 2026年5月22日 |
    | 第4章 内核配置与编译 | 怎么让内核支持我的板子？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 是 | 2026年6月15日 |
    | 第5章 根文件系统与初始化 | 内核启动后怎么得到shell？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否（AI已检） | 2026年6月18日 |
    | 第6章 第一个外设：点亮LED | 怎么让软件控制硬件？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否（AI已检） | 2026年6月18日 |

    **[→ 进入第一部目录](01-系统启动与运行/README.md)**

??? details "第二部 核心机制深度解析  <span class="tag tag-wip">完成</span> <span class="meta">最后更新： 2026年8月6日</span>"
    | 章节 | 核心问题 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 第7章 启动链深度解析 | 从复位到shell到底发生了什么？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否（AI已检） | 2026年8月26日 |
    | 第8章 进程与调度 | 内核如何管理任务与分配CPU？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月22日 |
    | 第9章 内存管理 | 内核如何管理物理与虚拟内存？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月22日 |
    | 第10章 中断与时间 | 硬件中断如何变成软件事件？ | <span class="tag tag-wip">ongoing</span> | <span class="tag tag-wip">待检</span> | 进行中 | 2026年9月14日 |
    | 第11章 设备模型 | 内核如何抽象和匹配设备？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 需二次复查 | 2026年8月26日 |
    | 第12章 文件系统 | 内核如何管理和访问文件？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否（AI已检） | 2026年8月12日 |
    | 第13章 并发与同步 | 内核如何处理多核并发？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否（AI已检） | 2026年8月11日 |
    | 第14章 网络子系统 | 内核如何处理网络数据包？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年6月8日 |
    | 第15章 电源管理 | 嵌入式设备如何省电？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年6月8日 |

    **[→ 进入第二部目录](02-核心机制深度解析/README.md)**

??? details "第三部 系统设计与决策 <span class="tag tag-wip">完成</span> <span class="meta">最后更新： 2026年9月22日</span>"
    | 章节 | 核心问题 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 第16章 内核版本与启动架构设计 | 一套内核版本与启动链方案怎么定下来，并在十年后仍然成立？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月8日 |
    | 第17章 存储架构设计 | 一套存储方案怎么设计出来，并被证明是对的？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月7日 |
    | 第18章 构建系统设计 | 一套构建流程怎么设计出来，并被证明它能撑五年？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月8日 |
    | 第19章 安全架构设计 | 安全要做什么程度？TrustZone值得投入吗？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月22日 |
    | 第20章 实时性设计 | 需要硬实时吗？PREEMPT_RT够了吗？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月22日 |
    | 第21章 OTA与更新架构设计 | 一套OTA方案怎么设计出来，并被证明变砖了也能自己爬回来？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月15日 |
    | 第22章 驱动架构设计 | 怎么设计"硬件变更时影响范围最小"的驱动层？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月8日 |

    **[→ 进入第三部目录](03-系统设计与决策/README.md)**

??? details "第四部 系统思维与全链路实战 <span class="tag tag-15">建设中</span> <span class="meta">最后更新： 2026年9月22日</span>"
    | 章节 | 核心问题 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 第23章 系统调试方法论 | 出了问题怎么系统调试？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月22日 |
    | 第24章 启动全链路优化 | 每一毫秒启动时间去了哪里？愿不愿付代价消灭它？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月15日 |
    | 第25章 Camera全链路：从Sensor到屏幕 | 一帧图像怎么从Sensor走到屏幕，慢在哪、坏在哪、怎么修？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月22日 |
    | 第26章 网络全链路：从PHY到Socket | 一个包从网线到应用，慢在哪、丢在哪、怎么修？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月22日 |
    | 第27章 工业通信全链路 | 确定性怎么从传感器一路保证到执行器？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月15日 |
    | 第28章 功耗全链路 | 每一毫瓦功耗从哪里来，怎么以最小的性能损失消灭它？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月22日 |
    | 第29章 安全全链路 | 安全怎么全链路设计？ | <span class="tag tag-15">建设中</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第30章 可靠性工程：让系统7×24运行 | 怎么让系统7×24运行？ | <span class="tag tag-15">建设中</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |

    **[→ 进入第四部目录](04-系统思维与全链路实战/README.md)**

??? details "第五部 前沿技术与行业视野 <span class="tag tag-15">建设中</span> <span class="meta">最后更新： 2026年8月6日</span>"
    | 章节 | 核心问题 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 第31章 嵌入式Linux行业全景 | 行业格局是怎样的？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月9日 |
    | 第32章 RISC-V：变局者 | RISC-V如何改变嵌入式芯片格局？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第33章 Rust for Linux：新语言 | Rust能替代C写Linux驱动吗？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第34章 边缘AI：智能无处不在 | 嵌入式设备怎么跑AI推理？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第35章 虚拟化与混合关键性 | 怎么在一颗芯片上跑多个系统？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第36章 安全与合规：从可选到强制 | 嵌入式安全合规怎么落地？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第37章 长期维护：10年的承诺 | 怎么维护一个系统10年？ | <span class="tag tag-15">骨架待写</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年7月2日 |
    | 第38章 技术路线规划：你的下一步 | 嵌入式工程师的职业下一步是什么？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年8月6日 |
    | 第39章 具身智能与机器人革命（附加） | 嵌入式Linux在机器人领域如何应用？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年6月18日 |
    | 第40章 赛博义体与碳硅融合（附加） | BCI/外骨骼与嵌入式Linux的关系？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年6月18日 |
    | 第41章 转行机器人：岗位地图与迁移路径（附加） | 3年+嵌入式工程师进机器人行业，去哪个岗位、差距在哪、怎么走？ | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月23日 |

    **[→ 进入第五部目录](05-前沿技术与行业视野/README.md)**

??? details "A. 应用层编程 <span class="tag tag-hold">搁置</span> <span class="meta">最后更新： -</span>"
    | 章节 | 核心问题 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 待规划 | 应用层编程范式与框架 | <span class="tag tag-hold">搁置</span> | 不适用（搁置） | - | - |

    **[→ 进入A扩展目录](A.%20应用层编程/README.md)**

??? details "B. 总线协议 <span class="tag tag-wip">待新规则复检</span> <span class="meta">最后更新： 2026年11月25日</span>"
    | 章节 | 快速链接 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | A. 片内总线认知 | APB/AHB/AXI/TileLink、NoC、CHI/UCIe | <span class="tag tag-wip">待新规则复检</span> | <span class="tag tag-wip">待检</span> | 是 | 2026年10月19日 |
    | B. 低速外设接口 | GPIO/PWM/ADC/DAC、I2C、SPI、UART、I3C（每组含实战篇）；I2C 与 SPI 先行优化，其余内容继续逐篇复检 | <span class="tag tag-wip">新规则复检进行中</span> | <span class="tag tag-wip">进行中</span> | 否 | 2026年11月24日 |
    | C. 中高速外设与存储 | USB、eMMC/UFS、MIPI CSI/DSI（含 7.5/8.5/9.5 三篇实战）；旧规则下已成稿 | <span class="tag tag-wip">待新规则复检</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月21日 |
    | D. 专用网络总线 | PCIe（6 篇）、CAN/CANopen（6 篇）、工业以太网（5 篇）、音频（4 篇）、车载与高速管理面（5 篇）；旧规则下已成稿 | <span class="tag tag-wip">待新规则复检</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月21日 |
    | E. 综合实战 | 机械臂/AGV/人形机器人、整机总线架构设计方法、数通整机三面架构、PREEMPT_RT 调优；旧规则下已成稿 | <span class="tag tag-wip">待新规则复检</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月21日 |
    | F. 前沿高速串行 | SerDes 通识、JESD204C、USB4/Thunderbolt、Aurora；旧规则下已成稿 | <span class="tag tag-wip">待新规则复检</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年9月21日 |
    | 知识图谱 | B.99 全局结构图、跨场景关联、选型速查、10 道自测题 | <span class="tag tag-wip">待新规则复检</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年8月18日 |

    旧规则下的人工复检或成稿状态不等于新规则通过；本扩展全部内容均需按最新规则复检，I2C 与 SPI 只是先行部分。

    **[→ 进入B扩展目录](B.%20总线协议/README.md)**

??? details "C. 专用技术与前沿趋势  <span class="tag tag-15">建设中</span> <span class="meta">最后更新：2026年5月7日</span>"
    | 章节 | 快速链接 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | 10.0 模块概览与学习路径 [E] | [前沿趋势](C.%20专用技术与前沿趋势/README.md) | <span class="tag tag-wip">建设完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月7日 |
    | 10.1 边缘 AI 推理 [E→M] | [边缘AI](C.%20专用技术与前沿趋势/01-边缘AI推理/README.md) | <span class="tag tag-l3">L3阶段</span> | <span class="tag tag-wip">待检</span> | 是 | 2026年5月4日 |
    | 10.2 异构多核通信 [E→M] | [异构多核](C.%20专用技术与前沿趋势/02-异构多核通信/README.md) | <span class="tag tag-l3">L3阶段</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月6日 |
    | 10.3 虚拟化混合关键系统 [E→M] | [虚拟化](C.%20专用技术与前沿趋势/README.md) | <span class="tag tag-wip">建设中</span> | <span class="tag tag-wip">待检</span> | 否 | / |
    | 10.4 RISC-V 生态与开放 ISA 实践 [E→M] | [RISC-V](C.%20专用技术与前沿趋势/README.md) | <span class="tag tag-wip">建设中</span> | <span class="tag tag-wip">待检</span> | 否 | / |
    | 10.5 Linux 长期演进与技术路线图 [E→M] | [演进路线](C.%20专用技术与前沿趋势/05-Linux长期演进与技术路线图/README.md) | <span class="tag tag-l3">L3阶段</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月7日 |
    | 10.6 嵌入式Linux实时化技术 [E→M] | [实时化](C.%20专用技术与前沿趋势/06-嵌入式Linux实时化技术/01-Linux实时性基础.md) | <span class="tag tag-l3">L3阶段</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年5月7日 |

??? details "D. 驱动开发实战 <span class="tag tag-wip">完成</span> <span class="meta">最后更新： 2026年11月24日</span>"
    | 章节 | 快速链接 | 旧规则基线 | 新规则复检 | 人工复检 | 最后修改日期 |
    |:---|:---|:---|:---|:---|:---|
    | Part 1 驱动骨架（D.1~D.9） | 模块框架、字符设备、阻塞等待、中断处理、定时器、DMA、设备树资源获取、电源管理、调试接口 | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年8月12日 |
    | Part 2 子系统写法（D.10~D.18） | input、IIO、hwmon、LED、watchdog、regmap、MFD、用户态驱动（UIO/VFIO）、选型速查；D.19 MTD 子系统写法待补 | <span class="tag tag-wip">完成</span> | <span class="tag tag-wip">待检</span> | 否 | 2026年11月24日 |

    **[→ 进入D扩展目录](D.%20驱动开发实战/README.md)**

---
> **GitHub**: [github.com/xiaohong0925/Embedded_Knowledge_System_V2026](https://github.com/xiaohong0925/Embedded_Knowledge_System_V2026)
