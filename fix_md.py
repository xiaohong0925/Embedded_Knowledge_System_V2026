import os, re, json

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议'

# 加载检查结果
with open('check_results2.json', 'r', encoding='utf-8') as f:
    results = json.load(f)

# 为每个主题定义补充内容模板
def get_history_evolution(topic):
    """根据主题返回历史演进段落（>=100字）"""
    histories = {
        'I2S': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eI2S\u003c/span\u003e协议的发展历史反映了数字音频从专业设备向消费电子的演进轨迹。1986年，Philips（现为NXP）首次提出I2S标准，初衷是解决CD播放器内部DAC与数字滤波器之间的芯片间音频传输问题。此后，I2S逐渐成为消费电子、PC声卡和嵌入式系统的通用标准。进入2000年代，随着多声道音频需求的增加，TDM（时分复用）扩展在I2S基础上实现了4~8通道的音频传输。2010年后，MEMS麦克风的普及催生了PDM（脉冲密度调制）接口，以1-bit过采样方式大幅降低麦克风与Codec之间的连线数量。当前发展趋势显示，I2S正与USB Audio、SoundWire等新兴协议并存，在嵌入式音频领域仍保持核心地位。""",
        'MIPI': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eMIPI Alliance\u003c/span\u003e成立于2003年，由ARM、Intel、Nokia、Samsung、Texas Instruments等业界巨头联合发起，旨在终结移动设备内部接口的混乱局面。2005年，MIPI发布首个DSI（显示串行接口）和CSI（摄像头串行接口）规范，统一了手机显示屏和摄像头的连接标准。2009年，D-PHY物理层规范成熟，确立了HS/LP双模式架构。2014年，C-PHY发布，采用三相编码技术将每lane带宽提升至5.7Gbps。2016年后，M-PHY进一步瞄准UFS存储和5G射频前端的高速互联需求。当前，MIPI标准已覆盖移动、汽车、IoT和AI边缘计算等多个领域，成为嵌入式高速串行接口的事实标准之一。""",
        'CoreSight': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eCoreSight\u003c/span\u003e调试架构由ARM在2004年随Cortex-M3处理器一同推出，标志着ARM芯片调试从简单的JTAG边界扫描向片上实时跟踪的跨越。在此之前，ARM7/ARM9时代的调试主要依赖EmbeddedICE逻辑，功能局限于断点和单步。CoreSight引入了ETM（嵌入式跟踪宏单元）、ITM（仪器化跟踪宏单元）和DWT（数据观察点与跟踪）等组件，实现了指令级流水跟踪、数据访问监控和软件日志输出。2010年后，CoreSight架构随Cortex-M4/M7/M33持续演进，支持更宽的跟踪带宽和更复杂的触发条件。未来趋势上，CoreSight正与Arm Trace Buffer、System Trace Macrocell（STM）整合，向多核异构系统的全链路调试跟踪方向发展。""",
        'JTAG': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eJTAG\u003c/span\u003e的起源可追溯至1985年成立的Joint Test Action Group，该组织由IBM、Philips、TI等公司联合组建，目标是解决高密度封装IC的板级测试难题。1990年，IEEE正式将JTAG边界扫描技术标准化为IEEE 1149.1。此后十年间，JTAG逐渐从单纯的边界扫描测试扩展为通用的芯片调试接口，几乎所有CPU、DSP、FPGA都内置JTAG端口。2000年后，JTAG成为Flash编程、在线调试、芯片诊断的标准入口。尽管SWD、 cJTAG等更节省引脚的替代方案相继出现，JTAG凭借标准成熟、工具生态完善的优势，在FPGA、复杂SoC和板级制造测试领域仍不可替代。""",
        'SWD': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eSWD\u003c/span\u003e（Serial Wire Debug）由ARM于2004年随Cortex-M3内核同步推出，是JTAG协议在引脚受限场景下的精简替代方案。ARM洞察到8/16/32-pin小型MCU的引脚资源极度紧张，4~5线的JTAG接口占用了宝贵的GPIO。SWD仅用SWCLK和SWDIO两根线，通过包传输协议实现了与JTAG等效的全部调试功能。2008年后，SWD迅速成为Cortex-M0/M0+/M3/M4/M7系列MCU的标准调试接口，OpenOCD、Keil MDK、IAR等主流工具链全面支持。2015年，ARM在CoreSight v3中引入双DP（Debug Port）的SWD扩展，支持多核同时调试。当前，SWD已超越JTAG成为嵌入式MCU领域最主流的调试物理层，每年出货的数十亿颗Cortex-M芯片均内置SWD端口。""",
        'ETM': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eETM\u003c/span\u003e（Embedded Trace Macrocell）是ARM CoreSight调试架构中负责指令级跟踪的核心组件。早期的ETMv1于2002年配合ARM9处理器推出，仅支持基本指令跟踪。ETMv3（2006年）增加了数据跟踪和更复杂的触发资源，配合Cortex-M3/M4实现了对中断延迟、函数执行时间的精确测量。ETMv4（2015年）随Cortex-M7和Cortex-A系列演进，引入了更宽的数据总线和更高效的压缩算法，跟踪带宽提升至数Gbps。当前，ETM已从单纯的调试辅助工具发展为系统性能分析的关键手段，与DS-5、Trace32等工具结合，可生成完整的程序执行剖面（Profiling）数据，为嵌入式实时系统的优化提供量化依据。""",
        'ITM': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eITM\u003c/span\u003e（Instrumentation Trace Macrocell）和DWT（Data Watchpoint and Trace）是ARM CoreSight架构中专为Cortex-M系列优化的轻量级调试组件。ITM的前身是早期ARM7中的DCC（Debug Communications Channel），仅能传输少量数据。2004年CoreSight发布后，ITM被设计为32通道的仪器化日志输出单元，允许软件通过ITM端口直接输出格式化字符串和变量值，无需占用UART。DWT则集成了4个硬件比较器，可同时监视程序计数器、数据地址和变量值的变化。2010年后，随着Cortex-M4浮点单元和Cortex-M7双精度单元的引入，DWT增加了对浮点指令的跟踪支持。当前，ITM与DWT的组合已成为Cortex-M调试的标准配置，printf调试（Semi-hosting替代方案）和实时变量监控是其最常见的应用场景。""",
        'DSI': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eMIPI DSI\u003c/span\u003e（Display Serial Interface）的发展史是移动显示技术从低分辨率向4K/8K超高清跃迁的缩影。2005年，MIPI Alliance发布DSI v1.0，基于D-PHY物理层，单lane速率最高1Gbps，足以驱动HVGA（480×320）手机屏。2010年DSI v1.1支持1080p。2015年DSI v1.2引入C-PHY物理层，lane速率提升至2.5Gbps，并增加了显示命令集（DCS）的扩展功能。2019年DSI v2.0整合D-PHY v2.5和C-PHY v2.0，单lane最高5.7Gbps，支持4K@60fps移动显示屏。当前，DSI已成为智能手机、平板、车载仪表、AR眼镜等产品的标准显示接口，与eDP、LVDS共同覆盖从嵌入式到PC显示的全场景需求。""",
        'CSI': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eMIPI CSI-2\u003c/span\u003e（Camera Serial Interface 2）自2005年发布以来，已成为移动摄像头和嵌入式视觉系统的首选接口。CSI-2 v1.0基于D-PHY，支持4-lane，单lane 1Gbps，满足早期200万像素手机摄像头的带宽需求。2012年CSI-2 v1.1增加虚拟通道（Virtual Channel）和RAW12/RAW14格式，支持多摄像头和HDR成像。2017年CSI-2 v2.0引入C-PHY选项，带宽翻倍，并增加智能区域传输（Smart Region of Interest）功能以降低AI视觉的功耗。2019年CSI-2 v3.0进一步整合D-PHY v3.0和C-PHY v2.0，支持8K视频和高速3D传感。在自动驾驶、机器视觉、医疗内窥镜等领域，CSI-2凭借其低引脚、高带宽、标准化生态的优势持续扩展市场份额。""",
        'TDM': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eTDM\u003c/span\u003e（Time Division Multiplexing，时分复用）技术起源于20世纪60年代的电信系统，用于在单条物理线路上传输多路电话信号。进入数字音频时代，TDM被引入I2S体系，以解决传统左右声道2通道无法满足多麦克风阵列和多扬声器系统的需求。2000年后，专业音频设备（调音台、DSP处理器）率先采用TDM模式实现8~32通道的音频传输。2010年后，智能音箱和语音助手（如Amazon Echo、Google Home）推动了TDM在消费电子中的普及，线性麦克风阵列通常需要6~8路同步ADC通道。当前，TDM与PDM MEMS麦克风接口的结合成为智能音箱的标准音频前端方案，而车载音响的主动降噪系统则依赖16通道以上的TDM总线实现全车厢声学覆盖。""",
        'PDM': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003ePDM\u003c/span\u003e（Pulse Density Modulation，脉冲密度调制）麦克风接口的兴起与MEMS麦克风技术的成熟密切相关。2000年代初，Knowles等厂商推出首批MEMS硅麦克风，其输出为1-bit PDM信号，需配合片内抽取滤波器（Decimation Filter）转换为标准PCM。PDM接口仅用1根数据线和1根时钟线即可传输音频，相比传统模拟麦克风+ADC方案大幅降低了BOM成本和PCB面积。2010年后，智能手机和TWS耳机的大规模出货推动了PDM接口的标准化，主流Codec芯片（如Cirrus Logic、TI、Realtek）均内置多路PDM输入。当前，PDM麦克风已从消费电子延伸至汽车（车载语音）、IoT（语音唤醒）和医疗（助听器）领域，并与TDM总线结合实现多麦克风阵列的高速数字音频输入。""",
        'TAP': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eTAP\u003c/span\u003e（Test Access Port）状态机是IEEE 1149.1标准的核心控制机制，其16状态设计体现了边界扫描协议对测试灵活性和标准化的高度追求。1985年至1990年间，Joint Test Action Group在制定标准时面临一个关键挑战：如何用有限的TMS/TCK信号线实现对芯片内部多种测试资源的灵活访问。最终采用的16状态有限状态机方案，通过TMS单线编码即可遍历IR/DR扫描、复位、空闲等全部操作模式。1990年IEEE 1149.1正式发布后，TAP状态机成为所有支持JTAG芯片的标配。2000年后，TAP架构被扩展用于IEEE 1532（在系统编程）和IEEE 1687（内部扫描网络访问）。当前，虽然SWD、cJTAG等新型调试接口在引脚效率上更优，TAP状态机仍以其完备性和通用性，在FPGA配置、板级边界扫描和复杂SoC调试中保持核心地位。""",
        'OpenOCD': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eOpenOCD\u003c/span\u003e（Open On-Chip Debugger）项目诞生于2005年，由Dominic Rath发起，旨在为嵌入式开发者提供一款开源、免费、跨平台的芯片调试工具。在此之前，嵌入式调试几乎被商业工具（如ARM的Multi-ICE、Segger J-Link、Lauterbach TRACE32）垄断，价格昂贵且封闭。OpenOCD最初仅支持少数ARM7/ARM9处理器和Wiggler并口JTAG适配器。2008年后，社区快速发展，支持了Cortex-M系列、MIPS、RISC-V等多种架构，以及USB-JTAG、SWD等物理层适配器。2015年，OpenOCD整合了对CMSIS-DAP、ST-Link、J-Link等主流调试器的支持，成为事实上的开源标准。当前，OpenOCD已深度集成于PlatformIO、VS Code插件和CI/CD流水线中，是嵌入式开源生态不可或缺的基石工具。""",
        'Cortex-M': """\n---\n\n## 历史演进与发展趋势\n\n\u003cspan class=\"red\"\u003eCortex-M\u003c/span\u003e系列微控制器自2004年ARM推出Cortex-M3以来，彻底重塑了32位嵌入式MCU的市场格局。Cortex-M3首次将ARMv7-M架构引入MCU领域，集成的NVIC中断控制器和Thumb-2指令集实现了优异的中断响应和代码密度。2009年Cortex-M0发布，以极小的硅面积和超低功耗瞄准8位MCU替代市场。2010年Cortex-M4增加单精度FPU和DSP指令，满足音频和传感器融合需求。2014年Cortex-M7引入双发射流水线和双精度FPU，性能达到CoreMark 2000分以上。2016年后，Cortex-M23/M33引入TrustZone安全扩展，为IoT安全奠定了基础。调试接口方面，Cortex-M系列全系标配SWD，高端型号（M4/M7/M33）额外提供4-bit ETM跟踪端口。当前，Cortex-M系列年出货量超过数十亿颗，占据32位MCU市场绝对主导地位。""",
    }
    return histories.get(topic, '')

