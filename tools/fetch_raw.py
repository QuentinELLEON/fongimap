#!/usr/bin/env python3
"""Download the FongiBase CSV (Gautier et al. 2022, Zenodo 17158524) into data_raw/ and verify its SHA-256.

    python tools/fetch_raw.py            # download if missing, verify
    python tools/fetch_raw.py --verify   # only verify the existing file

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
DEST = ROOT / "data_raw" / "DATA_Gautier et al 2022.csv"
URL = "https://zenodo.org/records/17158524/files/DATA_Gautier%20et%20al%202022.csv?download=1"
EXPECTED_SHA256 = "db9eeadf3297bd56ebc6d474d434b8d44000f1a5597c105be1711a13700a4000"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="only verify the existing file")
    args = ap.parse_args()
    if not DEST.exists():
        if args.verify:
            sys.exit("missing: %s" % DEST)
        DEST.parent.mkdir(parents=True, exist_ok=True)
        print("Downloading %s ..." % URL)
        tmp = DEST.with_suffix(".part")
        urllib.request.urlretrieve(URL, tmp)
        tmp.replace(DEST)
    got = sha256(DEST)
    if got != EXPECTED_SHA256:
        sys.exit("SHA-256 mismatch for %s\n  expected %s\n  got      %s" % (DEST.name, EXPECTED_SHA256, got))
    print("OK  %s  (%.1f MB, sha256 verified)" % (DEST.name, DEST.stat().st_size / 1e6))


if __name__ == "__main__":
    main()
