/* ================================================================
   PageContentRenderer.js
   ── 社長の自分史 電子ブック ─ ページコンテンツ描画クラス

   このクラスの責務:
     ・BOOK_DATA（生データ）を「描画関数の配列」に変換する
     ・1 ページ分の文字・背景を Canvas に描く（drawPage 相当）
     ・ページをオフスクリーン Canvas に事前描画してキャッシュする

   このクラスの責務外:
     ・ページが「めくれている途中の形」に変形する処理
       → PageFlipEffect が担当する
     ・フレーム全体の合成・アニメーションループ
       → BookRenderer / BookAnimator が担当する

   ── データの旅（このクラスが担う部分） ──
     BOOK_DATA（JSON）
       ↓ buildSpreads()
     spreads[]  … PC 用：見開き単位の描画関数配列
       ↓ buildPages()
     pages[]    … Mobile 単位：1 ページ単位にフラット化した配列

   ── Canvas API の基礎（初心者向け補足） ──
     <canvas> は HTML の「絵を描くための白いキャンバス」のような
     要素。JavaScript から ctx（コンテキスト）と呼ばれる「筆」を
     取得し、その筆のメソッドを呼ぶことで図形や文字を描いていく。
     このファイルでは getContext('2d') で取得した 2D 用のコンテキスト
     を使っており、変数名は ctx や c（このクラスでは引数名が c）で
     表されることが多い。

     座標系について:
       Canvas の座標は左上が (0, 0)。右に行くほど x が増え、
       下に行くほど y が増える（数学の座標とは上下が逆なので注意）。

     よく出てくるメソッド・プロパティ:
       fillStyle      … これから塗る色を指定する（次の fillRect等に効く）
       fillRect(x,y,w,h) … (x,y) を左上として幅w・高さhの四角を塗る
       fillText(text,x,y) … 文字を (x,y) の位置に描く
       font           … 文字のフォント・サイズを指定する（CSSのfontと似た書式）
       textAlign      … fillText の x 座標を「文字のどこに合わせるか」
                         （'center'なら文字の中央が x に来る）
       textBaseline   … fillText の y 座標を「文字のどこに合わせるか」
                         （'middle'なら文字の縦方向の中央が y に来る）
       createLinearGradient(x0,y0,x1,y1) … (x0,y0)から(x1,y1)へ
                         色が変化していくグラデーションを作る
       strokeStyle / lineWidth / stroke() … 塗りではなく「線」を描く
                         ときに使う（beginPath→moveTo→lineTo→strokeの順）
   ================================================================ */

class PageContentRenderer {

    /**
     * @param {Object} bookData - book-data.js で定義された BOOK_DATA
     * @param {Object} constants - constants.js の BOOK_CONST
     */
    constructor(bookData, constants) {
        this.C = constants;

        // 生のページデータ（左右）への参照。Q&A の折り返しを起動時に
        // 一度だけ計算して各ページへ覚えさせる（precomputeWrapping）ために使う。
        this._spreadData = bookData.spreads;

        // 写真（ドロップ画像）の留め方スタイル。BookController が
        // 設定（SettingsStore）から読み取ってここに反映する。
        // 'corners' | 'pushpin' | 'maskingtape' | 'tape'
        this.photoStyle = 'corners';

        // ── Q&A レイアウトの定数（描画と折り返し計算で必ず揃える）──
        this._QA_Q_FONT   = 'italic 16px Georgia, serif'; // 質問
        this._QA_A_FONT   = '15.5px Georgia, serif';      // 回答
        this._QA_MAXWIDTH = this.C.PAGE_W - 96;           // 折り返し幅（左右余白48px）

        // ── 事前描画＆計測用の「隠し描画面」（DOM に接続する）──
        // ページめくり用の事前描画を、DOM に接続していない Canvas で
        // 行うと、文書の言語(lang="ja")の文脈を共有しないため、
        // 日本語の serif フォールバックが画面上のメイン Canvas と
        // 食い違い、「静止時とめくり時で書体が変わる」原因になる。
        // そこで、画面外に隠した上で DOM に接続した Canvas を1枚用意し、
        // 事前描画も折り返し計測もすべてこの面で行うことで、メイン
        // Canvas と同じフォント解決になるようにする。
        const surface = document.createElement('canvas');
        surface.width  = this.C.PAGE_W;
        surface.height = this.C.PC_H;
        surface.setAttribute('aria-hidden', 'true');
        surface.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
        if (typeof document !== 'undefined' && document.body) {
            document.body.appendChild(surface);
        }
        this._surface    = surface;
        this._surfaceCtx = surface.getContext('2d');
        this._measureCtx = this._surfaceCtx; // 折り返し計測も同じ面で行う

        // BOOK_DATA（純粋なデータ）を描画関数の配列に変換する。
        // コンテンツ変更時は book-data.js だけ編集すればよく、
        // このクラス自体は変更不要にするための変換ステップ。
        this.spreads = this._buildSpreads(bookData);
        this.pages   = this._buildPages(this.spreads);

        // ── 目次データ ─────────────────────────────────────
        // BOOK_DATA に既に入っている chapter/title/pageNum から、
        // 「目次として表示すべき項目」だけを抜き出した配列。
        // spreads/pages とは別に持っておくことで、目次パネルを
        // 描画する側（BookController）は BOOK_DATA の生の形を
        // 知らなくても、この配列を順番に表示するだけで済む。
        this.tocEntries = this._buildTocEntries(bookData);

        // ── 背景画像キャッシュ（カバーページ用） ────────────
        // key: bgImage のデータURL文字列
        // value: 読み込み済みの Image オブジェクト
        //
        // BOOK_DATA の各ページが bgImage（データURL文字列）を
        // 持っている場合、それを Canvas に描くには「画像の読み込みが
        // 完了している Image オブジェクト」が必要になる
        // （Image の読み込みは非同期処理のため）。
        // loadBackgroundImages() で起動時に一括読み込みしておき、
        // drawPage() の中では「もう読み込み済みのはず」という前提で
        // このキャッシュから同期的に取り出して使う。
        this._bgImageCache = new Map();

        // ── preRenderPage() の結果キャッシュ ──────────────────
        // key: drawFn（spreads[]/pages[] の各要素が持つ描画関数）
        // value: 事前描画済みのオフスクリーン Canvas
        //
        // ページの文字内容は BOOK_DATA から固定的に決まるため、
        // 同じ drawFn を何度呼んでも結果は常に同じ画像になる。
        // にもかかわらず毎回 document.createElement('canvas') から
        // fillText 等を再実行するのは無駄なコストなので、
        // 1度生成した結果を関数自体をキーにして再利用する。
        //
        // 画像オーバーレイ（overlayImg）付きの呼び出しはキャッシュしない
        // （ドラッグ＆ドロップで画像が後から変わる可能性があるため）。
        this._renderCache = new Map();
    }

