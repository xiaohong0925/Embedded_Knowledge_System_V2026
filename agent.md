# agent.md — AI 复检工作手册

> 用途：跨会话/上下文压缩后快速恢复工作状态。新会话开始 AI 复检任务前，先读本文件。
> 最近更新：2026-08-12（第 12 章复检进行中，新增第 3 节第 4 步「补图检查」与第 4 节镜像兜底）

---

## 1. 项目一句话

《嵌入式 Linux 知识体系 V2026》：38 章主线（五部）+ A/B/C/D… 扩展篇的丛书工程，源码为 MkDocs Markdown，站点构建用 `mkdocs`。

## 2. 关键路径

| 内容 | 路径 |
|---|---|
| 正文 | `docs/0X-…/第N章 …/X.Y.Z_标题.md` |
| 全书状态总表 | `docs/index.md`（每章一行，含「是否人工复检」列） |
| 风格规范（22 条） | `plan.md`（R1–R22，原为第 4 章制定，实际全书通用） |
| 扩展篇设计 | `docs/00-模板/扩展篇设计大纲_v1.md` |
| 内核源码（核对基准） | `help-docs/kernel-src-v6.6/` |
| 配图生成脚本 | `tools/gen_ch11_diagrams.py`（第 11 章 9 张图） |

## 3. AI 复检流程（每节走一遍）

1. **通读**：整节读完再动手，不顺手改。
2. **事实核对**：所有内核函数名、文件路径、行号、CONFIG 项、结构体字段，必须对 v6.6 源码逐条验证，禁止凭记忆写"内核是这样的"。
3. **衔接与磕绊检查**（用户明确要求的红线）：
   - 相邻小节是否重复讲同一结论/同一操作（措辞近似的重复最刺眼）；
   - 指针类表述是否指对位置（"下一节/上文/前文"是否真在那里）；
   - 「下一步」预告是否与下一节实际标题、内容一致。
4. **补图检查**（2026-08-12 用户要求新增）：评估该节是否需要图辅助理解，按需四选一：
   - **内联 SVG 原理图**（2026-08-13 用户确认）：凡"接线/电路连接"关系（点对点物理连接），手绘内联 SVG 原理图——芯片方框+引脚名与物理引脚号、锯齿电阻/开关/二极管符号、GND 三横线符号、上拉电阻汇电源轨、跨线半圆拱。一律 `stroke="currentColor"` 适配深浅色主题，`viewBox` + `style="max-width:800px;width:100%"`。**禁止用 ASCII 连线图或纯表格表达接线**（用户反馈两者都看不懂）。**SVG 块内严禁空行与注释分组**——Python-Markdown 的 HTML 块遇空行即截断，后续元素成孤儿标签不渲染（2026-08-13 踩坑实录）；SVG 必须压成连续行。
   - **ASCII 图**：层级/流程简单、纯文本能表达清楚的，直接在正文用代码块画（如调用链树、字段布局、时序波形）；
   - **mermaid 图**：有时序/状态/分支结构的，直接补 mermaid（flowchart/sequenceDiagram/stateDiagram-v2）；
   - **生图占位**：需要精细视觉表达（硬件布局、缓存行结构、多版本共存这类空间关系）时，插入 HTML 注释占位块，含完整生图提示词（图名、风格、元素、布局、配色、比例），格式：`<!-- 【待补图】images/<节号>-<名称>.png（优先级：★必要/△可选）\n图名：…\n生图提示词：… -->`。用户人工复检时把提示词交给生图 AI 作图。占位块清单要进批次汇报和章存档。
5. **风格检查**：对照 `plan.md` R1–R22 + 下方第 5 节补充约定。
6. **修复**：用 Edit 精准修改，小修为主；重复内容按第 6 节收敛模式处理。
7. **构建验证**：`"/c/Users/75672/AppData/Local/Python/pythoncore-3.14-64/python.exe" -m mkdocs build 2>&1 | grep -c WARNING` 必须为 **0**。**严禁用托管运行时 `python`**——它没装 mkdocs，命令静默失败导致 grep 计数恒为 0，等于没验证（2026-08-13 踩坑实录：当会话多次误报"0 WARNING"）。pypinyin 缺失警告属环境问题非内容问题，出现时在汇报中说明。
8. **汇报**：逐节给"改/不改 + 原因"判定，列修改点表格；不夸大、不掩盖。

## 4. v6.6 源码核对基础设施

