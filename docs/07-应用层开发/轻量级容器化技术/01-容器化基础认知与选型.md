# 容器化基础认知与选型

<span class="badge-i">[I]</span> <span class="badge-e">[E]</span>

---

### 为什么嵌入式需要容器化

<span class="red">传统嵌入式系统采用单体式架构，所有应用直接运行在宿主机上，共享同一内核和文件系统。随着设备功能复杂度增加，这种架构暴露出依赖冲突、升级困难和安全隔离三大痛点。</span><br>

<span class="orange"><strong>依赖冲突</strong></span>：A 应用依赖 libssl 1.1，B 应用依赖 libssl 3.0，同一系统无法同时满足。<br>
<span class="orange"><strong>升级困难</strong></span>：更新单个应用需验证全系统兼容性，OTA 包体积大，回滚复杂。<br>
<span class="orange"><strong>安全隔离</strong></span>：单个应用被攻破意味着整个系统暴露，缺乏纵深防御。<br>

容器化将每个应用打包为独立镜像，携带自身依赖库，通过操作系统级虚拟化实现进程、网络和文件系统的隔离。<br>
在服务器领域，容器化已成为标准部署方式；在嵌入式领域，轻量级容器正逐步取代传统的 monolithic rootfs。<br>

<span class="blue">关键认知：嵌入式容器化不是复制 Docker 数据中心方案，而是在 MB 级内存、秒级启动的约束下，利用 namespace 和 cgroup 实现最小可用的隔离单元。</span><br>

---

### 容器化的三大基石

<span class="red">Linux 容器化依赖三大内核特性：chroot 隔离文件系统视图，namespace 隔离系统资源视图，cgroup 限制资源使用量。三者叠加构成完整的容器隔离环境。</span><br>

<span class="green">chroot（Change Root）</span> 是最古老的隔离机制，1979 年引入 Unix V7，通过修改进程的根目录，使其只能访问指定目录树下的文件。<br>
但 chroot 无法隔离进程、网络和挂载点，逃逸简单，现代容器中已不单独使用。<br>

<span class="green">Namespace</span> 是 Linux 2.4.19（2002 年）开始引入的资源隔离机制，每种 namespace 独立一类资源视图：<br>

| Namespace | 隔离资源 | 内核版本 | 作用 |
|-----------|----------|----------|------|
| PID | 进程 ID 空间 | 2.6.24 | 容器内 init 进程 PID=1 |
| NET | 网络设备、端口 | 2.6.24 | 独立网卡、IP、路由表 |
| IPC | 信号量、消息队列 | 2.6.19 | 独立 System V IPC |
| MNT | 挂载点 | 2.4.19 | 独立文件系统视图 |
| UTS | 主机名/域名 | 2.6.19 | 容器可设独立 hostname |
| USER | 用户/组 ID | 3.8 | root 映射为非特权用户 |
| CGROUP | cgroup 根目录 | 4.6 | 隐藏宿主 cgroup 信息 |
| TIME | 系统时钟 | 5.6 | 独立 boottime/monotonic |

<span class="green">cgroups（Control Groups）</span> 是 Linux 2.6.24 引入的资源限制框架，通过伪文件系统将进程分组，限制和统计 CPU、内存、I/O 等资源使用。<br>
cgroups v1（2007 年）采用层次结构，每种资源独立挂载；cgroups v2（2016 年）统一为单层次结构，接口更简洁。<br>

```c
// 手动创建 PID namespace 和隔离环境（简化示意）
#define _GNU_SOURCE
#include <sched.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
    // CLONE_NEWPID：新 PID namespace
    // CLONE_NEWNET：新网络 namespace
    // CLONE_NEWNS：新挂载 namespace
    pid_t pid = clone(child_func, stack + STACK_SIZE,
                      CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWNS | SIGCHLD,
                      NULL);
    waitpid(pid, NULL, 0);
    return 0;
}

int child_func(void *arg) {
    // 在新 namespace 中，当前进程 PID=1
    printf("pid in new ns: %d\n", getpid());   // 输出 1
    mount("proc", "/proc", "proc", 0, NULL);   // 挂载独立的 proc
    execlp("/bin/sh", "sh", NULL);
    return 0;
}
```

