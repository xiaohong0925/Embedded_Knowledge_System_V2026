# 第7章：启动链深度解析

> 所属：第 II 部 内核核心机制
> BIEM：[I→E] | 核心问题：BootROM→U-Boot→Linux 的完整启动链源码级分析

## 核心问题

BootROM→U-Boot→Linux 的完整启动链源码级分析

本章通过 20 个深度子节，从源码层面拆解内核的关键实现路径，帮助你建立"能读源码、能调问题、能做优化"的内核级技术能力。

## 子节清单

- [复位向量表与BootROM存储](7.1.1_复位向量表与BootROM存储.md)
- [启动介质检测顺序](7.1.2_启动介质检测顺序.md)
- [BootROM加载SPL的协议](7.1.3_BootROM加载SPL的协议.md)
- [SPL的存在理由与内存约束](7.2.1_SPL的存在理由与内存约束.md)
- [SPL的内存布局与board_init_f_r](7.2.2_SPL的内存布局与board_init_f_r.md)
- [Falcon_Mode_SPL直达内核的快速启动路径](7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md)
- [start汇编入口与重定位](7.3.1_start汇编入口与重定位.md)
- [DM框架_U-Boot的设备模型](7.3.2_DM框架_U-Boot的设备模型.md)
- [bootcmd执行流程与autoboot](7.3.3_bootcmd执行流程与autoboot.md)
- [U-Boot如何修改设备树](7.4.1_U-Boot如何修改设备树.md)
- [内核如何解析设备树_unflatten过程](7.4.2_内核如何解析设备树_unflatten过程.md)
- [U-Boot与内核的双边协作机制](7.4.3_U-Boot与内核的双边协作机制.md)
- [head.S_内核的汇编入口与MMU开启](7.5.1_head.S_内核的汇编入口与MMU开启.md)
- [start_kernel：C语言世界的入口](7.5.2_start_kernel：C语言世界的入口.md)
- [initcalls_八级初始化机制](7.5.3_initcalls_八级初始化机制.md)
- [rest_init与kernel_init_1号进程的诞生](7.5.4_rest_init与kernel_init_1号进程的诞生.md)
- [kernel_init线程的执行路径](7.6.1_kernel_init线程的执行路径.md)
- [根文件系统的挂载过程](7.6.2_根文件系统的挂载过程.md)
- [从init到systemd_初始化系统的演进](7.6.3_从init到systemd_初始化系统的演进.md)
- [第7章_知识图谱与查漏补缺](7.99_第7章_知识图谱与查漏补缺.md)

## 学习目标

理解从 BootROM 到用户空间 init 的完整启动链路；掌握 U-Boot 的 SPL 机制、设备树修改、内核解压与初始化；能独立排查启动失败和启动优化问题。

## 前置知识

- 第 I 部第3章 Bootloader：已了解 U-Boot 基本编译、配置和启动流程
- 第 I 部第4章内核配置与编译：已能编译并启动自定义内核
- 第 I 部第5章根文件系统：理解 init 进程和根文件系统挂载

## 后续衔接

第8章（进程与调度）将从 `rest_init` 和 `kernel_init` 出发，深入理解 Linux 如何管理进程、线程和调度器。

---

*本章为第 II 部第 7 章，共 20 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
