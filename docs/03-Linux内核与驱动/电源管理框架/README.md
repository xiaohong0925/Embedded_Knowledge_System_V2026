# 电源管理框架

> 📊 **本章难度等级：** <span class="badge-e">**高级 (Expert)**</span>

---

<span class="blue">**定义**：Linux <span class="red">电源管理框架</span>是内核中负责<strong>系统级与设备级功耗控制</strong>的一套协同子系统。<br></span>
它涵盖从整机挂起到设备空闲降频的全部策略，<br>
通过 "静态电源管理"（系统级）与 "动态电源管理"（设备级）两条主线，<br>
在嵌入式设备上实现毫瓦级功耗控制。

---

## 为什么电源管理是嵌入式的生死线

便携设备靠电池供电，每毫瓦都珍贵。<br>
无电源管理的 Linux 系统空闲时仍全速运行，<br>
功耗可达数瓦；启用完整电源管理后，<br>
同平台可降至几十毫瓦。

以 ARM Cortex-A53 为例：<br>
- 全速运行：约 1.5W<br>
- CPUIdle + CPUFreq：降至 200mW<br>
- Suspend-to-RAM：降至 5mW<br>
- 差距达 300 倍。

---

## 电源管理的两大范式

| 范式 | 管理对象 | 触发时机 | 目标 |
|------|----------|----------|------|
| **静态电源管理** | 整机系统 | 用户显式请求（如合盖）| 极致省电 |
| **动态电源管理** | 单个设备/CPU | 内核自动检测空闲 | 运行态省电 |

---

## 静态电源管理：Suspend 与 Resume

<span class="blue">**定义**：**静态电源管理**（System-Wide PM）是当系统长时间无人使用时，<br></span>
将整机推入低功耗状态并在事件触发时恢复的机制。<br>
<span class="red">Linux 内核</span>通过 `suspend` 框架统一处理这一流程。

---

### 四种系统睡眠状态

| 状态 | 命令 | 功耗 | 唤醒延迟 | 数据安全 |
|------|------|------|----------|----------|
| **Freeze** | `echo freeze > /sys/power/state` | 中 | 极低 | 内存保持 |
| **Standby** | `echo standby > /sys/power/state` | 较低 | 低 | 内存保持 |
| **Suspend-to-RAM** | `echo mem > /sys/power/state` | 极低 | 中 | 内存自刷新 |
| **Hibernate** | `echo disk > /sys/power/state` | 零 | 高 | 写回磁盘 |

- **Freeze**：仅冻结<span class="red">用户态</span> + idle CPU，<br>
  适用于快速切换场景（如手机瞬间亮屏）。<br>
- **Suspend-to-RAM（mem）**：内存进入自刷新，其余断电，<br>
  是嵌入式最常用的深度睡眠方式。

---

### Suspend 的执行流程

```
用户：echo mem > /sys/power/state
  └── pm_suspend()                          /* kernel/power/main.c */
        └── dpm_suspend_start()             /* 冻结用户进程 */
        └── dpm_suspend()                   /* 遍历所有设备 */
              └── dev->pm_domain->suspend()/* 功能：GenPD 挂起 */
              └── dev->driver->pm->suspend() /* 功能：驱动回调 */
        └── suspend_enter()                 /* 进入硬件睡眠 */
              └── cpu_suspend()             /* ARM PSCI */
                    └── PSCI_SYSTEM_SUSPEND /* 进安全世界 */
        [WAKE]
        └── cpu_resume()
        └── dpm_resume()                    /* 逆序恢复设备 */
        └── dpm_resume_end()                /* 解冻进程 */
```

---

### 设备的 suspend/resume 回调

```c
/* 定义：设备电源操作结构体，include/linux/pm.h */
struct dev_pm_ops {
    int (*prepare)(struct device *dev);      /* 功能：预检查 */
    int (*suspend)(struct device *dev);      /* 功能：挂起 */
    int (*suspend_late)(struct device *dev);  /* 功能：IRQ 关闭后 */
    int (*resume_early)(struct device *dev);  /* 功能：IRQ 开启前 */
    int (*resume)(struct device *dev);         /* 功能：恢复 */
    void (*complete)(struct device *dev);     /* 功能：收尾 */
};
```

驱动注册时把 `dev_pm_ops` 挂到 `struct device_driver`：

