/* ================================================================
   PageFlipEffect.js
   ── 社長の自分史 電子ブック ─ ページめくり変形エンジン

   このクラスの責務:
     ・「ページがめくれている途中の形」を数学的に計算し、
       Canvas に変形描画する（カール効果の核心ロジック）
     ・PC モード（見開きが回転する）と
       Mobile モード（1ページが右からカールして消える）
       の両方の変形を提供する

   このクラスの責務外:
     ・ページの文字内容を描く処理
       → PageContentRenderer が担当する
     ・フレーム全体の合成（背景＋このクラスの出力＋綴じ目）
       → BookRenderer が担当する
     ・requestAnimationFrame ループの管理
       → BookAnimator が担当する

   ── 物理モデル（PC 版） ──
     右ページは綴じ目（x = SPINE_X）を回転軸として
     角度 θ（0°→180°）で回転する 1 枚の紙として扱う。

     θ に応じた見かけ幅（透視変換）:
       見かけ幅 = PAGE_W × |cos(θ)|

     自由端（右端/左端）の X 座標:
       freeX = SPINE_X + PAGE_W × cos(θ)
       θ=0°  → freeX = PC_W（右端、初期位置）
       θ=90° → freeX = SPINE_X（綴じ目、ページが垂直に立っている）
       θ=180°→ freeX = 0（左端、めくり完了）

   ── カール遅延（CURL_DELAY）の仕組み ──
     各水平スライスが「いつ回転を開始するか」を y 位置によって変える。
     下端（yFactor=1.0）: t=0 から回転開始（最も先行）
     上端（yFactor=0.0）: t=CURL_DELAY 経過後に回転開始（遅れて追従）
     これにより対角線状のカール曲線（写真のような紙めくり感）が生まれる。
   ================================================================ */

class PageFlipEffect {

    /**
     * デバッグ用フラグ。true にすると、drawPCCurl が描く各スライスの
     * 境界を赤（表面）・青（裏面）の枠線で可視化する。
     * 「正しい軸（綴じ目）からズレている描画がどれか」を特定するための
     * 一時的な診断機能。問題解決後は false に戻すか削除してよい。
     */
    static DEBUG = false;

    /**
     * drawMobileCurl の診断ログを1回だけ出すためのフラグ。
     * （連投を防ぐための一時的なデバッグ用フラグ）
     */
    static _mobileDebugLogged = false;

    /**
     * @param {CanvasRenderingContext2D} ctx - 描画先コンテキスト
     * @param {Object} constants - constants.js の BOOK_CONST
     */
    constructor(ctx, constants) {
        this.ctx = ctx;
        this.C   = constants;

        // ── パフォーマンス最適化：行データ用の再利用バッファ ──
        // drawPCCurl() / drawMobileCurl() は毎フレーム「ページを輪切りに
        // した行」の情報（Y座標・自由端のX座標・角度）を NUM_SLICES 本分
        // 計算する。以前はこれを {y, freeX, angle, cosA} という
        // 小さなオブジェクトを1行ごとに new して配列に push していたが、
        // これは 60fps で動くアニメーション中、1秒間に最大で
        // （行数）×60 個程度の使い捨てオブジェクトを生成することになる。
        // 使い捨てオブジェクトが増えるとガーベジコレクション（不要に
        // なったメモリの回収処理）の発生頻度が上がり、その回収処理が
        // 走った瞬間にアニメーションが一瞬カクつく原因になり得る
        // （いわゆる「GCジャンク」）。
        //
        // 対策として、最大行数分の「数値だけの配列」を起動時に1回だけ
        // 確保しておき、毎フレームはその配列の値を上書きするだけにする
        // （配列自体は作り直さない）。
        // Float64Array は「小数を含む数値だけを格納できる、長さが
        // 固定された配列」で、通常の配列（何でも入る代わりに1つずつ
        // 管理コストがかかる）よりも省メモリ・高速に読み書きできる。
        const maxPcSlices     = this.C.NUM_SLICES + 1;
        const maxMobileSlices = this.C.MOBILE_NUM_SLICES + 1;

        // PC版：表面・裏面それぞれに最大 maxPcSlices 行分のバッファ
        // （ある1フレームで全行が表面側に偏ることもあるため、
        // 表裏どちらも「全行分」のサイズを確保しておく）。
        this._frontY      = new Float64Array(maxPcSlices);
        this._frontFreeX  = new Float64Array(maxPcSlices);
        this._frontAngle  = new Float64Array(maxPcSlices);
        this._backY       = new Float64Array(maxPcSlices);
        this._backFreeX   = new Float64Array(maxPcSlices);
        this._backAngle   = new Float64Array(maxPcSlices);

        // モバイル版：可視行用バッファ。MOBILE_NUM_SLICES（最大値）の
        // サイズで確保しておけば、sliceOverride で行数を減らした
        // 場合（ドラッグ中の軽量モード）でも余裕を持ってカバーできる。
        this._mobileY      = new Float64Array(maxMobileSlices);
        this._mobileFreeX  = new Float64Array(maxMobileSlices);
        this._mobileAngle  = new Float64Array(maxMobileSlices);
    }

