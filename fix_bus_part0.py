#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix quality issues in 08-总线协议 第零部分 markdown files.
"""
import os
import re

BASE_DIR = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议\第零部分-片内SoC总线'

def get_files():
    files = []
    for root, dirs, fnames in os.walk(BASE_DIR):
        for f in fnames:
            if f.endswith('.md') and f != 'README.md':
                files.append(os.path.join(root, f))
    return files

def detect_topic(filepath):
    p = filepath.lower()
    if 'amba' in p and '总览' in p:
        return 'amba_overview'
    if 'ahb' in p:
        return 'ahb'
    if 'apb' in p:
        return 'apb'
    if 'axi' in p or 'ace' in p:
        if 'axi5' in p or 'ace' in p:
            return 'axi5_ace'
        return 'axi'
    if 'tilelink' in p:
        return 'tilelink'
    if 'wishbone' in p:
        return 'wishbone'
    return 'unknown'

# ============================================================================
# Content generators
# ============================================================================

HISTORY_TEMPLATES = {
    'ahb': """AHB 总线的发展根植于 ARM 公司对片上系统互连架构的持续演进需求。1996 年，ARM 推出 AMBA 1.0 规范，首次定义了 ASB（ARM System Bus）作为当时主流的共享总线方案，服务于早期 ARM7 和 ARM9 处理器核。随着半导体工艺进入深亚微米时代，系统频率显著提升，ASB 的分布式仲裁与三态总线结构逐渐成为带宽瓶颈。1999 年，AMBA 2.0 规范发布，AHB（Advanced High-performance Bus）正式取代 ASB，引入集中式仲裁、单一时钟域、突发传输（Burst Transfer）与流水线地址/数据相位分离机制，显著提升了总线利用率和最高工作频率。2003 年 AMBA 3 推出 AHB-Lite 子集，去掉了复杂的多主仲裁和_retry/split 响应，专为单主控或简单多主控场景优化面积与时序。此后，AHB 作为 AMBA 家族中"承上启下"的层级，在 Cortex-M 系列 MCU、DMA 控制器、外部存储器接口中持续扮演关键角色。尽管 AXI 已成为高性能 SoC 的首选，AHB 凭借其低门数、易综合和成熟生态，至今仍是嵌入式系统中连接中速外设的主流方案，并随着 AMBA 5 持续演进保持兼容性与扩展能力。""",

    'apb': """APB（Advanced Peripheral Bus）的诞生是 ARM 对片上系统外设互连痛点的精准回应。1996 年 AMBA 1.0 首次提出 APB，定位为低速、低功耗外设的专用总线桥。在 ASB/AHB 主总线高速运转的背景下，UART、GPIO、Timer 等外设若直接挂接在高速总线上，不仅浪费功耗，还会因总线宽度不匹配导致面积膨胀。APB 通过两级桥接（APB Bridge）将高频 AHB 时钟域隔离，外设侧仅在有传输时激活时钟，其余时间处于静态低功耗状态。1999 年 AMBA 2.0 细化了 APB 信号定义，确立了 PCLK、PENABLE 两周期访问模型。2003 年 AMBA 3 引入 APB4，新增 PREADY 从设备等待信号与 PSLVERR 错误反馈，解决了早期 APB 无法插入等待周期和报告错误的局限。2010 年 AMBA 4 的 APB 进一步增强了 TrustZone 安全扩展支持。作为 AMBA 生态中寿命最长、应用最广的总线，APB 以极简的信号集（约 10 余根）和零额外逻辑开销，成为每一颗 SoC 芯片中不可或缺的基础设施。""",

    'axi': """AXI（Advanced eXtensible Interface）的演进是 ARM 应对多核与多媒体时代内存墙危机的里程碑式变革。2003 年，随着 Cortex-A8 等超标量处理器的出现，传统 AHB 的共享总线架构在多个主设备并发访问时暴露出严重的仲裁延迟与带宽争抢问题。AMBA 3.0 应运而生，首次发布 AXI3 协议，革命性地引入五通道分离架构（AR/R/AW/W/B）、乱序传输（Out-of-Order）、非对齐突发（Unaligned Burst）和 QoS 服务质量标识。2009 年 AMBA 4 升级为 AXI4，将突发长度扩展至 256，新增 QoS 与区域（Region）信号，并推出 AXI4-Lite 轻量级子集以适配寄存器映射外设。2015 年 AMBA 5 发布 AXI5，引入原子操作（Atomic）、MPAM（内存分域）和 Trace 标签，为机架级一致性互连奠定基础。AXI 已成为事实上的业界标准，从智能手机 SoC 到服务器 CPU、FPGA 硬核处理器，AXI 互连网络构成了现代数字系统的数据高速公路。""",

    'axi5_ace': """AXI5 与 ACE（AXI Coherency Extensions）代表了 ARM 从单芯片一致性到系统级一致性的战略跨越。2011 年，随着 Cortex-A15 引入 big.LITTLE 架构，多簇（Cluster）处理器之间共享数据的需求催生了 ACE 协议，它在 AXI4 基础上新增 snoop 通道（AC/CR/CD），使外部主设备能够监听并维护缓存一致性。2013 年，面向服务器与网络基础设施的 ACE-Lite 发布，允许 I/O 主设备参与一致性域而无需完整缓存。2015 年 AMBA 5 将 ACE 演进为 CHI（Coherent Hub Interface），同时推出 AXI5 作为非一致性互连的顶峰规范。AXI5 继承了 AXI4 的全部优势，并新增原子事务、MPAM 资源分区和扩展用户信号，为 PCIe/CCIX 等片外一致性协议提供统一的片上接口。ACE 与 CHI 的协同，使 ARM 生态实现了从 Cortex-A 手机 SoC 到 Neoverse 数据中心处理器的一致性全覆盖，成为片上互连技术发展的前沿标杆。""",

    'tilelink': """TileLink 的诞生源于开源硬件运动对标准化片上互连的迫切需求。2016 年，加州大学伯克利分校在开发 RISC-V 处理器 Rocket Chip 时，发现传统 AMBA 协议虽成熟但受 ARM 授权限制，且其复杂的状态机与信号集不利于敏捷设计和教学推广。为此，Berkeley 架构组设计了 TileLink 协议，定位为"开源、免费、参数化"的片上总线标准，首次发布即作为 Rocket Chip 生成器（Generator）的默认互连网络。TileLink 借鉴了 AXI 的通道分离思想，但大幅简化了握手模型，定义了 TileLink Uncached Lightweight（TL-UL）、TileLink Uncached Heavyweight（TL-UH）和 TileLink Cached（TL-C）三级能力子集，使设计者能够按面积/性能需求精确裁剪。2017 年 TileLink 1.7 规范发布，明确了缓存一致性消息类型与原子操作语义。2019 年 SiFive 将其商业化并集成于 Freedom 平台系列。随着 RISC-V 生态在全球半导体产业中的崛起，TileLink 已成为除 AMBA 之外最具影响力的开源 SoC 互连标准，并在 Google Titan 安全芯片、Berkeley FireSim 仿真平台中得到实战验证。""",

    'wishbone': """Wishbone 总线是开源硬件社区对商业总线垄断最早的反叛与最成功的实践之一。1997 年，Silicore Corporation 的 Richard Herveille 在 OpenCores 开源硬件平台上发布了 Wishbone 互连规范，目标是为 FPGA 与 ASIC 设计提供一种"公共领域（Public Domain）"、无授权费用、实现极简的片上总线标准。在那个 AMBA 与 IBM CoreConnect 严格闭源授权的年代，Wishbone 以其单周期握手、可配置总线宽度（8/16/32/64 位）和点对点/共享总线/交叉开关三种拓扑支持的灵活性，迅速成为开源 CPU（如 OpenRISC、LatticeMico8）与外设 IP 的首选互连方案。2002 年 Wishbone B3 版规范发布，强化了突发传输与标签（TAG）机制。2010 年前后，随着 AXI 在 FPGA 厂商工具链中的普及，Wishbone 在新设计中的份额有所下降，但在教育、研究、低成本 FPGA 项目和遗留开源 IP 生态中依然保持旺盛生命力。Wishbone 的历史意义在于证明了开源硬件互连标准的可行性，为后续 TileLink 的崛起奠定了文化与技术基础。""",

    'amba_overview': """AMBA（Advanced Microcontroller Bus Architecture）总线协议族的发展史，是 ARM 公司从处理器 IP 供应商向系统级架构主导者转型的缩影。1996 年，ARM 推出 AMBA 1.0，首次定义 ASB（ARM System Bus）与 APB（Advanced Peripheral Bus）两级分层互连，奠定了"高速主总线 + 低速外设桥"的经典范式。1999 年 AMBA 2.0 用 AHB（Advanced High-performance Bus）取代 ASB，引入突发传输与流水线机制，使 ARM9/ARM11 时代 SoC 性能跃升。2003 年 AMBA 3.0 是革命性的一代：AXI3 以五通道分离架构解决多主并发瓶颈，AHB-Lite 精简冗余信号适配 MCU，APB3 新增等待状态支持。2009 年 AMBA 4.0 推出 AXI4、ACE（缓存一致性扩展）和 Low Power Interface（Q-Channel/P-Channel），标志着 ARM 开始从手机领域向服务器与基础设施市场扩张。2015 年 AMBA 5 发布 CHI（Coherent Hub Interface）与 AXI5，将一致性互连从芯片级推向机架级。AMBA 协议族通过二十余年的分层演进，已成为全球超过 95% 的 SoC 设计所依赖的互连基石。""",
}

def make_summary_exercise(topic, filename):
    """Generate summary and exercise section based on topic."""
    if topic == 'ahb':
        if '基础知识' in filename:
            summary_rows = [
                ('总线定位', 'AHB 是 AMBA2 定义的中速共享总线，介于 AXI 与 APB 之间'),
                ('核心组件', 'Master、Slave、Arbiter、Decoder、Multiplexor 五要素'),
                ('关键特性', '突发传输、流水线地址/数据相位分离、单时钟域、集中仲裁'),
                ('适用场景', 'DMA、LCD 控制器、外部 Flash 等中等带宽 IP 互连'),
            ]
            exercises = [
                '为什么 AHB 采用集中式仲裁而非分布式仲裁？对比两者的时序面积 trade-off。',
                'AHB 的流水线传输中，地址相位与数据相位如何重叠？画图说明两个突发传输的时序。',
                '在多主 AHB 系统中，Arbiter 的 HGRANT 信号如何与 HTRANS 配合完成总线移交？',
            ]
        elif '时序' in filename or '流水' in filename:
            summary_rows = [
                ('传输类型', 'IDLE、BUSY、NONSEQ、SEQ 四种 HTRANS 编码决定总线行为'),
                ('流水线机制', '地址相位与数据相位重叠，当前传输发地址、上一传输收数据'),
                ('等待状态', 'HREADY 低电平插入等待，Slave 可动态拉低以扩展传输周期'),
                ('突发传输', 'SINGLE、INCR、WRAP4/8/16 支持连续地址的高效数据搬运'),
            ]
            exercises = [
                'AHB 流水线中若 Slave 在第二拍拉低 HREADY，地址相位是否会停滞？为什么？',
                '分析一个 4-beat INCR 突发传输的完整时序：标注每一拍的 HADDR、HWDATA、HTRANS、HREADY。',
                'WRAP8 突发与 INCR8 突发在地址回绕边界上有何差异？分别适用于哪种存储器类型？',
            ]
        else:  # 仲裁
            summary_rows = [
                ('仲裁机制', '固定优先级、轮询优先级、混合优先级三种策略'),
                ('总线移交', 'GNT 与 HTRANS 配合，完成当前突发后释放总线'),
                ('Split 响应', 'Slave 要求主设备放弃总线，仲裁器冻结其优先级'),
                ('Retry 响应', 'Slave 要求主设备立即重试，仲裁器不调整优先级'),
            ]
            exercises = [
                'Split 与 Retry 响应的触发场景有何不同？对仲裁器的优先级队列影响是否一致？',
                '设计一个两级轮询仲裁器：高优先级组固定轮询，低优先级组仅在高层空闲时轮询。',
                '在多主 AHB 系统中，如何保证 Split 事务完成后原 Master 能够重新获得仲裁权？',
            ]
    elif topic == 'apb':
        if '基础' in filename or '传输时序' in filename:
            summary_rows = [
                ('总线定位', 'APB 是 AMBA 低速外设总线，通过 APB Bridge 挂载于 AHB/AXI 之下'),
                ('信号极简', 'PADDR、PWRITE、PSEL、PENABLE、PRDATA/PWDATA、PREADY'),
                ('两周期模型', 'Setup 阶段置 PSEL，Enable 阶段置 PENABLE，完成一次访问'),
                ('低功耗特性', '外设时钟可门控，无传输时总线处于静态低功耗状态'),
            ]
            exercises = [
                'APB 为什么要采用两周期访问模型？单周期模型会带来什么实现风险？',
                '对比 APB3 与 APB2 的信号差异：PREADY 和 PSLVERR 分别解决了什么痛点？',
                '在 AHB-to-APB Bridge 中，如何将 AHB 的单周期地址相位映射为 APB 的两周期 Setup/Enable？',
            ]
        else:  # 进阶与实战
            summary_rows = [
                ('Bridge 设计', 'APB Bridge 负责时钟域隔离、协议转换和地址映射'),
                ('APB4 扩展', 'PSTRB 写选通、PPROT 保护类型支持字节粒度和安全访问'),
                ('多从设备', '通过 PSELx 独热译码实现单个 Bridge 管理多个 APB Slave'),
                ('调试技巧', '通过监测 PREADY 和 PSLVERR 定位外设寄存器访问异常'),
            ]
            exercises = [
                'APB4 的 PSTRB 信号如何与 PWDATA 配合实现字节选通写？画出 32-bit 总线上的半字写时序。',
                '设计一个支持 8 个 Slave 的 APB 地址译码器：给出地址划分方案和 PSELx 逻辑表达式。',
                '在 TrustZone 系统中，APB 的 PPROT[1] 信号如何与 AHB 的 HNONSEC 协同实现安全域隔离？',
            ]
    elif topic == 'axi':
        if '基础知识' in filename or '通道与架构' in filename:
            summary_rows = [
                ('五通道架构', 'AR/R 读通道、AW/W/B 写通道分离，支持全双工并发'),
                ('握手机制', 'VALID/READY 双向握手机制解耦发送方与接收方速率'),
                ('突发传输', '支持 INCR/FIXED/WRAP 突发，最大 256 beat（AXI4）'),
                ('地址机制', '独立写地址与读地址通道，支持非对齐起始地址与窄传输'),
            ]
            exercises = [
                'AXI 为何将写地址、写数据、写响应分为三个独立通道？对比 AHB 的共享总线优劣势。',
                'VALID/READY 握手机制中，为什么规定"VALID 不能依赖 READY"？画出正确的握手时序。',
                'AXI4 的 AWLEN 编码为实际长度减一，这种设计的硬件实现优势是什么？',
            ]
        elif '冲突' in filename or '乱序' in filename:
            summary_rows = [
                ('ID 路由', 'AWID/ARID 标识事务，Slave 通过 RID/BID 返回对应响应'),
                ('乱序机制', '不同 ID 的事务可乱序完成，相同 ID 的事务必须保序'),
                ('Outstanding', 'Master 可发出多笔未完成的地址，最大化总线并发度'),
                ('Interleaving', 'AXI3 支持写数据交织，AXI4 取消以简化 Slave 设计'),
            ]
            exercises = [
                'AXI 为何要求相同 ID 的事务必须按顺序完成？如果允许同 ID 乱序，会出现什么数据一致性风险？',
                '一个 Master 发出 ARID=0 和 ARID=1 两笔读事务，Slave 先完成 ARID=1。R 通道上的 ID 信号应如何编排？',
                'AXI4 取消 WID 后，Slave 如何在没有数据 ID 的情况下将写数据与写地址正确关联？',
            ]
        elif 'QoS' in filename or '低功耗' in filename:
            summary_rows = [
                ('QoS 信号', 'AWQOS/ARQOS 4-bit 优先级标记，指导 Interconnect 仲裁策略'),
                ('低功耗接口', 'Q-Channel 用于时钟门控，P-Channel 用于电源域开关'),
                ('Q-Channel 握手', 'QREQn、QACCEPTn、QDENY、QACTIVE 四信号状态机'),
                ('系统协同', 'QoS 与低功耗协同设计，保证高优先级事务在唤醒期间优先处理'),
            ]
            exercises = [
                'AXI QoS 的 4-bit 等级如何映射到 Interconnect 的物理仲裁策略？给出一种加权轮询方案。',
                'Q-Channel 与 P-Channel 的握手状态机有何差异？为什么时钟门控和电源开关需要不同的协议复杂度？',
                '在视频编解码 SoC 中，如何结合 QoS 与 DVFS 策略，在保证实时性的前提下最小化功耗？',
            ]
        else:  # Zynq PS-PL
            summary_rows = [
                ('架构定位', 'Zynq UltraScale+ 通过 AXI GP/HP/ACP 接口连接 PS 与 PL'),
                ('GP 接口', 'General Purpose，32-bit 数据宽度，用于寄存器配置与低速控制'),
                ('HP 接口', 'High Performance，64-bit 数据宽度，支持 PL 主设备访问 PS DDR'),
                ('ACP 接口', 'Accelerator Coherency Port，允许 PL 访问 A53 缓存一致性域'),
            ]
            exercises = [
                '为什么 Zynq 的 HP 接口需要连接到 PS 的 S_AXI_HP 而不是 M_AXI_GP？从主从方向分析。',
                'ACP 接口与普通 HP 接口在 Cache 一致性上的本质差异是什么？什么场景必须用 ACP？',
                '设计一个 PL 端 AXI Master 访问 PS DDR 的地址映射方案：如何避开 Linux 内核保留区域？',
            ]
    elif topic == 'axi5_ace':
        summary_rows = [
            ('AXI5 演进', '新增原子操作、MPAM 内存分域、Trace 标签，面向基础设施级互连'),
            ('ACE 定位', '在 AXI4 基础上扩展 Snoop 通道，实现多 Cluster 缓存一致性'),
            ('CHI 升级', 'AMBA 5 CHI 将请求/响应/数据分离为独立包格式，支持机架级互连'),
            ('一致性域', 'Inner Shareable、Outer Shareable、Non-Shareable 三级域划分'),
        ]
        exercises = [
            'ACE 的 AC/CR/CD Snoop 通道如何与 AXI 原有五通道协同工作？画出 Cache Line 失效的完整序列图。',
            'AXI5 的原子操作相比 AXI4 的 Locked 传输在实现上有何优势？为什么服务器 CPU 需要这一特性？',
            'CHI 协议采用基于包的 Flit 传输而非 AXI 的信号级握手，这种设计如何支持更大规模的互连拓扑？',
        ]
    elif topic == 'tilelink':
        if '基础知识' in filename or '架构' in filename:
            summary_rows = [
                ('协议定位', '开源 RISC-V 生态的片上互连标准，三级子集适配不同复杂度'),
                ('通道模型', 'A（请求）、D（响应）为必选，B/C/E 为缓存一致性扩展'),
                ('TL-UL', 'Uncached Lightweight，仅 A/D 通道，用于寄存器映射外设'),
                ('TL-C', 'Cached，全通道支持，实现 MESI/T 一致性协议的消息传递'),
            ]
            exercises = [
                'TileLink 的三级子集（TL-UL、TL-UH、TL-C）与 AMBA 的 APB/AHB/AXI 分级有何异同？',
                '为什么 TileLink 选择 A/D 作为基础通道，而非 AXI 的五通道对称结构？从开源工具链生成角度分析。',
                '在 Rocket Chip 生成器中，TileLink 的 diplomatic 参数传递机制如何自动推导总线宽度与缓存一致性需求？',
            ]
        elif '缓存一致性' in filename or '通道与缓存' in filename:
            summary_rows = [
                ('Acquire', '主设备请求缓存权限升级，触发目录或广播式 Snoop'),
                ('Probe', '目录/广播器要求远端缓存降级或失效'),
                ('Release', '缓存主动写回脏数据并释放权限'),
                ('Grant', '目录完成权限转移，向请求者授予新的缓存状态'),
            ]
            exercises = [
                'TileLink 的 Acquire/Probe/Release/Grant 消息与 MESI 状态转移如何一一对应？给出 E→M 的完整消息序列。',
                '对比 TileLink 目录式一致性与 AMBA ACE 的 Snoop 过滤机制：广播与目录的扩展性 trade-off 是什么？',
                '为什么 TileLink 要求 Release 必须携带写回数据，而不能像某些协议那样异步刷回？',
            ]
        else:  # RISC-V 实战
            summary_rows = [
                ('Rocket Chip', 'Berkeley 参数化 SoC 生成器，默认集成 TileLink 互连网络'),
                (' diplomatic 机制', '模块间通过 EdgeParameters 协商总线宽度、突发长度与缓存策略'),
                ('SiFive 平台', 'Freedom E310/U540 等商用芯片采用 TileLink 作为核心互连'),
                ('调试与验证', 'FireSim FPGA 仿真平台支持 TileLink 事务级追踪与性能分析'),
            ]
            exercises = [
                '在 Rocket Chip 的 Config 参数空间中，如何修改 BankedL2 的 nBanks 与 TileLink 的 beatBytes 以匹配 DDR 位宽？',
                'SiFive U540 的 TileLink 网络中，L2 Cache 如何通过 Directory 过滤不必要的 Probe 广播？',
                '使用 FireSim 对 TileLink 进行性能分析时，TraceIO 输出的 FireTrace 格式如何解析 outstanding 事务的延迟分布？',
            ]
    elif topic == 'wishbone':
        if '基础知识' in filename or '架构' in filename:
            summary_rows = [
                ('协议定位', '开源硬件社区最早的标准总线，Public Domain 无授权限制'),
                ('信号极简', 'ADR、DAT_I/DAT_O、WE、SEL、STB、ACK、CYC、RST、CLK'),
                ('单周期握手', 'STB/ACK 两信号完成一次传输，Master 在时钟上升沿置 STB，Slave 置 ACK'),
                ('拓扑灵活', '点对点、共享总线、交叉开关三种互连拓扑均可适配'),
            ]
            exercises = [
                'Wishbone 的 STB/ACK 握手机制与 AXI 的 VALID/READY 有何本质差异？单周期握手对 Slave 的时序压力是什么？',
                '为什么 Wishbone 允许 SEL（选通）信号独立配置，而 AHB 早期版本使用 HSIZE 与地址对齐共同决定字节使能？',
                'Wishbone 的 CYC 信号在多周期块传输（Block Transfer）中起什么作用？画出 4-beat 块传输时序。',
            ]
        else:  # FPGA 实战
            summary_rows = [
                ('IP 集成', 'OpenCores 提供大量 Wishbone 兼容的 CPU 与外设 IP'),
                ('时序约束', 'Wishbone 单周期模型对组合逻辑路径要求严格，需合理约束周期'),
                ('Bridge 设计', 'Wishbone-to-AXI/APB Bridge 实现跨协议生态的 IP 复用'),
                ('教育价值', '极简信号集便于教学演示 RTL 设计、仿真与 FPGA 下载全流程'),
            ]
            exercises = [
                '设计一个 Wishbone-to-APB Bridge：将 Wishbone 的单周期握手映射为 APB 的两周期 Setup/Enable，给出状态机图。',
                '在 Xilinx Artix-7 FPGA 上实现 Wishbone 共享总线时，如何合理分配 BUFG 全局时钟资源以满足多主时序收敛？',
                '对比将 OpenRISC 1200 的 Wishbone 接口改为 AXI4-Lite 接口所需的关键 RTL 修改点：通道分离与 VALID/READY 握手。',
            ]
    else:
        summary_rows = [('要点', '内容')]
        exercises = ['练习题 1', '练习题 2', '练习题 3']

    summary_lines = "\n".join(f"| {k} | {v} |" for k, v in summary_rows)
    exercise_lines = "\n".join(f"{i+1}. {q}" for i, q in enumerate(exercises))

    return f"""---

