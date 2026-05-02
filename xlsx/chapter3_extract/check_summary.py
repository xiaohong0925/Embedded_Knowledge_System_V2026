import json

with open(r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\xlsx\chapter3_extract\chapter3_complete_v2.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Check interrupt subsystem (sheet 18)
for sheet in data['sheets']:
    if '中断' in sheet['sheet_label'] or sheet['sheet_index'] == 18:
        print(f"Sheet: {sheet['sheet_label']} (idx {sheet['sheet_index']})")
        print(f"  H1 sections: {len(sheet['structure'])}")
        total_content = 0
        for h1 in sheet['structure']:
            h2_count = len(h1.get('children', []))
            fc_count = len(h1.get('floating_content', []))
            content_len = sum(
                sum(len(v) for v in h2.get('content', {}).values())
                for h2 in h1.get('children', [])
            )
            total_content += content_len
            print(f"    H1: {h1['title'][:40]} | H2: {h2_count} | floating: {fc_count} | content: {content_len}")
        print(f"  Total content chars: {total_content}")
        break

# Overall stats
print("\n=== ALL SHEETS ===")
for sheet in data['sheets']:
    total_h1 = len(sheet['structure'])
    total_h2 = sum(len(h1.get('children', [])) for h1 in sheet['structure'])
    total_chars = sum(
        sum(len(v) for v in h2.get('content', {}).values())
        for h1 in sheet['structure']
        for h2 in h1.get('children', [])
    )
    print(f"  {sheet['sheet_label']}: H1={total_h1}, H2={total_h2}, content_chars={total_chars}")