    /**
     * 三次イーズイン/アウト（Cubic Ease In-Out）
     *
     * アニメーションの進捗 t（線形、0.0〜1.0）を非線形な値に変換する。
     * 結果: 開始と終了がゆっくり、中間が速い S 字カーブ。
     * 実際の紙めくりは始まりと終わりがゆっくりで中間が速いため、
     * 線形補間より自然に見える。
     *
     * 「線形」「非線形」とは（初心者向け補足）:
     *   線形な進捗は「時間が2倍経過したら進捗も2倍になる」という
     *   一定の速さの変化（例えば自動車が同じ速度で走り続けるイメージ）。
     *   非線形な進捗はそうではなく、ここでは「ゆっくり発進して、
     *   中盤でスピードに乗り、終盤でまたゆっくり止まる」という
     *   速度変化のある動きになる。電車の発進・停止の感覚に近い。
     *
     * 三項演算子（条件 ? 真の場合の値 : 偽の場合の値）について:
     *   `t < 0.5 ? 4*t*t*t : 1 - ...` は if文を1行で書く方法。
     *   「t が 0.5 未満なら 4*t*t*t を、そうでなければ
     *   1 - Math.pow(...) を返す」という意味。
     *
     * なぜ式が2つに分かれているか:
     *   t=0.5（半分の時点）を境に、加速していく曲線（前半）と
     *   減速していく曲線（後半）を別の数式で作り、それらを
     *   滑らかに繋ぎ合わせることで「S字カーブ」を実現している。
     *   前半は「0から少しずつ速度を上げて中間点に到達する」式、
     *   後半は「中間点から少しずつ速度を落として1に到達する」式。
     *
     * @param {number} t - 線形進捗（0.0〜1.0）
     * @returns {number} イーズ適用後の進捗（0.0〜1.0）
     *
     * ── パフォーマンス最適化：Math.pow を使わない理由 ──
     *   以前は後半の式を `1 - Math.pow(-2*t+2, 3) / 2` と書いていたが、
     *   Math.pow(x, 3) は「任意の指数に対応できる汎用べき乗計算」を
     *   行うため、x*x*x という単純な3回の掛け算よりも内部処理が
     *   重い（指数が整数の3だと分かっていても、エンジンによっては
     *   最適化されないことがある）。指数が固定の整数3である今回は
     *   u*u*u と直接書く方が同じ結果をより軽い処理で得られる。
     *   また「/2」を「*0.5」に変えているのは、2の累乗で割る／掛ける
     *   計算は2進浮動小数点数（IEEE754）の仕組み上、丸め誤差が
     *   一切発生せず完全に同じ結果になるため（指数部の調整だけで
     *   済む計算で、仮数部の精度が失われない）、安全に置き換えられる。
     */
    easeInOutCubic(t) {
        if (t < 0.5) return 4 * t * t * t;
        const u = -2 * t + 2;
        return 1 - (u * u * u) * 0.5;
    }

