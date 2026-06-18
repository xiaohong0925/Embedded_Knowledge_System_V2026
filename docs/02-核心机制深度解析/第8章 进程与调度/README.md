# 第8章：进程与调度

> 所属：第 II 部 内核核心机制
> BIEM：[I→E] | 核心问题：Linux 如何管理进程？CFS 调度器如何工作？

## 核心问题

Linux 如何管理进程？CFS 调度器如何工作？

本章通过 18 个深度子节，从源码层面拆解内核的关键实现路径，帮助你建立"能读源码、能调问题、能做优化"的内核级技术能力。

## 子节清单

- [task_struct数据结构全景](8.1.1_task_struct数据结构全景.md)
- [进程状态与生命周期](8.1.2_进程状态与生命周期.md)
- [内核线程_kthread机制](8.1.3_内核线程_kthread机制.md)
- [fork系统调用与copy_process](8.2.1_fork系统调用与copy_process.md)
- [COW深度解析与页表机制](8.2.2_COW深度解析与页表机制.md)
- [vfork与clone系统调用](8.2.3_vfork与clone系统调用.md)
- [CFS调度器的设计哲学与核心数据结构](8.3.1_CFS调度器的设计哲学与核心数据结构.md)
- [vruntime计算与红黑树操作](8.3.2_vruntime计算与红黑树操作.md)
- [调度延迟与负载均衡](8.3.3_调度延迟与负载均衡.md)
- [实时调度器_SCHED_FIFO与SCHED_RR](8.4.1_实时调度器_SCHED_FIFO与SCHED_RR.md)
- [优先级继承与优先级反转](8.4.2_优先级继承与优先级反转.md)
- [cgroups_v2架构与资源控制哲学](8.5.1_cgroups_v2架构与资源控制哲学.md)
- [CPU_Memory_IO控制器深度解析](8.5.2_CPU_Memory_IO控制器深度解析.md)
- [systemd与cgroups_v2的集成](8.5.3_systemd与cgroups_v2的集成.md)
- [EAS架构_Energy_Aware_Scheduling](8.6.1_EAS架构_Energy_Aware_Scheduling.md)
- [Energy_Model与调度器协同机制](8.6.2_Energy_Model与调度器协同机制.md)
- [EAS调优实践与第8章收尾](8.6.3_EAS调优实践与第8章收尾.md)
- [第8章_知识图谱与查漏补缺](8.99_第8章_知识图谱与查漏补缺.md)

## 学习目标

理解 task_struct 与进程生命周期；掌握 fork、CFS 调度器、实时调度、cgroups v2 和 EAS 能效调度；能分析调度延迟和负载均衡问题。

## 前置知识

- 第7章启动链：理解内核启动流程、initcalls 和 1 号进程的诞生
- 基本的 C 语言结构体和指针知识
- 对操作系统进程概念有初步了解

## 后续衔接

第9章（内存管理）将在进程地址空间的基础上，深入理解虚拟内存、页表、物理内存分配和 slab 缓存机制。

---

*本章为第 II 部第 8 章，共 18 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
