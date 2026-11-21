  // ═══════════════════════════════════════════════════════════════════════════
  // Theme: light, dark or automatic (system preference). Panels, header and dialogs go dark; the map area keeps its
  // light "paper" palette so that every data colour and label halo stays validated (see .style.css, #map-container).
  // ═══════════════════════════════════════════════════════════════════════════
  const THEME_KEY = 'fongimap-theme';
  let themePref = 'auto';
  try { const v = window.localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark') themePref = v; } catch (e) { /* blocked storage: automatic */ }
  const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  function applyTheme() { document.documentElement.setAttribute('data-theme', themePref === 'dark' || (themePref === 'auto' && systemDark()) ? 'dark' : 'light'); }
  function initTheme() {
    applyTheme();
    if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', applyTheme); }
    const sel = $('sel-theme'); if (!sel) return;
    sel.value = themePref;
    sel.addEventListener('change', () => { themePref = sel.value; try { window.localStorage.setItem(THEME_KEY, themePref === 'auto' ? '' : themePref); } catch (e) { /* not remembered */ } applyTheme(); });
  }
