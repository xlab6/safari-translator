#!/usr/bin/env python3
"""Render the Safari Translator icon set.

Produces:
  extension/icons/icon-{16,32,48,64,128,256,512}.png
  xcode/<app>/<app>/Assets.xcassets/AppIcon.appiconset/mac-icon-*.png  (if --xcode)
  xcode/<app>/<app>/Resources/Icon.png                                (if --xcode)

Design: blue→violet rounded square; white speech bubble holding a
gradient 文/A mark. Very small sizes fall back to a single white 文 for
legibility in the Safari toolbar.
"""

import argparse
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "extension" / "icons"

HIragino = "/System/Library/Fonts/Hiragino Sans GB.ttc"
HELVETICA = "/System/Library/Fonts/Helvetica.ttc"

BLUE = (47, 107, 255)
VIOLET = (124, 92, 255)
INK = (32, 52, 170)

SAFARI_FACE_TOP = (92, 205, 255)
SAFARI_FACE_BOTTOM = (10, 105, 232)
SAFARI_NEEDLE = (244, 67, 54)
SAFARI_NEEDLE_LIGHT = (240, 245, 250)

SUPERSAMPLE = 2


def gradient(size, start, end):
    """Diagonal linear gradient."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x + y) / max(1, (size - 1) * 2)
    t = t[..., None]
    a = np.array(start, dtype=np.float32)
    b = np.array(end, dtype=np.float32)
    data = a + (b - a) * t
    return Image.fromarray(data.astype(np.uint8), "RGB").convert("RGBA")


def rounded_mask(size, box, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def bubble_mask(size, detailed):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    if detailed:
        rect = (212, 266, 812, 692)
        radius = 116
        draw.rounded_rectangle(rect, radius=radius, fill=255)
        draw.polygon([(300, 676), (452, 676), (300, 842)], fill=255)
    else:
        rect = (244, 252, 780, 716)
        draw.rounded_rectangle(rect, radius=128, fill=255)
        draw.polygon([(322, 700), (462, 700), (322, 848)], fill=255)
    return mask


def text_mask(size, glyphs):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    for text, font, center in glyphs:
        draw.text(center, text, font=font, fill=255, anchor="mm")
    return mask


def load_font(path, px, index=0):
    return ImageFont.truetype(path, px, index=index)


def vertical_gradient(width, height, start, end):
    t = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    a = np.array(start, dtype=np.float32)
    b = np.array(end, dtype=np.float32)
    data = np.repeat(a + (b - a) * t, width, axis=1).astype(np.uint8)
    return Image.fromarray(data, "RGB").convert("RGBA")


def polar_point(cx, cy, angle, distance):
    rad = math.radians(angle)
    return (cx + math.sin(rad) * distance, cy - math.cos(rad) * distance)


def draw_tick(draw, cx, cy, angle, inner, outer, half_width):
    rad = math.radians(angle)
    dx, dy = math.sin(rad), -math.cos(rad)
    px, py = math.cos(rad), math.sin(rad)
    draw.polygon([
        (cx + dx * outer + px * half_width, cy + dy * outer + py * half_width),
        (cx + dx * outer - px * half_width, cy + dy * outer - py * half_width),
        (cx + dx * inner - px * half_width, cy + dy * inner - py * half_width),
        (cx + dx * inner + px * half_width, cy + dy * inner + py * half_width)
    ], fill=(255, 255, 255, 240))


def safari_badge(size, cx, cy, radius, ticks=True):
    """A Safari-style compass badge for the bottom-right corner."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    shadow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shadow).ellipse(
        (cx - radius, cy - radius + radius * 0.10,
         cx + radius, cy + radius + radius * 0.10),
        fill=120
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius * 0.11))
    shadow_layer = Image.new("RGBA", (size, size), (14, 24, 60, 255))
    shadow_layer.putalpha(shadow)
    layer.alpha_composite(shadow_layer)

    draw = ImageDraw.Draw(layer)
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=(255, 255, 255, 255),
        outline=(208, 217, 231, 255),
        width=max(2, int(radius * 0.035))
    )

    face_radius = radius * 0.845
    diameter = int(math.ceil(face_radius * 2))
    face = vertical_gradient(diameter, diameter, SAFARI_FACE_TOP, SAFARI_FACE_BOTTOM)
    face_mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(face_mask).ellipse((0, 0, diameter - 1, diameter - 1), fill=255)
    face.putalpha(face_mask)
    layer.alpha_composite(face, (int(cx - face_radius), int(cy - face_radius)))

    if ticks:
        for index in range(16):
            angle = index * 22.5
            if index % 4 == 0:
                length, half_width = radius * 0.150, radius * 0.034
            elif index % 2 == 0:
                length, half_width = radius * 0.120, radius * 0.030
            else:
                length, half_width = radius * 0.080, radius * 0.025
            outer = radius * 0.690
            draw_tick(draw, cx, cy, angle, outer - length, outer, half_width)

    needle_length = radius * 0.610
    needle_half = radius * 0.088
    tip = polar_point(cx, cy, 45, needle_length)
    tail = polar_point(cx, cy, 225, needle_length)
    side_a = polar_point(cx, cy, 135, needle_half)
    side_b = polar_point(cx, cy, 315, needle_half)
    outline = max(1, int(radius * 0.012))
    draw.polygon([tail, side_a, side_b], fill=SAFARI_NEEDLE_LIGHT + (255,),
                 outline=(214, 222, 234, 255), width=outline)
    draw.polygon([tip, side_a, side_b], fill=SAFARI_NEEDLE + (255,),
                 outline=(255, 255, 255, 255), width=outline)

    hub = radius * 0.060
    draw.ellipse((cx - hub, cy - hub, cx + hub, cy + hub),
                 fill=(255, 255, 255, 255), outline=(203, 212, 226, 255),
                 width=max(1, int(radius * 0.014)))

    return layer


