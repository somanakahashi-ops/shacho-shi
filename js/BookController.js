/* ================================================================
   BookController.js
   ── 社長の自分史 電子ブック ─ アプリケーション司令塔クラス

   このクラスの責務:
     ・「今どのページ／見開きを表示中か」という位置情報を保持する
     ・PC ⇄ Mobile のモード切り替え（Canvas 解像度の変更含む）
     ・ナビゲーション操作（前へ／次へ）を各モードに振り分ける
     ・UI（カウンター・ボタンの有効/無効・ヒント文言）を更新する
     ・ボタン／キーボード／ウィンドウリサイズのイベントを登録する

   このクラスの責務外:
     ・実際の描画
       → BookRenderer に委譲する
     ・アニメーションの進行（RAF ループ）
       → BookAnimator に委譲する

   ── このクラスが「司令塔」である理由 ──
     他の全クラス（PageContentRenderer / PageFlipEffect /
     BookRenderer / BookAnimator）は「どう描くか」だけを知っていて
     「今何が起きているか」を知らない。
     BookController だけが両方のモードの状態を横断的に把握し、
     各クラスに「いつ何をするか」を指示する役割を持つ。

   ── PC ⇄ Mobile の位置同期規則 ──
     PC → Mobile:  currentPageIdx = currentSpread × 2
       （見開きの左ページ＝そのスプレッドの先頭ページから再開する）
     Mobile → PC:  currentSpread = floor(currentPageIdx / 2)
       （現在ページが属する見開きを表示する）
   ================================================================ */

class BookController {

    /**
     * @param {Object} constants - BOOK_CONST
     * @param {PageContentRenderer} contentRenderer
     * @param {BookRenderer} bookRenderer
     * @param {BookAnimator} animator
     * @param {ImageStore} imageStore
     * @param {BookmarkStore} bookmarkStore
     * @param {AudioPlayer} audioPlayer
     * @param {PdfExporter} pdfExporter
     * @param {HTMLCanvasElement} canvas
     * @param {Object} ui - { pageCounter, prevBtn, nextBtn, hintText, dropZone } の jQuery 要素
     */
    constructor(constants, contentRenderer, bookRenderer, animator, imageStore, bookmarkStore, audioPlayer, pdfExporter, canvas, ui) {
        this.C               = constants;
        this.contentRenderer = contentRenderer;
        this.bookRenderer     = bookRenderer;
        this.animator         = animator;
        this.imageStore        = imageStore;
        this.bookmarkStore      = bookmarkStore;
        this.audioPlayer         = audioPlayer;
        this.pdfExporter          = pdfExporter;
        this.canvas           = canvas;
        this.ui               = ui;

        // ── 位置状態 ──────────────────────────────────────
        // PC モードと Mobile モードそれぞれの「現在地」を別々に保持し、
        // モード切り替え時に相互変換して同期させる。
        this.isMobile        = false;
        this._debugForceMode = null; // デバッグ用: 'mobile' | 'pc' | null
        this.currentSpread   = 0; // PC モードの現在見開きインデックス
        this.currentPageIdx  = 0; // Mobile モードの現在ページインデックス

        // PC アニメーション中に render() が参照する「移動先」インデックス。
        // goNext() が更新し、アニメーション完了後は currentSpread に
        // 反映されるため、静止時は使われない（未定義値での参照を避けるため
        // ここで currentSpread と同じ値に初期化しておく）。
        this._pcNextIdx = 0;

        // ── 画像キャッシュ（見開きインデックス → 読込済み Image） ──
        // localStorage には Base64 文字列で保存されているが、
        // 毎フレーム文字列から Image を再構築するのは無駄なため、
        // 一度読み込んだ Image オブジェクトをメモリ上に保持しておく。
        // key: 見開きインデックス（number）, value: HTMLImageElement
        this._imageCache = new Map();
    }

    /**
     * アプリケーションを起動する
     *
     * 行うこと:
     *   1. ウィンドウ幅に応じた初期モードを適用
     *   2. 保存済みの画像をあらかじめメモリにロード
     *   3. 初回フレームを描画
     *   4. UI（カウンター・ボタン）を初期化
     *   5. イベントリスナーを登録（ドラッグ＆ドロップ含む）
     */
    async init() {
        // ── デバッグ用：起動シグナル ─────────────────────
        // JS が実行され始めたことを画面上で確認できるようにする。
        // 「真っ白で何も表示されない」のか「JS自体が動いていない」のかを
        // 区別するための一時的な目印。正常に init() が完了すると
        // この後の render() で本のページに上書きされて消える。
        try {
            const ctx0 = this.canvas.getContext('2d');
            ctx0.fillStyle = '#fdfcf8';
            ctx0.fillRect(0, 0, this.canvas.width || 1100, this.canvas.height || 680);
            ctx0.fillStyle = '#888';
            ctx0.font = '16px sans-serif';
            ctx0.fillText('読み込み中…', 20, 30);
        } catch (e) {
            console.error('起動シグナルの描画に失敗:', e);
        }

        console.log('[init] 開始');

        // ── しおりの読み込み（保存された読書位置の復元） ──
        // applyMode() より前に行う理由:
        //   applyMode() は「モードが変わったときだけ currentSpread と
        //   currentPageIdx を変換し直す」という判定（modeChanged）を
        //   含んでいる。しおりから復元した位置を確実に反映させるには、
        //   applyMode() が動き出す前に currentSpread/currentPageIdx を
        //   セットしておく必要がある。
        this._restoreBookmark();
        console.log('[init] しおり復元完了, currentSpread=', this.currentSpread, 'currentPageIdx=', this.currentPageIdx);

        // ── カバーページ用の背景画像を事前読み込み ──────────
        // render() より前に完了させる必要がある（drawPage() の中で
        // _bgImageCache から同期的に取り出して使うため）。
        await this.contentRenderer.loadBackgroundImages(BOOK_DATA);
        console.log('[init] 背景画像の読み込み完了');

        await this.applyMode(window.innerWidth < this.C.BREAKPOINT);
        console.log('[init] applyMode 完了, isMobile=', this.isMobile, 'canvas.width=', this.canvas.width, 'canvas.height=', this.canvas.height);
        await this._preloadCachedImage(this.currentSpread);
        console.log('[init] 画像の先読み完了');
        this.render();
        console.log('[init] render 完了');
        this._buildTocList(); // 目次パネルの中身（章リスト）を先に構築しておく
        this._restoreSoundSetting(); // 保存済みの音ON/OFF設定を復元する
        this.updateUI();      // ここで _highlightCurrentTocItem() が正しく項目を見つけられる
        this._bindEvents();
        console.log('[init] 起動完了');
    }

    /**
     * しおり（保存された読書位置）を読み込み、currentSpread /
     * currentPageIdx に反映する
     *
     * 保存データが無い場合（初回訪問、または保存に失敗していた場合）は
     * 何もしない。その場合 currentSpread/currentPageIdx は
     * コンストラクタで設定した初期値（0 = 表紙）のままになる。
     *
     * 範囲チェックについて:
     *   BOOK_DATA の内容を編集してページ数が変わった後に、
     *   古い（ページ数が多かった頃の）しおりが残っていると、
     *   存在しないページ番号を指してしまう可能性がある。
     *   そのため、保存されていた値が現在のページ数の範囲内に
     *   収まっているかを確認し、範囲外なら無視する（＝表紙から
     *   開始する）安全策を取っている。
     * @private
     */
    _restoreBookmark() {
        const bookmark = this.bookmarkStore.load();
        if (!bookmark) return; // 保存データが無い（初回訪問）

        const totalSpreads = this.contentRenderer.spreads.length;
        const totalPages    = this.contentRenderer.pages.length;

        const spreadInRange = bookmark.spreadIndex >= 0 && bookmark.spreadIndex < totalSpreads;
        const pageInRange   = bookmark.pageIndex   >= 0 && bookmark.pageIndex   < totalPages;

        if (spreadInRange && pageInRange) {
            this.currentSpread  = bookmark.spreadIndex;
            this.currentPageIdx = bookmark.pageIndex;
        } else {
            console.warn('[しおり] 保存されていた位置が範囲外のため無視します:', bookmark);
        }
    }

