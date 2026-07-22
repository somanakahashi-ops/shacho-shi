/* ================================================================
   pdfExport ── 静的版 PdfExporter.js の移植

   全ページ（表紙〜終章）を1冊のPDFに変換してダウンロードする。
   仕組みは静的版と同じ:
     1. PageContentRenderer.preRenderPage() でページ内容をCanvasに描く
        （キャッシュ機構があるため、既に表示済みのページは再描画コストゼロ）
     2. canvas.toDataURL() でJPEG画像に変換
     3. jsPDF の addImage() でPDFの1ページに貼る
     4. 1ページごとに setTimeout(0) を挟み、ブラウザを固まらせない

   静的版と同じく、写真オーバーレイはPDFには含めない
   （PdfExporterはページ本文のみを対象とする）。
   ================================================================ */
import { jsPDF } from 'jspdf';
import { PageContentRenderer } from './engine/PageContentRenderer';
import { BOOK_CONST } from './engine/constants';

export async function exportBookToPdf(
    contentRenderer: InstanceType<typeof PageContentRenderer>,
    title: string,
    onProgress?: (current: number, total: number) => void
): Promise<void> {
    const { PAGE_W, PC_H } = BOOK_CONST;
    const pages = contentRenderer.pages;
    const total = pages.length;

    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: [PAGE_W, PC_H],
    });

    for (let i = 0; i < total; i++) {
        const page = pages[i];
        const canvas = contentRenderer.preRenderPage(page.fn, page.isRight);
        const imgData = canvas.toDataURL('image/jpeg', 0.92);

        if (i > 0) {
            pdf.addPage([PAGE_W, PC_H], 'portrait');
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W, PC_H);

        if (onProgress) onProgress(i + 1, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const safeName = title.replace(/[\\/:*?"<>|]/g, '').trim() || '自分史';
    pdf.save(`${safeName}.pdf`);
}
