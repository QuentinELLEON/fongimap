#!/usr/bin/env python3
"""
FongiMap build script  -  CSV  ->  data.js
===========================================

Converts the FongiBase extract (Gautier et al. 2022, Zenodo 17158524) into the
compact embedded data file read by index.html.

Usage
-----
  python build.py                       # CSV auto-detected in data_raw/
  python build.py --csv path/to.csv     # explicit CSV
  python build.py --sample 10000        # first 10 000 rows only (fast dev loop)
  python build.py --inspect             # print schema / statistics, write nothing
  python build.py --out some/dir        # where data.js is written (default: this folder)

Requirements: Python 3.9+, pandas, numpy.

Binary record format  (specs/design.md section 2.2)
---------------------------------------------------
Little-endian, fixed width, 18 bytes per record, no padding:

  Offset  Bytes  Type    Field        Notes
  ------  -----  ------  -----------  ----------------------------------------
  0       2      uint16  lon_q        quantised longitude, 0xFFFF = missing
  2       2      uint16  lat_q        quantised latitude,  0xFFFF = missing
  4       2      uint16  year         calendar year, 0 = missing
  6       1      uint8   month        1-12, 0 = missing
  7       2      uint16  species      index into dicts.species, 0xFFFE = missing
  9       1      uint8   family       index into dicts.family,    0xFF = missing
  10      1      uint8   order        index into dicts.order,     0xFF = missing
  11      1      uint8   class_       index into dicts.class_,    0xFF = missing
  12      1      uint8   phylum       index into dicts.phylum,    0xFF = missing
  13      1      uint8   guild        index into dicts.guild,     0xFF = missing
  14      1      uint8   trophic      index into dicts.trophic,   0xFF = missing
  15      1      uint8   dept         index into dicts.dept,      0xFF = missing
  16      1      uint8   ecoregion    index into dicts.ecoregion, 0xFF = missing
  17      1      uint8   corine       index into dicts.corine,    0xFF = missing

Coordinate quantisation (bounding box of metropolitan France):
  lon_q = round((lon - LON_MIN) / (LON_MAX - LON_MIN) * 65534)
  lat_q = round((lat - LAT_MIN) / (LAT_MAX - LAT_MIN) * 65534)
  Points outside the box, or without coordinates, are stored as 0xFFFF.

Dictionaries are sorted by decreasing frequency; values that do not fit in the
dictionary (more than 254 distinct values for a uint8 field) are stored as the
"missing" code.  The whole blob is zlib-compressed (level 9), base64-encoded and
written to data.js together with the dictionaries.
"""

import argparse
import base64
import json
import re
import unicodedata
import sys
import time
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LAT_MIN, LAT_MAX = 41.0, 51.5
LON_MIN, LON_MAX = -5.5, 10.0
Q_MAX = 65534            # highest valid quantised value
COORD_MISSING = 0xFFFF
SPECIES_MISSING = 0xFFFE
U8_MISSING = 0xFF
RECORD_SIZE = 18
MAX_DATAJS_MB = 12.0     # NFR-03.2

DTYPE = np.dtype([
    ("lon_q",     "<u2"),
    ("lat_q",     "<u2"),
    ("year",      "<u2"),
    ("month",     "u1"),
    ("species",   "<u2"),
    ("family",    "u1"),
    ("order",     "u1"),
    ("class_",    "u1"),
    ("phylum",    "u1"),
    ("guild",     "u1"),
    ("trophic",   "u1"),
    ("dept",      "u1"),
    ("ecoregion", "u1"),
    ("corine",    "u1"),
])
assert DTYPE.itemsize == RECORD_SIZE

# logical name -> CSV header (compared case-insensitively, spaces == underscores)
WANTED = {
    "species":   "genus_species_ref",
    "family":    "family",
    "order":     "order",
    "class":     "class",
    "phylum":    "phylum",
    "trophic":   "trophic_mode",
    "guild":     "guild",
    "date":      "date",
    "dept":      "department",
    "ecoregion": "ecoregion",
    "corine":    "corine_biotope",
    "lat":       "gps_latitude",
    "lon":       "gps_longitude",
    "locality":  "locality",
}

CSV_NAMES = ["DATA_Gautier et al 2022.csv", "DATA_Gautier_et_al_2022.csv"]


def log(msg=""):
    print(msg, flush=True)


def norm_header(name):
    return re.sub(r"\s+", "_", str(name).strip().lower())


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------
def find_csv(arg):
    """Locate the source CSV or exit with a helpful message (NFR-05.6)."""
    here = Path(__file__).resolve().parent
    if arg:
        p = Path(arg)
        if not p.is_file():
            sys.exit("ERROR: CSV not found: %s" % p)
        return p
    raw = here / "data_raw"
    for name in CSV_NAMES:
        for base in (raw, here):
            if (base / name).is_file():
                return base / name
    found = sorted(raw.glob("*.csv")) if raw.is_dir() else []
    if len(found) == 1:
        return found[0]
    sys.exit(
        "ERROR: source CSV not found.\n"
        "  Download 'DATA_Gautier et al 2022.csv' from https://zenodo.org/records/17158524\n"
        "  and place it in:  %s\n"
        "  (or pass its location with --csv PATH)" % raw
    )