    /**
     * 現在の読書位置をしおりとして保存する
     *
     * 呼び出すタイミング:
     *   updateUI() の最後で毎回呼ぶ。ページ移動が確定する処理
     *   （goNext/goPrev の完了コールバック、目次からのジャンプ等）は
     *   すべて最終的に updateUI() を呼ぶ作りになっているため、
     *   ここに1箇所だけ追加すれば「ページが変わるたびに自動保存される」
     *   という挙動を、個々のページ移動処理に変更を入れずに実現できる。
     * @private
     */
    _saveBookmark() {
        this.bookmarkStore.save(this.currentSpread, this.currentPageIdx);
    }

    /**
     * 現在のモードに応じた描画関数を呼ぶディスパッチャ
     *
     * すべての描画リクエストはこの関数を経由する。
     * モード判定をここに集約することで、呼び出し側がモードを意識せずに済む。
     */
    render() {
        const animState = this.animator.state;
        if (this.isMobile) {
            this.bookRenderer.renderMobile(animState, this.contentRenderer.pages, this.currentPageIdx);
        } else {
            // 現在の見開きに紐づく画像（あれば）をキャッシュから取り出して渡す。
            // キャッシュに無ければ undefined ではなく null を渡すよう Map.get の
            // 結果をそのまま使う（Map は無ければ undefined を返すため ?? で null 化）。
            const leftImage = this._imageCache.get(this.currentSpread) ?? null;
            this.bookRenderer.renderPC(animState, this.contentRenderer.spreads, this.currentSpread, this._pcNextIdx, leftImage);
        }
    }

    /**
     * 次のページ・見開きへ移動する
     *
     * PC モード:    次の見開きへアニメーション付きで移動
     * Mobile モード: 次の 1 ページへアニメーション付きで移動
     *
     * アニメーション中は何もしない（BookAnimator 側のガードに加え、
     * ここでも早期 return することで意図を明確にしている）。
     *
     * startFlipMobile() / startFlipPC() への引数の渡し方について
     * （初心者向け補足）:
     *   `() => this.render()` のような書き方を「コールバック関数」と
     *   呼ぶ。これは「後でこの処理を実行してね」と関数を“予約”して
     *   渡しておく方法。BookAnimator は中で何度もアニメーションの
     *   フレームを処理するが、そのたびに「今の状態を画面に描いて」
     *   と頼みたい。しかし BookAnimator 自身は render() の存在を
     *   知らない（責務が分かれているため）。そこで「フレームが進む
     *   たびに呼んでほしい関数」をこちら側（BookController）から
     *   渡しておくことで、BookAnimator は「とにかく渡された関数を
     *   呼ぶだけ」で済むようになる。
     */
    goNext() {
        if (this.animator.state.isAnimating || this.animator.state.dragging) return;

        if (this.isMobile) {
            const pages = this.contentRenderer.pages;
            if (this.currentPageIdx < pages.length - 1) {
                const toIdx = this.currentPageIdx + 1;
                this.audioPlayer.play(); // ページめくり音（実際に移動が起きる場合のみ鳴らす）
                this.animator.startFlipMobile(
                    pages, this.currentPageIdx, toIdx,
                    () => this.render(),                                  // 毎フレーム呼ばれる（描画担当）
                    (finishedIdx) => this._onMobileFlipComplete(finishedIdx) // 完了時に1回だけ呼ばれる
                );
            }
        } else {
            const spreads = this.contentRenderer.spreads;
            if (this.currentSpread < spreads.length - 1) {
                const toIdx = this.currentSpread + 1;
                this._pcNextIdx = toIdx; // render() がアニメ中に参照する移動先
                this.audioPlayer.play(); // ページめくり音
                this.animator.startFlipPC(
                    spreads, this.currentSpread, toIdx,
                    () => this.render(),
                    (finishedIdx) => this._onPCFlipComplete(finishedIdx)
                );
            }
        }
    }

    /**
     * 前のページ・見開きへ移動する
     *
     * PC モード:    前の見開きへアニメーション付きで移動
     *               （startFlipPC を reverse=true で呼び、現在の左ページが
     *               綴じ目を軸に右へ閉じていく動きを再生する）
     * Mobile モード: 前の 1 ページへアニメーション付きで移動
     *               （startFlipMobile を reverse=true で呼び、
     *               「前のページから現在ページへの次へ」を逆再生する。
     *               見た目は「前のページが右からカールを解いて
     *               画面いっぱいに展開してくる」動きになる）
     */
    async goPrev() {
        if (this.animator.state.isAnimating || this.animator.state.dragging) return;
        this._stopAutoPlay(); // 手動で「前へ」を押したら自動送りは止める

        if (this.isMobile) {
            const pages = this.contentRenderer.pages;
            if (this.currentPageIdx > 0) {
                const toIdx = this.currentPageIdx - 1;
                this.audioPlayer.play(); // ページめくり音
                this.animator.startFlipMobile(
                    pages, this.currentPageIdx, toIdx,
                    () => this.render(),
                    (finishedIdx) => this._onMobileFlipComplete(finishedIdx),
                    true // reverse: 「前へ」方向
                );
            }
        } else {
            if (this.currentSpread > 0) {
                const toIdx = this.currentSpread - 1;
                this._pcNextIdx = toIdx; // render() がアニメ中に参照する移動先
                // 移動先の見開きに画像が紐づいているかもしれないため先読みする
                await this._preloadCachedImage(toIdx);
                this.audioPlayer.play(); // ページめくり音
                this.animator.startFlipPC(
                    this.contentRenderer.spreads, this.currentSpread, toIdx,
                    () => this.render(),
                    (finishedIdx) => this._onPCFlipComplete(finishedIdx),
                    true // reverse: 「前へ」方向
                );
            }
        }
    }

    /**
     * PC モードのアニメーション完了時の状態確定処理
     * @param {number} finishedIdx - 到達した見開きインデックス
     * @private
     */
    async _onPCFlipComplete(finishedIdx) {
        this.currentSpread  = finishedIdx;
        this.currentPageIdx = finishedIdx * 2; // Mobile の位置も同期
        // 到達した見開きに画像が紐づいているかもしれないため先読みする
        await this._preloadCachedImage(finishedIdx);
        this.render();
        this.updateUI();
    }

    /**
     * Mobile モードのアニメーション完了時の状態確定処理
     * @param {number} finishedIdx - 到達したページインデックス
     * @private
     */
    _onMobileFlipComplete(finishedIdx) {
        this.currentPageIdx = finishedIdx;
        this.currentSpread  = Math.floor(finishedIdx / 2); // PC の位置も同期
        this.render();
        this.updateUI();
    }

