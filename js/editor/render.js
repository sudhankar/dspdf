/**
 * DSPDF Editor — Renderer
 * -----------------------
 * Renders the current PDF page to canvas via pdf.js and drives the DOM
 * overlay showing interactive elements. Rendering is throttled and cached.
 */
(function () {
  "use strict";

  var Ed = window.DSPDFEditor;
  var state = Ed.state;
  var log = window.dspdfLog || function () {};

  var canvas = null;
  var ctx = null;
  var overlayLayer = null;
  var hitLayer = null;
  var wrap = null;
  var viewport = null;

  var pageCache = {}; // { pageIndex: { width, height, scale } }
  var renderTask = null;
  var renderToken = 0;

  function init() {
    canvas = document.getElementById("ed-pdf-canvas");
    ctx = canvas ? canvas.getContext("2d", { alpha: false }) : null;
    overlayLayer = document.getElementById("ed-overlay");
    hitLayer = document.getElementById("ed-hitlayer");
    wrap = document.getElementById("ed-canvas-wrap");
    viewport = document.getElementById("ed-viewport");

    window.addEventListener("resize", debounce(handleResize, 100));
    if(window.visualViewport) window.visualViewport.addEventListener("resize", debounce(handleResize, 100));
    if (window.ResizeObserver && viewport) {
      var resizeTimer = null;
      var ro = new ResizeObserver(function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (!state.pdfDoc) return;
          // Mobile layout can settle one or two frames after the PDF is opened.
          // Refit the current page when the real viewport dimensions become known.
          if (state.view.fitMode === "page") renderCurrentPage();
          else if (state.view.fitMode === "width") fitWidth();
        }, 80);
      });
      ro.observe(viewport);
    }
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  function handleResize() {
    if (!state.pdfDoc) return;
    if (state.view.fitMode === "page") fitPage();
    else if (state.view.fitMode === "width") fitWidth();
  }

  /**
   * Get the PDF page dimensions in PDF points for a given page.
   */
  async function getPageMetrics(pageIndex) {
    if (pageCache[pageIndex]) return pageCache[pageIndex];
    var page = await state.pdfDoc.getPage(pageIndex + 1);
    var vp = page.getViewport({ scale: 1 });
    pageCache[pageIndex] = { width: vp.width, height: vp.height };
    return pageCache[pageIndex];
  }

  async function waitForStableViewport(){
    if(!viewport) return;
    for(var i=0;i<4;i++){
      await new Promise(function(resolve){requestAnimationFrame(resolve);});
    }
    // Mobile browser chrome/fonts can change the layout a little after the
    // first paint. Give it a short settling window before measuring.
    await new Promise(function(resolve){setTimeout(resolve,80);});
  }

  /**
   * Render current page to the visible canvas.
   */
  async function renderCurrentPage() {
    if (!state.pdfDoc) return;
    var myToken = ++renderToken;

    var page = await state.pdfDoc.getPage(state.pageIndex + 1);
    if (myToken !== renderToken) return; // stale

    var vpNatural = page.getViewport({ scale: 1 });
    var vr = viewport.getBoundingClientRect();
    var availableW = Math.max(1, Math.floor(vr.width || viewport.clientWidth) - (window.matchMedia && window.matchMedia("(max-width: 900px)").matches ? 16 : 40));
    var availableH = Math.max(1, Math.floor(vr.height || viewport.clientHeight) - 20);
    // If the first layout pass has not produced a real viewport yet, retry
    // instead of rendering a cropped page that only fixes itself after paging.
    if(state.view.fitMode === "page" && (availableW < 120 || availableH < 120)){
      await waitForStableViewport();
      if(myToken !== renderToken)return;
      vr=viewport.getBoundingClientRect();
      availableW=Math.max(1,Math.floor(vr.width||viewport.clientWidth)-16);
      availableH=Math.max(1,Math.floor(vr.height||viewport.clientHeight)-20);
    }

    var scale = state.view.zoom;
    if (state.view.fitMode === "width") {
      scale = Math.max(0.25, availableW / vpNatural.width);
      state.view.zoom = scale;
    } else if (state.view.fitMode === "page") {
      var sx = availableW / vpNatural.width;
      var sy = availableH / vpNatural.height;
      scale = Math.max(0.25, Math.min(sx, sy));
      state.view.zoom = scale;
    }

    var dpr = window.devicePixelRatio || 1;
    var vp = page.getViewport({ scale: scale });

    // Canvas backing size
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    // CSS size
    canvas.style.width = Math.floor(vp.width) + "px";
    canvas.style.height = Math.floor(vp.height) + "px";
    wrap.style.width = Math.floor(vp.width) + "px";
    wrap.style.height = Math.floor(vp.height) + "px";

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, vp.width, vp.height);

    if (renderTask) { try { renderTask.cancel(); } catch (e) {} }
    renderTask = page.render({
      canvasContext: ctx,
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    });

    try {
      await renderTask.promise;
    } catch (err) {
      if (err && err.name !== "RenderingCancelledException") log("render err", err);
    }

    updateZoomIndicator();
  }

  function updateZoomIndicator() {
    var el = document.getElementById("ed-zoom-val");
    if (el) el.textContent = Math.round(state.view.zoom * 100) + "%";
    var cur = document.getElementById("ed-page-cur");
    var tot = document.getElementById("ed-page-total");
    if (cur) cur.textContent = String(state.pageIndex + 1);
    if (tot) tot.textContent = String(state.pageCount);
  }

  /* ---------- Overlay rendering ---------- */

  /**
   * Rebuild overlay DOM from state.overlays[state.pageIndex].
   * Called on every state change. For our scale (dozens of elements)
   * a full rebuild is simpler and correct.
   */
  function renderOverlays() {
    if (!overlayLayer || !wrap) return;
    var list = state.overlays[state.pageIndex] || [];
    // Clear all children
    overlayLayer.innerHTML = "";

    var wPx = parseFloat(wrap.style.width) || wrap.clientWidth;
    var hPx = parseFloat(wrap.style.height) || wrap.clientHeight;

    list.forEach(function (el) {
      var node = createElementNode(el, wPx, hPx);
      if (!node) return;
      overlayLayer.appendChild(node);
    });

    // Re-apply selection classes
    updateSelectionClasses();
  }

  function pxFromNorm(n, total) { return n * total; }

  function createElementNode(el, wPx, hPx) {
    var node = document.createElement("div");
    node.className = "ed-elem";
    node.dataset.type = el.type;
    node.dataset.id = el.id;
    node.style.position = "absolute";
    node.style.left = pxFromNorm(el.x, wPx) + "px";
    node.style.top = pxFromNorm(el.y, hPx) + "px";
    node.style.width = pxFromNorm(el.w, wPx) + "px";
    node.style.height = pxFromNorm(el.h, hPx) + "px";
    if (el.rotation) node.style.transform = "rotate(" + el.rotation + "deg)";

    if (el.type === "text") {
      var content = document.createElement("div");
      content.className = "ed-text-content";
      content.textContent = el.text || "Text";
      content.style.color = el.color || "#000";
      content.style.fontSize = fontSizePx(el, hPx) + "px";
      content.style.fontWeight = el.bold ? "700" : "400";
      content.style.fontFamily = mapFont(el.font);
      content.style.textAlign = el.align || "left";
      node.appendChild(content);
    } else if (el.type === "image") {
      var img = document.createElement("img");
      img.src = el.dataUrl;
      img.alt = "";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.style.pointerEvents = "none";
      node.appendChild(img);
    } else if (el.type === "highlight" || el.type === "redact") {
      node.style.background = el.type === "redact" ? "#000" : (el.color || "#FDE047");
      node.style.opacity = String((el.opacity != null ? el.opacity : 0.45));
      node.style.mixBlendMode = el.type === "highlight" ? "multiply" : "normal";
      node.style.borderRadius = "2px";
    } else if (el.type === "rect") {
      node.style.border = (el.strokeWidth || 2) + "px solid " + (el.stroke || "#2563EB");
      if (el.fill) node.style.background = el.fill;
    } else if (el.type === "ellipse") {
      node.style.border = (el.strokeWidth || 2) + "px solid " + (el.stroke || "#2563EB");
      node.style.borderRadius = "50%";
      if (el.fill) node.style.background = el.fill;
    } else if (el.type === "line" || el.type === "arrow") {
      node.innerHTML = svgLine(el, wPx, hPx);
      node.style.background = "transparent";
      node.style.border = "none";
    } else if (el.type === "draw") {
      node.innerHTML = svgPath(el, wPx, hPx);
      node.style.background = "transparent";
      node.style.border = "none";
    } else if (el.type === "signature") {
      var simg = document.createElement("img");
      simg.src = el.dataUrl;
      simg.alt = "signature";
      simg.style.width = "100%";
      simg.style.height = "100%";
      simg.style.objectFit = "contain";
      simg.style.pointerEvents = "none";
      node.appendChild(simg);
    }

    // Selection handles
    if (state.selectedId === el.id) {
      ["nw", "ne", "sw", "se"].forEach(function (h) {
        var handle = document.createElement("span");
        handle.className = "ed-handle";
        handle.dataset.h = h;
        node.appendChild(handle);
      });
      var del = document.createElement("span");
      del.className = "ed-delete";
      del.title = "Delete";
      del.textContent = "✕";
      del.setAttribute("role", "button");
      del.setAttribute("aria-label", "Delete element");
      node.appendChild(del);
    }

    return node;
  }

  function svgLine(el, wPx, hPx) {
    var w = wPx, h = hPx;
    var x1 = el.x1 != null ? el.x1 * w : 0;
    var y1 = el.y1 != null ? el.y1 * h : 0;
    var x2 = el.x2 != null ? el.x2 * w : w;
    var y2 = el.y2 != null ? el.y2 * h : h;
    var marker = el.type === "arrow"
      ? '<defs><marker id="arw-' + el.id + '" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="' + (el.stroke || "#2563EB") + '"/></marker></defs>'
      : "";
    var arrowAttr = el.type === "arrow" ? ' marker-end="url(#arw-' + el.id + ')"' : "";
    return '<svg width="100%" height="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="pointer-events:none;">' +
      marker +
      '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (el.stroke || "#2563EB") + '" stroke-width="' + (el.strokeWidth || 2) + '"' + arrowAttr + '/>' +
      '</svg>';
  }

  function svgPath(el, wPx, hPx) {
    if (!el.points || !el.points.length) return "";
    var d = "M";
    el.points.forEach(function (p, i) {
      var x = p[0] * wPx, y = p[1] * hPx;
      d += (i === 0 ? " " : " L ") + x + " " + y;
    });
    return '<svg width="100%" height="100%" viewBox="0 0 ' + wPx + ' ' + hPx + '" preserveAspectRatio="none" style="pointer-events:none;">' +
      '<path d="' + d + '" fill="none" stroke="' + (el.color || "#EF4444") + '" stroke-width="' + (el.strokeWidth || 3) + '" stroke-opacity="' + (el.opacity != null ? el.opacity : 1) + '" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function fontSizePx(el, hPx) {
    // Font size is stored in PDF points (8..72).
    // Convert: PDF point = 1/72 inch. Page height in points = hPx / (72/scale)?
    // Simpler: store fontSize in points and compute pixel size relative to
    // the current page's rendered height divided by its point height.
    // We approximate: page point height ≈ hPx / (state.view.zoom). Wait —
    // we store element.h as normalized height of a line box.
    // The simplest correct mapping: fontPx = el.fontSize * (hPx / pageHeightPts) * 72/72
    // We use a metric we set at render time.
    var ph = el._pageHeightPts || 792;
    return Math.max(6, (el.fontSize || 16) * (hPx / ph));
  }

  function mapFont(name) {
    if (name === "TimesRoman") return '"Times New Roman", Times, serif';
    if (name === "Courier") return '"Courier New", Courier, monospace';
    return "Helvetica, Arial, sans-serif";
  }

  function updateSelectionClasses() {
    var nodes = overlayLayer.querySelectorAll(".ed-elem");
    nodes.forEach(function (n) {
      n.classList.toggle("is-selected", n.dataset.id === state.selectedId);
    });
  }

  function fitWidth() {
    state.view.fitMode = "width";
    renderCurrentPage().then(renderOverlays);
  }
  function fitPage() {
    state.view.fitMode = "page";
    renderCurrentPage().then(renderOverlays);
  }
  function setZoom(z) {
    state.view.fitMode = "manual";
    state.view.zoom = Math.max(0.25, Math.min(4, z));
    renderCurrentPage().then(renderOverlays);
  }

  function invalidatePageCache() { pageCache = {}; }

  window.DSPDFEditorRender = {
    init: init,
    renderCurrentPage: renderCurrentPage,
    renderOverlays: renderOverlays,
    fitWidth: fitWidth,
    fitPage: fitPage,
    setZoom: setZoom,
    updateZoomIndicator: updateZoomIndicator,
    getPageMetrics: getPageMetrics,
    invalidatePageCache: invalidatePageCache
  };
})();