/**
 * HTML to PDF — render HTML to a canvas via html2canvas, then embed in PDF.
 * Documented limitations: only inline CSS, no external resources.
 */
(function () {
  "use strict";
  var D = window.DSPDF;
  var log = window.dspdfLog || function () {};

  function el(id) { return document.getElementById(id); }

  function sanitize(html) {
    // Strip script tags for safety (they wouldn't run in html2canvas anyway).
    return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "");
  }

  function updatePreview() {
    var html = sanitize(el("h2p-input").value);
    el("h2p-preview").innerHTML = html || '<p style="color:#888;">Preview will appear here…</p>';
  }

  function sheetSizePts(name) {
    if (name === "letter") return { w: 612, h: 792 };
    return { w: 595.28, h: 841.89 };
  }

  async function generate() {
    var html = sanitize(el("h2p-input").value).trim();
    if (!html) { D.showError("h2p-alert", "Enter some HTML or text first."); return; }
    D.clearAlert("h2p-alert");

    try {
      if (!window.html2canvas) throw new Error("html2canvas not loaded yet. Please try again.");
      if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF not loaded yet. Please try again.");

      var size = el("h2p-size").value;
      var orient = el("h2p-orient").value;
      var marginPt = parseInt(el("h2p-margin").value, 10) || 0;

      // Render HTML into an offscreen container to avoid affecting the page.
      var container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-10000px";
      container.style.top = "0";
      container.style.width = "780px";
      container.style.background = "#ffffff";
      container.style.color = "#000000";
      container.style.padding = "20px";
      container.style.fontFamily = "Helvetica, Arial, sans-serif";
      container.style.fontSize = "14px";
      container.style.lineHeight = "1.4";
      container.innerHTML = html;
      document.body.appendChild(container);

      var canvas = await window.html2canvas(container, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: false
      });
      document.body.removeChild(container);

      var pt = sheetSizePts(size);
      var pageW = orient === "landscape" ? pt.h : pt.w;
      var pageH = orient === "landscape" ? pt.w : pt.h;
      var contentW = pageW - marginPt * 2;
      var contentH = pageH - marginPt * 2;

      var jsPDF = window.jspdf.jsPDF;
      var pdf = new jsPDF({ unit: "pt", format: [pageW, pageH], compress: true });

      // Scale canvas to fit contentW, allow multiple pages if height overflows.
      var imgW = contentW;
      var imgH = (canvas.height / canvas.width) * contentW;
      var imgData = canvas.toDataURL("image/jpeg", 0.9);

      var yOffset = marginPt;
      var remainingHeight = imgH;

      // First page
      pdf.addImage(imgData, "JPEG", marginPt, yOffset, imgW, imgH, undefined, "FAST");
      remainingHeight -= contentH;

      // If content is taller than one page, slice into additional pages.
      // We do this by re-placing the same image with a negative offset so
      // subsequent portions show through — this is simple and works because
      // PDF viewers clip at page boundaries.
      var pageIndex = 1;
      while (remainingHeight > 0) {
        pdf.addPage([pageW, pageH], orient === "landscape" ? "landscape" : "portrait");
        var yShift = -contentH * pageIndex;
        pdf.addImage(imgData, "JPEG", marginPt, marginPt + yShift, imgW, imgH, undefined, "FAST");
        remainingHeight -= contentH;
        pageIndex++;
        if (pageIndex > 50) break; // sanity
      }

      pdf.setProperties({
        title: "DSPDF HTML to PDF",
        creator: "DSPDF"
      });

      var blob = pdf.output("blob");
      D.downloadBlob(blob, "dspdf-html.pdf");
      if (window.dspdfToast) window.dspdfToast("PDF saved.", "success");
    } catch (err) {
      log(err);
      D.showError("h2p-alert", D.humanError(err, "Could not generate PDF. Check your HTML for unsupported content."));
    }
  }

  function init() {
    var t;
    el("h2p-input").addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(updatePreview, 220);
    });
    el("h2p-sample").addEventListener("click", function () {
      el("h2p-input").value =
        '<h1 style="color:#2563EB;">Invoice</h1>\n' +
        '<p><strong>Client:</strong> Acme Corp</p>\n' +
        '<p><strong>Amount:</strong> $1,250.00</p>\n' +
        '<p style="color:#666;">Thank you for your business.</p>';
      updatePreview();
    });
    el("h2p-clear").addEventListener("click", function () {
      el("h2p-input").value = "";
      updatePreview();
    });
    el("h2p-apply").addEventListener("click", generate);
    updatePreview();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();