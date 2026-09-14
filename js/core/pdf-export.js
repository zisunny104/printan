// PDF 匯出：使用 jsPDF（透過 CDN 載入的全域 window.jspdf），維持熱感紙比例
// （紙寬 x 動態高度），不強制塞進 A4（見需求單第十八節）。
// 需要頁面先載入： https://cdnjs.cloudflare.com/ajax/libs/jspdf/{version}/jspdf.umd.min.js

/**
 * @param {Array<{canvas: HTMLCanvasElement, widthMm: number, heightMm: number}>} renderResults
 *   通常來自 renderTemplate()（單筆）或 renderBatch()（多筆，一筆一頁，對應 Mail Merge）。
 */
export function exportToPdf(renderResults, { fileName = "printan.pdf" } = {}) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error("尚未載入 jsPDF，請確認頁面有引入 jsPDF 的 CDN script");
    }
    if (!renderResults.length) throw new Error("沒有可匯出的內容");

    const { jsPDF } = window.jspdf;
    let doc;
    renderResults.forEach((result, i) => {
        const format = [Math.max(result.widthMm, 1), Math.max(result.heightMm, 1)];
        if (i === 0) {
            doc = new jsPDF({ unit: "mm", format, orientation: "portrait" });
        } else {
            doc.addPage(format, "portrait");
        }
        const imgData = result.canvas.toDataURL("image/png");
        doc.addImage(imgData, "PNG", 0, 0, format[0], format[1]);
    });
    doc.save(fileName);
    return doc;
}