    /**
     * BOOK_DATA 内のすべての bgImage を事前に読み込む
     *
     * 呼び出すタイミング:
     *   アプリ起動時（BookController.init() の冒頭）に1度だけ
     *   await で呼ぶ。これにより、最初の render() が呼ばれる前に
     *   すべての背景画像の読み込みが完了している状態になる。
     *
     * なぜ事前ロードが必要か:
     *   drawPage() は同期的に Canvas へ描く関数として作られている
     *   （PageFlipEffect 側がアニメーションの最中に何度も呼ぶため、
     *   await を挟むと設計が大きく複雑になってしまう）。
     *   そのため、画像の読み込みという非同期処理は drawPage() の
     *   外側で先に済ませておき、drawPage() の中では「キャッシュに
     *   もう入っているはず」という前提で同期的に取り出すだけにする。
     *
     * @param {Object} bookData - book-data.js の BOOK_DATA
     * @returns {Promise<void>} すべての画像の読み込みが完了したら解決される
     */
    async loadBackgroundImages(bookData) {
        // bookData.spreads を走査し、bgImage または signatureImage を
        // 持つページだけを集める。どちらも同じ「事前読み込みが必要な
        // 画像データURL」という性質を持つため、同じキャッシュ
        // （_bgImageCache）・同じ読み込み処理を共有している。
        // Set を使うことで、同じ画像が複数ページで使われていても
        // 1回だけ読み込むようにしている（重複読み込みの回避）。
        const urls = new Set();
        bookData.spreads.forEach(spread => {
            ['left', 'right'].forEach(side => {
                const page = spread[side];
                if (page.bgImage)       urls.add(page.bgImage);
                if (page.signatureImage) urls.add(page.signatureImage);
            });
        });

        if (urls.size === 0) return; // 画像を使うページが無ければ何もしない

        // Promise.all について（初心者向け補足）:
        //   複数の非同期処理を「全部同時に始めて、全部終わるまで待つ」
        //   ための仕組み。1枚ずつ順番に await すると画像の枚数分
        //   時間がかかってしまうが、Promise.all でまとめて並行に
        //   読み込むことで、全体の待ち時間を最も遅い1枚の分だけに
        //   抑えられる。
        const loadPromises = Array.from(urls).map(url =>
            // 共通ヘルパ loadImageFromSrc で読み込む。
            // 1枚の読み込み失敗で全体を止めないよう、catch で握りつぶして
            // 「キャッシュに入らない」状態のまま続行する
            // （drawPage 側はキャッシュに無ければ単色背景にフォールバックする）。
            loadImageFromSrc(url)
                .then(img => { this._bgImageCache.set(url, img); })
                .catch(() => {
                    console.warn('[背景画像] 読み込みに失敗しました:', url.substring(0, 50) + '...');
                })
        );

        await Promise.all(loadPromises);
    }

    /**
     * BOOK_DATA から目次（章一覧）データを構築する
     *
     * 抜き出す条件:
     *   chapter または title のどちらかが存在するページだけを
     *   目次の項目として採用する。本文だけのページ（章の2ページ目
     *   以降など）は見出しが無いため、目次には載せない。
     *
     * 各項目が持つ情報:
     *   spreadIndex … この項目が属する見開きのインデックス（PC用）
     *   pageIndex   … この項目が属する pages[] 上のインデックス（Mobile用）
     *                 PC・Mobile どちらのモードでもジャンプできるように、
     *                 両方のインデックスを同時に持たせている。
     *   chapter     … 章ラベル（"第一章" など）。無ければ null
     *   title       … タイトル文字列
     *   pageNum     … ページ番号表示用の文字列
     *
     * @param {Object} bookData
     * @returns {Array<{spreadIndex:number, pageIndex:number, chapter:string|null, title:string, pageNum:string}>}
     * @private
     */
    _buildTocEntries(bookData) {
        const entries = [];

        bookData.spreads.forEach((spread, spreadIndex) => {
            // 左ページ・右ページの両方をチェックし、見出しがある方を
            // 目次に追加する。見開き1ページ分につき、左右どちらかが
            // 採用されるのが基本（両方に見出しがあるケースは
            // 現在の BOOK_DATA には存在しないが、念のため両方確認する）。
            ['left', 'right'].forEach((side, sideIndex) => {
                const page = spread[side];
                if (!page.chapter && !page.title) return; // 見出しが無いページは目次に載せない

                entries.push({
                    spreadIndex,
                    pageIndex: spreadIndex * 2 + sideIndex, // left→偶数番目, right→奇数番目
                    chapter:   page.chapter,
                    title:     page.title,
                    pageNum:   page.pageNum
                });
            });
        });

        return entries;
    }

