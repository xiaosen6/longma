"""Transcribe a video with local OpenAI Whisper (default: tiny).

Extracts mono 16kHz audio via ffmpeg, runs whisper with word-level
timestamps, writes word-level JSON to
<edit_dir>/transcripts/<video_stem>.json so pack_transcripts / render /
timeline_view keep working unchanged.

Cached: if the output file already exists, transcription is skipped.

Usage:
    python helpers/transcribe.py <video_path>
    python helpers/transcribe.py <video_path> --edit-dir /custom/edit
    python helpers/transcribe.py <video_path> --language en
    python helpers/transcribe.py <video_path> --model tiny
    python helpers/transcribe.py <video_path> --model base
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

DEFAULT_MODEL = "tiny"

# Process-local cache so batch jobs load the model once.
_MODEL_CACHE: dict[str, Any] = {}


def load_whisper_model(model_name: str = DEFAULT_MODEL):
    """Load and cache a Whisper model by name (tiny/base/small/...)."""
    if model_name not in _MODEL_CACHE:
        try:
            import whisper
        except ImportError:
            sys.exit(
                "openai-whisper is not installed. "
                "Run: pip install openai-whisper   (or: uv sync inside the Video skill root)"
            )
        print(f"  loading Whisper model '{model_name}' …", flush=True)
        # Prefer CPU when CUDA driver is broken/mismatched (common on WSL).
        import os
        device = "cpu"
        if os.environ.get("WHISPER_DEVICE"):
            device = os.environ["WHISPER_DEVICE"]
        else:
            try:
                import torch
                if torch.cuda.is_available():
                    device = "cuda"
            except Exception:
                pass
        _MODEL_CACHE[model_name] = whisper.load_model(model_name, device=device)
        print(f"  model on {device}", flush=True)
    return _MODEL_CACHE[model_name]


def extract_audio(video_path: Path, dest: Path) -> None:
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(dest),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def result_to_payload(result: dict, model_name: str) -> dict:
    """Convert Whisper transcribe() output to the skill's word-level JSON schema.

    Schema (compatible with pack_transcripts / render / timeline_view):
      {
        "text": "...",
        "language": "en",
        "engine": "whisper",
        "model": "tiny",
        "words": [
          {"type": "word", "text": "Hello", "start": 0.0, "end": 0.4},
          {"type": "spacing", "text": " ", "start": 0.4, "end": 0.7},
          ...
        ]
      }
    """
    words: list[dict] = []
    prev_end: float | None = None

    for seg in result.get("segments") or []:
        seg_words = seg.get("words")
        if seg_words:
            for w in seg_words:
                text = (w.get("word") or "").strip()
                if not text:
                    continue
                start = float(w["start"])
                end = float(w["end"])
                if prev_end is not None and start > prev_end + 1e-3:
                    words.append({
                        "type": "spacing",
                        "text": " ",
                        "start": prev_end,
                        "end": start,
                    })
                words.append({
                    "type": "word",
                    "text": text,
                    "start": start,
                    "end": end,
                })
                prev_end = end
        else:
            # Fallback when word_timestamps unavailable: one token per segment.
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", start))
            if prev_end is not None and start > prev_end + 1e-3:
                words.append({
                    "type": "spacing",
                    "text": " ",
                    "start": prev_end,
                    "end": start,
                })
            words.append({
                "type": "word",
                "text": text,
                "start": start,
                "end": end,
            })
            prev_end = end

    return {
        "text": (result.get("text") or "").strip(),
        "language": result.get("language"),
        "engine": "whisper",
        "model": model_name,
        "words": words,
    }


def call_whisper(
    audio_path: Path,
    model_name: str = DEFAULT_MODEL,
    language: str | None = None,
    model=None,
) -> dict:
    """Run Whisper and return the skill's transcript payload."""
    if model is None:
        model = load_whisper_model(model_name)

    kwargs: dict[str, Any] = {
        "word_timestamps": True,
        "verbose": False,
    }
    if language:
        kwargs["language"] = language

    result = model.transcribe(str(audio_path), **kwargs)
    return result_to_payload(result, model_name)


def transcribe_one(
    video: Path,
    edit_dir: Path,
    language: str | None = None,
    model_name: str = DEFAULT_MODEL,
    model=None,
    verbose: bool = True,
) -> Path:
    """Transcribe a single video. Returns path to transcript JSON.

    Cached: returns existing path immediately if the transcript already exists.
    Pass a pre-loaded `model` to avoid reloading across a batch.
    """
    transcripts_dir = edit_dir / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    out_path = transcripts_dir / f"{video.stem}.json"

    if out_path.exists():
        if verbose:
            print(f"cached: {out_path.name}")
        return out_path

    if verbose:
        print(f"  extracting audio from {video.name}", flush=True)

    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        audio = Path(tmp) / f"{video.stem}.wav"
        extract_audio(video, audio)
        size_mb = audio.stat().st_size / (1024 * 1024)
        if verbose:
            print(
                f"  whisper/{model_name} on {video.stem}.wav ({size_mb:.1f} MB)",
                flush=True,
            )
        payload = call_whisper(
            audio,
            model_name=model_name,
            language=language,
            model=model,
        )

    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    dt = time.time() - t0

    if verbose:
        kb = out_path.stat().st_size / 1024
        print(f"  saved: {out_path.name} ({kb:.1f} KB) in {dt:.1f}s")
        print(f"    words: {len(payload.get('words', []))}")

    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Transcribe a video with local OpenAI Whisper"
    )
    ap.add_argument("video", type=Path, help="Path to video file")
    ap.add_argument(
        "--edit-dir",
        type=Path,
        default=None,
        help="Edit output directory (default: <video_parent>/edit)",
    )
    ap.add_argument(
        "--language",
        type=str,
        default=None,
        help="Optional ISO language code (e.g. 'en', 'zh'). Omit to auto-detect.",
    )
    ap.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Whisper model size (default: {DEFAULT_MODEL}). "
             "tiny | base | small | medium | large-v3",
    )
    args = ap.parse_args()

    video = args.video.resolve()
    if not video.exists():
        sys.exit(f"video not found: {video}")

    edit_dir = (args.edit_dir or (video.parent / "edit")).resolve()

    transcribe_one(
        video=video,
        edit_dir=edit_dir,
        language=args.language,
        model_name=args.model,
    )


if __name__ == "__main__":
    main()
