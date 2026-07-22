'use client';
/* ================================================================
   閲覧画面（/book/[id]）
   ── 本体は BookCanvas（静的版と同じ Canvas 描画エンジン）に委譲。
   このページは「本の読み込み」「TOC・カウンター等の周辺UI」
   「しおり」だけを担当する。

   静的版から移植済みの機能:
     ・前へ/次へ・キーボード（←→）
     ・本物のページめくりアニメーション（PageFlipEffectのカール）
     ・レスポンシブ（PC見開き/スマホ1ページを自動切替、CSSスケール追従）
     ・ページめくり音（🔊/🔇と目次内トグル、localStorageに記憶）
     ・目次サイドバー（ハンバーガー→章ジャンプ）
     ・読了プログレスバー（画面最上部の金の線）
     ・しおり（前回読んでいた見開きを本ごとに記憶して再開）
   未移植: TTS・写真・PDF出力
   ================================================================ */
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { Book } from '@/lib/types';
import { useFlipSound } from '@/lib/useFlipSound';
import { usePhotoStyle } from '@/lib/usePhotoStyle';
import { useTTS } from '@/lib/useTTS';
import { BOOK_CONST } from '@/lib/engine/constants';
import TocPanel, { buildToc } from '@/components/TocPanel';
import BookCanvas, { BookCanvasHandle, BookCanvasState } from '@/components/BookCanvas';

const bookmarkKey = (id: string) => `jibunshi-bookmark:${id}`;

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = getSupabase();
  const [book, setBook] = useState<Book | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const sound = useFlipSound();
  const photoStyle = usePhotoStyle();
  const canvasHandle = useRef<BookCanvasHandle>(null);
  const initialSpreadRef = useRef(0);

  const [viewState, setViewState] = useState<BookCanvasState>({
    isMobile: false,
    currentSpread: 0,
    spreadCount: 1,
    currentPageIdx: 0,
    pageCount: 1,
  });

  const atEnd = () =>
    viewState.isMobile
      ? viewState.currentPageIdx >= viewState.pageCount - 1
      : viewState.currentSpread >= viewState.spreadCount - 1;

  const tts = useTTS({
    getText: () => canvasHandle.current?.getReadText() ?? '',
    advance: () => canvasHandle.current?.goNext(),
    atEnd,
    flipDelayMs: BOOK_CONST.FLIP_MS,
  });

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
        const b = data as Book;
        // しおり: 前回の位置から再開（BookCanvas 初期化前に値だけ確保）
        const saved = Number(localStorage.getItem(bookmarkKey(id)) ?? '0');
        const count = Math.ceil((b.pages.length || 1) / 2);
        if (saved > 0 && saved < count) initialSpreadRef.current = saved;
        setBook({ ...b, images: b.images ?? {} });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // しおり: 見開きが変わるたび保存
  useEffect(() => {
    if (!id || !book) return;
    try {
      localStorage.setItem(bookmarkKey(id), String(viewState.currentSpread));
    } catch {
      /* 保存不可でも継続 */
    }
  }, [viewState.currentSpread, id, book]);

  // キーボード操作（← →）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') canvasHandle.current?.goNext();
      if (e.key === 'ArrowLeft') canvasHandle.current?.goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleExportPdf() {
    if (!book || pdfBusy) return;
    setPdfBusy(true);
    setPdfStatus('準備中…');
    try {
      await canvasHandle.current?.exportPdf(book.title, (current, total) => {
        setPdfStatus(`書き出し中… (${current}/${total})`);
      });
      setPdfStatus('ダウンロードを開始しました');
    } catch {
      setPdfStatus('PDFの作成に失敗しました');
    } finally {
      setPdfBusy(false);
      setTimeout(() => setPdfStatus(''), 4000);
    }
  }

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

  const progress =
    viewState.spreadCount > 1 ? (viewState.currentSpread / (viewState.spreadCount - 1)) * 100 : 100;
  const counterText = viewState.isMobile
    ? `ページ ${viewState.currentPageIdx + 1} / ${viewState.pageCount}`
    : `見開き ${viewState.currentSpread + 1} / ${viewState.spreadCount}`;

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
        currentSpread={viewState.currentSpread}
        onJump={(idx) => canvasHandle.current?.jumpToSpread(idx)}
        soundEnabled={sound.enabled}
        onToggleSound={sound.setEnabled}
        photoStyle={photoStyle.style}
        onPhotoStyleChange={photoStyle.setStyle}
        voicePref={tts.voicePref}
        onVoicePrefChange={tts.setVoicePref}
        onExportPdf={handleExportPdf}
        pdfBusy={pdfBusy}
        pdfStatus={pdfStatus}
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
          <button className="mini-link" onClick={tts.toggle} title="読み上げ">
            {tts.active ? '⏹' : '📖'}
          </button>
          <button className="mini-link" onClick={() => router.push(`/book/${id}/manage`)}>
            ✎ 編集
          </button>
        </span>
      </div>

      <div className="canvas-shell">
        <BookCanvas
          ref={canvasHandle}
          pages={book.pages}
          images={book.images}
          photoStyle={photoStyle.style}
          onStateChange={setViewState}
          onFlipStart={sound.play}
        />
      </div>

      <div className="reader-controls">
        <button
          className="btn"
          onClick={() => canvasHandle.current?.goPrev()}
          disabled={viewState.isMobile ? viewState.currentPageIdx === 0 : viewState.currentSpread === 0}
        >
          ← 前へ
        </button>
        <button
          className="btn"
          onClick={() => canvasHandle.current?.goNext()}
          disabled={
            viewState.isMobile
              ? viewState.currentPageIdx >= viewState.pageCount - 1
              : viewState.currentSpread >= viewState.spreadCount - 1
          }
        >
          次へ →
        </button>
      </div>
      <div className="reader-counter">{counterText}</div>
    </div>
  );
}
