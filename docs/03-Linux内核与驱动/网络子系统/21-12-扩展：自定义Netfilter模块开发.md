# 扩展：自定义Netfilter模块开发

> 📊 **本节难度等级：** <span class="badge-m">**M级**</span>

---

### <strong>嵌入式场景中，当iptables的默认功能无法满足需求（如自定义流量统计、特殊协议过滤）时，需开发Netfilter内核模块，通过注册钩子函数实现自定义逻辑。
以下以“TCP流量统计模块”为例，实现统计指定端口的TCP收发数据包数量。</strong>


### <strong>1. 钩子函数注册与包处理逻辑</strong>

Netfilter模块开发核心是“注册钩子函数到指定钩子点”，
通过`nf_register_hook()`函数完成注册，钩子函数中实现数据包处理逻辑。

（1）完整模块代码（tcp_count.c）
```c
#include <linux/init.h>
#include <linux/module.h>
#include <linux/netfilter.h>
#include <linux/netfilter_ipv4.h>
#include <linux/ip.h>
#include <linux/tcp.h>

#define TARGET_PORT 502  // 统计目标端口（Modbus端口）
static unsigned int tcp_in_count = 0;  // 入站TCP包计数
static unsigned int tcp_out_count = 0; // 出站TCP包计数

// 钩子函数：处理INPUT链（入站TCP包）
static unsigned int tcp_in_hook(void *priv, struct sk_buff *skb, const struct nf_hook_state *state) {
    struct iphdr *iph;
    struct tcphdr *tcph;

    // 校验skb和IP头
    if (!skb || !skb->data) return NF_ACCEPT;
    iph = ip_hdr(skb);
    if (iph->protocol != IPPROTO_TCP) return NF_ACCEPT; // 仅处理TCP包

    // 校验TCP头
    tcph = tcp_hdr(skb);
    if (ntohs(tcph->dest) == TARGET_PORT) { // 目标端口为502
        tcp_in_count++;
        printk(KERN_INFO "TCP IN: count=%u, src=%pI4, dst=%pI4, dport=%d\n",
               tcp_in_count, &iph->saddr, &iph->daddr, ntohs(tcph->dest));
    }

    return NF_ACCEPT; // 允许数据包通过（仅统计不过滤）
}

// 钩子函数：处理OUTPUT链（出站TCP包）
static unsigned int tcp_out_hook(void *priv, struct sk_buff *skb, const struct nf_hook_state *state) {
    struct iphdr *iph;
    struct tcphdr *tcph;

    if (!skb || !skb->data) return NF_ACCEPT;
    iph = ip_hdr(skb);
    if (iph->protocol != IPPROTO_TCP) return NF_ACCEPT;

    tcph = tcp_hdr(skb);
    if (ntohs(tcph->source) == TARGET_PORT) { // 源端口为502
        tcp_out_count++;
        printk(KERN_INFO "TCP OUT: count=%u, src=%pI4, dst=%pI4, sport=%d\n",
               tcp_out_count, &iph->saddr, &iph->daddr, ntohs(tcph->source));
    }

    return NF_ACCEPT;
}

// 钩子结构配置（注册到INPUT和OUTPUT链）
static struct nf_hook_ops tcp_in_hook_ops = {
    .hook = tcp_in_hook,          // 入站钩子函数
    .hooknum = NF_INET_LOCAL_IN,  // 钩子点（INPUT链）
    .pf = PF_INET,                // 协议族（IPv4）
    .priority = NF_IP_PRI_FIRST   // 优先级（最高，最先执行）
};

static struct nf_hook_ops tcp_out_hook_ops = {
    .hook = tcp_out_hook,         // 出站钩子函数
    .hooknum = NF_INET_LOCAL_OUT, // 钩子点（OUTPUT链）
    .pf = PF_INET,
    .priority = NF_IP_PRI_FIRST
};

// 模块初始化
static int __init tcp_count_init(void) {
    // 注册两个钩子
    nf_register_hook(&tcp_in_hook_ops);
    nf_register_hook(&tcp_out_hook_ops);
    printk(KERN_INFO "TCP count module loaded, target port=%d\n", TARGET_PORT);
    return 0;
}

// 模块卸载
static void __exit tcp_count_exit(void) {
    nf_unregister_hook(&tcp_in_hook_ops);
    nf_unregister_hook(&tcp_out_hook_ops);
    printk(KERN_INFO "TCP count module unloaded, in=%u, out=%u\n", tcp_in_count, tcp_out_count);
}

module_init(tcp_count_init);
module_exit(tcp_count_exit);
MODULE_LICENSE("GPL"); // 必须声明GPL协议（Netfilter要求）
MODULE_DESCRIPTION("TCP Packet Count Module for Embedded Linux");
MODULE_AUTHOR("Embedded Linux Team");
```

（2）Makefile（适配嵌入式内核）
```makefile
# 嵌入式内核路径（需替换为实际内核源码路径）
KERNELDIR ?= /home/user/linux-5.15.0-embedded
PWD := $(shell pwd)

obj-m += tcp_count.o  # 模块名

all:
    $(MAKE) -C $(KERNELDIR) M=$(PWD) modules  # 编译模块

clean:
    $(MAKE) -C $(KERNELDIR) M=$(PWD) clean    # 清理编译产物
```<br>

### <strong>2. 嵌入式场景：自定义流量统计模块实现</strong>

（1）模块编译与加载
1.  编译：将代码与Makefile放入同一目录，执行`make`，生成`tcp_count.ko`模块文件；
2.  加载模块：通过TFTP或<span class="green">USB</span>将模块传入嵌入式设备，执行加载命令：
    ```bash
    # 加载模块
    insmod tcp_count.ko
    # 查看模块加载状态
    lsmod | grep tcp_count
    # 预期输出：tcp_count 16384 0 - Live 0xffffffffc000a000 (O)
    # 查看模块日志
    dmesg | grep "TCP count module"
    # 预期输出：[12345.678901] TCP count module loaded, target port=502
    ```

（2）功能验证与调试
1.  触发流量：上位机通过Modbus协议（502端口）与设备通信，或执行`telnet 192.168.1.100 502`；
2.  查看统计日志：
    ```bash
    dmesg | grep "TCP IN\|TCP OUT"
    # 预期输出：
    # [12350.123456] TCP IN: count=1, src=192.168.1.200, dst=192.168.1.100, dport=502
    # [12350.234567] TCP OUT: count=1, src=192.168.1.100, dst=192.168.1.200, sport=502
    ```
3.  卸载模块：
    ```bash
    rmmod tcp_count
    dmesg | grep "TCP count module unloaded"
    # 预期输出：[12360.123456] TCP count module unloaded, in=5, out=5
    ```

（3）嵌入式优化建议
-  日志优化：
模块中`<span class="green">printk</span>`会占用CPU资源，实际部署时可通过`proc`文件系统暴露统计数据（如创建`/proc/tcp_count`文件，读取时返回计数），避免频繁打印日志；
-  资源释放：
若模块中使用动态内存（如`<span class="green">kmalloc</span>`），需在卸载时释放，避免内存泄漏；
-  内核版本适配：
不同内核版本的Netfilter接口可能变化（如5.4+版本钩子函数参数调整），编译前需确认内核头文件与接口匹配。<br>

---
