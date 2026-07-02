# 第10章：中断与时间

> 所属：第 二 部 核心机制深度解析
> BIEM：[I→E] | 核心问题：硬件中断如何变成软件事件？

## 核心问题

硬件中断如何变成软件事件？

## 本章简介

独特设计：从”事件驱动”视角整合中断和时间两个子系统——它们本质上都是CPU的异步事件处理机制。有经验工程师知道中断是”硬件通知CPU的方式”，知道顶半部和底半部的概念，知道timer可以定时触发。

但面对”中断响应偶尔延迟几百微秒”“hrtimer的精度为什么比传统timer高一个数量级”“tickless模式下系统时间还能准确吗”“为什么高精度定时器会触发CPU从idle唤醒”这些实际问题时，需要源码级的理解。本章要解决的核心认知是：中断和时间不是两个独立的子系统——定时器到期本身就是中断的一种。

理解它们在源码级的耦合关系（tick device layer连接两者），是优化嵌入式系统响应性和功耗的关键。你的设备有一个传感器需要每100us读取一次数据。你最初用setitimer(ITIMER_REAL, ...)实现，但发现实际精度只有~4ms（在100Hz tick的系统上）。你换成timer_create(CLOCK_MONOTONIC, ...)后改善到~1ms，但仍然不够。

你听说hrtimer可以达到微秒级精度，但不确定代价是什么。同时你发现，当CPU进入idle后，定时器精度反而变差了——为什么？怎么解决？...


## 子节清单

- [从GPIO延迟案例引入](10.1.1_从GPIO延迟案例引入.md)
- [ARM64异常与GICv2](10.1.2_ARM64异常与GICv2.md)
- [SPI PPI SGI三种中断](10.1.3_SPI_PPI_SGI三种中断.md)
- [GICv3与中断号映射](10.1.4_GICv3与中断号映射.md)
- [irq domain详解与级联中断](10.1.5_irq_domain详解与级联中断.md)
- [顶半部的约束与设计哲学](10.2.1_顶半部的约束与设计哲学.md)
- [中断入口的完整路径](10.2.2_中断入口的完整路径.md)
- [顶半部执行过长的后果与irqsoff tracer](10.2.3_顶半部执行过长的后果与irqsoff_tracer.md)
- [为什么需要底半部](10.3.1_为什么需要底半部.md)
- [softirq详解](10.3.2_softirq详解.md)
- [tasklet详解](10.3.3_tasklet详解.md)
- [workqueue详解](10.3.4_workqueue详解.md)
- [NAPI中断与轮询的混合模式](10.3.5_NAPI中断与轮询的混合模式.md)
- [底半部选择决策树](10.3.6_底半部选择决策树.md)
- [底半部常见错误与陷阱](10.3.7_底半部常见错误与陷阱.md)
- [为什么需要线程化中断](10.4.1_为什么需要线程化中断.md)
- [request threaded irq机制](10.4.2_request_threaded_irq机制.md)
- [线程化中断的优势代价与PREEMPT RT](10.4.3_线程化中断的优势代价与PREEMPT_RT.md)
- [传统定时器精度问题](10.5.1_传统定时器精度问题.md)
- [时间子系统分层架构](10.5.2_时间子系统分层架构.md)
- [timer wheel级联实现](10.5.3_timer_wheel级联实现.md)
- [hrtimer的实现](10.5.4_hrtimer的实现.md)
- [hrtimer精度问题与CPU idle](10.5.5_hrtimer精度问题与CPU_idle.md)
- [alarm timer与posix timer](10.5.6_alarm_timer与posix_timer.md)
- [periodic tick的问题](10.6.1_periodic_tick的问题.md)
- [NO HZ IDLE模式](10.6.2_NO_HZ_IDLE模式.md)
- [NO HZ FULL与cpuidle协同](10.6.3_NO_HZ_FULL与cpuidle协同.md)
- [tickless副作用与调试](10.6.4_tickless副作用与调试.md)
- [综合实战从GPIO延迟到音频爆音](10.7.1_综合实战从GPIO延迟到音频爆音.md)

## 学习目标

掌握GIC、顶半部/底半部、hrtimer、tickless

## 前置知识

- 第9章

## 后续衔接

第11章设备模型

---

*本章为第 二 部第 10 章，共 29 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
