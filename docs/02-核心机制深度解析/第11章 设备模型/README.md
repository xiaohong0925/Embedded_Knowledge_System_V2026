# 第11章：设备模型

> 所属：第 二 部 核心机制深度解析
> 
> BIEM：[I→E] | 核心问题：内核如何抽象和匹配设备？

## 核心问题

内核如何抽象和匹配设备？

## 本章简介

独特设计：从”驱动probe失败”这个最常见的问题出发，深入到设备模型和匹配机制。有经验工程师会写platform_driver，知道设备树compatible字符串要与驱动of_match_table匹配。

但当面对”insmod后probe没有执行”“两个驱动竞争同一个设备”“设备树节点存在但/sys中没有对应设备”“设备树overlay加载后驱动不自动probe”这些实际问题时，需要对设备模型的源码级理解。本章的核心认知是：设备模型不是”驱动的容器”，而是一个完整的匹配和生命周期管理系统。理解总线-设备-驱动三角关系、probe的执行条件、uevent的通知机制，是设计健壮驱动架构的基础。

你写了一个新的sensor驱动，编译为.ko后用insmod加载。模块加载成功了（没有错误打印），但probe函数没有执行——/dev下没有设备节点，sysfs中也没有出现对应设备。你确认compatible字符串与设备树一致。你开始怀疑：insmod成功 = 驱动注册成功，但probe的执行需要满足什么条件？驱动和设备之间的”匹配”到底是怎么发生的？在哪里可以排查匹配失败的原因？...


## 子节清单

- [为什么需要设备模型](11.1.1_为什么需要设备模型.md)
- [总线-设备-驱动三角关系](11.1.2_总线-设备-驱动三角关系.md)
- [match()与probe()的调用链](<11.1.3_match()与probe()的调用链.md>)
- [kobject kset与sysfs映射](11.1.4_kobject_kset与sysfs映射.md)
- [设备树到platform device](11.2.1_设备树到platform_device.md)
- [platform driver注册与匹配](11.2.2_platform_driver注册与匹配.md)
- [probe()函数内部](<11.2.3_probe()函数内部.md>)
- [devm 资源管理](11.2.4_devm_资源管理.md)
- [probe失败的排查](11.2.5_probe失败的排查.md)
- [compatible匹配原理](11.3.1_compatible匹配原理.md)
- [of match table的两种组织](11.3.2_of_match_table的两种组织.md)
- [设备树绑定规范](11.3.3_设备树绑定规范.md)
- [匹配竞争与优先级](11.3.4_匹配竞争与优先级.md)
- [sysfs三视图](11.4.1_sysfs三视图.md)
- [uevent生命周期](11.4.2_uevent生命周期.md)
- [udev规则与实战](11.4.3_udev规则与实战.md)
- [为什么需要overlay](11.5.1_为什么需要overlay.md)
- [dtbo编译与加载](11.5.2_dtbo编译与加载.md)
- [overlay的应用与限制](11.5.3_overlay的应用与限制.md)

## 学习目标

掌握kobject、sysfs、bus/device/driver、platform

## 前置知识

- 第10章

## 后续衔接

第12章文件系统

---

*本章为第 二 部第 11 章，共 19 个 .md 文件。建议按顺序阅读，遇到困难时可先阅读末尾的 "知识图谱与查漏补缺" 小节。*
