# 第15章：电源管理

> 所属：第 II 部 内核核心机制
> BIEM：[E] | 核心问题：Runtime PM、DVFS、休眠唤醒的源码级实现？

## 核心问题

Runtime PM、DVFS、休眠唤醒的源码级实现？

本章通过 17 个深度子节，从源码层面拆解内核的关键实现路径，帮助你建立"能读源码、能调问题、能做优化"的内核级技术能力。

## 子节清单

- [从待机耗电案例引入](15.1.1_从待机耗电案例引入.md)
- [Runtime_PM的引用计数模型](15.1.2_Runtime_PM的引用计数模型.md)
- [genpd与power_domain](15.1.3_genpd与power_domain.md)
- [cpuidle与C-state](15.2.1_cpuidle与C-state.md)
- [cpufreq与P-state](15.2.2_cpufreq与P-state.md)
- [schedutil深入与CPU调优](15.2.3_schedutil深入与CPU调优.md)
- [cpuidle与cpufreq的协同](15.2.4_cpuidle与cpufreq的协同.md)
- [DVFS功耗模型](15.3.1_DVFS功耗模型.md)
- [EAS能效调度](15.3.2_EAS能效调度.md)
- [Thermal框架架构](15.4.1_Thermal框架架构.md)
- [Thermal_Governor与设备树配置](15.4.2_Thermal_Governor与设备树配置.md)
- [Thermal与cpufreq的协同](15.4.3_Thermal与cpufreq的协同.md)
- [suspend-to-RAM与suspend-to-disk](15.5.1_suspend-to-RAM与suspend-to-disk.md)
- [唤醒源与Wakelock](15.5.2_唤醒源与Wakelock.md)
- [五子系统协同与闭环控制](15.6.1_五子系统协同与闭环控制.md)
- [综合实战功耗排查](15.7.1_综合实战功耗排查.md)
- [知识图谱与查漏补缺](15.99_知识图谱与查漏补缺.md)

## 学习目标

理解 Runtime PM、cpuidle、cpufreq、DVFS、Thermal 框架和休眠唤醒机制；能设计系统级电源管理方案，进行功耗排查和优化。

## 前置知识

- 第14章网络子系统：理解 NAPI 和设备功耗状态
- 第8章进程与调度：理解 EAS 和 CPU 频率
- 对嵌入式设备功耗约束和电池管理有基本认识

## 后续衔接

第 III 部（设备驱动与总线）将运用第 II 部理解的所有内核机制，动手编写字符设备、块设备、platform、I2C、SPI、USB、PCIe 等真实驱动。

---

*本章为第 II 部第 15 章，共 17 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
