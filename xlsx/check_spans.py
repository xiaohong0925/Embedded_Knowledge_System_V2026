import os
import re

def find_remaining_spans(filepath):
    """Find all remaining <span> tags in a file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find all <span occurrences
    matches = []
    for m in re.finditer(r'<span[^>]*>', content):
        start = max(0, m.start() - 50)
        end = min(len(content), m.end() + 100)
        context = content[start:end]
        matches.append(context)
    
    return matches

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    
    # Find all driver model files
    target_files = []
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.md'):
                path = os.path.join(root, f)
                # Include all files in the driver model directory
                if '05-' in path or ('驱动' in f or 'driver' in f.lower() or '实战' in f or '历史' in f or '进阶' in f):
                    target_files.append(path)
    
    for path in sorted(target_files):
        print(f"\n=== {os.path.basename(path)} ===")
        spans = find_remaining_spans(path)
        if spans:
            for i, span in enumerate(spans[:5]):
                print(f"  Span {i+1}: ...{span}...")
        else:
            print("  No remaining spans")

if __name__ == '__main__':
    main()
