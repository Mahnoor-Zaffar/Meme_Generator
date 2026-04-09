from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from PIL import Image, ImageDraw, ImageFont

ROOT_DIR: Final[Path] = Path(__file__).resolve().parents[1]

FONT_CANDIDATES: Final[tuple[Path, ...]] = (
    ROOT_DIR / "static" / "fonts" / "impact.ttf",
    Path("/System/Library/Fonts/Supplemental/Impact.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("C:/Windows/Fonts/impact.ttf"),
    Path("C:/Windows/Fonts/arialbd.ttf"),
)


@dataclass(slots=True)
class MemeOptions:
    top_text: str = ""
    bottom_text: str = ""
    font_size: int = 56
    text_color: str = "#FFFFFF"
    stroke_color: str = "#000000"
    stroke_width: int = 4
    alignment: str = "center"
    uppercase: bool = False


def ensure_default_templates(template_dir: Path) -> None:
    template_dir.mkdir(parents=True, exist_ok=True)
    defaults = {
        "city-lights.png": _build_city_template,
        "sunset-peak.png": _build_sunset_template,
        "retro-wave.png": _build_retro_template,
    }
    for filename, builder in defaults.items():
        destination = template_dir / filename
        if not destination.exists():
            template_image = builder((1280, 720))
            template_image.save(destination, format="PNG", optimize=True)


def generate_meme(source_path: Path, output_path: Path, options: MemeOptions) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image = _render_meme_image(source_path, options)
    try:
        image.save(output_path, format="PNG", optimize=True)
    finally:
        image.close()
    return output_path


def generate_meme_bytes(source_path: Path, options: MemeOptions) -> bytes:
    image = _render_meme_image(source_path, options)
    buffer = io.BytesIO()
    try:
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()
    finally:
        image.close()
        buffer.close()


def _render_meme_image(source_path: Path, options: MemeOptions) -> Image.Image:
    with Image.open(source_path) as opened:
        image = opened.convert("RGB")

    draw = ImageDraw.Draw(image)
    image_width, image_height = image.size
    margin = max(12, int(image_height * 0.03))
    max_width = int(image_width * 0.92)
    zone_height = int(image_height * 0.34)

    top_text = _normalize_text(options.top_text, options.uppercase)
    bottom_text = _normalize_text(options.bottom_text, options.uppercase)

    if top_text:
        lines, font, line_height = _fit_text_block(
            draw=draw,
            text=top_text,
            base_size=options.font_size,
            max_width=max_width,
            max_height=zone_height,
            stroke_width=options.stroke_width,
        )
        _draw_lines(
            draw=draw,
            lines=lines,
            font=font,
            start_y=margin,
            image_width=image_width,
            margin=margin,
            line_height=line_height,
            alignment=options.alignment,
            fill=options.text_color,
            stroke_fill=options.stroke_color,
            stroke_width=options.stroke_width,
        )

    if bottom_text:
        lines, font, line_height = _fit_text_block(
            draw=draw,
            text=bottom_text,
            base_size=options.font_size,
            max_width=max_width,
            max_height=zone_height,
            stroke_width=options.stroke_width,
        )
        total_height = len(lines) * line_height
        start_y = max(margin, image_height - margin - total_height)
        _draw_lines(
            draw=draw,
            lines=lines,
            font=font,
            start_y=start_y,
            image_width=image_width,
            margin=margin,
            line_height=line_height,
            alignment=options.alignment,
            fill=options.text_color,
            stroke_fill=options.stroke_color,
            stroke_width=options.stroke_width,
        )

    return image


def _normalize_text(value: str, uppercase: bool) -> str:
    text = (value or "").strip()
    return text.upper() if uppercase else text


def _fit_text_block(
    draw: ImageDraw.ImageDraw,
    text: str,
    base_size: int,
    max_width: int,
    max_height: int,
    stroke_width: int,
) -> tuple[list[str], ImageFont.ImageFont | ImageFont.FreeTypeFont, int]:
    starting_size = _clamp(base_size, 16, 140)

    best_lines: list[str] = []
    best_font: ImageFont.ImageFont | ImageFont.FreeTypeFont = _load_font(starting_size)
    best_line_height = _line_height(draw, best_font, stroke_width)

    for size in range(starting_size, 15, -2):
        font = _load_font(size)
        lines = _wrap_text(draw, text, font, max_width, stroke_width)
        line_height = _line_height(draw, font, stroke_width)
        if lines and len(lines) * line_height <= max_height:
            return lines, font, line_height
        best_lines = lines
        best_font = font
        best_line_height = line_height

    max_lines = max(1, max_height // max(best_line_height, 1))
    trimmed = best_lines[:max_lines]
    if best_lines and len(best_lines) > max_lines and trimmed:
        trimmed[-1] = _truncate_line(draw, trimmed[-1], best_font, max_width, stroke_width)
    return trimmed or [text], best_font, best_line_height


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    max_width: int,
    stroke_width: int,
) -> list[str]:
    lines: list[str] = []
    paragraphs = [line.strip() for line in text.splitlines() if line.strip()]
    if not paragraphs:
        return []

    for paragraph in paragraphs:
        words = paragraph.split()
        if not words:
            continue
        current_line = ""
        for word in words:
            candidate = f"{current_line} {word}".strip() if current_line else word
            if _measure_text(draw, candidate, font, stroke_width) <= max_width:
                current_line = candidate
                continue

            if current_line:
                lines.append(current_line)
                current_line = ""

            if _measure_text(draw, word, font, stroke_width) <= max_width:
                current_line = word
                continue

            chunks = _split_long_word(draw, word, font, max_width, stroke_width)
            if chunks:
                lines.extend(chunks[:-1])
                current_line = chunks[-1]

        if current_line:
            lines.append(current_line)

    return lines


def _split_long_word(
    draw: ImageDraw.ImageDraw,
    word: str,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    max_width: int,
    stroke_width: int,
) -> list[str]:
    chunks: list[str] = []
    current = ""
    for char in word:
        candidate = f"{current}{char}"
        if _measure_text(draw, candidate, font, stroke_width) <= max_width:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = char
    if current:
        chunks.append(current)
    return chunks or [word]


def _truncate_line(
    draw: ImageDraw.ImageDraw,
    line: str,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    max_width: int,
    stroke_width: int,
) -> str:
    ellipsis = "..."
    if _measure_text(draw, line, font, stroke_width) <= max_width:
        return line

    trimmed = line
    while trimmed and _measure_text(draw, f"{trimmed}{ellipsis}", font, stroke_width) > max_width:
        trimmed = trimmed[:-1].rstrip()

    return f"{trimmed}{ellipsis}" if trimmed else ellipsis


def _line_height(
    draw: ImageDraw.ImageDraw,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    stroke_width: int,
) -> int:
    bbox = draw.textbbox((0, 0), "Ag", font=font, stroke_width=stroke_width)
    return (bbox[3] - bbox[1]) + max(2, stroke_width)


def _measure_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    stroke_width: int,
) -> int:
    if not text:
        return 0
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    return bbox[2] - bbox[0]


