"""Extract a grayscale person matte video (white=person) via rembg u2net_human_seg.

Usage:
    python helpers/person_matte.py <video> -o <matte.mp4>
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def run_matte(src: Path, dest: Path, grow: int = 11, work_w: int = 384) -> Path:
    from rembg import new_session, remove

    dest.parent.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        sys.exit(f"cannot open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sess = new_session("u2net_human_seg")
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow))
    work_h = max(64, int(h * work_w / max(w, 1)))

    with tempfile.TemporaryDirectory() as tmp:
        tmpd = Path(tmp)
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            small = Image.fromarray(rgb).resize((work_w, work_h), Image.BILINEAR)
            mask_img = remove(small, session=sess, only_mask=True).convert("L")
            mask_img = mask_img.resize((w, h), Image.BILINEAR)
            m = np.array(mask_img)
            _, m = cv2.threshold(m, 90, 255, cv2.THRESH_BINARY)
            m = cv2.dilate(m, kernel, iterations=1)
            m = cv2.GaussianBlur(m, (0, 0), 2.6)
            cv2.imwrite(str(tmpd / f"m{i:06d}.png"), m)
            i += 1
            if i % 30 == 0:
                print(f"  matte {i}", flush=True)
        cap.release()
        print(f"matte frames {i} → encode")
        cmd = [
            "ffmpeg", "-y",
            "-framerate", f"{fps:.3f}",
            "-i", str(tmpd / "m%06d.png"),
            "-c:v", "libx264", "-pix_fmt", "gray",
            "-preset", "ultrafast", "-crf", "16",
            str(dest),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("-o", "--output", type=Path, required=True)
    args = ap.parse_args()
    run_matte(args.video.resolve(), args.output.resolve())
    print("wrote", args.output)


if __name__ == "__main__":
    main()
