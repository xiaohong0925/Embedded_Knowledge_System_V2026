# AI 复检归档与工作状态

> 用途：存放各章 AI 复检的闭环存档与当前任务状态（"状态进文件"原则的落点之一）。
> 行为规范在根目录 `agent.md`，本文件只记录"做过什么、结论是什么、接下来做什么"。
> 新会话恢复工作状态时：先读 `agent.md`（规范），再读本文件「当前任务与待办」一节（状态）；章存档按需查阅。

---

## 当前任务与待办

- 第二部已复检章：7、10、11、12、13。
- **第 8 章挂起中**（等用户发话）：框架落点修补（README 排错索引 + 8.3.1 调度类框架块）+ 8.2 批复检。
- **B 扩展 77 篇 + B.99 知识图谱已全部成文（2026-08-18 收官）**，但**整体内容偏薄、浮于表面，已列入返工封存**——清单与判定基准见 `docs/00-模板/B扩展_返工清单.md`。重灾区：D.14 车载（5 篇全 <120 行）、E 综合实战、D.12/D.13、D.10.5。用户明确：本月 tokens 消耗过大暂不返工，未来按清单逐篇加厚。
- **返工首例已闭环（2026-08-18）**：B-E.15.5 数通仪器仪表整机总线架构（134→416 行），验证了返工流程可行性。

---

## 第 11 章复检结论存档（2026-08-10 闭环）

- **P0 事实修复**（均对 v6.6 验证）：11.2.3 回调链 5 处；11.2.4 uevent 源码链 4 处；11.3.1 RK3568 无 `/soc` 节点贯穿错误（uart2 直挂根节点、hwirq 150）；11.3.2 `platform_drv_probe` 在 v6.6 不存在（实为 `platform_bus_type.probe = platform_probe`，platform.c:1379）；11.4.1 compatible **无通配符**（of_compat_cmp = strcasecmp，of.h:884）；11.4.4 8250 例证改 `8250_of.c`。
- **新增**：11.2.2「代码导读：从 start_kernel 走到 drv->probe()」三节溯源线 + grep 自查法。
- **收敛**：11.2.3 删 platform_match 附录、排查节压缩为最小顺序+指针到 11.3.5；11.2.4 用户空间段压缩指向 11.5.2；11.6.3 删与 11.6.2 重复的 status 排查段、删除结论改显式呼应 11.6.1。
- **图**：11.99 时序图 `bus_match()` → `driver_match_device()`（改脚本重生成）。
- 未动判定（质量达标）：11.2.1、11.5.1、11.5.2、11.5.3、11.6.1、11.6.2、11.99 其余部分。
- **后续增补（2026-08-11 应用户要求）**：11.3.3 在第二步前新增「为什么 probe 里要管时钟和电源」小节——x86/PCIe（硬件/固件托管）vs ARM SoC（软件可编程时钟树+PMIC供电）平台所有权对比表 + 机器人产品重灾区提示框 + "前四步=把设备活着从硬件保证变成软件保证"认知模型。动机：服务器/PCIe 背景读者对 clk/regulator 两步有认知断点。

## 第 10 章复检结论存档（2026-08-10 闭环）

