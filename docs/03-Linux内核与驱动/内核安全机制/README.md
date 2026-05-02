# 内核安全机制

> 📊 **本章难度等级：** <span class="badge-e">**高级 (Expert)**</span>

---

<span class="blue">**定义**：Linux 内核安全机制是一套**纵深防御**体系，</span>
从系统调用过滤、强制访问控制、完整性度量到内核锁定，
多层叠加，确保即使单点被突破，攻击面仍被严格限制。

---

## 为什么内核安全不是"锦上添花"

嵌入式设备常部署在无人值守环境：
工业网关、车载 ECU、医疗设备、智能家居。

一旦被物理接触或远程入侵，
篡改固件、窃取密钥、劫持控制链的后果远超传统服务器。

<span class="red">Linux 内核</span>安全机制把 "root 即上帝" 的 Unix 传统打破，
即使拿到 root，也有墙挡着。

---

## 安全机制的层次结构

```
┌──────────────────────────────────────────┐
│  应用层    │ SELinux/AppArmor 策略        │
├──────────────────────────────────────────┤
│  系统调用层 │ seccomp-bpf 过滤器            │
├──────────────────────────────────────────┤
│  内核对象层 │ LSM hooks（文件/task/IPC/网络） │
├──────────────────────────────────────────┤
│  完整性层  │ IMA/EVM 度量与校验             │
├──────────────────────────────────────────┤
│  启动链层  │ Secure Boot + TPM 度量         │
├──────────────────────────────────────────┤
│  硬件层    │ ARM TrustZone / RISC-V MultiZone│
└──────────────────────────────────────────┘
```

---

## LSM：安全机制的"骨架"

<span class="blue">**定义**：**LSM**（Linux Security Module）是内核中插入的**钩子框架**，</span>
在内核访问关键对象（文件、进程、网络包、IPC）前调用安全检查函数，
让安全策略模块决定是否允许操作。

---

### LSM 的设计哲学

LSM 不自己实现安全策略，
它只提供 "插入点"。

具体策略由 SELinux、AppArmor、SMACK 等模块实现。
这种解耦让内核保持通用，安全策略可独立演进。

---

### LSM Hook 的执行位置

```c
/* 定义：LSM hook 示例，fs/namei.c */
int vfs_open(const struct path *path, struct file *file)
{
    int ret;
    
    ret = security_file_open(file, cred);      /* 功能：LSM 检查 */
    if (ret)
        return ret;                            /* 核心API：拒绝访问 */
    
    return do_dentry_open(file, path->dentry, path->mnt);
}
```

- `security_file_open()` 调用所有注册的 LSM 模块，
任一模块返回非零即拒绝。

---

### LSM 的 "Major" 与 "Minor"

| 类型 | 模块 | 特点 |
|------|------|------|
| **Major** | SELinux, AppArmor, SMACK, TOMOYO | 独占安全上下文，一次只能启一个 |
| **Minor** | Yama, LoadPin, SafeSetID, Lockdown | 可叠加在 Major 之上 |

当前激活的 LSM 列表：

```bash
# 功能：查看已启用 LSM
cat /sys/kernel/security/lsm
# → capability,selinux,yama,loadpin
```

---

## SELinux：标签驱动的强制访问控制

<span class="blue">**定义**：**SELinux** 是 NSA 开发的 **MAC**（Mandatory Access Control）系统，</span>
给每个进程和文件打上安全上下文标签（如 `system_u:system_r:httpd_t:s0`），
策略规则决定 "什么标签的进程能访问什么标签的资源"。

---

### SELinux 的核心概念

| 概念 | 含义 | 示例 |
|------|------|------|
| **Subject** | 主动发起访问的实体 | 进程 `httpd_t` |
| **Object** | 被访问的资源 | 文件 `httpd_sys_content_t` |
| **Policy** | 允许/拒绝规则集合 | `allow httpd_t httpd_sys_content_t:file read;` |
| **Context** | 安全标签 | `u:r:t:s0` |

---

### SELinux 的工作流程

```
Apache (httpd_t) 请求读取 /var/www/index.html
  └── 内核 vfs_read()
        └── security_file_permission()
              └── selinux_file_permission()
                    └── 查 AVC 缓存（Access Vector Cache）
                    └── 命中 → 允许
                    └── 未命中 → 查策略库 → 更新 AVC → 允许/拒绝
```

