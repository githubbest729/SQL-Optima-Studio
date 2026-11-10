/* SQL-Optima Studio — core application
 * Router · state · IndexedDB persistence · profiler client · views · PWA lifecycle.
 * Vanilla JS (no build step). Depends on js/icons.js and js/components.js.
 */
(function () {
  'use strict';

  var UI = window.UI, I = window.Icons, esc = UI.esc;
  var VERSION = '1.0.0';
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
     Settings / state (localStorage — tiny, synchronous, needed before first paint)
     ===================================================================== */
  var THEMES = [
    { id: 'control-room', name: 'Control Room Dark', color: '#070b11', sw: ['#070b11', '#121a26', '#38bdf8', '#34d399'] },
    { id: 'slate', name: 'Engineer Slate', color: '#0f1420', sw: ['#0f1420', '#1b2333', '#8b9cff', '#7dd3fc'] },
    { id: 'amber', name: 'High-Viz Amber', color: '#0a0804', sw: ['#0a0804', '#17120a', '#ffb000', '#ffd166'] }
  ];
  var SECTORS = [
    { id: 'oil-gas', name: 'Oil & Gas', color: '#f59e0b', tip: 'Keep safety-instrumented systems and the historian network segregated, and replicate alarm/event history to a read-only reporting node before running heavy analytics.' },
    { id: 'water', name: 'Water / Wastewater', color: '#38bdf8', tip: 'Pump stations log at ~1 s but regulatory reports need 15-minute or daily values — build rollup tables or continuous aggregates instead of scanning raw samples.' },
    { id: 'cooling', name: 'District Cooling', color: '#22d3ee', tip: 'kW/TR and ΔT trends reward pre-aggregated hourly tables with an index on (PlantId, TagName, DateTime). Avoid CONVERT(date, …) in daily energy reports.' },
    { id: 'metals', name: 'Metals & Minerals', color: '#a78bfa', tip: 'Mill and furnace vibration tags are very high frequency: use columnstore/compression, keep 7–14 days raw and downsample the rest.' },
    { id: 'food', name: 'Food & Beverage', color: '#34d399', tip: 'Batch genealogy joins history with batch tables — partition by batch window and keep audit trails immutable to support data-integrity requirements.' },
    { id: 'infra', name: 'Infrastructure', color: '#fb7185', tip: 'Tunnels and buildings mean thousands of low-rate tags. Use tag-group lookup tables instead of long IN lists or LIKE \'%…%\' scans.' }
  ];
  var CURRENCIES = { USD: '$', EUR: '€', GBP: '£', PHP: '₱', AED: 'AED ', SAR: 'SAR ' };

  var State = (function () {
    var KEY = 'sqlopt.state', s = { theme: 'control-room', collapsed: false, sector: 'cooling', currency: 'USD' };
    try { var r = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in r) s[k] = r[k]; } catch (e) { }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } }
    return { get: function (k) { return s[k]; }, set: function (k, v) { s[k] = v; save(); }, all: function () { return s; } };
  })();
  function sectorObj() { return SECTORS.filter(function (x) { return x.id === State.get('sector'); })[0] || SECTORS[0]; }
  function money(n) { return (CURRENCIES[State.get('currency')] || '$') + UI.fmtNum(n, 2); }

  /* =====================================================================
     Seed content: query templates, scripts, error codes, BOM & QHSE data
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
      '-- Slow daily report (what NOT to do)',
      'SELECT *',
      'FROM Runtime.dbo.History',
      "WHERE CONVERT(date, [DateTime]) = '2026-11-09'",
      "  AND TagName LIKE '%Flow%'",
      'ORDER BY [DateTime] DESC;') },
    { id: 't3', name: 'Alarm flood at shift change', dialect: 'tsql', sql: L(
      '-- Alarm flood around the 06:00 shift handover (illustrative schema)',
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
      '-- Find tags with data-quality problems (communication gaps)',
      'SELECT TagName, COUNT(*) AS BadSamples',
      'FROM Runtime.dbo.History',
      'WHERE [DateTime] >= DATEADD(day, -1, GETDATE())',
      '  AND QualityDetail <> 192',
      'GROUP BY TagName',
      'HAVING COUNT(*) > 100',
      'ORDER BY BadSamples DESC;') },
    { id: 't6', name: 'Cursor row-by-row update (anti-pattern)', dialect: 'tsql', sql: L(
      '-- Last-value refresh with a cursor: replace with a set-based UPDATE',
      'DECLARE tag_cur CURSOR FOR SELECT TagName FROM Runtime.dbo.Tag;',
      'DECLARE @t nvarchar(256);',
      'OPEN tag_cur; FETCH NEXT FROM tag_cur INTO @t;',
      'WHILE @@FETCH_STATUS = 0',
      'BEGIN',
      '  UPDATE dbo.TagSummary',
      '  SET LastValue = (SELECT TOP 1 [Value] FROM Runtime.dbo.History WHERE TagName = @t ORDER BY [DateTime] DESC)',
      '  WHERE TagName = @t;',
      '  FETCH NEXT FROM tag_cur INTO @t;',
      'END') },
    { id: 't7', name: 'Oracle: daily energy totals (TRUNC anti-pattern)', dialect: 'plsql', sql: L(
      '-- Daily energy totals for a district cooling plant (Oracle)',
      'SELECT TRUNC(event_time) AS day, tag_name, SUM(tag_value) AS total_kwh',
      'FROM tag_history',
      "WHERE TRUNC(event_time) = TO_DATE('2026-11-09','YYYY-MM-DD')",
      "  AND tag_name LIKE 'DCP_%_ENERGY'",
      'GROUP BY TRUNC(event_time), tag_name;') },
    { id: 't8', name: 'TimescaleDB: 5-minute buckets, last 6 h', dialect: 'timescale', sql: L(
      '-- Turbidity trend for a water treatment plant (TimescaleDB)',
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
      '{ ===== Shift handover logger =====',
      '  Type: Condition script (On True) — fires when ShiftChange goes 0 -> 1 }',
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
      'public static class HistorianFetch',
      '{',
      '    // Reads one tag for the last N minutes and writes a CSV (parameterised, with timeout).',
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
      '# Nightly alarm summary for the 06:00 handover',
      '# cron: 15 5 * * *  /opt/scada/nightly_alarm_report.sh',
      'set -euo pipefail',
      '',
      'OUT="/var/reports/alarms_$(date +%F).csv"',
      'sqlcmd -S "$DB_HOST" -d Runtime -U "$DB_USER" -P "$DB_PASS" -b -W -s"," \\',
      '  -Q "SET NOCOUNT ON; SELECT TOP (50) Alarm_Source, COUNT(*) AS Cnt FROM dbo.AlarmHistory WHERE EventTime >= DATEADD(hour,-12,GETDATE()) GROUP BY Alarm_Source ORDER BY Cnt DESC" \\',
      '  > "$OUT"',
      'gzip -f "$OUT"',
      'logger -t scada-report "Alarm report written: $OUT.gz"') },
    { id: 's-sql', name: 'maintenance_fragmentation.sql', lang: 'sql', code: L(
      '-- Weekly index health check on the ARCHIVE database (run off-peak)',
      'SELECT TOP (25) OBJECT_NAME(ips.object_id) AS TableName, i.name AS IndexName,',
      '       ips.avg_fragmentation_in_percent, ips.page_count',
      'FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, \'LIMITED\') AS ips',
      'JOIN sys.indexes AS i ON i.object_id = ips.object_id AND i.index_id = ips.index_id',
      'WHERE ips.page_count > 1000 AND ips.avg_fragmentation_in_percent > 30',
      'ORDER BY ips.avg_fragmentation_in_percent DESC;') }
  ];

  // Reference data for the debugging console (verify against vendor documentation before acting).
  var ERRORS = [
    { sys: 'SQL Server', code: '1205', k: ['1205', 'deadlock victim', 'deadlocked'], title: 'Transaction deadlocked — chosen as victim', cause: 'Two sessions hold locks the other needs. Common when shift-change alarm bursts insert while report queries read/update the same pages.', fix: 'Retry with back-off in the caller; keep transactions short; access tables in the same order; enable READ_COMMITTED_SNAPSHOT for reporting reads; index the predicate columns to shrink lock footprints.' },
    { sys: 'SQL Server', code: '1222', k: ['1222', 'lock request time out'], title: 'Lock request time-out period exceeded', cause: 'A blocking session held locks longer than SET LOCK_TIMEOUT.', fix: 'Find the head blocker (sys.dm_exec_requests / sp_who2), shorten its transaction, or move heavy reads to a replica.' },
    { sys: 'SQL Server', code: '-2', k: ['-2', 'timeout expired', 'execution timeout'], title: 'Timeout expired (client CommandTimeout)', cause: 'Query ran longer than the client timeout — typically a table scan on a large history table or blocking.', fix: 'Add a sargable time predicate, profile the plan, and only then raise CommandTimeout. Avoid blindly increasing timeouts on HMI trend queries.' },
    { sys: 'SQL Server', code: '18456', k: ['18456', 'login failed'], title: 'Login failed for user', cause: 'Wrong password, disabled login, or the account lacks access to the database/DSN.', fix: 'Check the state number in the SQL error log, confirm the DSN/connection string, and rotate the service account secret.' },
    { sys: 'SQL Server', code: '9002', k: ['9002', 'transaction log', 'log is full'], title: 'Transaction log full', cause: 'Long-running transaction or missing log backups under the FULL recovery model.', fix: 'Take a log backup, find the open transaction (DBCC OPENTRAN), and schedule regular log backups.' },
    { sys: 'SQL Server', code: '8645', k: ['8645', 'memory grant'], title: 'Timeout waiting for memory resources', cause: 'Too many concurrent queries with large sort/hash grants.', fix: 'Reduce rows before sorting, add covering indexes, or cap with Resource Governor.' },
    { sys: 'Oracle', code: 'ORA-00060', k: ['ora-00060', '00060', 'deadlock detected'], title: 'Deadlock detected while waiting for resource', cause: 'Circular lock wait between sessions (often unindexed foreign keys).', fix: 'Review the trace file, index FK columns, and keep a consistent update order.' },
    { sys: 'Oracle', code: 'ORA-01555', k: ['ora-01555', '01555', 'snapshot too old'], title: 'Snapshot too old', cause: 'Long query needs undo that has been overwritten.', fix: 'Shorten the query (time-bound it), size UNDO_RETENTION appropriately, avoid commit-in-loop.' },
    { sys: 'Oracle', code: 'ORA-12541', k: ['ora-12541', '12541', 'no listener'], title: 'TNS: no listener', cause: 'Listener down, wrong host/port, or firewall.', fix: 'lsnrctl status, verify tnsnames.ora/Easy Connect, check the firewall between SCADA and DB zones.' },
    { sys: 'PostgreSQL / TimescaleDB', code: '40P01', k: ['40p01', 'deadlock detected'], title: 'deadlock_detected', cause: 'Concurrent transactions locked rows in opposite order.', fix: 'Retry the transaction, order updates consistently, and keep transactions short.' },
    { sys: 'PostgreSQL / TimescaleDB', code: '57014', k: ['57014', 'statement timeout', 'canceling statement'], title: 'query_canceled (statement_timeout)', cause: 'Query exceeded statement_timeout — usually scanning too many chunks.', fix: 'Add a time predicate so chunk exclusion applies; use continuous aggregates for long ranges.' },
    { sys: 'OPC UA', code: '0x800A0000', k: ['0x800a0000', 'badtimeout'], title: 'BadTimeout', cause: 'The server did not answer within the operation timeout — network latency, overloaded server, or oversized subscription.', fix: 'Raise the client timeout moderately, reduce items per read/subscription, check network QoS, and retry with back-off.' },
    { sys: 'OPC UA', code: '0x80050000', k: ['0x80050000', 'badcommunicationerror'], title: 'BadCommunicationError', cause: 'Communication with the server was interrupted.', fix: 'Check cabling/firewall, endpoint URL and server health; enable automatic reconnect.' },
    { sys: 'OPC UA', code: '0x80340000', k: ['0x80340000', 'badnodeidunknown'], title: 'BadNodeIdUnknown', cause: 'The NodeId does not exist in the server address space (renamed tag or wrong namespace index).', fix: 'Browse the server and re-map the tag; verify the namespace index after server restarts.' },
    { sys: 'OPC UA', code: '0x801A0000', k: ['0x801a0000', 'badcertificateuntrusted'], title: 'BadCertificateUntrusted', cause: 'The server certificate is not in the client trust list.', fix: 'Move the certificate into the trusted store after verifying its thumbprint.' },
    { sys: 'OPC UA', code: '0x80250000', k: ['0x80250000', 'badsessionidinvalid'], title: 'BadSessionIdInvalid', cause: 'Session expired or was closed by the server.', fix: 'Re-create the session and subscriptions; keep keep-alives within the session timeout.' },
    { sys: 'OPC UA', code: '0x80560000', k: ['0x80560000', 'badtoomanysessions'], title: 'BadTooManySessions', cause: 'The server reached its maximum concurrent sessions.', fix: 'Close stale sessions, share a single session across readers, or raise the server limit.' },
    { sys: 'Modbus', code: '01', k: ['modbus exception 01', 'illegal function'], title: 'Exception 01 — Illegal Function', cause: 'Function code not supported by the device.', fix: 'Check the device manual for supported function codes (03 vs 04 holding/input registers).' },
    { sys: 'Modbus', code: '02', k: ['modbus exception 02', 'illegal data address'], title: 'Exception 02 — Illegal Data Address', cause: 'Register address outside the device map (often 0- vs 1-based offset).', fix: 'Verify the register map and base offset; read in smaller blocks.' },
    { sys: 'Modbus', code: '03', k: ['modbus exception 03', 'illegal data value'], title: 'Exception 03 — Illegal Data Value', cause: 'Quantity or value out of the allowed range.', fix: 'Reduce the register count per request (commonly ≤125) and check value scaling.' },
    { sys: 'Modbus', code: '04', k: ['modbus exception 04', 'slave device failure'], title: 'Exception 04 — Slave Device Failure', cause: 'Unrecoverable error inside the device.', fix: 'Inspect the device diagnostics, power-cycle if safe, and escalate to the instrument team.' },
    { sys: 'Modbus', code: '0B', k: ['modbus exception 0b', 'gateway target device failed', 'exception 11'], title: 'Exception 0B — Gateway Target Failed to Respond', cause: 'The serial device behind the gateway is offline or has the wrong unit ID.', fix: 'Check RS-485 wiring/termination, baud/parity and the unit ID.' },
    { sys: 'InTouch', code: 'SQL* result ≠ 0', k: ['sqlconnect', 'sqlinsert', 'sqlselect', 'sqlerrormsg', 'result code'], title: 'InTouch SQL function returned a non-zero result', cause: 'The SQL Access function failed (bad DSN, credentials, table or bind list).', fix: 'Always capture the return code and log SQLErrorMsg(code). Verify the ODBC DSN (32-bit vs 64-bit) and the bind list column names.' }
  ];

  var QHSE_BASE = [
    { g: 'Quality', items: [
      'Change request / management-of-change approved before any schema or index change',
      'Query changes validated on a staging historian with production-sized data',
      'Before/after execution plans archived in the change record',
      'FAT/SAT scripts executed and signed off',
      'Rollback script prepared and tested'] },
    { g: 'Health', items: [
      'Control-room display theme tested for glare and contrast on night shift',
      'Alarm presentation reviewed for operator workload during shift handover',
      'Heavy maintenance jobs scheduled outside peak handover windows',
      'Ergonomics: touch targets and font sizes validated on field-rugged tablets'] },
    { g: 'Safety', items: [
      'Safety-instrumented functions remain independent of the historian/reporting database',
      'No write-back from reporting scripts to control tags without approval',
      'Backup and restore verified before index rebuild or partition switch',
      'Cybersecurity zones and conduits reviewed (IEC 62443 approach)',
      'Dashboards use least-privilege, read-only SQL accounts'] },
    { g: 'Environment', items: [
      'Data-retention policy defined to avoid needless storage growth',
      'Reporting jobs scheduled to reduce server energy use',
      'Emissions/energy tag mappings validated for regulatory reporting',
      'Decommissioned test data and copies securely disposed'] }
  ];
  var QHSE_EXTRA = {
    'oil-gas': [['Safety', 'Hazardous-area (ATEX/IECEx) status confirmed for any field hardware touched'], ['Quality', 'Custody-transfer / allocation tag history is immutable and audited']],
    water: [['Quality', 'Regulatory report values reconciled against lab / SCADA totals'], ['Environment', 'Discharge-limit alarms verified end-to-end after tag remapping']],
    cooling: [['Quality', 'kWh and cooling-energy (TR-h) rollups cross-checked against plant meters'], ['Environment', 'Energy-efficiency KPIs (kW/TR) calculation documented']],
    metals: [['Safety', 'High-frequency acquisition load tested so it cannot starve control-network bandwidth'], ['Health', 'Dust/heat exposure alarms retained for the statutory period']],
    food: [['Quality', 'Data-integrity controls (audit trail, e-signature) validated for batch records'], ['Safety', 'HACCP critical-limit alarms verified after any tag or historian change']],
    infra: [['Safety', 'Life-safety (fire, smoke-control) alarms excluded from maintenance throttling'], ['Quality', 'Tag naming standard applied across all sites']]
  };

  var BOM_BASE = [
    ['Historian server — 2U, 64 GB RAM, dual NVMe', 'Hardware', 1, 9800],
    ['NVMe storage tier (7.68 TB, RAID-10)', 'Hardware', 2, 3400],
    ['SQL Server Standard — 2-core pack', 'Licensing', 4, 1850],
    ['Historian tag licence — per 1,000 tags', 'Licensing', 20, 420],
    ['OPC UA / Modbus acquisition gateway', 'Hardware', 2, 2300],
    ['Backup appliance + 3-year support', 'Hardware', 1, 4200],
    ['Schema, partitioning & index design (hours)', 'Services', 40, 95],
    ['Query tuning & script development (hours)', 'Services', 60, 85],
    ['FAT / SAT commissioning (hours)', 'Services', 48, 90],
    ['Documentation & operator training (hours)', 'Services', 24, 70]
  ];
  var BOM_EXTRA = {
    'oil-gas': [['Hazardous-area rated edge enclosure', 'Hardware', 2, 3100], ['Redundant historian fail-over licence', 'Licensing', 1, 6500]],
    water: [['Remote RTU data concentrator (pump stations)', 'Hardware', 4, 1700], ['Regulatory report template pack (hours)', 'Services', 16, 80]],
    cooling: [['Energy (kW/TR) rollup tables (hours)', 'Services', 24, 90], ['Chiller Modbus mapping (hours)', 'Services', 32, 85]],
    metals: [['High-frequency (100 ms) acquisition licence', 'Licensing', 1, 7200], ['Columnstore archive storage', 'Hardware', 1, 5200]],
    food: [['Batch genealogy & audit-trail module', 'Licensing', 1, 5800], ['Validation (IQ/OQ) hours', 'Services', 40, 110]],
    infra: [['Tag-group lookup & naming standardisation (hours)', 'Services', 30, 80], ['Multi-site VPN gateway', 'Hardware', 2, 1400]]
  };
  function bomPreset(sector) {
    return BOM_BASE.concat(BOM_EXTRA[sector] || []).map(function (r) { return { id: UI.uid(), d: r[0], cat: r[1], q: r[2], u: r[3] }; });
  }

  /* =====================================================================
     Profiler client (Web Worker with main-thread fallback)
     ===================================================================== */
  var Profiler = (function () {
    var worker = null, seq = 0, pending = {}, fallback = false;
    function toFallback() { fallback = true; worker = null; Object.keys(pending).forEach(function (k) { pending[k].rej(new Error('Profiler worker stopped — please run again.')); }); pending = {}; }
    function init() {
      if (worker || fallback) return;
      try {
        worker = new Worker('js/profiler.worker.js');
        worker.onmessage = function (e) { var p = pending[e.data.id]; if (!p) return; delete pending[e.data.id]; if (e.data.ok) p.res(e.data.result); else p.rej(new Error(e.data.error)); };
        worker.onerror = toFallback;
      } catch (e) { toFallback(); }
    }
    function loadMain() {
      if (window.SQLProfiler) return Promise.resolve();
      return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'js/profiler.worker.js'; s.onload = res; s.onerror = function () { rej(new Error('Could not load profiler engine')); }; document.head.appendChild(s); });
    }
    return {
      run: function (sql, dialect) {
        init();
        var minDelay = new Promise(function (r) { setTimeout(r, 320); }), p;
        if (worker) p = new Promise(function (res, rej) { var id = ++seq; pending[id] = { res: res, rej: rej }; worker.postMessage({ id: id, sql: sql, dialect: dialect }); });
        else p = loadMain().then(function () { return window.SQLProfiler.analyze(sql, dialect); });
        return p.then(function (r) { return minDelay.then(function () { return r; }); });
      }
    };
  })();

  /* =====================================================================
     Shared UI pieces / cross-view signals
     ===================================================================== */
  var pending = null; // one-shot action for the next view: {type, arg}
  function go(route) { if (location.hash === '#/' + route) { router(); } else location.hash = '#/' + route; }
  function titleOf(sql) { var m = sql.match(/^\s*--\s*(.+)$/m); return (m ? m[1] : sql.replace(/\s+/g, ' ').trim()).slice(0, 56) || 'Untitled query'; }
  function sevBadge(s) { return '<span class="badge sev-' + (s === 'critical' ? 'critical' : s === 'warning' ? 'warning' : 'info') + '">' + s.toUpperCase() + '</span>'; }
  function emptyCard(icon, title, text, btn) {
    return '<div class="empty">' + I.get(icon, 36) + '<strong>' + esc(title) + '</strong><span>' + esc(text) + '</span>' + (btn || '') + '</div>';
  }

  /* =====================================================================
     VIEW: Dashboard
     ===================================================================== */
  async function viewDashboard(el) {
    var qs = (await DB.all('queries')).sort(function (a, b) { return b.ts - a.ts; });
    var scripts = await DB.all('scripts');
    var avg = qs.length ? Math.round(qs.reduce(function (s, q) { return s + q.score; }, 0) / qs.length) : 0;
    var crit = qs.reduce(function (s, q) { return s + (q.critical || 0); }, 0);
    var saved = qs.reduce(function (s, q) { return s + Math.max(0, q.elapsedMs - q.projectedMs); }, 0);
    var h = new Date().getHours(), greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var sec = sectorObj();
    var tele = { ingest: [], lat: [] };
    for (var i = 0; i < 60; i++) { tele.ingest.push(52 + Math.sin(i / 6) * 6 + Math.random() * 4); tele.lat.push(28 + Math.cos(i / 9) * 7 + Math.random() * 5); }
    function teleHtml() {
      return UI.lineChart([{ name: 'Historian ingest (K rows/s)', data: tele.ingest, color: 'var(--accent)' }, { name: 'Query p95 latency (ms)', data: tele.lat, color: 'var(--warn)' }], { xLabels: ['−2 min', 'now'], label: 'Simulated historian telemetry', min: 0 });
    }
    var recent = qs.slice(0, 6).map(function (q) {
      return '<button class="list-item" type="button" data-open-q="' + q.id + '"><span class="badge ' + (q.score >= 75 ? 'sev-ok' : q.score >= 50 ? 'sev-warning' : 'sev-critical') + '">' + q.score + '</span><span class="t">' + esc(q.name) + '</span><span class="muted" style="font-size:.8rem">' + UI.timeAgo(q.ts) + '</span></button>';
    }).join('') || emptyCard('gauge', 'No profiled queries yet', 'Run your first query through the profiler to see scores and savings here.', '<button class="btn btn-primary" data-go="profiler">Open profiler</button>');
    var slow = qs.slice().sort(function (a, b) { return b.elapsedMs - a.elapsedMs; }).slice(0, 5);
    var slowHtml = slow.length ? UI.barList(slow.map(function (q) { return { label: q.name, value: q.elapsedMs, text: UI.fmtMs(q.elapsedMs), color: q.score < 50 ? 'linear-gradient(90deg,var(--warn),var(--bad))' : '' }; })) : '<p class="muted">Nothing to rank yet.</p>';
    var sparkVals = qs.slice(0, 12).reverse().map(function (q) { return q.score; });

    el.innerHTML =
      '<div class="page-h"><div><h1>' + greet + ', engineer</h1><p>Your SCADA query tuning cockpit — profile historian queries, draft acquisition scripts and cost a project, all offline-capable.</p></div></div>' +
      '<div class="bento">' +
      UI.card({ span: 'c-8', cls: 'hero card-hover', body:
        '<div class="row"><span class="badge sev-info">' + I.get('sparkle', 14) + ' Simulation engine v' + VERSION + '</span><span class="badge" style="border-color:' + sec.color + '">' + esc(sec.name) + ' profile</span></div>' +
        '<h1>Make every historian query <span>seek, not scan.</span></h1>' +
        '<p class="muted" style="max-width:62ch">Paste T-SQL, PL/SQL or TimescaleDB, get an estimated execution plan, index &amp; partitioning advice tuned for high-frequency tag history, and a safe rewrite.</p>' +
        '<div class="row"><button class="btn btn-primary" data-go="profiler">' + I.get('gauge', 18) + ' Profile a query</button><button class="btn" data-go="workbench">' + I.get('terminal', 18) + ' Script workbench</button><button class="btn" data-go="bom">' + I.get('calculator', 18) + ' Cost a project</button></div>' }) +
      UI.card({ span: 'c-4', title: 'Fleet health score', icon: 'shield', body: UI.gauge(avg, { sub: qs.length ? 'avg of ' + qs.length + ' queries' : 'no data yet', label: 'Average query score' }) }) +
      UI.kpi('Queries profiled', UI.fmtNum(qs.length), 'stored on this device', UI.sparkline(sparkVals.length > 1 ? sparkVals : [50, 50]), 'database') +
      UI.kpi('Critical findings', '<span style="color:' + (crit ? 'var(--bad)' : 'var(--ok)') + '">' + crit + '</span>', crit ? 'fix before go-live' : 'all clear', '', 'alert') +
      UI.kpi('Est. time saved', UI.fmtMs(saved), 'per run, after recommended fixes', '', 'clock') +
      UI.kpi('Scripts saved', UI.fmtNum(scripts.length), 'InTouch · C# · SQL · shell', '', 'terminal') +
      UI.card({ span: 'c-8', title: 'Live historian telemetry', icon: 'bolt', right: '<span class="badge sev-info right">simulated</span>', body: '<div id="tele">' + teleHtml() + '</div>' }) +
      UI.card({ span: 'c-4', title: 'Slowest profiled queries', icon: 'clock', body: slowHtml }) +
      UI.card({ span: 'c-6', title: 'Industry focus', icon: 'layers', body:
        '<div class="sector-grid" id="sectorGrid">' + SECTORS.map(function (s) { return '<button class="sector" type="button" data-sector="' + s.id + '" aria-pressed="' + (s.id === sec.id) + '"><i style="background:' + s.color + '"></i>' + esc(s.name) + '</button>'; }).join('') + '</div>' +
        '<p class="tip" id="sectorTip" style="margin-top:12px">' + esc(sec.tip) + '</p>' }) +
      UI.card({ span: 'c-6', title: 'Recent activity', icon: 'list', body: '<div class="list">' + recent + '</div>' }) +
      '</div>';

    el.addEventListener('click', function (e) {
      var g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
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
     VIEW: Query Profiler
     ===================================================================== */
  async function viewProfiler(el) {
    var draft = await DB.kvGet('draft:profiler', null);
    var dialect = (draft && draft.dialect) || 'tsql', lastRes = null, lastSql = '', copyStore = [], libTab = 'tpl', mounted = true;
    el.innerHTML =
      '<div class="page-h"><div><h1>Query Profiler</h1><p>Estimate the execution plan, IO cost and memory grant of a historian query, then get tuning advice for time-series tables.</p></div></div>' +
      '<div class="bento">' +
      '<section class="card glass c-8"><div class="row" style="margin-bottom:12px"><label class="field field-inline"><span>SQL dialect</span><select class="select" id="dialect"><option value="tsql">T-SQL (SQL Server · AVEVA Historian)</option><option value="plsql">PL/SQL (Oracle)</option><option value="timescale">PostgreSQL / TimescaleDB</option></select></label>' +
      '<div class="row right"><button class="btn" type="button" data-act="clear">' + I.get('trash', 18) + ' Clear</button><button class="btn" type="button" data-act="save">' + I.get('save', 18) + ' Save</button><button class="btn btn-primary" type="button" id="runBtn" data-act="run">' + I.get('play', 18) + ' Profile query <kbd>Ctrl ↵</kbd></button></div></div>' +
      '<div id="edMount"></div><p class="muted" style="margin-top:8px;font-size:.85rem">Heuristic simulation — no database connection is made. Always confirm with the real actual execution plan before deploying.</p></section>' +
      '<section class="card glass c-4"><div class="seg" role="tablist" aria-label="Library"><button type="button" role="tab" aria-selected="true" data-tab="tpl">Templates</button><button type="button" role="tab" aria-selected="false" data-tab="hist">History</button></div><div id="libBody" class="list scroll-y" style="margin-top:12px;max-height:340px"></div></section>' +
      '</div><div class="bento" id="results" style="margin-top:16px" aria-live="polite"></div>';
    $('#dialect', el).value = dialect;
    var results = $('#results', el);
    results.innerHTML = UI.card({ body: emptyCard('gauge', 'Ready to profile', 'Press “Profile query” or Ctrl/Cmd + Enter to analyse the statement above.') });

    var saveDraft = UI.debounce(function () { DB.kvSet('draft:profiler', { sql: ed.getValue(), dialect: dialect }); }, 500);
    var ed = UI.codeEditor({ value: (draft && draft.sql) || TEMPLATES[0].sql, lang: 'sql', label: 'SQL query editor', onChange: saveDraft, onRun: run, onSave: saveQuery });
    $('#edMount', el).appendChild(ed.el);

    async function refreshLib() {
      var box = $('#libBody', el); if (!box) return;
      if (libTab === 'tpl') {
        box.innerHTML = TEMPLATES.map(function (t) { return '<button class="list-item" type="button" data-tpl="' + t.id + '">' + I.get('file', 16) + '<span class="t">' + esc(t.name) + '</span><span class="badge">' + (t.dialect === 'tsql' ? 'T-SQL' : t.dialect === 'plsql' ? 'PL/SQL' : 'PG') + '</span></button>'; }).join('');
      } else {
        var h = (await DB.all('queries')).sort(function (a, b) { return b.ts - a.ts; });
        box.innerHTML = h.length ? h.map(function (q) { return '<button class="list-item" type="button" data-hist="' + q.id + '"><span class="badge ' + (q.score >= 75 ? 'sev-ok' : q.score >= 50 ? 'sev-warning' : 'sev-critical') + '">' + q.score + '</span><span class="t">' + esc(q.name) + '</span><span class="muted" style="font-size:.78rem">' + UI.timeAgo(q.ts) + '</span></button>'; }).join('') + '<button class="btn btn-danger" type="button" data-act="clear-hist" style="margin-top:8px">' + I.get('trash', 18) + ' Clear history</button>' : emptyCard('clock', 'No history yet', 'Profiled queries are stored here and work offline.');
      }
    }
    function setDialect(d) { dialect = d; $('#dialect', el).value = d; saveDraft(); }
    function load(sql, d) { ed.setValue(sql); if (d) setDialect(d); saveDraft(); ed.focus(); }

    async function saveQuery(res) {
      var sql = ed.getValue(); if (!sql.trim()) return;
      var rec = { id: 'q' + djb(dialect + '|' + sql), ts: Date.now(), name: titleOf(sql), sql: sql, dialect: dialect, score: res ? res.score : 0, elapsedMs: res ? res.metrics.elapsedMs : 0, projectedMs: res ? res.metrics.projectedMs : 0, critical: res ? res.findings.filter(function (f) { return f.sev === 'critical'; }).length : 0 };
      if (!res) { var ex = await DB.get('queries', rec.id); if (ex) { rec = Object.assign(ex, { ts: Date.now() }); } }
      await DB.put('queries', rec);
      var all = (await DB.all('queries')).sort(function (a, b) { return b.ts - a.ts; });
      for (var i = 50; i < all.length; i++) await DB.del('queries', all[i].id);
      if (!res) UI.toast('Query saved to history', 'ok');
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
        if (mounted) results.innerHTML = UI.card({ body: '<div class="empty">' + I.get('alert', 36) + '<strong>Could not profile this statement</strong><span>' + esc(err.message) + '</span></div>' });
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
        tile('Elapsed time', UI.fmtMs(m.elapsedMs), 'est. wall-clock', m.elapsedMs > 10000 ? 'bad' : m.elapsedMs > 1000 ? 'warn' : 'ok') +
        tile('CPU time', UI.fmtMs(m.cpuMs), m.parallelism > 1 ? 'DOP ' + m.parallelism : 'serial plan') +
        tile('Logical reads', UI.fmtCompact(m.logicalReads), UI.fmtCompact(m.physicalReads) + ' physical', m.logicalReads > 1e6 ? 'bad' : m.logicalReads > 1e4 ? 'warn' : 'ok') +
        tile('I/O cost', m.ioCost >= 100 ? UI.fmtCompact(m.ioCost) : m.ioCost.toFixed(2), 'optimizer units', m.ioCost > 1000 ? 'bad' : m.ioCost > 10 ? 'warn' : 'ok') +
        tile(m.memLabel, UI.fmtMB(m.memMB), m.spill ? 'spill risk' : 'within budget', m.spill ? 'bad' : 'ok') +
        tile('Seek / Scan', seekPct + '%', m.seeks + ' seek · ' + m.scans + ' scan', seekPct >= 75 ? 'ok' : seekPct >= 40 ? 'warn' : 'bad') +
        tile('Rows read', UI.fmtCompact(m.rowsRead), m.readPct.toFixed(m.readPct < 1 ? 3 : 1) + '% of table(s)') +
        tile('Rows returned', UI.fmtCompact(m.rowsOut), 'estimated') + '</div>';
      var access = UI.barList(r.tables.map(function (t) {
        return { label: t.name + ' · ' + (t.access === 'seek' ? 'SEEK' : 'SCAN'), value: Math.max(1, t.read / t.rows * 100), text: UI.fmtCompact(t.read) + ' / ' + UI.fmtCompact(t.rows) + ' rows', color: t.access === 'scan' && t.rows > 1e5 ? 'linear-gradient(90deg,var(--warn),var(--bad))' : '' };
      }), { max: 100 });
      var findings = r.findings.map(function (f) {
        return '<article class="finding ' + f.sev + '"><h3>' + sevBadge(f.sev) + '<span>' + esc(f.title) + '</span><span class="badge right">Impact: ' + f.impact + '</span></h3><p class="muted">' + esc(f.detail) + '</p>' + (f.fix ? copyBlock('Suggested fix', f.fix) : '') + '</article>';
      }).join('');
      var ddl = r.ddl.length ? r.ddl.map(function (d) { return '<div class="stack">' + copyBlock(d.title, d.sql) + '</div>'; }).join('<div style="height:12px"></div>') : '<p class="muted">No table-structure recommendations for this statement.</p>';
      var rw = r.rewrite, rwHtml =
        (rw.changed ? '<div class="diff"><div>' + copyBlock('Original', lastSql.trim()) + '</div><div>' + copyBlock('Optimised rewrite', rw.sql) + '</div></div><ul class="stack" style="margin-top:12px">' + rw.changes.map(function (c) { return '<li class="row nowrap">' + I.get('check', 16) + '<span>' + esc(c) + '</span></li>'; }).join('') + '</ul><div class="row" style="margin-top:12px"><button class="btn btn-primary" type="button" data-act="apply-rw">' + I.get('sparkle', 18) + ' Apply rewrite to editor</button></div>' : '<p class="muted">No safe automatic rewrite applies — see the manual recommendations.</p>') +
        (rw.manual.length ? '<h3 style="margin-top:16px">Manual follow-ups</h3><ul class="stack" style="margin-top:8px">' + rw.manual.map(function (c) { return '<li class="row nowrap">' + I.get('alert', 16) + '<span>' + esc(c) + '</span></li>'; }).join('') + '</ul>' : '');

      results.innerHTML =
        UI.card({ span: 'c-4', title: 'Optimisation score', icon: 'gauge', body: UI.gauge(r.score, { sub: r.grade }) + '<p class="muted" style="text-align:center;margin-top:8px">' + (gain > 0 ? 'Estimated <b style="color:var(--ok)">' + gain + '% faster</b> after fixes (≈ ' + UI.fmtMs(m.projectedMs) + ').' : 'Already near the modelled optimum.') + '</p>' }) +
        UI.card({ span: 'c-8', title: 'Performance metrics (simulated)', icon: 'cpu', right: '<button class="btn right" type="button" data-act="report">' + I.get('download', 18) + ' Export report</button>', body: metrics }) +
        UI.card({ span: 'c-5', title: 'Index seek vs. table scan', icon: 'database', body: access + '<p class="muted" style="margin-top:12px;font-size:.85rem">Bars show the share of each table the engine must read. Long red bars mean scans on large history tables.</p>' }) +
        UI.card({ span: 'c-7', title: 'Estimated execution plan', icon: 'layers', body: UI.planTree(r.plan) }) +
        UI.card({ span: 'c-7', title: 'AI-assisted recommendations (' + r.findings.length + ')', icon: 'sparkle', body: '<div class="stack">' + findings + '</div>' }) +
        UI.card({ span: 'c-5', title: 'Table design for tag history', icon: 'database', body: ddl + '<p class="muted" style="margin-top:12px;font-size:.82rem">Apply on archive/reporting copies — never alter vendor-managed historian objects.</p>' }) +
        UI.card({ span: 'c-12', title: 'Safe rewrite', icon: 'refresh', body: rwHtml });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function reportMd(r) {
      var m = r.metrics, o = ['# SQL-Optima report', '', '_Simulated estimates — verify with the real execution plan._', '', '- Dialect: ' + r.dialect, '- Score: **' + r.score + '/100** (' + r.grade + ')', '- Elapsed: ' + UI.fmtMs(m.elapsedMs) + ' · Projected after fixes: ' + UI.fmtMs(m.projectedMs), '- Logical reads: ' + UI.fmtCompact(m.logicalReads) + ' · Rows read: ' + UI.fmtCompact(m.rowsRead), '', '## Query', '```sql', lastSql.trim(), '```', '', '## Findings'];
      r.findings.forEach(function (f) { o.push('- **[' + f.sev.toUpperCase() + '] ' + f.title + '** — ' + f.detail); if (f.fix) o.push('  ```', '  ' + f.fix.split('\n').join('\n  '), '  ```'); });
      if (r.rewrite.changed) o.push('', '## Suggested rewrite', '```sql', r.rewrite.sql, '```');
      r.ddl.forEach(function (d) { o.push('', '## ' + d.title, '```sql', d.sql, '```'); });
      return o.join('\n');
    }

    el.addEventListener('change', function (e) { if (e.target.id === 'dialect') setDialect(e.target.value); });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'run') return run();
      if (b.dataset.act === 'save') return saveQuery(null);
      if (b.dataset.act === 'clear') { ed.setValue(''); saveDraft(); ed.focus(); return; }
      if (b.dataset.act === 'apply-rw' && lastRes) { ed.setValue(lastRes.rewrite.sql); saveDraft(); UI.toast('Rewrite applied — profile again to compare', 'ok'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (b.dataset.act === 'report' && lastRes) return UI.download('sql-optima-report.md', reportMd(lastRes), 'text/markdown');
      if (b.dataset.act === 'clear-hist') { if (await UI.confirm('Clear history', 'Delete all saved profiled queries from this device?', 'Delete', true)) { await DB.clear('queries'); refreshLib(); } return; }
      if (b.dataset.copy != null) return UI.copyText(copyStore[+b.dataset.copy]);
      if (b.dataset.tab) { libTab = b.dataset.tab; $$('[data-tab]', el).forEach(function (x) { x.setAttribute('aria-selected', x === b); }); return refreshLib(); }
      if (b.dataset.tpl) { var t = TEMPLATES.filter(function (x) { return x.id === b.dataset.tpl; })[0]; load(t.sql, t.dialect); UI.toast('Template loaded: ' + t.name, 'info'); return; }
      if (b.dataset.hist) { var q = await DB.get('queries', b.dataset.hist); if (q) { load(q.sql, q.dialect); UI.toast('Loaded from history', 'info'); } }
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
     VIEW: Script & Data Pipeline Workbench
     ===================================================================== */
  function lintScript(lang, code) {
    var out = [], lines = code.split('\n');
    function add(lv, line, msg, c) { out.push({ lv: lv, line: line, msg: msg, code: c }); }
    if (!code.trim()) { add('WARN', 0, 'Script is empty.'); return out; }
    if (lang === 'intouch') {
      var ifs = 0, fors = 0, whiles = 0, conn = /SQLConnect\s*\(/i.test(code), disc = /SQLDisconnect\s*\(/i.test(code), sel = /SQLSelect\s*\(/i.test(code), end = /SQLEnd\s*\(/i.test(code);
      lines.forEach(function (raw, i) {
        var l = raw.replace(/\{[^}]*\}/g, '').replace(/"[^"]*"/g, '""').trim(), u = l.toUpperCase(), n = i + 1; if (!l) return;
        if (/^IF\b/.test(u)) { ifs++; if (!/\bTHEN\b/.test(u)) add('ERROR', n, 'IF statement is missing THEN.'); }
        if (/^ELSEIF\b/.test(u) && !/\bTHEN\b/.test(u)) add('ERROR', n, 'ELSEIF statement is missing THEN.');
        if (/^ENDIF\b/.test(u)) ifs--;
        if (/^FOR\b/.test(u)) fors++; if (/^NEXT\b/.test(u)) fors--;
        if (/^WHILE\b/.test(u)) whiles++; if (/^ENDWHILE\b/.test(u)) whiles--;
        if (/^[\w.$]+\s*=/.test(l) && !/;\s*$/.test(l)) add('WARN', n, 'Statement should end with a semicolon.');
        if (/^[A-Za-z_]\w*\s*\(.*\)$/.test(l)) add('WARN', n, 'Function call should end with a semicolon.');
        if (/^SQL(Connect|Insert|Update|Delete|Select|CreateTable|ClearTable)\s*\(/i.test(l)) add('WARN', n, 'SQL function result is ignored — assign it and check for rc <> 0, then log SQLErrorMsg(rc).', 'sqlerrormsg');
        if (/PWD=[^"+\s]+/i.test(raw.replace(/\{[^}]*\}/g, ''))) add('ERROR', n, 'Hard-coded password in connection string — read it from a secured tag or vault.');
      });
      if (ifs !== 0) add('ERROR', 0, 'Unbalanced IF / ENDIF (' + (ifs > 0 ? ifs + ' unclosed' : -ifs + ' extra ENDIF') + ').');
      if (fors !== 0) add('ERROR', 0, 'Unbalanced FOR / NEXT.');
      if (whiles !== 0) add('ERROR', 0, 'Unbalanced WHILE / ENDWHILE.');
      if (conn && !disc) add('WARN', 0, 'SQLConnect without SQLDisconnect — connections will leak on the SQL server.');
      if (sel && !end) add('WARN', 0, 'SQLSelect without SQLEnd — statement handles will leak.');
    } else if (lang === 'csharp') {
      var br = 0, pa = 0;
      lines.forEach(function (l, i) {
        var n = i + 1, t = l.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/, '');
        br += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length; pa += (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
        if (/new\s+SqlConnection/.test(l) && !/using/.test(l)) add('WARN', n, 'SqlConnection is not created in a using block — it may leak under load.');
        if (/"\s*(select|insert|update|delete)\b[^"]*"\s*\+/i.test(l)) add('ERROR', n, 'SQL built by string concatenation — use SqlParameter to prevent injection and plan-cache bloat.');
        if (/select\s+\*/i.test(l)) add('WARN', n, 'SELECT * in a data-fetch utility — list only the required columns.');
        if (/\.Result\b|\.Wait\(\)/.test(l)) add('WARN', n, 'Blocking on a Task (.Result / .Wait()) can deadlock — use await.');
        if (/Thread\.Sleep/.test(l)) add('INFO', n, 'Thread.Sleep blocks a thread — prefer await Task.Delay.');
      });
      if (br !== 0) add('ERROR', 0, 'Unbalanced braces { } (' + br + ').'); if (pa !== 0) add('ERROR', 0, 'Unbalanced parentheses ( ) (' + pa + ').');
      if (/SqlCommand/.test(code) && !/CommandTimeout/.test(code)) add('INFO', 0, 'No CommandTimeout set — default is 30 s; set it explicitly for historian queries.');
    } else if (lang === 'bash') {
      if (!/^#!/.test(code)) add('WARN', 1, 'Missing shebang (#!/usr/bin/env bash).');
      if (!/set\s+-[a-z]*e/.test(code)) add('WARN', 0, 'Add "set -euo pipefail" so failures stop the job instead of producing partial reports.');
      lines.forEach(function (l, i) { if (/-P\s+['"]?[A-Za-z0-9!@#$%^&*]{4,}['"]?(\s|$)/.test(l) && !/-P\s+"?\$/.test(l)) add('ERROR', i + 1, 'Hard-coded password passed to sqlcmd — use an environment variable or secrets file.'); if (/sqlcmd/.test(l) && !/\s-b\b/.test(l + (lines[i + 1] || ''))) add('INFO', i + 1, 'sqlcmd without -b: SQL errors will not change the exit code.'); });
      var cm = code.match(/cron:\s*((?:\S+\s+){4}\S+)/);
      if (cm) { var f = cm[1].trim().split(/\s+/); if (!f.every(function (x) { return /^[\d*\/,\-a-zA-Z]+$/.test(x); })) add('ERROR', 0, 'Cron expression looks invalid: ' + cm[1]); }
      else add('INFO', 0, 'No "# cron: m h dom mon dow" comment found — document the schedule next to the script.');
    } else {
      lines.forEach(function (l, i) {
        var n = i + 1, t = l.replace(/--.*$/, '');
        if (/select\s+\*/i.test(t)) add('WARN', n, 'SELECT * — list the required columns.');
        if (/with\s*\(\s*nolock\s*\)/i.test(t)) add('INFO', n, 'NOLOCK allows dirty reads; acceptable for trends, not for alarm/event reports.');
      });
      if (/\b(update|delete)\b/i.test(code) && !/\bwhere\b/i.test(code)) add('ERROR', 0, 'UPDATE/DELETE without WHERE affects every row.');
      if (!/;\s*$/.test(code.trim())) add('INFO', 0, 'Statement is not terminated with a semicolon.');
    }
    if (!out.length) add('OK', 0, 'No issues found by the built-in linter.');
    return out;
  }

  async function viewWorkbench(el) {
    var scripts = (await DB.all('scripts')).sort(function (a, b) { return (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name); });
    if (!scripts.length) { scripts = SCRIPT_SEEDS.map(function (s, i) { return Object.assign({ created: i, updated: Date.now() }, s); }); for (var i = 0; i < scripts.length; i++) await DB.put('scripts', scripts[i]); }
    var cur = scripts[0], logs = [], timers = [], mounted = true;
    var LANG_EXT = { intouch: 'txt', csharp: 'cs', bash: 'sh', sql: 'sql' };

    el.innerHTML =
      '<div class="page-h"><div><h1>Script &amp; Pipeline Workbench</h1><p>Draft InTouch QuickScripts, C# data-fetch utilities, SQL jobs and cron reports. Everything autosaves to IndexedDB, so it works in the plant with no network.</p></div></div>' +
      '<div class="bento">' +
      UI.card({ span: 'c-3', title: 'Scripts', icon: 'file', right: '<button class="btn btn-primary right" type="button" data-act="new" aria-label="New script">' + I.get('plus', 18) + '</button>', body: '<div class="list scroll-y" id="scriptList" style="max-height:420px"></div>' }) +
      '<section class="card glass c-9"><div class="row" style="margin-bottom:12px"><label class="field grow" style="min-width:160px"><span>Name</span><input class="input" id="sName" type="text" maxlength="60"></label><label class="field field-inline"><span>Language</span><select class="select" id="sLang"><option value="intouch">InTouch QuickScript</option><option value="csharp">C# (.NET)</option><option value="sql">SQL</option><option value="bash">Shell / cron</option></select></label></div><div id="edMount"></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="lint">' + I.get('bug', 18) + ' Lint</button><button class="btn btn-primary" type="button" data-act="run">' + I.get('play', 18) + ' Run (simulated) <kbd>Ctrl ↵</kbd></button><button class="btn" type="button" data-act="save">' + I.get('save', 18) + ' Save</button><button class="btn" type="button" data-act="export">' + I.get('download', 18) + ' Export</button><button class="btn" type="button" data-act="to-profiler">' + I.get('gauge', 18) + ' Send to profiler</button><button class="btn btn-danger right" type="button" data-act="delete">' + I.get('trash', 18) + ' Delete</button></div></section>' +
      UI.card({ span: 'c-7', title: 'Debug console', icon: 'terminal', right: '<button class="btn btn-ghost right" type="button" data-act="clear-log">Clear</button>', body: '<div class="console" id="console" role="log" aria-live="polite"></div>' }) +
      UI.card({ span: 'c-5', title: 'Error code lookup', icon: 'search', body: '<label class="field"><span>Code or message (OPC UA, Modbus, SQL, ORA-, PG)</span><input class="input" id="errQ" type="search" placeholder="e.g. 1205, 0x800A0000, ORA-00060, Modbus 02" autocomplete="off"></label><div id="errOut" class="stack scroll-y" style="margin-top:12px;max-height:300px"></div><p class="muted" style="font-size:.8rem;margin-top:8px">Reference data bundled for offline use — confirm against vendor documentation.</p>' }) +
      '</div>';

    var saveT;
    var ed = UI.codeEditor({ value: cur.code, lang: cur.lang, label: 'Script editor', onChange: function () { cur.code = ed.getValue(); cur.updated = Date.now(); clearTimeout(saveT); saveT = setTimeout(persist, 600); }, onRun: runSim, onSave: function () { persist(true); } });
    $('#edMount', el).appendChild(ed.el);

    function persist(toast) { DB.put('scripts', cur); if (toast) UI.toast('Script saved', 'ok'); renderList(); }
    function renderList() {
      var box = $('#scriptList', el); if (!box) return;
      box.innerHTML = scripts.map(function (s) { return '<button class="list-item' + (s.id === cur.id ? ' active' : '') + '" type="button" data-sid="' + s.id + '"><span class="t">' + esc(s.name) + '</span><span class="badge">' + esc({ intouch: 'QS', csharp: 'C#', bash: 'SH', sql: 'SQL' }[s.lang]) + '</span></button>'; }).join('');
    }
    function select(s) { cur = s; $('#sName', el).value = s.name; $('#sLang', el).value = s.lang; ed.setLang(s.lang); ed.setValue(s.code); renderList(); }
    function log(lv, msg, code) {
      var t = new Date(), ts = t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0');
      var box = $('#console', el); if (!box) return;
      var row = document.createElement('div'); row.className = 'log ' + lv;
      row.innerHTML = '<time>' + ts + '</time><span class="lv">' + lv + '</span><span class="msg">' + esc(msg) + '</span>' + (code ? '<button class="btn btn-ghost" type="button" data-lookup="' + esc(code) + '">Look up</button>' : '');
      box.appendChild(row); box.scrollTop = box.scrollHeight;
    }
    function lint() {
      log('INFO', 'Linting ' + cur.name + ' (' + UI.LANGS[cur.lang].name + ')…');
      var res = lintScript(cur.lang, ed.getValue());
      res.forEach(function (r) { log(r.lv, (r.line ? 'Line ' + r.line + ': ' : '') + r.msg, r.code); });
      var errs = res.filter(function (r) { return r.lv === 'ERROR'; }).length, warns = res.filter(function (r) { return r.lv === 'WARN'; }).length;
      log(errs ? 'ERROR' : 'OK', 'Lint finished — ' + errs + ' error(s), ' + warns + ' warning(s).');
    }
    function runSim() {
      timers.forEach(clearTimeout); timers = [];
      var c = ed.getValue(), seed = c, steps = [];
      var hasDb = /sqlconnect|sqlconnection|sqlcmd|psql|sqlplus|invoke-sqlcmd|\bselect\b/i.test(c);
      steps.push(['INFO', 'Starting ' + cur.name + ' in sandbox — no real connections are opened.']);
      if (hasDb) { steps.push(['INFO', 'Connecting to historian (simulated)…']); steps.push(['OK', 'Connected in ' + rnd(seed + 'c', 9, 60) + ' ms']); }
      if (/opc/i.test(c)) { steps.push(['INFO', 'Reading 24 OPC UA nodes…']); steps.push(['WARN', 'Node read timed out: BadTimeout (0x800A0000) — retry 1/3', '0x800A0000']); steps.push(['OK', 'Retry succeeded after ' + rnd(seed + 'o', 220, 640) + ' ms']); }
      if (/begin\s+tran/i.test(c) && /\b(update|insert|delete)\b/i.test(c)) { steps.push(['ERROR', 'Transaction (Process ID 61) was deadlocked on lock resources and was chosen as the deadlock victim. (Msg 1205)', '1205']); steps.push(['INFO', 'Retrying with exponential back-off (250 ms)…']); steps.push(['OK', 'Retry committed.']); }
      if (/\bselect\b|sqlselect/i.test(c)) { var rows = rnd(seed + 'r', 120, 48000); steps.push(['INFO', 'Fetched ' + UI.fmtNum(rows) + ' rows in ' + rnd(seed + 'f', 14, 900) + ' ms']); }
      if (/\binsert\b|sqlinsert/i.test(c)) steps.push(['INFO', 'Inserted ' + rnd(seed + 'i', 1, 40) + ' row(s).']);
      if (cur.lang === 'bash') steps.push(['INFO', 'Report written to /var/reports (simulated).']);
      steps.push(['OK', 'Finished with exit code 0 in ' + rnd(seed + 't', 180, 2400) + ' ms (simulated).']);
      steps.forEach(function (s, i) { timers.push(setTimeout(function () { if (mounted) log(s[0], s[1], s[2]); }, i * 160)); });
    }
    function lookup(q) {
      var out = $('#errOut', el); if (!out) return; q = (q || '').trim().toLowerCase();
      if (!q) { out.innerHTML = '<p class="muted">Type an error code to see cause and fix.</p>'; return; }
      function match(e) {
        return e.k.concat([e.code.toLowerCase(), e.title.toLowerCase(), e.sys.toLowerCase()]).some(function (k) {
          if (k.length <= 3) return new RegExp('(^|[^\\w-])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])').test(q);
          return q.indexOf(k) > -1 || (q.length >= 3 && k.indexOf(q) > -1);
        });
      }
      var hits = ERRORS.filter(match);
      out.innerHTML = hits.length ? hits.map(function (e) { return '<article class="finding info"><h3><span class="badge sev-info">' + esc(e.sys) + '</span><span class="mono">' + esc(e.code) + '</span></h3><strong>' + esc(e.title) + '</strong><p class="muted"><b>Likely cause:</b> ' + esc(e.cause) + '</p><p><b>Fix:</b> ' + esc(e.fix) + '</p></article>'; }).join('') : '<p class="muted">No match in the offline reference. Try the numeric code or a keyword such as “timeout”.</p>';
    }

    $('#sName', el).value = cur.name; $('#sLang', el).value = cur.lang; renderList(); lookup('');
    log('INFO', 'Workbench ready. Use Lint to check a script, Run to simulate execution, or paste an error into the lookup.');

    el.addEventListener('input', function (e) {
      if (e.target.id === 'sName') { cur.name = e.target.value || 'Untitled'; clearTimeout(saveT); saveT = setTimeout(persist, 600); }
      if (e.target.id === 'errQ') lookup(e.target.value);
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'sLang') { cur.lang = e.target.value; ed.setLang(cur.lang); persist(); } });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.sid) { var s = scripts.filter(function (x) { return x.id === b.dataset.sid; })[0]; if (s) select(s); return; }
      if (b.dataset.lookup) { $('#errQ', el).value = b.dataset.lookup; lookup(b.dataset.lookup); $('#errQ', el).scrollIntoView({ block: 'nearest' }); return; }
      switch (b.dataset.act) {
        case 'new': { var n = { id: 's' + UI.uid(), name: 'NewScript', lang: 'sql', code: '-- New script\nSELECT 1;', created: Date.now(), updated: Date.now() }; scripts.push(n); await DB.put('scripts', n); select(n); UI.toast('New script created', 'ok'); ed.focus(); break; }
        case 'save': persist(true); break;
        case 'lint': lint(); break;
        case 'run': runSim(); break;
        case 'clear-log': $('#console', el).innerHTML = ''; break;
        case 'export': { var base = cur.name.replace(/[^\w.-]+/g, '_'); UI.download(/\.\w+$/.test(base) ? base : base + '.' + LANG_EXT[cur.lang], ed.getValue()); break; }
        case 'to-profiler': pending = null; DB.kvSet('draft:profiler', { sql: ed.getValue(), dialect: 'tsql' }).then(function () { go('profiler'); }); break;
        case 'delete': if (scripts.length < 2) { UI.toast('Keep at least one script', 'warn'); break; } if (await UI.confirm('Delete script', 'Delete “' + cur.name + '” from this device?', 'Delete', true)) { await DB.del('scripts', cur.id); scripts = scripts.filter(function (x) { return x.id !== cur.id; }); select(scripts[0]); } break;
      }
    });
    if (pending && pending.type === 'new-script') { pending = null; var nb = $('[data-act="new"]', el); nb && nb.click(); }
    return function () { mounted = false; timers.forEach(clearTimeout); clearTimeout(saveT); };
  }

  /* =====================================================================
     VIEW: BOM & project costing
     ===================================================================== */
  async function viewBom(el) {
    var saved = await DB.kvGet('bom', null);
    var bom = saved || { markup: 12, contingency: 8, tax: 0, project: 'SCADA historian optimisation', items: bomPreset(State.get('sector')) };
    var persist = UI.debounce(function () { DB.kvSet('bom', bom); }, 400);
    var CATS = ['Hardware', 'Licensing', 'Services'];

    el.innerHTML =
      '<div class="page-h"><div><h1>BOM &amp; Project Costing</h1><p>Cost a SCADA database integration: hardware, licences and engineering hours. Prices are illustrative placeholders — replace them with vendor quotes.</p></div></div>' +
      '<div class="bento">' +
      '<section class="card glass c-8"><div class="row" style="margin-bottom:12px"><label class="field grow" style="min-width:200px"><span>Project name</span><input class="input" id="pName" type="text" maxlength="80"></label><label class="field field-inline"><span>Preset</span><select class="select" id="pSector">' + SECTORS.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') + '</select></label><button class="btn" type="button" data-act="preset" style="align-self:flex-end">' + I.get('refresh', 18) + ' Load preset</button></div>' +
      '<div class="table-wrap"><table class="table" id="bomTable"><thead><tr><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line total</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody></tbody></table></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn btn-primary" type="button" data-act="add">' + I.get('plus', 18) + ' Add line</button><button class="btn" type="button" data-act="csv">' + I.get('download', 18) + ' Export CSV</button></div></section>' +
      '<section class="card glass c-4"><h2 class="card-t" style="margin-bottom:12px">' + I.get('calculator', 18) + '<span>Cost summary</span></h2><div class="stack">' +
      '<div class="row"><label class="field grow"><span>Markup %</span><input class="input" id="mk" type="number" min="0" max="200" step="0.5" inputmode="decimal"></label><label class="field grow"><span>Contingency %</span><input class="input" id="ct" type="number" min="0" max="100" step="0.5" inputmode="decimal"></label><label class="field grow"><span>Tax / VAT %</span><input class="input" id="tx" type="number" min="0" max="100" step="0.5" inputmode="decimal"></label></div>' +
      '<div class="table-wrap"><table class="table" style="min-width:0" id="sumTable"><tbody></tbody></table></div><div id="catBars"></div></div></section>' +
      '</div>';
    $('#pName', el).value = bom.project; $('#pSector', el).value = State.get('sector');
    $('#mk', el).value = bom.markup; $('#ct', el).value = bom.contingency; $('#tx', el).value = bom.tax;

    function drawRows() {
      $('#bomTable tbody', el).innerHTML = bom.items.map(function (it) {
        return '<tr data-id="' + it.id + '"><td style="min-width:240px"><input class="cell-input" data-f="d" value="' + esc(it.d) + '" aria-label="Item description"></td><td><select class="select" data-f="cat" aria-label="Category" style="min-width:120px">' + CATS.map(function (c) { return '<option' + (c === it.cat ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></td><td class="num"><input class="cell-input num" data-f="q" type="number" min="0" step="1" inputmode="decimal" value="' + it.q + '" aria-label="Quantity"></td><td class="num"><input class="cell-input num" data-f="u" type="number" min="0" step="0.01" inputmode="decimal" value="' + it.u + '" aria-label="Unit cost"></td><td class="num line">' + money(it.q * it.u) + '</td><td><button class="btn btn-ghost btn-icon" type="button" data-del="' + it.id + '" aria-label="Remove line">' + I.get('trash', 18) + '</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No lines — add one or load a preset.</td></tr>';
    }
    function calc() {
      var by = {}, sub = 0; CATS.forEach(function (c) { by[c] = 0; });
      bom.items.forEach(function (it) { var t = (+it.q || 0) * (+it.u || 0); by[it.cat] = (by[it.cat] || 0) + t; sub += t; });
      var mk = sub * (+bom.markup || 0) / 100, ct = (sub + mk) * (+bom.contingency || 0) / 100, pre = sub + mk + ct, tx = pre * (+bom.tax || 0) / 100, total = pre + tx;
      $('#sumTable tbody', el).innerHTML = [['Subtotal', sub], ['Markup (' + (+bom.markup || 0) + '%)', mk], ['Contingency (' + (+bom.contingency || 0) + '%)', ct], ['Tax (' + (+bom.tax || 0) + '%)', tx]].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + money(r[1]) + '</td></tr>'; }).join('') + '<tr><td><strong>Grand total (' + esc(State.get('currency')) + ')</strong></td><td class="num" style="font-size:1.15rem;font-weight:800;color:var(--accent)">' + money(total) + '</td></tr>';
      $('#catBars', el).innerHTML = UI.barList(CATS.map(function (c) { return { label: c, value: by[c], text: money(by[c]) }; }), { max: Math.max(sub, 1) });
      $$('#bomTable tbody tr', el).forEach(function (tr) { var it = bom.items.filter(function (x) { return x.id === tr.dataset.id; })[0], ln = $('.line', tr); if (it && ln) ln.textContent = money((+it.q || 0) * (+it.u || 0)); });
    }
    el.addEventListener('input', function (e) {
      var t = e.target, tr = t.closest('tr[data-id]');
      if (tr && t.dataset.f) { var it = bom.items.filter(function (x) { return x.id === tr.dataset.id; })[0]; it[t.dataset.f] = (t.dataset.f === 'q' || t.dataset.f === 'u') ? parseFloat(t.value) || 0 : t.value; }
      else if (t.id === 'mk') bom.markup = parseFloat(t.value) || 0; else if (t.id === 'ct') bom.contingency = parseFloat(t.value) || 0; else if (t.id === 'tx') bom.tax = parseFloat(t.value) || 0; else if (t.id === 'pName') bom.project = t.value; else return;
      calc(); persist();
    });
    el.addEventListener('change', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr && e.target.dataset.f === 'cat') { bom.items.filter(function (x) { return x.id === tr.dataset.id; })[0].cat = e.target.value; calc(); persist(); } });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.del) { bom.items = bom.items.filter(function (x) { return x.id !== b.dataset.del; }); drawRows(); calc(); persist(); return; }
      if (b.dataset.act === 'add') { bom.items.push({ id: UI.uid(), d: 'New item', cat: 'Services', q: 1, u: 0 }); drawRows(); calc(); persist(); var rows = $$('#bomTable tbody tr', el); var last = rows[rows.length - 1]; if (last) $('input', last).select(); return; }
      if (b.dataset.act === 'preset') { var sec = $('#pSector', el).value; if (await UI.confirm('Load preset', 'Replace the current lines with the ' + SECTORS.filter(function (s) { return s.id === sec; })[0].name + ' preset?', 'Replace', true)) { bom.items = bomPreset(sec); State.set('sector', sec); renderSectorChip(); drawRows(); calc(); persist(); } return; }
      if (b.dataset.act === 'csv') {
        var rows2 = [['Item', 'Category', 'Qty', 'Unit cost', 'Line total']].concat(bom.items.map(function (it) { return [it.d, it.cat, it.q, it.u, (it.q * it.u).toFixed(2)]; }));
        UI.download((bom.project || 'bom').replace(/[^\w-]+/g, '_') + '_bom.csv', rows2.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'), 'text/csv');
      }
    });
    drawRows(); calc();
  }

  /* =====================================================================
     VIEW: QHSE compliance checklist
     ===================================================================== */
  async function viewQhse(el) {
    var st = await DB.kvGet('qhse', { done: {} });
    var sector = State.get('sector'), sec = sectorObj();
    var groups = QHSE_BASE.map(function (g) { return { g: g.g, items: g.items.slice() }; });
    (QHSE_EXTRA[sector] || []).forEach(function (x) { groups.filter(function (g) { return g.g === x[0]; })[0].items.push(x[1]); });
    var persist = UI.debounce(function () { DB.kvSet('qhse', st); }, 300);
    function id(g, t) { return g + ':' + djb(t); }
    function totals() { var tot = 0, done = 0; groups.forEach(function (g) { g.items.forEach(function (t) { tot++; if (st.done[id(g.g, t)]) done++; }); }); return { tot: tot, done: done }; }
    function draw() {
      var T = totals(), pct = T.tot ? T.done / T.tot * 100 : 0;
      el.innerHTML =
        '<div class="page-h"><div><h1>QHSE Compliance</h1><p>Quality, Health, Safety &amp; Environment gates for SCADA database changes — tailored to <b>' + esc(sec.name) + '</b>. A working aid, not a substitute for your management system.</p></div><div class="row right"><button class="btn" type="button" data-act="export">' + I.get('download', 18) + ' Export</button><button class="btn btn-danger" type="button" data-act="reset">' + I.get('refresh', 18) + ' Reset</button></div></div>' +
        '<div class="bento">' + UI.card({ span: 'c-12', cls: 'hero', body: '<div class="row">' + UI.ring(pct) + '<div class="grow"><strong style="font-size:1.1rem">' + T.done + ' of ' + T.tot + ' controls verified</strong><div class="bar" style="margin-top:8px"><span style="width:' + pct + '%"></span></div></div><span class="badge ' + (pct === 100 ? 'sev-ok' : 'sev-warning') + '">' + (pct === 100 ? 'Ready for sign-off' : 'Open items remain') + '</span></div>' }) +
        groups.map(function (g) {
          var d = g.items.filter(function (t) { return st.done[id(g.g, t)]; }).length;
          return UI.card({ span: 'c-6', body: '<div class="qhse-h">' + UI.ring(d / g.items.length * 100) + '<h2>' + g.g + '</h2><span class="muted right">' + d + '/' + g.items.length + '</span></div><div class="qhse-group">' + g.items.map(function (t) { var k = id(g.g, t); return '<label class="check"><input type="checkbox" data-k="' + k + '"' + (st.done[k] ? ' checked' : '') + '><span>' + esc(t) + '</span></label>'; }).join('') + '</div>' });
        }).join('') + '</div>';
    }
    draw();
    el.addEventListener('change', function (e) {
      var k = e.target.dataset.k; if (!k) return;
      var y = window.scrollY; if (e.target.checked) st.done[k] = true; else delete st.done[k]; persist(); draw(); window.scrollTo(0, y);
      var cb = $('[data-k="' + k + '"]', el); if (cb) cb.focus();
    });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'reset' && await UI.confirm('Reset checklist', 'Clear all checkmarks on this device?', 'Reset', true)) { st = { done: {} }; persist(); draw(); }
      if (b.dataset.act === 'export') {
        var o = ['# QHSE checklist — ' + sec.name, '_Generated ' + new Date().toISOString().slice(0, 10) + '_', ''];
        groups.forEach(function (g) { o.push('## ' + g.g); g.items.forEach(function (t) { o.push('- [' + (st.done[id(g.g, t)] ? 'x' : ' ') + '] ' + t); }); o.push(''); });
        UI.download('qhse-checklist.md', o.join('\n'), 'text/markdown');
      }
    });
  }

  /* =====================================================================
     VIEW: Settings
     ===================================================================== */
  async function viewSettings(el) {
    function html() {
      var cur = State.get('theme');
      return '<div class="page-h"><div><h1>Settings</h1><p>Appearance, defaults, offline data and app installation.</p></div></div><div class="bento">' +
        UI.card({ span: 'c-8', title: 'Theme', icon: 'palette', body: '<div class="theme-grid">' + THEMES.map(function (t) { return '<button class="theme-opt" type="button" data-theme="' + t.id + '" aria-pressed="' + (t.id === cur) + '"><div class="swatch">' + t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</div><strong>' + t.name + '</strong></button>'; }).join('') + '</div>' }) +
        UI.card({ span: 'c-4', title: 'Defaults', icon: 'sliders', body: '<div class="stack"><label class="field"><span>Industry sector</span><select class="select" id="setSector">' + SECTORS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === State.get('sector') ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label><label class="field"><span>Currency (BOM display)</span><select class="select" id="setCur">' + Object.keys(CURRENCIES).map(function (c) { return '<option' + (c === State.get('currency') ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label></div>' }) +
        UI.card({ span: 'c-6', title: 'Offline data', icon: 'database', body: '<p class="muted">Queries, scripts, BOM and QHSE progress live in this browser’s IndexedDB. Back them up before clearing site data.</p><div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="export">' + I.get('download', 18) + ' Export backup</button><button class="btn" type="button" data-act="import">' + I.get('upload', 18) + ' Import backup</button><button class="btn btn-danger" type="button" data-act="wipe">' + I.get('trash', 18) + ' Erase all data</button></div><input type="file" id="importFile" accept="application/json,.json" class="hide">' }) +
        UI.card({ span: 'c-6', title: 'App & offline status', icon: 'wifi', body: '<div class="stack"><div id="swInfo" class="muted">Checking service worker…</div><div class="row"><button class="btn btn-primary" type="button" data-act="install">' + I.get('download', 18) + ' Install app</button><button class="btn" type="button" data-act="update">' + I.get('refresh', 18) + ' Check for updates</button><button class="btn" type="button" data-act="clear-cache">Clear offline cache</button></div></div>' }) +
        UI.card({ span: 'c-6', title: 'Keyboard shortcuts', icon: 'command', body: '<ul class="stack">' + [['Ctrl / ⌘ + K', 'Command palette'], ['Ctrl / ⌘ + Enter', 'Run profiler / simulate script'], ['Ctrl / ⌘ + S', 'Save script'], ['Esc', 'Close dialogs and menus'], ['Tab', 'Indent inside editors']].map(function (r) { return '<li class="row"><kbd>' + r[0] + '</kbd><span class="muted">' + r[1] + '</span></li>'; }).join('') + '</ul>' }) +
        UI.card({ span: 'c-6', title: 'About', icon: 'info', body: '<p><b>SQL-Optima Studio</b> v' + VERSION + '</p><p class="muted" style="margin-top:8px">All profiling is a heuristic <b>simulation</b> based on typical historian table sizes — it never connects to a database. Wonderware/AVEVA, InTouch and other product names are trademarks of their owners; this project is independent and not affiliated with them.</p>' })
        + '</div>';
    }
    el.innerHTML = html();
    function swInfo() {
      var box = $('#swInfo', el); if (!box) return;
      if (!('serviceWorker' in navigator)) { box.textContent = 'Service workers are not supported in this browser — offline mode unavailable.'; return; }
      navigator.serviceWorker.getRegistration().then(function (r) { if (!box.isConnected) return; box.innerHTML = r ? '<span class="dot"></span> Service worker ' + (navigator.serviceWorker.controller ? '<b>active</b> — app shell is cached for offline use.' : 'registered — reload once to take control.') + '<br>Network: <b>' + (navigator.onLine ? 'online' : 'offline') + '</b> · Version ' + VERSION : '<span class="dot warn"></span> Not registered (serve over HTTPS or localhost).'; });
    }
    swInfo();
    el.addEventListener('change', function (e) {
      if (e.target.id === 'setSector') { State.set('sector', e.target.value); renderSectorChip(); }
      if (e.target.id === 'setCur') State.set('currency', e.target.value);
      if (e.target.id === 'importFile' && e.target.files[0]) importBackup(e.target.files[0]);
    });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.theme) { applyTheme(b.dataset.theme); $$('[data-theme]', el).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); return; }
      switch (b.dataset.act) {
        case 'export': exportBackup(); break;
        case 'import': $('#importFile', el).click(); break;
        case 'wipe': if (await UI.confirm('Erase all data', 'This permanently deletes saved queries, scripts, BOM and checklist progress from this device.', 'Erase everything', true)) { await Promise.all([DB.clear('queries'), DB.clear('scripts'), DB.clear('kv')]); try { localStorage.removeItem('sqlopt.state'); Object.keys(localStorage).filter(function (k) { return k.indexOf('sqlopt.') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (x) { } location.hash = '#/dashboard'; location.reload(); } break;
        case 'install': installApp(); break;
        case 'update': checkUpdate(true); break;
        case 'clear-cache': if (window.caches) { var ks = await caches.keys(); await Promise.all(ks.map(function (k) { return caches.delete(k); })); UI.toast('Offline cache cleared — reload while online to rebuild it', 'ok'); } break;
      }
    });
  }

  async function exportBackup() {
    var data = { app: 'sql-optima-studio', version: VERSION, exportedAt: new Date().toISOString(), state: State.all(), queries: await DB.all('queries'), scripts: await DB.all('scripts'), kv: await DB.all('kv') };
    UI.download('sql-optima-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2), 'application/json');
    UI.toast('Backup downloaded', 'ok');
  }
  function importBackup(file) {
    var fr = new FileReader();
    fr.onload = async function () {
      try {
        var d = JSON.parse(fr.result);
        if (d.app !== 'sql-optima-studio') throw new Error('Not a SQL-Optima backup file');
        if (!(await UI.confirm('Import backup', 'Merge ' + (d.queries || []).length + ' queries and ' + (d.scripts || []).length + ' scripts into this device? Existing items with the same ID are overwritten.', 'Import'))) return;
        for (var q of (d.queries || [])) if (q && q.id) await DB.put('queries', q);
        for (var s of (d.scripts || [])) if (s && s.id) await DB.put('scripts', s);
        for (var k of (d.kv || [])) if (k && k.key) await DB.put('kv', k);
        UI.toast('Backup imported', 'ok'); router();
      } catch (err) { UI.toast('Import failed: ' + err.message, 'error'); }
    };
    fr.readAsText(file);
  }

  /* =====================================================================
     Shell: theme, nav, breadcrumbs, footer, palette, router
     ===================================================================== */
  var ROUTES = {
    dashboard: { title: 'Dashboard', icon: 'home', sec: 'Studio', render: viewDashboard },
    profiler: { title: 'Query Profiler', icon: 'gauge', sec: 'Studio', render: viewProfiler },
    workbench: { title: 'Script Workbench', icon: 'terminal', sec: 'Studio', render: viewWorkbench },
    bom: { title: 'BOM & Costing', icon: 'calculator', sec: 'Project', render: viewBom },
    qhse: { title: 'QHSE Checklist', icon: 'shield', sec: 'Project', render: viewQhse },
    settings: { title: 'Settings', icon: 'sliders', sec: 'System', render: viewSettings }
  };
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var appEl = $('#app'), cleanup = null, navToken = 0;

  function applyTheme(id) {
    var t = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
    document.documentElement.setAttribute('data-theme', t.id); State.set('theme', t.id);
    var m = $('meta[name="theme-color"]'); if (m) m.setAttribute('content', t.color);
  }
  function renderSectorChip() { var c = $('#sectorChip'); if (c) c.innerHTML = 'Industry profile<b>' + esc(sectorObj().name) + '</b>'; }
  function renderNav() {
    var html = '', last = '';
    Object.keys(ROUTES).forEach(function (k) {
      var r = ROUTES[k]; if (r.sec !== last) { html += '<div class="nav-sec">' + r.sec + '</div>'; last = r.sec; }
      html += '<a class="nav-item" href="#/' + k + '" data-route="' + k + '" title="' + esc(r.title) + '">' + I.get(r.icon, 20) + '<span class="nav-label">' + esc(r.title) + '</span></a>';
    });
    $('#nav').innerHTML = html;
  }
  function setCollapsed(c) {
    appEl.classList.toggle('collapsed', c); State.set('collapsed', c);
    var b = $('#collapseBtn'); b.innerHTML = I.get(c ? 'chevR' : 'chevL', 20) + '<span class="collapse-label">Collapse</span>'; b.setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar'); b.setAttribute('aria-expanded', String(!c));
  }
  function openNav(o) { appEl.classList.toggle('nav-open', o); $('#menuBtn').setAttribute('aria-expanded', String(o)); }

  function renderFooter() {
    $('#footer').innerHTML =
      '<div class="footer-in"><div class="footer-brand">' + I.logo(32) + '<span>© ' + new Date().getFullYear() + ' <b>SQL-Optima Studio</b> · v' + VERSION + '<br>Industrial query tuning for SCADA &amp; control-room engineers.</span></div>' +
      '<div class="status-row" role="status" aria-label="System status"><span class="status-chip" title="Simulated database latency"><span class="dot" id="dbDot"></span>DB latency <b id="dbLat">— ms</b></span><span class="status-chip" title="Service worker and network state"><span class="dot" id="syncDot"></span>PWA sync <b id="syncTxt">…</b></span></div>' +
      '<div class="socials" aria-label="Social links">' + UI.socialBar() + '</div>' +
      '<p class="fine">Estimates are simulated and for engineering guidance only — validate every change in a staging environment and follow your site’s management-of-change process. Product names are trademarks of their respective owners.</p></div>';
  }
  var lat = 14;
  function tickLatency() {
    lat = Math.max(4, Math.min(95, lat + (Math.random() - .5) * 9 + (Math.random() < .04 ? 30 : 0)));
    var v = $('#dbLat'), d = $('#dbDot'); if (!v) return;
    v.textContent = Math.round(lat) + ' ms'; d.className = 'dot' + (lat > 60 ? ' bad' : lat > 35 ? ' warn' : '');
  }
  function refreshSync() {
    var t = $('#syncTxt'), d = $('#syncDot'); if (!t) return;
    var on = navigator.onLine, ctl = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    t.textContent = !on ? 'Offline · cached' : ctl ? 'Synced' : 'Caching…'; d.className = 'dot' + (!on ? ' warn' : ctl ? '' : ' warn pulse');
  }

  function setCrumbs(name) {
    var r = ROUTES[name];
    $('#crumbs').innerHTML = '<a class="crumb-root" href="#/dashboard" style="color:inherit;text-decoration:none">Studio</a><span class="sep" aria-hidden="true">/</span><b aria-current="page">' + esc(r.title) + '</b>';
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
      el.innerHTML = UI.card({ body: '<div class="empty">' + I.get('alert', 36) + '<strong>Something went wrong</strong><span>' + esc(err.message) + '</span><button class="btn btn-primary" type="button" onclick="location.reload()">Reload</button></div>' });
    }
    if (token === navToken) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
  }

  function paletteItems() {
    var items = Object.keys(ROUTES).map(function (k) { return { label: 'Go to ' + ROUTES[k].title, icon: ROUTES[k].icon, hint: 'Navigate', keywords: k, run: function () { go(k); } }; });
    items.push({ label: 'Profile current query', icon: 'play', hint: 'Ctrl ↵', keywords: 'run analyse execute', run: function () { pending = { type: 'run-profile' }; go('profiler'); } });
    TEMPLATES.forEach(function (t) { items.push({ label: 'Load template: ' + t.name, icon: 'file', hint: 'Profiler', keywords: 'template example sample', run: function () { pending = { type: 'template', arg: t.id }; go('profiler'); } }); });
    items.push({ label: 'New script', icon: 'plus', hint: 'Workbench', keywords: 'create intouch c# sql', run: function () { pending = { type: 'new-script' }; go('workbench'); } });
    items.push({ label: 'Look up error code', icon: 'search', hint: 'Workbench', keywords: 'opc modbus deadlock 1205 ora', run: function () { go('workbench'); setTimeout(function () { var i = $('#errQ'); i && i.focus(); }, 250); } });
    THEMES.forEach(function (t) { items.push({ label: 'Theme: ' + t.name, icon: 'palette', hint: 'Appearance', keywords: 'theme colour dark', run: function () { applyTheme(t.id); } }); });
    items.push({ label: 'Toggle sidebar', icon: 'panel', run: function () { setCollapsed(!appEl.classList.contains('collapsed')); } });
    items.push({ label: 'Export backup (JSON)', icon: 'download', hint: 'Data', keywords: 'save', run: exportBackup });
    items.push({ label: 'Install app', icon: 'download', hint: 'PWA', keywords: 'pwa home screen', run: installApp });
    items.push({ label: 'Check for updates', icon: 'refresh', hint: 'PWA', run: function () { checkUpdate(true); } });
    return items;
  }

  /* =====================================================================
     PWA lifecycle: service worker, update prompt, install
     ===================================================================== */
  var deferredPrompt = null, swReg = null, wantReload = false;
  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; }
  function updateInstallBtn() {
    var b = $('#installBtn'); if (!b) return;
    var show = !isStandalone() && (deferredPrompt || isIOS());
    b.classList.toggle('hide', !show); b.innerHTML = I.get('download', 18) + '<span class="hide-sm">Install</span>';
  }
  function installApp() {
    if (isStandalone()) return UI.toast('Already running as an installed app', 'info');
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function (c) { if (c.outcome === 'accepted') UI.toast('Installing…', 'ok'); deferredPrompt = null; updateInstallBtn(); }); return; }
    if (isIOS()) return UI.modal({ title: 'Install on iPhone / iPad', body: '<ol class="stack" style="list-style:decimal;padding-left:20px"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>', actions: [{ label: 'Got it', kind: 'primary' }] });
    UI.toast('Use your browser menu → “Install app” (Chrome/Edge) when available.', 'info', { ms: 6000 });
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state !== 'installed') return;
          if (navigator.serviceWorker.controller) UI.toast('A new version is ready.', 'info', { action: { label: 'Reload', onClick: function () { wantReload = true; nw.postMessage('SKIP_WAITING'); } } });
          else { UI.toast('Ready to work offline', 'ok'); refreshSync(); }
        });
      });
    }).catch(function () { var t = $('#syncTxt'); if (t) t.textContent = 'No SW'; });
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (wantReload) location.reload(); else refreshSync(); });
  }
  function checkUpdate(manual) {
    if (!swReg) { if (manual) UI.toast('Service worker not active in this context', 'warn'); return; }
    swReg.update().then(function () { if (manual) UI.toast('Checked — you are up to date unless a reload prompt appears.', 'info'); }).catch(function () { if (manual) UI.toast('Could not reach the server (offline?)', 'warn'); });
  }

  /* =====================================================================
     Boot
     ===================================================================== */
  function boot() {
    applyTheme(State.get('theme'));
    $('#brandLogo').innerHTML = I.logo(36);
    $('#searchIco').innerHTML = I.get('search', 20);
    $('#menuBtn').innerHTML = I.get('menu', 22);
    $('#themeBtn').innerHTML = I.get('palette', 20);
    $('#kbdHint').textContent = isMac ? '⌘ K' : 'Ctrl K';
    renderNav(); renderSectorChip(); renderFooter(); setCollapsed(!!State.get('collapsed')); updateInstallBtn();

    $('#collapseBtn').addEventListener('click', function () { setCollapsed(!appEl.classList.contains('collapsed')); });
    $('#menuBtn').addEventListener('click', function () { openNav(!appEl.classList.contains('nav-open')); });
    $('#scrimNav').addEventListener('click', function () { openNav(false); });
    $('#searchBtn').addEventListener('click', function () { UI.palette(paletteItems); });
    $('#installBtn').addEventListener('click', installApp);
    $('#themeBtn').addEventListener('click', function () { var i = THEMES.map(function (t) { return t.id; }).indexOf(State.get('theme')); var n = THEMES[(i + 1) % THEMES.length]; applyTheme(n.id); UI.toast('Theme: ' + n.name, 'info', { ms: 1800 }); });
    $('#nav').addEventListener('click', function (e) { if (e.target.closest('a')) openNav(false); });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (!$('.scrim')) UI.palette(paletteItems); }
      else if (e.key === 'Escape' && appEl.classList.contains('nav-open')) openNav(false);
    });
    window.addEventListener('hashchange', router);
    window.addEventListener('online', function () { refreshSync(); UI.toast('Back online', 'ok'); });
    window.addEventListener('offline', function () { refreshSync(); UI.toast('You are offline — saved queries and scripts remain available', 'warn', { ms: 5000 }); });
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; updateInstallBtn(); });
    window.addEventListener('appinstalled', function () { deferredPrompt = null; updateInstallBtn(); UI.toast('SQL-Optima installed', 'ok'); });

    tickLatency(); refreshSync(); setInterval(tickLatency, 2500);
    registerSW(); router();
  }
  boot();
})();
