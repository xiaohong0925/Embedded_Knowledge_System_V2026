# Netfilter框架：包过滤与网络钩子

> 📊 **本节难度等级：** <span class="badge-e">**E级**</span>

---

### <strong>Netfilter是Linux内核的“网络流量管控框架”，通过在协议栈关键位置嵌入“钩子点”（Hook Point），允许内核模块或用户层工具（如iptables）对数据包进行过滤、修改、转发或统计。
嵌入式场景中，Netfilter是实现设备安全（如端口过滤）、流量控制（如带宽限制）的核心技术。</strong>


### <strong>1. 核心钩子点：PRE_ROUTING、INPUT、FORWARD等链的作用</strong>

Netfilter在IPv4协议栈中定义了5个核心钩子点，覆盖数据包从接收至发送的全流程，
每个钩子点对应一个“链”（Chain），用户可在链上挂载规则处理数据包：

| 钩子点（Hook Point） | 所在协议栈位置                          | 核心作用                                                                 | 对应iptables链 |
|----------------------|-----------------------------------------|--------------------------------------------------------------------------|----------------|
| `NF_INET_PRE_ROUTING` | 链路层解封装后，网络层路由前            | 修改数据包目标IP（如DNAT）、流量统计，嵌入式常用于端口映射                | PREROUTING     |
| `NF_INET_LOCAL_IN`    | 路由后，确定数据包目标为本机时          | 过滤进入本机的数据包（如禁止访问22端口），嵌入式最常用钩子点              | INPUT          |
| `NF_INET_FORWARD`     | 路由后，确定数据包需转发至其他设备时    | 过滤转发数据包（如网关设备的跨网段流量控制）                              | FORWARD        |
| `NF_INET_LOCAL_OUT`   | 本机应用层发送数据，进入协议栈时        | 过滤本机发送的数据包（如禁止访问外部80端口）                              | OUTPUT         |
| `NF_INET_POST_ROUTING`| 网络层封装为链路层帧前                  | 修改数据包源IP（如SNAT）、设置MAC地址，嵌入式常用于网关出口地址转换        | POSTROUTING    |

- 数据包流经钩子点的完整流程（以“外部访问本机80端口”为例）：
```mermaid
flowchart TD
    A[外部发送TCP包到本机eth0] --> B[链路层解封装]
    B --> C[NF_INET_PRE_ROUTING（PREROUTING链，可做DNAT）]
    C --> D[网络层路由判断（目标为本机）]
    D --> E[NF_INET_LOCAL_IN（INPUT链，过滤80端口规则）]
    E --> F[传输层解封装（TCP）]
    F --> G[应用层（如nginx服务）]
```<br>

### <strong>2. 规则配置：iptables与内核钩子的关联逻辑</strong>

iptables是用户层操作Netfilter的工具，通过“表（Table）-链（Chain）-规则（Rule）”三级结构管理数据包处理逻辑，
其中“表”对应功能分类，“链”对应Netfilter钩子点，“规则”对应具体处理动作。

（1）核心关联逻辑
1.  表与链的绑定：iptables的表决定可操作的链，嵌入式常用表及关联链：
    | 表类型   | 功能分类               | 可操作的Netfilter钩子点（链）                  | 嵌入式应用场景       |
    |----------|------------------------|-----------------------------------------------|----------------------|
    | `filter` | 数据包过滤（核心表）   | INPUT、FORWARD、OUTPUT                         | 端口访问控制         |
    | `nat`    | 地址转换               | PREROUTING、INPUT、OUTPUT、POSTROUTING         | 网关端口映射         |
    | `mangle` | 数据包修改（如TTL）    | 所有5个钩子点                                 | 流量标记、TTL调整    |
2.  规则执行逻辑：每条规则包含“匹配条件”（如端口、协议）和“动作”（如ACCEPT、DROP），当数据包流经链时，按规则顺序匹配，匹配成功则执行动作，否则继续匹配下一条。

