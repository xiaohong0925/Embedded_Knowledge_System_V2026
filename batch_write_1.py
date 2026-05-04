#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量填充骨架文件"""

import os, glob, sys

BASE = "docs/08-总线协议"

def find_file(rel_pattern):
    """用glob查找文件，返回实际路径"""
    parts = rel_pattern.replace('/', os.sep).split(os.sep)
    # 逐步解析每一层目录（处理编码不匹配问题）
    current = parts[0]
    for i in range(1, len(parts)):
        if not os.path.isdir(current):
            return None
        candidates = os.listdir(current)
        found = None
        target = parts[i]
        # 先精确匹配
        for c in candidates:
            if c == target:
                found = c
                break
        # 再模糊匹配
        if not found:
            for c in candidates:
                if target.lower() in c.lower() or c.lower() in target.lower():
                    found = c
                    break
        if not found:
            # 尝试glob
            g = glob.glob(os.path.join(current, '*'))
            for p in g:
                if target.lower() in os.path.basename(p).lower():
                    found = os.path.basename(p)
                    break
        if not found:
            return None
        current = os.path.join(current, found)
    return current

def write_content(path, content):
    with open(path, 'wb') as f:
        f.write(content.encode('utf-8'))
    size = os.path.getsize(path)
    print(f"Wrote {size:5d} bytes -> {path}")
    return size

