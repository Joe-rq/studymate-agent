#!/usr/bin/env python3
"""Validate agent-skill packages against the Agent Skills / SCP SKILL.md format.

The competition's official quick_validate.py ships inside the login-only
developer resource pack; this script implements the same checks so they can
run offline at any time:

  1. <skill>/SKILL.md exists
  2. YAML frontmatter parses and has non-empty `name` and `description`
  3. `name` matches the directory name, is <= 64 chars, and is lowercase
     alphanumeric with hyphens (underscores tolerated: upstream SCP skills
     use them)
  4. `description` is <= 1024 chars
  5. no leftover TODO/FIXME/placeholder markers
  6. relative file references inside SKILL.md resolve on disk
  7. every other *.yaml/*.yml in the package parses
  8. reports SKILL.md line count (recommended < 500)

Usage:
    python scripts/validate_skill.py [skill_dir ...]   # default: skills/*/
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
PLACEHOLDER_RE = re.compile(r"\b(TODO|FIXME|XXX|<your[_ -]?(key|name)[^>]*>)\b", re.IGNORECASE)
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
RELREF_RE = re.compile(r"\]\((\.{1,2}/[^)#\s]+|[^:/)#\s]+\.(?:md|png|jpg|jpeg|json|ya?ml))")


def validate(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"missing {skill_md}"]

    text = skill_md.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(text)
    if not m:
        return ["SKILL.md has no YAML frontmatter delimited by leading --- blocks"]

    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        return [f"frontmatter is not valid YAML: {exc}"]

    name = meta.get("name")
    description = meta.get("description")
    if not name or not isinstance(name, str):
        errors.append("frontmatter `name` is missing or empty")
        name = ""
    if not description or not isinstance(description, str):
        errors.append("frontmatter `description` is missing or empty")
        description = ""

    if name:
        if name != skill_dir.name:
            errors.append(f"name {name!r} != directory name {skill_dir.name!r}")
        if len(name) > 64:
            errors.append(f"name is {len(name)} chars (max 64)")
        if not NAME_RE.match(name):
            errors.append("name must be lowercase alphanumeric with hyphens")
    if description and len(description) > 1024:
        errors.append(f"description is {len(description)} chars (max 1024)")

    for hit in PLACEHOLDER_RE.finditer(text):
        errors.append(f"unresolved placeholder/token: {hit.group(0)!r} (line {text.count(chr(10), 0, hit.start()) + 1})")

    for ref in RELREF_RE.findall(text):
        if not (skill_dir / ref).exists() and not (skill_dir.parent / ref).exists():
            errors.append(f"referenced local file not found: {ref}")

    for extra in skill_dir.rglob("*"):
        if extra.suffix.lower() in (".yaml", ".yml") and extra.is_file():
            try:
                yaml.safe_load(extra.read_text(encoding="utf-8"))
            except yaml.YAMLError as exc:
                errors.append(f"{extra.relative_to(skill_dir)} is not valid YAML: {exc}")

    lines = text.count("\n") + 1
    print(f"  {skill_md}: {lines} lines, name={name!r}, description={len(description)} chars")
    if lines > 500:
        errors.append(f"SKILL.md is {lines} lines (recommended max 500)")
    return errors


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parents[1]
    targets = [Path(a) for a in argv[1:]] or sorted(p for p in (root / "skills").iterdir() if p.is_dir())
    if not targets:
        print("no skill directories found under skills/")
        return 1

    failed = False
    for skill_dir in targets:
        print(f"[validate] {skill_dir}")
        errors = validate(skill_dir)
        for err in errors:
            print(f"  ERROR: {err}")
        if errors:
            failed = True
        else:
            print("  OK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
