"""List the separate objects (connected blobs) of a transparent asset sheet.

Usage: python -I tools/extract_blobs.py <sheet.png> <overlay.jpg>
Prints one line per blob: index, x, y, w, h (reading order) and writes an
overlay with the indices so blobs can be named in tools/env_assets.json.
"""
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def blobs(path, min_area=600, merge=6):
    a = np.asarray(Image.open(path).convert('RGBA'))
    mask = a[..., 3] > 60
    grown = ndimage.binary_dilation(mask, iterations=merge)
    lab, n = ndimage.label(grown)
    boxes = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl
        sub = mask[ys, xs]
        if sub.sum() < min_area:
            continue
        yy, xx = np.where(sub)
        boxes.append([int(xs.start + xx.min()), int(ys.start + yy.min()),
                      int(xx.max() - xx.min() + 1), int(yy.max() - yy.min() + 1)])
    # reading order: group by rows of similar center y
    boxes.sort(key=lambda b: b[1] + b[3] / 2)
    rows, cur = [], []
    for b in boxes:
        if cur and (b[1] + b[3] / 2) - (cur[0][1] + cur[0][3] / 2) > 60:
            rows.append(cur)
            cur = []
        cur.append(b)
    if cur:
        rows.append(cur)
    return [b for r in rows for b in sorted(r, key=lambda b: b[0])]


if __name__ == '__main__':
    src, overlay = sys.argv[1], sys.argv[2]
    bs = blobs(src)
    im = Image.open(src).convert('RGBA')
    bg = Image.new('RGBA', im.size, (70, 70, 70, 255))
    bg.alpha_composite(im)
    d = ImageDraw.Draw(bg)
    for i, (x, y, w, h) in enumerate(bs):
        d.rectangle([x, y, x + w, y + h], outline=(255, 0, 0, 255), width=2)
        d.rectangle([x, y, x + 34, y + 22], fill=(0, 0, 0, 255))
        d.text((x + 4, y + 4), str(i), fill=(255, 255, 0, 255))
        print(i, x, y, w, h)
    rgb = bg.convert('RGB')
    rgb.thumbnail((1100, 1100))
    rgb.save(overlay, quality=80)
