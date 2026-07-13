/* ================================================================
   types.ts ── マルチユーザー版の型定義

   ページの形は静的版（docs/data/book-data.js の PAGES）と同じ。
   1ページ＝1オブジェクトで、種類によって使うフィールドが変わる:
     ・表紙/章扉/本文ページ … chapter / title / body
     ・Q&Aページ           … qLabel / question / answer
   ================================================================ */

export interface BookPage {
    chapter?: string;   // タイトル上の小さな章見出し（例: 第一章）
    title?: string;     // 大見出し
    body?: string;      // 本文（\n 改行）
    qLabel?: string;    // "Q1" などの番号ラベル
    question?: string;  // 質問文（表示側で自動折り返し）
    answer?: string;    // 回答文（同上）
}

export interface Book {
    id: string;          // UUID（URLがそのまま共有キーになる）
    title: string;       // 本のタイトル（一覧表示用）
    author: string;      // 作者名（本棚でユーザーを選ぶときの表示名）
    pages: BookPage[];   // ページ配列（先頭が表紙）
    created_at?: string;
    updated_at?: string;
}
