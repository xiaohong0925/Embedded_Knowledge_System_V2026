# 嵌入式 Linux 知识体系 V2026

> 嵌入式 Linux 全栈知识库 —— 从硬件到应用，从入门到精通

---

## 体系概览

本知识系统覆盖嵌入式 Linux 开发全链路，按 **B→I→E→M** 四级递进编排。

<details open>
<summary><strong>1. 硬件层 [B→E]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| CPU架构 (ARMv7/v8, RISC-V) [B] | 建设中 | 否 | / |
| 总线协议 (I2C/SPI/UART, PCIe/CAN/USB) [B] | 建设中 | 否 | / |
| 内存系统与硬件实现 [I→E] | 建设中 | 否 | / |
| 存储设备 (NOR/NAND, eMMC/UFS, SD卡) [B] | 建设中 | 否 | / |
| 时钟与电源管理 (PMIC, DVFS硬件支持) [I] | 建设中 | 否 | / |
| 硬件加速器 (GPU, NPU, Crypto引擎) [I] | 建设中 | 否 | / |
| 硬件调试与安全 (CoreSight, JTAG, TrustZone) [E/M] | 建设中 | 否 | / |
| 传感器与执行器接口 [B] | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>2. Bootloader与启动 [B→E]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| U-Boot移植与定制 [I] | 建设中 | 否 | / |
| 安全启动 (Secure Boot, Measured Boot) [E] | 建设中 | 否 | / |
| 多阶段启动流程 (BL1/BL2, ATF, OP-TEE) [E] | 建设中 | 否 | / |
| 快速启动优化 (XIP, 并行初始化, 启动时间<2s) [M] | 建设中 | 否 | / |
| 网络引导方案 [I] | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>3. Linux内核与驱动 [I→M]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| Linux内核与系统简介 [B→I] | 建设中 | 否 | / |
| 进程管理 (调度策略, cgroups, rt-scheduling) [I] | 建设中 | 否 | / |
| 内存管理 (CMA/ION, 页分配, Memory Cgroup v2) [E] | 建设中 | 否 | / |
| 虚拟文件系统 (overlayfs, UBIFS调优) [I] | 建设中 | 否 | / |
| 文件管理的一些接口 | 建设中 | 否 | / |
| 设备树 (DTS) 原理与编写 [I] | 建设中 | 否 | / |
| 驱动模型 (Platform Driver, DT绑定) [I] | 建设中 | 否 | 2026-04-24 |
| 中断子系统 [I] | 建设中 | 否 | / |
| 时间子系统 [I] | 建设中 | 否 | / |
| 电源管理框架 (Runtime PM, Suspend/Resume) [E] | 建设中 | 否 | / |
| 网络子系统 (SKB, Netfilter, TSN支持) [I] | 建设中 | 否 | / |
| 内核安全机制 (SELinux, IMA, seccomp-bpf) [E] | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>4. 系统构建与部署 [I→E]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| 交叉编译工具链 [B] | 建设中 | 否 | / |
| 内核裁剪与移植 [I] | 建设中 | 否 | / |
| 系统构建框架 (Yocto/Buildroot, 选型决策树) [I] | 建设中 | 否 | / |
| 固件更新 (OTA, A/B分区, 差分更新) [I] | 建设中 | 否 | / |
| 根文件系统与系统初始化 (initramfs, systemd) [I] | 建设中 | 否 | / |
| 软件包管理 (opkg/apt, ipk/rpm, SBOM 生成) | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>5. 驱动开发 [B→M]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| 设备驱动框架 (字符/块/网络) [B] | 建设中 | 否 | / |
| 用户态-内核态交互 (ioctl, sysfs, mmap) [I] | 建设中 | 否 | / |
| 中断处理 (顶/底半部)、DMA编程 [I] | 建设中 | 否 | / |
| 并发与竞态 (自旋锁, 中断上下文限制) [E] | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>6. 内核调试与性能优化 [I→M]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| 内核崩溃分析 (Oops, panic, crash工具) [I] | 建设中 | 否 | / |
| 动态追踪 (ftrace, perf, eBPF) [E] | 建设中 | 否 | / |
| 稳定性测试 (KASAN, KMEMLEAK, stress-ng) [I] | 建设中 | 否 | / |
| 实时性优化 (PREEMPT_RT, 中断线程化) [E] | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>7. 应用层开发 [B→E]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| 多线程编程 (pthread, 同步原语) [B] | 建设中 | 否 | / |
| 网络编程 (TCP/IP, Socket, CoAP/MQTT) [I] | 建设中 | 否 | / |
| 进程间通信 (IPC, D-Bus) [I] | 建设中 | 否 | / |
| 开发工具链 (Makefile/CMake, Git, 交叉编译) [B] | 建设中 | 否 | / |
| 轻量级容器化技术 [I/E] | 建设中 | 否 | / |
| 低功耗与可靠性设计 (看门狗, 心跳) [I] | 建设中 | 否 | / |
| 性能分析与优化 (Valgrind, strace, perf火焰图, 编译器优化) | 建设中 | 否 | / |
| 系统服务化 (systemd/守护进程) | 建设中 | 否 | / |