- AVC 是内核缓存，
避免每次访问都解析庞大的策略库。

---

### SELinux 模式

| 模式 | 行为 | 用途 |
|------|------|------|
| **Enforcing** | 拒绝违规访问 | 生产环境 |
| **Permissive** | 仅记录不阻止 | 调试策略 |
| **Disabled** | 完全关闭 | 仅开发 |

```bash
# 功能：切换模式
setenforce 0        # Permissive
setenforce 1        # Enforcing
```

---

## AppArmor：路径 confinement

<span class="blue">**定义**：**AppArmor** 是 SUSE/Ubuntu 主推的 MAC 方案，</span>
通过**路径名**限制程序能访问的文件、网络、能力。
与 SELinux 的标签哲学不同，AppArmor 更直观：
"这个程序只能读写这些路径"。

---

### AppArmor Profile 示例

```
# 定义：AppArmor profile，/etc/apparmor.d/usr.sbin.nginx
#include <tunables/global>

/usr/sbin/nginx {
  #include <abstractions/base>
  
  capability net_bind_service,          /* 功能：允许绑定 80/443 */
  
  /var/www/** r,                        /* 功能：只读网站目录 */
  /var/log/nginx/* rw,                  /* 功能：读写日志 */
  
  deny /etc/shadow r,                   /* 核心API：显式拒绝敏感文件 */
  deny /proc/sys/** w,                  /* 核心API：禁止修改内核参数 */
}
```

---

### AppArmor vs SELinux

| 维度 | SELinux | AppArmor |
|------|---------|----------|
| 标识方式 | 安全标签（label） | 文件路径 |
| 策略复杂度 | 高 | 低 |
| 学习曲线 | 陡峭 | 平缓 |
| 灵活性 | 极高（RBAC/TE/MCS） | 中等 |
| 发行版 | RHEL/Fedora | Ubuntu/SUSE/openSUSE |
| 容器支持 | 成熟 | 成熟 |

---

## SMACK：简化的 Simplified MAC

<span class="blue">**定义**：**SMACK**（Simplified Mandatory Access Control Kernel）是 Intel/MeeGo 项目开发的轻量级 MAC，</span>
用 **"一个字符串标签"** 代替 SELinux 的多字段上下文，
规则只有 "读、写、执行" 三种。
适合资源极度受限的 IoT 设备。

---

### SMACK 规则示例

```
定义：SMACK 规则格式
subject_label object_label access

App.WebApp    _           rwx     /* WebApp 对自己标签的资源全权限 */
App.WebApp    System        r       /* 只读系统配置 */
App.WebApp    User::Home    rwx     /* 可操作用户目录 */
App.WebApp    ^             -       /* 拒绝其他所有访问 */
```

---

## IMA：完整性度量架构

<span class="blue">**定义**：**IMA**（Integrity Measurement Architecture）在内核中**度量（哈希计算）关键文件**，</span>
把度量结果扩展到 TPM（可信平台模块）的 PCR 寄存器，
实现从启动到运行时的信任链传递。

---

### IMA 的度量点

```
Bootloader (U-Boot) 度量 Kernel
  └── Kernel 度量 initramfs
        └── initramfs 度量 /sbin/init
              └── systemd 度量服务二进制
                    └── IMA 度量被访问的文件
                          └── 所有度量值扩展进 TPM PCR
```

---

### IMA 策略配置

```bash
# 定义：IMA 策略规则，/etc/ima/ima-policy
# 功能：度量 /usr/sbin 下所有可执行文件
dont_measure fsmagic=0x9fa0       /* procfs */
dont_measure fsmagic=0x1021994    /* sysfs */
measure func=FILE_CHECK mask=MAY_EXEC 
  fsmagic=0x612ff6b0              /* EXT4 */
  uid=0                           /* root 拥有的文件 */
```

---

### EVM：扩展验证模块

**EVM** 在 IMA 基础上增加**文件属性完整性保护**：
把文件的 mode、uid、xattr、IMA hash 等打包 HMAC，
任何属性篡改都会导致 HMAC 校验失败。

```bash
# 功能：查看文件的安全扩展属性
getfattr -d -m security /usr/sbin/nginx
# → security.ima      = 0sAQA... (文件哈希)
# → security.evm      = 0sAQA... (属性 HMAC)
```

---

## seccomp：系统调用过滤

