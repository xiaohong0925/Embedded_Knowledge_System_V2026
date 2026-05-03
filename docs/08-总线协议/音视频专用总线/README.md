# 第六部分：音视频专用总线

<span class="badge-i">[I]</span> <span class="badge-e">[E]</span>


> **难度等级**：I → E
> 
003e 本部分覆盖<span class="red">移动设备和嵌入式系统</span>中的音视频传输协议。
003e 
003e 从 MIPI DSI 的显示屏接口到 MIPI CSI 的摄像头接口，从 I2S 的数字音频到 PCM 的语音通话，
003e 这些协议定义了我们"看到"和"听到"的世界。

---

## 本部分大章概览

| 大章 | 难度 | 核心内容 | 典型场景 |
| --- | --- | --- | --- |
| MIPI Alliance | I → E | DSI/CSI/D-PHY/C-PHY/M-PHY | 手机屏、摄像头、射频 |
| I2S/PCM | B → I | 串行音频、主从模式、TDM | 音频编解码、语音通话 |

---

## 学习路径建议

**路径 A（手机/平板显示）**：
MIPI DSI → D-PHY → 面板时序

**路径 B（摄像头/机器视觉）**：
MIPI CSI-2 → D-PHY/C-PHY → ISP  pipeline

**路径 C（音频/语音）**：
I2S → PCM → TDM/PDM

---

## 选型速查表

| 场景 | 推荐总线 | 原因 |
| --- | --- | --- |
| 手机显示屏 | MIPI DSI + D-PHY | 标准接口，低功耗 |
| 手机摄像头 | MIPI CSI-2 + D-PHY | 4 lane，带宽高 |
| 车载多摄像头 | MIPI CSI-2 + C-PHY | 3 lane 替代 4 lane |
| 音频 DAC/ADC | I2S | 标准音频接口 |
| 多通道麦克风阵列 | TDM/PDM | 时隙复用 |
| 蜂窝基带语音 | PCM | 8KHz 采样标准 |

---

## 速率对比

| 总线 | 速率/带宽 | lane数 | 应用 |
| --- | --- | --- | --- |
| MIPI D-PHY v1.2 | 1.5 Gbps/lane | 1~4 | 显示屏、摄像头 |
| MIPI D-PHY v2.0 | 2.5 Gbps/lane | 1~4 | 高分辨率屏 |
| MIPI C-PHY v1.0 | 2.5 Gbps/lane | 1~3 | 摄像头 |
| MIPI M-PHY v4.1 | 11.6 Gbps/lane | 1~2 | UFS、PCIe 替代 |
| I2S | 采样率 × 位深 × 通道 | — | 音频 |
| PCM | 64~2048 Kbps | — | 语音 |

