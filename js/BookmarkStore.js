/* ================================================================
   BookmarkStore.js
   ── 社長の自分史 電子ブック ─ 読書位置の保存・読込クラス

   このクラスの責務:
     ・「最後に開いていたページ」を localStorage に保存する
     ・次回アクセス時にその位置を読み込んで返す
     ・保存されている位置を消す（最初からやり直したい場合用）

   このクラスの責務外:
     ・いつ保存するか、いつ読み込んだ位置にジャンプするかの判断
       → BookController が担当する（このクラスは「保存する」
         「読み込む」という操作そのものだけを提供する）
     ・PC/Mobile どちらの座標系を使うかの変換
       → BookController が既に持っている currentSpread ⇄
         currentPageIdx の変換ロジックをそのまま使う

   ── ImageStore との関係 ──
     このクラスは ImageStore（画像のドラッグ＆ドロップ保存）と
     同じ「localStorage を使う」という性質を持つが、保存する内容
     （数値のページ位置 vs 画像データ）が全く異なるため、
     別クラスとして分離している。1つのクラスに無関係な責務を
     混ぜると、後から読み返したときに分かりにくくなるため。

   ── 保存形式 ──
     localStorage のキー: 固定のキー名（複数の本を区別する必要が
     ない前提なので、ImageStore のような連番キーではなく単一の
     キーにシンプルな JSON 文字列を保存する）。
     値の例: {"spreadIndex": 3, "pageIndex": 6}

   ── JSON.stringify / JSON.parse について（初心者向け補足） ──
     localStorage は「文字列」しか保存できない決まりがある
     （数値やオブジェクトをそのまま保存することはできない）。
     JSON.stringify(オブジェクト) は、オブジェクトを「文字列の形」に
     変換する関数。逆に JSON.parse(文字列) は、その文字列を元の
     オブジェクトの形に戻す関数。この2つを組み合わせることで、
     「オブジェクト → 文字列にして保存 → 文字列を取り出して
     オブジェクトに戻す」という往復ができるようになる。
   ================================================================ */

class BookmarkStore {

    /**
     * @param {string} [storageKey] - localStorage に保存する際のキー名
     */
    constructor(storageKey = 'ebook-bookmark') {
        this.key = storageKey;
    }

    /**
     * 現在の読書位置を保存する
     *
     * @param {number} spreadIndex - PC モードの見開きインデックス
     * @param {number} pageIndex   - Mobile モードのページインデックス
     */
    save(spreadIndex, pageIndex) {
        try {
            const value = JSON.stringify({ spreadIndex, pageIndex });
            localStorage.setItem(this.key, value);
        } catch (e) {
            // localStorage が使えない環境（プライベートブラウジング等）
            // でも、しおり機能が無いだけで本自体は問題なく読めるべきなので、
            // ここで例外を投げてアプリ全体を止めるのではなく、
            // 警告だけ出してそのまま処理を続行する。
            console.warn('しおりの保存に失敗しました:', e);
        }
    }

    /**
     * 保存されている読書位置を読み込む
     *
     * @returns {{spreadIndex: number, pageIndex: number} | null}
     *          保存データが無い、または壊れている場合は null を返す
     */
    load() {
        try {
            const raw = localStorage.getItem(this.key);
            if (!raw) return null; // 一度も保存されていない（初回訪問）

            const parsed = JSON.parse(raw);

            // 保存されていた値が期待する形（spreadIndex・pageIndex が
            // どちらも数値）になっているかを確認する。
            // 壊れたデータ（手動編集やバージョン違いなど）を
            // そのまま使うと、存在しないページ番号にジャンプして
            // 画面が真っ白になる、といった不具合の原因になるため、
            // 形が違う場合は安全側に倒して null（＝最初から開く）を返す。
            if (typeof parsed.spreadIndex !== 'number' || typeof parsed.pageIndex !== 'number') {
                return null;
            }

            return parsed;
        } catch (e) {
            // JSON.parse に失敗した場合（保存データが壊れている）もここに来る
            console.warn('しおりの読込に失敗しました:', e);
            return null;
        }
    }

    /**
     * 保存されている読書位置を削除する（最初からやり直す用）
     */
    clear() {
        try {
            localStorage.removeItem(this.key);
        } catch (e) {
            console.warn('しおりの削除に失敗しました:', e);
        }
    }
}