```c
static const struct dev_pm_ops my_driver_pm = {
    .suspend = my_suspend,
    .resume  = my_resume,
};

static struct platform_driver my_driver = {
    .driver = {
        .name = "my-device",
        .pm = &my_driver_pm,            /* 核心API：绑定电源回调 */
    },
    .probe = my_probe,
    .remove = my_remove,
};
```

---

## 动态电源管理：Runtime PM

<span class="blue">**定义**：**Runtime PM**（运行时电源管理）是内核在<strong>系统运行期间</strong>，<br></span>
根据设备实际活动状态自动关闭空闲设备时钟与电源域的机制。<br>
它由<span class="red">设备驱动</span>主动触发，无需用户干预。

---

### Runtime PM 的核心计数模型

Runtime PM 基于<strong>引用计数</strong>：<br>
- 设备被使用时 `pm_runtime_get_sync()` → 计数 +1，设备上电。<br>
- 使用完毕 `pm_runtime_put_sync()` → 计数 -1，若归零则自动 idle。

```c
/* 功能：获取设备使用权（自动 resume） */
pm_runtime_get_sync(dev);

/* ... 执行 I/O ... */

/* 功能：释放设备使用权（计数归零后自动 suspend） */
pm_runtime_put_sync(dev);
```

---

### Runtime PM 状态机

```
          ┌─────────────┐
          │  ACTIVE     │ ← 正常运行
          └──────┬──────┘
                 │ put()
                 ▼
          ┌─────────────┐
          │  SUSPENDED  │ ← 完全关闭
          └──────┬──────┘
                 │ get()
                 ▼
          ┌─────────────┐
          │  RESUMING   │ ← 恢复中（短暂）
          └─────────────┘
```

---

### autosuspend：自动延迟挂起

某些设备频繁启停代价高（如硬盘电机）。<br>
`autosuspend` 在最后一次 `put()` 后延迟指定时间才真正挂起：

```c
/* 功能：设置 autosuspend 延迟为 5 秒 */
pm_runtime_set_autosuspend_delay(dev, 5000);
pm_runtime_use_autosuspend(dev);
```

---

## CPUFreq：CPU 动态调频调压

<span class="blue">**定义**：**CPUFreq** 是内核中根据负载<strong>动态调整 CPU 频率与电压</strong>的框架。<br></span>
基于 "D<span class="red">VFS</span>"（Dynamic Voltage and Frequency Scaling）原理：<br>
功耗与电压平方成正比、与频率成正比，降频降压可大幅省电。

---

### DVFS 的物理基础

动态功耗公式：<br>
`P = C × V² × f`<br>
- `C`：等效电容（工艺相关）<br>
- `V`：供电电压<br>
- `f`：时钟频率

降频通常需降压：<br>
- 1.2 GHz @ 1.05V → 约 1.3W<br>
- 600 MHz @ 0.9V → 约 0.4W（省电 70%）

---

### CPUFreq Governor 策略

| Governor | 策略 | 适用场景 |
|----------|------|----------|
| **performance** | 锁定最高频 | 基准测试 |
| **powersave** | 锁定最低频 | 极端省电 |
| **ondemand** | 负载突增时瞬间升频 | 桌面 |
| **conservative** | 缓慢升频、快速降频 | 笔记本 |
| **schedutil** | 利用调度器负载信息 | 推荐（内核 4.7+）|
| **userspace** | 用户通过 sysfs 指定 | 自定义策略 |

- **schedutil** 是目前的推荐策略：<br>
  它直接读取调度器的 `cpu_util` 信号，<br>
  无需额外采样线程，响应更快、开销更低。

---

### OPP（Operating Performance Point）

<span class="blue">**定义**：**OPP** 是 SoC 厂商预定义的<strong>频率-电压配对表</strong>。<br></span>
每对 OPP 经过硅片验证，确保在该电压下该频率稳定工作。

<span class="red">设备树</span>中定义 OPP：

```dts
/* 定义：OPP 表，arch/arm64/boot/dts/xxx.dts */
cpu0_opp_table: opp-table {
    compatible = "operating-points-v2";
    opp-shared;

    opp-600000000 {                            /* 指标：600 MHz */
        opp-hz = /bits/ 64 <600000000>;
        opp-microvolt = <900000>;              /* 指标：0.9V */
        clock-latency-ns = <100000>;
    };
    opp-1200000000 {                           /* 指标：1.2 GHz */
        opp-hz = /bits/ 64 <1200000000>;
        opp-microvolt = <1050000>;             /* 指标：1.05V */
    };
};
```