def get_why_derivation(title_keyword):
    """返回'为什么'推导段落"""
    derivations = {
        'I2S': """\n\n---\n\n## 为什么需要 I2S：数字音频的芯片互联\n\n\u003cspan class=\"red\"\u003eI2S\u003c/span\u003e由 \u003cspan class=\"green\"\u003ePhilips（现为 NXP）\u003c/span\u003e在 \u003cspan class=\"green\"\u003e1986 年\u003c/span\u003e提出，定位是芯片间传输数字音频的标准接口。\n\n在 I2S 之前，数字音频传输方式各异：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e并行接口\u003c/span\u003e：引脚多，PCB 走线复杂\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eSPI\u003c/span\u003e：通用但非音频优化\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e各厂商私有\u003c/span\u003e：NEC、Sony、Toshiba 互不兼容\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eI2S 用 3~4 根线传输立体声音频：串行时钟（SCK）、字选择（WS）、串行数据（SD），可选主时钟（MCLK）。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：I2S 如同"数字音频的专线电话"——专门设计用来传输音频，不需要额外的协议握手，接上就能出声。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'MIPI': """\n\n---\n\n## 为什么需要 MIPI：移动设备的接口"巴别塔"\n\n\u003cspan class=\"red\"\u003eMIPI Alliance\u003c/span\u003e成立于 \u003cspan class=\"green\"\u003e2003 年\u003c/span\u003e，由 ARM、Intel、Nokia、Samsung、TI 等公司发起。\n\n在 MIPI 之前，移动设备的接口混乱：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e显示屏\u003c/span\u003e：各厂商用私有的并行 RGB 接口\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e摄像头\u003c/span\u003e：并行接口，引脚多，EMI 差\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eRF 射频\u003c/span\u003e：DigRF、SLIMbus 各不兼容\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eMIPI 定义了移动设备的全套接口标准：DSI（显示）、CSI（摄像头）、D-PHY/C-PHY/M-PHY（物理层）、SLIMbus/I3C/SoundWire（控制/音频）。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：MIPI 如同"手机接口的 USB 组织"——就像 USB 统一了 PC 外设接口，MIPI 统一了手机内部所有芯片之间的接口。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'CoreSight': """\n\n---\n\n## 为什么需要 CoreSight：嵌入式调试的"透视眼"\n\n\u003cspan class=\"red\"\u003eCoreSight\u003c/span\u003e是 ARM 在 \u003cspan class=\"green\"\u003e2004 年\u003c/span\u003e随 Cortex-M3 推出的片上调试与跟踪架构。\n\n在传统嵌入式调试中，开发者面临诸多痛点：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e断点资源匮乏\u003c/span\u003e：早期 ARM7 仅有 2 个硬件断点，难以调试复杂程序\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e无法观察实时数据\u003c/span\u003e：程序全速运行时，内存和寄存器状态不可见\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e中断延迟不可测\u003c/span\u003e：传统调试器在断点时会停止系统时钟，破坏实时性分析\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eCoreSight 通过 ETM 实现指令级流水跟踪，通过 ITM 实现软件日志输出，通过 DWT 实现数据观察点监控——三者结合构成了嵌入式系统的"透视眼"，可在不打断程序执行的前提下，实时捕获系统运行状态。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：CoreSight 如同"手术室的无影灯加显微镜"——让开发者看清代码运行的每个细节，却不影响手术（程序执行）本身。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'JTAG': """\n\n---\n\n## 为什么需要 JTAG：测试芯片引脚的"背门"\n\n\u003cspan class=\"red\"\u003eJTAG\u003c/span\u003e由 \u003cspan class=\"green\"\u003eIEEE 1149.1\u003c/span\u003e标准定义，\u003cspan class=\"green\"\u003e1990 年\u003c/span\u003e正式发布。\n\n在 JTAG 之前，测试 IC 引脚连通性非常困难：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eIC 封装越来越密\u003c/span\u003e：QFP、BGA 的引脚无法逐一探测\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e多层 PCB\u003c/span\u003e：内层走线无法用探针接触\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e自动化测试\u003c/span\u003e：需要标准化的测试访问方法\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eJTAG 的核心创新：在芯片内部嵌入"边界扫描寄存器"（BSR），每个引脚对应一个寄存器位。通过 JTAG 接口，可以读取/控制每个引脚的状态，实现无需物理探针的板级测试。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：JTAG 如同"大楼的消防检修通道"——平时不用，但紧急时刻（测试/调试）可以从内部访问每个房间（引脚）的状态。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'SWD': """\n\n---\n\n## 为什么需要 SWD：引脚永远不够用\n\n\u003cspan class=\"red\"\u003eSWD\u003c/span\u003e由 ARM 在 \u003cspan class=\"green\"\u003e2004 年\u003c/span\u003e随 Cortex-M3 一同推出。\n\nJTAG 的 4~5 根线对 MCU 来说太奢侈：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e引脚资源紧张\u003c/span\u003e：小型 MCU（如 STM32F030，20-pin）每根线都宝贵\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003ePCB 面积\u003c/span\u003e：调试接口占用的空间不容忽视\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e成本\u003c/span\u003e：每多一根线 = 连接器成本 + 走线成本 + 测试成本\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eSWD 用 2 根线（SWCLK + SWDIO）替代 JTAG 的 4~5 根线，同时保留完整的调试功能（单步、断点、内存读写、Flash 下载）。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：SWD 如同"精简版的万能钥匙"——虽然钥匙齿（引脚）少了，但能开的门（调试功能）一扇没少。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'ETM': """\n\n---\n\n## 为什么需要 ETM：看不见的指令流\n\n\u003cspan class=\"red\"\u003eETM\u003c/span\u003e（Embedded Trace Macrocell）是 ARM CoreSight 架构中用于指令级跟踪的核心组件。\n\n在复杂嵌入式系统中，仅依靠断点和单步调试已无法满足需求：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e实时性破坏\u003c/span\u003e：断点会停止 CPU 时钟，无法分析中断延迟和时序关系\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e覆盖范围有限\u003c/span\u003e：2~6 个硬件断点无法覆盖大型代码库的全部执行路径\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e多核调试困难\u003c/span\u003e：多核系统的同步行为无法通过传统调试器观察\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eETM 的核心价值在于"无侵入跟踪"：CPU 全速运行时，ETM 将指令执行流压缩输出到跟踪端口，开发者事后可还原完整的程序执行轨迹、函数调用链和分支覆盖率。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：ETM 如同"飞机的黑匣子"——飞机（程序）正常飞行时持续记录数据，事故（Bug）发生后可完整还原现场。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'ITM': """\n\n---\n\n## 为什么需要 ITM 与 DWT：轻量级的调试透视\n\n\u003cspan class=\"red\"\u003eITM\u003c/span\u003e和 \u003cspan class=\"red\"\u003eDWT\u003c/span\u003e是 ARM 为 Cortex-M 系列量身打造的低成本调试组件。\n\n在资源受限的 MCU 调试中，传统方案存在明显短板：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eUART 占用资源\u003c/span\u003e：printf 调试需占用 UART 引脚和波特率配置，增加代码体积\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e断点不够用\u003c/span\u003e：仅有 2~4 个断点，无法同时监控多个变量和数据地址\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e中断行为难观测\u003c/span\u003e：无法精确测量中断响应时间和异常触发条件\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eITM 提供 32 个软件通道的日志输出能力，DWT 提供 4 个硬件比较器的数据观察点——两者均通过 SWO 单线输出，无需额外占用 UART 资源，即可实现 printf 调试、性能计数和变量监控。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：ITM/DWT 如同"汽车的 OBD 诊断口"——不改动任何线路，即可读取发动机转速、油耗、故障码等关键运行数据。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'DSI': """\n\n---\n\n## 为什么需要 MIPI DSI：移动显示的串行革命\n\n\u003cspan class=\"red\"\u003eMIPI DSI\u003c/span\u003e是 MIPI Alliance 专为移动设备显示屏定义的串行接口标准。\n\n在 DSI 出现之前，移动显示接口面临多重瓶颈：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e并行 RGB 引脚爆炸\u003c/span\u003e：24-bit 并行 RGB 需 28 根以上走线，PCB 空间紧张\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eEMI 与串扰\u003c/span\u003e：并行总线高频切换产生严重电磁辐射，影响射频灵敏度\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e功耗高企\u003c/span\u003e：并行接口的 CMOS 电平摆幅大，静态功耗和动态功耗均不理想\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eDSI 将并行 RGB 转换为高速差分串行流，用 1~4 对 lane 替代数十根并行线，同时引入 LP 低功耗模式实现静态节能。从 HVGA 到 4K 移动屏，DSI 已成为行业标准。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：DSI 如同"从并行的多车道高速改为串行的地铁轨道"——地面空间（PCB 面积）大幅缩减，运量（带宽）不降反升。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'CSI': """\n\n---\n\n## 为什么需要 MIPI CSI-2：摄像头接口的瘦身之道\n\n\u003cspan class=\"red\"\u003eMIPI CSI-2\u003c/span\u003e是移动和嵌入式摄像头领域的首选串行接口标准。\n\n传统并行摄像头接口已无法适应现代影像需求：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e引脚过多\u003c/span\u003e：10-bit 并行数据 + 同步信号 + 时钟，单摄像头即超 20 根线\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e速率瓶颈\u003c/span\u003e：并行总线受限于信号偏移（Skew）和 EMI，难以突破 200Mbps\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e多摄像头困境\u003c/span\u003e：智能手机 3~5 个摄像头（主摄、超广、长焦、ToF）并行布线不可行\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eCSI-2 以 1~4 lane 的差分串行传输替代并行总线，单 lane 速率可达 1~2.5Gbps，并通过虚拟通道（Virtual Channel）技术在单条物理链路上同时传输多路摄像头数据。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：CSI-2 如同"从多股麻绳改为钢丝绳"——股数（lane）少了，但单股强度（单 lane 速率）和整体承重（总带宽）远超旧方案。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'TDM': """\n\n---\n\n## 为什么需要 TDM 与 PDM：多通道音频的扩展之道\n\n\u003cspan class=\"red\"\u003eTDM\u003c/span\u003e和 \u003cspan class=\"red\"\u003ePDM\u003c/span\u003e是 I2S 标准在多媒体和语音应用中的两大扩展方向。\n\n传统 I2S 的 2 通道立体声已无法满足新兴场景：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e智能音箱\u003c/span\u003e：6~8 麦克风阵列需要 6~8 路同步 ADC\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e车载音响\u003c/span\u003e：主动降噪系统需 12~16 路扬声器信号\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eMEMS 麦克风\u003c/span\u003e：1-bit PDM 输出需配合抽取滤波器转换为 PCM\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eTDM 通过时分复用在同一对数据线上轮询传输多通道采样值，PDM 则以 1-bit 高频过采样大幅简化麦克风与 Codec 之间的物理连接。二者与 I2S 主框架兼容，是当代多通道嵌入式音频系统的基石。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：TDM 如同"一条电话线分时段接多个分机"，PDM 如同"用摩斯电码的高速版传输声音"——前者解决通道数问题，后者解决连线数问题。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        '边界扫描': """\n\n---\n\n## 为什么需要边界扫描：板级测试的自动化革命\n\n\u003cspan class=\"red\"\u003eJTAG 边界扫描\u003c/span\u003e是 IEEE 1149.1 标准最具实用价值的应用场景之一。\n\n在传统板级测试中，制造缺陷的检测成本持续攀升：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eBGA 封装普及\u003c/span\u003e：焊球在芯片底部，目视检查和探针接触均不可行\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e测试夹具昂贵\u003c/span\u003e：ICT（在线测试）治具成本随引脚数指数增长\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e测试覆盖率不足\u003c/span\u003e：飞针测试速度慢，无法覆盖高速信号完整性验证\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e边界扫描利用芯片内部嵌入的 BSR（边界扫描寄存器），通过 JTAG 串行链路读取/驱动每个引脚状态，实现无需物理接触的自动化板级连通性测试、功能测试和芯片间互连验证。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：边界扫描如同"给每栋大楼（芯片）装上远程智能电表"——无需敲开每扇门（物理接触引脚），即可远程读取所有房间（引脚）的电路状态。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'Flash': """\n\n---\n\n## 为什么需要 JTAG Flash 烧录：固件更新的标准通道\n\n\u003cspan class=\"red\"\u003eJTAG\u003c/span\u003e不仅是调试接口，更是嵌入式系统固件烧录的核心通道。\n\n在嵌入式产品开发和量产中，固件下载需求贯穿全生命周期：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e研发阶段\u003c/span\u003e：每日数十次编译下载，需要快速可靠的烧录方式\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e量产阶段\u003c/span\u003e：出厂固件写入需支持批量自动化\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e维护阶段\u003c/span\u003e：现场设备固件升级需兼顾安全与可靠性\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eJTAG 通过直接访问芯片内部的调试和内存总线，可绕过 bootloader 直接将固件写入 Flash。相比 UART/USB 等依赖软件协议栈的烧录方式，JTAG 在芯片"变砖"后仍能恢复，是最底层的救命通道。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：JTAG Flash 烧录如同"用万能钥匙直接打开保险柜（Flash）的后门"——即使正门（bootloader）损坏，也能从检修通道完成修复。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'OpenOCD': """\n\n---\n\n## 为什么需要 OpenOCD：开源调试的统一平台\n\n\u003cspan class=\"red\"\u003eOpenOCD\u003c/span\u003e是嵌入式开源社区最重要的片上调试工具之一。\n\n在商业调试工具主导的时代，开发者面临诸多限制：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e成本高昂\u003c/span\u003e：J-Link、ULINK 等商业调试器价格数百至数千美元\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e生态封闭\u003c/span\u003e：各厂商工具链互不兼容，切换芯片需更换硬件\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003eCI/CD 集成困难\u003c/span\u003e：商业工具缺乏命令行自动化接口，无法嵌入流水线\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003eOpenOCD 以开源方式实现了对几乎所有主流 JTAG/SWD 适配器和处理器架构的支持，提供完整的 GDB 远程调试协议兼容、Flash 编程脚本和边界扫描测试能力。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：OpenOCD 如同"汽车界的 OBD-II 开源扫描仪"——通用、免费、可扩展，让每位开发者都能诊断和修复自己的"发动机"（嵌入式系统）。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        'Cortex-M': """\n\n---\n\n## 为什么需要 Cortex-M 调试实战：从理论到产品\n\n\u003cspan class=\"red\"\u003eCortex-M\u003c/span\u003e系列微控制器的调试不仅是技术问题，更是产品可靠性的关键环节。\n\n在嵌入式产品从原型到量产的旅程中，调试能力直接影响上市时间和质量：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e难以复现的偶发故障\u003c/span\u003e：看门狗超时、HardFault 异常需通过调试器捕获现场\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e功耗优化瓶颈\u003c/span\u003e：睡眠模式进入/退出异常需用调试跟踪精确定位\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e安全认证需求\u003c/span\u003e：汽车电子（ISO 26262）和功能安全要求完整的故障注入与调试记录\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e掌握 SWD + OpenOCD + GDB 的完整调试链路，配合 ITM 日志和 DWT 性能计数器，可在不增加硬件成本的前提下，实现从代码调试到系统性能分析的全流程覆盖。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：Cortex-M 调试工具链如同"外科医生的全套器械"——手术刀（断点）、听诊器（变量观察）、X光（跟踪流）配合使用，才能精准诊断病灶。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
        '实战': """\n\n---\n\n## 为什么需要嵌入式实战：从知识到技能\n\n\u003cspan class=\"red\"\u003e嵌入式实战\u003c/span\u003e是将总线协议理论转化为工程能力的关键环节。\n\n仅掌握协议规范而不具备实操能力，在项目中将面临多重困境：\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e配置失误\u003c/span\u003e：寄存器设置错误导致总线无法初始化或数据错乱\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e调试困难\u003c/span\u003e：缺乏逻辑分析仪和示波器的使用经验，信号问题无从定位\n\u003cbr\u003e\n* \u003cspan class=\"green\"\u003e性能瓶颈\u003c/span\u003e：无法通过实测数据验证理论带宽，DMA 与中断配置全凭猜测\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e通过真实的硬件平台（如 STM32、i.MX RT、RK 系列）进行总线配置、波形抓取和性能测试，可将抽象的协议规范转化为可复用的工程直觉。\u003c/span\u003e\n\u003cbr\u003e\n\n\u003cspan class=\"blue\"\u003e类比：嵌入式实战如同"学游泳必须下水"——在岸上（纯理论）研究再多动作要领，不如在泳池（开发板）中呛几口水（踩坑）来得有效。\u003c/span\u003e\n\u003cbr\u003e\n\n---\n\n""",
    }
    return derivations.get(title_keyword, '')

