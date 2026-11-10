/* =====================================================================
   SQL-Optima Studio — Reusable UI Components & Industrial Visualizers
   ===================================================================== */
(function () {
  'use strict';
  var I = window.Icons;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function toast(msg, kind) {
    var root = document.getElementById('toasts');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'badge ' + (kind === 'ok' ? 'sev-ok' : kind === 'error' ? 'sev-critical' : 'sev-warning');
    el.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:99999; padding:10px 18px; border-radius:8px; font-size:0.85rem; box-shadow:0 8px 24px rgba(0,0,0,0.5);';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  function card(o) {
    return '<section class="card ' + (o.span || 'c-12') + '">' +
      (o.title ? '<header class="card-h"><h2 class="card-t">' + (o.icon ? I.get(o.icon, 18) : '') + '<span>' + esc(o.title) + '</span></h2>' + (o.right || '') + '</header>' : '') +
      (o.body || '') +
    '</section>';
  }

  function kpi(label, val, sub, spark, icon) {
    return '<section class="card c-3 kpi">' +
      '<div class="kpi-l">' + (icon ? I.get(icon, 14) : '') + esc(label) + '</div>' +
      '<div class="kpi-v">' + val + '</div>' +
      '<div class="kpi-s">' + esc(sub) + '</div>' +
    '</section>';
  }

  function gauge(val, o) {
    val = Math.max(0, Math.min(100, val || 0));
    var color = val >= 75 ? 'var(--ok)' : val >= 50 ? 'var(--warn)' : 'var(--bad)';
    return '<div style="text-align:center; padding:12px;">' +
      '<svg viewBox="0 0 160 90" width="160" height="90">' +
        '<path d="M 20 80 A 60 60 0 0 1 140 80" fill="none" stroke="var(--border-strong)" stroke-width="12" stroke-linecap="round"/>' +
        '<path d="M 20 80 A 60 60 0 0 1 140 80" fill="none" stroke="' + color + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (val * 1.88) + ' 200"/>' +
        '<text x="80" y="70" text-anchor="middle" font-size="28" font-weight="800" fill="#fff">' + val + '</text>' +
      '</svg>' +
      '<div style="font-size:0.75rem; color:var(--text-dim); text-transform:uppercase; font-weight:700;">' + esc(o.label || 'Score') + '</div>' +
      '<div style="font-size:0.8rem; color:' + color + '; font-weight:700;">' + esc(o.sub || '') + '</div>' +
    '</div>';
  }

  function barList(items) {
    if (!items || items.length === 0) {
      return '<div class="empty"><span>No items to rank.</span></div>';
    }
    var max = Math.max.apply(null, items.map(function (x) { return x.value || 1; }));
    return '<div class="stack" style="gap:10px;">' +
      items.map(function (it) {
        var pct = Math.max(4, Math.min(100, (it.value / max) * 100));
        return '<div>' +
          '<div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:3px;">' +
            '<span class="t" style="font-weight:600;">' + esc(it.label) + '</span>' +
            '<span style="font-family:var(--font-mono); color:var(--text-dim);">' + esc(it.text) + '</span>' +
          '</div>' +
          '<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">' +
            '<div style="width:' + pct + '%; height:100%; background:' + (it.color || 'var(--accent)') + ';"></div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function mockTelemetryChart() {
    return '<svg viewBox="0 0 500 120" width="100%" height="100%" preserveAspectRatio="none">' +
      '<line x1="0" y1="30" x2="500" y2="30" stroke="var(--border)" stroke-dasharray="4"/>' +
      '<line x1="0" y1="70" x2="500" y2="70" stroke="var(--border)" stroke-dasharray="4"/>' +
      '<path d="M 0 80 Q 80 40, 160 65 T 320 30 T 500 45" fill="none" stroke="var(--accent)" stroke-width="2.5"/>' +
      '<path d="M 0 100 Q 90 85, 180 90 T 360 70 T 500 75" fill="none" stroke="var(--warn)" stroke-width="2"/>' +
    '</svg>';
  }

  function mockMultiTrend() {
    return '<svg viewBox="0 0 600 180" width="100%" height="100%" preserveAspectRatio="none">' +
      '<line x1="0" y1="40" x2="600" y2="40" stroke="var(--border)" stroke-dasharray="4"/>' +
      '<line x1="0" y1="90" x2="600" y2="90" stroke="var(--border)" stroke-dasharray="4"/>' +
      '<line x1="0" y1="140" x2="600" y2="140" stroke="var(--border)" stroke-dasharray="4"/>' +
      '<path d="M 0 140 Q 150 130, 300 135 T 600 125" fill="none" stroke="var(--accent)" stroke-width="2.5"/>' +
      '<path d="M 0 80 Q 150 70, 300 65 T 600 60" fill="none" stroke="var(--warn)" stroke-width="2.5"/>' +
      '<path d="M 0 110 Q 120 40, 300 90 T 600 50" fill="none" stroke="var(--cyan)" stroke-width="2"/>' +
    '</svg>';
  }

  function codeEditor(opts) {
    var root = document.createElement('div');
    root.className = 'editor';
    root.innerHTML =
      '<div class="ed-gutter"></div>' +
      '<div class="ed-body">' +
        '<pre class="ed-hl"><code></code></pre>' +
        '<textarea class="ed-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea>' +
      '</div>';

    var ta = root.querySelector('.ed-input');
    var code = root.querySelector('code');
    var gutter = root.querySelector('.ed-gutter');
    var pre = root.querySelector('.ed-hl');

    ta.value = opts.value || '';

    function highlight(s) {
      return esc(s)
        .replace(/\b(SELECT|FROM|WHERE|AND|OR|JOIN|INNER|LEFT|RIGHT|ORDER BY|GROUP BY|TOP|INSERT|UPDATE|DELETE|LIMIT)\b/gi, '<span class="tk-kw">$1</span>')
        .replace(/\b(DATEADD|GETDATE|DATEDIFF|AVG|COUNT|SUM|MIN|MAX|time_bucket)\b/gi, '<span class="tk-fn">$1</span>')
        .replace(/('.*?')/g, '<span class="tk-str">$1</span>')
        .replace(/(--.*)/g, '<span class="tk-com">$1</span>');
    }

    function sync() {
      code.innerHTML = highlight(ta.value) + '\n';
      var lines = ta.value.split('\n').length;
      var g = '';
      for (var i = 1; i <= lines; i++) g += i + '\n';
      gutter.textContent = g;
    }

    ta.addEventListener('input', function () {
      sync();
      if (opts.onChange) opts.onChange(ta.value);
    });

    ta.addEventListener('scroll', function () {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    });

    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (opts.onRun) opts.onRun();
      }
    });

    sync();

    return {
      el: root,
      setValue: function (v) { ta.value = v; sync(); },
      getValue: function () { return ta.value; },
      focus: function () { ta.focus(); }
    };
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  window.UI = {
    esc: esc,
    fmtNum: fmtNum,
    toast: toast,
    card: card,
    kpi: kpi,
    gauge: gauge,
    barList: barList,
    mockTelemetryChart: mockTelemetryChart,
    mockMultiTrend: mockMultiTrend,
    codeEditor: codeEditor,
    download: download
  };
})();