    /**
     * BOOK_DATA.spreads を PC 用の描画関数配列に変換する
     *
     * 各要素は { left: fn, right: fn } 形式。
     * fn は Canvas コンテキストを受け取ってページを描画する関数。
     *
     * @param {Object} bookData
     * @returns {Array<{left: Function, right: Function}>}
     * @private
     */
    _buildSpreads(bookData) {
        return bookData.spreads.map(s => ({
            left:  (ctx) => this.drawPage(ctx, 'left',  s.left),
            right: (ctx) => this.drawPage(ctx, 'right', s.right)
        }));
    }

    /**
     * spreads[] の左右を交互に並べて pages[] にフラット化する
     *
     * spreads[i].left  → pages[i*2]
     * spreads[i].right → pages[i*2+1]
     *
     * { fn, isRight } の isRight フラグは、
     * right ページが ox=PAGE_W で描かれることを示す。
     * preRenderPage() はこのフラグを使って座標を x=0 に正規化する。
     *
     * @param {Array} spreads
     * @returns {Array<{fn: Function, isRight: boolean}>}
     * @private
     */
    _buildPages(spreads) {
        const pages = [];
        spreads.forEach(s => {
            pages.push({ fn: s.left,  isRight: false }); // 左ページは ox=0 で描画
            pages.push({ fn: s.right, isRight: true  }); // 右ページは ox=PAGE_W で描画
        });
        return pages;
    }

