#!/usr/bin/env python3
"""Draw the toolbar icon: a pink circle, corner marks, a sparkle, and a capital A."""

import math
import struct
import zlib
from pathlib import Path

PINK = (200, 96, 122, 255)
WHITE = (255, 255, 255, 255)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, width, height, pixels):
    raw = b"".join(b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def blend(dst, src):
    sr, sg, sb, sa = src
    if sa <= 0:
        return dst
    dr, dg, db, da = dst
    amount = sa / 255
    out_a = sa + da * (1 - amount)
    if out_a <= 0:
        return (0, 0, 0, 0)
    def mix(s, d):
        return int((s * sa + d * da * (1 - amount)) / out_a)
    return (mix(sr, dr), mix(sg, dg), mix(sb, db), int(out_a))


def coverage(distance, radius):
    return max(0.0, min(1.0, radius - distance + 0.5))


def seg_dist(px, py, x1, y1, x2, y2):
    vx, vy = x2 - x1, y2 - y1
    length = vx * vx + vy * vy or 1
    t = max(0.0, min(1.0, ((px - x1) * vx + (py - y1) * vy) / length))
    dx, dy = px - (x1 + t * vx), py - (y1 + t * vy)
    return math.hypot(dx, dy)


def star_dist(px, py, cx, cy, outer, inner):
    best = 1e9
    points = []
    for i in range(8):
        angle = -math.pi / 2 + i * math.pi / 4
        radius = outer if i % 2 == 0 else inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    for i in range(8):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % 8]
        # Filled star: approximate with distance to the four long rays.
    for i in range(0, 8, 2):
        x, y = points[i]
        best = min(best, seg_dist(px, py, cx, cy, x, y))
    return best


def draw(size):
    pixels = bytearray(size * size * 4)
    center = (size - 1) / 2
    radius = size * 0.46

    def put(x, y, color, alpha):
        if x < 0 or y < 0 or x >= size or y >= size or alpha <= 0:
            return
        index = (y * size + x) * 4
        current = tuple(pixels[index : index + 4])
        mixed = blend(current, (*color[:3], int(color[3] * alpha)))
        pixels[index : index + 4] = bytes(mixed)

    for y in range(size):
        for x in range(size):
            dist = math.hypot(x - center, y - center)
            alpha = coverage(dist, radius)
            if alpha > 0:
                put(x, y, PINK, alpha)

    stroke = max(1.2, size * 0.045)
    arm = size * 0.16
    inset = size * 0.22
    corners = [
        (inset, inset, 1, 1),
        (size - 1 - inset, inset, -1, 1),
        (size - 1 - inset, size - 1 - inset, -1, -1),
        (inset, size - 1 - inset, 1, -1),
    ]
    spark_c = (size * 0.36, size * 0.34)
    for y in range(size):
        for x in range(size):
            mark = 0
            for cx, cy, sx, sy in corners:
                mark = max(mark, coverage(seg_dist(x, y, cx, cy, cx + sx * arm, cy), stroke))
                mark = max(mark, coverage(seg_dist(x, y, cx, cy, cx, cy + sy * arm), stroke))
            mark = max(mark, coverage(star_dist(x, y, *spark_c, size * 0.075, size * 0.03), stroke * 0.72))
            # Capital A
            ax, ay = size * 0.64, size * 0.60
            aw, ah = size * 0.11, size * 0.20
            mark = max(mark, coverage(seg_dist(x, y, ax, ay + ah, ax + aw / 2, ay), stroke))
            mark = max(mark, coverage(seg_dist(x, y, ax + aw, ay + ah, ax + aw / 2, ay), stroke))
            mark = max(mark, coverage(seg_dist(x, y, ax + aw * 0.18, ay + ah * 0.62, ax + aw * 0.82, ay + ah * 0.62), stroke))
            if mark > 0:
                put(x, y, WHITE, mark)
    return pixels


def main():
    out = Path(__file__).resolve().parents[1] / "icons"
    out.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(out / f"icon{size}.png", size, size, draw(size))


if __name__ == "__main__":
    main()
