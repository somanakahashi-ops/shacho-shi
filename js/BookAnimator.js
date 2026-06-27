/* ================================================================
   BookAnimator.js
   ── 社長の自分史 電子ブック ─ アニメーション駆動クラス

   このクラスの責務:
     ・requestAnimationFrame（RAF）ループを管理する
     ・アニメーションの進捗状態（isAnimating, progress, offFront,
       offBack 等）を「単一の状態オブジェクト」として保持する
     ・アニメーション開始時にオフスクリーン Canvas を事前生成する
       （PageContentRenderer.preRenderPage() を呼ぶ）

   このクラスの責務外:
     ・実際の描画処理
       → 完了コールバック経由で BookRenderer / BookController に委譲する
     ・どのページへ進むかの判断（ナビゲーションロジック）
       → BookController が担当する

   ── RAF ループパターン ──
     RAF はブラウザの描画タイミングに同期して関数を呼ぶ仕組み。
     setTimeout/setInterval と異なり、タブが非アクティブなら
     自動的に一時停止するためリソース効率が良い。

     進捗 t の算出:
       t = (現在時刻 - 開始時刻) / FLIP_MS
       ただし t > 1.0 になったら 1.0 にクランプしてループを終了する。
   ================================================================ */

class BookAnimator {

    /**
     * @param {Object} constants - BOOK_CONST（FLIP_MS を使用）
     * @param {PageContentRenderer} contentRenderer - 事前描画キャッシュ生成に使用
     */
    constructor(constants, contentRenderer) {
        this.C               = constants;
        this.contentRenderer = contentRenderer;

        // ── アニメーション状態（単一オブジェクトで管理） ──
        // BookRenderer.renderPC() / renderMobile() に
        // そのまま渡せる形にしてある。
        this.state = {
            isAnimating: false,
            progress:    0,      // 0.0（開始）〜 1.0（完了）
            offFront:    null,   // 事前描画キャッシュ：捲れていくページ
            offBack:     null,   // 事前描画キャッシュ：背後に現れるページ
            reverse:     false,  // true なら「前へ」方向の逆再生

            // ── ドラッグ（スワイプ）操作用の状態 ──────────────
            // isAnimating（時間駆動）とは独立した、指の動きに直接
            // 追従するための状態。同時に true になることはない
            // （beginDrag は isAnimating 中は失敗する設計のため）。
            dragging:        false, // ドラッグ操作中かどうか
            dragPages:       null,  // ドラッグ開始時の pages/spreads 配列
            dragCurrentIdx:  0,     // ドラッグ開始時の現在ページ/見開きインデックス
            dragIsMobile:    true,  // true: Mobile（pages基準） / false: PC（spreads基準）
            dragDirection:   null   // 'next' | 'prev' | 'blocked' | null
        };
    }

    /**
     * PC モードのページめくりアニメーションを開始する
     *
     * @param {Array}    spreads        - PageContentRenderer.spreads
     * @param {number}   currentSpread  - 現在の見開きインデックス
     * @param {number}   toIdx          - 移動先の見開きインデックス
     * @param {Function} onFrame        - 各フレームで呼ぶコールバック（描画担当）
     * @param {Function} onComplete     - 完了時に呼ぶコールバック（状態確定担当）
     * @param {boolean}  [reverse=false] - true なら「前へ」方向の逆再生
     * @param {number}   [durationMs] - 1回のめくりにかける時間（ミリ秒）。
     *                                   省略時は通常の FLIP_MS を使う。
     *                                   パラパラめくり機能（複数ページの
     *                                   一括移動）から、短い FLUTTER_MS を
     *                                   指定して呼ばれることがある。
     *
     * reverse の意味:
     *   false（次へ）: 現在の右ページが表面、移動先の左ページが裏面。
     *                   角度は 0°→180°（右→左へ回転）。
     *   true （前へ）: 現在の左ページが表面、移動先の右ページが裏面。
     *                   角度は 180°→0°（左→右へ回転、閉じる方向）。
     *                   PageFlipEffect.drawPCCurl 側で reverse フラグに応じて
     *                   ヒンジを綴じ目に固定したまま開始角度・終了角度を
     *                   入れ替えて描画する。
     */
    startFlipPC(spreads, currentSpread, toIdx, onFrame, onComplete, reverse = false, durationMs) {
        if (this.state.isAnimating) return;
        if (toIdx < 0 || toIdx >= spreads.length || toIdx === currentSpread) return;

        this.state.isAnimating = true;
        this.state.reverse     = reverse;

        if (!reverse) {
            this.state.progress = 0;
            this.state.offFront = this.contentRenderer.preRenderPage(spreads[currentSpread].right, true);
            this.state.offBack  = this.contentRenderer.preRenderPage(spreads[toIdx].left,          false);
        } else {
            this.state.progress = 1.0;
            this.state.offFront = this.contentRenderer.preRenderPage(spreads[toIdx].right,         true);
            this.state.offBack  = this.contentRenderer.preRenderPage(spreads[currentSpread].left,  false);
        }

        this._runLoop(onFrame, () => {
            this._resetState();
            onComplete(toIdx);
        }, reverse, durationMs);
    }

