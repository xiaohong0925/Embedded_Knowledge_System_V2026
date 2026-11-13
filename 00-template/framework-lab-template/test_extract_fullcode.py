import tempfile
import unittest
from pathlib import Path

from extract_fullcode import build_entry, extract_function


SOURCE = """/* leading comment */
int first(int value)
{
    if (value) {
        return 1; /* } inside comment */
    }
    return 0;
}

/* keep this line between functions */
static int second(void)
{
    const char *text = "}";
    return text[0];
}
"""


class ExtractorTests(unittest.TestCase):
    def test_function_start_and_nested_braces(self):
        first = extract_function(SOURCE, "first")
        second = extract_function(SOURCE, "second")
        self.assertEqual(first["startLine"], 2)
        self.assertTrue(first["code"].endswith("\n}"))
        self.assertEqual(second["startLine"], 11)
        self.assertIn('"}"', second["code"])

    def test_multiple_functions_keep_continuous_source(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "sample.c").write_text(SOURCE, encoding="utf-8")
            entry = build_entry(root, "pair", {
                "source": "sample.c",
                "displayPath": "sample.c",
                "functions": ["first", "second"],
            })
        self.assertEqual(entry["startLine"], 2)
        self.assertIn("keep this line between functions", entry["code"])
        self.assertTrue(entry["code"].endswith("\n}"))

    def test_out_of_order_functions_are_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "sample.c").write_text(SOURCE, encoding="utf-8")
            with self.assertRaises(RuntimeError):
                build_entry(root, "pair", {
                    "source": "sample.c",
                    "displayPath": "sample.c",
                    "functions": ["second", "first"],
                })


if __name__ == "__main__":
    unittest.main()
