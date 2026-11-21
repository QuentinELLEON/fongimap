#!/usr/bin/env python3
"""
Prepare data_processed/vernacular_fr.csv: French vernacular names of the species in the FongiBase CSV.

Source: TAXREF (INPN / MNHN) public API, https://taxref.mnhn.fr/api  (taxon record, field frenchVernacularName,
open licence "Licence Ouverte"). The CSV column `cd_ref` is the TAXREF reference code, so no name matching is needed.
Species whose TAXREF record carries no French name stay Latin-only; they are listed in build_reports/.

Run once (about 15-25 minutes for ~12 800 codes, resumable thanks to the cache), commit the output:

    python tools/prepare_vernacular.py            # fetch what is missing from the cache, write the CSV
    python tools/prepare_vernacular.py --top 3000 # only the 3 000 most observed species (fast check)
    python tools/prepare_vernacular.py --offline  # rebuild the CSV from the cache only

Manual overrides: data_processed/vernacular_overrides.csv  (species,name_fr,status)  win over TAXREF; status "validated"
means a human (mycologist) checked it.  Output columns: species,cd_ref,name_fr,aliases,source,status
"""
import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data_raw" / "DATA_Gautier et al 2022.csv"
CACHE = ROOT / "data_raw" / "taxref_cache.jsonl"
OVERRIDES = ROOT / "data_processed" / "vernacular_overrides.csv"
OUT = ROOT / "data_processed" / "vernacular_fr.csv"
REPORT_DIR = ROOT / "build_reports"
API = "https://taxref.mnhn.fr/api/taxa/%s"
HEADERS = {"Accept": "application/hal+json", "User-Agent": "fongimap-data-prep/1.0"}


def fetch(cd):
    for attempt in range(4):
        try:
            req = urllib.request.Request(API % cd, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            return {"id": cd, "ref": d.get("referenceId"), "rank": d.get("rankId"), "fr": d.get("frenchVernacularName"),
                    "sci": d.get("scientificName"), "v": d.get("taxrefVersion")}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"id": cd, "missing": True}
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return {"id": cd, "error": True}


WD_CACHE = ROOT / "data_raw" / "wikidata_cache.json"
SPARQL = "https://query.wikidata.org/sparql"


