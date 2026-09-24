/**
 * PDF -> PNG — render pages via pdf.js and package them as a ZIP.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};
  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var state = { file: null, pdfDoc: null, pageCount: 0 };
  var progressUI = null;
  function el(id){ return document.getElementById(id); }
  function loadScript(src){
    return new Promise(function(resolve,reject){
      if(document.querySelector('script[src="'+src+'"]')) return resolve();
      var s=document.createElement("script"); s.src=src; s.onload=resolve; s.onerror=function(){reject(new Error("Could not load PDF renderer."));};
      document.head.appendChild(s);
    });
  }
  async function loadPdf(file){
    D.clearAlert("p2p-alert");
    if(!(file.type === "application/pdf" || /\\.pdf$/i.test(file.name))){ D.showError("p2p-alert","Please choose a PDF file."); return; }
    state.file=file; state.pdfDoc=null; state.pageCount=0;
    el("p2p-toolbar").hidden=true;
    D.showInfo("p2p-alert","Reading PDF…");
    try{
      await loadScript(PDFJS_URL);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
      var buf=await D.fileToArrayBuffer(file);
      state.pdfDoc=await window.pdfjsLib.getDocument({data:buf}).promise;
      state.pageCount=state.pdfDoc.numPages;
      el("p2p-info").textContent=file.name+" — "+state.pageCount+" page(s)";
      el("p2p-toolbar").hidden=false;
      D.clearAlert("p2p-alert");
    }catch(err){ log(err); D.showError("p2p-alert",D.humanError(err,"Could not open this PDF.")); }
  }
  function renderPage(pageNum,dpi){
    return state.pdfDoc.getPage(pageNum).then(function(page){
      var scale=dpi/72, vp=page.getViewport({scale:scale});
      var canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.floor(vp.width)); canvas.height=Math.max(1,Math.floor(vp.height));
      var ctx=canvas.getContext("2d",{alpha:false}); ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
      return page.render({canvasContext:ctx,viewport:vp}).promise.then(function(){
        return new Promise(function(resolve,reject){ canvas.toBlob(function(blob){ blob?resolve(blob):reject(new Error("PNG export failed.")); },"image/png"); });
      });
    });
  }
  async function convert(){
    if(!state.pdfDoc) return;
    var dpi=parseInt(el("p2p-dpi").value,10)||150;
    progressUI.show(); progressUI.set(2,"Preparing…");
    try{
      if(!window.JSZip) throw new Error("ZIP library is still loading. Please try again.");
      var zip=new window.JSZip();
      var base=(state.file.name||"document").replace(/\\.pdf$/i,"");
      for(var p=1;p<=state.pageCount;p++){
        var blob=await renderPage(p,dpi);
        var pad=String(p).padStart(String(state.pageCount).length,"0");
        zip.file(base+"-page-"+pad+".png",blob);
        progressUI.set(5+(p/state.pageCount)*82,"Rendered page "+p+" / "+state.pageCount);
      }
      var zipBlob=await zip.generateAsync({type:"blob"},function(meta){ progressUI.set(87+meta.percent*0.12,"Packaging ZIP… "+Math.round(meta.percent)+"%"); });
      D.downloadBlob(zipBlob,base+"-png.zip");
      progressUI.set(100,"Done — "+state.pageCount+" PNG(s) in ZIP.");
      if(window.dspdfToast) window.dspdfToast("Saved ZIP with "+state.pageCount+" image(s)","success");
    }catch(err){ log(err); progressUI.error("Conversion failed."); D.showError("p2p-alert",D.humanError(err,"Could not convert this PDF. Try a lower DPI.")); }
  }
  function init(){
    progressUI=new D.ProgressUI(el("p2p-progress"));
    new D.UploadZone("#uz-p2p",{accept:"application/pdf,.pdf",multiple:false,onFiles:function(files){if(files[0])loadPdf(files[0]);}});
    el("p2p-apply").addEventListener("click",convert);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
