(function () {
  'use strict';

  function lttb(data, threshold) {
    if (!data || threshold >= data.length || threshold <= 2) return data || [];
    var sampled = [];
    var sampledIndex = 0;
    var every = (data.length - 2) / (threshold - 2);
    var a = 0;
    var maxAreaPoint, maxArea, area, nextA;

    sampled[sampledIndex++] = data[a];

    for (var i = 0; i < threshold - 2; i++) {
      var avgX = 0, avgY = 0;
      var avgRangeStart = Math.floor((i + 1) * every) + 1;
      var avgRangeEnd = Math.floor((i + 2) * every) + 1;
      avgRangeEnd = avgRangeEnd < data.length ? avgRangeEnd : data.length;
      var avgRangeLength = avgRangeEnd - avgRangeStart;

      for (var j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += data[j].t;
        avgY += data[j].v;
      }
      avgX /= (avgRangeLength || 1);
      avgY /= (avgRangeLength || 1);

      var rangeOffs = Math.floor((i + 0) * every) + 1;
      var rangeTo = Math.floor((i + 1) * every) + 1;
      var pointAX = data[a].t;
      var pointAY = data[a].v;

      maxArea = -1;

      for (var k = rangeOffs; k < rangeTo; k++) {
        area = Math.abs(
          (pointAX - avgX) * (data[k].v - pointAY) -
          (pointAX - data[k].t) * (avgY - pointAY)
        ) * 0.5;
        if (area > maxArea) {
          maxArea = area;
          maxAreaPoint = data[k];
          nextA = k;
        }
      }

      sampled[sampledIndex++] = maxAreaPoint;
      a = nextA;
    }

    sampled[sampledIndex++] = data[data.length - 1];
    return sampled;
  }

  function calculateStats(points) {
    if (!points || points.length === 0) {
      return { min: 0, max: 0, avg: 0, median: 0, stdDev: 0, count: 0 };
    }
    var sum = 0, min = Infinity, max = -Infinity, vals = [];
    for (var i = 0; i < points.length; i++) {
      var v = points[i].v;
      vals.push(v);
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    var avg = sum / points.length;
    vals.sort(function (a, b) { return a - b; });
    var mid = Math.floor(vals.length / 2);
    var median = vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;

    var varianceSum = 0;
    for (var j = 0; j < vals.length; j++) {
      varianceSum += Math.pow(vals[j] - avg, 2);
    }
    var stdDev = Math.sqrt(varianceSum / vals.length);

    return { min: min, max: max, avg: avg, median: median, stdDev: stdDev, count: points.length };
  }

  function createTrendChart(container, options) {
    var canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    container.innerHTML = '';
    container.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var seriesData = options.series || [];
    var visibleRange = options.range || { start: 0, end: Date.now() };

    function render() {
      var rect = container.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      var width = rect.width, height = rect.height;
      ctx.clearRect(0, 0, width, height);
      if (!seriesData.length) return;

      var padding = { top: 20, right: 30, bottom: 30, left: 50 };
      var plotW = width - padding.left - padding.right;
      var plotH = height - padding.top - padding.bottom;

      ctx.strokeStyle = 'rgba(148, 170, 196, 0.15)';
      ctx.beginPath();
      for (var g = 0; g <= 4; g++) {
        var y = padding.top + (plotH / 4) * g;
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
      }
      ctx.stroke();

      seriesData.forEach(function (s) {
        if (!s.visible || !s.points || !s.points.length) return;
        var downsampled = lttb(s.points, 800);
        var min = s.min !== undefined ? s.min : 0;
        var max = s.max !== undefined ? s.max : 100;
        var rangeV = max - min || 1;
        var tMin = visibleRange.start;
        var tMax = visibleRange.end;
        var rangeT = tMax - tMin || 1;

        ctx.strokeStyle = s.color || '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var k = 0; k < downsampled.length; k++) {
          var px = padding.left + ((downsampled[k].t - tMin) / rangeT) * plotW;
          var py = padding.top + plotH - ((downsampled[k].v - min) / rangeV) * plotH;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    }

    render();
    window.addEventListener('resize', render);

    return {
      setSeries: function (newSeries, newRange) {
        seriesData = newSeries;
        if (newRange) visibleRange = newRange;
        render();
      }
    };
  }

  window.TrendEngine = {
    lttb: lttb,
    calculateStats: calculateStats,
    createChart: createTrendChart
  };
})();
