/* ================================================================
   main.js
   ── 社長の自分史 電子ブック ─ エントリーポイント

   このファイルの責務:
     ・各クラスをインスタンス化し、依存関係を組み立てる（DI: 依存性注入）
     ・DOM 読み込み完了後にアプリケーションを起動する

   このファイルの責務外:
     ・実際の描画・アニメーション・状態管理ロジック
       → すべて各クラス（Page〜, Book〜, ImageStore）に委譲されている

   ── 依存関係の組み立て順序 ──
     PageContentRenderer  … データ（BOOK_DATA）を必要とする
     PageFlipEffect        … Canvas コンテキストを必要とする
     BookRenderer           … 上記 2 つを組み合わせて使う
     BookAnimator            … PageContentRenderer を使ってキャッシュ生成
     ImageStore               … 画像の保存・読込のみ（他クラスに依存しない）
     BookController             … 上記すべてを統括する司令塔

   依存の向きは一方通行（下層 → 上層）になっており、
   循環参照が発生しないように設計されている。
   ================================================================ */

$(document).ready(function () {

    // ── Canvas 要素の取得 ──────────────────────────────────
    const canvas = document.getElementById('book-canvas');
    const ctx    = canvas.getContext('2d');

    // ── UI 要素（jQuery オブジェクト）をまとめて渡す ──────
    const ui = {
        pageCounter: $('#page-counter'),
        prevBtn:     $('#prev-btn'),
        nextBtn:     $('#next-btn'),
        hintText:    $('#hint-text'),

        // 目次サイドバー関連の要素。BookController が開閉や
        // 項目クリックのイベント登録、ハイライト更新に使う。
        tocToggleBtn: $('#toc-toggle-btn'),
        tocCloseBtn:  $('#toc-close-btn'),
        tocPanel:     $('#toc-panel'),
        tocOverlay:   $('#toc-overlay'),
        tocList:      $('#toc-list'),

        // PDF書き出し関連の要素
        pdfExportBtn:    $('#pdf-export-btn'),
        pdfExportStatus: $('#pdf-export-status'),

        // ナビ補助（読み上げ）
        ttsBtn:           $('#tts-btn'),

        // 設定セクション（音ON/OFF・写真の留め方・自動ページ送り）
        soundToggle:      $('#sound-toggle'),
        photoStyleSelect: $('#photo-style-select'),
        autoPlayBtn:      $('#auto-play-btn'),

        // 読了プログレスバー
        progressBarFill: $('#progress-bar-fill')
    };

    // ── 各クラスのインスタンス化（依存性注入） ────────────
    const contentRenderer = new PageContentRenderer(BOOK_DATA, BOOK_CONST);
    const flipEffect       = new PageFlipEffect(ctx, BOOK_CONST);
    const bookRenderer      = new BookRenderer(ctx, BOOK_CONST, contentRenderer, flipEffect);
    const animator           = new BookAnimator(BOOK_CONST, contentRenderer);
    const imageStore          = new ImageStore();
    const bookmarkStore        = new BookmarkStore();
    const settingsStore         = new SettingsStore();
    const audioPlayer            = new AudioPlayer(PAGE_FLIP_SOUND_DATA_URL);
    const pdfExporter             = new PdfExporter(contentRenderer, BOOK_CONST);

    const controller = new BookController(
        BOOK_CONST,
        contentRenderer,
        bookRenderer,
        animator,
        imageStore,
        bookmarkStore,
        settingsStore,
        audioPlayer,
        pdfExporter,
        canvas,
        ui
    );

    controller.init().catch((err) => {
        console.error('電子ブックの起動に失敗しました:', err);
    });

    $('#debug-mode-btn').on('click', () => controller._toggleDebugMode());
    // 「⚙ データ管理」は別ページ（manage.html）へ遷移するリンクなので、
    // ここでの JS 配線は不要（HTML の <a href="manage.html"> が担う）。
});
