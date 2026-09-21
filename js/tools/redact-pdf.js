/**
 * Redact PDF — draw black boxes; optional rasterization for permanent redaction.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = {
    file: null, bytes: null, pdfDoc: null,
    pageCount: 0, pageIndex: 0,
    boxes: {}, // pageIndex -> array of {x,y,w,h,color}
    color: "#000000", thickness: 20
  };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    D.clearAlert("red-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("red-alert", "Please choose a PDF."); return;
    }
    el("red-toolbar").hidden = true;
    D.showInfo("red-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      state.pageIndex = 0;
      state.boxes = {};
      el("red-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("red-toolbar").hidden = false;
      D.clearAlert("red-alert");
      await renderPage();
      updateCount();
    } catch (err) {
      log(err); D.showError("red-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  async function renderPage() {
    var page = await state.pdfDoc.getPage(state.pageIndex + 1);
    var vp = page.getViewport({ scale: 1.8 });
    var canvas = el("red-canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    drawBoxes(ctx, canvas);
    el("red-page-label").textContent = (state.pageIndex + 1) + " / " + state.pageCount;
  }

  function drawBoxes(ctx, canvas) { var list=state.boxes[state.pageIndex]||[]; list.forEach(function(b){var pts=b.points||[];if(!pts.length)return;ctx.save();ctx.strokeStyle=b.color||"#000";ctx.lineWidth=b.thickness*(canvas.width/800);ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();pts.forEach(function(p,i){var x=p[0]*canvas.width,y=p[1]*canvas.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();ctx.restore();}); }

  function setupDrawing(){var canvas=el("red-canvas"),drawing=false,current=null,last=null;function point(e){var r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}function stroke(a,b){var ctx=canvas.getContext("2d");ctx.save();ctx.strokeStyle=state.color;ctx.lineWidth=state.thickness*(canvas.width/800);ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(a.x*canvas.width,a.y*canvas.height);ctx.lineTo(b.x*canvas.width,b.y*canvas.height);ctx.stroke();ctx.restore();}canvas.addEventListener("pointerdown",function(e){drawing=true;current={points:[],color:state.color,thickness:state.thickness};var p=point(e);current.points.push([p.x,p.y]);last=p;try{canvas.setPointerCapture(e.pointerId)}catch(_){}e.preventDefault();});canvas.addEventListener("pointermove",function(e){if(!drawing)return;var p=point(e),dx=p.x-last.x,dy=p.y-last.y;if(Math.hypot(dx,dy)<.002)return;current.points.push([p.x,p.y]);stroke(last,p);last=p;e.preventDefault();});["pointerup","pointercancel"].forEach(function(ev){canvas.addEventListener(ev,function(){if(!drawing)return;drawing=false;if(current){if(!state.boxes[state.pageIndex])state.boxes[state.pageIndex]=[];state.boxes[state.pageIndex].push(current);current=null;renderPage();updateCount();el("red-save").disabled=false;}last=null;});});}

  function updateCount() {
    var n = 0;
    Object.keys(state.boxes).forEach(function (k) { n += state.boxes[k].length; });
    el("red-count").textContent = n + " box" + (n === 1 ? "" : "es");
  }

  /* ---------- Rasterize entire PDF via canvas + rebuild ---------- */
  async function rasterizePdf() {
    var PDFLib = window.PDFLib;
    var doc = await PDFLib.PDFDocument.create();
    // For each page: render at 1.5x to canvas, embed as PNG, add as page.
    for (var i = 0; i < state.pageCount; i++) {
      var page = await state.pdfDoc.getPage(i + 1);
      var vp = page.getViewport({ scale: 1.8 });
      var canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      // Draw redaction boxes for this page
      var list = state.boxes[i] || [];
      list.forEach(function(b){var pts=b.points||[];if(!pts.length)return;ctx.save();ctx.strokeStyle=b.color||"#000";ctx.lineWidth=b.thickness*(canvas.width/800);ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();pts.forEach(function(p,i){var x=p[0]*canvas.width,y=p[1]*canvas.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();ctx.restore();});

      var dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      var b64 = dataUrl.split(",")[1];
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      var img = await doc.embedJpg(bytes);
      // Use original page size in points
      var pageSize = page.getViewport({ scale: 1 });
      var newPage = doc.addPage([pageSize.width, pageSize.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
      progressUI.set(15 + ((i + 1) / state.pageCount) * 70, "Rasterizing page " + (i + 1) + " / " + state.pageCount);
    }
    return doc;
  }

  async function save() {
    if (!state.bytes) return;
    var rasterize = el("red-rasterize").checked;
    progressUI.show();
    progressUI.set(10, rasterize ? "Rasterizing pages…" : "Applying boxes…");
    try {
      var PDFLib = window.PDFLib;
      var doc;

      if (rasterize) {
        doc = await rasterizePdf();
      } else {
        doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
        var pages = doc.getPages();
        Object.keys(state.boxes).forEach(function (k) {
          var pIdx = parseInt(k, 10);
          var page = pages[pIdx];
          if (!page) return;
          var size = page.getSize();
          state.boxes[k].forEach(function(b){var hex=(b.color||"#000000").replace("#","");var n=parseInt(hex,16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,bb=(n&255)/255,pts=b.points||[];for(var ii=1;ii<pts.length;ii++){var aa=pts[ii-1],cc=pts[ii];page.drawLine({start:{x:aa[0]*size.width,y:size.height-aa[1]*size.height},end:{x:cc[0]*size.width,y:size.height-cc[1]*size.height},thickness:b.thickness*(size.width/800),color:PDFLib.rgb(r,g,bb),opacity:1});}});
        });
      }

      progressUI.set(90, "Building PDF…");
      doc.setProducer("DSPDF");
      if (doc.setCreator) doc.setCreator("DSPDF Redact");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-redacted.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved redacted PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("red-alert", D.humanError(err, "Could not save."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("red-progress"));
    new D.UploadZone("#uz-red", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("red-color").addEventListener("input", function () { state.color = this.value; });
    el("red-thickness").addEventListener("input", function(){state.thickness=+this.value;el("red-thickness-val").textContent=this.value+" px";});
    el("red-prev").addEventListener("click", function () {
      if (state.pageIndex > 0) { state.pageIndex--; renderPage(); }
    });
    el("red-next").addEventListener("click", function () {
      if (state.pageIndex < state.pageCount - 1) { state.pageIndex++; renderPage(); }
    });
    el("red-undo").addEventListener("click", function () {
      var list = state.boxes[state.pageIndex];
      if (list && list.length) { list.pop(); renderPage(); updateCount(); }
    });
    el("red-clear-page").addEventListener("click", function () {
      state.boxes[state.pageIndex] = [];
      renderPage();
      updateCount();
    });
    el("red-clear-all").addEventListener("click", function () {
      state.boxes = {};
      renderPage();
      updateCount();
      el("red-save").disabled = true;
    });
    el("red-save").addEventListener("click", save);
    setupDrawing();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();