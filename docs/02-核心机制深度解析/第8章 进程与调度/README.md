# 第8章：进程与调度

> 所属：第 二 部 核心机制深度解析
> BIEM：[I→E] | 核心问题：内核如何管理任务与分配CPU？

## 核心问题

内核如何管理任务与分配CPU？

## 本章简介

独特设计：从”为什么我的实时任务被延迟了？“这个实际问题开始，深入到调度器源码。有经验工程师知道ps怎么看进程、top怎么看CPU占用、知道nice可以调整优先级。但当面对”为什么我的SCHED_FIFO任务偶尔延迟2ms？““为什么系统负载不高但响应很慢？”“cgroup限制了CPU为什么效果不明显？”这些问题时，缺乏源码级的调度器理解就会束手无策。

本章要解决的核心矛盾是：调度器的”公平”是数学意义上的公平（vruntime相等），而非工程意义上的公平（每个任务都按时完成）。理解这个区别，是做出正确调度决策的前提。此外，现代ARM SoC的big.LITTLE架构使EAS能效调度成为标配，cgroups v2使资源控制成为容器化嵌入式系统的必备知识——这些[E]级内容将帮助工程师在多核异构环境下做出正确的调度设计。...


## 子节清单

- [task struct数据结构全景](8.1.1_task_struct数据结构全景.md)
- [进程状态与生命周期](8.1.2_进程状态与生命周期.md)
- [内核线程 kthread机制](8.1.3_内核线程_kthread机制.md)
- [fork系统调用与copy process](8.2.1_fork系统调用与copy_process.md)
- [COW深度解析与页表机制](8.2.2_COW深度解析与页表机制.md)
- [vfork与clone系统调用](8.2.3_vfork与clone系统调用.md)
- [CFS调度器的设计哲学与核心数据结构](8.3.1_CFS调度器的设计哲学与核心数据结构.md)
- [vruntime计算与红黑树操作](8.3.2_vruntime计算与红黑树操作.md)
- [调度延迟与负载均衡](8.3.3_调度延迟与负载均衡.md)
- [实时调度器 SCHED FIFO与SCHED RR](8.4.1_实时调度器_SCHED_FIFO与SCHED_RR.md)
- [优先级继承与优先级反转](8.4.2_优先级继承与优先级反转.md)
- [cgroups v2架构与资源控制哲学](8.5.1_cgroups_v2架构与资源控制哲学.md)
- [CPU Memory IO控制器深度解析](8.5.2_CPU_Memory_IO控制器深度解析.md)
- [systemd与cgroups v2的集成](8.5.3_systemd与cgroups_v2的集成.md)
- [EAS架构 Energy Aware Scheduling](8.6.1_EAS架构_Energy_Aware_Scheduling.md)
- [Energy Model与调度器协同机制](8.6.2_Energy_Model与调度器协同机制.md)
- [EAS调优实践与第8章收尾](8.6.3_EAS调优实践与第8章收尾.md)

## 学习目标

掌握task_struct、CFS、RT调度、cgroups与EAS

## 前置知识

- 第7章

## 后续衔接

第9章内存管理

---

*本章为第 二 部第 8 章，共 17 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