<span class="blue">关键结论：chroot + namespace + cgroup 是 Linux 容器的技术底座。理解这三者的叠加原理，是掌握嵌入式容器裁剪和故障排查的前提。</span><br>

---

### Namespace 原理与实现

<span class="red">Namespace 的本质是为进程组创建独立的资源视图，不同 namespace 中的进程看到的是各自的全局资源，彼此互不感知。</span><br>

内核为每个进程维护 `nsproxy` 结构体，指向其所属的各种 namespace 对象。<br>
`unshare()` 系统调用将调用线程移出指定的共享 namespace，移入新的私有 namespace；`setns()` 将线程加入已有 namespace。<br>
PID namespace 是容器化最关键的特性：新 namespace 中的第一个进程 PID 为 1，拥有 `init` 的特殊地位，收养孤儿进程，接收 SIGCHLD。<br>

```mermaid
flowchart TD
    subgraph HOST["宿主机 Namespace"]
        P1["进程 A<br>PID=1000"]
        P2["进程 B<br>PID=1001"]
    end
    subgraph NS1["容器 A Namespace"]
        C1["nginx<br>PID=1"]
        C2["php-fpm<br>PID=2"]
    end
    subgraph NS2["容器 B Namespace"]
        D1["redis<br>PID=1"]
        D2["worker<br>PID=2"]
    end
    P1 -->|unshare| NS1
    P2 -->|unshare| NS2
    C1 .-.->|看不到| P1
    D1 .-.->|看不到| P2
    C1 .-.->|看不到| D1
```

---

### cgroups 资源控制

<span class="red">cgroups 将进程组织为层次化的组，为每组分配资源配额和限制，是防止容器资源耗尽导致宿主机崩溃的关键防线。</span><br>

cgroups v2 统一层次结构下，每个组是一个目录，通过 `cgroup.controllers` 启用控制器：<br>
<span class="orange"><strong>cpu</strong></span>：`cpu.weight` 设置 CPU 时间权重，`cpu.max` 设置硬上限。<br>
<span class="orange"><strong>memory</strong></span>：`memory.max` 设置内存上限，超出触发 OOM Killer。<br>
<span class="orange"><strong>io</strong></span>：`io.max` 限制块设备 IOPS 和带宽。<br>
<span class="orange"><strong>pids</strong></span>：`pids.max` 限制进程/线程数量，防止 fork 炸弹。<br>

```bash
# 手动创建 cgroup 并限制内存
$ mkdir /sys/fs/cgroup/mycontainer
$ echo "+memory" > /sys/fs/cgroup/cgroup.subtree_control
$ echo "67108864" > /sys/fs/cgroup/mycontainer/memory.max   # 64MB 上限
$ echo "$$" > /sys/fs/cgroup/mycontainer/cgroup.procs       # 将当前 shell 移入
```

<span class="blue">易错点：cgroups v1 和 v2 的接口不兼容。嵌入式 Linux 若使用旧内核（如 4.4），只能使用 cgroups v1，需分别挂载 `cpu`、`memory`、`blkio` 子系统。</span><br>

---

### 容器 vs 裸机 vs 虚拟机

<span class="red">嵌入式部署形态有三种选择：裸机直接运行（传统方式）、容器化运行（轻量级隔离）、虚拟化运行（强隔离）。三者各有适用域，不能简单替代。</span><br>

| 维度 | 裸机 | 容器 | 虚拟机 |
|------|------|------|--------|
| 启动时间 | 秒级 | 毫秒~秒级 | 数十秒 |
| 内存开销 | 0 | MB 级 | GB 级 |
| 隔离强度 | 无 | 进程级 | 硬件级 |
| 内核共享 | 单一内核 | 共享内核 | 独立内核 |
| 实时性 | 最优 | 较好（namespace 开销小） | 差（虚拟化开销） |
| 适用场景 | 资源极度受限 | 中等复杂度应用隔离 | 安全强隔离、多 OS |

<span class="blue">选型结论：128MB 以下内存、秒级启动硬要求 → 裸机；需要应用隔离和独立依赖链 → 容器；需运行不同操作系统或强安全隔离 → 虚拟机（如 Jailhouse、Xen）。</span><br>

---

### 嵌入式容器选型：Docker、containerd、Podman

<span class="red">服务器领域的容器运行时（Docker、containerd、Podman）功能丰富但体积庞大，嵌入式场景需评估裁剪可行性或选择专用轻量方案。</span><br>