- **范围**：30 节全量复检（10.1×5 / 10.2×3 / 10.3×7 / 10.4×3 / 10.5×6 / 10.6×4 / 10.7×1 / 10.99×1），每批构建 0 WARNING，终验 0 WARNING。
- **章级结论**：第 10 章虚构内核代码密度明显高于第 11 章，几乎每节都有凭记忆编造的内核实现；最严重的是 10.5.3 时间轮整节基于 4.8 之前的 `tvec_base`+tv1~tv5 五级级联旧实现（v6.6 实为 8/9 层×64 桶扁平数组+位图、不级联搬迁）。
- **重大事实修复**（均对 v6.6 验证）：10.5.3 时间轮整节重写（`timer_base`、`calc_index()`、`__run_timers()` timer.c:1995）；10.4 PREEMPT_RT 时间线更正为 2024-11 Linux 6.12 完整合入主线（原书"2023 年 6.1"错误）；10.6.2 换真实实现 `tick_nohz_idle_enter()`（tick-sched.c:1159）、`tick_nohz_stop_sched_tick()`（:966）、`tick_nohz_next_event()`（:801）、`tick_nohz_idle_exit()`（:1339）；10.6.3 `tick_nohz_full_cpu` 更正为 tick.h:194 宏（只查 cpumask，原书虚构复合函数）+ `can_stop_full_tick()`（tick-sched.c:303）；10.6.4 虚构 tracepoint 路径 `events/tick/tick_nohz_stop_sched_tick` 更正为真实事件 `timer:tick_stop`（v6.6 无 `tick_start`，事件格式 `success=%d dependency=%s`，include/trace/events/timer.h:406）；10.6.4 /proc/timer_list 虚构输出更正为真实格式（`Tick Device: mode:     1` timer_list.c:184 + `.nohz_mode`/`.tick_stopped`/`.idle_calls`/`.idle_sleeps` 带点字段，P(x) 宏 timer_list.c:144-165；nohz_mode 枚举 0=INACTIVE/1=LOWRES/2=HIGHRES，tick-sched.h:17）。
- **跨节收敛**：10.6.4 的 jiffies/RCU 两大段压缩加指针到 10.6.2，独特价值保留在 CPU 统计失真 + CONFIG_RCU_FAST_NO_HZ + 调试工具箱；10.7.1 带练B 音频爆音案例与 10.5.5 大面积撞车（同案例同根因同修复，还各带一份 hrtimer 测试模块）——10.7.1 删除重复的模块代码与 sysfs 命令细节，改为指针到 10.5.5，保留排查 SOP 流程本身。
- **边界指针**：10.3.5→第14章（NAPI 只讲机制，协议栈归 14 章）；10.3.6→第13章（spin_lock_bh/local_bh_disable 归并发章）。待第 13、14 章复检时核对反向引用。
- **10.99 重写**：删除全局知识点编号 135-186（9.99/11.99 均无此编号，属孤儿方案）；速查表 168 时间轮描述对齐 10.5.3 新实现、170 hrtimer 模式描述对齐 10.5.4（clockevent oneshot，非"低分辨率经 timer wheel"）；章节标题更正（第7章=启动链深度解析、第8章=进程与调度、第11章=设备模型）；Q4 选项 A/C/B/D 乱序修复。
- **10.7.1 修复**：MAX_SAMPLES=1000000 与输出 samples=2857142 自相矛盾（随模块删除消解）；总结表"I2C 延后到 tasklet"错误（tasklet 不能睡眠）改为 workqueue/线程化中断。
- **新增源码缓存**：`kernel_time_timer.c`、`kernel_time_timer_list.c`、`kernel_time_tick-sched.h`、`kernel_time_tick-internal.h`、`include_trace_events_timer.h` 等。
- index.md 第 10 章行已更新为「AI复检完成 / 2026年8月10日」。
- **后续拆分（2026-08-10 应用户要求）**：10.7.1 拆为两节——`10.7.1_实战GPIO中断延迟排查.md`（带练A + 新增修复前后中断路径对比 mermaid 图）和 `10.7.2_实战音频爆音排查与排错方法论.md`（带练B + 方法论/工具速查/症状对照）。旧文件 `10.7.1_综合实战从GPIO延迟到音频爆音.md` 已删除，mkdocs.yml、README.md、10.6.4 下一步指针均已同步。全章现 31 节。
- **10.2.1/10.2.3 第二份外部评审吸收（2026-08-31）**：结构性建议 6 条，采纳 2 条半——10.2.1 导读后新增「顶半部是什么，以及它必须做的四件事」（一句话定义 + 确认/清除/抢救/调度论证表，FIFO 抢救为全书首次覆盖，末尾指针到 10.3.1）；10.2.3 I2C 案例挂精简修复后 handler 正例（注明完整模板在 10.2.1、底半部选型在 10.3）。**拒绝 #2**（"为什么拆两半"是 10.3.1 整节主题，评审漏看）、**拒绝 #4**（评审声称"无完整 handler 代码"有误——10.2.1:77-93 即最小化模板、10.2.2 有共享中断模板；FIFO 变体已并入表格）；评审的"急救窗口"比喻与两列镜像表违反 plan.md 风格与防模板化纪律，只取内容不取表述。
- **10.3 节组评审否决（2026-08-31）**：第三份评审称 10.3.1~10.3.7"缺定义/缺通用用法/缺数据契约"，逐条核实后**全部不成立**——定义在 10.3.1 黄金法则节（含 6 维对比表）；数据契约分布在 10.3.3 🔴、10.3.6 💡（spin_lock_bh/local_bh_disable 按既定边界归第 13 章）、10.3.7 max_active 段；补"底半部概论"会与黄金法则节重复，否决。**采纳的唯一行动**：用户追问"500μs 里中断谁关的"，暴露 10.2.1 铁律三只说"关着"没说"谁关"——补一句：ARM64 异常入口硬件自动置位 `PSTATE.DAIF` 的 I 位，handler 无需手动关；pseudo-NMI 例外指针到本节 💡（gic_pmr_mask_irqs，irq-gic-v3.c:817）。另：8250 串口 FIFO 抢救实证已补入 10.2.1 四步表 💡（serial8250_rx_chars，8250_port.c:1779，UART_LSR_OE overrun :1749）。新增缓存 `drivers_tty_serial_8250_8250_port.c`。
- **用户人工复检补漏（2026-08-27）**：10.1.5 pca953x 代码块系虚构——真实驱动（v6.6 与 v6.18 一致）从未用过 `gpiochip_set_chained_irqchip()`，走 Nested 路线：`gpio_irq_chip_set_chip()` + `girq->threaded=true` + `devm_request_threaded_irq(IRQF_ONESHOT|IRQF_SHARED)`，handler 内 `irq_find_mapping()` + `handle_nested_irq()`（I2C 读 pending 必须睡眠，Chained 物理上不可行）。probe/handler 两代码块已换 v6.6 真实实现，🔴 框 `generic_handle_irq`→`handle_nested_irq`；用户自加 Chained/Nested 对比表保留。新增缓存 `drivers_gpio_gpio-pca953x.c`（v6.6）；用户提供的 v6.18 源码存 `help-docs/kernel-src-v6.18/`。
- **用户阅读反馈 11 点整改（2026-09-01）**：跨 10.2.2/10.3.2/10.3.3/10.3.4 四节，逐条核实后全部采纳或部分采纳——①500μs 谁关中断已闭环（上轮 PSTATE.DAIF）；②10.2.2 新增「中断的内部状态位：istate」小节（`kernel/irq/internals.h`：字段本名 `core_internal_state__do_not_mess_with_it`，IRQS_PENDING/ONESHOT/REPLAY/WAITING 表格 + "正在处理中"在 `irq_data` 的 `IRQD_IRQ_INPROGRESS`、irq.h:241——**v6.6 无 IRQS_INPROGRESS，勿凭旧记忆写**；同步修正结构体节选里虚构的 `status` 字段为 `istate`）；③10.3.2 总结表后加收口句；④10.3.2 新增三张概念卡片（softirq_vec / pending 位图 / ksoftirqd）；⑤10.3.3 导读下 tasklet 废弃平文升级为 ⚠️ 醒目块；⑥10.3.3 新增「串行保证」概念卡片（STATE_SCHED/RUN 原文已有定义未重复）；⑦10.3.3 ⚠️ 补三函数睡眠原理一句 + 指针回 10.2.1 铁律一；⑧10.3.4 调用链前补「两个基本动作」（INIT_WORK 定义 + queue_work 提交）；⑨10.3.4 执行侧补 `process_one_work()` 真实代码（workqueue.c:2536，节选精简带行注释，含"先清 PENDING 再执行"与 current_func 调试用途）；⑩10.3.4 补「只有 system_wq 有 schedule_work/schedule_delayed_work 封装」+ v6.6 实际预建 6 个系统 wq（workqueue.c:6596-6606，long/freezable/power_efficient 知道存在即可）；⑪10.3.4 完整示例重写为全行尾注释版本。四节各改完构建均 0 WARNING。新增缓存 `include_linux_irq.h`、`include_linux_irqdesc.h`、`kernel_irq_internals.h`。
- **本节总结模式升级（2026-09-02 用户确立，全书执行）**：10.3.2/10.3.3/10.3.4 三节「本节总结」重排——表格不再是总结主体，改为 2~4 句带立场散文收口（10.3.3：tasklet 价值在存量不在新驱动；10.3.4：默认选 workqueue + 两个必须记住的点），原表格改名「速查表」置于其后。规则已固化进 agent.md §5。