def get_mermaid_diagram(topic):
    """返回Mermaid图代码块"""
    diagrams = {
        'MIPI实战': """\n\n```mermaid\nflowchart TD\n    SOC[\"SoC\nMIPI Host\"] --\"4-lane DSI\"--> DSI[\"DSI Controller\"]\n    SOC --\"4-lane CSI-2\"--> CSI[\"CSI-2 Controller\"]\n    DSI --\"D-PHY\"--> PANEL[\"LCD/OLED Panel\"]\n    CSI --\"D-PHY\"--> CAM[\"Camera Module\"]\n    SOC --\"I2C/I3C\"--> TOUCH[\"Touch Controller\"]\n    \n    subgraph 移动设备显示与摄像子系统\n        DSI\n        CSI\n        PANEL\n        CAM\n    end\n```\n\n""",
        'ETM': """\n\n```mermaid\nflowchart LR\n    CPU[\"Cortex-M CPU\nPipeline\"] --\"Instruction Trace\"--> ETM[\"ETM\nTrace Macrocell\"]\n    ETM --\"Compressed Trace\"--> TPIU[\"TPIU\nTrace Port\"]\n    TPIU --\"4-bit Trace Data\"--> SWO[\"SWO / Trace Port\"]\n    SWO --> PC[\"PC\nTrace32 / Keil\"]\n    \n    DWT[\"DWT\nData Watchpoint\"] --\"Data Trace\"--> ETM\n    ITM[\"ITM\nInstrumentation\"] --\"Software Logs\"--> TPIU\n```\n\n""",
        'ITM': """\n\n```mermaid\nflowchart TD\n    SWD[\"SWD\nSWCLK+SWDIO\"] --> DAP[\"DAP\nDebug Access Port\"]\n    DAP --> AP[\"AP\nAccess Port\"]\n    AP --> ITM[\"ITM\n32 Channels\"]\n    AP --> DWT[\"DWT\n4 Comparators\"]\n    ITM --\"SWO\"--> SWO_OUT[\"SWO Output\nSingle Wire\"]\n    DWT --\"PC Sampling\"--> SWO_OUT\n    \n    subgraph CoreSight Cortex-M 调试架构\n        DAP\n        AP\n        ITM\n        DWT\n    end\n```\n\n""",
        'SWD调试': """\n\n```mermaid\nflowchart LR\n    HOST[\"Host PC\nGDB / IDE\"] --\"TCP 3333\"--> OCD[\"OpenOCD\nServer\"]\n    OCD --\"USB\"--> DAP[\"CMSIS-DAP\nAdapter\"]\n    DAP --\"SWD\"--> MCU[\"Cortex-M MCU\nSWCLK+SWDIO\"]\n    MCU --\"SWO\"--> DAP\n    \n    subgraph 调试链路\n        HOST\n        OCD\n        DAP\n        MCU\n    end\n```\n\n""",
        'Cortex-M调试': """\n\n```mermaid\nsequenceDiagram\n    participant GDB as GDB Client\n    participant OCD as OpenOCD\n    participant DAP as CMSIS-DAP\n    participant MCU as Cortex-M\n    \n    GDB->>OCD: target remote :3333\n    OCD->>DAP: swd init\n    DAP->>MCU: SWD sequence\n    MCU-->>DAP: ACK + IDCODE\n    DAP-->>OCD: Device ID\n    OCD-->>GDB: Connected\n    \n    GDB->>OCD: load firmware.elf\n    OCD->>DAP: Flash write\n    DAP->>MCU: AP memory write\n    MCU-->>DAP: OK\n    DAP-->>OCD: Done\n    OCD-->>GDB: Download complete\n```\n\n""",
    }
    return diagrams.get(topic, '')

