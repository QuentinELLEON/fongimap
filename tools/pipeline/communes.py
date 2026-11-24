"""
Commune geometry for FongiMap (numpy only).

Input : IGN ADMIN-EXPRESS COG PLUS, communes, TopoJSON (WGS84, shared arcs), data.gouv.fr, Licence Ouverte.
Output: - a compact, topology-preserving geometry package (arcs + rings + arc classes) for the browser,
        - the commune table (code, name, département, population, area, label anchor),
        - the commune of every site (exact point-in-polygon on the *unsimplified* rings).

Package layout (all integers are unsigned LEB128 varints unless noted; coordinates are 16-bit quantised longitude / latitude
over the same bounding box as the observation records, so one unit is about 2 m):
    arcs   : for every arc  n_points, x0, y0, then (n_points-1) pairs of zig-zag deltas
    classes: one byte per arc  0 = between two communes of one département, 1 = between two départements of one region,
             2 = between two regions, 3 = edge (coast or national border)
    rings  : for every commune  n_polygons, then per polygon  n_rings, then per ring  n_refs, then refs = (arc_index << 1) | reversed
The three sections are concatenated, zlib-compressed and base64-encoded into geo-communes.js.
"""
import base64
import json
import math
import zlib
from pathlib import Path

import numpy as np

LAT_MIN, LAT_MAX, LON_MIN, LON_MAX, Q_MAX = 41.0, 51.5, -5.5, 10.0, 65534
KM_PER_DEG_LAT = 110.574
COS_LAT = math.cos(math.radians(46.5))


# ---------------------------------------------------------------------------- reading
def load_topology(path):
    """-> arcs (list of (n,2) float64 lon/lat arrays) and communes (list of dicts with polygons as lists of rings of arc refs)."""
    t = json.loads(Path(path).read_text(encoding="utf-8"))
    sx, sy = t["transform"]["scale"]
    tx, ty = t["transform"]["translate"]
    arcs = []
    for a in t["arcs"]:
        q = np.cumsum(np.asarray(a, dtype=np.int64), axis=0)
        arcs.append(np.column_stack((q[:, 0] * sx + tx, q[:, 1] * sy + ty)))
    geoms = list(t["objects"].values())[0]["geometries"]
    communes = []
    for g in geoms:
        p = g["properties"]
        dep = str(p.get("dept") or "")
        if len(dep) != 2:                       # overseas départements (971…976) are outside the basemap
            continue
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        communes.append({"code": str(p["codgeo"]), "name": p["libgeo"], "dep": dep, "reg": str(p.get("reg") or ""),
                         "pop": int(p.get("population") or 0), "area_km2": float(p.get("superf") or 0) / 100.0, "polys": polys})
    return arcs, communes


def ring_points(arcs, ring):
    """Coordinates of one ring given as a list of (possibly negative = reversed) arc indices; junction points are not repeated."""
    out = []
    for r in ring:
        a = arcs[~r][::-1] if r < 0 else arcs[r]
        out.append(a if not out else a[1:])
    return np.vstack(out)


