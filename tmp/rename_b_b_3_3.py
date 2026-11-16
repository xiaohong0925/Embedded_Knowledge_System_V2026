from pathlib import Path

root = Path(r"E:\HongWork\MySelf\MyKnowledge\Embedded_Knowledge_System_V2026")
base = root / 'docs' / 'B. 总线协议' / 'B. 低速外设接口'
mapping = {
    'B-B.3.3_I2C Linux驱动框架_启动建链.md': 'B-B.3.3_I2C Linux驱动框架_startup.md',
    'B-B.3.3_I2C Linux驱动框架_运行传输.md': 'B-B.3.3_I2C Linux驱动框架_transfer.md',
    'B-B.3.3_I2C Linux驱动框架_用户态入口.md': 'B-B.3.3_I2C Linux驱动框架_userspace.md',
    'B-B.3.3_I2C Linux驱动框架_替换控制器.md': 'B-B.3.3_I2C Linux驱动框架_gpio.md',
}
for old_name, new_name in mapping.items():
    (base / old_name).rename(base / new_name)

for path in (root / 'docs').rglob('*.md'):
    text = path.read_text(encoding='utf-8')
    updated = text
    for old_name, new_name in mapping.items():
        updated = updated.replace(old_name, new_name)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

nav_path = root / 'mkdocs.yml'
nav = nav_path.read_text(encoding='utf-8')
for old_name, new_name in mapping.items():
    nav = nav.replace(old_name, new_name)
nav_path.write_text(nav, encoding='utf-8')
