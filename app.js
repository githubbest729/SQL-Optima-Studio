/* SQL-Optima Studio — Core Application
 * Focus:
 *  1. Develop and optimize SQL queries for efficient data handling.
 *  2. PWA Concept: SQL-Optima Studio (Query profiler & performance tuning hub).
 *  3. Develop and maintain scripts for data acquisition, processing, and reporting. Troubleshoot & debug code.
 */
(function () {
  'use strict';

  var UI = window.UI, I = window.Icons, esc = UI.esc;
  var VERSION = '2.0.0-focused';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var L = function () { return Array.prototype.slice.call(arguments).join('\n'); };
  function djb(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function rnd(seed, min, max) { var x = parseInt(djb(seed), 36) % 1000 / 1000; return Math.round(min + x * (max - min)); }

  /* =====================================================================
     Persistence — IndexedDB with localStorage fallback
     ===================================================================== */
  var DB = (function () {
    var NAME = 'sql-optima-studio', VER = 1, dbp = null;
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
        r.onblocked = function () { rej(new Error('blocked')); };
      });
      return dbp;
    }
    function idb(store, mode, fn) {
      return open().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(store, mode), out, rq = fn(t.objectStore(store));
          if (rq) rq.onsuccess = function () { out = rq.result; };
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    function lsRead(s) { try { return JSON.parse(localStorage.getItem('sqlopt.fb.' + s) || '{}'); } catch (e) { return {}; } }
    function lsWrite(s, o) { try { localStorage.setItem('sqlopt.fb.' + s, JSON.stringify(o)); } catch (e) { } }
    function keyOf(s, o) { return s === 'kv' ? o.key : o.id; }
    return {
      put: function (s, o) { return idb(s, 'readwrite', function (st) { return st.put(o); }).then(function () { return o; }, function () { var m = lsRead(s); m[keyOf(s, o)] = o; lsWrite(s, m); return o; }); },
      get: function (s, k) { return idb(s, 'readonly', function (st) { return st.get(k); }).catch(function () { return lsRead(s)[k]; }); },
      del: function (s, k) { return idb(s, 'readwrite', function (st) { return st.delete(k); }).catch(function () { var m = lsRead(s); delete m[k]; lsWrite(s, m); }); },
      all: function (s) { return idb(s, 'readonly', function (st) { return st.getAll(); }).then(function (r) { return r || []; }, function () { return Object.keys(lsRead(s)).map(function (k) { return lsRead(s)[k]; }); }); },
      clear: function (s) { return idb(s, 'readwrite', function (st) { return st.clear(); }).catch(function () { lsWrite(s, {}); }); },
      kvGet: function (key, def) { return this.get('kv', key).then(function (r) { return r ? r.value : def; }); },
      kvSet: function (key, value) { return this.put('kv', { key: key, value: value }); }
    };
  })();

  /* =====================================================================
     Settings / state
     ===================================================================== */
  var THEMES = [
    { id: 'control-room', name: 'Control Room Dark', color: '#070b11', sw: ['#070b11', '#121a26', '#38bdf8', '#34d399'] },
    { id: 'slate', name: 'Engineer Slate', color: '#0f1420', sw: ['#0f1420', '#1b2333', '#8b9cff', '#7dd3fc'] },
    { id: 'amber', name: 'High-Viz Amber', color: '#0a0804', sw: ['#0a0804', '#17120a', '#ffb000', '#ffd166'] }
  ];
  var SECTORS = [
    { id: 'cooling', name: 'District Cooling', color: '#22d3ee', tip: 'kW/TR and ΔT trends reward pre-aggregated hourly tables with an index on (PlantId, TagName, DateTime). Avoid CONVERT(date, …) in daily energy reports.' },
    { id: 'oil-gas', name: 'Oil & Gas', color: '#f59e0b', tip: 'Keep safety systems segregated. Replicate tag & alarm logs to a read-only reporting node before executing heavy analytical SQL.' },
    { id: 'water', name: 'Water / Wastewater', color: '#38bdf8', tip: 'Pump stations log at ~1s but regulatory compliance reports require 15-minute aggregates — use rollup tables instead of scanning raw histories.' },
    { id: 'metals', name: 'Metals & Minerals', color: '#a78bfa', tip: 'Mill and furnace vibration tags are very high frequency: use columnstore/compression, keep 7–14 days raw and downsample older data.' },
    { id: 'food', name: 'Food & Beverage', color: '#34d399', tip: 'Batch genealogy joins history with recipe tables — partition by batch window to guarantee sub-second retrieval.' },
    { id: 'infra', name: 'Infrastructure', color: '#fb7185', tip: 'Tunnels and smart facilities handle thousands of low-rate tags. Use tag-group lookup tables instead of leading wildcard LIKE scans.' }
  ];

  var State = (function () {
    var KEY = 'sqlopt.state', s = { theme: 'control-room', collapsed: false, sector: 'cooling' };
    try { var r = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in r) s[k] = r[k]; } catch (e) { }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } }
    return { get: function (k) { return s[k]; }, set: function (k, v) { s[k] = v; save(); }, all: function () { return s; } };
  })();
  function sectorObj() { return SECTORS.filter(function (x) { return x.id === State.get('sector'); })[0] || SECTORS[0]; }

  /* =====================================================================
     Seed content: query templates, scripts, and error diagnostics
     ===================================================================== */
  var TEMPLATES = [
    { id: 't1', name: '12-tag trend, last hour (well-bounded)', dialect: 'tsql', sql: L(
      '-- Trend screen: chiller plant tags, last 60 minutes, 1-minute resolution',
      'SELECT TOP (5000) [DateTime], TagName, [Value], QualityDetail',
      'FROM Runtime.dbo.History',
      "WHERE TagName IN ('CHW_P1.Flow','CHW_P1.Temp_Supply','CHW_P1.Temp_Return','CH_01.Load','CH_02.Load','CH_03.Load')",
      '  AND [DateTime] >= DATEADD(hour, -1, GETDATE())',
      '  AND [DateTime] <  GETDATE()',
      '  AND wwResolution = 60000',
      "  AND wwRetrievalMode = 'Cyclic'",
      'ORDER BY TagName, [DateTime];') },
    { id: 't2', name: 'Anti-pattern: day report with CONVERT + wildcard', dialect: 'tsql', sql: L(
      '-- Slow daily report (Non-SARGable full table scan)',
      'SELECT *',
      'FROM Runtime.dbo.History',
      "WHERE CONVERT(date, [DateTime]) = '2026-11-09'",
      "  AND TagName LIKE '%Flow%'",
      'ORDER BY [DateTime] DESC;') },
    { id: 't3', name: 'Alarm flood at shift change', dialect: 'tsql', sql: L(
      '-- Alarm flood around the 06:00 shift handover',
      'SELECT TOP (20) Alarm_Source, Priority, COUNT(*) AS AlarmCount',
      'FROM Runtime.dbo.AlarmHistory',
      "WHERE EventTime >= '2026-11-09 05:30' AND EventTime < '2026-11-09 06:30'",
      'GROUP BY Alarm_Source, Priority',
      'ORDER BY AlarmCount DESC;') },
    { id: 't4', name: '1-minute min/avg/max downsample (7 days)', dialect: 'tsql', sql: L(
      '-- Downsample cooling-tower power to 1-minute buckets',
      'SELECT TagName,',
      '       DATEADD(minute, DATEDIFF(minute, 0, [DateTime]), 0) AS [Minute],',
      '       AVG([Value]) AS AvgValue, MIN([Value]) AS MinValue, MAX([Value]) AS MaxValue',
      'FROM Runtime.dbo.AnalogHistory',
      "WHERE TagName IN ('CT_01.Power','CT_02.Power')",
      '  AND [DateTime] >= DATEADD(day, -7, GETDATE())',
      'GROUP BY TagName, DATEADD(minute, DATEDIFF(minute, 0, [DateTime]), 0)',
      'ORDER BY TagName, [Minute];') },
    { id: 't5', name: 'Bad-quality samples by tag (24 h)', dialect: 'tsql', sql: L(
      '-- Find tags with communication / telemetry gaps',
      'SELECT TagName, COUNT(*) AS BadSamples',
      'FROM Runtime.dbo.History',
      'WHERE [DateTime] >= DATEADD(day, -1, GETDATE())',
      '  AND QualityDetail <> 192',
      'GROUP BY TagName',
      'HAVING COUNT(*) > 100',
      'ORDER BY BadSamples DESC;') },
    { id: 't6', name: 'TimescaleDB: 5-minute buckets, last 6 h', dialect: 'timescale', sql: L(
      '-- Turbidity & flow trend for water treatment plant',
      "SELECT time_bucket('5 minutes', ts) AS bucket, tag_name, avg(value) AS avg_v, max(value) AS max_v",
      'FROM tag_history',
      "WHERE tag_name = 'WTP1.Turbidity'",
      "  AND ts >= now() - INTERVAL '6 hours'",
      'GROUP BY bucket, tag_name',
      'ORDER BY bucket DESC',
      'LIMIT 500;') }
  ];

  var SCRIPT_SEEDS = [
    { id: 's-intouch', name: 'ShiftHandover_Logger', lang: 'intouch', code: L(
      '{ ===== Data Processing & Logging Script =====',
      '  Type: Wonderware InTouch Condition Script (On True) }',
      'rc = SQLConnect( ConnId, "DSN=HistorianRO;UID=svc_scada;PWD=" + $DbPassword );',
      'IF rc <> 0 THEN',
      '  LogMessage( "SQLConnect failed, code " + Text( rc, "#" ) + ": " + SQLErrorMsg( rc ) );',
      'ELSE',
      '  rc = SQLInsert( ConnId, "ShiftLog", "BindList_ShiftLog" );',
      '  IF rc <> 0 THEN',
      '    LogMessage( "SQLInsert failed: " + SQLErrorMsg( rc ) );',
      '  ENDIF;',
      '  SQLDisconnect( ConnId );',
      'ENDIF;') },
    { id: 's-csharp', name: 'HistorianFetch.cs', lang: 'csharp', code: L(
      'using System;',
      'using System.IO;',
      'using System.Threading.Tasks;',
      'using Microsoft.Data.SqlClient;',
      '',
      'public static class HistorianDataAcquisition',
      '{',
      '    // Acquires high-frequency tag data and buffers for report generation',
      '    public static async Task ExportAsync(string connStr, string tag, int minutes, string path)',
      '    {',
      '        const string sql = @"SELECT [DateTime], [Value] FROM Runtime.dbo.History',
      '                              WHERE TagName = @tag AND [DateTime] >= DATEADD(minute, -@mins, GETDATE())',
      '                              AND wwResolution = 60000 ORDER BY [DateTime]";',
      '        using var conn = new SqlConnection(connStr);',
      '        await conn.OpenAsync();',
      '        using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };',
      '        cmd.Parameters.AddWithValue("@tag", tag);',
      '        cmd.Parameters.AddWithValue("@mins", minutes);',
      '        using var rdr = await cmd.ExecuteReaderAsync();',
      '        using var w = new StreamWriter(path);',
      '        await w.WriteLineAsync("DateTime,Value");',
      '        while (await rdr.ReadAsync())',
      '            await w.WriteLineAsync($"{rdr.GetDateTime(0):O},{rdr.GetDouble(1)}");',
      '    }',
      '}') },
    { id: 's-bash', name: 'nightly_alarm_report.sh', lang: 'bash', code: L(
      '#!/usr/bin/env bash',
      '# Automated Nightly Alarm Processing & Report Delivery',
      '# cron: 15 5 * * * /opt/scada/nightly_alarm_report.sh',
      'set -euo pipefail',
      '',
      'OUT="/var/reports/alarms_$(date +%F).csv"',
      'sqlcmd -S "$DB_HOST" -d Runtime -U "$DB_USER" -P "$DB_PASS" -b -W -s"," \\',
      '  -Q "SET NOCOUNT ON; SELECT TOP (50) Alarm_Source, COUNT(*) AS Cnt FROM dbo.AlarmHistory WHERE EventTime >= DATEADD(hour,-12,GETDATE()) GROUP BY Alarm_Source ORDER BY Cnt DESC" \\',
      '  > "$OUT"',
      'gzip -f "$OUT"',
      'logger -t scada-report "Alarm report generated: $OUT.gz"') },
    { id: 's-sql', name: 'maintenance_fragmentation.sql', lang: 'sql', code: L(
      '-- Routine Index Maintenance: Identify fragmented Historian archive tables',
      'SELECT TOP (25) OBJECT_NAME(ips.object_id) AS TableName, i.name AS IndexName,',
      '       ips.avg_fragmentation_in_percent, ips.page_count',
      'FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, \'\'LIMITED\'\') AS ips',
      'JOIN sys.indexes AS i ON i.object_id = ips.object_id AND i.index_id = ips.index_id',
      'WHERE ips.page_count > 1000 AND ips.avg_fragmentation_in_percent > 30',
      'ORDER BY ips.avg_fragmentation_in_percent DESC;') }
  ];

  var ERRORS = [
    { sys: 'SQL Server', code: '1205', k: ['1205', 'deadlock victim', 'deadlocked'], title: 'Transaction deadlocked — chosen as victim', cause: 'Two sessions hold locks the other needs. Common when shift-change alarm bursts insert while report queries read the same pages.', fix: 'Retry with back-off; access tables in same order; enable READ_COMMITTED_SNAPSHOT; index predicate columns.' },
    { sys: 'SQL Server', code: '1222', k: ['1222', 'lock request time out'], title: 'Lock request time-out period exceeded', cause: 'A blocking session held locks longer than SET LOCK_TIMEOUT.', fix: 'Identify head blocker via sys.dm_exec_requests; shorten transaction durations; move reporting queries to read-only replica.' },
    { sys: 'SQL Server', code: '-2', k: ['-2', 'timeout expired', 'execution timeout'], title: 'Timeout expired (client CommandTimeout)', cause: 'Query exceeded timeout due to unindexed table scan across multi-million row history table.', fix: 'Add sargable half-open time predicate [DateTime] >= ... AND [DateTime] < ...; do NOT simply increase client timeout.' },
    { sys: 'SQL Server', code: '18456', k: ['18456', 'login failed'], title: 'Login failed for user', cause: 'Invalid credentials or service account lacks permission on SCADA database.', fix: 'Inspect SQL Server error log state code; verify ODBC DSN service account.' },
    { sys: 'OPC UA', code: '0x800A0000', k: ['0x800a0000', 'badtimeout'], title: 'BadTimeout', cause: 'Server did not answer within timeout period (network congestion or oversized subscription batch).', fix: 'Reduce items per subscription block; increase client timeout moderately; inspect network QoS.' },
    { sys: 'OPC UA', code: '0x80050000', k: ['0x80050000', 'badcommunicationerror'], title: 'BadCommunicationError', cause: 'Connection to industrial automation server dropped or socket closed.', fix: 'Check network cable/switch port; confirm OPC UA endpoint URL; ensure auto-reconnect logic exists.' },
    { sys: 'Modbus', code: '01', k: ['modbus exception 01', 'illegal function'], title: 'Exception 01 — Illegal Function', cause: 'Function code not supported by the slave/PLC.', fix: 'Check PLC device manual for supported function codes (03 holding vs 04 input registers).' },
    { sys: 'Modbus', code: '02', k: ['modbus exception 02', 'illegal data address'], title: 'Exception 02 — Illegal Data Address', cause: 'Target register address is out of range or misaligned (0-based vs 1-based offset).', fix: 'Verify register map offset; ensure request does not exceed register boundaries.' },
    { sys: 'InTouch', code: 'SQL* result ≠ 0', k: ['sqlconnect', 'sqlinsert', 'sqlselect', 'sqlerrormsg', 'result code'], title: 'InTouch SQL function returned non-zero code', cause: 'SQL Access Manager failed (invalid DSN, bad credentials, missing column in bind list).', fix: 'Always capture rc and log SQLErrorMsg(rc). Ensure 32-bit vs 64-bit ODBC DSN matches InTouch runtime architecture.' }
  ];

  /* =====================================================================
     Profiler client
     ===================================================================== */
  var Profiler = (function () {
    var worker = null, seq = 0, pendingMap = {}, fallback = false;
    function toFallback() { fallback = true; worker = null; Object.keys(pendingMap).forEach(function (k) { pendingMap[k].rej(new Error('Profiler worker stopped — please run again.')); }); pendingMap = {}; }
    function init() {
      if (worker || fallback) return;
      try {
        worker = new Worker('profiler.worker.js');
        worker.onmessage = function (e) { var p = pendingMap[e.data.id]; if (!p) return; delete pendingMap[e.data.id]; if (e.data.ok) p.res(e.data.result); else p.rej(new Error(e.data.error)); };
        worker.onerror = toFallback;
      } catch (e) { toFallback(); }
    }
    function loadMain() {
      if (window.SQLProfiler) return Promise.resolve();
      return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'profiler.worker.js'; s.onload = res; s.onerror = function () { rej(new Error('Could not load profiler engine')); }; document.head.appendChild(s); });
    }
    return {
      run: function (sql, dialect) {
        init();
        var minDelay = new Promise(function (r) { setTimeout(r, 260); }), p;
        if (worker) p = new Promise(function (res, rej) { var id = ++seq; pendingMap[id] = { res: res, rej: rej }; worker.postMessage({ id: id, sql: sql, dialect: dialect }); });
        else p = loadMain().then(function () { return window.SQLProfiler.analyze(sql, dialect); });
        return p.then(function (r) { return minDelay.then(function () { return r; }); });
      }
    };
  })();

  var pending = null;
  function go(route) { if (location.hash === '#/' + route) { router(); } else location.hash = '#/' + route; }
  function titleOf(sql) { var m = sql.match(/^\s*--\s*(.+)$/m); return (m ? m[1] : sql.replace(/\s+/g, ' ').trim()).slice(0, 56) || 'Untitled query'; }
  function sevBadge(s) { return '<span class="badge sev-' + (s === 'critical' ? 'critical' : s === 'warning' ? 'warning' : 'info') + '">' + s.toUpperCase() + '</span>'; }
  function emptyCard(icon, title, text, btn) {
    return '<div class="empty">' + I.get(icon, 36) + '<strong>' + esc(title) + '</strong><span>' + esc(text) + '</span>' + (btn || '') + '</div>';
  }

  /* =====================================================================
     VIEW: Dashboard (Focused on Tuning & Script Pipelines)
     ===================================================================== */
  async function viewDashboard(el) {
    var qs = (await DB.all('queries')).sort(function (a, b) { return b.ts - a.ts; });
    var scripts = await DB.all('scripts');
    var avg = qs.length ? Math.round(qs.reduce(function (s, q) { return s + q.score; }, 0) / qs.length) : 0;
    var crit = qs.reduce(function (s, q) { return s + (q.critical || 0); }, 0);
    var saved = qs.reduce(function (s, q) { return s + Math.max(0, q.elapsedMs - q.projectedMs); }, 0);
    var sec = sectorObj();
    var tele = { ingest: [], lat: [] };
    for (var i = 0; i < 60; i++) { tele.ingest.push(52 + Math.sin(i / 6) * 6 + Math.random() * 4); tele.lat.push(28 + Math.cos(i / 9) * 7 + Math.random() * 5); }
    function teleHtml() {
      return UI.lineChart([{ name: 'Historian Ingest (K rows/s)', data: tele.ingest, color: 'var(--accent)' }, { name: 'Query p95 Latency (ms)', data: tele.lat, color: 'var(--warn)' }], { xLabels: ['−2 min', 'now'], label: 'Simulated historian telemetry', min: 0 });
    }
    var recent = qs.slice(0, 5).map(function (q) {
      return '<button class="list-item" type="button" data-open-q="' + q.id + '"><span class="badge ' + (q.score >= 75 ? 'sev-ok' : q.score >= 50 ? 'sev-warning' : 'sev-critical') + '">' + q.score + '</span><span class="t">' + esc(q.name) + '</span><span class="muted" style="font-size:.8rem">' + UI.timeAgo(q.ts) + '</span></button>';
    }).join('') || emptyCard('gauge', 'No profiled queries yet', 'Profile historian SQL to inspect seek/scan efficiency.', '<button class="btn btn-primary" data-go="profiler">Open Profiler</button>');
    var slow = qs.slice().sort(function (a, b) { return b.elapsedMs - a.elapsedMs; }).slice(0, 5);
    var slowHtml = slow.length ? UI.barList(slow.map(function (q) { return { label: q.name, value: q.elapsedMs, text: UI.fmtMs(q.elapsedMs), color: q.score < 50 ? 'linear-gradient(90deg,var(--warn),var(--bad))' : '' }; })) : '<p class="muted">No queries profiled yet.</p>';
    var sparkVals = qs.slice(0, 12).reverse().map(function (q) { return q.score; });

    el.innerHTML =
      '<div class="page-h"><div><h1>SCADA SQL-Optima Cockpit</h1><p>Dedicated tuning hub for industrial process historians, data acquisition scripts, and diagnostic debugging.</p></div></div>' +
      '<div class="bento">' +
      UI.card({ span: 'c-8', cls: 'hero card-hover', body:
        '<div class="row"><span class="badge sev-info">' + I.get('sparkle', 14) + ' Tuning Engine v' + VERSION + '</span><span class="badge" style="border-color:' + sec.color + '">' + esc(sec.name) + ' Heuristics</span></div>' +
        '<h1>Optimize Historian Queries &amp; <span>Data Pipelines.</span></h1>' +
        '<p class="muted" style="max-width:62ch">Profile T-SQL and TimescaleDB queries to eliminate unindexed table scans, and draft data acquisition &amp; reporting scripts with offline linting.</p>' +
        '<div class="row"><button class="btn btn-primary" data-go="profiler">' + I.get('gauge', 18) + ' Query Profiler</button><button class="btn" data-go="workbench">' + I.get('terminal', 18) + ' Script Workbench</button><button class="btn" data-go="workbench" data-lookup-focus="true">' + I.get('bug', 18) + ' Error Code Lookup</button></div>' }) +
      UI.card({ span: 'c-4', title: 'Historian Health Score', icon: 'shield', body: UI.gauge(avg, { sub: qs.length ? 'avg of ' + qs.length + ' queries' : 'no data yet', label: 'Average score' }) }) +
      UI.kpi('Queries Profiled', UI.fmtNum(qs.length), 'stored in local IndexedDB', UI.sparkline(sparkVals.length > 1 ? sparkVals : [50, 50]), 'database') +
      UI.kpi('Critical Bottlenecks', '<span style="color:' + (crit ? 'var(--bad)' : 'var(--ok)') + '">' + crit + '</span>', crit ? 'scans & timeouts' : 'all queries healthy', '', 'alert') +
      UI.kpi('Est. Time Saved', UI.fmtMs(saved), 'per query batch execution', '', 'clock') +
      UI.kpi('Active Scripts', UI.fmtNum(scripts.length), 'InTouch · C# · Shell · SQL', '', 'terminal') +
      UI.card({ span: 'c-8', title: 'Historian Ingest & Query Latency', icon: 'bolt', right: '<span class="badge sev-info right">simulated</span>', body: '<div id="tele">' + teleHtml() + '</div>' }) +
      UI.card({ span: 'c-4', title: 'Top Latency Queries', icon: 'clock', body: slowHtml }) +
      UI.card({ span: 'c-6', title: 'Industry Optimization Focus', icon: 'layers', body:
        '<div class="sector-grid" id="sectorGrid">' + SECTORS.map(function (s) { return '<button class="sector" type="button" data-sector="' + s.id + '" aria-pressed="' + (s.id === sec.id) + '"><i style="background:' + s.color + '"></i>' + esc(s.name) + '</button>'; }).join('') + '</div>' +
        '<p class="tip" id="sectorTip" style="margin-top:12px">' + esc(sec.tip) + '</p>' }) +
      UI.card({ span: 'c-6', title: 'Recent Queries', icon: 'list', body: '<div class="list">' + recent + '</div>' }) +
      '</div>';

    el.addEventListener('click', function (e) {
      var g = e.target.closest('[data-go]');
      if (g) {
        if (g.dataset.lookupFocus) { go('workbench'); setTimeout(function () { var i = $('#errQ'); i && i.focus(); }, 250); return; }
        return go(g.dataset.go);
      }
      var s = e.target.closest('[data-sector]');
      if (s) { State.set('sector', s.dataset.sector); $$('#sectorGrid .sector', el).forEach(function (b) { b.setAttribute('aria-pressed', b === s); }); $('#sectorTip', el).textContent = sectorObj().tip; renderSectorChip(); return; }
      var q = e.target.closest('[data-open-q]'); if (q) { pending = { type: 'open-query', arg: q.dataset.openQ }; go('profiler'); }
    });
    var t = setInterval(function () {
      tele.ingest.push(Math.max(30, tele.ingest[tele.ingest.length - 1] + (Math.random() - .5) * 6)); tele.ingest.shift();
      var spike = Math.random() < .06 ? 25 : 0; tele.lat.push(Math.max(8, 26 + Math.random() * 12 + spike)); tele.lat.shift();
      var box = $('#tele', el); if (box) box.innerHTML = teleHtml();
    }, 2000);
    return function () { clearInterval(t); };
  }

  /* =====================================================================
     VIEW: Query Profiler (Task 1: Develop and optimize SQL queries)
     ===================================================================== */
  async function viewProfiler(el) {
    var draft = await DB.kvGet('draft:profiler', null);
    var dialect = (draft && draft.dialect) || 'tsql', lastRes = null, lastSql = '', copyStore = [], libTab = 'tpl', mounted = true;
    el.innerHTML =
      '<div class="page-h"><div><h1>SQL Query Profiler &amp; Tuning Engine</h1><p>Develop and optimize queries for SCADA historians. Analyze execution plans, seek/scan ratios, and IO bottlenecks.</p></div></div>' +
      '<div class="bento">' +
      '<section class="card glass c-8"><div class="row" style="margin-bottom:12px"><label class="field field-inline"><span>SQL Dialect</span><select class="select" id="dialect"><option value="tsql">T-SQL (SQL Server · AVEVA / Wonderware)</option><option value="timescale">PostgreSQL / TimescaleDB</option><option value="plsql">PL/SQL (Oracle)</option></select></label>' +
      '<div class="row right"><button class="btn" type="button" data-act="clear">' + I.get('trash', 18) + ' Clear</button><button class="btn" type="button" data-act="save">' + I.get('save', 18) + ' Save</button><button class="btn btn-primary" type="button" id="runBtn" data-act="run">' + I.get('play', 18) + ' Profile Query <kbd>Ctrl ↵</kbd></button></div></div>' +
      '<div id="edMount"></div><p class="muted" style="margin-top:8px;font-size:.85rem">Off-thread AST analysis &amp; cost simulation. Validates indexing, sargability, and memory grant requests.</p></section>' +
      '<section class="card glass c-4"><div class="seg" role="tablist" aria-label="Library"><button type="button" role="tab" aria-selected="true" data-tab="tpl">Historian Templates</button><button type="button" role="tab" aria-selected="false" data-tab="hist">Query History</button></div><div id="libBody" class="list scroll-y" style="margin-top:12px;max-height:340px"></div></section>' +
      '</div><div class="bento" id="results" style="margin-top:16px" aria-live="polite"></div>';
    $('#dialect', el).value = dialect;
    var results = $('#results', el);
    results.innerHTML = UI.card({ body: emptyCard('gauge', 'Ready to Profile', 'Select a template or paste SQL above, then click Profile Query.') });

    var saveDraft = UI.debounce(function () { DB.kvSet('draft:profiler', { sql: ed.getValue(), dialect: dialect }); }, 500);
    var ed = UI.codeEditor({ value: (draft && draft.sql) || TEMPLATES[0].sql, lang: 'sql', label: 'SQL query editor', onChange: saveDraft, onRun: run, onSave: saveQuery });
    $('#edMount', el).appendChild(ed.el);

    async function refreshLib() {
      var box = $('#libBody', el); if (!box) return;
      if (libTab === 'tpl') {
        box.innerHTML = TEMPLATES.map(function (t) { return '<button class="list-item" type="button" data-tpl="' + t.id + '">' + I.get('file', 16) + '<span class="t">' + esc(t.name) + '</span><span class="badge">' + (t.dialect === 'tsql' ? 'T-SQL' : t.dialect === 'plsql' ? 'PL/SQL' : 'PG') + '</span></button>'; }).join('');
      } else {
        var h = (await DB.all('queries')).sort(function (a, b) { return b.ts - a.ts; });
        box.innerHTML = h.length ? h.map(function (q) { return '<button class="list-item" type="button" data-hist="' + q.id + '"><span class="badge ' + (q.score >= 75 ? 'sev-ok' : q.score >= 50 ? 'sev-warning' : 'sev-critical') + '">' + q.score + '</span><span class="t">' + esc(q.name) + '</span><span class="muted" style="font-size:.78rem">' + UI.timeAgo(q.ts) + '</span></button>'; }).join('') + '<button class="btn btn-danger" type="button" data-act="clear-hist" style="margin-top:8px">' + I.get('trash', 18) + ' Clear history</button>' : emptyCard('clock', 'No history yet', 'Saved queries persist locally in IndexedDB.');
      }
    }
    function setDialect(d) { dialect = d; $('#dialect', el).value = d; saveDraft(); }
    function load(sql, d) { ed.setValue(sql); if (d) setDialect(d); saveDraft(); ed.focus(); }

    async function saveQuery(res) {
      var sql = ed.getValue(); if (!sql.trim()) return;
      var rec = { id: 'q' + djb(dialect + '|' + sql), ts: Date.now(), name: titleOf(sql), sql: sql, dialect: dialect, score: res ? res.score : 0, elapsedMs: res ? res.metrics.elapsedMs : 0, projectedMs: res ? res.metrics.projectedMs : 0, critical: res ? res.findings.filter(function (f) { return f.sev === 'critical'; }).length : 0 };
      if (!res) { var ex = await DB.get('queries', rec.id); if (ex) { rec = Object.assign(ex, { ts: Date.now() }); } }
      await DB.put('queries', rec);
      if (!res) UI.toast('Query saved to local library', 'ok');
      if (mounted) refreshLib();
    }

    async function run() {
      var sql = ed.getValue(), btn = $('#runBtn', el); if (!btn) return;
      btn.disabled = true;
      results.innerHTML = '<div class="card glass c-4"><div class="skeleton" style="height:150px"></div></div><div class="card glass c-8"><div class="skeleton" style="height:150px"></div></div><div class="card glass c-12"><div class="skeleton" style="height:200px"></div></div>';
      try {
        var res = await Profiler.run(sql, dialect);
        lastRes = res; lastSql = sql;
        if (!mounted) return;
        renderResults(res); saveQuery(res);
      } catch (err) {
        if (mounted) results.innerHTML = UI.card({ body: '<div class="empty">' + I.get('alert', 36) + '<strong>Profiling Error</strong><span>' + esc(err.message) + '</span></div>' });
      } finally { btn.disabled = false; }
    }

    function copyBlock(label, text) {
      copyStore.push(text);
      return '<div class="codeblock-h"><strong>' + esc(label) + '</strong><button class="btn btn-ghost right" type="button" data-copy="' + (copyStore.length - 1) + '" aria-label="Copy ' + esc(label) + '">' + I.get('copy', 16) + ' Copy</button></div><pre class="codeblock">' + esc(text) + '</pre>';
    }
    function renderResults(r) {
      copyStore = [];
      var m = r.metrics, gain = m.elapsedMs > 0 ? Math.max(0, Math.round((1 - m.projectedMs / m.elapsedMs) * 100)) : 0;
      var seekPct = (m.seeks + m.scans) ? Math.round(m.seeks / (m.seeks + m.scans) * 100) : 0;
      function tile(l, v, s, cls) { return '<div class="metric ' + (cls || '') + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
      var metrics = '<div class="metric-grid">' +
        tile('Elapsed Time', UI.fmtMs(m.elapsedMs), 'est. wall-clock', m.elapsedMs > 10000 ? 'bad' : m.elapsedMs > 1000 ? 'warn' : 'ok') +
        tile('CPU Time', UI.fmtMs(m.cpuMs), m.parallelism > 1 ? 'DOP ' + m.parallelism : 'serial') +
        tile('Logical Reads', UI.fmtCompact(m.logicalReads), UI.fmtCompact(m.physicalReads) + ' physical', m.logicalReads > 1e6 ? 'bad' : m.logicalReads > 1e4 ? 'warn' : 'ok') +
        tile('I/O Cost', m.ioCost >= 100 ? UI.fmtCompact(m.ioCost) : m.ioCost.toFixed(2), 'units', m.ioCost > 1000 ? 'bad' : m.ioCost > 10 ? 'warn' : 'ok') +
        tile(m.memLabel, UI.fmtMB(m.memMB), m.spill ? 'spill risk' : 'within budget', m.spill ? 'bad' : 'ok') +
        tile('Seek / Scan', seekPct + '%', m.seeks + ' seek · ' + m.scans + ' scan', seekPct >= 75 ? 'ok' : seekPct >= 40 ? 'warn' : 'bad') +
        tile('Rows Read', UI.fmtCompact(m.rowsRead), m.readPct.toFixed(m.readPct < 1 ? 3 : 1) + '% of table') +
        tile('Rows Returned', UI.fmtCompact(m.rowsOut), 'estimated') + '</div>';
      var access = UI.barList(r.tables.map(function (t) {
        return { label: t.name + ' · ' + (t.access === 'seek' ? 'SEEK' : 'SCAN'), value: Math.max(1, t.read / t.rows * 100), text: UI.fmtCompact(t.read) + ' / ' + UI.fmtCompact(t.rows) + ' rows', color: t.access === 'scan' && t.rows > 1e5 ? 'linear-gradient(90deg,var(--warn),var(--bad))' : '' };
      }), { max: 100 });
      var findings = r.findings.map(function (f) {
        return '<article class="finding ' + f.sev + '"><h3>' + sevBadge(f.sev) + '<span>' + esc(f.title) + '</span><span class="badge right">Impact: ' + f.impact + '</span></h3><p class="muted">' + esc(f.detail) + '</p>' + (f.fix ? copyBlock('Optimization recommendation', f.fix) : '') + '</article>';
      }).join('');
      var ddl = r.ddl.length ? r.ddl.map(function (d) { return '<div class="stack">' + copyBlock(d.title, d.sql) + '</div>'; }).join('<div style="height:12px"></div>') : '<p class="muted">No table index adjustments required for this query.</p>';
      var rw = r.rewrite, rwHtml =
        (rw.changed ? '<div class="diff"><div>' + copyBlock('Original Query', lastSql.trim()) + '</div><div>' + copyBlock('Optimized Query', rw.sql) + '</div></div><ul class="stack" style="margin-top:12px">' + rw.changes.map(function (c) { return '<li class="row nowrap">' + I.get('check', 16) + '<span>' + esc(c) + '</span></li>'; }).join('') + '</ul><div class="row" style="margin-top:12px"><button class="btn btn-primary" type="button" data-act="apply-rw">' + I.get('sparkle', 18) + ' Apply optimized rewrite to editor</button></div>' : '<p class="muted">Query is already well-bounded or requires manual restructuring.</p>') +
        (rw.manual.length ? '<h3 style="margin-top:16px">Manual Adjustments</h3><ul class="stack" style="margin-top:8px">' + rw.manual.map(function (c) { return '<li class="row nowrap">' + I.get('alert', 16) + '<span>' + esc(c) + '</span></li>'; }).join('') + '</ul>' : '');

      results.innerHTML =
        UI.card({ span: 'c-4', title: 'Optimization Score', icon: 'gauge', body: UI.gauge(r.score, { sub: r.grade }) + '<p class="muted" style="text-align:center;margin-top:8px">' + (gain > 0 ? 'Estimated <b style="color:var(--ok)">' + gain + '% faster</b> with fixes (≈ ' + UI.fmtMs(m.projectedMs) + ').' : 'Near theoretical optimum.') + '</p>' }) +
        UI.card({ span: 'c-8', title: 'Execution Metrics', icon: 'cpu', right: '<button class="btn right" type="button" data-act="report">' + I.get('download', 18) + ' Export Report</button>', body: metrics }) +
        UI.card({ span: 'c-5', title: 'Index Seek vs Table Scan', icon: 'database', body: access }) +
        UI.card({ span: 'c-7', title: 'Execution Plan Hierarchy', icon: 'layers', body: UI.planTree(r.plan) }) +
        UI.card({ span: 'c-7', title: 'Performance Findings & Fixes (' + r.findings.length + ')', icon: 'sparkle', body: '<div class="stack">' + findings + '</div>' }) +
        UI.card({ span: 'c-5', title: 'Partitioning & Index Schemes', icon: 'database', body: ddl }) +
        UI.card({ span: 'c-12', title: 'Safe Rewritten Statement', icon: 'refresh', body: rwHtml });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function reportMd(r) {
      var m = r.metrics, o = ['# SQL-Optima Performance Report', '', '- Dialect: ' + r.dialect, '- Score: **' + r.score + '/100** (' + r.grade + ')', '- Elapsed: ' + UI.fmtMs(m.elapsedMs) + ' · Projected: ' + UI.fmtMs(m.projectedMs), '', '## Query', '```sql', lastSql.trim(), '```', '', '## Findings'];
      r.findings.forEach(function (f) { o.push('- **[' + f.sev.toUpperCase() + '] ' + f.title + '** — ' + f.detail); if (f.fix) o.push('  ```', '  ' + f.fix.split('\n').join('\n  '), '  ```'); });
      if (r.rewrite.changed) o.push('', '## Rewritten Query', '```sql', r.rewrite.sql, '```');
      return o.join('\n');
    }

    el.addEventListener('change', function (e) { if (e.target.id === 'dialect') setDialect(e.target.value); });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'run') return run();
      if (b.dataset.act === 'save') return saveQuery(null);
      if (b.dataset.act === 'clear') { ed.setValue(''); saveDraft(); ed.focus(); return; }
      if (b.dataset.act === 'apply-rw' && lastRes) { ed.setValue(lastRes.rewrite.sql); saveDraft(); UI.toast('Rewritten SQL applied to editor', 'ok'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (b.dataset.act === 'report' && lastRes) return UI.download('sql-tuning-report.md', reportMd(lastRes), 'text/markdown');
      if (b.dataset.act === 'clear-hist') { if (await UI.confirm('Clear Library', 'Delete saved queries from this device?', 'Delete', true)) { await DB.clear('queries'); refreshLib(); } return; }
      if (b.dataset.copy != null) return UI.copyText(copyStore[+b.dataset.copy]);
      if (b.dataset.tab) { libTab = b.dataset.tab; $$('[data-tab]', el).forEach(function (x) { x.setAttribute('aria-selected', x === b); }); return refreshLib(); }
      if (b.dataset.tpl) { var t = TEMPLATES.filter(function (x) { return x.id === b.dataset.tpl; })[0]; load(t.sql, t.dialect); UI.toast('Loaded: ' + t.name, 'info'); return; }
      if (b.dataset.hist) { var q = await DB.get('queries', b.dataset.hist); if (q) { load(q.sql, q.dialect); UI.toast('Query loaded', 'info'); } }
    });

    await refreshLib();
    if (pending) {
      var p = pending; pending = null;
      if (p.type === 'run-profile') run();
      else if (p.type === 'template') { var tt = TEMPLATES.filter(function (x) { return x.id === p.arg; })[0]; if (tt) load(tt.sql, tt.dialect); }
      else if (p.type === 'open-query') { var qq = await DB.get('queries', p.arg); if (qq) load(qq.sql, qq.dialect); }
    }
    return function () { mounted = false; };
  }

  /* =====================================================================
     VIEW: Script Workbench (Tasks 2 & 3: Scripts & Troubleshooting)
     ===================================================================== */
  function lintScript(lang, code) {
    var out = [], lines = code.split('\n');
    function add(lv, line, msg, c) { out.push({ lv: lv, line: line, msg: msg, code: c }); }
    if (!code.trim()) { add('WARN', 0, 'Script is empty.'); return out; }
    if (lang === 'intouch') {
      var ifs = 0, fors = 0, whiles = 0, conn = /SQLConnect\s*\(/i.test(code), disc = /SQLDisconnect\s*\(/i.test(code), sel = /SQLSelect\s*\(/i.test(code), end = /SQLEnd\s*\(/i.test(code);
      lines.forEach(function (raw, i) {
        var l = raw.replace(/\{[^}]*\}/g, '').replace(/"[^"]*"/g, '""').trim(), u = l.toUpperCase(), n = i + 1; if (!l) return;
        if (/^IF\b/.test(u)) { ifs++; if (!/\bTHEN\b/.test(u)) add('ERROR', n, 'IF statement missing THEN.'); }
        if (/^ENDIF\b/.test(u)) ifs--;
        if (/^FOR\b/.test(u)) fors++; if (/^NEXT\b/.test(u)) fors--;
        if (/^WHILE\b/.test(u)) whiles++; if (/^ENDWHILE\b/.test(u)) whiles--;
        if (/^[\w.$]+\s*=/.test(l) && !/;\s*$/.test(l)) add('WARN', n, 'Assignment should terminate with semicolon (;).');
        if (/^SQL(Connect|Insert|Update|Delete|Select)\s*\(/i.test(l)) add('WARN', n, 'SQL return code is ignored. Capture rc and verify rc == 0.', 'sqlerrormsg');
        if (/PWD=[^"+\s]+/i.test(raw)) add('ERROR', n, 'Hardcoded password detected in connection string.');
      });
      if (ifs !== 0) add('ERROR', 0, 'Unclosed IF / ENDIF structure.');
      if (conn && !disc) add('WARN', 0, 'SQLConnect without SQLDisconnect — connections will leak on SCADA node.');
      if (sel && !end) add('WARN', 0, 'SQLSelect without SQLEnd — cursor handles will leak.');
    } else if (lang === 'csharp') {
      lines.forEach(function (l, i) {
        var n = i + 1;
        if (/new\s+SqlConnection/.test(l) && !/using/.test(l)) add('WARN', n, 'SqlConnection not instantiated in a using declaration.');
        if (/\"\s*(select|insert|update|delete)\b[^\"]*\"\s*\+/i.test(l)) add('ERROR', n, 'SQL constructed by raw concatenation. Use parameterized SqlCommand.');
        if (/select\s+\*/i.test(l)) add('WARN', n, 'SELECT * in acquisition utility. Specify explicit tag columns.');
        if (/\.Result\b|\.Wait\(\)/.test(l)) add('WARN', n, 'Synchronous blocking (.Result/.Wait) on async task. Use await.');
      });
    } else if (lang === 'bash') {
      if (!/^#!/.test(code)) add('WARN', 1, 'Missing shebang (#!/usr/bin/env bash).');
      if (!/set\s+-[a-z]*e/.test(code)) add('WARN', 0, 'Add "set -euo pipefail" to prevent partial execution on error.');
      lines.forEach(function (l, i) {
        if (/sqlcmd/.test(l) && !/\s-b\b/.test(l)) add('INFO', i + 1, 'sqlcmd without -b: errors will not exit with non-zero status.');
      });
    } else {
      lines.forEach(function (l, i) {
        var n = i + 1;
        if (/select\s+\*/i.test(l)) add('WARN', n, 'SELECT * retrieves unneeded tag columns.');
      });
      if (/\b(update|delete)\b/i.test(code) && !/\bwhere\b/i.test(code)) add('ERROR', 0, 'UPDATE/DELETE without WHERE affects all historical rows.');
    }
    if (!out.length) add('OK', 0, 'No issues detected by script linter.');
    return out;
  }

  async function viewWorkbench(el) {
    var scripts = (await DB.all('scripts')).sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    if (!scripts.length) { scripts = SCRIPT_SEEDS.map(function (s, i) { return Object.assign({ created: i, updated: Date.now() }, s); }); for (var i = 0; i < scripts.length; i++) await DB.put('scripts', scripts[i]); }
    var cur = scripts[0], timers = [], mounted = true;
    var LANG_EXT = { intouch: 'txt', csharp: 'cs', bash: 'sh', sql: 'sql' };

    el.innerHTML =
      '<div class="page-h"><div><h1>Script Workbench &amp; Diagnostics Hub</h1><p>Develop, maintain, and debug SCADA data acquisition, processing, and automated reporting scripts.</p></div></div>' +
      '<div class="bento">' +
      UI.card({ span: 'c-3', title: 'Script Repository', icon: 'file', right: '<button class="btn btn-primary right" type="button" data-act="new" aria-label="New script">' + I.get('plus', 18) + '</button>', body: '<div class="list scroll-y" id="scriptList" style="max-height:420px"></div>' }) +
      '<section class="card glass c-9"><div class="row" style="margin-bottom:12px"><label class="field grow" style="min-width:160px"><span>Script Name</span><input class="input" id="sName" type="text" maxlength="60"></label><label class="field field-inline"><span>Platform / Language</span><select class="select" id="sLang"><option value="intouch">InTouch QuickScript</option><option value="csharp">C# (.NET Historian Fetch)</option><option value="sql">SQL Maintenance</option><option value="bash">Shell / Cron Automation</option></select></label></div><div id="edMount"></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="lint">' + I.get('bug', 18) + ' Lint Code</button><button class="btn btn-primary" type="button" data-act="run">' + I.get('play', 18) + ' Simulate Run <kbd>Ctrl ↵</kbd></button><button class="btn" type="button" data-act="save">' + I.get('save', 18) + ' Save</button><button class="btn" type="button" data-act="export">' + I.get('download', 18) + ' Export</button><button class="btn" type="button" data-act="to-profiler">' + I.get('gauge', 18) + ' Profile SQL</button><button class="btn btn-danger right" type="button" data-act="delete">' + I.get('trash', 18) + ' Delete</button></div></section>' +
      UI.card({ span: 'c-7', title: 'Debug Console', icon: 'terminal', right: '<button class="btn btn-ghost right" type="button" data-act="clear-log">Clear</button>', body: '<div class="console" id="console" role="log" aria-live="polite"></div>' }) +
      UI.card({ span: 'c-5', title: 'Protocol & Error Code Lookup', icon: 'search', body: '<label class="field"><span>Search Error or Status (OPC UA, Modbus, SQL, InTouch)</span><input class="input" id="errQ" type="search" placeholder="e.g. 1205, 0x800A0000, ORA-00060, Modbus 02" autocomplete="off"></label><div id="errOut" class="stack scroll-y" style="margin-top:12px;max-height:300px"></div>' }) +
      '</div>';

    var saveT;
    var ed = UI.codeEditor({ value: cur.code, lang: cur.lang, label: 'Script editor', onChange: function () { cur.code = ed.getValue(); cur.updated = Date.now(); clearTimeout(saveT); saveT = setTimeout(persist, 600); }, onRun: runSim, onSave: function () { persist(true); } });
    $('#edMount', el).appendChild(ed.el);

    function persist(toast) { DB.put('scripts', cur); if (toast) UI.toast('Script saved', 'ok'); renderList(); }
    function renderList() {
      var box = $('#scriptList', el); if (!box) return;
      box.innerHTML = scripts.map(function (s) { return '<button class="list-item' + (s.id === cur.id ? ' active' : '') + '" type="button" data-sid="' + s.id + '"><span class="t">' + esc(s.name) + '</span><span class="badge">' + esc({ intouch: 'InTouch', csharp: 'C#', bash: 'Shell', sql: 'SQL' }[s.lang]) + '</span></button>'; }).join('');
    }
    function select(s) { cur = s; $('#sName', el).value = s.name; $('#sLang', el).value = s.lang; ed.setLang(s.lang); ed.setValue(s.code); renderList(); }
    function log(lv, msg, code) {
      var t = new Date(), ts = t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0');
      var box = $('#console', el); if (!box) return;
      var row = document.createElement('div'); row.className = 'log ' + lv;
      row.innerHTML = '<time>' + ts + '</time><span class="lv">' + lv + '</span><span class="msg">' + esc(msg) + '</span>' + (code ? '<button class="btn btn-ghost" type="button" data-lookup="' + esc(code) + '">Diagnostics</button>' : '');
      box.appendChild(row); box.scrollTop = box.scrollHeight;
    }
    function lint() {
      log('INFO', 'Linting ' + cur.name + ' (' + UI.LANGS[cur.lang].name + ')...');
      var res = lintScript(cur.lang, ed.getValue());
      res.forEach(function (r) { log(r.lv, (r.line ? 'Line ' + r.line + ': ' : '') + r.msg, r.code); });
    }
    function runSim() {
      timers.forEach(clearTimeout); timers = [];
      var c = ed.getValue(), seed = c, steps = [];
      steps.push(['INFO', 'Simulating execution: ' + cur.name + ' in sandbox...']);
      if (/sqlconnect|sqlconnection|sqlcmd/i.test(c)) { steps.push(['INFO', 'Connecting to SCADA Historian DSN...']); steps.push(['OK', 'Connected in ' + rnd(seed + 'c', 8, 45) + ' ms']); }
      if (/opc/i.test(c)) { steps.push(['INFO', 'Reading 24 OPC UA monitored items...']); steps.push(['WARN', 'OPC UA read delay: BadTimeout (0x800A0000)', '0x800A0000']); steps.push(['OK', 'Retry successful']); }
      if (/select/i.test(c)) { steps.push(['INFO', 'Acquired ' + UI.fmtNum(rnd(seed + 'r', 400, 12000)) + ' telemetry samples.']); }
      steps.push(['OK', 'Execution completed with return code 0.']);
      steps.forEach(function (s, i) { timers.push(setTimeout(function () { if (mounted) log(s[0], s[1], s[2]); }, i * 160)); });
    }
    function lookup(q) {
      var out = $('#errOut', el); if (!out) return; q = (q || '').trim().toLowerCase();
      if (!q) { out.innerHTML = '<p class="muted">Type an error code or protocol exception to inspect root cause &amp; fix.</p>'; return; }
      var hits = ERRORS.filter(function (e) {
        return e.k.concat([e.code.toLowerCase(), e.title.toLowerCase(), e.sys.toLowerCase()]).some(function (k) {
          return q.indexOf(k) > -1 || k.indexOf(q) > -1;
        });
      });
      out.innerHTML = hits.length ? hits.map(function (e) { return '<article class="finding info"><h3><span class="badge sev-info">' + esc(e.sys) + '</span><span class="mono">' + esc(e.code) + '</span></h3><strong>' + esc(e.title) + '</strong><p class="muted"><b>Cause:</b> ' + esc(e.cause) + '</p><p><b>Fix:</b> ' + esc(e.fix) + '</p></article>'; }).join('') : '<p class="muted">No matching error code in offline database.</p>';
    }

    $('#sName', el).value = cur.name; $('#sLang', el).value = cur.lang; renderList(); lookup('');
    log('INFO', 'Workbench active. Lint scripts, simulate runs, or lookup error diagnostics.');

    el.addEventListener('input', function (e) {
      if (e.target.id === 'sName') { cur.name = e.target.value || 'Untitled'; clearTimeout(saveT); saveT = setTimeout(persist, 600); }
      if (e.target.id === 'errQ') lookup(e.target.value);
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'sLang') { cur.lang = e.target.value; ed.setLang(cur.lang); persist(); } });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.sid) { var s = scripts.filter(function (x) { return x.id === b.dataset.sid; })[0]; if (s) select(s); return; }
      if (b.dataset.lookup) { $('#errQ', el).value = b.dataset.lookup; lookup(b.dataset.lookup); return; }
      switch (b.dataset.act) {
        case 'new': { var n = { id: 's' + UI.uid(), name: 'New_Pipeline', lang: 'sql', code: '-- Data acquisition query\nSELECT TOP (1000) [DateTime], TagName, [Value] FROM Runtime.dbo.History;', created: Date.now(), updated: Date.now() }; scripts.push(n); await DB.put('scripts', n); select(n); UI.toast('Script created', 'ok'); break; }
        case 'save': persist(true); break;
        case 'lint': lint(); break;
        case 'run': runSim(); break;
        case 'clear-log': $('#console', el).innerHTML = ''; break;
        case 'export': { var base = cur.name.replace(/[^\w.-]+/g, '_'); UI.download(base + '.' + LANG_EXT[cur.lang], ed.getValue()); break; }
        case 'to-profiler': DB.kvSet('draft:profiler', { sql: ed.getValue(), dialect: 'tsql' }).then(function () { go('profiler'); }); break;
        case 'delete': if (scripts.length < 2) { UI.toast('Keep at least one script', 'warn'); break; } if (await UI.confirm('Delete script', 'Delete “' + cur.name + '”?', 'Delete', true)) { await DB.del('scripts', cur.id); scripts = scripts.filter(function (x) { return x.id !== cur.id; }); select(scripts[0]); } break;
      }
    });
    return function () { mounted = false; timers.forEach(clearTimeout); clearTimeout(saveT); };
  }

  /* =====================================================================
     VIEW: Settings
     ===================================================================== */
  async function viewSettings(el) {
    el.innerHTML =
      '<div class="page-h"><div><h1>PWA Settings &amp; Local Storage</h1><p>Control room themes, offline cache status, and IndexedDB query backup.</p></div></div><div class="bento">' +
      UI.card({ span: 'c-8', title: 'Display Theme', icon: 'palette', body: '<div class="theme-grid">' + THEMES.map(function (t) { return '<button class="theme-opt" type="button" data-theme="' + t.id + '" aria-pressed="' + (t.id === State.get('theme')) + '"><div class="swatch">' + t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</div><strong>' + t.name + '</strong></button>'; }).join('') + '</div>' }) +
      UI.card({ span: 'c-4', title: 'Sector Heuristics', icon: 'sliders', body: '<label class="field"><span>Industry Focus</span><select class="select" id="setSector">' + SECTORS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === State.get('sector') ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' }) +
      UI.card({ span: 'c-6', title: 'Offline Storage', icon: 'database', body: '<p class="muted">All profiled queries and automation scripts are stored locally inside browser IndexedDB.</p><div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="export">' + I.get('download', 18) + ' Export Backup</button><button class="btn btn-danger" type="button" data-act="wipe">' + I.get('trash', 18) + ' Clear Storage</button></div>' }) +
      UI.card({ span: 'c-6', title: 'PWA Lifecycle', icon: 'wifi', body: '<div class="stack"><div id="swInfo" class="muted">Inspecting service worker...</div><div class="row"><button class="btn btn-primary" type="button" data-act="install">' + I.get('download', 18) + ' Install App</button><button class="btn" type="button" data-act="update">' + I.get('refresh', 18) + ' Check Update</button></div></div>' }) +
      '</div>';
    
    function swInfo() {
      var box = $('#swInfo', el); if (!box || !('serviceWorker' in navigator)) return;
      navigator.serviceWorker.getRegistration().then(function (r) {
        if (!box.isConnected) return;
        box.innerHTML = r && navigator.serviceWorker.controller ? '<span class="dot"></span> Service worker active — offline caching enabled.<br>Network: <b>' + (navigator.onLine ? 'online' : 'offline') + '</b>' : '<span class="dot warn"></span> Running without active service worker.';
      });
    }
    swInfo();

    el.addEventListener('change', function (e) {
      if (e.target.id === 'setSector') { State.set('sector', e.target.value); renderSectorChip(); }
    });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.theme) { applyTheme(b.dataset.theme); $$('[data-theme]', el).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); return; }
      if (b.dataset.act === 'export') {
        var data = { app: 'sql-optima-studio', version: VERSION, queries: await DB.all('queries'), scripts: await DB.all('scripts') };
        UI.download('sql-optima-backup.json', JSON.stringify(data, null, 2), 'application/json');
      }
      if (b.dataset.act === 'wipe' && await UI.confirm('Clear Storage', 'Erase saved queries and scripts?', 'Erase', true)) {
        await Promise.all([DB.clear('queries'), DB.clear('scripts')]); location.reload();
      }
      if (b.dataset.act === 'install') installApp();
      if (b.dataset.act === 'update') checkUpdate(true);
    });
  }

  /* =====================================================================
     Shell: Router, Nav, Footer
     ===================================================================== */
  var ROUTES = {
    dashboard: { title: 'Dashboard', icon: 'home', render: viewDashboard },
    profiler: { title: 'Query Profiler', icon: 'gauge', render: viewProfiler },
    workbench: { title: 'Script Workbench', icon: 'terminal', render: viewWorkbench },
    settings: { title: 'Settings', icon: 'sliders', render: viewSettings }
  };
  var appEl = $('#app'), cleanup = null, navToken = 0;

  function applyTheme(id) {
    var t = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
    document.documentElement.setAttribute('data-theme', t.id); State.set('theme', t.id);
  }
  function renderSectorChip() { var c = $('#sectorChip'); if (c) c.innerHTML = 'Sector Heuristic<b>' + esc(sectorObj().name) + '</b>'; }
  function renderNav() {
    var html = '<div class="nav-sec">Core Studio</div>';
    Object.keys(ROUTES).forEach(function (k) {
      var r = ROUTES[k];
      html += '<a class="nav-item" href="#/' + k + '" data-route="' + k + '" title="' + esc(r.title) + '">' + I.get(r.icon, 20) + '<span class="nav-label">' + esc(r.title) + '</span></a>';
    });
    $('#nav').innerHTML = html;
  }
  function setCollapsed(c) {
    appEl.classList.toggle('collapsed', c); State.set('collapsed', c);
  }
  function openNav(o) { appEl.classList.toggle('nav-open', o); }

  function renderFooter() {
    $('#footer').innerHTML =
      '<div class="footer-in"><div class="footer-brand">' + I.logo(32) + '<span>© ' + new Date().getFullYear() + ' <b>SQL-Optima Studio</b><br>SCADA Historian Query Profiling &amp; Script Workbench.</span></div>' +
      '<div class="status-row"><span class="status-chip"><span class="dot" id="dbDot"></span>Historian Latency <b id="dbLat">— ms</b></span><span class="status-chip"><span class="dot" id="syncDot"></span>Offline PWA <b id="syncTxt">Active</b></span></div>' +
      '<div class="socials">' + UI.socialBar() + '</div></div>';
  }
  var lat = 14;
  function tickLatency() {
    lat = Math.max(4, Math.min(85, lat + (Math.random() - .5) * 8));
    var v = $('#dbLat'), d = $('#dbDot'); if (!v) return;
    v.textContent = Math.round(lat) + ' ms'; d.className = 'dot' + (lat > 50 ? ' warn' : '');
  }

  function setCrumbs(name) {
    var r = ROUTES[name];
    $('#crumbs').innerHTML = '<a class="crumb-root" href="#/dashboard">Studio</a><span class="sep">/</span><b aria-current="page">' + esc(r.title) + '</b>';
    document.title = r.title + ' — SQL-Optima Studio';
    $$('.nav-item').forEach(function (a) { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  async function router() {
    var name = (location.hash.replace(/^#\/?/, '').split(/[?\/]/)[0]) || 'dashboard';
    if (!ROUTES[name]) name = 'dashboard';
    if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; }
    var token = ++navToken, host = $('#view'), el = document.createElement('div'); el.className = 'view-enter';
    host.replaceChildren(el); setCrumbs(name); openNav(false);
    try {
      var c = await ROUTES[name].render(el);
      if (token !== navToken) { if (typeof c === 'function') c(); return; }
      cleanup = typeof c === 'function' ? c : null;
    } catch (err) {
      el.innerHTML = UI.card({ body: '<div class="empty">' + I.get('alert', 36) + '<strong>Application Error</strong><span>' + esc(err.message) + '</span></div>' });
    }
  }

  var deferredPrompt = null, swReg = null;
  function installApp() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
    else UI.toast('PWA already installed or install from browser menu.', 'info');
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) { swReg = reg; }).catch(function () {});
  }
  function checkUpdate(manual) {
    if (swReg) swReg.update().then(function () { if (manual) UI.toast('PWA is up to date', 'ok'); });
  }

  function boot() {
    applyTheme(State.get('theme'));
    $('#brandLogo').innerHTML = I.logo(36);
    renderNav(); renderSectorChip(); renderFooter(); setCollapsed(!!State.get('collapsed'));
    $('#collapseBtn').addEventListener('click', function () { setCollapsed(!appEl.classList.contains('collapsed')); });
    $('#menuBtn').addEventListener('click', function () { openNav(!appEl.classList.contains('nav-open')); });
    $('#scrimNav').addEventListener('click', function () { openNav(false); });
    $('#themeBtn').addEventListener('click', function () {
      var i = THEMES.map(function (t) { return t.id; }).indexOf(State.get('theme'));
      applyTheme(THEMES[(i + 1) % THEMES.length].id);
    });
    window.addEventListener('hashchange', router);
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
    tickLatency(); setInterval(tickLatency, 2500);
    registerSW(); router();
  }
  boot();
})();
