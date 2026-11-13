"""Static B-B.3.5 article checks; does not compile C/DTB or access hardware."""
import re
import subprocess
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
ARTICLE = HERE.parents[1] / "B-B.3.5_实战AT24C02_EEPROM端到端读写.md"


class ArticleAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = ARTICLE.read_text(encoding="utf-8")

    def test_relative_markdown_files_exist(self):
        targets = re.findall(r"\]\((\./[^)]+)\)", self.text)
        self.assertEqual(len(targets), 9)
        missing = []
        for target in targets:
            clean = target.split("#", 1)[0]
            if not (ARTICLE.parent / clean).resolve().exists():
                missing.append(target)
        self.assertEqual(missing, [], f"missing local links: {missing}")

    def test_iframe_resolves_from_rendered_article_directory(self):
        sources = re.findall(r'<iframe\s+src="([^"]+)"', self.text)
        self.assertEqual(sources, ["../html/at24-lab.html"])
        rendered_directory = ARTICLE.parent / ARTICLE.stem
        for source in sources:
            self.assertTrue((rendered_directory / source).resolve().is_file(), source)

    def test_product_experiment_bash_syntax(self):
        match = re.search(
            r'```bash title="产品路径完整实验；任一硬检查失败即停止"\n(.*?)```',
            self.text,
            re.S,
        )
        self.assertIsNotNone(match)
        result = subprocess.run(
            ["bash", "-n"],
            input=match.group(1),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_expected_outputs_are_not_claimed_as_hardware_results(self):
        self.assertIn("预期示例，不是实测记录", self.text)
        self.assertIn("未上板读写 EEPROM", self.text)
        self.assertIn("不是 EEPROM 硬件仿真", self.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
