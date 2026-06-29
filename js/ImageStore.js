/* ================================================================
   ImageStore.js
   ── 社長の自分史 電子ブック ─ 画像の保存・読込クラス

   このクラスの責務:
     ・ドロップされた画像ファイルを Base64 文字列に変換する
     ・見開きインデックスをキーに localStorage へ保存する
     ・ページ表示時に画像を読み込んで Image オブジェクトを返す

   このクラスの責務外:
     ・画像をどこに・どのサイズで描くか
       → PageContentRenderer が担当する（このクラスから値を受け取るだけ）
     ・ドラッグ＆ドロップのイベント検出（dragover/drop）
       → BookController が担当する（このクラスのメソッドを呼ぶだけ）

   ── 保存形式 ──
     localStorage のキー: "ebook-image:<見開きインデックス>"
     値: 画像の Base64 データURL文字列（例: "data:image/png;base64,..."）

     見開きインデックスをキーにしている理由:
       「見開き」という単位はページめくり中も変わらない安定した識別子。
       PC/Mobile モードの切り替えがあっても、見開きインデックスから
       常に同じ画像を参照できる。

   ── 容量に関する注意 ──
     localStorage は通常 5MB 程度の上限がある。
     大きな画像を複数枚保存する用途には適さないため、
     本実装では「読み込み時に画像を縮小してから保存する」
     （_resizeImage）ことで 1 枚あたりの容量を抑えている。

   ── async / await / Promise について（初心者向け補足） ──
     このクラスのメソッドには async という単語が付いているものが多い。
     画像の読み込みやリサイズは「時間がかかる処理」で、処理が終わるまで
     プログラムの実行を止めて待つことができない（止めるとブラウザ全体が
     固まってしまう）。そこで JavaScript では「後で結果が届く約束」を
     表す Promise（プロミス）という仕組みを使う。

     - 関数の前に async を付けると、その関数は必ず Promise を返す
       関数になる（普通の値を return しても自動的に Promise に包まれる）。
     - 関数の中で await を付けると、「その Promise の結果が届くまで
       ここで待つ」という意味になる。await は async が付いた関数の
       中でしか使えない。
     - 呼び出す側も、結果を受け取るには await を使うか、
       .then(結果 => {...}) という書き方をする必要がある。

     例えば saveImage() の中の
       const rawDataUrl = await this._readFileAsDataUrl(file);
     は「ファイルの読み込みが終わるまで待ってから、結果を
     rawDataUrl という変数に入れる」という意味になる。
   ================================================================ */

class ImageStore {

    /**
     * @param {string} [storagePrefix] - localStorage キーの接頭辞
     * @param {number}  [maxDimension]  - 保存前に縮小する最大辺の長さ（px）
     */
    constructor(storagePrefix = 'ebook-image:', maxDimension = 1000) {
        this.prefix       = storagePrefix;
        this.maxDimension  = maxDimension;
    }

    /**
     * 見開きインデックスに対応する localStorage キーを生成する
     * @param {number} spreadIndex
     * @returns {string}
     * @private
     */
    _keyFor(spreadIndex) {
        return `${this.prefix}${spreadIndex}`;
    }

    /**
     * ドロップされたファイルを読み込み、縮小してから保存する
     *
     * 処理の流れ:
     *   1. File → データURL（FileReader.readAsDataURL）
     *   2. データURL → Image オブジェクトとして読み込み
     *   3. Canvas 経由で maxDimension 以下にリサイズ
     *   4. リサイズ後のデータURLを localStorage に保存
     *
     * @param {File}   file        - input/drop から得られた画像ファイル
     * @param {number} spreadIndex - 保存先の見開きインデックス
     * @returns {Promise<string>}   保存したデータURL文字列
     */
    async saveImage(file, spreadIndex) {
        const rawDataUrl    = await this._readFileAsDataUrl(file);
        const resizedDataUrl = await this._resizeImage(rawDataUrl, this.maxDimension);

        try {
            localStorage.setItem(this._keyFor(spreadIndex), resizedDataUrl);
        } catch (e) {
            // 容量超過（QuotaExceededError）などをここで捕捉する。
            // 保存に失敗してもアプリ全体を止めないよう、呼び出し元に
            // データURLだけは返して「今回の表示」だけは継続できるようにする。
            console.warn('画像の保存に失敗しました（容量上限の可能性があります）:', e);
        }

        return resizedDataUrl;
    }