---

## CPUIdle：让 CPU 打盹

<span class="blue">**定义**：**CPUIdle** 是内核在 CPU 无任务可执行时，<br></span>
将其推入<strong>低功耗 C-State</strong>的框架。<br>
C-State 越深，功耗越低，但退出延迟越长。

---

### C-State 层级

| 状态 | 功耗 | 退出延迟 | 行为 |
|------|------|----------|------|
| C0 | 100% | 0 | 全速运行 |
| C1 | ~90% | 1 µs | 停时钟，缓存保持 |
| C2 | ~70% | 10 µs | 部分总线关闭 |
| C3 | ~30% | 100 µs | 刷新 L1/L2，时钟门控 |
| C6 | ~10% | 1 ms | 保存上下文，核电压降低 |

---

### CPUIdle Governor

| Governor | 策略 | 特点 |
|----------|------|------|
| **menu** | 预测下次唤醒时间 | 综合 latency、功耗，最常用 |
| **ladder** | 逐级深入 | 保守，逐级试 deeper state |
| **teo** | 基于期望空闲时长 | 内核 5.1+，优化唤醒预测 |

`menu` governor 的核心算法：<br>
`next_timer = min(hrtimer_expires, next_sched_event)`<br>
如果 `next_timer > entry_latency + min_residency`，<br>
则选择更深的 C-State。

---

## GenPD：Generic Power Domain

<span class="blue">**定义**：**GenPD**（Generic Power Domain）是把 SoC 中<strong>功能相近的设备划入同一电源域</strong>，<br></span>
统一控制该域的开关与时钟门控的框架。<br>
它基于 Runtime PM 构建，但管理粒度从单个设备提升到电源域。

---

### 为什么需要 GenPD

现代 SoC（如 STM32MP1、i.MX8）把数百个设备组织成几十个电源域：<br>
- `pd_uart`：串口域，包含 <span class="green">UART</span>1/2/3<br>
- `pd_gpu`：图形域，含 GPU、VPU<br>
- `pd_ddr`：内存域，必须常开

若每个设备独立关时钟，依赖关系会乱。<br>
GenPD 建立父子域关系：关闭父域前必须关闭所有子域。

---

### 设备树中的 GenPD

```dts
/* 定义：电源域层级 */
pd_dma: power-domain@0 {
    compatible = "generic-power-domain";
    #power-domain-cells = <1>;
    
    pd_uart: power-domain@1 {
        #power-domain-cells = <0>;
    };
};

/* 功能：UART 设备绑定到 pd_uart */
&uart1 {
    power-domains = <&pd_uart>;
};
```

---

## DevFreq：设备级 DVFS

<span class="blue">**定义**：**DevFreq** 是 CPUFreq 思想的延伸：<br></span>
对<strong>非 CPU 设备</strong>（如 GPU、内存控制器、ISP）做动态调频调压。<br>
例如 Mali GPU 可根据渲染负载在 300 MHz 与 800 MHz 间切换。

---

### DevFreq Governor

| Governor | 策略 |
|----------|------|
| **simple_ondemand** | 负载高则升频，低则降频 |
| **performance** | 锁定最高频 |
| **powersave** | 锁定最低频 |
| **passive** | 跟随 CPUFreq（如内存总线随 CPU 升降）|

---

## PSCI 与 SCMI：固件接口

<span class="blue">**定义**：**PSCI**（Power State Coordination Interface）是 ARM 标准固件接口，<br></span>
用于内核向安全监控器（如 TF-A、OP-TEE）请求 CPU 挂起、核上线/下线等操作。<br>
**SCMI**（System Control and Management Interface）则把电源域、时钟、传感器管理统一为消息协议。

---

### PSCI 调用流程

```
内核：cpu_suspend()
  └── invoke_psci_fn(PSCI_0_2_FN_SYSTEM_SUSPEND, ...)
        └── SMC #0                            /* 陷入 EL3 */
              └── TF-A BL31                   /* 固件层 */
                    └── 配置 DDR 自刷新
                    └── 关 PLL
                    └── 降电压
                    └── WFI                   /* 等中断 */
        [IRQ 到来]
              └── 恢复电压/PLL/DDR
              └── ERET 回内核
```