## 第 13 章复检结论存档（2026-08-11 闭环）

- **范围**：全章 23 节复检（13.1×2 / 13.2×4 / 13.3×4 / 13.4×3 / 13.5×4 / 13.6×3 / 13.7×2 / 13.99×1），每批构建 0 WARNING，终验 0 WARNING。
- **重大事实修复**（均对 v6.6 验证）：13.2.1 ARM64 spinlock 换 qspinlock/MCS 真实实现（原书 ticket lock 旧实现）；13.2.2 mutex 慢速路径换 `__mutex_lock_common`（乐观自旋+FIFO wait_list）并修三处 P0——mutex 无 PI、PREEMPT_RT 不替换 mutex、rt_mutex 不支持递归（PI 深读指针到 8.4.2、RT 转换指针到 10.4.3）；13.3.1 原子操作换 `atomic_ll_sc.h` 真实宏 + LSE；13.3.2 屏障映射经 `asm/barrier.h`:119-121 核对，修"atomic_t 默认顺序一致"错误；13.3.3 换 `rwonce.h` 真实定义；13.4.1 `rcu_dereference` = READ_ONCE+数据依赖序（无屏障）；13.4.2 `rcu_assign_pointer` = `smp_store_release`（rcupdate.h:494）；13.5.1 修"rwlock 中断上下文不可用"错误；13.6.3 修模式1"RT 下 raw_spinlock 不关抢占"说反（重写为 per-cpu 忘关抢占例）。
- **跨节收敛**：13.5.4 TASK 状态表压缩加指针到 8.1.2、删孤儿"知识点258"；13.7 带练B lockdep 报告解读压缩为指针到 13.6.1（同场景同工具）。
- **13.7 拆分（仿 10.7 先例）**：旧 `13.7.1_综合实战并发崩溃排查.md`（三个带练455行）拆为 `13.7.1_实战原子上下文睡眠与死锁排查.md`（带练A全量+带练B压缩版）和 `13.7.2_实战rwlock到RCU迁移与选型速查.md`（带练C全量+速查表+DO/DON'T）。mkdocs.yml、README、13.6.3 下一步指针已同步。
- **13.99 重写**：删除全局知识点编号 187-213（同 10.99 孤儿方案），改小节号锚点；速查表对齐新表述（LDXR/STXR、smp_ 系屏障、五种 RCU 变体无 Tasks RCU）；章节名更正（第8章=进程与调度、第10章=中断与时间）；自测题解析引用改小节号。
- **待补图占位**（HTML注释含生图提示词，交外部生图AI）：13.2.1 MCS队列（△）、13.3.2 store buffer（★）、13.3.4 伪共享布局（★）、13.4.1 RCU GP时间轴（★）、13.7.2 RCU迁移多版本共存（△）。
- **新增源码缓存**：`atomic_ll_sc.h`、`atomic_lse.h`、`asm/barrier.h`、`rwonce.h`、`rcupdate.h` 等（`help-docs/kernel-src-v6.6/`）。
- README 页脚小节数 21→23；index.md 第 13 章行已更新为「AI复检完成 / 2026年8月11日」。