<span class="blue">**定义**：**seccomp**（secure computing mode）是内核从 2.6.12 引入的**系统调用过滤机制**，</span>
通过 BPF 程序决定进程能执行哪些系统调用，
把攻击面从 "全部 300+ 系统调用" 压缩到 "最小必要集合"。

---

### seccomp 模式演进

| 模式 | 能力 | 用途 |
|------|------|------|
| **strict** | 只读、exit、sigreturn | 极端沙箱，几乎不用 |
| **filter** | 自定义 BPF 规则 | 主流用法 |
| **notify** | 用户态处理决策 | 灵活代理 |

---

### seccomp-bpf 规则示例

```c
/* 定义：seccomp BPF 程序 */
struct sock_filter filter[] = {
    /* 功能：加载系统调用号 */
    BPF_STMT(BPF_LD + BPF_W + BPF_ABS, 
               offsetof(struct seccomp_data, nr)),
    
    /* 功能：允许 openat */
    BPF_JUMP(BPF_JMP + BPF_JEQ + BPF_K, __NR_openat, 0, 1),
    BPF_STMT(BPF_RET + BPF_K, SECCOMP_RET_ALLOW),
    
    /* 功能：允许 read/write/close */
    BPF_JUMP(BPF_JMP + BPF_JEQ + BPF_K, __NR_read, 0, 1),
    BPF_STMT(BPF_RET + BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP + BPF_JEQ + BPF_K, __NR_write, 0, 1),
    BPF_STMT(BPF_RET + BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP + BPF_JEQ + BPF_K, __NR_close, 0, 1),
    BPF_STMT(BPF_RET + BPF_K, SECCOMP_RET_ALLOW),
    
    /* 核心API：拒绝其他所有系统调用 */
    BPF_STMT(BPF_RET + BPF_K, SECCOMP_RET_KILL),
};

struct sock_fprog prog = {
    .len = ARRAY_SIZE(filter),
    .filter = filter,
};

/* 功能：应用过滤器 */
prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog);
```

---

### Docker 默认 seccomp 策略

Docker 默认阻止约 44 个危险系统调用：

| 被阻调用 | 风险 |
|----------|------|
| `mount` | 挂载任意文件系统 |
| `pivot_root` | 切换根目录 |
| `swapon` | 启用交换 |
| `reboot` | 重启系统 |
| `kexec_load` | 加载新内核 |

---

## Capabilities：细分 root 权限

<span class="blue">**定义**：传统 Unix 的 root 是 "全有或全无"。</span>
**Capabilities** 把 root 特权拆成 ~40 个独立权限位，
让进程只拥有它真正需要的特权，而非全部。

---

### 关键 Capabilities

| Capability | 权限 | 嵌入式场景 |
|------------|------|------------|
| **CAP_SYS_ADMIN** | 系统管理万能牌 | 容器内一般去掉 |
| **CAP_NET_ADMIN** | 网络配置 | 网络服务可能需要 |
| **CAP_NET_BIND_SERVICE** | 绑定 < 1024 端口 | Web 服务器常用 |
| **CAP_SYS_TIME** | 修改系统时钟 | 一般只给 NTP |
| **CAP_SYS_MODULE** | 加载内核模块 | 生产环境绝对禁止 |
| **CAP_SYS_RAWIO** | 原始 I/O（/dev/mem）| 极度危险 |

---

### 实战：最小化容器权限

```dockerfile
# 定义：Docker 最小权限配置
FROM alpine:latest
COPY app /app

# 功能：只保留必要 capabilities
RUN setcap 'cap_net_bind_service=+ep' /app

USER 1000:1000

# 核心API：运行时丢弃所有其他权限
docker run --cap-drop=ALL \
           --cap-add=NET_BIND_SERVICE \
           --security-opt no-new-privileges:true \
           myimage
```

---

## Lockdown：内核锁定模式

<span class="blue">**定义**：**Lockdown** 是内核 5.4 引入的**完整性保护模式**，</span>
一旦启用，即使 root 也无法：
- 加载未签名模块
- 通过 `/dev/mem` 修改内核内存
- 使用 `kprobes` 插入探测点
- 通过 `bpf` 写入内核内存

---

### Lockdown 等级

| 等级 | 限制 | 场景 |
|------|------|------|
| **none** | 无限制 | 开发 |
| **integrity** | 禁止修改运行内核 | 标准生产 |
| **confidentiality** | 额外禁止提取敏感数据 | 高安全 |

