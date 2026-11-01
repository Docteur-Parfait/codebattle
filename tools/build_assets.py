"""Build game-ready sprite atlases from the AI-generated sprite sheets.

The sheets are not on a strict grid, so for every row we know how many frames
to expect (from the generation prompts) and look for the emptiest columns near
the expected cut positions. Each frame is trimmed, anchored on the feet
(bottom) and on the head/torso (x), scaled to a common character height and
packed into one atlas per character.

Usage:  python -I tools/build_assets.py [--debug <dir>]
Output: assets/build/<character>.png + assets/build/atlas.json
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'sprites')
OUT = os.path.join(ROOT, 'assets', 'build')

# rows: list of (frame_count, [(anim, first, last_inclusive), ...])
# kind: 'body' anchors on head/torso, 'center' anchors on bbox center.
SHEETS = [
    dict(char='parfait', file='01_parfait_idle_walk.webp', rows=[
        (6, [('idle', 0, 5)]),
        (8, [('walk_v1', 0, 7)])]),
    dict(char='parfait', file='02_parfait_punches.webp', rows=[
        (5, [('jab', 0, 4)]),
        (7, [('cross', 0, 6)]),
        (6, [('uppercut', 0, 5)])]),
    dict(char='parfait', file='03_parfait_kicks.webp', rows=[
        (5, [('kick', 0, 4)]),
        (8, [('roundhouse', 0, 7)]),
        (6, [('sweep', 0, 5)])]),
    dict(char='parfait', file='04_parfait_power_code_override.webp', rows=[
        (7, [('blast', 0, 6)]),
        (6, [('fx_syntax_blast', 0, 5, 'center')]),
        (6, [('charge', 0, 5)])]),
    dict(char='parfait', file='05_parfait_jump_defense_damage.webp', chroma='magenta', rows=[
        (7, [('jump', 0, 6)]),
        (8, [('crouch', 0, 1), ('crouch_block', 2, 3), ('block', 4, 7)]),
        (8, [('hit', 0, 3), ('dash_back', 4, 7)]),
        (9, [('ko', 0, 5), ('get_up', 6, 8)])]),
    dict(char='parfait', file='06_parfait_parkour.webp', rows=[
        (8, [('run_v1', 0, 7)]),
        (6, [('run_jump', 0, 3), ('fall', 4, 4), ('land', 5, 5)]),
        (8, [('ledge_climb', 0, 5), ('ladder', 6, 7)]),
        (8, [('slide', 0, 3), ('push', 4, 7)])]),
    dict(char='parfait', file='07_parfait_stealth_treasure.webp', rows=[
        (8, [('sneak', 0, 5), ('wall_run', 6, 7)]),
        (7, [('takedown', 0, 6)]),
        (8, [('open_chest', 0, 5), ('raise_treasure_v1', 6, 7)]),
        # the row-3 raise pose has its legs cut off; row 4 has it full length
        (7, [('victory', 0, 0), ('raise_treasure', 1, 2), ('death', 3, 6)])]),
    # walk/run redrawn as classic 8-frame cycles (contact, down, passing, up)
    dict(char='parfait', file='13_parfait_walk_run_v2.png', rows=[
        (8, [('walk', 0, 7)]),
        (8, [('run', 0, 7)])]),
    # parkour additions (white background)
    dict(char='parfait', file='18_parfait_fall_land_roll.png', chroma='white', rows=[
        (8, [('fall_loop', 0, 3), ('land_heavy', 4, 7)]),
        (8, [('roll', 0, 7)])]),
    dict(char='parfait', file='19_parfait_climb_ledge_walljump.png', chroma='white', rows=[
        (8, [('climb', 0, 7)]),
        (8, [('ledge_hang', 0, 3), ('wall_jump', 4, 7)])]),
    dict(char='parfait', file='20_parfait_air_assassination_counter.png', chroma='white', rows=[
        (8, [('air_assassination', 0, 7)]),
        (8, [('counter', 0, 7)])]),
    dict(char='guard', file='08_enemy_bug_guard.webp', rows=[
        (10, [('idle', 0, 2), ('walk_v1', 3, 9)]),
        (9, [('alert', 0, 2), ('run_v1', 3, 8)]),
        (8, [('attack', 0, 7)]),
        (8, [('hit', 0, 2), ('death', 3, 7)])]),
    dict(char='guard', file='14_guard_walk_run_v2.png', rows=[
        (8, [('walk', 0, 7)]),
        (8, [('run', 0, 7)])]),
    dict(char='sniper', file='09_enemy_glitch_sniper.webp', chroma='green', rows=[
        (9, [('idle_v1', 0, 2), ('walk_v1', 3, 8)]),
        (7, [('shoot', 0, 6)]),
        (8, [('fx_bolt', 0, 3, 'center'), ('fx_bolt_hit', 4, 7, 'center')]),
        (9, [('hit', 0, 2), ('death', 3, 8)])]),
    dict(char='sniper', file='16_sniper_walk_idle_v2.png', rows=[
        (8, [('walk', 0, 7)]),
        (8, [('idle', 0, 7)])]),
    dict(char='drone', file='10_enemy_sentinel_drone.webp', kind='core', solo=True, rows=[
        (6, [('hover', 0, 5)]),
        (6, [('scan', 0, 5)]),
        (8, [('alert', 0, 2), ('laser', 3, 7)]),
        (8, [('hit', 0, 1), ('death', 2, 7)])]),
    dict(char='brute', file='11_enemy_firewall_brute.webp', chroma='magenta', rows=[
        (9, [('idle_v1', 0, 2), ('walk_v1', 3, 8)]),
        (7, [('block', 0, 1), ('bash', 2, 6)]),
        (7, [('slam', 0, 6)]),
        (7, [('hit', 0, 2), ('death', 3, 6)])]),
    dict(char='brute', file='15_brute_walk_idle_v2.png', rows=[
        (8, [('walk', 0, 7)]),
        (8, [('idle', 0, 7)])]),
    dict(char='kernel', file='12_boss_kernel.webp', rows=[
        (8, [('idle_v1', 0, 2), ('walk_v1', 3, 7)], [0.169, 0.333, 0.471, 0.591, 0.711, 0.822, 0.916]),
        (7, [('combo', 0, 6)]),
        (8, [('runes', 0, 5), ('teleport', 6, 7)]),
        (8, [('hit', 0, 1), ('death', 2, 7)])]),
    # the staff of each pose touches the coat of the previous one: cut just
    # left of every staff orb (found from the orange glow)
    dict(char='kernel', file='17_kernel_walk_idle_v2.png', rows=[
        (8, [('walk', 0, 7)], {'cuts': [0.117, 0.2456, 0.3626, 0.4806, 0.5966, 0.7267, 0.8522]}),
        (8, [('idle', 0, 7)], {'cuts': [0.1251, 0.2476, 0.3717, 0.4942, 0.6178, 0.7433, 0.8583]})]),
]

# Frames where two poses of the sheet touch and could not be separated.
# Also frames drawn facing the wrong way (guard walk 6).
EXCLUDE = {('guard', 'walk_v1'): [6], ('drone', 'laser'): [1, 2, 3]}

# Height in game pixels of a standing character (game world is 1280x720).
TARGET_HEIGHT = dict(parfait=190, guard=190, sniper=195, drone=100, brute=265, kernel=245)
# Every sprite is stored facing right; enemies were drawn facing left.
FACING = dict(parfait='right', guard='left', sniper='left', drone='left', brute='left', kernel='left')


def load_rgba(path, chroma):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if chroma == 'magenta':
        # distance from pure magenta; despill by pulling r/b down to g-ish
        key = np.clip((np.minimum(r, b) - g - 60) / 80, 0, 1)
        a[..., 3] = 255 * (1 - key)
        spill = np.clip(np.minimum(r, b) - g, 0, None) * 0.5 * (1 - key)
        a[..., 0] -= spill * 0.6
        a[..., 2] -= spill * 0.6
    elif chroma == 'green':
        key = np.clip((g - np.maximum(r, b) - 60) / 80, 0, 1)
        a[..., 3] = 255 * (1 - key)
        spill = np.clip(g - np.maximum(r, b), 0, None) * 0.5 * (1 - key)
        a[..., 1] -= spill * 0.8
    elif chroma == 'white':
        # plain white background: only the near-white pixels connected to the
        # border go, so the white t-shirt and sneakers (inside dark outlines) stay
        m = np.minimum(np.minimum(r, g), b)
        lab, _ = ndimage.label(m > 232)
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        bg = np.isin(lab, edge[edge > 0])
        rim = ndimage.binary_dilation(bg, iterations=2) & ~bg
        alpha = np.where(bg, 0, 255).astype(np.float32)
        alpha[rim] = np.clip((250 - m[rim]) / 50, 0, 1) * 255
        a[..., 3] = alpha
    return np.clip(a, 0, 255).astype(np.uint8)


def strip_lines(mask):
    """Remove thin, near full-length grid lines from a boolean mask (in place)."""
    h, w = mask.shape
    cols = mask.sum(0)
    for x in np.where(cols > 0.8 * h)[0]:
        lo, hi = max(0, x - 4), min(w, x + 5)
        if (cols[lo:hi] > 0.8 * h).sum() <= 4:
            mask[:, x] = False
    rows = mask.sum(1)
    for y in np.where(rows > 0.8 * w)[0]:
        lo, hi = max(0, y - 4), min(h, y + 5)
        if (rows[lo:hi] > 0.8 * w).sum() <= 4:
            mask[y, :] = False
    return mask


def best_cuts(profile, n, hint=None):
    """n-1 cut positions near uniform spacing (or near `hint`, cut positions as
    fractions of the width for sheets with uneven cells), at the emptiest columns."""
    size = len(profile)
    smooth = ndimage.uniform_filter1d(profile.astype(np.float32), 9)
    cell = size / n
    cuts, prev = [], 0
    for k in range(1, n):
        if hint:
            lo = max(prev + 1, int((hint[k - 1] - 0.03) * size))
            hi = min(size - 1, int((hint[k - 1] + 0.03) * size))
        else:
            lo = max(prev + int(cell * 0.35), int(k * cell - cell * 0.45))
            hi = min(size - 1, int(k * cell + cell * 0.45))
        if hi <= lo:
            c = int(k * cell)
        else:
            window = smooth[lo:hi]
            # prefer the middle of the flattest-lowest stretch
            m = window.min()
            idx = np.where(window <= m + 0.5)[0]
            c = lo + int(idx[len(idx) // 2])
        cuts.append(c)
        prev = c
    return [0] + cuts + [size]


def frame_from_cell(rgba, mask, kind, drop_left_edge=False):
    lab, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    ok = sizes >= max(40, sizes.max() * 0.004)
    if drop_left_edge:
        # pieces cut off the previous pose (its coat tail) touch the left edge
        edge = set(np.unique(lab[:, 0])) - {0}
        ok &= np.array([(k + 1) not in edge or k == int(np.argmax(sizes)) for k in range(n)])
    keep = np.isin(lab, 1 + np.where(ok)[0])
    return frame_from_keep(rgba, keep, kind)


def row_frames(rgba, band, cuts, kind_of, ylim=None, solo=False, fixed=False):
    """Extract one frame per cell from a row, following whole shapes.

    Each cell's pose is the largest connected shape whose centre lies in the
    cell, taken whole even where it crosses the cut line. Smaller shapes
    (impact sparks, a detached foot, motion trails) join the nearest pose, so
    a fist or effect that overflows into the next cell stays with its frame.
    Falls back to the plain cell cut when one shape covers two cells.
    """
    lab, n = ndimage.label(band, structure=np.ones((3, 3)))
    if n == 0:
        return [None] * (len(cuts) - 1)
    idx = np.arange(1, n + 1)
    sizes = ndimage.sum(band, lab, idx)
    boxes = ndimage.find_objects(lab)
    cx = [(b[1].start + b[1].stop) / 2 for b in boxes]
    if ylim:
        # the band is padded into the neighbouring rows so a raised fist or a
        # jump is not clipped; shapes centred in another row are ignored
        cy = [(b[0].start + b[0].stop) / 2 for b in boxes]
        inside = [ylim[0] <= y < ylim[1] for y in cy]
        sizes = np.where(inside, sizes, 0)
    big = sizes.max()
    ncell = len(cuts) - 1
    owner = [None] * ncell
    # Exactly one large shape per expected frame: the poses overlap in x (a
    # staff reaching under the previous coat) but do not touch, so take them
    # in left-to-right order instead of trusting the column cuts.
    poses = sorted([k for k in range(n) if sizes[k] >= big * 0.4], key=lambda k: cx[k])
    exact = len(poses) == ncell and not fixed
    for c in range(ncell):
        if exact:
            owner[c] = poses[c]
            continue
        cand = [k for k in range(n) if cuts[c] <= cx[k] < cuts[c + 1] and sizes[k] >= big * 0.12]
        if cand:
            owner[c] = max(cand, key=lambda k: sizes[k])
        else:
            span = [k for k in range(n) if boxes[k][1].start < cuts[c + 1] and boxes[k][1].stop > cuts[c] and sizes[k] >= big * 0.12]
            if span:
                owner[c] = max(span, key=lambda k: sizes[k])
    bodies = [o for o in owner if o is not None]
    groups = {o: [o] for o in bodies}
    cell_w = band.shape[1] / ncell
    for k in range(n):
        if k in groups or sizes[k] < 40 or solo:
            continue
        b = boxes[k]

        def gap(o):
            ob = boxes[o]
            dx = max(0, ob[1].start - b[1].stop, b[1].start - ob[1].stop)
            dy = max(0, ob[0].start - b[0].stop, b[0].start - ob[0].stop)
            return np.hypot(dx, dy)

        if not bodies:
            continue
        best = min(bodies, key=gap)
        if gap(best) < cell_w * 0.3:
            groups[best].append(k)
    out = []
    for c in range(ncell):
        o = owner[c]
        kind = kind_of(c)
        b = boxes[o] if o is not None else None
        shared = o is not None and owner.count(o) > 1
        if fixed:
            x0, x1 = cuts[c], cuts[c + 1]
            y0, y1 = ylim or (0, band.shape[0])
            out.append(frame_from_cell(rgba[y0:y1, x0:x1], band[y0:y1, x0:x1], kind, drop_left_edge=True))
            continue
        if o is None or shared or (not exact and (b[1].start < cuts[c] - cell_w * 0.5 or b[1].stop > cuts[c + 1] + cell_w * 0.5)):
            # shape spans into a neighbour: use the plain cell cut
            x0, x1 = cuts[c], cuts[c + 1]
            y0, y1 = ylim or (0, band.shape[0])
            out.append(frame_from_cell(rgba[y0:y1, x0:x1], band[y0:y1, x0:x1], kind))
            continue
        keep = np.isin(lab, [g + 1 for g in groups[o]])
        out.append(frame_from_keep(rgba, keep, kind))
    return out


def frame_from_keep(rgba, keep, kind):
    if kind == 'core':
        # one solid object (the drone): drop anything not attached to it
        lab, n = ndimage.label(keep)
        if n > 1:
            sizes = ndimage.sum(keep, lab, range(1, n + 1))
            keep = lab == int(np.argmax(sizes)) + 1
    ys, xs = np.where(keep)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    img = rgba[y0:y1, x0:x1].copy()
    img[..., 3] = np.where(keep[y0:y1, x0:x1], img[..., 3], 0)
    h = y1 - y0
    if kind == 'center':
        ax = (x1 - x0) / 2
    elif kind == 'core':
        # anchor on the solid body (the drone), not on the bounding box that
        # grows and shrinks with scan beams and lasers
        solid = keep[y0:y1, x0:x1] & (img[..., 3] > 200)
        lab, n = ndimage.label(solid)
        if n:
            sizes = ndimage.sum(solid, lab, range(1, n + 1))
            cy, cx = ndimage.center_of_mass(solid, lab, int(np.argmax(sizes)) + 1)
            return dict(img=img, ax=float(cx), ay=float(cy), h=h)
        ax = (x1 - x0) / 2
    else:
        band = keep[y0 + int(h * 0.08):y0 + int(h * 0.42), x0:x1]
        bx = np.where(band)[1]
        ax = float(np.median(bx)) if len(bx) else (x1 - x0) / 2
    return dict(img=img, ax=ax, h=h)


def process_sheet(sheet, debug_dir=None):
    path = os.path.join(SRC, sheet['file'])
    rgba = load_rgba(path, sheet.get('chroma'))
    mask = strip_lines(rgba[..., 3] > 110)
    H, W = mask.shape
    nrows = len(sheet['rows'])
    row_cuts = best_cuts(mask.sum(1), nrows)
    dbg = Image.fromarray(rgba).convert('RGB') if debug_dir else None
    draw = ImageDraw.Draw(dbg) if dbg else None
    anims = {}
    for r, (count, spec, *hint) in enumerate(sheet['rows']):
        ry0, ry1 = row_cuts[r], row_cuts[r + 1]
        band = mask[ry0:ry1].copy()
        strip_lines(band)
        fixed = hint and isinstance(hint[0], dict)
        if fixed:
            # exact cut positions (fractions of the width), for poses that touch
            col_cuts = [0] + [int(f * W) for f in hint[0]['cuts']] + [W]
        else:
            col_cuts = best_cuts(band.sum(0), count, hint[0] if hint else None)
        frames = []
        for c in range(count):
            cx0, cx1 = col_cuts[c], col_cuts[c + 1]
            frames.append((cx0, cx1))
            if draw:
                draw.rectangle([cx0, ry0, cx1 - 1, ry1 - 1], outline=(255, 0, 0), width=2)
                draw.text((cx0 + 4, ry0 + 4), str(c), fill=(255, 255, 0))
        kinds = {}
        for item in spec:
            for c in range(item[1], item[2] + 1):
                kinds[c] = item[3] if len(item) > 3 else sheet.get('kind', 'body')
        pad = (ry1 - ry0) // 4
        e0, e1 = max(0, ry0 - pad), min(H, ry1 + pad)
        ext = mask[e0:e1].copy()
        strip_lines(ext)
        extracted = row_frames(rgba[e0:e1], ext, col_cuts, lambda c: kinds.get(c, 'body'), (ry0 - e0, ry1 - e0),
                               solo=sheet.get('solo', False), fixed=fixed)
        # drop broken fragments (a cut that only caught part of a pose)
        areas = [int((f['img'][..., 3] > 110).sum()) if f else 0 for f in extracted]
        for item in spec:
            group = [areas[c] for c in range(item[1], item[2] + 1) if areas[c]]
            med = float(np.median(group)) if group else 0
            for c in range(item[1], item[2] + 1):
                if extracted[c] and areas[c] < med * 0.5 and len(group) > 2:
                    extracted[c] = None
        for item in spec:
            name, first, last = item[0], item[1], item[2]
            out = []
            for c in range(first, last + 1):
                f = extracted[c]
                if f:
                    f['kind'] = kinds[c]
                    out.append(f)
            anims[name] = out
    for (char, name), drop in EXCLUDE.items():
        if char == sheet['char'] and name in anims:
            anims[name] = [f for i, f in enumerate(anims[name]) if i not in drop]
    if dbg:
        dbg.thumbnail((1400, 1400))
        dbg.save(os.path.join(debug_dir, sheet['file'].rsplit('.', 1)[0] + '_grid.jpg'), quality=80)
    return anims


# The generated sheets draw the hero at different sizes from one row to the
# next, so the frame height cannot be trusted (it depends on the pose). The
# hair/head blob has the same size in every pose: each animation is rescaled so
# its head matches the idle animation's.
HEAD_CALIBRATED = {'parfait'}
HEAD_REF_ANIM = 'idle'
HEAD_UNRELIABLE = {'ko', 'death', 'get_up', 'ladder', 'wall_run', 'slide', 'push', 'ledge_climb', 'roll'}


def head_size(im):
    a = np.asarray(im.convert('RGBA')).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    dark = (al > 150) & (np.maximum(np.maximum(r, g), b) < 60) & ((b - r) < 18)
    lab, n = ndimage.label(dark)
    if not n:
        return None
    sizes = ndimage.sum(dark, lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    cand = [k for k in range(n) if sizes[k] >= max(30, sizes.max() * 0.05)]
    k = min(cand, key=lambda k: objs[k][0].start)
    return float(np.sqrt(sizes[k]))


def shoe_size(im):
    a = np.asarray(im.convert('RGBA')).astype(int)
    h = a.shape[0]
    white = (a[..., 3] > 150) & (np.minimum(np.minimum(a[..., 0], a[..., 1]), a[..., 2]) > 175)
    white[:int(h * 0.7)] = False
    lab, n = ndimage.label(white)
    if not n:
        return None
    sizes = np.sort(ndimage.sum(white, lab, range(1, n + 1)))
    return float(np.sqrt(sizes[-2:].mean()))


def calibrate_heads(images, meta):
    by_anim = {}
    for i, (name, _, _, _) in enumerate(meta):
        by_anim.setdefault(name, []).append(i)
    # Hair and white sneakers are both drawn at a steady size in every pose;
    # each is a little off on some sheets, so the two estimates are averaged.
    heads, shoes = {}, {}
    for name, idx in by_anim.items():
        if name.startswith('fx_') or name in HEAD_UNRELIABLE:
            continue
        v = [h for h in (head_size(images[i]) for i in idx) if h]
        if v:
            heads[name] = float(np.median(v))
        v = [h for h in (shoe_size(images[i]) for i in idx) if h]
        if v:
            shoes[name] = float(np.median(v))
    factors = {}
    for n in heads:
        k = heads[HEAD_REF_ANIM] / heads[n]
        if n in shoes and n not in ('open_chest', 'raise_treasure_v1'):
            k = np.sqrt(k * shoes[HEAD_REF_ANIM] / shoes[n])
        factors[n] = float(np.clip(k, 0.6, 1.4))
    fallback = float(np.median(list(factors.values())))
    out_images, out_meta = [], []
    for im, (name, i, ax, ay) in zip(images, meta):
        k = factors.get(name, 1.0 if name.startswith('fx_') else fallback)
        if abs(k - 1) > 0.01:
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            ax, ay = round(ax * k, 1), round(ay * k, 1)
        out_images.append(im)
        out_meta.append((name, i, ax, ay))
    print('head scale', {n: round(f, 2) for n, f in factors.items()})
    return out_images, out_meta


def pack(frames, max_w=2048, pad=2):
    """Simple shelf packer. frames: list of PIL images. Returns positions, size."""
    order = sorted(range(len(frames)), key=lambda i: -frames[i].height)
    pos, x, y, shelf_h, width = [None] * len(frames), 0, 0, 0, 0
    for i in order:
        w, h = frames[i].size
        if x + w > max_w:
            x, y, shelf_h = 0, y + shelf_h + pad, 0
        pos[i] = (x, y)
        x += w + pad
        shelf_h = max(shelf_h, h)
        width = max(width, x)
    return pos, (width, y + shelf_h)


# Anims anchored mostly on the head instead of the lowest foot: in flight
# frames the feet are tucked up, so pinning the feet to the ground would make
# the head dip every stride. value = share of the head alignment (rest = feet).
HEAD_LEVEL = {('parfait', 'run'): 0.75, ('guard', 'run'): 0.75}


def level_heads(char, images, meta):
    for (c, name), share in HEAD_LEVEL.items():
        if c != char:
            continue
        idx = [k for k, m in enumerate(meta) if m[0] == name]
        tops = []
        for k in idx:
            a = np.asarray(images[k])[..., 3] > 110
            tops.append(int(np.argmax(a.any(1))))
        rise = float(np.median([meta[k][3] - t for k, t in zip(idx, tops)]))
        new = [meta[k][3] * (1 - share) + (t + rise) * share for k, t in zip(idx, tops)]
        # no foot below the ground: the lowest frames stand on it, flight frames float
        sink = max(images[k].height - a for k, a in zip(idx, new))
        for k, a in zip(idx, new):
            n, i, ax, _ = meta[k]
            meta[k] = (n, i, ax, round(a + max(0, sink), 1))
    return meta


def main():
    debug_dir = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    per_char = {}
    for sheet in SHEETS:
        anims = process_sheet(sheet, debug_dir)
        # Reference height: tall-ish standing frames of this sheet's body anims.
        hs = [f['h'] for a in anims.values() for f in a if f['kind'] == 'body']
        if not hs and sheet.get('kind') in ('center', 'core'):
            hs = [f['h'] for a in anims.values() for f in a]
        ref = float(np.percentile(hs, 70)) if hs else None
        per_char.setdefault(sheet['char'], []).append((anims, ref))
        print(sheet['file'], {k: len(v) for k, v in anims.items()}, 'ref', ref)

    atlas = {}
    for char, sheets in per_char.items():
        refs = [r for _, r in sheets if r]
        target = TARGET_HEIGHT[char]
        images, meta = [], []
        for anims, ref in sheets:
            scale = target / (ref or np.median(refs))
            for name, frames in anims.items():
                for i, f in enumerate(frames):
                    im = Image.fromarray(f['img'])
                    ax = f['ax']
                    if FACING[char] == 'left':
                        im = im.transpose(Image.FLIP_LEFT_RIGHT)
                        ax = im.width - ax
                    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
                    im = im.resize((w, h), Image.LANCZOS)
                    images.append(im)
                    ay = h if f['kind'] == 'body' else f['ay'] * scale if 'ay' in f else h / 2
                    meta.append((name, i, round(ax * scale, 1), round(ay, 1)))
        if char in HEAD_CALIBRATED:
            images, meta = calibrate_heads(images, meta)
        meta = level_heads(char, images, meta)
        # superseded animations (kept in the sheets list for reference only)
        keep = [k for k, m in enumerate(meta) if not m[0].endswith('_v1')]
        images, meta = [images[k] for k in keep], [meta[k] for k in keep]
        pos, size = pack(images)
        sheet_img = Image.new('RGBA', size, (0, 0, 0, 0))
        anim_meta = {}
        for im, (x, y), (name, i, ax, ay) in zip(images, pos, meta):
            sheet_img.paste(im, (x, y))
            anim_meta.setdefault(name, []).append([x, y, im.width, im.height, ax, ay])
        sheet_img.save(os.path.join(OUT, f'{char}.png'), optimize=True)
        atlas[char] = dict(image=f'assets/build/{char}.png', anims=anim_meta)
        print(char, size)
    with open(os.path.join(OUT, 'atlas.json'), 'w', encoding='utf-8') as fh:
        json.dump(atlas, fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