def get_exercise(topic):
    """返回额外的练习题（1道，使总数达到3道）"""
    exercises = {
        'I2S基础': "3. TDM 模式下，若帧长为 256 个 BCLK 周期、位深 32-bit，最多可支持多少个音频通道？",
        'I2S时序': "3. 在 DSP Mode A（PCM）中，WS 与 MSB 对齐而非延迟 1 bit，这种设计对 Codec 的采样保持电路提出了什么要求？",
        'TDM': "3. 某智能音箱采用 8 路 PDM 麦克风 + 1 路 TDM 输出，Codec 的抽取滤波器输出为 48kHz/24-bit，计算 TDM 帧所需的 BCLK 频率。",
        'I2S实战': "3. 在 I2S 主从模式配置中，若 SoC 作为主设备输出 MCLK=12.288MHz，Codec 要求 MCLK 为 256×Fs，可支持哪些标准采样率？列出分频方案。",
        'MIPI基础': "3. 某手机显示屏分辨率为 2400×1080、刷新率 120Hz、24-bit 色深，计算 MIPI DSI 所需的最小总带宽。若使用 D-PHY v1.2（单 lane 1.5Gbps），需要几 lane？",
        'DSI': "3. DSI 的 LP（Low Power）模式功耗仅为 HS 模式的千分之一，但 LP 模式仅支持 10Mbps。解释为何 DSI 不能一直运行在 LP 模式下，需要 HS/LP 动态切换。",
        'CSI': "3. 某自动驾驶系统需同时连接前视 8MP（4K）摄像头（60fps，RAW12）和环视 4 路 2MP 摄像头（30fps，RAW10），计算 CSI-2 总线所需的最小带宽，并设计 lane 分配方案。",
        'MIPI实战': "3. 在 MIPI DSI 的 LP 模式下，主机发送 DCS 命令配置显示屏亮度。画出 LP 模式下的命令包格式（Data Type + WC + ECC + Payload + Checksum）。",
        'CoreSight基础': "3. CoreSight 的 ATB（Advanced Trace Bus）用于连接多个跟踪源到 TPIU。解释 ATB 的 "flush" 机制在系统进入低功耗模式时的作用。",
        'ETM': "3. ETMv4 相比 ETMv3 增加了"数据跟踪"（Data Trace）功能。解释为何数据跟踪比指令跟踪消耗更多跟踪带宽，并说明 ETMv4 的压缩算法如何缓解这一问题。",
        'ITM': "3. ITM 的 32 个软件通道中，通道 0 通常用于 printf 重定向（SWO 输出）。解释为何 ITM printf 相比 UART printf 具有更低的中断开销和更高的输出效率。",
        'CoreSight实战': "3. 在 CoreSight 实战中，使用 DWT 的 CYCCNT（周期计数器）测量函数执行时间时，若 CPU 频率为 168MHz，CYCCNT 的 32 位溢出周期是多少？如何避免溢出导致的测量误差？",
        'JTAG基础': "3. 在 JTAG 链上串联 3 个设备，各自的 IR 长度分别为 4-bit、5-bit、6-bit。若要访问第 2 个设备的 IDCODE 寄存器，写出完整的 TMS/TDI 序列（从 Run-Test-Idle 到读取 32-bit IDCODE）。",
        '边界扫描': "3. 某 PCB 上有 2 颗 FPGA 通过 JTAG 链串联，使用 OpenOCD 进行边界扫描测试。写出 OpenOCD 配置文件中定义 JTAG 链上设备 IR 长度的语法，并解释 BYPASS 指令在链式测试中的加速原理。",
        'Flash': "3. 使用 JTAG 向 SPI Flash 烧录固件时，OpenOCD 的 "flash write_image" 命令背后经历了哪些总线转换？画出从 GDB 命令到 SPI Flash 页编程（Page Program）的完整数据路径。",
        'JTAG实战': "3. 在 JTAG 嵌入式实战中，某 STM32 芯片因 Flash 写保护导致 JTAG 连接失败。解释 RDP（Read Protection）等级与 JTAG/SWD 调试访问权限的关系，并说明解锁流程。",
        'SWD基础': "3. SWD 的 DAP（Debug Access Port）包含 DP（Debug Port）和 AP（Access Port）两层。解释为何需要这种分层设计，并说明 DP 的 SELECT 寄存器如何选择目标 AP。",
        'OpenOCD': "3. OpenOCD 的配置文件（.cfg）使用 Tcl 语法。写出一段配置脚本：定义 STM32F407 的 SWD 接口、指定 ST-Link 适配器、设置 168MHz 的时钟频率、并配置 4KB 的 Flash 页大小。",
        'Cortex-M调试': "3. Cortex-M 的 HardFault 异常是嵌入式调试中最棘手的故障之一。列出触发 HardFault 的 5 种常见原因，并说明如何通过 SCB->CFSR 和 SCB->HFSR 寄存器定位具体故障源。",
        'SWD实战': "3. 在 SWD 嵌入式实战中，某低功耗 MCU 在进入 STOP 模式后 SWD 连接丢失。解释为何调试接口在低功耗模式下会失效，并给出保持调试连接可用的配置方案（DBGMCU_CR 寄存器）。",
    }
    return exercises.get(topic, "3. 结合本章内容，设计一个完整的工程验证方案，说明测试环境搭建、关键参数配置和结果判定标准。")

