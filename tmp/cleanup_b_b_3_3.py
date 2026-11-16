from pathlib import Path

base = Path(r"E:\HongWork\MySelf\MyKnowledge\Embedded_Knowledge_System_V2026\docs\B. 总线协议\B. 低速外设接口")
paths = list(base.glob('B-B.3.3_I2C Linux驱动框架*.md'))
for path in paths:
    text = path.read_text(encoding='utf-8')
    while '\n---\n\n---\n' in text:
        text = text.replace('\n---\n\n---\n', '\n---\n')
    path.write_text(text, encoding='utf-8')

overview_path = base / 'B-B.3.3_I2C Linux驱动框架.md'
overview = overview_path.read_text(encoding='utf-8')
overview = overview.replace(' | 预计阅读时间：60 分钟', '')
lab = '[在新窗口打开 I2C Framework Lab](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。实验室中的步骤是依据 v6.6 源码构造的模型推演，不连接真实硬件。'
legacy = '[在新窗口打开 I2C Framework Lab](./html/i2c-framework-lab.html){: target="_blank" rel="noopener noreferrer" }。实验室中的步骤是依据 v6.6 源码构造的模型推演，不连接真实硬件。'
overview = overview.replace(lab + '\n\n' + legacy, lab)
overview = overview.replace(
    '下一节再展开它们的字段和所有权',
    '[启动建链](B-B.3.3_I2C Linux驱动框架_启动建链.md)再展开它们的字段和所有权'
)
overview_path.write_text(overview, encoding='utf-8')

transfer_path = base / 'B-B.3.3_I2C Linux驱动框架_运行传输.md'
transfer = transfer_path.read_text(encoding='utf-8')
start = transfer.index('<div class="interactive-demo">')
end = transfer.index('</div>', start) + len('</div>')
transfer = transfer[:start] + transfer[end:].lstrip('\n')
transfer_path.write_text(transfer, encoding='utf-8')
