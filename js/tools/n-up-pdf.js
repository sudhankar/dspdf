/**
 * N-up PDF — combine pages per sheet using canvas compositing.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pdfDoc: null, pageCount: 0 };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }
  function sheetSizePts(name) {
    if (name === "letter") return { w: 612, h: 792 };
    return { w: 595.28, h: 841.89 }; // A4
  }

  async function loadPdf(file) {
    D.clearAlert("nup-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("nup-alert", "Please choose a PDF."); return;
    }
    el("nup-toolbar").hidden = true;
    D.showInfo("nup-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      el("nup-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("nup-toolbar").hidden = false;
      D.clearAlert("nup-alert");
    } catch (err) {
      log(err); D.showError("nup-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  function gridFor(count) {
    if (count === 2) return { cols: 2, rows: 1 };
    if (count === 4) return { cols: 2, rows: 2 };
    if (count === 6) return { cols: 3, rows: 2 };
    if (count === 9) return { cols: 3, rows: 3 };
    return { cols: 2, rows: 2 };
  }

  async function buildNup() {
    if (!state.pdfDoc) return;
    progressUI.show();
    progressUI.set(5, "Preparing…");
    try {
      var perSheet = parseInt(el("nup-count").value, 10);
      var sheetName = el("nup-sheet").value;
      var orient = el("nup-orient").value;
      var gap = parseInt(el("nup-gap").value, 10) || 0;
      var drawBorder = el("nup-border").checked;

      var sheet = sheetSizePts(sheetName);
      // Auto orientation: landscape unless portrait explicitly chosen
      if (orient === "landscape" || orient === "auto") {
        sheet = { w: sheet.h, h: sheet.w };
      }

      var grid = gridFor(perSheet);
      var cellW = (sheet.w - gap * (grid.cols + 1)) / grid.cols;
      var cellH = (sheet.h - gap * (grid.rows + 1)) / grid.rows;

      // Render at 1.5x sheet size to keep quality
      var renderScale = 1.5;
      var sheetPxW = sheet.w * renderScale;
      var sheetPxH = sheet.h * renderScale;
      var cellPxW = cellW * renderScale;
      var cellPxH = cellH * renderScale;
      var gapPx = gap * renderScale;

      var sheets = Math.ceil(state.pageCount / perSheet);
      var sheetBlobs = [];

      for (var s = 0; s < sheets; s++) {
        var canvas = document.createElement("canvas");
        canvas.width = sheetPxW; canvas.height = sheetPxH;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (var i = 0; i < perSheet; i++) {
          var pIdx = s * perSheet + i;
          if (pIdx >= state.pageCount) break;
          var col = i % grid.cols;
          var row = Math.floor(i / grid.cols);

          var cellX = gapPx + col * (cellPxW + gapPx);
          var cellY = gapPx + row * (cellPxH + gapPx);

          var page = await state.pdfDoc.getPage(pIdx + 1);
          var vpNatural = page.getViewport({ scale: 1 });
          var scaleX = cellPxW / vpNatural.width;
          var scaleY = cellPxH / vpNatural.height;
          var pageScale = Math.min(scaleX, scaleY);
          var vp = page.getViewport({ scale: pageScale });
          var drawX = cellX + (cellPxW - vp.width) / 2;
          var drawY = cellY + (cellPxH - vp.height) / 2;

          // Render page to temp canvas
          var tmp = document.createElement("canvas");
          tmp.width = Math.floor(vp.width);
          tmp.height = Math.floor(vp.height);
          var tmpCtx = tmp.getContext("2d");
          tmpCtx.fillStyle = "#fff"; tmpCtx.fillRect(0, 0, tmp.width, tmp.height);
          await page.render({ canvasContext: tmpCtx, viewport: vp }).promise;
          ctx.drawImage(tmp, drawX, drawY);

          if (drawBorder) {
            ctx.strokeStyle = "rgba(0,0,0,0.2)";
            ctx.lineWidth = 1;
            ctx.strokeRect(drawX, drawY, vp.width, vp.height);
          }
        }

        // Convert to JPEG blob
        var blob = await new Promise(function (res) { canvas.toBlob(res, "image/jpeg", 0.85); });
        sheetBlobs.push({ blob: blob, w: sheet.w, h: sheet.h });
        progressUI.set(5 + ((s + 1) / sheets) * 80, "Composed sheet " + (s + 1) + " / " + sheets);
      }

      // Assemble PDF
      progressUI.set(88, "Building PDF…");
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.create();
      for (var k = 0; k < sheetBlobs.length; k++) {
        var sb = sheetBlobs[k];
        var buf = await sb.blob.arrayBuffer();
        var img = await doc.embedJpg(new Uint8Array(buf));
        var pg = doc.addPage([sb.w, sb.h]);
        pg.drawImage(img, { x: 0, y: 0, width: sb.w, height: sb.h });
      }
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var pdfBlob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(pdfBlob, base + "-" + perSheet + "up.pdf");
      progressUI.set(100, "Done — " + sheets + " sheet(s).");
      if (window.dspdfToast) window.dspdfToast("Saved N-up PDF.", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("nup-alert", D.humanError(err, "Could not build N-up PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("nup-progress"));
    new D.UploadZone("#uz-nup", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("nup-apply").addEventListener("click", buildNup);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();