def detect_separator(path):
    """Return ',' or ';' (or tab) by looking at the header line; handles the UTF-8 BOM."""
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        head = fh.readline()
    counts = {s: head.count(s) for s in (",", ";", "\t")}
    return max(counts, key=counts.get)


def read_csv(path, sample):
    """Read only the needed columns, everything as text (numeric parsing is done explicitly)."""
    sep = detect_separator(path)
    log("Separator detected: %r" % sep)
    header = pd.read_csv(path, sep=sep, encoding="utf-8-sig", nrows=0)
    by_norm = {norm_header(c): c for c in header.columns}
    missing = [h for h in WANTED.values() if h not in by_norm]
    if missing:
        sys.exit("ERROR: missing column(s) in CSV: %s\n  columns found: %s"
                 % (", ".join(missing), ", ".join(map(str, header.columns))))
    usecols = [by_norm[h] for h in WANTED.values()]
    kw = dict(sep=sep, encoding="utf-8-sig", usecols=usecols, dtype=str,
              low_memory=False, keep_default_na=False)
    if sample > 0:
        kw["nrows"] = sample
    df = pd.read_csv(path, **kw)
    inv = {by_norm[h]: k for k, h in WANTED.items()}
    return df.rename(columns=inv)


# ---------------------------------------------------------------------------
# Column cleaning / encoding
# ---------------------------------------------------------------------------
# placeholders used by the source for "no value" (e.g. species "NA NA", coordinates "NULL")
NA_TOKENS = {"", "NULL", "NA", "NaN", "nan", "NA NA"}


def clean_text(series):
    """Strip whitespace; empty strings and NA placeholders become NA."""
    s = series.str.strip()
    return s.mask(s.isin(NA_TOKENS))


def geojson_dept_codes():
    """Département codes of the basemap (used to guarantee they all get a dictionary slot)."""
    p = Path(__file__).resolve().parent / "data_processed" / "departements.geojson"
    try:
        gj = json.loads(p.read_text(encoding="utf-8-sig"))
        return [f["properties"]["code"] for f in gj["features"]]
    except Exception:
        return []


EDIBILITY_CSV = Path(__file__).resolve().parent / "data_processed" / "edibility.csv"


def load_edibility(species):
    """Edibility code per species (0 unknown, 1 edible, 2 edible cooked, 3 not edible, 4 toxic,
    5 deadly) from the curated data_processed/edibility.csv; 'Genus *' lines are genus defaults
    for species not listed.  Returns (codes string, {species idx: note}, {genus: note})."""
    exact, genus, gnotes = {}, {}, {}
    if EDIBILITY_CSV.is_file():
        for line in EDIBILITY_CSV.read_text(encoding="utf-8-sig").splitlines()[1:]:
            if not line.strip() or line.startswith("#"):
                continue
            name, code, note = (line.split(",", 2) + [""])[:3]
            name, code = name.strip(), int(code)
            if name.endswith(" *"):
                genus[name[:-2]] = code
                gnotes[name[:-2]] = note.strip()
            else:
                exact[name] = (code, note.strip())
    codes, notes = [], {}
    for i, sp in enumerate(species):
        if sp in exact:
            codes.append(exact[sp][0])
            if exact[sp][1]:
                notes[i] = exact[sp][1]
        else:
            codes.append(genus.get(sp.split(" ")[0], 0))
    return "".join(str(c) for c in codes), notes, gnotes


# ---- Lambert-93 (EPSG:2154), ellipsoidal two-parallel conic conformal (EPSG method 9802) -------
_A = 6378137.0                       # GRS80 semi-major axis
_F = 1 / 298.257222101
_E2 = 2 * _F - _F * _F
_E = _E2 ** 0.5
_PHI1, _PHI2, _PHI0, _LAM0 = map(np.radians, (44.0, 49.0, 46.5, 3.0))
_FE, _FN = 700000.0, 6600000.0


def _m(phi):
    return np.cos(phi) / np.sqrt(1 - _E2 * np.sin(phi) ** 2)


def _t(phi):
    return np.tan(np.pi / 4 - phi / 2) / ((1 - _E * np.sin(phi)) / (1 + _E * np.sin(phi))) ** (_E / 2)


_N = (np.log(_m(_PHI1)) - np.log(_m(_PHI2))) / (np.log(_t(_PHI1)) - np.log(_t(_PHI2)))
_FF = _m(_PHI1) / (_N * _t(_PHI1) ** _N)
_R0 = _A * _FF * _t(_PHI0) ** _N


def lambert93(lon, lat):
    """lon/lat degrees -> Lambert-93 easting/northing in metres."""
    r = _A * _FF * _t(np.radians(lat)) ** _N
    th = _N * (np.radians(lon) - _LAM0)
    return _FE + r * np.sin(th), _FN + _R0 - r * np.cos(th)


def lambert93_inverse(e, n):
    """Lambert-93 easting/northing -> lon/lat degrees."""
    dx, dy = e - _FE, _R0 - (n - _FN)
    r = np.hypot(dx, dy)
    t = (r / (_A * _FF)) ** (1 / _N)
    lam = np.arctan2(dx, dy) / _N + _LAM0
    phi = np.pi / 2 - 2 * np.arctan(t)
    for _ in range(8):
        phi = np.pi / 2 - 2 * np.arctan(t * ((1 - _E * np.sin(phi)) / (1 + _E * np.sin(phi))) ** (_E / 2))
    return np.degrees(lam), np.degrees(phi)


