"""Sample a reference video into a style contact sheet for LLM vision.

Produces:
  <edit>/style_ref/
    frames/frame_NNN.jpg
    contact_sheet.jpg
    style_brief.md   ← template the agent fills after looking at frames
    meta.json

Usage:
    python helpers/analyze_style.py <reference.mp4> --edit-dir <edit>
    python helpers/analyze_style.py <reference.mp4> --edit-dir <edit> --n 12
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def ffprobe_meta(video: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,codec_name",
        "-show_entries", "format=duration,size",
        "-of", "json",
        str(video),
    ]
    out = subprocess.check_output(cmd, text=True)
    data = json.loads(out)
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    dur = float(fmt.get("duration") or 0)
    return {
        "path": str(video.resolve()),
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "fps": stream.get("r_frame_rate"),
        "codec": stream.get("codec_name"),
        "duration_s": dur,
        "size_bytes": int(float(fmt.get("size") or 0)),
    }


def sample_frames(video: Path, out_dir: Path, n: int, duration: float) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    if duration <= 0:
        duration = 10.0
    # skip first/last 5%
    t0, t1 = duration * 0.05, duration * 0.95
    if t1 <= t0:
        t0, t1 = 0.0, max(duration, 1.0)
    times = [t0 + (t1 - t0) * i / max(n - 1, 1) for i in range(n)]
    paths: list[Path] = []
    for i, t in enumerate(times):
        p = out_dir / f"frame_{i:03d}_{t:06.2f}s.jpg"
        cmd = [
            "ffmpeg", "-y", "-ss", f"{t:.3f}", "-i", str(video),
            "-frames:v", "1", "-q:v", "2", str(p),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        paths.append(p)
    return paths


def contact_sheet(frames: list[Path], out: Path, cols: int = 4) -> None:
    from PIL import Image

    if not frames:
        return
    imgs = [Image.open(p).convert("RGB") for p in frames]
    w, h = imgs[0].size
    # uniform thumbnail
    tw = 480
    th = int(h * (tw / w))
    thumbs = [im.resize((tw, th), Image.Resampling.LANCZOS) for im in imgs]
    cols = min(cols, len(thumbs))
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), (20, 20, 20))
    for i, im in enumerate(thumbs):
        r, c = divmod(i, cols)
        sheet.paste(im, (c * tw, r * th))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=90)


BRIEF_TEMPLATE = """# Style brief (fill after viewing frames)

Reference: `{name}`
Duration: {duration:.1f}s · {width}x{height}

## Layout zones
- Top: (title bar / stickers / none?)
- Middle: (speaker / B-roll?)
- Bottom: (caption position, height from bottom)

## Subtitles
- Color / outline / shadow:
- Font feel (sans heavy / rounded / handwritten):
- Chunking (word / short phrase / sentence):
- Case / emphasis (keywords color?):
- Motion in/out (pop / fade / slide / typewriter):

## Top / upper overlays
- What appears above the subject:
- Timing (always / on beats / on keywords):

## Other FX
- Stickers, arrows, emoji, progress bars, split text:
- Grade / contrast / vignette:

## Palette (hex if possible)
- Primary text:
- Keyword:
- Outline:
- Accent:

## Motion language (1–3 rules)
1.
2.
3.

## Machine profile path
Write concrete values into `edit/style_profile.yaml` (copy from `styles/ma_dage.yaml` and patch).
"""


def main() -> None:
    ap = argparse.ArgumentParser(description="Sample reference video for style reverse-engineering")
    ap.add_argument("reference", type=Path, help="Reference video path")
    ap.add_argument("--edit-dir", type=Path, required=True)
    ap.add_argument("--n", type=int, default=12, help="Number of sample frames")
    ap.add_argument("--cols", type=int, default=4)
    args = ap.parse_args()

    ref = args.reference.resolve()
    if not ref.exists():
        sys.exit(f"not found: {ref}")

    edit = args.edit_dir.resolve()
    style_dir = edit / "style_ref"
    frames_dir = style_dir / "frames"

    meta = ffprobe_meta(ref)
    frames = sample_frames(ref, frames_dir, args.n, meta["duration_s"])
    sheet = style_dir / "contact_sheet.jpg"
    contact_sheet(frames, sheet, cols=args.cols)

    brief = style_dir / "style_brief.md"
    brief.write_text(
        BRIEF_TEMPLATE.format(
            name=ref.name,
            duration=meta["duration_s"],
            width=meta["width"],
            height=meta["height"],
        ),
        encoding="utf-8",
    )
    (style_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"style_ref → {style_dir}")
    print(f"  frames: {len(frames)}")
    print(f"  contact_sheet: {sheet.name}")
    print(f"  style_brief: {brief.name}")
    print("Next: open contact_sheet + frames, fill style_brief, write edit/style_profile.yaml")


if __name__ == "__main__":
    main()
