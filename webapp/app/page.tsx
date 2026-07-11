'use client';
/* ================================================================
   ホーム画面
   ── 「新しい本を作る」＋「この端末で作った本の一覧」

   認証なしMVPの考え方:
     ・本を作ると UUID が発行され、Supabase に保存される。
     ・URL（/book/<uuid>）を知っている人だけがアクセスできる。
     ・「自分の本の一覧」は localStorage に覚えた UUID のリスト
       （＝この端末で作った本）を表示するだけ。
   ================================================================ */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { createDefaultPages } from '@/lib/defaultBook';

const MY_BOOKS_KEY = 'jibunshi-my-books'; // localStorage: ["uuid1", "uuid2", ...]

interface BookSummary { id: string; title: string; updated_at: string }

export default function HomePage() {
  const router = useRouter();
  const supabase = getSupabase();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // この端末で作った本の一覧を読み込む
  useEffect(() => {
    if (!supabase) return;
    const ids: string[] = JSON.parse(localStorage.getItem(MY_BOOKS_KEY) || '[]');
    if (ids.length === 0) return;
    supabase
      .from('books')
      .select('id, title, updated_at')
      .in('id', ids)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError('一覧の読み込みに失敗しました: ' + error.message);
        else setBooks(data ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createBook() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    const title = 'わたしの自分史';
    const { data, error } = await supabase
      .from('books')
      .insert({ title, pages: createDefaultPages(title) })
      .select('id')
      .single();
    if (error || !data) {
      setError('本の作成に失敗しました: ' + (error?.message ?? ''));
      setBusy(false);
      return;
    }
    // この端末で作った本として記憶する
    const ids: string[] = JSON.parse(localStorage.getItem(MY_BOOKS_KEY) || '[]');
    localStorage.setItem(MY_BOOKS_KEY, JSON.stringify([data.id, ...ids]));
    router.push(`/book/${data.id}/manage`);
  }

  return (
    <div className="shell">
      <h1 className="site-title">自分史ブック</h1>
      <p className="site-sub">〜 問いと答えで綴る、あなたの物語 〜</p>

      {!supabase ? (
        <div className="setup-note">
          <strong>セットアップが必要です。</strong>
          <br />
          Supabase の環境変数が設定されていません。
          <code>NEXT_PUBLIC_SUPABASE_URL</code> と{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を設定してください。
          手順は <code>webapp/README.md</code> を参照。
        </div>
      ) : (
        <>
          <div className="center">
            <button className="btn btn-primary" onClick={createBook} disabled={busy}>
              {busy ? '作成中…' : '＋ 新しい本を作る'}
            </button>
            <p className="status-line err">{error}</p>
          </div>

          {books.length > 0 && (
            <>
              <h2 className="site-sub mt-lg">この端末で作った本</h2>
              <div className="book-list">
                {books.map((b) => (
                  <div key={b.id} className="book-card">
                    <span className="book-card-title">{b.title}</span>
                    <span className="book-card-date">
                      {new Date(b.updated_at).toLocaleDateString('ja-JP')}
                    </span>
                    <button className="mini-link" onClick={() => router.push(`/book/${b.id}`)}>
                      読む
                    </button>
                    <button
                      className="mini-link"
                      onClick={() => router.push(`/book/${b.id}/manage`)}
                    >
                      編集
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