# ========== 文件2：1-Wire 历史演进（扩充版） ==========
content2 = """# 1-Wire 从 iButton 到现代 IoT 的演进

<span class="badge-e">[Expert]</span>

---

<span class="red">1-Wire 总线</span> 是 Dallas Semiconductor（现 Maxim Integrated）于 1989 年推出的单线串行通信协议。
<br>
从最早的 iButton 电子钥匙到现代 IoT 温度传感器网络，1-Wire 以其极简的布线拓扑在特定场景中保持不可替代性。
<br>
理解其演进脉络，有助于在 I2C/SPI/1-Wire 之间做出正确的接口选型决策。

---

## <strong>1989-1995：iButton 时代与协议诞生</strong>

### <strong>为什么 Dallas 要发明单总线</strong>

1980 年代末，Dallas Semiconductor 需要一种极低引脚占用的身份识别方案。
<br>
传统 EEPROM 需要电源、地、时钟、数据四线，而门禁系统希望传感器与钥匙都能用两线接触实现。
<br>
1-Wire 应运而生：仅需数据线+地线，通过寄生电容从数据线窃取能量维持工作。
<br>
这种设计让纽扣大小的不锈钢封装（iButton）成为可能，Durability 达到 10 万次插拔。

---

### <strong>早期产品家族</strong>

| 年份 | 产品 | 家族码 | 应用场景 |
|------|------|--------|----------|
| 1990 | DS1990A | 0x01 | iButton 身份识别、门禁卡 |
| 1992 | DS1992 | 0x08 | 1KB NV RAM 数据存储 |
| 1993 | DS1993 | 0x06 | 4KB NV RAM 数据存储 |
| 1994 | DS1994 | 0x04 | 带实时时钟的 NV RAM |

<span class="blue">关键结论：早期 1-Wire 产品以 NV RAM 和 RTC 为核心，
<br>
iButton 形态使其成为比磁条卡更安全的物理密钥载体。
</span>
<br>

---

### <strong>1-Wire 与 Dallas 半导体战略</strong>

Dallas Semiconductor 在 1990 年代以"非易失性存储+安全"为核心竞争力。
<br>
1-Wire 协议作为其产品的统一接口，降低了客户多产品集成的复杂度。
<br>
1995 年，Dallas 推出 DS2502 1KB EEPROM（家族码 0x09），用于存储设备配置信息。
<br>
这些 EEPROM 与 iButton 共享同一总线，客户无需为不同产品学习不同协议。

---

## <strong>1996-2005：温度传感器革命与工业渗透</strong>

### <strong>DS18B20 的诞生与影响</strong>

1996 年，DS18B20 数字温度传感器发布，家族码 0x28。
<br>
这是 1-Wire 协议第一次大规模进入工业测量领域。
<br>
12-bit 分辨率（0.0625°C/LSB）、-55°C 至 +125°C 量程、±0.5°C 精度，参数媲美当时主流模拟传感器。
<br>
但单线拓扑使其在分布式测温场景中布线成本降低 60% 以上。

---

### <strong>工业应用爆发</strong>

```mermaid
flowchart LR
    IB["iButton 1990s门禁/资产"] --> IND["DS18B20 2000s工业测温"]
    IND --> COLD["冷链物流车厢温度监控"]
    IND --> GRAIN["粮仓温控多点分布式"]
    IND --> DC["数据中心机柜/空调监控"]
    IND --> HVAC["楼宇自动化暖通系统"]
    style IND fill:#e8f5e9
```

<span class="blue">关键结论：1-Wire 在"点位多、距离短、速率低"的场景中展现出独特优势。
<br>
每个传感器节省 2-3 根线，在 50 点以上的系统中布线成本差异显著。
</span>
<br>

---

### <strong>协议增强：Overdrive 模式</strong>

| 模式 | 速率 | 推出时间 | 适用场景 |
|------|------|----------|----------|
| Standard | 16.3 kbps | 1989 | 长距离、高电容 |
| Overdrive | 142 kbps | 1997 | 短距离、低电容 |

Overdrive 模式将位时隙从 61μs 缩短至 7μs，速率提升近 9 倍。
<br>
但要求总线电容 < 100pF，设备数 < 10，限制了其应用范围。
<br>
Overdrive 的推出标志着 1-Wire 试图向更高性能拓展，但单线物理层的天花板很快显现。

---

### <strong>竞争格局初现</strong>

2000 年前后，I2C 已成为板级传感器接口的事实标准。
<br>
Philips（NXP）推动的 I2C 规范从 100kHz 标准模式扩展到 400kHz 快速模式。
<br>
SPI 则在存储器和高速 ADC 领域占据主导。
<br>
1-Wire 的 16.3kbps 速率使其无法进入板级高速通信市场，只能深耕布线受限的分布式场景。

---

## <strong>2006-2015：与 I2C/SPI 的竞争定位</strong>

### <strong>为什么 1-Wire 没有成为主流总线</strong>

1-Wire 的 16.3kbps 速率在 2000 年代后成为硬伤。
<br>
I2C Fast-mode（400kHz）和 SPI（MHz 级）已占据传感器接口主流。
<br>
1-Wire 的独特优势只剩下"单线布线"和"寄生供电"，这恰好是 I2C/SPI 无法做到的。
<br>
因此 1-Wire 选择差异化定位：在布线极度受限的场景中保持存在。

---

### <strong>三种总线的选型矩阵</strong>

| 维度 | 1-Wire | I2C | SPI |
|------|--------|-----|-----|
| 信号线数 | 1 (DQ) | 2 (SDA+SCL) | 4 (MOSI+MISO+SCK+CS) |
| 典型速率 | 16.3 kbps | 100-400 kHz | 1-50 MHz |
| 设备供电 | 寄生/外部 | 外部 | 外部 |
| 多设备共享 | 是（ROM匹配） | 是（寻址） | 否（每设备CS） |
| 最大距离 | 100m | 1m | <30cm |
| 布线成本 | 最低 | 中等 | 最高 |
| 适用场景 | 分布式测温 | 板级传感器 | 高速存储/ADC |

<span class="blue">关键结论：1-Wire 不是 I2C/SPI 的替代品，而是互补品。
<br>
当布线成本大于性能需求时选择 1-Wire；反之选择 I2C/SPI。
</span>
<br>

---

### <strong>Maxim 收购与标准维护</strong>

2001 年，Maxim Integrated 收购 Dallas Semiconductor，继承 1-Wire 产品线。
<br>
Maxim 持续发布新型温度传感器（DS18S20、DS18B20-PAR 寄生供电版、DS1822 经济版）。
<br>
2008 年推出 DS28E15 安全认证器，将 1-Wire 与 SHA-256 加密结合，进入物联网安全领域。
<br>
Maxim 的维护确保了 1-Wire 在 2010 年代后仍有新品发布，而非成为遗产协议。

---

## <strong>2016-2026：IoT 时代的新生机</strong>

### <strong>现代 IoT 网关架构</strong>

```mermaid
flowchart LR
    subgraph "现场层"
        S1["DS18B20 1"] --- DQ["DQ 总线"]
        S2["DS18B20 2"] --- DQ
        S3["DS18B20 3"] --- DQ
    end
    DQ --> ESP["ESP32(1-Wire Master)"]
    ESP -- WiFi --> CLOUD["MQTT Broker/云平台"]
    CLOUD -- API --> APP["手机APP/监控大屏"]
    style ESP fill:#fff3e0
```

---

### <strong>新应用形态</strong>

| 场景 | 架构 | 1-Wire 角色 |
|------|------|-------------|
| 智能家居 | ESP32 + 多个 DS18B20 | 房间多点温度采集 |
| 智慧农业 | LoRa网关 + 1-Wire 采集节点 | 大棚土壤/空气温度 |
| 冷链监控 | 4G模组 + iButton 历史记录 | 运输全程温度轨迹 |
| 工业预测维护 | 树莓派 + w1 子系统 | 电机/变压器绕组测温 |
| 数据中心 | BMC + 1-Wire 温度探头 | 机柜进/出风口温差 |

<span class="blue">关键结论：IoT 网关（ESP32、树莓派、BeagleBone）的普及，
<br>
让 1-Wire 从"MCU 直连"升级为"边缘采集 + 云端分析"的分层架构。
<br>
1-Wire 负责末端低功耗采集，高速通信由 WiFi/4G/LoRa 承担。
</span>
<br>

---

### <strong>Linux 生态的完善</strong>

Linux 内核 w1 子系统于 2005 年合并，随后不断完善。
<br>
2010 年后，主流嵌入式 Linux 发行版（Buildroot、Yocto、OpenWrt）均默认支持 w1-gpio 驱动。
<br>
Device Tree 绑定标准化，任意 GPIO 可通过设备树声明为 1-Wire 主控制器。
<br>
2020 年后，w1 子系统增加了对新型 Maxim 温度传感器的自动识别支持。

---

### <strong>开源硬件社区的推动</strong>

Arduino OneWire 库（Paul Stoffregen 维护）于 2010 年代成为最广泛使用的 1-Wire 软件实现。
<br>
该库支持 ROM 搜索、寄生电源、多机网络等全部功能，跨平台兼容 AVR、ARM、ESP32。
<br>
树莓派的 1-Wire 教程在社区中大量传播，降低了入门门槛。
<br>
开源生态的繁荣使 1-Wire 在 Maker 和工业开发者中保持了活跃度。

---

## <strong>历史演进时间线</strong>

```mermaid
timeline
    title 1-Wire 技术演进路线
    1989 : 1-Wire 协议诞生
         : Dallas Semiconductor 提出单线通信概念
    1990 : iButton 产品发布
         : DS1990A 电子钥匙，不锈钢封装
    1996 : DS18B20 温度传感器
         : 工业测温领域的突破
    1997 : Overdrive 模式
         : 142 kbps 高速模式
    2001 : Maxim 收购 Dallas
         : 产品线持续扩展
    2005 : Linux w1 子系统
         : 内核原生支持 1-Wire
    2008 : DS28E15 安全认证器
         : SHA-256 + 1-Wire 安全方案
    2012 : ESP8266/ESP32 时代
         : IoT 网关与 1-Wire 结合
    2016 : Raspberry Pi w1 普及
         : sysfs 接口简化开发
    2020 : 边缘计算集成
         : MQTT + 1-Wire 云端监控方案
```

---

## 小结

| 要点 | 内容 |
|------|------|
| 起源 | 1989 年 Dallas Semiconductor，为 iButton 身份识别发明 |
| 突破 | 1996 年 DS18B20 将 1-Wire 带入工业温度测量 |
| 竞争定位 | 单线布线优势 vs I2C/SPI 性能劣势，差异化互补 |
| IoT 新生 | ESP32/树莓派网关 + Linux w1 子系统，边缘采集上云 |
| 未来 | 持续深耕布线受限+低速传感 niche 市场 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | 对比 1-Wire、I2C、SPI 在"50 个温度传感器分布式采集"场景中的布线成本。计算信号线总数并分析 1-Wire 节省的比例。 |
| 2 | 为什么 1-Wire 的 Overdrive 模式（142kbps）未能像 I2C Fast-mode（400kHz）那样普及？从物理层限制和市场需求两个角度分析。 |
| 3 | 在现代 IoT 架构中，1-Wire 与 WiFi/Zigbee 的分工是什么？为什么 1-Wire 不直接承担长距离通信，而是作为末端采集层？ |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：1-Wire 基础时序、GPIO 模拟读写、单点温度采集。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：ROM 搜索、多点网络、CRC 校验、与 I2C/SPI 的选型对比。
<br>
- <span class="badge-e">[Expert]</span> 掌握：历史演进分析、IoT 网关集成、Linux w1 子系统深度配置、寄生电源电路设计。

---

<span class="purple">扩展阅读</span>：Maxim Integrated "1-Wire Technology Overview"；
<br>
《The Art of Electronics》第三版第 14 章串行总线对比分析。
"""

