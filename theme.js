/* Applica tema e dimensione testi salvati (caricato prima del rendering per evitare "flash"). */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('nutri.settings') || '{}');
    var r = document.documentElement;
    if (s.theme === 'light' || s.theme === 'dark') r.setAttribute('data-theme', s.theme);
    var f = parseFloat(s.size);
    if (f >= 1 && f <= 1.5) r.style.setProperty('--fs', String(f));
  } catch (e) { /* ignora */ }
})();