# 主题映射规则
def get_topic_from_filename(fname):
    """根据文件名返回主题关键词"""
    if 'I2S' in fname and '基础' in fname: return 'I2S'
    if 'I2S' in fname and '时序' in fname: return 'I2S'
    if 'TDM' in fname or 'PDM' in fname: return 'TDM'
    if 'I2S' in fname and '实战' in fname: return 'I2S'
    if 'MIPI' in fname and '基础' in fname: return 'MIPI'
    if 'DSI' in fname: return 'DSI'
    if 'CSI' in fname: return 'CSI'
    if 'MIPI' in fname and '实战' in fname: return 'MIPI'
    if 'CoreSight' in fname and '基础' in fname: return 'CoreSight'
    if 'ETM' in fname and '跟踪' in fname: return 'ETM'
    if 'ITM' in fname or 'DWT' in fname: return 'ITM'
    if 'CoreSight' in fname and '实战' in fname: return 'CoreSight'
    if 'JTAG' in fname and '基础' in fname: return 'JTAG'
    if 'JTAG' in fname and '边界' in fname: return '边界扫描'
    if 'JTAG' in fname and 'Flash' in fname: return 'Flash'
    if 'JTAG' in fname and '实战' in fname: return '实战'
    if 'SWD' in fname and '基础' in fname: return 'SWD'
    if 'SWD' in fname and 'OpenOCD' in fname: return 'OpenOCD'
    if 'Cortex-M' in fname: return 'Cortex-M'
    if 'SWD' in fname and '实战' in fname: return '实战'
    return '通用'

