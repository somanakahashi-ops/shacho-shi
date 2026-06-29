/* ================================================================
   ContentStore.js
   ── 社長の自分史 電子ブック ─ 本文（文章）編集の保存クラス

   このクラスの責務:
     ・データ管理画面でユーザーが書き換えた文章（章・タイトル・本文・
       質問・回答など）を localStorage に「上書き分」として保存する。
     ・保存済みの上書き分を読み出す／全消去する。

   このクラスの責務外:
     ・実際の本文の初期値 → data/book-data.js（PAGES）が持つ。
     ・上書きを画面に反映する処理 → DataManager / BookController。

   ── 保存形式 ──
     localStorage キー: "ebook-content-override"
     値: { "<ページ番号>": { title?, chapter?, body?, qLabel?, question?, answer? }, ... }
     ページ番号は PAGES 配列のインデックス（表紙=0, 序文=1, ...）。

   ── 初期値との関係 ──
     book-data.js は起動時にこのキーを読み、PAGES（初期値）へ
     フィールド単位で上書きしてから本を組み立てる。よって、ここに
     保存が無いフィールドは常に book-data.js の初期値が使われる。
     clearAll() で上書きを消すと、本は完全に初期状態へ戻る。
   ================================================================ */

class ContentStore {

    /**
     * @param {string} [key] - localStorage キー
     */
    constructor(key = 'ebook-content-override') {
        this.key = key;
    }

    /**
     * 上書き分すべてを読み出す。
     * @returns {Object} { pageIndex: { field: value } }（無ければ空オブジェクト）
     */
    getAll() {
        try {
            return JSON.parse(localStorage.getItem(this.key) || '{}');
        } catch (e) {
            console.warn('本文の上書きデータ読込に失敗しました:', e);
            return {};
        }
    }

    /**
     * 1ページの1フィールドの上書きを保存する。
     * @param {number} pageIndex
     * @param {string} field   - 'title' | 'chapter' | 'body' | 'qLabel' | 'question' | 'answer'
     * @param {string} value
     */
    setField(pageIndex, field, value) {
        const all = this.getAll();
        if (!all[pageIndex]) all[pageIndex] = {};
        all[pageIndex][field] = value;
        this._save(all);
    }

    /** 上書きをすべて消す（初期状態に戻す）。 */
    clearAll() {
        try {
            localStorage.removeItem(this.key);
        } catch (e) {
            console.warn('本文の上書きデータ削除に失敗しました:', e);
        }
    }

    /** @private */
    _save(all) {
        try {
            localStorage.setItem(this.key, JSON.stringify(all));
        } catch (e) {
            console.warn('本文の上書きデータ保存に失敗しました:', e);
        }
    }
}