    /**
     * ドロップされたファイルを読み込み、リサイズだけして返す
     * （localStorage への保存は行わない）
     *
     * saveImage() との違い:
     *   現時点では「画像を見開きに紐づけて永続化する」機能は
     *   まだ有効にしていない（将来的に対応予定）。そのため、
     *   今は「表示している間だけメモリ上に保持する」という
     *   軽量版の処理として、このメソッドを別に用意している。
     *   リサイズのロジック（_resizeImage）は将来の保存機能とも
     *   共有できるよう、saveImage() と同じ処理を呼び出している。
     *
     * @param {File} file - input/drop から得られた画像ファイル
     * @returns {Promise<string>} リサイズ後のデータURL文字列
     */
    async prepareImage(file) {
        const rawDataUrl     = await this._readFileAsDataUrl(file);
        const resizedDataUrl = await this._resizeImage(rawDataUrl, this.maxDimension);
        return resizedDataUrl;
    }

    /**
     * 見開きインデックスに対応する画像を読み込む
     *
     * @param {number} spreadIndex
     * @returns {Promise<HTMLImageElement|null>}
     *   保存されていれば読み込み済み Image を、なければ null を返す
     */
    async loadImage(spreadIndex) {
        const dataUrl = localStorage.getItem(this._keyFor(spreadIndex));
        if (!dataUrl) return null;
        return loadImageFromSrc(dataUrl);
    }

    /**
     * 見開きインデックスに保存された画像のデータURL文字列をそのまま返す。
     * （サムネイル表示など、Image 化せず生のデータURLが欲しい場面用）
     * @param {number} spreadIndex
     * @returns {string|null}
     */
    getDataUrl(spreadIndex) {
        return localStorage.getItem(this._keyFor(spreadIndex));
    }

    /**
     * 見開きインデックスに画像が保存済みかどうかを同期的に確認する
     * （Image の読み込み完了を待たずに真偽値だけ知りたい場合に使う）
     *
     * @param {number} spreadIndex
     * @returns {boolean}
     */
    hasImage(spreadIndex) {
        return localStorage.getItem(this._keyFor(spreadIndex)) !== null;
    }

    /**
     * 見開きインデックスの画像を削除する
     * @param {number} spreadIndex
     */
    removeImage(spreadIndex) {
        localStorage.removeItem(this._keyFor(spreadIndex));
    }

    /**
     * File オブジェクトを データURL文字列として読み込む
     * @param {File} file
     * @returns {Promise<string>}
     * @private
     */
    _readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    /**
     * 画像を maxDimension 以下に縮小し、新しいデータURLとして返す
     *
     * 縮小する理由:
     *   localStorage の容量上限（多くのブラウザで約5MB）に収まるよう、
     *   保存前に画像サイズを抑える。スマートフォンで撮影した写真などは
     *   そのままだと数MBになるため、長辺を maxDimension に合わせる。
     *
     * @param {string} dataUrl
     * @param {number} maxDimension
     * @returns {Promise<string>}
     * @private
     */
    async _resizeImage(dataUrl, maxDimension) {
        const img = await loadImageFromSrc(dataUrl);

        // 縦横の長い方を maxDimension に合わせる縮小率を計算
        // （すでに小さい画像は拡大しない = scale の上限を 1 にする）
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);

        const off    = document.createElement('canvas');
        off.width    = w;
        off.height   = h;
        const offCtx = off.getContext('2d');
        offCtx.drawImage(img, 0, 0, w, h);

        // JPEG 品質 0.85 で書き出し、ファイルサイズを抑える
        return off.toDataURL('image/jpeg', 0.85);
    }
}
