/* =====================================================================
   SQL-Optima Studio — Native Binary PDF (jsPDF) & XLSX (SheetJS) Engine
   Generates Genuine Multi-Sheet Workbooks and Paginated Audit Reports
   ===================================================================== */
(function () {
  'use strict';

  function exportWorkbook(sheets, filename) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS XLSX library is not loaded.');
    }
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var ws = XLSX.utils.aoa_to_sheet(s.data);
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename + '.xlsx');
  }

  function exportPdf(options) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      throw new Error('jsPDF engine not available.');
    }
    var doc = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    // Document Header
    doc.setFillColor(7, 11, 17);
    doc.rect(0, 0, 210, 297, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(56, 189, 248);
    doc.text(options.title || 'SQL-OPTIMA ENGINEERING AUDIT REPORT', 14, 20);

    doc.setFontSize(9);
    doc.setTextColor(148, 170, 196);
    doc.text('PROJECT / FACILITY: ' + (options.project || 'AGAC Industrial Utilities (Dubai, UAE)'), 14, 28);
    doc.text('GENERATED: ' + new Date().toISOString() + ' | AUTHOR: ' + (options.author || 'SCADA Systems Engineer'), 14, 33);

    // Executive Summary
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('1. Executive Technical Summary', 14, 44);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(148, 170, 196);
    var splitSummary = doc.splitTextToSize(options.summary || 'Operational health audit conducted across SCADA Historian repositories.', 182);
    doc.text(splitSummary, 14, 50);

    var currentY = 50 + (splitSummary.length * 5) + 6;

    // Structured Data Tables via autoTable
    if (options.tables && options.tables.length > 0) {
      options.tables.forEach(function (tbl, idx) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.text((idx + 2) + '. ' + tbl.title, 14, currentY);

        doc.autoTable({
          head: [tbl.headers],
          body: tbl.rows,
          startY: currentY + 4,
          theme: 'grid',
          headStyles: { fillColor: [14, 21, 32], textColor: [56, 189, 248], fontStyle: 'bold' },
          bodyStyles: { fillColor: [18, 26, 38], textColor: [232, 238, 246] },
          styles: { fontSize: 8, font: 'courier' },
          margin: { left: 14, right: 14 }
        });

        currentY = doc.lastAutoTable.finalY + 12;
      });
    }

    doc.save((options.filename || 'SQL_Optima_Engineering_Report') + '.pdf');
  }

  window.ReportGenerator = {
    exportWorkbook: exportWorkbook,
    exportPdf: exportPdf
  };
})();