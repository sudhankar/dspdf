/**
 * Annotate PDF — sticky notes, preset stamps, freehand drawing.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var state = {
    file: null, bytes: null, pdfDoc: null,
    pageCount: 0, pageIndex: 0,
    annotations: {}, // pageIndex -> array of { type, ... }
    selectedIndex: -1, history: [], historyIndex: -1, stampImage: null
  };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  function hexToRgb01(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(hex, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  function pdfRgb(hex) {
    var c = hexToRgb01(hex);
    return window.PDFLib.rgb(c.r, c.g, c.b);
  }

  async function loadPdf(file) {
    if (progressUI) progressUI.reset();
    D.clearAlert("an-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("an-alert", "Please choose a PDF."); return;
    }
    el("an-toolbar").hidden = true;
    D.showInfo("an-alert", "Loading…");
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      state.pageIndex = 0;
      state.annotations = {}; state.selectedIndex=-1; state.history=[]; state.historyIndex=-1; state.stampImage=null;
      var stampFile = el("an-stamp-image"); if (stampFile) stampFile.value = "";
      pushHistory();
      el("an-info").textContent = file.name + " — " + state.pageCount + " page(s)";
      el("an-toolbar").hidden = false;
      D.clearAlert("an-alert");
      await renderPage();
      updateCount();
    } catch (err) {
      log(err); D.showError("an-alert", D.humanError(err, "Could not open this PDF."));
    }
  }

  var stampImageCache = {};
  async function getStampImage(src) {
    if (!src) return null;
    if (stampImageCache[src]) return stampImageCache[src];
    var im = await new Promise(function(resolve,reject){ var i=new Image(); i.onload=function(){resolve(i)}; i.onerror=reject; i.src=src; });
    stampImageCache[src]=im;
    return im;
  }

  async function renderPage() {
    var page = await state.pdfDoc.getPage(state.pageIndex + 1);
    var vp = page.getViewport({ scale: 1.8 });
    var canvas = el("an-canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    await drawAnnotations(ctx, canvas);
    el("an-page-label").textContent = (state.pageIndex + 1) + " / " + state.pageCount;
  }

  async function drawAnnotations(ctx, canvas) {
    var list = state.annotations[state.pageIndex] || [];
    for (var idx = 0; idx < list.length; idx++) {
      var a = list[idx];
      var selected = idx === state.selectedIndex;
      if (selected) { ctx.save(); ctx.strokeStyle="#2563EB"; ctx.lineWidth=2; }
      if (a.type === "note") {
        // Sticky note: colored square with fold
        var w = 40, h = 40;
        var x = a.x * canvas.width;
        var y = a.y * canvas.height;
        ctx.fillStyle = a.color || "#FDE047";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h - 10);
        ctx.lineTo(x + w - 10, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.stroke();
        // Text if short
        if (a.text) {
          ctx.fillStyle = "#111";
          ctx.font = "10px Helvetica, Arial, sans-serif";
          var lines = wrap(a.text, 34);
          lines.slice(0, 3).forEach(function (line, i) {
            ctx.fillText(line, x + 4, y + 14 + i * 11);
          });
        }
      } else if (a.type === "stamp") {
        var sw = (a.w || 0.20) * canvas.width;
        var sh = (a.h || 0.10) * canvas.height;
        var cx = a.x * canvas.width, cy = a.y * canvas.height;
        ctx.save();
        if(a.image){
          try {
            var im=await getStampImage(a.image);
            ctx.save();ctx.globalAlpha=.9;ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(im,cx-sw/2,cy-sh/2,sw,sh);ctx.restore();
          } catch(ex) { log("stamp image preview",ex); }
        } else {
          ctx.translate(cx, cy);
          var size=Math.max(12,Math.min(30,sh*.42));
          ctx.font="bold "+size+"px Helvetica, Arial, sans-serif";
          ctx.textAlign="center";ctx.textBaseline="middle";
          ctx.strokeStyle=a.color||"#EF4444";ctx.lineWidth=3;ctx.strokeRect(-sw/2,-sh/2,sw,sh);
          ctx.fillStyle=a.color||"#EF4444";ctx.fillText(a.text||"STAMP",0,0);
        }
        if(selected){ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle="#2563EB";ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.strokeRect(cx-sw/2,cy-sh/2,sw,sh);ctx.setLineDash([]);}
        ctx.restore();
      } else if (a.type === "draw") {
        var pts = a.points || [];
        if (pts.length < 2) return;
        ctx.strokeStyle = a.color || "#EF4444";
        ctx.lineWidth = a.width || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        pts.forEach(function (p, i) {
          var x = p[0] * canvas.width;
          var y = p[1] * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      if (selected) { ctx.restore(); }
    }
  }

  function wrap(text, maxChars) {
    var words = String(text).split(/\s+/);
    var lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (test.length > maxChars && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function updateCount() {
    var n = 0;
    Object.keys(state.annotations).forEach(function (k) { n += state.annotations[k].length; });
    el("an-count").textContent = n + " annotation" + (n === 1 ? "" : "s");
  }

  function snapshot(){ return JSON.stringify({annotations:state.annotations,pageIndex:state.pageIndex,selectedIndex:state.selectedIndex}); }
  function pushHistory(){ var snap=snapshot(); if(state.history[state.historyIndex]===snap)return; state.history=state.history.slice(0,state.historyIndex+1);state.history.push(snap);if(state.history.length>50)state.history.shift();state.historyIndex=state.history.length-1; }
  function restoreSnap(snap){ var d=JSON.parse(snap);state.annotations=d.annotations||{};state.pageIndex=d.pageIndex||0;state.selectedIndex=d.selectedIndex==null?-1:d.selectedIndex;renderPage();updateCount(); }

  function currentTool() {
    var checked=document.querySelector('input[name="an-tool"]:checked');
    return checked ? checked.value : null;
  }

  function setupInteractions() {
    var canvas = el("an-canvas");
    var drawing = false, pts = [], drag = null, drawLayer = null, dragLayer = null;
    var host = canvas.parentElement;
    host.style.position = "relative";
    function ensureDragLayer(){
      if(dragLayer)return dragLayer;
      dragLayer=document.createElement("canvas");
      dragLayer.id="an-drag-layer";
      dragLayer.style.cssText="position:absolute;left:12px;top:12px;pointer-events:none;z-index:4;display:none;";
      host.appendChild(dragLayer);
      return dragLayer;
    }
    function showDraggedAnnotation(a){
      var dl=ensureDragLayer(),ctx=dl.getContext("2d");
      dl.width=canvas.width;dl.height=canvas.height;
      dl.style.width=canvas.clientWidth+"px"; dl.style.height=canvas.clientHeight+"px";
      ctx.clearRect(0,0,dl.width,dl.height);
      if(a.type==="note"){var x=a.x*dl.width,y=a.y*dl.height,w=40,h=40;ctx.fillStyle=a.color||"#FDE047";ctx.fillRect(x,y,w,h);ctx.fillStyle="#111";ctx.font="10px Helvetica,Arial,sans-serif";(a.text?wrap(a.text,34):[]).slice(0,3).forEach(function(line,i){ctx.fillText(line,x+4,y+14+i*11);});}
      else if(a.type==="stamp"){var sw=(a.w||.20)*dl.width,sh=(a.h||.10)*dl.height,cx=a.x*dl.width,cy=a.y*dl.height;if(a.image){getStampImage(a.image).then(function(im){if(!dragLayer||dragLayer.style.display==="none")return;var cur=(state.annotations[state.pageIndex]||[])[drag?drag.index:-1]||a;var csw=(cur.w||.20)*dl.width,csh=(cur.h||.10)*dl.height,ccx=cur.x*dl.width,ccy=cur.y*dl.height;var c=dragLayer.getContext("2d");c.clearRect(0,0,dragLayer.width,dragLayer.height);c.globalAlpha=.9;c.drawImage(im,ccx-csw/2,ccy-csh/2,csw,csh);c.globalAlpha=1;});}else{ctx.save();ctx.strokeStyle=a.color||"#EF4444";ctx.lineWidth=3;ctx.strokeRect(cx-sw/2,cy-sh/2,sw,sh);ctx.fillStyle=a.color||"#EF4444";ctx.font="bold "+Math.max(12,Math.min(30,sh*.42))+"px Helvetica,Arial,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(a.text||"STAMP",cx,cy);ctx.restore();}}
      dl.style.display="block";
    }
    function hideDragLayer(){if(dragLayer){dragLayer.style.display="none";dragLayer.getContext("2d").clearRect(0,0,dragLayer.width,dragLayer.height);}}

    function ensureDrawLayer(){
      if(drawLayer)return drawLayer;
      drawLayer=document.createElement("canvas");
      drawLayer.id="an-draw-preview";
      drawLayer.style.cssText="position:absolute;left:12px;top:12px;pointer-events:none;z-index:3;";
      host.appendChild(drawLayer);
      return drawLayer;
    }
    function sizeDrawLayer(){
      if(!drawLayer)return;
      drawLayer.width=canvas.width;drawLayer.height=canvas.height;
      drawLayer.style.width=canvas.clientWidth+"px";drawLayer.style.height=canvas.clientHeight+"px";
    }
    function drawLive(){
      var lc=ensureDrawLayer(),ctx=lc.getContext("2d");sizeDrawLayer();ctx.clearRect(0,0,lc.width,lc.height);
      if(pts.length<2)return;ctx.strokeStyle=el("an-draw-color").value;ctx.lineWidth=parseInt(el("an-draw-width").value,10)||3;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();
      pts.forEach(function(p,i){var x=p[0]*lc.width,y=p[1]*lc.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    }
    function hitAnnotation(x,y){
      var list=state.annotations[state.pageIndex]||[];
      for(var i=list.length-1;i>=0;i--){var a=list[i],aw=a.type==="stamp"?(a.w||.20):.10,ah=a.type==="stamp"?(a.h||.10):.10;if(Math.abs((a.x||0)-x)<=aw/2+.03&&Math.abs((a.y||0)-y)<=ah/2+.03)return i;}
      return -1;
    }

    canvas.addEventListener("pointerdown", async function (e) {
      var rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height,tool=currentTool();
      if(tool==="draw"){
        drawing=true;pts=[[x,y]];ensureDrawLayer();sizeDrawLayer();drawLive();try{canvas.setPointerCapture(e.pointerId);}catch(err){}e.preventDefault();return;
      }
      var list=state.annotations[state.pageIndex]||[],found=hitAnnotation(x,y);
      if(found>=0){
        state.selectedIndex=found;var a=list[found];
        if(a.type==="stamp" || a.type==="note"){
          var halfW=a.type==="stamp"?(a.w||.20)/2:.06,halfH=a.type==="stamp"?(a.h||.10)/2:.06;
          var corner=a.type==="stamp" && Math.abs(x-(a.x||0))>halfW*.72&&Math.abs(y-(a.y||0))>halfH*.72;
          drag={kind:corner?"resize":"move",index:found,startX:x,startY:y,orig:JSON.parse(JSON.stringify(a)),pointerId:e.pointerId};
          showDraggedAnnotation(a);
          try{canvas.setPointerCapture(e.pointerId);}catch(err){}e.preventDefault();
          updateCount();el("an-save").disabled=false;
          return;
        }
        renderPage();updateCount();el("an-save").disabled=false;
        if(tool===null)return;
      }
      if(!state.annotations[state.pageIndex])state.annotations[state.pageIndex]=[];
      if(tool==="note"){
        state.annotations[state.pageIndex].push({type:"note",x:x,y:y,text:el("an-note-text").value||"",color:el("an-note-color").value});state.selectedIndex=state.annotations[state.pageIndex].length-1;pushHistory();document.querySelector('input[name="an-tool"][value="note"]').checked=false;
      }else if(tool==="stamp"){
        var preset=el("an-stamp-preset").value,text=preset==="custom"?el("an-stamp-custom").value:preset;if(!text)text="STAMP";
        var a={type:"stamp",x:x,y:y,text:text,color:el("an-stamp-color").value,w:.20,h:.10};
        if(state.stampImage){
          a.image=state.stampImage;
          try {
            var sim=await getStampImage(state.stampImage);
            var ratio=(sim.naturalWidth||sim.width||1)/(sim.naturalHeight||sim.height||1);
            a.h=Math.max(.03,Math.min(.75,(a.w*canvas.width)/(ratio*canvas.height)));
          } catch(ex) { log("stamp size",ex); }
        }
        state.annotations[state.pageIndex].push(a);state.selectedIndex=state.annotations[state.pageIndex].length-1;pushHistory();document.querySelector('input[name="an-tool"][value="stamp"]').checked=false;
      }
      renderPage();updateCount();el("an-save").disabled=false;
    });

    window.addEventListener("pointermove", function(e){
      var rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;
      if(drag){var a=state.annotations[state.pageIndex][drag.index];if(!a)return;if(drag.kind==="move"){a.x=Math.max(0,Math.min(1,drag.orig.x+(x-drag.startX)));a.y=Math.max(0,Math.min(1,drag.orig.y+(y-drag.startY)));}else{var nw=Math.max(.05,Math.min(1,Math.abs(x-drag.orig.x)*2));var aspect=(drag.orig.w||.20)/(drag.orig.h||.10);var nh=Math.max(.04,Math.min(1,nw/aspect));a.w=nw;a.h=nh;}showDraggedAnnotation(a);return;}
      if(!drawing)return;pts.push([x,y]);drawLive();e.preventDefault();
    });

    window.addEventListener("pointerup", function(e){
      if(drag){hideDragLayer();pushHistory();drag=null;renderPage();updateCount();el("an-save").disabled=false;return;}
      if(!drawing)return;drawing=false;
      if(pts.length>=2){if(!state.annotations[state.pageIndex])state.annotations[state.pageIndex]=[];state.annotations[state.pageIndex].push({type:"draw",points:pts.slice(),color:el("an-draw-color").value,width:parseInt(el("an-draw-width").value,10)||3});state.selectedIndex=state.annotations[state.pageIndex].length-1;pushHistory();}
      pts=[];if(drawLayer){drawLayer.getContext("2d").clearRect(0,0,drawLayer.width,drawLayer.height);}renderPage();updateCount();el("an-save").disabled=false;
    });
    window.addEventListener("resize",function(){if(drawLayer)sizeDrawLayer();});
  }

  async function save() {
    if (!state.bytes) return;
    progressUI.show();
    progressUI.set(20, "Applying annotations…");
    try {
      var PDFLib = window.PDFLib;
      var doc = await PDFLib.PDFDocument.load(state.bytes.slice(0));
      var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      var boldFont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      var pages = doc.getPages();
      var stampImages = {};
      var annKeys = Object.keys(state.annotations);
      for (var aki=0; aki<annKeys.length; aki++) {
        var alist=state.annotations[annKeys[aki]]||[];
        for(var ali=0; ali<alist.length; ali++){
          var aa=alist[ali];
          if(aa.type==="stamp" && aa.image){
            try{var ib64=aa.image.split(",")[1],ibin=atob(ib64),iba=new Uint8Array(ibin.length);for(var ii=0;ii<ibin.length;ii++)iba[ii]=ibin.charCodeAt(ii);stampImages[aa.image]=/data:image\/png/.test(aa.image)?await doc.embedPng(iba):await doc.embedJpg(iba);}catch(ex){log("stamp image",ex);}
          }
        }
      }

      Object.keys(state.annotations).forEach(function (k) {
        var pIdx = parseInt(k, 10);
        var page = pages[pIdx];
        if (!page) return;
        var size = page.getSize();
        state.annotations[k].forEach(function (a) {
          if (a.type === "note") {
            var nx = a.x * size.width;
            var ny = size.height - a.y * size.height - 40;
            var c = hexToRgb01(a.color);
            page.drawRectangle({
              x: nx, y: ny, width: 40, height: 40,
              color: PDFLib.rgb(c.r, c.g, c.b),
              borderColor: PDFLib.rgb(0.6, 0.6, 0.6),
              borderWidth: 0.5
            });
            if (a.text) {
              var lines = wrap(a.text, 34).slice(0, 3);
              lines.forEach(function (line, i) {
                page.drawText(line, {
                  x: nx + 3, y: ny + 40 - 12 - i * 10,
                  size: 7, font: font,
                  color: PDFLib.rgb(0.1, 0.1, 0.1)
                });
              });
            }
          } else if (a.type === "stamp") {
            if(a.image && stampImages[a.image]){
              var iobj=stampImages[a.image],iw=(a.w||.20)*size.width,ih=(a.h||.10)*size.height;
              page.drawImage(iobj,{x:a.x*size.width-iw/2,y:size.height-a.y*size.height-ih/2,width:iw,height:ih,opacity:.9});
              return;
            }
            var sx = a.x * size.width;
            var sy = size.height - a.y * size.height;
            var stampSize = 22;
            var text = a.text || "STAMP";
            var tw = boldFont.widthOfTextAtSize(text, stampSize);
            var boxW = tw + 24;
            var boxH = stampSize + 16;
            var c2 = hexToRgb01(a.color);
            page.drawRectangle({
              x: sx - boxW / 2, y: sy - boxH / 2,
              width: boxW, height: boxH,
              borderColor: PDFLib.rgb(c2.r, c2.g, c2.b),
              borderWidth: 3,
              opacity: 0,
              borderOpacity: 0.85
            });
            page.drawText(text, {
              x: sx - tw / 2, y: sy - stampSize / 3,
              size: stampSize, font: boldFont,
              color: PDFLib.rgb(c2.r, c2.g, c2.b),
              opacity: 0.9
            });
          } else if (a.type === "draw") {
            var pts = a.points || [];
            if (pts.length < 2) return;
            var c3 = hexToRgb01(a.color);
            for (var i = 1; i < pts.length; i++) {
              var p1 = pts[i - 1], p2 = pts[i];
              page.drawLine({
                start: { x: p1[0] * size.width, y: size.height - p1[1] * size.height },
                end:   { x: p2[0] * size.width, y: size.height - p2[1] * size.height },
                thickness: a.width || 3,
                color: PDFLib.rgb(c3.r, c3.g, c3.b)
              });
            }
          }
        });
      });

      progressUI.set(85, "Building PDF…");
      doc.setProducer("DSPDF");
      var out = await doc.save({ useObjectStreams: true });
      var blob = new Blob([out], { type: "application/pdf" });
      var base = (state.file.name || "document").replace(/\.pdf$/i, "");
      D.downloadBlob(blob, base + "-annotated.pdf");
      progressUI.set(100, "Done.");
      if (window.dspdfToast) window.dspdfToast("Saved annotated PDF", "success");
    } catch (err) {
      log(err);
      progressUI.error("Failed.");
      D.showError("an-alert", D.humanError(err, "Could not save annotations."));
    }
  }

  function init() {
    progressUI = new D.ProgressUI(el("an-progress"));
    new D.UploadZone("#uz-an", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    document.querySelectorAll('input[name="an-tool"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var t = currentTool();
        el("an-note-row").hidden = t !== "note";
        el("an-stamp-row").hidden = t !== "stamp";
        el("an-stamp-image-row").hidden = t !== "stamp";
        el("an-draw-row").hidden = t !== "draw";
        var imgOn=el("an-stamp-image-on"), imgFile=el("an-stamp-image"), imgPick=el("an-stamp-image-pick");
        imgOn.disabled = t !== "stamp";
        imgFile.disabled = t !== "stamp";
        imgPick.disabled = t !== "stamp" || !imgOn.checked;
        if(t !== "stamp") { imgOn.checked=false; }
      });
    });
    el("an-stamp-image-on").addEventListener("change", function(){ var pick=el("an-stamp-image-pick"); pick.disabled=!this.checked; if(this.checked) el("an-stamp-image").click(); else {state.stampImage=null;el("an-stamp-image-name").textContent="No image selected";} });
    el("an-stamp-image-pick").addEventListener("click", function(){ if(!this.disabled) el("an-stamp-image").click(); });
    el("an-stamp-image").addEventListener("change", async function(e){
      var f=e.target.files&&e.target.files[0]; if(!f)return;
      try { state.stampImage=await D.fileToDataURL(f); el("an-stamp-image-on").checked=true; el("an-stamp-image-pick").disabled=false; el("an-stamp-image-name").textContent=f.name; if(window.dspdfToast)window.dspdfToast("Stamp image selected.","success"); }
      catch(err){ log(err); }
      this.value="";
    });
    el("an-stamp-size").addEventListener("input", function () {
      var pct=parseInt(this.value,10)||20; el("an-stamp-size-val").textContent=pct+"%";
      var list=state.annotations[state.pageIndex]||[], a=list[state.selectedIndex];
      if(a && a.type==="stamp"){
        var ratio=(a.h&&a.w)?a.h/a.w:0.5; a.w=pct/100; a.h=Math.max(.03,Math.min(.8,a.w*ratio));
        showDraggedAnnotation(a); renderPage(); el("an-save").disabled=false;
      }
    });
    el("an-stamp-preset").addEventListener("change", function () {
      el("an-stamp-custom").hidden = this.value !== "custom";
    });
    el("an-draw-width").addEventListener("input", function () {
      el("an-draw-width-val").textContent = this.value;
    });
    el("an-prev").addEventListener("click", function () {
      if (state.pageIndex > 0) { state.pageIndex--; renderPage(); }
    });
    el("an-next").addEventListener("click", function () {
      if (state.pageIndex < state.pageCount - 1) { state.pageIndex++; renderPage(); }
    });
    el("an-undo").addEventListener("click", function () { if(state.historyIndex>0){state.historyIndex--;restoreSnap(state.history[state.historyIndex]);} });
    el("an-redo").addEventListener("click", function () { if(state.historyIndex<state.history.length-1){state.historyIndex++;restoreSnap(state.history[state.historyIndex]);} });
    el("an-delete").addEventListener("click", function () { var list=state.annotations[state.pageIndex]||[]; if(state.selectedIndex<0||!list[state.selectedIndex]){if(window.dspdfToast)window.dspdfToast("Select an annotation first.","error");return;} list.splice(state.selectedIndex,1);state.selectedIndex=-1;pushHistory();renderPage();updateCount(); });
    el("an-clear-page").addEventListener("click", function () {
      state.annotations[state.pageIndex] = []; state.selectedIndex=-1; pushHistory();
      renderPage();
      updateCount();
    });
    el("an-save").addEventListener("click", save);
    setupInteractions();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();