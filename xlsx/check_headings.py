import os

def check_headings(base):
    for f in sorted(os.listdir(base)):
        if not f.endswith('.md'):
            continue
        path = os.path.join(base, f)
        with open(path, 'r', encoding='utf-8') as fh:
            lines = fh.readlines()
        
        # Check first non-empty line
        first_line = ''
        for line in lines:
            if line.strip():
                first_line = line.strip()
                break
        
        if first_line == '#':
            print(f"{f}: EMPTY H1 heading!")
        elif not first_line.startswith('# '):
            print(f"{f}: First line is not H1: {first_line[:50]}")
        else:
            print(f"{f}: OK - {first_line[:60]}")

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'
check_headings(base)
