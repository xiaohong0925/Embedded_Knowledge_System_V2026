# 音视频专用总线

<span class="badge-i">[Intermediate]</span> <span class="badge-e">[Expert]</span>

<span class="red">音视频专用总线</span>是移动设备和嵌入式系统中用于多媒体数据传输的专用接口。
<br>
从I2S的数字音频时序到MIPI DSI的显示屏接口，从MIPI CSI-2的摄像头连接到PCM的语音通话，这些协议定义了我们"看到"和"听到"的数字世界。
<br>
理解音视频总线的时钟同步、数据格式和带宽计算，是设计多媒体嵌入式平台的基础。
<br>
本类别覆盖六种核心总线：I2S、PCM、TDM、PDM、MIPI DSI和MIPI CSI-2。
<br>

---

## <strong>本类别总线总览</strong>

| 总线 | 类型 | 最大速率 | 信号线 | 典型应用 |
|------|------|----------|--------|----------|
| I2S | 数字音频 | 采样率×位深×通道数 | 3+（BCLK+WS+SD） | DAC、ADC、音频Codec |
| PCM | 语音数字 | 2.048Mbps（E1） | 4（BCLK+FS+DX+DR） | 语音编解码、电话系统 |
| TDM | 时分复用音频 | 采样率×位深×N通道 | 3+ | 多通道音频系统 |
| PDM | 脉冲密度调制 | MHz级 | 1-2 | MEMS麦克风 |
| MIPI DSI | 显示接口 | 4.5Gbps/lane | 4lane+时钟 | 手机显示屏、车载仪表 |
| MIPI CSI-2 | 摄像头接口 | 4.5Gbps/lane | 4lane+时钟 | 手机摄像头、ADAS |

---

## <strong>多媒体接口选择</strong>

### <strong>音频接口：I2S vs PCM vs TDM vs PDM</strong>

| 接口 | 通道数 | 位深 | 时钟同步 | 典型场景 |
|------|--------|------|----------|----------|
| I2S | 2（立体声） | 16/24/32bit | 独立BCLK | Hi-Fi音频、蓝牙 |
| PCM | 1-2 | 8/16bit | 独立BCLK | 语音通话、电话 |
| TDM | 2-16+ | 16/24/32bit | 共享BCLK | 会议系统、车载多通道 |
| PDM | 1-2 | 1bit（过采样） | 共享CLK | MEMS麦克风阵列 |

<span class="blue">关键认知：音频接口的选择核心是"通道数 vs 位深 vs 布线复杂度"——I2S适合立体声，TDM适合多通道，PDM适合低成本麦克风阵列。它们的物理层差异很小，主要区别在于帧格式和时钟分配。
</span><br>

### <strong>视频接口：MIPI DSI vs MIPI CSI-2</strong>

MIPI Alliance定义了移动设备中摄像头和显示屏的标准接口：
<br>
- <span class="green">MIPI DSI</span>（Display Serial Interface）：从SoC到显示屏的串行接口，支持命令模式和视频模式
<br>
- <span class="green">MIPI CSI-2</span>（Camera Serial Interface 2）：从摄像头到SoC的串行接口，支持RAW、YUV和压缩格式
<br>

| 特性 | MIPI DSI | MIPI CSI-2 |
|------|----------|------------|
| 方向 | SoC → 显示屏 | 摄像头 → SoC |
| 物理层 | D-PHY v1.2/C-PHY | D-PHY v1.2/C-PHY |
| 最大速率 | 4.5Gbps/lane | 4.5Gbps/lane |
| 典型lane数 | 2-4 | 2-4 |
| 低功耗模式 | 支持 | 支持 |
| 传输类型 | 命令+视频流 | 图像数据包 |
| 虚拟通道 | 支持（多显示） | 支持（多摄像头） |

---

## <strong>带宽计算实例</strong>

### <strong>音频带宽计算</strong>

音频接口的带宽需求由三个参数决定：采样率、位深和通道数。
<br>
公式：带宽 = 采样率 × 位深 × 通道数
<br>