    /**
     * ページカウンター・ボタンの有効/無効・ヒントテキストを更新する
     *
     * モードに応じて表示内容が変わる:
     *   PC:     「見開き N / M」（M = spreads.length）
     *   Mobile: 「ページ N / M」 （M = pages.length）
     *
     * この関数は DOM の変更のみ行い、Canvas 描画には関与しない。
     * render() とは独立して呼ぶこと。
     */
    updateUI() {
        const { pageCounter, prevBtn, nextBtn, hintText } = this.ui;

        // ── DEBUG: Canvas実寸を画面上に表示 ──────────────────
        // コンソールを開けない環境（スマホ実機など）でも、
        // Canvas の内部解像度（width/height属性）と CSS 表示サイズが
        // 期待通りになっているかを画面上で確認できるようにする診断情報。
        // PageFlipEffect.DEBUG が true のときだけ表示し、
        // 通常運用時は文字列構築のコストごと発生させない。
        const debugInfo = PageFlipEffect.DEBUG
            ? ` [DEBUG] canvas.width=${this.canvas.width} height=${this.canvas.height} `
              + `style=${this.canvas.style.width}x${this.canvas.style.height} `
              + `isMobile=${this.isMobile} MOB_W=${this.C.MOB_W} MOB_H=${this.C.MOB_H}`
            : '';

        if (this.isMobile) {
            const total = this.contentRenderer.pages.length;
            pageCounter.text(`ページ ${this.currentPageIdx + 1} / ${total}`);
            prevBtn.prop('disabled', this.currentPageIdx === 0);
            nextBtn.prop('disabled', this.currentPageIdx === total - 1);
            hintText.text('スワイプまたはボタンでページをめくります' + debugInfo);
        } else {
            const total = this.contentRenderer.spreads.length;
            pageCounter.text(`見開き ${this.currentSpread + 1} / ${total}`);
            prevBtn.prop('disabled', this.currentSpread === 0);
            nextBtn.prop('disabled', this.currentSpread === total - 1);
            hintText.text('矢印キー（← →）またはボタンでページをめくります（左ページに画像をドラッグ＆ドロップできます）' + debugInfo);
        }

        // ── 読了プログレスバーの更新 ───────────────────────
        // 「現在ページ番号 ÷ 全ページ数」を 0〜100% に変換し、
        // プログレスバーの幅（width）として反映する。
        // PC/Mobile どちらのモードでも pages 配列のインデックス
        // （currentPageIdx）を基準にすることで、モードが違っても
        // 同じ尺度（実際のページ数）で進捗を表せるようにしている。
        const totalPages = this.contentRenderer.pages.length;
        // 最終ページで100%になるよう、分母を (総数-1) にしている
        // （0ページ目=0%、最終ページ=100% という対応にするため）。
        const progressPercent = totalPages > 1
            ? (this.currentPageIdx / (totalPages - 1)) * 100
            : 0;
        this.ui.progressBarFill.css('width', `${progressPercent}%`);

        // ページが切り替わるたびに、目次パネル内の「現在地マーク」も
        // 一緒に更新しておく（パネルが閉じていても次に開いたとき
        // 正しい場所がハイライトされるように、開閉に関係なく毎回更新する）。
        this._highlightCurrentTocItem();

        // ページが切り替わるたびに、現在地をしおりとして自動保存する。
        // updateUI() はページ移動が確定したときに必ず呼ばれる作りに
        // なっているため、ここに保存処理を1箇所だけ置けば、
        // 「次へ」「前へ」「目次からのジャンプ」「スワイプでの確定」
        // など、すべての移動方法に対して自動的にしおりが効くようになる。
        this._saveBookmark();
    }

    /**
     * PC/Mobile モードを適用する
     *
     * 行うこと:
     *   1. Canvas の解像度（描画サイズ）を変更
     *      ※ canvas.width を変更すると Canvas 内容がクリアされるが
     *        ctx 参照は有効なまま（取得し直す必要はない）
     *   2. Canvas の CSS 表示サイズをウィンドウ幅に合わせてスケール
     *   3. モード切り替え時のみページ位置インデックスを同期
     *   4. Mobile → PC 切り替え時は、表示する見開きの画像を先読みする
     *
     * @param {boolean} newMobile - 新しいモード（true: Mobile、false: PC）
     */
    async applyMode(newMobile) {
        const modeChanged = (newMobile !== this.isMobile); // 初回呼び出し時も true
        this.isMobile = newMobile;

        const { PC_W, PC_H, MOB_W, MOB_H } = this.C;
        const canvas = this.canvas;

        if (this.isMobile) {
            canvas.width  = MOB_W;
            canvas.height = MOB_H;
            this._applyCssScale(MOB_W, MOB_H, 20); // 左右 10px ずつのマージン想定
            if (modeChanged) this.currentPageIdx = this.currentSpread * 2;
        } else {
            canvas.width  = PC_W;
            canvas.height = PC_H;
            this._applyCssScale(PC_W, PC_H, 40); // 左右 20px ずつのマージン想定
            if (modeChanged) this.currentSpread = Math.floor(this.currentPageIdx / 2);
            // PC 表示に切り替わるときだけ画像が見える可能性があるため先読みする
            // （Mobile では画像オーバーレイ機能を提供していないため不要）
            if (modeChanged) await this._preloadCachedImage(this.currentSpread);
        }

        // NAVバーの組み立て・解体は「モードが実際に変わったとき」だけ行う。
        // 毎回（例えばリサイズで CSS サイズだけ変わるとき）実行すると、
        // 既に正しい場所にある要素を無駄に動かし直すことになるため。
        if (modeChanged) this._toggleMobileNavbar(this.isMobile);
    }

    /**
     * モバイル NAV バーの表示・非表示と、その中身の組み立てを行う
     *
     * 「組み立て」とは何をしているか:
     *   ハンバーガーボタン（#toc-toggle-btn）とページカウンター
     *   （#page-counter）は、HTML 上では元々 NAVバーの外（body の
     *   直接の子）に置かれている。Mobile モードに入るときだけ、
     *   jQuery の appendTo() を使ってこれらの要素を実際に
     *   NAVバーの中（#mobile-navbar-left / #mobile-navbar-right）に
     *   移動させ、CSS クラス（.in-navbar）を付けて見た目も
     *   「ヘッダーに収まる小さいボタン」に変える。
     *   PC モードに戻るときは逆に、元の場所（body の直接の子として
     *   #mobile-navbar の直前）に戻し、.in-navbar クラスも外す。
     *
     * なぜ要素を複製せず「移動」させるのか:
     *   ハンバーガーボタンのクリックイベント（_bindTocEvents で
     *   一度だけ登録済み）は、要素そのものに結び付いている。
     *   複製すると同じイベントが2つの別要素に分かれてしまい、
     *   片方を操作してももう片方には反映されない、といった
     *   不整合の原因になる。appendTo() で「同じ要素」を移動させる
     *   ことで、イベントや状態を保ったまま見た目だけ変えられる。
     *
     * @param {boolean} toMobile - true なら NAVバーを組み立てる、
     *                              false なら解体して元に戻す
     * @private
     */
    _toggleMobileNavbar(toMobile) {
        const { tocToggleBtn, pageCounter } = this.ui;
        const $body   = $('body');
        const $navbar = $('#mobile-navbar');

        if (toMobile) {
            // ── 組み立て：ボタン類をNAVバーの中へ移動する ──
            tocToggleBtn.addClass('in-navbar').appendTo('#mobile-navbar-left');
            pageCounter.addClass('in-navbar').appendTo('#mobile-navbar-right');
            $navbar.addClass('visible');
            $body.addClass('has-mobile-navbar'); // 本の表示位置をNAVバーの下にずらす
        } else {
            // ── 解体：元の場所（body の直接の子）に戻す ──
            // before() で「#mobile-navbar の直前」に挿入することで、
            // HTML の元々の並び順とほぼ同じ位置に戻している。
            tocToggleBtn.removeClass('in-navbar').insertBefore($navbar);
            pageCounter.removeClass('in-navbar').insertBefore($navbar);
            $navbar.removeClass('visible');
            $body.removeClass('has-mobile-navbar');
        }
    }

    /**
     * Canvas の CSS 表示サイズ（見た目のサイズ）をウィンドウ幅に合わせて更新する
     *
     * 描画解像度（canvas.width/height）は変更しない。
     * リサイズ時に「同一モード内でのウィンドウ幅変化」にも使う。
     *
     * @param {number} drawW   - Canvas の描画解像度の幅
     * @param {number} drawH   - Canvas の描画解像度の高さ
     * @param {number} margin  - ウィンドウ幅から引くマージン（px）
     * @private
     */
    _applyCssScale(drawW, drawH, margin) {
        const cssW = Math.min(window.innerWidth - margin, drawW);
        this.canvas.style.width  = cssW + 'px';
        this.canvas.style.height = (drawH * cssW / drawW) + 'px';
    }

