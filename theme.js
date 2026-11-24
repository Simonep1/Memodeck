// Theme switcher independent of study/deck data.
(() => {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  const meta = document.getElementById('theme-meta');
  function paint(theme) {
    const dark = theme === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    if (icon) icon.textContent = dark ? '☀' : '☾';
    if (label) label.textContent = dark ? 'Tema chiaro' : 'Tema scuro';
    if (btn) {
      btn.setAttribute('aria-label', dark ? 'Attiva modalità chiara' : 'Attiva modalità scura');
      btn.setAttribute('aria-pressed', String(dark));
      btn.title = dark ? 'Passa al tema chiaro' : 'Passa al tema scuro';
    }
    if (meta) meta.content = dark ? '#0c101a' : '#f6f7fb';
  }
  paint(root.dataset.theme);
  btn?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    paint(next);
    try { localStorage.setItem('memodeck-theme', next); } catch(e) { /* private browsing */ }
  });
})();
