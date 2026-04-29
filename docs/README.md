# 嵌入式 Linux 知识体系（V2025）

> **一本给 BSP / 内核驱动工程师的嵌入式 Linux 全景教材**  
> 风格参考《深入 Linux 内核架构》——代码带读、概念从 0 推导、事无巨细。

[![BIEM](https://img.shields.io/badge/深度-BIEM分级-blue)](./docs/biem-guide.md)
[![License](https://img.shields.io/badge/License-CC--BY--SA%204.0-green)](./LICENSE)

---

## 本书定位

本书覆盖嵌入式 Linux 全栈知识，从硬件层到应用层，从系统启动到内核机制，从设备驱动到安全加固。核心读者为：

- **BSP / 内核驱动工程师**（主力读者）
- **想深入理解 Linux 内核的嵌入式开发者**


全书采用 **BIEM 深度分级**，不同水平的读者可以找到对应的切入路径。

---

## 知识体系地图

<table class="knowledge-map">
  <thead>
    <tr>
      <th style="width:11%">章节</th>
      <th style="width:26%">知识点</th>
      <th style="width:10%">快速链接</th>
      <th style="width:8%;text-align:center">状态</th>
      <th style="width:9%;text-align:center">完成阶段</th>
      <th style="width:10%;text-align:center">最后日期</th>
      <th style="width:7%;text-align:center">开源</th>
      <th style="width:7%;text-align:center">BIEM</th>
      <th style="width:12%">备注</th>
    </tr>
  </thead>
  <tbody>
    <tr class="odd">
      <td class="chapter-cell" rowspan="8">1. 硬件层<br><span class="chapter-level">[B→E]</span></td>
      <td>01-CPU架构选型与嵌入式适配</td>
      <td style="text-align:center"><span class="quick-link">CPU架构</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2025-11-20</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>02-片上总线与外设接口</td>
      <td style="text-align:center"><span class="quick-link">总线协议</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l2">L2阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2025-09-19</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>03-存储介质选型与可靠性设计</td>
      <td style="text-align:center"><span class="quick-link">内存</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l2">L2阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2025-11-17</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I→E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>04-电源管理与硬件调优</td>
      <td style="text-align:center"><span class="quick-link">存储设备</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l2">L2阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2025-11-13</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>05-硬件加速器集成</td>
      <td style="text-align:center"><span class="quick-link">时钟&电源管理</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>06-调试与安全模块</td>
      <td style="text-align:center"><span class="quick-link">硬件加速器</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>07-传感器与工业执行器接口</td>
      <td style="text-align:center"><span class="quick-link">硬件调试与安全</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E/M</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>08-（预留）</td>
      <td style="text-align:center"><span class="quick-link">传感器与执行器接口</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td class="chapter-cell" rowspan="5">2. Bootloader与系统启动<br><span class="chapter-level">[B→E]</span></td>
      <td>01-U-Boot移植与板级初始化</td>
      <td style="text-align:center"><span class="quick-link">Bootloader</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l1">L1阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-18</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>02-安全启动信任链</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>03-启动加速与故障排查</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>04-网络引导与远程部署</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>05-固件冗余与回滚策略</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td class="chapter-cell" rowspan="12">3. Linux内核深度解析<br><span class="chapter-level">[I→M]</span></td>
      <td>00-内核架构与系统全景</td>
      <td style="text-align:center"><span class="quick-link">Linux简介</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-19</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">B→I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>01-进程调度：CFS、实时性与资源隔离</td>
      <td style="text-align:center"><span class="quick-link">进程管理</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-03-09</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>02-内存管理：分配、回收与DMA一致性</td>
      <td style="text-align:center"><span class="quick-link">内存管理</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-03-16</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>03-虚拟文件系统与存储栈</td>
      <td style="text-align:center"><span class="quick-link">虚拟文件系统</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-03-20</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>04-设备树与硬件抽象</td>
      <td style="text-align:center"><span class="quick-link">文件管理</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-06-30</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>05-驱动模型与设备热插拔</td>
      <td style="text-align:center"><span class="quick-link">设备树</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-03-26</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>06-中断机制：从硬件信号到内核响应</td>
      <td style="text-align:center"><span class="quick-link">驱动模型</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2026-04-24</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>07-时间子系统：时钟源、定时器与实时性</td>
      <td style="text-align:center"><span class="quick-link">中断子系统</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-07</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>08-电源管理与能效优化</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>09-网络子系统：协议栈、卸载与TSN</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>10-内核安全加固</td>
      <td style="text-align:center"><span class="quick-link">网络子系统</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-18</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>11-（预留）</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td class="chapter-cell" rowspan="6">4. 系统构建与部署<br><span class="chapter-level">[I→E]</span></td>
      <td>01-交叉编译与工具链构建</td>
      <td style="text-align:center"><span class="quick-link">交叉编译与部署</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-20</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>02-内核裁剪与移植</td>
      <td style="text-align:center"><span class="quick-link">内核裁剪与调优</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-22</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>03-构建系统选型与决策</td>
      <td style="text-align:center"><span class="quick-link">系统构建框架</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2025-11-07</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>04-根文件系统与系统初始化</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>05-软件包管理与供应链</td>
      <td style="text-align:center"><span class="quick-link">rootfs与系统初始化</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-01-30</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>06-OTA更新与差分升级</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td class="chapter-cell" rowspan="8">5. 设备驱动开发<br><span class="chapter-level">[B→M]</span></td>
      <td>01-驱动框架与设备模型</td>
      <td style="text-align:center"><span class="quick-link">设备驱动框架</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-14</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>02-用户-内核接口设计</td>
      <td style="text-align:center"><span class="quick-link">用户-内核接口</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-17</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>03-并发与竞态控制</td>
      <td style="text-align:center"><span class="quick-link">中断&DMA</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-18</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>04-中断驱动开发</td>
      <td style="text-align:center"><span class="quick-link">并发&竞态</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-19</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>05-DMA引擎与高速外设</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>06-标准外设驱动实战</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>07-工业总线驱动与协议栈</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>08-多媒体驱动pipeline</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td class="chapter-cell" rowspan="5">6. 内核调试与性能优化<br><span class="chapter-level">[I→M]</span></td>
      <td>01-崩溃分析与现场恢复</td>
      <td style="text-align:center"><span class="quick-link">内核崩溃分析</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-21</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>02-动态追踪与事件采集</td>
      <td style="text-align:center"><span class="quick-link">动态追踪</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-22</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>03-内存调试与泄漏检测</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>04-实时性调优：延迟分析与工业案例</td>
      <td style="text-align:center"><span class="quick-link">实时性优化</span></td>
      <td style="text-align:center"><span class="status-badge status-building">建设中</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l3">L3阶段</span></td>
      <td style="text-align:center"><span class="date-tag">2026-02-21</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>05-启动时间与功耗剖析</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td class="chapter-cell" rowspan="10">7. 应用层开发<br><span class="chapter-level">[B→E]</span></td>
      <td>01-多线程与同步机制</td>
      <td style="text-align:center"><span class="quick-link">多线程编程</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>02-网络编程与物联网协议</td>
      <td style="text-align:center"><span class="quick-link">网络编程</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>03-进程间通信与消息总线</td>
      <td style="text-align:center"><span class="quick-link">进程间通信</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>04-开发工具链与CI/CD</td>
      <td style="text-align:center"><span class="quick-link">开发工具链</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>05-嵌入式C/C++高级话题</td>
      <td style="text-align:center"><span class="quick-link">轻量级容器与隔离技术</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I/E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>06-轻量级容器与隔离</td>
      <td style="text-align:center"><span class="quick-link">低功耗与可靠性设计</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>07-性能剖析与火焰图</td>
      <td style="text-align:center"><span class="quick-link">性能分析</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>08-低功耗与可靠性设计</td>
      <td style="text-align:center"><span class="quick-link">系统服务化</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>09-系统服务化与守护进程</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-shelved">搁置</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>10-机器人专用应用框架</td>
      <td style="text-align:center"><span class="quick-link">机器人专题</span></td>
      <td style="text-align:center"><span class="status-badge status-done">建设完成</span></td>
      <td style="text-align:center"><span class="phase-tag phase-l5">L5完成</span></td>
      <td style="text-align:center"><span class="date-tag">2025-11-21</span></td>
      <td style="text-align:center"><span class="os-tag os-yes">是</span></td>
      <td style="text-align:center"><span class="biem-tag">I→E</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td class="chapter-cell" rowspan="6">8. 系统安全与功能安全<br><span class="chapter-level">[I→M ★]</span></td>
      <td>01-安全启动链与信任根</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>02-可信执行环境与资源隔离</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>03-内核加固与访问控制</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>04-加密与密钥管理</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>05-漏洞生命周期与供应链安全</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>06-功能安全与失效分析</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">M</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td class="chapter-cell" rowspan="8">9. Linux文件系统与文件管理<br><span class="chapter-level">[B→E ★]</span></td>
      <td>01-Shell命令与文件操作速查</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>02-系统调用与fd生命周期</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B→E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>03-VFS架构与四大对象</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>04-页缓存与回写策略</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>05-mmap与零拷贝机制</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>06-嵌入式文件系统选型与调优</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>07-断电安全与只读rootfs</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I→E</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>08-一切皆文件机制实例</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">I</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td class="chapter-cell" rowspan="6">10. 专用技术与前沿趋势<br><span class="chapter-level">[E→M ★]</span></td>
      <td>01-边缘AI推理与NPU集成</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E→M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>02-异构多核通信与协同</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E→M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>03-虚拟化与混合关键系统</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E→M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>04-功耗与热管理策略</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E→M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>05-RISC-V生态与开放ISA</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E→M</span></td>
      <td></td>
    </tr>
    <tr class="even">
      <td>06-长期演进与维护策略</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">E→M</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td class="chapter-cell" rowspan="4">附录. 附录</td>
      <td>A-基础理论速查</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>B-开源许可证对比</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>C-参考书与线上资源</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
    <tr class="odd">
      <td>D-BIEM标记索引</td>
      <td style="text-align:center"><span class="quick-link-empty">/</span></td>
      <td style="text-align:center"><span class="status-badge status-todo">待写</span></td>
      <td style="text-align:center"><span class="phase-empty">/</span></td>
      <td style="text-align:center"><span class="date-empty">/</span></td>
      <td style="text-align:center"><span class="os-tag os-no">否</span></td>
      <td style="text-align:center"><span class="biem-tag">B</span></td>
      <td></td>
    </tr>
  </tbody>
</table>

<p class="map-legend">
<strong>图例：</strong>
<span class="status-badge status-done">建设完成</span>
<span class="status-badge status-building">建设中</span>
<span class="status-badge status-shelved">搁置</span>
<span class="status-badge status-todo">待写</span>
 | <strong>※</strong> 深挖章节 | <strong>★</strong> 扩展章节
</p>

---

## BIEM 深度分级

| 级别 | 定位 | 内容特征 |
|:---:|:---|:---|
| **B** Beginner | 入门建立认知 | 生活类比、基础命令、概念速查，**不涉及内核源码** |
| **I** Intermediate | 理解机制与框架 | 数据结构、调用链、API 用法，可阅读伪代码与框架逻辑 |
| **E** Expert | 源码级深挖 | 真实内核源码（Linux 5.15/6.1 LTS）+ 关键行注释，逐行带读 |
| **M** Master | 扩展与前沿 | 历史演进、未来趋势、异构/虚拟化等探索性内容，**可独立跳过** |

> **阅读提示**：章节标题后的 `[B→I]`、`[I→E]`、`[E→M]` 表示该章的深度跨度。小白可从 B 级切入，高手直接跳到 I/E 级，大师关注 M 级扩展框。

---

## 学习路径推荐

### 路径一：小白入门（B → I）
**目标**：建立完整知识地图，能看懂内核机制，能写基础驱动。

1. **第 1 章** → 了解硬件边界与选型逻辑
2. **第 2 章** → 理解系统启动全流程
3. **第 3 章** → 重点阅读 `00~05`（内核概览），跳过 E 级源码节
4. **第 4 章** → 掌握 Yocto/Buildroot 构建能力
5. **第 5 章** → 阅读 `01~03`（驱动框架与并发），跳过 DMA 深挖
6. **第 7 章** → 补齐应用层与工具链

### 路径二：内核工程师进阶（I → E）
**目标**：具备内核子系统源码级理解，能独立调试、优化、移植。

在路径一基础上，深入以下章节：
- **3.6 中断机制** ※ → 源码级带读：irq_desc → 注册链路 → 顶半部/下半部 → SMP
- **3.7 时间子系统** ※ → 时钟源、定时器、HRTIMER 调优
- **3.9 网络子系统** ★ → SKB、NAPI、XDP、TSN
- **5.4 中断驱动开发** ※ → request_irq、threaded IRQ、共享中断排错
- **5.5 DMA 引擎** ※ → dmaengine、一致性/流式 DMA、高速外设
- **6.4 实时性调优** ※ → PREEMPT_RT、中断延迟、工业案例

### 路径三：大师级深挖（E → M）
**目标**：复杂场景定制、安全加固、异构/虚拟化方案设计。

- **3.10 内核安全加固** ★ → SELinux 策略编写、LSM 钩子
- **8.2~8.4** → TrustZone、OP-TEE、TPM 2.0
- **10.2 异构多核** [E→M] → RPMsg、remoteproc、跨核中断协同
- **10.3 虚拟化** [E→M] → Jailhouse、KVM/arm64、VFIO 直通

---

## 仓库结构

```text
embedded-linux-v2026/
├── README.md                          # 本书主页（你正在阅读）
├── LICENSE                            # CC-BY-SA 4.0
├── 模板/
│   ├── 目录架构模板.md
│   └── 正文填充模板.md
├── 01-硬件层/
│   └── 01-CPU架构选型与嵌入式适配.md
├── 02-Bootloader与系统启动/
│   ├── 01-U-Boot移植与板级初始化.md
│   ├── 02-安全启动信任链.md
│   ├── 03-启动加速与故障排查.md
│   ├── 04-网络引导与远程部署.md
│   └── 05-固件冗余与回滚策略.md
├── 03-Linux内核深度解析/
│   ├── 00-内核架构与系统全景.md
│   ├── 01-进程调度.md
│   ├── 02-内存管理.md
│   ├── 03-虚拟文件系统与存储栈.md
│   ├── 04-设备树与硬件抽象.md
│   ├── 05-驱动模型与设备热插拔.md
│   ├── 06-中断机制/                    # 深挖：按节拆分子目录
│   │   ├── 01-中断基础与硬件抽象.md
│   │   ├── 02-中断描述符与核心数据结构.md
│   │   ├── 03-中断注册与注销完整链路.md
│   │   ├── 04-顶半部处理与流控机制.md
│   │   ├── 05-下半部机制深度解析.md
│   │   ├── 06-SMP中断管理与跨核分发.md
│   │   ├── 07-中断调试工具与故障排查.md
│   │   └── 08-中断子系统演进与趋势.md
│   ├── 07-时间子系统/                  # 深挖
│   ├── 09-网络子系统.md
│   └── 10-内核安全加固.md
├── 04-系统构建与部署/
├── 05-设备驱动开发/
│   ├── 01-驱动框架与设备模型.md
│   ├── 02-用户-内核接口设计.md
│   ├── 03-并发与竞态控制.md
│   ├── 04-中断驱动开发/                # 深挖
│   ├── 05-DMA引擎与高速外设/           # 深挖
│   ├── 06-标准外设驱动实战.md
│   ├── 07-工业总线驱动与协议栈.md
│   └── 08-多媒体驱动pipeline.md
├── 06-内核调试与性能优化/
│   └── 04-实时性调优/                  # 深挖
├── 07-应用层开发/
├── 08-系统安全与功能安全/
├── 09-Linux文件系统与文件管理/
├── 10-专用技术与前沿趋势/
└── 附录/
    ├── A-基础理论速查.md
    ├── B-开源许可证对比.md
    ├── C-参考书与资源.md
    └── D-BIEM标记索引.md
```

> **写作规范**：所有正文遵循 `模板/正文填充模板.md` 中的约束——段落呼吸感（单段 ≤ 4 行）、完整认知链路（场景→定义→图示→代码→验证）、代码带读必须注明内核文件路径与行号。

---

## 写作进度

| 章节 | 状态 | 深度 |
|:---|:---:|:---:|
| 3.6 中断机制 | 🚧 进行中 | I→E |
| 其他章节 | ⏳ 待填充 | - |

欢迎通过 Issue 提交勘误，或通过 PR 贡献章节。请严格遵循 [正文填充模板](./模板/正文填充模板.md) 的格式与深度规范。

---

## 许可证

本作品采用 [Creative Commons Attribution-ShareAlike 4.0 International](./LICENSE) 许可协议。

您可以自由分享、改编，但必须署名并以相同方式共享。
