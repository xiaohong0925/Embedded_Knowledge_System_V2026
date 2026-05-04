# LIN历史演进与自动驾驶

<span class="badge-i">[Intermediate]</span>

<span class="red">LIN（Local Interconnect Network）</span> 是低成本车载网络标准，用于车身电子控制。

---

## <strong>历史演进</strong>

- <span class="green">1999 年 LIN 1.0</span> — 宝马、奔驰、Volvo联合制定<br>
- <span class="green">2003 年 LIN 1.3</span> — 物理层优化，诊断增强<br>
- <span class="green">2006 年 LIN 2.0</span> — 引入诊断规范和传输层<br>
- <span class="green">2010 年 LIN 2.1</span> — 自动波特率检测<br>
- <span class="green">2016 年 LIN 2.2A</span> — 当前主流版本<br>

## <strong>自动驾驶时代的角色</strong>

<span class="blue">LIN 在自动驾驶中继续承担"低成本执行器网络"角色</span>：

| 域 | 总线 | 用途 |
|----|------|------|
| 动力域 | CAN FD | 发动机、变速箱 |
| 底盘域 | CAN FD | 制动、转向 |
| 车身域 | LIN | 车门、座椅、灯光、雨刷 |
| ADAS域 | 车载以太网 | 摄像头、雷达、融合 |

<span class="red">LIN 不会被以太网替代</span>，因为车身执行器对带宽需求极低，成本敏感。

---

## 小结与练习

**练习**

1. 计算 LIN 总线理论最大节点数（考虑线电容限制）。
2. 比较 LIN 和 CAN 在成本和抗干扰能力上的差异。
3. 分析为什么自动驾驶传感器网络不使用 LIN。