# ========== 文件3：I2C 历史演进（扩充版） ==========
content3 = """# I2C 从 1982 到 I3C 的历史演进与未来展望

<span class="badge-e">[Expert]</span>

---

<span class="red">I2C 总线</span> 由 Philips（现 NXP）于 1982 年发明，最初用于电视机内部芯片通信。
<br>
四十余年间，从 100kHz 标准模式发展到 3.4MHz 高速模式，衍生出 SMBus、PMBus 等工业标准。
<br>
MIPI I3C 作为 I2C 的精神继承者，正逐步接管下一代传感器接口市场。
<br>
理解 I2C 的演进路线，是把握嵌入式总线技术发展趋势的关键。

---

## <strong>1982-1992：诞生与标准化</strong>

### <strong>为什么 Philips 发明 I2C</strong>

1980 年代初，电视机内部需要大量控制芯片（调谐器、音量控制、频道存储等）。
<br>
每增加一个功能就需要一组并行地址+数据线，PCB 布线越来越复杂。
<br>
Philips 工程师需要一种"只需两根线就能连接所有芯片"的方案。
<br>
I2C（Inter-Integrated Circuit）由此诞生：SDA（数据）+ SCL（时钟），开漏输出+上拉电阻。

---

### <strong>原始规范与局限性</strong>

1982 年的原始规范仅支持 100kHz 标准模式，7-bit 地址，无广播机制。
<br>
设备数量限于 112 个（0x08~0x77）。
<br>
最大总线电容 400pF，限制 PCB 走线长度。
<br>
但这些限制在电视机内部芯片通信中完全可接受。

---

### <strong>1992 年 1.0 版规范发布</strong>

1992 年，Philips 发布 I2C 1.0 规范，正式确立标准模式（100kHz）和快速模式（400kHz）。
<br>
引入 10-bit 扩展地址，设备上限提升至 1024 个。
<br>
定义完整的 START/STOP/ACK/NACK 时序，成为后续所有实现的基准。
<br>
I2C 从此走出电视机，进入更广阔的消费电子和工业控制领域。

---

## <strong>1993-2006：速率扩展与工业衍生</strong>

### <strong>高速模式 Hs-mode（3.4MHz）</strong>

| 模式 | 速率 | 推出时间 | 关键技术 |
|------|------|----------|----------|
| Standard | 100 kHz | 1982 | 开漏+上拉 |
| Fast | 400 kHz | 1992 | 开漏+上拉 |
| Fast-mode Plus | 1 MHz | 2006 | 增强驱动 |
| High-speed | 3.4 MHz | 2000 | 电流源上拉 |
| Ultra Fast-mode | 5 MHz | 2012 | 推挽输出（单向） |

2000 年推出的 Hs-mode（3.4MHz）使用电流源上拉替代电阻上拉。
<br>
电流源在 SCL 上升沿提供快速充电，下降沿仍由开漏管下拉。
<br>
但 Hs-mode 需要主设备切换电流源电路，硬件复杂度大幅增加。
<br>
实际部署中，Fast-mode（400kHz）仍是工业主流。

---

### <strong>SMBus：Intel 推动的系统管理总线</strong>

1995 年，Intel 推出 SMBus（System Management Bus），基于 I2C 物理层但重新定义协议层。
<br>
SMBus 严格规定超时机制（35ms 时钟低电平超时），防止设备死锁总线。
<br>
引入 Packet Error Checking（PEC），为关键数据附加 SMBus 特有的 CRC-8。
<br>
SMBus 成为 PC 主板上的标准接口：电池管理、温度监控、EEPROM 存储。

---

### <strong>PMBus：电源管理的数字化</strong>

2004 年，PMBus（Power Management Bus）发布，基于 SMBus 但专为电源转换器设计。
<br>
PMBus 定义标准命令集：输出电压设置、过流保护阈值、温度监控、故障报告。
<br>
数字电源（Digital Power）的兴起使 PMBus 成为服务器电源、通信电源的标配。
<br>
PMBus 1.2（2010 年）加入 Zone 概念，支持总线分段寻址，扩展至大规模电源系统。

---

## <strong>2007-2015：I2C 的瓶颈与变革前夜</strong>

### <strong>为什么 I2C 需要变革</strong>

智能手机的传感器数量从 2007 年的 3-4 个激增至 2015 年的 15+ 个。
<br>
加速度计、陀螺仪、磁力计、气压计、环境光、接近传感器、指纹识别等都需要总线连接。
<br>
I2C 的 400kHz 速率在多传感器并发读取时成为瓶颈。
<br>
更严重的是，I2C 的中断机制缺失：传感器事件必须通过主机轮询检测，功耗极高。

---

### <strong>MIPI Alliance 的介入</strong>

2003 年成立的 MIPI Alliance 最初专注于移动设备摄像头和显示接口。
<br>
2013 年，MIPI 成立传感器工作组，目标是定义下一代传感器接口。
<br>
工作组面临的约束：必须兼容现有 I2C 传感器生态，不能要求厂商重新设计全部产品。
<br>
2016 年，I3C（Improved Inter-Integrated Circuit）规范正式发布。

---

## <strong>2016-2026：I3C 过渡与未来展望</strong>

### <strong>I3C 对 I2C 的兼容性设计</strong>

```mermaid
flowchart LR
    I2C["I2C 设备遗留"] --> BUS["I3C 总线混合模式"]
    I3C["I3C 设备原生"] --> BUS
    BUS --> HDR["HDR 模式12.5MHz"]
    BUS --> SDR["SDR 模式12.5MHz原生"]
    style BUS fill:#e3f2fd
```

I3C 总线支持 I2C 设备共存，但 I3C 设备启用 HDR（High Data Rate）模式时 I2C 设备被静默。
<br>
这种"向后兼容、向前演进"的设计降低了厂商迁移成本。
<br>
I3C 保留 SDA/SCL 双线命名，但电气特性改为推挽输出，速率跃升至 12.5MHz SDR。
<br>
更重要的是，I3C 引入 IBI（In-Band Interrupt）带内中断，传感器可主动通知主机事件。

---

### <strong>I2C 到 I3C 的关键改进对比</strong>

| 特性 | I2C | I3C |
|------|-----|-----|
| 最大速率 | 3.4 MHz (Hs) | 12.5 MHz (SDR) |
| 最小速率 | 无 | 12.5 MHz (无低速模式) |
| 中断机制 | 无（需轮询） | IBI 带内中断 |
| 动态地址 | 无（固定地址） | 有（总线枚举分配） |
| 热插拔 | 不支持 | 支持 |
| 功耗 | 较高（开漏上拉持续耗电） | 较低（推挽+时钟停止） |
| 兼容 I2C | - | 是（混合模式） |

<span class="blue">关键结论：I3C 不是 I2C 的简单提速，而是重新设计了地址分配、中断、功耗管理机制。
<br>
12.5MHz 速率 + IBI 中断 + 动态地址，使其成为多传感器移动设备的理想接口。
</span>
<br>

---

### <strong>未来发展方向</strong>

I2C 在工业控制和传统嵌入式领域仍将继续存在。
<br>
SMBus/PMBus 生态已深度绑定 PC 电源管理，短期内不会被替代。
<br>
但在智能手机、可穿戴设备、AR/VR 等传感器密集型场景中，I3C 正在快速渗透。
<br>
高通骁龙 8 Gen 2、联发科天玑 9200 等旗舰 SoC 已原生支持 I3C。
<br>
未来 5-10 年，I2C 与 I3C 将长期共存，前者服务存量工业市场，后者主导新兴移动市场。

---

## <strong>历史演进时间线</strong>

```mermaid
timeline
    title I2C 技术演进路线
    1982 : I2C 协议诞生
         : Philips 为电视机内部芯片通信发明
    1992 : I2C 1.0 规范
         : 标准模式 100kHz + 快速模式 400kHz
    1995 : SMBus 发布
         : Intel 定义系统管理总线
    2000 : Hs-mode 3.4MHz
         : 电流源上拉实现高速
    2004 : PMBus 发布
         : 数字电源管理标准
    2006 : Fast-mode Plus 1MHz
         : 增强驱动能力
    2012 : Ultra Fast-mode 5MHz
         : 推挽单向输出
    2016 : MIPI I3C 发布
         : 12.5MHz + IBI 中断 + 动态地址
    2020 : I3C 在旗舰 SoC 普及
         : 高通、联发科原生支持
    2026 : I2C/I3C 长期共存
         : 工业市场 I2C + 移动市场 I3C
```

---

## 小结

| 要点 | 内容 |
|------|------|
| 起源 | 1982 年 Philips，为电视机内部芯片通信发明 |
| 速率演进 | 100kHz -> 400kHz -> 1MHz -> 3.4MHz -> 5MHz |
| 工业衍生 | SMBus（PC 管理）、PMBus（数字电源） |
| 变革驱动 | 智能手机传感器激增，I2C 速率+中断机制不足 |
| I3C 继承 | 12.5MHz SDR、IBI 中断、动态地址、I2C 兼容 |
| 未来格局 | 工业 I2C 存量 + 移动 I3C 增量，长期共存 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | 为什么 I2C 的 Hs-mode（3.4MHz）使用电流源上拉而非电阻上拉？从 RC 充电时间常数和总线电容关系推导。 |
| 2 | SMBus 的 35ms 时钟超时机制解决了 I2C 的什么固有问题？设想一个 I2C 设备死锁时主机和总线的状态，说明 SMBus 超时如何恢复。 |
| 3 | 如果一颗 SoC 需要同时连接 20 个传感器，为什么 I3C 比 I2C 更适合？从速率、中断、功耗三个维度分析。 |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：I2C 基础时序、7/10-bit 地址、START/STOP 条件、ACK/NACK 机制。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：Fast-mode/Fm+/Hs-mode 时序差异、SMBus/PMBus 协议层、Linux i2c-dev 驱动。
<br>
- <span class="badge-e">[Expert]</span> 掌握：I2C 到 I3C 的演进逻辑、I3C HDR/SDR 模式、IBI 中断设计、动态地址分配机制、未来总线选型决策。

---

<span class="purple">扩展阅读</span>：NXP I2C Specification v6（2014）；MIPI Alliance I3C Specification v1.1.1；
<br>
Intel SMBus Specification 3.2；PMBus Power System Management Protocol Specification 1.3。
"""