```bash
# 功能：查看 lockdown 状态
cat /sys/kernel/security/lockdown
# → [integrity] confidentiality none
```

---

## 安全启动链：从 BootROM 到用户态

<span class="blue">**定义**：**安全启动链**是一系列签名验证环节，</span>
确保从芯片上电开始，每一级固件/内核/应用都经过授权方签名，
任何篡改都会导致启动终止。

---

### ARM 安全启动流程

```
BootROM（芯片硬件）
  └── 验证 BL1（Trusted Firmware）签名
        └── BL1 验证 BL2 签名
              └── BL2 验证 OP-TEE + U-Boot 签名
                    └── U-Boot 验证 Kernel + DTB 签名（FIT image）
                          └── Kernel 验证模块签名（CONFIG_MODULE_SIG）
                                └── IMA 度量用户态关键文件
                                      └── SELinux/AppArmor 限制运行时行为
```

---

### FIT Image 签名

U-Boot 使用 **FIT**（Flattened Image Tree）格式打包 kernel + dtb + initramfs，
并用 RSA/ECDSA 签名：

```
定义：FIT image 签名节点
/ {
    images {
        kernel@1 { ... };
        fdt@1 { ... };
    };
    configurations {
        default = "conf@1";
        conf@1 {
            kernel = "kernel@1";
            fdt = "fdt@1";
            signature@1 {
                algo = "sha256,rsa2048";    /* 功能：签名算法 */
                key-name-hint = "dev";
            };
        };
    };
};
```

---

## 嵌入式安全实战：纵深防御配置

---

### 最小安全基线

```bash
# 1. 功能：启用 SELinux（Enforcing）
setenforce 1
sed -i 's/SELINUX=permissive/SELINUX=enforcing/' /etc/selinux/config

# 2. 功能：启用 IMA 度量
ima_policy="tcb"
grubby --update-kernel=ALL --args="ima_policy=$ima_policy"

# 3. 功能：启用内核 lockdown
grubby --update-kernel=ALL --args="lockdown=integrity"

# 4. 功能：启用模块签名强制
grubby --update-kernel=ALL --args="module.sig_enforce=1"

# 5. 功能：限制 dmesg 暴露
sysctl kernel.dmesg_restrict=1
sysctl kernel.kptr_restrict=2
```

---

### 容器安全上下文（Kubernetes）

```yaml
# 定义：Pod Security Context
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsNonRoot: true                  /* 功能：禁止 root 运行 */
    seccompProfile:
      type: RuntimeDefault             /* 功能：默认系统调用过滤 */
    appArmorProfile:
      type: RuntimeDefault             /* 功能：AppArmor 保护 */
  containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false   /* 核心API：禁止提权 */
      readOnlyRootFilesystem: true       /* 核心API：根文件系统只读 */
      capabilities:
        drop:
        - ALL                           /* 核心API：丢弃所有能力 */
        add:
        - NET_BIND_SERVICE              /* 功能：仅保留绑定端口能力 */
```

---

## 总结

<span class="blue">**定义**：Linux 内核安全机制通过 **LSM 钩子框架** 串联 SELinux/AppArmor/SMACK 强制访问控制、</span>
**seccomp-bpf** 系统调用过滤、
**IMA/EVM** 完整性度量、
**Lockdown** 内核锁定、
**Capabilities** 权限细分，
构建了一套从启动到运行时的纵深防御体系。

---

| 机制 | 防御层次 | 核心文件 |
|------|----------|----------|
| Secure Boot + FIT | 启动链 | `U-Boot + TF-A` |
| IMA/EVM | 完整性度量 | `security/integrity/` |
| LSM (SELinux/AppArmor/SMACK) | 强制访问控制 | `security/selinux/`, `security/apparmor/` |
| seccomp-bpf | 系统调用过滤 | `kernel/seccomp.c` |
| Capabilities | 权限细分 | `kernel/capability.c` |
| Lockdown | 内核锁定 | `security/lockdown/` |
| TPM | 硬件信任根 | `drivers/char/tpm/` |

---

掌握<span class="red">内核安全机制</span>意味着：
能为 IoT 设备设计 "被物理破解也无法提取密钥" 的方案，
能在容器里实现 "即使应用被 RCE，也只能访问一个空目录" 的硬隔离，
能建立从芯片 BootROM 到<span class="red">用户态</span>应用的完整信任链。
