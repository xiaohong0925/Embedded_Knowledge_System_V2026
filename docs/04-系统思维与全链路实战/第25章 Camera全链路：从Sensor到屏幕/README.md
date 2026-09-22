# 第25章：Camera全链路：从Sensor到屏幕

> 所属：第四部 系统思维与全链路实战
>
> 难度：[M] ~ [E] | 核心问题：一帧图像怎么从 Sensor 走到屏幕，慢在哪、坏在哪、怎么修？

## 核心问题

一帧图像从光线进入 Sensor 到显示在屏幕上，中间经过哪些环节？延迟花在哪一段？故障出在哪一层？——本章追踪一帧数据的完整旅程，把 V4L2、DMA-BUF、DRM/KMS 三个子系统的协同从黑盒变成可测量、可排查、可优化的工程对象。

## 本章简介

Camera 链路是嵌入式 Linux 里跨子系统最多的一条数据通路：Sensor、MIPI CSI-2、ISP、内存、显示控制器、面板，涉及 V4L2、Media Controller、DMA-BUF、VB2、DRM/KMS 五套框架的协同。任何一段出问题，表象都是"画面不对"——但修复手段完全不同。

本章的定位是**链路实战层**，与存量内容的分工明确：协议细节（D-PHY/CSI-2/DSI）在 B-C.9.1~9.5，架构选型决策（libcamera vs 直接 V4L2、零拷贝的决策条件）在 22.5，本章回答的是"一帧数据怎么走完、出问题怎么查、慢在哪里怎么抠"。主线工具是三件：media-ctl 拓扑图（地图）、VB2 队列模型（采集机理）、延迟预算表（优化方法论）。全章以智能门铃 300ms→120ms 的延迟优化案收口。

## 子节清单

| 节 | 主题 | 难度 |
|----|------|------|
| [25.1 Pipeline 全景与 Media Controller 实操](25.1_Pipeline全景与Media_Controller实操.md) | 一帧旅程全景、entity/pad/link、media-ctl 读图/建链/配格式/验证 | [E] |
| [25.2 V4L2 采集链路实战](25.2_V4L2采集链路实战.md) | VIDIOC 十一步序列、三种 buffer 模式、VB2 队列模型、帧丢失机理与调试 | [E] |
| [25.3 DMA-BUF 零拷贝实战](25.3_DMA-BUF零拷贝实战.md) | exporter/importer、Camera→Display 五步、dumb/GBM/dma_heap、cache 一致性 | [E] |
| [25.4 DRM/KMS 显示通路实战](25.4_DRM-KMS显示通路实战.md) | plane/crtc/encoder/connector、modetest、atomic commit、Direct Display vs Compositor | [E] |
| [25.5 端到端延迟分解与测量](25.5_端到端延迟分解与测量.md) | 七段分解、分段测量四把尺、光电二极管法、延迟预算表、机器人场景差异 | [E] |
| [25.6 常见故障排查](25.6_常见故障排查.md) | 节点缺席/颜色错/帧率低/抖动大四类检修路径、症状-入口速查表 | [M]~[E] |
| [25.7 综合实战：智能门铃延迟优化](25.7_综合实战_智能门铃延迟优化.md) | 300ms→120ms 五步优化完整复盘，全章方法论的联合作战 | [E] |

## 学习目标

- 能用 media-ctl 读出任意平台的 Camera 拓扑，并完成建链、配格式、抓帧验证
- 能写出 V4L2 mmap 采集程序，并用 VB2 队列模型分析帧丢失的根因
- 能搭建 Camera→Display 的 DMA-BUF 零拷贝通路，处理 stride 对齐与 cache 一致性问题
- 能用 modetest 和 atomic commit 管理显示资源，判断 Compositor 与 Direct Display 的取舍
- 能用分段测量+光电二极管法建立延迟预算表，把总量指标翻译成每段靶子
- 能按"症状→第一条命令"的路径排查 Camera 四类高频故障

## 前置知识

- 第 10 章（中断与时间：帧中断、VB2 done 的底层机制）
- 第 22.5 节（多媒体驱动架构 pipeline 视角：本章的决策层背景）
- B-C.9.1~9.5（MIPI D-PHY/CSI-2/DSI 协议细节，本章多处指向）

## 后续衔接

- 第 26 章（未写）：网络全链路——门铃案例里 Wi-Fi 传输段的展开
- 第 23 章（系统调试方法论）：25.6 故障排查的方法论源头（已写）
- D 扩展驱动开发实战：Sensor 驱动、ISP 驱动的编写视角

---

*本章为第四部第 25 章，共 7 个 .md 文件。建议按顺序阅读。*
