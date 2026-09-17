/**
 * Compress PDF — honest client-side compression.
 *
 * Approach:
 *   1. Use pdf.js to render each page to a canvas at a chosen scale.
 *   2. Export each canvas to JPEG at a chosen quality.
 *   3. Rebuild a new PDF from those JPEGs (via jsPDF).
 *
 * This converts text to image — documented honestly on the page.
 * We never claim a size we didn't achieve.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

  var state = {
    file: null,
    buffer: null,
    pdfDoc: null,
    pageCount: 0,
    lastResult: null // { blob, bytes, quality, size }
  };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("load fail " + src)); };
      document.head.appendChild(s);
    });
  }
  async function ensureLibs() {
    await loadScript(PDFJS_URL);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    await loadScript(JSPDF_URL);
  }

  async function loadPdf(file) {
    D.clearAlert("compress-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("compress-alert", "Please choose a PDF."); return;
    }
    el("compress-toolbar").hidden = true;
    el("compress-result").hidden = true;
    el("compress-preview").hidden = true;
    el("compress-download").hidden = true;
    state.lastResult = null;
    D.showInfo("compress-alert", "Reading PDF…");
    try {
      await ensureLibs();
      var buf = await D.fileToArrayBuffer(file);
      state.buffer = buf.slice(0);
      state.file = file;
      var task = window.pdfjsLib.getDocument({ data: buf });
      state.pdfDoc = await task.promise;
      state.pageCount = state.pdfDoc.numPages;
      el("compress-info").textContent =
        state.file.name + " — " + D.formatBytes(state.file.size) + " — " + state.pageCount + " page(s)";
      el("compress-toolbar").hidden = false;
      el("compress-preview-btn").disabled = false;
      el("compress-apply").disabled = false;
      D.clearAlert("compress-alert");
    } catch (err) {
      log(err);
      D.showError("compress-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  /**
   * Render one page to a canvas at a given scale.
   */
  async function renderPage(pageNum, scale) {
    var page = await state.pdfDoc.getPage(pageNum);
    var vp = page.getViewport({ scale: scale });
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    var ctx = canvas.getContext("2d");
    // Fill white to avoid transparency becoming black in JPEG
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }

  /**
   * Compress the whole PDF at a given JPEG quality.
   * scale controls raster resolution: 1.5 ≈ 108 dpi at default page size.
   */
  async function compressAtQuality(quality, onProgress) {
    var scale = quality >= 60 ? 1.5 : quality >= 40 ? 1.2 : 1.0;
    var pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4", compress: true });
    var firstPageDone = false;
    for (var p = 1; p <= state.pageCount; p++) {
      var canvas = await renderPage(p, scale);
      var dataUrl = canvas.toDataURL("image/jpeg", quality / 100);
      // Page size in points matching canvas aspect
      var pageW = canvas.width / scale;
      var pageH = canvas.height / scale;
      if (p === 1) {
        pdf.deletePage(1);
      }
      pdf.addPage([pageW, pageH], pageW > pageH ? "landscape" : "portrait");
      pdf.addImage(dataUrl, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
      if (onProgress) onProgress(p / state.pageCount);
      if (!firstPageDone) firstPageDone = true;
    }
    var blob = pdf.output("blob");
    return blob;
  }

  async function runCompress() {
    if (!state.buffer) return;
    var mode = document.querySelector('input[name="c-mode"]:checked').value;
    el("compress-download").hidden = true;
    el("compress-result").hidden = true;
    progressUI.show();

    try {
      var originalSize = state.file.size;
      var blob, quality;

      if (mode === "quality") {
        quality = parseInt(el("c-quality").value, 10);
        progressUI.set(5, "Compressing at quality " + quality + "%…");
        blob = await compressAtQuality(quality, function (pct) {
          progressUI.set(5 + pct * 88, "Compressing… page " + Math.round(pct * state.pageCount) + " / " + state.pageCount);
        });
      } else {
        var targetNum = parseFloat(el("c-target-num").value);
        var unit = el("c-target-unit").value;
        if (!targetNum || targetNum <= 0) throw new Error("Enter a positive target size.");
        var targetBytes = unit === "MB" ? targetNum * 1024 * 1024 : targetNum * 1024;

        if (originalSize <= targetBytes) {
          progressUI.hide();
          el("compress-result").className = "alert alert-info mt-4";
          el("compress-result").innerHTML = "Your file is already <strong>" + D.formatBytes(originalSize) +
            "</strong>, smaller than the target of <strong>" + D.formatBytes(targetBytes) +
            "</strong>. No compression is needed.";
          el("compress-result").hidden = false;
          return;
        }

        var best = null;
        var q = 80;
        while (q >= 20) {
          progressUI.set(5 + (80 - q) * 0.9, "Trying quality " + q + "%…");
          var candidate = await compressAtQuality(q, function (pct) {
            progressUI.set(5 + (80 - q) * 0.9 + pct * 3, "Trying quality " + q + "%…");
          });
          if (!best || candidate.size < best.size) {
            best = { blob: candidate, quality: q, size: candidate.size };
          }
          if (candidate.size <= targetBytes) {
            best = { blob: candidate, quality: q, size: candidate.size };
            break;
          }
          q -= 10;
        }
        blob = best.blob;
        quality = best.quality;
        if (best.size > targetBytes) {
          // Show honest message but still offer the best
          el("compress-result").className = "alert alert-warning mt-4";
          el("compress-result").innerHTML =
            "Best achievable: <strong>" + D.formatBytes(best.size) + "</strong> at quality " + quality +
            "%. Your target of " + D.formatBytes(targetBytes) +
            " was unreachable without severe quality loss. Download the best result, or try a larger target.";
          el("compress-result").hidden = false;
        }
      }

      progressUI.set(100, "Done.");
      var savings = Math.max(0, Math.round((1 - blob.size / originalSize) * 100));
      state.lastResult = { blob: blob, quality: quality, size: blob.size };

      if (blob.size >= originalSize) {
        el("compress-result").className = "alert alert-warning mt-4";
        el("compress-result").innerHTML = "We could not reduce this file's size. It is already as small as we can make it. " +
          "Original: " + D.formatBytes(originalSize) + " — Result: " + D.formatBytes(blob.size) + ".";
      } else if (el("compress-result").hidden) {
        el("compress-result").className = "alert alert-info mt-4";
        el("compress-result").innerHTML =
          "Original: <strong>" + D.formatBytes(originalSize) + "</strong> → Result: <strong>" +
          D.formatBytes(blob.size) + "</strong> (" + savings + "% smaller) at quality " + quality + "%.";
      }
      el("compress-result").hidden = false;

      // Preview compressed first page
      renderFirstPagePreview(blob, "prev-compressed");
      renderFirstPagePreview(state.file, "prev-original");
      el("compress-preview").hidden = false;

      el("compress-download").hidden = false;
      if (window.dspdfToast) window.dspdfToast("Compressed to " + D.formatBytes(blob.size), "success");
    } catch (err) {
      log(err);
      progressUI.error("Compression failed.");
      D.showError("compress-alert", D.humanError(err, "Could not compress this PDF."));
    }
  }

  async function renderFirstPagePreview(source, canvasId) {
    try {
      var buf;
      if (source instanceof Blob) buf = await source.arrayBuffer();
      else buf = await D.fileToArrayBuffer(source);
      var doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
      var page = await doc.getPage(1);
      var vp = page.getViewport({ scale: 0.5 });
      var canvas = el(canvasId);
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (err) { log("preview fail", canvasId, err); }
  }

  function init() {
    progressUI = new D.ProgressUI(el("compress-progress"));
    new D.UploadZone("#uz-compress", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("c-quality").addEventListener("input", function () {
      var v = parseInt(el("c-quality").value, 10);
      el("c-quality-val").textContent = v + "%";
    });
    document.querySelectorAll('input[name="c-mode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var mode = document.querySelector('input[name="c-mode"]:checked').value;
        el("c-quality").disabled = mode !== "quality";
        el("c-target-num").disabled = mode !== "target";
        el("c-target-unit").disabled = mode !== "target";
      });
    });
    el("c-target-num").disabled = true;
    el("c-target-unit").disabled = true;

    el("compress-preview-btn").addEventListener("click", async function () {
      if (!state.buffer) return;
      el("compress-preview").hidden = false;
      await renderFirstPagePreview(state.file, "prev-original");
      // Preview at current quality
      progressUI.show();
      progressUI.set(20, "Rendering preview…");
      try {
        var q = parseInt(el("c-quality").value, 10);
        var canvas = await renderPage(1, q >= 60 ? 1.5 : 1.2);
        var prev = el("prev-compressed");
        prev.width = canvas.width; prev.height = canvas.height;
        prev.getContext("2d").drawImage(canvas, 0, 0);
        progressUI.hide();
      } catch (err) {
        progressUI.error("Preview failed.");
      }
    });

    el("compress-apply").addEventListener("click", runCompress);
    el("compress-download").addEventListener("click", function () {
      if (!state.lastResult) return;
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(state.lastResult.blob, base + "-compressed.pdf");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();