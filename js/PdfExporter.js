/* ================================================================
   PdfExporter.js
   ── 社長の自分史 電子ブック ─ PDF書き出しクラス

   このクラスの責務:
     ・全ページ（表紙〜終章）を1冊のPDFファイルに変換する
     ・変換中の進捗（今何ページ目を処理しているか）を
       呼び出し側に伝える（プログレス表示のため）

   このクラスの責務外:
     ・どのタイミングでPDF化を開始するか（ボタンのイベント等）
       → BookController が担当する
     ・PDFのページレイアウトの細かい計算（中身は jsPDF ライブラリが
       内部で処理する）

   ── 仕組み（処理の流れ） ──
     1. PageContentRenderer.preRenderPage() で各ページの内容を
        Canvas に描く（既存のキャッシュ機構がそのまま使えるので、
        本を読んでいる間に既に表示したページは再描画コストがゼロ）
     2. そのCanvasを canvas.toDataURL() で画像データに変換する
     3. jsPDF の addImage() でPDFの1ページに貼り付ける
     4. 全ページ終わったら save() でダウンロードを開始する

   ── jsPDF ライブラリについて（初心者向け補足） ──
     jsPDF は「ブラウザの中だけでPDFファイルを組み立てる」ための
     ライブラリ。サーバーに送信したり、特別なソフトをインストール
     したりする必要がなく、JavaScript の new jsPDF(...) でPDF文書を
     作り始め、addImage() や text() で内容を追加し、最後に save() を
     呼ぶとブラウザが自動的にファイルをダウンロードしてくれる。

   ── なぜ「重い処理」への対策が必要か ──
     全ページ分の Canvas 描画・画像変換・PDF への追加を一度に
     まとめて実行すると、ページ数が多い場合にブラウザが一瞬
     「固まった」ように見えることがある。これを避けるため、
     1ページ処理するごとに setTimeout(..., 0) で「いったん
     ブラウザに制御を返す」処理を挟んでいる。これにより、
     処理の合間にブラウザが画面更新（プログレス表示の反映など）
     を行う時間を確保できる。
   ================================================================ */

class PdfExporter {

    /**
     * @param {PageContentRenderer} contentRenderer - 各ページの描画を担当するクラス
     * @param {Object} constants - BOOK_CONST（PAGE_W, PC_H を使用）
     */
    constructor(contentRenderer, constants) {
        this.contentRenderer = contentRenderer;
        this.C               = constants;
    }

    /**
     * 全ページをPDFに変換してダウンロードする
     *
     * @param {Function} [onProgress] - 各ページ処理後に呼ばれる
     *        (current, total) => void 形式のコールバック。
     *        プログレス表示の更新に使う。
     * @returns {Promise<void>} 全ページの処理とダウンロード開始が
     *        完了したら解決される Promise
     */
    async exportToPdf(onProgress) {
        const { PAGE_W, PC_H } = this.C;
        const pages = this.contentRenderer.pages;
        const total = pages.length;

        // jsPDF のインスタンスを作る。
        // 第3引数の [PAGE_W, PC_H] で「PDFの1ページのサイズ」を
        // 直接 Canvas の解像度（ピクセル数）と同じ値に指定している。
        // 単位（'pt'）はピクセルとほぼ同じ感覚で使える単位なので、
        // 「Canvas に描いた絵をそのままの大きさでPDFに貼る」という
        // 単純な対応関係になり、余計な縮小・拡大の計算が要らない。
        const pdf = new jspdf.jsPDF({
            orientation: 'portrait',
            unit: 'pt',
            format: [PAGE_W, PC_H]
        });

        for (let i = 0; i < total; i++) {
            const page = pages[i];

            // 既存のキャッシュ機構をそのまま利用する。
            // 既に画面に表示したことのあるページなら、ここでは
            // 「描き直す」のではなく「キャッシュを取り出すだけ」になる。
            const canvas = this.contentRenderer.preRenderPage(page.fn, page.isRight);

            // Canvas の内容を JPEG画像データ（データURL文字列）に変換する。
            // PNGより JPEG の方がファイルサイズが小さくなるため、
            // 文章中心のページでは JPEG を採用している
            // （第2引数の 0.92 は画質。1.0に近いほど高画質・大きいサイズ）。
            const imgData = canvas.toDataURL('image/jpeg', 0.92);

            if (i > 0) {
                // 2ページ目以降は、新しいページを追加してから画像を貼る。
                // 1ページ目は new jsPDF() の時点で既に1ページ分が
                // 用意されているため、addPage() は不要。
                pdf.addPage([PAGE_W, PC_H], 'portrait');
            }
            pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W, PC_H);

            if (onProgress) onProgress(i + 1, total);

            // setTimeout(fn, 0) について（初心者向け補足）:
            //   「0ミリ秒後に実行して」という指定だが、実際には
            //   「今実行中の処理が一区切りついたら、できるだけ早く
            //   実行して」という意味になる。これを挟むことで、
            //   ループの途中でブラウザに一瞬「次に何をすべきか
            //   考える時間」を与えられる（画面の再描画や、他の
            //   操作への応答などがこのタイミングで行われる）。
            //   await と組み合わせることで、ループ全体が
            //   「ブラウザを固まらせない」形で進行する。
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // ファイル名は本のタイトルが分かるようにしておく。
        // 半角スペースや記号を避けたシンプルな名前にしている。
        pdf.save('社長の自分史.pdf');
    }
}
