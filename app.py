from __future__ import annotations

import io
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Final

from flask import Flask, render_template, request, send_file, url_for
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

from utils.meme_generator import MemeOptions, ensure_default_templates, generate_meme, generate_meme_bytes

BASE_DIR: Final[Path] = Path(__file__).resolve().parent
STATIC_DIR: Final[Path] = BASE_DIR / "static"
IS_VERCEL: Final[bool] = os.getenv("VERCEL") == "1"
UPLOAD_DIR: Final[Path] = (Path("/tmp") / "uploads") if IS_VERCEL else (STATIC_DIR / "uploads")
GENERATED_DIR: Final[Path] = (Path("/tmp") / "generated") if IS_VERCEL else (STATIC_DIR / "generated")
TEMPLATE_DIR: Final[Path] = STATIC_DIR / "templates"

ALLOWED_EXTENSIONS: Final[set[str]] = {".png", ".jpg", ".jpeg", ".webp"}
MAX_UPLOAD_BYTES: Final[int] = 8 * 1024 * 1024

HEX_COLOR_PATTERN: Final[re.Pattern[str]] = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
ALIGNMENTS: Final[set[str]] = {"left", "center", "right"}


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

    for folder in (UPLOAD_DIR, GENERATED_DIR, TEMPLATE_DIR):
        folder.mkdir(parents=True, exist_ok=True)
    ensure_default_templates(TEMPLATE_DIR)

    @app.get("/")
    def index() -> str:
        template_images = _list_template_images()
        return render_template(
            "index.html",
            template_images=template_images,
            max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
            project_title="Untitled Meme",
        )

    @app.get("/gallery")
    def gallery() -> str:
        generated_memes = _list_generated_memes(limit=48)
        return render_template("gallery.html", generated_memes=generated_memes)

    @app.post("/generate")
    def generate() -> tuple[dict[str, object], int] | dict[str, object]:
        uploaded_image_path: Path | None = None
        try:
            source_path = _resolve_source_image()
            if source_path.parent == UPLOAD_DIR:
                uploaded_image_path = source_path

            options = _parse_meme_options()
            direct_stream = IS_VERCEL or request.args.get("direct") == "1"
            output_filename = f"meme_{uuid.uuid4().hex}.png"
            if direct_stream:
                image_bytes = generate_meme_bytes(source_path, options)
                return send_file(
                    io.BytesIO(image_bytes),
                    mimetype="image/png",
                    as_attachment=request.args.get("download") == "1",
                    download_name=output_filename,
                    max_age=0,
                )

            output_path = GENERATED_DIR / output_filename
            generate_meme(source_path, output_path, options)
            image_url = url_for("static", filename=f"generated/{output_filename}")
            return {
                "success": True,
                "message": "Meme generated successfully.",
                "image_url": image_url,
                "filename": output_filename,
            }
        except ValueError as exc:
            return {"success": False, "message": str(exc)}, 400
        except Exception:
            logging.exception("Unhandled error while generating meme")
            return {"success": False, "message": "Failed to generate meme. Please try again."}, 500
        finally:
            if uploaded_image_path and uploaded_image_path.exists():
                uploaded_image_path.unlink(missing_ok=True)

    @app.errorhandler(RequestEntityTooLarge)
    def handle_large_file(_: RequestEntityTooLarge) -> tuple[dict[str, object], int]:
        return {
            "success": False,
            "message": f"Image is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.",
        }, 413

    return app


def _list_template_images() -> list[dict[str, str]]:
    files = sorted(
        (path for path in TEMPLATE_DIR.iterdir() if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS),
        key=lambda item: item.name.lower(),
    )
    return [
        {
            "filename": path.name,
            "label": path.stem.replace("-", " ").replace("_", " ").title(),
            "url": url_for("static", filename=f"templates/{path.name}"),
        }
        for path in files
    ]


def _list_generated_memes(limit: int = 12) -> list[dict[str, str]]:
    if IS_VERCEL:
        return []

    files = sorted(
        (path for path in GENERATED_DIR.iterdir() if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )[:limit]
    return [
        {
            "filename": path.name,
            "url": url_for("static", filename=f"generated/{path.name}"),
        }
        for path in files
    ]


def _resolve_source_image() -> Path:
    uploaded_file = request.files.get("image")
    if uploaded_file and uploaded_file.filename:
        filename = secure_filename(uploaded_file.filename)
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            raise ValueError("Unsupported image type. Allowed types: PNG, JPG, JPEG, WEBP.")

        destination = UPLOAD_DIR / f"upload_{uuid.uuid4().hex}{suffix}"
        uploaded_file.save(destination)
        return destination

    template_name = request.form.get("template_name", "").strip()
    if not template_name:
        raise ValueError("Please upload an image or choose a template.")

    safe_template_name = Path(secure_filename(template_name)).name
    if not safe_template_name:
        raise ValueError("Invalid template selection.")

    candidate = (TEMPLATE_DIR / safe_template_name).resolve()
    template_root = TEMPLATE_DIR.resolve()
    if template_root not in candidate.parents:
        raise ValueError("Invalid template path.")
    if not candidate.exists() or not candidate.is_file():
        raise ValueError("Selected template does not exist.")
    if candidate.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError("Selected template format is not supported.")

    return candidate


def _parse_meme_options() -> MemeOptions:
    top_text = request.form.get("top_text", "")
    bottom_text = request.form.get("bottom_text", "")
    font_size = _clamp_int(request.form.get("font_size", "56"), minimum=20, maximum=120, field_name="font size")
    stroke_width = _clamp_int(
        request.form.get("stroke_width", "4"),
        minimum=0,
        maximum=20,
        field_name="stroke width",
    )

    text_color = _validate_hex_color(request.form.get("text_color", "#ffffff"), "text color")
    stroke_color = _validate_hex_color(request.form.get("stroke_color", "#000000"), "stroke color")

    alignment = request.form.get("alignment", "center").strip().lower()
    if alignment not in ALIGNMENTS:
        alignment = "center"

    uppercase = request.form.get("uppercase", "false").strip().lower() in {"1", "true", "on", "yes"}
    return MemeOptions(
        top_text=top_text,
        bottom_text=bottom_text,
        font_size=font_size,
        text_color=text_color,
        stroke_color=stroke_color,
        stroke_width=stroke_width,
        alignment=alignment,
        uppercase=uppercase,
    )


def _clamp_int(value: str, minimum: int, maximum: int, field_name: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {field_name}.") from exc
    return max(minimum, min(maximum, parsed))


def _validate_hex_color(value: str, field_name: str) -> str:
    color = value.strip() if isinstance(value, str) else ""
    if not HEX_COLOR_PATTERN.fullmatch(color):
        raise ValueError(f"Invalid {field_name} value.")
    return color


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
