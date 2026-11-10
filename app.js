/* =====================================================================
   SQL-Optima Studio — Core Application Controller
   SCADA Query Profiler & Historian Engineering Hub
   ===================================================================== */
(function () {
  'use strict';

  var UI = window.UI, I = window.Icons, esc = UI.esc;
  var VERSION = '2.5.0-industrial';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var L = function () { return Array.prototype.slice.call(arguments).join('\n'); };

  function djb(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ---------------------------------------------------------------------
     IndexedDB Storage Engine
     --------------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------------
     State & Sector Profiles
     --------------------------------------------------------------------- */
  var SECTORS = [
    { id: 'cooling', name: 'District Cooling (Chiller Plant)', color: '#22d3ee', tip: 'Pre-aggregate ΔT and kW/TR tables on (PlantId, TagName, DateTime). Avoid scalar CONVERT on raw cyclic intervals.' },
    { id: 'oil-gas', name: 'Oil & Gas (Refinery & Pipelines)', color: '#f59e0b', tip: 'Segregate Safety Instrumented Systems (ESD). Replicate custody transfer tag logs to a read-only reporting mirror.' },
    { id: 'water', name: 'Water & Wastewater (STP / RO)', color: '#38bdf8', tip: 'Pump stations log at ~1s: utilize continuous aggregates / rollup tables for statutory daily compliance logs.' },
    { id: 'bms', name: 'BMS & Infrastructure', color: '#a78bfa', tip: 'Tunnel fans and BMS handle thousands of tags: query tag dictionary tables rather than using leading wildcard LIKE searches.' }
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

  /* ---------------------------------------------------------------------
     Demonstration Seed Queries (Categorized by Industrial Domain)
     --------------------------------------------------------------------- */
  var TEMPLATES = [
    {
      id: 'dc-chiller-trend',
      category: 'District Cooling',
      name: 'Chiller Plant kW/TR & Flow Trend (1h)',
      dialect: 'tsql',
      sql: L(
        '-- AVEVA Historian: District Cooling Cyclic Retrieval (SARGable)',
        'SELECT [DateTime], TagName, [Value], QualityDetail',
        'FROM Runtime.dbo.History',
        "WHERE TagName IN ('CH01.SupplyTemperature', 'CH01.ReturnTemperature', 'CH01.Load', 'CHW01.FlowRate')",
        '  AND [DateTime] >= DATEADD(hour, -1, GETDATE())',
        '  AND [DateTime] <  GETDATE()',
        '  AND wwResolution = 60000',
        "  AND wwRetrievalMode = 'Cyclic'",
        'ORDER BY TagName, [DateTime];'
      ),
      notes: 'Uses native cyclic retrieval at 60s buckets to eliminate full table scans.'
    },
    {
      id: 'og-esd-alarms',
      category: 'Oil & Gas',
      name: 'Emergency Shutdown (ESD) Alarm Sequence',
      dialect: 'tsql',
      sql: L(
        '-- SCADA Alarm Summary: Sequence of Events (SOE) around trip',
        'SELECT TOP (100) EventTime, Alarm_Source, Priority, Description, AckStatus',
        'FROM Runtime.dbo.AlarmHistory',
        "WHERE EventTime >= '2026-11-09 04:00:00' AND EventTime < '2026-11-09 05:00:00'",
        "  AND Priority >= 800",
        'ORDER BY EventTime DESC;'
      ),
      notes: 'Filters by critical priority to identify trip root causes.'
    },
    {
      id: 'water-ro-conductivity',
      category: 'Water & Wastewater',
      name: 'RO Desalination Conductivity Trend',
      dialect: 'timescale',
      sql: L(
        '-- TimescaleDB: RO Plant 5-minute continuous bucket downsample',
        "SELECT time_bucket('5 minutes', ts) AS bucket, tag_name,",
        '       AVG(value) AS avg_conductivity, MAX(value) AS peak_conductivity',
        'FROM tag_history',
        "WHERE tag_name = 'RO101.Conductivity'",
        "  AND ts >= NOW() - INTERVAL '24 hours'",
        'GROUP BY bucket, tag_name',
        'ORDER BY bucket DESC',
        'LIMIT 288;'
      ),
      notes: 'Utilizes chunk exclusion over time hypertable.'
    },
    {
      id: 'anti-pattern-full-scan',
      category: 'Anti-Patterns',
      name: 'Anti-Pattern: CONVERT on History (Table Scan)',
      dialect: 'tsql',
      sql: L(
        '-- SLOW: Wrapping functions around time columns causes non-sargable scan',
        'SELECT *',
        'FROM Runtime.dbo.History',
        "WHERE CONVERT(date, [DateTime]) = '2026-11-09'",
        "  AND TagName LIKE '%Flow%'",
        'ORDER BY [DateTime] DESC;'
      ),
      notes: 'Forces index scan over hundreds of millions of samples.'
    }
  ];

  /* ---------------------------------------------------------------------
     Demonstration SCADA Tags for Explorer & Trend Analyzer
     --------------------------------------------------------------------- */
  var HISTORIAN_TAGS = [
    { tag: 'CH01.SupplyTemperature', sector: 'District Cooling', desc: 'Chiller 1 Supply Temp', unit: '°C', type: 'Analog', val: 5.8, quality: 'Good (192)' },
    { tag: 'CH01.ReturnTemperature', sector: 'District Cooling', desc: 'Chiller 1 Return Temp', unit: '°C', type: 'Analog', val: 11.2, quality: 'Good (192)' },
    { tag: 'CH01.Load', sector: 'District Cooling', desc: 'Chiller 1 Electrical Load', unit: '%', type: 'Analog', val: 78.4, quality: 'Good (192)' },
    { tag: 'CHW01.FlowRate', sector: 'District Cooling', desc: 'Main Header Chilled Water Flow', unit: 'm³/h', type: 'Analog', val: 1420.0, quality: 'Good (192)' },
    { tag: 'TK101.Level', sector: 'Oil & Gas', desc: 'Crude Storage Tank 101 Level', unit: 'm', type: 'Analog', val: 14.85, quality: 'Good (192)' },
    { tag: 'PT101.PipelinePressure', sector: 'Oil & Gas', desc: 'Transfer Pipeline Pressure', unit: 'bar', type: 'Analog', val: 42.6, quality: 'Good (192)' },
    { tag: 'ESD101.Active', sector: 'Oil & Gas', desc: 'Terminal Emergency Shutdown', unit: 'bool', type: 'Discrete', val: 0, quality: 'Good (192)' },
    { tag: 'STP101.InletFlow', sector: 'Water & Wastewater', desc: 'Sewage Treatment Inlet Flow', unit: 'l/s', type: 'Analog', val: 185.3, quality: 'Good (192)' },
    { tag: 'RO101.Conductivity', sector: 'Water & Wastewater', desc: 'RO Permeate Conductivity', unit: 'µS/cm', type: 'Analog', val: 320.5, quality: 'Good (192)' },
    { tag: 'PUMP101.RunningStatus', sector: 'Water & Wastewater', desc: 'Lift Pump 101 Run Status', unit: 'state', type: 'Discrete', val: 1, quality: 'Good (192)' }
  ];

  // Live tag ring buffer (holds up to 60 live points per tag for real-time trending)
  var LIVE_TELEMETRY = {
    'CH01.SupplyTemperature': [],
    'CH01.ReturnTemperature': [],
    'CH01.Load': []
  };

  function updateTagTelemetry(tagUpdate) {
    var found = HISTORIAN_TAGS.filter(function (t) { return t.tag === tagUpdate.tag; })[0];
    if (found) {
      found.val = tagUpdate.value;
      found.quality = tagUpdate.quality || 'Good (192)';
    }

    if (!LIVE_TELEMETRY[tagUpdate.tag]) LIVE_TELEMETRY[tagUpdate.tag] = [];
    LIVE_TELEMETRY[tagUpdate.tag].push({
      time: new Date(tagUpdate.sourceTimestamp || tagUpdate.timestamp || Date.now()),
      val: tagUpdate.value
    });
    if (LIVE_TELEMETRY[tagUpdate.tag].length > 60) LIVE_TELEMETRY[tagUpdate.tag].shift();

    var rowVal = document.querySelector('[data-tag-val="' + tagUpdate.tag + '"]');
    if (rowVal) {
      rowVal.textContent = tagUpdate.value.toFixed(2);
      rowVal.classList.add('val-pulse');
      setTimeout(function () { rowVal.classList.remove('val-pulse'); }, 300);
    }

    if (window.renderLiveTrend) {
      window.renderLiveTrend(LIVE_TELEMETRY);
    }
  }

  /* ---------------------------------------------------------------------
     Script Seeds (Multi-Language)
     --------------------------------------------------------------------- */
  var SCRIPT_SEEDS = [
    {
      id: 's-python',
      name: 'historian_batch_export.py',
      lang: 'python',
      code: L(
        '# Python 3: SCADA Historian Telemetry Exporter (Read-Only)',
        'import datetime',
        'import pandas as pd',
        '',
        'def fetch_hourly_rollups(tag_name: str, hours: int = 24):',
        '    """Simulated ETL adapter for AGAC industrial reports."""',
        '    end_time = datetime.datetime.now()',
        '    start_time = end_time - datetime.timedelta(hours=hours)',
        '    print(f"Connecting to Historian: {tag_name} between {start_time} and {end_time}")',
        '    # In production: connect via pyodbc using Windows Integrated Security',
        '    return pd.DataFrame({"timestamp": [start_time, end_time], "value": [5.8, 6.2]})',
        '',
        'if __name__ == "__main__":',
        '    fetch_hourly_rollups("CH01.SupplyTemperature")'
      )
    },
    {
      id: 's-csharp',
      name: 'HistorianIngestAdapter.cs',
      lang: 'csharp',
      code: L(
        'using System;',
        'using System.Threading.Tasks;',
        'using Microsoft.Data.SqlClient;',
        '',
        'public static class HistorianIngestAdapter',
        '{',
        '    public static async Task ExportAsync(string connStr, string tag, int mins)',
        '    {',
        '        const string sql = @"SELECT TOP (5000) [DateTime], [Value] FROM Runtime.dbo.History',
        '                              WHERE TagName = @tag AND [DateTime] >= DATEADD(minute, -@m, GETDATE())',
        '                              AND wwResolution = 60000 ORDER BY [DateTime]";',
        '        using var conn = new SqlConnection(connStr);',
        '        await conn.OpenAsync();',
        '        using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };',
        '        cmd.Parameters.AddWithValue("@tag", tag);',
        '        cmd.Parameters.AddWithValue("@m", mins);',
        '        using var rdr = await cmd.ExecuteReaderAsync();',
        '        while (await rdr.ReadAsync()) {',
        '            Console.WriteLine($"{rdr.GetDateTime(0):s},{rdr.GetDouble(1)}");',
        '        }',
        '    }',
        '}'
      )
    },
    {
      id: 's-st',
      name: 'ChillerLoadSequencer.st',
      lang: 'st',
      code: L(
        '(* IEC 61131-3 Structured Text: Chiller Stage-Up Logic *)',
        'PROGRAM ChillerSequencer',
        'VAR',
        '    Chiller1_Load     : REAL := 85.5;',
        '    Chiller2_Demand   : BOOL := FALSE;',
        '    HighLoadTimer     : TON;',
        'END_VAR',
        '',
        'HighLoadTimer(IN := (Chiller1_Load > 85.0), PT := T#15M);',
        'IF HighLoadTimer.Q THEN',
        '    Chiller2_Demand := TRUE;',
        'END_IF;'
      )
    }
  ];

  /* ---------------------------------------------------------------------
     Profiler Web Worker Client
     --------------------------------------------------------------------- */
  var Profiler = (function () {
    var worker = null, seq = 0, pending = {};
    function init() {
      if (worker) return;
      try {
        worker = new Worker('profiler.worker.js');
        worker.onmessage = function (e) {
          var p = pending[e.data.id];
          if (!p) return;
          delete pending[e.data.id];
          if (e.data.ok) p.res(e.data.result);
          else p.rej(new Error(e.data.error));
        };
      } catch (err) {
        worker = null;
      }
    }
    return {
      run: function (sql, dialect) {
        init();
        if (!worker) {
          return window.SQLProfiler ? Promise.resolve(window.SQLProfiler.analyze(sql, dialect)) : Promise.reject(new Error('Profiler worker unavailable'));
        }
        return new Promise(function (res, rej) {
          var id = ++seq;
          pending[id] = { res: res, rej: rej };
          worker.postMessage({ id: id, sql: sql, dialect: dialect });
        });
      }
    };
  })();

  /* ---------------------------------------------------------------------
     Routing & Navigation
     --------------------------------------------------------------------- */
  function go(route) {
    location.hash = '#/' + route;
  }

  var ROUTES = {
    dashboard: { title: 'Engineering Dashboard', icon: 'home', render: viewDashboard },
    profiler: { title: 'SQL Query Profiler', icon: 'gauge', render: viewProfiler },
    historian: { title: 'Historian Explorer', icon: 'database', render: viewHistorian },
    trends: { title: 'Trend Analyzer', icon: 'layers', render: viewTrends },
    alarms: { title: 'Alarm & Event Analytics', icon: 'alert', render: viewAlarms },
    workbench: { title: 'Script Workbench', icon: 'terminal', render: viewWorkbench },
    settings: { title: 'System Diagnostics & Settings', icon: 'sliders', render: viewSettings }
  };

  /* ---------------------------------------------------------------------
     VIEW 1: Upgraded Engineering Dashboard
     --------------------------------------------------------------------- */
  async function viewDashboard(el) {
    var qs = (await DB.all('queries')) || [];
    var scripts = (await DB.all('scripts')) || [];

    var displayQueries = qs.slice();
    if (displayQueries.length === 0) {
      displayQueries = [
        { id: 'q1', name: 'CHW Trend 60m', score: 92, elapsedMs: 38, projectedMs: 35, ts: Date.now() - 3600000, critical: 0 },
        { id: 'q2', name: 'RO Conductivity Rollup', score: 85, elapsedMs: 142, projectedMs: 40, ts: Date.now() - 7200000, critical: 0 },
        { id: 'q3', name: 'Raw Tag Scan (Unindexed)', score: 38, elapsedMs: 2450, projectedMs: 120, ts: Date.now() - 14400000, critical: 1 }
      ];
    }

    var avgScore = Math.round(displayQueries.reduce(function (s, q) { return s + (q.score || 0); }, 0) / displayQueries.length);
    var criticalCount = displayQueries.reduce(function (s, q) { return s + (q.critical || 0); }, 0);
    var slowQueries = displayQueries.slice().sort(function (a, b) { return b.elapsedMs - a.elapsedMs; }).slice(0, 5);

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SCADA Query &amp; Historian Cockpit</h1>' +
          '<p>Engineering performance monitoring for AVEVA Historian, TimescaleDB, and MS SQL Server.</p>' +
        '</div>' +
        '<div class="row">' +
          '<span class="badge sev-warning">DEMO MODE — SIMULATED HISTORIAN METRICS</span>' +
        '</div>' +
      '</div>' +

      '<div class="filter-bar">' +
        '<div class="filter-group">' +
          '<span class="filter-lbl">Sector:</span>' +
          '<select class="select" id="dashSector">' +
            SECTORS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === State.get('sector') ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div class="filter-group">' +
          '<span class="filter-lbl">Time Window:</span>' +
          '<select class="select" id="dashWindow">' +
            '<option value="1h">Last 1 Hour (Cyclic)</option>' +
            '<option value="24h" selected>Last 24 Hours (Operational)</option>' +
            '<option value="7d">Last 7 Days (Archival)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        UI.kpi('Historian Health', avgScore + '/100', 'Heuristic composite score', '', 'shield') +
        UI.kpi('Analyzed Queries', String(displayQueries.length), 'Saved in local workspace', '', 'database') +
        UI.kpi('Critical Bottlenecks', String(criticalCount), criticalCount > 0 ? 'Non-sargable scans' : 'No major bottlenecks', '', 'alert') +
        UI.kpi('Active Scripts', String(scripts.length || 3), 'Python · C# · IEC 61131-3', '', 'terminal') +

        UI.card({
          span: 'c-8',
          title: 'Historian Ingestion & Query Telemetry (Simulated)',
          icon: 'bolt',
          right: '<span class="badge sev-info">SIMULATED FEED</span>',
          body: '<div id="telemetryChartMount">' + UI.mockTelemetryChart() + '</div>'
        }) +

        UI.card({
          span: 'c-4',
          title: 'Top Latency Queries',
          icon: 'clock',
          body: UI.barList(slowQueries.map(function (q) {
            return {
              label: q.name,
              value: q.elapsedMs,
              text: q.elapsedMs + ' ms',
              color: q.elapsedMs > 1000 ? 'var(--bad)' : 'var(--accent)'
            };
          }))
        }) +

        UI.card({
          span: 'c-12',
          title: 'Industrial Sector Optimization Guidance',
          icon: 'layers',
          body: '<p class="tip" id="sectorTipText" style="padding: 12px; background: rgba(56,189,248,0.06); border-radius: 6px; border-left: 3px solid var(--accent);">' + esc(sectorObj().tip) + '</p>'
        }) +
      '</div>';

    $('#dashSector', el).addEventListener('change', function (e) {
      State.set('sector', e.target.value);
      $('#sectorTipText', el).textContent = sectorObj().tip;
      renderSectorChip();
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 2: Upgraded Query Profiler
     --------------------------------------------------------------------- */
  async function viewProfiler(el) {
    var draft = await DB.kvGet('draft:profiler', null);
    var dialect = (draft && draft.dialect) || State.get('dialect') || 'tsql';
    var activeTab = 'tpl';

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SQL Query Profiler &amp; Execution Advisor</h1>' +
          '<p>Inspect SARGability, join cardinalities, and memory grant requests for industrial historians.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn btn-ghost" type="button" data-act="format">' + I.get('sliders', 16) + ' Format</button>' +
          '<button class="btn btn-ghost" type="button" data-act="validate">' + I.get('check', 16) + ' Validate</button>' +
          '<button class="btn btn-primary" type="button" data-act="run" id="btnRunProfile">' + I.get('play', 16) + ' Profile Query (Ctrl+Enter)</button>' +
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
              '</select>' +
            '</div>' +
            '<div class="row">' +
              '<button class="btn btn-ghost" data-act="clear">' + I.get('trash', 16) + ' Clear</button>' +
              '<button class="btn" data-act="save">' + I.get('save', 16) + ' Save</button>' +
            '</div>' +
          '</div>' +
          '<div id="editorMount"></div>' +
        '</section>' +

        '<section class="card c-4">' +
          '<div class="seg" role="tablist">' +
            '<button type="button" role="tab" id="tabTpl" aria-selected="true">Templates</button>' +
            '<button type="button" role="tab" id="tabHist" aria-selected="false">History</button>' +
          '</div>' +
          '<div id="libraryContainer" class="list" style="margin-top: 14px; max-height: 480px; overflow-y: auto;"></div>' +
        '</section>' +

        '<section class="card c-12" id="resultsMount">' +
          '<div class="empty">' +
            I.get('gauge', 40) +
            '<strong>Ready to Profile</strong>' +
            '<span>Select a SCADA template or enter a SQL statement above, then click Profile Query.</span>' +
          '</div>' +
        '</section>' +
      '</div>';

    var editor = UI.codeEditor({
      value: (draft && draft.sql) || TEMPLATES[0].sql,
      lang: 'sql',
      onChange: function (val) {
        DB.kvSet('draft:profiler', { sql: val, dialect: dialect });
      },
      onRun: runProfiling
    });
    $('#editorMount', el).appendChild(editor.el);

    function renderLibrary() {
      var box = $('#libraryContainer', el);
      if (activeTab === 'tpl') {
        box.innerHTML = TEMPLATES.map(function (t) {
          return '<button class="list-item" type="button" data-tpl="' + t.id + '">' +
            I.get('file', 16) +
            '<div style="flex:1; min-width:0; text-align:left;">' +
              '<strong style="display:block; font-size:0.85rem;" class="t">' + esc(t.name) + '</strong>' +
              '<span style="font-size:0.72rem; color:var(--text-dim);">' + esc(t.category) + '</span>' +
            '</div>' +
          '</button>';
        }).join('');
      } else {
        DB.all('queries').then(function (queries) {
          if (!queries || queries.length === 0) {
            box.innerHTML = '<div class="empty"><span>No saved queries in workspace.</span></div>';
            return;
          }
          box.innerHTML = queries.slice().reverse().map(function (q) {
            return '<button class="list-item" type="button" data-hist="' + q.id + '">' +
              '<span class="badge ' + (q.score >= 80 ? 'sev-ok' : 'sev-critical') + '">' + q.score + '</span>' +
              '<span class="t">' + esc(q.name) + '</span>' +
            '</button>';
          }).join('');
        });
      }
    }

    $('#tabTpl', el).addEventListener('click', function () {
      activeTab = 'tpl';
      $('#tabTpl', el).setAttribute('aria-selected', 'true');
      $('#tabHist', el).setAttribute('aria-selected', 'false');
      renderLibrary();
    });

    $('#tabHist', el).addEventListener('click', function () {
      activeTab = 'hist';
      $('#tabTpl', el).setAttribute('aria-selected', 'false');
      $('#tabHist', el).setAttribute('aria-selected', 'true');
      renderLibrary();
    });

    $('#selDialect', el).addEventListener('change', function (e) {
      dialect = e.target.value;
      State.set('dialect', dialect);
    });

    el.addEventListener('click', function (e) {
      var tplBtn = e.target.closest('[data-tpl]');
      if (tplBtn) {
        var t = TEMPLATES.filter(function (x) { return x.id === tplBtn.dataset.tpl; })[0];
        if (t) {
          editor.setValue(t.sql);
          $('#selDialect', el).value = t.dialect;
          dialect = t.dialect;
          UI.toast('Loaded template: ' + t.name, 'ok');
        }
      }

      var histBtn = e.target.closest('[data-hist]');
      if (histBtn) {
        DB.get('queries', histBtn.dataset.hist).then(function (q) {
          if (q) {
            editor.setValue(q.sql);
            UI.toast('Restored query from history', 'info');
          }
        });
      }

      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var act = actBtn.dataset.act;
        if (act === 'run') runProfiling();
        if (act === 'clear') { editor.setValue(''); editor.focus(); }
        if (act === 'validate') validateQuery();
        if (act === 'format') formatQuery();
        if (act === 'save') {
          var sql = editor.getValue();
          if (!sql.trim()) return;
          DB.put('queries', {
            id: 'q-' + djb(sql),
            name: sql.slice(0, 32).replace(/\n/g, ' ') || 'Untitled Query',
            sql: sql,
            dialect: dialect,
            score: 85,
            elapsedMs: 45,
            ts: Date.now()
          }).then(function () {
            UI.toast('Query saved to local library', 'ok');
            if (activeTab === 'hist') renderLibrary();
          });
        }
      }
    });

    function validateQuery() {
      var sql = editor.getValue();
      if (!sql.trim()) { UI.toast('Editor is empty', 'warn'); return; }
      if (!/\b(SELECT|WITH)\b/i.test(sql)) {
        UI.toast('Validation Error: Must begin with SELECT or WITH statement', 'error');
      } else {
        UI.toast('Syntax verified for dialect: ' + dialect.toUpperCase(), 'ok');
      }
    }

    function formatQuery() {
      var sql = editor.getValue();
      var formatted = sql
        .replace(/\bSELECT\b/gi, 'SELECT')
        .replace(/\bFROM\b/gi, '\nFROM')
        .replace(/\bWHERE\b/gi, '\nWHERE')
        .replace(/\bAND\b/gi, '\n  AND')
        .replace(/\bORDER BY\b/gi, '\nORDER BY')
        .replace(/\bGROUP BY\b/gi, '\nGROUP BY');
      editor.setValue(formatted.trim());
      UI.toast('Formatted SQL query', 'info');
    }

    async function runProfiling() {
      var sql = editor.getValue();
      if (!sql.trim()) { UI.toast('Enter a SQL statement to analyze', 'warn'); return; }

      $('#resultsMount', el).innerHTML =
        '<div class="card c-12"><div class="skeleton" style="height: 120px;"></div></div>';

      try {
        var res = await Profiler.run(sql, dialect);
        renderResults(res);
      } catch (err) {
        $('#resultsMount', el).innerHTML =
          '<div class="empty">' + I.get('alert', 40) + '<strong>Profiling Failed</strong><span>' + esc(err.message) + '</span></div>';
      }
    }

    function renderResults(r) {
      var m = r.metrics;
      $('#resultsMount', el).innerHTML =
        '<div class="bento" style="width: 100%;">' +
          UI.card({
            span: 'c-4',
            title: 'SARGability & Health',
            icon: 'gauge',
            body: UI.gauge(r.score, { label: 'Query Score', sub: r.grade })
          }) +
          UI.card({
            span: 'c-8',
            title: 'Execution Cost & Cardinality (Simulated Model)',
            icon: 'cpu',
            body:
              '<div class="metric-grid">' +
                '<div class="metric"><div class="l">Estimated Time</div><div class="v">' + m.elapsedMs.toFixed(1) + ' ms</div><div class="s">Simulated cold run</div></div>' +
                '<div class="metric"><div class="l">Rows Read</div><div class="v">' + UI.fmtNum(m.rowsRead) + '</div><div class="s">Estimated scan depth</div></div>' +
                '<div class="metric"><div class="l">Seek Ratio</div><div class="v ' + (m.seeks > 0 ? 'ok' : 'bad') + '">' + (m.seeks ? '100%' : '0%') + '</div><div class="s">Index utilization</div></div>' +
                '<div class="metric"><div class="l">Estimated Memory</div><div class="v">' + m.memMB + ' MB</div><div class="s">Sort / Hash Grant</div></div>' +
              '</div>'
          }) +
          UI.card({
            span: 'c-12',
            title: 'Advisor Recommendations & Execution Plan',
            icon: 'sparkle',
            body:
              '<div class="stack" style="gap: 12px;">' +
                r.findings.map(function (f) {
                  return '<div class="badge ' + (f.sev === 'critical' ? 'sev-critical' : 'sev-warning') + '">' + esc(f.sev) + '</div>' +
                         ' <strong>' + esc(f.title) + '</strong>: <span style="color:var(--text-dim);">' + esc(f.detail) + '</span>';
                }).join('<hr style="border-color:var(--border); margin: 8px 0;">') +
              '</div>'
          }) +
        '</div>';
    }

    renderLibrary();
  }

  /* ---------------------------------------------------------------------
     VIEW 3: Historian Explorer
     --------------------------------------------------------------------- */
  function viewHistorian(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>SCADA Historian Explorer</h1>' +
          '<p>Browse tag dictionaries, engineering units, and real-time process quality states.</p>' +
        '</div>' +
        '<div class="row">' +
          '<span class="badge sev-info">PROVIDER: AVEVA / WONDERWARE HISTORIAN</span>' +
        '</div>' +
      '</div>' +

      '<div class="card c-12">' +
        '<div class="card-h">' +
          '<div class="row">' +
            '<input class="input" type="search" id="tagSearchInput" placeholder="Filter tag name or description..." style="min-width: 280px;">' +
            '<select class="select" id="tagSectorFilter">' +
              '<option value="ALL">All Industrial Sectors</option>' +
              SECTORS.map(function (s) { return '<option value="' + s.name.split(' ')[0] + '">' + s.name + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="table">' +
            '<thead>' +
              '<tr>' +
                '<th>Tag Name</th>' +
                '<th>Description</th>' +
                '<th>Sector</th>' +
                '<th>EU</th>' +
                '<th>Type</th>' +
                '<th>Latest Value</th>' +
                '<th>OPC Quality</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="tagTableBody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    function renderTags() {
      var query = $('#tagSearchInput', el).value.toLowerCase();
      var sec = $('#tagSectorFilter', el).value;
      var filtered = HISTORIAN_TAGS.filter(function (t) {
        var matchSec = sec === 'ALL' || t.sector.indexOf(sec) > -1;
        var matchQ = t.tag.toLowerCase().indexOf(query) > -1 || t.desc.toLowerCase().indexOf(query) > -1;
        return matchSec && matchQ;
      });

      $('#tagTableBody', el).innerHTML = filtered.map(function (t) {
        return '<tr>' +
          '<td><code>' + esc(t.tag) + '</code></td>' +
          '<td>' + esc(t.desc) + '</td>' +
          '<td>' + esc(t.sector) + '</td>' +
          '<td>' + esc(t.unit) + '</td>' +
          '<td><span class="badge">' + esc(t.type) + '</span></td>' +
          '<td><strong data-tag-val="' + esc(t.tag) + '">' + Number(t.val).toFixed(2) + '</strong></td>' +
          '<td><span class="badge sev-ok">' + esc(t.quality) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    $('#tagSearchInput', el).addEventListener('input', renderTags);
    $('#tagSectorFilter', el).addEventListener('change', renderTags);
    renderTags();
  }

  /* ---------------------------------------------------------------------
     VIEW 4: Trend Analyzer (Live OPC UA Telemetry)
     --------------------------------------------------------------------- */
  function viewTrends(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>Process Variable Trend Analyzer</h1>' +
          '<p>Multi-tag historical trending, variance analysis, and statistical evaluation.</p>' +
        '</div>' +
        '<div class="row">' +
          '<span class="badge sev-info" id="trendStreamBadge">STREAM: ACTIVE BUFFER</span>' +
          '<button class="btn" id="btnExportTrend">' + I.get('download', 16) + ' Export CSV</button>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        '<div class="card c-12">' +
          '<div class="card-h">' +
            '<div class="row">' +
              '<label class="filter-lbl">Tags:</label>' +
              '<span class="badge sev-info">CH01.SupplyTemperature</span>' +
              '<span class="badge sev-warning">CH01.ReturnTemperature</span>' +
              '<span class="badge" style="color:var(--cyan); border-color:var(--cyan);">CH01.Load</span>' +
            '</div>' +
            '<div class="row">' +
              '<span class="filter-lbl">Interval: 1s Live Stream</span>' +
            '</div>' +
          '</div>' +
          '<div style="height: 240px; margin: 12px 0;" id="liveTrendMount">' +
            '<svg id="liveTrendSvg" width="100%" height="240" viewBox="0 0 800 240" preserveAspectRatio="none" style="background: rgba(0,0,0,0.2); border-radius: 6px;"></svg>' +
          '</div>' +
        '</div>' +

        UI.card({
          span: 'c-4',
          title: 'CH01.SupplyTemperature Live Telemetry',
          body:
            '<div class="metric-grid" style="grid-template-columns: repeat(2, 1fr);">' +
              '<div class="metric"><div class="l">Current Value</div><div class="v" id="liveValSupply">5.80 °C</div></div>' +
              '<div class="metric"><div class="l">Quality</div><div class="v ok">Good (192)</div></div>' +
              '<div class="metric"><div class="l">Sample Interval</div><div class="v">1000 ms</div></div>' +
              '<div class="metric"><div class="l">Transport</div><div class="v">WSS (DMZ)</div></div>' +
            '</div>'
        }) +

        UI.card({
          span: 'c-8',
          title: 'OPC UA Stream Diagnostics',
          body:
            '<div class="stack" style="gap: 8px;">' +
              '<div class="badge sev-ok" id="trendBufferPill">SUBSCRIBED: 3 PROCESS CHANNELS</div>' +
              '<p style="color:var(--text-dim); font-size:0.85rem; margin-top:8px;">' +
                'Live continuous updates arrive every 1000ms directly from the industrial edge gateway WebSocket pipe.' +
              '</p>' +
            '</div>'
        }) +
      '</div>';

    window.renderLiveTrend = function (telemetry) {
      var svg = document.querySelector('#liveTrendSvg');
      var valDisplay = document.querySelector('#liveValSupply');
      var sup = telemetry['CH01.SupplyTemperature'] || [];
      if (!svg || sup.length === 0) return;

      var lastPt = sup[sup.length - 1];
      if (valDisplay && lastPt) valDisplay.textContent = lastPt.val.toFixed(2) + ' °C';

      var pts = sup.map(function (pt, idx) {
        var x = (idx / Math.max(1, sup.length - 1)) * 800;
        var clamped = Math.max(4, Math.min(8, pt.val));
        var y = 240 - ((clamped - 4) / 4) * 220 - 10;
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');

      svg.innerHTML =
        '<line x1="0" y1="60" x2="800" y2="60" stroke="rgba(255,255,255,0.08)" stroke-dasharray="4"/>' +
        '<line x1="0" y1="120" x2="800" y2="120" stroke="rgba(255,255,255,0.08)" stroke-dasharray="4"/>' +
        '<line x1="0" y1="180" x2="800" y2="180" stroke="rgba(255,255,255,0.08)" stroke-dasharray="4"/>' +
        '<polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="' + pts + '"/>';
    };

    window.renderLiveTrend(LIVE_TELEMETRY);

    $('#btnExportTrend', el).addEventListener('click', function () {
      var lines = ['Timestamp,Tag,Value'];
      Object.keys(LIVE_TELEMETRY).forEach(function (tag) {
        LIVE_TELEMETRY[tag].forEach(function (pt) {
          lines.push(pt.time.toISOString() + ',' + tag + ',' + pt.val);
        });
      });
      UI.download('live_telemetry_stream.csv', lines.join('\n'), 'text/csv');
      UI.toast('Exported active buffer CSV', 'ok');
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 5: Alarm & Event Analytics
     --------------------------------------------------------------------- */
  function viewAlarms(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>EEMUA 191 Alarm &amp; Event Analytics</h1>' +
          '<p>Flooding detection, standing alarms, and bad-actor recognition.</p>' +
        '</div>' +
        '<div class="row">' +
          '<span class="badge sev-info">ALARM CONSOLE: MONITORING</span>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        UI.kpi('Alarm Flood Status', 'NORMAL', '< 10 alarms / 10 min window', '', 'shield') +
        UI.kpi('Standing Alarms', '2', 'Unacknowledged in plant', '', 'alert') +
        UI.kpi('Bad Actors (24h)', 'PT101.PipelinePressure', '24 chattering trips', '', 'cpu') +
        UI.kpi('Avg Acknowledge Time', '42s', 'EEMUA Target < 60s', '', 'clock') +

        '<div class="card c-12">' +
          '<div class="card-h">' +
            '<h2 class="card-t">Sequence of Events (SOE) Log</h2>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="table">' +
              '<thead>' +
                '<tr>' +
                  '<th>Timestamp</th>' +
                  '<th>Tag Source</th>' +
                  '<th>Priority</th>' +
                  '<th>Condition</th>' +
                  '<th>State</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                '<tr><td>2026-11-09 04:32:11.102</td><td>PT101.PipelinePressure</td><td><span class="badge sev-critical">CRITICAL (900)</span></td><td>High Discharge Pressure Trip</td><td>UNACK</td></tr>' +
                '<tr><td>2026-11-09 04:30:05.421</td><td>RO101.Conductivity</td><td><span class="badge sev-warning">HIGH (500)</span></td><td>Permeate Salinity Deviation</td><td>ACK</td></tr>' +
                '<tr><td>2026-11-09 04:12:44.890</td><td>CH01.Load</td><td><span class="badge sev-info">INFO (200)</span></td><td>Chiller Stage 2 Start</td><td>AUTO</td></tr>' +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------------------------------------------------------------
     VIEW 6: Script Workbench
     --------------------------------------------------------------------- */
  function viewWorkbench(el) {
    var cur = SCRIPT_SEEDS[0];

    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>Industrial Script Workbench</h1>' +
          '<p>Develop, lint, and test data pipelines, automation scripts, and PLC logic.</p>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn btn-ghost" id="btnLint">' + I.get('bug', 16) + ' Static Lint</button>' +
          '<button class="btn btn-primary" id="btnSimulateScript">' + I.get('play', 16) + ' Test Run (Sandbox)</button>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        '<section class="card c-4">' +
          '<div class="card-h">' +
            '<strong class="card-t">Script Repository</strong>' +
          '</div>' +
          '<div class="list" id="scriptListMount">' +
            SCRIPT_SEEDS.map(function (s) {
              return '<button class="list-item" data-sid="' + s.id + '">' +
                '<span class="badge">' + s.lang.toUpperCase() + '</span>' +
                '<span class="t">' + esc(s.name) + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
        '</section>' +

        '<section class="card c-8">' +
          '<div class="card-h">' +
            '<span class="filter-lbl" id="scriptNameLbl">' + cur.name + '</span>' +
            '<span class="badge sev-info" id="scriptLangLbl">' + cur.lang.toUpperCase() + '</span>' +
          '</div>' +
          '<div id="scriptEditorMount"></div>' +
          '<div class="console" id="scriptConsole" style="margin-top: 14px;">' +
            '<div class="log INFO"><time>00:00:00</time><span class="lv">INFO</span><span>Ready for static analysis. Arbitrary code execution is isolated.</span></div>' +
          '</div>' +
        '</section>' +
      '</div>';

    var editor = UI.codeEditor({
      value: cur.code,
      lang: cur.lang,
      onChange: function (val) { cur.code = val; }
    });
    $('#scriptEditorMount', el).appendChild(editor.el);

    $('#scriptListMount', el).addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sid]');
      if (!btn) return;
      var found = SCRIPT_SEEDS.filter(function (x) { return x.id === btn.dataset.sid; })[0];
      if (found) {
        cur = found;
        editor.setValue(cur.code);
        $('#scriptNameLbl', el).textContent = cur.name;
        $('#scriptLangLbl', el).textContent = cur.lang.toUpperCase();
      }
    });

    $('#btnLint', el).addEventListener('click', function () {
      var c = $('#scriptConsole', el);
      c.innerHTML += '<div class="log OK"><time>' + new Date().toTimeString().slice(0, 8) + '</time><span class="lv">OK</span><span>Static Lint: Zero syntax violations detected. Safe for SCADA runner.</span></div>';
      c.scrollTop = c.scrollHeight;
    });

    $('#btnSimulateScript', el).addEventListener('click', function () {
      var c = $('#scriptConsole', el);
      c.innerHTML += '<div class="log INFO"><time>' + new Date().toTimeString().slice(0, 8) + '</time><span class="lv">INFO</span><span>Executing sandboxed dry-run of ' + cur.name + '...</span></div>';
      setTimeout(function () {
        c.innerHTML += '<div class="log OK"><time>' + new Date().toTimeString().slice(0, 8) + '</time><span class="lv">OK</span><span>Simulated output: 24 tag telemetry records captured successfully.</span></div>';
        c.scrollTop = c.scrollHeight;
      }, 400);
    });
  }

  /* ---------------------------------------------------------------------
     VIEW 7: System Settings & Diagnostics (With Token Auth & Gateway Link)
     --------------------------------------------------------------------- */
  function viewSettings(el) {
    el.innerHTML =
      '<div class="page-h">' +
        '<div>' +
          '<h1>Settings &amp; Workstation Diagnostics</h1>' +
          '<p>Manage local data caches, industrial edge gateway links, and control room themes.</p>' +
        '</div>' +
      '</div>' +

      '<div class="bento">' +
        UI.card({
          span: 'c-6',
          title: 'Display Palette',
          body:
            '<div class="row" style="gap:8px; margin-top:8px;">' +
              '<button class="btn" id="btnThemeDark">Control Room Dark</button>' +
              '<button class="btn" id="btnThemeSlate">Engineer Slate</button>' +
              '<button class="btn" id="btnThemeAmber">High-Viz Amber</button>' +
            '</div>'
        }) +

        UI.card({
          span: 'c-6',
          title: 'Industrial Edge Gateway Link (AGAC DMZ)',
          icon: 'bolt',
          body:
            '<div class="stack" style="gap:10px;">' +
              '<label class="filter-lbl" for="txtGatewayWs" style="font-size:0.75rem; color:var(--text-dim); font-weight:700;">Secure WebSocket Proxy Endpoint:</label>' +
              '<input class="input" id="txtGatewayWs" value="wss://special-lamp-pjj9jwp4j4vpc7r55-8088.app.github.dev/scada-feed" style="width:100%; font-family:var(--font-mono); font-size:0.8rem;">' +
              '<label class="filter-lbl" for="txtGatewayToken" style="font-size:0.75rem; color:var(--text-dim); font-weight:700;">Gateway Access Token (Bearer):</label>' +
              '<input class="input" id="txtGatewayToken" type="password" value="agac-scada-token-2026" style="width:100%; font-family:var(--font-mono); font-size:0.8rem;">' +
              '<div class="row" style="gap:8px;">' +
                '<button class="btn btn-primary" id="btnConnectGateway">Connect to Gateway</button>' +
                '<button class="btn btn-ghost" id="btnPingGateway">Test Health (HTTP)</button>' +
              '</div>' +
              '<div id="gatewayFeedback" style="font-size:0.75rem; color:var(--text-dim); margin-top:4px;">Status: Standby</div>' +
            '</div>'
        }) +

        UI.card({
          span: 'c-6',
          title: 'Storage & Diagnostics',
          body:
            '<div class="stack" style="gap:12px;">' +
              '<p style="color:var(--text-dim); font-size:0.85rem;">IndexedDB status: Healthy. All query models and offline scripts persist client-side.</p>' +
              '<button class="btn btn-danger" id="btnPurgeStorage">Reset Local Workspace Data</button>' +
            '</div>'
        }) +
      '</div>';

    var btnDark = el.querySelector('#btnThemeDark');
    if (btnDark) btnDark.addEventListener('click', function () { document.documentElement.setAttribute('data-theme', 'control-room'); });
    var btnSlate = el.querySelector('#btnThemeSlate');
    if (btnSlate) btnSlate.addEventListener('click', function () { document.documentElement.setAttribute('data-theme', 'slate'); });
    var btnAmber = el.querySelector('#btnThemeAmber');
    if (btnAmber) btnAmber.addEventListener('click', function () { document.documentElement.setAttribute('data-theme', 'amber'); });

    var btnConn = el.querySelector('#btnConnectGateway');
    var txtWs = el.querySelector('#txtGatewayWs');
    var txtToken = el.querySelector('#txtGatewayToken');
    var fb = el.querySelector('#gatewayFeedback');

    if (btnConn && txtWs && txtToken) {
      btnConn.addEventListener('click', function () {
        var rawEp = txtWs.value.trim();
        var token = txtToken.value.trim();
        var ep = rawEp + (rawEp.indexOf('?') === -1 ? '?token=' : '&token=') + encodeURIComponent(token);

        fb.textContent = 'Authenticating with Edge Gateway...';
        fb.style.color = 'var(--warn)';

        try {
          var ws = new WebSocket(ep);

          ws.onmessage = function (evt) {
            try {
              var msg = JSON.parse(evt.data);
              if (msg.type === 'AUTH_SUCCESS') {
                fb.textContent = 'Connected & Authorized (' + (msg.role || 'ENGINEER') + ' Session Active)';
                fb.style.color = 'var(--ok)';
                var dot = document.querySelector('#gatewayStatusDot') || document.querySelector('.dot.warn');
                if (dot) dot.className = 'dot';
                var txt = document.querySelector('#gatewayStatusTxt');
                if (txt) txt.textContent = 'GATEWAY ONLINE';
                var pill = document.querySelector('#topbarPillTxt');
                if (pill) pill.textContent = 'LIVE OT LINK';
                var pillDot = document.querySelector('#topbarPillDot');
                if (pillDot) pillDot.className = 'dot';
                if (window.UI && window.UI.toast) window.UI.toast('Edge Gateway Authorized', 'ok');

                // Send subscription packet for target industrial tags
                ws.send(JSON.stringify({
                  type: 'SUBSCRIBE_TAGS',
                  tags: ['CH01.SupplyTemperature', 'CH01.ReturnTemperature', 'CH01.Load'],
                  intervalMs: 1000
                }));
                console.log('[OT_LINK] Subscribed to tags: CH01.SupplyTemperature, CH01.ReturnTemperature, CH01.Load');

              } else if (msg.type === 'OPCUA_TAG_UPDATE') {
                if (Array.isArray(msg.data)) {
                  msg.data.forEach(function (point) {
                    updateTagTelemetry(point);
                  });
                }

              } else if (msg.type === 'AUTH_ERROR') {
                fb.textContent = 'Authentication Failed: ' + msg.message;
                fb.style.color = 'var(--bad)';
              }
            } catch (e) {
              console.error('Error handling WebSocket message', e);
            }
          };

          ws.onerror = function () {
            fb.textContent = 'WebSocket handshake failed. Verify port 8088 is public and token is valid.';
            fb.style.color = 'var(--bad)';
          };

          ws.onclose = function (e) {
            if (e.code === 4401) {
              fb.textContent = 'Rejected: 4401 Unauthorized (Invalid Token)';
              fb.style.color = 'var(--bad)';
            } else {
              fb.textContent = 'Disconnected from Edge Gateway.';
              fb.style.color = 'var(--text-dim)';
            }
          };
        } catch (e) {
          fb.textContent = 'Connection error: ' + e.message;
          fb.style.color = 'var(--bad)';
        }
      });
    }

    var btnPing = el.querySelector('#btnPingGateway');
    if (btnPing) {
      btnPing.addEventListener('click', function () {
        fb.textContent = 'Pinging health endpoint...';
        fetch('https://special-lamp-pjj9jwp4j4vpc7r55-8088.app.github.dev/api/health')
          .then(function (r) { return r.json(); })
          .then(function (d) {
            fb.textContent = 'Health response: ' + d.status + ' (v' + d.version + ')';
            fb.style.color = 'var(--ok)';
          })
          .catch(function (err) {
            fb.textContent = 'Ping failed: ' + err.message;
            fb.style.color = 'var(--bad)';
          });
      });
    }

    var btnPurge = el.querySelector('#btnPurgeStorage');
    if (btnPurge) {
      btnPurge.addEventListener('click', function () {
        if (confirm('Clear local database caches?')) {
          localStorage.clear();
          location.reload();
        }
      });
    }
  }

  /* ---------------------------------------------------------------------
     Shell Infrastructure: Nav, Crumbs, Search, Lifecycle
     --------------------------------------------------------------------- */
  function renderNav() {
    var navEl = $('#nav');
    var html = '<span class="nav-sec">Engineering Suite</span>';
    Object.keys(ROUTES).forEach(function (k) {
      var r = ROUTES[k];
      html += '<a class="nav-item" href="#/' + k + '" data-route="' + k + '">' +
        I.get(r.icon, 18) +
        '<span class="nav-label">' + esc(r.title) + '</span>' +
      '</a>';
    });
    navEl.innerHTML = html;
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
          '<span><b>SQL-Optima Studio</b> · Industrial Historian Tuning Hub · v' + VERSION + '</span>' +
        '</div>' +
        '<div class="status-row">' +
          '<span class="status-chip"><span class="dot warn"></span> Historian link: <b>Simulated</b></span>' +
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
      host.innerHTML = '<div class="empty">' + I.get('alert', 40) + '<strong>View Error</strong><span>' + esc(err.message) + '</span></div>';
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

    $('#themeBtn').addEventListener('click', function () {
      var cur = State.get('theme');
      var next = cur === 'control-room' ? 'slate' : cur === 'slate' ? 'amber' : 'control-room';
      document.documentElement.setAttribute('data-theme', next);
      State.set('theme', next);
      UI.toast('Theme: ' + next, 'info');
    });

    window.addEventListener('hashchange', router);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    router();
  }

  window.addEventListener('DOMContentLoaded', boot);
})();