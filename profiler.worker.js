/* =====================================================================
   SQL-Optima Studio — Background Profiler Engine (Web Worker)
   Heuristic Plan Simulator for SCADA Historians
   ===================================================================== */
(function (root) {
  'use strict';

  function analyze(sql, dialect) {
    sql = String(sql || '').trim();
    if (!sql) throw new Error('Query statement is empty.');

    var findings = [];
    var penalty = 0;
    var seeks = 0;
    var scans = 0;
    var rowsRead = 5000;
    var memMB = 4;
    var elapsedMs = 12.0;

    var isSelectStar = /\bSELECT\s+\*/i.test(sql);
    var hasWhere = /\bWHERE\b/i.test(sql);
    var hasDateRange = /\b(DateTime|ts|EventTime)\s*(>=|>|<|<=|BETWEEN)\b/i.test(sql);
    var hasConvertOnTime = /\b(CONVERT|CAST|YEAR|TRUNC)\s*\([^)]*(DateTime|ts|EventTime)/i.test(sql);
    var hasWildcard = /LIKE\s+'%/i.test(sql);
    var hasCyclic = /\bwwRetrievalMode\s*=\s*'Cyclic'/i.test(sql);

    // Heuristic Rules for Industrial Tag Historians
    if (isSelectStar) {
      findings.push({ sev: 'warning', title: 'SELECT * Projection', detail: 'Avoid SELECT * on high-frequency historian tables. Explicitly specify [DateTime], [TagName], [Value], [QualityDetail].' });
      penalty += 15;
    }

    if (!hasWhere) {
      findings.push({ sev: 'critical', title: 'Unbounded Query', detail: 'Missing WHERE clause. Query will scan entire partition depth.' });
      penalty += 40;
      scans++;
      rowsRead = 2500000;
      elapsedMs = 1850.0;
      memMB = 64;
    } else if (hasConvertOnTime) {
      findings.push({ sev: 'critical', title: 'Non-SARGable Predicate', detail: 'Function wrapped around timestamp column prevents clustered index seek.' });
      penalty += 30;
      scans++;
      rowsRead = 850000;
      elapsedMs = 420.0;
    } else if (hasDateRange) {
      findings.push({ sev: 'info', title: 'SARGable Range Seek', detail: 'Timestamp bounded correctly using half-open comparison.' });
      seeks++;
      rowsRead = 3600;
      elapsedMs = 28.0;
    }

    if (hasWildcard) {
      findings.push({ sev: 'warning', title: 'Leading Wildcard Scan', detail: 'LIKE "%..." prevents B-Tree prefix seek on TagName index.' });
      penalty += 12;
    }

    if (dialect === 'tsql' && !hasCyclic && hasDateRange) {
      findings.push({ sev: 'info', title: 'Raw Delta Mode', detail: 'Query requests raw samples. For trend screens, consider wwRetrievalMode="Cyclic" with wwResolution.' });
    }

    var score = Math.max(10, Math.min(100, 100 - penalty));
    var grade = score >= 85 ? 'Optimized' : score >= 60 ? 'Needs Tuning' : 'Critical Bottleneck';

    return {
      dialect: dialect,
      score: score,
      grade: grade,
      metrics: {
        elapsedMs: elapsedMs,
        rowsRead: rowsRead,
        seeks: seeks,
        scans: scans,
        memMB: memMB
      },
      findings: findings
    };
  }

  var api = { analyze: analyze };
  root.SQLProfiler = api;

  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = function (e) {
      var d = e.data || {};
      try {
        var res = analyze(d.sql, d.dialect);
        root.postMessage({ id: d.id, ok: true, result: res });
      } catch (err) {
        root.postMessage({ id: d.id, ok: false, error: err.message });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);