    /**
     * モバイルモードのページめくりアニメーションを開始する
     *
     * PC 版との主な違い:
     *   - spreads ではなく pages を対象にする
     *   - offFront = カールして展開・収縮するページ
     *   - offBack  = 背景として固定的に見えるページ
     *
     * @param {Array}    pages          - PageContentRenderer.pages
     * @param {number}   currentPageIdx - 現在のページインデックス
     * @param {number}   toIdx          - 移動先のページインデックス
     * @param {Function} onFrame        - 各フレームで呼ぶコールバック
     * @param {Function} onComplete     - 完了時に呼ぶコールバック
     * @param {boolean}  [reverse=false] - true なら「前へ」方向の逆再生
     * @param {number}   [durationMs] - 1回のめくりにかける時間（ミリ秒）。
     *                                   省略時は通常の FLIP_MS を使う。
     *
     * reverse の意味（「前へ」を逆再生で実現する仕組み）:
     *   false（次へ）:
     *     offFront = 現在ページ（pages[currentPageIdx]） … カールして消える
     *     offBack  = 次ページ（pages[toIdx]）             … 下から現れる
     *     progress は 0.0→1.0
     *
     *   true（前へ）:
     *     「前のページから現在ページへの“次へ”」を逆再生する。
     *     offFront = 前のページ（pages[toIdx]）           … カールが収縮して展開しきる
     *     offBack  = 現在ページ（pages[currentPageIdx]）  … 最初は全面に見えている
     *     progress は 1.0→0.0
     *     （= drawMobileCurl から見ると「t=1.0(見えない)→t=0.0(全面に見える)」
     *        という、ちょうど「次へ」の逆回しの絵になる）
     */
    startFlipMobile(pages, currentPageIdx, toIdx, onFrame, onComplete, reverse = false, durationMs) {
        if (this.state.isAnimating) return;
        if (toIdx < 0 || toIdx >= pages.length || toIdx === currentPageIdx) return;

        this.state.isAnimating = true;
        this.state.reverse     = reverse;

        if (!reverse) {
            this.state.progress = 0;
            // 「次へ」: offFront=現在ページ（消える）、offBack=次ページ（現れる）
            this.state.offFront = this.contentRenderer.preRenderPage(pages[currentPageIdx].fn, pages[currentPageIdx].isRight);
            this.state.offBack  = this.contentRenderer.preRenderPage(pages[toIdx].fn,          pages[toIdx].isRight);
        } else {
            this.state.progress = 1.0; // 逆再生は t=1.0 から開始する
            // 「前へ」: offFront=前のページ（展開していく）、offBack=現在ページ（背景）
            this.state.offFront = this.contentRenderer.preRenderPage(pages[toIdx].fn,          pages[toIdx].isRight);
            this.state.offBack  = this.contentRenderer.preRenderPage(pages[currentPageIdx].fn, pages[currentPageIdx].isRight);
        }

        this._runLoop(onFrame, () => {
            this._resetState();
            onComplete(toIdx);
        }, reverse, durationMs);
    }

    /* ================================================================
       ドラッグ（スワイプ）駆動のアニメーション制御
       ================================================================
       時間（RAF + FLIP_MS）で progress を進める startFlipMobile とは
       別の入力経路。指の移動量がそのまま progress に変換されるため、
       「ホールド（移動量ゼロ）では何も起きない」「指を動かした分だけ
       カールが追従する」という、スワイプ操作に必要な性質を持つ。

       使い方（BookController 側のタッチイベントから呼ぶ）:
         1. touchstart  → beginDrag()
         2. touchmove   → updateDragProgress(deltaX) を毎回呼ぶ
         3. touchend     → endDrag(onFrame, onCommit, onCancel) で
                            「めくり確定」か「元に戻す」かを自動判定し、
                            残りの動きだけ時間アニメーションで補完する
       ================================================================ */