def render_master(detailed=True, badge=False):
    size = 1024
    square = gradient(size, BLUE, VIOLET)
    mask = rounded_mask(size, (0, 0, size - 1, size - 1), 232)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(square, (0, 0), mask)

    if not detailed:
        # 32px and below: a single white 文 reads better than tiny marks.
        if badge:
            font = load_font(HIragino, 390, index=2)
            glyphs = [("文", font, (450, 462))]
        else:
            font = load_font(HIragino, 720, index=2)
            glyphs = [("文", font, (512, 512))]
        shade = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shade.paste((255, 255, 255, 255), (0, 0), text_mask(size, glyphs))
        out.alpha_composite(shade)
        if badge:
            out.alpha_composite(safari_badge(size, 790, 790, 140, ticks=False))
        return out

    bubble = bubble_mask(size, True)
    shadow = bubble.filter(ImageFilter.GaussianBlur(22))
    shadow_layer = Image.new("RGBA", (size, size), (10, 22, 70, 70))
    shadow_layer.putalpha(shadow.point(lambda v: int(v * 0.5)))
    out.alpha_composite(shadow_layer, (0, 12))

    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    out.paste(white, (0, 0), bubble)

    text_gradient = gradient(size, (26, 82, 235), (116, 74, 245))
    wen = load_font(HIragino, 344, index=2)
    latin = load_font(HELVETICA, 268, index=1)
    glyphs = [
        ("文", wen, (400, 474)),
        ("A", latin, (662, 492)),
    ]
    out.paste(text_gradient, (0, 0), text_mask(size, glyphs))

    # Soft top-light falloff instead of a hard highlight band.
    ramp = np.clip(30 * (1 - np.arange(size)[:, None] / (size * 0.55)), 0, 30)
    alpha = np.repeat(ramp, size, axis=1).astype(np.uint8)
    highlight = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    highlight.putalpha(Image.fromarray(alpha, "L"))
    highlight.putalpha(
        Image.composite(highlight.getchannel("A"), Image.new("L", (size, size), 0), mask)
    )
    out.alpha_composite(highlight)
    if badge:
        out.alpha_composite(safari_badge(size, 795, 795, 136, ticks=True))
    return out


def downscale(master, size):
    return master.resize((size, size), Image.LANCZOS)


def app_icon(master):
    """macOS app icon: content inset on a 1024 canvas with a soft shadow."""
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    content = master.resize((824, 824), Image.LANCZOS)
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    alpha = content.getchannel("A").point(lambda v: int(v * 0.55))
    shadow.paste((12, 20, 48, 255), (100, 118), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(content, (100, 100))
    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xcode", metavar="APP_DIR", help="Xcode app source directory")
    args = parser.parse_args()

    detailed = render_master(True, badge=True)
    compact = render_master(False, badge=True)
    simple = render_master(False, badge=False)
    app = app_icon(detailed)

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    sizes = [16, 32, 48, 64, 128, 256, 512]
    for size in sizes:
        if size <= 16:
            source = simple
        elif size <= 32:
            source = compact
        else:
            source = detailed
        icon = downscale(source, size)
        icon.save(ICON_DIR / f"icon-{size}.png", optimize=True)
        print(f"extension/icons/icon-{size}.png")

    if args.xcode:
        app_dir = Path(args.xcode).expanduser().resolve()
        icon_set = app_dir / "Assets.xcassets" / "AppIcon.appiconset"
        icon_set.mkdir(parents=True, exist_ok=True)

        specs = [
            ("mac-icon-16@1x.png", 16),
            ("mac-icon-16@2x.png", 32),
            ("mac-icon-32@1x.png", 32),
            ("mac-icon-32@2x.png", 64),
            ("mac-icon-128@1x.png", 128),
            ("mac-icon-128@2x.png", 256),
            ("mac-icon-256@1x.png", 256),
            ("mac-icon-256@2x.png", 512),
            ("mac-icon-512@1x.png", 512),
            ("mac-icon-512@2x.png", 1024),
        ]
        for name, px in specs:
            app.resize((px, px), Image.LANCZOS).save(icon_set / name, optimize=True)
            print(f"{icon_set.name}/{name}")

        resources = app_dir / "Resources"
        resources.mkdir(parents=True, exist_ok=True)
        app.resize((256, 256), Image.LANCZOS).save(resources / "Icon.png", optimize=True)
        print("Resources/Icon.png")

    app.resize((512, 512), Image.LANCZOS).save(ROOT / "extension" / "icons" / "icon-512.png", optimize=True)


if __name__ == "__main__":
    main()
