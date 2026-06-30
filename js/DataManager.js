/* ================================================================
   DataManager.js
   ── 社長の自分史 電子ブック ─ データ管理画面（独立ページ用）

   このクラスの責務:
     ・別ページ（manage.html）で、本の文章・画像を管理する画面を作る。
     ・文章タブ: 各ページの文章（章・タイトル・本文・質問・回答）を
       編集し、入力欄の横にプレビューを表示する。「保存」で localStorage
       に保存する（本のページに戻ると反映される）。
     ・画像タブ: 見開きごとに保存済み画像のサムネ表示・削除・追加/差し替え。
     ・「初期状態に戻す」で文章の上書きを全消去して初期状態へ。

   このクラスの責務外:
     ・本の表示・ページめくり → 本のページ（BookController）が担当。
       この画面は localStorage に保存するだけで、本へは「戻ったとき」に
       book-data.js / ImageStore 経由で反映される。

   依存（コンストラクタで受け取る）:
     deps.contentRenderer … PageContentRenderer（プレビュー描画・データ参照）
     deps.imageStore      … ImageStore（画像の保存・削除・取得）
     deps.contentStore    … ContentStore（文章の上書き保存）
     deps.C               … BOOK_CONST（ページ寸法など）
     onBack               … 「本に戻る」ときに呼ぶ関数（ページ遷移など）
   ================================================================ */

class DataManager {

    /**
     * @param {Object} deps - { contentRenderer, imageStore, contentStore, C }
     * @param {Object} ui   - { backBtn, tabs, bodyText, bodyImage, saveBtn, resetBtn, status }
     * @param {Function} onBack - 「本に戻る」操作で呼ばれる
     */
    constructor(deps, ui, onBack) {
        this.contentRenderer = deps.contentRenderer;
        this.imageStore      = deps.imageStore;
        this.contentStore    = deps.contentStore;
        this.C               = deps.C;
        this.ui              = ui;
        this.onBack          = onBack || function () {};
        this._bind();
    }

    /** @private イベント登録 */
    _bind() {
        this.ui.backBtn.on('click',  () => this.onBack());
        this.ui.tabs.on('click', (e) => this._switchTab(e.currentTarget.getAttribute('data-tab')));
        this.ui.saveBtn.on('click',  () => this._saveText());
        this.ui.resetBtn.on('click', () => this._resetText());
    }

    /** 画面の中身を組み立てて表示する（ページ読み込み時に1回呼ぶ） */
    build() {
        this._buildTextForm();
        this._buildImageList();
        this._switchTab('text');
        this._status('');
    }

    /** @private タブ切り替え */
    _switchTab(tab) {
        this.ui.tabs.removeClass('active');
        this.ui.tabs.filter(`[data-tab="${tab}"]`).addClass('active');
        this.ui.bodyText.prop('hidden',  tab !== 'text');
        this.ui.bodyImage.prop('hidden', tab !== 'image');
    }

    /** @private 全ページを {pageIndex, page} の配列で返す */
    _eachPage() {
        const out = [];
        this.contentRenderer._spreadData.forEach((s, sIdx) => {
            ['left', 'right'].forEach((side, sideIdx) => {
                const page = s[side];
                if (page) out.push({ pageIndex: sIdx * 2 + sideIdx, page });
            });
        });
        return out;
    }

    /* ── 文章タブ ──────────────────────────────────────── */