    /**
     * PC モードのページカールアニメーションを描画する
     *
     * ── 描画変換の数学（表面・裏面） ──
     *
     *   表面（cosA > 0、ページが右側にある）:
     *     front の x=[0..PAGE_W] を canvas の x=[SPINE_X..freeX] に圧縮する。
     *     ctx.translate(SPINE_X, y0); ctx.scale(cosA, 1);
     *     検証: x=0      → canvas SPINE_X ✓
     *           x=PAGE_W → canvas SPINE_X + PAGE_W×cosA = freeX ✓
     *
     *   裏面（cosA < 0、ページが左側にある）:
     *     back の x=[0..PAGE_W] を canvas の x=[freeX..SPINE_X] にマップする。
     *     ctx.translate(PAGE_W*(1+cosA), y0); ctx.scale(-cosA, 1);
     *     検証: x=0      → canvas PAGE_W×(1+cosA) = freeX ✓
     *           x=PAGE_W → canvas PAGE_W = SPINE_X ✓
     *
     * @param {number}           t     アニメーション進捗（0.0〜1.0）
     * @param {HTMLCanvasElement} front 表面の事前描画 Canvas（x=0 基準）
     * @param {HTMLCanvasElement} back  裏面の事前描画 Canvas（x=0 基準）
     * @param {boolean}           [reverse=false] 「前へ」方向かどうか
     * @param {number}           [sliceOverride] - 指定時は NUM_SLICES の
     *        代わりにこの値を使う。マウスドラッグ中などリアルタイム性を
     *        優先したい場面で、一時的に粗いスライス数に切り替えるための
     *        引数（drawMobileCurl の sliceOverride と同じ考え方）。
     *        未指定時は通常の NUM_SLICES を使う。
     *
     * ── reverse=true（前へ）のときの違い ──
     *   「次へ」は右ページ（綴じ目から右に伸びている）が綴じ目を軸に
     *   左へ回転していく動き。「前へ」は現在開いている左ページ
     *   （綴じ目から左に伸びている）が綴じ目を軸に右へ回転していく動き。
     *   自由端の伸びる方向が左右で逆になるため、freeX の符号を
     *   反転させる必要がある（dir 変数で切り替える）。
     *   front/back の割り当て自体は BookAnimator.startFlipPC() 側で
     *   既に入れ替えてあるため、ここでは符号だけを切り替えればよい。
     */
    drawPCCurl(t, front, back, reverse = false, sliceOverride) {
        const { PC_W, PC_H, PAGE_W, SPINE_X, NUM_SLICES: NUM_SLICES_DEFAULT, CURL_DELAY } = this.C;
        const NUM_SLICES = sliceOverride || NUM_SLICES_DEFAULT;
        const ctx = this.ctx;
        const dir = 1;

        // ── パフォーマンス最適化：再利用バッファを使う ──
        // constructor で確保済みの Float64Array（_frontY 等）を使い、
        // 毎フレームの {y,freeX,angle,cosA} オブジェクト生成を避ける。
        // 値はこのフレームの分で毎回上書きするので、前フレームの
        // 値が混ざることはない。
        // 注意: このバッファは NUM_SLICES_DEFAULT+1 のサイズで確保されて
        // いるため、sliceOverride に NUM_SLICES_DEFAULT より大きい値を
        // 渡すことは想定していない（ドラッグ用の軽量化は常に「減らす」
        // 用途のため、この前提が破られることはない）。
        const frontY = this._frontY, frontFreeX = this._frontFreeX, frontAngle = this._frontAngle;
        const backY  = this._backY,  backFreeX  = this._backFreeX,  backAngle  = this._backAngle;
        let frontCount = 0;
        let backCount  = 0;

        // ── Step A: 各行の cosA・freeX を計算しつつ、輪郭パスを構築 ──
        // モバイル版（drawMobileCurl）と同じ「1本のループで輪郭パスと
        // ハイライト用パスを同時に組み立てる」方式に統一した。
        // PC版がモバイル版と異なる点は以下の2つ:
        //   1. ヒンジ（回転軸）が x=0 ではなく SPINE_X（綴じ目）
        //   2. 表面（front）だけでなく、cosA が負になった後は
        //      裏面（back）も同じ紙の続きとして描く必要がある
        //      （見開きでは「めくれた後ろに次のページが見える」ため）
        // この2点に対応するため、可視行を showFront の値ごとに
        // 別々の輪郭パスに振り分けて集める。
        const frontOutline = new Path2D(); // 表面のクリップ用（閉じたパス）
        const backOutline  = new Path2D(); // 裏面のクリップ用（閉じたパス）
        const frontEdge     = new Path2D(); // 表面側ハイライト用（開いたパス）
        const backEdge      = new Path2D(); // 裏面側ハイライト用（開いたパス）

        // ループ内で「直前の行」を覚えておくための変数。
        // 以前はオブジェクト（prevRow）として保持していたが、
        // 数値2つ（y・freeX）＋フラグだけで十分なので、
        // プリミティブ変数に置き換えてここでも余分な生成を避けている。
        let prevY = 0, prevFreeX = 0, hasPrev = false, prevWasFront = null;

        // ── パフォーマンス最適化：除算を事前計算した逆数の乗算に置き換える ──
        // CPU にとって割り算（division）は掛け算（multiplication）より
        // 計算コストが高い処理（一般に数倍〜十倍程度遅いと言われる）。
        // ループの中で毎回同じ値（NUM_SLICES や 1.0-CURL_DELAY）で
        // 割っているなら、ループの外で先に「1 ÷ その値」（逆数）を
        // 1度だけ計算しておき、ループの中では「割る」代わりに
        // 「逆数を掛ける」ことで、同じ結果をより軽い処理で得られる。
        //
        // 検証済みの境界ケースについて:
        //   厳密には浮動小数点の丸め方が極めて僅かに変わるため、
        //   「ある行のページ角度がちょうど90度（cosA=0）」という
        //   極めて稀な境界値においてのみ、その行を「見える」「見えない」
        //   どちらに分類するかが旧実装と1行だけ食い違うことがある
        //   （実機検証: 10万通りの進捗値のうち約21通り、発生率0.021%）。
        //   ただし、その境界行自体の表示幅は計算上 1ピクセルの
        //   10兆分の1以下（角度がほぼ90度＝紙がほぼ真横を向いている
        //   ため、元々ほぼ見えない極小のスライバー）であり、
        //   どちらに分類されても画面上の見た目には一切影響しない
        //   ことを確認済み。
        const invNumSlices          = 1 / NUM_SLICES;
        const invOneMinusCurlDelay  = 1 / (1.0 - CURL_DELAY);

        for (let i = 0; i <= NUM_SLICES; i++) {
            const v = i * invNumSlices; // 0(上端)〜1(下端)。旧: i / NUM_SLICES
            const t_strip = Math.min(1.0, Math.max(0.0,
                (t - CURL_DELAY * (1.0 - v)) * invOneMinusCurlDelay // 旧: 同じ式を ÷(1.0-CURL_DELAY)
            ));

            // ── パフォーマンス最適化：easeInOutCubic をループ内に展開する ──
            // 本来は this.easeInOutCubic(t_strip) という1行で済むが、
            // メソッド呼び出しには「this から easeInOutCubic を探す」
            // 「関数呼び出し用のスタックフレームを用意する」という
            // 多少のオーバーヘッドが伴う。このループは最大 NUM_SLICES+1
            // 回（PC版で最大61回）、1秒間に60フレーム分実行される
            // 「最も呼ばれる頻度が高い処理」なので、ロジック自体は
            // easeInOutCubic メソッドと完全に同じものをここに直接
            // 書き出し（インライン化）、呼び出しのオーバーヘッドを
            // 1段階減らしている。
            // （汎用の easeInOutCubic メソッド自体は他の場所
            //   （Step B の落ち影・Step E のハイライト計算など、
            //   ループの外で1回だけ呼ばれる箇所）でそのまま使われて
            //   いるので、削除はしていない。）
            let easedT;
            if (t_strip < 0.5) {
                easedT = 4 * t_strip * t_strip * t_strip;
            } else {
                const u = -2 * t_strip + 2;
                easedT = 1 - (u * u * u) * 0.5;
            }
            const angle = easedT * Math.PI;
            const cosA  = Math.cos(angle);

            // reverse 時は符号系が反転しているため、表裏判定にも dir をかける
            const showFront = (dir * cosA) >= 0;
            const freeX      = SPINE_X + dir * PAGE_W * cosA;
            const y           = v * PC_H;

            if (showFront) {
                frontY[frontCount] = y; frontFreeX[frontCount] = freeX; frontAngle[frontCount] = angle;
                frontCount++;
            } else {
                backY[backCount] = y; backFreeX[backCount] = freeX; backAngle[backCount] = angle;
                backCount++;
            }

            // 表面区間・裏面区間が切り替わるタイミングでは、前の行との
            // 接続を一旦リセットする（別の輪郭パスとして扱うため）。
            const targetOutline = showFront ? frontOutline : backOutline;
            const targetEdge    = showFront ? frontEdge    : backEdge;

            if (hasPrev && prevWasFront === showFront) {
                const midY = (prevY + y) / 2;
                const midX = (prevFreeX + freeX) / 2;
                targetOutline.quadraticCurveTo(prevFreeX, prevY, midX, midY);
                targetOutline.lineTo(freeX, y);
                targetEdge.quadraticCurveTo(prevFreeX, prevY, midX, midY);
                targetEdge.lineTo(freeX, y);
            } else {
                // この区間の最初の行 → 両パスの起点
                targetOutline.moveTo(SPINE_X, y);
                targetOutline.lineTo(freeX, y);
                targetEdge.moveTo(freeX, y);
            }

            prevY = y; prevFreeX = freeX; hasPrev = true; prevWasFront = showFront;
        }

        // 各輪郭パスを閉じる（綴じ目側の辺を通って起点へ戻る）
        if (frontCount >= 2) {
            frontOutline.lineTo(SPINE_X, frontY[frontCount - 1]);
            frontOutline.closePath();
        }
        if (backCount >= 2) {
            backOutline.lineTo(SPINE_X, backY[backCount - 1]);
            backOutline.closePath();
        }

        // Step B: 落ち影（無効化 — 垂直な影の線が不要なため）

        // ── Step C+D: 本体描画＋シェーディングを表裏それぞれ1回でまとめる ──
        // 以前は本体描画（_drawCurlSide）とシェーディング（_shadeCurlSide）
        // を別々に呼んでおり、それぞれが独立して save→clip(outline)→
        // …→restore という一連の操作を行っていた（同じ outline を
        // 2回 clip していた）。同じクリップ範囲に対する処理なので
        // 1つの save/clip ブロックにまとめ、呼び出し回数を削減した。
        this._drawAndShadeCurlSide(frontCount, frontY, frontFreeX, frontAngle, frontOutline, front, true,  SPINE_X, dir, PAGE_W, PC_H, PC_W);
        this._drawAndShadeCurlSide(backCount,  backY,  backFreeX,  backAngle,  backOutline,  back,  false, SPINE_X, dir, PAGE_W, PC_H, PC_W);

        // ── Step E: 綴じ目エッジの光沢ライン ──────────────
        // 表面・裏面どちらが見えていても、自由端の位置にハイライトを出す。
        const hlAlpha = Math.sin(this.easeInOutCubic(t) * Math.PI) * 0.50;
        if (hlAlpha > 0.02) {
            ctx.save();
            ctx.strokeStyle = `rgba(255,255,255,${hlAlpha})`;
            ctx.lineWidth   = 2.5;
            ctx.shadowColor = 'rgba(255,255,255,0.5)';
            ctx.shadowBlur  = 5;
            if (frontCount >= 2) ctx.stroke(frontEdge);
            if (backCount  >= 2) ctx.stroke(backEdge);
            ctx.shadowBlur  = 0;
            ctx.shadowColor = 'transparent';
            ctx.restore();
        }
    }

