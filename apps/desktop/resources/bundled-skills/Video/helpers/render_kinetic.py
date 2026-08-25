"""Render kinetic Chinese subtitles + top overlays as a transparent WebM/MOV track.

Reads:
  - style_profile.yaml (or .json)
  - transcript JSON (Whisper word-level)
  - optional style_job.json: { "title": "...", "keywords": ["..."], "ranges": optional }

Writes:
  - <edit>/animations/kinetic/overlay.webm  (yuva420p / vp9 if available, else png seq + mov)
  - <edit>/animations/kinetic/cues.json
  - optionally burns onto source via --burn

Usage:
    python helpers/render_kinetic.py \\
        --video source.mp4 \\
        --transcript edit/transcripts/1.json \\
        --style styles/ma_dage.yaml \\
        --edit-dir edit \\
        --burn
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

# Optional YAML
try:
    import yaml  # type: ignore
except Exception:
    yaml = None


def load_profile(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        if yaml is None:
            # minimal fallback: only support JSON if no yaml
            sys.exit("PyYAML not installed. pip install pyyaml  OR pass a .json profile")
        return yaml.safe_load(text)
    return json.loads(text)


def probe_wh(video: Path) -> tuple[int, int, float]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "json", str(video),
    ]
    data = json.loads(subprocess.check_output(cmd, text=True))
    st = (data.get("streams") or [{}])[0]
    dur = float((data.get("format") or {}).get("duration") or 0)
    return int(st["width"]), int(st["height"]), dur


def fit_source_to_canvas(src: Path, dest: Path, cw: int, ch: int, bias_x: float = 0.6) -> Path:
    """Cover-crop source into cw×ch (portrait social). bias_x 0=left 1=right."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    # scale to cover, then crop with horizontal bias
    vf = (
        f"scale={cw}:{ch}:force_original_aspect_ratio=increase,"
        f"crop={cw}:{ch}:(in_w-{cw})*{bias_x}:(in_h-{ch})/2"
    )
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", vf,
        "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(dest),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return dest


def resolve_font(preferred: str | None = None) -> str:
    """Pick a CJK font. Prefer Windows 微软雅黑 Bold to match 硅谷101-class subtitles."""
    candidates: list[Path] = []
    if preferred:
        candidates.append(Path(preferred))
    candidates.extend([
        # Closest to common CN documentary / 硅谷101 burned-in captions
        Path("/mnt/c/Windows/Fonts/msyhbd.ttc"),       # Microsoft YaHei Bold
        Path("/mnt/c/Windows/Fonts/msyh.ttc"),         # Microsoft YaHei
        Path("/mnt/c/Windows/Fonts/HarmonyOS_Sans_SC_Bold.ttf"),
        Path("/mnt/c/Windows/Fonts/simhei.ttf"),
        Path("/mnt/c/Windows/Fonts/PingFang Medium.ttf"),
        Path("/mnt/c/Windows/Fonts/MiSans-Regular.ttf"),
        Path("/mnt/c/Windows/Fonts/Alibaba-PuHuiTi-Regular.otf"),
        Path("/mnt/c/Windows/Fonts/Dengb.ttf"),
        Path("/home/sun/.local/share/fonts/whitepaper/NotoSansSC-Medium.otf"),
        Path("/home/sun/.local/share/fonts/whitepaper/NotoSansSC-Regular.otf"),
        Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
    ])
    for p in candidates:
        if p.exists():
            return str(p)
    sys.exit("No CJK font found. Install Microsoft YaHei or Noto Sans CJK.")


def hex_to_rgba(h: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = h.strip().lstrip("#")
    if len(h) == 8:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16)
    if len(h) == 6:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha
    raise ValueError(h)