    /**
     * 1 ページ分のコンテンツを Canvas に描画する
     *
     * PC / Mobile 共通で使用される。描画は以下の順で重ねられる:
     *   1. 背景色の塗り潰し
     *   2. 用紙テクスチャ（対角グラデーション）
     *   3. 章ラベル（chapter が非 null の場合）
     *   4. タイトル（title が非 null の場合）
     *   5. 金色の区切り線（章またはタイトルがある場合）
     *   6. 本文（body が非 null の場合）
     *   7. ページ番号（pageNum が非 null の場合）
     *
     * 座標系について:
     *   side='left'  → ox=0、x=[0, PAGE_W] に描画
     *   side='right' → ox=PAGE_W、x=[PAGE_W, PC_W] に描画
     *   preRenderPage() 経由で呼ばれる場合は translate(-PAGE_W, 0) が
     *   事前に適用され、実質 x=[0, PAGE_W] になる。
     *
     * @param {CanvasRenderingContext2D} c
     * @param {'left'|'right'} side - ページの左右（描画 X 基点を決定）
     * @param {string}  bg         - 背景色（CSS カラー文字列）
     * @param {string|null} chapter - 章ラベル。null で非表示
     * @param {string|null} title   - 大タイトル。null で非表示
     * @param {string|null} body    - 本文。\n で改行。null で非表示
     * @param {string|null} pageNum - ページ番号ラベル。null で非表示
     */
    /**
     * 1ページ分の内容（背景・章・タイトル・本文・ページ番号）を描く
     *
     * @param {CanvasRenderingContext2D} c
     * @param {'left'|'right'} side
     * @param {string} bg        - 背景色（bgImage が無いページで使われる）
     * @param {string|null} chapter
     * @param {string|null} title
     * @param {string|null} body
     * @param {string} pageNum
     * @param {HTMLImageElement|undefined} [bgImage] - カバーページ用の
     *        背景写真（読み込み済みの Image オブジェクト）。
     *        BOOK_DATA に bgImage の指定が無いページ、または
     *        まだ読み込みが完了していないページでは undefined になる
     *        （Map.get() は該当キーが無いと undefined を返すため）。
     * @param {string|null} [dateLabel] - ページの角に小さく表示する
     *        年代ラベル（例: "1985年"）。BOOK_DATA に指定が無ければ
     *        何も描かれない。
     * @param {HTMLImageElement|undefined} [signatureImage] - 表紙などに
     *        小さく配置する署名・落款の画像（読み込み済みの Image）。
     *        bgImage と同じキャッシュ機構（_bgImageCache）を共有する。
     */
    drawPage(c, side, page) {
        const { PAGE_W, PC_H } = this.C;
        const ox = (side === 'right') ? PAGE_W : 0;

        // ページデータ（オブジェクト）から各項目を取り出す。
        // 画像系（bgImage / signatureImage）はデータURL文字列をキーに
        // 読み込み済み Image をキャッシュから引く（未読込なら undefined）。
        const { bg, chapter, title, body, pageNum, dateLabel, qLabel, question, answer } = page;
        const bgImage        = this._bgImageCache.get(page.bgImage);
        const signatureImage = this._bgImageCache.get(page.signatureImage);

        // ── 1. 背景 ────────────────────────────────────────
        if (bgImage) {
            // ── カバーページ用：写真を全面に敷く ──
            // cover方式（はみ出す分は切り取る）で、ページ全体を
            // 写真で埋め尽くす。アスペクト比が違っても余白ができない
            // ようにするため、幅基準・高さ基準のうち大きい方の
            // スケールを採用する。
            const scale = Math.max(PAGE_W / bgImage.width, PC_H / bgImage.height);
            const drawW = bgImage.width  * scale;
            const drawH = bgImage.height * scale;
            // 中央に配置されるよう、はみ出した分の半分だけずらす
            const drawX = ox + (PAGE_W - drawW) / 2;
            const drawY = (PC_H - drawH) / 2;
            c.drawImage(bgImage, drawX, drawY, drawW, drawH);

            // ── 半透明の白いベール ──
            // 写真の上にそのまま文字を置くと読みにくくなるため、
            // 白を薄く重ねて全体を明るく霞ませ、文字の可読性を確保する。
            // bg（ページごとの基調色）に近い色を使うことで、
            // 背景画像が無いページとの統一感も保たれる。
            c.fillStyle = 'rgba(253, 252, 248, 0.78)';
            c.fillRect(ox, 0, PAGE_W, PC_H);
        } else {
            // ── 通常ページ：単色背景 ──
            c.fillStyle = bg;
            c.fillRect(ox, 0, PAGE_W, PC_H);
        }

        // ── 2. 用紙テクスチャ ───────────────────────────────
        // 対角グラデーションで紙の微細なムラ・光の当たり方を表現する。
        // 完全フラットな色だと印刷物のように見えてしまうため。
        const pg = c.createLinearGradient(ox, 0, ox + PAGE_W, PC_H);
        pg.addColorStop(0,   'rgba(255,255,255,0.18)'); // 左上: 明るく
        pg.addColorStop(0.5, 'rgba(0,0,0,0.01)');        // 中央: ほぼ透明
        pg.addColorStop(1,   'rgba(0,0,0,0.05)');        // 右下: わずかに暗く
        c.fillStyle = pg;
        c.fillRect(ox, 0, PAGE_W, PC_H);

        // テキスト描画の基準 X（ページ中央）と基準 Y（垂直中央より上）
        const cx = ox + PAGE_W / 2;
        let   cy = PC_H / 2 - 40; // -40 は視覚的重心を少し上に置くため
        c.textAlign    = 'center';
        c.textBaseline = 'middle';

        // ── Q&A ページかどうか ──────────────────────────────
        // question / answer を持つページは、章・タイトル・本文の
        // 代わりに専用の Q&A レイアウト（_drawQA）で描く。
        const isQA = !!(answer || question);
        if (isQA) {
            this._drawQA(c, ox, page);
        }

        // ── 3. 章ラベル ─────────────────────────────────────
        if (!isQA && chapter) {
            c.font      = 'italic 17px Georgia, serif';
            c.fillStyle = '#c9a961'; // ゴールド色
            c.fillText(chapter, cx, cy - 125); // タイトルより上に配置
        }

        // ── 4. タイトル ─────────────────────────────────────
        // 8 文字超のタイトルは自動的に小さいフォントに切り替える。
        // 「社長の自分史」（7 文字）は大タイトル、
        // 「事業の成長と課題」（9 文字）は小タイトルになる。
        if (!isQA && title) {
            const lines  = title.split('\n');
            const isLong = title.length > 8;
            c.fillStyle  = isLong ? '#c9a961' : '#2a2020';
            c.font       = isLong ? 'bold 28px Georgia, serif' : 'bold 44px Georgia, serif';
            const lineH  = isLong ? 36 : 54; // 行送り
            lines.forEach((ln, i) => c.fillText(ln, cx, cy - 85 + i * lineH));
            // 複数行の場合、cy を行数分下にずらして後続要素の位置を調整
            cy += (lines.length - 1) * lineH;
        }

        // ── 5. 金色の区切り線 ───────────────────────────────
        // 章またはタイトルがある場合のみ描画する。
        // 中央が不透明、端が透明なグラデーションで「光るライン」を表現。
        if (!isQA && (chapter || title)) {
            const gl = c.createLinearGradient(cx - 65, 0, cx + 65, 0);
            gl.addColorStop(0,   'rgba(201,169,97,0)');    // 左端: 透明
            gl.addColorStop(0.5, 'rgba(201,169,97,0.92)'); // 中央: ゴールド
            gl.addColorStop(1,   'rgba(201,169,97,0)');    // 右端: 透明
            c.strokeStyle = gl;
            c.lineWidth   = 1.5;
            c.beginPath();
            c.moveTo(cx - 65, cy - 32); // タイトル直下に配置
            c.lineTo(cx + 65, cy - 32);
            c.stroke();
        }

        // ── 6. 本文 ────────────────────────────────────────
        if (!isQA && body) {
            c.font      = '17px Georgia, serif';
            c.fillStyle = '#484040';
            const lines  = body.split('\n');
            const lineH  = 29; // 行送り
            // タイトル等がある場合は区切り線の直下、ない場合は垂直中央に配置
            const startY = (chapter || title)
                ? cy + 8
                : PC_H / 2 - (lines.length * lineH) / 2;
            lines.forEach((ln, i) => c.fillText(ln, cx, startY + i * lineH));
        }

        // ── 7. ページ番号 ───────────────────────────────────
        // 左ページは左下、右ページは右下に配置する（本の慣習に従う）
        if (pageNum) {
            c.font      = 'italic 13px Georgia, serif';
            c.fillStyle = '#c0b0a0'; // 薄いベージュ（目立たせず存在させる）
            const nx    = side === 'left' ? ox + 50 : ox + PAGE_W - 50;
            c.textAlign = side === 'left' ? 'left' : 'right';
            c.fillText(pageNum, nx, PC_H - 28);
            c.textAlign = 'center'; // 他の描画に影響しないようリセット
        }

        // ── 8. 年代スタンプ ─────────────────────────────────
        // ページ番号とは対角（左ページなら右上、右ページなら左上）の
        // 角に、年代ラベルを控えめに表示する。アルバムの隅にある
        // 日付印のような役割。pageNum と対角にすることで、お互いの
        // 表示が重ならず、ページの左右両端に視覚的なバランスが生まれる。
        if (dateLabel) {
            c.font       = 'italic 12px Georgia, serif';
            c.fillStyle  = 'rgba(180, 160, 130, 0.55)'; // ごく薄いベージュ
            const dateX  = side === 'left' ? ox + PAGE_W - 45 : ox + 45;
            c.textAlign  = side === 'left' ? 'right' : 'left';
            c.fillText(dateLabel, dateX, 38);
            c.textAlign  = 'center'; // 他の描画に影響にリセット
        }

        // ── 9. 落款・サイン画像 ─────────────────────────────
        // 表紙などに「署名」や「印影」の小さな画像を右下に配置する。
        // pageNum と重ならないよう、もう少し上の位置に置く。
        if (signatureImage) {
            // サインは小さく、かつ縦横比を保って配置する。
            // 幅を基準に高さを自動計算する（contain方式と似た考え方）。
            const sigW = 90;
            const sigH = sigW * (signatureImage.height / signatureImage.width);
            const sigX = ox + PAGE_W - sigW - 45;
            const sigY = PC_H - sigH - 55; // ページ番号より少し上
            c.save();
            c.globalAlpha = 0.88; // わずかに馴染ませるため完全な不透明にしない
            c.drawImage(signatureImage, sigX, sigY, sigW, sigH);
            c.restore();
        }
    }

