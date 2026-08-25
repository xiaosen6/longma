#!/usr/bin/env python3
"""Write a Douyin SMS code to <sau-home>/verify_code.txt."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("usage: write_verify_code.py <code> [sau-home]", file=sys.stderr)
        return 1

    code = sys.argv[1].strip()
    home = Path(sys.argv[2]).expanduser().resolve() if len(sys.argv) > 2 else Path.cwd()
    if not home.is_dir():
        print(f"sau-home is not a directory: {home}", file=sys.stderr)
        return 1

    path = home / "verify_code.txt"
    path.write_text(code + "\n", encoding="utf-8")
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
