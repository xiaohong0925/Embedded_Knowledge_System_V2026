import yaml
import os
import re

# Read current mkdocs.yml
mkdocs_path = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\mkdocs.yml'
with open(mkdocs_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the nav section for module 03
# We need to replace the 03 module nav with compressed version

# The current 03 section starts with:
#   - 3. Linux内核与驱动 [I→M]:
# and ends before:
#   - 4. 系统构建与部署 [I→E]:

# Find the start and end of module 03 nav
start_marker = '  - 3. Linux内核与驱动 [I→M]:'
end_marker = '  - 4. 系统构建与部署 [I→E]:'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print(f'ERROR: Could not find markers. start={start_idx}, end={end_idx}')
    exit(1)

# Extract the old section (for reference)
old_section = content[start_idx:end_idx]

# Build the new compressed section
new_section = '''  - 3. Linux内核与驱动 [I→M]:
    - "概览": 03-Linux内核与驱动/README.md
    - 3.1 linux简介:
      - "22-01-历史演进与核心认知": 03-Linux内核与驱动/linux简介/22-01-历史演进与核心认知.md
      - "22-02-内核架构与核心子系统": 03-Linux内核与驱动/linux简介/22-02-内核架构与核心子系统.md
      - "22-03-嵌入式专属实战场景": 03-Linux内核与驱动/linux简介/22-03-嵌入式专属实战场景.md
      - "22-04-扩展阅读：进阶方向指引": 03-Linux内核与驱动/linux简介/22-04-扩展阅读：进阶方向指引.md
    - 3.2 进程管理:
      - "03-01-进程与调度核心认知": 03-Linux内核与驱动/进程管理/03-01-进程与调度核心认知.md
      - "03-02-核心机制：进程管理与调度底层逻辑": 03-Linux内核与驱动/进程管理/03-02-核心机制：进程管理与调度底层逻辑.md
      - "03-03-技术教学：调度配置与编程实战": 03-Linux内核与驱动/进程管理/03-03-技术教学：调度配置与编程实战.md
      - "03-04-多核调度与CPU亲和性": 03-Linux内核与驱动/进程管理/03-04-多核调度与CPU亲和性.md
      - "03-05-嵌入式专属实战场景": 03-Linux内核与驱动/进程管理/03-05-嵌入式专属实战场景.md
      - "03-06-技术演进": 03-Linux内核与驱动/进程管理/03-06-技术演进.md
      - "03-07-扩展阅读：调度器源码深度与定制": 03-Linux内核与驱动/进程管理/03-07-扩展阅读：调度器源码深度与定制.md
    - 3.3 内存管理:
      - "04-01-内存管理基础认知": 03-Linux内核与驱动/内存管理/04-01-内存管理基础认知.md
      - "04-02-核心内存分配机制原理解析": 03-Linux内核与驱动/内存管理/04-02-核心内存分配机制原理解析.md
      - "04-03-进阶内存管理机制": 03-Linux内核与驱动/内存管理/04-03-进阶内存管理机制.md
      - "04-04-嵌入式场景实战与调优": 03-Linux内核与驱动/内存管理/04-04-嵌入式场景实战与调优.md
      - "04-05-历史演进与前沿扩展": 03-Linux内核与驱动/内存管理/04-05-历史演进与前沿扩展.md
      - "04-06-前沿技术方向": 03-Linux内核与驱动/内存管理/04-06-前沿技术方向.md
    - 3.4 虚拟文件系统:
      - "05-01-基本介绍": 03-Linux内核与驱动/虚拟文件系统/05-01-基本介绍.md
      - "05-02-VFS核心原理与数据结构": 03-Linux内核与驱动/虚拟文件系统/05-02-VFS核心原理与数据结构.md
      - "05-04-VFS关键流程与嵌入式核心实例": 03-Linux内核与驱动/虚拟文件系统/05-04-VFS关键流程与嵌入式核心实例.md
      - "05-05-嵌入式VFS实战场景": 03-Linux内核与驱动/虚拟文件系统/05-05-嵌入式VFS实战场景.md
      - "05-09-VFS历史演进与嵌入式优化": 03-Linux内核与驱动/虚拟文件系统/05-09-VFS历史演进与嵌入式优化.md
    - 3.5 设备树:
      - "06-01-设备树基础认知": 03-Linux内核与驱动/设备树/06-01-设备树基础认知.md
      - "06-02-设备树的历史演进与设计初衷": 03-Linux内核与驱动/设备树/06-02-设备树的历史演进与设计初衷.md
      - "06-03-设备树入门实战：编写与编译": 03-Linux内核与驱动/设备树/06-03-设备树入门实战：编写与编译.md
      - "06-04-设备树底层原理：内核解析流程": 03-Linux内核与驱动/设备树/06-04-设备树底层原理：内核解析流程.md
      - "06-05-嵌入式实战场景：设备树适配案例": 03-Linux内核与驱动/设备树/06-05-嵌入式实战场景：设备树适配案例.md
      - "06-09-设备树高级应用：调试与优化": 03-Linux内核与驱动/设备树/06-09-设备树高级应用：调试与优化.md
      - "06-10-设备树排错与工程实践指南": 03-Linux内核与驱动/设备树/06-10-设备树排错与工程实践指南.md
    - 3.6 驱动模型:
      - "01-驱动模型基础认知": 03-Linux内核与驱动/驱动模型/01-驱动模型基础认知.md
      - "02-核心驱动模型原理解析": 03-Linux内核与驱动/驱动模型/02-核心驱动模型原理解析.md
      - "03-驱动开发核心技术教学": 03-Linux内核与驱动/驱动模型/03-驱动开发核心技术教学.md
      - "04-软硬件实战场景": 03-Linux内核与驱动/驱动模型/04-软硬件实战场景.md
      - "05-驱动模型进阶与优化": 03-Linux内核与驱动/驱动模型/05-驱动模型进阶与优化.md
      - "06-驱动模型历史演进与生态": 03-Linux内核与驱动/驱动模型/06-驱动模型历史演进与生态.md
    - 3.7 中断子系统:
      - "07-01-1 中断基础与硬件架构": 03-Linux内核与驱动/中断子系统/07-01-1 中断基础与硬件架构.md
      - "07-02-2 内核中断处理机制": 03-Linux内核与驱动/中断子系统/07-02-2 内核中断处理机制.md
    - 3.8 网络子系统:
      - "21-01-网络子系统基础认知": 03-Linux内核与驱动/网络子系统/21-01-网络子系统基础认知.md
      - "21-02-核心数据结构：sk_buff深度解析": 03-Linux内核与驱动/网络子系统/21-02-核心数据结构：sk_buff深度解析.md
      - "21-03-内核协议栈实现：从L2到L4": 03-Linux内核与驱动/网络子系统/21-03-内核协议栈实现：从L2到L4.md
      - "21-04-数据链路层（L2）实现": 03-Linux内核与驱动/网络子系统/21-04-数据链路层（L2）实现.md
      - "21-05-网络层（L3）核心机制": 03-Linux内核与驱动/网络子系统/21-05-网络层（L3）核心机制.md
      - "21-06-传输层（L4）深度剖析": 03-Linux内核与驱动/网络子系统/21-06-传输层（L4）深度剖析.md
      - "21-07-网络设备驱动框架": 03-Linux内核与驱动/网络子系统/21-07-网络设备驱动框架.md
      - "21-08-高级特性实现：嵌入式高性能需求适配": 03-Linux内核与驱动/网络子系统/21-08-高级特性实现：嵌入式高性能需求适配.md
      - "21-09-子系统核心机制：命名空间与Netfilter": 03-Linux内核与驱动/网络子系统/21-09-子系统核心机制：命名空间与Netfilter.md
      - "21-10-网络命名空间：资源隔离的实现": 03-Linux内核与驱动/网络子系统/21-10-网络命名空间：资源隔离的实现.md
      - "21-11-Netfilter框架：包过滤与网络钩子": 03-Linux内核与驱动/网络子系统/21-11-Netfilter框架：包过滤与网络钩子.md
      - "21-12-扩展：自定义Netfilter模块开发": 03-Linux内核与驱动/网络子系统/21-12-扩展：自定义Netfilter模块开发.md
      - "21-13-嵌入式专属实战场景": 03-Linux内核与驱动/网络子系统/21-13-嵌入式专属实战场景.md
      - "21-14-网络子系统演进与前沿方向": 03-Linux内核与驱动/网络子系统/21-14-网络子系统演进与前沿方向.md
      - "21-15-前沿技术：内核网络的新趋势": 03-Linux内核与驱动/网络子系统/21-15-前沿技术：内核网络的新趋势.md
      - "21-16-扩展：SDN与内核网络集成": 03-Linux内核与驱动/网络子系统/21-16-扩展：SDN与内核网络集成.md
'''

# Replace the old section with new section
new_content = content[:start_idx] + new_section + content[end_idx:]

# Write back
with open(mkdocs_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print('mkdocs.yml updated: module 03 STRICTLY compressed to 8 expandable sections')
print('Removed from nav: 时间子系统, 电源管理框架, 内核安全机制, 设备驱动框架, 用户-内核接口, 并发与竞态')
print('These files still exist but are NOT in the navigation sidebar.')
print('If needed, they can be linked from content pages or added back later.')

# Also search for Mermaid errors
print('\n=== Mermaid Error Search ===')
base_docs = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
issues = []
for root, dirs, files in os.walk(base_docs):
    for f in files:
        if f.endswith('.md'):
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8') as mf:
                    text = mf.read()
                # Find mermaid blocks
                mermaid_blocks = re.findall(r'```mermaid\n(.*?)\n```', text, re.DOTALL)
                for block in mermaid_blocks:
                    # Check for common syntax issues
                    lines = block.split('\n')
                    for i, line in enumerate(lines, 1):
                        # Check for Chinese punctuation in node labels without quotes
                        if re.search(r'[\u3000-\u303f\uff00-\uffef]', line):
                            if not re.search(r'["\']', line):
                                issues.append(f'{path}: line {i} - Chinese punctuation without quotes: {line[:60]}')
                        # Check for unclosed brackets
                        if line.count('[') != line.count(']'):
                            issues.append(f'{path}: line {i} - Unclosed brackets: {line[:60]}')
                        # Check for empty node IDs
                        if re.search(r'^\s*[A-Za-z0-9_]+\s*\[\s*\]', line):
                            issues.append(f'{path}: line {i} - Empty node label: {line[:60]}')
            except Exception as e:
                pass

if issues:
    print(f'Found {len(issues)} potential Mermaid issues:')
    for issue in issues[:20]:
        print(f'  {issue}')
else:
    print('No obvious Mermaid syntax issues found in scanned files.')
    print('Note: The error might be from a specific file not yet scanned, or from runtime rendering.')