## 第 12 章复检结论存档（2026-08-12 闭环）

- **范围**：全章 18 节复检（12.1×4 / 12.2×3 / 12.3×5 / 12.4×3 / 12.5×3 / 12.99×1）+ 新写 12.1.4，每批构建 0 WARNING，终验 0 WARNING，19 文件一致性 grep 全绿（所属章节/导读/本节覆盖/无知识点前缀/无考纲残留/无$提示符/下一步指针）。
- **新写 12.1.4 字符设备与 file_operations**（用户指出全书盲区，大纲零覆盖）：设备号/cdev 三层 API/misc=major10 特化/chrdev_open 的 fops 替换（char_dev.c:373、def_chr_fops:452）/fops 方法表/ioctl 编码/poll（do_poll fs/select.c:885）/mmap。mkdocs.yml nav、README 已同步。
- **重大事实修复**（均对 v6.6 验证）：12.1.1 struct file 联合字段更正（fs.h:992）、vfs_read 换 new_sync_read（read_write.c:450）；12.1.2 do_sys_open 链更正（do_sys_openat2 fs/open.c:1406）、删已移除的 s_op->read_inode；12.1.3 挂载链升级 fs_context 框架（super.c:1739 vfs_get_tree→get_tree_bdev:1537）；12.2.1 readpage→read_folio（fs.h:404）、pagecache_get_page 已删除换 __filemap_get_folio（filemap.c:1863）；12.2.2 wb_workfn 换真实实现（fs-writeback.c:2245）、write_cache_pages 换 folio_batch 版（page-writeback.c:2394）；12.2.3 vfs_fsync 更正为 f_op->fsync 带 start/end（sync.c:180）。
- **12.3 批**：12.3.2 f2fs 原代码块"真实路径+伪代码函数体"全换真实链——`f2fs_gc(sbi, gc_control)`（gc.c:1797）、`__get_victim`（gc.c:1858）、`do_garbage_collect`（gc.c:1675）、`select_gc_type` FG_GREEDY/BG_CB（gc.c:216）、写路径 `__allocate_data_block`（data.c:1468）、Checkpoint `f2fs_write_checkpoint`（checkpoint.c:1620）；虚构的 select_victim_segment/fggc_threshold 等全部清除，调优参数换真实 sysfs（gc_urgent/gc_idle/gc_min_sleep_time）。12.3.3 UBIFS：`ubifs_write_inode`（super.c:296）、`ubifs_leb_change`（io.c:126，无不存在的 dtype 参数）换真实实现；"B+树"更正为游荡树+TNC；原子性承诺核实为真（kapi.c:559→eba.c:1197 ubi_eba_atomic_leb_change）。12.3.4 补 overlayfs（用户批准）：三层模型/copy-up/whiteout/OTA A-B 保留配置。12.3.5 补 iostat/blktrace I/O 模式分析段（充分性缺口落点，README 排错索引断链修复）。
- **12.4 批**：12.4.1 mtd_read 返回值口径修正（-EUCLEAN/-EBADMSG，非"返回正数"，mtd.h:282）；12.4.2 三处 P0——struct ubi_volume 换真实结构（ubi.h:338，`ck vol_sem` 错字、usable_leb_size、eba_tbl 类型）、EC 头位置更正（PEB 数据区起始 64 字节 in-band，非 OOB；ubi-media.h:147 字段类型修正）、ubi_leb_change 虚构函数体换真实链（kapi.c:559→eba.c:1197→try_write_vid_and_data:944）；WL 阈值 CONFIG_MTD_UBI_WL_THRESHOLD=128、BEB_LIMIT 每 1024 块 20 个；12.4.3 UBI 合入主线年份 2008→2007（2.6.22）。
- **12.5 批**：safe_write_file 三处重复收敛——12.2.3 为规范实现，12.5.1 改指针引用，12.5.2 保留 mkstemp 变体并注明出处；12.5.2 mermaid 时序错误修复（close 画在 fsync 前）；barrier=0 口径与 12.5.3 对齐；删"防盗门"生活化比喻。
- **12.99 重写**（仿 13.99 模板）：去 1-60 全局编号，改"关联图+速查表+10 道自测题（???答案块）+前后章关联"格式；关联图内容对齐复检后口径（read_folio、fs_context 挂载链、new_sync_read、F2FS 六区域、游荡树、overlayfs、四层防御、六大陷阱与 12.5.3 一致）；跨章引用更正为 README 口径（第7/9/11/13/15章）。
- **待补图占位**：第 12 章无新增生图占位（各节 mermaid/ASCII 图覆盖充分）。
- **新增源码缓存**：`fs_f2fs_gc.c`、`fs_f2fs_data.c`、`fs_f2fs_checkpoint.c`、`fs_ubifs_io.c`、`fs_ubifs_super.c`、`drivers_mtd_ubi_kapi.c`、`drivers_mtd_ubi_eba.c`、`drivers_mtd_ubi_ubi.h`、`drivers_mtd_ubi_ubi-media.h`、`include_linux_mtd_ubi.h`、`include_linux_mtd_mtd.h`（`help-docs/kernel-src-v6.6/`）。
- README 12.3.x 链接文本同步新标题；index.md 第 12 章行已更新为「AI复检完成 / 2026年8月12日」。

