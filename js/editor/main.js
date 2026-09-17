/**
 * DSPDF Editor — Main
 * -------------------
 * Wires UI controls to state, render, tools, interactions, and export.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var Ed = window.DSPDFEditor;
  var state = Ed.state;
  var R = window.DSPDFEditorRender;
  var T = window.DSPDFEditorTools;
  var I = window.DSPDFEditorInteractions;
  var E = window.DSPDFEditorExport;
  var log = window.dspdfLog || function () {};

  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  function el(id) { return document.getElementById(id); }
  function on(sel, ev, fn) { document.querySelectorAll(sel).forEach(function (n) { n.addEventListener(ev, fn); }); }

  /* ---------- Load PDF ---------- */
  async function loadPdf(file) {
    D.clearAlert("ed-empty-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("ed-empty-alert", "Please choose a PDF.");
      return;
    }
    try {
      if (!window.pdfjsLib) throw new Error("pdf.js not loaded yet. Please try again in a moment.");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      var pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

      Ed.reset({
        file: file,
        originalBytes: bytes,
        pdfDoc: pdfDoc,
        pageCount: pdfDoc.numPages
      });

      el("ed-filename").textContent = file.name;
      el("ed-empty").hidden = true;
      el("ed-viewport").hidden = false;
      el("ed-bottombar").hidden = false;
      el("ed-save").disabled = false;
      el("edm-save").disabled = false;

      await R.renderCurrentPage();
      R.renderOverlays();
      buildThumbnails();
    } catch (err) {
      log(err);
      D.showError("ed-empty-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  /* ---------- Thumbnails ---------- */
  var thumbCache = {};
  async function buildThumbnails() {
    var host = el("ed-thumbs");
    host.innerHTML = "";
    for (var p = 0; p < state.pageCount; p++) {
      var d = document.createElement("div");
      d.className = "ed-thumb";
      d.dataset.page = String(p);
      d.innerHTML = '<canvas></canvas><div class="ed-thumb__num">' + (p + 1) + '</div>';
      host.appendChild(d);
    }
    // Render lazily (sequential)
    for (var i = 0; i < state.pageCount; i++) {
      await renderThumb(i);
    }
    highlightActiveThumb();
    Ed.on("page", highlightActiveThumb);
  }

  async function renderThumb(pageIdx) {
    try {
      var page = await state.pdfDoc.getPage(pageIdx + 1);
      var vp = page.getViewport({ scale: 0.28 });
      var c = el("ed-thumbs").querySelector('[data-page="' + pageIdx + '"] canvas');
      if (!c) return;
      c.width = vp.width; c.height = vp.height;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (err) { log("thumb err", err); }
  }
  function highlightActiveThumb() {
    el("ed-thumbs").querySelectorAll(".ed-thumb").forEach(function (n) {
      n.classList.toggle("is-active", Number(n.dataset.page) === state.pageIndex);
    });
  }

  /* ---------- Save ---------- */
  function openSaveModal() {
    if (!state.originalBytes) return;
    el("save-modal").classList.add("is-open");
  }
  function closeSaveModal() { el("save-modal").classList.remove("is-open"); }

  async function doSave() {
    var flatten = el("save-flatten").checked;
    closeSaveModal();
    var saveBtn = el("ed-save");
    var saveBtn2 = el("edm-save");
    var prev1 = saveBtn.textContent, prev2 = saveBtn2.textContent;
    saveBtn.disabled = saveBtn2.disabled = true;
    saveBtn.textContent = "Exporting…";
    saveBtn2.textContent = "…";
    try {
      var bytes = await E.exportPdf({ flatten: flatten });
      var blob = new Blob([bytes], { type: "application/pdf" });
      var base = (state.file && state.file.name || "document").replace(/\.pdf$/i, "");
      var name = "dspdf-edited-" + base + ".pdf";
      D.downloadBlob(blob, name);
      if (window.dspdfToast) window.dspdfToast("Saved " + name, "success");
    } catch (err) {
      log(err);
      if (window.dspdfToast) window.dspdfToast(D.humanError(err, "Export failed."), "error");
    } finally {
      saveBtn.disabled = saveBtn2.disabled = false;
      saveBtn.textContent = prev1;
      saveBtn2.textContent = prev2;
    }
  }

  /* ---------- Tool panel ---------- */
  function initToolTabs() {
    document.querySelectorAll(".ed-tool-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".ed-tool-tab").forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var name = tab.dataset.panel;
        document.querySelectorAll(".editor-panel").forEach(function (p) {
          p.classList.toggle("is-active", p.dataset.panelId === name);
        });
      });
    });
  }

  function activateTool(tool, btn) {
    Ed.setActiveTool(tool);
    document.querySelectorAll(".ed-tool-btn").forEach(function (b) { b.classList.remove("is-active"); });
    if (btn) btn.classList.add("is-active");
    I.setDrawingMode(tool !== null);
    // Show relevant property panels
    var map = {
      text: "props-text",
      rect: "props-shape", ellipse: "props-shape", line: "props-shape", arrow: "props-shape"
    };
    ["props-text", "props-shape"].forEach(function (id) {
      var on = (map[tool] === id);
      el(id).hidden = !on;
    });
  }

  function initToolButtons() {
    document.querySelectorAll(".ed-tool-btn[data-tool]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tool = btn.dataset.tool;
        if (tool === "sign-draw" || tool === "sign-type" || tool === "sign-upload") {
          handleSignTool(tool);
          return;
        }
        if (btn.classList.contains("is-active")) {
          activateTool(null, null);
        } else {
          activateTool(tool, btn);
        }
      });
    });
    document.getElementById("image-pick").addEventListener("click", function () {
      document.getElementById("image-file").click();
    });
    document.getElementById("image-file").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) handleImageUpload(f);
      e.target.value = "";
    });
    document.getElementById("sign-file").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) readSignatureFile(f);
      e.target.value = "";
    });
    document.getElementById("draw-clear-page").addEventListener("click", function () {
      var list = state.overlays[state.pageIndex] || [];
      var remaining = list.filter(function (el) { return el.type !== "draw"; });
      state.overlays[state.pageIndex] = remaining;
      Ed.pushHistory();
      Ed.emit("change");
    });
  }

  /* ---------- Image upload ---------- */
  async function handleImageUpload(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      D.showError("ed-empty-alert", "Please choose a PNG, JPG, or WebP image.");
      return;
    }
    var dataUrl = await D.fileToDataURL(file);
    // If WebP, re-encode to PNG for pdf-lib embed compatibility
    if (file.type === "image/webp") {
      dataUrl = await reEncodeToPng(dataUrl);
    }
    var img = await loadImage(dataUrl);
    var aspect = img.naturalWidth / img.naturalHeight;
    var metrics = await R.getPageMetrics(state.pageIndex);
    T.makeImage({ x: 0.15, y: 0.15 }, dataUrl, aspect, {
      pageWidthPts: metrics.width,
      pageHeightPts: metrics.height,
      w: 0.3
    });
    if (window.dspdfToast) window.dspdfToast("Image added. Drag to position.", "success");
  }

  function reEncodeToPng(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      };
      img.src = dataUrl;
    });
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var i = new Image();
      i.onload = function () { resolve(i); };
      i.onerror = reject;
      i.src = src;
    });
  }

  /* ---------- Signature tools ---------- */
  function handleSignTool(kind) {
    var modal = document.getElementById("sign-modal");
    var body = document.getElementById("sign-modal-body");
    body.innerHTML = "";
    if (kind === "sign-draw") buildDrawPad(body);
    else if (kind === "sign-type") buildTypePad(body);
    else if (kind === "sign-upload") { document.getElementById("sign-file").click(); return; }
    modal.classList.add("is-open");
  }

  function buildDrawPad(body) {
    body.innerHTML =
      '<p class="text-muted">Sign with mouse, finger, or stylus.</p>' +
      '<div class="sign-pad"><canvas id="sign-pad-canvas"></canvas></div>' +
      '<div style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-sm" id="sign-pad-clear">Clear</button></div>';
    var pad = body.querySelector(".sign-pad");
    var canvas = body.querySelector("#sign-pad-canvas");
    var dpr = window.devicePixelRatio || 1;
    var rect = pad.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#0F172A";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    var drawing = false;
    var hasInk = false;
    canvas.addEventListener("pointerdown", function (e) {
      drawing = true; hasInk = true;
      canvas.setPointerCapture(e.pointerId);
      var p = pointerPos(e, canvas, rect);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var p = pointerPos(e, canvas, rect);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      canvas.addEventListener(ev, function () { drawing = false; });
    });
    body.querySelector("#sign-pad-clear").addEventListener("click", function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
    });
    // store a getter so confirm can read
    body._getSignature = function () {
      if (!hasInk) return null;
      return { dataUrl: canvas.toDataURL("image/png"), aspect: rect.width / rect.height };
    };
  }

  function pointerPos(e, canvas, rect) {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function buildTypePad(body) {
    body.innerHTML =
      '<p class="text-muted">Type your name — we\'ll render it in a signature-style font.</p>' +
      '<input type="text" class="sign-type-input" id="sign-type-text" placeholder="Your name" />' +
      '<div class="sign-font-choice">' +
      '<button type="button" class="is-active" data-font="Dancing Script">Dancing Script</button>' +
      '<button type="button" data-font="Caveat">Caveat</button>' +
      '<button type="button" data-font="Georgia">Serif</button>' +
      '</div>';
    var chosen = "Dancing Script";
    body.querySelectorAll(".sign-font-choice button").forEach(function (b) {
      b.addEventListener("click", function () {
        body.querySelectorAll(".sign-font-choice button").forEach(function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active");
        chosen = b.dataset.font;
      });
    });
    body._getSignature = function () {
      var text = (body.querySelector("#sign-type-text").value || "").trim();
      if (!text) return null;
      var family = chosen === "Georgia" ? '"Times New Roman", serif' : '"' + chosen + '", cursive';
      // For Georgia we keep the raw name — but we still need an image.
      // renderTypedSignature handles fonts. We pass the resolved family.
      return new Promise(function (resolve) {
        T.renderTypedSignature(text, family, "#0F172A").then(resolve);
      });
    };
  }

  async function readSignatureFile(file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      if (window.dspdfToast) window.dspdfToast("Use PNG or JPG for the signature image.", "error");
      return;
    }
    var dataUrl = await D.fileToDataURL(file);
    var img = await loadImage(dataUrl);
    var aspect = img.naturalWidth / img.naturalHeight;
    var metrics = await R.getPageMetrics(state.pageIndex);
    T.makeSignature({ x: 0.2, y: 0.35 }, dataUrl, aspect, {
      pageWidthPts: metrics.width,
      pageHeightPts: metrics.height,
      w: 0.28
    });
    if (window.dspdfToast) window.dspdfToast("Signature placed. Drag to position.", "success");
  }

  function initSignModal() {
    var modal = document.getElementById("sign-modal");
    var body = document.getElementById("sign-modal-body");
    document.getElementById("sign-cancel").addEventListener("click", function () {
      modal.classList.remove("is-open");
    });
    document.getElementById("sign-confirm").addEventListener("click", async function () {
      var getter = body._getSignature;
      if (!getter) { modal.classList.remove("is-open"); return; }
      var result = await getter();
      if (!result) { if (window.dspdfToast) window.dspdfToast("Please create a signature first.", "error"); return; }
      modal.classList.remove("is-open");
      var metrics = await R.getPageMetrics(state.pageIndex);
      T.makeSignature({ x: 0.2, y: 0.4 }, result.dataUrl, result.aspect, {
        pageWidthPts: metrics.width,
        pageHeightPts: metrics.height,
        w: 0.28
      });
      if (window.dspdfToast) window.dspdfToast("Signature placed. Drag to position.", "success");
    });
  }

  /* ---------- Property bindings ---------- */
  function initProps() {
    // Text props
    document.getElementById("text-size").addEventListener("input", function () {
      document.getElementById("text-size-val").textContent = this.value;
      var el = Ed.getSelected();
      if (el && el.type === "text") Ed.updateElement(el.id, { fontSize: parseInt(this.value, 10) });
    });
    ["text-color", "text-font", "text-align", "text-bold"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function () {
        var sel = Ed.getSelected();
        if (!sel || sel.type !== "text") return;
        var patch = {};
        if (id === "text-color") patch.color = document.getElementById("text-color").value;
        if (id === "text-font") patch.font = document.getElementById("text-font").value;
        if (id === "text-align") patch.align = document.getElementById("text-align").value;
        if (id === "text-bold") patch.bold = document.getElementById("text-bold").checked;
        Ed.updateElement(sel.id, patch);
      });
    });

    // Shape props
    ["shape-stroke", "shape-fill", "shape-fill-on", "shape-width"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function () {
        var sel = Ed.getSelected();
        if (!sel || (sel.type !== "rect" && sel.type !== "ellipse" && sel.type !== "line" && sel.type !== "arrow")) return;
        var patch = {};
        if (id === "shape-stroke") patch.stroke = document.getElementById("shape-stroke").value;
        if (id === "shape-fill") patch.fill = document.getElementById("shape-fill").value;
        if (id === "shape-fill-on") {
          patch.fill = document.getElementById("shape-fill-on").checked
            ? document.getElementById("shape-fill").value : null;
        }
        if (id === "shape-width") {
          patch.strokeWidth = parseInt(document.getElementById("shape-width").value, 10);
          document.getElementById("shape-width-val").textContent = this.value;
        }
        Ed.updateElement(sel.id, patch);
      });
    });

    // Draw props
    ["draw-color", "draw-width"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function () {
        if (id === "draw-width") {
          document.getElementById("draw-width-val").textContent = this.value;
        }
      });
    });

    // Mark props
    ["mark-color", "mark-opacity"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", function () {
        if (id === "mark-opacity") {
          document.getElementById("mark-opacity-val").textContent = this.value + "%";
        }
        var sel = Ed.getSelected();
        if (!sel || (sel.type !== "highlight" && sel.type !== "redact")) return;
        var patch = {};
        if (id === "mark-color" && sel.type === "highlight") patch.color = document.getElementById("mark-color").value;
        if (id === "mark-opacity") patch.opacity = parseInt(document.getElementById("mark-opacity").value, 10) / 100;
        Ed.updateElement(sel.id, patch);
      });
    });
  }

  /* ---------- Freehand drawing (points) ---------- */
  function initDrawing() {
    var hit = document.getElementById("ed-hitlayer");
    var wrap = document.getElementById("ed-canvas-wrap");
    var drawing = false;
    var pts = [];

    hit.addEventListener("pointerdown", function (e) {
      if (state.activeTool !== "draw") return;
      drawing = true;
      pts = [];
      var rect = wrap.getBoundingClientRect();
      pts.push([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
      hit.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var rect = wrap.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      pts.push([x, y]);
      drawTempPath(pts);
    });

    function finish() {
      if (!drawing) return;
      drawing = false;
      clearTempPath();
      if (pts.length >= 2) {
        T.makeDraw(pts, {
          color: document.getElementById("draw-color").value,
          strokeWidth: parseInt(document.getElementById("draw-width").value, 10)
        });
      }
      pts = [];
    }
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  var tempPath = null;
  function drawTempPath(pts) {
    var wrap = document.getElementById("ed-canvas-wrap");
    var rect = wrap.getBoundingClientRect();
    if (!tempPath) {
      tempPath = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      tempPath.style.cssText = "position:absolute;inset:0;pointer-events:none;width:100%;height:100%;";
      tempPath.setAttribute("viewBox", "0 0 " + rect.width + " " + rect.height);
      document.getElementById("ed-overlay").appendChild(tempPath);
    }
    tempPath.innerHTML = "";
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    var d = "";
    pts.forEach(function (p, i) {
      d += (i === 0 ? "M" : " L ") + (p[0] * rect.width) + " " + (p[1] * rect.height);
    });
    path.setAttribute("d", d);
    path.setAttribute("stroke", document.getElementById("draw-color").value);
    path.setAttribute("stroke-width", document.getElementById("draw-width").value);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    tempPath.appendChild(path);
  }
  function clearTempPath() {
    if (tempPath && tempPath.parentNode) tempPath.parentNode.removeChild(tempPath);
    tempPath = null;
  }

  /* ---------- Bottom bar / navigation / zoom ---------- */
  function initBottomBar() {
    document.getElementById("ed-prev").addEventListener("click", function () {
      if (state.pageIndex > 0) Ed.setPage(state.pageIndex - 1);
    });
    document.getElementById("ed-next").addEventListener("click", function () {
      if (state.pageIndex < state.pageCount - 1) Ed.setPage(state.pageIndex + 1);
    });
    document.getElementById("ed-zoom-in").addEventListener("click", function () {
      R.setZoom(state.view.zoom * 1.2);
    });
    document.getElementById("ed-zoom-out").addEventListener("click", function () {
      R.setZoom(state.view.zoom / 1.2);
    });
    document.getElementById("ed-zoom-fit").addEventListener("click", function () { R.fitWidth(); });

    Ed.on("page", async function () {
      R.renderCurrentPage();
      highlightActiveThumb();
    });
    Ed.on("change", function () { R.renderOverlays(); });

    document.getElementById("ed-thumbs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-page]");
      if (!t) return;
      Ed.setPage(Number(t.dataset.page));
      document.querySelector(".editor-thumbs").classList.remove("is-open");
    });
  }

  /* ---------- Undo/redo buttons ---------- */
  function initHistoryButtons() {
    document.getElementById("ed-undo").addEventListener("click", function () { Ed.undo(); });
    document.getElementById("ed-redo").addEventListener("click", function () { Ed.redo(); });
    document.getElementById("edm-undo").addEventListener("click", function () { Ed.undo(); });
    document.getElementById("edm-redo").addEventListener("click", function () { Ed.redo(); });
  }

  /* ---------- Mobile drawers ---------- */
  function initMobile() {
    document.getElementById("edm-thumbs").addEventListener("click", function () {
      document.querySelector(".editor-thumbs").classList.toggle("is-open");
    });
    document.getElementById("edm-tools").addEventListener("click", function () {
      document.querySelector(".editor-tools").classList.toggle("is-open");
    });
    document.getElementById("ed-thumb-close").addEventListener("click", function () {
      document.querySelector(".editor-thumbs").classList.remove("is-open");
    });
    document.getElementById("ed-tools-close").addEventListener("click", function () {
      document.querySelector(".editor-tools").classList.remove("is-open");
    });
  }

  /* ---------- Load flow ---------- */
  function initUpload() {
    new D.UploadZone("#ed-upload-zone", {
      accept: "application/pdf,.pdf",
      multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
  }

  /* ---------- Save modal ---------- */
  function initSave() {
    document.getElementById("ed-save").addEventListener("click", openSaveModal);
    document.getElementById("edm-save").addEventListener("click", openSaveModal);
    document.getElementById("save-cancel").addEventListener("click", closeSaveModal);
    document.getElementById("save-confirm").addEventListener("click", doSave);
    window.addEventListener("dspdf:save", openSaveModal);
    document.getElementById("save-modal").addEventListener("click", function (e) {
      if (e.target === this) closeSaveModal();
    });
    document.getElementById("sign-modal").addEventListener("click", function (e) {
      if (e.target === this) this.classList.remove("is-open");
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    R.init();
    I.init();
    initUpload();
    initToolTabs();
    initToolButtons();
    initProps();
    initDrawing();
    initBottomBar();
    initHistoryButtons();
    initMobile();
    initSave();
    initSignModal();
    // Undo/redo disabled state on history change
    Ed.on("change", function () {
      document.getElementById("ed-undo").disabled = state.historyIndex <= 0;
      document.getElementById("ed-redo").disabled = state.historyIndex >= state.history.length - 1;
      document.getElementById("edm-undo").disabled = state.historyIndex <= 0;
      document.getElementById("edm-redo").disabled = state.historyIndex >= state.history.length - 1;
    });
    // Initial render
    Ed.on("change", function () { R.renderOverlays(); });
    R.renderOverlays();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();