    /**
     * ドラッグ操作を開始する（指が画面に触れた瞬間）
     *
     * この時点では「次へ」方向（pages[currentPageIdx] が消えて
     * pages[currentPageIdx+1] が現れる）を前提に offFront/offBack を
     * 準備する。指が右方向（前へ方向）に動いた場合は
     * updateDragProgress() 内で動的に逆方向へ切り替える。
     *
     * @param {Array}  pages          - PageContentRenderer.pages
     * @param {number} currentPageIdx - 現在のページインデックス
     * @returns {boolean} 開始できたか（既にアニメーション中なら false）
     */
    /**
     * ドラッグ操作を開始する（指/マウスが画面に触れた瞬間）
     *
     * この時点では「次へ」方向（items[currentIdx] が消えて
     * items[currentIdx+1] が現れる）を前提に offFront/offBack を
     * 準備する。指/マウスが右方向（前へ方向）に動いた場合は
     * updateDragProgress() 内で動的に逆方向へ切り替える。
     *
     * PC/Mobile 両対応について:
     *   以前はモバイル専用（pages配列・MOB_W固定）だったが、
     *   PC モードでもマウスドラッグでページをめくれるようにするため、
     *   「どちらのモードか」を isMobileMode として保持するように
     *   拡張した。これにより updateDragProgress() の中で、
     *   モバイルなら MOB_W・pages を、PC なら PAGE_W・spreads を
     *   使い分けられるようになる。
     *
     * @param {Array}   items        - PageContentRenderer.pages（Mobile）
     *                                  または .spreads（PC）
     * @param {number}  currentIdx   - 現在のページ/見開きインデックス
     * @param {boolean} [isMobileMode=true] - true なら Mobile 用の
     *                                  幅・配列の扱いをする
     * @returns {boolean} 開始できたか（既にアニメーション中なら false）
     */
    beginDrag(items, currentIdx, isMobileMode = true) {
        if (this.state.isAnimating) return false; // 時間駆動アニメーション中は割り込まない
        if (this.state.dragging) return false;     // 既にドラッグ中

        this.state.dragging       = true;
        this.state.dragPages      = items; // 名前は dragPages のままだが、PCモードでは spreads 配列が入る
        this.state.dragCurrentIdx = currentIdx;
        this.state.dragIsMobile   = isMobileMode;
        this.state.dragDirection  = null; // 'next' | 'prev' | null（まだ未確定）
        this.state.progress       = 0;
        this.state.reverse        = false;
        this.state.offFront       = null;
        this.state.offBack        = null;
        return true;
    }