def wikidata_names(species, batch=150):
    """{species: [French names]} from Wikidata for the given Latin binomials (P225)."""
    import urllib.parse
    out = {}
    for i in range(0, len(species), batch):
        chunk = species[i:i + batch]
        values = " ".join('"%s"' % s.replace('"', "") for s in chunk)
        q = ('SELECT ?name ?fr ?title WHERE { VALUES ?name { %s } ?t wdt:P225 ?name . '
             'OPTIONAL { ?t wdt:P1843 ?fr . FILTER(lang(?fr)="fr") } '
             'OPTIONAL { ?a schema:about ?t ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?title } }') % values
        body = urllib.parse.urlencode({"query": q, "format": "json"}).encode("utf-8")
        data = None
        for attempt in range(4):
            try:
                req = urllib.request.Request(SPARQL, data=body, headers={"User-Agent": "fongimap-data-prep/1.0 (open-source mycology map)", "Accept": "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = json.load(r)
                break
            except Exception as e:
                print("   attempt %d: %s" % (attempt + 1, str(e)[:100]))
                time.sleep(3 * (attempt + 1))
        if not data:
            print("  wikidata batch %d failed" % (i // batch))
            continue
        for b in data["results"]["bindings"]:
            sp = b["name"]["value"]
            names = out.setdefault(sp, [])
            if "fr" in b:
                names.append(b["fr"]["value"])
            if "title" in b:
                t = b["title"]["value"]
                genus = sp.split(" ")[0].lower()
                if "(" not in t and t.lower() != sp.lower() and not t.lower().startswith(genus + " ") and t.lower() != genus:
                    names.append(t)
        time.sleep(1.0)
        print("  wikidata %d/%d" % (min(i + batch, len(species)), len(species)))
    return {k: list(dict.fromkeys(" ".join(n.split()) for n in v)) for k, v in out.items() if v}


def split_names(s):
    """'Cèpe de Bordeaux, Cèpe du Périgord' -> ['Cèpe de Bordeaux', 'Cèpe du Périgord']"""
    if not s:
        return []
    out, seen = [], set()
    for part in str(s).split(","):
        p = " ".join(part.split())
        if p and p.lower() not in seen:
            seen.add(p.lower())
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=0, help="only the N most observed species")
    ap.add_argument("--offline", action="store_true", help="do not call the API")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--wikidata-top", type=int, default=4000, help="look up at most N species still without a name in Wikidata")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    df = pd.read_csv(CSV, usecols=["genus_species_ref", "cd_ref"], dtype=str, encoding="utf-8-sig")
    total = len(df)
    counts = df["genus_species_ref"].value_counts()
    pairs = df.dropna().groupby(["genus_species_ref", "cd_ref"]).size().reset_index(name="n")
    species = [s for s in counts.index if s != "NA NA"]      # "NA NA" = species not recorded in the source
    if args.top:
        species = species[: args.top]
    sp_cds = {}                                   # species -> [cd_ref sorted by frequency]
    for sp, grp in pairs.groupby("genus_species_ref"):
        sp_cds[sp] = list(grp.sort_values("n", ascending=False)["cd_ref"])
    wanted = []
    for sp in species:
        wanted.extend(sp_cds.get(sp, []))
    wanted = list(dict.fromkeys(wanted))

    cache = {}
    if CACHE.exists():
        for line in CACHE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                if not r.get("error"):
                    cache[str(r["id"])] = r
    todo = [c for c in wanted if c not in cache]
    print("species considered: %d  cd_ref wanted: %d  cached: %d  to fetch: %d" % (len(species), len(wanted), len(cache), len(todo)))
    if todo and not args.offline:
        t0 = time.time()
        with open(CACHE, "a", encoding="utf-8") as fh, ThreadPoolExecutor(args.workers) as ex:
            for i, r in enumerate(ex.map(fetch, todo), 1):
                if not r.get("error"):
                    cache[str(r["id"])] = r
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
                if i % 500 == 0:
                    fh.flush()
                    print("  %d/%d  (%.0f s)" % (i, len(todo), time.time() - t0))
    # a synonym carries no name: follow its reference taxon when we already have it
    def names_for(cd):
        r = cache.get(str(cd))
        if not r:
            return [], None
        nm = split_names(r.get("fr"))
        if not nm and r.get("ref") and str(r["ref"]) != str(cd) and str(r["ref"]) in cache:
            nm = split_names(cache[str(r["ref"])].get("fr"))
        return nm, r.get("v")

    overrides = {}
    if OVERRIDES.exists():
        for row in csv.DictReader(open(OVERRIDES, encoding="utf-8")):
            overrides[row["species"]] = row

    rows, version = [], None
    for sp in species:
        if sp in overrides:
            nm = split_names(overrides[sp]["name_fr"])
            if nm:
                rows.append((sp, "", nm[0], "|".join(nm[1:]), "manual", overrides[sp].get("status", "proposed")))
                continue
        best, bestcd = [], ""
        for cd in sp_cds.get(sp, []):
            nm, v = names_for(cd)
            if v:
                version = v
            if nm:
                best, bestcd = nm, cd
                break
        if best:
            rows.append((sp, bestcd, best[0], "|".join(best[1:]), "TAXREF", "source"))
    # second source for what TAXREF does not name: Wikidata (P1843 French common name, else the title of the French
    # Wikipedia article when it is a vernacular name rather than the Latin binomial). Wikidata data is CC0.
    named = {r[0] for r in rows}
    lacking = [s for s in species if s not in named][: args.wikidata_top]
    if lacking and not args.offline:
        wd = wikidata_names(lacking)
        WD_CACHE.write_text(json.dumps(wd, ensure_ascii=False), encoding="utf-8")
    elif WD_CACHE.exists():
        wd = json.loads(WD_CACHE.read_text(encoding="utf-8"))
    else:
        wd = {}
    for sp in lacking:
        nm = wd.get(sp)
        if nm:
            rows.append((sp, "", nm[0], "|".join(nm[1:]), "Wikidata", "source"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["species", "cd_ref", "name_fr", "aliases", "source", "status"])
        w.writerows(rows)

    have = {r[0] for r in rows}
    cover = lambda n: 100.0 * counts[[s for s in counts.index[:n] if s in have]].sum() / counts.iloc[:n].sum()
    print("TAXREF version seen: %s" % version)
    print("species with a French name: %d / %d" % (len(have), len(species)))
    print("observation share with a French name: %.1f %%" % (100.0 * counts[[s for s in counts.index if s in have]].sum() / total))
    for n in (100, 500, 2000):
        if len(counts) >= n:
            print("  top %-4d species: %.1f %% of their observations have a name (%d/%d species)" % (n, cover(n), sum(1 for s in counts.index[:n] if s in have), n))
    REPORT_DIR.mkdir(exist_ok=True)
    miss = [(s, int(counts[s])) for s in counts.index[:500] if s not in have]
    with open(REPORT_DIR / "missing_fr_top500.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n"); w.writerow(["species", "observations"]); w.writerows(miss)
    print("top-500 species without a name: %d (build_reports/missing_fr_top500.csv)" % len(miss))


if __name__ == "__main__":
    main()
