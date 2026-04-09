# MemeForge Studio

Production-style meme editor built with Flask, Jinja templates, Tailwind (CDN), vanilla JavaScript, and Pillow.

## Features

- Tool-first app-shell editor (`/`) with:
  - topbar actions
  - left rail + contextual tool panel
  - dominant live canvas
  - inspector with progress states
- Real-time meme preview (no page reload)
- Upload image support (PNG/JPG/JPEG/WEBP)
- Local template selection
- Text controls:
  - top/bottom text
  - font size
  - text color
  - stroke color
  - stroke width
  - alignment
  - uppercase toggle
- Backend image generation with Pillow:
  - wrapping
  - auto scaling
  - alignment and stroke rendering
- Single export flow with strict disabled/ready states
- Blocking errors inline, transient success via toast
- Gallery route (`/gallery`) for generated memes
- Dark/light theme toggle

## Tech Stack

- Python 3.x
- Flask
- Jinja2
- Tailwind CSS (CDN)
- Vanilla JavaScript
- Pillow

## Project Structure

```text
.
├── app.py
├── requirements.txt
├── README.md
├── templates
│   ├── base.html
│   ├── index.html
│   └── gallery.html
├── static
│   ├── css
│   │   └── styles.css
│   ├── js
│   │   └── app.js
│   ├── templates
│   │   ├── city-lights.png
│   │   ├── retro-wave.png
│   │   └── sunset-peak.png
│   ├── uploads
│   └── generated
└── utils
    └── meme_generator.py
```

## Setup

1. Create and activate virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run the app:

```bash
python app.py
```

4. Open:

```text
http://127.0.0.1:5000
```

## Routes

- `GET /` → main editor
- `GET /gallery` → generated meme gallery
- `POST /generate` → generate final meme PNG

## Notes

- Max upload size is 8MB (configured in `app.py`).
- Generated files are saved under `static/generated`.
- Uploaded files are temporary and removed after generation.
- If `Impact` font is unavailable, system bold fallbacks are used.

## Quick Validation

```bash
python3 -m compileall app.py utils
node --check static/js/app.js
```
