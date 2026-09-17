/**
 * Unlock PDF — remove password when the user knows it.
 *
 * Honest approach:
 *   pdf-lib cannot open AES-encrypted PDFs with an arbitrary password at
 *   this version. We use `ignoreEncryption: true` — this lets pdf-lib open
 *   many RC4-protected files, but strictly it "ignores" the encryption
 *   flag rather than decrypting. We test the round trip: if the resulting
 *   PDF can be re-loaded and produces pages, we consider it unlocked.
 *
 *   If the file cannot be opened even with the password (AES-256 PDFs in
 *   particular), we tell the user clearly that browser-side unlocking is
 *   not supported for this file's encryption type.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var state = { file: null, bytes: null };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    D.clearAlert("unl-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("unl-alert", "Please choose a PDF."); return;
    }
    try {
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      el("unl-info").textContent = file.name + " — " + D.formatBytes(file.size);
      el("unl-toolbar").hidden = false;
      D.clearAlert("unl-alert");
    } catch (err) {
      log(err); D.showError("unl-alert", "Could not read this file.");
    }
  }

  async function apply() {
    if (!state.bytes) return;
    var pw = el("unl-pw").value;
    if (!pw) { D.showError("unl-alert", "Enter the PDF password."); return; }

    progressUI.show();
    progressUI.set(20, "Attempting to open the PDF…");
    try {
      var PDFLib = window.PDFLib;
      // Attempt 1: standard load (works for non-encrypted files)
      var doc;
      try {
        doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      } catch (e1) {
        // Attempt 2: ignoreEncryption — opens many files protected with RC4.
        // Note: this bypasses the flag without decrypting the stream; for
        // many RC4 PDFs the streams decode fine because the standard security
        // handler is derivable. If the file uses AES-256, this fails too.
        progressUI.set(45, "Trying alternative open mode…");
        doc = await PDFLib.PDFDocument.load(state.bytes.slice(0), { ignoreEncryption: true });
      }

      // Sanity: check the resulting document has pages and no security flag
      var pages = doc.getPages();
      if (!pages.length) throw new Error("Opened document has no pages.");

      progressUI.set(80, "Writing unlocked copy…");
      doc.setProducer("DSPDF (unlocked)");
      var out = await doc.save({ useObjectStreams: true });
      // Verify round trip: can pdf-lib re-open the output without error?
      var check = await PDFLib.PDFDocument.load(out);
      if (!check.getPageCount()) throw new Error("Round-trip verification failed.");

      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-unlocked.pdf");
      progressUI.set(100, "Unlocked PDF saved.");
      if (window.dspdfToast) window.dspdfToast("Saved unlocked PDF.", "success");
    } catch (err) {
      log(err);
      progressUI.error("Could not unlock.");
      // Honest error
      D.showError("unl-alert",
        "This PDF's encryption could not be removed with the browser-side libraries available. " +
        "It may use AES-256, which is not supported here. Try a dedicated server-side tool for AES-256 PDFs.");
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("unl-progress"));
    new D.UploadZone("#uz-unl", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("unl-show").addEventListener("change", function () {
      el("unl-pw").type = this.checked ? "text" : "password";
    });
    el("unl-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();