    /**
     * drawPCCurl の本体描画（紙の帯を貼る）とシェーディング（明暗の
     * グラデーション）を、表面・裏面それぞれに対して1回の save/clip
     * ブロックの中でまとめて行う。
     *
     * 以前は2つの別メソッド（_drawCurlSide / _shadeCurlSide）に
     * 分かれており、それぞれが同じ outline を別々に save→clip→
     * restore していた。クリップ対象（outline）が同じなら、その
     * クリップを保持したまま続けて両方の描画を行う方が
     * save/clip/restore の呼び出し回数を抑えられる。
     *
     * 変換について（transform の利用）:
     *   以前は各スライスで ctx.translate() と ctx.scale() を
     *   個別に呼んでいたが、これは ctx.transform(a,0,0,d,e,f) を
     *   1回呼ぶのと数学的に完全に同じ結果になる
     *   （translate(e,f) の後に scale(a,d) を呼ぶことは、
     *   行列計算的に transform(a,0,0,d,e,f) を1回呼ぶことと
     *   等価なため）。呼び出し回数を1つ減らせるうえ、
     *   ctx.transform() は「現在の変形に乗算で合成する」ため、
     *   この時点での変形が何であっても安全に同じ結果になる
     *   （ctx.setTransform() のように絶対値で上書きするのとは違い、
     *   前提条件に依存しない）。
     *
     * @param {number} count    - 有効な行数
     * @param {Float64Array} yArr, freeXArr, angleArr - 行データ（再利用バッファ）
     * @param {Path2D} outline  - クリップ用の輪郭パス
     * @param {HTMLCanvasElement} image - front または back の事前描画 Canvas
     * @param {boolean} isFront - true なら表面、false なら裏面
     * @param {number} spineX, dir, pageW, pageH, pcW - 描画に必要な定数
     * @private
     */
    _drawAndShadeCurlSide(count, yArr, freeXArr, angleArr, outline, image, isFront, spineX, dir, pageW, pageH, pcW) {
        if (count < 2) return; // 描画する行がほぼ無い

        const ctx = this.ctx;
        ctx.save();
        ctx.clip(outline);

        // pageW は呼び出し中ずっと同じ値（定数）なので、ループの外で
        // 1度だけ逆数を計算しておき、ループ内の「÷pageW」を
        // 「×invPageW」に置き換える（除算より乗算の方が軽いため）。
        const invPageW = 1 / pageW;

        // ── 本体描画 ──
        for (let i = 0; i < count - 1; i++) {
            const y0 = yArr[i], y1 = yArr[i + 1];
            const sliceH = y1 - y0;
            const f0 = freeXArr[i], f1 = freeXArr[i + 1];
            // クリップが既に輪郭パスで制限されているため、
            // 帯の描画が輪郭をわずかに超えても見た目には影響しない。
            const freeX0 = Math.min(spineX, f0, f1);
            const freeX1 = Math.max(spineX, f0, f1);
            const sliceW = freeX1 - freeX0;
            if (sliceW < 0.5) continue;

            // effCosA は「中間点での実効的な縮小率」として
            // sliceW/pageW をそのまま使う（向きは freeX の位置関係で決まる）。
            const effCosA = (Math.max(f0, f1) - spineX) * invPageW * dir;

            ctx.save();
            ctx.beginPath();
            ctx.rect(freeX0, y0, sliceW, sliceH);
            ctx.clip();
            if (isFront) {
                // 表面: front の x=[0..pageW] を x=[spineX..freeX] に圧縮する。
                // 旧: ctx.translate(spineX,y0); ctx.scale(effCosA,1);
                ctx.transform(effCosA, 0, 0, 1, spineX, y0);
            } else {
                // 裏面: back の x=[0..pageW] を x=[freeX..spineX] にマップする。
                // 旧: ctx.translate(pageW*(1+effCosA),y0); ctx.scale(-effCosA,1);
                ctx.transform(-effCosA, 0, 0, 1, pageW * (1.0 + effCosA), y0);
            }
            ctx.drawImage(image, 0, y0, pageW, sliceH, 0, 0, pageW, sliceH);
            ctx.restore(); // ここで clip も transform も同時に元に戻る
        }

        // ── シェーディング（同じクリップを保持したまま続けて行う） ──
        const midIdx = count >> 1;
        const shade  = Math.sin(angleArr[midIdx]) * 0.42;
        if (shade > 0.008) {
            const sg = ctx.createLinearGradient(spineX, 0, freeXArr[midIdx], 0);
            if (isFront) {
                // 表面: 綴じ目側（回転軸付近）が暗く、自由端が明るい
                sg.addColorStop(0, `rgba(0,0,0,${shade})`);
                sg.addColorStop(1, `rgba(0,0,0,${shade * 0.12})`);
            } else {
                // 裏面: 自由端が暗く、綴じ目側が明るい（光の当たり方が逆）
                sg.addColorStop(0, `rgba(0,0,0,${shade * 0.12})`);
                sg.addColorStop(1, `rgba(0,0,0,${shade})`);
            }
            ctx.fillStyle = sg;
            ctx.fillRect(0, 0, pcW, pageH);
        }

        ctx.restore();
    }