（2）iptables基础操作命令（嵌入式常用）
```bash
# 1. 查看filter表所有链的规则（默认表为filter）
iptables -L -n
# 预期输出：
# Chain INPUT (policy ACCEPT)
# target     prot opt source               destination         
# 
# Chain FORWARD (policy ACCEPT)
# target     prot opt source               destination         
# 
# Chain OUTPUT (policy ACCEPT)
# target     prot opt source               destination         

# 2. 配置INPUT链规则：仅允许TCP 22（SSH）和80（HTTP）端口，其他拒绝
# 先允许已建立的连接（避免配置后SSH断开）
iptables -A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
# 允许22端口
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
# 允许80端口
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
# 拒绝其他所有INPUT流量
iptables -P INPUT DROP  # 设置INPUT链默认策略为DROP

# 3. 查看配置后的规则
iptables -L -n --line-numbers
# 预期输出：
# Chain INPUT (policy DROP)
# num  target     prot opt source               destination         
# 1    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            state RELATED,ESTABLISHED
# 2    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22
# 3    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:80

# 4. 保存规则（嵌入式重启后生效，不同系统路径可能不同）
iptables-save > /etc/iptables/rules.v4
# 恢复规则
iptables-restore < /etc/iptables/rules.v4

# 5. 清除所有规则（测试场景用）
iptables -F
iptables -X
iptables -P INPUT ACCEPT
```<br>

### <strong>3. 嵌入式实战：通过iptables配置端口过滤，实现设备访问控制</strong>

以“工业控制设备”为例，需求：仅允许上位机访问设备的502端口（Modbus协议）和22端口（SSH调试），
拒绝其他所有端口访问，同时记录被拒绝的流量日志。

（1）完整配置流程
```bash
# 1. 加载日志模块（嵌入式需确保内核支持nf_conntrack和xt_LOG模块）
modprobe xt_LOG
modprobe nf_conntrack

# 2. 配置INPUT链规则
# 允许已建立连接
iptables -A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
# 允许SSH（22端口）
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
# 允许Modbus（502端口）
iptables -A INPUT -p tcp --dport 502 -j ACCEPT
# 拒绝其他所有TCP/UDP流量并记录日志（日志前缀"REJECTED: "）
iptables -A INPUT -p tcp -j LOG --log-prefix "REJECTED_TCP: " --log-level 6
iptables -A INPUT -p udp -j LOG --log-prefix "REJECTED_UDP: " --log-level 6
iptables -A INPUT -j REJECT

# 3. 配置OUTPUT链规则（允许本机主动发起的连接）
iptables -A OUTPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p tcp --sport 22 -j ACCEPT
iptables -A OUTPUT -p tcp --sport 502 -j ACCEPT
iptables -A OUTPUT -j REJECT
```

（2）验证与故障排查
1.  功能验证：
    - 上位机测试：`telnet 192.168.1.100 502`（连接成功），`telnet 192.168.1.100 80`（连接失败）；
    - 设备端查看日志：`<span class="green">dmesg</span> | grep REJECTED`（查看被拒绝的流量）：
      ```bash
      dmesg | grep REJECTED
      # 预期输出：[12345.678901] REJECTED_TCP: IN=eth0 OUT= MAC=00:11:22:33:44:55:aa:bb:cc:dd:ee:ff:08:00 SRC=192.168.1.200 DST=192.168.1.100 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=12345 DF PROTO=TCP SPT=54321 DPT=80 WINDOW=64240 RES=0x00 SYN URGP=0
      ```
2.  常见问题排查：
    - 配置后SSH断开：未配置“允许已建立连接”规则，需先执行`iptables -A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`；
    - 502端口无法访问：检查规则顺序（拒绝规则需在允许规则之后），通过`iptables -L -n --line-numbers`确认；
    - 无日志输出：未加载xt_LOG模块，执行`<span class="green">modprobe</span> xt_LOG`并重新配置日志规则。<br>

---
