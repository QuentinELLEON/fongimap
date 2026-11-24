  // ═══════════════════════════════════════════════════════════════════════════
  // Side panel toggle (issue #13): the left panel (species list, filters, around-me) can be hidden to give the map the
  // whole window. Two controls drive it (the button in the top bar and the handle on the panel edge), plus the "["
  // key and Ctrl/Cmd + B. The choice is remembered. Hiding the panel resizes the map once, instantly (no animated
  // layout, which would redraw the canvases at every frame); the geography under the eyes stays where it was.
  // ═══════════════════════════════════════════════════════════════════════════
  const SIDE_KEY = 'fongimap-sidebar';
  let sideOpen = true, quietZoom = false;
  try { if (window.localStorage.getItem(SIDE_KEY) === 'closed') sideOpen = false; } catch (e) { /* storage blocked: open */ }

  function paintSidebarControls() {
    const label = sideOpen ? 'Masquer le panneau latéral ([)' : 'Afficher le panneau latéral ([)', aria = sideOpen ? 'Masquer le panneau latéral' : 'Afficher le panneau latéral';
    ['btn-side', 'side-rail'].forEach((id) => {
      const b = $(id); if (!b) return;
      b.setAttribute('aria-expanded', sideOpen ? 'true' : 'false'); b.title = tr(label); b.setAttribute('aria-label', tr(aria));
    });
    $('main').classList.toggle('side-collapsed', !sideOpen);
  }

  // open / close the panel. user = false for the silent restore at start-up.
  function setSidebar(open, user) {
    open = !!open;
    if (open === sideOpen && user !== undefined) return;
    sideOpen = open;
    paintSidebarControls();
    if (user) {
      try { window.localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed'); } catch (e) { /* not remembered */ }
      $('live').textContent = tr(open ? 'Panneau latéral affiché.' : 'Panneau latéral masqué.');
      if (open) {                                          // the panel slides in; closing is instant
        const m = $('main'); m.classList.remove('side-opening'); void m.offsetWidth; m.classList.add('side-opening');
        $('sidebar').addEventListener('animationend', () => m.classList.remove('side-opening'), { once: true });
      }
    }
    if (!zoom) return;                                     // before the map exists nothing needs to move
    const w0 = base.w;
    layoutMap();                                           // synchronous: reads the new size of the map area
    if (getComputedStyle($('main')).flexDirection.indexOf('row') === 0 && w0 && base.w !== w0) {
      quietZoom = true;                                    // keep the geography where it was on screen (the map area grew or shrank on its left)
      try { mapSvg.call(zoom.translateBy, (base.w - w0) / tf.k, 0); } finally { quietZoom = false; }
    }
    requestDraw();
  }
  const toggleSidebar = () => setSidebar(!sideOpen, true);
  function ensureSidebar() { if (!sideOpen) setSidebar(true, true); }

  function initPanelToggle() {
    paintSidebarControls();
    $('btn-side').addEventListener('click', toggleSidebar);
    $('side-rail').addEventListener('click', toggleSidebar);
    document.addEventListener('keydown', (e) => {
      const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.key === '[' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b')) { e.preventDefault(); toggleSidebar(); }
    });
  }
  if (!sideOpen) paintSidebarControls();                   // restored before the first layout: the map starts at its final size
