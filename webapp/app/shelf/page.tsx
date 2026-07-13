'use client';
/* ================================================================
   みんなの本棚（/shelf）
   ── ユーザー（作者）を選んで、その人の本を読む画面。

   1. 全ての本から作者一覧を作って表示（人を選ぶ）
   2. 選んだ人の本の一覧を表示（本を選ぶ → 閲覧ページへ）

   認証なしMVPのため「全員の本が見える」設計。
   将来ログインを入れたら「公開設定した本だけ」に絞る予定。
   ================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

interface ShelfBook { id: string; title: string; author: string; updated_at: string }

export default function ShelfPage() {
  const router = useRouter();
  const supabase = getSupabase();
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // 選択中の作者
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('books')
      .select('id, title, author, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) setError('本棚の読み込みに失敗しました: ' + error.message);
        else setBooks((data ?? []) as ShelfBook[]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 作者ごとにまとめる（名前なしは「（名前なし）」に集約）
  const authors = useMemo(() => {
    const map = new Map<string, ShelfBook[]>();
    books.forEach((b) => {
      const key = b.author?.trim() || '（名前なし）';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    });
    return [...map.entries()]; // [作者名, 本の配列][]
  }, [books]);

  const selectedBooks = selected
    ? (authors.find(([name]) => name === selected)?.[1] ?? [])
    : [];

  if (!supabase) {
    return (
      <div className="shell">
        <div className="setup-note">Supabase が未設定です。webapp/README.md を参照してください。</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <h1 className="site-title">みんなの本棚</h1>
      <p className="site-sub">読みたい人を選んでください</p>

      <div className="center" style={{ marginBottom: 24 }}>
        <button className="mini-link" onClick={() => (selected ? setSelected(null) : router.push('/'))}>
          ← {selected ? '人の一覧へ戻る' : 'ホームへ'}
        </button>
      </div>

      {error && <p className="status-line err center">{error}</p>}
      {loading && <p className="site-sub center">読み込み中…</p>}

      {!loading && !selected && (
        <>
          {authors.length === 0 && (
            <p className="site-sub center">まだ誰も本を作っていません。最初の1冊を作りましょう！</p>
          )}
          <div className="author-grid">
            {authors.map(([name, list]) => (
              <button key={name} className="author-card" onClick={() => setSelected(name)}>
                <span className="author-avatar">{name.charAt(0)}</span>
                <span className="author-name">{name}</span>
                <span className="author-count">{list.length}冊</span>
              </button>
            ))}
          </div>
        </>
      )}

      {!loading && selected && (
        <>
          <h2 className="site-sub">{selected} さんの本</h2>
          <div className="book-list">
            {selectedBooks.map((b) => (
              <div key={b.id} className="book-card">
                <span className="book-card-title">{b.title}</span>
                <span className="book-card-date">
                  {new Date(b.updated_at).toLocaleDateString('ja-JP')}
                </span>
                <button className="mini-link" onClick={() => router.push(`/book/${b.id}`)}>
                  読む
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