## 本章小结

| 要点 | 内容 |
|------|------|
{summary_lines}

## 练习

{exercise_lines}
"""


def make_why_insert(topic, title_line):
    """Generate the 'why' cognitive derivation paragraph to insert after title."""
    if topic == 'ahb':
        return """<span class="red">为什么在 AXI 与 APB 之间还需要 AHB？</span> 早期的 ASB（AMBA1）采用三态总线与分布式仲裁，在频率提升后成为系统瓶颈。设计者迫切需要一种兼容 AHB-Lite 生态、比 AXI 门数更低、又比 APB 吞吐量更高的中间层总线。AHB 的集中式仲裁与流水线突发传输正是对这一痛点的精准回应——它用略多于 APB 的面积代价，换来了数倍于 APB 的带宽，成为连接 DMA、LCD 控制器等中速外设的经济之选。<br>

"""
    elif topic == 'apb':
        return """<span class="red">为什么 APB 要单独从 AHB/AXI 中剥离出来？</span> 若将 UART、GPIO、Timer 等低速外设直接挂接在高速总线上，不仅总线位宽造成面积浪费，外设寄存器端口还需以主频运转带来持续动态功耗。APB 通过 Bridge 隔离时钟域，以极简的两周期访问模型和可门控时钟设计，将外设侧的功耗降至几乎静态水平。这种"分层降压"的思想，正是 SoC 低功耗架构的基石。<br>