HEX_W = 10000.0                      # hexagon width, flat to flat (m): area ~86.6 km2 each, all equal
HEX_R = HEX_W / np.sqrt(3)           # circumradius = side length


def hex_of(e, n):
    """Pointy-top hexagon (axial q, r) containing Lambert-93 points (metres), by cube rounding."""
    q = (np.sqrt(3) / 3 * e - n / 3.0) / HEX_R
    r = (2.0 / 3 * n) / HEX_R
    x, z = q, r
    y = -x - z
    rx, ry, rz = np.rint(x), np.rint(y), np.rint(z)
    dx, dy, dz = np.abs(rx - x), np.abs(ry - y), np.abs(rz - z)
    fix_x = (dx > dy) & (dx > dz)
    fix_y = ~fix_x & (dy > dz)
    rx = np.where(fix_x, -ry - rz, rx)
    rz = np.where(~fix_x & ~fix_y, -rx - ry, rz)
    return rx.astype(np.int64), rz.astype(np.int64)
SNAP_M = 3000    # positions this close to the basemap (simplified coastline) are pulled back onto land
COMMUNE_NAME_KM = 12.0   # a site is assigned to the commune named like its locality when that centre is this close
PLACE_MIN_POP = 5000   # communes at least this populous become map labels (toponyms)
POP_JSON = Path(__file__).resolve().parent / "data_raw" / "communes_population.json"


def land_rings():
    """Projected (Lambert-93, metres) rings of the 96 département polygons: [(is_hole, x, y), ...]."""
    p = Path(__file__).resolve().parent / "data_processed" / "departements.geojson"
    gj = json.loads(p.read_text(encoding="utf-8-sig"))
    rings = []
    for f in gj["features"]:
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            for ri, ring in enumerate(poly):
                a = np.array(ring, dtype=float)
                x, y = lambert93(a[:, 0], a[:, 1])
                rings.append((ri > 0, x, y))
    return rings


def point_in_land(rings, e, n):
    """Even-odd ray casting of points (metres) against all rings (outer rings add, holes remove)."""
    inside = np.zeros(len(e), dtype=bool)
    for hole, x, y in rings:
        cand = np.flatnonzero((e >= x.min()) & (e <= x.max()) & (n >= y.min()) & (n <= y.max()))
        for s in range(0, len(cand), 2000):
            c = cand[s:s + 2000]
            px, py = e[c][:, None], n[c][:, None]
            x1, y1, x2, y2 = x[:-1][None, :], y[:-1][None, :], x[1:][None, :], y[1:][None, :]
            cross = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1)
            odd = (cross.sum(axis=1) % 2) == 1
            inside[c[odd]] = not hole
    return inside


