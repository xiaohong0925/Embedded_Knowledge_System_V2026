import openpyxl
import re
import os

def clean_text(text):
    if not text:
        return ""
    text = str(text)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    return text

def get_content(row):
    """Get content from all possible content columns (8, 9, 10, 11)"""
    contents = []
    for col_idx in [8, 9, 10, 11]:
        if col_idx < len(row) and row[col_idx]:
            text = clean_text(row[col_idx])
            if text:
                contents.append(text)
    return '\n\n'.join(contents) if contents else ""

def split_into_paragraphs(text, max_lines=4):
    if not text:
        return ""
    paragraphs = []
    current = []
    count = 0
    
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            if current:
                paragraphs.append('\n'.join(current))
                current = []
                count = 0
            continue
        if re.match(r'^\d+\.\s+', line) or line.startswith('- ') or line.startswith('* '):
            if current:
                paragraphs.append('\n'.join(current))
                current = []
                count = 0
            paragraphs.append(line)
            continue
        if count >= max_lines:
            paragraphs.append('\n'.join(current))
            current = [line]
            count = 1
        else:
            current.append(line)
            count += 1
    
    if current:
        paragraphs.append('\n'.join(current))
    
    return '\n\n'.join(paragraphs)

def format_content(text):
    text = clean_text(text)
    text = split_into_paragraphs(text)
    return text

def write_file(filepath, title, sections):
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(f"# {title}\n\n")
        for section in sections:
            title_text = section.get('title', '')
            level = section.get('level', 2)
            content = section.get('content', '')
            subs = section.get('subsections', [])
            
            if title_text:
                f.write(f"{'#' * level} {title_text}\n\n")
            if content:
                f.write(format_content(content))
                f.write("\n\n")
            
            for sub in subs:
                st = sub.get('title', '')
                sc = sub.get('content', '')
                sl = sub.get('level', 3)
                if st:
                    f.write(f"{'#' * sl} {st}\n\n")
                if sc:
                    f.write(format_content(sc))
                    f.write("\n\n")

def parse_and_generate(xlsx_path, output_dir):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb['驱动模型']
    rows = list(ws.iter_rows(min_row=1, max_row=263, values_only=True))
    
    boundaries = [
        (4, 37, "01-驱动模型基础认知.md", "1. 驱动模型基础认知 [B→I]"),
        (38, 91, "02-核心驱动模型原理解析.md", "2. 核心驱动模型原理解析 [I→E]"),
        (92, 155, "03-驱动开发核心技术教学.md", "3. 驱动开发核心技术教学 [I→E]"),
        (156, 207, "04-软硬件实战场景.md", "4. 软硬件实战场景 [B→E]"),
        (208, 243, "05-驱动模型进阶与优化.md", "5. 驱动模型进阶与优化 [E→M]"),
        (244, 258, "06-驱动模型历史演进与生态.md", "6. 驱动模型历史演进与生态 [I→E]"),
    ]
    
    for start, end, filename, title in boundaries:
        sections = []
        current_section = None
        current_subsection = None
        
        for row_idx in range(start - 1, end):
            row = rows[row_idx]
            col0 = str(row[0]).strip() if row[0] else ""
            col2 = str(row[2]).strip() if row[2] else ""
            content = get_content(row)
            
            if not col0 and not col2 and not content:
                continue
            
            # Major section header: Col0 with [B→I] etc., no Col2, no content
            if col0 and re.search(r'\[[BIE]→[IEM]\]', col0) and not col2 and not content:
                if current_section:
                    sections.append(current_section)
                current_section = {'title': col0, 'level': 2, 'content': '', 'subsections': []}
                current_subsection = None
            
            # Subsection header: Col0 without [B→I], might have Col2 as intro or content
            elif col0 and not re.search(r'\[[BIE]→[IEM]\]', col0):
                # Check if Col2 is a topic title or intro text
                if current_subsection and (current_subsection.get('content') or current_subsection.get('title')):
                    current_section['subsections'].append(current_subsection)
                
                # If Col2 is short and looks like a title, it's a topic
                # If Col2 is long, it's intro text for the subsection
                intro_text = ""
                if col2:
                    if len(col2) < 50 and not col2.endswith('。') and not col2.endswith('：'):
                        # Likely a topic title - store separately
                        current_subsection = {'title': col0, 'level': 3, 'content': '', 'subsections': []}
                        # Create a sub-topic for col2
                        sub_topic = {'title': col2, 'level': 4, 'content': content}
                        current_section['subsections'].append(sub_topic)
                        current_subsection = None
                        continue
                    else:
                        intro_text = col2
                
                combined = (intro_text + "\n\n" + content).strip() if intro_text and content else (intro_text or content)
                current_subsection = {'title': col0, 'level': 3, 'content': combined}
            
            # Topic: Col2 with content
            elif col2 and content:
                if current_subsection:
                    current_section['subsections'].append(current_subsection)
                current_subsection = {'title': col2, 'level': 4, 'content': content}
            
            # Col2-only: title without content
            elif col2 and not content:
                if current_subsection:
                    current_section['subsections'].append(current_subsection)
                current_subsection = {'title': col2, 'level': 4, 'content': ''}
            
            # Content-only: continuation
            elif content and current_subsection:
                if current_subsection['content']:
                    current_subsection['content'] += "\n\n" + content
                else:
                    current_subsection['content'] = content
        
        if current_subsection and current_subsection.get('content'):
            if current_section:
                current_section['subsections'].append(current_subsection)
        if current_section:
            sections.append(current_section)
        
        filepath = os.path.join(output_dir, filename)
        write_file(filepath, title, sections)
        total_size = os.path.getsize(filepath)
        print(f"Written: {filename} ({len(sections)} sections, {total_size} bytes)")

if __name__ == '__main__':
    xlsx_path = r'C:\Users\15314\.openclaw\workspace\downloads\19de3995-86a2-8846-8000-00004ea5fac3_Linux知识体系.xlsx'
    output_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'
    parse_and_generate(xlsx_path, output_dir)
    print("Done!")
