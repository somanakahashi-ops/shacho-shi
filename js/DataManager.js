/* ================================================================
   DataManager.js
   ── 社長の自分史 電子ブック ─ データ管理画面

   このクラスの責務:
     ・「⚙ データ管理」で開く全画面オーバーレイの中身を組み立てる。
     ・文章タブ: 各ページの文章（章・タイトル・本文・質問・回答）を
       編集できるフォームを作り、「保存して反映」で本へ反映＋保存する。
     ・画像タブ: 見開きごとに保存済み画像のサムネ表示・削除・追加/差し替え。
     ・「初期状態に戻す」で文章の上書きを全消去して初期状態へ。

   このクラスの責務外:
     ・実際の描画・ページ移動 → BookController に委譲。
     ・保存先 localStorage の詳細 → ContentStore / ImageStore。

   依存:
     controller … BookController（contentRenderer/imageStore/反映メソッド）
     contentStore … 文章の上書き保存
   ================================================================ */

class DataManager {

    /**
     * @param {BookController} controller
     * @param {ContentStore} contentStore
     * @param {Object} ui - { overlay, openBtn, closeBtn, tabs, bodyText, bodyImage,
     *                         saveBtn, resetBtn, status }（jQuery 要素）
     */
    constructor(controller, contentStore, ui) {
        this.controller   = controller;
        this.contentStore = contentStore;
        this.ui           = ui;
        this._bind();
    }

    /** @private イベント登録 */
    _bind() {
        this.ui.openBtn.on('click',  () => this.open());
        this.ui.closeBtn.on('click', () => this.close());
        this.ui.overlay.on('click', (e) => {
            // 背景（パネル外）クリックで閉じる
            if (e.target === this.ui.overlay[0]) this.close();
        });
        this.ui.tabs.on('click', (e) => this._switchTab(e.currentTarget.getAttribute('data-tab')));
        this.ui.saveBtn.on('click',  () => this._saveText());
        this.ui.resetBtn.on('click', () => this._resetText());
    }

    /** 管理画面を開く（中身を作り直してから表示） */
    open() {
        this._buildTextForm();
        this._buildImageList();
        this._switchTab('text');
        this._status('');
        this.ui.overlay.prop('hidden', false);
    }

    /** 管理画面を閉じる */
    close() {
        this.ui.overlay.prop('hidden', true);
    }

    /** @private タブ切り替え */
    _switchTab(tab) {
        this.ui.tabs.removeClass('active');
        this.ui.tabs.filter(`[data-tab="${tab}"]`).addClass('active');
        this.ui.bodyText.prop('hidden',  tab !== 'text');
        this.ui.bodyImage.prop('hidden', tab !== 'image');
    }

    /** @private 全ページを {pageIndex, side, page} の配列で返す */
    _eachPage() {
        const out = [];
        const spreads = this.controller.contentRenderer._spreadData;
        spreads.forEach((s, sIdx) => {
            ['left', 'right'].forEach((side, sideIdx) => {
                const page = s[side];
                if (page) out.push({ pageIndex: sIdx * 2 + sideIdx, page });
            });
        });
        return out;
    }

    /* ── 文章タブ ──────────────────────────────────────── */

