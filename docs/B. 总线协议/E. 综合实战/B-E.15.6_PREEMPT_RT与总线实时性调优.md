# B-E.15.6 PREEMPT_RT 与总线实时性调优

> 所属章节：第五部 B. 总线协议 > E. 综合实战
>
> 难度：[M] | 预计阅读时间：45 分钟

## 本节导读

EtherCAT 主站、1 kHz 控制循环、确定性 IO——这些需求最后都收敛到同一个系统问题：Linux 的调度延迟能不能压到微秒级，并且**最坏情况**也可控。PREEMPT_RT 把内核自旋锁改成可睡眠锁、中断线程化，让高优先级任务几乎可以抢占一切，最坏延迟从毫秒级压到几十微秒。但打上补丁只是入场券：BIOS 的电源管理、中断亲和性、内存换页、驱动里的长临界区，每一项都能把实时性打回原形。本篇是 B 扩展的收官篇，把"rt 内核 + 系统调优 + 量化验证"的完整方法论串起来。

本篇被 12.5（IgH 实战）、15.1（机械臂）、15.3（人形）反复引用，是它们的实时性地基。

本节覆盖：PREEMPT_RT 改了什么、最坏延迟的来源清单（硬件/内核/驱动/应用四层）、系统调优 checklist（BIOS/内核参数/调度/内存/中断）、cyclictest 量化验证方法、周期性抖动的归因流程、实时性的验收标准。

## PREEMPT_RT 改了什么

标准 Linux 内核里有三类不可抢占区段，它们决定最坏延迟：

| 不可抢占源 | 标准内核 | PREEMPT_RT |
|:---|:---|:---|
| 自旋锁临界区 | 持锁期间不可抢占 | spinlock 变 rtmutex（可睡眠、带优先级继承） |
| 中断处理 | 硬中断上下文执行，抢占一切 | 中断线程化（threaded IRQ），可按优先级调度 |
| 关抢占/关中断区段 | rcu_read_lock 等长区段 | 可抢占 RCU 等改造 |

效果量级：同一台 x86 工控机，标准内核 cyclictest 最坏延迟常见 1~10 ms（SMI 爆发时更差），PREEMPT_RT + 调优后稳态最坏 20~60 µs。这个数字就是 1 ms 控制周期能不能跑的判断依据。

内核获取：Linux 6.x 起 PREEMPT_RT 主体已进主线，`CONFIG_PREEMPT_RT=y` 直接开；发行版侧 Ubuntu（realtime 内核）、Debian（rt 包）、openEuler 都有现成包。自编译内核时确认 `.config` 里 `CONFIG_PREEMPT_RT=y`、`CONFIG_HIGH_RES_TIMERS=y`。

## 最坏延迟的来源清单

实时性调优的对象是一张四层清单，每层都能独立毁掉实时性：

```
 硬件/固件层
   SMI（系统管理中断）：BIOS 电源管理触发，绕过 OS 直接停 CPU
   CPU C-state 深休眠：唤醒延迟几十~几百 µs
   超线程/频率缩放：核间资源争抢、变频过渡抖动
 内核层
   未打 rt 补丁、缺 HIGH_RES_TIMERS
   能源感知调度（EAS）把 RT 线程搬来搬去
 驱动层
   非 rt 感知的驱动：长自旋锁区段、本地关中断
   GPU/NPU 驱动的页表操作、固件通信停顿
 应用层
   页错误（没 mlockall）、动态内存分配、日志 IO
   优先级没配、CPU 没隔离、优先级反转（无优先级继承的互斥锁）
```

## 调优 Checklist

按层执行，每项都可验证：

```bash
# ── BIOS ──
# 关：C-states（或限 C1）、C1E、Turbo（评估后）、超线程（可选）、
#     所有电源管理特性（ASPM 等）
# 开：高性能电源模式
# 验证：turbostat 看 C-state 驻留；hwlatdetect 测 SMI

# ── 内核命令行 ──
# isolcpus=2,3 nohz_full=2,3 rcu_nocbs=2,3
#   隔离 2/3 核：不跑调度时钟滴答、RCU 回调挪走
# intel_idle.max_cstate=1（若无 BIOS 选项时的兜底）
# irqaffinity=0,1（默认中断亲和到 0/1 核）

# ── 系统服务 ──
systemctl stop irqbalance          # irqbalance 会打乱中断亲和性
# NTP/chrony 配平滑模式（禁止跳变校时）——12.3 的 DC 参考时钟稳定性依赖它

# ── 中断亲和 ──
# 把网卡（EtherCAT 口）中断绑到隔离核之外，或与 RT 线程同核（策略见下）
cat /proc/interrupts | grep enp2s0
echo 2 > /proc/irq/$(irq号)/smp_affinity_list
```

应用侧纪律（与 12.5/15.1 代码里出现的三件套对应）：

