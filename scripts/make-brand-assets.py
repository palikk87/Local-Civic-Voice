"""
AYE & NAY brand assets.

Rebuilds the social-preview images and the favicon around the app's real mark
(apps/web/src/components/civic/Seal.tsx — three arcs for the three branches
around a central node) and the real brand type (Fraunces for the wordmark,
Public Sans for everything else). Colours come from the dark-theme tokens in
apps/web/src/index.css.

Everything is drawn at 4x and downsampled, so edges and arcs stay clean.

WHY THIS IS A SCRIPT AND NOT FOUR CHECKED-IN BINARIES. A PNG in a repository is
a dead end: nobody can tell what produced it, whether it still matches the mark
in the app, or how to make the next one. This is re-runnable, so a change to the
Seal or to the palette is one command away from being reflected everywhere, and
the reasoning behind the small decisions — why the favicon is drawn separately
at each size, why the node disappears at 16px — survives in the place that makes
them.

    bun run brand-assets          (from the repository root)

or directly:

    pip install Pillow
    python3 scripts/make-brand-assets.py

FONTS. Both are open-licensed and are not vendored here; the script fetches them
on first run into a cache directory. Override with FRAUNCES_TTF / PUBLIC_SANS_TTF
if you already have them.
"""

import os
import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ModuleNotFoundError:
    sys.exit("Pillow is needed to draw these. Install it with: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
FONT_CACHE = Path(os.environ.get("BRAND_FONT_CACHE", ROOT / ".brand-fonts"))

# Google Fonts, OFL. Pinned to the variable originals so the wordmark's weight
# and optical size are set by axis rather than by picking a static cut.
FONT_SOURCES = {
    "Fraunces[SOFT,WONK,opsz,wght].ttf":
        "https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/"
        "Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf",
    "PublicSans[wght].ttf":
        "https://raw.githubusercontent.com/google/fonts/main/ofl/publicsans/"
        "PublicSans%5Bwght%5D.ttf",
}


def font_file(name: str, override_env: str) -> str:
    """The font, from an override, the cache, or the web — in that order."""
    override = os.environ.get(override_env)
    if override:
        return override

    path = FONT_CACHE / name
    if not path.exists():
        FONT_CACHE.mkdir(parents=True, exist_ok=True)
        url = FONT_SOURCES[name]
        print(f"fetching {name}")
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as error:
            sys.exit(
                f"Could not fetch {name}: {error}\n"
                f"Download it from {url} and point {override_env} at it."
            )
    return str(path)


FRAUNCES = font_file("Fraunces[SOFT,WONK,opsz,wght].ttf", "FRAUNCES_TTF")
PUBLIC_SANS = font_file("PublicSans[wght].ttf", "PUBLIC_SANS_TTF")

BG = (15, 23, 42)            # --background  slate-900 #0F172A
FG = (226, 232, 240)         # slate-200
MUTED = (148, 163, 184)      # slate-400
CARD = (23, 35, 58)          # --card
BORDER = (51, 65, 85)        # slate-700
AMBER = (245, 158, 11)       # --accent #F59E0B

# wordmark gradient: deep orange -> amber -> gold
GRAD = [(0.00, (218, 88, 30)), (0.45, (245, 158, 11)), (1.00, (240, 204, 122))]

SS = 4  # supersample factor


def fraunces(size, wght=900, opsz=144, soft=0, wonk=1):
    f = ImageFont.truetype(FRAUNCES, size)
    f.set_variation_by_axes([opsz, wght, soft, wonk])
    return f


def public_sans(size, wght=500):
    f = ImageFont.truetype(PUBLIC_SANS, size)
    f.set_variation_by_axes([wght])
    return f


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_at(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(GRAD) - 1):
        t0, c0 = GRAD[i]
        t1, c1 = GRAD[i + 1]
        if t0 <= t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return GRAD[-1][1]


def horizontal_gradient(size):
    w, h = size
    img = Image.new("RGB", (w, 1))
    px = img.load()
    for x in range(w):
        px[x, 0] = gradient_at(x / max(1, w - 1))
    return img.resize((w, h), Image.NEAREST)


def radial_glow(size, center, radius, colour, strength=0.30):
    """A soft amber bloom, drawn small and scaled up so it is genuinely smooth."""
    w, h = size
    small = max(2, w // 16), max(2, h // 16)
    g = Image.new("L", small, 0)
    d = ImageDraw.Draw(g)
    cx, cy = center[0] * small[0] / w, center[1] * small[1] / h
    r = radius * small[0] / w
    steps = 42
    for i in range(steps, 0, -1):
        t = i / steps
        rr = r * t
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=int(255 * (1 - t) ** 2))
    g = g.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(w / 60))
    layer = Image.new("RGB", (w, h), colour)
    mask = g.point(lambda v: int(v * strength))
    return layer, mask


