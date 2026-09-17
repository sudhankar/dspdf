/**
 * JPG → PDF — uses pdf-lib on main thread (simpler than a worker for image work).
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFLIB_URL = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";

  var items = []; // { id, file, name, size, width, height, bytes, mime }
  var nextId = 1;
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function render() {
    var list = el("j2p-list");
    list.innerHTML = "";
    items.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "file-list__item";
      li.setAttribute("draggable", "true");
      li.setAttribute("data-id", it.id);
      li.innerHTML =
        '<span class="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>' +
        '<span class="file-list__name" title="' + escapeHtml(it.name) + '">' + escapeHtml(it.name) + '</span>' +
        '<span class="file-list__size">' + D.formatBytes(it.size) + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-remove="' + it.id + '" aria-label="Remove ' + escapeHtml(it.name) + '">✕</button>';
      list.appendChild(li);
    });
    var has = items.length > 0;
    el("j2p-options").hidden = !has;
    el("j2p-apply").disabled = !has;

    D.makeSortable(list, function (orderedIds) {
      var byId = {};
      items.forEach(function (it) { byId[it.id] = it; });
      items = orderedIds.map(function (id) { return byId[id]; }).filter(Boolean);
    });
  }

  async function addFiles(files) {
    D.clearAlert("j2p-alert");
    var added = 0, rejected = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var isImg = /^image\/(jpeg|png|webp)$/.test(f.type) ||
                  /\.(jpe?g|png|webp)$/i.test(f.name);
      if (!isImg) { rejected++; continue; }
      var bytes = new Uint8Array(await D.fileToArrayBuffer(f));
      var dims = await getImageDimensions(bytes, f.type);
      items.push({
        id: nextId++, file: f, name: f.name, size: f.size,
        width: dims.width, height: dims.height,
        bytes: bytes, mime: f.type || guessMime(f.name)
      });
      added++;
    }
    if (rejected) D.showError("j2p-alert", rejected + " file(s) skipped — only JPG, PNG, or WebP.");
    render();
  }

  function guessMime(name) {
    if (/\.png$/i.test(name)) return "image/png";
    if (/\.webp$/i.test(name)) return "image/webp";
    return "image/jpeg";
  }

  function getImageDimensions(bytes, mime) {
    return new Promise(function (resolve) {
      var blob = new Blob([bytes], { type: mime || "image/jpeg" });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth || 800, height: img.naturalHeight || 1000 });
        URL.revokeObjectURL(url);
      };
      img.onerror = function () {
        resolve({ width: 800, height: 1000 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  function pageSizePoints(name) {
    switch (name) {
      case "letter": return { w: 612, h: 792 };
      case "a4":     return { w: 595.28, h: 841.89 };
      default:       return null; // fit
    }
  }

  async function create() {
    if (!items.length) return;
    progressUI.show();
    progressUI.set(5, "Preparing…");
    try {
      await loadScript(PDFLIB_URL);
      var PDFLib = window.PDFLib;
      var pdf = await PDFLib.PDFDocument.create();

      var pageSize = el("j2p-pagesize").value;
      var orient = el("j2p-orient").value;
      var margin = Math.max(0, Math.min(60, parseInt(el("j2p-margin").value, 10) || 0));

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        progressUI.set(10 + (i / items.length) * 75, "Embedding image " + (i + 1) + " / " + items.length);

        var img;
        if (it.mime === "image/png") img = await pdf.embedPng(it.bytes);
        else img = await pdf.embedJpg(await convertToJpeg(it));

        var dims;
        if (pageSize === "fit") {
          dims = { w: img.width, h: img.height };
        } else {
          var ps = pageSizePoints(pageSize);
          var landscape = orient === "landscape" ||
            (orient === "auto" && it.width > it.height);
          dims = landscape ? { w: ps.h, h: ps.w } : { w: ps.w, h: ps.h };
        }

        var page = pdf.addPage([dims.w, dims.h]);
        // Fit image into page minus margin, preserve aspect
        var maxW = dims.w - margin * 2;
        var maxH = dims.h - margin * 2;
        var scale = Math.min(maxW / img.width, maxH / img.height);
        var drawW = img.width * scale;
        var drawH = img.height * scale;
        var x = margin + (maxW - drawW) / 2;
        var y = margin + (maxH - drawH) / 2;
        page.drawImage(img, { x: x, y: y, width: drawW, height: drawH });
      }

      progressUI.set(90, "Building PDF…");
      var bytes = await pdf.save({ useObjectStreams: true });
      var blob = new Blob([bytes], { type: "application/pdf" });
      var name = "dspdf-images-" + Date.now() + ".pdf";
      D.downloadBlob(blob, name);
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved " + name, "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("j2p-alert", D.humanError(err, "Could not create the PDF."));
    }
  }

  /**
   * Non-JPEG images (PNG handled directly, WebP converted here) get re-encoded
   * to JPEG on a canvas so pdf-lib can embed them.
   */
  function convertToJpeg(it) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([it.bytes], { type: it.mime });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (outBlob) {
          URL.revokeObjectURL(url);
          outBlob.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject);
        }, "image/jpeg", 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not load image.")); };
      img.src = url;
    });
  }

  function init() {
    progressUI = new D.ProgressUI(el("j2p-progress"));
    new D.UploadZone("#uz-j2p", {
      accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
      multiple: true,
      onFiles: addFiles
    });
    el("j2p-apply").addEventListener("click", create);
    el("j2p-list").addEventListener("click", function (e) {
      var id = e.target.getAttribute && e.target.getAttribute("data-remove");
      if (!id) return;
      items = items.filter(function (it) { return String(it.id) !== id; });
      render();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();