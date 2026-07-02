# 第25章：Camera全链路：从Sensor到屏幕

> 所属：第 四 部 系统思维与全链路实战
> BIEM：[E] | 核心问题：Camera全链路：从Sensor到屏幕

## 核心问题

Camera全链路：从Sensor到屏幕

## 本章简介

核心链路：Sensor → MIPI CSI → V4L2 → Buffer → DRM → Display
本章追踪一帧图像数据从光线进入Sensor到最终显示在屏幕上的完整旅程。这不是一个子系统的问题，而是V4L2、DMA-BUF、DRM/KMS、内存管理、电源管理五个子系统的协同。


## 子节清单

- Camera Pipeline架构
- V4L2子系统深度
- Buffer管理（DMA-BUF/ION）
- DRM/KMS显示通路
- 端到端延迟分析

## 学习目标

掌握本章核心知识，能够在实际项目中应用相关技术。

## 前置知识

- 第24章相关内容

## 后续衔接

- 前置：已完成前序章节
- 后续：继续学习后续章节

---

*本章为第 四 部第 25 章，共 5 个 .md 文件。建议按顺序阅读。*
