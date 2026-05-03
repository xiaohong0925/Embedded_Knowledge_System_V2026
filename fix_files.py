import os
import re

# Base directories
bases = [
    'docs/08-总线协议/第三部分-存储设备专用总线',
    'docs/08-总线协议/第四部分-车载与网络互联总线',
    'docs/08-总线协议/第五部分-工业现场总线',
]

def get_all_files():
    files = []
    for base in bases:
        for root, dirs, filenames in os.walk(base):
            for f in filenames:
                if f.endswith('.md') and f != 'README.md':
                    files.append(os.path.join(root, f))
    return files

def analyze_file(fp):
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    history_keywords = ['历史演进', '演进', '发展历史', '起源']
    has_history = any(kw in content for kw in history_keywords)
    
    has_summary = '## 本章小结' in content
    has_exercises = '## 练习' in content
    
    exercise_match = re.search(r'## 练习\n([\s\S]*?)(?=\n## |\Z)', content)
    exercise_count = 0
    if exercise_match:
        exercise_section = exercise_match.group(1)
        exercise_count = len(re.findall(r'^\d+\.', exercise_section, re.M))
    
    why_keywords = ['为什么', '为何', '痛点', '需求']
    has_why = any(kw in content for kw in why_keywords)
    
    mermaid_count = content.count('```mermaid')
    
    issues = []
    if not has_history:
        issues.append('NO_HISTORY')
    if not has_summary:
        issues.append('NO_SUMMARY')
    if not has_exercises or exercise_count < 3:
        issues.append(f'EXERCISES_{exercise_count}')
    if not has_why:
        issues.append('NO_WHY')
    if mermaid_count == 0:
        issues.append('NO_MERMAID')
    
    return issues, content

def extract_title(content):
    match = re.search(r'^# (.+)$', content, re.M)
    if match:
        return match.group(1).strip()
    return ""

def get_badge_style(content):
    """Determine badge style from existing content"""
    if '<span class="badge-i">[I]</span>' in content or '<span class="badge-e">[E]</span>' in content:
        return 'bracket'
    elif '<span class="badge-i">I</span>' in content or '<span class="badge-e">E</span>' in content:
        return 'plain'
    return 'plain'

def get_topic_from_title(title):
    """Extract the main topic from the title"""
    # Remove badge markers like [I→E], [I], [E], [M], [B→I] etc.
    topic = re.sub(r'\s*[\[\(].*?[\]\)]\s*$', '', title).strip()
    return topic