    /** @private 文章編集フォームを組み立てる */
    _buildTextForm() {
        const $body = this.ui.bodyText;
        $body.empty();

        // 編集対象フィールドの定義（ラベルと入力種別）
        const FIELDS = [
            { key: 'chapter',  label: '章ラベル',   type: 'input'    },
            { key: 'title',    label: 'タイトル',   type: 'input'    },
            { key: 'qLabel',   label: '質問番号',   type: 'input'    },
            { key: 'question', label: '質問',       type: 'textarea' },
            { key: 'answer',   label: '回答',       type: 'textarea' },
            { key: 'body',     label: '本文',       type: 'textarea' }
        ];

        this._eachPage().forEach(({ pageIndex, page }) => {
            // そのページが「文章ページ」でなければ（空白ページ等）スキップ
            const hasAny = FIELDS.some(f => typeof page[f.key] === 'string');
            if (!hasAny) return;

            const $card = $('<div>').addClass('dm-page');
            const heading = (page.chapter ? page.chapter + '　' : '')
                + (page.title || page.qLabel || `ページ ${pageIndex}`);
            $('<div>').addClass('dm-page-head').text(`p.${page.pageNum || pageIndex}　${heading}`).appendTo($card);

            // 入力欄（左）とプレビュー（右）の横並び
            const $row = $('<div>').addClass('dm-page-row');
            const $fields = $('<div>').addClass('dm-page-fields');

            FIELDS.forEach((f) => {
                if (typeof page[f.key] !== 'string') return; // そのフィールドを持つページのみ
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

            // プレビュー（編集内容を即座に反映して描画する）
            const $prevWrap = $('<div>').addClass('dm-preview-wrap');
            $('<div>').addClass('dm-preview-cap').text('プレビュー').appendTo($prevWrap);
            const $canvas = $('<canvas>')
                .addClass('dm-preview')
                .attr('width', this.controller.C.PAGE_W)
                .attr('height', this.controller.C.PC_H);
            $prevWrap.append($canvas);

            $row.append($fields, $prevWrap);
            $card.append($row);
            $body.append($card);

            // 入力のたびにプレビューを更新（負荷軽減のため少し遅延）
            const canvasEl = $canvas[0];
            const renderPreview = () => this._renderPreview(canvasEl, pageIndex, $fields.find('.dm-input'));
            let timer = null;
            $fields.find('.dm-input').on('input', () => {
                clearTimeout(timer);
                timer = setTimeout(renderPreview, 120);
            });
            renderPreview(); // 初期表示
        });
    }

    /**
     * 編集中の内容で1ページ分のプレビューを描く。
     * 実データは書き換えず、入力欄の現在値を一時的に重ねて描画する。
     * @param {HTMLCanvasElement} canvas
     * @param {number} pageIndex
     * @param {JQuery} $inputs - そのページの入力欄
     * @private
     */
    _renderPreview(canvas, pageIndex, $inputs) {
        const real = this._pageByIndex(pageIndex);
        if (!real) return;
        // 一時ページ = 実データ + 入力中の値（折り返しキャッシュは外して再計算させる）
        const temp = Object.assign({}, real);
        delete temp._qLines;
        delete temp._aLines;
        $inputs.each((_, el) => { temp[el.getAttribute('data-field')] = el.value; });

        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // プレビューは常に左ページ基準（ox=0）で描けば PAGE_W 幅に収まる
        this.controller.contentRenderer.drawPage(ctx, 'left', temp);
    }

    /** @private 文章を保存して本へ反映する */
    _saveText() {
        const edits = this.ui.bodyText.find('.dm-input');
        let changed = 0;
        edits.each((_, el) => {
            const pageIndex = Number(el.getAttribute('data-page'));
            const field     = el.getAttribute('data-field');
            const value     = el.value;
            const page      = this._pageByIndex(pageIndex);
            if (!page) return;
            if (page[field] === value) return; // 変更なし
            page[field] = value;                       // 表示中データを書き換え
            this.contentStore.setField(pageIndex, field, value); // 永続化
            changed++;
        });
        this.controller.refreshContent(); // 再描画・目次更新
        this._status(changed > 0 ? `${changed}件を保存しました` : '変更はありませんでした');
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
        const s = this.controller.contentRenderer._spreadData[Math.floor(pageIndex / 2)];
        if (!s) return null;
        return (pageIndex % 2 === 0) ? s.left : s.right;
    }

    /* ── 画像タブ ──────────────────────────────────────── */

    /** @private 画像管理リストを組み立てる */
    _buildImageList() {
        const $body = this.ui.bodyImage;
        $body.empty();

        const imageStore = this.controller.imageStore;
        const spreads    = this.controller.contentRenderer._spreadData;

        $('<p>').addClass('dm-note')
            .text('画像は各見開きの「左ページ」に表示されます（表紙を除く）。')
            .appendTo($body);

        spreads.forEach((s, sIdx) => {
            if (sIdx === 0) return; // 表紙の見開きは対象外
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

            // 追加/差し替え（ファイル選択）
            const $fileLabel = $('<label>').addClass('dm-btn-mini').text(dataUrl ? '差し替え' : '追加');
            const $file = $('<input type="file" accept="image/*">').css('display', 'none');
            $file.on('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                await imageStore.saveImage(file, sIdx);
                await this.controller.refreshImage(sIdx);
                this._buildImageList(); // サムネ更新
                this._status(`見開き ${sIdx + 1} の画像を保存しました`);
            });
            $fileLabel.append($file);
            $actions.append($fileLabel);

            // 削除
            if (dataUrl) {
                const $del = $('<button>').addClass('dm-btn-mini dm-btn-danger').text('削除');
                $del.on('click', async () => {
                    if (!window.confirm(`見開き ${sIdx + 1} の画像を削除しますか？`)) return;
                    imageStore.removeImage(sIdx);
                    await this.controller.refreshImage(sIdx);
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
