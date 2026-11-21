/* ═══════════════════════════════════════════════════════════════════════════
   Marching squares: isoline segments of a regular elevation grid (used for the IGN altitude overlay).
   z: Float32Array / array of n x n values (row-major, index j * n + i); t: threshold; push(p, q) receives the two end points
   of every segment in grid units (x along i, y along j). Cells with a missing value (NaN) are skipped.
   Pure function, unit-tested in Node (tests/contour.test.js).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const core = root.FMAP_CORE = root.FMAP_CORE || {};
  core.isoSegments = function isoSegments(z, n, t, push) {
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = z[j * n + i], b = z[j * n + i + 1], c = z[(j + 1) * n + i + 1], d = z[(j + 1) * n + i];
      if (a !== a || b !== b || c !== c || d !== d) continue;
      const idx = (a >= t ? 1 : 0) | (b >= t ? 2 : 0) | (c >= t ? 4 : 0) | (d >= t ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const L = [i, j + (t - a) / (d - a)], B = [i + (t - a) / (b - a), j], R = [i + 1, j + (t - b) / (c - b)], T = [i + (t - d) / (c - d), j + 1];
      switch (idx) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(R, T); break;
        case 6: case 9: push(B, T); break;
        case 7: case 8: push(L, T); break;
        case 5: if ((a + b + c + d) / 4 >= t) { push(L, T); push(B, R); } else { push(L, B); push(R, T); } break;
        case 10: if ((a + b + c + d) / 4 >= t) { push(L, B); push(R, T); } else { push(L, T); push(B, R); } break;
        default: break;
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
