/**
 * Header & Footer PDF — running text with {page} {total} {date} placeholders.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = { file: null, bytes: null, pageCount: 0, pdfDoc: null };
  var previewToken = 0;
  var progressUI = null;

  function el(id) { return document.getElementById(id); }
  function hexToRgb01(hex) {
    hex = (hex || "#666666").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(hex, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  function pdfRgb(hex) {
    var c = hexToRgb01(hex);
    return window.PDFLib.rgb(c.r, c.g, c.b);
  }
  function parseRange(str, max) {
    if (!str) return [];
    var out = [];
    str.split(",").forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var m = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = Math.max(1, parseInt(m[1], 10));
        var b = Math.min(max, parseInt(m[2], 10));
        for (var i = a; i <= b; i++) out.push(i - 1);
      } else {
        var s = parseInt(chunk, 10);
        if (s >= 1 && s <= max) out.push(s - 1);
      }
    });
    return out;
  }
  function applyPlaceholders(text, n, total, date) {
    return String(text)
      .replace(/\{page\}/g, n)
      .replace(/\{total\}/g, total)
      .replace(/\{date\}/g, date);
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  async function loadPdf(file) {
    D.clearAlert("hf-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("hf-alert", "Please choose a PDF."); return;
    }
    el("hf-toolbar").hidden = true;
    D.showInfo("hf-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file;
      state.bytes = bytes;
      var doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pdfDoc = doc;
      state.pageCount = doc.numPages;
      el("hf-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("hf-toolbar").hidden = false;
      D.clearAlert("hf-alert");
    } catch (err) {
      log(err); D.showError("hf-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  function computeX(align, pageW, margin, textW) {
    if (align === "left") return margin;
    if (align === "right") return pageW - margin - textW;
    return (pageW - textW) / 2;
  }


  async function updatePreview(){
    if(!state.pdfDoc)return;
    var token=++previewToken,host=el("hf-preview-pdf"),c=el("hf-preview-canvas");
    host.hidden=false;
    try{
      var page=await state.pdfDoc.getPage(1),vp=page.getViewport({scale:1.8});
      c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);c.style.width="100%";c.style.height="auto";
      var ctx=c.getContext("2d",{alpha:false});
      await page.render({canvasContext:ctx,viewport:vp}).promise;if(token!==previewToken)return;
      var fontSize=Math.max(6,Math.min(48,parseInt(el("hf-size").value,10)||10));
      if(el("hf-size-val"))el("hf-size-val").textContent=fontSize+" pt";
      var fontName=el("hf-font").value,family=fontName==="TimesRoman"?"Times New Roman":fontName==="Courier"?"Courier New":"Arial";
      ctx.save();ctx.font="700 "+(fontSize*vp.scale)+"px "+family;ctx.fillStyle=el("hf-color").value;ctx.textBaseline="alphabetic";
      var margin=(parseInt(el("hf-margin").value,10)||30)*vp.scale,total=state.pageCount,date=todayISO();
      if(el("hf-header-on").checked&&el("hf-header-text").value){var t=applyPlaceholders(el("hf-header-text").value,1,total,date),tw=ctx.measureText(t).width,x=computeX(el("hf-header-align").value,vp.width,margin,tw);ctx.fillText(t,x,margin+(fontSize*vp.scale));}
      if(el("hf-footer-on").checked&&el("hf-footer-text").value){var f=applyPlaceholders(el("hf-footer-text").value,1,total,date),fw=ctx.measureText(f).width,fx=computeX(el("hf-footer-align").value,vp.width,margin,fw);ctx.fillText(f,fx,vp.height-margin);}
      ctx.restore();
    }catch(e){log("header/footer preview",e)}
  }

  async function apply() {
    if (!state.bytes) return;
    var headerOn = el("hf-header-on").checked;
    var footerOn = el("hf-footer-on").checked;
    if (!headerOn && !footerOn) {
      D.showError("hf-alert", "Enable header or footer first."); return;
    }

    progressUI.show();
    progressUI.set(15, "Preparing…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));

      var fontName = el("hf-font").value;
      var font;
      if (fontName === "TimesRoman") font = await doc.embedFont(PDFLib.StandardFonts.TimesRoman);
      else if (fontName === "Courier") font = await doc.embedFont(PDFLib.StandardFonts.Courier);
      else font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

      var fontSize = parseInt(el("hf-size").value, 10) || 10;
      var color = pdfRgb(el("hf-color").value);
      var margin = parseInt(el("hf-margin").value, 10) || 30;
      var headerText = el("hf-header-text").value || "";
      var footerText = el("hf-footer-text").value || "";
      var headerAlign = el("hf-header-align").value;
      var footerAlign = el("hf-footer-align").value;

      var pageMode = el("hf-pages").value;
      var targets;
      if (pageMode === "all") { targets = []; for (var i = 0; i < state.pageCount; i++) targets.push(i); }
      else if (pageMode === "skip-first") { targets = []; for (var j = 1; j < state.pageCount; j++) targets.push(j); }
      else { targets = parseRange(el("hf-range").value, state.pageCount); }

      var total = state.pageCount;
      var date = todayISO();
      var pages = doc.getPages();

      for (var t = 0; t < targets.length; t++) {
        var pIdx = targets[t];
        var page = pages[pIdx];
        if (!page) continue;
        var size = page.getSize();

        if (headerOn && headerText) {
          var hTxt = applyPlaceholders(headerText, pIdx + 1, total, date);
          var hW = font.widthOfTextAtSize(hTxt, fontSize);
          var hX = computeX(headerAlign, size.width, margin, hW);
          var hY = size.height - margin - fontSize;
          page.drawText(hTxt, { x: hX, y: hY, size: fontSize, font: font, color: color });
        }
        if (footerOn && footerText) {
          var fTxt = applyPlaceholders(footerText, pIdx + 1, total, date);
          var fW = font.widthOfTextAtSize(fTxt, fontSize);
          var fX = computeX(footerAlign, size.width, margin, fW);
          var fY = margin;
          page.drawText(fTxt, { x: fX, y: fY, size: fontSize, font: font, color: color });
        }
        progressUI.set(15 + ((t + 1) / targets.length) * 65, "Processing page " + (pIdx + 1));
      }

      progressUI.set(85, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-header-footer.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved with header/footer", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("hf-alert", D.humanError(err, "Could not add header/footer."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("hf-progress"));
    new D.UploadZone("#uz-hf", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("hf-pages").addEventListener("change", function () {
      el("hf-range").hidden = this.value !== "custom";
    });
    el("hf-apply").addEventListener("click", apply);
    el("hf-preview-refresh").addEventListener("click", updatePreview);
    ["hf-header-on","hf-footer-on","hf-header-text","hf-footer-text","hf-header-align","hf-footer-align","hf-font","hf-size","hf-color","hf-margin","hf-pages","hf-range"].forEach(function(id){var n=el(id);if(n){n.addEventListener("input",updatePreview);n.addEventListener("change",updatePreview);}});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();