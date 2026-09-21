/**
 * Unlock PDF — remove password when the user knows it.
 *
 * Honest approach:
 *   pdf-lib cannot open AES-encrypted PDFs with an arbitrary password at
 *   this version. We use `ignoreEncryption: true` — this lets pdf-lib open
 *   many RC4-protected files, but strictly it "ignores" the encryption
 *   flag rather than decrypting. We test the round trip: if the resulting
 *   PDF can be re-loaded and produces pages, we consider it unlocked.
 *
 *   If the file cannot be opened even with the password (AES-256 PDFs in
 *   particular), we tell the user clearly that browser-side unlocking is
 *   not supported for this file's encryption type.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  var state = { file: null, bytes: null };
  var progressUI = null;

  function el(id) { return document.getElementById(id); }

  async function loadPdf(file) {
    if (progressUI) progressUI.reset();
    D.clearAlert("unl-alert");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      D.showError("unl-alert", "Please choose a PDF."); return;
    }
    try {
      var bytes = new Uint8Array(await D.fileToArrayBuffer(file));
      state.file = file; state.bytes = bytes;
      if(progressUI) progressUI.reset();
      el("unl-pw").value = "";
      el("unl-info").textContent = file.name + " — " + D.formatBytes(file.size);
      el("unl-toolbar").hidden = false;
      D.clearAlert("unl-alert");
    } catch (err) {
      log(err); D.showError("unl-alert", "Could not read this file.");
    }
  }

  var decryptEnginePromise = null;
  function ensureDecryptEngine(){
    if(window.PDFDecrypt && typeof window.PDFDecrypt.decryptPDF === "function") return Promise.resolve(true);
    if(decryptEnginePromise) return decryptEnginePromise;
    decryptEnginePromise = (async function(){
      // @pdfsmaller/pdf-decrypt publishes ESM/CJS files, not a UMD build.
      // The old /dist/pdf-decrypt.umd.js URL therefore always failed. Load the
      // real ESM entry through jsDelivr and expose the two functions globally.
      var urls=[
        "https://cdn.jsdelivr.net/npm/@pdfsmaller/pdf-decrypt@1.0.1/dist/index.mjs",
        "https://cdn.jsdelivr.net/npm/@localonlytools/pdf-decrypt@1.0.1/dist/index.mjs"
      ];
      for(var i=0;i<urls.length;i++){
        try{
          var mod=await import(urls[i]);
          if(mod && typeof mod.decryptPDF === "function"){
            window.PDFDecrypt={decryptPDF:mod.decryptPDF,isEncrypted:mod.isEncrypted};
            return true;
          }
        }catch(err){ log("decrypt engine load",err); }
      }
      return false;
    })();
    return decryptEnginePromise;
  }

  async function apply(){
    if(!state.bytes)return;var pw=el("unl-pw").value;if(!pw){D.showError("unl-alert","Enter the PDF password.");return}
    progressUI.show();
    progressUI.set(8,"Preparing decryption engine…");
    var ready=await ensureDecryptEngine();
    if(!ready){progressUI.error("Decryption engine unavailable.");D.showError("unl-alert","The browser decryption engine could not be loaded. Check your internet connection and try again.");return;}progressUI.set(20,"Checking PDF encryption…");
    try{
      if(window.PDFDecrypt.isEncrypted){var info=await window.PDFDecrypt.isEncrypted(new Uint8Array(state.bytes));if(!info.encrypted){D.showError("unl-alert","This PDF is not password-protected.");progressUI.reset();return;}}
      progressUI.set(45,"Decrypting PDF…");var out=await window.PDFDecrypt.decryptPDF(new Uint8Array(state.bytes),pw);if(!out||!out.length)throw new Error("No decrypted PDF was produced.");
      progressUI.set(85,"Preparing download…");var blob=new Blob([out],{type:"application/pdf"}),base=(state.file.name||"document").replace(/\.pdf$/i,"");D.downloadBlob(blob,base+"-unlocked.pdf");progressUI.set(100,"Unlocked PDF saved.");if(window.dspdfToast)window.dspdfToast("Saved unlocked PDF.","success");
    }catch(err){log(err);progressUI.error("Could not unlock.");var msg=String(err&&err.message||err);if(/incorrect password/i.test(msg))msg="Incorrect password. Please enter the password used to open this PDF.";else if(/unsupported encryption/i.test(msg))msg="This PDF uses an encryption format that this browser tool does not currently support.";D.showError("unl-alert",msg);}
  }

  function init() {
    progressUI = new D.ProgressUI(el("unl-progress"));
    new D.UploadZone("#uz-unl", {
      accept: "application/pdf,.pdf", multiple: false,
      onFiles: function (files) { if (files[0]) loadPdf(files[0]); }
    });
    el("unl-show").addEventListener("change", function () {
      el("unl-pw").type = this.checked ? "text" : "password";
    });
    el("unl-apply").addEventListener("click", apply);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();