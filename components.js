/* SQL-Optima Studio — reusable UI components (vanilla JS, no build step)
 * Exposes window.UI: helpers, toast, modal, command palette, charts, code editor,
 * execution-plan tree and the social icon bar.
 */
(function () {
  'use strict';
  var I = window.Icons;

  /* ---------- formatting helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function fmtNum(n, d) { d = d || 0; return Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); }
  function fmtCompact(n) { var a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K'; return String(Math.round(n)); }
  function fmtMs(ms) { if (ms < 1) return '<1 ms'; if (ms < 1000) return Math.round(ms) + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s'; if (ms < 3600000) return (ms / 60000).toFixed(1) + ' min'; return (ms / 3600000).toFixed(1) + ' h'; }
  function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'; }
  function timeAgo(ts) { var s = Math.max(1, Math.round((Date.now() - ts) / 1000)); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard', 'ok'); }, fallback);
    return fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied to clipboard', 'ok'); } catch (e) { toast('Copy failed — select and copy manually', 'error'); }
      ta.remove();
    }
  }

  /* ---------- toast ---------- */
  function toast(msg, kind, opts) {
    kind = kind || 'info'; opts = opts || {};
    var root = document.getElementById('toasts'); if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="toast-ico">' + I.get(kind === 'ok' ? 'check' : (kind === 'error' || kind === 'warn') ? 'alert' : 'info', 18) + '</span><span class="toast-msg">' + esc(msg) + '</span>' +
      (opts.action ? '<button class="btn btn-ghost toast-act" type="button">' + esc(opts.action.label) + '</button>' : '');
    root.appendChild(el);
    function remove() { el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }
    if (opts.action) el.querySelector('.toast-act').onclick = function () { opts.action.onClick(); remove(); };
    setTimeout(remove, opts.ms || (opts.action ? 12000 : 3800));
  }

  /* ---------- modal ---------- */
  function modal(o) {
    var prev = document.activeElement, root = document.getElementById('overlay-root');
    var wrap = document.createElement('div'); wrap.className = 'scrim';
    wrap.innerHTML = '<div class="modal modal-' + (o.size || 'md') + ' glass" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      (o.bare ? '' : '<header class="modal-h"><h2>' + esc(o.title) + '</h2><button class="btn btn-ghost btn-icon" type="button" data-close aria-label="Close dialog">' + I.get('x') + '</button></header>') +
      '<div class="modal-b"></div><footer class="modal-f"></footer></div>';
    var b = wrap.querySelector('.modal-b');
    if (typeof o.body === 'string') b.innerHTML = o.body; else if (o.body) b.appendChild(o.body);
    var f = wrap.querySelector('.modal-f');
    (o.actions || []).forEach(function (a) {
      var btn = document.createElement('button'); btn.type = 'button';
      btn.className = 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : '');
      btn.textContent = a.label;
      btn.onclick = function () { var r = a.onClick ? a.onClick(close) : undefined; if (r !== false && !a.keepOpen) close(); };
      f.appendChild(btn);
    });
    if (!(o.actions || []).length) f.remove();
    function close() { document.removeEventListener('keydown', key, true); wrap.remove(); if (prev && prev.focus) try { prev.focus(); } catch (e) { } if (o.onClose) o.onClose(); }
    function key(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Tab') {
        var els = wrap.querySelectorAll('button:not([disabled]),input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])');
        if (!els.length) return; var first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    var cb = wrap.querySelector('[data-close]'); if (cb) cb.onclick = close;
    root.appendChild(wrap); document.addEventListener('keydown', key, true);
    var focusEl = wrap.querySelector('[autofocus],input,select,textarea') || wrap.querySelector('.modal-f .btn') || cb;
    if (focusEl) focusEl.focus();
    return { close: close, el: wrap };
  }
  function confirmDialog(title, message, okLabel, danger) {
    return new Promise(function (resolve) {
      var done = false;
      modal({ title: title, body: '<p>' + esc(message) + '</p>', size: 'sm',
        actions: [{ label: 'Cancel', onClick: function () { done = true; resolve(false); } }, { label: okLabel || 'Confirm', kind: danger ? 'danger' : 'primary', onClick: function () { done = true; resolve(true); } }],
        onClose: function () { if (!done) resolve(false); } });
    });
  }

  /* ---------- command palette (Ctrl/Cmd + K) ---------- */
  function palette(getItems) {
    var items = getItems(), sel = 0, list = items;
    var m = modal({ title: 'Command palette', size: 'palette', bare: true, body:
      '<div class="pal"><div class="pal-in">' + I.get('search') + '<input class="pal-input" type="text" placeholder="Type a command or search…" aria-label="Search commands" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><ul class="pal-list" role="listbox" aria-label="Commands"></ul></div>' });
    var input = m.el.querySelector('.pal-input'), ul = m.el.querySelector('.pal-list');
    function draw() {
      if (!list.length) { ul.innerHTML = '<li class="pal-empty">No matching commands</li>'; return; }
      ul.innerHTML = list.map(function (it, i) {
        return '<li role="option" aria-selected="' + (i === sel) + '" class="pal-item' + (i === sel ? ' sel' : '') + '" data-i="' + i + '">' + I.get(it.icon || 'bolt', 18) + '<span class="pal-label">' + esc(it.label) + '</span>' + (it.hint ? '<span class="pal-hint">' + esc(it.hint) + '</span>' : '') + '</li>';
      }).join('');
      var s = ul.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function run(i) { var it = list[i]; if (!it) return; m.close(); setTimeout(function () { it.run(); }, 30); }
    input.addEventListener('input', function () {
      var t = input.value.trim().toLowerCase(); sel = 0;
      list = !t ? items : items.filter(function (it) { return (it.label + ' ' + (it.keywords || '') + ' ' + (it.hint || '')).toLowerCase().indexOf(t) > -1; });
      draw();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    });
    ul.addEventListener('click', function (e) { var li = e.target.closest('.pal-item'); if (li) run(+li.dataset.i); });
    draw(); input.focus();
  }

  /* ---------- charts (inline SVG / CSS, theme-aware) ---------- */
  function sparkline(values, o) {
    o = o || {}; var w = o.w || 120, h = o.h || 36, c = o.color || 'var(--accent)';
    if (!values || values.length < 2) return '';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = (max - min) || 1;
    var pts = values.map(function (v, i) { return [i / (values.length - 1) * w, h - 3 - (v - min) / span * (h - 6)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="' + c + '" opacity=".14"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function lineChart(series, o) {
    o = o || {}; var W = 640, H = o.h || 220, L = 44, R = 12, T = 12, B = 24;
    var all = []; series.forEach(function (s) { all = all.concat(s.data); });
    var min = o.min != null ? o.min : Math.min.apply(null, all), max = o.max != null ? o.max : Math.max.apply(null, all);
    if (max === min) max = min + 1; var pad = (max - min) * 0.1; if (o.min == null) min -= pad; if (o.max == null) max += pad;
    function X(i, n) { return L + i / Math.max(1, n - 1) * (W - L - R); }
    function Y(v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); }
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var v = min + (max - min) * g / 4, y = Y(v);
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--border)" stroke-dasharray="3 4"/><text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="var(--text-dim)" font-size="11">' + fmtCompact(v) + '</text>';
    }
    var paths = series.map(function (s) {
      var d = s.data.map(function (v, i) { return (i ? 'L' : 'M') + X(i, s.data.length).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('');
    var legend = series.map(function (s) { return '<span class="legend"><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>'; }).join('');
    var xl = o.xLabels ? '<text x="' + L + '" y="' + (H - 6) + '" fill="var(--text-dim)" font-size="11">' + esc(o.xLabels[0]) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" fill="var(--text-dim)" font-size="11">' + esc(o.xLabels[1]) + '</text>' : '';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Line chart') + '">' + grid + paths + xl + '</svg><div class="legends">' + legend + '</div>';
  }
  function barList(items, o) {
    o = o || {}; var max = o.max || Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    return '<ul class="barlist">' + items.map(function (i) {
      return '<li><div class="bl-h"><span class="bl-l">' + esc(i.label) + '</span><span class="bl-v mono">' + esc(i.text != null ? i.text : fmtNum(i.value)) + '</span></div><div class="bar"><span style="width:' + Math.max(2, Math.min(100, i.value / max * 100)).toFixed(1) + '%;' + (i.color ? 'background:' + i.color : '') + '"></span></div></li>';
    }).join('') + '</ul>';
  }
  function gauge(value, o) {
    o = o || {}; var v = Math.max(0, Math.min(100, value)), len = Math.PI * 80;
    var color = v >= 75 ? 'var(--ok)' : v >= 50 ? 'var(--warn)' : 'var(--bad)';
    return '<div class="gauge" role="img" aria-label="' + esc((o.label || 'Score') + ' ' + Math.round(v) + ' out of 100') + '"><svg viewBox="0 0 200 122"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--border-strong)" stroke-width="14" stroke-linecap="round"/><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="' + color + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + (v / 100 * len).toFixed(1) + ' ' + len.toFixed(1) + '" class="gauge-arc"/><text x="100" y="92" text-anchor="middle" font-size="40" font-weight="700" fill="var(--text)">' + Math.round(v) + '</text><text x="100" y="114" text-anchor="middle" font-size="12" fill="var(--text-dim)">' + esc(o.sub || 'out of 100') + '</text></svg></div>';
  }
  function ring(pct, o) {
    o = o || {}; var r = 22, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    return '<div class="ring" role="img" aria-label="' + Math.round(p) + ' percent complete"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="' + r + '" fill="none" stroke="var(--border-strong)" stroke-width="6"/><circle cx="28" cy="28" r="' + r + '" fill="none" stroke="' + (p === 100 ? 'var(--ok)' : 'var(--accent)') + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (p / 100 * c).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 28 28)"/></svg><span>' + Math.round(p) + '%</span></div>';
  }

  /* ---------- execution plan tree ---------- */
  function planNode(n) {
    var warn = (n.warn || []).map(function (w) { return '<span class="badge sev-warning">' + esc(w) + '</span>'; }).join('');
    return '<li><div class="plan-node' + (n.hot ? ' hot' : '') + '"><div class="plan-h"><strong>' + esc(n.op) + '</strong>' + (n.object ? '<span class="muted mono plan-obj">' + esc(n.object) + '</span>' : '') + '<span class="plan-cost mono">' + n.cost.toFixed(0) + '%</span></div><div class="bar"><span style="width:' + Math.min(100, n.cost) + '%"></span></div><div class="plan-m muted">est. rows ' + fmtCompact(n.rows) + (n.read != null ? ' · read ' + fmtCompact(n.read) : '') + '</div>' + warn + '</div>' +
      (n.children && n.children.length ? '<ul>' + n.children.map(planNode).join('') + '</ul>' : '') + '</li>';
  }
  function planTree(root) { return '<ul class="plan" role="tree" aria-label="Execution plan">' + planNode(root) + '</ul>'; }

  /* ---------- syntax highlighting ---------- */
  var LANGS = {
    sql: { name: 'SQL (T-SQL / PL-SQL / PostgreSQL)', ci: true, com: '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/', str: "N?'(?:[^'\\n]|'')*'",
      kw: 'select|from|where|and|or|not|in|is|null|as|on|join|inner|left|right|full|outer|cross|group|by|order|having|top|distinct|union|all|insert|into|values|update|set|delete|create|alter|drop|table|index|clustered|nonclustered|columnstore|partition|function|scheme|view|materialized|with|between|like|exists|case|when|then|else|end|declare|begin|commit|rollback|transaction|tran|if|while|return|limit|offset|fetch|first|rows|only|over|using|option|nolock|include|on|primary|key|default|constraint|interval|cursor|open|close|deallocate|next|exec|execute|go|print|merge|matched|truncate|grant|revoke',
      fn: 'count|sum|avg|min|max|dateadd|datediff|datepart|getdate|convert|cast|isnull|coalesce|row_number|rank|dense_rank|lag|lead|time_bucket|date_trunc|now|sysdate|systimestamp|to_char|to_date|trunc|nvl|round|floor|ceiling|stdev|substring|len|upper|lower|format|create_hypertable|add_compression_policy' },
    intouch: { name: 'InTouch QuickScript', ci: true, com: '\\{[^}]*\\}', str: '"(?:[^"\\n]|"")*"',
      kw: 'if|then|else|elseif|endif|for|to|step|next|while|endwhile|and|or|not|xor|mod|true|false',
      fn: 'sqlconnect|sqldisconnect|sqlselect|sqlinsert|sqlupdate|sqldelete|sqlend|sqlfirst|sqlnext|sqlprev|sqllast|sqlgetrecord|sqlnumrows|sqlerrormsg|sqlcreatetable|sqlclearstatement|logmessage|text|stringleft|stringright|stringmid|stringlen|stringreplace|abs|round|trunc|now|dtext|showwindow|hidewindow|wwvalue|inkey|inputbox|startapp|sleep' },
    csharp: { name: 'C#', ci: false, com: '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/', str: '@?"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)\'',
      kw: 'using|namespace|class|static|void|public|private|protected|internal|async|await|var|new|return|if|else|for|foreach|while|do|try|catch|finally|throw|string|int|long|double|float|decimal|bool|DateTime|TimeSpan|null|true|false|const|readonly|out|ref|in|is|as|this|base|switch|case|break|continue|get|set|record|partial|override|virtual|sealed|abstract|interface|enum|struct|Task|List|Dictionary|IEnumerable',
      fn: 'SqlConnection|SqlCommand|SqlDataReader|SqlParameter|OpenAsync|ExecuteReaderAsync|ExecuteNonQueryAsync|ReadAsync|WriteLine|Parse|ToString|Add|AddWithValue|Dispose|Delay|WriteAllText|AppendAllText|Format' },
    bash: { name: 'Shell / cron / PowerShell', ci: false, com: '#[^\\n]*', str: '"(?:[^"\\\\\\n]|\\\\.)*"|\'[^\'\\n]*\'',
      kw: 'if|then|else|elif|fi|for|do|done|while|case|esac|function|echo|export|set|exit|return|in|local|param|foreach|Write-Host|Invoke-Sqlcmd|try|catch|finally|throw|trap',
      fn: 'sqlcmd|psql|sqlplus|bcp|curl|date|mkdir|cp|mv|rm|gzip|tar|mail|logger|crontab|sed|awk|grep|cat|Get-Date|Export-Csv|Send-MailMessage' }
  };
  function highlight(code, lang) {
    var L = LANGS[lang] || LANGS.sql;
    var re = new RegExp('(' + L.com + ')|(' + L.str + ')|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:' + L.kw + ')\\b)|(\\b(?:' + L.fn + ')\\b)(?=\\s*[({]?)', 'g' + (L.ci ? 'i' : ''));
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      out += esc(code.slice(last, m.index));
      var cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'num' : m[4] ? 'kw' : 'fn';
      out += '<span class="tk-' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last)) + '\n';
  }

  /* ---------- code editor (textarea + highlighted overlay + gutter) ---------- */
  function codeEditor(o) {
    var lang = o.lang || 'sql';
    var root = document.createElement('div'); root.className = 'editor';
    root.innerHTML = '<div class="ed-gutter" aria-hidden="true"></div><div class="ed-body"><pre class="ed-hl" aria-hidden="true"><code></code></pre><textarea class="ed-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="' + esc(o.label || 'Code editor') + '"></textarea></div>';
    var ta = root.querySelector('.ed-input'), code = root.querySelector('code'), pre = root.querySelector('.ed-hl'), gut = root.querySelector('.ed-gutter');
    ta.value = o.value || '';
    function render() {
      code.innerHTML = highlight(ta.value, lang);
      var n = ta.value.split('\n').length, g = '';
      for (var i = 1; i <= n; i++) g += i + '\n';
      gut.textContent = g;
    }
    function sync() { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; }
    ta.addEventListener('input', function () { render(); sync(); if (o.onChange) o.onChange(ta.value); });
    ta.addEventListener('scroll', sync);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); var s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event('input'));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (o.onRun) o.onRun(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (o.onSave) o.onSave(); }
    });
    render();
    return {
      el: root, textarea: ta,
      getValue: function () { return ta.value; },
      setValue: function (v) { ta.value = v; render(); sync(); },
      setLang: function (l) { lang = l; render(); },
      focus: function () { ta.focus(); }
    };
  }

  /* ---------- bento card helper ---------- */
  function card(o) {
    return '<section class="card glass ' + (o.span || 'c-12') + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
      (o.title ? '<header class="card-h"><h2 class="card-t">' + (o.icon ? I.get(o.icon, 18) : '') + '<span>' + esc(o.title) + '</span></h2>' + (o.right || '') + '</header>' : '') + (o.body || '') + '</section>';
  }
  function kpi(label, value, sub, spark, icon) {
    return '<section class="card glass c-3 kpi"><div class="kpi-top"><span class="kpi-l">' + (icon ? I.get(icon, 16) : '') + esc(label) + '</span></div><div class="kpi-v">' + value + '</div><div class="kpi-s muted">' + (sub || '') + '</div>' + (spark || '') + '</section>';
  }

  window.UI = {
    esc: esc, fmtNum: fmtNum, fmtCompact: fmtCompact, fmtMs: fmtMs, fmtMB: fmtMB, timeAgo: timeAgo, uid: uid, debounce: debounce,
    download: download, copyText: copyText, toast: toast, modal: modal, confirm: confirmDialog, palette: palette,
    sparkline: sparkline, lineChart: lineChart, barList: barList, gauge: gauge, ring: ring, planTree: planTree,
    highlight: highlight, LANGS: LANGS, codeEditor: codeEditor, card: card, kpi: kpi,
    socialBar: function () { return I.socialBar(); }
  };
})();
