"""Regenerate the extension icons from the mark.

    python tools/make-icons.py

An icon nobody can regenerate is an icon that rots the first time the palette
moves, so this lives in the repository rather than in someone's downloads.
Needs Pillow, which is the only thing in this project that is not standard
library. Nothing at runtime depends on it: the PNGs it writes are committed.

The mark is a one-time-code field. Three rounded cells, the first two dimmed and
the third filled, with a caret in the filled one at the sizes that can hold it.
A padlock is what every security product uses and it says "security" rather than
saying what this does.
"""

from PIL import Image, ImageDraw
from pathlib import Path

ACCENT = (99, 102, 241)      # indigo-500, the one value legible on light and dark chrome
PLATE = (28, 26, 33)         # --surface dark, the ground the mark is designed against
DIM = 0.55                   # the cells not yet filled; below about 0.4 they vanish on dark

OUT = Path(__file__).resolve().parent.parent / "icons"


def mark(size, plate=False, caret=True, supersample=8):
    """Drawn large and shrunk, which is what gives clean curves.

    Large sizes get a plate: a store listing shows the 128 on a white card,
    where a transparent mark made of thin elements reads as unfinished. The
    toolbar sizes stay transparent so they sit on the browser's own chrome.
    """
    s = size * supersample
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 24

    if plate:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=round(5.2 * u), fill=PLATE + (255,))

    w, h, gap = 6 * u, 7 * u, 1.6 * u
    x = (s - (3 * w + 2 * gap)) / 2
    y0 = (s - h) / 2
    r = max(1, round(1.5 * u))

    last = x
    for i in range(3):
        alpha = 255 if i == 2 else round(255 * DIM)
        d.rounded_rectangle([x, y0, x + w, y0 + h], radius=r, fill=ACCENT + (alpha,))
        last = x
        x += w + gap

    if caret:
        cx, cw, ch = last + w / 2, 1.1 * u, 3.6 * u
        box = [cx - cw / 2, y0 + (h - ch) / 2, cx + cw / 2, y0 + (h + ch) / 2]
        rr = max(1, round(0.4 * u))
        # Punched through rather than painted on, so on a plateless icon the cut
        # shows whatever chrome is behind instead of a guessed background.
        d.rounded_rectangle(box, radius=rr, fill=(PLATE + (255,)) if plate else (0, 0, 0, 0))

    return img.resize((size, size), Image.LANCZOS)


def mark16():
    """Two cells, not three, on whole pixels.

    Sixteen pixels leaves fourteen usable. Three cells across that is four
    pixels each with sub-pixel gaps, which blur into one grey block at exactly
    the size where the icon most needs to be recognisable. Simplifying the
    smallest size is ordinary practice, not a compromise.
    """
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = 1
    for i in range(2):
        alpha = 255 if i == 1 else round(255 * DIM)
        d.rounded_rectangle([x, 4, x + 5, 11], radius=1, fill=ACCENT + (alpha,))
        x += 8
    return img


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    mark16().save(OUT / "icon16.png")
    mark(32, plate=False, caret=False).save(OUT / "icon32.png")
    mark(48, plate=True).save(OUT / "icon48.png")
    mark(128, plate=True).save(OUT / "icon128.png")
    for n in (16, 32, 48, 128):
        print(f"  wrote icons/icon{n}.png")
