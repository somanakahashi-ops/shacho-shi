/* ================================================================
   SettingsStore.js
   ── 社長の自分史 電子ブック ─ ユーザー設定の保存・読込クラス

   このクラスの責務:
     ・ユーザーの表示設定（現状は「ページめくり音 ON/OFF」）を
       localStorage に保存・読込する。

   このクラスの責務外:
     ・設定をいつ読むか、設定変更時に何をするか（音を実際に鳴らす等）
       → BookController / AudioPlayer が担当する。

   ── なぜ独立クラスにするか ──
     以前は BookController が音設定だけ生の localStorage を直接
     触っており、しおり（BookmarkStore）・画像（ImageStore）が
     Store クラスで包んでいるのと不整合だった。設定も同じ
     「Store パターン」に揃え、localStorage アクセスを1箇所に閉じ込める。

   localStorage が使えない環境（プライベートブラウジング等）でも
   設定が保存されないだけで本自体は読めるべきなので、例外は握りつぶして
   警告だけ出す（BookmarkStore と同じ方針）。
   ================================================================ */

class SettingsStore {

    /**
     * @param {string} [soundKey] - 音 ON/OFF を保存する localStorage キー
     */
    constructor(soundKey = 'ebook-sound-enabled') {
        this.soundKey = soundKey;
    }

    /**
     * ページめくり音が有効かを読み込む。
     * 保存が無い（初回訪問）／読込失敗時は既定の true（ON）を返す。
     * @returns {boolean}
     */
    getSoundEnabled() {
        try {
            const saved = localStorage.getItem(this.soundKey);
            if (saved !== null) return saved === '1';
        } catch (e) {
            console.warn('音設定の読込に失敗しました:', e);
        }
        return true;
    }

    /**
     * ページめくり音の ON/OFF を保存する。
     * @param {boolean} enabled
     */
    setSoundEnabled(enabled) {
        try {
            localStorage.setItem(this.soundKey, enabled ? '1' : '0');
        } catch (e) {
            console.warn('音設定の保存に失敗しました:', e);
        }
    }
}