    /**
     * ドラッグの移動量から progress を更新する（touchmove のたびに呼ぶ）
     *
     * 方向の確定タイミング:
     *   最初に意味のある移動（|deltaX| > 数px）が起きた時点で、
     *   左方向（deltaX < 0）なら「次へ」、右方向（deltaX > 0）なら
     *   「前へ」として dragDirection を確定し、その方向に対応する
     *   offFront/offBack を1度だけ準備する。
     *   方向が確定するまでは何も描画変化させない（= ホールド扱い）。
     *
     * progress の計算:
     *   移動量 |deltaX| を画面幅 MOB_W に対する比率に変換するだけ。
     *   「次へ」方向なら 0→1（左に大きく動かすほど1に近づく）。
     *   「前へ」方向なら 1→0（右に大きく動かすほど0に近づく、
     *   = drawMobileCurl 的には前ページが展開してくる）。
     *
     * @param {number} deltaX - touchstart 時の X 座標からの移動量（px）。
     *                          負の値 = 左方向（次へ）、正の値 = 右方向（前へ）
     * @returns {boolean} 現在ドラッグ中で progress が更新されたか
     */
    /**
     * ドラッグの移動量から progress を更新する（touchmove/mousemove のたびに呼ぶ）
     *
     * 方向の確定タイミング:
     *   最初に意味のある移動（|deltaX| > 数px）が起きた時点で、
     *   左方向（deltaX < 0）なら「次へ」、右方向（deltaX > 0）なら
     *   「前へ」として dragDirection を確定し、その方向に対応する
     *   offFront/offBack を1度だけ準備する。
     *   方向が確定するまでは何も描画変化させない（= ホールド扱い）。
     *
     * progress の計算:
     *   移動量 |deltaX| を画面幅（Mobile: MOB_W、PC: PAGE_W）に対する
     *   比率に変換するだけ。PC モードでは「片側のページ幅」を基準に
     *   している（見開き全体の幅ではなく、めくれるページ1枚分の幅で
     *   進捗を測ることで、Mobile と同じ感覚の操作量になる）。
     *   「次へ」方向なら 0→1（左に大きく動かすほど1に近づく）。
     *   「前へ」方向なら 1→0（右に大きく動かすほど0に近づく）。
     *
     * PC モードでの offFront/offBack の準備について:
     *   spreads[i] は { left: fn, right: fn } という形（isRight フラグを
     *   持たない）。drawPCCurl が要求する「x=0 基準に正規化された
     *   Canvas」を得るため、preRenderPage の第2引数には
     *   「right ページなら true」を明示的に渡す必要がある。
     *
     * @param {number} deltaX - ドラッグ開始時の X 座標からの移動量（px）。
     *                          負の値 = 左方向（次へ）、正の値 = 右方向（前へ）
     * @returns {boolean} 現在ドラッグ中で progress が更新されたか
     */
    updateDragProgress(deltaX) {
        if (!this.state.dragging) return false;

        const isMobileMode = this.state.dragIsMobile;
        const dragWidth = isMobileMode ? this.C.MOB_W : this.C.PAGE_W;

        // DIRECTION_THRESHOLD: 指/マウスの「ぶれ」を「スワイプ/ドラッグの
        // 意図」と誤判定しないための余裕（px）。
        const DIRECTION_THRESHOLD = 4; // px。これ未満の移動は「まだ静止」とみなす

        // 方向がまだ未確定の場合、ここで確定させる
        if (this.state.dragDirection === null) {
            // Math.abs() は絶対値（マイナスを取り除いた値）を返す関数。
            if (Math.abs(deltaX) < DIRECTION_THRESHOLD) {
                return true; // まだ判定できない（ホールド中として扱う）
            }

            const items   = this.state.dragPages; // Mobile: pages配列 / PC: spreads配列
            const curIdx  = this.state.dragCurrentIdx;

            // deltaX の符号で「どちら向きにドラッグしたか」を判定する。
            if (deltaX < 0 && curIdx < items.length - 1) {
                // 左方向 = 次へ
                this.state.dragDirection = 'next';
                this.state.reverse       = false;
                if (isMobileMode) {
                    this.state.offFront = this.contentRenderer.preRenderPage(items[curIdx].fn,     items[curIdx].isRight);
                    this.state.offBack  = this.contentRenderer.preRenderPage(items[curIdx+1].fn,   items[curIdx+1].isRight);
                } else {
                    // PC: 「次へ」は現在見開きの右ページが消えて、
                    // 次の見開きの左ページが現れる（startFlipPC と同じ組み合わせ）
                    this.state.offFront = this.contentRenderer.preRenderPage(items[curIdx].right,   true);
                    this.state.offBack  = this.contentRenderer.preRenderPage(items[curIdx+1].left,  false);
                }
            } else if (deltaX > 0 && curIdx > 0) {
                // 右方向 = 前へ
                this.state.dragDirection = 'prev';
                this.state.reverse       = true;
                if (isMobileMode) {
                    this.state.offFront = this.contentRenderer.preRenderPage(items[curIdx-1].fn,   items[curIdx-1].isRight);
                    this.state.offBack  = this.contentRenderer.preRenderPage(items[curIdx].fn,     items[curIdx].isRight);
                } else {
                    this.state.offFront = this.contentRenderer.preRenderPage(items[curIdx-1].right,  true);
                    this.state.offBack  = this.contentRenderer.preRenderPage(items[curIdx].left,     false);
                }
            } else {
                // 先頭で右方向、または末尾で左方向 → 動かせる先がない
                this.state.dragDirection = 'blocked';
                return true;
            }
        }

        if (this.state.dragDirection === 'blocked') return true;

        // 移動量を progress（0.0〜1.0）に変換する。
        // dragWidth は Mobile なら MOB_W、PC なら PAGE_W（片側ページ幅）。
        const ratio = Math.min(1.0, Math.max(0.0, Math.abs(deltaX) / dragWidth));
        this.state.progress = (this.state.dragDirection === 'next') ? ratio : (1.0 - ratio);

        return true;
    }