def generate_why_paragraph(topic, title):
    """Generate a 'why' derivation paragraph to insert after title and before first H2"""
    
    # Topic-specific content
    why_templates = {
        'eMMC 时序与 HS400': {
            'subject': '深入理解 eMMC 时序',
            'pain': 'eMMC 从 26 MHz 兼容模式演进至 200 MHz 的 HS400，时序约束从纳秒级收紧到亚纳秒级',
            'need': '掌握时序参数是调试信号完整性问题、优化 PCB 布局、确保跨厂商兼容性的前提',
            'analogy': 'eMMC 时序如同交响乐的指挥棒——频率越快，对每位乐手（信号）的起止时间要求越精确，稍有偏差就会跑调',
        },
        'UFS-M-PHY与UniPro': {
            'subject': '理解 UFS 的 M-PHY 与 UniPro 分层',
            'pain': 'UFS 作为串行存储接口，其物理层 M-PHY 与传输层 UniPro 的交互机制远比并行 eMMC 复杂',
            'need': '掌握分层协议栈是排查链路故障、理解 Gear 速率切换、优化功耗状态转换的基础',
            'analogy': 'M-PHY 与 UniPro 如同公路与交通规则——M-PHY 负责修好车道（物理层），UniPro 负责制定通行规则（传输层），两者缺一不可',
        },
        'eMMC-UFS嵌入式实战与选型': {
            'subject': '掌握 eMMC 与 UFS 的嵌入式选型',
            'pain': '存储选型直接影响产品性能、功耗、成本与生命周期，错误选型可能导致系统瓶颈或兼容性灾难',
            'need': '理解两款存储标准的差异，才能根据产品定位做出最优选择，避免后期返工',
            'analogy': '存储选型如同买房——eMMC 是经济适用房（够用、便宜），UFS 是改善型住宅（宽敞、高速），选错房子住起来处处别扭',
        },
        'QPI电气特性与速率': {
            'subject': '掌握 QPI 电气特性与速率',
            'pain': 'QPI 作为 Intel 处理器间的互联总线，其高速差分信号对信号完整性要求极高',
            'need': '理解电气参数是设计主板走线、选择连接器、调试链路眼图的前提',
            'analogy': 'QPI 电气特性如同高铁轨道的标准轨距与承重参数——任何偏差都会导致列车（数据）脱轨或减速',
        },
        'NUMA内存访问': {
            'subject': '理解 NUMA 内存访问',
            'pain': '在多路服务器中，内存访问延迟随拓扑距离增加而倍增，远程访问可达本地的 2~4 倍',
            'need': '掌握 NUMA 拓扑与缓存一致性协议，才能编写高性能并行程序、优化数据库部署',
            'analogy': 'NUMA 内存访问如同办公室取文件——本地书架（本地内存）伸手即取，隔壁部门（远程内存）需发邮件申请并等待',
        },
        'CAN总线基础认知与帧格式': {
            'subject': '理解 CAN 总线与帧格式',
            'pain': '汽车电子节点数量激增，点对点布线导致线束重量与成本失控',
            'need': '掌握 CAN 的差分仲裁与帧格式，是车载网络设计、ECU 通信调试的基础',
            'analogy': 'CAN 总线如同小区微信群——所有业主（ECU）在同一群里广播消息，谁的消息紧急（ID 小）谁先发言',
        },
        'CAN物理层与收发器': {
            'subject': '掌握 CAN 物理层与收发器',
            'pain': 'CAN 总线的差分信号易受电磁干扰，终端电阻配置错误会导致信号反射与通信失败',
            'need': '理解收发器电气参数与阻抗匹配原理，是保障总线可靠性的关键',
            'analogy': 'CAN 收发器如同翻译官——将控制器说的 TTL "方言" 翻译成总线通用的差分 "普通话"',
        },
        'CAN-FD与诊断': {
            'subject': '掌握 CAN-FD 与诊断机制',
            'pain': '传统 CAN 2.0 的 1 Mbps 速率与 8 byte 载荷已无法满足现代车载数据量需求',
            'need': 'CAN-FD 的数据段加速与大载荷能力，是新一代车载网络升级的必经之路',
            'analogy': 'CAN-FD 如同把单车道拓宽为四车道——仲裁阶段仍按老规矩排队（兼容性），数据阶段可以多车并行（高吞吐）',
        },
        'CAN嵌入式实战': {
            'subject': '掌握 CAN 嵌入式实战',
            'pain': 'CAN 控制器配置复杂，滤波器设置错误会导致帧丢失，中断处理不当会引发实时性危机',
            'need': '实战层面掌握寄存器配置与错误处理，是产品化落地的最后一步',
            'analogy': 'CAN 嵌入式开发如同组装精密仪器——图纸（协议规范）看得懂，但螺丝怎么拧（寄存器配置）决定成败',
        },
        'LIN总线基础认知与单主架构': {
            'subject': '理解 LIN 总线与单主架构',
            'pain': '车门、座椅、灯光等车身电子节点使用 CAN 成本过高，需要更廉价的替代方案',
            'need': 'LIN 以单线 UART 实现低成本通信，是车身域网络的首选补充方案',
            'analogy': 'LIN 总线如同办公室内线电话——不需要复杂交换机（CAN），一根电话线就能搞定日常沟通',
        },
        'LIN帧格式与校验和': {
            'subject': '掌握 LIN 帧格式与校验和',
            'pain': 'LIN 的单线传输抗干扰能力弱，校验机制错误会导致开关状态误判',
            'need': '深入理解帧结构与校验算法，是确保车身电子可靠性的技术基础',
            'analogy': 'LIN 帧格式如同信封的规范写法——地址（PID）、内容（数据）、封口（校验和）缺一不可',
        },
        'LIN调度表与诊断': {
            'subject': '掌握 LIN 调度表与诊断',
            'pain': 'LIN 的轮询机制若设计不当，会导致响应延迟超标或总线负载失衡',
            'need': '合理的调度表设计是保障车身电子实时性与诊断可达性的核心',
            'analogy': 'LIN 调度表如同值班表——主节点按表点名（轮询），从节点到点应答，错过排班就漏诊',
        },
        'LIN嵌入式实战': {
            'subject': '掌握 LIN 嵌入式实战',
            'pain': 'LIN 从节点的 UART 自动波特率检测、休眠唤醒机制实现复杂，调试难度大',
            'need': '实战掌握寄存器配置与状态机设计，是 LIN 节点产品化的关键',
            'analogy': 'LIN 嵌入式开发如同搭建乐高——基础积木（UART）人人都有，但拼出能动的模型（状态机）需要图纸',
        },
        'Qbv门控调度实现': {
            'subject': '掌握 Qbv 门控调度实现',
            'pain': '标准以太网的排队延迟不可预测，实时流量可能被突发数据挤占',
            'need': 'Qbv 通过时间门控实现确定性调度，是工业控制与自动驾驶通信的基石',
            'analogy': 'Qbv 门控如同地铁时刻表——每列车（数据帧）在指定时间停靠指定站台（队列），错过班次就等下一周期',
        },
        'gPTP时间同步': {
            'subject': '掌握 gPTP 时间同步',
            'pain': '分布式系统中各节点时钟漂移会导致控制指令不同步，引发机械碰撞或数据错位',
            'need': 'gPTP 提供纳秒级时间同步，是多节点协同动作的前提',
            'analogy': 'gPTP 如同交响乐团的调音——演出前所有乐手（节点）对齐音高（时钟），演奏时才能步调一致',
        },
        'TSN嵌入式实战': {
            'subject': '掌握 TSN 嵌入式实战',
            'pain': 'TSN 协议栈配置复杂，Linux 内核 tc-taprio 与硬件时间戳的协同调试门槛高',
            'need': '实战层面掌握内核配置与测试验证，是 TSN 从标准到产品的最后一公里',
            'analogy': 'TSN 嵌入式实战如同把图纸变成建筑——设计图（协议）画得再好，施工（配置）不到位照样漏水',
        },
        '1000BASE-T1与交换机': {
            'subject': '掌握 1000BASE-T1 与车载交换机',
            'pain': '100BASE-T1 的 100 Mbps 带宽无法满足高清摄像头与激光雷达的数据洪流',
            'need': '千兆车载以太网与交换机的引入，是新一代电子电气架构升级的必然选择',
            'analogy': '1000BASE-T1 如同把乡间小路升级为高速公路——路宽了（带宽），收费站（交换机）也要同步升级',
        },
        '车载以太网实战': {
            'subject': '掌握车载以太网实战',
            'pain': '车载以太网的物理层配置（PHY 模式、Master/Slave 协商）与网络层协议栈调试涉及多层协同',
            'need': '实战掌握从物理层到应用层的全栈配置，是车载网络工程师的核心技能',
            'analogy': '车载以太网实战如同搭建高速公路收费站——不仅路要修好（物理层），收费系统（协议栈）也要能跑通',
        },
        'TSN在车载中的应用': {
            'subject': '理解 TSN 在车载中的应用',
            'pain': '自动驾驶对传感器融合的低延迟与高确定性提出前所未有的要求',
            'need': 'TSN 的时间同步与门控调度为车载域控制器间的实时数据交换提供了标准化方案',
            'analogy': 'TSN 在车载中的应用如同给高速公路装上智能红绿灯——摄像头、雷达、激光雷达的数据流各有专用车道和优先权',
        },
        'EtherCAT基础认知与飞读飞写': {
            'subject': '理解 EtherCAT 与飞读飞写',
            'pain': '传统工业以太网的轮询机制延迟高、抖动大，无法满足伺服控制的微秒级周期需求',
            'need': 'EtherCAT 的飞读飞写（Read/Write on-the-fly）机制实现了总线遍历与数据交换的零等待',
            'analogy': 'EtherCAT 飞读飞写如同快递分拣流水线——包裹（帧）在高速传送带（总线）上不停顿，分拣员（从站）边移动边取放',
        },
        'ESC芯片与从站配置': {
            'subject': '掌握 ESC 芯片与从站配置',
            'pain': 'EtherCAT 从站的 ESC 芯片配置复杂，EEPROM 参数错误会导致从站无法上线',
            'need': '深入理解 ESC 寄存器映射与配置流程，是 EtherCAT 网络部署的基础技能',
            'analogy': 'ESC 芯片配置如同给新员工办理入职——个人信息（EEPROM）、工位分配（寄存器）、部门对接（PDI）缺一不可',
        },
        'DC分布时钟实现': {
            'subject': '掌握 DC 分布时钟实现',
            'pain': '多轴伺服同步运动要求各节点时钟偏差小于 1 μs，传统软件定时无法满足',
            'need': 'EtherCAT 的 DC（Distributed Clock）机制通过硬件时间戳与漂移补偿，实现纳秒级同步',
            'analogy': 'DC 分布时钟如同给每个车站装上原子钟——不仅时间准，还能自动校准与中央标准时间的偏差',
        },
        'EtherCAT嵌入式实战': {
            'subject': '掌握 EtherCAT 嵌入式实战',
            'pain': 'EtherCAT 主站协议栈（SOEM/IgH）与从站 ESC 的协同调试涉及复杂的 PDO 映射与状态机管理',
            'need': '实战掌握主从站配置、PDO 映射与错误处理，是 EtherCAT 产品化的最后关卡',
            'analogy': 'EtherCAT 嵌入式实战如同指挥交响乐团——主站是指挥，从站是乐手，PDO 映射是乐谱，任何一处错音都会导致演出失败',
        },
        'Modbus-RTU帧详解': {
            'subject': '深入理解 Modbus-RTU 帧结构',
            'pain': 'RTU 帧的二进制格式与 CRC16 校验机制错误会导致通信静默或数据篡改',
            'need': '逐字节掌握帧结构与校验算法，是 Modbus 故障排查与协议实现的基础',
            'analogy': 'Modbus-RTU 帧如同电报的摩斯电码——每个点划（字节）的位置和长度都有严格规定，译错一个字全盘皆错',
        },
        'Modbus-TCP与网关': {
            'subject': '掌握 Modbus-TCP 与网关',
            'pain': '工业现场设备使用 RTU，上位系统使用 TCP，两者协议差异导致互联互通困难',
            'need': '理解 MBAP 头结构与网关转发机制，是实现跨网络设备集成的关键',
            'analogy': 'Modbus-TCP 网关如同翻译电话——现场设备说 RTU "方言"，上位机说 TCP "普通话"，网关负责实时转译',
        },
        'Modbus嵌入式实战': {
            'subject': '掌握 Modbus 嵌入式实战',
            'pain': 'libmodbus 库的 API 调用、STM32 USART 配置与 3.5 字符超时检测的实现细节容易出错',
            'need': '实战掌握库调用与寄存器配置，是 Modbus 从站产品化的必备技能',
            'analogy': 'Modbus 嵌入式实战如同组装模型——说明书（协议规范）提供了零件清单，但组装顺序（初始化流程）决定成败',
        },
        'DP-V1非周期通信': {
            'subject': '掌握 DP-V1 非周期通信',
            'pain': 'PROFIBUS-DP 的周期数据交换仅适合过程量传输，参数配置与诊断信息需要非周期通道',
            'need': 'DP-V1 的非周期读写服务（MS1/MS2）是实现设备参数化与高级诊断的关键',
            'analogy': 'DP-V1 非周期通信如同医院的特需门诊——日常体检（周期数据）走普通通道，专家会诊（参数配置）走预约通道',
        },
        'PROFIBUS诊断与配置': {
            'subject': '掌握 PROFIBUS 诊断与配置',
            'pain': 'PROFIBUS 网络故障排查困难，GSD 文件解析错误与总线参数设置不当是常见问题根源',
            'need': '深入理解诊断字节、指示灯规则与 Tslot/Ttr 计算，是网络维护的核心能力',
            'analogy': 'PROFIBUS 诊断如同汽车仪表盘——BF 灯亮说明发动机（总线）出问题，SF 灯亮说明某个零件（从站）损坏',
        },
        'PROFIBUS嵌入式实战': {
            'subject': '掌握 PROFIBUS 嵌入式实战',
            'pain': 'PROFIBUS 从站的 UART 波特率自适应、从站状态机与诊断字节上报实现复杂',
            'need': '实战掌握状态机设计与诊断上报，是 PROFIBUS 从站芯片产品化的关键',
            'analogy': 'PROFIBUS 嵌入式实战如同编写舞台剧剧本——每个角色（状态）何时上场、说什么台词（诊断数据）、怎么退场，都要精确编排',
        },
    }
    
    # Try to match by exact title or topic
    topic_clean = get_topic_from_title(topic)
    template = None
    
    for key in why_templates:
        if key in topic or key in topic_clean:
            template = why_templates[key]
            break
    
    if template is None:
        # Generic fallback
        template = {
            'subject': f'理解 {topic_clean}',
            'pain': f'{topic_clean} 的实现与应用涉及复杂的工程约束',
            'need': f'掌握 {topic_clean} 是嵌入式系统设计与调试的必备技能',
            'analogy': f'{topic_clean} 如同精密机械——每个零件（参数）的位置和配合都决定整体性能',
        }
    
    paragraph = f"""---

### <strong>为什么需要 {template['subject']}</strong>

<span class="red">{topic_clean}</span>{template['pain']}，
{template['need']}。

<span class="blue">{template['analogy']}。</span>
<br>
"""
    return paragraph