</details>

<details open>
<summary><strong>8. 总线协议 [B→M]</strong></summary>

| 子项 | AI完成情况 | 是否人工复检 | 最后修改日期 |
|------|-----------|------------|------------|
| 片内SoC总线 (AMBA/AXI/AHB/APB/TileLink/Wishbone) [B→I] | 建设中 | 否 | 2026-05-03 |
| 基础外设通信总线 (I2C/SPI/UART/1-Wire/MDIO/MIPI-I3C) [B→I] | 建设中 | 否 | 2026-05-03 |
| 高速外设扩展总线 (SD/SATA/PCIe/USB) [I→E] | 建设中 | 否 | 2026-05-03 |
| 存储设备专用总线 (eMMC/UFS/QPI/OPI) [I→E] | 建设中 | 否 | 2026-05-03 |
| 车载与网络互联总线 (CAN/LIN/TSN/车载以太网) [I→E] | 建设中 | 否 | 2026-05-03 |
| 工业现场总线 (Modbus/PROFIBUS/EtherCAT) [I→E] | 建设中 | 否 | 2026-05-03 |
| 音视频专用总线 (I2S/PCM/MIPI Alliance) [I→E] | 建设中 | 否 | 2026-05-03 |
| 调试与跟踪专用总线 (CoreSight/JTAG/SWD) [I→M] | 建设中 | 否 | 2026-05-03 |

</details>

---

## 阅读指南

<span class="red">**BIEM分级**</span><br>
* <span class="badge-b">**B**</span> — 建立直觉，看懂系统在干什么<br>
* <span class="badge-i">**I**</span> — 理解实现机制，能跟读代码<br>
* <span class="badge-e">**E**</span> — 掌握设计权衡，能修改系统行为<br>
* <span class="badge-m">**M**</span> — 洞察底层数学与物理约束，能设计新架构<br>

<span class="red">**认知流**</span><br>
每一章遵循 **看见 → 理解 → 验证 → 运用 → 看透** 的五步认知闭环。<br>

<span class="red">**颜色标记**</span><br>
* <span class="red">红色</span> — 核心概念，必须记住<br>
* <span class="green">绿色</span> — 技术术语，精确理解<br>
* <span class="blue">蓝色</span> — 关键结论，直接影响决策<br>
* <span class="orange">橙色</span> — 列表标题，结构化索引<br>

---

## 快速导航

* [1. 硬件层](01-硬件层/README.md)
* [2. Bootloader与启动](02-Bootloader与启动/README.md)
* [3. Linux内核与驱动](03-Linux内核与驱动/README.md)
* [4. 系统构建与部署](04-系统构建与部署/README.md)
* [5. 驱动开发](05-驱动开发/README.md)
* [6. 内核调试与性能优化](06-内核调试/README.md)
* [7. 应用层开发](07-应用层开发/README.md)
* [8. 总线协议](08-总线协议/README.md)

---

> **GitHub**: [github.com/xiaohong0925/Embedded_Knowledge_System_V2026](https://github.com/xiaohong0925/Embedded_Knowledge_System_V2026)
