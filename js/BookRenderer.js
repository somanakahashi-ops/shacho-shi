/* ================================================================
   BookRenderer.js
   ── 社長の自分史 電子ブック ─ フレーム合成クラス

   このクラスの責務:
     ・Canvas 1 フレーム分を「背景 → ページ → 前面」の順で合成する
     ・PC モード / Mobile モードそれぞれの描画順序を管理する
     ・本の外枠（角丸クリップ）・綴じ目の描画を行う

   このクラスの責務外:
     ・ページの文字内容を描く処理
       → PageContentRenderer が担当する（このクラスが呼び出す）
     ・カール変形の数学
       → PageFlipEffect が担当する（このクラスが呼び出す）
     ・requestAnimationFrame ループの管理
       → BookAnimator が担当する（このクラスは呼ばれる側）

   ── 描画順序の設計思想 ──
     Canvas は「消して上から描き直す」方式のため、
     毎フレーム clearRect() → 背景 → ページ → 前面 の順で描く。
     PC モードのアニメーション中は、捲れていくページが
     見開き全体にまたがって描かれるため、背景ページ（静止側）を
     クリップして「正しい半分にだけ」表示する工夫をしている。
   ================================================================ */

class BookRenderer {

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} constants            - BOOK_CONST
     * @param {PageContentRenderer} contentRenderer
     * @param {PageFlipEffect} flipEffect
     */
    constructor(ctx, constants, contentRenderer, flipEffect) {
        this.ctx             = ctx;
        this.C                = constants;
        this.contentRenderer  = contentRenderer;
        this.flipEffect       = flipEffect;

        // ── パフォーマンス最適化：角丸クリップパスの事前キャッシュ ──
        // PC モード・Mobile モードそれぞれの「本の外形（角丸矩形）」は
        // Canvas の解像度（PC_W/PC_H、MOB_W/MOB_H）が変わらない限り
        // 全く同じ形になる。にもかかわらず、以前は renderPC()/
        // renderMobile() が呼ばれるたび（つまり毎フレーム、アニメーション
        // 中なら1秒に60回）に beginPath〜arcTo×4〜closePath という
        // 約12個のパス命令を再構築していた。
        // 同じ形を毎回作り直すのは無駄なので、起動時に1度だけ
        // Path2D として構築し、以降は ctx.clip(キャッシュ済みPath2D) で
        // 再利用する（PC_W等は BOOK_CONST の固定値で、モード切替で
        // 変わるのは canvas.width/height という「解像度」だけであり、
        // この2つの形そのものは常に同じであるため、作り直す必要がない）。
        const { PC_W, PC_H, MOB_W, MOB_H, SPINE_X } = this.C;
        this._pcClipPath     = this._buildRoundRectPath(0, 0, PC_W, PC_H, [4, 8, 8, 4]);
        this._mobileClipPath = this._buildRoundRectPath(0, 0, MOB_W, MOB_H, 10);

        // ── パフォーマンス最適化：綴じ目グラデーションの事前キャッシュ ──
        // drawSpine() が毎フレーム生成していた2つのグラデーションは、
        // SPINE_X・PC_H という不変の定数だけに基づいているため、
        // 内容は毎回まったく同じになる。1度だけ作って再利用すれば、
        // 毎フレームの createLinearGradient + addColorStop 呼び出し
        // （計6回）を省略できる。
        this._spineGradLeft  = this._buildSpineGradient(SPINE_X - 22, SPINE_X, 'left');
        this._spineGradRight = this._buildSpineGradient(SPINE_X, SPINE_X + 22, 'right');
    }

    /**
     * 角丸矩形の Path2D を構築する（roundRect() と同じ形を Path2D として作る版）
     *
     * roundRect() は ctx に直接コマンドを発行するため、その場限りの
     * パスにしかならない（次のフレームには残らない）。
     * Path2D オブジェクトとして作っておけば、一度構築した形を
     * 何度でも ctx.clip(path) で再利用できる。
     * @private
     */
    _buildRoundRectPath(x, y, w, h, r) {
        const path = new Path2D();
        const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
        path.moveTo(x + tl, y);
        path.lineTo(x + w - tr, y);
        path.arcTo(x + w, y,     x + w, y + tr,     tr);
        path.lineTo(x + w, y + h - br);
        path.arcTo(x + w, y + h, x + w - br, y + h, br);
        path.lineTo(x + bl, y + h);
        path.arcTo(x, y + h,     x, y + h - bl,     bl);
        path.lineTo(x, y + tl);
        path.arcTo(x, y,         x + tl, y,         tl);
        path.closePath();
        return path;
    }

    /**
     * 綴じ目の影グラデーションを構築する（drawSpine() の左右どちらか用）
     * @param {number} x0 - グラデーション開始X座標
     * @param {number} x1 - グラデーション終了X座標
     * @param {'left'|'right'} side - 左ページ側の影か、右ページ側の影か
     * @private
     */
    _buildSpineGradient(x0, x1, side) {
        const g = this.ctx.createLinearGradient(x0, 0, x1, 0);
        if (side === 'left') {
            // 左ページ右端の影（綴じ目に近づくほど暗い）
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,0.14)');
        } else {
            // 右ページ左端の影（綴じ目から離れるほど明るくなる）
            g.addColorStop(0, 'rgba(0,0,0,0.14)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
        }
        return g;
    }

    /**
     * 角丸矩形パスを作成する（Canvas 2D の roundRect 互換実装）
     *
     * ctx.roundRect() は古いブラウザでサポートされないため、
     * arcTo() を使った互換実装を用意している。
     * この関数を呼んだ後に clip() すると角丸クリップが適用される。
     *
     * 注記（パフォーマンス最適化後の現状）:
     *   PC モード・Mobile モードの角丸クリップは、現在は
     *   constructor で1度だけ構築した Path2D（_pcClipPath /
     *   _mobileClipPath）を再利用する方式に切り替えたため、
     *   このメソッド自体は renderPC()/renderMobile() からは
     *   呼ばれなくなった。形が固定でない角丸矩形クリップが
     *   将来必要になった場合のための参考実装として残している。
     *
     * @param {number} x - 左上 X
     * @param {number} y - 左上 Y
     * @param {number} w - 幅
     * @param {number} h - 高さ
     * @param {number|number[]} r - 角丸半径。配列なら [左上,右上,右下,左下]
     */
    roundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        ctx.arcTo(x + w, y,     x + w, y + tr,     tr);
        ctx.lineTo(x + w, y + h - br);
        ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
        ctx.lineTo(x + bl, y + h);
        ctx.arcTo(x, y + h,     x, y + h - bl,     bl);
        ctx.lineTo(x, y + tl);
        ctx.arcTo(x, y,         x + tl, y,         tl);
        ctx.closePath();
    }

    /**
     * 綴じ目（本の背表紙側）を描画する（PC 専用）
     *
     * 本の見開き中央に立体感を与えるため、以下を重ねて描く:
     *   - 左ページ右端: 右に向かって暗くなるグラデーション（影）
     *   - 右ページ左端: 左に向かって暗くなるグラデーション（影）
     *   - 中央の縦線: 薄い茶色のライン（綴じ目の存在感）
     *
     * 常に最前面（全ページの描画後）に呼ぶこと。
     * アニメーション中も綴じ目が見えることで本らしさが保たれる。
     */
    drawSpine() {
        const { PC_H, SPINE_X } = this.C;
        const ctx = this.ctx;

        ctx.fillStyle = this._spineGradLeft;
        ctx.fillRect(SPINE_X - 22, 0, 22, PC_H);

        ctx.fillStyle = this._spineGradRight;
        ctx.fillRect(SPINE_X, 0, 22, PC_H);
    }

    /**
     * PC モードの 1 フレームを描画する
     *
     * 描画順（下から上へ重ねる）:
     *   [A] 非アニメーション時:
     *       ① 左ページ  ② 左ページの画像（あれば）  ③ 右ページ  ④ 綴じ目
     *
     *   [B] アニメーション時（捲り中）:
     *       ① 新しい右ページ（右半分クリップ）← 捲れるページの下に現れる
     *       ② 現在の左ページ（左半分クリップ）← 捲れてきたページに覆われる
     *       ③ 捲れていくページ（クリップなし）← 両半分にまたがる最上位
     *       ④ 綴じ目                          ← 常に最前面
     *
     * ①②をクリップする理由:
     *   捲れていくページ（③）が見開き全体にまたがって描かれるため、
     *   背景ページが適切な半分にのみ表示されるよう制限する。
     *
     * 画像をアニメーション中に描かない理由:
     *   画像はドラッグ＆ドロップで追加される「左ページ専用」の機能であり、
     *   めくり中の見開きにまで対応すると PageFlipEffect 側の
     *   カール変形・キャッシュ機構を画像対応にする必要が生まれ、
     *   複雑さが大きく増す。静止状態のみの対応とすることで
     *   既存のアニメーション機構には一切手を入れずに済む。
     *
     * @param {Object} animState - { isAnimating, progress, offFront, offBack }
     * @param {Array} spreads    - PageContentRenderer.spreads
     * @param {number} currentSpread
     * @param {number} nextSpreadIdx
     * @param {HTMLImageElement|null} [leftImage] - 現在の見開き左ページに重ねる画像
     */
    renderPC(animState, spreads, currentSpread, nextSpreadIdx, leftImage = null) {
        const { PC_W, PC_H, PAGE_W, SPINE_X } = this.C;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, PC_W, PC_H);

        // 本の外形（角丸矩形）でクリップ。これより外には何も描かれない。
        // ── パフォーマンス最適化：constructor で事前構築した Path2D を
        // 再利用する（毎フレームの beginPath〜arcTo×4〜closePath の
        // 再構築を省略できる。形そのものは PC_W/PC_H が変わらない限り
        // 常に同じため、安全に再利用できる）。
        ctx.save();
        ctx.clip(this._pcClipPath);

        // isAnimating（時間駆動アニメーション中）と dragging（マウスで
        // ドラッグ中）の両方を「動的描画が必要な状態」として扱う。
        // モバイル版の renderMobile と同じ考え方を PC 版にも適用した。
        const isDynamic = animState.isAnimating || animState.dragging;

        // 「静止して現在の見開きをそのまま表示するだけでよい」条件。
        //   - 完全な静止状態（isDynamic === false）
        //   - ドラッグ中だが方向がまだ未確定（ホールド中の見た目）
        //   - ドラッグ中だが先頭/末尾で動かせる方向がない（突っかかり）
        const showsStaticSpread =
            !isDynamic ||
            (animState.dragging && (animState.dragDirection === null || animState.dragDirection === 'blocked'));

        if (showsStaticSpread) {
            // 静止状態: 現在の見開きをそのまま描く
            spreads[currentSpread].left(ctx);

            // 左ページに画像が紐づいていれば、文字コンテンツの上に重ねる
            if (leftImage) {
                this.contentRenderer.drawImageOverlay(ctx, 'left', leftImage);
            }

            spreads[currentSpread].right(ctx);
        } else {
            const cur  = spreads[currentSpread];
            const next = spreads[nextSpreadIdx];
            const isReverse = animState.reverse;

            // [1] 右半分の背景ページ
            ctx.save();
            ctx.beginPath();
            ctx.rect(SPINE_X, 0, PAGE_W, PC_H);
            ctx.clip();
            if (isReverse) {
                cur.right(ctx);
            } else {
                next.right(ctx);
            }
            ctx.restore();

            // [2] 左半分の背景ページ
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, SPINE_X, PC_H);
            ctx.clip();
            if (isReverse) {
                next.left(ctx);
            } else {
                cur.left(ctx);
            }
            ctx.restore();

            // [3] 捲れていくページ（クリップなし: 左右両側にまたがる）
            //
            // ドラッグ中（マウスで直接動かしている間）は touchmove/
            // mousemove の頻度に合わせて毎フレーム描き直す必要があり、
            // 通常の NUM_SLICES（60）でも負荷が積み重なりやすいため、
            // リアルタイム性を優先して粗いスライス数（30）に切り替える
            // （モバイル版の drawMobileCurl で実証済みの最適化と
            // 同じ考え方。PC版は元々スライス数が少ないため効果は
            // モバイルよりも小さいが、マウスドラッグでも同様に
            // 「指を離した後の仕上げアニメーションでは元の滑らかさに
            // 戻る」という操作感の一貫性を保てる）。
            const pcSliceOverride = animState.dragging ? 30 : undefined;
            this.flipEffect.drawPCCurl(animState.progress, animState.offFront, animState.offBack, animState.reverse, pcSliceOverride);
        }

        // 綴じ目は常に最前面（ページの上に重ねる）
        this.drawSpine();
        ctx.restore();
    }

    /**
     * モバイルモードの 1 フレームを描画する
     *
     * 描画順（下から上へ重ねる）:
     *   [A] 非アニメーション時:
     *       ① 現在ページ
     *
     *   [B] アニメーション時（捲り中）:
     *       ① 次ページ（背景として下に敷く）← 現在ページが消えた後に見える
     *       ② 現在ページ（カールして消えていく）
     *
     * @param {Object} animState - { isAnimating, progress, offFront, offBack }
     * @param {Array} pages      - PageContentRenderer.pages
     * @param {number} currentPageIdx
     */
    renderMobile(animState, pages, currentPageIdx) {
        const { MOB_W, MOB_H } = this.C;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, MOB_W, MOB_H);
        ctx.save();
        // ── パフォーマンス最適化：constructor で事前構築した Path2D を
        // 再利用する（PC版 renderPC と同じ最適化）。
        ctx.clip(this._mobileClipPath);

        // isAnimating（時間駆動アニメーション中）と dragging（指で
        // ドラッグ中）の両方を「動的描画が必要な状態」として扱う。
        // どちらの場合も offFront/offBack/progress は同じ意味で
        // 使われるため、描画ロジック自体は共通化できる。
        const isDynamic = animState.isAnimating || animState.dragging;

        // 「静止して現在ページをそのまま表示するだけでよい」条件を
        // 1箇所にまとめる。元々は以下の3パターンが同じ処理
        // （preRenderPage → drawImage）を別々の分岐に重複して
        // 書いていたため、ここで1本化した:
        //   - 完全な静止状態（isDynamic === false）
        //   - ドラッグ中だが方向がまだ未確定（ホールド中の見た目）
        //   - ドラッグ中だが先頭/末尾で動かせる方向がない（突っかかり）
        const showsStaticPage =
            !isDynamic ||
            (animState.dragging && (animState.dragDirection === null || animState.dragDirection === 'blocked'));

        if (showsStaticPage) {
            // preRenderPage は内部キャッシュを持つため、ページ内容が
            // 変わっていない限り fillText 等の再実行は発生しない
            // （2回目以降の呼び出しはキャッシュ済み Canvas を返すだけ）。
            const page = pages[currentPageIdx];
            const pg   = this.contentRenderer.preRenderPage(page.fn, page.isRight);
            ctx.drawImage(pg, 0, 0);
        } else if (PageFlipEffect.DEBUG) {
            // ── DEBUG モード: カール変形を無効化 ──────────────
            // offFront と offBack をそのまま（変形なし）並べて表示し、
            // 「画像生成自体は正しいか」と「カール変形ロジックの
            // 問題か」を切り分けるための診断モード。
            // 左半分に offBack、右半分に offFront を等倍で表示する。
            ctx.drawImage(animState.offBack, 0, 0, MOB_W, MOB_H, 0, 0, MOB_W/2, MOB_H);
            ctx.drawImage(animState.offFront, 0, 0, MOB_W, MOB_H, MOB_W/2, 0, MOB_W/2, MOB_H);
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(MOB_W/2, 0);
            ctx.lineTo(MOB_W/2, MOB_H);
            ctx.stroke();
        } else {
            // [1] 次ページを背景として描く（現在ページの下から現れる）
            ctx.drawImage(animState.offBack, 0, 0);
            // [2] 現在ページをカールさせながら消す
            //
            // ドラッグ中（指で直接動かしている間）は touchmove の頻度に
            // 合わせて毎フレーム描き直す必要があり、通常の
            // MOBILE_NUM_SLICES（150）では負荷が高くなりがちなため、
            // リアルタイム性を優先して粗いスライス数（60）に切り替える。
            // 指を離した後の確定/キャンセルの自動補完アニメーション
            // （isAnimating=true, dragging=false の状態）は touchmove の
            // 頻度に縛られないので、通常の滑らかさ（150）に戻す。
            const sliceOverride = animState.dragging ? 60 : undefined;
            this.flipEffect.drawMobileCurl(animState.progress, animState.offFront, sliceOverride);
        }

        ctx.restore();
    }
}
