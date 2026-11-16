from pathlib import Path

root = Path(r"E:\HongWork\MySelf\MyKnowledge\Embedded_Knowledge_System_V2026")
for bundle in (root / 'site' / 'assets' / 'javascripts').glob('bundle.*.min.js'):
    text = bundle.read_text(encoding='utf-8')
    needle = 'md-nav__link--active'
    positions = []
    start = 0
    while True:
        index = text.find(needle, start)
        if index == -1:
            break
        positions.append(index)
        start = index + len(needle)
    print(bundle.name, len(positions))
    for i, index in enumerate(positions):
        (root / 'tmp' / 'review' / f'material-active-{i}.txt').write_text(
            text[max(0, index - 1800):index + 1800], encoding='utf-8'
        )
        print(i, index)