def ease_out_cubic(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def words_only(transcript: dict) -> list[dict]:
    out = []
    for w in transcript.get("words") or []:
        if w.get("type", "word") != "word":
            continue
        text = (w.get("text") or "").strip()
        if not text:
            continue
        out.append({
            "text": text,
            "start": float(w["start"]),
            "end": float(w["end"]),
        })
    return out


_PUNCT = set("，。！？、；：,.!?;:…—-~·\"'「」『』【】（）()[]")


def chunk_phrases(words: list[dict], max_chars: int, mode: str) -> list[dict]:
    """Group words into subtitle cues."""
    if not words:
        return []
    cues: list[dict] = []
    buf: list[dict] = []
    char_count = 0

    def flush() -> None:
        nonlocal buf, char_count
        if not buf:
            return
        text = "".join(w["text"] for w in buf)
        # Chinese often has no spaces; keep as-is. For Latin join with space.
        if any(ord(c) < 128 and c.isalpha() for c in text):
            text = " ".join(w["text"] for w in buf)
        text = re.sub(r"\s+", " ", text).strip()
        cues.append({
            "text": text,
            "start": buf[0]["start"],
            "end": buf[-1]["end"],
            "words": buf,
        })
        buf = []
        char_count = 0

    for w in words:
        t = w["text"]
        buf.append(w)
        char_count += len(t)
        end_punct = t[-1] in _PUNCT if t else False
        if mode == "punct" and end_punct:
            flush()
        elif char_count >= max_chars or end_punct:
            flush()
    flush()
    return cues


def pick_keywords(cues: list[dict], explicit: list[str] | None, limit: int = 8) -> list[str]:
    # explicit=[] means "no keywords"; only auto-pick when explicit is None
    if explicit is not None:
        return [k for k in explicit if k]
    from collections import Counter
    toks: list[str] = []
    for c in cues:
        parts = re.split(r"[，。！？、；：\s]+", c["text"])
        for p in parts:
            p = p.strip()
            if 2 <= len(p) <= 6 and re.search(r"[\u4e00-\u9fff]", p):
                toks.append(p)
    common = [w for w, _ in Counter(toks).most_common(limit * 2)]
    common.sort(key=lambda s: (-len(s), s))
    return common[:limit]


def insert_phrase_spaces(text: str) -> str:
    """Insert spaces between short sense groups like 硅谷101: '这么多钱 都花哪去了'.

    Only break *before* conjunction/particle starts a new group, never mid-word.
    """
    if not text or " " in text:
        return text
    # break BEFORE these when buffer already has enough chars
    lead = set("就都也还要能会在和与及对把被让从比那这可但而")
    out: list[str] = []
    buf = ""
    for i, ch in enumerate(text):
        if buf and len(buf) >= 5 and ch in lead:
            out.append(buf)
            buf = ch
        else:
            buf += ch
            if len(buf) >= 9:
                out.append(buf)
                buf = ""
    if buf:
        out.append(buf)
    return " ".join(out) if len(out) > 1 else text


def mark_keywords(text: str, keywords: list[str]) -> list[tuple[str, bool]]:
    """Split text into (segment, is_keyword) spans. Greedy longest-match."""
    if not keywords:
        return [(text, False)]
    kws = sorted(set(keywords), key=len, reverse=True)
    spans: list[tuple[str, bool]] = []
    i = 0
    while i < len(text):
        hit = None
        for k in kws:
            if text.startswith(k, i):
                hit = k
                break
        if hit:
            spans.append((hit, True))
            i += len(hit)
        else:
            # extend plain run
            j = i + 1
            while j < len(text):
                if any(text.startswith(k, j) for k in kws):
                    break
                j += 1
            spans.append((text[i:j], False))
            i = j
    return spans


def draw_text_with_outline(draw, xy, text, font, fill, outline, outline_w, shadow=None):
    """Hard circular outline (legacy). Prefer draw_text_stroke_soft for 硅谷101-class subs."""
    x, y = xy
    if shadow:
        sx, sy, sc = shadow
        draw.text((x + sx, y + sy), text, font=font, fill=sc)
    for dx in range(-outline_w, outline_w + 1):
        for dy in range(-outline_w, outline_w + 1):
            if dx == 0 and dy == 0:
                continue
            if dx * dx + dy * dy > outline_w * outline_w:
                continue
            draw.text((x + dx, y + dy), text, font=font, fill=outline)
    draw.text((x, y), text, font=font, fill=fill)


def draw_text_stroke_soft(
    base_img,
    xy: tuple[int, int],
    text: str,
    font,
    fill=(255, 255, 255, 255),
    outline_rgb=(0, 0, 0),
    outline_w: int = 6,
    soft: float = 1.6,
    letter_spacing: float = 0.0,
):
    """Reference-style caption: thick black stroke + soft outer edge + white fill.

    Matches 硅谷101 burned-in look (white face, heavy black rim, slight soft halo).
    """
    from PIL import Image, ImageDraw, ImageFilter

    if not text:
        return
    x, y = xy
    # Measure
    tmp = Image.new("RGBA", (8, 8))
    td = ImageDraw.Draw(tmp)
    if letter_spacing > 0:
        tw = 0
        th = 0
        for ch in text:
            bb = td.textbbox((0, 0), ch, font=font)
            tw += bb[2] - bb[0] + letter_spacing
            th = max(th, bb[3] - bb[1])
        tw = int(tw - letter_spacing)
    else:
        bb = td.textbbox((0, 0), text, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]

    pad = outline_w * 3 + 8
    layer = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ox, oy = pad, pad

    def _draw_str(dr, pos, col):
        px, py = pos
        if letter_spacing <= 0:
            dr.text((px, py), text, font=font, fill=col)
            return
        cx = px
        for ch in text:
            dr.text((cx, py), ch, font=font, fill=col)
            bb = dr.textbbox((cx, py), ch, font=font)
            cx = bb[2] + letter_spacing

    # 1) Soft outer halo (blurred black)
    halo = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    _draw_str(hd, (ox, oy), (*outline_rgb, 255))
    # dilate via multi-offset then blur
    halo2 = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    r = outline_w + 2
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            if dx * dx + dy * dy > r * r:
                continue
            halo2.alpha_composite(halo, (dx, dy))
    blur_r = max(1, int(soft * 2))
    halo2 = halo2.filter(ImageFilter.GaussianBlur(radius=blur_r))
    # tone down halo
    hr, hg, hb, ha = halo2.split()
    ha = ha.point(lambda a: int(a * 0.85))
    halo2 = Image.merge("RGBA", (hr, hg, hb, ha))
    layer.alpha_composite(halo2)

    # 2) Hard thick rim
    for dx in range(-outline_w, outline_w + 1):
        for dy in range(-outline_w, outline_w + 1):
            if dx == 0 and dy == 0:
                continue
            if dx * dx + dy * dy > outline_w * outline_w:
                continue
            _draw_str(ld, (ox + dx, oy + dy), (*outline_rgb, 255))

    # 3) White face
    _draw_str(ld, (ox, oy), fill if len(fill) == 4 else (*fill, 255))

    base_img.alpha_composite(layer, (int(x - pad), int(y - pad)))


def measure_text_width(draw, text: str, font, letter_spacing: float = 0.0) -> int:
    if not text:
        return 0
    if letter_spacing <= 0:
        bb = draw.textbbox((0, 0), text, font=font)
        return bb[2] - bb[0]
    w = 0
    for i, ch in enumerate(text):
        bb = draw.textbbox((0, 0), ch, font=font)
        w += bb[2] - bb[0]
        if i < len(text) - 1:
            w += letter_spacing
    return int(w)


def wrap_text(text: str, font, max_width: int, draw, letter_spacing: float = 0.0) -> list[str]:
    if not text:
        return []
    # char-based wrap for CJK
    lines: list[str] = []
    cur = ""
    for ch in text:
        trial = cur + ch
        tw = measure_text_width(draw, trial, font, letter_spacing)
        if tw <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def draw_text_tracked(
    draw,
    xy,
    text,
    font,
    fill,
    outline,
    outline_w,
    shadow=None,
    letter_spacing: float = 0.0,
    base_img=None,
    soft_stroke: bool = False,
    soft: float = 1.6,
):
    """Draw CJK text with optional tracking; soft_stroke matches reference captions."""
    if soft_stroke and base_img is not None:
        outline_rgb = outline[:3] if len(outline) >= 3 else (0, 0, 0)
        fill_rgba = fill if len(fill) == 4 else (*fill, 255)
        draw_text_stroke_soft(
            base_img, xy, text, font, fill_rgba, outline_rgb, outline_w, soft, letter_spacing
        )
        return
    x, y = xy
    if letter_spacing <= 0:
        draw_text_with_outline(draw, xy, text, font, fill, outline, outline_w, shadow)
        return
    cx = x
    for ch in text:
        draw_text_with_outline(draw, (cx, y), ch, font, fill, outline, outline_w, shadow)
        bb = draw.textbbox((cx, y), ch, font=font)
        cx = bb[2] + letter_spacing


def render_frame(
    w: int,
    h: int,
    t: float,
    cues: list[dict],
    profile: dict,
    title: str,
    font_path: str,
    keywords: list[str],
    chapters: list[str] | None = None,
    duration: float = 0.0,
    logo_text: str | None = None,
    giant_text: str | None = None,
):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    m = min(w, h)
    typo = profile.get("typography") or {}
    sub = profile.get("subtitle") or {}
    top = profile.get("top_overlay") or {}
    pal = profile.get("palette") or {}
    logo = profile.get("logo") or {}
    chap = profile.get("chapter_bar") or {}

    body_size = max(16, int(m * float(typo.get("body_size_ratio", 0.055))))
    kw_size = max(16, int(m * float(typo.get("keyword_size_ratio", 0.072))))
    top_size = max(14, int(m * float(typo.get("top_title_size_ratio", 0.048))))
    outline_w = max(1, int(m * float(typo.get("outline_px_ratio", 0.006))))
    tracking = float(typo.get("letter_spacing", 0))  # extra px between CJK chars

    def _load_font(path: str, size: int):
        # TTC (YaHei) uses index 0
        try:
            return ImageFont.truetype(path, size, index=0)
        except TypeError:
            return ImageFont.truetype(path, size)

    font_body = _load_font(font_path, body_size)
    font_kw = _load_font(font_path, kw_size)
    font_top = _load_font(font_path, top_size)
    font_logo = _load_font(font_path, max(12, int(m * 0.026)))
    font_chap = _load_font(font_path, max(11, int(m * 0.017)))

    fill = hex_to_rgba(pal.get("text", "#FFFFFF"))
    kw_fill = hex_to_rgba(pal.get("keyword", "#FFE500"))
    outline = hex_to_rgba(pal.get("outline", "#000000"))
    shadow = None
    if typo.get("shadow", True):
        off = typo.get("shadow_offset") or [2, 2]
        sc = hex_to_rgba(pal.get("outline", "#000000"), 170)
        shadow = (int(off[0]), int(off[1]), sc)

    placement = sub.get("placement", "lower_third")
    soft_stroke = bool(typo.get("soft_stroke", True))
    soft_amt = float(typo.get("soft_stroke_blur", 1.6))
    chapter_h = int(h * float(chap.get("height_pct", 0.035))) if chap.get("enabled") else 0
    bar_h = int(h * float(sub.get("bar_height_pct", 0.09))) if placement == "bottom_bar" else 0

    # --- chapter progress bar (bottom-most) ---
    if chap.get("enabled") and chapters:
        items = chapters
        cy = h - chapter_h
        draw.rectangle([0, cy, w, h], fill=hex_to_rgba(pal.get("chapter_bg", "#1A1A1AEE")))
        n = max(len(items), 1)
        slot_w = w / n
        # active chapter by time progress
        progress = (t / duration) if duration > 0 else 0.0
        active_i = min(n - 1, int(progress * n))
        for i, name in enumerate(items):
            x0 = int(i * slot_w)
            x1 = int((i + 1) * slot_w)
            col = hex_to_rgba(
                pal.get("chapter_active", "#FF6A00") if i == active_i else pal.get("chapter_idle", "#888888")
            )
            # active underline
            if i == active_i:
                draw.rectangle([x0, cy, x1, cy + max(3, chapter_h // 6)], fill=col)
            bb = draw.textbbox((0, 0), name, font=font_chap)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            tx = x0 + (x1 - x0 - tw) // 2
            ty = cy + (chapter_h - th) // 2 + 1
            draw.text((tx, ty), name, font=font_chap, fill=col)

    # --- bottom subtitle bar (silicon-valley style) ---
    if placement == "bottom_bar":
        by1 = h - chapter_h
        by0 = by1 - bar_h
        draw.rectangle([0, by0, w, by1], fill=hex_to_rgba(pal.get("bar_bg", "#2A2A2ACC")))

    # --- logo badge ---
    if logo.get("enabled", False):
        lt = logo_text if logo_text is not None else (logo.get("text") or "V")
        size = int(m * float(logo.get("size_pct", 0.085)))
        lx = int(w * float(logo.get("x_pct", 0.02)))
        # sit on subtitle bar
        ly = h - chapter_h - bar_h + max(4, (bar_h - size) // 2) if bar_h else int(
            h * (1.0 - float(logo.get("y_from_bottom_pct", 0.11))) - size
        )
        rad = int(m * float(logo.get("radius_pct", 0.012)))
        draw.rounded_rectangle(
            [lx, ly, lx + size, ly + size],
            radius=max(4, rad),
            fill=hex_to_rgba(pal.get("logo_bg", "#FF6A00")),
        )
        # multi-line logo text
        lines_l = lt.replace("\\n", "\n").split("\n")
        total = 0
        bbs = []
        for ln in lines_l:
            bb = draw.textbbox((0, 0), ln, font=font_logo)
            bbs.append(bb)
            total += bb[3] - bb[1] + 2
        yy = ly + (size - total) // 2
        for ln, bb in zip(lines_l, bbs):
            tw = bb[2] - bb[0]
            th = bb[3] - bb[1]
            draw.text(
                (lx + (size - tw) // 2, yy),
                ln,
                font=font_logo,
                fill=hex_to_rgba(pal.get("logo_text", "#FFFFFF")),
            )
            yy += th + 2

    # --- giant fixed type (童愈-style watermark) ---
    giant = profile.get("giant") or {}
    if giant.get("enabled"):
        gtext = giant_text or giant.get("text") or ""
        if gtext:
            gfont_path = giant.get("font_path") or font_path
            gsize = max(40, int(w * float(giant.get("size_ratio", 0.36))))
            try:
                gfont = ImageFont.truetype(gfont_path, gsize, index=0)
            except Exception:
                gfont = font_body
            gfill = hex_to_rgba(giant.get("fill", "#FFFFFF"), int(255 * float(giant.get("alpha", 0.92))))
            # measure and center
            gbb = draw.textbbox((0, 0), gtext, font=gfont)
            gw, gh = gbb[2] - gbb[0], gbb[3] - gbb[1]
            gx = (w - gw) // 2 + int(w * float(giant.get("x_shift_pct", 0.0)))
            gy = int(h * float(giant.get("y_pct", 0.16)))
            # thin dark edge so it reads on light bg
            g_outline = max(1, int(gsize * 0.012))
            draw_text_with_outline(
                draw, (gx, gy), gtext, gfont, gfill,
                (0, 0, 0, int(90 * float(giant.get("alpha", 0.92)))),
                g_outline,
            )

    # --- top-left identity card ---
    idc = profile.get("id_card") or {}
    if idc.get("enabled"):
        brand = str(idc.get("brand") or "")
        lines_id = list(idc.get("lines") or [])
        ix = int(w * float(idc.get("x_pct", 0.05)))
        iy = int(h * float(idc.get("y_pct", 0.035)))
        bsize = max(18, int(m * float(idc.get("brand_size_ratio", 0.055))))
        lsize = max(11, int(m * float(idc.get("line_size_ratio", 0.022))))
        bfont = _load_font(font_path, bsize)
        lfont = _load_font(font_path, lsize)
        # brand
        if brand:
            draw_text_with_outline(
                draw, (ix, iy), brand, bfont, fill, (0, 0, 0, 180), max(1, outline_w),
            )
            bb = draw.textbbox((ix, iy), brand, font=bfont)
            card_x = bb[2] + 10
        else:
            card_x = ix
        # credential box
        if lines_id:
            pad = 6
            line_h = lsize + 6
            box_w = max(draw.textbbox((0, 0), ln, font=lfont)[2] for ln in lines_id) + pad * 2
            box_h = line_h * len(lines_id) + pad
            box_fill = hex_to_rgba(idc.get("box_fill", "#00000099"))
            draw.rounded_rectangle(
                [card_x, iy + 4, card_x + box_w, iy + 4 + box_h],
                radius=4, fill=box_fill,
            )
            yy = iy + 4 + pad // 2
            for ln in lines_id:
                draw.text((card_x + pad, yy), ln, font=lfont, fill=(255, 255, 255, 230))
                yy += line_h

    # --- hook title (fixed large 2-line punch, 童愈 lower chest) ---
    hook = profile.get("hook") or {}
    hook_lines = list(hook.get("lines") or [])
    hook_until = float(hook.get("until_s", 1e9))
    show_hook = bool(hook.get("enabled") and hook_lines and t <= hook_until)
    if show_hook:
        hsize = max(22, int(m * float(hook.get("size_ratio", 0.062))))
        hfont = _load_font(font_path, hsize)
        h_outline = max(3, int(hsize * 0.10))
        gap = int(hsize * 0.18)
        widths, heights = [], []
        for ln in hook_lines:
            bb = draw.textbbox((0, 0), ln, font=hfont)
            widths.append(bb[2] - bb[0])
            heights.append(bb[3] - bb[1])
        hy = int(h * float(hook.get("y_pct", 0.62)))
        for ln, lw, lh in zip(hook_lines, widths, heights):
            hx = (w - lw) // 2
            draw_text_stroke_soft(
                img, (hx, hy), ln, hfont,
                fill=(255, 255, 255, 255),
                outline_rgb=(0, 0, 0),
                outline_w=h_outline,
                soft=1.4,
                letter_spacing=float(hook.get("letter_spacing", 0.5)),
            )
            hy += lh + gap
    # After hook leaves, drop speech captions to the hook's Y (they are now the bottom line)
    if (not show_hook) and hook.get("enabled") and hook.get("until_s") is not None:
        # y_from_bottom used later; stash on profile copy
        sub["y_from_bottom_pct"] = float(hook.get("caption_y_from_bottom", 0.38))

    # --- top overlay (optional title bar) ---
    if top.get("enabled", False) and title and top.get("mode") not in (None, "none"):
        tin = float(top.get("motion_in_s", 0.35))
        alpha_m = ease_out_cubic(min(1.0, t / tin)) if tin > 0 else 1.0
        y0 = int(h * float(top.get("y_from_top_pct", 0.08)))
        thb = int(h * float(top.get("bar_height_pct", 0.09)))
        bar_w = int(w * float(top.get("bar_width_pct", 0.92)))
        x0 = (w - bar_w) // 2
        bar_color = hex_to_rgba(pal.get("top_bar", pal.get("top_tag_bg", "#000000CC")))
        bar_color = (*bar_color[:3], int(bar_color[3] * alpha_m))
        yb = y0
        if top.get("mode") == "title_bar":
            draw.rounded_rectangle(
                [x0, yb, x0 + bar_w, yb + thb],
                radius=max(6, thb // 5),
                fill=bar_color,
            )
        tb = draw.textbbox((0, 0), title, font=font_top)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        tx = (w - tw) // 2
        ty = yb + (thb - th) // 2 - 2
        col = (*fill[:3], int(255 * alpha_m))
        draw_text_with_outline(
            draw, (tx, ty), title, font_top, col, (*outline[:3], int(255 * alpha_m)),
            max(1, outline_w),
            shadow=(shadow[0], shadow[1], (*shadow[2][:3], int(shadow[2][3] * alpha_m))) if shadow else None,
        )

    # --- active subtitle cue (hold last so captions never vanish mid-video) ---
    active = None
    pad = float(sub.get("pad_after_s", 0.08))
    last = None
    for c in cues:
        if c["end"] <= t:
            last = c
        if c["start"] <= t <= c["end"] + pad:
            active = c
            break
    if not active:
        if last is not None and bool(sub.get("hold_last", True)):
            active = last
        else:
            return img

    local_t = t - active["start"]
    motion_s = float(sub.get("motion_in_s", 0.18))
    scale = 1.0
    alpha = 1.0
    motion = sub.get("motion_in", "fade")
    if motion == "pop_scale" and motion_s > 0:
        p = ease_out_cubic(min(1.0, local_t / motion_s))
        scale = 0.88 + 0.12 * p
        alpha = p
    elif motion == "fade" and motion_s > 0:
        alpha = ease_out_cubic(min(1.0, local_t / motion_s))
    elif motion == "slide_up" and motion_s > 0:
        p = ease_out_cubic(min(1.0, local_t / motion_s))
        alpha = p

    text = active["text"].rstrip("，。！？、；：,.!?;:")
    # Compact Whisper junk spaces, then optional reference-style phrase spaces
    plain = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fffA-Za-z0-9])", "", text)
    plain = re.sub(r"(?<=[A-Za-z0-9])\s+(?=[\u4e00-\u9fff])", "", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    if typo.get("phrase_space"):
        plain = insert_phrase_spaces(plain)
    # leave room for logo on bottom_bar
    logo_pad = int(m * float(logo.get("size_pct", 0.085))) + 28 if logo.get("enabled") else 0
    max_w = int(w * 0.92) - (logo_pad if placement == "bottom_bar" else 0)
    lines = wrap_text(plain, font_body, max_w, draw, tracking)
    lines = lines[: int(typo.get("max_lines", 2))]
    if not lines:
        return img

    line_heights = []
    for ln in lines:
        bb = draw.textbbox((0, 0), ln or "字", font=font_body)
        line_heights.append(bb[3] - bb[1] + 8)
    total_h = sum(line_heights)

    if placement == "bottom_bar":
        by1 = h - chapter_h
        by0 = by1 - bar_h
        y = by0 + (bar_h - total_h) // 2 - 1
        content_left = logo_pad + 12
        content_right = w - 20
    else:
        y_base = int(h * (1.0 - float(sub.get("y_from_bottom_pct", 0.22))))
        if motion == "slide_up" and motion_s > 0:
            p = ease_out_cubic(min(1.0, local_t / motion_s))
            y_base += int((1 - p) * 40)
        y = y_base - total_h
        content_left = 0
        content_right = w

    kw_motion = sub.get("keyword_motion", "none")
    underline_col = hex_to_rgba(pal.get("keyword_alt", pal.get("accent_line", "#FF6A00")))
    # Reference style: same color for all body text; keywords only get underline, not color change
    same_color_keywords = bool(typo.get("keyword_same_color", True))

    for li, ln in enumerate(lines):
        line_spans = mark_keywords(ln, keywords)
        line_w = 0
        for seg, is_kw in line_spans:
            f = font_kw if (is_kw and not same_color_keywords) else font_body
            line_w += measure_text_width(draw, seg, f, tracking)
        if placement == "bottom_bar":
            x = content_left + (content_right - content_left - int(line_w * scale)) // 2
        else:
            x = (w - int(line_w * scale)) // 2

        # Join full line for one soft-stroke pass (cleaner rim than per-span)
        full_line = "".join(seg for seg, _ in line_spans)
        f = font_body
        col = (*fill[:3], int(255 * alpha))
        oc = (*outline[:3], int(255 * alpha))
        sh = None
        if shadow and not soft_stroke:
            sh = (shadow[0], shadow[1], (*shadow[2][:3], int(shadow[2][3] * alpha)))
        draw_text_tracked(
            draw, (x, y), full_line, f, col, oc, outline_w, sh, tracking,
            base_img=img, soft_stroke=soft_stroke, soft=soft_amt,
        )
        if kw_motion == "underline" and keywords:
            cx = x
            for seg, is_kw in line_spans:
                seg_w = measure_text_width(draw, seg, f, tracking)
                if is_kw:
                    bb = draw.textbbox((cx, y), seg, font=f)
                    draw.rectangle(
                        [cx, bb[3] + 3, cx + seg_w, bb[3] + 6],
                        fill=(*underline_col[:3], int(255 * alpha)),
                    )
                cx += seg_w
        y += line_heights[li]

    return img


def encode_overlay_from_frames(frame_dir: Path, fps: int, out_path: Path, w: int, h: int) -> Path:
    """Encode PNG sequence to a true-alpha MOV (qtrle ARGB). VP9 often drops alpha."""
    out_path = out_path.with_suffix(".mov")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pattern = str(frame_dir / "frame_%06d.png")
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", pattern,
        "-c:v", "qtrle", "-pix_fmt", "argb",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return out_path


def burn_overlay(
    video: Path,
    overlay: Path,
    out: Path,
    grade_filter: str = "",
    fps: int | None = None,
    frame_dir: Path | None = None,
) -> None:
    """Composite transparent overlay onto source. Prefer PNG sequence if provided."""
    if frame_dir is not None:
        pattern = str(frame_dir / "frame_%06d.png")
        fr = str(fps or 24)
        if grade_filter:
            fc = (
                f"[0:v]{grade_filter}[base];"
                f"[1:v]format=rgba[ov];"
                f"[base][ov]overlay=0:0:format=auto:shortest=1"
            )
        else:
            fc = "[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:format=auto:shortest=1"
        # Force yuv420p + High profile — Windows players reject yuv444p / High 4:4:4.
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video),
            "-framerate", fr, "-i", pattern,
            "-filter_complex", fc + "[vout]",
            "-map", "[vout]", "-map", "0:a?",
            "-c:v", "libx264", "-profile:v", "high", "-level", "4.0",
            "-pix_fmt", "yuv420p",
            "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
            "-shortest",
            "-movflags", "+faststart",
            str(out),
        ]
    else:
        if grade_filter:
            fc = (
                f"[0:v]{grade_filter}[base];"
                f"[1:v]format=rgba[ov];"
                f"[base][ov]overlay=0:0:format=auto"
            )
        else:
            fc = "[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:format=auto"
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video),
            "-i", str(overlay),
            "-filter_complex", fc + "[vout]",
            "-map", "[vout]", "-map", "0:a?",
            "-c:v", "libx264", "-profile:v", "high", "-level", "4.0",
            "-pix_fmt", "yuv420p",
            "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
            "-shortest",
            "-movflags", "+faststart",
            str(out),
        ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:] if r.stderr else "ffmpeg failed")
        raise subprocess.CalledProcessError(r.returncode, cmd)


