import os
import re

def find_driver_model_files(base_path):
    """Find all markdown files in the driver model section"""
    dm_files = []
    for root, dirs, files in os.walk(base_path):
        # Check if this is the driver model directory
        for f in files:
            if f.endswith('.md'):
                path = os.path.join(root, f)
                dm_files.append(path)
    return dm_files

def check_file(filepath):
    """Check a markdown file for formatting issues"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    issues = []
    lines = content.split('\n')
    
    in_code_block = False
    code_fence_lang = None
    
    for i, line in enumerate(lines, 1):
        # Track code block state
        fence_match = re.match(r'^(\s*)```(\w*)', line)
        if fence_match:
            if not in_code_block:
                in_code_block = True
                code_fence_lang = fence_match.group(2)
            else:
                in_code_block = False
                code_fence_lang = None
            continue
        
        # Check for <br> tags
        if '<br>' in line or '<br/>' in line or '<br />' in line:
            if in_code_block:
                issues.append(f"Line {i}: <br> in code block (will render as plain text)")
            else:
                issues.append(f"Line {i}: <br> outside code block")
        
        # Check for <span> tags in code blocks
        if in_code_block and '<span' in line:
            issues.append(f"Line {i}: <span> tag in code block (will NOT render colors)")
        
        # Check for <span> tags outside code blocks (might be OK with md_in_html)
        if not in_code_block and '<span' in line:
            # In tables, <span> might break table rendering
            if '|' in line:
                issues.append(f"Line {i}: <span> in table row (may break table parsing)")
        
        # Check for broken table rows (lines with | but inconsistent column counts)
        if not in_code_block and '|' in line and not line.strip().startswith('#') and not line.strip().startswith('>'):
            # This might be a table row - we'll just note it
            pass
    
    return issues

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    
    # Find driver model files by walking the tree
    all_files = []
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.md'):
                path = os.path.join(root, f)
                # Check if path contains 驱动模型 or 驱动
                if '驱动' in path or 'driver' in path.lower():
                    all_files.append(path)
    
    print(f"Found {len(all_files)} driver-model related files:\n")
    
    for path in sorted(all_files):
        size = os.path.getsize(path)
        print(f"\n{'='*60}")
        print(f"File: {path}")
        print(f"Size: {size:,} bytes")
        print(f"{'='*60}")
        
        issues = check_file(path)
        if issues:
            print(f"\nIssues found ({len(issues)}):")
            for issue in issues[:20]:  # Limit output
                print(f"  - {issue}")
            if len(issues) > 20:
                print(f"  ... and {len(issues) - 20} more issues")
        else:
            print("\nNo issues found")

if __name__ == '__main__':
    main()