    /**
     * ドラッグ終了時の処理（指を離した瞬間）
     *
     * 判定基準:
     *   'next' 方向で progress が COMMIT_THRESHOLD を超えていれば
     *   「ページ送り確定」とみなし、残りを 1.0 まで自動アニメーションする。
     *   超えていなければ「キャンセル」とみなし、0.0 まで戻すアニメーションをする。
     *   'prev' 方向はこの逆（1.0 に近いほど「戻っていない」状態なので、
     *   progress が低いほど確定に近い）。
     *
     * @param {Function} onFrame    - 各フレームで呼ぶ描画コールバック
     * @param {Function} onCommit   - ページ送りが確定したときに呼ぶ
     *                                 ({direction, pages, currentIdx}) => void
     * @param {Function} onCancel   - キャンセルされたときに呼ぶ（引数なし）
     * @param {Function} [onCommitDecided] - 「確定した」と判定された直後
     *                                 （残りのアニメーションが始まる前）に呼ばれる。
     *                                 ページめくり音を「結果が決まった瞬間」に
     *                                 鳴らしたい、といった用途のための差し込み口。
     *                                 引数なしで呼ばれる。
     */
    endDrag(onFrame, onCommit, onCancel, onCommitDecided) {
        if (!this.state.dragging) return;

        const direction = this.state.dragDirection;
        this.state.dragging = false;

        // 方向未確定 or 動かせる先がない場合はそのまま何もせず終了
        if (direction === null || direction === 'blocked') {
            this._resetState();
            onFrame();
            onCancel();
            return;
        }

        const COMMIT_THRESHOLD = 0.25; // 画面幅の25%以上動かしたら確定
        const progress = this.state.progress;

        // 'next': progress が大きいほど確定に近い
        // 'prev': progress が小さいほど確定に近い（1.0→0.0 方向のため）
        const committed = (direction === 'next')
            ? (progress >= COMMIT_THRESHOLD)
            : (progress <= (1.0 - COMMIT_THRESHOLD));

        this.state.isAnimating = true; // 以降は時間駆動アニメーションとして補完する

        if (committed) {
            // ここで「確定した」ことが判明する。残りのアニメーションを
            // 始める前に通知することで、効果音などを「結果が決まった
            // 瞬間」に鳴らせるようにしている。
            if (onCommitDecided) onCommitDecided();

            // 残りを終端まで自動アニメーションさせる。
            // 'next' なら progress→1.0、'prev' なら progress→0.0 が終端。
            this._animateProgressTo(direction === 'next' ? 1.0 : 0.0, onFrame, () => {
                const finishedIdx = (direction === 'next')
                    ? this.state.dragCurrentIdx + 1
                    : this.state.dragCurrentIdx - 1;
                this._resetState();
                onCommit(finishedIdx);
            });
        } else {
            // キャンセル: 元の状態（'next'なら0.0、'prev'なら1.0）に戻す
            this._animateProgressTo(direction === 'next' ? 0.0 : 1.0, onFrame, () => {
                this._resetState();
                onCancel();
            });
        }
    }

    /**
     * 現在の progress から指定した目標値まで、時間ベースで滑らかに補完する
     *
     * ドラッグ終了後の「確定 or キャンセル」の残り区間を、
     * 指を離した位置から自然に閉じる／開くアニメーションとして仕上げる。
     * 移動距離に応じて所要時間を短縮する（わずかな残りなら短時間で完了する）。
     *
     * @param {number}   targetProgress - 0.0 または 1.0
     * @param {Function} onFrame
     * @param {Function} onDone
     * @private
     */
    _animateProgressTo(targetProgress, onFrame, onDone) {
        const startProgress = this.state.progress;
        const distance       = Math.abs(targetProgress - startProgress);
        // 残り距離が小さいほど短時間で終わらせる（最低120ms、最大はFLIP_MSと同じ）
        const duration = Math.max(120, distance * this.C.FLIP_MS);
        const startTime = performance.now();

        const step = (now) => {
            const elapsed = Math.min((now - startTime) / duration, 1.0);
            this.state.progress = startProgress + (targetProgress - startProgress) * elapsed;
            onFrame();

            if (elapsed < 1.0) {
                requestAnimationFrame(step);
            } else {
                this.state.progress = targetProgress; // 浮動小数の誤差を確実に終端値へ
                onDone();
            }
        };

        requestAnimationFrame(step);
    }

