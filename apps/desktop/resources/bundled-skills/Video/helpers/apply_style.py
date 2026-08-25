"""One-shot style replication: reference analysis (optional) + kinetic burn on source.

Usage:
    # with local reference video
    python helpers/apply_style.py \\
        --source 1.mp4 --reference ref.mp4 --edit-dir edit \\
        --title "现在是一个好的时代吗？" --style styles/ma_dage.yaml

    # without reference (use style profile only)
    python helpers/apply_style.py \\
        --source 1.mp4 --edit-dir edit \\
        --title "现在是一个好的时代吗？" --style styles/ma_dage.yaml --keywords "时代,好时代"
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> None:
    print("$", " ".join(str(c) for c in cmd[:8]), "…" if len(cmd) > 8 else "")
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Apply style-mimic pipeline to a source video")
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--reference", type=Path, default=None, help="Optional style reference video")
    ap.add_argument("--edit-dir", type=Path, required=True)
    ap.add_argument("--style", type=Path, required=True, help="Base style yaml/json")
    ap.add_argument("--title", type=str, default="")
    ap.add_argument("--keywords", type=str, default="")
    ap.add_argument("--language", type=str, default="zh")
    ap.add_argument("--model", type=str, default="tiny")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--max-duration", type=float, default=0)
    ap.add_argument("--skip-transcribe", action="store_true")
    args = ap.parse_args()

    helpers = Path(__file__).resolve().parent
    source = args.source.resolve()
    edit = args.edit_dir.resolve()
    edit.mkdir(parents=True, exist_ok=True)
    style = args.style.resolve()

    if args.reference and args.reference.exists():
        run([
            sys.executable, str(helpers / "analyze_style.py"),
            str(args.reference.resolve()),
            "--edit-dir", str(edit),
        ])
        print("Reference sampled. Agent should refine edit/style_profile.yaml if needed.")
    else:
        print("No reference video — using style profile as-is.")

    # copy style into edit
    dest_style = edit / "style_profile.yaml"
    dest_style.write_text(style.read_text(encoding="utf-8"), encoding="utf-8")

    job = {
        "title": args.title,
        "keywords": [k.strip() for k in args.keywords.split(",") if k.strip()],
        "source": str(source),
        "style": str(dest_style),
    }
    (edit / "style_job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    tr_path = edit / "transcripts" / f"{source.stem}.json"
    if not args.skip_transcribe and not tr_path.exists():
        run([
            sys.executable, str(helpers / "transcribe.py"),
            str(source),
            "--edit-dir", str(edit),
            "--language", args.language,
            "--model", args.model,
        ])
    elif tr_path.exists():
        print(f"cached transcript: {tr_path}")
    else:
        sys.exit(f"missing transcript: {tr_path}")

    cmd = [
        sys.executable, str(helpers / "render_kinetic.py"),
        "--video", str(source),
        "--transcript", str(tr_path),
        "--style", str(dest_style),
        "--edit-dir", str(edit),
        "--job", str(edit / "style_job.json"),
        "--fps", str(args.fps),
        "--burn",
    ]
    if args.max_duration:
        cmd += ["--max-duration", str(args.max_duration)]
    run(cmd)
    print("done →", edit / "final.mp4")


if __name__ == "__main__":
    main()
