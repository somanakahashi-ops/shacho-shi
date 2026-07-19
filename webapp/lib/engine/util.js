/* ================================================================
   util.js
   ── 社長の自分史 電子ブック ─ 小さな共通ヘルパ

   このファイルの責務:
     ・複数のクラスで重複していた汎用処理を1箇所にまとめる。
       特定のクラスに属さない「道具」だけを置く。

   このファイルの責務外:
     ・アプリ固有のロジック（描画・状態管理など）
       → 各クラスが担当する。

   読み込み順序:
     依存を持たないため、他のどの .js よりも先に読み込んでよい。
   ================================================================ */

/**
 * 画像 URL（通常の URL でもデータ URL でも可）を Image として読み込む。
 *
 * 以前は PageContentRenderer / ImageStore / BookController の3箇所で
 * 「new Image() して onload/onerror を Promise で包む」処理が個別に
 * 書かれていた。同じ内容なのでここに1本化した。
 *
 * （ImageStore.loadImage(spreadIndex) とは別物。あちらは保存番号から
 *   読み込む高レベル API。こちらは生の URL/データURL を読むだけの道具。）
 *
 * @param {string} src - 画像の URL またはデータ URL
 * @returns {Promise<HTMLImageElement>} 読み込めた Image。失敗時は reject。
 */
export function loadImageFromSrc(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = () => reject(new Error('画像の読み込みに失敗しました: ' + String(src).slice(0, 50)));
        img.src = src;
    });
}

/**
 * 文字列から短いハッシュ（FNV-1a 32bit、8桁の16進文字列）を作る。
 *
 * 用途: 事前生成した読み上げ音声（audio/tts/）のファイル名キーに使う。
 *   同じ文章 → 同じハッシュ → 同じ音声ファイル、という対応にすることで、
 *   「文章を編集したらハッシュが変わり、その部分だけ音声が無くなって
 *    ブラウザ内蔵の声に自動フォールバックする」挙動を実現している。
 *
 * 重要: この計算は音声を生成する側（Node の /tmp/gen/extract.js）と
 *   完全に一致していなければならない。charCodeAt は UTF-16 コード単位を
 *   返すが、日本語は基本多言語面（BMP）に収まるため両者で一致する。
 *
 * @param {string} str
 * @returns {string} 8桁の16進ハッシュ
 */
export function ttsHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
}
