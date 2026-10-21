#!/usr/bin/env python3
"""Trims the KayKit packs into the files the movement games ship (frontend/public/game/).

    python3 -I frontend/scripts/game_assets.py <KayKit Adventurers dir> <KayKit Skeletons dir>

The first folder holds Knight.glb, Mage.glb, Barbarian.glb, Rogue.glb and Rogue_Hooded.glb from
https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (Characters/gltf); the second
Skeleton_Warrior.glb from https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0. Both CC0
(frontend/public/game/LICENSES.md). The downloads are read as data only; run with `python3 -I`.

What it writes, every name carrying a hash of its content (the files can be cached for a year):
- one glTF per body: the six skinned parts, the cape and the body's own hat; no weapons, no animations;
- kaykit-anims: the rig and the 8 player clips, shared by all five bodies (their clips are the same data);
- kaykit-skeleton: the boss with its 7 clips;
- src/lib/live/three/assets.gen.ts, the file names for the kit.

Why .gltf + several .bin and not one .glb: the Space refuses a pushed binary file over 100 KB
(backend/tests/test_space_binaries.py), so every .bin stays under 96 KB. Sizes are cut without changing the look:
normals as bytes, texture coordinates as 16-bit (KHR_mesh_quantization), joints and weights as bytes, rotations
as 16-bit, a key track that never changes kept as one key, no tracks for the IK helper bones nothing is bound to.
"""

import hashlib
import json
import math
import os
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'public' / 'game'
MANIFEST = HERE.parent / 'src' / 'lib' / 'live' / 'three' / 'assets.gen.ts'
BIN_LIMIT = 96 * 1024

BODIES = [  # (id in the kit, source file, kept mesh nodes)
    ('knight', 'Knight.glb', r'^Knight_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight|Cape|Helmet)$'),
    ('mage', 'Mage.glb', r'^Mage_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight|Cape|Hat)$'),
    ('barbarian', 'Barbarian.glb', r'^Barbarian_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight|Cape|Hat)$'),
    ('rogue', 'Rogue.glb', r'^Rogue_(ArmLeft|ArmRight|Body|Head|LegLeft|LegRight|Cape)$'),
    ('hooded', 'Rogue_Hooded.glb', r'^Rogue_(ArmLeft|ArmRight|Body|Head_Hooded|LegLeft|LegRight|Cape)$'),
]
PLAYER_CLIPS = ['Idle', 'Running_A', 'Jump_Full_Short', 'Jump_Idle', 'Cheer', 'Hit_B', 'Death_A', 'Interact']
BOSS_CLIPS = ['Idle_Combat', 'Taunt', 'Taunt_Longer', '1H_Melee_Attack_Jump_Chop', 'Death_C_Skeletons',
              'Death_C_Skeletons_Resurrect', 'Running_C']
# Helper bones of the rig: no vertex is bound to them and no bone hangs under them.
UNBOUND_BONES = re.compile(r'(IK|^control-|^handslot)')

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    data = path.read_bytes()
    magic, _version, _length = struct.unpack('<4sII', data[:12])
    if magic != b'glTF':
        raise SystemExit(f'{path}: not a GLB')
    clen, ctype = struct.unpack('<II', data[12:20])
    if ctype != 0x4E4F534A:
        raise SystemExit(f'{path}: first chunk is not JSON')
    gltf = json.loads(data[20:20 + clen])
    rest = data[20 + clen:]
    blen, btype = struct.unpack('<II', rest[:8])
    if btype != 0x004E4942:
        raise SystemExit(f'{path}: second chunk is not BIN')
    return gltf, rest[8:8 + blen]


def read_accessor(g, binc, i):
    """The accessor's values as a list of tuples, normalized integers turned into floats."""
    a = g['accessors'][i]
    fmt, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    bv = g['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', size * n)
    out = []
    for k in range(a['count']):
        vals = struct.unpack_from('<' + fmt * n, binc, base + k * stride)
        if a.get('normalized'):
            top = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a['componentType']]
            vals = tuple(max(v / top, -1.0) for v in vals)
        out.append(vals)
    return out