def get_exercise_topic(fname):
    if 'I2S' in fname and '基础' in fname: return 'I2S基础'
    if 'I2S' in fname and '时序' in fname: return 'I2S时序'
    if 'TDM' in fname or 'PDM' in fname: return 'TDM'
    if 'I2S' in fname and '实战' in fname: return 'I2S实战'
    if 'MIPI' in fname and '基础' in fname: return 'MIPI基础'
    if 'DSI' in fname: return 'DSI'
    if 'CSI' in fname: return 'CSI'
    if 'MIPI' in fname and '实战' in fname: return 'MIPI实战'
    if 'CoreSight' in fname and '基础' in fname: return 'CoreSight基础'
    if 'ETM' in fname and '跟踪' in fname: return 'ETM'
    if 'ITM' in fname or 'DWT' in fname: return 'ITM'
    if 'CoreSight' in fname and '实战' in fname: return 'CoreSight实战'
    if 'JTAG' in fname and '基础' in fname: return 'JTAG基础'
    if 'JTAG' in fname and '边界' in fname: return '边界扫描'
    if 'JTAG' in fname and 'Flash' in fname: return 'Flash'
    if 'JTAG' in fname and '实战' in fname: return 'JTAG实战'
    if 'SWD' in fname and '基础' in fname: return 'SWD基础'
    if 'SWD' in fname and 'OpenOCD' in fname: return 'OpenOCD'
    if 'Cortex-M' in fname: return 'Cortex-M调试'
    if 'SWD' in fname and '实战' in fname: return 'SWD实战'
    return '通用'