    /**
     * Q&A 形式（質問と回答）のページ本文を描く。
     *
     * レイアウト（上から）:
     *   ・「Q1」などの質問番号ラベル（ゴールド）
     *   ・質問文（やや小さめ・落ち着いた色・イタリック）
     *   ・金色の区切り線
     *   ・回答文（読みやすい本文サイズ）
     *
     * 長文でもページ幅に収まるよう自動折り返しするが、その行分割は
     * precomputeWrapping() が起動時に一度だけ計算して page._qLines /
     * page._aLines に格納したものを使う。こうすることで、静止時
     * （メイン Canvas）とめくり時（オフスクリーン Canvas）で折り返しが
     * 食い違わず、めくり開始時に行がズレる不具合を防ぐ。
     * （万一未計算なら、その場で測って描く安全策も入れてある。）
     *
     * @param {CanvasRenderingContext2D} c
     * @param {number} ox  - ページ左端の X（left=0 / right=PAGE_W）
     * @param {Object} page - ページデータ（qLabel/question/answer と
     *                        precompute 済みの _qLines/_aLines を持つ）
     * @private
     */
    _drawQA(c, ox, page) {
        const { PAGE_W } = this.C;
        const cx = ox + PAGE_W / 2;
        c.textAlign    = 'center';
        c.textBaseline = 'middle';

        // precompute 済みの行を使う（無ければその場で計算）
        const qLines = page._qLines || (page.question ? this._wrapWith(this._QA_Q_FONT, page.question) : []);
        const aLines = page._aLines || (page.answer   ? this._wrapWith(this._QA_A_FONT, page.answer)   : []);

        let y = 84; // 文字エリア上端

        // 質問番号ラベル
        if (page.qLabel) {
            c.font      = this._QA_Q_FONT;
            c.fillStyle = '#c9a961';
            c.fillText(page.qLabel, cx, y);
            y += 30;
        }

        // 質問文（落ち着いた色のイタリック）
        if (qLines.length) {
            c.font      = this._QA_Q_FONT;
            c.fillStyle = '#6b5a42';
            const lineH = 26;
            qLines.forEach((ln) => { c.fillText(ln, cx, y); y += lineH; });
        }

        // 金色の区切り線
        if (qLines.length && aLines.length) {
            y += 6;
            const gl = c.createLinearGradient(cx - 55, 0, cx + 55, 0);
            gl.addColorStop(0,   'rgba(201,169,97,0)');
            gl.addColorStop(0.5, 'rgba(201,169,97,0.85)');
            gl.addColorStop(1,   'rgba(201,169,97,0)');
            c.strokeStyle = gl;
            c.lineWidth   = 1.2;
            c.beginPath();
            c.moveTo(cx - 55, y);
            c.lineTo(cx + 55, y);
            c.stroke();
            y += 24;
        }

        // 回答文（本文）
        if (aLines.length) {
            c.font      = this._QA_A_FONT;
            c.fillStyle = '#403838';
            const lineH = 27;
            aLines.forEach((ln) => { c.fillText(ln, cx, y); y += lineH; });
        }
    }

    /**
     * 測定用の固定コンテキストで、指定フォントの折り返し行を計算する。
     * @param {string} font
     * @param {string} text
     * @returns {string[]}
     * @private
     */
    _wrapWith(font, text) {
        this._measureCtx.font = font;
        return this._wrapText(this._measureCtx, text, this._QA_MAXWIDTH);
    }

    /**
     * 全 Q&A ページの質問・回答の折り返しを一度だけ計算し、各ページに
     * _qLines / _aLines として覚えさせる。
     *
     * 呼び出すタイミング:
     *   BookController.init() で、document.fonts.ready を待った後・最初の
     *   描画より前に1回だけ。フォントが確定した状態で、かつ常に同じ
     *   測定用コンテキストで計算するので、折り返しが全描画で一定になる。
     */
    precomputeWrapping() {
        // 測定の精度を上げるため、使うフォントを一度ウォームアップする
        // （生成直後のコンテキストは初回計測でフォールバックすることがある）。
        [this._QA_Q_FONT, this._QA_A_FONT].forEach((f) => {
            this._measureCtx.font = f;
            this._measureCtx.measureText('漢字あいう');
        });

        this._spreadData.forEach((s) => {
            ['left', 'right'].forEach((side) => {
                const p = s[side];
                if (!p) return;
                if (p.question) p._qLines = this._wrapWith(this._QA_Q_FONT, p.question);
                if (p.answer)   p._aLines = this._wrapWith(this._QA_A_FONT, p.answer);
            });
        });
    }