# ---------------------------------------------------------------------------- simplification
def _dp_keep(xy, eps):
    """Douglas-Peucker on an (n,2) metric array; returns indices kept (always the two ends)."""
    n = len(xy)
    if n <= 2:
        return np.arange(n)
    keep = np.zeros(n, dtype=bool); keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    closed = bool(np.all(xy[0] == xy[-1]))
    if closed and n > 3:                          # closed ring in one arc: split at the farthest point first
        m = int(np.argmax(np.hypot(*(xy - xy[0]).T)))
        keep[m] = True; stack = [(0, m), (m, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p = xy[i + 1:j]; a = xy[i]; b = xy[j]; d = b - a; L = math.hypot(d[0], d[1])
        if L == 0:
            dist = np.hypot(p[:, 0] - a[0], p[:, 1] - a[1])
        else:
            dist = np.abs(d[0] * (p[:, 1] - a[1]) - d[1] * (p[:, 0] - a[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > eps:
            m = i + 1 + k; keep[m] = True; stack.append((i, m)); stack.append((m, j))
    return np.nonzero(keep)[0]


def simplify_arcs(arcs, eps_m):
    """Simplify every arc independently (shared arcs stay shared, so neighbouring communes still fit together)."""
    out = []
    for a in arcs:
        xy = np.column_stack((a[:, 0] * COS_LAT * 111.32e3, a[:, 1] * KM_PER_DEG_LAT * 1e3))
        out.append(a[_dp_keep(xy, eps_m)])
    return out


# ---------------------------------------------------------------------------- classification
def classify_arcs(n_arcs, communes):
    """Class per arc from the communes on each side (see the module docstring)."""
    users = [[] for _ in range(n_arcs)]
    for ci, c in enumerate(communes):
        seen = set()
        for poly in c["polys"]:
            for ring in poly:
                for r in ring:
                    a = r if r >= 0 else ~r
                    if a not in seen:
                        seen.add(a); users[a].append(ci)
    cls = np.full(n_arcs, 255, dtype=np.uint8)
    for a, u in enumerate(users):
        if not u:
            continue                              # arc used only by overseas communes
        if len(u) == 1:
            cls[a] = 3
        else:
            c0, c1 = communes[u[0]], communes[u[1]]
            cls[a] = 0 if c0["dep"] == c1["dep"] else (1 if c0["reg"] == c1["reg"] else 2)
    return cls


# ---------------------------------------------------------------------------- encoding
def _varint(v, out):
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80); v >>= 7
    out.append(v)


def _zig(v):
    return (v << 1) ^ (v >> 63) if v < 0 else v << 1


def quantise(lon, lat):
    qx = np.clip(np.rint((np.asarray(lon) - LON_MIN) / (LON_MAX - LON_MIN) * Q_MAX), 0, Q_MAX).astype(np.int64)
    qy = np.clip(np.rint((np.asarray(lat) - LAT_MIN) / (LAT_MAX - LAT_MIN) * Q_MAX), 0, Q_MAX).astype(np.int64)
    return qx, qy


def encode_package(arcs_s, cls, communes):
    """-> (zlib bytes, section sizes). Arcs used only by overseas communes are dropped (class 255 -> empty arc)."""
    arcs_b, rings_b = bytearray(), bytearray()
    for a, c in zip(arcs_s, cls):
        if c == 255:
            _varint(0, arcs_b); continue
        qx, qy = quantise(a[:, 0], a[:, 1])
        _varint(len(qx), arcs_b); _varint(int(qx[0]), arcs_b); _varint(int(qy[0]), arcs_b)
        dx, dy = np.diff(qx), np.diff(qy)
        for u, v in zip(dx.tolist(), dy.tolist()):
            _varint(_zig(u), arcs_b); _varint(_zig(v), arcs_b)
    for c in communes:
        _varint(len(c["polys"]), rings_b)
        for poly in c["polys"]:
            _varint(len(poly), rings_b)
            for ring in poly:
                _varint(len(ring), rings_b)
                for r in ring:
                    _varint(((r if r >= 0 else ~r) << 1) | (1 if r < 0 else 0), rings_b)
    blob = bytes(arcs_b) + bytes(cls.tobytes()) + bytes(rings_b)
    return zlib.compress(blob, 9), {"arcs": len(arcs_b), "classes": len(cls), "rings": len(rings_b)}


# ---------------------------------------------------------------------------- anchors and area
def _ring_area_centroid(p):
    x, y = p[:, 0], p[:, 1]
    cr = x[:-1] * y[1:] - x[1:] * y[:-1]
    a = cr.sum() / 2.0
    if abs(a) < 1e-18:
        return 0.0, float(x.mean()), float(y.mean())
    return a, float(((x[:-1] + x[1:]) * cr).sum() / (6 * a)), float(((y[:-1] + y[1:]) * cr).sum() / (6 * a))


def _inside(poly_rings, px, py):
    """Even-odd point in polygon (outer ring + holes) for one point."""
    ins = False
    for r in poly_rings:
        x, y = r[:, 0], r[:, 1]
        x0, y0, x1, y1 = x[:-1], y[:-1], x[1:], y[1:]
        cond = (y0 > py) != (y1 > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = (x1 - x0) * (py - y0) / (y1 - y0) + x0
        if (np.count_nonzero(cond & (px < xi)) & 1):
            ins = not ins
    return ins


def label_anchor(poly_rings):
    """A point inside the polygon, in the middle of its widest horizontal span (better than the centroid for concave shapes)."""
    outer = poly_rings[0]
    _, cx, cy = _ring_area_centroid(outer)
    if _inside(poly_rings, cx, cy):
        # still prefer the middle of the span through the centroid line
        pass
    best = (cx, cy, -1.0)
    ymin, ymax = float(outer[:, 1].min()), float(outer[:, 1].max())
    for fy in (cy, ymin + 0.5 * (ymax - ymin), ymin + 0.35 * (ymax - ymin), ymin + 0.65 * (ymax - ymin)):
        xs = []
        for r in poly_rings:
            x, y = r[:, 0], r[:, 1]
            x0, y0, x1, y1 = x[:-1], y[:-1], x[1:], y[1:]
            cond = (y0 > fy) != (y1 > fy)
            with np.errstate(divide="ignore", invalid="ignore"):
                xi = (x1 - x0) * (fy - y0) / (y1 - y0) + x0
            xs.extend(xi[cond].tolist())
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            w = xs[k + 1] - xs[k]
            if w > best[2]:
                best = ((xs[k] + xs[k + 1]) / 2, fy, w)
    return best[0], best[1]


# ---------------------------------------------------------------------------- build
def build(topo_path, eps_m=250.0, log=print):
    """-> dict with the table (arrays), the package (b64 + sizes) and what is needed to assign sites to communes."""
    arcs, communes = load_topology(topo_path)
    log("Communes: %d metropolitan communes, %d arcs, %d vertices (IGN source)" % (len(communes), len(arcs), sum(len(a) for a in arcs)))
    cls = classify_arcs(len(arcs), communes)
    arcs_s = simplify_arcs(arcs, eps_m)
    log("Simplified at %.0f m: %d vertices kept" % (eps_m, sum(len(a) for a, c in zip(arcs_s, cls) if c != 255)))
    z, sizes = encode_package(arcs_s, cls, communes)
    b64 = base64.b64encode(z).decode("ascii")
    log("Commune geometry: raw %.2f MB -> zlib %.2f MB -> base64 %.2f MB" % (sum(sizes.values()) / 1e6, len(z) / 1e6, len(b64) / 1e6))

    # exact rings (unsimplified) for anchors and point-in-polygon
    full = []                                       # per commune: list of polygons, each a list of (n,2) rings
    lon_a, lat_a = [], []
    for c in communes:
        polys = [[ring_points(arcs, r) for r in poly] for poly in c["polys"]]
        full.append(polys)
        big = max(polys, key=lambda pr: abs(_ring_area_centroid(pr[0])[0]))
        x, y = label_anchor(big)
        lon_a.append(x); lat_a.append(y)
    aqx, aqy = quantise(lon_a, lat_a)
    table = {
        "code": [c["code"] for c in communes], "names": [c["name"] for c in communes], "dep": [c["dep"] for c in communes],
        "pop": [c["pop"] for c in communes], "area": [round(c["area_km2"], 2) for c in communes],
        "lonq": aqx.tolist(), "latq": aqy.tolist(),
    }
    return {"table": table, "b64": b64, "sizes": sizes, "n_arcs": len(arcs), "full": full, "anchors": np.column_stack((lon_a, lat_a))}


# ---------------------------------------------------------------------------- sites -> communes
def assign_sites(res, lon, lat, log=print):
    """Commune index of each site (exact point-in-polygon on the unsimplified rings; nearest anchor when on the coast or outside)."""
    full = res["full"]
    n = len(full)
    bbox = np.array([[min(r[0][:, 0].min() for r in polys), min(r[0][:, 1].min() for r in polys),
                      max(r[0][:, 0].max() for r in polys), max(r[0][:, 1].max() for r in polys)] for polys in full])
    # uniform grid of cells (0.1 deg) -> communes whose bbox touches the cell
    G = 0.1
    cells = {}
    for ci in range(n):
        for gx in range(int(math.floor(bbox[ci, 0] / G)), int(math.floor(bbox[ci, 2] / G)) + 1):
            for gy in range(int(math.floor(bbox[ci, 1] / G)), int(math.floor(bbox[ci, 3] / G)) + 1):
                cells.setdefault((gx, gy), []).append(ci)
    out = np.full(len(lon), -1, dtype=np.int32)
    for k in range(len(lon)):
        px, py = float(lon[k]), float(lat[k])
        for ci in cells.get((int(math.floor(px / G)), int(math.floor(py / G))), ()):
            b = bbox[ci]
            if px < b[0] or px > b[2] or py < b[1] or py > b[3]:
                continue
            if any(_inside(poly, px, py) for poly in full[ci]):
                out[k] = ci; break
    miss = np.nonzero(out < 0)[0]
    if len(miss):
        A = res["anchors"]
        for k in miss:
            d = (A[:, 0] - lon[k]) ** 2 + ((A[:, 1] - lat[k]) ** 2)
            out[k] = int(np.argmin(d))
    log("Sites -> communes: %d sites, %d placed by polygon, %d by nearest label point (coast / outside every polygon)" % (len(lon), len(lon) - len(miss), len(miss)))
    return out
