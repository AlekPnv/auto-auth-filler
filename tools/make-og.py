"""Regenerate the Open Graph card at site/og-image.png.

    python tools/make-og.py

This is the image that appears when the site is pasted into a chat, a post or a
search result, so it carries the mark and the palette and has to stay in step
with them. Needs Pillow. Nothing at runtime depends on it: the PNG is committed.

Fonts come from the Windows font directory, which is where this project is
developed. On another machine, point FONT_DIR somewhere with a usable sans.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys

W, H = 1200, 630
BG = (20, 19, 23)            # --bg dark
TEXT = (236, 233, 240)       # --text dark
MUTED = (163, 158, 174)      # --muted dark
ACCENT = (139, 134, 255)     # --accent dark
DIM = 0.55

FONT_DIR = Path("C:/Windows/Fonts")
OUT = Path(__file__).resolve().parent.parent / "site" / "og-image.png"


def font(name, size):
    path = FONT_DIR / name
    if not path.exists():
        sys.exit(f"font not found: {path}. Point FONT_DIR at a directory with a sans face.")
    return ImageFont.truetype(str(path), size)


def draw_mark(img, cx, cy, cell_w, cell_h, gap, radius):
    """The same three cells as the icons, at whatever size the card wants."""
    d = ImageDraw.Draw(img)
    span = 3 * cell_w + 2 * gap
    x = cx - span / 2
    y0 = cy - cell_h / 2
    for i in range(3):
        alpha = 255 if i == 2 else round(255 * DIM)
        d.rounded_rectangle([x, y0, x + cell_w, y0 + cell_h],
                            radius=radius, fill=ACCENT + (alpha,))
        x += cell_w + gap
    # The caret, cut into the filled cell exactly as the large icons do.
    last = cx - span / 2 + 2 * (cell_w + gap)
    cw, ch = cell_w * 0.18, cell_h * 0.52
    ccx = last + cell_w / 2
    d.rounded_rectangle([ccx - cw / 2, cy - ch / 2, ccx + cw / 2, cy + ch / 2],
                        radius=max(1, round(cw / 3)), fill=BG + (255,))


def main():
    # Drawn at 2x and shrunk, which keeps the curves and the type clean.
    s = 2
    img = Image.new("RGBA", (W * s, H * s), BG + (255,))
    d = ImageDraw.Draw(img)

    draw_mark(img, W * s / 2, 212 * s, 54 * s, 64 * s, 14 * s, 13 * s)

    title = font("seguisb.ttf", 76 * s)
    sub = font("segoeui.ttf", 33 * s)
    foot = font("segoeui.ttf", 26 * s)

    def centred(text, f, y, fill):
        box = d.textbbox((0, 0), text, font=f)
        d.text(((W * s - (box[2] - box[0])) / 2 - box[0], y), text, font=f, fill=fill)

    centred("Auto Auth Filler", title, 300 * s, TEXT + (255,))
    centred("The verification code from your Gmail, typed in for you", sub, 406 * s, MUTED + (255,))
    # "nothing leaves your browser" is the claim the FAQ makes and then
    # immediately qualifies: the extension does talk to Google's API to read
    # your mail. A card has no room for the qualification, so it says the part
    # that is unconditionally true instead.
    centred("Firefox and Chrome  ·  open source  ·  no server, no account, no analytics",
            foot, 492 * s, MUTED + (255,))

    img.resize((W, H), Image.LANCZOS).convert("RGB").save(OUT)
    print(f"  wrote {OUT.relative_to(OUT.parent.parent)} at {W}x{H}")


if __name__ == "__main__":
    main()
