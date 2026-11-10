/* =====================================================================
   SQL-Optima Studio — Inline Vector Icons (Offline Ready)
   ===================================================================== */
(function () {
  'use strict';

  var GLYPHS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/>',
    gauge: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="M12 14l4-5"/><circle cx="12" cy="14" r="1.5"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5"/>',
    alert: '<path d="M12 3 2 20h20L12 3zM12 9v4M12 17h.01"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.1 2.6-.4.5-.2.8-.8.6-1.3-.2-.5-.1-1.1.2-1.5.7-1 2-1.5 3.1-1.2.5.1 1.1-.1 1.4-.6 1.4-2.1 2.1-4.6 2.1-7 0-5.5-4.5-10-10-10z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    sparkle: '<polygon points="12 2 15 8 21 9 16 14 18 20 12 17 6 20 8 14 3 9 9 8 12 2"/>',
    bug: '<rect x="8" y="9" width="8" height="9" rx="4"/><path d="M9 3v3M15 3v3M6 13H2M22 13h-4M6 17l-3 2M21 19l-3-2M6 9 3 7M21 7l-3 2"/>'
  };

  function get(name, size) {
    size = size || 18;
    return '<svg class="ico" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (GLYPHS[name] || '') + '</svg>';
  }

  function logo(size) {
    size = size || 32;
    return '<svg class="logo" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" aria-hidden="true">' +
      '<rect width="64" height="64" rx="14" fill="#0f1520" stroke="rgba(56,189,248,0.4)" stroke-width="2"/>' +
      '<g fill="none" stroke="#38bdf8" stroke-width="3.5" stroke-linecap="round">' +
        '<ellipse cx="32" cy="18" rx="15" ry="6"/>' +
        '<path d="M17 18v14c0 3.3 6.7 6 15 6s15-2.7 15-6V18"/>' +
        '<path d="M17 32v10c0 3.3 6.7 6 15 6s15-2.7 15-6V32"/>' +
      '</g>' +
      '<path d="M20 44l8-8 6 5 10-12" fill="none" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  }

  window.Icons = { get: get, logo: logo };
})();