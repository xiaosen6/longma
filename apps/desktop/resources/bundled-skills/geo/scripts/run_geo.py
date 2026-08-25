#!/usr/bin/env python3
"""Run geo-optimizer-skill CLI without requiring a global install.

Tries, in order: `geo` on PATH, then `uvx --from geo-optimizer-skill geo`.
Usage: python run_geo.py audit --url https://example.com
"""
from __future__ import annotations

import shutil
import subprocess
import sys


def main() -> int:
    args = sys.argv[1:]
    geo = shutil.which("geo")
    if geo:
        return subprocess.call([geo, *args])

    uvx = shutil.which("uvx")
    if uvx:
        return subprocess.call([uvx, "--from", "geo-optimizer-skill", "geo", *args])

    uv = shutil.which("uv")
    if uv:
        return subprocess.call(
            [uv, "tool", "run", "--from", "geo-optimizer-skill", "geo", *args]
        )

    sys.stderr.write(
        "GEO CLI not found.\n"
        "Install uv from https://docs.astral.sh/uv/ then retry, or run:\n"
        "  pip install geo-optimizer-skill\n"
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