- 本地缓存：`help-docs/kernel-src-v6.6/`，文件名为原路径 `/` 换 `_`（如 `drivers_base_dd.c`、`include_linux_of.h`）。
- 缺失时下载：先 `curl https://raw.githubusercontent.com/torvalds/linux/v6.6/<路径>`；**GitHub 429 限流时改走 jsdelivr 镜像** `https://cdn.jsdelivr.net/gh/torvalds/linux@v6.6/<路径>`（2026-08-12 起生效）。限流时停等换源，不硬刷。
- **行号引用但书**：镜像暂时取不到的文件，正文只引路径不标行号，批次汇报中明示待验项，镜像恢复后补验闭环。
- **行号引用必须基于缓存文件实际查证**，写入正文时注明文件与行号。

## 5. 风格约定（plan.md 之外的补充，全书已确认）

- 提示框三级：`> 💡`（技巧）、`> ⚠️`（注意）、`> 🔴`（危险/硬性前提），81 个文件在用，不得新增级别；emoji 后第一个词**不加粗**；框内不加"提示/陷阱/危险"标签词。
- 导读收尾句式：`本节覆盖：…`（禁"学完本节，你能…"）。
- 代码块不带 `$` 提示符。
- 禁生活化比喻（第 11 章 11.2.4 的户籍比喻已因此拆除），技术直述。
- 图片：正文引用 `images/<文件名>.png`，alt 文本描述图内容；改图先改 `tools/` 下生成脚本，重新生成后用 ReadMediaFile 回读验证。
- 换行符统一 `<BR>` 大写。

## 6. 重复内容的收敛模式（第 11 章确立）

发现跨节重复时，不两边都留全量：

1. **细节更深的一方保留全量**；
2. 另一方压缩为一两句 + 显式指针（"这套方法在 X.Y.Z 已经讲过，这里不再重复"）；
3. 若重复本身是"不同视角的同一结论"，改写成显式呼应（"X.Y.Z 从工程角度给出过同样结论，本节把它落到机制层面"），让重复读起来是有意的分层，而非失控的冗余。

## 7. index.md 状态列口径

「是否人工复检」列取值：`是`（人工检完）/ `AI复检完成`（AI 检完待人工）/ `待人工复检` / `否`（未检）。AI 复检闭环一章后：改为 `AI复检完成` + 更新日期（当前日期从会话时间戳取）。

## 8. 已确立的设计决策（勿推翻）

- **驱动教学不塞进 B 扩展**：第 11 章（接合机制）/ B 扩展（总线传输 API）/ D 扩展（子系统写法，待建，第一波最高优先级）/ 第 22 章（选型决策）四层正交。依据见 `docs/00-模板/扩展篇设计大纲_v1.md`。
- **驱动三支柱复检顺序**：第 10 章（中断与时间）→ 第 11 章（设备模型，已完成）→ 第 13 章（并发与同步）。10+11 充分于"读懂驱动"，加 13 才充分于"动手写"的机制层。
- **C 扩展不删不合并**：15 篇成文是边缘 AI/异构多核/实时化/内核演进唯一实际内容，与第五部骨架不冲突；待第 32–37 章撰写时逐专题决策。
- 全书实锚点硬件：**RK3568**（第 11 章 uart2/GIC_SPI 118→hwirq 150 等均按 rk3568.dtsi 实际核对）。

## 9. 第 11 章复检结论存档（2026-08-10 闭环）

- **P0 事实修复**（均对 v6.6 验证）：11.2.3 回调链 5 处；11.2.4 uevent 源码链 4 处；11.3.1 RK3568 无 `/soc` 节点贯穿错误（uart2 直挂根节点、hwirq 150）；11.3.2 `platform_drv_probe` 在 v6.6 不存在（实为 `platform_bus_type.probe = platform_probe`，platform.c:1379）；11.4.1 compatible **无通配符**（of_compat_cmp = strcasecmp，of.h:884）；11.4.4 8250 例证改 `8250_of.c`。
- **新增**：11.2.2「代码导读：从 start_kernel 走到 drv->probe()」三节溯源线 + grep 自查法。
- **收敛**：11.2.3 删 platform_match 附录、排查节压缩为最小顺序+指针到 11.3.5；11.2.4 用户空间段压缩指向 11.5.2；11.6.3 删与 11.6.2 重复的 status 排查段、删除结论改显式呼应 11.6.1。
- **图**：11.99 时序图 `bus_match()` → `driver_match_device()`（改脚本重生成）。
- 未动判定（质量达标）：11.2.1、11.5.1、11.5.2、11.5.3、11.6.1、11.6.2、11.99 其余部分。
- **后续增补（2026-08-11 应用户要求）**：11.3.3 在第二步前新增「为什么 probe 里要管时钟和电源」小节——x86/PCIe（硬件/固件托管）vs ARM SoC（软件可编程时钟树+PMIC供电）平台所有权对比表 + 机器人产品重灾区提示框 + "前四步=把设备活着从硬件保证变成软件保证"认知模型。动机：服务器/PCIe 背景读者对 clk/regulator 两步有认知断点。