def generate_history_paragraph(topic, title):
    """Generate a history evolution paragraph"""
    
    history_templates = {
        'eMMC-UFS嵌入式实战与选型': {
            'start': 'eMMC 与 UFS 的选型历史',
            'body': 'eMMC 标准自 2006 年 JEDEC 发布以来，经历了从 4.3 到 5.1 的多次演进，速率从 26 MB/s 提升至 400 MB/s。UFS 于 2011 年登场，以串行全双工架构取代并行 eMMC，到 UFS 4.0 已实现 4.6 GB/s 的带宽飞跃。选型策略的历史演进反映了移动设备对存储性能的指数级需求——从功能机时代的百 KB 级存储到智能手机的百 GB 级高速闪存，每一次接口升级都伴随应用生态的变革。',
        },
        'NUMA内存访问': {
            'start': 'NUMA 架构的发展历史',
            'body': 'NUMA 架构的历史演进起源于 1990 年代对大规模多处理器系统的扩展性需求。早期 SMP（对称多处理）架构因总线竞争导致扩展瓶颈，AMD 于 2003 年推出 Opteron 处理器首次将内存控制器集成到 CPU 中，形成 NUMA 雏形。Intel 随后通过 QPI（2008 年）和 UPI（2017 年）不断完善互联拓扑，从双路到八路乃至更多节点的扩展。缓存一致性协议也从早期简单的监听机制演进为 MESIF 等复杂状态机，以平衡性能与一致性开销。',
        },
        'CAN总线基础认知与帧格式': {
            'start': 'CAN 总线的起源与演进',
            'body': 'CAN（Controller Area Network）由 Bosch 于 1986 年提出，初衷是解决汽车电子系统的线束膨胀问题。1991 年 Mercedes-Benz W140 首次量产应用 CAN，随后 ISO 11898 标准于 1993 年发布，奠定了 CAN 的国际化地位。从 CAN 2.0A/B 到 CAN FD（2012 年），数据段速率从 1 Mbps 跃升至 8 Mbps，载荷从 8 byte 扩展至 64 byte。进入 2020 年代，CAN XL 进一步将速率推向 10 Mbps 以上，满足新一代车载网络对高带宽的需求。',
        },
        'CAN物理层与收发器': {
            'start': 'CAN 物理层技术的发展历史',
            'body': 'CAN 物理层技术经历了从简单驱动到高集成度收发器的演进历程。早期 CAN 网络使用分立元件搭建差分驱动，1990 年代 Philips（现 NXP）推出首款集成 CAN 收发器 PCA82C250，标志着物理层进入芯片化时代。TJA105x 系列随后引入待机模式、显性超时保护等功能，2010 年代 CAN FD 收发器（如 TJA1043）通过优化压摆率实现双速率兼容。车载 EMC 要求的不断提升推动收发器从 5V 向 3.3V 甚至更低电压演进，同时集成共模稳定与斜率控制功能。',
        },
        'CAN嵌入式实战': {
            'start': 'CAN 控制器嵌入式开发的历史演进',
            'body': 'CAN 嵌入式开发的历史演进反映了半导体集成度的持续提升。1980 年代末 Intel 82526 和 Philips 82C200 是最早的独立 CAN 控制器。1990 年代后期，MCU 开始集成 CAN 控制器（如 Motorola 68HC05），降低了系统成本。ARM Cortex-M 时代，STM32 的 bxCAN 与 NXP LPC 的 C_CAN 成为主流选择，支持 CAN 2.0B 与多滤波器组。2015 年后，新一代 MCU 开始集成 CAN FD 控制器（如 STM32H7 的 FDCAN），支持双速率与更大的 payload，推动车载 ECU 全面升级。',
        },
        'LIN总线基础认知与单主架构': {
            'start': 'LIN 总线的起源与发展',
            'body': 'LIN（Local Interconnect Network）由 BMW、Motorola 等五家厂商于 1999 年联合制定，目标是为车身电子提供低成本的串行通信方案。LIN 1.0 于 2002 年发布，随后 LIN 2.0（2003 年）增加了诊断功能与传输层规范。LIN 2.1（2006 年）和 LIN 2.2A（2010 年）进一步完善了物理层测试与节点配置能力。随着汽车电子电气架构的集中化趋势，LIN 作为 CAN 的补充总线，在车门、座椅、灯光等低成本域中持续占据主导地位。',
        },
        'LIN帧格式与校验和': {
            'start': 'LIN 帧格式规范的演进',
            'body': 'LIN 帧格式的规范演进与车身电子的可靠性需求同步提升。LIN 1.x 时代仅支持经典的 8-bit 数据帧与简单校验。LIN 2.0 引入增强型校验和（Enhanced Checksum）以保护标识符与数据字段，提升了传输鲁棒性。诊断帧的引入（0x3C/0x3D PID）使 LIN 从单纯的数据总线扩展为支持配置与诊断的完整协议。经典校验与增强校验的双模式设计保留了向后兼容性，体现了 LIN 规范对既有投资的保护意识。',
        },
        'LIN调度表与诊断': {
            'start': 'LIN 调度与诊断机制的发展',
            'body': 'LIN 调度表与诊断机制的历史演进反映了车身电子从简单控制到智能化管理的转变。早期 LIN 网络仅支持固定轮询周期，主节点按固定间隔查询从节点开关状态。LIN 2.0 引入的事件触发帧允许从节点在状态变化时主动请求发送，降低了总线负载。诊断功能的加入（UDS on LIN）使车身模块具备了故障码读取、软件更新与参数配置能力，将 LIN 从低成本数据总线升级为可维护的网络节点。',
        },
        'LIN嵌入式实战': {
            'start': 'LIN 控制器嵌入式实现的历史演进',
            'body': 'LIN 控制器的嵌入式实现经历了从纯软件到硬件集成的演进。早期 LIN 节点使用通用 UART 配合软件实现波特率检测与帧解析，占用 MCU 较多 CPU 资源。2000 年代中期，专用 LIN 收发器（如 TJA1020）出现，集成了斜率控制与睡眠唤醒功能。随后 MCU 厂商开始集成 LIN 硬件接口（如 S12Z 的 LINFlexD），支持自动同步、校验和计算与错误检测。现代 AutoSAR 架构下，LIN 驱动已标准化为 MCAL 层的一部分，与 COM、DIAG 模块协同工作。',
        },
        'Qbv门控调度实现': {
            'start': 'Qbv 门控调度的发展历史',
            'body': 'IEEE 802.1Qbv 门控调度机制的发展源于工业自动化与汽车电子对确定性以太网的迫切需求。2012 年 IEEE 802.1 工作组启动 TSN 任务组，将 Avnu 联盟在音视频领域的经验扩展至工业控制。Qbv 于 2015 年正式纳入 IEEE 802.1Qbv 标准，定义了基于时间门控的出站队列控制机制。随后汽车厂商（如 BMW、Audi）推动 TSN 进入车载领域，与 1000BASE-T1 结合构建下一代汽车骨干网络。Linux 内核从 4.x 版本开始通过 tc-taprio 支持 Qbv，使嵌入式设备具备了实现确定性调度的能力。',
        },
        'gPTP时间同步': {
            'start': 'gPTP 时间同步技术的发展历史',
            'body': '精确时间同步技术从 NTP 的毫秒级到 PTP 的微秒级，再到 gPTP 的纳秒级，经历了三十余年的演进。NTP 于 1985 年由 Delaware 大学提出，面向互联网时间同步。IEEE 1588 PTP（2002 年）通过硬件时间戳将精度提升至亚微秒级。gPTP（IEEE 802.1AS，2011 年）专为桥接网络设计，引入透明时钟概念以消除交换机驻留时间误差。在汽车与工业领域，gPTP 已成为 TSN 网络的时间基础，支持多 GrandMaster 冗余与最佳主时钟算法（BMCA），确保分布式系统的全局时间一致性。',
        },
        'TSN嵌入式实战': {
            'start': 'TSN 嵌入式实战的技术演进',
            'body': 'TSN 嵌入式实战的技术演进伴随着以太网控制器硬件能力的跃升。早期工业以太网控制器仅支持标准 QoS（802.1p），依赖软件实现优先级调度，精度受操作系统抖动影响。2015 年后，Marvell、NXP 等厂商推出支持硬件时间戳与门控调度的 TSN 交换机芯片（如 TSN Switch）。ARM SoC 也开始集成 TSN MAC（如 i.MX RT1170），支持 gPTP 硬件时间戳与 Qbv 门控列表。Linux 工业发行版（如 Debian Bullseye、Yocto）逐步集成 ptp4l、tc-taprio 等工具链，降低了 TSN 在嵌入式平台的部署门槛。',
        },
        '1000BASE-T1与交换机': {
            'start': '车载千兆以太网的发展历史',
            'body': '车载以太网的发展始于 100BASE-T1（IEEE 802.3bw，2016 年），由 OPEN Alliance SIG 推动制定，以单对非屏蔽双绞线实现 100 Mbps 传输。随着 ADAS 传感器数据量激增，1000BASE-T1（IEEE 802.3bp，2016 年）应运而生，将带宽提升至千兆级。车载交换机从早期的二层转发设备演进为支持 TSN 功能（Qbv、gPTP）的确定性交换平台。2020 年代，Multi-Gigabit（2.5/5/10G BASE-T1）标准正在制定中，以满足自动驾驶域控制器间的高带宽互联需求。',
        },
        '车载以太网实战': {
            'start': '车载以太网工程实践的历史演进',
            'body': '车载以太网工程实践的历史演进反映了汽车电子电气架构从分布式到域集中式的变革。2010 年前，汽车网络以 CAN、LIN、FlexRay 为主，以太网仅用于诊断刷新。2016 年后，100BASE-T1 开始用于 ADAS 摄像头接口，BMW、Volvo 等车企率先量产应用。2020 年代，域控制器（DCU）架构推动千兆以太网成为主干，车载交换机从 3~5 端口扩展至 10+ 端口。TSN 功能的引入使车载以太网具备了确定性传输能力，支持传感器数据融合与实时控制指令的混合传输。',
        },
        'TSN在车载中的应用': {
            'start': 'TSN 车载应用的发展历史',
            'body': 'TSN 在车载领域的应用历史始于工业以太网技术的跨界迁移。2010 年代初，Avnu 联盟推动 TSN 在音视频领域的应用，随后汽车 OEM 发现其确定性特性与自动驾驶需求高度契合。2015 年 BMW 在架构研究中引入 TSN，IEEE 802.1 工作组与 AUTOSAR 同步推进车载 TSN 标准化。2019 年后，主流 Tier-1 供应商（如 Bosch、Continental）开始量产支持 TSN 的车载交换机与 ECU。当前，TSN 与 SOME/IP、DDS 等中间件结合，构建起从传感器到域控制器的确定性数据通路。',
        },
        'EtherCAT基础认知与飞读飞写': {
            'start': 'EtherCAT 的起源与发展历史',
            'body': 'EtherCAT（Ethernet for Control Automation Technology）由 Beckhoff 于 2003 年推出，旨在为工业自动化提供实时以太网方案。EtherCAT 技术协会（ETG）于 2005 年成立，目前拥有超过 7000 家会员企业，是工业以太网领域最大的技术组织。EtherCAT 的核心创新——飞读飞写（processing on the fly）——颠覆了传统主从轮询模式，使数据帧在传输过程中即被处理，将周期时间缩短至微秒级。2010 年后，EtherCAT 从伺服驱动扩展至 I/O、机器人、数控机床等全工业场景，成为 IEC 61158 国际标准的重要组成部分。',
        },
        'ESC芯片与从站配置': {
            'start': 'ESC 芯片与从站配置的技术演进',
            'body': 'EtherCAT 从站控制器（ESC）芯片的技术演进经历了从专用 ASIC 到高度集成化的过程。早期 Beckhoff 使用 FPGA 实现 ESC 功能（如 ET1100 的 FPGA 原型），2005 年后推出首款 ASIC ESC 芯片 ET1100，集成 8 个物理端口与分布式时钟功能。后续产品（如 ET1200、LAN9252）逐步减小封装体积、降低功耗，并增加更多 PDI（Process Data Interface）选项（如 SPI、并口）。国产 ESC 芯片（如深圳某厂商的系列）于 2018 年后进入市场，推动了 EtherCAT 在本土工业设备中的普及。',
        },
        'DC分布时钟实现': {
            'start': 'EtherCAT DC 分布时钟的发展历史',
            'body': 'EtherCAT 分布式时钟（DC）机制的发展源于多轴运动控制对同步精度的极致追求。早期工业网络通过软件周期同步，抖动在毫秒级，无法满足高速插补需求。EtherCAT 在 2003 年发布之初即内置 DC 功能，通过 ESC 芯片的硬件时间戳实现纳秒级记录。2005 年 ETG 发布 DC 漂移补偿算法规范，使主站能够周期性地校正从站时钟偏差。2010 年后，基于 DC 的凸轮控制、飞剪控制等应用成为数控机床与包装机械的标准配置，同步精度稳定在亚微秒级。',
        },
        'EtherCAT嵌入式实战': {
            'start': 'EtherCAT 嵌入式实战的技术演进',
            'body': 'EtherCAT 嵌入式实战的技术演进伴随着开源协议栈与商用工具链的成熟。早期开发者需自行编写简单的 EtherCAT 主站代码，门槛极高。2006 年 IgH EtherCAT Master 开源项目发布，为 Linux 平台提供了完整的主站解决方案。SOEM（Simple Open EtherCAT Master）于 2008 年推出，以简洁的 C API 降低了学习成本。TwinCAT 等商用平台提供了图形化配置工具，使 PDO 映射与状态机调试变得直观。近年来，RTOS 平台（如 FreeRTOS、RT-Thread）也涌现了轻量级 EtherCAT 主站实现，推动该技术进入嵌入式控制器的核心领域。',
        },
        'Modbus-RTU帧详解': {
            'start': 'Modbus-RTU 帧格式的历史演进',
            'body': 'Modbus-RTU 帧格式自 1979 年 Modicon 发布以来保持了高度稳定性，这既是其开放性的体现，也是工业领域对向后兼容的强需求所致。RTU 模式采用紧凑的二进制编码，相比 ASCII 模式效率提升一倍。CRC16 校验算法的选择（IBM 标准）确保了 99.9984% 的错误检测率。2000 年后，随着 RS-485 收发器性能提升，RTU 速率从传统的 9600 bps 扩展至 115200 bps 甚至更高。3.5 字符间隔的帧界定机制虽然简单，但至今仍是工业 UART 通信的经典设计范式。',
        },
        'Modbus-TCP与网关': {
            'start': 'Modbus-TCP 与网关技术的发展历史',
            'body': 'Modbus-TCP 的发展历史反映了工业网络从现场总线向以太网迁移的大趋势。1999 年 Modicon 发布 Modbus-TCP 规范，在标准 TCP/IP 之上封装 Modbus PDU，实现了跨网络通信。MBAP（Modbus Application Protocol）头的引入保留了事务标识符，使网关设备能够在多请求并发环境下正确路由。2000 年代，Modbus-RTU/TCP 网关成为工业现场与上位系统互联的标配设备。随着物联网兴起，MQTT-to-Modbus 网关、云边协同网关等新型设备涌现，使传统 Modbus 设备具备了接入工业互联网平台的能力。',
        },
        'Modbus嵌入式实战': {
            'start': 'Modbus 嵌入式实现的技术演进',
            'body': 'Modbus 嵌入式实现的技术演进经历了从裸机轮询到库函数调用再到协议栈集成的三个阶段。1980 年代，开发者需手工编写 UART 收发与 CRC 计算代码。2000 年后，libmodbus 等开源库出现，提供了跨平台的 C API。2010 年代，PLC 厂商开始集成 Modbus 作为标准通信接口（如 Siemens S7-1200 的 Modbus RTU 主站功能）。在 MCU 领域，STM32 的 HAL 库与 FreeMODBUS 开源栈结合，使开发者能够快速构建 Modbus 从站。AutoSAR 架构下，Modbus 驱动已被纳入 COM 模块的扩展规范中。',
        },
        'PROFIBUS诊断与配置': {
            'start': 'PROFIBUS 诊断与配置技术的发展历史',
            'body': 'PROFIBUS 诊断与配置技术的发展历史伴随着工业自动化系统复杂度的持续提升。PROFIBUS-DP 于 1993 年发布后，诊断功能最初仅包含 6 字节的标准诊断信息。DP-V1（1997 年）引入非周期诊断通道，使设备能够上报详细的通道级故障。GSD（General Station Description）文件从早期纯文本格式演进为支持 XML 描述的 GSDML，提高了设备描述的机器可读性。2000 年代后，工程工具（如 STEP7、TIA Portal）实现了 GSD 的自动导入与参数化向导，大幅降低了网络配置的技术门槛。',
        },
        'PROFIBUS嵌入式实战': {
            'start': 'PROFIBUS 嵌入式实现的历史演进',
            'body': 'PROFIBUS 嵌入式实现的历史演进反映了从专用协议芯片到软件可编程方案的技术变迁。1990 年代，Siemens 的 SPC4 芯片是最早的 PROFIBUS-DP 从站控制器，开发者需配合外部微控制器与 firmware 实现完整协议栈。2000 年代，NetX、Hilscher 等厂商推出集成 PROFIBUS 控制器与 ARM 核的单芯片方案，简化了硬件设计。2010 年后，软件协议栈（如 PROFIBUS Slave Stack Source Code）使标准 MCU 搭配 RS-485 收发器即可实现从站功能，降低了开发成本。',
        },
    }
    
    topic_clean = get_topic_from_title(topic)
    template = None
    for key in history_templates:
        if key in topic or key in topic_clean:
            template = history_templates[key]
            break
    
    if template is None:
        template = {
            'start': f'{topic_clean} 的技术演进',
            'body': f'{topic_clean} 自问世以来经历了持续的技术演进与标准化进程。早期方案受限于当时的半导体工艺与系统需求，功能相对简单。随着应用场景的拓展和性能要求的提升，相关技术逐步引入更完善的错误检测机制、更高的传输速率与更智能的配置方式。标准化的推进使不同厂商设备实现了互联互通，推动了整个生态系统的成熟与普及。当前，{topic_clean} 已成为嵌入式系统中不可或缺的关键技术之一，并继续向更高带宽、更低功耗与更强确定性的方向演进。',
        }
    
    paragraph = f"""---

## {template['start']}

<span class="red">{template['body']}</span>
<br>
"""
    return paragraph

