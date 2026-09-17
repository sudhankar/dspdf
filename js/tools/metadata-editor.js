/**
 * Metadata Editor — read and write PDF info dictionary.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var state = { file: null, bytes: null, doc: null };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    D.clearAlert("meta-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("meta-alert", "Please choose a PDF."); return;
    }
    el("meta-toolbar").hidden = true;
    D.showInfo("meta-alert", "Loading…");
    try {
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      var PDFLib = window.PDFLib;
      state.doc = await PDFLib.PDFDocument.load(bytes.slice(0));

      el("meta-title").value = state.doc.getTitle() || "";
      el("meta-author").value = state.doc.getAuthor() || "";
      el("meta-subject").value = state.doc.getSubject() || "";
      el("meta-keywords").value = (state.doc.getKeywords() || "");
      el("meta-creator").value = state.doc.getCreator() || "";
      el("meta-producer").value = state.doc.getProducer() || "";
      el("meta-created").value = state.doc.getCreationDate() ? state.doc.getCreationDate().toISOString() : "";
      el("meta-modified").value = state.doc.getModificationDate() ? state.doc.getModificationDate().toISOString() : "";

      el("meta-info").textContent = file.name + " — " + D.formatBytes(file.size);
      el("meta-toolbar").hidden = false;
      D.clearAlert("meta-alert");
    } catch (err) {
      log(err); D.showError("meta-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function apply() {
    if (!state.doc) return;
    progressUI.show();
    progressUI.set(30, "Updating metadata…");
    try {
      var doc = state.doc;
      doc.setTitle(el("meta-title").value || "");
      doc.setAuthor(el("meta-author").value || "");
      doc.setSubject(el("meta-subject").value || "");
      // keywords expects a string in pdf-lib
      doc.setKeywords([el("meta-keywords").value || ""]);
      doc.setCreator(el("meta-creator").value || "");
      doc.setProducer(el("meta-producer").value || "");
      var created = el("meta-created").value;
      var modified = el("meta-modified").value;
      if (created) {
        var d1 = new Date(created);
        if (!isNaN(d1.getTime())) doc.setCreationDate(d1);
      }
      if (modified) {
        var d2 = new Date(modified);
        if (!isNaN(d2.getTime())) doc.setModificationDate(d2);
      }

      progressUI.set(75, "Building PDF…");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-metadata.pdf");
      progressUI.set(100, "Metadata saved.");
      if (window.dspdfToast) window.dspdfToast("Saved PDF with updated metadata.", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("meta-alert", D.humanError(err, "Could not save metadata."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("meta-progress"));
    new D.UploadZone("#uz-meta", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("meta-clear-all").addEventListener("click", function () {
      ["meta-title", "meta-author", "meta-subject", "meta-keywords", "meta-creator", "meta-producer", "meta-created", "meta-modified"]
        .forEach(function (id) { el(id).value = ""; });
    });
    el("meta-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();