| 运行时 | 守护进程 | 镜像格式 | 嵌入式适用性 | 典型裁剪后体积 |
|--------|----------|----------|-------------|--------------|
| Docker | dockerd | OCI | 需大幅裁剪 | ~20MB |
| containerd | containerd | OCI | 中等 | ~15MB |
| Podman | 无（rootless） | OCI | 较好 | ~15MB |
| crun | 无 | OCI | 轻量 | ~1MB |
| runc | 无 | OCI | 参考实现 | ~2MB |
| systemd-nspawn | systemd | 目录/DIF | 系统集成好 | ~0（systemd 自带） |

<span class="blue">关键认知：嵌入式容器化的核心不是选哪个运行时，而是控制镜像体积和启动延迟。一个精简的 Alpine 或 Buildroot 基础镜像，配合 crun 或 systemd-nspawn，可在 5MB 以内实现完整的容器隔离。</span><br>

---

**学习路径提示**：<br>
- <span class="badge-i">[I]</span> 读者：理解 namespace 和 cgroup 的隔离原理，掌握 chroot 到完整容器的演进脉络。<br>
- <span class="badge-e">[E]</span> 读者：关注 cgroups v1/v2 接口差异、嵌入式裁剪策略和容器/裸机/虚拟机的选型权衡。<br>

---

## 历史演进与发展趋势

容器化技术的根源可追溯至 1979 年 Unix V7 的 chroot 系统调用，最初用于构建 FTP 服务的安全沙箱文件系统。2000 年，FreeBSD Jails 将 chroot 扩展为进程和网络隔离，首次实现接近现代容器的"操作系统级虚拟化"。2001 年，Linux VServer 项目为 Linux 引入类似的虚拟化能力。2006 年，Google 推出 Process Containers（后更名为 cgroups），为容器资源控制奠定基础。2008 年，Linux 2.6.24 同时合并 cgroups 和 PID/NET namespace，容器化的内核底座成型。2013 年，Docker 发布，通过镜像分层和仓库机制大幅降低容器使用门槛，引发云原生革命。2015 年，OCI（Open Container Initiative）成立，标准化容器运行时和镜像格式，避免厂商锁定。2016 年，cgroups v2 进入 Linux 4.5，统一资源控制接口。2020 年后，嵌入式领域开始吸收容器化成果：Yocto 和 Buildroot 增加容器工具链支持，systemd-nspawn 成为嵌入式 Linux 的轻量容器方案。未来趋势上，eBPF 与 cgroup 的结合正在催生新一代"可观测容器"，内核态可实时监控每个容器的系统调用和性能事件，而 unikernel 则走向另一极端——一个应用一个专用内核，比容器更轻、更贴近硬件。

---

## 本章小结

| 要点 | 内容 |
|------|------|
| 三大基石 | chroot 隔离文件视图，namespace 隔离资源视图，cgroup 限制资源用量 |
| Namespace | PID/NET/IPC/MNT/UTS/USER/CGROUP/TIME 八种，独立进程全局资源视图 |
| cgroups | v1 多挂载点 / v2 统一层次，cpu/memory/io/pids 控制器限制配额 |
| 裸机 vs 容器 | 裸机零开销无隔离，容器轻量共享内核，虚拟机强隔离独立内核 |
| 选型建议 | 极简资源用裸机，应用隔离用容器，强安全隔离用虚拟机 |
| 嵌入式运行时 | crun/systemd-nspawn 轻量首选，Docker 需大幅裁剪 |

## 练习

1. 使用 `unshare` 命令手动创建一个隔离环境：新 PID namespace、新挂载 namespace、新 UTS namespace。在新环境中挂载 proc 并运行 shell，观察 `ps` 和 `hostname` 的输出与宿主机有何不同。
2. 手动创建 cgroups v2 组，设置 `cpu.max` 为 "50000 100000"（每 100ms 周期内最多使用 50ms CPU），并将一个 CPU 密集型进程移入该组。用 `perf` 或 `time` 验证限制效果。
3. 对比 Docker、containerd 和 systemd-nspawn 三种容器运行时，从守护进程依赖、镜像格式、rootless 能力和嵌入式体积四个维度列出选型矩阵，说明在 256MB RAM 的工业网关中应选择哪一种。