def get_mermaid_topic(fname):
    if 'MIPI' in fname and '实战' in fname: return 'MIPI实战'
    if 'ETM' in fname and '跟踪' in fname: return 'ETM'
    if 'ITM' in fname or 'DWT' in fname: return 'ITM'
    if 'SWD' in fname and 'OpenOCD' in fname: return 'SWD调试'
    if 'Cortex-M' in fname: return 'Cortex-M调试'
    return None

def get_derivation_topic(fname):
    if 'I2S' in fname and '基础' in fname: return 'I2S'
    if 'I2S' in fname and '时序' in fname: return 'I2S'
    if 'TDM' in fname or 'PDM' in fname: return 'TDM'
    if 'I2S' in fname and '实战' in fname: return '实战'
    if 'MIPI' in fname and '基础' in fname: return 'MIPI'
    if 'DSI' in fname: return 'DSI'
    if 'CSI' in fname: return 'CSI'
    if 'MIPI' in fname and '实战' in fname: return '实战'
    if 'CoreSight' in fname and '基础' in fname: return 'CoreSight'
    if 'ETM' in fname and '跟踪' in fname: return 'ETM'
    if 'ITM' in fname or 'DWT' in fname: return 'ITM'
    if 'CoreSight' in fname and '实战' in fname: return '实战'
    if 'JTAG' in fname and '基础' in fname: return 'JTAG'
    if 'JTAG' in fname and '边界' in fname: return '边界扫描'
    if 'JTAG' in fname and 'Flash' in fname: return 'Flash'
    if 'JTAG' in fname and '实战' in fname: return '实战'
    if 'SWD' in fname and '基础' in fname: return 'SWD'
    if 'SWD' in fname and 'OpenOCD' in fname: return 'OpenOCD'
    if 'Cortex-M' in fname: return 'Cortex-M'
    if 'SWD' in fname and '实战' in fname: return '实战'
    return None