```c
mlockall(MCL_CURRENT | MCL_FUTURE);     /* 防换页 → 页错误 */
struct sched_param sp = { .sched_priority = 90 };
sched_setscheduler(0, SCHED_FIFO, &sp); /* RT 优先级 */
/* 栈预触碰：在进入实时循环前把栈每页写一遍 */
```

> 💡
> 中断与 RT 线程的核分配有两种风格：中断与 RT 线程同核（处理完中断立刻跑线程，延迟最低，但中断风暴会挤占线程）；或分核（隔离性更好）。EtherCAT 主站推荐**同核**起步——收包中断唤醒周期任务的路径最短。两种都实测，用数据选。

## 量化验证：cyclictest

实时性只认测量。cyclictest 起一组高精度定时器线程，统计每次唤醒的实际延迟：

```bash
cyclictest -m -p 99 -i 1000 -h 500 -l 10000000 --smp
#  -m mlockall  -p99 RT 优先级  -i 1000 µs 周期
#  -h 500 直方图到 500 µs  -l 跑 1000 万次（约 3 小时）  --smp 全核
```

判读输出：看 **Max**（最坏值）与直方图尾部，不是看平均值。验收标准按控制周期定：1 ms 周期的系统，要求 72 小时 cyclictest 最坏值 < 150 µs（留 15% 周期预算给调度），同时 hwlatdetect 确认无 SMI 事件。

制造压力再测是必要步骤——空闲系统的数字没有意义：

```bash
stress-ng --cpu 4 --io 2 --vm 2 &      # 系统压力
iperf3 -c <对端> &                      # 网络压力
# 压力状态下重跑 cyclictest，最坏值漂移不应超过空闲态的 2 倍
```

## 周期性抖动的归因流程

12.5/15.x 实战里"周期偶发超时"按这个顺序归因：

```
 1. cyclictest 基线干净吗？
      不干净 → 硬件/内核层：hwlatdetect 查 SMI，turbostat 查 C-state
 2. 干净。抖动与什么事件相关？
      与时间相关（每 N 秒）→ 后台服务/NTP 跳变/cron
      与负载相关 → 中断亲和、驱动临界区
      与操作相关（打开文件、打印日志）→ 应用层页错误/IO
 3. 用 ftrace 抓现场：
      trace-cmd record -e sched_switch -e irq_handler_entry \
                       -p function_graph -l <rt线程函数> sleep 60
      找唤醒链路上耗时最长的环节
 4. 修复后回归：同一压力剧本重跑 cyclictest，对比直方图尾部
```

## 验收标准模板

交付实时系统时的书面验收（写进测试报告）：

| 项 | 方法 | 合格线 |
|:---|:---|:---|
| 空闲最坏延迟 | cyclictest 72 h | <150 µs（1 ms 周期系统） |
| 压力最坏延迟 | cyclictest + stress-ng + 网络压力 24 h | <300 µs |
| SMI 事件 | hwlatdetect 24 h | 0 次超限（>15 µs） |
| 控制周期实测 | 应用内周期时间戳统计 | max <1.2×周期，抖动 <10% 周期 |
| 掉帧/丢步 | WKC（EtherCAT）/错误计数 | 0 |

## 排障：实时性故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| 最坏延迟几百 µs 且固定间隔出现 | SMI（BIOS 电源管理） | hwlatdetect；BIOS 关电源管理项 |
| 最坏延迟随温度/时间劣化 | C-state 深休眠、CPU 降频 | turbostat 驻留统计 |
| 加负载后抖动恶化 10 倍 | 中断未隔离、irqbalance 在跑 | /proc/interrupts 分布、进程状态 |
| RT 线程偶发长时间不运行 | 优先级反转（普通锁被低优先级持） | ftrace 查阻塞链；换 rtmutex/无锁结构 |
| 程序运行初期抖动、后期稳定 | 页错误发生在运行初期（未预触碰栈/堆） | mlockall + 预触碰；/proc/self/status 看缺页计数 |
| 一切配置正确仍不达标 | 网卡/芯片组本身不适合（消费级平台） | 换 I210 + 工业主板交叉验证 |

## 本节自查

读完本篇，你应能独立完成以下动作：

- 说出 PREEMPT_RT 对三类不可抢占源的改造及延迟量级改善
- 按四层清单审计一个候选系统的实时性风险
- 执行完整调优 checklist 并逐项验证（isolcpus/nohz_full/irq 亲和/mlockall）
- 用 cyclictest + 压力剧本产出验收级延迟数据
- 按归因流程定位一例周期性抖动到具体层
- 为一个 1 ms 控制周期项目写出验收标准表

## 参考资料

- PREEMPT_RT：kernel.org 文档与 wiki.linuxfoundation.org/realtime
- rt-tests（cyclictest/hwlatdetect）、trace-cmd/ftrace 文档
- 内核文档：`Documentation/scheduler/`（sched-deadline、isolation）
- OSADL（开源自动化发展实验室）的 QA Farm 实时性测试数据