    /**
     * RAF ループの本体（PC/Mobile 共通処理）
     *
     * @param {Function} onFrame    - 進捗更新後に毎フレーム呼ぶ（描画トリガー）
     * @param {Function} onComplete - 進捗が終端（0.0 または 1.0）に達したら呼ぶ
     * @param {boolean}  [reverse=false] - true なら進捗を 1.0→0.0 に向けて進める
     *
     * reverse の使い道:
     *   「前へ」を逆再生で実現する場合、offFront/offBack の役割を
     *   入れ替えた上で、進捗の向きそのものも逆転させる必要がある。
     *   例えば「ページN-1からページNへの“次へ”アニメーション」を
     *   逆に再生すれば、見た目は「ページNからページN-1への“前へ”」になる。
     *   そのアニメーションは t=1.0（N-1が完全にカールして消えた状態
     *   ＝現在の表示）から始まり、t=0.0（N-1が画面いっぱいに戻った状態）
     *   で終わる。
     * @private
     */
    /**
     * RAF ループの本体（PC/Mobile 共通処理）
     *
     * @param {Function} onFrame    - 進捗更新後に毎フレーム呼ぶ（描画トリガー）
     * @param {Function} onComplete - 進捗が終端（0.0 または 1.0）に達したら呼ぶ
     * @param {boolean}  [reverse=false] - true なら進捗を 1.0→0.0 に向けて進める
     * @param {number}   [durationMs] - 1回のアニメーションにかける時間（ミリ秒）。
     *                                   省略時は通常の FLIP_MS を使う。
     *                                   パラパラめくり（startFlutterPC等）では
     *                                   ここに短い FLUTTER_MS を渡す。
     *
     * reverse の使い道:
     *   「前へ」を逆再生で実現する場合、offFront/offBack の役割を
     *   入れ替えた上で、進捗の向きそのものも逆転させる必要がある。
     *   例えば「ページN-1からページNへの“次へ”アニメーション」を
     *   逆に再生すれば、見た目は「ページNからページN-1への“前へ”」になる。
     *   そのアニメーションは t=1.0（N-1が完全にカールして消えた状態
     *   ＝現在の表示）から始まり、t=0.0（N-1が画面いっぱいに戻った状態）
     *   で終わる。
     * @private
     */
    _runLoop(onFrame, onComplete, reverse = false, durationMs) {
        const startTime = performance.now();
        const flipMs     = durationMs || this.C.FLIP_MS;
        const state      = this.state;

        const step = (now) => {
            // 経過時間から線形進捗（0.0〜1.0）を算出
            const elapsed = Math.min((now - startTime) / flipMs, 1.0);
            // reverse なら 1.0 を基点に減算し、進行方向を反転させる
            state.progress = reverse ? (1.0 - elapsed) : elapsed;
            onFrame();

            // reverse の有無に関わらず、経過時間が flipMs に達したら終了
            // （reverse は progress の値の意味を反転させるだけで、
            //   ループの終了判定そのものは elapsed を基準にする）
            if (elapsed < 1.0) {
                requestAnimationFrame(step); // 次フレームも続ける
            } else {
                onComplete(); // アニメーション完了
            }
        };

        requestAnimationFrame(step);
    }

    /**
     * アニメーション完了後の状態リセット
     *
     * オフスクリーン Canvas の参照を null にして
     * ガベージコレクションに解放を促す。
     * @private
     */
    _resetState() {
        this.state.isAnimating = false;
        this.state.progress    = 0;
        this.state.offFront    = null;
        this.state.offBack     = null;
        this.state.reverse     = false;

        // ドラッグ状態もここで併せてリセットする。
        // beginDrag → endDrag の正常フローでは endDrag 内で
        // dragging=false は既に設定済みだが、それ以外の経路
        // （例: 時間駆動アニメーション完了時）でも一貫してクリアしておく。
        this.state.dragging       = false;
        this.state.dragPages      = null;
        this.state.dragCurrentIdx = 0;
        this.state.dragIsMobile   = true;
        this.state.dragDirection  = null;
    }
}
