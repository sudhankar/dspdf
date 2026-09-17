/**
 * DSPDF Editor — Tools
 * --------------------
 * Each tool function receives a "placement" interaction:
 *  - click tools (text, image, signature, stamp): caller passes point
 *  - drag tools (rect, ellipse, line, arrow, highlight, redact, draw): caller
 *    passes start/end normalized points
 */
(function () {
  "use strict";
  var Ed = window.DSPDFEditor;
  var state = Ed.state;

  var defaults = {
    text: {
      font: "Helvetica", fontSize: 16, color: "#000000",
      align: "left", bold: false
    },
    shape: { stroke: "#2563EB", fill: null, strokeWidth: 2 },
    draw: { color: "#EF4444", strokeWidth: 3 },
    mark: { color: "#FDE047", opacity: 0.45 }
  };

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function makeTextBox(point, opts) {
    opts = opts || {};
    var el = {
      type: "text",
      x: clamp01(point.x),
      y: clamp01(point.y),
      w: 0.35,
      h: 0.05,
      text: opts.text || "Type here",
      font: opts.font || defaults.text.font,
      fontSize: opts.fontSize || defaults.text.fontSize,
      color: opts.color || defaults.text.color,
      align: opts.align || defaults.text.align,
      bold: !!opts.bold,
      _pageHeightPts: opts.pageHeightPts || 792
    };
    return Ed.addElement(el);
  }

  function makeImage(point, dataUrl, naturalAspect, opts) {
    opts = opts || {};
    // Default width 30% of page; height scaled by aspect relative to page
    var w = opts.w || 0.3;
    var h = w * (opts.hOverW || (1 / naturalAspect)) * (opts.pageAspect || 1);
    // Simpler: define h as a fraction too, using actual aspect against page.
    // We'll pick w=30% of page width, then h such that aspect preserved:
    // hFrac = (wFrac * pageWidthPts) / aspect / pageHeightPts
    var pageW = opts.pageWidthPts || 612;
    var pageH = opts.pageHeightPts || 792;
    w = opts.w || 0.3;
    var wPts = w * pageW;
    var hPts = wPts / naturalAspect;
    h = hPts / pageH;

    var el = {
      type: "image",
      x: clamp01(point.x),
      y: clamp01(point.y),
      w: w,
      h: h,
      dataUrl: dataUrl,
      naturalAspect: naturalAspect,
      pageWidthPts: pageW,
      pageHeightPts: pageH
    };
    return Ed.addElement(el);
  }

  function makeSignature(point, dataUrl, naturalAspect, opts) {
    opts = opts || {};
    var pageW = opts.pageWidthPts || 612;
    var pageH = opts.pageHeightPts || 792;
    var w = opts.w || 0.25;
    var wPts = w * pageW;
    var hPts = wPts / (naturalAspect || 2.5);
    var h = hPts / pageH;

    var el = {
      type: "signature",
      x: clamp01(point.x),
      y: clamp01(point.y),
      w: w, h: h,
      dataUrl: dataUrl,
      naturalAspect: naturalAspect || 2.5
    };
    return Ed.addElement(el);
  }

  /**
   * Rect / ellipse: drag start→end. In normalized coords.
   * start = {x,y}, end = {x,y}
   */
  function makeRect(start, end, opts) {
    opts = opts || {};
    var x = Math.min(start.x, end.x);
    var y = Math.min(start.y, end.y);
    var w = Math.abs(end.x - start.x);
    var h = Math.abs(end.y - start.y);
    if (w < 0.01 || h < 0.01) return null;
    var el = {
      type: opts.shape || "rect",
      x: clamp01(x), y: clamp01(y), w: w, h: h,
      stroke: opts.stroke || defaults.shape.stroke,
      fill: opts.fill || null,
      strokeWidth: opts.strokeWidth || defaults.shape.strokeWidth
    };
    return Ed.addElement(el);
  }

  function makeLine(start, end, opts) {
    opts = opts || {};
    // Store both start/end normalized plus bounding box for handles
    var x = Math.min(start.x, end.x);
    var y = Math.min(start.y, end.y);
    var w = Math.max(0.01, Math.abs(end.x - start.x));
    var h = Math.max(0.01, Math.abs(end.y - start.y));
    var el = {
      type: opts.type || "line",
      x: clamp01(x), y: clamp01(y), w: w, h: h,
      // line endpoints within the bounding box, 0..1
      x1: (start.x - x) / w, y1: (start.y - y) / h,
      x2: (end.x - x) / w, y2: (end.y - y) / h,
      stroke: opts.stroke || defaults.shape.stroke,
      strokeWidth: opts.strokeWidth || defaults.shape.strokeWidth
    };
    return Ed.addElement(el);
  }

  function makeHighlight(start, end, opts) {
    opts = opts || {};
    var x = Math.min(start.x, end.x);
    var y = Math.min(start.y, end.y);
    var w = Math.abs(end.x - start.x);
    var h = Math.abs(end.y - start.y);
    if (w < 0.005 || h < 0.005) return null;
    var el = {
      type: opts.type || "highlight",
      x: clamp01(x), y: clamp01(y), w: w, h: h,
      color: opts.color || defaults.mark.color,
      opacity: opts.opacity != null ? opts.opacity : defaults.mark.opacity
    };
    return Ed.addElement(el);
  }

  /**
   * Freehand path. `points` is array of normalized [x,y] pairs.
   */
  function makeDraw(points, opts) {
    opts = opts || {};
    if (!points || points.length < 2) return null;
    var xs = points.map(function (p) { return p[0]; });
    var ys = points.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var w = Math.max(0.005, maxX - minX);
    var h = Math.max(0.005, maxY - minY);
    // Convert points to local coordinates within bounding box (0..1)
    var local = points.map(function (p) {
      return [(p[0] - minX) / w, (p[1] - minY) / h];
    });
    var el = {
      type: "draw",
      x: clamp01(minX), y: clamp01(minY), w: w, h: h,
      points: local,
      color: opts.color || defaults.draw.color,
      strokeWidth: opts.strokeWidth || defaults.draw.strokeWidth
    };
    return Ed.addElement(el);
  }

  /**
   * Generate a typed signature image (PNG data URL) using a hidden canvas.
   * Returns promise of { dataUrl, aspect }.
   */
  function renderTypedSignature(text, fontFamily, color) {
    return new Promise(function (resolve) {
      var canvas = document.createElement("canvas");
      // Reasonable aspect for signatures
      canvas.width = 600; canvas.height = 200;
      var ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color || "#0F172A";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = "700 90px " + (fontFamily || '"Dancing Script", cursive');
      // Shrink to fit width if necessary
      var metrics = ctx.measureText(text);
      var targetW = canvas.width * 0.9;
      var size = 90;
      while (metrics.width > targetW && size > 20) {
        size -= 4;
        ctx.font = "700 " + size + "px " + (fontFamily || '"Dancing Script", cursive');
        metrics = ctx.measureText(text);
      }
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      resolve({
        dataUrl: canvas.toDataURL("image/png"),
        aspect: canvas.width / canvas.height
      });
    });
  }

  window.DSPDFEditorTools = {
    defaults: defaults,
    makeTextBox: makeTextBox,
    makeImage: makeImage,
    makeSignature: makeSignature,
    makeRect: makeRect,
    makeLine: makeLine,
    makeHighlight: makeHighlight,
    makeDraw: makeDraw,
    renderTypedSignature: renderTypedSignature
  };
})();