# procfs与内核性能接口

> <span class="badge-i">**中级 (Intermediate)**</span>
> 掌握 /proc 和 /sys 两个伪文件系统的关键节点，学会编写轻量级嵌入式性能监控脚本。

---

## proc-stat-meminfo关键字段

---

### <strong>/proc/stat 的 CPU 时间片解析</strong>

<span class="badge-i">I</span><br>
<span class="red">/proc/stat</span>是内核CPU时间片统计的权威数据源，第一行汇总所有CPU核的jiffies分布。<br>

```
# 文件路径：/proc/stat
# 格式：cpu user nice system idle iowait irq softirq steal guest guest_nice
$ cat /proc/stat | head -n 1
cpu  10234 0 5678 89012 123 45 678 0 0 0
```

<span class="orange"><strong>1. user + nice：</strong></span><br>
用户态CPU时间，nice值是进程优先级调整后的用户态时间。<br>

<span class="orange"><strong>2. system：</strong></span><br>
内核态CPU时间，高system占比通常意味着频繁的系统调用或中断处理。<br>

<span class="orange"><strong>3. iowait：</strong></span><br>
CPU空闲但存在未完成的IO等待——这是IO瓶颈的直接信号。<br>

<span class="orange"><strong>4. irq + softirq：</strong></span><br>
硬中断和软中断时间，嵌入式系统中softirq过高常见于网络收包路径。<br>

```bash
# 计算CPU利用率（bash脚本）
# 文件路径：scripts/cpu_usage.sh
# 行号：1-15
get_cpu_usage() {
    local stat1=$(cat /proc/stat | grep '^cpu ')
    local user1=$(echo $stat1 | awk '{print $2}')
    local system1=$(echo $stat1 | awk '{print $4}')
    local idle1=$(echo $stat1 | awk '{print $5}')
    local total1=$((user1 + system1 + idle1))
    
    sleep 1
    
    local stat2=$(cat /proc/stat | grep '^cpu ')
    local user2=$(echo $stat2 | awk '{print $2}')
    local system2=$(echo $stat2 | awk '{print $4}')
    local idle2=$(echo $stat2 | awk '{print $5}')
    local total2=$((user2 + system2 + idle2))
    
    local usage=$(((user2 - user1 + system2 - system1) * 100 / (total2 - total1)))
    echo "CPU Usage: ${usage}%"
}
```

<span class="blue">关键洞察：/proc/stat 的jiffies计数是单调递增的，必须两次采样求差值才能得到区间利用率。</span><br>

---

### <strong>/proc/meminfo 内存全景</strong>

<span class="badge-i">I</span><br>
<span class="red">/proc/meminfo</span>提供物理内存的详细分解，是诊断内存压力的第一入口。<br>

```bash
$ cat /proc/meminfo | grep -E "MemTotal|MemFree|MemAvailable|Buffers|Cached|Slab|SReclaimable|Shmem|Active|Inactive"
MemTotal:        2048000 kB
MemFree:          123456 kB
MemAvailable:     567890 kB
Buffers:           23456 kB
Cached:           345678 kB
Slab:              45678 kB
SReclaimable:      34567 kB
Shmem:             12345 kB
Active:           678901 kB
Inactive:         234567 kB
```

<span class="orange"><strong>1. MemAvailable：</strong></span><br>
MemAvailable ≈ MemFree + Buffers + Cached + SReclaimable - 不可回收预留，反映系统真实可用内存。<br>

<span class="orange"><strong>2. Slab + SReclaimable：</strong></span><br>
内核对象缓存，SReclaimable部分在内存压力下可回收。嵌入式系统中dentry和inode缓存可能占用数十MB。<br>

<span class="orange"><strong>3. Shmem：</strong></span><br>
tmpfs和共享内存的占用，这部分计入Cached但无法被进程直接回收。<br>

<span class="blue">关键洞察：MemFree低但MemAvailable高是健康的——说明系统正在有效利用缓存。反之MemAvailable低才是真危险。</span><br>