## 第 7 章复检结论存档（2026-08-26 闭环）

- **范围**：全章 19 节 + 7.99（7.1×3 / 7.2×3 / 7.3×3 / 7.4×3 / 7.5×4 / 7.6×3 / 7.99×1），每节一闭环（通读→v6.6 事实核对→修改→构建 0 WARNING→汇报），每批构建 0 WARNING。7.4/7.5/7.6 三个节组先做设计调研汇报、用户认可后才动手（节组级前置流程本章确立）。
- **7.6.1 kernel_init**：`kernel_init_freeable()` 旧内核残留清理——删 v6.6 不存在的 `set_cpus_allowed_ptr(current, cpu_all_mask)`、`cad_pid = get_pid(task_pid(current))`、`page_ext_init_flatmem_late()`→`page_alloc_init_late()`、删旧式 `if (!ramdisk_execute_command) ramdisk_execute_command = "/init"`（v6.6 为静态初始化）；`kernel_init()` 尾部 `kcsan_shutdown()`→`kprobe_free_init_mem()` 并补 `pti_finalize()`；`kernel_thread()`→`user_mode_thread()`（导读与 mermaid 同步）。
- **7.6.2 根文件系统挂载（概念性错误）**：`Waiting for root device` 原文误述为 `mount_block_root()` 的"挂载失败重试循环"——v6.6 实际是挂载**之前**的 `wait_for_root()` 等待循环（do_mounts.c:411-431，5ms 轮询 `driver_probe_done()`+`early_lookup_bdev()`），挂载失败不重试直接 panic；`prepare_namespace()` 代码块按 v6.6 重写（`parse_root_device()`/`initrd_load()`/`wait_for_root()`/`mount_root()`/`devtmpfs_mount()`/`init_mount`+`init_chroot`）；`do_mount_root()` 换 `init_mount`/`init_chdir` 真实实现；`populate_rootfs()` 更正为 `async_schedule_domain()` 异步解压（与 7.6.1 `wait_for_initramfs()` 闭环）；rootwait=N 超时语义补全，车机案例叙事改 `rootwait=30` 语境；mermaid 决策链重画。
- **7.6.3/7.99**：7.6.3 导读归属修正（execve 在 7.6.1 非 7.6.2）、交叉引用 7.5.4「PID 1 信任根」验证为真；7.99 补标准头部（所属行+难度行），统计表 58 知识点 BIEM 分布逐行重数验证吻合，迁移对照表五落点 grep 全部命中。
- **跨节统一**：全部 20 篇所属行统一为 `> 所属章节：第7章 启动链深度解析 > 节号 README短名`；全章补齐「下一步」衔接链（7.6.1→7.6.2→7.6.3→7.99）；7.5.4 删越界承诺 initramfs 内容的表述；README 主线表 7.6.1 难度 [I]→[I→E] 同步；README「每节内部遵循统一结构」模板句改写为"章级问题驱动、节内自然展开"口径。
- **新增源码缓存**：`init_do_mounts.c`、`init_do_mounts_initrd.c`、`init_initramfs.c`（`help-docs/kernel-src-v6.6/`）。
- index.md 第 7 章行已更新为「AI复检完成 / 2026年8月26日」。
