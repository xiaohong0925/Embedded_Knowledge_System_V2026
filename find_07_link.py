import re

with open('docs/index.md', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Find all references to 07-应用层
idx = content.find('07-')
if idx != -1:
    # Show context around first match
    start = max(0, idx - 50)
    end = min(len(content), idx + 50)
    print('First match context:')
    print(content[start:end])
    print()
    
# Count occurrences
print('Count of 07- references:', content.count('07-应用层'))

# Find exact line
lines = content.split('\n')
for i, line in enumerate(lines):
    if '07-应用层' in line:
        print('Line %d: %s' % (i+1, line))