class Writer:
    """New accessors and buffer views, packed into buffers of at most BIN_LIMIT bytes."""

    def __init__(self):
        self.accessors, self.views, self.bufs = [], [], [bytearray()]

    def _view(self, payload, stride=None, target=None):
        if len(payload) > BIN_LIMIT:
            raise SystemExit('one accessor is over the buffer limit')
        buf = self.bufs[-1]
        while len(buf) % 4:
            buf.append(0)
        if len(buf) + len(payload) > BIN_LIMIT:
            self.bufs.append(bytearray())
            buf = self.bufs[-1]
        view = {'buffer': len(self.bufs) - 1, 'byteOffset': len(buf), 'byteLength': len(payload)}
        if stride:
            view['byteStride'] = stride
        if target:
            view['target'] = target
        buf += payload
        self.views.append(view)
        return len(self.views) - 1

    def add(self, values, ctype, kind, normalized=False, stride=None, target=None, minmax=False):
        fmt, size = COMP[ctype]
        n = NCOMP[kind]
        top = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}.get(ctype)
        elem = size * n
        step = stride or elem
        payload = bytearray(step * len(values))
        for k, v in enumerate(values):
            if top and normalized:
                v = [int(round(max(-1.0, min(1.0, x)) * top)) for x in v]
            struct.pack_into('<' + fmt * n, payload, k * step, *v)
        acc = {'bufferView': self._view(bytes(payload), stride if stride and stride != elem else None, target),
               'componentType': ctype, 'count': len(values), 'type': kind}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [min(v[c] for v in values) for c in range(n)]
            acc['max'] = [max(v[c] for v in values) for c in range(n)]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def quantize_weights(weights):
    out = []
    for w in weights:
        q = [int(round(x * 255)) for x in w]
        q[q.index(max(q))] += 255 - sum(q)
        out.append(tuple(x / 255 for x in q))
    return out


def same(values, eps=1e-6):
    first = values[0]
    return all(abs(a - b) <= eps for v in values for a, b in zip(v, first))


def convert(src, stem, keep_mesh, clips, keep_skin=True, keep_material=True):
    g, binc = load_glb(src)
    w = Writer()
    mesh_re = re.compile(keep_mesh) if keep_mesh else None
    kept_meshes = {}
    for node in g['nodes']:
        if 'mesh' not in node:
            continue
        if not mesh_re or not mesh_re.search(node.get('name', '')):
            del node['mesh']
            node.pop('skin', None)
            continue
        kept_meshes.setdefault(node['mesh'], len(kept_meshes))
    meshes = []
    for old, _new in sorted(kept_meshes.items(), key=lambda kv: kv[1]):
        m = g['meshes'][old]
        prims = []
        for pr in m['primitives']:
            at = pr['attributes']
            out = {}
            pos = read_accessor(g, binc, at['POSITION'])
            out['POSITION'] = w.add(pos, 5126, 'VEC3', target=34962, minmax=True)
            if 'NORMAL' in at:
                nrm = []
                for v in read_accessor(g, binc, at['NORMAL']):
                    ln = math.sqrt(sum(x * x for x in v)) or 1.0
                    nrm.append(tuple(x / ln for x in v))
                out['NORMAL'] = w.add(nrm, 5120, 'VEC3', normalized=True, stride=4, target=34962)
            if 'TEXCOORD_0' in at:
                uv = read_accessor(g, binc, at['TEXCOORD_0'])
                if all(0.0 <= x <= 1.0 for v in uv for x in v):
                    out['TEXCOORD_0'] = w.add(uv, 5123, 'VEC2', normalized=True, target=34962)
                else:
                    out['TEXCOORD_0'] = w.add(uv, 5126, 'VEC2', target=34962)
            if 'JOINTS_0' in at:
                out['JOINTS_0'] = w.add(read_accessor(g, binc, at['JOINTS_0']), 5121, 'VEC4', target=34962)
                weights = quantize_weights(read_accessor(g, binc, at['WEIGHTS_0']))
                out['WEIGHTS_0'] = w.add(weights, 5121, 'VEC4', normalized=True, target=34962)
            npr = {'attributes': out, 'mode': pr.get('mode', 4)}
            if 'indices' in pr:
                idx = [v for v in read_accessor(g, binc, pr['indices'])]
                big = max(v[0] for v in idx) > 65535
                npr['indices'] = w.add(idx, 5125 if big else 5123, 'SCALAR', target=34963)
            if 'material' in pr and keep_material:
                npr['material'] = pr['material']
            prims.append(npr)
        meshes.append({'name': m.get('name', ''), 'primitives': prims})
    for node in g['nodes']:
        if 'mesh' in node:
            node['mesh'] = kept_meshes[node['mesh']]
    # animations
    names = [n.get('name', '') for n in g['nodes']]
    anims = []
    for a in g.get('animations', []):
        if a.get('name') not in clips:
            continue
        samplers, channels = [], []
        for ch in a['channels']:
            node = ch['target']['node']
            if UNBOUND_BONES.search(names[node]):
                continue
            s = a['samplers'][ch['sampler']]
            times = read_accessor(g, binc, s['input'])
            vals = read_accessor(g, binc, s['output'])
            path = ch['target']['path']
            if same(vals):
                times, vals = times[:1], vals[:1]
            ti = w.add(times, 5126, 'SCALAR', minmax=True)
            if path == 'rotation':
                vi = w.add(vals, 5122, 'VEC4', normalized=True)
            else:
                vi = w.add(vals, 5126, NCOMP_KIND[len(vals[0])])
            samplers.append({'input': ti, 'output': vi, 'interpolation': s.get('interpolation', 'LINEAR')})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': path}})
        anims.append({'name': a['name'], 'samplers': samplers, 'channels': channels})
    missing = set(clips) - {a['name'] for a in anims}
    if missing:
        raise SystemExit(f'{src.name}: no clips {sorted(missing)}')
    # skins
    skins = []
    if keep_skin and any('skin' in n for n in g['nodes']):
        for s in g['skins']:
            ibm = read_accessor(g, binc, s['inverseBindMatrices'])
            skins.append({'name': s.get('name', ''), 'joints': s['joints'], 'inverseBindMatrices': w.add(ibm, 5126, 'MAT4')})
    else:
        for n in g['nodes']:
            n.pop('skin', None)
    # images: separate files
    files = {}
    images, textures, materials, samplers_t = [], [], [], []
    if keep_material and meshes:
        for im in g.get('images', []):
            bv = g['bufferViews'][im['bufferView']]
            data = binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
            if im.get('mimeType') != 'image/png' or data[:8] != b'\x89PNG\r\n\x1a\n':
                raise SystemExit(f'{src.name}: an image that is not a PNG')
            name = f'{stem}-{hashlib.sha256(data).hexdigest()[:10]}.png'
            files[name] = data
            images.append({'name': im.get('name', ''), 'uri': name, 'mimeType': 'image/png'})
        textures = g.get('textures', [])
        materials = g.get('materials', [])
        samplers_t = g.get('samplers', [])
    else:
        for m in meshes:
            for pr in m['primitives']:
                pr.pop('material', None)
    buffers = []
    for k, buf in enumerate(w.bufs):
        while len(buf) % 4:
            buf.append(0)
        name = f'{stem}-{hashlib.sha256(buf).hexdigest()[:10]}.bin'
        files[name] = bytes(buf)
        buffers.append({'byteLength': len(buf), 'uri': name})
    out = {
        'asset': {'version': '2.0', 'generator': 'meldy game_assets.py',
                  'copyright': 'KayKit by Kay Lousberg, CC0 1.0 (frontend/public/game/LICENSES.md)'},
        'extensionsUsed': ['KHR_mesh_quantization'],
        'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': g['scenes'], 'nodes': g['nodes'],
        'meshes': meshes, 'accessors': w.accessors, 'bufferViews': w.views, 'buffers': buffers,
    }
    if not meshes:
        del out['meshes']
        del out['extensionsUsed']
        del out['extensionsRequired']
    for key, val in (('animations', anims), ('skins', skins), ('materials', materials), ('textures', textures),
                     ('images', images), ('samplers', samplers_t)):
        if val:
            out[key] = val
    text = json.dumps(out, separators=(',', ':'), ensure_ascii=True).encode()
    name = f'{stem}-{hashlib.sha256(text).hexdigest()[:10]}.gltf'
    files[name] = text
    return name, files


