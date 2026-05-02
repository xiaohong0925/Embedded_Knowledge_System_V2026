import os

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'
print('Docs directory files:')
for f in sorted(os.listdir(base)):
    print(f'  {f}')

site_base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\site\03-Linux内核深度解析\05-驱动模型'
print('\nSite directory files:')
for f in sorted(os.listdir(site_base)):
    print(f'  {f}')
    
# Check if 06 HTML exists
html_path = os.path.join(site_base, '06-驱动模型历史演进与生态', 'index.html')
print(f'\nHTML file exists: {os.path.exists(html_path)}')
