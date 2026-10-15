/**
 * Draw page chrome (footers) on already-buffered PDFKit pages without spawning
 * blank pages. Writing below the content bottom-margin with switchToPage + text()
 * otherwise triggers PDFKit auto page-breaks.
 */
export function forEachBufferedPage(
  doc: PDFKit.PDFDocument,
  paint: (pageNumber: number, pageCount: number) => void
) {
  const range = doc.bufferedPageRange();
  const count = range.count;
  for (let i = 0; i < count; i++) {
    doc.switchToPage(range.start + i);
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    try {
      paint(i + 1, count);
    } finally {
      doc.page.margins.bottom = prevBottom;
    }
  }
}
