# 第7章：启动链深度解析

> 所属：第 二 部 核心机制深度解析
> 
> BIEM：[I→E] | 核心问题：从复位到shell到底发生了什么？

## 核心问题

从复位到shell到底发生了什么？

## 本章简介

独特设计：逐行分析启动日志，对应到每个子系统的初始化。读者可以拿着自己板子的启动日志，跟着本章逐行理解。<br>有经验工程师能移植U-Boot、能编译内核、能让系统跑起来, 但面对启动日志中某一行的失败，常常束手无策。为什么？因为他们对启动链的每个阶段只有模糊的”大概在这时候初始化”的认知，缺乏精确的源码级对应关系。本章的价值在于建立“启动日志 ↔ 源码路径 ↔ 子系统初始化”的三重映射。

当你看到”Waiting for root device”卡住时，能立刻定位到是块设备子系统还没初始化完；当你看到”VFS: Cannot open root device”时，能判断出是设备名错误还是驱动未加载。这种能力是后续所有系统级调试的基础, 启动链是整个系统初始化的缩影，理解了启动链，就理解了内核初始化的全局图景。你拿到一块新的开发板，上电后启动日志在某个位置停住了。

可能是”Starting kernel …“之后黑屏，可能是”Waiting for root device”之后卡住，也可能是systemd启动服务时超时。

你会用串口看日志，但日志中的每一行, Booting Linux on physical CPU 0x0、Machine model: xxx、pid_max: default: 32768, 你知道内核在这时候具体在做什么吗？为什么是这个顺序？如果某一行失败了，该去哪个源码文件找原因？...


## 子节清单

- [复位向量表与BootROM存储](7.1.1_复位向量表与BootROM存储.md)
- [启动介质检测顺序](7.1.2_启动介质检测顺序.md)
- [BootROM加载SPL的协议](7.1.3_BootROM加载SPL的协议.md)
- [SPL的存在理由与内存约束](7.2.1_SPL的存在理由与内存约束.md)
- [SPL的内存布局与board init f r](7.2.2_SPL的内存布局与board_init_f_r.md)
- [Falcon Mode SPL直达内核的快速启动路径](7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md)
- [start汇编入口与重定位](7.3.1_start汇编入口与重定位.md)
- [DM框架 U-Boot的设备模型](7.3.2_DM框架_U-Boot的设备模型.md)
- [bootcmd执行流程与autoboot](7.3.3_bootcmd执行流程与autoboot.md)
- [U-Boot如何修改设备树](7.4.1_U-Boot如何修改设备树.md)
- [内核如何解析设备树 unflatten过程](7.4.2_内核如何解析设备树_unflatten过程.md)
- [U-Boot与内核的双边协作机制](7.4.3_U-Boot与内核的双边协作机制.md)
- [head.S 内核的汇编入口与MMU开启](7.5.1_head.S_内核的汇编入口与MMU开启.md)
- [start kernel：C语言世界的入口](7.5.2_start_kernel：C语言世界的入口.md)
- [initcalls 八级初始化机制](7.5.3_initcalls_八级初始化机制.md)
- [rest init与kernel init 1号进程的诞生](7.5.4_rest_init与kernel_init_1号进程的诞生.md)
- [kernel init线程的执行路径](7.6.1_kernel_init线程的执行路径.md)
- [根文件系统的挂载过程](7.6.2_根文件系统的挂载过程.md)
- [从init到systemd 初始化系统的演进](7.6.3_从init到systemd_初始化系统的演进.md)

## 学习目标

理解BootROM→SPL→U-Boot→Kernel→init的完整链路

## 前置知识

- 第1-6章

## 后续衔接

第8章进程调度

---

*本章为第 二 部第 7 章，共 19 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
