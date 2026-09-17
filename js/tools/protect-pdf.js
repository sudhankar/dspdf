/**
 * Protect PDF — password protection using pdf-lib.
 *
 * IMPORTANT / HONEST:
 *   pdf-lib 1.17.1 does NOT expose a public API for adding user/owner
 *   passwords to an existing PDF. Its `save()` method does not accept
 *   encryption options in the public API.
 *
 *   We could not claim to "encrypt" if we can't genuinely encrypt. So this
 *   implementation does one of the following, honestly:
 *
 *   1. If the loaded pdf-lib build exposes an experimental save option
 *      (some builds do via `PDFDocument.prototype.encrypt`), we use it.
 *   2. If not available, we tell the user clearly that client-side
 *      encryption is not supported by the current library, and offer
 *      to instead rasterize the PDF (image-only, no text layer, harder
 *      to extract content from) as a partial protection.
 *
 *   We never claim encryption if we didn't actually encrypt.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var state = { file: null, bytes: null, pageCount: 0, pdfDocJs: null };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    D.clearAlert("prot-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("prot-alert", "Please choose a PDF."); return;
    }
    el("prot-toolbar").hidden = true;
    D.showInfo("prot-alert", "Loading…");
    try {
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      // Load with pdf.js just to count pages (also for rasterize fallback)
      var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      state.pdfDocJs = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDocJs.numPages;
      el("prot-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("prot-toolbar").hidden = false;
      D.clearAlert("prot-alert");
    } catch (err) {
      log(err); D.showError("prot-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  function checkPdfLibEncryptionSupport() {
    // Detect if this pdf-lib build exposes any encryption API.
    if (!window.PDFLib || !window.PDFLib.PDFDocument) return false;
    // Some builds expose PDFDocument.prototype.encrypt
    var proto = window.PDFLib.PDFDocument.prototype;
    return typeof proto.encrypt === "function";
  }

  async function rasterizeOnly() {
    // Fallback: rasterize pages, no text layer. Not true encryption but
    // removes searchable/extractable text.
    var PDFLib = window.PDFLib;
    var doc = await PDFLib.PDFDocument.create();
    for (var i = 0; i < state.pageCount; i++) {
      var page = await state.pdfDocJs.getPage(i + 1);
      var vp = page.getViewport({ scale: 1.5 });
      var canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      var dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      var b64 = dataUrl.split(",")[1];
      var bin = atob(b64);
      var imgBytes = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) imgBytes[j] = bin.charCodeAt(j);
      var img = await doc.embedJpg(imgBytes);
      var pageSize = page.getViewport({ scale: 1 });
      var newPage = doc.addPage([pageSize.width, pageSize.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
      progressUI.set(15 + ((i + 1) / state.pageCount) * 70, "Rasterizing page " + (i + 1) + " / " + state.pageCount);
    }
    doc.setProducer("DSPDF");
    return doc;
  }

  async function apply() {
    if (!state.bytes) return;
    var pw = el("prot-pw").value;
    var pw2 = el("prot-pw2").value;
    if (!pw || pw.length < 6) { D.showError("prot-alert", "Password must be at least 6 characters."); return; }
    if (pw !== pw2) { D.showError("prot-alert", "Passwords do not match."); return; }

    progressUI.show();
    progressUI.set(10, "Preparing…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));

      var canEncrypt = checkPdfLibEncryptionSupport();

      if (canEncrypt) {
        progressUI.set(40, "Encrypting…");
        doc.encrypt({ userPassword: pw, ownerPassword: pw, permissions: {} });
        var encBytes = await doc.save({ useObjectStreams: true });
        var blob = new Blob([encBytes], { type: "application/pdf" });
        var base = (state.file.name || "document").replace(/\.pdf$/i, "");
        D.downloadBlob(blob, base + "-protected.pdf");
        progressUI.set(100, "Encrypted PDF saved.");
        if (window.dspdfToast) window.dspdfToast("Saved encrypted PDF.", "success");
      } else {
        // Honest fallback: we cannot truly encrypt with this pdf-lib build.
        progressUI.set(35, "Encryption API not available in this build.");
        var proceed = window.confirm(
          "Client-side PDF encryption is not supported by the current library build in your browser.\n\n" +
          "Would you like to receive a 'rasterized PDF' instead? This converts each page to an image and removes selectable/searchable text — a partial protection, not true encryption.\n\n" +
          "Or press Cancel to keep your original file unchanged."
        );
        if (!proceed) {
          progressUI.hide();
          D.showInfo("prot-alert", "Nothing changed. Your original file is untouched.");
          return;
        }
        progressUI.set(45, "Rasterizing pages…");
        var rasterized = await rasterizeOnly();
        var out = await rasterized.save({ useObjectStreams: true });
        var blob2 = new Blob([out], { type: "application/pdf" });
        var base2 = (state.file.name || "document").replace(/\.pdf$/i, "");
        D.downloadBlob(blob2, base2 + "-rasterized.pdf");
        progressUI.set(100, "Rasterized PDF saved. Note: this is not encrypted.");
        if (window.dspdfToast) window.dspdfToast("Saved rasterized PDF (not encrypted).", "info");
      }
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("prot-alert", D.humanError(err, "Could not protect this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("prot-progress"));
    new D.UploadZone("#uz-prot", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("prot-show").addEventListener("change", function () {
      el("prot-pw").type = this.checked ? "text" : "password";
      el("prot-pw2").type = this.checked ? "text" : "password";
    });
    el("prot-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();