---

## procfs读取实战脚本

---

### <strong>轻量级嵌入式监控脚本</strong>

<span class="badge-i">I</span><br>
<span class="red">嵌入式性能监控脚本</span>在资源受限环境中不能依赖top/htop等交互工具，必须直接解析procfs节点。<br>

```bash
#!/bin/sh
# 文件路径：/usr/local/bin/embed-mon.sh
# 功能：嵌入式轻量性能监控，输出JSON供上层采集
# 行号：1-45

CPU_USAGE() {
    read -r cpu u n s i io irq soft st g1 g2 < /proc/stat
    t1=$((u + n + s + i + io + irq + soft))
    idle1=$i
    sleep 1
    read -r cpu u n s i io irq soft st g1 g2 < /proc/stat
    t2=$((u + n + s + i + io + irq + soft))
    idle2=$i
    echo $(((t2 - t1 - idle2 + idle1) * 100 / (t2 - t1)))
}

MEM_INFO() {
    mem_total=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    mem_avail=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    echo $((100 - mem_avail * 100 / mem_total))
}

LOAD_INFO() {
    read -r load1 _ < /proc/loadavg
    echo "$load1"
}

echo "{ \"cpu\": $(CPU_USAGE), \"mem\": $(MEM_INFO), \"load\": $(LOAD_INFO), \"ts\": $(date +%s) }"
```

<span class="blue">关键洞察：shell脚本解析/proc是零依赖的方案，适合无法安装Python的极简系统。awk和grep本身是BusyBox内置命令。</span><br>

---

## sysfs设备性能节点

---

### <strong>/sys 的可配置性能接口</strong>

<span class="badge-i">I</span><br>
<span class="red">sysfs</span>不仅暴露状态，更提供运行时调参能力——嵌入式中常用于CPU频率、调度策略和IO调度器的动态调整。<br>

<span class="orange"><strong>1. CPU频率节点：</strong></span><br>
<span class="green">/sys/devices/system/cpu/cpu0/cpufreq/</span>目录包含scaling_cur_freq、scaling_available_frequencies等节点，是DVFS的直接控制接口。<br>

<span class="orange"><strong>2. 调度器节点：</strong></span><br>
<span class="green">/sys/block/sda/queue/scheduler</span>显示和切换块设备IO调度器（noop/mq-deadline/bfq），嵌入式eMMC通常选noop降低延迟。<br>

<span class="orange"><strong>3. 内存回收参数：</strong></span><br>
<span class="green">/proc/sys/vm/swappiness</span>控制匿名页交换倾向，嵌入式无swap时应设为0。<br>

```bash
# 嵌入式常用 sysfs 调参脚本
# 文件路径：/etc/init.d/performance-tune.sh
# 行号：1-20

# 切换 IO 调度器为 noop（适合 eMMC/SD卡）
for dev in /sys/block/mmcblk* /sys/block/mtdblock*; do
    [ -d "$dev" ] || continue
    echo noop > "$dev/queue/scheduler" 2>/dev/null
done

# 降低swappiness（无swap系统）
echo 0 > /proc/sys/vm/swappiness

# 禁用透明大页（THP在嵌入式中开销大于收益）
echo never > /sys/kernel/mm/transparent_hugepage/enabled
```

<span class="blue">关键洞察：sysfs调参在init阶段一次性执行，避免了守护进程常驻内存——嵌入式节省MB级RAM。</span><br>

---

## 嵌入式轻量监控

---

### <strong>从脚本到最小化agent</strong>

<span class="badge-i">I</span><br>
<span class="red">嵌入式轻量监控</span>的核心矛盾是：需要持续观测，但监控本身不能消耗过多资源。<br>