    /**
     * ボタン・キーボード・リサイズ・ドラッグ＆ドロップの
     * イベントリスナーを登録する
     * @private
     */
    _bindEvents() {
        const { prevBtn, nextBtn } = this.ui;

        // ── ナビゲーションボタン ──────────────────────────
        nextBtn.on('click', () => this.goNext());
        prevBtn.on('click', () => this.goPrev());

        // ── キーボード操作 ────────────────────────────────
        // PC ユーザーが矢印キーで直感的に操作できるようにする
        $(document).on('keydown', (e) => {
            if (e.key === 'ArrowRight') this.goNext();
            if (e.key === 'ArrowLeft')  this.goPrev();
        });

        // ── ウィンドウリサイズ処理（デバウンス付き）───────
        // デバウンスする理由:
        //   resize イベントはウィンドウサイズ変更中に数百回/秒発火する。
        //   毎回 applyMode() + render() を呼ぶとパフォーマンスが
        //   著しく低下するため、200ms 間イベントが来なくなってから
        //   一度だけ処理する。
        //
        // アニメーション中はリサイズを無視する理由:
        //   アニメーション中に Canvas サイズを変更すると描画が乱れるため。
        //   アニメーション完了後の自然なタイミングで切り替わる。
        let resizeTimer;
        $(window).on('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this._handleResize(), 200);
        });

        // ── ドラッグ＆ドロップ（画像の追加） ───────────────
        this._bindDragAndDrop();

        // ── スワイプジェスチャー（モバイルのページめくり） ─
        this._bindSwipeGesture();

