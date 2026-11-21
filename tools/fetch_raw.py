#!/usr/bin/env python3
"""Download the FongiBase CSV (Gautier et al. 2022, Zenodo 17158524) into data_raw/ and verify its SHA-256.

    python tools/fetch_raw.py                       # download the CSV if missing, verify
    python tools/fetch_raw.py --what communes       # IGN commune boundaries (TopoJSON, 12 MB, Licence Ouverte)
    python tools/fetch_raw.py --what all --verify   # only verify what is already there

The expected hash is the one of the file the project was built and tested with (it is also the former Git LFS
object id of that file). If Zenodo ever serves a different version the script stops: update EXPECTED_SHA256 only
after checking the new record's version and re-running the golden tests.
"""
import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = {
    "csv": (ROOT / "data_raw" / "DATA_Gautier et al 2022.csv",
            "https://zenodo.org/records/17158524/files/DATA_Gautier%20et%20al%202022.csv?download=1",
            "db9eeadf3297bd56ebc6d474d434b8d44000f1a5597c105be1711a13700a4000"),
    # IGN ADMIN-EXPRESS COG PLUS 2025, communes, TopoJSON WGS84 (data.gouv.fr "Communes et EPCI 2025"), Licence Ouverte v2
    "communes": (ROOT / "data_raw" / "a_com2025_topo.json",
                 "https://static.data.gouv.fr/resources/communes-et-epci-2025-admin-express-cog-plus-ign/20250624-144024/a-com2025-topo.json",
                 "80934e73a3ec25e460d9f4fdea251430b362d9ca98eaa075ac3626ebeb289a40"),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch_one(name, verify_only):
    dest, url, expected = RAW[name]
    if not dest.exists():
        if verify_only:
            sys.exit("missing: %s" % dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        print("Downloading %s ..." % url)
        tmp = dest.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(dest)
    got = sha256(dest)
    if got != expected:
        sys.exit("SHA-256 mismatch for %s\n  expected %s\n  got      %s" % (dest.name, expected, got))
    print("OK  %s  (%.1f MB, sha256 verified)" % (dest.name, dest.stat().st_size / 1e6))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--what", choices=["csv", "communes", "all"], default="csv")
    ap.add_argument("--verify", action="store_true", help="only verify the existing files")
    args = ap.parse_args()
    for name in (RAW if args.what == "all" else [args.what]):
        fetch_one(name, args.verify)


if __name__ == "__main__":
    main()
