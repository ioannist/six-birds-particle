#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$repo_root" python3 - <<'PY'
from __future__ import annotations

from dataclasses import dataclass
import fnmatch
import json
import os
import pathlib
import zipfile

root = pathlib.Path(os.environ["REPO_ROOT"]).resolve()
repo_name = root.name
version_file = root / ".package-repo-snapshot-version"
config_path = root / ".package-repo-snapshot.json"

if not config_path.exists():
    raise SystemExit("Missing .package-repo-snapshot.json; configure allowed roots first.")

raw_config = json.loads(config_path.read_text(encoding="utf-8"))
if not isinstance(raw_config, dict):
    raise SystemExit("Invalid .package-repo-snapshot.json: expected a JSON object.")

allowed_roots_cfg = raw_config.get("allowed_roots", {})
allowed_root_files = set(raw_config.get("allowed_root_files", []))
excluded_dirs = set(
    raw_config.get(
        "exclude_dirs",
        [
            ".git",
            ".lake",
            ".venv",
            "venv",
            "__pycache__",
            ".mypy_cache",
            ".pytest_cache",
            ".ruff_cache",
        ],
    )
)

if not isinstance(allowed_roots_cfg, dict) or not allowed_roots_cfg:
    raise SystemExit("Invalid .package-repo-snapshot.json: allowed_roots must be a non-empty object.")

allowed_roots = [root / name for name in allowed_roots_cfg.keys()]

current_version = -1
if version_file.exists():
    raw = version_file.read_text(encoding="utf-8").strip()
    if raw.isdigit():
        current_version = int(raw)

next_version = current_version + 1
suffix = os.environ.get("SNAPSHOT_SUFFIX", "").strip()
if suffix and not suffix.startswith("_"):
    suffix = f"_{suffix}"
zip_path = root / f"{repo_name}_snapshot_v{next_version}{suffix}.zip"

@dataclass(frozen=True)
class IgnoreRule:
    base: pathlib.Path
    pattern: str
    negated: bool
    anchored: bool
    dir_only: bool


def _parse_gitignore(path: pathlib.Path) -> list[IgnoreRule]:
    rules: list[IgnoreRule] = []
    if not path.exists():
        return rules
    base = path.parent
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(r"\#") or line.startswith(r"\!"):
            line = line[1:]
        negated = line.startswith("!")
        if negated:
            line = line[1:]
        anchored = line.startswith("/")
        if anchored:
            line = line[1:]
        dir_only = line.endswith("/")
        if dir_only:
            line = line[:-1]
        if not line:
            continue
        rules.append(
            IgnoreRule(
                base=base,
                pattern=line,
                negated=negated,
                anchored=anchored,
                dir_only=dir_only,
            )
        )
    return rules


def _match_rule(rule: IgnoreRule, rel_posix: str, is_dir: bool) -> bool:
    if rule.dir_only and not is_dir:
        # Directory rules apply to directories and their contents.
        parts = rel_posix.split("/")
        for i in range(1, len(parts) + 1):
            prefix = "/".join(parts[:i])
            if _match_rule(
                IgnoreRule(
                    base=rule.base,
                    pattern=rule.pattern,
                    negated=rule.negated,
                    anchored=rule.anchored,
                    dir_only=False,
                ),
                prefix,
                is_dir=True,
            ):
                return True
        return False
    if rule.anchored:
        return fnmatch.fnmatchcase(rel_posix, rule.pattern)
    if "/" in rule.pattern:
        return fnmatch.fnmatchcase(rel_posix, rule.pattern)
    return fnmatch.fnmatchcase(pathlib.PurePosixPath(rel_posix).name, rule.pattern)


def _collect_rules(root_path: pathlib.Path) -> list[IgnoreRule]:
    rules: list[IgnoreRule] = []
    rules.append(
        IgnoreRule(
            base=root_path,
            pattern=".git",
            negated=False,
            anchored=False,
            dir_only=True,
        )
    )
    rules.append(
        IgnoreRule(
            base=root_path,
            pattern="*_snapshot.zip",
            negated=False,
            anchored=False,
            dir_only=False,
        )
    )
    rules.append(
        IgnoreRule(
            base=root_path,
            pattern="*_snapshot_v*.zip",
            negated=False,
            anchored=False,
            dir_only=False,
        )
    )
    for dirpath, dirnames, filenames in os.walk(root_path):
        if ".git" in dirnames:
            dirnames.remove(".git")
        ignore_path = pathlib.Path(dirpath) / ".gitignore"
        if ignore_path.exists():
            rules.extend(_parse_gitignore(ignore_path))
    return rules


def _is_ignored(path: pathlib.Path, rules: list[IgnoreRule]) -> bool:
    rel_posix = path.relative_to(root).as_posix()
    ignored = False
    for rule in rules:
        try:
            rel_to_rule = path.relative_to(rule.base).as_posix()
        except ValueError:
            continue
        if _match_rule(rule, rel_to_rule, path.is_dir()):
            ignored = not rule.negated
    return ignored


def _is_allowed(path: pathlib.Path) -> bool:
    rel = path.relative_to(root)
    if not rel.parts:
        return False
    top = rel.parts[0]
    cfg = allowed_roots_cfg.get(top)
    if not isinstance(cfg, dict):
        return False
    allowed_exts = set(cfg.get("extensions", []))
    allowed_names = set(cfg.get("filenames", []))
    if path.name in allowed_names:
        return True
    return path.suffix in allowed_exts


rules = _collect_rules(root)
files: list[pathlib.Path] = []
for base in allowed_roots:
    if not base.exists():
        continue
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in excluded_dirs]
        for filename in filenames:
            path = pathlib.Path(dirpath) / filename
            if not path.exists():
                continue
            if not _is_allowed(path):
                continue
            if _is_ignored(path, rules):
                continue
            files.append(path)

for name in allowed_root_files:
    path = root / name
    if path.exists() and not _is_ignored(path, rules):
        files.append(path)

if not files:
    raise SystemExit("No files to package (all files ignored).")

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for path in files:
        rel = path.relative_to(root).as_posix()
        zf.write(path, rel)

version_file.write_text(str(next_version), encoding="utf-8")
previous_path = None
if current_version >= 0:
    previous_path = root / f"{repo_name}_snapshot_v{current_version}.zip"
if previous_path and previous_path.exists():
    previous_path.unlink()

for path in root.glob(f"{repo_name}_snapshot_v*.zip"):
    if path == zip_path:
        continue
    if path.exists():
        path.unlink()

print(f"Wrote {zip_path}")
PY
