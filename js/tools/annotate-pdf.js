/**
 * Annotate PDF — sticky notes, preset stamps, freehand drawing.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = {
    file: null, bytes: null, pdfDoc: null,
    pageCount: 0, pageIndex: 0,
    annotations: {} // pageIndex -> array of { type, ... }
  };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function hexToRgb01(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(hex, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  function pdfRgb(hex) {
    var c = hexToRgb01(hex);
    return window.PDFLib.rgb(c.r, c.g, c.b);
  }

  async function loadPdf(file) {
    D.clearAlert("an-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("an-alert", "Please choose a PDF."); return;
    }
    el("an-toolbar").hidden = true;
    D.showInfo("an-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      state.pageIndex = 0;
      state.annotations = {};
      el("an-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("an-toolbar").hidden = false;
      D.clearAlert("an-alert");
      await renderPage();
      updateCount();
    } catch (err) {
      log(err); D.showError("an-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderPage() {
    var page = await state.pdfDoc.getPage(state.pageIndex + 1);
    var vp = page.getViewport({ scale: 1.4 });
    var canvas = el("an-canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    drawAnnotations(ctx, canvas);
    el("an-page-label").textContent = (state.pageIndex + 1) + " / " + state.pageCount;
  }

  function drawAnnotations(ctx, canvas) {
    var list = state.annotations[state.pageIndex] || [];
    list.forEach(function (a) {
      if (a.type === "note") {
        // Sticky note: colored square with fold
        var w = 40, h = 40;
        var x = a.x * canvas.width;
        var y = a.y * canvas.height;
        ctx.fillStyle = a.color || "#FDE047";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h - 10);
        ctx.lineTo(x + w - 10, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.stroke();
        // Text if short
        if (a.text) {
          ctx.fillStyle = "#111";
          ctx.font = "10px Helvetica, Arial, sans-serif";
          var lines = wrap(a.text, 34);
          lines.slice(0, 3).forEach(function (line, i) {
            ctx.fillText(line, x + 4, y + 14 + i * 11);
          });
        }
      } else if (a.type === "stamp") {
        var text = a.text || "STAMP";
        var size = 22;
        ctx.font = "bold " + size + "px Helvetica, Arial, sans-serif";
        var tw = ctx.measureText(text).width;
        var padX = 12, padY = 8;
        var boxW = tw + padX * 2;
        var boxH = size + padY * 2;
        var bx = a.x * canvas.width - boxW / 2;
        var by = a.y * canvas.height - boxH / 2;
        ctx.save();
        ctx.translate(a.x * canvas.width, a.y * canvas.height);
        ctx.rotate(-0.2);
        ctx.translate(-a.x * canvas.width, -a.y * canvas.height);
        // Outline
        ctx.strokeStyle = a.color || "#EF4444";
        ctx.lineWidth = 3;
        ctx.strokeRect(bx, by, boxW, boxH);
        ctx.fillStyle = a.color || "#EF4444";
        ctx.fillText(text, bx + padX, by + padY + size - 4);
        ctx.restore();
      } else if (a.type === "draw") {
        var pts = a.points || [];
        if (pts.length < 2) return;
        ctx.strokeStyle = a.color || "#EF4444";
        ctx.lineWidth = a.width || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(function (p, i) {
          var x = p[0] * canvas.width;
          var y = p[1] * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    });
  }

  function wrap(text, maxChars) {
    var words = String(text).split(/\s+/);
    var lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (test.length > maxChars && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function updateCount() {
    var n = 0;
    Object.keys(state.annotations).forEach(function (k) { n += state.annotations[k].length; });
    el("an-count").textContent = n + " annotation" + (n === 1 ? "" : "s");
  }

  function currentTool() {
    return document.querySelector('input[name="an-tool"]:checked').value;
  }

  function setupInteractions() {
    var canvas = el("an-canvas");
    var drawing = false, pts = [];

    canvas.addEventListener("pointerdown", function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      var tool = currentTool();

      if (tool === "draw") {
        drawing = true;
        pts = [[x, y]];
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }

      if (!state.annotations[state.pageIndex]) state.annotations[state.pageIndex] = [];

      if (tool === "note") {
        state.annotations[state.pageIndex].push({
          type: "note",
          x: x, y: y,
          text: el("an-note-text").value || "",
          color: el("an-note-color").value
        });
      } else if (tool === "stamp") {
        var preset = el("an-stamp-preset").value;
        var text = preset === "custom" ? el("an-stamp-custom").value : preset;
        if (!text) text = "STAMP";
        state.annotations[state.pageIndex].push({
          type: "stamp",
          x: x, y: y,
          text: text,
          color: el("an-stamp-color").value
        });
      }
      renderPage();
      updateCount();
      el("an-save").disabled = false;
    });

    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      pts.push([x, y]);
      renderPage().then(function () {
        var ctx = canvas.getContext("2d");
        ctx.strokeStyle = el("an-draw-color").value;
        ctx.lineWidth = parseInt(el("an-draw-width").value, 10) || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(function (p, i) {
          var px = p[0] * canvas.width;
          var py = p[1] * canvas.height;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      });
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      canvas.addEventListener(ev, function () {
        if (!drawing) return;
        drawing = false;
        if (pts.length >= 2) {
          if (!state.annotations[state.pageIndex]) state.annotations[state.pageIndex] = [];
          state.annotations[state.pageIndex].push({
            type: "draw",
            points: pts.slice(),
            color: el("an-draw-color").value,
            width: parseInt(el("an-draw-width").value, 10) || 3
          });
        }
        pts = [];
        renderPage();
        updateCount();
        el("an-save").disabled = false;
      });
    });
  }

  async function save() {
    if (!state.bytes) return;
    progressUI.show();
    progressUI.set(20, "Applying annotations…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      var boldFont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      var pages = doc.getPages();

      Object.keys(state.annotations).forEach(function (k) {
        var pIdx = parseInt(k, 10);
        var page = pages[pIdx];
        if (!page) return;
        var size = page.getSize();
        state.annotations[k].forEach(function (a) {
          if (a.type === "note") {
            var nx = a.x * size.width;
            var ny = size.height - a.y * size.height - 40;
            var c = hexToRgb01(a.color);
            page.drawRectangle({
              x: nx, y: ny, width: 40, height: 40,
              color: PDFLib.rgb(c.r, c.g, c.b),
              borderColor: PDFLib.rgb(0.6, 0.6, 0.6),
              borderWidth: 0.5
            });
            if (a.text) {
              var lines = wrap(a.text, 34).slice(0, 3);
              lines.forEach(function (line, i) {
                page.drawText(line, {
                  x: nx + 3, y: ny + 40 - 12 - i * 10,
                  size: 7, font: font,
                  color: PDFLib.rgb(0.1, 0.1, 0.1)
                });
              });
            }
          } else if (a.type === "stamp") {
            var sx = a.x * size.width;
            var sy = size.height - a.y * size.height;
            var stampSize = 22;
            var text = a.text || "STAMP";
            var tw = boldFont.widthOfTextAtSize(text, stampSize);
            var boxW = tw + 24;
            var boxH = stampSize + 16;
            var c2 = hexToRgb01(a.color);
            page.drawRectangle({
              x: sx - boxW / 2, y: sy - boxH / 2,
              width: boxW, height: boxH,
              borderColor: PDFLib.rgb(c2.r, c2.g, c2.b),
              borderWidth: 3,
              opacity: 0,
              borderOpacity: 0.85,
              rotate: PDFLib.degrees(-12)
            });
            page.drawText(text, {
              x: sx - tw / 2, y: sy - stampSize / 3,
              size: stampSize, font: boldFont,
              color: PDFLib.rgb(c2.r, c2.g, c2.b),
              opacity: 0.9,
              rotate: PDFLib.degrees(-12)
            });
          } else if (a.type === "draw") {
            var pts = a.points || [];
            if (pts.length < 2) return;
            var c3 = hexToRgb01(a.color);
            for (var i = 1; i < pts.length; i++) {
              var p1 = pts[i - 1], p2 = pts[i];
              page.drawLine({
                start: { x: p1[0] * size.width, y: size.height - p1[1] * size.height },
                end:   { x: p2[0] * size.width, y: size.height - p2[1] * size.height },
                thickness: a.width || 3,
                color: PDFLib.rgb(c3.r, c3.g, c3.b)
              });
            }
          }
        });
      });

      progressUI.set(85, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-annotated.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved annotated PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("an-alert", D.humanError(err, "Could not save annotations."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("an-progress"));
    new D.UploadZone("#uz-an", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    document.querySelectorAll('input[name="an-tool"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var t = currentTool();
        el("an-note-row").hidden = t !== "note";
        el("an-stamp-row").hidden = t !== "stamp";
        el("an-draw-row").hidden = t !== "draw";
      });
    });
    el("an-stamp-preset").addEventListener("change", function () {
      el("an-stamp-custom").hidden = this.value !== "custom";
    });
    el("an-draw-width").addEventListener("input", function () {
      el("an-draw-width-val").textContent = this.value;
    });
    el("an-prev").addEventListener("click", function () {
      if (state.pageIndex > 0) { state.pageIndex--; renderPage(); }
    });
    el("an-next").addEventListener("click", function () {
      if (state.pageIndex < state.pageCount - 1) { state.pageIndex++; renderPage(); }
    });
    el("an-undo").addEventListener("click", function () {
      var list = state.annotations[state.pageIndex];
      if (list && list.length) { list.pop(); renderPage(); updateCount(); }
    });
    el("an-clear-page").addEventListener("click", function () {
      state.annotations[state.pageIndex] = [];
      renderPage();
      updateCount();
    });
    el("an-save").addEventListener("click", save);
    setupInteractions();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();