/* SQL-Optima Studio — Query profiler engine
 * Runs inside a Web Worker (off the main thread). If Workers are unavailable the
 * same file is loaded as a normal script and exposes window.SQLProfiler.analyze().
 *
 * IMPORTANT: this is a *heuristic simulation* — it never connects to a database.
 * Row counts, timings and costs are modelled from the query text and typical
 * SCADA historian table sizes so engineers can reason about a query before they
 * run it against a real server. Always confirm with the real Actual Execution Plan.
 */
(function (root) {
  'use strict';

  var RETENTION_S = 2 * 365 * 86400; // assumed online retention: 2 years
  var TAG_UNIVERSE = 5e4;            // assumed tag count on a mid-size plant

  /* ---------- Known / typical SCADA historian tables ---------- */
  var TABLES = {
    history:         { rows: 2.4e9, kind: 'ts' },
    analoghistory:   { rows: 1.9e9, kind: 'ts' },
    discretehistory: { rows: 6.0e8, kind: 'ts' },
    stringhistory:   { rows: 4.0e7, kind: 'ts' },
    taghistory:      { rows: 3.0e9, kind: 'ts' },
    events:          { rows: 8.0e7, kind: 'ts' },
    alarmhistory:    { rows: 3.2e7, kind: 'ts' },
    alarmsummary:    { rows: 1.1e7, kind: 'ts' },
    live:            { rows: 5.0e4, kind: 'snap' },
    tag:             { rows: 5.0e4, kind: 'dim' },
    analogtag:       { rows: 3.5e4, kind: 'dim' },
    discretetag:     { rows: 1.5e4, kind: 'dim' }
  };

  var OPS = {
    tsql: { seek: 'Clustered Index Seek', scan: 'Clustered Index Scan', hash: 'Hash Match (Inner Join)', nested: 'Nested Loops (Inner Join)', merge: 'Merge Join (Inner Join)', sort: 'Sort', topsort: 'Sort (Top N Sort)', hashagg: 'Hash Match (Aggregate)', top: 'Top', root: 'SELECT' },
    plsql: { seek: 'INDEX RANGE SCAN', scan: 'TABLE ACCESS FULL', hash: 'HASH JOIN', nested: 'NESTED LOOPS', merge: 'MERGE JOIN', sort: 'SORT ORDER BY', topsort: 'SORT ORDER BY STOPKEY', hashagg: 'HASH GROUP BY', top: 'COUNT STOPKEY', root: 'SELECT STATEMENT' },
    timescale: { seek: 'Index Scan (chunk-excluded)', scan: 'Seq Scan (all chunks)', hash: 'Hash Join', nested: 'Nested Loop', merge: 'Merge Join', sort: 'Sort', topsort: 'Sort (top-N heapsort)', hashagg: 'HashAggregate', top: 'Limit', root: 'Result' }
  };
  var MEM_LABEL = { tsql: 'Memory grant', plsql: 'PGA / temp', timescale: 'work_mem' };

  /* ---------- helpers ---------- */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function jitter(seed, salt) { return 0.93 + (hash(seed + ':' + salt) / 4294967295) * 0.14; }
  function compact(n) { var a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(Math.round(n)); }
  function unitSec(u) {
    u = String(u).toLowerCase();
    if (/^(second|ss|s)$/.test(u)) return 1;
    if (/^(minute|mi|n)$/.test(u)) return 60;
    if (/^(hour|hh)$/.test(u)) return 3600;
    if (/^(day|dd|d)$/.test(u)) return 86400;
    if (/^(week|wk|ww)$/.test(u)) return 604800;
    if (/^(month|mm|m)$/.test(u)) return 2592000;
    if (/^(year|yy|yyyy)$/.test(u)) return 31536000;
    return 86400;
  }
  function parseWindow(q) {
    var m;
    if ((m = q.match(/dateadd\s*\(\s*(\w+)\s*,\s*-\s*(\d+)/))) return unitSec(m[1]) * +m[2];
    if ((m = q.match(/interval\s*'\s*(\d+)\s*(second|minute|hour|day|week|month)s?\s*'/))) return unitSec(m[2]) * +m[1];
    if ((m = q.match(/interval\s*'\s*(\d+)\s*'\s*(second|minute|hour|day)/))) return unitSec(m[2]) * +m[1];
    if ((m = q.match(/sysdate\s*-\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/))) return 86400 * (+m[1]) / (m[2] ? +m[2] : 1);
    if ((m = q.match(/between\s+'(\d{4}-\d{2}-\d{2})[^']*'\s+and\s+'(\d{4}-\d{2}-\d{2})/)) ||
        (m = q.match(/>=?\s*'(\d{4}-\d{2}-\d{2})[^']*'\s*and\s*[\w.\[\]]+\s*<=?\s*'(\d{4}-\d{2}-\d{2})/))) {
      var d = Math.abs(Date.parse(m[2]) - Date.parse(m[1])) / 1000;
      return d > 0 ? d : 86400;
    }
    return null;
  }
  function topN(q) {
    var m = q.match(/\btop\s*\(?\s*(\d+)/) || q.match(/\blimit\s+(\d+)/) || q.match(/\brownum\s*<=?\s*(\d+)/) || q.match(/\bfetch\s+first\s+(\d+)/);
    return m ? +m[1] : 0;
  }
  function tableInfo(raw) {
    var name = raw.replace(/[\[\]"`]/g, '').split('.').pop().toLowerCase();
    if (TABLES[name]) return TABLES[name];
    if (/hist|log|event|alarm|sample|reading|measure|archive|telemetry|trend|raw/.test(name)) return { rows: 4e8, kind: 'ts' };
    return { rows: 2.5e6, kind: 'generic' };
  }
  function extractTables(src) {
    var re = /\b(?:from|join)\s+([\[\]\w."#@]+)(?:\s+(?:as\s+)?(\w+))?/gi, out = [], m, seen = {};
    while ((m = re.exec(src))) {
      var n = m[1];
      if (/^(select|where|set|values|lateral)$/i.test(n)) continue;
      if (!seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push({ name: n }); }
    }
    return out;
  }

  /* ---------- cost model ---------- */
  function estimate(o) {
    // o: {read, pre, out, sortRows, hashJoins, width, par}
    var logical = Math.max(1, Math.round(o.read / 100));
    var physical = Math.round(logical * 0.07);
    var ioCost = 0.003125 + logical * 0.00074074;
    var sortCost = o.sortRows > 1 ? o.sortRows * Math.log2(o.sortRows) * 0.00012 / (o.topped ? 3 : 1) : 0;
    var hashCost = o.hashJoins * o.pre * 0.0002;
    var cpu = o.read * 0.00035 + sortCost + hashCost + 0.4;
    var elapsed = cpu / o.par + (physical * 0.08) / o.par + o.out * (o.width > 100 ? 0.0035 : 0.0018) + 1.2;
    var sortMB = o.sortRows > 1 ? (o.topped ? Math.min(o.sortRows, 5000) : o.sortRows) * o.width * 1.4 / 1048576 : 0;
    var hashMB = o.hashJoins * o.pre * o.width * 1.2 / 1048576;
    var mem = Math.min(64000, Math.max(1, Math.round(sortMB + hashMB)));
    return { logical: logical, physical: physical, ioCost: ioCost, cpu: cpu, elapsed: elapsed, mem: mem };
  }

  /* ---------- DDL generators ---------- */
  function monthBoundaries(n) {
    var d = new Date(), out = [];
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    for (var i = 0; i < n; i++) { out.push("'" + d.toISOString().slice(0, 10) + "'"); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
    return out;
  }
  function buildDdl(dialect, tname) {
    var arch = tname + '_archive', yr = new Date().getUTCFullYear();
    if (dialect === 'plsql') {
      var o = arch.toLowerCase();
      return [
        { title: 'Interval-partitioned archive table (daily)', sql:
          '-- Interval partitioning creates a new daily partition automatically.\n' +
          'CREATE TABLE ' + o + ' (\n  event_time TIMESTAMP(3) NOT NULL,\n  tag_name   VARCHAR2(256) NOT NULL,\n  tag_value  BINARY_DOUBLE,\n  quality    NUMBER(3)\n)\nPARTITION BY RANGE (event_time)\nINTERVAL (NUMTODSINTERVAL(1, \'DAY\'))\n(PARTITION p_init VALUES LESS THAN (TIMESTAMP \'' + yr + '-01-01 00:00:00\'));\n\n' +
          '-- Optional (needs the Advanced Compression option):\n-- ALTER TABLE ' + o + ' ROW STORE COMPRESS ADVANCED;' },
        { title: 'Local index for tag + time lookups', sql: 'CREATE INDEX ix_' + o + '_tag_time ON ' + o + ' (tag_name, event_time) LOCAL;' }
      ];
    }
    if (dialect === 'timescale') {
      var t = arch.toLowerCase();
      return [
        { title: 'Hypertable + compression (adjust to your TimescaleDB version)', sql:
          'CREATE TABLE ' + t + ' (\n  ts        timestamptz NOT NULL,\n  tag_name  text        NOT NULL,\n  value     double precision,\n  quality   smallint\n);\nSELECT create_hypertable(\'' + t + '\', \'ts\', chunk_time_interval => INTERVAL \'1 day\');\n\nALTER TABLE ' + t + ' SET (\n  timescaledb.compress,\n  timescaledb.compress_segmentby = \'tag_name\',\n  timescaledb.compress_orderby   = \'ts DESC\'\n);\nSELECT add_compression_policy(\'' + t + '\', INTERVAL \'7 days\');' },
        { title: 'Continuous aggregate for trend screens (5-minute)', sql:
          'CREATE MATERIALIZED VIEW ' + t + '_5min WITH (timescaledb.continuous) AS\nSELECT time_bucket(\'5 minutes\', ts) AS bucket, tag_name,\n       avg(value) AS avg_v, min(value) AS min_v, max(value) AS max_v\nFROM ' + t + '\nGROUP BY bucket, tag_name;\n\nSELECT add_continuous_aggregate_policy(\'' + t + '_5min\',\n  start_offset => INTERVAL \'1 hour\', end_offset => INTERVAL \'5 minutes\',\n  schedule_interval => INTERVAL \'5 minutes\');' }
      ];
    }
    var b = monthBoundaries(12).join(', ');
    return [
      { title: 'Monthly partitioned archive table + clustered columnstore', sql:
        '-- Apply to a reporting/archive copy. Do NOT alter vendor-managed historian objects.\n' +
        'CREATE PARTITION FUNCTION pf_' + tname + '_month (datetime2(3))\n  AS RANGE RIGHT FOR VALUES (' + b + ');\n' +
        'CREATE PARTITION SCHEME ps_' + tname + '_month\n  AS PARTITION pf_' + tname + '_month ALL TO ([PRIMARY]);\n\n' +
        'CREATE TABLE dbo.' + arch + ' (\n  [DateTime] datetime2(3)  NOT NULL,\n  TagName    nvarchar(256) NOT NULL,\n  [Value]    float         NULL,\n  Quality    tinyint       NULL\n) ON ps_' + tname + '_month([DateTime]);\n\n' +
        'CREATE CLUSTERED COLUMNSTORE INDEX cci_' + arch + ' ON dbo.' + arch + ';' },
      { title: 'Covering rowstore index (use instead of columnstore for point lookups)', sql:
        'CREATE NONCLUSTERED INDEX IX_' + arch + '_Tag_Time\n  ON dbo.' + arch + ' (TagName, [DateTime])\n  INCLUDE ([Value], Quality)\n  WITH (DATA_COMPRESSION = PAGE, ONLINE = ON);' }
    ];
  }

  /* ---------- main analysis ---------- */
  function analyze(sqlRaw, dialect) {
    dialect = OPS[dialect] ? dialect : 'tsql';
    var src = String(sqlRaw || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
    if (!src.trim()) throw new Error('Query is empty — paste or write a SQL statement to profile.');
    var q = src.toLowerCase().replace(/[\[\]]/g, ''); // bracket-quoted identifiers → plain
    if (!/\b(select|with|insert|update|delete|merge)\b/.test(q)) throw new Error('No SQL statement detected (expected SELECT / WITH / INSERT / UPDATE / DELETE / MERGE).');
    var ops = OPS[dialect];

    var wm = q.match(/\bwhere\b([\s\S]*?)(?=\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\boption\b|\blimit\b|\bfetch\b|;|$)/);
    var where = wm ? wm[1] : '';
    var timeRe = '(?:datetime|timestamp|timestamputc|eventtime|event_time|alarmtime|alarm_time|logtime|log_time|sample_time|ts|ts_utc|time|recorded_at|created_at)';
    var f = {
      selectStar: /\bselect\s+(?:distinct\s+)?(?:top\s*\(?\s*\d+\s*\)?\s+)?(?:[\w\[\]]+\.)?\*/.test(q),
      hasWhere: where.trim().length > 0,
      groupBy: /\bgroup\s+by\b/.test(q),
      orderBy: /\border\s+by\b/.test(q),
      distinct: /\bselect\s+distinct\b/.test(q),
      cursor: /\bdeclare\s+\w+\s+cursor\b|\bfetch\s+next\b/.test(q),
      nolock: /with\s*\(\s*nolock\s*\)/.test(q),
      leadingWildcard: /\blike\s+n?'%/.test(where),
      subIn: /\bin\s*\(\s*select\b/.test(q),
      orCount: (where.match(/\bor\b/g) || []).length,
      crossJoin: /\bcross\s+join\b/.test(q),
      joins: (q.match(/\bjoin\b/g) || []).length,
      top: topN(q)
    };
    f.wrapped = new RegExp('\\b(?:convert|cast|year|month|day|datepart|datediff|format|isnull|coalesce|date_trunc|trunc|to_char|extract|substring|left|right|upper|lower|str|date)\\s*\\([^()]*?\\b' + timeRe + '\\b', 'i').test(where);
    f.timeFilter = new RegExp('\\b' + timeRe + '\\b\\s*(?:>=|>|<=|<|=|between\\b)', 'i').test(where);

    var tagN = 0, mt;
    if ((mt = where.match(/\b(?:tagname|tag_name|tag|pointname|point_name|tag_id)\s+in\s*\(([^)]*)\)/))) tagN = mt[1].split(',').length;
    else if (/\b(?:tagname|tag_name|tag|pointname|tag_id)\s*=\s*['\d@:]/.test(where)) tagN = 1;
    else if (/\b(?:tagname|tag_name|tag)\s+like\s+n?'[^%_]/.test(where)) tagN = 250;
    f.tagN = tagN;

    var parsedWindow = parseWindow(q);
    var windowAssumed = f.timeFilter && !parsedWindow;
    var winS = parsedWindow || (f.timeFilter ? 86400 : RETENTION_S);

    /* tables */
    var tabs = extractTables(src).map(function (t) {
      var info = tableInfo(t.name);
      return { name: t.name, rows: info.rows, kind: info.kind };
    });
    if (!tabs.length) tabs = [{ name: '(no table)', rows: 1, kind: 'dim' }];
    var keyed = /[\w\]]\s*(?:=|in\s*\()\s*(?:'|\d|@|:)/.test(where);
    tabs.forEach(function (t) {
      if (t.kind === 'ts') {
        if (f.timeFilter) {
          var frac = Math.min(1, Math.max(1e-7, winS / RETENTION_S));
          var tf = f.tagN ? Math.min(1, Math.max(f.tagN / TAG_UNIVERSE, 2e-5)) : 1;
          t.read = Math.max(1, Math.round(t.rows * frac * tf)); t.access = 'seek';
        } else { t.read = t.rows; t.access = 'scan'; }
      } else if (f.hasWhere && keyed && t.rows > 1000) { t.read = Math.max(1, Math.round(t.rows * 0.002)); t.access = 'seek'; }
      else { t.read = t.rows; t.access = 'scan'; }
    });
    var fact = tabs.filter(function (t) { return t.kind === 'ts'; })[0] || tabs[0];
    var totalRead = tabs.reduce(function (s, t) { return s + t.read; }, 0);
    var totalRows = tabs.reduce(function (s, t) { return s + t.rows; }, 0);

    /* cardinalities */
    var extraSel = 1;
    if (/\b(?:value|vvalue|val)\s*(?:>|<|>=|<=)/.test(where)) extraSel *= 0.25;
    if (/quality(?:detail)?\s*(?:=|<>|!=|>)/.test(where)) extraSel *= 0.9;
    var pre = Math.max(1, Math.round(fact.read * extraSel));
    var out = pre;
    if (f.groupBy) out = Math.max(1, Math.min(pre, Math.round(Math.max(24, pre * 0.0005))));
    if (f.distinct && !f.groupBy) out = Math.max(1, Math.round(out * 0.2));
    if (f.top) out = Math.min(out, f.top);
    var sortRows = f.orderBy ? (f.groupBy ? out : pre) : 0;
    var hashJoins = tabs.filter(function (t) { return t.read > 1e5; }).length > 1 ? f.joins : 0;
    var width = f.selectStar ? 160 : 80;
    var par = totalRead > 2e6 ? 4 : 1;
    var seed = src;

    var act = estimate({ read: totalRead, pre: pre, out: out, sortRows: sortRows, hashJoins: hashJoins, width: width, par: par, topped: !!f.top });
    var elapsedMs = act.elapsed * jitter(seed, 'e'), cpuMs = act.cpu * jitter(seed, 'c');

    /* projected (after recommended fixes) */
    var pTabs = tabs.map(function (t) {
      if (t.kind === 'ts' && t.access === 'scan') return Math.max(1, Math.round(t.rows * (3600 / RETENTION_S) * (f.tagN ? Math.min(1, Math.max(f.tagN / TAG_UNIVERSE, 2e-5)) : 20 / TAG_UNIVERSE)));
      return t.read;
    });
    var pRead = pTabs.reduce(function (s, v) { return s + v; }, 0);
    var pPre = Math.max(1, Math.round(pRead * extraSel));
    var pOut = Math.min(f.groupBy ? Math.max(1, Math.round(pPre * 0.0005)) : pPre, f.top || 10000);
    var proj = estimate({ read: pRead, pre: pPre, out: pOut, sortRows: f.orderBy ? pOut : 0, hashJoins: 0, width: 80, par: pRead > 2e6 ? 4 : 1, topped: true });
    var projectedMs = Math.min(elapsedMs, proj.elapsed * jitter(seed, 'p'));

    /* ---------- findings ---------- */
    var findings = [], penalty = 0;
    function add(sev, id, title, detail, fix, impact, pen) { findings.push({ sev: sev, id: id, title: title, detail: detail, fix: fix || '', impact: impact }); penalty += pen || 0; }
    var timeCol = dialect === 'timescale' ? 'ts' : dialect === 'plsql' ? 'event_time' : '[DateTime]';
    var windowFix = dialect === 'timescale' ? 'WHERE ts >= now() - INTERVAL \'1 hour\'\n  AND ts <  now()' :
      dialect === 'plsql' ? 'WHERE event_time >= SYSTIMESTAMP - INTERVAL \'1\' HOUR\n  AND event_time <  SYSTIMESTAMP' :
      'WHERE [DateTime] >= DATEADD(hour, -1, GETDATE())\n  AND [DateTime] <  GETDATE()';

    if (!f.hasWhere && fact.rows > 1e5 && !f.top) {
      add('critical', 'unbounded', 'Unbounded read of ' + compact(fact.rows) + ' rows', 'No WHERE clause: the engine must read the whole history table. During shift-change alarm bursts this also blocks historian inserts.', windowFix, 'High', 30);
    } else if (fact.kind === 'ts' && !f.timeFilter && fact.rows > 1e6) {
      add('critical', 'no-time', 'No sargable time predicate on a time-series table', 'Filtering on tags only still forces a scan of ' + compact(fact.rows) + ' rows. Always bound the query by the time column using a range.', windowFix, 'High', 28);
    }
    if (f.wrapped) {
      var ex = dialect === 'plsql' ? "WHERE TRUNC(event_time) = DATE '2026-11-09'\n-- becomes\nWHERE event_time >= DATE '2026-11-09'\n  AND event_time <  DATE '2026-11-09' + 1" :
        dialect === 'timescale' ? "WHERE date_trunc('day', ts) = '2026-11-09'\n-- becomes\nWHERE ts >= '2026-11-09' AND ts < '2026-11-10'" :
        "WHERE CONVERT(date, [DateTime]) = '2026-11-09'\n-- becomes\nWHERE [DateTime] >= '2026-11-09'\n  AND [DateTime] <  '2026-11-10'";
      add('critical', 'non-sargable', 'Function wrapped around the time column (non-SARGable)', 'Applying CONVERT/CAST/TRUNC/YEAR… to the column prevents index seeks and forces a scan with per-row evaluation.', ex, 'High', 22);
    }
    if (f.cursor) add('critical', 'cursor', 'Row-by-row cursor / FETCH loop', 'Cursors process one row per iteration and hold locks longer. Replace with a set-based statement (window functions, MERGE, or a single UPDATE … FROM).', '', 'High', 15);
    if (f.crossJoin) add('critical', 'cross', 'CROSS JOIN detected', 'A cartesian product multiplies row counts. Confirm it is intentional (e.g. against a small calendar/tag-list table).', '', 'High', 15);
    if (f.leadingWildcard) add('warning', 'wildcard', "Leading wildcard in LIKE '%…'", 'A leading % defeats index ordering on tag names. Prefer a prefix search (LIKE \'Chiller_%\'), a tag-group lookup table, or a full-text/trigram index.', "WHERE TagName LIKE 'CHW_Plant1_%'   -- prefix search can seek", 'Medium', 10);
    if (f.selectStar) add('warning', 'star', 'SELECT * on a wide historian table', 'Extra columns inflate IO, memory grant and network transfer, and block covering-index plans. Name only the columns you display.', dialect === 'tsql' ? 'SELECT [DateTime], TagName, [Value], Quality' : 'SELECT ts, tag_name, value, quality', 'Medium', 8);
    if (!f.top && !f.groupBy && out > 1e5) add('warning', 'no-top', 'Unbounded result set (≈' + compact(out) + ' rows returned)', 'Returning this many rows to a trend/HMI client is slow and memory-heavy. Add a row cap, downsample, or aggregate in SQL.', dialect === 'tsql' ? 'SELECT TOP (10000) …' : dialect === 'plsql' ? 'FETCH FIRST 10000 ROWS ONLY' : 'LIMIT 10000', 'Medium', 12);
    if (f.orCount >= 2) add('warning', 'or', f.orCount + ' OR predicates in WHERE', 'Multiple ORs often cause scans. Use IN (…) for tag lists, or UNION ALL of seekable branches.', '', 'Medium', 6);
    if (f.subIn) add('info', 'subin', 'IN (SELECT …) sub-query', 'Rewrite as EXISTS or a JOIN so the optimizer can pick a semi-join and push time predicates down.', '', 'Low', 4);
    if (f.tagN > 50) add('info', 'taglist', 'Large literal tag list (' + f.tagN + ' tags)', 'Big IN lists bloat plans. Load tag names into a small indexed table / TVP / temp table and JOIN to it.', '', 'Low', 4);
    if (f.nolock) add('info', 'nolock', 'NOLOCK hint', 'Acceptable for trend reads but can return uncommitted or duplicated rows. Prefer READ_COMMITTED_SNAPSHOT for alarm and event reporting.', '', 'Low', 1);
    if (dialect === 'tsql' && /\bhistory\b/.test(q) && f.timeFilter && !/wwresolution|wwretrievalmode/.test(q)) {
      add('info', 'wwres', 'Historian retrieval options not used', 'For trend screens request fewer points server-side with wwResolution / wwRetrievalMode instead of pulling raw samples and downsampling later.', "WHERE wwResolution = 60000      -- ms between returned samples\n  AND wwRetrievalMode = 'Cyclic'", 'Medium', 5);
    }
    if (fact.kind === 'ts' && (fact.rows >= 5e8 || fact.read > 1e8)) {
      var tn = fact.name.replace(/[\[\]"`]/g, '').split('.').pop();
      add('info', 'partition', 'Partition + compress high-frequency tag history', 'At ' + compact(fact.rows) + ' rows, partition by time (month/day), use columnstore or native compression, and pre-aggregate trends. Partition elimination keeps seeks proportional to the window, not the retention.',
        dialect === 'timescale' ? 'create_hypertable(…, chunk_time_interval => INTERVAL \'1 day\')' : dialect === 'plsql' ? 'PARTITION BY RANGE (event_time) INTERVAL (NUMTODSINTERVAL(1,\'DAY\'))' : 'CREATE CLUSTERED COLUMNSTORE INDEX … ON partitioned archive table', 'High', 0);
    }
    if (act.mem > 2048) add('warning', 'mem', MEM_LABEL[dialect] + ' of ≈' + compact(act.mem) + ' MB requested', 'Large sorts/hashes can spill to disk or queue behind other queries, stalling HMI trends. Reduce rows before the sort (time window, TOP) or pre-aggregate.', '', 'High', 10);
    if (windowAssumed) add('info', 'window', 'Time window could not be parsed', 'The model assumed a 24-hour window for estimates. Use DATEADD/INTERVAL expressions or literal date ranges for better accuracy.', '', 'Low', 0);
    if (f.distinct && !f.groupBy && out > 1e5) add('info', 'distinct', 'DISTINCT over a large set', 'DISTINCT forces a sort/hash over every row. Verify duplicates really occur, or pre-filter / use GROUP BY on the key columns.', '', 'Low', 3);
    if (!findings.length) add('info', 'ok', 'No major anti-patterns detected', 'The statement looks well-bounded. Validate with the real Actual Execution Plan and keep an eye on parameter sniffing for variable time windows.', '', 'Low', 0);

    var score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    var grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs tuning' : 'Critical';

    /* ---------- plan tree ---------- */
    function leaf(t) {
      var warn = [];
      if (t.access === 'scan' && t.rows > 1e5) warn.push('Full scan of ' + compact(t.rows) + ' rows');
      return { op: t.access === 'seek' ? ops.seek : ops.scan, object: t.name, rows: t.read, read: t.read, w: Math.pow(Math.max(1, t.read), 0.92) * (t.access === 'scan' ? 1.1 : 1), warn: warn, children: [] };
    }
    var leaves = tabs.map(leaf), cur = leaves[0];
    for (var i = 1; i < leaves.length; i++) {
      var big = cur.rows > 1e5 || leaves[i].rows > 1e5;
      cur = { op: big ? ops.hash : (tabs[i].access === 'seek' ? ops.nested : ops.merge), rows: Math.max(cur.rows, leaves[i].rows), w: Math.max(1, pre * 0.4), warn: [], children: [cur, leaves[i]] };
    }
    if (f.groupBy) cur = { op: ops.hashagg, rows: out, w: Math.max(1, pre * 0.3), warn: [], children: [cur] };
    if (f.orderBy) cur = { op: f.top ? ops.topsort : ops.sort, rows: f.top ? out : sortRows, w: Math.max(1, sortRows * Math.log2(Math.max(2, sortRows)) * 0.5 / (f.top ? 3 : 1)), warn: act.mem > 2048 ? [MEM_LABEL[dialect] + ' ≈ ' + compact(act.mem) + ' MB'] : [], children: [cur] };
    if (f.top) cur = { op: ops.top, rows: out, w: 1, warn: [], children: [cur] };
    var plan = { op: ops.root, rows: out, w: 1, warn: [], children: [cur] };
    var sumW = 0;
    (function walk(n) { sumW += n.w; n.children.forEach(walk); })(plan);
    (function walk(n) { n.cost = n.w / sumW * 100; n.hot = n.cost >= 40; delete n.w; n.children.forEach(walk); })(plan);

    /* ---------- rewrite ---------- */
    var rw = src.trim(), changes = [], before = rw, mm;
    rw = rw.replace(/convert\s*\(\s*date\s*,\s*([\w.\[\]]+)\s*\)\s*=\s*('[^']+')/gi, function (_, c, lit) { changes.push('Replaced CONVERT(date, ' + c + ') = … with a half-open range'); return c + ' >= ' + lit + ' AND ' + c + ' < DATEADD(day, 1, ' + lit + ')'; });
    rw = rw.replace(/cast\s*\(\s*([\w.\[\]]+)\s+as\s+date\s*\)\s*=\s*('[^']+')/gi, function (_, c, lit) { changes.push('Replaced CAST(' + c + ' AS date) = … with a half-open range'); return c + ' >= ' + lit + ' AND ' + c + ' < DATEADD(day, 1, ' + lit + ')'; });
    rw = rw.replace(/year\s*\(\s*([\w.\[\]]+)\s*\)\s*=\s*(\d{4})/gi, function (_, c, y) { changes.push('Replaced YEAR(' + c + ') = ' + y + ' with a range'); return c + " >= '" + y + "-01-01' AND " + c + " < '" + (+y + 1) + "-01-01'"; });
    rw = rw.replace(/trunc\s*\(\s*([\w.]+)\s*\)\s*=\s*(to_date\s*\([^)]*\)|date\s*'[^']+')/gi, function (_, c, lit) { changes.push('Replaced TRUNC(' + c + ') = … with a half-open range'); return c + ' >= ' + lit + ' AND ' + c + ' < ' + lit + ' + 1'; });
    if (dialect === 'tsql' && f.selectStar && /\bfrom\s+[\w.\[\]]*history\b/i.test(rw)) {
      rw = rw.replace(/select(\s+distinct)?(\s+top\s*\(?\s*\d+\s*\)?)?\s+(?:[\w\[\]]+\.)?\*/i, function (m0, d, t) { changes.push('Replaced SELECT * with an explicit column list'); return 'SELECT' + (d || '') + (t || '') + ' [DateTime], TagName, [Value], Quality'; });
    }
    if (dialect === 'tsql' && !f.top && !f.groupBy && out > 1e5 && /^\s*select\b/i.test(rw)) {
      rw = rw.replace(/^(\s*select)(\s+distinct)?/i, function (m0, s, d) { changes.push('Added TOP (10000) safety cap'); return s + (d || '') + ' TOP (10000)'; });
    }
    var manual = [];
    if (f.selectStar && !changes.some(function (c) { return /SELECT \*/.test(c); })) manual.push('Replace SELECT * with an explicit column list');
    if (f.leadingWildcard) manual.push("Avoid leading-wildcard LIKE on tag names");
    if (f.cursor) manual.push('Replace cursor loop with a set-based statement');
    if (fact.kind === 'ts' && !f.timeFilter) manual.push('Add a sargable time-range predicate (see recommendation)');
    var rewrite = { sql: rw, changed: rw !== before, changes: changes, manual: manual };

    var tname = fact.name.replace(/[\[\]"`]/g, '').split('.').pop().replace(/[^\w]/g, '') || 'TagHistory';
    var ddl = fact.kind === 'ts' ? buildDdl(dialect, tname) : [];

    return {
      dialect: dialect, score: score, grade: grade,
      metrics: {
        elapsedMs: elapsedMs, cpuMs: cpuMs, logicalReads: act.logical, physicalReads: act.physical, ioCost: act.ioCost,
        memMB: act.mem, memLabel: MEM_LABEL[dialect], rowsRead: totalRead, rowsOut: out,
        seeks: tabs.filter(function (t) { return t.access === 'seek'; }).length,
        scans: tabs.filter(function (t) { return t.access === 'scan'; }).length,
        readPct: totalRows ? Math.min(100, totalRead / totalRows * 100) : 0,
        parallelism: par, projectedMs: projectedMs, spill: act.mem > 2048
      },
      tables: tabs.map(function (t) { return { name: t.name, rows: t.rows, read: t.read, access: t.access, kind: t.kind }; }),
      plan: plan, findings: findings, rewrite: rewrite, ddl: ddl, simulated: true
    };
  }

  var api = { analyze: analyze };
  root.SQLProfiler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = function (e) {
      var d = e.data || {};
      try { root.postMessage({ id: d.id, ok: true, result: analyze(d.sql, d.dialect) }); }
      catch (err) { root.postMessage({ id: d.id, ok: false, error: err.message }); }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