# ========== 文件4：MDIO 逻辑级与以太网驱动 ==========
content4 = """# MDIO 帧结构与 Linux 以太网 PHY 驱动

<span class="badge-e">[Expert]</span>

---

<span class="red">MDIO（Management Data Input/Output）</span> 是以太网 MAC 与 PHY 之间的管理接口，
<br>
通常与 MII/RGMII/SGMII 数据接口配合使用。
<br>
MDIO 仅包含 MDC（时钟）和 MDIO（双向数据）两条线，负责 PHY 寄存器的读写配置。
<br>
理解 MDIO 帧结构和 Linux mdio_bus 驱动，是嵌入式网络开发的必备技能。

---

## <strong>MDIO 帧结构详解</strong>

### <strong>Clause 22 帧格式（传统 MDIO）</strong>

IEEE 802.3 Clause 22 定义了 32 个 PHY 寄存器的标准读写帧格式：

```
| Preamble | ST  | OP   | PHYADR | REGADR | TA | Data (16bit) | Idle |
|----------|-----|------|--------|--------|----|-------------|------|
| 32 bit   | 2bit| 2bit | 5bit   | 5bit   | 2bit| 16bit       | -    |
```

| 字段 | 位宽 | 读操作值 | 写操作值 | 说明 |
|------|------|----------|----------|------|
| Preamble | 32 | 全 1 | 全 1 | 同步前导 |
| ST (Start) | 2 | 01 | 01 | 起始帧 |
| OP (Opcode) | 2 | 10 | 01 | 10=读，01=写 |
| PHYADR | 5 | 目标地址 | 目标地址 | 0-31 |
| REGADR | 5 | 寄存器号 | 寄存器号 | 0-31 |
| TA (Turnaround) | 2 | Z0 | 10 | 读时主机释放总线 |
| Data | 16 | 读出的值 | 写入的值 | 寄存器数据 |

<span class="blue">关键结论：Clause 22 限制最多 32 个 PHY 地址、32 个寄存器，
<br>
无法满足现代千兆/万兆 PHY 大量扩展寄存器的需求。
</span>
<br>

---

### <strong>Clause 45 帧格式（扩展 MDIO）</strong>

IEEE 802.3 Clause 45 扩展了地址空间和设备类型：

```
| Preamble | ST  | OP   | PHYADR | DEVTYPE | TA | Address/Data(16bit) | Idle |
|----------|-----|------|--------|---------|----|---------------------|------|
| 32 bit   | 2bit| 2bit | 5bit   | 5bit    | 2bit| 16bit               | -    |
```

| OP 码 | 含义 | 用途 |
|-------|------|------|
| 00 | 地址写入 | 设置目标扩展寄存器地址 |
| 01 | 数据写入 | 向当前地址写入 16-bit 数据 |
| 10 | 数据读取 | 从当前地址读取 16-bit 数据 |
| 11 | 地址读取 | 读取当前地址指针（较少用） |

```mermaid
sequenceDiagram
    participant MAC as MAC MDIO
    participant PHY as PHY芯片
    Note over MAC,PHY: Clause 45 扩展寄存器读取
    MAC->>PHY: 地址帧: OP=00, DEVTYPE=3(PMA/PMD), Address=0x1234
    PHY-->>MAC: ACK
    MAC->>PHY: 数据帧: OP=10, DEVTYPE=3, Data=??
    PHY-->>MAC: 返回 0x5678
```

<span class="green">`DEVTYPE`</span> 字段定义设备类型：
<br>
0=保留，1=PMA/PMD，2=WIS，3=PCS，4=PHY XS，5=DTE XS，6=TC，7=自动协商，29/30/31=厂商自定义。

---

## <strong>PHY 寄存器标准映射</strong>

### <strong>为什么寄存器地址是标准化的</strong>

IEEE 802.3 强制规定 Register 0-15 的标准语义，确保不同厂商 PHY 能被统一驱动管理。
<br>
Register 16-31 留给厂商自定义，用于实现芯片特有功能（LED 控制、时序调整等）。
<br>
这种分层设计使 Linux 内核可以编写通用 PHY 驱动框架，而厂商只需补充私有扩展。

---

### <strong>关键寄存器一览</strong>

| 寄存器 | 名称 | 标准定义 | 典型用途 |
|--------|------|----------|----------|
| Reg 0 | Control | 802.3 Clause 22 | 复位、自协商使能、速率/双工设置 |
| Reg 1 | Status | 802.3 Clause 22 | 自协商完成、链路状态、故障检测 |
| Reg 2 | PHY ID 1 | 802.3 Clause 22 | 厂商 ID 高 16 位（如 Marvell=0x0141） |
| Reg 3 | PHY ID 2 | 802.3 Clause 22 | 厂商 ID 低 16 位 + 型号 + 版本 |
| Reg 4 | Auto-Neg Adv | 802.3 Clause 22 | 通告支持的速率和双工模式 |
| Reg 9 | 1000BASE-X Ctrl | 802.3 Clause 22 | 千兆光纤自协商控制 |
| Reg 10 | 1000BASE-X Stat | 802.3 Clause 22 | 千兆光纤自协商状态 |
| Reg 17 | SGMII Control | Cisco/SerDes 私有 | SGMII 模式使能、链路定时器 |

---

### <strong>Link Status 检测机制</strong>

```c
// 轮询链路状态的典型代码
uint16_t reg1 = mdio_read(phy_addr, 1);  // Read Status Register
uint8_t link_up = (reg1 >> 2) & 0x1;      // Bit 2: Link Status
uint8_t aneg_done = (reg1 >> 5) & 0x1;    // Bit 5: Auto-Negotiation Complete

// Linux 内核 phylib 中的标准链路检测
// drivers/net/phy/phy.c: genphy_read_status()
// 1. 读 Reg 1 确认 link_up
// 2. 读 Reg 4/9 确认自协商结果
// 3. 读厂商私有寄存器确认实际速率
```

<span class="blue">关键结论：Link Status（Reg1 bit2）是 latch-low 位，
<br>
链路断开时会锁存 0，直到下一次 MDIO 读取才更新。
<br>
因此中断驱动方式比轮询更高效，链路变化由 PHY INT 引脚通知 MAC。
</span>

---

## <strong>Linux mdio_bus 驱动框架</strong>

### <strong>为什么内核需要 mdio_bus 抽象</strong>

现代 SoC 中 MDIO 控制器可能集成在 MAC（如 STM32 ETH）、独立存在（如 IP101GR），或由交换机芯片提供。
<br>
Linux 内核将 MDIO 控制器抽象为 `mdio_bus`，将 PHY 设备抽象为 `phy_device`，
<br>
实现控制器与 PHY 的解耦，同一驱动可适配不同硬件平台。

---

### <strong>设备树绑定与注册</strong>

```dts
// arch/arm/boot/dts/stm32f7.dts 示例
&mac {
    pinctrl-names = "default";
    pinctrl-0 = <&ethernet_mdc_pa1>;
    phy-mode = "rmii";
    phy-handle = <&phy0>;
    
    mdio {
        #address-cells = <1>;
        #size-cells = <0>;
        
        phy0: ethernet-phy@0 {
            reg = <0>;              // PHY 地址 0
            compatible = "ethernet-phy-ieee802.3-c22";
            reset-gpios = <&gpioa 0 GPIO_ACTIVE_LOW>;
        };
    };
};
```

<span class="green">`phy-mode = "rmii"`</span> 指定数据接口为 RGMII 之前的简化版，MDIO 独立管理。
<br>
<span class="green">`reg = <0>`</span> 是 PHY 在 MDIO 总线上的地址，硬件通过 PHYAD 引脚（上拉/下拉）配置。

---

### <strong>驱动核心结构</strong>

```c
// drivers/net/phy/mdio_bus.c 核心逻辑
struct mii_bus *devm_mdiobus_alloc(struct device *dev);
int mdiobus_register(struct mii_bus *bus);

// PHY 读写 API
int mdiobus_read(struct mii_bus *bus, int addr, u32 regnum);
int mdiobus_write(struct mii_bus *bus, int addr, u32 regnum, u16 val);

// PHY 设备探测
static int mdio_bus_match(struct device *dev, struct device_driver *drv) {
    struct phy_device *phydev = to_phy_device(dev);
    struct phy_driver *phydrv = to_phy_driver(drv);
    // 匹配 PHY ID（Reg 2/3）与驱动支持的 ID 列表
    return phydrv->phy_id == (phydev->phy_id & phydrv->phy_id_mask);
}
```

<span class="green">`phy_id`</span> 由 Reg 2 和 Reg 3 拼接而成：`(Reg2 << 16) | Reg3`，唯一标识 PHY 型号。
<br>
<span class="green">`mdiobus_read/write`</span> 是同步阻塞调用，底层触发 MDIO 状态机发送 Clause 22 帧。

---

### <strong>通用 PHY 驱动（phylib）</strong>

```c
// drivers/net/phy/phy_device.c: phy_init()
// 自动识别 PHY ID 并绑定对应驱动

// 若厂商未提供专用驱动，fallback 到 genphy（通用 PHY 驱动）
static struct phy_driver genphy_driver = {
    .phy_id         = 0xffffffff,
    .phy_id_mask    = 0xffffffff,
    .name           = "Generic PHY",
    .read_status    = genphy_read_status,
    .config_aneg    = genphy_config_aneg,
    .soft_reset     = genphy_soft_reset,
};
```

<span class="blue">关键结论：Linux phylib 框架通过 PHY ID 自动匹配驱动，
<br>
未知 PHY 回退到 genphy，基本功能（速率/双工/链路检测）仍可工作。
<br>
但厂商特有功能（EEE 节能、LED、RGMII 时序调谐）需要专用驱动支持。
</span>

---

## <strong>历史演进与工业应用</strong>

MDIO 随 MII 接口于 1995 年在 IEEE 802.3u（快速以太网）中标准化。
<br>
Clause 22 为 10/100M 时代设计，32 个寄存器足够覆盖基础配置。
<br>
2002 年千兆以太网普及后，32 个寄存器明显不足，Clause 45 于 IEEE 802.3ae（10G）中引入。
<br>
Clause 45 通过 DEVTYPE + 扩展地址空间，支持数千个寄存器，覆盖 SerDes、PMA、PCS 等子层。
<br>
在嵌入式 Linux 中，mdio_bus 框架于 2.6 内核时代成熟，Device Tree 绑定在 3.x 后标准化。
<br>
现代 SoC（i.MX、STM32、RK3588）均将 MDIO 集成到以太网 MAC 或独立作为 GPIO bitbang 实现。

---

## 小结

| 要点 | 内容 |
|------|------|
| Clause 22 | 32 地址 x 32 寄存器，OP=10/01 读/写，适用于 10/100M PHY |
| Clause 45 | 32 地址 x 32 DEVTYPE x 65536 寄存器，OP=00/01/10/11，适用于千兆+ PHY |
| 关键寄存器 | Reg0 控制、Reg1 状态、Reg2/3 PHY ID、Reg4 自协商通告 |
| Linux 框架 | mdio_bus 抽象控制器、phy_device 抽象 PHY、phylib 自动识别 |
| 设备树 | `phy-handle` + `mdio` 子节点 + `reg` 配置 PHY 地址 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | Clause 22 的 TA（Turnaround）字段在读操作时为什么要求主机先释放 MDIO 总线（Z 状态），再读取 PHY 数据？从开漏/推挽电气特性分析。 |
| 2 | 为什么现代千兆 PHY 需要 Clause 45 而非 Clause 22？计算两种帧格式可访问的寄存器总数并分析扩展性差异。 |
| 3 | 在 Linux 内核中，若一颗新 PHY 芯片没有专用驱动，genphy 如何保证基本功能（速率、双工、链路检测）可用？从 phy_id 匹配和通用寄存器语义分析。 |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：MDIO 引脚定义、 Clause 22 帧格式、基本寄存器读写。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：Clause 45 扩展帧格式、PHY 寄存器语义、Linux mdio_bus 框架。
<br>
- <span class="badge-e">[Expert]</span> 掌握：Linux phylib 驱动开发、Device Tree 绑定、厂商私有寄存器调试、RGMII/SGMII 时序配合。

---

<span class="purple">扩展阅读</span>：IEEE 802.3 Clause 22/45；Linux Kernel `Documentation/devicetree/bindings/net/ethernet-phy.yaml`；
<br>
`drivers/net/phy/` 目录下内核 PHY 驱动源码。
"""

