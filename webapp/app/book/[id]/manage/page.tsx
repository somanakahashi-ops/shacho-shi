'use client';
/* ================================================================
   編集画面（/book/[id]/manage）
   ── 文章タブ: 見開き（左右2ページ）単位で文章を編集して保存する。
   ── 画像タブ: 見開き（表紙を除く）ごとに写真を1枚追加/差し替え/削除。

   静的版の DataManager と同じUX:
     ・プルダウンで編集する見開きを選ぶ（1見開きだけ表示）
     ・左ページ｜右ページ を並べ、各フィールドを編集
     ・「保存」で Supabase に反映（読む側は再読み込みで反映）
   ================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Book, BookPage } from '@/lib/types';
import { resizeImageFile } from '@/lib/imageResize';

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
  const [tab, setTab] = useState<'text' | 'photo'>('text');
  const [spread, setSpread] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingSpread, setUploadingSpread] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase || !id) return;
    supabase
      .from('books')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setStatus('本が見つかりませんでした。');
        else {
          const b = data as Book;
          setBook({ ...b, images: b.images ?? {} });
        }
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

  // 画像タブで並べる見開き一覧（表紙＝見開き0は対象外。静的版と同じ）
  const photoSpreads = useMemo(() => {
    if (!book) return [];
    const count = Math.ceil(book.pages.length / 2);
    const out: { index: number; label: string }[] = [];
    for (let i = 1; i < count; i++) {
      const l = book.pages[i * 2];
      const r = book.pages[i * 2 + 1];
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

  async function saveBook(next: Book, successMsg: string) {
    if (!supabase) return;
    setBusy(true);
    setStatus('保存中…');
    const title = next.pages[0]?.title || next.title;
    const { error } = await supabase
      .from('books')
      .update({ title, pages: next.pages, images: next.images, updated_at: new Date().toISOString() })
      .eq('id', next.id);
    setBusy(false);
    setStatus(error ? '保存に失敗しました: ' + error.message : successMsg);
  }

  async function save() {
    if (!book) return;
    await saveBook(book, '保存しました');
  }

  /** 画像タブ: ファイルを選んだらその場でリサイズ→保存まで行う */
  async function handlePhotoChange(spreadIndex: number, file: File | null) {
    if (!book || !file) return;
    setUploadingSpread(spreadIndex);
    try {
      const dataUrl = await resizeImageFile(file);
      const next: Book = { ...book, images: { ...book.images, [spreadIndex]: dataUrl } };
      setBook(next);
      await saveBook(next, `見開き ${spreadIndex + 1} の画像を保存しました`);
    } catch {
      setStatus('画像の読み込みに失敗しました');
    } finally {
      setUploadingSpread(null);
    }
  }

  async function handlePhotoRemove(spreadIndex: number) {
    if (!book) return;
    if (!window.confirm(`見開き ${spreadIndex + 1} の画像を削除しますか？`)) return;
    const images = { ...book.images };
    delete images[spreadIndex];
    const next: Book = { ...book, images };
    setBook(next);
    await saveBook(next, `見開き ${spreadIndex + 1} の画像を削除しました`);
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

      <div className="tabs">
        <button className={`tab ${tab === 'text' ? 'active' : ''}`} onClick={() => setTab('text')}>
          📝 文章
        </button>
        <button className={`tab ${tab === 'photo' ? 'active' : ''}`} onClick={() => setTab('photo')}>
          🖼 画像
        </button>
      </div>

      {tab === 'text' ? (
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
      ) : (
        <div className="editor-card">
          <p className="site-sub" style={{ marginBottom: 20 }}>
            画像は各見開きの「左ページ」に表示されます（表紙を除く）。
          </p>
          <div className="photo-list">
            {photoSpreads.map((s) => {
              const dataUrl = book.images[s.index];
              const uploading = uploadingSpread === s.index;
              return (
                <div key={s.index} className="photo-row">
                  <span className="photo-label">{s.label}</span>
                  <div className="photo-thumb">
                    {dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={dataUrl} alt="" />
                    ) : (
                      <span className="photo-empty">画像なし</span>
                    )}
                  </div>
                  <div className="photo-actions">
                    <label className="btn-mini">
                      {uploading ? '処理中…' : dataUrl ? '差し替え' : '追加'}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={uploading}
                        onChange={(e) => handlePhotoChange(s.index, e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {dataUrl && (
                      <button className="btn-mini btn-mini-danger" onClick={() => handlePhotoRemove(s.index)}>
                        削除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="editor-footer">
            <span className="status-line" style={{ flex: 1, marginTop: 0 }}>{status}</span>
          </div>
        </div>
      )}
    </div>
  );
}