def draw_seal(size, colour=AMBER, detail="full"):
    """
    The Seal mark from components/civic/Seal.tsx, on a 48-unit grid.

    detail="full"   faithful to the component: outer ring plus three arcs at
                    100/70/50% opacity.
    detail="bold"   no outer ring, arcs opened up and thickened — what the
                    mark needs at 32-48px before the faint strokes vanish.
    detail="tiny"   16px. Two fat arcs and no node — the node and the arcs
                    collide at that size and the whole thing turns to porridge.
    """
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = n / 48.0                      # one SVG unit in pixels
    cx = cy = 24 * u

    def box(r):
        return [cx - r, cy - r, cx + r, cy + r]

    def rgba(alpha):
        return colour + (round(255 * alpha),)

    if detail == "full":
        # outer ring, r=22 stroke 1.5 opacity .35
        d.ellipse(box(22 * u), outline=rgba(0.35), width=max(1, round(1.5 * u)))
        w3 = max(1, round(3 * u))
        # three arcs, r=18. PIL angles: 0deg = 3 o'clock, clockwise.
        d.arc(box(18 * u), -90, -30, fill=rgba(1.00), width=w3)   # 24,6 -> 39.6,15
        d.arc(box(18 * u), 30, 150, fill=rgba(0.70), width=w3)    # 39.6,33 -> 8.4,33
        d.arc(box(18 * u), -150, -90, fill=rgba(0.50), width=w3)  # 8.4,15 -> 24,6
        d.ellipse(box(5 * u), fill=rgba(1.0))                     # the citizen

    elif detail == "bold":
        w3 = max(2, round(5 * u))
        r = 17 * u
        d.arc(box(r), -95, -25, fill=rgba(1.00), width=w3)
        d.arc(box(r), 25, 155, fill=rgba(0.85), width=w3)
        d.arc(box(r), -155, -85, fill=rgba(0.70), width=w3)
        d.ellipse(box(6.5 * u), fill=rgba(1.0))

    else:  # tiny
        # At 16px the node and the arcs collide into a blob, so the node goes and
        # the two arcs carry the silhouette on their own.
        w3 = max(2, round(7 * u))
        r = 14 * u
        d.arc(box(r), -105, -15, fill=rgba(1.0), width=w3)
        d.arc(box(r), 15, 165, fill=rgba(1.0), width=w3)

    return img.resize((size, size), Image.LANCZOS)


def fit_font(text, target_w, maker, lo=10, hi=2400):
    """Largest size whose rendered width fits target_w."""
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        f = maker(mid)
        w = f.getbbox(text)[2] - f.getbbox(text)[0]
        if w <= target_w:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return maker(best)


