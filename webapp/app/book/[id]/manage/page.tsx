'use client';
/* ================================================================
   編集画面（/book/[id]/manage）
   ── 見開き（左右2ページ）単位で文章を編集して保存する。

   静的版の DataManager と同じUX:
     ・プルダウンで編集する見開きを選ぶ（1見開きだけ表示）
     ・左ページ｜右ページ を並べ、各フィールドを編集
     ・「保存」で Supabase に反映（読む側は再読み込みで反映）
   ================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Book, BookPage } from '@/lib/types';

const FIELDS: { key: keyof BookPage; label: string; kind: 'input' | 'textarea' }[] = [
  { key: 'chapter', label: '章ラベル', kind: 'input' },
  { key: 'title', label: 'タイトル', kind: 'input' },
  { key: 'qLabel', label: '質問番号', kind: 'input' },
  { key: 'question', label: '質問', kind: 'textarea' },
  { key: 'answer', label: '回答', kind: 'textarea' },
  { key: 'body', label: '本文', kind: 'textarea' },
];

function isEditable(page: BookPage | null | undefined): page is BookPage {
  if (!page) return false;
  return FIELDS.some((f) => typeof page[f.key] === 'string');
}

export default function ManagePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = getSupabase();
  const [book, setBook] = useState<Book | null>(null);
  const [spread, setSpread] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !id) return;
    supabase
      .from('books')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setStatus('本が見つかりませんでした。');
        else setBook(data as Book);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 編集できる見開きの一覧（プルダウン用）
  const editableSpreads = useMemo(() => {
    if (!book) return [];
    const out: { index: number; label: string }[] = [];
    for (let i = 0; i * 2 < book.pages.length; i++) {
      const l = book.pages[i * 2];
      const r = book.pages[i * 2 + 1];
      if (!isEditable(l) && !isEditable(r)) continue;
      const name = l?.title || l?.chapter || r?.title || r?.chapter || '';
      out.push({ index: i, label: `見開き ${i + 1}${name ? `：${name}` : ''}` });
    }
    return out;
  }, [book]);

  function setField(pageIndex: number, key: keyof BookPage, value: string) {
    setBook((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((p, i) => (i === pageIndex ? { ...p, [key]: value } : p));
      return { ...prev, pages };
    });
  }

  async function save() {
    if (!supabase || !book) return;
    setBusy(true);
    setStatus('保存中…');
    // 表紙のタイトルを本のタイトルにも反映する
    const title = book.pages[0]?.title || book.title;
    const { error } = await supabase
      .from('books')
      .update({ title, pages: book.pages, updated_at: new Date().toISOString() })
      .eq('id', book.id);
    setBusy(false);
    setStatus(error ? '保存に失敗しました: ' + error.message : '保存しました');
  }

  if (!supabase) {
    return (
      <div className="shell">
        <div className="setup-note">Supabase が未設定です。webapp/README.md を参照してください。</div>
      </div>
    );
  }
  if (!book) {
    return <div className="shell center site-sub">{status || '読み込み中…'}</div>;
  }

  const renderEditor = (pageIndex: number, sideLabel: string) => {
    const page = book.pages[pageIndex];
    return (
      <div className="spread-col">
        <div className="side-label">{sideLabel}</div>
        {!isEditable(page) ? (
          <div className="empty-page-note">（編集できる文章はありません）</div>
        ) : (
          FIELDS.map((f) =>
            typeof page[f.key] === 'string' ? (
              <label key={f.key} className="field">
                <span className="field-label">{f.label}</span>
                {f.kind === 'textarea' ? (
                  <textarea
                    className="input"
                    value={page[f.key] as string}
                    onChange={(e) => setField(pageIndex, f.key, e.target.value)}
                  />
                ) : (
                  <input
                    className="input"
                    type="text"
                    value={page[f.key] as string}
                    onChange={(e) => setField(pageIndex, f.key, e.target.value)}
                  />
                )}
              </label>
            ) : null
          )
        )}
      </div>
    );
  };

  return (
    <div className="shell">
      <div className="reader-top">
        <button className="mini-link" onClick={() => router.push(`/book/${id}`)}>
          ← 本に戻る
        </button>
        <span className="reader-book-title">データ管理</span>
        <span />
      </div>

      <div className="editor-card">
        <div className="picker-row">
          <span className="picker-label">表示する見開き</span>
          <select
            className="select"
            value={spread}
            onChange={(e) => setSpread(Number(e.target.value))}
          >
            {editableSpreads.map((s) => (
              <option key={s.index} value={s.index}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="spread-row">
          {renderEditor(spread * 2, '左ページ')}
          {renderEditor(spread * 2 + 1, '右ページ')}
        </div>

        <div className="editor-footer">
          <span className="status-line" style={{ flex: 1, marginTop: 0 }}>{status}</span>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