---

### SCMI 消息示例

```c
/* 功能：通过 SCMI 设置电源域状态 */
scmi_pd_power_state_set(proto, domain_id, POWER_DOMAIN_STATE_OFF);

/* 功能：通过 SCMI 获取时钟频率 */
scmi_clock_rate_get(proto, clock_id, &rate);
```

---

## 嵌入式电源管理实战策略

---

### 策略 1：分层功耗预算

设计阶段为每个子系统分配功耗上限：

| 子系统 | 预算 | 控制手段 |
|--------|------|----------|
| CPU | 500 mW | CPUFreq + CPUIdle |
| DDR | 200 mW | DevFreq + self-refresh |
| GPU | 100 mW | Runtime PM + DevFreq |
| WiFi | 50 mW | autosuspend |
| Sensor | 10 mW | Runtime PM |

---

### 策略 2：唤醒源管理

深度睡眠后，只有<strong>唤醒源</strong>能恢复系统。<br>
嵌入式常见唤醒源：

| 唤醒源 | 配置 | 延迟 |
|--------|------|------|
| RTC 闹钟 | `alarmtimer` | 精确到秒 |
| GPIO 按键 | `enable_irq_wake()` | 毫秒级 |
| UART RX | `uart_handle_break()` | 字符级 |
| 网络 Magic Packet | `ethtool -s eth0 wol g` | 秒级 |

```c
/* 功能：注册 GPIO 为唤醒源 */
device_init_wakeup(dev, true);
enable_irq_wake(gpio_to_irq(BTN_PIN));
```

---

### 策略 3：调试与测量

```bash
# 功能：查看各设备 Runtime PM 状态
cat /sys/devices/.../power/runtime_status
# → active / suspended / unsupported

# 功能：查看 CPUIdle 统计
cat /sys/devices/system/cpu/cpu0/cpuidle/state*/time
# → 在各 C-State 停留的时长

# 功能：查看 CPUFreq 当前频率
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq

# 功能：测量 suspend/resume 时间
dmesg | grep -E "PM:.*(sync|start|end)"
```

---

### 策略 4：延迟容忍声明

<span class="red">设备驱动</span>通过 `pm_qos` 声明对唤醒延迟的要求：

```c
/* 定义：延迟约束，include/linux/pm_qos.h */
struct pm_qos_request {
    enum pm_qos_req_action node;
    struct plist_node pm_qos_node;
    int pm_qos_class;
    struct delayed_work work;
};

/* 功能：声明 "本设备要求唤醒延迟 < 10ms" */
pm_qos_add_request(&req, PM_QOS_RESUME_LATENCY, 10000);
```

CPUIDle governor 在选 C-State 时，<br>
会确保 `exit_latency < max(resume_latency_constraints)`。

---

## 总结

<span class="blue">**定义**：Linux <span class="red">电源管理框架</span>通过 <strong>静态管理（Suspend/Resume）</strong>与<strong>动态管理（Runtime PM + CPUFreq + CPUIdle + DevFreq + GenPD）</strong>两条主线，<br></span>
结合 ARM PSCI/SCMI 固件接口，<br>
在嵌入式设备上实现从毫瓦到瓦特的精细功耗控制。

---

| 组件 | 职责 | 关键文件 |
|------|------|----------|
| Suspend/Resume | 系统级整机睡眠 | `kernel/power/` |
| Runtime PM | 设备级自动开关 | `drivers/base/power/runtime.c` |
| CPUFreq | CPU 调频调压 | `drivers/cpufreq/` |
| CPUIdle | CPU C-State 管理 | `drivers/cpuidle/` |
| DevFreq | 设备级 DVFS | `drivers/devfreq/` |
| GenPD | 电源域管理 | `drivers/base/power/domain.c` |
| PSCI | 固件电源接口 | `drivers/firmware/psci.c` |
| SCMI | 系统管理消息协议 | `drivers/firmware/arm_scmi/` |

---

掌握电源管理意味着：<br>
能设计出让设备待机一周不充电的方案，<br>
能在性能与功耗之间找到工程最优解，<br>
能排查 "suspend 后无法唤醒"、"Runtime PM 导致设备失联" 等顽固问题。