def nearest_boundary(rings, e, n):
    """Distance (m) and nearest boundary point of one point (e, n) over every ring segment."""
    best, bx, by = 1e18, e, n
    for _, x, y in rings:
        ax, ay, cx, cy = x[:-1], y[:-1], x[1:], y[1:]
        vx, vy = cx - ax, cy - ay
        t = np.clip(((e - ax) * vx + (n - ay) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
        qx, qy = ax + t * vx, ay + t * vy
        d = np.hypot(e - qx, n - qy)
        k = int(d.argmin())
        if d[k] < best:
            best, bx, by = float(d[k]), float(qx[k]), float(qy[k])
    return best, bx, by


def mask_to_land(lon_q, lat_q):
    """Keep located records on the land area of the basemap (France incl. Corsica).
    Distinct positions outside the polygons are (a) pulled back inside when within SNAP_M of the coast or
    border (the basemap is simplified), or (b) set to 'no position' when farther away (sea, abroad, islands
    absent from the basemap).  Returns new (lon_q, lat_q) and a statistics dict."""
    lon_q, lat_q = lon_q.copy(), lat_q.copy()
    valid = lon_q != COORD_MISSING
    idx = np.flatnonzero(valid)
    key = lon_q[idx].astype(np.uint64) * 65536 + lat_q[idx].astype(np.uint64)
    uniq, inv, counts = np.unique(key, return_inverse=True, return_counts=True)
    lq = (uniq >> np.uint64(16)).astype(np.int64)
    aq = (uniq & np.uint64(0xFFFF)).astype(np.int64)
    lon = LON_MIN + lq / Q_MAX * (LON_MAX - LON_MIN)
    lat = LAT_MIN + aq / Q_MAX * (LAT_MAX - LAT_MIN)
    e, n = lambert93(lon, lat)
    rings = land_rings()
    inside = point_in_land(rings, e, n)
    new_lq, new_aq = lq.copy(), aq.copy()
    snapped = dropped = rec_snapped = rec_dropped = 0
    drop = np.zeros(len(uniq), dtype=bool)
    for k in np.flatnonzero(~inside):
        d, bx, by = nearest_boundary(rings, e[k], n[k])
        if d > SNAP_M:
            drop[k] = True
            dropped += 1; rec_dropped += int(counts[k])
            continue
        # move to the boundary point, then a few hundred metres further inward (direction point -> boundary);
        # the quantised result must itself test as land, otherwise the position is dropped like a far one
        ux, uy = (bx - e[k]) / max(d, 1e-6), (by - n[k]) / max(d, 1e-6)
        placed = False
        for push in (300.0, 100.0, 600.0, 1200.0):
            lo, la = lambert93_inverse(np.array([bx + ux * push]), np.array([by + uy * push]))
            qx = int(np.clip(np.rint((lo[0] - LON_MIN) / (LON_MAX - LON_MIN) * Q_MAX), 0, Q_MAX))
            qy = int(np.clip(np.rint((la[0] - LAT_MIN) / (LAT_MAX - LAT_MIN) * Q_MAX), 0, Q_MAX))
            te, tn = lambert93(LON_MIN + qx / Q_MAX * (LON_MAX - LON_MIN), LAT_MIN + qy / Q_MAX * (LAT_MAX - LAT_MIN))
            if point_in_land(rings, np.array([te]), np.array([tn]))[0]:
                new_lq[k], new_aq[k] = qx, qy
                placed = True
                break
        if placed:
            snapped += 1; rec_snapped += int(counts[k])
        else:
            drop[k] = True
            dropped += 1; rec_dropped += int(counts[k])
    lon_q[idx] = new_lq[inv].astype("<u2")
    lat_q[idx] = new_aq[inv].astype("<u2")
    gone = drop[inv]
    lon_q[idx[gone]] = COORD_MISSING
    lat_q[idx[gone]] = COORD_MISSING
    keep = ~drop                                   # verification: every kept position must now be on land
    e2, n2 = lambert93(LON_MIN + new_lq[keep] / Q_MAX * (LON_MAX - LON_MIN), LAT_MIN + new_aq[keep] / Q_MAX * (LAT_MAX - LAT_MIN))
    still = int((~point_in_land(rings, e2, n2)).sum())
    return lon_q, lat_q, {"positions": len(uniq), "outside": int((~inside).sum()), "snapped": snapped, "still_outside": still,
                          "records_snapped": rec_snapped, "dropped": dropped, "records_dropped": rec_dropped}


def build_places(path_centres, path_pop):
    """Toponyms: communes of at least PLACE_MIN_POP inhabitants (population from geo.api.gouv.fr),
    most populous first.  Returns {names, lon, lat, pop} or None if the population file is missing."""
    if not (path_centres.is_file() and path_pop.is_file()):
        log("Toponyms skipped: %s / %s not found." % (path_centres.name, path_pop.name))
        return None
    pop = {c["code"]: c.get("population") or 0 for c in json.loads(path_pop.read_text(encoding="utf-8-sig"))}
    rows = []
    for c in json.loads(path_centres.read_text(encoding="utf-8-sig")):
        p = pop.get(c["code"], 0)
        if p >= PLACE_MIN_POP and c.get("centre"):
            rows.append((p, c["nom"], c["centre"]["coordinates"][0], c["centre"]["coordinates"][1], c["code"]))
    rows.sort(key=lambda r: -r[0])
    return {"names": [r[1] for r in rows], "lon": [round(r[2], 3) for r in rows],
            "lat": [round(r[3], 3) for r in rows], "pop": [r[0] for r in rows], "code": [r[4] for r in rows]}


COMMUNES_JSON = Path(__file__).resolve().parent / "data_raw" / "communes.json"


def norm_place(s):
    """Normalise a place name for matching: no accents/case/punctuation, 'Saint' -> 'st', no article."""
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"saint(e?)", r"st", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^(le|la|les|l) ", "", s)


def build_communes(s_lon_q, s_lat_q, s_loc, s_names, places, path):
    """Assign every site to a commune (there are no commune polygons offline, only centres):
    1) a commune of the same normalised name as the site's main locality within COMMUNE_NAME_KM, else
    2) the nearest commune centre.  Returns (compact commune table, commune index per site) and adds a
    'commune' index to each toponym.  Approximate: a GPS point near a border can land in the neighbour."""
    if not path.is_file():
        return None, None
    cl = [c for c in json.loads(path.read_text(encoding="utf-8-sig")) if c.get("centre")]
    clon = np.array([c["centre"]["coordinates"][0] for c in cl]); clat = np.array([c["centre"]["coordinates"][1] for c in cl])
    kx = 111.32 * np.cos(np.radians(46.5))
    cx, cy = (clon * kx).astype(np.float32), (clat * 111.32).astype(np.float32)
    lon = LON_MIN + np.asarray(s_lon_q) / Q_MAX * (LON_MAX - LON_MIN)
    lat = LAT_MIN + np.asarray(s_lat_q) / Q_MAX * (LAT_MAX - LAT_MIN)
    sx, sy = (lon * kx).astype(np.float32), (lat * 111.32).astype(np.float32)
    near = np.empty(len(sx), dtype=np.int64)
    for a in range(0, len(sx), 300):
        d2 = (sx[a:a + 300, None] - cx[None, :]) ** 2 + (sy[a:a + 300, None] - cy[None, :]) ** 2
        near[a:a + 300] = d2.argmin(axis=1)
    by_name = {}
    for i, c in enumerate(cl):
        by_name.setdefault(norm_place(c["nom"]), []).append(i)
    chosen, named = near.copy(), 0
    for k in range(len(sx)):
        nm = s_names[s_loc[k]] if s_loc[k] else ""
        cand = by_name.get(norm_place(nm)) if nm else None
        if cand:
            d = np.hypot(cx[cand] - sx[k], cy[cand] - sy[k])
            j = int(d.argmin())
            if d[j] <= COMMUNE_NAME_KM:
                if cand[j] != near[k]:
                    named += 1
                chosen[k] = cand[j]
    by_code = {c["code"]: i for i, c in enumerate(cl)}
    place_idx = [by_code.get(code, -1) for code in places["code"]] if places else []
    used = sorted(set(chosen.tolist()) | {i for i in place_idx if i >= 0})
    remap = {old: new for new, old in enumerate(used)}
    table = {"names": [cl[i]["nom"] for i in used], "dep": [cl[i]["codeDepartement"] for i in used],
             "lon": [round(float(clon[i]), 3) for i in used], "lat": [round(float(clat[i]), 3) for i in used]}
    if places:
        places["commune"] = [remap.get(i, -1) for i in place_idx]
        del places["code"]
    log("Communes: {:,} in the table; {:,} sites assigned ({:,} by locality name instead of nearest centre)".format(
        len(used), len(sx), named))
    return table, [remap[i] for i in chosen.tolist()]


def geocode(df, lat, lon, path):
    """Give a position to the records without a usable GPS point, from their (département, locality):
    1) centre of the commune of that name in that département (geo.api.gouv.fr list, data_raw/communes.json),
    2) else the median GPS position of other observations of the same locality.
    Returns (lat, lon, approx mask).  Approximate positions are commune-level, not collection points."""
    approx = np.zeros(len(df), dtype=bool)
    if not path.is_file():
        log("Geocoding skipped: %s not found (see README)." % path.name)
        return lat, lon, approx
    centre = {}
    for c in json.loads(path.read_text(encoding="utf-8-sig")):
        if c.get("centre"):
            centre.setdefault((c["codeDepartement"], norm_place(c["nom"])), tuple(c["centre"]["coordinates"]))
    dep = df["dept"].str.strip()
    loc = clean_text(df["locality"])
    uniq = {u: norm_place(u) for u in loc.dropna().unique()}
    place = loc.map(uniq)
    exact = (lat.notna() & lon.notna() & lat.between(LAT_MIN, LAT_MAX) & lon.between(LON_MIN, LON_MAX))
    # own-GPS fallback: median position per (département, locality)
    own = (pd.DataFrame({"d": dep[exact], "p": place[exact], "lat": lat[exact], "lon": lon[exact]})
           .dropna(subset=["p"]).groupby(["d", "p"])[["lat", "lon"]].median())
    own_d = {k: (v["lon"], v["lat"]) for k, v in own.to_dict("index").items()}
    need = ~exact & place.notna() & (dep != "")
    new_lon = np.full(len(df), np.nan); new_lat = np.full(len(df), np.nan)
    n_c = n_o = 0
    pairs = pd.DataFrame({"d": dep[need], "p": place[need]}).drop_duplicates()
    found = {}
    for d, p in zip(pairs["d"], pairs["p"]):
        if (d, p) in centre:
            found[(d, p)] = (centre[(d, p)], 1)
        elif (d, p) in own_d:
            found[(d, p)] = (own_d[(d, p)], 2)
    idx = np.flatnonzero(need.to_numpy())
    dv, pv = dep.to_numpy(), place.to_numpy()
    for i in idx:
        hit = found.get((dv[i], pv[i]))
        if hit:
            (new_lon[i], new_lat[i]), how = hit
            approx[i] = True
            n_c += how == 1; n_o += how == 2
    lat = lat.where(~approx, pd.Series(new_lat, index=lat.index))
    lon = lon.where(~approx, pd.Series(new_lon, index=lon.index))
    log("Geocoding: {:,} records placed at their commune centre, {:,} from other observations of the same "
        "locality ({:,} still without position)".format(int(n_c), int(n_o), int(need.sum() - approx.sum())))
    return lat, lon, approx


def build_sites(lon_q, lat_q, locality, approx):
    """Distinct GPS sites (identical quantised coordinates) with their most frequent locality name.
    Returns (lon, lat, locality index, localities, approx flags, hexagon index per site, hexagons), biggest sites first."""
    valid = lon_q != COORD_MISSING
    key = lon_q[valid].astype(np.uint64) * 65536 + lat_q[valid].astype(np.uint64)
    uniq, counts = np.unique(key, return_counts=True)
    order = np.argsort(-counts, kind="stable")
    uniq = uniq[order]
    # a site is "approximate" when none of its records has a real GPS position
    n_exact = pd.Series((~approx[valid]).astype(int)).groupby(key).sum()
    site_approx = [int(n_exact.get(int(k), 0) == 0) for k in uniq]
    loc = clean_text(locality)[valid].reset_index(drop=True)
    d = pd.DataFrame({"k": key, "loc": loc}).dropna()
    best = (d.groupby(["k", "loc"]).size().rename("n").reset_index()
            .sort_values(["k", "n"], ascending=[True, False]).drop_duplicates("k").set_index("k")["loc"])
    names = [""] + sorted(best.unique())
    nidx = {v: i for i, v in enumerate(names)}
    loc_idx = [nidx.get(best.get(int(k)), 0) if int(k) in best.index else 0 for k in uniq]
    s_lon_q = (uniq >> 16).astype(np.int64)
    s_lat_q = (uniq & 0xFFFF).astype(np.int64)
    # 10 km hexagon of each site (pointy-top, 10 km flat to flat, equal area), computed in Lambert-93
    lon_deg = LON_MIN + s_lon_q / Q_MAX * (LON_MAX - LON_MIN)
    lat_deg = LAT_MIN + s_lat_q / Q_MAX * (LAT_MAX - LAT_MIN)
    east, north = lambert93(lon_deg, lat_deg)
    hq, hr = hex_of(east, north)
    ckey, site_cell = np.unique((hq + 10000) * 100000 + (hr + 10000), return_inverse=True)
    cell_q, cell_r = ckey // 100000 - 10000, ckey % 100000 - 10000
    cx = HEX_R * np.sqrt(3) * (cell_q + cell_r / 2.0)
    cy = HEX_R * 1.5 * cell_r
    flat = []
    for i in range(6):                       # per cell: lon0,lat0,...,lon5,lat5
        ang = np.radians(30 + 60 * i)
        lo, la = lambert93_inverse(cx + HEX_R * np.cos(ang), cy + HEX_R * np.sin(ang))
        flat += [lo, la]
    flat = np.stack(flat, axis=1)
    cells = {"q": cell_q.tolist(), "r": cell_r.tolist(),
             "corners": np.round(flat, 4).ravel().tolist()}
    return (s_lon_q.tolist(), s_lat_q.tolist(), loc_idx, names, site_approx, site_cell.tolist(), cells)


def to_float(series):
    """Parse a coordinate column (accepts decimal commas)."""
    return pd.to_numeric(series.str.replace(",", ".", regex=False), errors="coerce")


def encode_categorical(series, max_n, dtype, missing, must_include=()):
    """Dictionary-encode a text column; returns (codes array, values sorted by frequency).
    Values in must_include (if present in the data) always get a slot, displacing the rarest."""
    s = clean_text(series)
    counts = s.value_counts()
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    keep = [k for k, _ in ranked if k in set(must_include)]
    rest = [k for k, _ in ranked if k not in set(keep)]
    values = sorted(keep + rest[:max(0, max_n - len(keep))], key=lambda k: (-counts[k], k))
    codes = pd.Categorical(s, categories=values).codes.astype(np.int64)
    arr = np.where(codes >= 0, codes, missing).astype(dtype)
    return arr, values


def quantise(vals, vmin, vmax, in_range):
    """Map degrees to uint16 [0, 65534]; entries not in_range become 0xFFFF."""
    q = np.rint((vals.to_numpy(dtype="float64") - vmin) / (vmax - vmin) * Q_MAX)
    q = np.where(in_range.to_numpy(), q, COORD_MISSING)
    return np.clip(q, 0, COORD_MISSING).astype("<u2")


YEAR_VALID = (1700, 2021)   # the dataset spans 1708-2021; anything else is a typo in the source


def parse_dates(series, keep_jan1=False):
    """Extract (year, month) arrays; 0 = missing.
    A date of exactly YYYY-01-01 is the source's placeholder for "year only" (70k records,
    ~7x the real January rate), so its month is stored as unknown unless keep_jan1."""
    parts = series.str.extract(r"^\s*(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?")
    year = pd.to_numeric(parts[0], errors="coerce")
    month = pd.to_numeric(parts[1], errors="coerce")
    day = pd.to_numeric(parts[2], errors="coerce")
    year = year.where(year.between(*YEAR_VALID))
    month = month.where(month.between(1, 12) & year.notna())
    if not keep_jan1:
        month = month.where(~((month == 1) & (day == 1)))
    return year.fillna(0).astype("<u2").to_numpy(), month.fillna(0).astype("u1").to_numpy()


# ---------------------------------------------------------------------------
# --inspect
# ---------------------------------------------------------------------------
def inspect(df):
    n = len(df)
    log("\n" + "=" * 64 + "\nSCHEMA / STATISTICS\n" + "=" * 64)
    log("Rows: {:,}".format(n))
    log("\nMissing rates:")
    for c in df.columns:
        miss = int((df[c].str.strip() == "").sum())
        log("  {:<12s} {:>10,}  ({:5.1f}%)".format(c, miss, 100.0 * miss / max(n, 1)))

    lat, lon = to_float(df["lat"]), to_float(df["lon"])
    has = lat.notna() & lon.notna()
    inb = has & lat.between(LAT_MIN, LAT_MAX) & lon.between(LON_MIN, LON_MAX)
    log("\nCoordinates:")
    log("  with lat/lon     : {:>10,}  ({:.1f}%)".format(int(has.sum()), 100.0 * has.mean()))
    log("  inside France box: {:>10,}  ({:.1f}%)".format(int(inb.sum()), 100.0 * inb.mean()))
    log("  outside box      : {:>10,}".format(int((has & ~inb).sum())))

    year, month = parse_dates(df["date"])
    ok = year > 0
    log("\nDates:")
    log("  with year        : {:>10,}  ({:.1f}%)".format(int(ok.sum()), 100.0 * ok.mean()))
    log("  with month       : {:>10,}".format(int((month > 0).sum())))
    if ok.any():
        log("  year range       : %d - %d" % (year[ok].min(), year[ok].max()))
        for dec, cnt in sorted(pd.Series(year[ok] // 10 * 10).value_counts().items()):
            log("    %ds: %s" % (dec, "{:,}".format(cnt)))

    for c in ("phylum", "class", "order", "guild", "trophic", "ecoregion"):
        log("\nTop values - %s:" % c)
        s = clean_text(df[c])
        for v, cnt in s.value_counts(dropna=False).head(12).items():
            log("  {:<40s} {:>10,}  ({:.1f}%)".format(str(v), cnt, 100.0 * cnt / n))
    log("\nDistinct values:")
    for c in ("species", "family", "order", "class", "phylum", "guild", "trophic",
              "dept", "ecoregion", "corine"):
        log("  {:<10s} {:>7,}".format(c, clean_text(df[c]).nunique()))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="FongiMap ETL: CSV -> data.js")
    ap.add_argument("--csv", default=None, help="path to the source CSV")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent),
                    help="output directory for data.js (default: script folder)")
    ap.add_argument("--sample", type=int, default=0, help="only read the first N rows")
    ap.add_argument("--inspect", action="store_true", help="print statistics and exit")
    ap.add_argument("--communes", default=str(COMMUNES_JSON),
                    help="commune list (geo.api.gouv.fr JSON) used to place records without GPS")
    ap.add_argument("--no-geocode", action="store_true", help="do not place records without GPS by commune")
    ap.add_argument("--no-mask", action="store_true", help="do not clip positions to the land area of the basemap")
    ap.add_argument("--keep-jan1", action="store_true",
                    help="keep YYYY-01-01 dates as real January observations")
    args = ap.parse_args()

    t0 = time.time()
    path = find_csv(args.csv)
    log("Reading %s (%.1f MB)" % (path, path.stat().st_size / 1e6))
    df = read_csv(path, args.sample)
    n = len(df)
    log("Rows read: {:,}  ({:.1f}s)".format(n, time.time() - t0))

    if args.inspect:
        inspect(df)
        log("\n--inspect: nothing written.")
        return

    # ---- coordinates -------------------------------------------------------
    lat, lon = to_float(df["lat"]), to_float(df["lon"])
    zeros = int(((lat == 0) & (lon == 0)).sum())
    log("Coordinates in the source: {:,} are the (0, 0) placeholder and {:,} are NULL".format(zeros, int(lat.isna().sum())))
    approx = np.zeros(n, dtype=bool)
    if not args.no_geocode:
        lat, lon, approx = geocode(df, lat, lon, Path(args.communes))
    ok = (lat.notna() & lon.notna() &
          lat.between(LAT_MIN, LAT_MAX) & lon.between(LON_MIN, LON_MAX))
    lon_q = quantise(lon, LON_MIN, LON_MAX, ok)
    lat_q = quantise(lat, LAT_MIN, LAT_MAX, ok)

    # reverse-transform error check (acceptance: < 200 m)
    if ok.any():
        okn = ok.to_numpy() & ~approx
        lon_back = LON_MIN + lon_q[okn].astype("float64") / Q_MAX * (LON_MAX - LON_MIN)
        lat_back = LAT_MIN + lat_q[okn].astype("float64") / Q_MAX * (LAT_MAX - LAT_MIN)
        dlat = np.abs(lat_back - lat.to_numpy()[okn]) * 111_320.0
        dlon = np.abs(lon_back - lon.to_numpy()[okn]) * 111_320.0 * np.cos(np.radians(46.5))
        err = float(np.hypot(dlat, dlon).max())
        log("Coordinates: {:,} in France box; max quantisation error {:.1f} m".format(int(ok.sum()), err))
        assert err < 200, "quantisation error too large"
    else:
        log("WARNING: no usable coordinates found.")

    # ---- land mask: nothing placed over the sea or abroad ----------------------
    if not args.no_mask:
        n_before = int((lon_q != COORD_MISSING).sum())
        lon_q, lat_q, ms = mask_to_land(lon_q, lat_q)
        log("Land mask: {:,} of {:,} distinct positions fall outside the département polygons; "
            "{:,} (-> {:,} records) pulled back within {:.0f} km of the coast/border, "
            "{:,} (-> {:,} records) farther away set to 'no position'".format(
                ms["outside"], ms["positions"], ms["snapped"], ms["records_snapped"], SNAP_M / 1000,
                ms["dropped"], ms["records_dropped"]))
        log("Land mask check: {:,} kept positions still outside the polygons".format(ms["still_outside"]))
        assert n_before - ms["records_dropped"] == int((lon_q != COORD_MISSING).sum())

    # ---- dates ---------------------------------------------------------------
    year, month = parse_dates(df["date"], args.keep_jan1)
    log("Dates: {:,} with year, {:,} with month".format(int((year > 0).sum()), int((month > 0).sum())))

    # ---- dictionaries --------------------------------------------------------
    sp, sp_d = encode_categorical(df["species"], 65534, "<u2", SPECIES_MISSING)
    fam, fam_d = encode_categorical(df["family"], 254, "u1", U8_MISSING)
    ordr, ord_d = encode_categorical(df["order"], 254, "u1", U8_MISSING)
    cls, cls_d = encode_categorical(df["class"], 254, "u1", U8_MISSING)
    phy, phy_d = encode_categorical(df["phylum"], 254, "u1", U8_MISSING)
    gld, gld_d = encode_categorical(df["guild"], 254, "u1", U8_MISSING)
    trp, trp_d = encode_categorical(df["trophic"], 254, "u1", U8_MISSING)
    dpt, dpt_d = encode_categorical(df["dept"], 254, "u1", U8_MISSING, geojson_dept_codes())
    eco, eco_d = encode_categorical(df["ecoregion"], 254, "u1", U8_MISSING)
    cor, cor_d = encode_categorical(df["corine"], 254, "u1", U8_MISSING)
    log("Dictionaries: species={:,} family={} order={} class={} phylum={} guild={} "
        "trophic={} dept={} ecoregion={} corine={}".format(
            len(sp_d), len(fam_d), len(ord_d), len(cls_d), len(phy_d), len(gld_d),
            len(trp_d), len(dpt_d), len(eco_d), len(cor_d)))

    # ---- pack ------------------------------------------------------------------
    arr = np.empty(n, dtype=DTYPE)
    arr["lon_q"], arr["lat_q"] = lon_q, lat_q
    arr["year"], arr["month"] = year, month
    arr["species"] = sp
    arr["family"], arr["order"], arr["class_"] = fam, ordr, cls
    arr["phylum"], arr["guild"], arr["trophic"] = phy, gld, trp
    arr["dept"], arr["ecoregion"], arr["corine"] = dpt, eco, cor
    assert arr.nbytes == RECORD_SIZE * n
    # Record order carries no meaning: sort by (dept, species) so that equal bytes sit
    # together and zlib compresses ~25 % better (stable sort -> deterministic output).
    arr = arr[np.lexsort((arr["species"], arr["dept"]))]
    raw = arr.tobytes()
    log("Packed: {:.2f} MB ({} bytes/record)".format(len(raw) / 1e6, RECORD_SIZE))

    comp = zlib.compress(raw, 9)
    b64 = base64.b64encode(comp).decode("ascii")
    log("Compressed: {:.2f} MB (x{:.1f}); base64: {:.2f} MB".format(
        len(comp) / 1e6, len(raw) / max(len(comp), 1), len(b64) / 1e6))

    # ---- sites (exact GPS positions) and edibility -------------------------------------
    s_lon, s_lat, s_loc, s_names, s_apx, s_cell, cells = build_sites(lon_q, lat_q, df["locality"], approx)
    log("10 km hexagons: {:,} occupied cells".format(len(cells["q"])))
    log("Sites: {:,} distinct positions ({:,} approximate), {:,} locality names".format(
        len(s_lon), sum(s_apx), len(s_names) - 1))
    log("Located records: {:,} ({:.1f}%)".format(int((lon_q != COORD_MISSING).sum()), 100.0 * (lon_q != COORD_MISSING).mean()))
    places = build_places(COMMUNES_JSON, POP_JSON)
    if places:
        log("Toponyms: {:,} communes of at least {:,} inhabitants".format(len(places["names"]), PLACE_MIN_POP))
    communes, s_commune = build_communes(s_lon, s_lat, s_loc, s_names, places, COMMUNES_JSON)
    e_codes, e_notes, e_gnotes = load_edibility(sp_d)
    known = np.array([int(c) for c in e_codes], dtype=np.int64)
    valid_sp = sp != SPECIES_MISSING
    cov = 100.0 * (known[sp[valid_sp]] > 0).mean() if valid_sp.any() else 0.0
    log("Edibility: {:,} taxa classified; {:.1f}% of records have a known class".format(
        int((known > 0).sum()), cov))

    meta = {
        "n_records": int(n),
        "record_size": RECORD_SIZE,
        "lat_min": LAT_MIN, "lat_max": LAT_MAX,
        "lon_min": LON_MIN, "lon_max": LON_MAX,
        "dicts": {
            "species": sp_d, "family": fam_d, "order": ord_d, "class_": cls_d,
            "phylum": phy_d, "guild": gld_d, "trophic": trp_d, "dept": dpt_d,
            "ecoregion": eco_d, "corine": cor_d,
        },
        "sites": {"lon": s_lon, "lat": s_lat, "loc": s_loc, "names": s_names, "approx": s_apx, "cell": s_cell, "commune": s_commune},
        "communes": communes,
        "cells": cells,
        "places": places,
        "edible": {"codes": e_codes, "notes": {str(k): v for k, v in e_notes.items()},
                   "genus_notes": e_gnotes},
    }
    meta_json = json.dumps(meta, ensure_ascii=True, separators=(",", ":"))

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "data.js"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Auto-generated by build.py - do not edit manually\n")
        f.write("// FongiBase dataset - (c) Gautier et al. 2022, licence CC-BY 4.0\n")
        f.write("// Source: https://zenodo.org/records/17158524\n\n")
        f.write("window.FMAP_META = %s;\n\n" % meta_json)
        f.write("window.FMAP_DATA = '%s';\n" % b64)
    size_mb = out.stat().st_size / 1e6
    log("\nWrote %s  (%.2f MB, %.1fs total)" % (out, size_mb, time.time() - t0))
    if size_mb > MAX_DATAJS_MB:
        log("WARNING: data.js exceeds the %.0f MB target." % MAX_DATAJS_MB)
    log("Next: python assemble_html.py   (then open index.html next to data.js)")


if __name__ == "__main__":
    main()