def _draw_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont,
    start_y: int,
    image_width: int,
    margin: int,
    line_height: int,
    alignment: str,
    fill: str,
    stroke_fill: str,
    stroke_width: int,
) -> None:
    y = start_y
    for line in lines:
        line_width = _measure_text(draw, line, font, stroke_width)
        if alignment == "left":
            x = margin
        elif alignment == "right":
            x = image_width - margin - line_width
        else:
            x = (image_width - line_width) / 2

        draw.text(
            (max(0, x), y),
            line,
            font=font,
            fill=fill,
            stroke_fill=stroke_fill,
            stroke_width=stroke_width,
        )
        y += line_height


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if candidate.exists():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except OSError:
                continue
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size=size)
    except OSError:
        return ImageFont.load_default()


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def _build_sunset_template(size: tuple[int, int]) -> Image.Image:
    image = _vertical_gradient(size, (34, 25, 64), (250, 115, 78))
    draw = ImageDraw.Draw(image)
    width, height = image.size
    draw.ellipse(
        (int(width * 0.68), int(height * 0.12), int(width * 0.9), int(height * 0.45)),
        fill=(255, 218, 121),
    )
    draw.polygon(
        [(0, height), (int(width * 0.28), int(height * 0.48)), (int(width * 0.52), height)],
        fill=(46, 32, 90),
    )
    draw.polygon(
        [(int(width * 0.35), height), (int(width * 0.63), int(height * 0.4)), (width, height)],
        fill=(30, 24, 56),
    )
    _stamp_template_name(draw, image.size, "Sunset Peak")
    return image


def _build_city_template(size: tuple[int, int]) -> Image.Image:
    image = _vertical_gradient(size, (11, 18, 44), (54, 91, 132))
    draw = ImageDraw.Draw(image)
    width, height = image.size
    base_y = int(height * 0.58)
    building_width = int(width / 11)
    colors = [(12, 20, 36), (20, 28, 52), (18, 36, 58)]
    for index in range(12):
        x0 = index * building_width
        x1 = x0 + building_width
        top = base_y - (index % 5) * 26 - int(height * 0.12)
        draw.rectangle((x0, top, x1, height), fill=colors[index % len(colors)])
        if index % 2 == 0:
            for y in range(top + 14, height - 14, 24):
                draw.rectangle((x0 + 8, y, x0 + 14, y + 8), fill=(245, 202, 128))
                draw.rectangle((x0 + 22, y, x0 + 28, y + 8), fill=(245, 202, 128))
    draw.rectangle((0, int(height * 0.82), width, height), fill=(13, 16, 28))
    _stamp_template_name(draw, image.size, "City Lights")
    return image


def _build_retro_template(size: tuple[int, int]) -> Image.Image:
    image = _vertical_gradient(size, (43, 26, 95), (239, 68, 68))
    draw = ImageDraw.Draw(image)
    width, height = image.size
    horizon = int(height * 0.58)
    draw.rectangle((0, horizon, width, height), fill=(18, 14, 52))
    for step in range(1, 14):
        y = horizon + step * int((height - horizon) / 14)
        draw.line((0, y, width, y), fill=(72, 52, 122), width=2)
    for x in range(0, width + 1, int(width / 15)):
        draw.line((x, horizon, width / 2, height), fill=(72, 52, 122), width=2)
    draw.ellipse(
        (int(width * 0.37), int(height * 0.18), int(width * 0.63), int(height * 0.54)),
        fill=(255, 212, 95),
    )
    _stamp_template_name(draw, image.size, "Retro Wave")
    return image


def _vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        ratio = y / max(height - 1, 1)
        color = (
            int(top[0] + (bottom[0] - top[0]) * ratio),
            int(top[1] + (bottom[1] - top[1]) * ratio),
            int(top[2] + (bottom[2] - top[2]) * ratio),
        )
        draw.line((0, y, width, y), fill=color)
    return image


def _stamp_template_name(draw: ImageDraw.ImageDraw, size: tuple[int, int], label: str) -> None:
    font = _load_font(30)
    text = f"Template: {label}"
    stroke = 2
    text_width = _measure_text(draw, text, font, stroke)
    x = size[0] - text_width - 26
    y = size[1] - 56
    draw.text((x, y), text, font=font, fill="#FFFFFF", stroke_fill="#000000", stroke_width=stroke)
