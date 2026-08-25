#!/usr/bin/env python3
"""Print the newest login QR image under cookies/ or ./qrcode.png."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    roots = [Path.cwd()]
    if len(sys.argv) > 1:
        roots.insert(0, Path(sys.argv[1]).expanduser().resolve())

    candidates: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        if root in seen or not root.is_dir():
            continue
        seen.add(root)
        cookies = root / "cookies"
        if cookies.is_dir():
            candidates.extend(cookies.glob("*login_qrcode*.png"))
        qrcode = root / "qrcode.png"
        if qrcode.is_file():
            candidates.append(qrcode)

    if not candidates:
        return 1

    newest = max(candidates, key=lambda path: path.stat().st_mtime)
    print(newest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