    /** @private 文章編集フォームを「見開き（左右2ページ）」単位で組み立てる
     *  一度に1見開きだけ表示し、プルダウンで表示する見開きを切り替える。 */
    _buildTextForm() {
        const $body = this.ui.bodyText;
        $body.empty();

        // 編集できる文章を持つ見開きだけを対象にする
        const editableSpreads = [];
        this.contentRenderer._spreadData.forEach((spread, sIdx) => {
            if (this._isEditablePage(spread.left) || this._isEditablePage(spread.right)) {
                editableSpreads.push(sIdx);
            }
        });

        if (editableSpreads.length === 0) {
            $('<p>').addClass('dm-note').text('編集できる文章がありません。').appendTo($body);
            return;
        }

        // ── プルダウン（表示する見開きの選択） ──
        const $picker = $('<div>').addClass('dm-spread-picker');
        $('<span>').addClass('dm-spread-picker-label').text('表示する見開き').appendTo($picker);
        const $select = $('<select>').addClass('toc-select dm-spread-select');
        editableSpreads.forEach((sIdx) => {
            const spread = this.contentRenderer._spreadData[sIdx];
            $('<option>')
                .attr('value', sIdx)
                .text(`見開き ${sIdx + 1}${this._spreadSummary(spread)}`)
                .appendTo($select);
        });
        $picker.append($select);
        $body.append($picker);

        // ── 選択中の見開きを描画する領域 ──
        const $stage = $('<div>').addClass('dm-spread-stage');
        $body.append($stage);

        const renderSpread = (sIdx) => {
            const spread = this.contentRenderer._spreadData[sIdx];
            $stage.empty();

            const $card = $('<div>').addClass('dm-page dm-spread');
            $('<div>').addClass('dm-page-head').text(`見開き ${sIdx + 1}`).appendTo($card);

            // 実際の本と同じ「左ページ｜右ページ」の並びで2枚を横に置く
            const $row = $('<div>').addClass('dm-spread-row');
            $row.append(this._buildPageEditor(sIdx * 2,     spread.left,  '左ページ'));
            $row.append(this._buildPageEditor(sIdx * 2 + 1, spread.right, '右ページ'));
            $card.append($row);

            $stage.append($card);
        };

        $select.on('change', () => renderSpread(Number($select.val())));
        renderSpread(editableSpreads[0]);
    }

    /** @private プルダウンに出す見開きの簡単な見出し（章・タイトル） */
    _spreadSummary(spread) {
        const pick = (p) => p && (p.title || p.chapter || '');
        const label = pick(spread.left) || pick(spread.right) || '';
        return label ? `：${label}` : '';
    }

    /** 編集対象の文章フィールドの定義（左右ページ共通） @private */
    _textFields() {
        return [
            { key: 'chapter',  label: '章ラベル',   type: 'input'    },
            { key: 'title',    label: 'タイトル',   type: 'input'    },
            { key: 'qLabel',   label: '質問番号',   type: 'input'    },
            { key: 'question', label: '質問',       type: 'textarea' },
            { key: 'answer',   label: '回答',       type: 'textarea' },
            { key: 'body',     label: '本文',       type: 'textarea' }
        ];
    }

    /** @private 文章を持つページか（編集対象か）を判定 */
    _isEditablePage(page) {
        if (!page) return false;
        return this._textFields().some(f => typeof page[f.key] === 'string');
    }

    /**
     * 1ページ分の編集ブロック（見出し・プレビュー・入力欄）を作って返す。
     * @param {number} pageIndex
     * @param {Object} page
     * @param {string} sideLabel - '左ページ' / '右ページ'
     * @returns {JQuery}
     * @private
     */
    _buildPageEditor(pageIndex, page, sideLabel) {
        const $col = $('<div>').addClass('dm-spread-col');
        $('<div>').addClass('dm-side-label').text(sideLabel).appendTo($col);

        // 編集できる文章が無いページ（空白ページ）はその旨だけ表示
        if (!this._isEditablePage(page)) {
            $('<div>').addClass('dm-empty-page').text('（編集できる文章はありません）').appendTo($col);
            return $col;
        }

        // プレビュー（上）
        const $prevWrap = $('<div>').addClass('dm-preview-wrap');
        $('<div>').addClass('dm-preview-cap').text('プレビュー').appendTo($prevWrap);
        const $canvas = $('<canvas>')
            .addClass('dm-preview')
            .attr('width', this.C.PAGE_W)
            .attr('height', this.C.PC_H);
        $prevWrap.append($canvas);
        $col.append($prevWrap);

        // 入力欄（下）
        const $fields = $('<div>').addClass('dm-page-fields');
        this._textFields().forEach((f) => {
            if (typeof page[f.key] !== 'string') return;
            const $field = $('<label>').addClass('dm-field');
            $('<span>').addClass('dm-field-label').text(f.label).appendTo($field);
            const $inp = (f.type === 'textarea') ? $('<textarea>') : $('<input type="text">');
            $inp.addClass('dm-input')
                .val(page[f.key])
                .attr('data-page', pageIndex)
                .attr('data-field', f.key);
            $field.append($inp);
            $fields.append($field);
        });
        $col.append($fields);

        // 入力のたびにプレビューを更新（少し遅延）
        const canvasEl = $canvas[0];
        const renderPreview = () => this._renderPreview(canvasEl, pageIndex, $fields.find('.dm-input'));
        let timer = null;
        $fields.find('.dm-input').on('input', () => {
            clearTimeout(timer);
            timer = setTimeout(renderPreview, 120);
        });
        renderPreview();

        return $col;
    }