def text_gradient(draw_size, text, font, xy, anchor="ls"):
    """Text filled with the brand gradient, returned as an RGBA layer."""
    mask = Image.new("L", draw_size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=font, fill=255, anchor=anchor)
    bbox = mask.getbbox()
    grad = Image.new("RGB", draw_size, GRAD[0][1])
    if bbox:
        span = horizontal_gradient((bbox[2] - bbox[0], draw_size[1]))
        grad.paste(span, (bbox[0], 0))
    out = Image.new("RGBA", draw_size, (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def tracked_text(draw, xy, text, font, fill, tracking, anchor_left=True):
    """Letter-spaced text. Returns the advance width."""
    x, y = xy
    total = sum(font.getlength(c) for c in text) + tracking * (len(text) - 1)
    if not anchor_left:
        x -= total
    for c in text:
        draw.text((x, y), c, font=font, fill=fill, anchor="ls")
        x += font.getlength(c) + tracking
    return total


def build_og(width, height, path, tagline="Your voice on every bill, order, and ruling"):
    W, H = width * SS, height * SS
    s = width / 1200.0 * SS          # scale everything off the 1200-wide design

    img = Image.new("RGB", (W, H), BG)

    # amber bloom behind the mark, and a cool lift in the bottom-left
    seal_cx, seal_cy = W - 250 * s, H / 2
    layer, mask = radial_glow((W, H), (seal_cx, seal_cy), 420 * s, (245, 158, 11), 0.22)
    img.paste(layer, (0, 0), mask)
    layer, mask = radial_glow((W, H), (120 * s, H), 700 * s, (30, 58, 95), 0.35)
    img.paste(layer, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # hairline frame
    d.rectangle([0, 0, W - 1, H - 1], outline=BORDER + (0,), width=0)

    left = 88 * s
    col_w = (W - 470 * s) - left      # text column stops clear of the mark

    # wordmark — fit to the column, then let the tagline fit the same width
    wm_font = fit_font("AYE & NAY", col_w, lambda px: fraunces(px, wght=900, opsz=144))
    wm_box = wm_font.getbbox("AYE & NAY")          # (x0, y0, x1, y1) from baseline-top
    wm_ascent = -wm_font.getbbox("AYE & NAY", anchor="ls")[1]

    tag_font = public_sans(round(34 * s), wght=500)
    tag_w = tag_font.getlength(tagline)
    if tag_w > col_w:
        tag_font = fit_font(tagline, col_w, lambda px: public_sans(px, wght=500))

    gap_tag = 74 * s
    gap_pills = 56 * s
    ph = 46 * s
    block_h = wm_ascent + gap_tag + gap_pills + ph
    top = (H - block_h) / 2 - 8 * s               # a touch of optical lift

    baseline_y = top + wm_ascent
    wm = text_gradient((W, H), "AYE & NAY", wm_font, (left, baseline_y))
    img.paste(wm, (0, 0), wm)

    # tagline
    d.text((left, baseline_y + gap_tag), tagline, font=tag_font, fill=FG, anchor="ls")

    # branch pills
    pill_font = public_sans(round(19 * s), wght=600)
    px_ = left
    py = baseline_y + gap_tag + gap_pills
    for label in ("CONGRESS", "EXECUTIVE", "SUPREME COURT"):
        tw = sum(pill_font.getlength(c) for c in label) + 1.6 * s * (len(label) - 1)
        pw = tw + 44 * s
        d.rounded_rectangle([px_, py, px_ + pw, py + ph], radius=ph / 2,
                            fill=CARD, outline=BORDER, width=max(1, round(1.5 * s)))
        tracked_text(d, (px_ + 22 * s, py + ph / 2 + 7 * s), label, pill_font, MUTED, 1.6 * s)
        px_ += pw + 14 * s

    # the mark
    seal_px = round(300 * s)
    seal = draw_seal(seal_px)
    img.paste(seal, (round(seal_cx - seal_px / 2), round(seal_cy - seal_px / 2)), seal)

    img = img.resize((width, height), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)
    return path


def build_favicon(path):
    """The Seal on a dark rounded square — legible down to 16px."""
    layers = {}
    for size in (256, 128, 64, 48, 32, 16):
        n = size * SS
        img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        radius = n * (0.26 if size >= 48 else 0.20)
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=radius, fill=BG + (255,))
        detail = "full" if size >= 64 else ("bold" if size >= 32 else "tiny")
        inset = 0.13 if size >= 64 else (0.10 if size >= 32 else 0.08)
        seal_px = round(n * (1 - 2 * inset))
        seal = draw_seal(seal_px, detail=detail)
        img.paste(seal, (round(n * inset), round(n * inset)), seal)
        layers[size] = img.resize((size, size), Image.LANCZOS)

    # Written by hand: Pillow's ICO writer downsamples one source image, which
    # would throw away the per-size drawings above. PNG-in-ICO, Vista onwards.
    import io, struct
    blobs = []
    for size in sorted(layers):
        buf = io.BytesIO()
        layers[size].save(buf, "PNG", optimize=True)
        blobs.append((size, buf.getvalue()))
    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries, data = b"", b""
    for size, blob in blobs:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                               1, 32, len(blob), offset)
        offset += len(blob)
        data += blob
    with open(path, "wb") as fh:
        fh.write(header + entries + data)
    return path


if __name__ == "__main__":
    web = ROOT / "apps" / "web" / "public"
    mobile = ROOT / "apps" / "mobile" / "public"
    for directory in (web, mobile):
        directory.mkdir(parents=True, exist_ok=True)

    # The web app's link preview, at 1x and 2x. index.html references both.
    print(build_og(1200, 630, str(web / "og-aye-and-nay.png")))
    print(build_og(2400, 1260, str(web / "og-aye-and-nay@2x.png")))

    # apps/mobile/public/index.html serves /og-base.png as its og:image. That
    # file shipped as the old host platform's pastel wordmark, so every
    # mobile-web link preview carried another company's branding. Different
    # aspect ratio from the web pair, and a different line, because it is the
    # preview for the app rather than for the site.
    print(build_og(1200, 628, str(mobile / "og-base.png"),
                   "Read what your government is actually doing"))

    print(build_favicon(str(web / "favicon.ico")))
