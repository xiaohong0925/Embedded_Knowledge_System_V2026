import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from check_review import sha256, validate_record


class ReviewRecordTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root = Path(self.temporary.name)
        (self.root / "docs").mkdir()
        (self.root / "reviews" / "sections").mkdir(parents=True)
        (self.root / "docs" / "outline.md").write_text("outline\n", encoding="utf-8")
        (self.root / "docs" / "section.md").write_text("original\n", encoding="utf-8")
        (self.root / "agent.md").write_text("agent\n", encoding="utf-8")
        (self.root / "plan.md").write_text("plan\n", encoding="utf-8")
        self.record_path = self.root / "reviews" / "sections" / "demo.json"

    def tearDown(self):
        self.temporary.cleanup()

    def write_record(self, **changes):
        record = {
            "section": "DEMO",
            "article": "docs/section.md",
            "main_question": "临时样例怎样验证哈希？",
            "baseline": {
                "reviewed_at": "2026-11-09",
                "article_sha256": sha256(self.root / "docs" / "section.md"),
                "agent_sha256": sha256(self.root / "agent.md"),
                "plan_sha256": sha256(self.root / "plan.md"),
            },
            "scope": {
                "outlines": ["docs/outline.md"],
                "source_snapshots": [],
                "assets": [],
                "related_sections": [],
            },
            "reader_checks": {
                key: {"status": "pass", "evidence": "临时测试"}
                for key in ("dependency", "mainline", "blind_delete", "follow")
            },
            "verification": {
                "strict_build": {
                    "status": "pass",
                    "command": "python -m mkdocs build --strict",
                    "result": "临时测试",
                },
                "browser": {"status": "not_applicable", "result": ""},
                "teaching_code": {
                    "compile": "not_verified",
                    "run": "not_verified",
                    "hardware": "not_verified",
                    "note": "未验证不等于失败",
                },
            },
            "open_issues": [],
            "next_action": "",
        }
        record.update(changes)
        self.record_path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        return record

    def test_current_record_and_unverified_code_are_valid(self):
        self.write_record()
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "current")
        self.assertEqual(result["errors"], [])
        self.assertEqual(len(result["checked_hashes"]), 3)

    def test_article_change_marks_record_stale(self):
        self.write_record()
        (self.root / "docs" / "section.md").write_text("changed\n", encoding="utf-8")
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "stale")
        self.assertIn("article 已在验收基线后变化", result["stale_reasons"])

    def test_rule_changes_mark_record_stale(self):
        for name in ("agent.md", "plan.md"):
            with self.subTest(name=name):
                self.write_record()
                (self.root / name).write_text("changed\n", encoding="utf-8")
                result = validate_record(self.record_path, self.root)
                self.assertEqual(result["record_state"], "stale")
                self.assertIn(f"{name} 已在验收基线后变化", result["stale_reasons"])
                (self.root / name).write_text(name.replace(".md", "\n"), encoding="utf-8")

    def test_missing_scope_file_is_invalid(self):
        record = self.write_record()
        record["scope"]["outlines"] = ["docs/missing.md"]
        self.record_path.write_text(json.dumps(record), encoding="utf-8")
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "invalid")
        self.assertTrue(any("不存在" in error for error in result["errors"]))

    def test_path_escape_is_invalid(self):
        record = self.write_record()
        record["article"] = "../outside.md"
        self.record_path.write_text(json.dumps(record), encoding="utf-8")
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "invalid")
        self.assertTrue(any("越出项目根目录" in error for error in result["errors"]))

    def test_unknown_status_is_invalid(self):
        record = self.write_record()
        record["reader_checks"]["follow"]["status"] = "probably"
        self.record_path.write_text(json.dumps(record), encoding="utf-8")
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "invalid")
        self.assertTrue(any("status 非法" in error for error in result["errors"]))

    def test_not_verified_reader_checks_do_not_fake_quality_pass(self):
        record = self.write_record()
        for item in record["reader_checks"].values():
            item["status"] = "not_verified"
            item["evidence"] = ""
        record["verification"]["strict_build"]["status"] = "not_verified"
        self.record_path.write_text(json.dumps(record), encoding="utf-8")
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "current")
        self.assertNotIn("quality_passed", result)

    def test_malformed_json_is_invalid(self):
        self.record_path.write_text("{broken", encoding="utf-8")
        result = validate_record(self.record_path, self.root)
        self.assertEqual(result["record_state"], "invalid")
        self.assertTrue(any("无法读取 JSON" in error for error in result["errors"]))

    def test_real_cli_exit_codes(self):
        command = [
            sys.executable,
            str(Path(__file__).with_name("check_review.py")),
            str(self.record_path),
            "--root",
            str(self.root),
        ]
        self.write_record()
        current = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=False)
        self.assertEqual(current.returncode, 0, current.stdout + current.stderr)
        self.assertEqual(json.loads(current.stdout)["record_state"], "current")

        (self.root / "docs" / "section.md").write_text("changed\n", encoding="utf-8")
        stale = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=False)
        self.assertEqual(stale.returncode, 1, stale.stdout + stale.stderr)
        self.assertEqual(json.loads(stale.stdout)["record_state"], "stale")

        self.record_path.write_text("{broken", encoding="utf-8")
        invalid = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=False)
        self.assertEqual(invalid.returncode, 2, invalid.stdout + invalid.stderr)
        self.assertEqual(json.loads(invalid.stdout)["record_state"], "invalid")


class ProjectRoutingFileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.skill = (cls.root / ".agents" / "skills" / "embedded-book-authoring" / "SKILL.md").read_text(encoding="utf-8")

    def test_skill_frontmatter_has_only_name_and_description(self):
        self.assertTrue(self.skill.startswith("---\n"))
        frontmatter = self.skill.split("---", 2)[1]
        keys = [
            line.split(":", 1)[0]
            for line in frontmatter.splitlines()
            if line and not line.startswith((" ", "\t"))
        ]
        self.assertEqual(keys, ["name", "description"])
        self.assertIn("name: embedded-book-authoring", frontmatter)
        self.assertIn("新写正文", frontmatter)
        self.assertIn("Framework Lab", frontmatter)

    def test_conditional_reference_files_exist(self):
        references = [
            "agent.md",
            "plan.md",
            "docs/00-模板/全书框架设计学习整理_v1.md",
            "docs/00-模板/扩展篇设计大纲_v1.md",
            "docs/00-模板/总线协议_2026深度调研与写作大纲_v3.md",
            "docs/00-模板/B-B.3_I2C章级整改复盘与复用经验.md",
            "docs/00-模板/framework-lab-template/README.md",
            "docs/00-模板/section-review.template.json",
            "tools/check_review.py",
        ]
        for reference in references:
            with self.subTest(reference=reference):
                self.assertIn(reference, self.skill)
                self.assertTrue((self.root / reference).is_file())

    def test_agent_owns_all_five_impact_levels(self):
        agent = (self.root / "agent.md").read_text(encoding="utf-8")
        self.assertIn("## 13. 修改影响面与验收基线", agent)
        for level in ("T0 机械修改", "T1 局部正文", "T2 单章重构", "T3 跨章调整", "T4 共享变化"):
            self.assertIn(level, agent)
        self.assertIn("`.agents/skills/embedded-book-authoring/SKILL.md` 只负责按本节路由", agent)

    def test_blank_template_is_json_and_preserves_unverified_boundaries(self):
        template = json.loads((self.root / "docs" / "00-模板" / "section-review.template.json").read_text(encoding="utf-8"))
        self.assertEqual(template["verification"]["browser"]["status"], "not_applicable")
        for key in ("compile", "run", "hardware"):
            self.assertEqual(template["verification"]["teaching_code"][key], "not_verified")
        self.assertIn("mkdocs build --strict", template["verification"]["strict_build"]["command"])

    def test_skill_bounds_reads_and_deduplicates_sources(self):
        for phrase in (
            "只读当前章节及直接关联区间",
            "不得通读整份内核源码",
            "不得同时通读",
            "证据路径、函数名和必要行号区间",
        ):
            self.assertIn(phrase, self.skill)

    def test_skill_has_context_checkpoint_and_reuses_confirmed_diagnosis(self):
        self.assertIn("不重复全量诊断", self.skill)
        self.assertIn("超过 60% 上下文", self.skill)
        self.assertIn("换新会话重写", self.skill)
        self.assertIn("不得编造上下文百分比", self.skill)

    def test_skill_separates_rules_reviewed_patterns_and_design_intent(self):
        for phrase in (
            "A：现行规则",
            "B：人工验证经验",
            "C：设计意图参考",
            "D：历史查询",
            "AI 自评 `pass` 不足以升级",
            "数量配额",
            "不得作为验收依据",
        ):
            self.assertIn(phrase, self.skill)

    def test_skill_prioritizes_human_reviewed_i2c_experience(self):
        self.assertIn("B-B.3 必读", self.skill)
        self.assertIn("优先作为人工验证正例", self.skill)
        self.assertIn("继承自 v2 的旧格式要求同样无效", self.skill)

    def test_bus_outline_does_not_inherit_obsolete_acceptance_rules(self):
        outline = (self.root / "docs" / "00-模板" / "总线协议_2026深度调研与写作大纲_v3.md").read_text(encoding="utf-8")
        for phrase in (
            "v2 第 3.2 节不再整体继承",
            "历史质量评价",
            "不得作为当前完成状态",
            "固定栏目、数量配额、勾选式自查",
            "`reviews/sections/`",
            "人工复检",
        ):
            self.assertIn(phrase, outline)


if __name__ == "__main__":
    unittest.main()
