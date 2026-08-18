# B-D.14.4 车载 SerDes：GMSL / FPD-Link / A-PHY / ASA / HSMT

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] | 预计阅读时间：30 分钟

## 本节导读

摄像头和显示屏是车载数据量最大的两类外设：一路 8 MP 摄像头的 RAW 数据流超过 3 Gbps，一块座舱大屏的显示流更在 10 Gbps 以上。这类"点对点、长距离（几米到十五米）、单对同轴或差分线"的高速视频链路，走的是车载专用 SerDes——不是以太网，不是 MIPI 直连。市场上有五个标准并存，分属不同阵营，做摄像头/显示链路设计或选型时绕不开。本节把五家的机制差异、生态锁定关系和 Linux 侧的接入形态讲清楚。

本节覆盖：车载 SerDes 解决的问题与 MIPI 直连的边界、五大标准（GMSL/FPD-Link/A-PHY/ASA/HSMT）的技术与生态对比、PoC 同轴供电、反向控制通道、Linux 驱动接入形态（V4L2/DRM）、链路排障要点。

## 为什么 MIPI 不能直接上车

MIPI CSI-2/DSI（B-C.9 组）的物理层 D-PHY/C-PHY 设计边界是**板内十几厘米**：电压摆幅小、无长线均衡、无车载 EMC 要求。摄像模组到域控制器的线束是 3~15 米，中间穿过整车电磁环境。车载 SerDes 的本质就是把 MIPI 流重新封装到带均衡、编码、EMC 设计的高速串行链路上：摄像头侧一颗串行器（Serializer）把 MIPI 转 SerDes，域控侧一颗解串器（Deserializer）还原回 MIPI——SoC 看到的仍是标准 CSI-2 输入，中间的线束问题由 SerDes 芯片解决。

```
 摄像模组                线束 3~15 m              域控制器
 ┌─────────┐    ┌────┐   同轴/差分对   ┌────┐    ┌─────────┐
 │ Sensor  │───▶│串行器│ ═══════════▶ │解串器│───▶│ SoC     │
 │ MIPI    │MIPI│     │   + PoC 供电  │     │MIPI│ CSI-2   │
 └─────────┘    └────┘   + 反向控制   └────┘    └─────────┘
```

串行器/解串器对（Ser/Des 对）就是这个领域的"芯片对"：两端必须同标准、通常同厂商配对。

## 五大标准对比

| 标准 | 主推厂商 | 下行速率 | 线缆 | 生态性质 |
|:---|:---|:---|:---|:---|
| GMSL2/GMSL3 | Analog Devices（美信） | 6 / 12 Gbps | 同轴或 STP | 私有，ADAS 摄像头市占最高 |
| FPD-Link III/IV | TI | 4.16 / 13.5 Gbps | 同轴或 STP | 私有，座舱显示与摄像头 |
| A-PHY | MIPI 联盟（开放标准） | 16 Gbps+（路线图 32） | 同轴/差分 | 开放标准，Valens 等芯片 |
| ASA Motion Link | ASA 联盟（宝马等） | ~13.5 Gbps | 非屏蔽双绞为主 | 联盟标准，欧系车企推动 |
| HSMT | 中国汽标委 | ~12.8 Gbps | 同轴/STP | 中国公开标准，国产芯片跟进 |

关键认知：

- **GMSL 与 FPD-Link 是私有但成熟**，上车验证里程最长，摄像头模组市场基本是这两家；A-PHY/ASA/HSMT 是后起的开放/联盟标准，意图打破私有锁定，2026 年处于"新标准导入期"——新平台设计会看到它们的身影，存量平台仍是 GMSL/FPD-Link。
- **上下行不对称**：下行（域控→摄像头/屏）是高速视频流，上行（反向通道）是百 Mbps 级的低速通道，跑 I2C/GPIO 透传——摄像头的 Sensor 初始化、触摸回传都走反向通道。
- **PoC（Power over Coax）**：同轴线上叠加供电（5~12 V），摄像头模组只需一根线。PoC 滤波网络（电感选型）是摄像模组硬件设计的核心坑位，滤波不好既伤链路又伤电源。

## Linux 接入形态

对软件工程师，SerDes 对的可见接口是：

1. **V4L2 侧（摄像头链路）**：解串器驱动（`drivers/media/i2c/max96717.c` 等已进主线）作为 V4L2 subdev，串在 sensor 与 SoC CSI 接收端之间。设备树里视频管道变长：`sensor → serializer → deserializer → csi2 → isp`。内核 5.16+ 的 V4L2 链路子设备模型（media controller）就是这类长管道的管理框架。
2. **DRM 侧（显示链路）**：串行器作为 DRM bridge，把 SoC 的 DSI 输出桥到 FPD-Link/GMSL 显示链路。
3. **I2C 透传**：SerDes 对的反向通道把 I2C 透传到远端 Sensor——驱动写法上是"通过解串器访问一个远程 I2C 设备"，设备树里 sensor 节点挂在解串器创建的 I2C 适配器下。

设备树骨架（GMSL 摄像头链）：

```dts
&i2c1 {
    max96717: serializer@40 {           /* 摄像头模组侧串行器 */
        compatible = "adi,max96717f";
        reg = <0x40>;
    };
    max9296: deserializer@48 {          /* 域控侧解串器 */
        compatible = "adi,max9296a";
        reg = <0x48>;
        /* GMSL 链路配置：串行器地址映射、MIPI 速率 */
        ports { /* 0/1：GMSL 输入；2：CSI-2 输出到 SoC */ };
        i2c-alias {                     /* 透传 I2C 总线，远端 sensor 挂这里 */
            ov9281: sensor@60 {
                compatible = "ovti,ov9281";
                reg = <0x60>;
            };
        };
    };
};
```

调试入口因此分三层：V4L2 层（`media-ctl -p` 看管道拓扑）、SerDes 寄存器层（`i2ctransfer` 读解串器的链路状态/误码寄存器）、物理层（解串器自带眼图/PRBS 测试功能）。

## 排障：车载 SerDes 链路

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| 链路锁不上（lock 位为 0） | 线缆/连接器、PoC 滤波、串行器未上电 | 读解串器链路状态寄存器；量同轴供电电压 |
| 锁定但无视频帧 | MIPI 速率/通道数两端不匹配 | 核对 sensor 输出与解串器 CSI 输出配置 |
| 图像偶发花屏 | 链路误码：线束受损、EMC | 读误码计数；开 PRBS 测试模式隔离视频源 |
| I2C 透传超时 | 地址映射冲突、反向通道未使能 | 核对 i2c-alias 地址转换表 |
| 摄像头启动慢 | PoC 上电时序：电压爬升期内链路训练失败 | 示波器抓 PoC 电压爬升与 lock 时间的关系 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说明车载 SerDes 与 MIPI 直连的边界（距离/EMC/供电）
- 画出 sensor→serializer→deserializer→SoC 的完整管道，标出 PoC 与反向通道
- 对比五大标准的阵营与成熟度，给新平台选型给出倾向与理由
- 在设备树里写出含 I2C 透传的三节点视频管道
- 用三层调试入口定位"链路锁不上"与"有锁无帧"

## 参考资料

- ADI GMSL2/3 用户指南（max96717/max9296 数据手册）
- TI FPD-Link III/IV 数据手册（DS90UB 系列）
- MIPI A-PHY 规范（mipi.org）；ASA Motion Link 规范；HSMT 标准文本
- 内核源码：`drivers/media/i2c/`（max96717/max9296 等）、V4L2 media-controller 文档