| 场景 | 采样率 | 位深 | 通道数 | 所需带宽 |
|------|--------|------|--------|----------|
| 语音通话 | 8kHz | 16bit | 1 | 128kbps |
| CD音质 | 44.1kHz | 16bit | 2 | 1.41Mbps |
| Hi-Fi音频 | 96kHz | 24bit | 2 | 4.61Mbps |
| 专业录音 | 192kHz | 32bit | 2 | 12.29Mbps |
| 7.1环绕声 | 48kHz | 24bit | 8 | 9.22Mbps |

### <strong>视频带宽计算</strong>

视频接口的带宽需求由分辨率、刷新率、色深和压缩比决定。
<br>
公式：带宽 = 分辨率 × 刷新率 × 色深 × 压缩比
<br>

| 场景 | 分辨率 | 刷新率 | 色深 | 所需带宽（原始） | MIPI lane需求 |
|------|--------|--------|------|-----------------|---------------|
| 手机屏 | 1080×2400 | 120Hz | 24bit | 7.46Gbps | 2lane D-PHY |
| 平板屏 | 2732×2048 | 120Hz | 24bit | 16.1Gbps | 4lane D-PHY |
| 车载仪表 | 1920×720 | 60Hz | 24bit | 1.99Gbps | 1-2lane |
| 摄像头1080p | 1920×1080 | 30fps | RAW10 | 622Mbps | 1-2lane |
| 摄像头4K | 3840×2160 | 30fps | RAW10 | 2.49Gbps | 2-4lane |
| 摄像头8K | 7680×4320 | 30fps | RAW10 | 9.95Gbps | 4lane C-PHY |

---

## <strong>为什么MIPI dominates移动多媒体</strong>

MIPI Alliance的接口标准在移动设备中占据统治地位，原因有三：
<br>
- <strong>引脚效率</strong>：4lane MIPI DSI即可驱动2K显示屏，而传统RGB并行接口需要24+根线
<br>
- <strong>功耗优化</strong>：MIPI D-PHY支持低功耗模式（LP Mode），静态功耗仅为高速模式的1/100
<br>
- <strong>生态锁定</strong>：全球主流SoC（高通、联发科、三星）、显示屏和摄像头模组都支持MIPI
<br>

<span class="blue">关键认知：MIPI的成功不是技术最优，而是"移动场景最优"——在引脚受限、功耗敏感、空间紧凑的移动设备中，MIPI的串行+低功耗设计是工程最优解。
</span><br>

---

## <strong>小结</strong>

| 要点 | 内容 |
|------|------|
| 音频总线 | I2S（立体声）、PCM（语音）、TDM（多通道）、PDM（麦克风） |
| 视频总线 | MIPI DSI（显示）、MIPI CSI-2（摄像头） |
| 选型核心 | 通道数 vs 位深 vs 布线复杂度 |
| MIPI优势 | 引脚少、功耗低、移动生态庞大 |
| 音频计算 | 带宽 = 采样率 × 位深 × 通道数 |
| 视频计算 | 带宽 = 分辨率 × 刷新率 × 色深 × 压缩比 |

## <strong>练习</strong>

1. 计算一个1920×1080@60fps的显示屏通过MIPI DSI 4lane传输所需的带宽。假设色深为24bit，MIPI DSI使用D-PHY v1.2（1.5Gbps/lane），是否满足需求？
2. 设计一个8通道会议系统的音频接口方案。比较TDM和I2S两种方案在布线复杂度和时钟同步方面的差异。
3. 为什么PDM麦克风（1bit过采样）可以通过简单的低通滤波器重建高保真音频？从Σ-Δ调制原理角度解释。

| 题目 | 考查点 | 难度 |
|------|--------|------|
| 1 | MIPI DSI带宽计算 | Intermediate |
| 2 | TDM vs I2S多通道设计 | Intermediate |
| 3 | PDM/Σ-Δ调制原理 | Expert |

---

## <strong>学习路径</strong>

- <span class="badge-i">[Intermediate]</span> 从I2S的BCLK/WS/SD时序入手，理解音频采样率和位深对带宽的影响。
<br>
- <span class="badge-e">[Expert]</span> 深入研究MIPI D-PHY的HS/LP模式切换、CSI-2的虚拟通道和DSI的命令模式协议。
<br>
- <span class="purple">扩展阅读：I2S Specification from Philips Semiconductor、MIPI DSI Specification v2.0、MIPI CSI-2 Specification v3.0、MIPI D-PHY Specification v2.5。
</span><br>
