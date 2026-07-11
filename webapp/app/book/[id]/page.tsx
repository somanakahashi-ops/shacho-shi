'use client';
/* ================================================================
   閲覧画面（/book/[id]）
   ── 見開き（左右2ページ）で本を読む。前へ/次へ、キーボード対応。

   静的版の BookController（PC見開きモード）に相当する最小構成。
   ページめくりアニメーション・TTS・画像などは後続で移植する。
   ================================================================ */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Book, BookPage } from '@/lib/types';
import PageView from '@/components/PageView';

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = getSupabase();
  const [book, setBook] = useState<Book | null>(null);
  const [spread, setSpread] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase || !id) return;
    supabase
      .from('books')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setError('本が見つかりませんでした。URLをご確認ください。');
        else setBook(data as Book);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 2ページずつ見開きにまとめる（静的版 book-data.js と同じ考え方）
  const pages: (BookPage | null)[] = book ? [...book.pages] : [];
  if (pages.length % 2 === 1) pages.push(null);
  const spreadCount = Math.max(1, pages.length / 2);
  const left = pages[spread * 2] ?? null;
  const right = pages[spread * 2 + 1] ?? null;

  // キーボード操作（← →）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setSpread((s) => Math.min(s + 1, spreadCount - 1));
      if (e.key === 'ArrowLeft') setSpread((s) => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spreadCount]);

  if (!supabase) {
    return (
      <div className="shell">
        <div className="setup-note">Supabase が未設定です。webapp/README.md を参照してください。</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="shell center">
        <p className="status-line err">{error}</p>
      </div>
    );
  }
  if (!book) {
    return <div className="shell center site-sub">読み込み中…</div>;
  }

  const pageNumOf = (idx: number) => (idx === 0 ? 'Cover' : String(idx));

  return (
    <div className="reader-shell">
      <div className="reader-top">
        <button className="mini-link" onClick={() => router.push('/')}>← ホーム</button>
        <span className="reader-book-title">{book.title}</span>
        <button className="mini-link" onClick={() => router.push(`/book/${id}/manage`)}>
          ✎ 編集
        </button>
      </div>

      <div className="spread">
        <PageView page={left} side="left" pageNum={pageNumOf(spread * 2)} />
        <PageView page={right} side="right" pageNum={pageNumOf(spread * 2 + 1)} />
      </div>

      <div className="reader-controls">
        <button className="btn" onClick={() => setSpread((s) => Math.max(s - 1, 0))} disabled={spread === 0}>
          ← 前へ
        </button>
        <button
          className="btn"
          onClick={() => setSpread((s) => Math.min(s + 1, spreadCount - 1))}
          disabled={spread >= spreadCount - 1}
        >
          次へ →
        </button>
      </div>
      <div className="reader-counter">
        見開き {spread + 1} / {spreadCount}
      </div>
    </div>
  );
}
