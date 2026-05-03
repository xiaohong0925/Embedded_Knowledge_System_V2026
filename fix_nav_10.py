import os

base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
part_dir = os.path.join(base_dir, '10-专用技术与前沿趋势')

# Collect actual files
nav_entries = []

# README
readme_path = os.path.join(part_dir, 'README.md')
if os.path.exists(readme_path):
    nav_entries.append(('概览', '10-专用技术与前沿趋势/README.md'))

# Walk subdirectories
for subdir in sorted(os.listdir(part_dir)):
    subpath = os.path.join(part_dir, subdir)
    if not os.path.isdir(subpath):
        continue
    
    md_files = [f for f in os.listdir(subpath) if f.endswith('.md')]
    md_files.sort()
    
    if not md_files:
        continue
    
    # Group entries
    file_entries = []
    for f in md_files:
        # Remove .md extension for display
        display = f[:-3]
        rel_path = '10-专用技术与前沿趋势/%s/%s' % (subdir, f)
        file_entries.append((display, rel_path))
    
    nav_entries.append((subdir, file_entries))

# Build YAML block
yaml_lines = ['\n', '  - 10. 专用技术与前沿趋势:\n']
for entry in nav_entries:
    if isinstance(entry[1], str):
        # Single file entry like ('概览', 'path')
        yaml_lines.append('      - %s: %s\n' % (entry[0], entry[1]))
    else:
        # Directory with multiple files
        yaml_lines.append('      - %s:\n' % entry[0])
        for display, path in entry[1]:
            yaml_lines.append('          - %s: %s\n' % (display, path))

# Append to mkdocs.yml
with open(os.path.join(base_dir, '..', 'mkdocs.yml'), 'a', encoding='utf-8') as f:
    f.writelines(yaml_lines)

print('Added 10-专用技术与前沿趋势 nav with real filenames:')
for line in yaml_lines:
    print(line.rstrip())