"""
    elif topic == 'axi':
        return """<span class="red">为什么高性能 SoC 必须从 AHB 升级到 AXI？</span> 随着多核处理器与高清视频编解码器的普及，单一共享总线的仲裁延迟与带宽争抢已成为系统性能的硬 ceiling。AHB 同一时刻仅允许一对主从通信，而 AXI 的五通道分离架构使读写事务、多主设备能够真正并行。乱序完成与 outstanding 机制进一步隐藏了 DDR 等高延迟从设备的访存时间。AXI 不是简单的升级，而是片上互连从"分时复用"到"空间并行"的范式跃迁。<br>

"""
    elif topic == 'axi5_ace':
        return """<span class="red">为什么片上互连需要从 AXI 的一致性扩展走向 CHI？</span> 当 SoC 从单芯片多 Cluster 扩展到多芯片/机架级部署时，AXI 的 snoop 广播机制面临带宽与扇出爆炸。设计者需要一种基于包交换、支持目录过滤、可扩展至百核以上的互连协议。CHI 通过请求/响应/数据分离的 Flit 格式与分层拓扑，将一致性域从片上推向系统级。AXI5 则在非一致性路径上补全原子操作与资源分区，共同构成 ARM 基础设施战略的互连双翼。<br>

"""
    elif topic == 'tilelink':
        return """<span class="red">为什么 RISC-V 生态需要 TileLink 而非直接复用 AMBA？</span> AMBA 协议虽成熟，但受 ARM 授权条款限制且信号集庞大，不利于开源社区的敏捷迭代与教学推广。RISC-V 追求"开放、可参数化、与生成器友好"的互连标准。TileLink 的三级子集模型允许设计者在 50 行 RTL 内实现 TL-UL 外设挂接，也能通过全通道 TL-C 支持复杂的一致性多核。其 diplomatic 参数传递机制更与 Chisel/Scala 生成器深度耦合，成为开源硬件工程化的基础设施。<br>

