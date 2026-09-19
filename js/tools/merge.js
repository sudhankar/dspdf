/**
 * Merge PDF — client-side via pdf-lib worker.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var files = []; // { id, file, name, size }
  var nextId = 1;
  var worker = null;
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function ensureWorker() {
    if (worker) return worker;
    worker = D.createPdfWorker();
    return worker;
  }

  var previewToken = 0;
  async function updatePreview() {
    var token = ++previewToken;
    var host = el("merge-preview");
    if (!host) return;
    host.innerHTML = files.length ? '<p class="text-muted">Preview (first page of each PDF, in merge order):</p><div class="preview-pdf-strip" id="merge-preview-strip"></div>' : '';
    if (!files.length) return;
    var strip = el("merge-preview-strip");
    for (var i=0;i<files.length;i++) {
      if (token !== previewToken) return;
      var item=document.createElement("div"); item.className="preview-pdf-item";
      item.innerHTML='<canvas></canvas><small>PDF '+(i+1)+' — '+escapeHtml(files[i].name)+'</small>'; strip.appendChild(item);
      try {
        if (!window.pdfjsLib) throw new Error("Preview engine is still loading.");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        var bytes=new Uint8Array(await D.fileToArrayBuffer(files[i].file));
        var doc=await window.pdfjsLib.getDocument({data:bytes.slice(0), disableWorker:true}).promise;
        var page=await doc.getPage(1), vp=page.getViewport({scale:0.85}), c=item.querySelector("canvas");
        c.width=vp.width;c.height=vp.height;
        await page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;
      } catch(e) { item.querySelector("small").textContent="PDF "+(i+1)+" — preview unavailable"; log("merge preview",e); }
    }
  }

  function render() {
    var list = el("merge-list");
    var bar = el("merge-toolbar");
    var btn = el("merge-btn");
    var count = el("merge-count");
    list.innerHTML = "";
    files.forEach(function (f) {
      var li = document.createElement("li");
      li.className = "file-list__item";
      li.setAttribute("draggable", "true");
      li.setAttribute("data-id", f.id);
      li.innerHTML =
        '<span class="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>' +
        '<span class="file-list__name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</span>' +
        '<span class="file-list__size">' + D.formatBytes(f.size) + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-remove="' + f.id + '" aria-label="Remove ' + escapeHtml(f.name) + '">✕</button>';
      list.appendChild(li);
    });

    bar.hidden = files.length === 0;
    count.textContent = files.length + (files.length === 1 ? " file" : " files");
    btn.disabled = files.length < 2;

    D.makeSortable(list, function (orderedIds) {
      var byId = {};
      files.forEach(function (f) { byId[f.id] = f; });
      files = orderedIds.map(function (id) { return byId[id]; }).filter(Boolean);
      log("Reordered:", files.map(function (f) { return f.name; }));
      updatePreview();
    });
    updatePreview();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function addFiles(newFiles) {
    if (progressUI) progressUI.reset();
    var added = 0, rejected = 0;
    newFiles.forEach(function (f) {
      var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!isPdf) { rejected++; return; }
      files.push({ id: nextId++, file: f, name: f.name, size: f.size });
      added++;
    });
    D.clearAlert("merge-alert");
    if (rejected > 0) D.showError("merge-alert", rejected + " file(s) skipped — only PDFs can be merged.");
    if (added > 0) D.showInfo("merge-alert", added + " file(s) added.");
    render();
  }

  async function merge() {
    if (files.length < 2) return;
    var btn = el("merge-btn");
    btn.disabled = true;
    D.clearAlert("merge-alert");
    progressUI.show();
    progressUI.set(2, "Reading files…");

    try {
      var buffers = [];
      for (var i = 0; i < files.length; i++) {
        var buf = await D.fileToArrayBuffer(files[i].file);
        buffers.push(buf);
        progressUI.set(2 + (i + 1) / files.length * 20, "Reading file " + (i + 1) + " of " + files.length + "…");
      }
      progressUI.set(25, "Merging in worker…");

      var result = await D.runPdfOperation("merge", { buffers: buffers });

      progressUI.set(90, "Preparing download…");
      var blob = new Blob([result.bytes], { type: "application/pdf" });
      var name = "dspdf-merged-" + Date.now() + ".pdf";
      D.downloadBlob(blob, name);
      progressUI.set(100, "Done — check your downloads.");
      if (window.dspdfToast) window.dspdfToast("Merged PDF saved as " + name, "success");
    } catch (err) {
      progressUI.error("Merge failed.");
      D.showError("merge-alert", D.humanError(err, "Could not merge these PDFs. One file may be encrypted or corrupted."));
    } finally {
      btn.disabled = files.length < 2;
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("merge-progress"));
    new D.UploadZone("#uz-merge", {
      accept: "application/pdf,.pdf",
      multiple: true,
      onFiles: addFiles
    });
    el("merge-btn").addEventListener("click", merge);
    el("merge-clear").addEventListener("click", function () {
      files = []; render(); D.clearAlert("merge-alert"); progressUI.hide();
    });
    el("merge-list").addEventListener("click", function (e) {
      var id = e.target.getAttribute && e.target.getAttribute("data-remove");
      if (!id) return;
      files = files.filter(function (f) { return String(f.id) !== id; });
      render();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();