    /**
     * テキストを指定幅に収まるよう自動で折り返し、行の配列を返す。
     * 日本語のように空白で区切れない文章にも対応するため、1文字ずつ
     * measureText で幅を測りながら詰めていく。元の改行（\n）は尊重する。
     *
     * 呼び出す前に c.font を設定しておくこと（measureText がそのフォントで
     * 計測するため）。
     *
     * @param {CanvasRenderingContext2D} c
     * @param {string} text
     * @param {number} maxWidth
     * @returns {string[]} 折り返し後の行
     * @private
     */
    _wrapText(c, text, maxWidth) {
        const out = [];
        String(text).split('\n').forEach((para) => {
            let line = '';
            for (const ch of para) {
                const test = line + ch;
                if (line && c.measureText(test).width > maxWidth) {
                    out.push(line);
                    line = ch;
                } else {
                    line = test;
                }
            }
            out.push(line);
        });
        return out;
    }

    /**
     * 左ページの下半分に画像を「ポラロイド写真」風に重ねて描画する
     *
     * なぜ drawPage() に組み込まず分離しているか:
     *   spreads[]/pages[] の描画関数は BOOK_DATA から固定的に
     *   生成されるクロージャであり、後から画像の有無を差し込めない。
     *   画像は「ユーザー操作で動的に追加される」データのため、
     *   描画パイプラインの最後に独立したレイヤーとして合成する方が
     *   責務が分かりやすく、BOOK_DATA 側の構造を変えずに済む。
     *
     * デザイン方針（おしゃれな自分史アルバム風）:
     *   ・上半分（タイトル・本文）はそのまま見える状態を保ち、
     *     下半分だけを写真エリアとして使う。
     *   ・写真は白いカード（ポラロイド）に載せ、下側だけ余白を広く取る。
     *   ・カードは角丸＋柔らかい落ち影で「本に貼った1枚の写真」の質感に。
     *   ・カードをほんの少し傾けて、台紙に無造作に貼ったような温かみを出す。
     *   傾けてもページ外や綴じ目にはみ出さないよう、余白を多めに確保する。
     *
     * @param {CanvasRenderingContext2D} c
     * @param {'left'|'right'} side  - ページの左右（描画 X 基点を決定）
     * @param {HTMLImageElement} img - 描画する画像
     */
    drawImageOverlay(c, side, img) {
        const { PAGE_W, PC_H } = this.C;
        const ox = (side === 'right') ? PAGE_W : 0;

        // 写真エリアはページ「下部のバンド」に固定する。
        // 本文（章＋タイトル＋本文）は最大で y≈435 付近まで伸びるため、
        // それより十分下から写真を始めて、後ろの文字と重ならないようにする。
        const margin       = 50; // 左右余白
        const bottomMargin = 28; // 下端の余白
        const frameX = ox + margin;
        const frameY = 448;                         // 本文の下端より下
        const frameW = PAGE_W - margin * 2;
        const frameH = PC_H - bottomMargin - frameY;

        // ── ポラロイドの余白（下だけ広い「顎」を作るのが味） ──
        const padSide   = 14; // 左右
        const padTop    = 14; // 上
        const padBottom = 30; // 下（広め）

        // 写真本体を、カードの余白を差し引いた内側領域に contain で収める
        const innerW = frameW - padSide * 2;
        const innerH = frameH - padTop - padBottom;
        const scale  = Math.min(innerW / img.width, innerH / img.height);
        const photoW = img.width  * scale;
        const photoH = img.height * scale;

        // カード外形のサイズと、表示枠内での中央配置
        const cardW = photoW + padSide * 2;
        const cardH = photoH + padTop + padBottom;
        const cardX = frameX + (frameW - cardW) / 2;
        const cardY = frameY + (frameH - cardH) / 2;

        // 写真のカード内オフセット（左右中央・上余白の下）
        const photoOffX = padSide;
        const photoOffY = padTop;

        // カード中心を基準に、ごくわずかに傾ける（無造作に貼った雰囲気）
        const cx = cardX + cardW / 2;
        const cy = cardY + cardH / 2;
        const tilt = -2.2 * Math.PI / 180; // ラジアン

        c.save();
        c.translate(cx, cy);
        c.rotate(tilt);
        // 以降は「カード中心が原点」の座標系で描く
        const left = -cardW / 2;
        const top  = -cardH / 2;

        // ── 1) 白いカード（角丸＋柔らかい落ち影） ──
        c.save();
        c.shadowColor   = 'rgba(40,30,20,0.30)';
        c.shadowBlur    = 26;
        c.shadowOffsetX = 2;
        c.shadowOffsetY = 12;
        c.fillStyle = '#fffdf8'; // ほんのり暖色の白（羊皮紙の本になじむ）
        this._roundRectPath(c, left, top, cardW, cardH, 10);
        c.fill();
        c.restore();

        // ── 2) 写真の落ち込み（マット内側のごく薄い影で立体感） ──
        const px = left + photoOffX;
        const py = top + photoOffY;
        c.save();
        c.shadowColor   = 'rgba(0,0,0,0.18)';
        c.shadowBlur    = 6;
        c.shadowOffsetY = 2;
        c.fillStyle = '#000';
        c.fillRect(px, py, photoW, photoH);
        c.restore();

        // ── 3) 写真本体 ──
        c.drawImage(img, px, py, photoW, photoH);

        // ── 4) 写真の縁を引き締める極細の枠線 ──
        c.strokeStyle = 'rgba(0,0,0,0.10)';
        c.lineWidth   = 1;
        c.strokeRect(px + 0.5, py + 0.5, photoW - 1, photoH - 1);

        // ── 5) 留め方の装飾（ユーザーが選んだスタイル）──
        // カード中心が原点の回転座標系の中で描くので、装飾もカードと
        // 一緒にわずかに傾く。
        this._drawPhotoDecoration(c, left, top, cardW, cardH);

        c.restore();
    }