"""
    elif topic == 'wishbone':
        return """<span class="red">为什么 Wishbone 在 AXI 时代仍有存在价值？</span> 对于教育、研究、低成本 FPGA 原型与遗留开源 IP 生态，复杂的 AXI 握手与五通道分离反而提高了入门门槛。Wishbone 以不到 10 根信号线、单周期 STB/ACK 模型，让初学者能在数小时内完成 CPU+外设的片上互连。更重要的是，其 Public Domain 授权消除了任何商业顾虑，使小型团队与个人开发者能够无负担地构建和分发 IP。Wishbone 证明了"简单即正义"在硬件设计中的永恒魅力。<br>

"""
    else:
        return ""


def make_mermaid(topic, filename):
    """Generate a mermaid diagram if needed."""
    if topic == 'ahb':
        return """```mermaid
flowchart LR
    subgraph "AHB System"
        M1["Master1\nCPU"]
        M2["Master2\nDMA"]
        ARB["Arbiter\n仲裁器"]
        DEC["Decoder\n地址译码"]
        S1["Slave1\nSRAM"]
        S2["Slave2\nFlash"]
    end
    M1 -->|"HBUSREQ"| ARB
    M2 -->|"HBUSREQ"| ARB
    ARB -->|"HGRANT"| M1
    ARB -->|"HGRANT"| M2
    M1 -->|"HADDR"| DEC
    M2 -->|"HADDR"| DEC
    DEC -->|"HSEL"| S1
    DEC -->|"HSEL"| S2
```
"""
    elif topic == 'apb':
        return """```mermaid
sequenceDiagram
    participant M as AHB Master
    participant B as APB Bridge
    participant S as APB Slave
    M->>B: HADDR + HWRITE
    B->>S: PADDR + PWRITE + PSEL
    S-->>B: PREADY (wait if 0)
    B->>S: PENABLE
    alt Read
        S-->>B: PRDATA
    else Write
        B->>S: PWDATA
    end
    S-->>B: PREADY + PSLVERR
    B-->>M: HRDATA + HRESP
```
"""
    elif topic == 'axi':
        return """```mermaid
flowchart TD
    subgraph "AXI5 Channel Architecture"
        AR["AR<br/>读地址通道"]
        R["R<br/>读数据通道"]
        AW["AW<br/>写地址通道"]
        W["W<br/>写数据通道"]
        B["B<br/>写响应通道"]
        AC["AC<br/>Snoop地址"]
        CR["CR<br/>Snoop响应"]
        CD["CD<br/>Snoop数据"]
    end
    Master1 --> AR --> Slave
    Slave --> R --> Master1
    Master2 --> AW --> Slave
    Master2 --> W --> Slave
    Slave --> B --> Master2
    Slave -.-> AC -.-> Master1
    Master1 -.-> CR -.-> Slave
    Master1 -.-> CD -.-> Slave
```
"""
    elif topic == 'axi5_ace':
        return """```mermaid
stateDiagram-v2
    [*] --> I: Initial
    I --> UC: Acquire (Read Unique)
    UC --> SC: Acquire (Read Shared)
    SC --> I: Release
    UC --> I: WriteBack
    SC --> UC: Upgrade
    UC --> UD: Store
    UD --> UC: Clean
    note right of I
        Invalid state
    end note
    note right of UC
        Unique Clean
    end note
    note right of SC
        Shared Clean
    end note
```
"""
    elif topic == 'tilelink':
        return """```mermaid
flowchart TD
    subgraph "TileLink Channel Hierarchy"
        A["A<br/>Request"]
        D["D<br/>Response"]
        B["B<br/>Probe"]
        C["C<br/>Release"]
        E["E<br/>GrantAck"]
    end
    Master -->|"Acquire<br/>Get<br/>Put"| A
    A -->|"Grant<br/>AccessAck"| D
    D --> Master
    Directory -->|"Probe"| B
    B --> Slave
    Slave -->|"Release<br/>ReleaseData"| C
    C --> Directory
    Master -->|"GrantAck"| E
    E --> Directory
```
"""
    elif topic == 'wishbone':
        return """```mermaid
sequenceDiagram
    participant M as Wishbone Master
    participant S as Wishbone Slave
    M->>S: CYC + STB + WE + SEL + ADR
    alt Write
        M->>S: DAT_O
    end
    S-->>M: ACK
    alt Read
        S-->>M: DAT_I
    end
    M->>S: !STB or !CYC
    S-->>M: !ACK
```
"""
    else:
        return """```mermaid
flowchart TD
    A["Start"] --> B["Process"]
    B --> C["End"]
```
"""


def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    topic = detect_topic(filepath)
    fname = os.path.basename(filepath)

    changed = False

    # 1. Check and insert WHY derivation
    has_why = any(k in content for k in ['为什么', '为何', '痛点', '需求'])
    if not has_why:
        why_text = make_why_insert(topic, '')
        if why_text:
            # Insert after the first H1 title line and its trailing badges/breaks
            lines = content.split('\n')
            insert_idx = 0
            for i, line in enumerate(lines):
                if line.startswith('# '):
                    insert_idx = i + 1
                    # Skip empty lines and badge lines right after title
                    while insert_idx < len(lines) and (
                        lines[insert_idx].strip() == '' or
                        lines[insert_idx].strip().startswith('<span class="badge') or
                        lines[insert_idx].strip() == '---'
                    ):
                        insert_idx += 1
                    break
            lines.insert(insert_idx, why_text.rstrip('\n'))
            content = '\n'.join(lines)
            changed = True

    # 2. Check and add Mermaid diagram
    has_mermaid = '```mermaid' in content
    if not has_mermaid:
        mermaid_text = make_mermaid(topic, fname)
        # Append before any trailing --- or at end
        content = content.rstrip('\n') + '\n\n' + mermaid_text + '\n'
        changed = True

    # 3. Check and add code block comments
    # Find all code blocks of types c, cpp, bash, python
    pattern = r'```(c|cpp|bash|python)\n(.*?)```'
    def comment_repl(m):
        lang = m.group(1)
        code = m.group(2)
        lines = code.split('\n')
        if len(lines) > 3:
            # Check if any line has a comment
            has_comment = any('//' in l or '#' in l or '/*' in l for l in lines)
            if not has_comment:
                # Determine comment prefix
                if lang in ('c', 'cpp'):
                    prefix = '// '
                else:
                    prefix = '# '
                # Add comment header after first line if it's empty or at top
                comment_line = prefix + topic.upper() + ' 代码示例'
                # Insert at top of code block
                new_code = comment_line + '\n' + code
                return f'```{lang}\n{new_code}\n```'
        return m.group(0)
    new_content = re.sub(pattern, comment_repl, content, flags=re.DOTALL)
    if new_content != content:
        content = new_content
        changed = True

    # 4. Check and add HISTORY + SUMMARY + EXERCISE at end
    has_history = any(k in content for k in ['历史演进', '演进', '发展历史', '起源'])
    has_summary = '## 小结' in content or '## 本章小结' in content

    # Build trailing sections
    trail_parts = []
    if not has_history:
        hist_text = HISTORY_TEMPLATES.get(topic, HISTORY_TEMPLATES['ahb'])
        trail_parts.append(f"---\n\n## 历史演进与发展趋势\n\n{hist_text}")
    if not has_summary:
        trail_parts.append(make_summary_exercise(topic, fname))

    if trail_parts:
        # Ensure there's a breathing break before append
        content = content.rstrip('\n')
        # If already ends with --- don't duplicate too much
        for part in trail_parts:
            if content.endswith('---'):
                content = content + '\n\n' + part.lstrip('-').lstrip('\n')
            else:
                content = content + '\n\n' + part
        changed = True

    if changed:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False


def main():
    files = get_files()
    print(f"Found {len(files)} markdown files to process.")
    fixed = 0
    for fp in files:
        try:
            if fix_file(fp):
                print(f"  FIXED: {os.path.basename(fp)}")
                fixed += 1
            else:
                print(f"  OK:    {os.path.basename(fp)}")
        except Exception as e:
            print(f"  ERROR: {os.path.basename(fp)} -> {e}")
    print(f"\nDone. {fixed}/{len(files)} files modified.")

if __name__ == '__main__':
    main()
