/**
 * Split PDF — every N pages or custom ranges → ZIP.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var state = { file: null, buffer: null, pdfDoc: null, pageCount: 0 };
  var worker = null;
  var progressUI = null;

  function el(id) { return document.getElementById(id); }
  function ensureWorker() {
    if (!worker) worker = D.createPdfWorker();
    return worker;
  }

  function parseRanges(str, max) {
    // "1-3, 5, 7-10" → [[0,2],[4,4],[6,9]]  (0-indexed, inclusive)
    return String(str).split(",").map(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return null;
      var m = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = Math.max(1, parseInt(m[1], 10));
        var b = Math.min(max, parseInt(m[2], 10));
        if (isNaN(a) || isNaN(b) || b < a) return null;
        return [a - 1, b - 1];
      }
      var single = parseInt(chunk, 10);
      if (!isNaN(single) && single >= 1 && single <= max) return [single - 1, single - 1];
      return null;
    }).filter(Boolean);
  }

  function readPageCount(buffer) {
    // Cheap: use pdf-lib worker? Simpler: use pdf.js on main thread once.
    // We'll load pdf.js here just to get page count (small overhead).
    return loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js").then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      return window.pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    }).then(function (doc) { return doc.numPages; });
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("load fail " + src)); };
      document.head.appendChild(s);
    });
  }

  var previewToken = 0;
  async function updatePreview() {
    if (!state.pdfDoc) return;
    var token=++previewToken, host=el("split-preview"); if(!host)return;
    host.innerHTML='<p class="text-muted">Preview of the loaded PDF:</p><div class="preview-pdf-strip" id="split-preview-strip"></div>';
    var strip=el("split-preview-strip");
    for(var i=0;i<state.pageCount;i++){
      if(token!==previewToken)return;
      var item=document.createElement("div");item.className="preview-pdf-item";item.innerHTML='<canvas></canvas><small>Page '+(i+1)+'</small>';strip.appendChild(item);
      try{var page=await state.pdfDoc.getPage(i+1),vp=page.getViewport({scale:.70}),c=item.querySelector("canvas");c.width=vp.width;c.height=vp.height;await page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;}catch(e){log("split preview",e);}
      // Avoid an enormous preview for very large documents while still showing the first 20 pages.
      if(i>=19 && state.pageCount>20){var more=document.createElement("div");more.className="text-muted";more.textContent="+ "+(state.pageCount-20)+" more pages";strip.appendChild(more);break;}
    }
  }

  async function loadPdf(file) {
    if (progressUI) progressUI.reset();
    D.clearAlert("split-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("split-alert", "Please choose a PDF."); return;
    }
    el("split-toolbar").hidden = true;
    D.showInfo("split-alert", "Reading PDF…");
    try {
      var buf = await D.fileToArrayBuffer(file);
      state.file = file;
      state.buffer = buf;
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      state.pdfDoc = await window.pdfjsLib.getDocument({data: buf.slice(0), disableWorker:true}).promise;
      state.pageCount = state.pdfDoc.numPages;
      el("split-info").textContent = "This PDF has " + state.pageCount + " page(s).";
      el("split-n").max = String(state.pageCount);
      el("split-toolbar").hidden = false;
      D.clearAlert("split-alert");
      updatePreview();
    } catch (err) {
      log(err);
      D.showError("split-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function apply() {
    if (!state.buffer) return;
    var mode = document.querySelector('input[name="split-mode"]:checked').value;
    var op, payload;

    if (mode === "every") {
      var n = parseInt(el("split-n").value, 10);
      if (!n || n < 1) { D.showError("split-alert", "Pages per chunk must be 1 or more."); return; }
      if (n >= state.pageCount) { D.showError("split-alert", "Chunk size equals the whole PDF — nothing to split."); return; }
      op = "splitEvery";
      payload = { buffer: state.buffer.slice(0), chunkSize: n };
    } else {
      var ranges = parseRanges(el("split-ranges").value, state.pageCount);
      if (!ranges.length) { D.showError("split-alert", "Could not understand those ranges. Try something like 1-3, 5, 7-10."); return; }
      op = "splitRange";
      payload = { buffer: state.buffer.slice(0), ranges: ranges };
    }

    progressUI.show();
    progressUI.set(30, "Splitting…");
    try {
      var result = await D.runPdfOperation(op, payload);
      progressUI.set(70, "Packaging ZIP…");
      if (!window.JSZip) throw new Error("JSZip is still loading. Please try again in a moment.");
      var zip = new window.JSZip();
      result.chunks.forEach(function (c) { zip.file(c.name, c.bytes); });
      var blob = await zip.generateAsync({ type: "blob" }, function (meta) {
        progressUI.set(70 + meta.percent * 0.28, "Packaging ZIP… " + Math.round(meta.percent) + "%");
      });
      var name = "dspdf-split-" + (state.file.name || "document").replace(/\.pdf$/i, "") + ".zip";
      D.downloadBlob(blob, name);
      progressUI.set(100, "Done — " + result.chunks.length + " file(s) in ZIP.");
      if (window.dspdfToast) window.dspdfToast("Saved " + name, "success");
    } catch (err) {
      progressUI.error("Split failed.");
      D.showError("split-alert", D.humanError(err, "Could not split this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("split-progress"));
    new D.UploadZone("#uz-split", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("split-apply").addEventListener("click", apply);
    // Toggle disabled state of inputs based on radio
    document.querySelectorAll('input[name="split-mode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var mode = document.querySelector('input[name="split-mode"]:checked').value;
        el("split-n").disabled = mode !== "every";
        el("split-ranges").disabled = mode !== "ranges";
      });
    });
    el("split-ranges").disabled = true;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();