| 方案 | 内存占用 | CPU占用 | 适用场景 |
|------|---------|---------|---------|
| shell脚本 + cron | <1MB | 周期性 spike | 极简系统，无常驻进程 |
| busybox top + logger | ~2MB | 低 | 已有syslog的系统 |
| collectd (裁剪) | ~5MB | 低 | 需要历史趋势和远程上报 |
| 自定义C agent | ~1MB | 极低 | 高频采集（>1Hz）、自定义协议 |

```c
// 文件路径：monitor_agent.c
// 功能：最小化嵌入式性能监控agent，每秒采样，UDP上报
// 行号：1-40
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>

#define INTERVAL_US 1000000  // 1秒

typedef struct {
    unsigned long long user, nice, system, idle;
} cpu_stat_t;

int read_cpu_stat(cpu_stat_t *s) {
    FILE *fp = fopen("/proc/stat", "r");
    if (!fp) return -1;
    char buf[256];
    if (!fgets(buf, sizeof(buf), fp)) { fclose(fp); return -1; }
    fclose(fp);
    sscanf(buf, "cpu %llu %llu %llu %llu", &s->user, &s->nice, &s->system, &s->idle);
    return 0;
}

int main(int argc, char **argv) {
    cpu_stat_t prev = {0}, curr;
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    struct sockaddr_in dst = { .sin_family = AF_INET, .sin_port = htons(9999) };
    inet_pton(AF_INET, "192.168.1.100", &dst.sin_addr);
    
    read_cpu_stat(&prev);
    while (1) {
        usleep(INTERVAL_US);
        read_cpu_stat(&curr);
        unsigned long long total = (curr.user - prev.user) + (curr.nice - prev.nice)
                                 + (curr.system - prev.system) + (curr.idle - prev.idle);
        int usage = total ? (curr.user + curr.nice + curr.system - prev.user - prev.nice - prev.system) * 100 / total : 0;
        char msg[64];
        snprintf(msg, sizeof(msg), "cpu=%d,ts=%lu", usage, (unsigned long)time(NULL));
        sendto(sock, msg, strlen(msg), 0, (struct sockaddr *)&dst, sizeof(dst));
        prev = curr;
    }
    return 0;
}
```

<span class="blue">关键洞察：C实现的agent常驻内存仅几十KB，CPU占用<0.1%，适合电池供电的远程监测节点。</span><br>

---

## 历史演进：从 /proc 到统一性能接口

---

### <strong>内核统计接口的三十年演进</strong>

<span class="badge-i">I</span><br>

| 年代 | 接口 | 特点 |
|------|------|------|
| 1990s | /proc 诞生 | 文本格式，人类可读，解析开销大 |
| 2000s | sysfs 补充 | 结构化键值，可配置，面向设备 |
| 2010s | perf_event_open | 二进制接口，硬件PMU直连，低开销 |
| 2020s | eBPF | 可编程内核态分析，无需修改源码 |

<span class="blue">演进逻辑：从"人类可读的文本"到"机器高效的二进制"再到"可编程的分析逻辑"，趋势是更少的内核-用户空间数据搬运。</span><br>

---

## 小结

---

### <strong>本章核心要点</strong>

| 知识点 | 关键内容 | 难度 |
|--------|---------|------|
| /proc/stat | jiffies时间片解析，CPU利用率计算 | I |
| /proc/meminfo | MemAvailable vs MemFree，Slab缓存 | I |
| sysfs调参 | CPU频率、IO调度器、内存回收参数 | I |
| 轻量监控 | shell脚本、C agent方案选型 | I |

---

### <strong>本章练习题</strong>

<span class="badge-i">I</span>

1. 为什么计算CPU利用率需要两次采样 /proc/stat 并求差值？
2. sysfs 和 procfs 的本质区别是什么？分别适合暴露什么类型的数据？
3. 设计一个占用内存<500KB的嵌入式性能监控agent，列出架构要点。

---

> <span class="badge-i">I</span> <span class="blue">/proc 是内核的眼睛，/sys 是内核的手——前者让你看见问题，后者让你调整行为。</span>
