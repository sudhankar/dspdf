/**
 * Sign PDF — draw/type/upload a signature, click to place, export.
 * Single signature per session (simple and honest).
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = {
    file: null, bytes: null, pdfDoc: null, pageCount: 0,
    currentPage: 0, sigDataUrl: null, sigAspect: 2.5,
    placement: null  // { x, y } in normalized page coords
  };
  var progressUI = null;
  var renderInfo = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    D.clearAlert("sign-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("sign-alert", "Please choose a PDF."); return;
    }
    el("sign-toolbar").hidden = true;
    D.showInfo("sign-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayInputOrBuffer(file));
      state.file = file;
      state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      state.currentPage = 0;
      el("sign-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("sign-toolbar").hidden = false;
      D.clearAlert("sign-alert");
      if (state.sigDataUrl) await showCanvas();
    } catch (err) {
      log(err); D.showError("sign-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  // helper: since engine only exposes fileToArrayBuffer, wrap
  async function fileToArrayBuffer(file) { return D.fileToArrayBuffer(file); }
  // fix the typo above at runtime:
  D.fileToArrayInputOrBuffer = D.fileToArrayBuffer;

  async function showCanvas() {
    el("sign-canvas-wrap").hidden = false;
    var page = await state.pdfDoc.getPage(state.currentPage + 1);
    var vp = page.getViewport({ scale: 1.8 });
    var canvas = el("sign-page-canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    // draw any existing placement
    if (state.placement) drawPlacement(ctx, canvas);
  }

  function drawPlacement(ctx, canvas) {
    if (!state.placement) return;
    var sigW = canvas.width * 0.2;
    var sigH = sigW / state.sigAspect;
    var x = state.placement.x * canvas.width - sigW / 2;
    var y = state.placement.y * canvas.height - sigH / 2;
    if (state.sigDataUrl) {
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, x, y, sigW, sigH);
      };
      img.src = state.sigDataUrl;
    }
  }

  function initPlacement() {
    var canvas = el("sign-page-canvas");
    if (!canvas) return;
    canvas.addEventListener("click", async function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      state.placement = { x: x, y: y };
      // Refresh canvas
      await showCanvas();
      el("sign-save").disabled = false;
    });
  }

  /* ---------- Modal helpers ---------- */
  function openModal(id) { el(id).classList.add("is-open"); }
  function closeModal(id) { el(id).classList.remove("is-open"); }
  document.addEventListener("click", function (e) {
    if (e.target.matches("[data-close-modal]")) {
      var m = e.target.closest(".modal");
      if (m) m.classList.remove("is-open");
    }
    if (e.target.classList.contains("modal")) e.target.classList.remove("is-open");
  });

  /* ---------- Draw pad ---------- */
  function initDrawPad() {
    var pad = document.querySelector(".sign-pad");
    var canvas = el("sig-pad-canvas");
    var dpr = window.devicePixelRatio || 1;
    function resize() {
      var rect = pad.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      var ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = "#0F172A";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    // Delay size setup until modal is open
    var observer = new MutationObserver(function () {
      if (el("sig-draw-modal").classList.contains("is-open")) {
        resize();
      }
    });
    observer.observe(el("sig-draw-modal"), { attributes: true });

    var drawing = false, hasInk = false, rect;
    canvas.addEventListener("pointerdown", function (e) {
      rect = canvas.getBoundingClientRect();
      drawing = true; hasInk = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      var ctx = canvas.getContext("2d");
      ctx.beginPath();
      ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var ctx = canvas.getContext("2d");
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.stroke();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      canvas.addEventListener(ev, function () { drawing = false; });
    });
    el("sig-pad-clear").addEventListener("click", function () {
      var ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
    });
    el("sig-draw-confirm").addEventListener("click", function () {
      if (!hasInk) { if (window.dspdfToast) window.dspdfToast("Draw a signature first.", "error"); return; }
      state.sigDataUrl = canvas.toDataURL("image/png");
      state.sigAspect = canvas.width / canvas.height;
      el("sign-sig-img").src = state.sigDataUrl;
      el("sign-sig-preview").hidden = false;
      closeModal("sig-draw-modal");
      showCanvas();
    });
  }

  /* ---------- Type signature ---------- */
  function initTypePad() {
    var chosen = "Dancing Script";
    document.querySelectorAll(".sign-font-choice button").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".sign-font-choice button").forEach(function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active");
        chosen = b.dataset.font;
      });
    });
    el("sig-type-confirm").addEventListener("click", function () {
      var text = (el("sig-type-text").value || "").trim();
      if (!text) { if (window.dspdfToast) window.dspdfToast("Type your name first.", "error"); return; }
      var family = chosen === "Georgia" ? '"Times New Roman", serif' : '"' + chosen + '", cursive';
      // Render to canvas
      var canvas = document.createElement("canvas");
      canvas.width = 600; canvas.height = 200;
      var ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#0F172A";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      var size = 90;
      function draw() {
        ctx.font = "700 " + size + "px " + family;
        var w = ctx.measureText(text).width;
        if (w > canvas.width * 0.9 && size > 20) {
          size -= 4;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          draw();
        } else {
          ctx.fillText(text, canvas.width / 2, canvas.height / 2);
          state.sigDataUrl = canvas.toDataURL("image/png");
          state.sigAspect = canvas.width / canvas.height;
          el("sign-sig-img").src = state.sigDataUrl;
          el("sign-sig-preview").hidden = false;
          closeModal("sig-type-modal");
          showCanvas();
        }
      }
      draw();
    });
  }

  /* ---------- Upload signature ---------- */
  function initUpload() {
    el("sign-upload-btn").addEventListener("click", function () {
      el("sign-upload-file").click();
    });
    el("sign-upload-file").addEventListener("change", async function (e) {
      var f = e.target.files[0]; if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) {
        if (window.dspdfToast) window.dspdfToast("Use a PNG or JPG image.", "error");
        return;
      }
      state.sigDataUrl = await D.fileToDataURL(f);
      var img = await loadImage(state.sigDataUrl);
      state.sigAspect = img.naturalWidth / img.naturalHeight;
      el("sign-sig-img").src = state.sigDataUrl;
      el("sign-sig-preview").hidden = false;
      showCanvas();
      e.target.value = "";
    });
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = rej;
      i.src = src;
    });
  }

  /* ---------- Save ---------- */
  function dataUrlToBytes(dataUrl) {
    var b64 = dataUrl.split(",")[1];
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function save() {
    if (!state.sigDataUrl || !state.placement) {
      D.showError("sign-alert", "Create a signature and click where to place it.");
      return;
    }
    progressUI.show();
    progressUI.set(20, "Embedding signature…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var bytes = dataUrlToBytes(state.sigDataUrl);
      var isPng = /^data:image\/png/.test(state.sigDataUrl);
      var img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      var pages = doc.getPages();
      var page = pages[state.currentPage];
      var size = page.getSize();
      var sigW = size.width * 0.2;
      var sigH = sigW / state.sigAspect;
      var x = state.placement.x * size.width - sigW / 2;
      var y = size.height - state.placement.y * size.height - sigH / 2;
      page.drawImage(img, { x: x, y: y, width: sigW, height: sigH });

      progressUI.set(80, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-signed.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved signed PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("sign-alert", D.humanError(err, "Could not sign this PDF."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("sign-progress"));
    new D.UploadZone("#uz-sign", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("sign-draw-btn").addEventListener("click", function () { openModal("sig-draw-modal"); });
    el("sign-type-btn").addEventListener("click", function () { openModal("sig-type-modal"); });
    el("sign-save").addEventListener("click", save);
    initDrawPad();
    initTypePad();
    initUpload();
    initPlacement();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();