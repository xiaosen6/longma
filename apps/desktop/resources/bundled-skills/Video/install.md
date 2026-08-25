---
name: Video-install
description: Install Video into the current agent and wire up ffmpeg + local Whisper so the user can start editing immediately.
---

# Video install

Use this file only for first-time install or reconnect. For daily editing, read `SKILL.md`. Always read `helpers/` — that's where the scripts live.

## What you're doing

You're setting up a conversation-driven video editor for the user. After install, the user drops raw footage into any folder, runs their agent there, and says "edit these into a launch video." You do the rest by reading `SKILL.md`.

Three things must exist on this machine:

1. The `Video` skill directory somewhere stable (this repo).
2. `ffmpeg` on `$PATH` (plus optional `yt-dlp` for online sources).
3. Local OpenAI Whisper installed (`openai-whisper`); default model is `tiny` (first run downloads weights once, no API key).

And one thing must be true about the current agent:

4. It can discover `SKILL.md` — either via a global skills directory (`~/.grok/skills/`, `~/.claude/skills/`, `~/.codex/skills/`) or via a system-prompt import.

## Install prompt contract

- Do everything yourself. Only ask the user for confirmation before `sudo` / `brew install`.
- Prefer a stable path like `~/Developer/Video` or the project's `Video/` folder (not `/tmp`, not `~/Downloads`).
- The skill references helpers by bare name (`transcribe.py`, `render.py`). That works because SKILL.md and `helpers/` ship together — keep them as siblings when you register the skill.
- After install, verify by running one real command against the helpers. Don't declare success on file-existence checks alone.

## Steps

### 1. Place the skill

If this tree already exists (e.g. `/path/to/Video`), `cd` into it. Otherwise clone or copy it to a stable path:

```bash
# example
test -d ~/Developer/Video || cp -a /path/to/Video ~/Developer/Video
cd ~/Developer/Video
```

### 2. Install Python deps (includes Whisper)

```bash
command -v uv >/dev/null && uv sync || pip install -e .
```

On slow network mounts (e.g. WSL `/mnt/d`), put the venv on a local disk:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.cache/video-skill-venv"
uv sync
# then always call helpers with that python:
# $UV_PROJECT_ENVIRONMENT/bin/python helpers/transcribe.py clip.mp4
```

`pyproject.toml` lists `openai-whisper` (pulls `torch`), `librosa`, `matplotlib`, `pillow`, `numpy`. First Whisper run downloads the `tiny` model weights (~75MB). No console scripts — helpers are invoked as `python helpers/<name>.py`.

Optional larger models if accuracy matters more than speed:

```bash
# used at runtime via --model base|small|medium|large-v3
python helpers/transcribe.py clip.mp4 --model base
```

### 3. Install ffmpeg (+ optional yt-dlp)

`ffmpeg` and `ffprobe` are hard requirements. `yt-dlp` is only needed if the user wants to pull sources from URLs. Animation engines (HyperFrames, Remotion, Manim) install lazily on first use.

```bash
# macOS
command -v ffmpeg >/dev/null || brew install ffmpeg
command -v yt-dlp >/dev/null || brew install yt-dlp     # optional

# Debian / Ubuntu
# sudo apt-get update && sudo apt-get install -y ffmpeg
# pip install yt-dlp

# Arch
# sudo pacman -S ffmpeg yt-dlp
```

If package managers need sudo, print the exact command and wait. Do not invent a password.

### 4. Register the skill with the current agent

Symlink the **whole directory** (helpers must sit next to SKILL.md):

- **Grok** (`~/.grok/` present):

    ```bash
    mkdir -p ~/.grok/skills
    ln -sfn /absolute/path/to/Video ~/.grok/skills/Video
    ```

- **Claude Code** (`~/.claude/` present):

    ```bash
    mkdir -p ~/.claude/skills
    ln -sfn /absolute/path/to/Video ~/.claude/skills/Video
    ```

- **Codex** (`$CODEX_HOME` set, or `~/.codex/` present):

    ```bash
    mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
    ln -sfn /absolute/path/to/Video "${CODEX_HOME:-$HOME/.codex}/skills/Video"
    ```

- **Hermes / Openclaw / another agent**: symlink into that agent's skills directory under the name `Video`, or point its system prompt at `Video/SKILL.md`.

If you can't tell which agent you're in, ask once, then pick the right target.

### 5. Verify Whisper + helpers

```bash
python -c "import whisper; print('whisper OK', whisper.__version__ if hasattr(whisper,'__version__') else '')"
python /absolute/path/to/Video/helpers/timeline_view.py --help >/dev/null && echo "helpers OK"
ffprobe -version | head -1
```

Optional smoke test (downloads `tiny` on first run):

```bash
# only when the user already has a short clip handy
python /absolute/path/to/Video/helpers/transcribe.py /path/to/clip.mp4 --model tiny
```

### 6. Hand off

Tell the user, in one short message:

- Where the skill is installed.
- That they should `cd` into their footage folder and start their agent there.
- That a good first message is: *"edit these into a launch video"* or *"inventory these takes and propose a strategy."*
- That all outputs land in `<videos_dir>/edit/` — the skill directory stays clean.
- That transcription is **local Whisper `tiny`** — no cloud API key.

## Keeping the skill current

- Pull / copy updates into the skill path. Symlinks pick them up on the next run.
- If `pyproject.toml` changed deps, re-run `uv sync` / `pip install -e .`.

## Cold-start reminders

- Symlink the **whole directory**, not just `SKILL.md`.
- No ElevenLabs / cloud ASR key is required.
- Default model is `tiny`. Upgrade with `--model base` (or larger) when the user needs better accuracy and accepts slower runs.
- `ffmpeg` from static builds works fine (≥ 4.x).
- `yt-dlp` is optional. Install lazily the first time a user asks to pull from a URL.
- Node.js/npm only for HyperFrames or Remotion. HyperFrames currently requires Node.js 22+.
- HyperFrames, Remotion, and Manim are optional per animation slot — don't install them all at setup.
