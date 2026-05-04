import os
import re

base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026'
pcie_dir = os.path.join(base_dir, 'docs', '08-总线协议', '高速外设扩展总线', 'PCI与PCIe')

# 1. 删除骨架文件（<3KB的文件）
skeleton_files = []
for f in os.listdir(pcie_dir):
    fp = os.path.join(pcie_dir, f)
    if os.path.isfile(fp) and os.path.getsize(fp) < 3000:
        skeleton_files.append(f)
        print(f'Removing skeleton: {f} ({os.path.getsize(fp)} bytes)')
        os.remove(fp)

print(f'\nRemoved {len(skeleton_files)} skeleton files.')

# 2. 更新 mkdocs.yml 导航
mkdocs_path = os.path.join(base_dir, 'mkdocs.yml')
with open(mkdocs_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 替换映射: 骨架标题/文件名 -> 完整版标题/文件名
replacements = [
    # 04: 数据链路层协议 -> 事务层与TLP
    ('数据链路层协议: 08-总线协议/高速外设扩展总线/PCI与PCIe/04-数据链路层协议.md',
     '事务层与TLP: 08-总线协议/高速外设扩展总线/PCI与PCIe/04-事务层与TLP.md'),
    
    # 05: 事务层详解 -> 配置空间
    ('事务层详解: 08-总线协议/高速外设扩展总线/PCI与PCIe/05-事务层详解.md',
     '配置空间: 08-总线协议/高速外设扩展总线/PCI与PCIe/05-配置空间.md'),
    
    # 06: 配置空间与枚举 -> 地址空间与枚举
    ('配置空间与枚举: 08-总线协议/高速外设扩展总线/PCI与PCIe/06-配置空间与枚举.md',
     '地址空间与枚举: 08-总线协议/高速外设扩展总线/PCI与PCIe/06-地址空间与枚举.md'),
    
    # 09: 错误处理与AER -> 高级错误报告AER
    ('错误处理与AER: 08-总线协议/高速外设扩展总线/PCI与PCIe/09-错误处理与AER.md',
     '高级错误报告AER: 08-总线协议/高速外设扩展总线/PCI与PCIe/09-高级错误报告AER.md'),
    
    # 11: 实战：NVMe驱动分析 -> 实战NVMe与嵌入式存储
    ('实战：NVMe驱动分析: 08-总线协议/高速外设扩展总线/PCI与PCIe/11-实战：NVMe驱动分析.md',
     '实战NVMe与嵌入式存储: 08-总线协议/高速外设扩展总线/PCI与PCIe/11-实战NVMe与嵌入式存储.md'),
    
    # 13: 前沿趋势：CXL与PCIe6.0 -> 前沿趋势CXL与PCIe6.0
    ('前沿趋势：CXL与PCIe6.0: 08-总线协议/高速外设扩展总线/PCI与PCIe/13-前沿趋势：CXL与PCIe6.0.md',
     '前沿趋势CXL与PCIe6.0: 08-总线协议/高速外设扩展总线/PCI与PCIe/13-前沿趋势CXL与PCIe6.0.md'),
]

made_changes = False
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        print(f'Replaced nav: {old} -> {new}')
        made_changes = True
    else:
        print(f'WARNING: Could not find in nav: {old}')

if made_changes:
    with open(mkdocs_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('\nmkdocs.yml updated successfully.')
else:
    print('\nNo changes made to mkdocs.yml!')

# 3. 验证剩余文件
print('\n--- Remaining files in PCIe dir ---')
for f in sorted(os.listdir(pcie_dir)):
    size = os.path.getsize(os.path.join(pcie_dir, f))
    print(f'{size:>6}  {f}')