def burn_behind_person(
    video: Path,
    giant_png: Path,
    matte: Path,
    front_dir: Path,
    out: Path,
    fps: int,
) -> None:
    """bg video + giant (behind) + person cutout + front overlays."""
    pattern = str(front_dir / "frame_%06d.png")
    # 0=video 1=giant 2=matte 3=front seq
    fc = (
        "[0:v]format=rgba[bg];"
        "[1:v]format=rgba[giant];"
        "[bg][giant]overlay=0:0[gbg];"
        "[0:v][2:v]alphamerge[person];"
        "[gbg][person]overlay=0:0[mid];"
        "[3:v]format=rgba[front];"
        "[mid][front]overlay=0:0:shortest=1[vout]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-loop", "1", "-i", str(giant_png),
        "-i", str(matte),
        "-framerate", str(fps), "-i", pattern,
        "-filter_complex", fc,
        "-map", "[vout]", "-map", "0:a?",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.0",
        "-pix_fmt", "yuv420p",
        "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        "-shortest",
        "-movflags", "+faststart",
        str(out),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2500:] if r.stderr else "ffmpeg failed")
        raise subprocess.CalledProcessError(r.returncode, cmd)


def main() -> None:
    ap = argparse.ArgumentParser(description="Render kinetic style overlays")
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--transcript", type=Path, required=True)
    ap.add_argument("--style", type=Path, required=True, help="style_profile yaml/json")
    ap.add_argument("--edit-dir", type=Path, required=True)
    ap.add_argument("--title", type=str, default="")
    ap.add_argument("--keywords", type=str, default="", help="comma-separated")
    ap.add_argument("--job", type=Path, default=None, help="style_job.json")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--burn", action="store_true", help="Composite onto source → final")
    ap.add_argument("--max-duration", type=float, default=0, help="limit seconds for preview")
    args = ap.parse_args()

    profile = load_profile(args.style.resolve())
    video = args.video.resolve()
    tr = json.loads(args.transcript.read_text(encoding="utf-8"))
    edit = args.edit_dir.resolve()
    out_dir = edit / "animations" / "kinetic"
    out_dir.mkdir(parents=True, exist_ok=True)

    job: dict[str, Any] = {}
    if args.job and args.job.exists():
        job = json.loads(args.job.read_text(encoding="utf-8"))

    title = args.title or job.get("title") or (profile.get("top_overlay") or {}).get("text") or ""
    # CLI --keywords takes priority; else job; empty list disables auto keywords
    if args.keywords.strip():
        kw_list: list[str] | None = [k.strip() for k in args.keywords.split(",") if k.strip()]
    elif "keywords" in job:
        kw_list = list(job.get("keywords") or [])
    else:
        kw_list = None

    w, h, duration = probe_wh(video)
    canvas = profile.get("canvas") or {}
    if canvas.get("width") and canvas.get("height"):
        cw, ch = int(canvas["width"]), int(canvas["height"])
        if (w, h) != (cw, ch):
            fitted = out_dir / f"source_{cw}x{ch}.mp4"
            print(f"fit canvas {w}x{h} → {cw}x{ch}")
            video = fit_source_to_canvas(
                video, fitted, cw, ch, bias_x=float(canvas.get("crop_bias_x", 0.62)),
            )
            w, h, duration = probe_wh(video)
    if args.max_duration and args.max_duration > 0:
        duration = min(duration, args.max_duration)

    words = words_only(tr)
    sub = profile.get("subtitle") or {}
    typo = profile.get("typography") or {}
    cues = chunk_phrases(
        words,
        max_chars=int(typo.get("max_chars_per_line", 14)),
        mode=sub.get("chunk", "phrase"),
    )
    # clamp cue durations
    min_d = float(sub.get("min_duration_s", 0.45))
    max_d = float(sub.get("max_duration_s", 3.2))
    for c in cues:
        if c["end"] - c["start"] < min_d:
            c["end"] = c["start"] + min_d
        if c["end"] - c["start"] > max_d:
            c["end"] = c["start"] + max_d

    keywords = pick_keywords(cues, kw_list)
    typo_pref = (profile.get("typography") or {})
    font_path = resolve_font(typo_pref.get("font_path"))
    print(f"font → {font_path}")
    chapters = list(job.get("chapters") or (profile.get("chapter_bar") or {}).get("items") or [])
    if not chapters and (profile.get("chapter_bar") or {}).get("enabled"):
        # auto chapters from timeline thirds + title-ish keywords
        chapters = ["开头", "展开", "细节", "收尾"]
    logo_text = job.get("logo_text") or (profile.get("logo") or {}).get("text") or ""

    (out_dir / "cues.json").write_text(
        json.dumps(
            {
                "title": title,
                "keywords": keywords,
                "chapters": chapters,
                "logo_text": logo_text,
                "cues": cues,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    fps = args.fps
    n_frames = int(math.ceil(duration * fps))
    print(
        f"rendering {n_frames} frames @ {fps}fps, {w}x{h}, "
        f"cues={len(cues)}, keywords={keywords}, chapters={chapters}"
    )

    # If giant-behind-person: render giant as a static plate, omit it from front frames
    giant_cfg = profile.get("giant") or {}
    behind_person = bool(giant_cfg.get("enabled") and giant_cfg.get("behind_person", True))
    front_profile = json.loads(json.dumps(profile))  # deep-ish copy
    if behind_person:
        front_profile.setdefault("giant", {})["enabled"] = False
        g_only = {
            "giant": {**giant_cfg, "enabled": True},
            "id_card": {"enabled": False},
            "hook": {"enabled": False},
            "subtitle": {"placement": "none"},
            "logo": {"enabled": False},
            "chapter_bar": {"enabled": False},
            "top_overlay": {"enabled": False},
            "typography": profile.get("typography") or {},
            "palette": profile.get("palette") or {},
        }
        giant_only = render_frame(
            w, h, 0.0, [], g_only, "", font_path, [],
            giant_text=(job.get("giant_text") or None),
        )
        giant_png = out_dir / "giant.png"
        giant_only.save(giant_png)
        print(f"giant plate → {giant_png}")
    else:
        front_profile = profile
        giant_png = None

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for i in range(n_frames):
            t = i / fps
            frame = render_frame(
                w, h, t, cues, front_profile, title, font_path, keywords,
                chapters=chapters, duration=duration, logo_text=logo_text,
                giant_text=(job.get("giant_text") or None),
            )
            frame.save(tmp_dir / f"frame_{i:06d}.png")
            if i % 50 == 0:
                print(f"  frame {i}/{n_frames}", flush=True)

        # Keep PNG sequence on disk for reliable alpha composite (VP9 drops alpha).
        frames_keep = out_dir / "frames"
        if frames_keep.exists():
            import shutil
            shutil.rmtree(frames_keep)
        import shutil
        shutil.copytree(tmp_dir, frames_keep)
        overlay_path = encode_overlay_from_frames(frames_keep, fps, out_dir / "overlay.mov", w, h)
        print(f"overlay → {overlay_path}")
        print(f"frames  → {frames_keep}")

    if args.burn:
        grade = profile.get("grade") or ""
        grade_filter = ""
        if grade and grade not in ("none", ""):
            try:
                sys.path.insert(0, str(Path(__file__).resolve().parent))
                from grade import get_preset
                grade_filter = get_preset(grade) if re.fullmatch(r"[a-zA-Z0-9_\-]+", grade) else grade
            except Exception:
                grade_filter = ""
        final = edit / "final.mp4"
        preview = edit / "preview.mp4"
        src = video
        if args.max_duration and args.max_duration > 0:
            trimmed = out_dir / "source_trim.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(video), "-t", str(args.max_duration),
                 "-c", "copy", str(trimmed)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            src = trimmed
        frames_keep = out_dir / "frames"
        if behind_person and giant_png is not None:
            matte_path = out_dir / "person_matte.mp4"
            print("extract person matte …")
            from person_matte import run_matte
            run_matte(src, matte_path)
            print(f"matte → {matte_path}")
            burn_behind_person(src, giant_png, matte_path, frames_keep, final, fps)
        else:
            burn_overlay(
                src,
                overlay_path,
                final,
                grade_filter=grade_filter,
                fps=fps,
                frame_dir=frames_keep if frames_keep.exists() else None,
            )
        subprocess.run(["cp", str(final), str(preview)], check=False)
        print(f"burned → {final}")


if __name__ == "__main__":
    main()
