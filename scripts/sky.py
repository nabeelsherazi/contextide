"""Renders ContextIDE's two backdrops: an open day sky with soft, sunlit cumulus, and a deep warm night
with a scatter of stars. Oil painting in spirit only (deep pigments, one warm light, luminous glazes,
soft edges); the surfaces stay smooth and digital, with no brush or canvas texture.

    python3 scripts/sky.py        # writes public/sky/day.webp and public/sky/night.webp

Needs numpy and Pillow. The output is committed, so this only runs when the look changes.
"""
import os
import sys

import numpy as np
from PIL import Image

W, H = 2560, 1600
S = W / 1920  # the compositions below are laid out at 1920 wide
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "sky")


def smooth_noise(w, h, cells, seed):
    r = np.random.default_rng(seed)
    g = r.random((max(2, int(h / w * cells)) + 2, cells + 2)).astype(np.float32)
    im = Image.fromarray(g, "F").resize((w + 2 * w // cells, h + 2 * w // cells), Image.BICUBIC)
    return np.asarray(im)[w // cells : w // cells + h, w // cells : w // cells + w]


def fbm(base, octaves, seed, gain=0.5):
    out = np.zeros((H, W), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * smooth_noise(W, H, base * 2**o, seed + o * 31)
        tot += amp
        amp *= gain
    return out / tot


def blur(a, r):
    """A gaussian-ish blur (three box passes along each axis)."""
    r = max(1, int(r))
    k = np.ones(2 * r + 1, np.float32) / (2 * r + 1)
    for _ in range(3):
        a = np.apply_along_axis(lambda m: np.convolve(np.pad(m, r, mode="edge"), k, "valid"), 1, a)
        a = np.apply_along_axis(lambda m: np.convolve(np.pad(m, r, mode="edge"), k, "valid"), 0, a)
    return a


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], np.float32)


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) else t
    return a * (1 - t) + b * t


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def glow(cx, cy, rx, ry):
    """A soft elliptical pool of light, 1 at the centre."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    return np.exp(-d)


def save(rgb, name, quality):
    os.makedirs(OUT, exist_ok=True)
    # a whisper of dither, below what the eye reads as grain, so the long gradients don't band
    rgb = rgb + np.random.default_rng(1).uniform(-0.6, 0.6, rgb.shape)
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    path = os.path.join(OUT, name)
    im.save(path, "WEBP", quality=quality, method=6)
    print(path, os.path.getsize(path) // 1024, "KB")


def cumulus(heaps, seed):
    """A height field of cumulus heaps: clusters of spheres with flattened bellies."""
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    h = np.zeros((H, W), np.float32)
    for cx, base_y, width, tall in heaps:
        for _ in range(int(18 + width / 9)):
            # many small spheres piled towards the middle of the heap, lower on its shoulders
            u = float(np.clip(r.normal(0, 0.3), -0.5, 0.5))
            x = cx + u * width
            rad = tall * (0.14 + 0.2 * r.random()) * (1 - abs(u) * 0.9)
            y = base_y - rad - (tall - rad * 1.6) * r.random() ** 0.8 * (1 - abs(u) * 1.6)
            dome = np.sqrt(np.maximum(0, rad * rad - ((xx - x) ** 2 + (yy - y) ** 2)))
            dome[yy > base_y + rad * 0.15] = 0  # flat underside
            h = np.maximum(h, dome)
    return h


def day():
    yy = np.linspace(0, 1, H)[:, None] * np.ones((1, W))
    # ultramarine overhead, thinning to a pale, warm horizon
    top, mid, low = hexrgb("#1d4f9c"), hexrgb("#3f7fcb"), hexrgb("#a9c6e6")
    sky = mix(mix(top, mid, smoothstep(0, 0.55, yy)), low, smoothstep(0.45, 1.1, yy))
    sky = sky + glow(W * 0.12, -H * 0.1, W * 0.5, H * 0.45)[..., None] * np.array([40, 34, 22], np.float32)  # the sun, off-frame

    heaps = [
        (140, 1260, 620, 640), (700, 1300, 560, 420), (1250, 1260, 500, 300), (1800, 1250, 520, 520),
        (420, 600, 420, 220), (1040, 760, 300, 140), (1580, 480, 300, 150), (60, 820, 300, 230),
        (1880, 820, 320, 210), (820, 330, 220, 90), (1300, 230, 160, 60),
    ]
    h = cumulus([tuple(v * S for v in hp) for hp in heaps], 11)
    edge = (fbm(18, 3, 13) - 0.5) * 30  # soft, irregular silhouettes
    dens = smoothstep(0, 46 * S, h + edge * S * smoothstep(0, 40, h) - 4)
    dens = blur(dens, 1)
    hs = blur(h, 16 * S)
    gy, gx = np.gradient(hs)
    norm = np.sqrt(gx * gx + gy * gy + 1)
    lit = np.clip((gx * -0.45 + gy * -0.75 + 0.5) / norm, 0, 1)  # light from the upper left
    lit = np.clip(lit * 1.15 - 0.1 + smoothstep(20 * S, 160 * S, hs) * 0.1, 0, 1)
    cream, warm, shade, deep = hexrgb("#f3ead9"), hexrgb("#fff6e6"), hexrgb("#b4c0d2"), hexrgb("#8a9cb8")
    cloud = mix(mix(deep, shade, smoothstep(0.0, 0.45, lit)), mix(cream, warm, smoothstep(0.8, 1, lit)), smoothstep(0.35, 0.85, lit))
    cloud = mix(cloud, sky * 0.35 + cloud * 0.65, smoothstep(0.75, 0.25, yy) * 0.5)  # far clouds take on the sky
    save(mix(sky, cloud, dens), "day.webp", 82)


def stars(rgb, n_faint, n_bright, seed):
    """Fine points of light, a few with long cross glints."""
    r = np.random.default_rng(seed)
    out = rgb.copy()
    tints = [hexrgb("#fff3dc"), hexrgb("#ffe2b8"), hexrgb("#dfe7ff"), hexrgb("#ffc890"), hexrgb("#ffffff")]

    def dab(x, y, rad, col, gain):
        x0, x1 = int(max(0, x - rad * 4)), int(min(W, x + rad * 4 + 1))
        y0, y1 = int(max(0, y - rad * 4)), int(min(H, y + rad * 4 + 1))
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        g = np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * rad * rad)) * gain / 255
        out[y0:y1, x0:x1] += g[..., None] * col

    for _ in range(n_faint):
        b = r.random() ** 4
        dab(r.random() * W, r.random() * H, 0.5 + b * 0.55, tints[r.integers(len(tints))], 30 + b * 210)
    for _ in range(n_bright):
        x, y = r.random() * W, r.random() * H
        col = tints[r.integers(len(tints))]
        size = 8 + r.random() * 14
        dab(x, y, 1.15, col, 300)
        dab(x, y, 4.5, col, 22)  # halo
        x0, x1 = int(max(0, x - size)), int(min(W, x + size + 1))
        y0, y1 = int(max(0, y - size)), int(min(H, y + size + 1))
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        dx, dy = np.abs(xx - x), np.abs(yy - y)
        spike = np.exp(-dy * dy / 0.5) * np.clip(1 - dx / size, 0, 1) ** 2 + np.exp(-dx * dx / 0.5) * np.clip(1 - dy / size, 0, 1) ** 2
        out[y0:y1, x0:x1] += (spike * 170)[..., None] * col / 255
    return out


def night():
    yy = np.linspace(0, 1, H)[:, None] * np.ones((1, W))
    # a warm umber black: one low lamp-glow from below, a cold ultramarine depth overhead
    base = mix(hexrgb("#0a090c"), hexrgb("#120d0a"), yy)
    base = base + glow(W * 0.78, H * 1.15, W * 0.55, H * 0.45)[..., None] * np.array([46, 26, 10], np.float32)
    base = base + glow(W * 0.15, -H * 0.15, W * 0.6, H * 0.5)[..., None] * np.array([6, 12, 30], np.float32)
    base = base + (fbm(2, 3, 41) - 0.5)[..., None] * np.array([10, 7, 5], np.float32)  # a soft unevenness, like layered glaze
    save(stars(base, int(2000 * S * S), 24, 3), "night.webp", 80)


if __name__ == "__main__":
    which = sys.argv[1:] or ["day", "night"]
    if "day" in which:
        day()
    if "night" in which:
        night()