## 10. 第 10 章复检结论存档（2026-08-10 闭环）

- **范围**：30 节全量复检（10.1×5 / 10.2×3 / 10.3×7 / 10.4×3 / 10.5×6 / 10.6×4 / 10.7×1 / 10.99×1），每批构建 0 WARNING，终验 0 WARNING。
- **章级结论**：第 10 章虚构内核代码密度明显高于第 11 章，几乎每节都有凭记忆编造的内核实现；最严重的是 10.5.3 时间轮整节基于 4.8 之前的 `tvec_base`+tv1~tv5 五级级联旧实现（v6.6 实为 8/9 层×64 桶扁平数组+位图、不级联搬迁）。
- **重大事实修复**（均对 v6.6 验证）：10.5.3 时间轮整节重写（`timer_base`、`calc_index()`、`__run_timers()` timer.c:1995）；10.4 PREEMPT_RT 时间线更正为 2024-11 Linux 6.12 完整合入主线（原书"2023 年 6.1"错误）；10.6.2 换真实实现 `tick_nohz_idle_enter()`（tick-sched.c:1159）、`tick_nohz_stop_sched_tick()`（:966）、`tick_nohz_next_event()`（:801）、`tick_nohz_idle_exit()`（:1339）；10.6.3 `tick_nohz_full_cpu` 更正为 tick.h:194 宏（只查 cpumask，原书虚构复合函数）+ `can_stop_full_tick()`（tick-sched.c:303）；10.6.4 虚构 tracepoint 路径 `events/tick/tick_nohz_stop_sched_tick` 更正为真实事件 `timer:tick_stop`（v6.6 无 `tick_start`，事件格式 `success=%d dependency=%s`，include/trace/events/timer.h:406）；10.6.4 /proc/timer_list 虚构输出更正为真实格式（`Tick Device: mode:     1` timer_list.c:184 + `.nohz_mode`/`.tick_stopped`/`.idle_calls`/`.idle_sleeps` 带点字段，P(x) 宏 timer_list.c:144-165；nohz_mode 枚举 0=INACTIVE/1=LOWRES/2=HIGHRES，tick-sched.h:17）。
- **跨节收敛**：10.6.4 的 jiffies/RCU 两大段压缩加指针到 10.6.2，独特价值保留在 CPU 统计失真 + CONFIG_RCU_FAST_NO_HZ + 调试工具箱；10.7.1 带练B 音频爆音案例与 10.5.5 大面积撞车（同案例同根因同修复，还各带一份 hrtimer 测试模块）——10.7.1 删除重复的模块代码与 sysfs 命令细节，改为指针到 10.5.5，保留排查 SOP 流程本身。
- **边界指针**：10.3.5→第14章（NAPI 只讲机制，协议栈归 14 章）；10.3.6→第13章（spin_lock_bh/local_bh_disable 归并发章）。待第 13、14 章复检时核对反向引用。
- **10.99 重写**：删除全局知识点编号 135-186（9.99/11.99 均无此编号，属孤儿方案）；速查表 168 时间轮描述对齐 10.5.3 新实现、170 hrtimer 模式描述对齐 10.5.4（clockevent oneshot，非"低分辨率经 timer wheel"）；章节标题更正（第7章=启动链深度解析、第8章=进程与调度、第11章=设备模型）；Q4 选项 A/C/B/D 乱序修复。
- **10.7.1 修复**：MAX_SAMPLES=1000000 与输出 samples=2857142 自相矛盾（随模块删除消解）；总结表"I2C 延后到 tasklet"错误（tasklet 不能睡眠）改为 workqueue/线程化中断。
- **新增源码缓存**：`kernel_time_timer.c`、`kernel_time_timer_list.c`、`kernel_time_tick-sched.h`、`kernel_time_tick-internal.h`、`include_trace_events_timer.h` 等（清单见第 3 节缓存目录）。
- index.md 第 10 章行已更新为「AI复检完成 / 2026年8月10日」。
- **后续拆分（2026-08-10 应用户要求）**：10.7.1 拆为两节——`10.7.1_实战GPIO中断延迟排查.md`（带练A + 新增修复前后中断路径对比 mermaid 图）和 `10.7.2_实战音频爆音排查与排错方法论.md`（带练B + 方法论/工具速查/症状对照）。旧文件 `10.7.1_综合实战从GPIO延迟到音频爆音.md` 已删除，mkdocs.yml、README.md、10.6.4 下一步指针均已同步。全章现 31 节。