    /**
     * 写真カードの「留め方」装飾を描く。スタイルは this.photoStyle で決まる:
     *   'corners'     … 左上・右下に三角のフォトコーナー（アルバム差し込み風）
     *   'pushpin'     … 上端中央に赤い画鋲
     *   'maskingtape' … 上の両角に半透明パステルのマスキングテープ
     *   'tape'        … 上の両角に半透明クリアのテープ
     *
     * 座標はカード中心が原点（left,top が左上、right,bottom が右下）。
     * @param {CanvasRenderingContext2D} c
     * @param {number} left, top, w, h - カードの矩形
     * @private
     */
    _drawPhotoDecoration(c, left, top, w, h) {
        const right  = left + w;
        const bottom = top + h;
        switch (this.photoStyle) {
            case 'pushpin':
                this._drawPushpin(c, 0, top + 14);
                break;
            case 'maskingtape':
                this._drawTapeStrip(c, left, top, +1, 'masking');  // 左上角
                this._drawTapeStrip(c, right, top, -1, 'masking'); // 右上角
                break;
            case 'tape':
                this._drawTapeStrip(c, left, top, +1, 'clear');
                this._drawTapeStrip(c, right, top, -1, 'clear');
                break;
            case 'corners':
            default:
                this._drawPhotoCorner(c, left, top, 'tl');      // 左上
                this._drawPhotoCorner(c, right, bottom, 'br');  // 右下
                break;
        }
    }