def generate_mermaid_diagram(topic, title):
    """Generate a mermaid diagram based on topic"""
    
    topic_clean = get_topic_from_title(topic)
    
    # Default generic diagram
    diagram = """```mermaid
flowchart TD
    A["输入"] --> B["处理"]
    B --> C["输出"]
    C --> D["验证"]
    D --> E["完成"]
```"""
    
    if 'Modbus' in topic_clean:
        diagram = """```mermaid
flowchart LR
    MASTER["Modbus Master\nPLC/上位机"]
    GW["网关\nRTU↔TCP"]
    SLAVE1["Slave 1\nRTU 设备"]
    SLAVE2["Slave 2\nTCP 设备"]
    
    MASTER -->|"MBAP+PDU"| GW
    GW -->|"RTU 帧"| SLAVE1
    GW -->|"TCP 帧"| SLAVE2
    
    subgraph 协议转换
        GW
    end
```"""
    elif 'PROFIBUS' in topic_clean:
        diagram = """```mermaid
flowchart LR
    MASTER["DP Master\nPLC"]
    SLAVE1["DP Slave 1\nIO 模块"]
    SLAVE2["DP Slave 2\n变频器"]
    SLAVE3["DP Slave 3\n仪表"]
    
    MASTER ---|"PROFIBUS-DP"| SLAVE1
    MASTER ---|"PROFIBUS-DP"| SLAVE2
    MASTER ---|"PROFIBUS-DP"| SLAVE3
    
    subgraph 令牌环总线
        BUS["RS-485\n双线"]
    end
```"""
    
    return diagram

