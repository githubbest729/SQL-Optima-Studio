/* =====================================================================
   SQL-Optima Studio — EEMUA 191 Alarm & Event Analytics Engine
   Calculates Chattering, Fleeting Alarms, and Alarm Floods
   ===================================================================== */
(function () {
  'use strict';

  function parseAlarmDataset(records, config) {
    config = config || {
      chatteringThresholdSec: 60,
      chatteringMinCount: 3,
      floodThresholdCount: 10,
      floodWindowSec: 600
    };

    var validRecords = [];
    var invalidRecords = 0;
    var tagCounts = {};
    var priorityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, JOURNAL: 0 };
    var activeStanding = {};
    var acknowledgedCount = 0;
    var unacknowledgedCount = 0;

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var ts = typeof r.timestamp === 'number' ? r.timestamp : Date.parse(r.timestamp);
      if (isNaN(ts) || !r.tag) {
        invalidRecords++;
        continue;
      }

      var normalized = {
        id: r.id || ('al-' + i),
        timestamp: ts,
        tag: String(r.tag).trim(),
        priority: String(r.priority || 'HIGH').toUpperCase(),
        state: String(r.state || 'ALARM').toUpperCase(),
        ack: Boolean(r.ack),
        description: r.description || ''
      };

      validRecords.push(normalized);
      tagCounts[normalized.tag] = (tagCounts[normalized.tag] || 0) + 1;

      if (priorityCounts[normalized.priority] !== undefined) {
        priorityCounts[normalized.priority]++;
      } else {
        priorityCounts.HIGH++;
      }

      if (normalized.ack) acknowledgedCount++;
      else unacknowledgedCount++;

      if (normalized.state === 'ALARM' || normalized.state === 'ACTIVE') {
        activeStanding[normalized.tag] = normalized;
      } else if (normalized.state === 'CLEAR' || normalized.state === 'RTN') {
        delete activeStanding[normalized.tag];
      }
    }

    validRecords.sort(function (a, b) { return a.timestamp - b.timestamp; });

    // 1. Chattering Alarm Detection (>= N transitions in X seconds)
    var chatteringAlarms = {};
    var tagTimestamps = {};
    for (var j = 0; j < validRecords.length; j++) {
      var item = validRecords[j];
      if (!tagTimestamps[item.tag]) tagTimestamps[item.tag] = [];
      tagTimestamps[item.tag].push(item.timestamp);
    }

    Object.keys(tagTimestamps).forEach(function (tag) {
      var times = tagTimestamps[tag];
      if (times.length < config.chatteringMinCount) return;
      for (var k = 0; k <= times.length - config.chatteringMinCount; k++) {
        var diff = (times[k + config.chatteringMinCount - 1] - times[k]) / 1000;
        if (diff <= config.chatteringThresholdSec) {
          chatteringAlarms[tag] = {
            tag: tag,
            transitions: times.length,
            sampleIntervalSec: diff
          };
          break;
        }
      }
    });

    // 2. Alarm Flood Identification (> 10 alarms / 10 mins according to EEMUA 191 benchmark)
    var floods = [];
    var windowMs = config.floodWindowSec * 1000;
    var left = 0;

    for (var right = 0; right < validRecords.length; right++) {
      while (validRecords[right].timestamp - validRecords[left].timestamp > windowMs) {
        left++;
      }
      var countInWindow = right - left + 1;
      if (countInWindow >= config.floodThresholdCount) {
        var startTime = validRecords[left].timestamp;
        var endTime = validRecords[right].timestamp;
        if (floods.length === 0 || startTime > floods[floods.length - 1].endTime) {
          floods.push({
            startTime: startTime,
            endTime: endTime,
            alarmCount: countInWindow,
            peakRatePer10Min: countInWindow
          });
        }
      }
    }

    // 3. Top Bad Actors (Pareto Analysis)
    var sortedBadActors = Object.keys(tagCounts).map(function (tag) {
      return { tag: tag, count: tagCounts[tag], pct: (tagCounts[tag] / validRecords.length) * 100 };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    return {
      summary: {
        totalEvents: validRecords.length,
        invalidRecords: invalidRecords,
        standingAlarmsCount: Object.keys(activeStanding).length,
        acknowledgedCount: acknowledgedCount,
        unacknowledgedCount: unacknowledgedCount,
        floodPeriodsCount: floods.length,
        chatteringCount: Object.keys(chatteringAlarms).length
      },
      priorityCounts: priorityCounts,
      badActors: sortedBadActors,
      chatteringAlarms: Object.values(chatteringAlarms),
      floods: floods,
      records: validRecords
    };
  }

  window.AlarmEngine = {
    parseDataset: parseAlarmDataset
  };
})();