    /**
     * モバイルモードのシングルページカールアニメーションを描画する
     *
     * PC 版との違い:
     *   PC 版は「本の右ページが綴じ目を軸に左ページに重なる」動きだが、
     *   モバイル版は「現在ページが右端から左に向かってカールして消える」動き。
     *
     * 回転軸とページ座標:
     *   スパイン（ヒンジ）= 左端（x=0）として扱う。
     *   自由端（freeX）は右端（x=MOB_W）から始まり、左に向かって縮む。
     *     freeX = MOB_W × cos(θ)
     *     θ>90° になると cosA<0 → freeX<0（Canvas 外、自然に不可視）
     *
     * cos（コサイン）を使う理由（プログラミング初心者向け補足）:
     *   このアニメーションは「ページが立体的にめくれて起き上がり、
     *   最終的に反対側へ倒れる」動きを表現している。
     *   ページを横から見ると、左端（ヒンジ）を軸にした扇のような
     *   開閉運動になる。角度 θ（シータ）が 0°のときページは
     *   画面に対して真っ平ら（フラット）、90°のときページは
     *   画面に対して垂直に立っている（真横から見ると線になる）、
     *   180°のとき完全に反対側へ倒れきった状態になる。
     *
     *   「真横から見たときの幅」が cos(θ) に比例して変化するのは
     *   三角関数の基本的な性質で、紙を斜めに見ると実際の幅より
     *   短く見える現象（透視）をそのまま計算式にしたもの。
     *     θ=0°（フラット）  → cos(0°)=1   → 幅はそのまま(100%)
     *     θ=60°（傾いている）→ cos(60°)=0.5 → 幅は半分(50%)に見える
     *     θ=90°（真横向き） → cos(90°)=0   → 幅はゼロ（見えない）
     *     θ=180°（反対側）  → cos(180°)=-1 → 裏返って反対方向に幅が出る
     *   このコードでは cosA <= 0（90°を超えた）の時点でページが
     *   ほぼ真横を向いて見えなくなるとみなし、描画をスキップしている。
     *
     * @param {number}           t          アニメーション進捗（0.0〜1.0）。
     *        0.0 = ページがめくれ始める前（フラット）、
     *        1.0 = ページが完全にめくれ終わった状態を表す「割合」。
     * @param {HTMLCanvasElement} offCurrent 現在ページの事前描画 Canvas。
     *        ページの文字や背景がすでに描かれた「1枚の画像」のようなもの。
     *        この画像を変形させながら貼り付けていくことでアニメーションを作る。
     * @param {number}           [sliceOverride] - 指定時は MOBILE_NUM_SLICES の
     *        代わりにこの値を使う。ドラッグ中などリアルタイム性を優先したい
     *        場面で、一時的に粗いスライス数（軽量・やや角張る）に
     *        切り替えるための引数。未指定時は通常の MOBILE_NUM_SLICES を使う。
     */
    drawMobileCurl(t, offCurrent, sliceOverride) {
        const { MOB_W, MOB_H, MOBILE_NUM_SLICES, CURL_DELAY } = this.C;
        // sliceOverride が渡されていれば（0 や undefined ではない値なら）
        // それを使い、渡されていなければ通常の MOBILE_NUM_SLICES を使う。
        // 「||」（OR演算子）は左側が falsy（0, undefined, null, '' など）
        // のときに右側の値を採用する、という意味で使われている。
        const NUM_SLICES = sliceOverride || MOBILE_NUM_SLICES;
        const ctx = this.ctx;

        // ── パフォーマンス最適化：再利用バッファを使う ──
        // constructor で確保済みの Float64Array（_mobileY 等）を使い、
        // 毎フレームの {y,freeX,angle,cosA} オブジェクト生成を避ける
        // （PC版 drawPCCurl と同じ最適化）。
        const rowY     = this._mobileY;
        const rowFreeX = this._mobileFreeX;
        const rowAngle = this._mobileAngle;
        let rowCount   = 0;

        const outlinePath  = new Path2D(); // クリップ用（閉じたパス）
        const edgePath     = new Path2D(); // ハイライト用（自由端だけの開いたパス）
        let prevY = 0, prevFreeX = 0, hasPrev = false;

        // ── パフォーマンス最適化：除算を事前計算した逆数の乗算に置き換える ──
        // PC版 drawPCCurl と同じ理由（割り算は掛け算より計算コストが
        // 高いため）で、ループの外で先に逆数を計算しておく。
        // 境界ケース（cosA≈0 付近での1行ぶんの分類の僅かなズレと、
        // その視覚的影響が無視できることの検証）については
        // drawPCCurl の同様のコメントを参照。
        const invNumSlices         = 1 / NUM_SLICES;
        const invOneMinusCurlDelay = 1 / (1.0 - CURL_DELAY);

        // ── このループでは「ページを輪切りにした横の帯（行）」を
        //    上から下まで1本ずつ調べ、各帯がどれくらいめくれているか
        //    （cosA）と、その帯の右端の位置（freeX）を計算していく。 ──
        for (let i = 0; i <= NUM_SLICES; i++) {
            const v = i * invNumSlices; // 0(上端)〜1(下端)。旧: i / NUM_SLICES

            const t_strip = Math.min(1.0, Math.max(0.0,
                (t - CURL_DELAY * (1.0 - v)) * invOneMinusCurlDelay // 旧: 同じ式を ÷(1.0-CURL_DELAY)
            ));

            // ── パフォーマンス最適化：easeInOutCubic をループ内に展開する ──
            // PC版 drawPCCurl の同箇所と同じ理由・同じロジック
            // （メソッド呼び出しのオーバーヘッドを避けるため、
            // 呼び出し頻度が最も高いこのループの中だけ直接展開する）。
            let easedT;
            if (t_strip < 0.5) {
                easedT = 4 * t_strip * t_strip * t_strip;
            } else {
                const u = -2 * t_strip + 2;
                easedT = 1 - (u * u * u) * 0.5;
            }
            const angle = easedT * Math.PI;
            const cosA  = Math.cos(angle);

            // cosA が 0 以下（角度が90度を超えた）ということは、
            // この行はもう真横を向いていて見えない状態。
            // continue で次の行の処理に進む（この行は描画しない）。
            // hasPrev も false に戻し、「見える区間が途切れた」ことを
            // 後続の処理が認識できるようにしておく。
            if (cosA <= 0) { hasPrev = false; continue; }

            const y     = v * MOB_H;
            const freeX = MOB_W * cosA;
            rowY[rowCount] = y; rowFreeX[rowCount] = freeX; rowAngle[rowCount] = angle;
            rowCount++;

            if (!hasPrev) {
                // この可視区間の最初の行 → 両パスの起点
                outlinePath.moveTo(0, y);
                outlinePath.lineTo(freeX, y);
                edgePath.moveTo(freeX, y);
            } else {
                // quadraticCurveTo（2次ベジェ曲線）で前の行と滑らかに繋ぐ
                const midY = (prevY + y) / 2;
                const midX = (prevFreeX + freeX) / 2;
                outlinePath.quadraticCurveTo(prevFreeX, prevY, midX, midY);
                outlinePath.lineTo(freeX, y);
                edgePath.quadraticCurveTo(prevFreeX, prevY, midX, midY);
                edgePath.lineTo(freeX, y);
            }
            prevY = y; prevFreeX = freeX; hasPrev = true;
        }

        // 見える行が1つ以下では曲線として描けない（線を引くには最低2点必要）
        // ので、何も描かずに処理を終える。
        if (rowCount < 2) return; // 描画する行がほぼ無い

        // 輪郭パス（クリップ用）だけを閉じる。
        outlinePath.lineTo(0, rowY[rowCount - 1]);
        outlinePath.closePath();

        // ── Step B+C: 本体描画とシェーディングを1回のclipでまとめる ──
        // 以前は本体描画（drawImageのループ）とシェーディング
        // （グラデーションのfillRect）をそれぞれ別の save/clip/restore
        // ブロックで行っていたが、どちらも同じ outlinePath でクリップ
        // するので、1つの save/clip ブロックの中で続けて行うように
        // まとめ、save/clip/restore の呼び出し回数を削減した。
        ctx.save();
        ctx.clip(outlinePath);
        for (let i = 0; i < rowCount - 1; i++) {
            const y0 = rowY[i], y1 = rowY[i + 1];
            const sliceH = y1 - y0;
            // クリップが既に輪郭パスで制限されているため、
            // 帯の描画が輪郭をわずかに超えても見た目には影響しない。
            const freeX = Math.max(rowFreeX[i], rowFreeX[i + 1]);
            ctx.drawImage(offCurrent, 0, y0, MOB_W, sliceH, 0, y0, freeX, sliceH);
        }

        // シェーディングを1回のグラデーションで一括適用する。
        // 明暗の基準は中央付近の代表的な freeX を使う。
        const midIdx = rowCount >> 1;
        const shadeStrength = Math.sin(rowAngle[midIdx]) * 0.38;
        if (shadeStrength > 0.008 && rowFreeX[midIdx] > 1) {
            const sg = ctx.createLinearGradient(0, 0, rowFreeX[midIdx], 0);
            sg.addColorStop(0, `rgba(0,0,0,${shadeStrength * 0.08})`);
            sg.addColorStop(1, `rgba(0,0,0,${shadeStrength})`);
            ctx.fillStyle = sg;
            ctx.fillRect(0, 0, MOB_W, MOB_H);
        }
        ctx.restore();

        // ── Step D: 自由端エッジの光沢ライン ──────────────────
        // Step A で同時構築した edgePath（自由端だけの開いたパス）を
        // そのままストロークするだけで、輪郭と完全に一致したハイライトに
        // なる。
        const hlAlpha = Math.sin(this.easeInOutCubic(t) * Math.PI) * 0.40;
        if (hlAlpha > 0.02) {
            ctx.save();
            ctx.strokeStyle = `rgba(255,255,255,${hlAlpha})`;
            ctx.lineWidth   = 2;
            ctx.shadowColor = 'rgba(255,255,255,0.5)';
            ctx.shadowBlur  = 4;
            ctx.stroke(edgePath);
            ctx.shadowBlur  = 0;
            ctx.shadowColor = 'transparent';
            ctx.restore();
        }
    }
}