# ========== 文件5：MDIO 历史演进 ==========
content5 = """# MDIO 从 MII 到 XFI 的历史演进

<span class="badge-e">[Expert]</span>

---

<span class="red">MDIO 管理接口</span> 随 MII 数据接口于 1995 年标准化，最初仅支持 10/100M 以太网 PHY 配置。
<br>
随着以太网从百兆到万兆的演进，MDIO 先后经历 Clause 22、Clause 45 两次重大升级，
<br>
与 RGMII、SGMII、XFI 等数据接口协同演化。
<br>
理解 MDIO 的演进脉络，有助于在嵌入式网络选型中正确匹配 PHY 与 MAC 的管理接口。

---

## <strong>1995-2000：MII 时代与 Clause 22 诞生</strong>

### <strong>为什么 MII 需要配套管理接口</strong>

1995 年 IEEE 802.3u 定义快速以太网（100BASE-TX），引入 MII（Media Independent Interface）
<br>
将 MAC 与 PHY 解耦，同一 MAC 可适配不同物理层（双绞线、光纤）。
<br>
但速率协商、链路检测、环回测试等功能需要寄存器访问机制。
<br>
MDIO 应运而生：2 线串行接口，32 地址 x 32 寄存器，满足当时百兆 PHY 的配置需求。

---

### <strong>MII + MDIO 经典架构</strong>

```mermaid
flowchart LR
    MAC["MAC 控制器"] -- TXD[4:0]--> MII["MII 接口"]
    MAC -- RXD[4:0]--> MII
    MAC -- TX_CLK/RX_CLK--> MII
    MAC -- MDC --> MDIO["MDIO 管理"]
    MAC -- MDIO --> MDIO
    MII --> PHY["PHY 芯片\n10/100M"]
    MDIO --> PHY
    style MII fill:#e3f2fd
    style MDIO fill:#e8f5e9
```

MII 使用 16 根数据线（TXD/RXD 各 4-bit + 控制/时钟），MDIO 仅需 2 根线。
<br>
这种分离设计使 MAC 只需关注数据转发，PHY 配置由 MDIO 独立管理。

---

## <strong>2001-2005：RGMII/SGMII 精简与千兆普及</strong>

### <strong>为什么 MII 需要瘦身</strong>

千兆以太网（1000BASE-T）于 1999 年标准化，MII 的 16 根线在 PCB 上占用过多引脚。
<br>
RGMII（Reduced Gigabit Media Independent Interface）将数据线压缩至 12 根，
<br>
通过在时钟边沿双采样（DDR）保持 1Gbps 速率。
<br>
SGMII（Serial Gigabit MII）进一步将数据接口串行化，仅需 2 对差分线（TX/RX）。

---

### <strong>RGMII/SGMII 与 MDIO 的配合</strong>

| 数据接口 | 数据线数 | 时钟 | MDIO 角色 | 典型应用 |
|----------|----------|------|-----------|----------|
| MII | 16 | 25MHz | 独立管理 | 早期百兆嵌入式 |
| RMII | 10 | 50MHz | 独立管理 | 精简百兆（STM32） |
| RGMII | 12 | 125MHz DDR | 独立管理 | 千兆主流方案 |
| SGMII | 2对差分 | SerDes | 独立管理 | 千兆SerDes方案 |
| XFI | 1对差分 | 10.3125G SerDes | 扩展管理(Clause45) | 万兆光纤 |

<span class="blue">关键结论：数据接口从并行走向串行，但 MDIO 始终保持独立管理角色。
<br>
即使 SGMII/XFI 使用 SerDes，PHY 寄存器配置仍需 MDIO/Clause 45。
</span>
<br>

---

### <strong>RGMII 时序与 PHY 寄存器调谐</strong>

```c
// 典型 RGMII RX 时钟延迟调谐（Marvell PHY）
// 通过 MDIO 修改厂商私有寄存器
mdio_write(phy_addr, 0x1D, 0x1F);  // 选择 Page 31
mdio_write(phy_addr, 0x1E, 0x00B0); // 选择寄存器 0xB0 (RGMII 时序)
uint16_t val = mdio_read(phy_addr, 0x1E);
val |= (1 << 7);  // 设置 RX 时钟延迟使能
mdio_write(phy_addr, 0x1E, val);
```

RGMII 要求 TX 时钟与数据边沿对齐，RX 时钟需 1.5-2.0ns 延迟避免采样冲突。
<br>
这些时序参数通常通过 MDIO 访问 PHY 私有寄存器调整。
<br>
不同厂商（Marvell、Realtek、Micrel）的寄存器映射各不相同，驱动开发需查阅 datasheet。

---

## <strong>2006-2015：Clause 45 与万兆扩展</strong>

### <strong>为什么 Clause 22 无法满足万兆需求</strong>

10G 以太网 PHY 内部结构远比百兆复杂：PCS（物理编码子层）、PMA（物理媒介附加）、
<br>
PMD（物理媒介相关）、WIS（WAN 接口子层）、Auto-Neg 等子模块都需要独立寄存器空间。
<br>
Clause 22 的 32 个寄存器远远不够，且 DEVTYPE 字段缺失导致无法区分子模块。
<br>
Clause 45 通过引入 DEVTYPE（5-bit）和地址/数据分离帧，将可访问寄存器扩展至 32x32x64K。

---

### <strong>Clause 45 与 XFI 的协同</strong>

XFI（10 Gigabit Serial Electrical Interface）使用单通道 10.3125Gbps SerDes，
<br>
物理层通常是集成 MAC+PHY 的网卡芯片（如 Intel X710），或交换机 ASIC。
<br>
在此场景中，MDIO 不再连接外部 PHY，而是访问芯片内部的 SerDes 寄存器。
<br>
Clause 45 的 DEVTYPE=1（PMA/PMD）和 DEVTYPE=3（PCS）成为调谐误码率、预加重、均衡的关键接口。

---

## <strong>历史演进时间线</strong>

```mermaid
timeline
    title MDIO 与数据接口演进路线
    1995 : MII + MDIO Clause22
         : 16根数据线 + 2线管理，10/100M
    1999 : RGMII 诞生
         : 12根 DDR 数据线，千兆主流
    2002 : Clause45 引入
         : 万兆扩展寄存器空间
    2003 : SGMII 普及
         : SerDes 串行数据 + MDIO 管理
    2006 : XFI 万兆接口
         : 单通道10G SerDes
    2010 : Linux mdio_bus 成熟
         : Device Tree 绑定标准化
    2016 : Clause45 在嵌入式普及
         : RK3588/i.MX8 原生 Clause45 支持
    2020 : USXGMII 多速率接口
         : 2.5G/5G/10G 统一 SerDes
```

---

## 小结

| 要点 | 内容 |
|------|------|
| 起源 | 1995 年 MII 配套管理接口，Clause 22 标准化 |
| 数据接口瘦身 | MII(16) -> RMII(10) -> RGMII(12 DDR) -> SGMII(2差分) -> XFI(1差分) |
| MDIO 升级 | Clause 22(32x32) -> Clause 45(32x32x64K)，DEVTYPE 区分子模块 |
| 时序调谐 | RGMII RX 时钟延迟、SGMII 链路定时器通过 MDIO 厂商私有寄存器配置 |
| 嵌入式趋势 | 现代 SoC 通过 mdio_bus 框架统一支持 Clause 22/45，PHY 地址由设备树配置 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | RGMII 为什么需要在时钟边沿双采样（DDR）才能用 12 根线实现 1Gbps？计算单线速率并与 MII 对比。 |
| 2 | Clause 45 的地址帧（OP=00）和数据帧（OP=10）分离设计，相比 Clause 22 的直接读写有什么优势和劣势？从协议效率和实现复杂度分析。 |
| 3 | 在 SGMII 架构中，MDIO 管理的是外部 PHY 还是 MAC 内部的 SerDes 控制器？若使用 XFI 直连光模块（无外部 PHY），MDIO 还有存在的必要吗？ |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：MDIO 引脚定义、Clause 22 帧结构、基本寄存器读写。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：RGMII/SGMII 与 MDIO 的配合、PHY 地址配置、Linux mdio_bus 注册。
<br>
- <span class="badge-e">[Expert]</span> 掌握：Clause 45 扩展帧、万兆 SerDes 寄存器调谐、XFI/USXGMII 接口演进、厂商 PHY 私有寄存器逆向调试。

---

<span class="purple">扩展阅读</span>：IEEE 802.3 Clause 22/45；RGMII v2.0 Specification（RapidlIO Trade Association）；
<br>
Cisco SGMII Application Note；Linux `drivers/net/phy/` 源码。
"""

print("=" * 60)
print("开始批量写入文件...")
print("=" * 60)

# 写文件2
p2 = find_file("docs/08-总线协议/基础外设通信总线/1-Wire/05-1-Wire历史演进与前沿.md")
if p2:
    sz = write_content(p2, content2)
else:
    print("ERROR: 找不到 05-1-Wire历史演进与前沿.md")

# 写文件3
p3 = find_file("docs/08-总线协议/基础外设通信总线/I2C/05-I2C历史演进与未来展望.md")
if p3:
    sz = write_content(p3, content3)
else:
    print("ERROR: 找不到 05-I2C历史演进与未来展望.md")

# 写文件4
p4 = find_file("docs/08-总线协议/基础外设通信总线/MDIO/04-MDIO逻辑级与以太网驱动.md")
if p4:
    sz = write_content(p4, content4)
else:
    print("ERROR: 找不到 04-MDIO逻辑级与以太网驱动.md")

# 写文件5
p5 = find_file("docs/08-总线协议/基础外设通信总线/MDIO/05-MDIO历史演进.md")
if p5:
    sz = write_content(p5, content5)
else:
    print("ERROR: 找不到 05-MDIO历史演进.md")

print("=" * 60)
print("第一批文件写入完成")
print("=" * 60)