# 开始处理文件
fix_count = 0
for fname, info in results.items():
    fp = info['path']
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # 1. 补充历史演进（在文件末尾）
    if not info['hist_ok']:
        topic = get_topic_from_filename(fname)
        hist = get_history_evolution(topic)
        if hist:
            content = content.rstrip() + hist
            print(f'  [{fname}] 追加历史演进: {topic}')
    
    # 2. 补充练习题（在现有练习部分追加）
    if info['exercise_count'] < 3:
        topic = get_exercise_topic(fname)
        ex = get_exercise(topic)
        # 找到练习部分的末尾，追加新题目
        ex_pattern = re.compile(r'(##\s+(?:练习|习题|思考题|课后练习)\s*\n[\s\S]*?)(?=\n##\s|\Z)')
        match = ex_pattern.search(content)
        if match:
            end_pos = match.end(1)
            # 在练习部分最后追加新题
            content = content[:end_pos] + '\n' + ex + '\n' + content[end_pos:]
            print(f'  [{fname}] 追加练习题: {topic}')
        else:
            # 如果没有练习部分，在末尾追加
            content = content.rstrip() + '\n\n---\n\n## 练习\n\n' + ex + '\n'
            print(f'  [{fname}] 新建练习部分并追加: {topic}')
    
    # 3. 补充"为什么"推导（在 # 标题 后的第一个 H2 之前插入）
    if not info['has_why']:
        topic = get_derivation_topic(fname)
        deriv = get_why_derivation(topic)
        if deriv:
            # 找到第一个 ## 开头的行（H2）
            h2_match = re.search(r'\n##\s+', content)
            if h2_match:
                pos = h2_match.start()
                content = content[:pos] + deriv + content[pos:]
                print(f'  [{fname}] 插入推导段: {topic}')
    
    # 4. 补充Mermaid图
    if not info['has_mermaid']:
        topic = get_mermaid_topic(fname)
        diagram = get_mermaid_diagram(topic)
        if diagram:
            # 找一个合适的位置插入：第一个表格或列表之后，或第一个H2之后
            # 简单策略：在第一个 ## 段落内，找一个合适位置
            h2_match = re.search(r'(##\s+.+\n)', content)
            if h2_match:
                # 在当前第一个H2段落末尾（下一个H2之前或文件末尾）插入
                next_h2 = re.search(r'\n##\s+', content[h2_match.end():])
                if next_h2:
                    insert_pos = h2_match.end() + next_h2.start()
                else:
                    insert_pos = len(content)
                content = content[:insert_pos] + diagram + content[insert_pos:]
                print(f'  [{fname}] 插入Mermaid图: {topic}')
    
    if content != original:
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)
        fix_count += 1

print(f'\n总共修复 {fix_count} 个文件')
