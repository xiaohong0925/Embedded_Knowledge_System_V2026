import os

# 获取确切路径
mdio04 = None
for root, dirs, files in os.walk('docs/08-总线协议/基础外设通信总线/MDIO'):
    for f in files:
        if '04' in f:
            mdio04 = os.path.join(root, f)
            break

i3c04 = None
for root, dirs, files in os.walk('docs/08-总线协议/基础外设通信总线/MIPI-I3C'):
    for f in files:
        if '04' in f:
            i3c04 = os.path.join(root, f)
            break

print('mdio04:', mdio04)
print('i3c04:', i3c04)

# 从 batch_write_2.py 提取内容
with open('batch_write_2.py', 'rb') as fh:
    script = fh.read().decode('utf-8')

# 提取 content4
marker4 = 'content4 = """'
start4 = script.find(marker4) + len(marker4)
end4 = script.find('"""\n\n# ========== 文件5')
content4 = script[start4:end4]

# 提取 content6
marker6 = 'content6 = """'
start6 = script.find(marker6) + len(marker6)
end6 = script.find('"""\n\n# ========== 文件7')
content6 = script[start6:end6]

print('content4 len:', len(content4))
print('content6 len:', len(content6))

# 写入
for path, content in [(mdio04, content4), (i3c04, content6)]:
    if path:
        with open(path, 'wb') as f:
            f.write(content.encode('utf-8'))
        size = os.path.getsize(path)
        print(f'Wrote {size} bytes -> {path}')
    else:
        print('PATH NOT FOUND')
