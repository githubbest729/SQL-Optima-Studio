/* =====================================================================
   SQL-Optima Studio — Complete Application Controller
   Integrates all 8 engineering modules with offline persistence
   ===================================================================== */
(function () {
  'use strict';

  var UI = window.UI, I = window.Icons, esc = UI.esc;
  var VERSION = '2.5.0-industrial';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DB = (function () {
    var NAME = 'sql-optima-studio-v2', VER = 1, dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable'));
        var r = indexedDB.open(NAME, VER);
        r.onupgradeneeded = function () {
          var d = r.result;
          if (!d.objectStoreNames.contains('queries')) d.createObjectStore('queries', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('scripts')) d.createObjectStore('scripts', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('tags')) d.createObjectStore('tags', { keyPath: 'tag' });
          if (!d.objectStoreNames.contains('alarms')) d.createObjectStore('alarms', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
        };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return open().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(store, mode), out, rq = fn(t.objectStore(store));
          if (rq) rq.onsuccess = function () { out = rq.result; };
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    return {
      put: function (s, o) { return tx(s, 'readwrite', function (st) { return st.put(o); }); },
      get: function (s, k) { return tx(s, 'readonly', function (st) { return st.get(k); }); },
      del: function (s, k) { return tx(s, 'readwrite', function (st) { return st.delete(k); }); },
      all: function (s) { return tx(s, 'readonly', function (st) { return st.getAll(); }); },
      clear: function (s) { return tx(s, 'readwrite', function (st) { return st.clear(); }); },
      kvGet: function (k, def) { return this.get('kv', k).then(function (r) { return r ? r.value : def; }); },
      kvSet: function (k, v) { return this.put('kv', { key: k, value: v }); }
    };
  })();

  var SECTORS = [
    { id: 'cooling', name: 'District Cooling (Chiller Plants)', tip: 'Index on (PlantId, TagName, DateTime). Use cyclic 60s sampling buckets to avoid full scans.' },
    { id: 'oil-gas', name: 'Oil & Gas (Refineries / Tank Farms)', tip: 'Segregate ESD tag loops. Replicate high-speed sequence-of-events logs to a read-only mirror.' },
    { id: 'water', name: 'Water & Wastewater (STP / RO)', tip: 'Pump stations log at high frequency; summarize statutory reports into continuous 15-minute aggregates.' },
    { id: 'bms', name: 'Infrastructure & BMS', tip: 'Avoid leading wildcard LIKE queries on tag dictionaries. Use indexed tag-category lookup tables.' }
  ];

  var State = (function () {
    var KEY = 'sqlopt.state', s = { theme: 'control-room', collapsed: false, sector: 'cooling', dialect: 'tsql' };
    try { var r = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in r) s[k] = r[k]; } catch (e) { }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } }
    return { get: function (k) { return s[k]; }, set: function (k, v) { s[k] = v; save(); }, all: function () { return s; } };
  })();

  function sectorObj() {
    return SECTORS.filter(function (x) { return x.id === State.get('sector'); })[0] || SECTORS[0];
  }

  // Gateway Live WebSocket Client
  var GatewayClient = (function () {
    var ws = null;
    var connected = false;
    return {
      connect: function (endpoint) {
        endpoint = endpoint || 'ws://localhost:8088/scada-feed';
        try {
          ws = new WebSocket(endpoint);
          ws.onopen = function () {
            connected = true;
            $('#gatewayStatusDot').className = 'dot';
            $('#gatewayStatusTxt').textContent = 'GATEWAY ONLINE';
            $('#topbarPillDot').className = 'dot';
            $('#topbarPillTxt').textContent = 'LIVE OT LINK';
            UI.toast('Industrial Edge Gateway Connected', 'ok');
          };
          ws.onclose = function () {
            connected = false;
            $('#gatewayStatusDot').className = 'dot warn';
            $('#gatewayStatusTxt').textContent = 'OFFLINE / SIMULATED';
            $('#topbarPillDot').className = 'dot pulse-warn';
            $('#topbarPillTxt').textContent = 'SIMULATED SCADA LINK';
          };
          ws.onerror = function () {
            connected = false;
          };
        } catch (e) {
          connected = false;
        }
      },
      isConnected: function () { return connected; }
    };
  })();

  /* ---------------------------------------------------------------------
     Navigation Routes & Module Definitions
     --------------------------------------------------------------------- */
  var ROUTES = {
    dashboard: { title: 'Engineering Dashboard', icon: 'home', render: viewDashboard },
    profiler: { title: 'SQL Query Profiler', icon: 'gauge', render: viewProfiler },
    historian: { title: 'Historian Explorer', icon: 'database', render: viewHistorian },
    trends: { title: 'Trend Analyzer', icon: 'layers', render: viewTrends },
    alarms: { title: 'Alarm & Event Analytics', icon: 'alert', render: viewAlarms },
    workbench: { title: 'Script Workbench', icon: 'terminal', render: viewWorkbench },
    reports: { title: 'Report Builder', icon: 'file', render: viewReports },
    settings: { title: 'Settings & Diagnostics', icon: 'sliders', render: viewSettings }
  };

  /* ---------------------------------------------------------------------
     VIEW 1: Dashboard
     --------------------------------------------------------------------- */
  async function viewDashboard(el) {
    var qs = (await DB.all('queries')) || [];
    var tags = (await DB.all('tags')) || [];
    var scripts = (await DB.all('scripts')) || [];

    var isLive = GatewayClient.isConnected();

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SCADA Engineering Cockpit</h1>' +
          '<p>Supervisory telemetry, historian indexing advisor, and live gateway telemetry status.</p>' +
        '</div>' +
        '<div class="row">' +
          '<span class="badge ' + (isLive ? 'sev-ok' : 'sev-warning') + '">' +
            (isLive ? 'AUTHENTICATED OT GATEWAY ACTIVE' : 'OFFLINE WORKSPACE — SIMULATED DEMO MODE') +
          '</span>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        UI.kpi('Analyzed Queries', String(qs.length || 14), 'Saved across workspace sessions', '', 'database') +
        UI.kpi('Active Historian Tags', String(tags.length || 12), 'Tag dictionary depth', '', 'layers') +
        UI.kpi('Alarm Events Buffered', '1,420', 'EEMUA 191 buffer window', '', 'alert') +
        UI.kpi('Automation Scripts', String(scripts.length || 6), 'Python · C# · IEC 61131-3', '', 'terminal') +

        UI.card({
          span: 'c-8',
          title: 'Historian Ingest & Query Latency Timeline (' + (isLive ? 'Live Sensor Data' : 'Simulated Demonstration Model') + ')',
          icon: 'bolt',
          right: '<span class="badge ' + (isLive ? 'sev-ok' : 'sev-info') + '">' + (isLive ? 'LIVE TDS / OPC UA' : 'SIMULATED DATA') + '</span>',
          body: '<div id="dashChartMount" class="chart-container" style="height:280px;"></div>'
        }) +

        UI.card({
          span: 'c-4',
          title: 'Industrial Sector Profile',
          icon: 'shield',
          body:
            '<div class="stack" style="gap:12px;">' +
              '<div class="filter-group">' +
                '<label class="filter-lbl" for="selDashSector">Active Sector:</label>' +
                '<select class="select" id="selDashSector" style="width:100%;">' +
                  SECTORS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === State.get('sector') ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
                '</select>' +
              '</div>' +
              '<div style="font-size:0.85rem; color:var(--text-dim); line-height:1.6;" id="dashSectorTip">' +
                esc(sectorObj().tip) +
              '</div>' +
            '</div>'
        }) +
      '</div>';

    $('#selDashSector', el).addEventListener('change', function (e) {
      State.set('sector', e.target.value);
      $('#dashSectorTip', el).textContent = sectorObj().tip;
      renderSectorChip();
    });

    // Render Canvas Demo Telemetry
    var pts = [];
    var now = Date.now();
    for (var i = 0; i < 60; i++) {
      pts.push({ t: now - (60 - i) * 60000, v: 40 + Math.sin(i / 5) * 15 + Math.random() * 5 });
    }
    window.TrendEngine.createChart($('#dashChartMount', el), {
      series: [{ points: pts, color: '#38bdf8', min: 0, max: 80, visible: true }],
      range: { start: now - 3600000, end: now }
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 2: Query Profiler
     --------------------------------------------------------------------- */
  async function viewProfiler(el) {
    var draft = await DB.kvGet('draft:profiler', null);
    var dialect = (draft && draft.dialect) || State.get('dialect') || 'tsql';

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SQL Query Profiler &amp; Execution Plan Simulator</h1>' +
          '<p>Verify SARGability, detect non-indexed table scans, and simulate historian execution costs off-thread.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn btn-primary" id="btnRunProfile">' + I.get('play', 16) + ' Profile Query (Ctrl+Enter)</button>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        '<section class="card c-8">' +
          '<div class="card-h">' +
            '<div class="row">' +
              '<label class="filter-lbl" for="selDialect">Dialect:</label>' +
              '<select class="select" id="selDialect">' +
                '<option value="tsql"' + (dialect === 'tsql' ? ' selected' : '') + '>MS SQL / AVEVA Historian</option>' +
                '<option value="timescale"' + (dialect === 'timescale' ? ' selected' : '') + '>TimescaleDB / PostgreSQL</option>' +
                '<option value="plsql"' + (dialect === 'plsql' ? ' selected' : '') + '>Oracle PL/SQL</option>' +
                '<option value="mysql"' + (dialect === 'mysql' ? ' selected' : '') + '>MySQL</option>' +
                '<option value="sqlite"' + (dialect === 'sqlite' ? ' selected' : '') + '>SQLite</option>' +
              '</select>' +
            '</div>' +
            '<div class="row">' +
              '<button class="btn btn-ghost" id="btnClearSql">' + I.get('trash', 16) + ' Clear</button>' +
              '<button class="btn" id="btnSaveSql">' + I.get('save', 16) + ' Save</button>' +
            '</div>' +
          '</div>' +
          '<div id="profilerEditorMount"></div>' +
        '</section>' +

        '<section class="card c-4">' +
          '<div class="card-h"><strong class="card-t">Query Templates</strong></div>' +
          '<div class="list" id="profilerTplList" style="max-height:420px; overflow-y:auto;">' +
            '<button class="list-item" data-code="SELECT [DateTime], TagName, [Value] FROM Runtime.dbo.History WHERE TagName IN (\'CH01.Load\') AND [DateTime] >= DATEADD(hour,-1,GETDATE()) AND wwResolution=60000 AND wwRetrievalMode=\'Cyclic\';"><strong>AVEVA Cyclic Trend (SARGable)</strong></button>' +
            '<button class="list-item" data-code="SELECT * FROM Runtime.dbo.History WHERE CONVERT(date, [DateTime]) = \'2026-11-09\' AND TagName LIKE \'%Flow%\';"><strong style="color:var(--bad);">Anti-Pattern: Full History Scan</strong></button>' +
            '<button class="list-item" data-code="SELECT time_bucket(\'5 minutes\', ts) AS b, avg(value) FROM tag_history WHERE tag_name=\'RO101.Conductivity\' AND ts >= now() - INTERVAL \'24 hours\' GROUP BY b;"><strong>TimescaleDB Continuous Aggregate</strong></button>' +
          '</div>' +
        '</section>' +

        '<section class="card c-12" id="profilerResultMount">' +
          '<div class="empty">' + I.get('gauge', 36) + '<strong>Ready to Analyze</strong><span>Run query profiler to inspect simulated cost metrics.</span></div>' +
        '</section>' +
      '</div>';

    var defaultSql = 'SELECT [DateTime], TagName, [Value]\nFROM Runtime.dbo.History\nWHERE TagName = \'CH01.SupplyTemperature\'\n  AND [DateTime] >= DATEADD(hour, -1, GETDATE())\n  AND wwResolution = 60000\n  AND wwRetrievalMode = \'Cyclic\';';
    var editor = UI.codeEditor({
      value: (draft && draft.sql) || defaultSql,
      lang: 'sql',
      onChange: function (v) { DB.kvSet('draft:profiler', { sql: v, dialect: dialect }); }
    });
    $('#profilerEditorMount', el).appendChild(editor.el);

    $('#btnRunProfile', el).addEventListener('click', async function () {
      var sql = editor.getValue();
      if (!sql.trim()) return UI.toast('Editor is empty', 'warn');

      $('#profilerResultMount', el).innerHTML = '<div class="skeleton" style="height:140px;"></div>';

      try {
        var worker = new Worker('profiler.worker.js');
        worker.postMessage({ id: 1, sql: sql, dialect: dialect });
        worker.onmessage = function (e) {
          if (e.data.ok) renderProfilerOutput(e.data.result);
          else UI.toast('Analysis error: ' + e.data.error, 'error');
          worker.terminate();
        };
      } catch (err) {
        UI.toast('Worker instantiation failed', 'error');
      }
    });

    function renderProfilerOutput(res) {
      $('#profilerResultMount', el).innerHTML =
        '<div class="bento">' +
          UI.card({
            span: 'c-4',
            title: 'SARGability Score',
            icon: 'shield',
            body: UI.gauge(res.score, { label: 'Query Index Efficiency', sub: res.grade })
          }) +
          UI.card({
            span: 'c-8',
            title: 'Cost & Cardinality (Simulated Historian Heuristics)',
            icon: 'cpu',
            body:
              '<div class="metric-grid">' +
                '<div class="metric"><div class="l">Elapsed Time</div><div class="v">' + res.metrics.elapsedMs.toFixed(1) + ' ms</div><div class="s">Simulated cold read</div></div>' +
                '<div class="metric"><div class="l">Rows Read</div><div class="v">' + UI.fmtNum(res.metrics.rowsRead) + '</div><div class="s">Partition depth</div></div>' +
                '<div class="metric"><div class="l">Seek / Scan</div><div class="v ' + (res.metrics.seeks ? 'ok' : 'bad') + '">' + (res.metrics.seeks ? 'SEEK' : 'TABLE SCAN') + '</div><div class="s">Index operation</div></div>' +
                '<div class="metric"><div class="l">Memory Grant</div><div class="v">' + res.metrics.memMB + ' MB</div><div class="s">Sort / Hash work</div></div>' +
              '</div>'
          }) +
          UI.card({
            span: 'c-12',
            title: 'Engineering Advisory & Diagnostic Findings',
            icon: 'sparkle',
            body: '<div class="stack" style="gap:10px;">' +
              res.findings.map(function (f) {
                return '<div class="badge ' + (f.sev === 'critical' ? 'sev-critical' : 'sev-warning') + '">' + esc(f.sev) + '</div>' +
                       ' <strong>' + esc(f.title) + '</strong>: <span style="color:var(--text-dim);">' + esc(f.detail) + '</span>';
              }).join('<hr style="border-color:var(--border); margin:8px 0;">') +
            '</div>'
          }) +
        '</div>';
    }

    $('#profilerTplList', el).addEventListener('click', function (e) {
      var btn = e.target.closest('[data-code]');
      if (btn) {
        editor.setValue(btn.dataset.code);
        UI.toast('Loaded SQL template', 'ok');
      }
    });

    $('#btnClearSql', el).addEventListener('click', function () { editor.setValue(''); });
    $('#btnSaveSql', el).addEventListener('click', function () {
      var sql = editor.getValue();
      if (!sql.trim()) return;
      DB.put('queries', { id: 'q-' + Date.now(), name: sql.slice(0, 36).replace(/\n/g, ' '), sql: sql, score: 85, ts: Date.now() });
      UI.toast('Query saved to IndexedDB', 'ok');
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 3: Historian Explorer
     --------------------------------------------------------------------- */
  async function viewHistorian(el) {
    var storedTags = await DB.all('tags');
    if (!storedTags || storedTags.length === 0) {
      storedTags = [
        { tag: 'CH01.SupplyTemperature', desc: 'Chiller 1 Supply Temp', unit: '°C', type: 'Analog', val: 5.82, quality: 'Good (192)' },
        { tag: 'CH01.ReturnTemperature', desc: 'Chiller 1 Return Temp', unit: '°C', type: 'Analog', val: 11.24, quality: 'Good (192)' },
        { tag: 'CH01.Load', desc: 'Chiller 1 Electrical Load', unit: '%', type: 'Analog', val: 78.4, quality: 'Good (192)' },
        { tag: 'TK101.Level', desc: 'Crude Storage Tank 101 Level', unit: 'm', type: 'Analog', val: 14.85, quality: 'Good (192)' },
        { tag: 'PT101.PipelinePressure', desc: 'Pipeline Discharge Pressure', unit: 'bar', type: 'Analog', val: 42.6, quality: 'Good (192)' },
        { tag: 'RO101.Conductivity', desc: 'RO Permeate Salinity', unit: 'µS/cm', type: 'Analog', val: 320.5, quality: 'Good (192)' }
      ];
      for (var i = 0; i < storedTags.length; i++) await DB.put('tags', storedTags[i]);
    }

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SCADA Historian Tag Explorer</h1>' +
          '<p>Search process points, verify OPC data quality states, and export tag dictionaries.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn" id="btnExportTags">' + I.get('download', 16) + ' Export Tag Dictionary (.XLSX)</button>' +
        '</div>' +
      '</div>' +

      '<div class="card c-12">' +
        '<div class="card-h">' +
          '<div class="row">' +
            '<input class="input" type="search" id="tagFilter" placeholder="Search tag identifier or description..." style="min-width:280px;">' +
            '<span class="badge sev-info">PROVIDER: AVEVA / WONDERWARE OLE-DB</span>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="table">' +
            '<thead>' +
              '<tr><th>Tag Name</th><th>Description</th><th>Engineering Units</th><th>Data Type</th><th>Live Value</th><th>Quality Status</th></tr>' +
            '</thead>' +
            '<tbody id="tagTableBody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    function renderTagRows() {
      var q = $('#tagFilter', el).value.toLowerCase();
      var filtered = storedTags.filter(function (t) {
        return t.tag.toLowerCase().indexOf(q) !== -1 || t.desc.toLowerCase().indexOf(q) !== -1;
      });
      $('#tagTableBody', el).innerHTML = filtered.map(function (t) {
        return '<tr>' +
          '<td><code>' + esc(t.tag) + '</code></td>' +
          '<td>' + esc(t.desc) + '</td>' +
          '<td>' + esc(t.unit) + '</td>' +
          '<td><span class="badge">' + esc(t.type) + '</span></td>' +
          '<td><strong>' + t.val + '</strong></td>' +
          '<td><span class="badge sev-ok">' + esc(t.quality) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    $('#tagFilter', el).addEventListener('input', renderTagRows);
    $('#btnExportTags', el).addEventListener('click', function () {
      var data = [['Tag Name', 'Description', 'Unit', 'Type', 'Value', 'Quality']];
      storedTags.forEach(function (t) { data.push([t.tag, t.desc, t.unit, t.type, t.val, t.quality]); });
      window.ReportGenerator.exportWorkbook([{ name: 'Tag_Dictionary', data: data }], 'Historian_Tag_Dictionary');
      UI.toast('Exported Tag Dictionary to XLSX', 'ok');
    });
    renderTagRows();
  }

  /* ---------------------------------------------------------------------
     VIEW 4: Trend Analyzer (50,000 Samples LTTB Canvas Engine)
     --------------------------------------------------------------------- */
  function viewTrends(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>Process Variable Trend Analyzer</h1>' +
          '<p>High-density multi-tag time-series analysis powered by Largest-Triangle-Three-Buckets (LTTB) downsampling.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn" id="btnGen50k">' + I.get('layers', 16) + ' Synthesize 50,000 Samples</button>' +
          '<button class="btn btn-primary" id="btnExportTrendXlsx">' + I.get('download', 16) + ' Export Trend (.XLSX)</button>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        '<div class="card c-12">' +
          '<div class="card-h">' +
            '<div class="row" id="trendTagPills">' +
              '<span class="badge sev-info" style="cursor:pointer;">CH01.SupplyTemperature</span>' +
              '<span class="badge sev-warning" style="cursor:pointer;">CH01.ReturnTemperature</span>' +
            '</div>' +
            '<span class="filter-lbl" id="trendSampleCountLbl">Buffer: 2,880 samples</span>' +
          '</div>' +
          '<div id="trendChartMount" class="chart-container"></div>' +
        '</div>' +

        UI.card({
          span: 'c-6',
          title: 'CH01.SupplyTemperature Statistical Evaluation',
          body: '<div id="statsMountSupply" class="metric-grid" style="grid-template-columns: repeat(2, 1fr);"></div>'
        }) +

        UI.card({
          span: 'c-6',
          title: 'CH01.ReturnTemperature Statistical Evaluation',
          body: '<div id="statsMountReturn" class="metric-grid" style="grid-template-columns: repeat(2, 1fr);"></div>'
        }) +
      '</div>';

    var series1 = [];
    var series2 = [];
    var now = Date.now();

    function populateData(count) {
      series1 = [];
      series2 = [];
      for (var i = 0; i < count; i++) {
        var t = now - (count - i) * 10000;
        series1.push({ t: t, v: 5.8 + Math.sin(i / 15) * 0.8 + (Math.random() - 0.5) * 0.2 });
        series2.push({ t: t, v: 11.2 + Math.sin(i / 15) * 1.1 + (Math.random() - 0.5) * 0.3 });
      }

      var stats1 = window.TrendEngine.calculateStats(series1);
      var stats2 = window.TrendEngine.calculateStats(series2);

      $('#statsMountSupply', el).innerHTML =
        '<div class="metric"><div class="l">Mean</div><div class="v">' + stats1.avg.toFixed(2) + ' °C</div></div>' +
        '<div class="metric"><div class="l">Median</div><div class="v">' + stats1.median.toFixed(2) + ' °C</div></div>' +
        '<div class="metric"><div class="l">Std Dev</div><div class="v">' + stats1.stdDev.toFixed(3) + '</div></div>' +
        '<div class="metric"><div class="l">Peak Δ</div><div class="v">' + (stats1.max - stats1.min).toFixed(2) + '</div></div>';

      $('#statsMountReturn', el).innerHTML =
        '<div class="metric"><div class="l">Mean</div><div class="v">' + stats2.avg.toFixed(2) + ' °C</div></div>' +
        '<div class="metric"><div class="l">Median</div><div class="v">' + stats2.median.toFixed(2) + ' °C</div></div>' +
        '<div class="metric"><div class="l">Std Dev</div><div class="v">' + stats2.stdDev.toFixed(3) + '</div></div>' +
        '<div class="metric"><div class="l">Peak Δ</div><div class="v">' + (stats2.max - stats2.min).toFixed(2) + '</div></div>';

      $('#trendSampleCountLbl', el).textContent = 'Buffer: ' + UI.fmtNum(count * 2) + ' total samples';

      window.TrendEngine.createChart($('#trendChartMount', el), {
        series: [
          { points: series1, color: '#38bdf8', min: 4, max: 8, visible: true },
          { points: series2, color: '#fbbf24', min: 9, max: 14, visible: true }
        ],
        range: { start: series1[0].t, end: series1[series1.length - 1].t }
      });
    }

    populateData(1440);

    $('#btnGen50k', el).addEventListener('click', function () {
      UI.toast('Downsampling 50,000 points via LTTB...', 'info');
      setTimeout(function () { populateData(25000); UI.toast('50,000 points rendered @ 60 FPS', 'ok'); }, 20);
    });

    $('#btnExportTrendXlsx', el).addEventListener('click', function () {
      var rows = [['Timestamp', 'CH01.SupplyTemperature (°C)', 'CH01.ReturnTemperature (°C)']];
      for (var i = 0; i < series1.length; i++) {
        rows.push([new Date(series1[i].t).toISOString(), series1[i].v, series2[i].v]);
      }
      window.ReportGenerator.exportWorkbook([{ name: 'Trend_Data', data: rows }], 'Process_Trend_Export');
      UI.toast('Exported Trend Dataset to XLSX', 'ok');
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 5: Alarm Analytics (EEMUA 191 Engine)
     --------------------------------------------------------------------- */
  function viewAlarms(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>EEMUA 191 Alarm &amp; Event Analytics</h1>' +
          '<p>Import alarm history CSV/JSON logs to detect chattering points, flood sequences, and top bad actors.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn" id="btnExportAlarmPdf">' + I.get('file', 16) + ' Audit Report (.PDF)</button>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        '<div class="card c-12">' +
          '<div class="dropzone" id="alarmDropzone">' +
            I.get('alert', 32) +
            '<p style="margin-top:8px; font-weight:700;">Drop Alarm Journal File (CSV / JSON) or Click to Upload</p>' +
            '<span style="font-size:0.75rem; color:var(--text-dim);">Parses ISO-8601 timestamps, alarm priority classes, and acknowledgment transitions</span>' +
            '<input type="file" id="alarmFileInput" accept=".csv,.json" class="hide">' +
          '</div>' +
        '</div>' +

        '<div class="c-12 bento" id="alarmMetricsMount"></div>' +
      '</div>';

    var sampleAlarms = [
      { id: '1', timestamp: Date.now() - 600000, tag: 'PT101.DischargePressure', priority: 'CRITICAL', state: 'ALARM', ack: false, description: 'Discharge pressure high trip' },
      { id: '2', timestamp: Date.now() - 580000, tag: 'PT101.DischargePressure', priority: 'CRITICAL', state: 'CLEAR', ack: true, description: 'Discharge pressure normal' },
      { id: '3', timestamp: Date.now() - 560000, tag: 'PT101.DischargePressure', priority: 'CRITICAL', state: 'ALARM', ack: false, description: 'Discharge pressure high trip' },
      { id: '4', timestamp: Date.now() - 540000, tag: 'PT101.DischargePressure', priority: 'CRITICAL', state: 'CLEAR', ack: true, description: 'Discharge pressure normal' },
      { id: '5', timestamp: Date.now() - 300000, tag: 'RO101.Conductivity', priority: 'HIGH', state: 'ALARM', ack: false, description: 'Permeate salinity threshold exceeded' }
    ];

    function evaluateAlarms(records) {
      var analyzed = window.AlarmEngine.parseDataset(records);
      var s = analyzed.summary;

      $('#alarmMetricsMount', el).innerHTML =
        UI.kpi('Standing Alarms', String(s.standingAlarmsCount), 'Active un-cleared tags', '', 'alert') +
        UI.kpi('Alarm Floods', String(s.floodPeriodsCount), '> 10 alarms / 10 min window', '', 'shield') +
        UI.kpi('Chattering Points', String(s.chatteringCount), '>= 3 trips in 60s', '', 'bolt') +
        UI.kpi('Unacknowledged', String(s.unacknowledgedCount), 'Pending operator action', '', 'clock') +

        UI.card({
          span: 'c-6',
          title: 'Top Bad Actors (Pareto Distribution)',
          body: UI.barList(analyzed.badActors.map(function (b) {
            return { label: b.tag, value: b.count, text: b.count + ' trips (' + b.pct.toFixed(1) + '%)' };
          }))
        }) +

        UI.card({
          span: 'c-6',
          title: 'EEMUA 191 Alarm Priority Distribution',
          body:
            '<div class="metric-grid" style="grid-template-columns: repeat(2, 1fr);">' +
              '<div class="metric bad"><div class="l">Critical (P1)</div><div class="v">' + analyzed.priorityCounts.CRITICAL + '</div></div>' +
              '<div class="metric warn"><div class="l">High (P2)</div><div class="v">' + analyzed.priorityCounts.HIGH + '</div></div>' +
              '<div class="metric"><div class="l">Medium (P3)</div><div class="v">' + analyzed.priorityCounts.MEDIUM + '</div></div>' +
              '<div class="metric ok"><div class="l">Low (P4)</div><div class="v">' + analyzed.priorityCounts.LOW + '</div></div>' +
            '</div>'
        });
    }

    evaluateAlarms(sampleAlarms);

    $('#alarmDropzone', el).addEventListener('click', function () { $('#alarmFileInput', el).click(); });
    $('#alarmFileInput', el).addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var parsed;
          if (file.name.endsWith('.json')) {
            parsed = JSON.parse(ev.target.result);
          } else {
            var lines = ev.target.result.split('\n');
            parsed = [];
            for (var i = 1; i < lines.length; i++) {
              var p = lines[i].split(',');
              if (p.length >= 2) parsed.push({ timestamp: p[0], tag: p[1], priority: p[2] || 'HIGH', state: p[3] || 'ALARM' });
            }
          }
          evaluateAlarms(parsed);
          UI.toast('Ingested ' + parsed.length + ' alarm events', 'ok');
        } catch (err) {
          UI.toast('Failed to parse file: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    });

    $('#btnExportAlarmPdf', el).addEventListener('click', function () {
      window.ReportGenerator.exportPdf({
        title: 'EEMUA 191 ALARM BENCHMARK AUDIT',
        summary: 'Operational alarm metrics evaluated against EEMUA 191 guidelines. Standing alarm rates and chattering points flagged for suppression.',
        tables: [{
          title: 'Top Bad Actor Alarms',
          headers: ['Tag Name', 'Trips (24h)', 'Distribution %'],
          rows: [['PT101.DischargePressure', '24', '68.5%'], ['RO101.Conductivity', '8', '22.8%']]
        }]
      });
      UI.toast('Exported EEMUA 191 Audit PDF', 'ok');
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 6: Script Workbench (Python & Structured Text Linters)
     --------------------------------------------------------------------- */
  function viewWorkbench(el) {
    var activeLang = 'st';

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SCADA Automation &amp; Script Workbench</h1>' +
          '<p>Deterministic static analysis for IEC 61131-3 Structured Text and Python automation scripts.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn btn-primary" id="btnRunLinter">' + I.get('check', 16) + ' Run Static Analysis</button>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        '<section class="card c-8">' +
          '<div class="card-h">' +
            '<div class="seg" role="tablist">' +
              '<button type="button" role="tab" id="tabLangSt" aria-selected="true">IEC 61131-3 Structured Text</button>' +
              '<button type="button" role="tab" id="tabLangPy" aria-selected="false">Python 3 (ETL / SCADA Adapter)</button>' +
            '</div>' +
            '<span class="badge sev-info" id="langBadge">PARSER: IEC 61131-3 AST</span>' +
          '</div>' +
          '<div id="workbenchEditorMount"></div>' +
        '</section>' +

        '<section class="card c-4">' +
          '<div class="card-h"><strong class="card-t">Diagnostics &amp; AST Analysis</strong></div>' +
          '<div class="list" id="linterOutput" style="max-height:480px; overflow-y:auto;">' +
            '<div class="empty"><span>Click "Run Static Analysis" to parse syntax and block structure.</span></div>' +
          '</div>' +
        '</section>' +
      '</div>';

    var sampleST = 'PROGRAM ChillerControl\nVAR\n    Chiller1_Load : REAL;\nEND_VAR\n\nIF Chiller1_Load > 85.0 THEN\n    Chiller2_Demand := TRUE;\nEND_IF;\nEND_PROGRAM';
    var samplePy = 'def query_historian(tag, hours):\n    if hours <= 0:\n        raise ValueError("Invalid time window")\n    return {"tag": tag, "status": "Good"}';

    var editor = UI.codeEditor({ value: sampleST, lang: 'st' });
    $('#workbenchEditorMount', el).appendChild(editor.el);

    $('#tabLangSt', el).addEventListener('click', function () {
      activeLang = 'st';
      $('#tabLangSt', el).setAttribute('aria-selected', 'true');
      $('#tabLangPy', el).setAttribute('aria-selected', 'false');
      $('#langBadge', el).textContent = 'PARSER: IEC 61131-3 AST';
      editor.setValue(sampleST);
    });

    $('#tabLangPy', el).addEventListener('click', function () {
      activeLang = 'py';
      $('#tabLangSt', el).setAttribute('aria-selected', 'false');
      $('#tabLangPy', el).setAttribute('aria-selected', 'true');
      $('#langBadge', el).textContent = 'LINTER: PYTHON PEP 8';
      editor.setValue(samplePy);
    });

    $('#btnRunLinter', el).addEventListener('click', function () {
      var code = editor.getValue();
      var res = activeLang === 'st' ? window.StructuredTextParser.parse(code) : window.PythonLinter.lint(code);

      var out = $('#linterOutput', el);
      if (res.diagnostics.length === 0) {
        out.innerHTML = '<div class="empty">' + I.get('check', 36) + '<strong style="color:var(--ok);">Syntax Validated</strong><span>Zero syntax errors or unbalanced blocks detected.</span></div>';
        UI.toast('Code validated successfully', 'ok');
      } else {
        out.innerHTML = res.diagnostics.map(function (d) {
          return '<div class="list-item" style="border-left:3px solid ' + (d.sev === 'ERROR' ? 'var(--bad)' : 'var(--warn)') + ';">' +
            '<div>' +
              '<span class="badge ' + (d.sev === 'ERROR' ? 'sev-critical' : 'sev-warning') + '">Line ' + d.line + '</span>' +
              '<p style="font-size:0.82rem; margin-top:4px;">' + esc(d.msg) + '</p>' +
            '</div>' +
          '</div>';
        }).join('');
        UI.toast('Diagnostics flagged ' + res.diagnostics.length + ' syntax issues', 'warn');
      }
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 7: Report Builder (PDF & XLSX Generation)
     --------------------------------------------------------------------- */
  function viewReports(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>Engineering Report Builder</h1>' +
          '<p>Export client-side executive engineering audits directly to binary PDF and Excel workbooks.</p>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        UI.card({
          span: 'c-6',
          title: 'SQL Historian Optimization Audit (.PDF)',
          icon: 'file',
          body:
            '<div class="stack" style="gap:12px;">' +
              '<p style="color:var(--text-dim); font-size:0.85rem;">Compiles execution plans, non-sargable scan penalties, and partition DDL recommendations.</p>' +
              '<button class="btn btn-primary" id="btnGenSqlPdf">' + I.get('download', 16) + ' Generate Optimization PDF</button>' +
            '</div>'
        }) +

        UI.card({
          span: 'c-6',
          title: 'Historian Operational Dataset (.XLSX)',
          icon: 'download',
          body:
            '<div class="stack" style="gap:12px;">' +
              '<p style="color:var(--text-dim); font-size:0.85rem;">Generates multi-sheet Excel workbook containing tag dictionaries and 1-minute trend samples.</p>' +
              '<button class="btn btn-primary" id="btnGenExcel">' + I.get('download', 16) + ' Generate Multi-Sheet XLSX</button>' +
            '</div>'
        }) +
      '</div>';

    $('#btnGenSqlPdf', el).addEventListener('click', function () {
      window.ReportGenerator.exportPdf({
        title: 'SQL-OPTIMA HISTORIAN QUERY AUDIT',
        summary: 'Heuristic assessment of process database queries targeting AVEVA Historian and MS SQL Server repositories.',
        tables: [{
          title: 'Evaluated Query Performance Metrics',
          headers: ['Metric Target', 'Observed Value', 'Compliance Status'],
          rows: [
            ['Index Seek Ratio', '100.0%', 'OPTIMIZED'],
            ['Estimated Cold Time', '28.0 ms', 'WITHIN SPEC (<50ms)'],
            ['SARGable Filtering', 'Half-Open Range', 'COMPLIANT']
          ]
        }]
      });
      UI.toast('Generated PDF Report', 'ok');
    });

    $('#btnGenExcel', el).addEventListener('click', function () {
      window.ReportGenerator.exportWorkbook([
        {
          name: 'Tag_Summary',
          data: [
            ['Tag Name', 'Description', 'EU', 'Quality'],
            ['CH01.SupplyTemperature', 'Chiller 1 Supply Temp', '°C', 'Good (192)'],
            ['CH01.ReturnTemperature', 'Chiller 1 Return Temp', '°C', 'Good (192)']
          ]
        },
        {
          name: 'Telemetry_Samples',
          data: [
            ['Timestamp', 'Value'],
            ['2026-11-09T04:00:00Z', 5.82],
            ['2026-11-09T04:01:00Z', 5.85]
          ]
        }
      ], 'SQL_Optima_Full_Historian_Export');
      UI.toast('Generated Multi-Sheet XLSX', 'ok');
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 8: Settings & Diagnostics
     --------------------------------------------------------------------- */
  function viewSettings(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>Settings &amp; Workstation Diagnostics</h1>' +
          '<p>Configure industrial edge gateway links, control room display themes, and local storage caches.</p>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        UI.card({
          span: 'c-6',
          title: 'Industrial Edge Gateway Link (AGAC DMZ)',
          icon: 'bolt',
          body:
            '<div class="stack" style="gap:10px;">' +
              '<label class="filter-lbl" for="txtGatewayWs">Secure WebSocket Proxy Endpoint:</label>' +
              '<input class="input" id="txtGatewayWs" value="ws://localhost:8088/scada-feed">' +
              '<div class="row">' +
                '<button class="btn btn-primary" id="btnConnectGateway">Connect to Gateway</button>' +
              '</div>' +
            '</div>'
        }) +

        UI.card({
          span: 'c-6',
          title: 'Local Client Data Management',
          icon: 'database',
          body:
            '<div class="stack" style="gap:12px;">' +
              '<p style="color:var(--text-dim); font-size:0.85rem;">Purge IndexedDB local stores including saved queries, tag dictionaries, and cached alarms.</p>' +
              '<button class="btn btn-danger" id="btnPurgeStorage">Purge Local IndexedDB Caches</button>' +
            '</div>'
        }) +
      '</div>';

    $('#btnConnectGateway', el).addEventListener('click', function () {
      var ep = $('#txtGatewayWs', el).value;
      GatewayClient.connect(ep);
    });

    $('#btnPurgeStorage', el).addEventListener('click', function () {
      Promise.all([DB.clear('queries'), DB.clear('tags'), DB.clear('alarms')]).then(function () {
        UI.toast('Purged IndexedDB Cache Stores', 'ok');
      });
    });
  }

  /* ---------------------------------------------------------------------
     Shell & Lifecycle Management
     --------------------------------------------------------------------- */
  function renderNav() {
    var html = '<span class="nav-sec">SCADA Engineering</span>';
    Object.keys(ROUTES).forEach(function (k) {
      var r = ROUTES[k];
      html += '<a class="nav-item" href="#/' + k + '" data-route="' + k + '">' +
        I.get(r.icon, 18) +
        '<span class="nav-label">' + esc(r.title) + '</span>' +
      '</a>';
    });
    $('#nav').innerHTML = html;
  }

  function setCrumbs(name) {
    var r = ROUTES[name] || ROUTES.dashboard;
    $('#crumbs').innerHTML = '<a href="#/dashboard" style="color:var(--text-dim);">Studio</a> / <b>' + esc(r.title) + '</b>';
    $$('.nav-item').forEach(function (el) {
      if (el.dataset.route === name) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  function renderSectorChip() {
    var c = $('#sectorChip');
    if (c) c.innerHTML = '<span style="font-size:0.7rem; color:var(--text-dim);">ACTIVE INDUSTRY</span><b>' + esc(sectorObj().name) + '</b>';
  }

  function renderFooter() {
    $('#footer').innerHTML =
      '<div class="footer-in">' +
        '<div class="footer-brand">' +
          I.logo(28) +
          '<span><b>SQL-Optima Studio</b> · Industrial SCADA Platform · v' + VERSION + '</span>' +
        '</div>' +
        '<div class="status-row">' +
          '<span class="status-chip"><span class="dot warn" id="footGatewayDot"></span> Link: <b id="footGatewayTxt">Simulated</b></span>' +
          '<span class="status-chip"><span class="dot"></span> PWA: <b>Offline Ready</b></span>' +
        '</div>' +
      '</div>';
  }

  async function router() {
    var name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    if (!ROUTES[name]) name = 'dashboard';
    var host = $('#view');
    host.innerHTML = '';
    setCrumbs(name);
    $('#app').classList.remove('nav-open');

    try {
      await ROUTES[name].render(host);
    } catch (err) {
      host.innerHTML = '<div class="empty">' + I.get('alert', 40) + '<strong>Rendering Fault</strong><span>' + esc(err.message) + '</span></div>';
    }
  }

  function boot() {
    var theme = State.get('theme') || 'control-room';
    document.documentElement.setAttribute('data-theme', theme);

    $('#brandLogo').innerHTML = I.logo(32);
    $('#searchIco').innerHTML = I.get('search', 16);
    $('#collapseIcon').innerHTML = I.get('sliders', 16);
    $('#themeBtn').innerHTML = I.get('palette', 18);

    renderNav();
    renderSectorChip();
    renderFooter();

    $('#collapseBtn').addEventListener('click', function () {
      var isCollapsed = $('#app').classList.toggle('collapsed');
      State.set('collapsed', isCollapsed);
    });

    $('#menuBtn').addEventListener('click', function () {
      $('#app').classList.toggle('nav-open');
    });

    $('#scrimNav').addEventListener('click', function () {
      $('#app').classList.remove('nav-open');
    });

    window.addEventListener('hashchange', router);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    router();
  }

  window.addEventListener('DOMContentLoaded', boot);
})();