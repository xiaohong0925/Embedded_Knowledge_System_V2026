import os
import re

bases = [
    'docs/08-总线协议/第三部分-存储设备专用总线',
    'docs/08-总线协议/第四部分-车载与网络互联总线',
    'docs/08-总线协议/第五部分-工业现场总线',
]

files = []
for base in bases:
    for root, dirs, filenames in os.walk(base):
        for f in filenames:
            if f.endswith('.md') and f != 'README.md':
                files.append(os.path.join(root, f))

out_lines = [f"Total files: {len(files)}", ""]

code_comment_files = []

for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 5. Code block comments - more thorough check
    # Find all ```c / ```cpp / ```bash blocks
    code_pattern = r'```(?:c|cpp|bash)\n([\s\S]*?)```'
    code_blocks = re.findall(code_pattern, content)
    
    for idx, block in enumerate(code_blocks):
        lines = block.strip().split('\n')
        if len(lines) > 3:
            first_line = lines[0].strip()
            # Check if first non-empty line is a comment
            is_comment = False
            for l in lines:
                lstrip = l.strip()
                if lstrip:
                    if lstrip.startswith('//') or lstrip.startswith('#') or lstrip.startswith('/*') or lstrip.startswith('*'):
                        is_comment = True
                    break
            if not is_comment:
                code_comment_files.append((fp, idx, lines[0][:60]))

if code_comment_files:
    print("Files with code blocks needing comments:")
    for fp, idx, first_line in code_comment_files:
        rel = os.path.relpath(fp)
        print(f"  {rel} block#{idx}: {first_line}")
else:
    print("No code blocks need comment headers.")