        // ── 目次サイドバー ─────────────────────────────────
        this._bindTocEvents();
    }

    /**
     * 目次パネルの中身（章リスト）を構築する
     *
     * contentRenderer.tocEntries（BOOK_DATA から自動抽出された
     * 見出し一覧）を1つずつ <li><button>...</button></li> として
     * #toc-list に追加していく。
     *
     * 各ボタンのクリックで _jumpToToc() を呼び、該当ページへ移動する。
     * ボタンには data-spread-index / data-page-index 属性を持たせて
     * おき、後で「今どの項目が現在地か」をハイライトする際に
     * 参照できるようにしている。
     *
     * jQuery初心者向け補足:
     *   $('<li>') のように HTML タグ名を文字列で渡すと、
     *   その種類の新しい要素を jQuery オブジェクトとして作成できる。
     *   .addClass() でCSSクラスを付け、.html() で中身のHTMLを設定し、
     *   .appendTo() で指定した要素の最後の子として追加する、という
     *   流れで1つずつ目次項目を組み立てている。
     */
    _buildTocList() {
        const $list = this.ui.tocList;
        $list.empty(); // 念のため既存の内容をクリアしてから構築する

        // ── パフォーマンス最適化：ボタン要素への参照をキャッシュする ──
        // _highlightCurrentTocItem() はページが変わるたびに呼ばれる
        // （次へ/前へ/ドラッグ確定/パラパラめくり完了など、あらゆる
        // ページ移動の最後で実行される、比較的頻度の高い処理）。
        // そのたびに毎回 `.find('.toc-item-btn')`（全ボタン取得）や
        // 属性セレクタ `[data-spread-index=...][data-page-index=...]`
        // でDOMを検索するのは無駄が大きい（属性セレクタは class や id
        // によるセレクタに比べてブラウザの評価コストが高い種類の
        // セレクタとして知られている）。
        // ここで作成した各ボタンの情報をそのまま軽量な配列に保存して
        // おけば、後から「現在地に対応するボタン」を探す処理が
        // 「DOM検索」ではなく「配列の走査」（はるかに軽い処理）で
        // 済むようになる。
        this._tocButtons = [];

        this.contentRenderer.tocEntries.forEach((entry) => {
            const chapterHtml = entry.chapter
                ? `<span class="toc-item-chapter">${entry.chapter}</span>`
                : '';
            // タイトルの中の改行（\n）は目次では邪魔なので、
            // 半角スペースに置き換えて1行で表示する。
            const titleText = (entry.title || '').replace(/\n/g, ' ');

            const $button = $('<button>')
                .addClass('toc-item-btn')
                .attr('data-spread-index', entry.spreadIndex)
                .attr('data-page-index', entry.pageIndex)
                .html(
                    chapterHtml +
                    `<span class="toc-item-title">${titleText}</span>` +
                    `<span class="toc-item-page">p.${entry.pageNum}</span>`
                )
                .on('click', () => this._jumpToToc(entry.spreadIndex, entry.pageIndex));

            $('<li>').append($button).appendTo($list);

            // キャッシュ配列にも保存する（data属性と同じ情報を
            // JSのプロパティとしても持たせることで、後から
            // 文字列ベースの属性セレクタを組み立てて検索する必要を
            // なくしている）。
            this._tocButtons.push({
                spreadIndex: entry.spreadIndex,
                pageIndex:   entry.pageIndex,
                $btn:        $button
            });
        });

        // 現在ハイライト中のボタンへの参照（無ければ null）。
        // _highlightCurrentTocItem() がこれを使うことで、
        // 「前回ハイライトしていたボタン1つだけ」を removeClass
        // すればよく、毎回「全ボタンを取得してクラスを取り除く」
        // という処理を省略できる。
        this._currentTocHighlight = null;
    }

    /**
     * 目次パネルを開く
     *
     * .open クラスを付けることで、CSS の transition により
     * サイドバーが左からスライドインし、背景オーバーレイも
     * フェードインする（実際のアニメーションは CSS 側が担当する）。
     */
    _openToc() {
        this.ui.tocPanel.addClass('open');
        this.ui.tocOverlay.addClass('open');
        this._highlightCurrentTocItem();
    }

    /**
     * 目次パネルを閉じる
     */
    _closeToc() {
        this.ui.tocPanel.removeClass('open');
        this.ui.tocOverlay.removeClass('open');
    }

    /**
     * 目次の項目がクリックされたときに該当ページへジャンプする
     *
     * PC モードでは spreadIndex（見開き番号）を、Mobile モードでは
     * pageIndex（ページ番号）を使う。
     *
     * 移動方法の切り替え:
     *   移動先までの距離が FLUTTER_THRESHOLD 以上離れている場合は
     *   「パラパラめくり」アニメーション（_runFlutter）を再生する。
     *   距離が近い場合は、パラパラめくりをするほどの見栄えの効果が
     *   薄いため、従来通りの即時切替えにする。
     *
     * @param {number} spreadIndex - 移動先の見開きインデックス（PC用）
     * @param {number} pageIndex   - 移動先のページインデックス（Mobile用）
     */
    async _jumpToToc(spreadIndex, pageIndex) {
        if (this.animator.state.isAnimating || this.animator.state.dragging) return;
        this._stopAutoPlay(); // 目次から手動で移動したら自動送りは止める

        // 目次パネルは移動方法に関わらず即座に閉じる
        // （パラパラめくりの様子を隠さず見せるため）
        this._closeToc();

        const FLUTTER_THRESHOLD = this.C.FLUTTER_THRESHOLD; // これ以上ページ/見開きが離れていたらパラパラめくりにする

        if (this.isMobile) {
            const distance = Math.abs(pageIndex - this.currentPageIdx);
            if (distance >= FLUTTER_THRESHOLD) {
                await this._runFlutter(pageIndex);
            } else {
                this.currentPageIdx = pageIndex;
                this.currentSpread  = spreadIndex;
                this.render();
                this.updateUI();
            }
        } else {
            const distance = Math.abs(spreadIndex - this.currentSpread);
            if (distance >= FLUTTER_THRESHOLD) {
                await this._runFlutter(spreadIndex);
            } else {
                this.currentSpread  = spreadIndex;
                this.currentPageIdx = pageIndex;
                // PC モードでは見開きに画像が紐づいているかもしれないため先読みする
                await this._preloadCachedImage(spreadIndex);
                this.render();
                this.updateUI();
            }
        }
    }

    /**
     * 複数ページ/見開きを「ひとまとめに」めくる自然なパラパラめくり
     * （リフル）アニメーションを行う。
     *
     * 旧実装との違い:
     *   旧: 1枚を完全にめくり終えてから次の1枚を開始する逐次再生
     *       （カクカクして不自然だった）。
     *   新: 複数のシートを「めくり始めのタイミングを少しずつずらして」
     *       1本の RAF ループで同時進行させる。前のシートがまだ
     *       めくれている最中に次が動き出すため、紙を指で弾いたような
     *       連続した自然な動きになる。
     *
     * 方向の扱い（実装をシンプルかつ確実にするための工夫）:
     *   常に「小さいインデックス lo → 大きいインデックス hi」へ進む
     *   “順方向リフル”として 1 つだけ実装する。
     *     ・前へ進む（target>start）: そのまま時間 τ=elapsed で再生。
     *     ・後ろへ戻る（target<start）: 同じ順方向リフルを τ=total-elapsed と
     *       時間を逆回しで再生する。これにより「正しい順方向アニメの
     *       完全な逆再生」となり、戻り方向専用のロジックを別に書かずに
     *       確実に整合する。
     *
     * 各フレームの重ね合わせ（下→上）:
     *   ① 左半分の最背面 = 直近に着地したシートの裏面（無ければ開始の左頁）
     *   ② 右半分の最背面 = 着地先（hi）の右頁（右の山の一番下）
     *   ③ 山の最上面     = まだめくり始めていない一番手前の頁
     *   ④ 飛行中シート群 = 開始タイミングがずれた複数の捲れ
     *
     * @param {number} targetIdx - 最終的な移動先のインデックス
     *        （Mobile: pages配列の番号 / PC: spreads配列の番号）
     * @returns {Promise<void>} 全体が完了したら解決される
     * @private
     */
    _runFlutter(targetIdx) {
        return new Promise((resolve) => {
            const isMobile = this.isMobile;
            const startIdx = isMobile ? this.currentPageIdx : this.currentSpread;
            if (targetIdx === startIdx) { resolve(); return; }

            const forward = targetIdx > startIdx;
            const loIdx = Math.min(startIdx, targetIdx);
            const hiIdx = Math.max(startIdx, targetIdx);
            const N     = hiIdx - loIdx;          // めくるシート枚数
            const cr    = this.contentRenderer;

            // ── 各シートの面を事前レンダリング（preRenderPage はキャッシュ付き）──
            // 順方向 lo→hi として用意する。
            //   PC:     シート i の表 = spreads[lo+i].right、裏 = spreads[lo+i+1].left
            //   Mobile: シート i の面 = pages[lo+i]
            const fronts = [], backs = [];
            for (let k = 0; k < N; k++) {
                const i = loIdx + k;
                if (isMobile) {
                    const pg = cr.pages[i];
                    fronts.push(cr.preRenderPage(pg.fn, pg.isRight));
                } else {
                    fronts.push(cr.preRenderPage(cr.spreads[i].right, true));
                    backs.push(cr.preRenderPage(cr.spreads[i + 1].left, false));
                }
            }

            // ── タイミング（総時間が長くなりすぎたら比例縮小）──
            const C = this.C;
            let sheetMs = C.FLUTTER_SHEET_MS;
            let stagger = C.FLUTTER_STAGGER_MS;
            let total   = stagger * (N - 1) + sheetMs;
            if (total > C.FLUTTER_MAX_MS) {
                const s = C.FLUTTER_MAX_MS / total;
                sheetMs *= s; stagger *= s; total = C.FLUTTER_MAX_MS;
            }

            // 他の操作（goNext/goPrev 等）と競合しないようアニメ中フラグを立てる
            this.animator.state.isAnimating = true;

            const t0 = performance.now();
            this.audioPlayer.play();
            let soundsPlayed = 1;
            const soundCap = Math.min(N, 8); // 鳴らしすぎないよう上限

            const frame = (now) => {
                const elapsed = Math.min(now - t0, total);
                // 後ろへ戻るときは時間を逆回しして順方向リフルを逆再生する
                const tau = forward ? elapsed : (total - elapsed);

                // シート k の進捗 t（0=未着手, 1=着地）
                const tk = (k) => {
                    const v = (tau - k * stagger) / sheetMs;
                    return v < 0 ? 0 : (v > 1 ? 1 : v);
                };

                // landedMax: すでに着地し終えた最大シート番号（-1 なら無し）
                let landedMax = -1;
                for (let k = N - 1; k >= 0; k--) { if (tk(k) >= 1) { landedMax = k; break; } }
                // m: まだめくり始めていない最小シート番号（-1 なら無し）
                let m = -1;
                for (let k = 0; k < N; k++) { if (tk(k) <= 0) { m = k; break; } }

                if (isMobile) {
                    // 最背面 = スタックの一番下＝着地先ページ（常に hi）。
                    // landedMax を使うと終盤で奥のページが手前のものに化け、
                    // 連続めくりの「下から現れる絵」が崩れるため hi で固定する。
                    const basePage = cr.preRenderPage(cr.pages[hiIdx].fn, cr.pages[hiIdx].isRight);
                    const pileTop  = (m >= 0)
                        ? cr.preRenderPage(cr.pages[loIdx + m].fn, cr.pages[loIdx + m].isRight)
                        : null;
                    // 手前ほど後で描く（奥→手前）。手前 = 進捗が大きい小さい k。
                    const curls = [];
                    for (let k = N - 1; k >= 0; k--) {
                        const t = tk(k);
                        if (t > 0 && t < 1) curls.push({ t, front: fronts[k] });
                    }
                    this.bookRenderer.renderFlutterMobile(basePage, pileTop, curls);
                } else {
                    const spreads = cr.spreads;
                    // 左半分の最背面 = 直近に着地したシートの裏面（無ければ開始見開きの左頁）
                    const leftBaseImg  = cr.preRenderPage(spreads[loIdx + landedMax + 1].left, false);
                    // 右半分の最背面 = 着地先（hi）の右頁（右の山の一番下）
                    const rightBaseImg = cr.preRenderPage(spreads[hiIdx].right, true);
                    const pileTopImg = (m >= 0)
                        ? cr.preRenderPage(spreads[loIdx + m].right, true)
                        : null;
                    // 重なり順（z順）が右ページのめくり描画の肝。
                    // PC は綴じ目を軸に回転するため、紙が立っている瞬間
                    // （t=0.5）に最も高く持ち上がる。頂点に近いシートほど
                    // 物理的に手前にあるので「|t-0.5| が小さいほど後で（上に）
                    // 描く」= |t-0.5| の降順で重ねる。
                    // これで右側（持ち上がり中＝より進んだ方が手前）も
                    // 左側（着地間際＝より進んだ方が奥）も同時に正しくなる。
                    // （単純な k 昇順だと右側で、まだ寝ているだけの後続ページが
                    //   めくり上がり中のページを覆い隠してしまっていた）
                    const curls = [];
                    for (let k = 0; k < N; k++) {
                        const t = tk(k);
                        if (t > 0 && t < 1) curls.push({ t, front: fronts[k], back: backs[k], reverse: false });
                    }
                    curls.sort((a, b) => Math.abs(b.t - 0.5) - Math.abs(a.t - 0.5));
                    this.bookRenderer.renderFlutterPC(leftBaseImg, rightBaseImg, pileTopImg, curls);
                }

                // 効果音を全体の進行に合わせて数回鳴らす
                const wantSounds = Math.min(soundCap, 1 + Math.floor((elapsed / total) * soundCap));
                while (soundsPlayed < wantSounds) { this.audioPlayer.play(); soundsPlayed++; }

                if (elapsed >= total) {
                    // 完了: 位置を確定し、通常の静止描画に戻す
                    this.animator.state.isAnimating = false;
                    this.currentPageIdx = isMobile ? targetIdx : targetIdx * 2;
                    this.currentSpread  = isMobile ? Math.floor(targetIdx / 2) : targetIdx;
                    (async () => {
                        if (!isMobile) await this._preloadCachedImage(this.currentSpread);
                        this.render();
                        this.updateUI();
                        resolve();
                    })();
                    return;
                }
                requestAnimationFrame(frame);
            };

            requestAnimationFrame(frame);
        });
    }

    /**
     * 目次パネル内の「現在表示中の章」に対応する項目をハイライトする
     *
     * 現在のページ番号（PC なら currentSpread、Mobile なら
     * currentPageIdx）に最も近い、かつそれ以前にある目次項目を
     * 「現在地」として扱う。例えば「第一章」の2ページ目を表示中でも、
     * 目次の中で次に新しい見出しが出てくるまでは「第一章」が
     * ハイライトされ続ける（本の目次として自然な振る舞い）。
     * @private
     */
    _highlightCurrentTocItem() {
        const entries = this.contentRenderer.tocEntries;
        if (entries.length === 0) return;

        const currentPageIndex = this.isMobile
            ? this.currentPageIdx
            : this.currentSpread * 2; // 見開きの左ページ相当のインデックスに変換

        // 現在地以前にある項目の中で、最もページ番号が大きい
        // （＝最も現在地に近い）ものを探す。見つからなければ
        // 先頭の項目（表紙や序文など）をそのまま使う。
        let matched = entries[0];
        for (const entry of entries) {
            if (entry.pageIndex <= currentPageIndex) {
                matched = entry;
            } else {
                break; // tocEntries はページ順になっているので、ここで探索を打ち切れる
            }
        }

        // ── パフォーマンス最適化：DOM検索を配列走査に置き換える ──
        // 以前は毎回「全ボタン取得 + removeClass」と「属性セレクタで
        // 該当ボタンを検索 + addClass」という2回のDOM検索を行って
        // いたが、_buildTocList() で保存しておいた軽量な配列
        // （_tocButtons）を直接見るだけで同じ結果が得られる。
        // 配列の要素数は章の数程度（通常10件未満）なので、
        // 線形探索（.find）でも実質的なコストはほぼゼロに近い。
        //
        // 「前回ハイライトしていたボタン」（_currentTocHighlight）を
        // 覚えておくことで、removeClass の対象を「そのボタン1つ」に
        // 絞り、毎回「全ボタンからクラスを取り除く」という処理も
        // 省略している。
        if (this._currentTocHighlight) {
            this._currentTocHighlight.removeClass('current');
        }

        const target = this._tocButtons && this._tocButtons.find(
            b => b.spreadIndex === matched.spreadIndex && b.pageIndex === matched.pageIndex
        );
        if (target) {
            target.$btn.addClass('current');
            this._currentTocHighlight = target.$btn;
        }
    }

    /**
     * 目次の開閉・項目クリックに関するイベントを登録する
     * @private
     */
    _bindTocEvents() {
        this.ui.tocToggleBtn.on('click', () => this._openToc());
        this.ui.tocCloseBtn.on('click', () => this._closeToc());
        // オーバーレイ（サイドバー外の暗い部分）をクリックしても閉じられるようにする
        this.ui.tocOverlay.on('click', () => this._closeToc());

        // Escキーでも閉じられるようにする（よくあるダイアログ系UIの作法）
        $(document).on('keydown', (e) => {
            if (e.key === 'Escape') this._closeToc();
        });

        // PDFダウンロードボタン
        this.ui.pdfExportBtn.on('click', () => this._handlePdfExport());

        // ページめくり音 ON/OFF トグル
        this.ui.soundToggle.on('change', (e) => {
            this.audioPlayer.setEnabled(e.target.checked);
            try {
                localStorage.setItem('ebook-sound-enabled', e.target.checked ? '1' : '0');
            } catch (err) {
                console.warn('音設定の保存に失敗しました:', err);
            }
        });

        // 自動ページ送り（スライドショー）の開始/停止ボタン
        this.ui.autoPlayBtn.on('click', () => this._toggleAutoPlay());
    }

    /**
     * 起動時に、保存済みの「ページめくり音 ON/OFF」設定を復元する
     *
     * 呼び出すタイミング: init() の中で一度だけ呼ぶ。
     * 保存データが無い場合（初回訪問）はデフォルトの ON のままにする。
     * @private
     */
    _restoreSoundSetting() {
        let enabled = true;
        try {
            const saved = localStorage.getItem('ebook-sound-enabled');
            if (saved !== null) enabled = (saved === '1');
        } catch (e) {
            console.warn('音設定の読込に失敗しました:', e);
        }
        this.audioPlayer.setEnabled(enabled);
        this.ui.soundToggle.prop('checked', enabled);
    }

    /**
     * 自動ページ送り（スライドショー）の開始/停止を切り替える
     *
     * 仕組み:
     *   setInterval で一定間隔ごとに goNext() を呼ぶだけ。
     *   goNext() 自体はアニメーション中なら何もしない安全装置を
     *   既に持っているため、インターバルの間隔をアニメーション時間
     *   より少し長くしておけば、めくり途中に次の呼び出しが来て
     *   動きがおかしくなる、ということは起きない。
     *
     *   最終ページに到達したら自動的に停止する（無限ループで
     *   「次がありません」を繰り出すだけの状態にならないように）。
     * @private
     */
    _toggleAutoPlay() {
        if (this._autoPlayTimer) {
            // 既に再生中 → 停止する
            this._stopAutoPlay();
        } else {
            // 停止中 → 開始する
            const AUTO_PLAY_INTERVAL_MS = 3500; // 1ページ表示する時間（めくり時間込み）

            this.ui.autoPlayBtn.text('⏸ 停止').addClass('active');

            this._autoPlayTimer = setInterval(() => {
                const atLastPage = this.isMobile
                    ? (this.currentPageIdx >= this.contentRenderer.pages.length - 1)
                    : (this.currentSpread  >= this.contentRenderer.spreads.length - 1);

                if (atLastPage) {
                    // 最終ページに到達したので自動的に停止する
                    this._stopAutoPlay();
                    return;
                }
                this.goNext();
            }, AUTO_PLAY_INTERVAL_MS);
        }
    }

    /**
     * 自動ページ送りを停止し、ボタンの表示を元に戻す
     * @private
     */
    _stopAutoPlay() {
        if (this._autoPlayTimer) {
            clearInterval(this._autoPlayTimer);
            this._autoPlayTimer = null;
        }
        this.ui.autoPlayBtn.text('▶ 自動ページ送り').removeClass('active');
    }

    /**
     * 「PDFをダウンロード」ボタンが押されたときの処理
     *
     * ボタンを押している間は二重クリックを防ぐために無効化し、
     * 進捗（何ページ目を処理しているか）をボタン下のテキストに
     * 表示する。処理完了後（またはエラー時）は必ずボタンを
     * 元の状態に戻す（finally 相当の処理を try/catch の両方に書く
     * のではなく、async/await の構造に合わせて try...finally を使う）。
     * @private
     */
    async _handlePdfExport() {
        const { pdfExportBtn, pdfExportStatus } = this.ui;

        pdfExportBtn.prop('disabled', true);
        pdfExportStatus.text('準備中…');

        try {
            await this.pdfExporter.exportToPdf((current, total) => {
                pdfExportStatus.text(`書き出し中… (${current} / ${total})`);
            });
            pdfExportStatus.text('ダウンロードが完了しました');
        } catch (e) {
            // jsPDF が読み込めていない、画像変換に失敗した等のケース。
            // ここで失敗してもページめくり自体には影響しないため、
            // エラーメッセージを表示して処理を止めるだけにする。
            console.error('[PDF書き出し] エラーが発生しました:', e);
            pdfExportStatus.text('書き出しに失敗しました');
        } finally {
            pdfExportBtn.prop('disabled', false);
            // 数秒後にステータス表示を消す（いつまでも残っていると
            // 「まだ処理中なのか」と誤解されるため）
            setTimeout(() => pdfExportStatus.text(''), 4000);
        }
    }

    /**
     * モバイルモードでのスワイプジェスチャーを登録する
     *
     * 設計方針:
     *   タッチの座標を毎フレーム取得し、その移動量を
     *   BookAnimator.updateDragProgress() にそのまま渡す。
     *   これにより「指を動かした分だけページがめくれる」
     *   「ホールド（移動量ゼロ）では何も起きない」という、
     *   指の動きに直接追従する操作感を実現する。
     *
     * イベントの流れ:
     *   touchstart → beginDrag()
     *                isMobile でなければ何もしない（PC は対象外）
     *   touchmove  → updateDragProgress(deltaX) → render()
     *                preventDefault() でページ全体のスクロールを止める
     *   touchend   → endDrag() で確定/キャンセルを判定し、
     *                残りを自動アニメーションで仕上げる
     *
     * マウスでの動作確認用に mousedown/mousemove/mouseup にも
     * 同じロジックをバインドしている（実機テストがしづらいため）。
     * @private
     */
    _bindSwipeGesture() {
        const $canvas = $(this.canvas);

        // ここで定義する startX・dragActive などの変数は、
        // 下に書かれている onStart・onMove・onEnd という3つの関数
        // すべてから共有して読み書きされる「ドラッグ操作中の状態」。
        // これらの関数は「クロージャ」という仕組みにより、
        // _bindSwipeGesture が呼び出し終わった後もこの変数を
        // 覚えていられる（イベントが起きるたびに最新の値を読み書きできる）。
        let startX = null;      // touchstart した瞬間のX座標（基準点）
        let dragActive = false; // 今まさにドラッグ操作中かどうか

        // const onStart = (clientX) => { ... } という書き方について:
        //   これは「アロー関数」という関数の書き方で、
        //   function onStart(clientX) { ... } とほぼ同じ意味。
        //   こう書いておくことで、後ろの $canvas.on('touchstart', ...)
        //   の中から onStart という名前で呼び出せるようになる。
        //
        // PC/Mobile 両対応について:
        //   Mobile では pages 配列・currentPageIdx を、
        //   PC では spreads 配列・currentSpread を渡す。
        //   beginDrag の第3引数 isMobileMode で、後続の
        //   updateDragProgress が「どちらの幅・配列で計算するか」を
        //   判断できるようにしている。
        const onStart = (clientX) => {
            const items     = this.isMobile ? this.contentRenderer.pages   : this.contentRenderer.spreads;
            const currentIdx = this.isMobile ? this.currentPageIdx          : this.currentSpread;
            const started = this.animator.beginDrag(items, currentIdx, this.isMobile);
            if (!started) return;
            this._stopAutoPlay(); // 手動でドラッグを始めたら自動送りは止める
            startX = clientX;
            dragActive = true;
        };

        // ── touchmove の発火頻度対策（描画スロットリング） ──
        // touchmove はブラウザによって 60〜120Hz 程度の高頻度で発火する。
        // drawMobileCurl は 1 回の呼び出しで MOBILE_NUM_SLICES 本の
        // drawImage と輪郭計算を行うため、touchmove のたびに毎回
        // render() をフル実行すると、画面のリフレッシュレートを超える
        // 頻度で重い描画が走り、表示が遅延・カクつく原因になる。
        // これを防ぐため、最新の deltaX だけを保持しておき、実際の
        // 描画は requestAnimationFrame で「1フレームに1回」に
        // まとめて行う（スロットリング = 頻度を間引くこと）。
        let pendingDeltaX  = null;  // まだ描画に反映していない「最新の移動量」
        let renderScheduled = false; // 「次のフレームで描画する予約」が入っているか

        const scheduleRender = (deltaX) => {
            pendingDeltaX = deltaX; // 最新の移動量で常に上書きする
            if (renderScheduled) return; // 既に次フレームの描画が予約済み
            renderScheduled = true;
            requestAnimationFrame(() => {
                renderScheduled = false;
                if (pendingDeltaX === null || !dragActive) return;
                this.animator.updateDragProgress(pendingDeltaX);
                this.render();
            });
        };

        const onMove = (clientX) => {
            if (!dragActive || startX === null) return;
            const deltaX = clientX - startX;
            scheduleRender(deltaX);
        };

        const onEnd = () => {
            if (!dragActive) return;

            // スロットリングで描画待ちになっていた「最後の移動量」を
            // ここで確実に反映する。これを忘れると、指を離す直前の
            // わずかな動きが progress に反映されないまま endDrag の
            // 確定/キャンセル判定が行われてしまう可能性がある。
            if (pendingDeltaX !== null) {
                this.animator.updateDragProgress(pendingDeltaX);
                pendingDeltaX = null;
            }

            dragActive = false;
            startX = null;

            this.animator.endDrag(
                () => this.render(),
                (finishedIdx) => {
                    // ページ送りが確定した。
                    // finishedIdx の意味は drag 開始時のモードによって変わる:
                    //   Mobile: pages 配列のインデックス（ページ番号）
                    //   PC    : spreads 配列のインデックス（見開き番号）
                    // どちらの場合も、もう一方の位置指標を変換して
                    // 同期させる（goNext/goPrev 完了時と同じ考え方）。
                    if (this.isMobile) {
                        this.currentPageIdx = finishedIdx;
                        this.currentSpread  = Math.floor(finishedIdx / 2);
                    } else {
                        this.currentSpread  = finishedIdx;
                        this.currentPageIdx = finishedIdx * 2;
                    }
                    this.render();
                    this.updateUI();
                },
                () => {
                    // キャンセルされた（位置は変わらないが再描画だけ行う）
                    this.render();
                    this.updateUI();
                },
                () => {
                    // 確定が判明した瞬間（残りのアニメーションが始まる前）
                    // に呼ばれる。ページめくり音をここで鳴らすことで、
                    // 「指を離して、もう戻せない」と決まった瞬間に
                    // 音が鳴るという、ボタン操作（goNext/goPrev）と
                    // 揃った自然なタイミングになる。
                    this.audioPlayer.play();
                }
            );
        };

        // ── タッチイベント（実機向け） ────────────────────
        $canvas.on('touchstart', (e) => {
            if (!this.isMobile) return;
            const touch = e.originalEvent.touches[0];
            onStart(touch.clientX);
        });

        $canvas.on('touchmove', (e) => {
            if (!dragActive) return;
            e.preventDefault(); // ページ全体のスクロールを止める
            const touch = e.originalEvent.touches[0];
            onMove(touch.clientX);
        });

        $canvas.on('touchend touchcancel', () => {
            onEnd();
        });

        // ── マウスイベント（PC ドラッグ操作 / 動作確認の両方を兼ねる） ───
        // 以前は isMobile のときだけ（= ウィンドウを狭くしたデバッグ用）
        // 有効にしていたが、PC モードでもマウスでページをめくれるように
        // するため、モードを問わず常に有効にした。
        // onStart 内で isMobile に応じて pages/spreads を切り替えるため、
        // ここでのモード判定は不要になっている。
        $canvas.on('mousedown', (e) => {
            onStart(e.clientX);
        });
        $(document).on('mousemove', (e) => {
            if (!dragActive) return;
            onMove(e.clientX);
        });
        $(document).on('mouseup', () => {
            onEnd();
        });
    }

    /**
     * 画像のドラッグ＆ドロップ用イベントを登録する
     *
     * ブラウザの既定動作（ドロップした画像をページ全体に
     * 表示してナビゲートしてしまう）を防ぐため、
     * dragover と drop の両方で preventDefault() が必要。
     *
     * document 全体でも既定動作を防ぐ理由:
     *   Canvas 要素に dragover/drop を登録していても、ブラウザは
     *   「ウィンドウ全体としてファイルのドロップを許可するか」を
     *   別途判定する。document（または window）側で何も
     *   preventDefault() していないと、ドラッグ中のカーソルが
     *   終始「禁止」マークのまま固定され、Canvas 上の个別ハンドラに
     *   到達する前にブラウザの既定動作（別タブで画像を開く等）が
     *   優先されてしまうブラウザがある。
     *   そのため、document レベルでも dragover/drop の既定動作を
     *   先に解除しておく。
     *
     * 対象範囲:
     *   実際に画像を受け取るのは Canvas 要素のみ。
     *   document 側のリスナーは「ブラウザに許可を伝える」ためだけの
     *   ものであり、ファイルの処理自体は行わない
     *   （Canvas 側の drop ハンドラが処理を担う）。
     *
     * 表紙ページでは無効にする理由:
     *   今回の要件は「見開きが開いている状態」が対象であり、
     *   表紙（spreads[0]）は別仕様として後日対応する前提のため、
     *   ここでは _isCoverSpread() で判定して早期に無視する。
     * @private
     */
    _bindDragAndDrop() {
        const canvasEl = this.canvas;
        const $canvas  = $(canvasEl);

        // ── document 全体の既定動作を解除 ──────────────────
        // これが無いと、ブラウザによっては Canvas 上であっても
        // ドラッグ中のカーソルが常に「禁止」マークになり、
        // drop イベント自体が発火しないことがある。
        $(document).on('dragover drop', (e) => {
            e.preventDefault();
        });

        // jQuery の dragenter/dragover/drop は素のイベントオブジェクトに
        // アクセスするため e.originalEvent を経由する。
        //
        // dragenter にも preventDefault() が必要な理由:
        //   ブラウザは dragenter → dragover → drop の順でイベントを発火する。
        //   dragenter の時点でデフォルト動作（拒否）のままだと、
        //   その後の dragover で copy を指定しても「禁止」カーソルが
        //   表示され続け、drop も発火しないブラウザがある。
        //   dragenter ・ dragover の両方で明示的に許可する必要がある。
        $canvas.on('dragenter', (e) => {
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'copy';
        });

        $canvas.on('dragover', (e) => {
            e.preventDefault(); // これが無いと drop イベントが発火しない
            e.originalEvent.dataTransfer.dropEffect = 'copy';
            $canvas.addClass('drag-over'); // 視覚的フィードバック（CSS側で枠線表示）
        });

        $canvas.on('dragleave', () => {
            $canvas.removeClass('drag-over');
        });

        $canvas.on('drop', (e) => {
            e.preventDefault();
            $canvas.removeClass('drag-over');
            this._handleImageDrop(e.originalEvent);
        });
    }

    /**
     * 画像ドロップ時の本体処理
     *
     * 処理の流れ:
     *   1. ドロップされたファイルの中から画像ファイルのみ抽出
     *   2. PC モードかつ「見開きが開いている状態」かを確認
     *      （Mobile モード・表紙ページではドロップを無視する）
     *   3. ドロップ座標が左ページ側かどうかを確認
     *      （右ページへのドロップは今回の要件外のため無視する）
     *   4. ImageStore でリサイズのみ行う（永続化はまだ行わない）
     *   5. 画像キャッシュを更新して再描画
     *
     * 永続化について:
     *   現時点では画像をブラウザに保存する機能はまだ有効にしていない
     *   （将来的に対応予定）。そのため、ドロップした画像は
     *   ページを離れたり再読み込みしたりすると消える
     *   （タブを閉じない限り、表示中は _imageCache に残る）。
     *
     * @param {DragEvent} dragEvent - ブラウザネイティブの DragEvent
     * @private
     */
    async _handleImageDrop(dragEvent) {
        try {
            // PC モード以外（Mobile）はそもそも見開き表示がないため対象外
            if (this.isMobile) {
                console.log('[drop] Mobile モードのため無視しました');
                return;
            }

            // 表紙（最初の見開き）は今回の対象外。要件通り無視する。
            if (this._isCoverSpread(this.currentSpread)) {
                console.log('[drop] 表紙ページのため無視しました（spreads[0]）');
                return;
            }

            // ドロップされたファイルの中から画像だけを取り出す
            const files = Array.from(dragEvent.dataTransfer.files || [])
                .filter(f => f.type.startsWith('image/'));
            if (files.length === 0) {
                console.log('[drop] 画像ファイルが見つかりませんでした', dragEvent.dataTransfer.files);
                return;
            }

            // ドロップ座標が左ページ側かどうかを判定する。
            // 右ページへのドロップは今回の要件（左ページに表示）に
            // 含まれないため、左ページ側でなければ何もしない。
            if (!this._isDropOnLeftPage(dragEvent)) {
                console.log('[drop] 右ページ側へのドロップのため無視しました');
                return;
            }

            console.log('[drop] 画像を読み込みます:', files[0].name, 'spreadIndex=', this.currentSpread);

            const file = files[0]; // 複数ドロップされても先頭の 1 枚のみ採用

            // リサイズのみ行う（localStorage への保存は行わない）
            const dataUrl = await this.imageStore.prepareImage(file);
            console.log('[drop] prepareImage 完了, dataUrl長さ=', dataUrl ? dataUrl.length : 'null');

            // データURLから Image オブジェクトを作りキャッシュに登録する。
            // ここで再度ファイルを読み直すのではなく、prepareImage が返した
            // データURLをそのまま使うことで二重読み込みを避けている。
            const img = await loadImageFromSrc(dataUrl);
            console.log('[drop] Image読込完了, width=', img.width, 'height=', img.height);

            this._imageCache.set(this.currentSpread, img);

            console.log('[drop] 画像をキャッシュに登録し再描画します（見開き', this.currentSpread, '）');
            this.render(); // 画像を反映した状態で再描画
            console.log('[drop] render() 呼び出し完了');

        } catch (err) {
            // prepareImage / loadImage 等で例外が起きた場合、
            // async 関数のため何もしないと静かに失敗してしまう。
            // 必ずコンソールに出して原因を追えるようにする。
            console.error('[drop] 画像ドロップ処理中にエラーが発生しました:', err);
        }
    }

    /**
     * 指定した見開きインデックスが表紙かどうかを判定する
     * @param {number} spreadIndex
     * @returns {boolean}
     * @private
     */
    _isCoverSpread(spreadIndex) {
        return spreadIndex === 0;
    }

    /**
     * ドロップ座標がページの左半分（左ページ）かどうかを判定する
     *
     * Canvas は CSS でスケールされて表示されているため、
     * マウス座標（CSS ピクセル）を Canvas の描画解像度に
     * 変換してから判定する必要がある。
     *
     * 変換式:
     *   canvas_x = (clientX - canvasRect.left) × (canvas.width / canvasRect.width)
     *
     * @param {DragEvent} dragEvent
     * @returns {boolean} 左ページ側なら true
     * @private
     */
    _isDropOnLeftPage(dragEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const cssX = dragEvent.clientX - rect.left;
        // CSS 表示幅 → Canvas 描画解像度幅へのスケール変換
        const canvasX = cssX * (this.canvas.width / rect.width);
        const isLeft  = canvasX < this.C.SPINE_X; // 綴じ目より左側か

        console.log('[drop] 座標判定: clientX=', dragEvent.clientX,
            'rect.left=', rect.left, 'rect.width=', rect.width,
            'canvas.width=', this.canvas.width,
            '-> cssX=', cssX.toFixed(1), 'canvasX=', canvasX.toFixed(1),
            'SPINE_X=', this.C.SPINE_X, '-> isLeft=', isLeft);

        return isLeft;
    }

    /**
     * 現在の見開きに保存済みの画像があれば事前に読み込んでキャッシュする
     *
     * 呼び出すタイミング:
     *   ・起動時（init）
     *   ・PC モードでページ移動した直後（_onPCFlipComplete / goPrev）
     *   ・Mobile → PC へモード切替した直後（applyMode）
     *
     * すでにキャッシュ済みの場合は何もしない
     * （localStorage への問い合わせ自体は軽量だが、
     *   Image の再構築コストを避けるため早期 return する）。
     *
     * @param {number} spreadIndex
     * @private
     */
    async _preloadCachedImage(spreadIndex) {
        if (this._imageCache.has(spreadIndex)) return;
        const img = await this.imageStore.loadImage(spreadIndex);
        if (img) this._imageCache.set(spreadIndex, img);
    }

    /**
     * デバウンス後に実行される実際のリサイズ処理
     * @private
     */
    async _handleResize() {
        if (this.animator.state.isAnimating) return;

        const shouldMobile = this._debugForceMode
            ? this._debugForceMode === 'mobile'
            : window.innerWidth < this.C.BREAKPOINT;

        if (shouldMobile !== this.isMobile) {
            await this.applyMode(shouldMobile);
            this.render();
            this.updateUI();
        } else {
            const { PC_W, PC_H, MOB_W, MOB_H } = this.C;
            if (this.isMobile) {
                this._applyCssScale(MOB_W, MOB_H, 20);
            } else {
                this._applyCssScale(PC_W, PC_H, 40);
            }
        }
    }

    _toggleDebugMode() {
        if (this._debugForceMode === 'pc') {
            this._debugForceMode = null;
        } else {
            this._debugForceMode = this.isMobile ? 'pc' : 'mobile';
        }
        this._handleResize();
    }
}
