import openpyxl
import re

def clean_text(text):
    """Clean text from xlsx - remove <br> tags, normalize newlines"""
    if not text:
        return ""
    text = str(text)
    # Replace <br> variants with actual newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    # Normalize multiple newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Remove trailing whitespace
    text = text.strip()
    return text

def split_into_short_paragraphs(text, max_lines=4):
    """Split long text into short paragraphs (D2L style)"""
    if not text:
        return ""
    
    paragraphs = []
    current_para = []
    current_line_count = 0
    
    lines = text.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            if current_para:
                paragraphs.append('\n'.join(current_para))
                current_para = []
                current_line_count = 0
            continue
        
        # Check if this line starts a list item
        if re.match(r'^\d+\.\s+', line) or line.startswith('- ') or line.startswith('* '):
            if current_para:
                paragraphs.append('\n'.join(current_para))
                current_para = []
                current_line_count = 0
            paragraphs.append(line)
            continue
        
        # Check if adding this line would exceed max_lines
        if current_line_count >= max_lines:
            paragraphs.append('\n'.join(current_para))
            current_para = [line]
            current_line_count = 1
        else:
            current_para.append(line)
            current_line_count += 1
    
    if current_para:
        paragraphs.append('\n'.join(current_para))
    
    return '\n\n'.join(paragraphs)

def format_content(text):
    """Format content following D2L style"""
    text = clean_text(text)
    text = split_into_short_paragraphs(text)
    return text

def write_markdown_file(filepath, title, sections):
    """Write a markdown file with proper structure"""
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(f"# {title}\n\n")
        
        for section in sections:
            section_title = section.get('title', '')
            section_level = section.get('level', 2)
            content = section.get('content', '')
            subsections = section.get('subsections', [])
            
            if section_title:
                f.write(f"{'#' * section_level} {section_title}\n\n")
            
            if content:
                f.write(format_content(content))
                f.write("\n\n")
            
            for sub in subsections:
                sub_title = sub.get('title', '')
                sub_content = sub.get('content', '')
                sub_level = sub.get('level', 3)
                
                if sub_title:
                    f.write(f"{'#' * sub_level} {sub_title}\n\n")
                
                if sub_content:
                    f.write(format_content(sub_content))
                    f.write("\n\n")

def parse_xlsx_to_files(xlsx_path, output_dir):
    """Parse xlsx and generate 6 markdown files"""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb['驱动模型']
    
    rows = list(ws.iter_rows(min_row=1, max_row=263, values_only=True))
    
    # Define file boundaries based on Col0 section headers
    file_boundaries = [
        (4, 37, "01-驱动模型基础认知.md", "1. 驱动模型基础认知 [B→I]"),
        (38, 91, "02-核心驱动模型原理解析.md", "2. 核心驱动模型原理解析 [I→E]"),
        (92, 155, "03-驱动开发核心技术教学.md", "3. 驱动开发核心技术教学 [I→E]"),
        (156, 207, "04-软硬件实战场景.md", "4. 软硬件实战场景 [B→E]"),
        (208, 243, "05-驱动模型进阶与优化.md", "5. 驱动模型进阶与优化 [E→M]"),
        (244, 258, "06-驱动模型历史演进与生态.md", "6. 驱动模型历史演进与生态 [I→E]"),
    ]
    
    for start_row, end_row, filename, title in file_boundaries:
        sections = []
        current_section = None
        current_subsection = None
        
        for row_idx in range(start_row - 1, end_row):  # 0-based indexing
            row = rows[row_idx]
            col0 = str(row[0]) if row[0] else ""
            col2 = str(row[2]) if row[2] else ""
            col9 = str(row[9]) if row[9] else ""
            col11 = str(row[11]) if row[11] else ""
            
            # Determine content column
            content = col9 if col9 else (col11 if col11 else "")
            content = clean_text(content)
            
            # Skip empty rows
            if not col0 and not col2 and not content:
                continue
            
            # Check if Col0 is a major section header (ends with [B→I] etc. or is just a title)
            if col0 and not col2 and not content:
                # Major section header
                if current_section:
                    sections.append(current_section)
                current_section = {
                    'title': col0,
                    'level': 2,
                    'content': '',
                    'subsections': []
                }
                current_subsection = None
            
            # Check if Col0 is a subsection header
            elif col0 and (col2 or content):
                # Subsection with title in Col0 and content in Col2/Col9
                if current_subsection:
                    current_section['subsections'].append(current_subsection)
                
                combined_content = col2 + "\n\n" + content if col2 and content else (col2 or content)
                current_subsection = {
                    'title': col0,
                    'level': 3,
                    'content': combined_content
                }
            
            # Check if Col2 is a topic title with Col9/Col11 content
            elif col2 and content:
                # Topic with title in Col2 and content in Col9/Col11
                if current_subsection:
                    current_section['subsections'].append(current_subsection)
                
                current_subsection = {
                    'title': col2,
                    'level': 4,
                    'content': content
                }
            
            # Content-only rows (continuation of previous topic)
            elif content and current_subsection:
                if current_subsection['content']:
                    current_subsection['content'] += "\n\n" + content
                else:
                    current_subsection['content'] = content
            
            # Col2-only rows (titles without content - might be section headers)
            elif col2 and not content:
                if current_subsection:
                    current_section['subsections'].append(current_subsection)
                current_subsection = {
                    'title': col2,
                    'level': 4,
                    'content': ''
                }
        
        # Don't forget the last subsection
        if current_subsection and current_subsection.get('content'):
            if current_section:
                current_section['subsections'].append(current_subsection)
        
        if current_section:
            sections.append(current_section)
        
        # Write the file
        filepath = f"{output_dir}/{filename}"
        write_markdown_file(filepath, title, sections)
        print(f"Written: {filename} ({len(sections)} sections)")

if __name__ == '__main__':
    xlsx_path = r'C:\Users\15314\.openclaw\workspace\downloads\19de3995-86a2-8846-8000-00004ea5fac3_Linux知识体系.xlsx'
    output_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'
    parse_xlsx_to_files(xlsx_path, output_dir)
    print("Done!")
