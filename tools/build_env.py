"""Write assets/build/env.json: named rectangles inside the environment sheets.

Blob indices come from tools/extract_blobs.py (reading order). Tilesets use
their first row (ground left/middle/right) and second row (floating platform
left/middle/right), which every world tileset was generated with.

Usage: python -I tools/build_env.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_blobs import blobs  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, 'assets', 'environment')

NAMED = {
    'props': {
        0: 'rock_medium', 1: 'rock_large', 2: 'cardboard_stack', 3: 'cardboard', 4: 'crate',
        5: 'crate_cracked', 6: 'rock_small', 7: 'crate_metal', 8: 'barrel', 9: 'barrel_explosive',
        10: 'vase', 11: 'vase_broken', 12: 'chest_closed', 13: 'chest_open', 14: 'great_chest',
        15: 'spikes', 16: 'torch', 17: 'signpost', 18: 'ladder', 19: 'rope', 20: 'door_and_flag',
        21: 'lever_up', 22: 'lever_down',
    },
    'collectibles_fx': {
        0: 'coin_0', 1: 'coin_1', 2: 'coin_2', 3: 'coin_3', 4: 'coin_4', 5: 'coin_5',
        6: 'gem_blue', 7: 'gem_red', 8: 'heart', 9: 'key', 10: 'map', 11: 'code_fragment',
        12: 'energy_orb', 13: 'spark_0', 14: 'spark_1', 15: 'spark_2', 16: 'spark_3',
        17: 'dust_strip', 18: 'explosion_strip', 19: 'explosion_big', 24: 'splash_strip',
        25: 'teleport_strip',
    },
    'ui_kit': {
        0: 'portrait', 1: 'bars', 2: 'boss_bar', 3: 'coin_counter', 4: 'gem_counter', 5: 'stars',
        6: 'btn_pause', 7: 'btn_punch', 8: 'btn_kick', 9: 'btn_jump', 10: 'btn_special',
        11: 'joystick', 12: 'btn_stealth', 13: 'btn_block', 14: 'btn_interact', 15: 'btn_wide',
    },
}


def rows_of(bs):
    rows, cur = [], []
    for b in bs:
        if cur and (b[1] + b[3] / 2) - (cur[0][1] + cur[0][3] / 2) > 60:
            rows.append(cur)
            cur = []
        cur.append(b)
    if cur:
        rows.append(cur)
    return rows


def main():
    out = {}
    for sheet, names in NAMED.items():
        bs = blobs(os.path.join(ENV, sheet + '.png'))
        out[sheet] = dict(image=f'assets/environment/{sheet}.png',
                          items={names[i]: b for i, b in enumerate(bs) if i in names})
    for w, key in enumerate(['w1_jungle', 'w2_desert', 'w3_neocity', 'w4_caverns', 'w5_vault'], 1):
        bs = blobs(os.path.join(ENV, key + '_tiles.png'))
        rows = rows_of(bs)
        items = {}
        for prefix, row in (('ground', rows[0]), ('plat', rows[1])):
            row = sorted(row, key=lambda b: b[0])
            for name, b in zip(('l', 'm', 'r'), row[:3]):
                items[f'{prefix}_{name}'] = b
        # Decorations: everything from the last rows that is wider than tall-ish.
        deco = [b for r in rows[2:] for b in r if b[2] < 400]
        for i, b in enumerate(deco[:8]):
            items[f'deco_{i}'] = b
        out[f'tiles_w{w}'] = dict(image=f'assets/environment/{key}_tiles.png', items=items)
        print(key, len(bs), 'blobs', [len(r) for r in rows])
    with open(os.path.join(ROOT, 'assets', 'build', 'env.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1)


if __name__ == '__main__':
    main()