NCOMP_KIND = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    adv, skel = Path(sys.argv[1]), Path(sys.argv[2])
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        if old.is_file() and re.match(r'^kaykit-.+-[0-9a-f]{10}\.(gltf|bin|png)$', old.name):
            old.unlink()
    produced = {}
    all_files = {}
    for body, srcname, keep in BODIES:
        name, files = convert(adv / srcname, f'kaykit-{body}', keep, set())
        produced[body] = name
        all_files.update(files)
    name, files = convert(adv / 'Knight.glb', 'kaykit-anims', None, set(PLAYER_CLIPS), keep_skin=False, keep_material=False)
    produced['anims'] = name
    all_files.update(files)
    name, files = convert(skel / 'Skeleton_Warrior.glb', 'kaykit-skeleton', r'^Skeleton_Warrior_', set(BOSS_CLIPS))
    produced['skeleton'] = name
    all_files.update(files)
    total = 0
    for fname, data in sorted(all_files.items()):
        (OUT / fname).write_bytes(data)
        total += len(data)
        print(f'{fname:44s} {len(data) / 1024:7.1f} KB')
    print(f'total {total / 1024:.1f} KB in {len(all_files)} files')
    bodies = ', '.join(f"{b}: '{produced[b]}'" for b, _s, _k in BODIES)
    MANIFEST.write_text(
        '// Generated by frontend/scripts/game_assets.py: do not edit. The names carry a hash of their content.\n'
        f"export const BODY_FILES = {{ {bodies} }} as const;\n"
        f"export const ANIMS_FILE = '{produced['anims']}';\n"
        f"export const SKELETON_FILE = '{produced['skeleton']}';\n",
        encoding='utf-8')


if __name__ == '__main__':
    main()
