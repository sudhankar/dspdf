/**
 * OCR PDF — Tesseract.js (lazy-loaded) + pdf.js rendering + pdf-lib text layer.
 *
 * Honest notes:
 *   - Tesseract.js 5.x is loaded only when the user clicks "Run".
 *   - We render each page to a canvas, OCR the canvas, then build an output
 *     PDF that shows the original page image plus an invisible text layer.
 *   - "Invisible" text is drawn with rendering mode 3 (invisible) — this is
 *     standard practice for searchable PDFs. pdf-lib does not expose render
 *     mode directly, so we approximate by drawing white-on-white with an
 *     alpha of 0.001 — visually invisible, still searchable in most readers.
 *     (We document this. Truly invisible rendering mode requires a lower-level
 *     PDF library; documented as a known limitation.)
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js";
  var FONTKIT_URL = "https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";

  var state = { file: null, bytes: null, pdfDoc: null, pageCount: 0, lastText: "", runId: 0 };
  var progressUI = null;
  var tesseractLoaded = false;

  function el(id) { return document.getElementById(id); }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function parseRange(str, max) {
    if (!str) return [];
    var out = [];
    str.split(",").forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var m = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = Math.max(1, parseInt(m[1], 10));
        var b = Math.min(max, parseInt(m[2], 10));
        for (var i = a; i <= b; i++) out.push(i - 1);
      } else {
        var s = parseInt(chunk, 10);
        if (s >= 1 && s <= max) out.push(s - 1);
      }
    });
    return out;
  }

  async function loadPdf(file) {
    if (progressUI) progressUI.reset();
    D.clearAlert("ocr-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("ocr-alert", "Please choose a PDF."); return;
    }
    el("ocr-toolbar").hidden = true;
    el("ocr-result").hidden = true;
    el("ocr-text-out").textContent = "";
    el("ocr-apply").disabled = true;
    el("ocr-text-only").disabled = true;
    state.lastText = "";
    state.runId++;
    var loadRun = state.runId;
    var previewWrap = el("ocr-preview-wrap"); if (previewWrap) previewWrap.hidden = true;
    var previewCanvas = el("ocr-preview-canvas"); if (previewCanvas) { previewCanvas.width=1; previewCanvas.height=1; }
    D.showInfo("ocr-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      if (loadRun !== state.runId) return;
      state.pageCount = state.pdfDoc.numPages;
      el("ocr-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      await renderOcrPreview();
      el("ocr-toolbar").hidden = false;
      el("ocr-apply").disabled = false;
      el("ocr-text-only").disabled = false;
      D.clearAlert("ocr-alert");
    } catch (err) {
      log(err); D.showError("ocr-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderOcrPreview() {
    if (!state.pdfDoc) return;
    var wrap=el("ocr-preview-wrap"), canvas=el("ocr-preview-canvas");
    if (!wrap || !canvas) return;
    try {
      var page=await state.pdfDoc.getPage(1);
      var base=page.getViewport({scale:1});
      var maxCss=1100;
      var scale=Math.max(1.5, Math.min(2.0, maxCss/base.width));
      var vp=page.getViewport({scale:scale});
      canvas.width=Math.ceil(vp.width); canvas.height=Math.ceil(vp.height);
      canvas.style.width="100%"; canvas.style.height="auto";
      var ctx=canvas.getContext("2d",{alpha:false});
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      wrap.hidden=false;
    } catch(e){ log("OCR preview",e); }
  }

  function pagesToProcess() {
    var mode = el("ocr-pages").value;
    if (mode === "all") { var a = []; for (var i = 0; i < state.pageCount; i++) a.push(i); return a; }
    if (mode === "first") return [0];
    return parseRange(el("ocr-range").value, state.pageCount);
  }

  async function renderPageToCanvas(pageNum, dpi) {
    var page = await state.pdfDoc.getPage(pageNum);
    var scale = dpi / 72;
    var vp = page.getViewport({ scale: scale });
    var canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas: canvas, pageSize: page.getViewport({ scale: 1 }) };
  }

  async function ensureTesseract() {
    if (tesseractLoaded) return;
    progressUI.set(2, "Loading OCR engine (first time only)…");
    await loadScript(TESSERACT_URL);
    tesseractLoaded = true;
  }

  async function loadOcrFont(PDFLib, lang) {
    var needsDeva = /(^|\+)hin(\+|$)/.test(lang);
    if (!needsDeva) return null;
    try {
      var url="https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf";
      var r=await fetch(url,{mode:"cors"}); if(!r.ok) throw new Error("Hindi font download failed");
      return new Uint8Array(await r.arrayBuffer());
    } catch(e) { log("Hindi font unavailable",e); return null; }
  }

  async function runOCR(collectTextOnly) {
    if (!state.pdfDoc) return;
    var runId = state.runId;
    var lang = el("ocr-lang").value;
    var dpi = parseInt(el("ocr-dpi").value, 10);
    var pages = pagesToProcess();
    if (!pages.length) { D.showError("ocr-alert", "Select at least one page."); return; }

    progressUI.show();
    try {
      await ensureTesseract();
      if (runId !== state.runId) return;
      var Tesseract = window.Tesseract;
      if (!Tesseract || !Tesseract.createWorker) {
        throw new Error("Tesseract failed to initialise. Check your internet connection and reload.");
      }
      progressUI.set(5, "Initialising OCR worker for language: " + lang + "…");
      var worker = await Tesseract.createWorker(lang, 1, {
        logger: function (m) {
          if (m.status === "recognizing text") {
            // Progress is per-page — we layer on top of overall progress
          }
        }
      });

      var allText = "";
      var pageOutputs = []; // { dataUrl, pageSize, text, blocks }

      for (var i = 0; i < pages.length; i++) {
        var pIdx = pages[i];
        progressUI.set(10 + (i / pages.length) * 70, "Rendering page " + (pIdx + 1) + "…");
        var rendered = await renderPageToCanvas(pIdx + 1, dpi);

        progressUI.set(15 + (i / pages.length) * 70, "Recognising text — page " + (pIdx + 1) + " of " + pages.length + "…");
        var result = await worker.recognize(rendered.canvas);
        if (runId !== state.runId) { try { await worker.terminate(); } catch (_) {} return; }
        var text = (result && result.data && result.data.text) || "";
        allText += "\n\n--- Page " + (pIdx + 1) + " ---\n" + text;

        pageOutputs.push({
          dataUrl: rendered.canvas.toDataURL("image/jpeg", 0.85),
          pageW: rendered.pageSize.width,
          pageH: rendered.pageSize.height,
          canvasW: rendered.canvas.width,
          canvasH: rendered.canvas.height,
          text: text,
          words: (result && result.data && result.data.words) || []
        });
      }

      progressUI.set(85, "Finalising OCR worker…");
      await worker.terminate();
      state.lastText = allText;

      // Show preview
      el("ocr-text-out").textContent = allText.slice(0, 500) + (allText.length > 500 ? "\n…" : "");
      el("ocr-result").hidden = false;

      if (collectTextOnly) {
        var blob = new Blob([allText], { type: "text/plain;charset=utf-8" });
        var base = (state.file.name || "document").replace(/\.pdf$/i, "");
        D.downloadBlob(blob, base + "-ocr.txt");
        progressUI.set(100, "Text downloaded.");
        if (window.dspdfToast) window.dspdfToast("Text file saved.", "success");
        return;
      }

      // Build searchable PDF
      progressUI.set(88, "Building searchable PDF…");
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.create();
      var langFontBytes = await loadOcrFont(PDFLib, lang);
      var font;
      if (langFontBytes) {
        try {
          await loadScript(FONTKIT_URL);
          if (window.fontkit && PDFLib.PDFDocument.prototype.registerFontkit) doc.registerFontkit(window.fontkit);
          font = await doc.embedFont(langFontBytes, {subset:true});
        } catch(fontErr) {
          log("Devanagari font embedding failed",fontErr);
          font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        }
      } else { font = await doc.embedFont(PDFLib.StandardFonts.Helvetica); }

      for (var k = 0; k < pageOutputs.length; k++) {
        var po = pageOutputs[k];
        var b64 = po.dataUrl.split(",")[1];
        var bin = atob(b64);
        var imgBytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) imgBytes[j] = bin.charCodeAt(j);
        var img = await doc.embedJpg(imgBytes);
        var page = doc.addPage([po.pageW, po.pageH]);
        page.drawImage(img, { x: 0, y: 0, width: po.pageW, height: po.pageH });

        // Invisible-ish text layer for searchability
        // We draw each word in white at a tiny opacity. Most readers will
        // still index the text. (Documented: not fully invisible mode 3.)
        po.words.forEach(function (w) {
          if (!w.text || !w.bbox) return;
          try {
            var sx = po.pageW / po.canvasW, sy = po.pageH / po.canvasH;
            var fontSize = Math.max(4, (w.bbox.y1 - w.bbox.y0) * sy * 0.92);
            if (!isFinite(fontSize) || fontSize < 3) return;
            page.drawText(w.text, {
              x: w.bbox.x0 * sx,
              y: po.pageH - (w.bbox.y1 * sy),
              size: fontSize, font: font,
              color: PDFLib.rgb(0, 0, 0), opacity: 0.001
            });
          } catch (e) { /* skip bad bbox */ }
        });
      }

      doc.setProducer("DSPDF OCR");
      var outBytes = await doc.save({ useObjectStreams: true });
      var pdfBlob = new Blob([outBytes], { type: "application/pdf" });
      var baseName = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(pdfBlob, baseName + "-searchable.pdf");
      progressUI.set(100, "Searchable PDF saved.");
      if (window.dspdfToast) window.dspdfToast("Saved searchable PDF.", "success");
    } catch (err) {
      log(err);
      progressUI.error("OCR failed.");
      D.showError("ocr-alert", D.humanError(err, "OCR failed. Try a lower DPI or fewer pages."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("ocr-progress"));
    new D.UploadZone("#uz-ocr", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("ocr-pages").addEventListener("change", function () {
      el("ocr-range").hidden = this.value !== "custom";
    });
    el("ocr-apply").addEventListener("click", function () { runOCR(false); });
    el("ocr-text-only").addEventListener("click", function () { runOCR(true); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();