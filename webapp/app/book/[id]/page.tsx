'use client';
/* ================================================================
   閲覧画面（/book/[id]）
   ── 見開き（左右2ページ）で本を読む。

   静的版 BookController から移植済みの機能:
     ・前へ/次へ・キーボード（←→）
     ・ページめくり音（🔊/🔇と目次内トグル、localStorageに記憶）
     ・目次サイドバー（ハンバーガー→章ジャンプ）
     ・読了プログレスバー（画面最上部の金の線）
     ・しおり（前回読んでいた見開きを本ごとに記憶して再開）
   未移植: めくりアニメーション・TTS・写真・PDF出力
   ================================================================ */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Book, BookPage } from '@/lib/types';
import { useFlipSound } from '@/lib/useFlipSound';
import PageView from '@/components/PageView';
import TocPanel, { buildToc } from '@/components/TocPanel';

const bookmarkKey = (id: string) => `jibunshi-bookmark:${id}`;

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = getSupabase();
  const [book, setBook] = useState<Book | null>(null);
  const [spread, setSpread] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [error, setError] = useState('');
  const sound = useFlipSound();

  useEffect(() => {
    if (!supabase || !id) return;
    supabase
      .from('books')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setError('本が見つかりませんでした。URLをご確認ください。');
          return;
        }
        setBook(data as Book);
        // しおり: 前回の位置から再開
        const saved = Number(localStorage.getItem(bookmarkKey(id)) ?? '0');
        const count = Math.ceil(((data as Book).pages.length || 1) / 2);
        if (saved > 0 && saved < count) setSpread(saved);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // しおり: 位置が変わるたび保存
  useEffect(() => {
    if (!id || !book) return;
    try { localStorage.setItem(bookmarkKey(id), String(spread)); } catch { /* 保存不可でも継続 */ }
  }, [spread, id, book]);

  // 2ページずつ見開きにまとめる（静的版 book-data.js と同じ考え方）
  const pages: (BookPage | null)[] = book ? [...book.pages] : [];
  if (pages.length % 2 === 1) pages.push(null);
  const spreadCount = Math.max(1, pages.length / 2);

  // めくりアニメーション中の状態（null=静止中）
  // from→to へ、dir='fwd'（進む）| 'bwd'（戻る）で1枚めくる
  const [flip, setFlip] = useState<{ from: number; to: number; dir: 'fwd' | 'bwd' } | null>(null);

  // 表示する見開き:
  //   進むめくり中 … 土台は「左=旧い左、右=新しい右」＋右半分の紙が回転
  //   戻るめくり中 … 土台は「左=新しい左、右=旧右」＋左半分の紙が回転
  const baseLeftIdx  = flip ? (flip.dir === 'fwd' ? flip.from : flip.to) : spread;
  const baseRightIdx = flip ? (flip.dir === 'fwd' ? flip.to : flip.from) : spread;
  const left = pages[baseLeftIdx * 2] ?? null;
  const right = pages[baseRightIdx * 2 + 1] ?? null;

  /** 見開き移動（実際に動くときだけ、めくり音＋アニメーション） */
  const moveTo = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(target, 0), spreadCount - 1);
      setSpread((s) => {
        if (next === s || flip) return s; // 端 or めくり中は無視
        sound.play();
        // スマホ（縦積み表示）はアニメーションなしで即切替
        const isNarrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
        if (isNarrow) return next;
        setFlip({ from: s, to: next, dir: next > s ? 'fwd' : 'bwd' });
        return s; // 実際の切替はアニメーション完了時
      });
    },
    // sound.play は ref 経由で常に最新設定を見るため依存に入れなくてよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spreadCount, flip]
  );

  const goTo = useCallback((delta: number) => moveTo(spread + delta), [moveTo, spread]);
  const jumpTo = moveTo;

  /** めくりアニメーション完了 → 見開きを確定 */
  const finishFlip = useCallback(() => {
    if (!flip) return;
    setSpread(flip.to);
    setFlip(null);
  }, [flip]);

  // キーボード操作（← →）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(1);
      if (e.key === 'ArrowLeft') goTo(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo]);

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
  const progress = spreadCount > 1 ? (spread / (spreadCount - 1)) * 100 : 100;

  return (
    <div className="reader-shell">
      {/* 読了プログレスバー */}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* 目次サイドバー */}
      <TocPanel
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        toc={buildToc(book.pages)}
        currentSpread={spread}
        onJump={jumpTo}
        soundEnabled={sound.enabled}
        onToggleSound={sound.setEnabled}
      />

      <div className="reader-top">
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="toc-toggle-btn" onClick={() => setTocOpen(true)} aria-label="目次を開く">
            <span></span><span></span><span></span>
          </button>
          <button className="mini-link" onClick={() => router.push('/')}>← ホーム</button>
        </span>
        <span className="reader-book-title">{book.title}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button
            className="mini-link"
            onClick={() => sound.setEnabled(!sound.enabled)}
            aria-label="ページめくり音の切り替え"
            title="ページめくり音"
          >
            {sound.enabled ? '🔊' : '🔇'}
          </button>
          <button className="mini-link" onClick={() => router.push(`/book/${id}/manage`)}>
            ✎ 編集
          </button>
        </span>
      </div>

      <div className="spread">
        <PageView page={left} side="left" pageNum={pageNumOf(baseLeftIdx * 2)} />
        <PageView page={right} side="right" pageNum={pageNumOf(baseRightIdx * 2 + 1)} />

        {/* めくり中の紙（1枚）。表と裏に別ページを貼って回転させる */}
        {flip && (
          <div className={`flip-sheet ${flip.dir}`} onAnimationEnd={finishFlip}>
            {flip.dir === 'fwd' ? (
              <>
                {/* 表: 今の右ページ / 裏: 次の左ページ */}
                <div className="flip-face flip-front">
                  <PageView page={pages[flip.from * 2 + 1] ?? null} side="right" pageNum={pageNumOf(flip.from * 2 + 1)} />
                </div>
                <div className="flip-face flip-back">
                  <PageView page={pages[flip.to * 2] ?? null} side="left" pageNum={pageNumOf(flip.to * 2)} />
                </div>
              </>
            ) : (
              <>
                {/* 表: 今の左ページ / 裏: 前の右ページ */}
                <div className="flip-face flip-front">
                  <PageView page={pages[flip.from * 2] ?? null} side="left" pageNum={pageNumOf(flip.from * 2)} />
                </div>
                <div className="flip-face flip-back">
                  <PageView page={pages[flip.to * 2 + 1] ?? null} side="right" pageNum={pageNumOf(flip.to * 2 + 1)} />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="reader-controls">
        <button className="btn" onClick={() => goTo(-1)} disabled={spread === 0}>
          ← 前へ
        </button>
        <button className="btn" onClick={() => goTo(1)} disabled={spread >= spreadCount - 1}>
          次へ →
        </button>
      </div>
      <div className="reader-counter">
        見開き {spread + 1} / {spreadCount}
      </div>
    </div>
  );
}