    /**
     * アルバムの「フォトコーナー」（写真の角を差し込む三角の留め具）を描く。
     * @param {CanvasRenderingContext2D} c
     * @param {number} x,y - 角の頂点座標
     * @param {'tl'|'br'} corner - どの角か（向きを決める）
     * @private
     */
    _drawPhotoCorner(c, x, y, corner) {
        const s = 26; // 三角の一辺
        const dx = (corner === 'tl') ? 1 : -1; // 内側へ向かう向き
        const dy = (corner === 'tl') ? 1 : -1;
        c.save();
        // ほんのり影を落として浮きを表現
        c.shadowColor   = 'rgba(0,0,0,0.25)';
        c.shadowBlur    = 4;
        c.shadowOffsetX = dx * 1.5;
        c.shadowOffsetY = dy * 1.5;
        // 黒っぽい台紙色の直角三角形（角にぴったり重ねる）
        c.fillStyle = 'rgba(40,34,28,0.82)';
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + dx * s, y);
        c.lineTo(x, y + dy * s);
        c.closePath();
        c.fill();
        c.restore();
        // 斜辺に沿ったハイライトで、紙を差し込む“ポケット”感を出す
        c.save();
        c.strokeStyle = 'rgba(255,255,255,0.25)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + dx * s, y);
        c.lineTo(x, y + dy * s);
        c.stroke();
        c.restore();
    }

    /**
     * カードの上角に貼る「テープ」を描く（マスキング／クリア共通）。
     * 角をまたぐように斜め45度の短冊を描く。
     * @param {CanvasRenderingContext2D} c
     * @param {number} cornerX - 角の X（左上なら left、右上なら right）
     * @param {number} cornerY - 角の Y（top）
     * @param {number} dir - 内側へ向かう向き（左上=+1 / 右上=-1）
     * @param {'masking'|'clear'} kind - テープの種類
     * @private
     */
    _drawTapeStrip(c, cornerX, cornerY, dir, kind) {
        const len  = 58; // 短冊の長さ
        const half = 11; // 短冊の幅の半分
        // 角の少し外側から内側へ、45度で横切らせる
        const cxp = cornerX - dir * 6;
        const cyp = cornerY - 6;
        c.save();
        c.translate(cxp, cyp);
        c.rotate(dir * 45 * Math.PI / 180); // 左上は右下がり、右上は左下がりに
        c.shadowColor   = 'rgba(0,0,0,0.18)';
        c.shadowBlur    = 3;
        c.shadowOffsetY = 1;

        if (kind === 'masking') {
            // パステルの半透明（紙テープ）。端は少しギザつかせる。
            c.fillStyle = 'rgba(150,200,210,0.55)';
        } else {
            // クリアテープ（ほぼ透明＋うっすら白み）。
            c.fillStyle = 'rgba(245,245,235,0.28)';
        }
        // 短冊（中心から左右に len/2）
        c.beginPath();
        c.rect(-len / 2, -half, len, half * 2);
        c.fill();
        c.shadowColor = 'transparent';

        if (kind === 'clear') {
            // クリアテープの“てかり”を斜めの白線で表現
            c.strokeStyle = 'rgba(255,255,255,0.35)';
            c.lineWidth = 1.5;
            c.beginPath();
            c.moveTo(-len / 2 + 3, -half + 3);
            c.lineTo(len / 2 - 3, -half + 3);
            c.stroke();
        } else {
            // マスキングテープの縁を少し濃く
            c.strokeStyle = 'rgba(120,170,180,0.5)';
            c.lineWidth = 1;
            c.strokeRect(-len / 2, -half, len, half * 2);
        }
        c.restore();
    }

    /**
     * 画鋲（プッシュピン）を上から見た形で描く。
     * @param {CanvasRenderingContext2D} c
     * @param {number} x,y - ピン頭の中心座標
     * @private
     */
    _drawPushpin(c, x, y) {
        c.save();
        // 影
        c.fillStyle = 'rgba(0,0,0,0.30)';
        c.beginPath();
        c.ellipse(x + 2, y + 6, 9, 4, 0, 0, Math.PI * 2);
        c.fill();
        // 頭（赤の光沢球）
        const g = c.createRadialGradient(x - 4, y - 5, 2, x, y, 13);
        g.addColorStop(0,   '#ff8a8a');
        g.addColorStop(0.5, '#e23b3b');
        g.addColorStop(1,   '#9e1f1f');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, 11, 0, Math.PI * 2);
        c.fill();
        // 縁
        c.lineWidth   = 1;
        c.strokeStyle = 'rgba(110,18,18,0.6)';
        c.stroke();
        // ハイライト
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.beginPath();
        c.arc(x - 4, y - 4, 3, 0, Math.PI * 2);
        c.fill();
        c.restore();
    }

    /**
     * 角丸矩形のパスを現在のコンテキストに作る（fill/stroke する前に呼ぶ）。
     * ctx.roundRect 非対応ブラウザでも動くよう arcTo で実装。
     * @private
     */
    _roundRectPath(c, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        c.beginPath();
        c.moveTo(x + rr, y);
        c.arcTo(x + w, y,     x + w, y + h, rr);
        c.arcTo(x + w, y + h, x,     y + h, rr);
        c.arcTo(x,     y + h, x,     y,     rr);
        c.arcTo(x,     y,     x + w, y,     rr);
        c.closePath();
    }

    /**
     * ページをオフスクリーン Canvas に事前描画して返す
     *
     * なぜオフスクリーン Canvas が必要か:
     *   アニメーション中は毎フレーム（60fps）PageFlipEffect の描画が
     *   呼ばれる。毎フレーム drawPage() を呼ぶと重いテキスト描画が
     *   60fps で走り、パフォーマンスが低下する。
     *   アニメーション開始時に一度だけ描画してキャッシュすることで、
     *   毎フレームは軽量な drawImage() だけで済む。
     *
     * 結果キャッシュについて（最適化）:
     *   overlayImg を指定しない呼び出しは、同じ drawFn に対して
     *   常に同じ画像が生成される（BOOK_DATA は静的なため）。
     *   そのため drawFn 自体を Map のキーにして結果を再利用し、
     *   document.createElement('canvas') や fillText の再実行を
     *   完全に省略できるようにしている。
     *   静止表示のたびに（例えば updateUI() 経由で render() が
     *   何度も呼ばれるような場面でも）このキャッシュが効くため、
     *   ページめくり操作と無関係な再描画コストがほぼゼロになる。
     *
     *   overlayImg 付きの呼び出し（ドラッグ＆ドロップで画像が
     *   追加された見開きの左ページ）はキャッシュしない。
     *   画像は後から変わる可能性があり、誤って古い画像が
     *   キャッシュされ続けると更新が反映されなくなるため。
     *
     * 座標正規化について（isRight = true の場合）:
     *   drawPage() の right ページは ox=PAGE_W（画面中央から右）に描かれる。
     *   しかし PageFlipEffect は「ページコンテンツが x=0 から始まる」
     *   前提で透視変換の数式を組んでいる（簡略化のため）。
     *   translate(-PAGE_W, 0) を事前に適用することで right ページの描画を
     *   x=0 基準に正規化し、PC/Mobile 両方で同じ変換式を使えるようにする。
     *
     * @param {Function} drawFn  - 描画関数（spreads[i].left / .right）
     * @param {boolean}  isRight - true なら translate(-PAGE_W,0) で正規化
     * @param {HTMLImageElement|null} [overlayImg] - 重ねて描く画像（あれば）
     * @returns {HTMLCanvasElement} PAGE_W × PC_H のオフスクリーン Canvas
     */
    preRenderPage(drawFn, isRight, overlayImg = null) {
        // Map（マップ）について（JavaScript初心者向けメモ）:
        //   Map は「キーと値のペア」を保存しておける箱のようなもの。
        //   普通の配列（Array）は「0番目、1番目...」という数字でしか
        //   要素を取り出せないが、Map は「このキーに対応する値は何？」
        //   という形で何でもキーにできる（ここでは関数 drawFn 自体を
        //   キーにしている）。
        //     .has(キー)      → そのキーが登録済みか（true/false）
        //     .get(キー)      → そのキーに対応する値を取り出す
        //     .set(キー, 値)  → キーと値のペアを新しく登録する
        //
        // overlayImg が無い場合のみ、「このページはもう描いたことが
        // あるか？」を確認し、あれば新しく描き直さずに前回の結果
        // （オフスクリーン Canvas）をそのまま返す。これにより、
        // 同じページを何度表示しても1回目だけ重い描画処理が走り、
        // 2回目以降は「描いた結果を取り出すだけ」の軽い処理になる。
        if (!overlayImg && this._renderCache.has(drawFn)) {
            return this._renderCache.get(drawFn);
        }

        const { PAGE_W, PC_H } = this.C;

        // まず DOM 接続済みの隠し描画面に描く（メイン Canvas と同じ
        // フォント解決になるので、静止時とめくり時で書体が一致する）。
        const sctx = this._surfaceCtx;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, PAGE_W, PC_H);
        // right ページ: ox=PAGE_W の描画を x=0 基準に正規化
        if (isRight) sctx.translate(-PAGE_W, 0);
        drawFn(sctx);
        // 画像が指定されていれば、文字コンテンツの上に重ねて描く。
        // isRight 正規化済みの座標系で描くため side は常に 'left'。
        if (overlayImg) {
            this.drawImageOverlay(sctx, 'left', overlayImg);
        }
        sctx.setTransform(1, 0, 0, 1, 0, 0);

        // 描いた結果（ピクセル）を、返却用の Canvas にコピーする。
        // コピーは画像転送なので、ここで作る Canvas が DOM 非接続でも
        // フォントには影響しない（文字はもう描画面でラスタライズ済み）。
        const off    = document.createElement('canvas');
        off.width    = PAGE_W; // = MOB_W（PC/Mobile 共通サイズ）
        off.height   = PC_H;   // = MOB_H
        off.getContext('2d').drawImage(this._surface, 0, 0);

        // オーバーレイなしの結果のみキャッシュする
        if (!overlayImg) this._renderCache.set(drawFn, off);

        return off;
    }
}