## 11. 第 13 章复检结论存档（2026-08-11 闭环）

- **范围**：全章 23 节复检（13.1×2 / 13.2×4 / 13.3×4 / 13.4×3 / 13.5×4 / 13.6×3 / 13.7×2 / 13.99×1），每批构建 0 WARNING，终验 0 WARNING。
- **重大事实修复**（均对 v6.6 验证）：13.2.1 ARM64 spinlock 换 qspinlock/MCS 真实实现（原书 ticket lock 旧实现）；13.2.2 mutex 慢速路径换 `__mutex_lock_common`（乐观自旋+FIFO wait_list）并修三处 P0——mutex 无 PI、PREEMPT_RT 不替换 mutex、rt_mutex 不支持递归（PI 深读指针到 8.4.2、RT 转换指针到 10.4.3）；13.3.1 原子操作换 `atomic_ll_sc.h` 真实宏 + LSE；13.3.2 屏障映射经 `asm/barrier.h`:119-121 核对，修"atomic_t 默认顺序一致"错误；13.3.3 换 `rwonce.h` 真实定义；13.4.1 `rcu_dereference` = READ_ONCE+数据依赖序（无屏障）；13.4.2 `rcu_assign_pointer` = `smp_store_release`（rcupdate.h:494）；13.5.1 修"rwlock 中断上下文不可用"错误；13.6.3 修模式1"RT 下 raw_spinlock 不关抢占"说反（重写为 per-cpu 忘关抢占例）。
- **跨节收敛**：13.5.4 TASK 状态表压缩加指针到 8.1.2、删孤儿"知识点258"；13.7 带练B lockdep 报告解读压缩为指针到 13.6.1（同场景同工具）。
- **13.7 拆分（仿 10.7 先例）**：旧 `13.7.1_综合实战并发崩溃排查.md`（三个带练455行）拆为 `13.7.1_实战原子上下文睡眠与死锁排查.md`（带练A全量+带练B压缩版）和 `13.7.2_实战rwlock到RCU迁移与选型速查.md`（带练C全量+速查表+DO/DON'T）。mkdocs.yml、README、13.6.3 下一步指针已同步。
- **13.99 重写**：删除全局知识点编号 187-213（同 10.99 孤儿方案），改小节号锚点；速查表对齐新表述（LDXR/STXR、smp_ 系屏障、五种 RCU 变体无 Tasks RCU）；章节名更正（第8章=进程与调度、第10章=中断与时间）；自测题解析引用改小节号。
- **待补图占位**（HTML注释含生图提示词，交外部生图AI）：13.2.1 MCS队列（△）、13.3.2 store buffer（★）、13.3.4 伪共享布局（★）、13.4.1 RCU GP时间轴（★）、13.7.2 RCU迁移多版本共存（△）。
- **新增源码缓存**：`atomic_ll_sc.h`、`atomic_lse.h`、`asm/barrier.h`、`rwonce.h`、`rcupdate.h` 等（`help-docs/kernel-src-v6.6/`）。
- README 页脚小节数 21→23；index.md 第 13 章行已更新为「AI复检完成 / 2026年8月11日」。

## 12. 第 12 章复检结论存档（2026-08-12 闭环）

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

## 13. 当前任务

第 12 章复检已闭环（2026-08-12）。第二部已复检章：10（中断与时间）、11（设备模型）、12（文件系统）、13（并发与同步）。下一章候选：第 9 章内存管理或第 14 章网络子系统，等用户指定。

## 14. 工作纪律

- 一切生成物放工作区内；不改 `help-docs/` 下的原始 docx。
- 先读后改；不确定的事实用源码验证，不猜测。
- 用户语言为中文，汇报用中文；结尾给单一明确的下一步建议。