    /**
     * 編集中の内容で1ページ分のプレビューを描く（実データは変更しない）。
     * @private
     */
    _renderPreview(canvas, pageIndex, $inputs) {
        const real = this._pageByIndex(pageIndex);
        if (!real) return;
        const temp = Object.assign({}, real);
        delete temp._qLines;
        delete temp._aLines;
        $inputs.each((_, el) => { temp[el.getAttribute('data-field')] = el.value; });

        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.contentRenderer.drawPage(ctx, 'left', temp);
    }

    /** @private 文章を localStorage に保存する（本へは戻ったときに反映） */
    _saveText() {
        const edits = this.ui.bodyText.find('.dm-input');
        let changed = 0;
        edits.each((_, el) => {
            const pageIndex = Number(el.getAttribute('data-page'));
            const field     = el.getAttribute('data-field');
            const value     = el.value;
            const page      = this._pageByIndex(pageIndex);
            if (!page || page[field] === value) return;
            page[field] = value;                                  // この画面のデータも合わせて更新
            this.contentStore.setField(pageIndex, field, value);  // 永続化
            changed++;
        });
        this._status(changed > 0
            ? `${changed}件を保存しました（「← 本に戻る」で反映されます）`
            : '変更はありませんでした');
    }

    /** @private 文章を初期状態へ戻す（上書きを全消去して再読込） */
    _resetText() {
        const ok = window.confirm('編集した文章をすべて消して、初期状態に戻します。よろしいですか？\n（追加した画像はそのまま残ります）');
        if (!ok) return;
        this.contentStore.clearAll();
        location.reload();
    }

    /** @private pageIndex から表示中のページデータを引く */
    _pageByIndex(pageIndex) {
        const s = this.contentRenderer._spreadData[Math.floor(pageIndex / 2)];
        if (!s) return null;
        return (pageIndex % 2 === 0) ? s.left : s.right;
    }

    /* ── 画像タブ ──────────────────────────────────────── */

    /** @private 画像管理リストを組み立てる */
    _buildImageList() {
        const $body = this.ui.bodyImage;
        $body.empty();

        const imageStore = this.imageStore;
        const spreads    = this.contentRenderer._spreadData;

        $('<p>').addClass('dm-note')
            .text('画像は各見開きの「左ページ」に表示されます（表紙を除く）。')
            .appendTo($body);

        spreads.forEach((s, sIdx) => {
            if (sIdx === 0) return; // 表紙は対象外
            const label = (s.left && (s.left.title || s.left.chapter))
                ? ((s.left.chapter ? s.left.chapter + '　' : '') + (s.left.title || ''))
                : `見開き ${sIdx + 1}`;

            const $row = $('<div>').addClass('dm-img-row');
            $('<div>').addClass('dm-img-label').text(`見開き ${sIdx + 1}　${label}`).appendTo($row);

            const dataUrl = imageStore.getDataUrl(sIdx);
            const $thumbWrap = $('<div>').addClass('dm-img-thumb');
            if (dataUrl) {
                $('<img>').attr('src', dataUrl).appendTo($thumbWrap);
            } else {
                $('<span>').addClass('dm-img-empty').text('画像なし').appendTo($thumbWrap);
            }
            $row.append($thumbWrap);

            const $actions = $('<div>').addClass('dm-img-actions');

            // 追加/差し替え
            const $fileLabel = $('<label>').addClass('dm-btn-mini').text(dataUrl ? '差し替え' : '追加');
            const $file = $('<input type="file" accept="image/*">').css('display', 'none');
            $file.on('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                await imageStore.saveImage(file, sIdx);
                this._buildImageList();
                this._status(`見開き ${sIdx + 1} の画像を保存しました`);
            });
            $fileLabel.append($file);
            $actions.append($fileLabel);

            // 削除
            if (dataUrl) {
                const $del = $('<button>').addClass('dm-btn-mini dm-btn-danger').text('削除');
                $del.on('click', () => {
                    if (!window.confirm(`見開き ${sIdx + 1} の画像を削除しますか？`)) return;
                    imageStore.removeImage(sIdx);
                    this._buildImageList();
                    this._status(`見開き ${sIdx + 1} の画像を削除しました`);
                });
                $actions.append($del);
            }

            $row.append($actions);
            $body.append($row);
        });
    }

    /** @private 下部のステータス表示 */
    _status(msg) {
        this.ui.status.text(msg);
    }
}
