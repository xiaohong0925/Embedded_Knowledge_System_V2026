# 嵌入式 Linux 知识体系 V2026

> 嵌入式 Linux 全栈知识库 —— 从硬件到应用，从入门到精通

## 体系概览

本知识系统覆盖嵌入式 Linux 开发全链路，按 **B→I→E→M** 四级递进编排。
点击下方模块可展开查看各章节完成状态。

---

??? details "1. 硬件层 <span class="badge-b">B</span><span class="badge-e">E</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 1.0 原理图阅读与板级硬件基础 [B] | [硬件层](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.1 CPU 架构（ARMv7/v8, RISC-V, MIPS）[B→E] | [CPU架构](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.2 时钟、电源与复位管理（PMIC, DVFS, PVT, 看门狗）[B→E] | [时钟电源](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.3 DDR/LPDDR 运行内存硬件 [B→E] | [内存](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.4 存储设备（NOR/NAND, eMMC/UFS, SD, 选型规范）[B→E] | [存储设备](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.5 总线与接口（低速外设、高速总线、工业总线）[B→E] | [总线协议](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.6 硬件加速器（GPU, NPU, Crypto, DSP）[B→E] | [硬件加速器](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.7 硬件调试 & 安全模块（JTAG/SWD, CoreSight, TrustZone, TPM/HSM）[B→E] | [硬件调试](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 1.8 传感器/执行器接口（IIO硬件规范、工业总线硬件层）[B→E] | [传感器接口](01-硬件层/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "2. Bootloader与启动 <span class="badge-b">B</span><span class="badge-e">E</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 2.0 模块概览与学习路径 [B] | [Bootloader](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 2.1 U-Boot 移植与定制 [B→E] | [U-Boot](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 2.2 安全启动链 [I→E] | [安全启动](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 2.3 启动排错与快速启动 [I→E] | [快速启动](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 2.4 网络引导 [I] | [网络引导](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 2.5 A/B 分区 & 回滚策略 [I→E] | [A/B回滚](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 2.6 U-Boot 命令与脚本开发 [B→I] | [U-Boot脚本](02-Bootloader与启动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "3. Linux内核深度解析 <span class="badge-i">I</span><span class="badge-m">M</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：2026年5月4日</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 3.0 模块概览与学习路径 [I] | [Linux内核](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.1 系统调用与ABI接口 [I] | [系统调用](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.2 内核启动与初始化全流程 [I→E] | [内核启动](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.3 进程管理与调度 [I→M] | [进程管理](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.4 内存管理 [I→M] | [内存管理](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.5 中断子系统 [I→M] | [中断子系统](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.6 时间子系统 [I→E] | [时间子系统](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.7 内核同步原语底层实现 [I→E] | [同步原语](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.8 虚拟文件系统与页缓存 [I→M] | [VFS](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.9 设备树 & ACPI [I→E] | [设备树](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.10 驱动模型 [I→E] | [驱动模型](03-Linux内核与驱动/驱动模型/01-驱动模型基础认知.md) | <span class="tag tag-l3">L3阶段</span> | 是 | 2026年5月4日 |
    | 3.11 电源管理 [I→E] | [电源管理](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.12 网络子系统 [I→M] | [网络子系统](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.13 内核安全加固 [I→M] | [安全加固](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 3.14 内核模块机制 [I] | [模块机制](03-Linux内核与驱动/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "4. 系统构建与部署 <span class="badge-i">I</span><span class="badge-e">E</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 4.0 模块概览与学习路径 [I] | [系统构建](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.1 交叉编译工具链 [I] | [交叉编译](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.2 内核裁剪与移植 [I→E] | [内核裁剪](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.3 构建系统选型 [I→E] | [构建选型](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.4 rootfs 与系统初始化 [I→E] | [rootfs](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.5 软件包管理 [I] | [包管理](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.6 OTA 更新 [I→E] | [OTA](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 4.7 固件镜像打包与烧录 [I] | [固件烧录](04-系统构建与部署/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "5. 设备驱动开发 <span class="badge-b">B</span><span class="badge-m">M</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 5.0 模块概览与学习路径 [B] | [驱动开发](05-驱动开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.1 驱动框架 [B→I] | [驱动框架](05-驱动开发/设备驱动框架（字符-块-网络）/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.2 用户-内核接口 [B→I] | [用户-内核接口](05-驱动开发/用户态-内核态交互/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.3 并发与竞态 [I→E] | [并发与竞态](05-驱动开发/并发与竞态/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.4 中断 & DMA [I→E] | [中断&DMA](05-驱动开发/中断处理、DMA编程/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.5 标准外设驱动实战 [B→I] | [标准外设](05-驱动开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.6 高速外设驱动实战 [I→E] | [高速外设](05-驱动开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.7 工业总线驱动实战 [I→E] | [工业总线](05-驱动开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.8 多媒体驱动入门 [E→M] | [多媒体驱动](05-驱动开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 5.10 驱动调试与排错进阶 [I→E] | [驱动调试](05-驱动开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "6. 内核调试与性能优化 <span class="badge-i">I</span><span class="badge-m">M</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 6.0 模块概览与学习路径 [I] | [内核调试](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 6.1 崩溃分析 [I→E] | [崩溃分析](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 6.2 死锁与系统Hang机调试 [I→E] | [死锁调试](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 6.3 动态追踪 [I→M] | [动态追踪](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 6.4 内存调试 [I→E] | [内存调试](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 6.5 实时性调优 [I→M] | [实时性](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 6.6 启动时间 & 功耗剖析 [I→E] | [启动功耗](06-内核调试与性能优化/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "7. 应用层开发 <span class="badge-b">B</span><span class="badge-e">E</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 7.0 嵌入式应用开发基础 [B] | [应用层](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.1 多线程与同步 [B→I] | [多线程](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.2 信号处理 [I] | [信号处理](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.3 网络编程 [B→E] | [网络编程](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.4 IPC 与消息总线 [I→E] | [IPC](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.5 开发工具链 [B→I] | [工具链](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.6 嵌入式 C/C++ 高级话题 [I→E] | [C++高级](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.7 轻量级容器与隔离 [I→E] | [容器隔离](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.8 性能剖析 [I→E] | [性能剖析](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 7.9 嵌入式应用高可用设计 [I→E] | [高可用](07-应用层开发/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "8. 系统安全与功能安全 <span class="badge-i">I</span><span class="badge-m">M</span> ★ <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 8.0 模块概览与学习路径 [I] | [系统安全](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.1 安全启动链与信任根 [I→E] | [信任根](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.2 可信执行环境 [I→E] | [TEE](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.3 内核加固 & LSM [I→M] | [LSM加固](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.4 加密与密钥管理 [I→E] | [密钥管理](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.5 漏洞生命周期管理 [I→E] | [漏洞管理](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.6 功能安全入门 [I] | [功能安全](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 8.7 功能安全Linux落地实践 [E→M] | [安全落地](08-系统安全与功能安全/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "9. 总线协议 <span class="badge-b">B</span><span class="badge-m">M</span> <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：/</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 9.0 总线协议基础概览 [B] | [总线协议](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.1 片内SoC总线（AMBA AXI/AHB/APB等）[B→I] | [SoC总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.2 基础外设通信总线（I2C/SPI/UART/I3C等）[B→I] | [外设总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.3 存储设备专用总线（eMMC/UFS/NAND ONFI等）[I→E] | [存储总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.4 高速外设扩展总线（PCIe/USB3.x等）[I→E] | [高速总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.5 音视频专用总线（MIPI CSI/DSI/I2S等）[I→E] | [音视频总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.6 车载与网络互联总线（CAN-FD/TSN/车载以太网等）[E→M] | [车载总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.7 工业现场总线（EtherCAT/CANopen/Modbus等）[E→M] | [工业总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 9.8 调试与跟踪专用总线（JTAG/SWD/CoreSight等）[I→E] | [调试总线](09-总线协议/README.md) | <span class="tag tag-wip">建设中</span> | 否 | / |

??? details "10. 专用技术与前沿趋势 <span class="badge-e">E</span><span class="badge-m">M</span> ★ <span class="tag tag-wip">建设中</span> <span class="meta">最后更新：2026年5月6日</span>"
    | 章节 | 快速链接 | 完成情况 | 是否人工复检 | 最后修改日期 |
    |------|---------|---------|------------|------------|
    | 10.0 模块概览与学习路径 [E] | [前沿趋势](10-专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-done">建设完成</span> | 否 | 2026年5月7日 |
    | 10.1 边缘 AI 推理 [E→M] | [边缘AI](10-专用技术与前沿趋势/01-边缘AI推理/README.md) | <span class="tag tag-l3">L3阶段</span> | 是 | 2026年5月4日 |
    | 10.2 异构多核通信 [E→M] | [异构多核](10-专用技术与前沿趋势/02-异构多核通信/README.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月6日 |
    | 10.3 虚拟化混合关键系统 [E→M] | [虚拟化](10-专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 10.4 RISC-V 生态与开放 ISA 实践 [E→M] | [RISC-V](10-专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-wip">建设中</span> | 否 | / |
    | 10.5 Linux 长期演进与技术路线图 [E→M] | [演进路线](10-专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月7日 |
    | 10.6 嵌入式Linux实时化技术 [E→M] | [实时化](10-专用技术与前沿趋势/模块概览与学习路径.md) | <span class="tag tag-l3">L3阶段</span> | 否 | 2026年5月7日 |

---

> **GitHub**: [github.com/xiaohong0925/Embedded_Knowledge_System_V2026](https://github.com/xiaohong0925/Embedded_Knowledge_System_V2026)
