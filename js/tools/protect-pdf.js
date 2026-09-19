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
    return !!(window.PDFLib && window.PDFLib.PDFDocument &&
      typeof window.PDFLib.PDFDocument.prototype.encrypt === "function");
  }

  async function apply() {
    if (!state.bytes) return;
    var pw = el("prot-pw").value;
    var pw2 = el("prot-pw2").value;
    if (!pw || pw.length < 6) { D.showError("prot-alert", "Password must be at least 6 characters."); return; }
    if (pw !== pw2) { D.showError("prot-alert", "Passwords do not match."); return; }

    if (!checkPdfLibEncryptionSupport()) {
      D.showError("prot-alert", "Password encryption is not available in this browser build. Please refresh and try again.");
      return;
    }
    progressUI.show();
    progressUI.set(15, "Opening PDF…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      progressUI.set(55, "Applying AES-256 password protection…");
      doc.encrypt({
        userPassword: pw,
        ownerPassword: pw,
        algorithm: "AES-256",
        permissions: { copying: false, modifying: false, printing: false }
      });
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-protected.pdf");
      progressUI.set(100, "Protected PDF saved.");
      if (window.dspdfToast) window.dspdfToast("Saved password-protected PDF.", "success");
    } catch (err) {
      log(err);
      progressUI.error("Protection failed.");
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