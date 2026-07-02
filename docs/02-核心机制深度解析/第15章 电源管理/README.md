# 第15章：电源管理

> 所属：第 二 部 核心机制深度解析
> BIEM：[I→E] | 核心问题：电去哪了？

## 核心问题

电去哪了？

## 本章简介

独特设计：从”系统级功耗分析”视角出发，展示电源管理各子系统的协同工作关系。有经验工程师知道cpufreq可以降低CPU频率来省电、知道echo mem > /sys/power/state可以suspend、知道设备的Runtime PM可以自动休眠。

但面对”suspend-to-RAM后仍然耗电200mA”“Runtime PM的get/put引用计数泄漏导致设备无法唤醒”“不同cpufreq governor的选择依据”“thermal框架如何在温度过高时自动降频”这些实际问题时，需要源码级的理解。

本章的核心认知是：电源管理不是”一个开关”——它是多个子系统（Runtime PM、cpuidle、cpufreq、thermal、EAS）的协同工作。真正有效的功耗优化需要理解这些子系统如何交互、如何形成完整的功耗-性能-温度闭环控制。...


## 子节清单

- [从待机耗电案例引入](15.1.1_从待机耗电案例引入.md)
- [Runtime PM的引用计数模型](15.1.2_Runtime_PM的引用计数模型.md)
- [genpd与power domain](15.1.3_genpd与power_domain.md)
- [cpuidle与C-state](15.2.1_cpuidle与C-state.md)
- [cpufreq与P-state](15.2.2_cpufreq与P-state.md)
- [schedutil深入与CPU调优](15.2.3_schedutil深入与CPU调优.md)
- [cpuidle与cpufreq的协同](15.2.4_cpuidle与cpufreq的协同.md)
- [DVFS功耗模型](15.3.1_DVFS功耗模型.md)
- [EAS能效调度](15.3.2_EAS能效调度.md)
- [Thermal框架架构](15.4.1_Thermal框架架构.md)
- [Thermal Governor与设备树配置](15.4.2_Thermal_Governor与设备树配置.md)
- [Thermal与cpufreq的协同](15.4.3_Thermal与cpufreq的协同.md)
- [suspend-to-RAM与suspend-to-disk](15.5.1_suspend-to-RAM与suspend-to-disk.md)
- [唤醒源与Wakelock](15.5.2_唤醒源与Wakelock.md)
- [五子系统协同与闭环控制](15.6.1_五子系统协同与闭环控制.md)
- [综合实战功耗排查](15.7.1_综合实战功耗排查.md)

## 学习目标

掌握Runtime PM、cpuidle/cpufreq、Thermal、Suspend

## 前置知识

- 第14章

## 后续衔接

第16章内核版本设计

---

*本章为第 二 部第 15 章，共 16 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