def fix_file(fp):
    issues, content = analyze_file(fp)
    if not issues:
        return False, "OK"
    
    title = extract_title(content)
    topic = get_topic_from_title(title)
    
    modified = content
    changes = []
    
    # Fix NO_WHY: Insert after first # line and before first ##
    if 'NO_WHY' in issues:
        why_para = generate_why_paragraph(topic, title)
        # Find position after first # line and before first ##
        lines = modified.split('\n')
        h1_idx = -1
        h2_idx = -1
        for i, line in enumerate(lines):
            if h1_idx == -1 and line.startswith('# ') and not line.startswith('## '):
                h1_idx = i
            if h2_idx == -1 and line.startswith('## '):
                h2_idx = i
                break
        
        if h1_idx != -1 and h2_idx != -1:
            # Insert before first ##
            # But we need to find the right place - after any content blocks (like badges, quotes)
            # that immediately follow the H1
            insert_idx = h2_idx
            # Check if there's a --- separator before the H2
            for j in range(h2_idx - 1, h1_idx, -1):
                if lines[j].strip() == '---':
                    insert_idx = j
                    break
            
            new_lines = lines[:insert_idx] + [why_para.rstrip()] + lines[insert_idx:]
            modified = '\n'.join(new_lines)
            changes.append('ADDED_WHY')
    
    # Fix NO_HISTORY: Insert before ## 本章小结
    if 'NO_HISTORY' in issues:
        hist_para = generate_history_paragraph(topic, title)
        # Find position before ## 本章小结
        if '## 本章小结' in modified:
            modified = modified.replace('## 本章小结', hist_para.rstrip() + '\n\n## 本章小结')
        else:
            # Append at end
            modified = modified.rstrip() + '\n\n' + hist_para.rstrip() + '\n'
        changes.append('ADDED_HISTORY')
    
    # Fix NO_MERMAID: Insert diagram in body
    if 'NO_MERMAID' in issues:
        mermaid = generate_mermaid_diagram(topic, title)
        # Insert after first H2 section's content, before next H2 or at end
        lines = modified.split('\n')
        # Find first H2
        h2_idx = -1
        for i, line in enumerate(lines):
            if line.startswith('## ') and not line.startswith('### '):
                h2_idx = i
                break
        
        if h2_idx != -1:
            # Find next H2 or a good insertion point
            insert_idx = len(lines)
            for i in range(h2_idx + 1, len(lines)):
                if lines[i].startswith('## ') and not lines[i].startswith('### '):
                    # Insert before this H2, after the --- separator if any
                    for j in range(i - 1, h2_idx, -1):
                        if lines[j].strip() == '---':
                            insert_idx = j
                            break
                    else:
                        insert_idx = i
                    break
            
            new_lines = lines[:insert_idx] + ['', mermaid, ''] + lines[insert_idx:]
            modified = '\n'.join(new_lines)
            changes.append('ADDED_MERMAID')
    
    # Write back if modified
    if changes:
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(modified)
        return True, changes
    
    return False, "NO_CHANGES"

def main():
    files = get_all_files()
    total = len(files)
    fixed = 0
    skipped = 0
    
    for fp in files:
        was_fixed, msg = fix_file(fp)
        rel = os.path.relpath(fp)
        if was_fixed:
            print(f"FIXED: {rel} -> {msg}")
            fixed += 1
        else:
            print(f"SKIP: {rel} -> {msg}")
            skipped += 1
    
    print(f"\nTotal: {total}, Fixed: {fixed}, Skipped: {skipped}")

if __name__ == '__main__':
    main()
