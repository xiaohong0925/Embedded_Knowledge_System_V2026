# 第26章：网络全链路：从PHY到Socket

> 所属：第 四 部 系统思维与全链路实战
> BIEM：[E] | 核心问题：网络全链路：从PHY到Socket

## 核心问题

网络全链路：从PHY到Socket

## 本章简介

核心链路：PHY → MAC → 驱动 → Netfilter → 协议栈 → Socket → 应用
本章追踪一个网络数据包从网线上进入系统到被应用程序读取的完整旅程，以及反向的发送路径。理解这条链路的每个环节是诊断网络性能问题和设计高性能网络应用的基础。

硬件层：

```
RJ45 ──▶ PHY ──▶ MAC (SoC内置或外挂) ──▶ DMA ──▶ DDR
         │        │                         │
         └─ MDIO控制 ─┘               Ring Buffer
内核接收路径（Rx）：
PHY ──▶ MAC ──▶ NAPI poll ──▶ netif_receive_skb ──▶ TC/Netfilter ──▶ IP层 ──▶ TCP/UDP ──▶ Socket ──▶ Userspace
                         │                        │
                    softirq上下文               进程上下文
内核发送路径（Tx）：
Userspace ──▶ Socket ──▶ TCP/UDP ──▶ IP ──▶ TC/Netfilter ──▶ dev_queue_xmit ──▶ NIC Driver ──▶ MAC ──▶ PHY
                                                                 │
                                                            hardirq/softirq
```


## 子节清单

- 网络硬件架构（PHY/MAC/交换机）
- 内核网络路径
- Netfilter与eBPF加速
- Socket层到应用
- 端到端延迟与吞吐量分析

## 学习目标

掌握本章核心知识，能够在实际项目中应用相关技术。

## 前置知识

- 第25章相关内容

## 后续衔接

- 前置：已完成前序章节
- 后续：继续学习后续章节

---

*本章为第 四 部第 26 章，共 5 个 .md 文件。建议按顺序阅读。*
