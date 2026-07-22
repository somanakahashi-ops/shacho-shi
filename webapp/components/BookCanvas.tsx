'use client';
/* ================================================================
   BookCanvas ── 静的版の描画エンジンをそのまま使う Canvas コンポーネント

   静的版（docs/js/BookController.js）の responsive・めくりアニメーション
   ロジックを、React の世界に合わせて移植したもの。
   実際の描画・カール計算・フレーム合成は webapp/lib/engine/ 配下の
   クラス（PageContentRenderer / PageFlipEffect / BookRenderer /
   BookAnimator）がそのまま担当する＝静的版と完全に同じ見た目になる。

   このコンポーネントの責務:
     ・エンジンのインスタンスを1回だけ作る（useRef）
     ・PC/モバイルの判定とCanvasのCSS表示サイズ調整（レスポンシブ）
     ・goNext/goPrev/jumpToSpread を ref 経由で親に公開する
     ・状態が変わるたび onStateChange で親（カウンター・進捗バー・
       目次のハイライト）に通知する
   ================================================================ */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { BOOK_CONST } from '@/lib/engine/constants';
import { PageContentRenderer } from '@/lib/engine/PageContentRenderer';
import { PageFlipEffect } from '@/lib/engine/PageFlipEffect';
import { BookRenderer } from '@/lib/engine/BookRenderer';
import { BookAnimator } from '@/lib/engine/BookAnimator';
import { loadImageFromSrc } from '@/lib/engine/util';
import { buildSpreadData } from '@/lib/buildSpreads';
import { BookPage } from '@/lib/types';

export interface BookCanvasState {
  isMobile: boolean;
  currentSpread: number;
  spreadCount: number;
  currentPageIdx: number;
  pageCount: number;
}

export interface BookCanvasHandle {
  goNext: () => void;
  goPrev: () => void;
  jumpToSpread: (spreadIndex: number) => void;
  /** 現在表示中のページ/見開きの読み上げテキストを返す（TTS用） */
  getReadText: () => string;
}

interface Props {
  pages: BookPage[];
  images?: Record<number, string>; // 見開きindex → 画像データURL（左ページに重ねる）
  photoStyle?: string; // 'corners' | 'pushpin' | 'maskingtape' | 'tape'
  onStateChange: (s: BookCanvasState) => void;
  onFlipStart?: () => void; // 実際に移動が起きる瞬間に呼ぶ（めくり音用）
}

const BookCanvas = forwardRef<BookCanvasHandle, Props>(function BookCanvas(
  { pages, images, photoStyle, onStateChange, onFlipStart },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<{
    contentRenderer: InstanceType<typeof PageContentRenderer>;
    flipEffect: InstanceType<typeof PageFlipEffect>;
    bookRenderer: InstanceType<typeof BookRenderer>;
    animator: InstanceType<typeof BookAnimator>;
  } | null>(null);

  const isMobileRef = useRef(false);
  const currentSpreadRef = useRef(0);
  const currentPageIdxRef = useRef(0);
  // 見開きindex → 読み込み済み Image。静的版と同じく左ページにのみ重ねる。
  const imageCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());

  const notify = () => {
    const eng = engineRef.current;
    if (!eng) return;
    onStateChange({
      isMobile: isMobileRef.current,
      currentSpread: currentSpreadRef.current,
      spreadCount: eng.contentRenderer.spreads.length,
      currentPageIdx: currentPageIdxRef.current,
      pageCount: eng.contentRenderer.pages.length,
    });
  };

  const render = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const animState = eng.animator.state;
    if (isMobileRef.current) {
      // 画像は見開きの「左ページ」＝偶数ページのときだけ重ねる
      const isLeftPage = currentPageIdxRef.current % 2 === 0;
      const pageImage = isLeftPage
        ? imageCacheRef.current.get(currentPageIdxRef.current / 2) ?? null
        : null;
      eng.bookRenderer.renderMobile(
        animState,
        eng.contentRenderer.pages,
        currentPageIdxRef.current,
        pageImage
      );
    } else {
      const leftImage = imageCacheRef.current.get(currentSpreadRef.current) ?? null;
      eng.bookRenderer.renderPC(
        animState,
        eng.contentRenderer.spreads,
        currentSpreadRef.current,
        pcNextIdxRef.current,
        leftImage
      );
    }
  };
  const pcNextIdxRef = useRef(0);

  /** Canvas の CSS 表示サイズを画面幅に合わせる（描画解像度は変えない） */
  const applyCssScale = (drawW: number, drawH: number, margin: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = Math.min(window.innerWidth - margin, drawW);
    canvas.style.width = cssW + 'px';
    canvas.style.height = (drawH * cssW) / drawW + 'px';
  };

  /** PC/モバイルの切り替え（初回・リサイズでモードが変わったとき） */
  const applyMode = (newMobile: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const modeChanged = newMobile !== isMobileRef.current;
    isMobileRef.current = newMobile;
    const { PC_W, PC_H, MOB_W, MOB_H } = BOOK_CONST;

    if (newMobile) {
      canvas.width = MOB_W;
      canvas.height = MOB_H;
      applyCssScale(MOB_W, MOB_H, 20);
      if (modeChanged) currentPageIdxRef.current = currentSpreadRef.current * 2;
    } else {
      canvas.width = PC_W;
      canvas.height = PC_H;
      applyCssScale(PC_W, PC_H, 40);
      if (modeChanged) currentSpreadRef.current = Math.floor(currentPageIdxRef.current / 2);
    }
  };

  const handleResize = () => {
    const eng = engineRef.current;
    if (!eng || eng.animator.state.isAnimating) return;
    const shouldMobile = window.innerWidth < BOOK_CONST.BREAKPOINT;
    if (shouldMobile !== isMobileRef.current) {
      applyMode(shouldMobile);
      render();
      notify();
    } else {
      const { PC_W, PC_H, MOB_W, MOB_H } = BOOK_CONST;
      applyCssScale(
        isMobileRef.current ? MOB_W : PC_W,
        isMobileRef.current ? MOB_H : PC_H,
        isMobileRef.current ? 20 : 40
      );
    }
  };

  // ── 初期化（1回だけ） ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const contentRenderer = new PageContentRenderer(buildSpreadData(pages), BOOK_CONST);
    const flipEffect = new PageFlipEffect(ctx, BOOK_CONST);
    const bookRenderer = new BookRenderer(ctx, BOOK_CONST, contentRenderer, flipEffect);
    const animator = new BookAnimator(BOOK_CONST, contentRenderer);
    engineRef.current = { contentRenderer, flipEffect, bookRenderer, animator };

    applyMode(window.innerWidth < BOOK_CONST.BREAKPOINT);
    render();
    notify();

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
    // pages は初回マウント時点のものだけを使う（編集は別画面で行うため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画像の先読み。images が変わるたび（初回表示・編集からの帰還時など）
  // 読み込み直し、完了した分から順に再描画する。
  useEffect(() => {
    if (!images) return;
    let cancelled = false;
    Object.entries(images).forEach(([key, dataUrl]) => {
      const idx = Number(key);
      loadImageFromSrc(dataUrl).then((img: HTMLImageElement) => {
        if (cancelled) return;
        imageCacheRef.current.set(idx, img);
        render();
      }).catch(() => { /* 読み込み失敗時は画像なしのまま表示を続ける */ });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // 写真の留め方（コーナー/画鋲/マステ/テープ）。変更のたび再描画する。
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !photoStyle) return;
    eng.contentRenderer.photoStyle = photoStyle;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoStyle]);

  const goNext = () => {
    const eng = engineRef.current;
    if (!eng || eng.animator.state.isAnimating || eng.animator.state.dragging) return;

    if (isMobileRef.current) {
      const p = eng.contentRenderer.pages;
      if (currentPageIdxRef.current < p.length - 1) {
        const toIdx = currentPageIdxRef.current + 1;
        onFlipStart?.();
        eng.animator.startFlipMobile(
          p,
          currentPageIdxRef.current,
          toIdx,
          render,
          (finishedIdx: number) => {
            currentPageIdxRef.current = finishedIdx;
            currentSpreadRef.current = Math.floor(finishedIdx / 2);
            render();
            notify();
          }
        );
      }
    } else {
      const s = eng.contentRenderer.spreads;
      if (currentSpreadRef.current < s.length - 1) {
        const toIdx = currentSpreadRef.current + 1;
        pcNextIdxRef.current = toIdx;
        onFlipStart?.();
        eng.animator.startFlipPC(
          s,
          currentSpreadRef.current,
          toIdx,
          render,
          (finishedIdx: number) => {
            currentSpreadRef.current = finishedIdx;
            currentPageIdxRef.current = finishedIdx * 2;
            render();
            notify();
          }
        );
      }
    }
  };

  const goPrev = () => {
    const eng = engineRef.current;
    if (!eng || eng.animator.state.isAnimating || eng.animator.state.dragging) return;

    if (isMobileRef.current) {
      const p = eng.contentRenderer.pages;
      if (currentPageIdxRef.current > 0) {
        const toIdx = currentPageIdxRef.current - 1;
        onFlipStart?.();
        eng.animator.startFlipMobile(
          p,
          currentPageIdxRef.current,
          toIdx,
          render,
          (finishedIdx: number) => {
            currentPageIdxRef.current = finishedIdx;
            currentSpreadRef.current = Math.floor(finishedIdx / 2);
            render();
            notify();
          },
          true
        );
      }
    } else {
      if (currentSpreadRef.current > 0) {
        const toIdx = currentSpreadRef.current - 1;
        pcNextIdxRef.current = toIdx;
        onFlipStart?.();
        eng.animator.startFlipPC(
          eng.contentRenderer.spreads,
          currentSpreadRef.current,
          toIdx,
          render,
          (finishedIdx: number) => {
            currentSpreadRef.current = finishedIdx;
            currentPageIdxRef.current = finishedIdx * 2;
            render();
            notify();
          },
          true
        );
      }
    }
  };

  /** 目次からのジャンプ（アニメーションなしで即座に切り替え） */
  const jumpToSpread = (spreadIndex: number) => {
    const eng = engineRef.current;
    if (!eng || eng.animator.state.isAnimating || eng.animator.state.dragging) return;
    const count = eng.contentRenderer.spreads.length;
    const next = Math.min(Math.max(spreadIndex, 0), count - 1);
    if (next === currentSpreadRef.current) return;
    onFlipStart?.();
    currentSpreadRef.current = next;
    currentPageIdxRef.current = next * 2;
    render();
    notify();
  };

  /** 静的版 PageContentRenderer.getSpreadReadText/getPageReadTextByIndex を利用 */
  const getReadText = () => {
    const eng = engineRef.current;
    if (!eng) return '';
    return isMobileRef.current
      ? eng.contentRenderer.getPageReadTextByIndex(currentPageIdxRef.current)
      : eng.contentRenderer.getSpreadReadText(currentSpreadRef.current);
  };

  useImperativeHandle(ref, () => ({ goNext, goPrev, jumpToSpread, getReadText }));

  // ── スワイプ（ドラッグ）でのページめくり。スマホのみ。──
  // 静的版 BookController._bindSwipeGesture と同じロジック:
  //   touchstart → beginDrag()
  //   touchmove  → updateDragProgress(deltaX)（rAFで1フレームに間引く）
  //   touchend   → endDrag() で確定/キャンセルを判定し、残りを自動補完
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let startX: number | null = null;
    let dragActive = false;
    let pendingDeltaX: number | null = null;
    let renderScheduled = false;

    const scheduleRender = (deltaX: number) => {
      pendingDeltaX = deltaX;
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderScheduled = false;
        const eng = engineRef.current;
        if (pendingDeltaX === null || !dragActive || !eng) return;
        eng.animator.updateDragProgress(pendingDeltaX);
        render();
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      const eng = engineRef.current;
      // スマホのみ対応（PCはボタン/キーボードでの操作のまま）
      if (!eng || !isMobileRef.current) return;
      const started = eng.animator.beginDrag(
        eng.contentRenderer.pages,
        currentPageIdxRef.current,
        true
      );
      if (!started) return;
      startX = e.touches[0].clientX;
      dragActive = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragActive || startX === null) return;
      e.preventDefault(); // ページ全体のスクロールを止める
      scheduleRender(e.touches[0].clientX - startX);
    };

    const onTouchEnd = () => {
      const eng = engineRef.current;
      if (!dragActive || !eng) return;

      if (pendingDeltaX !== null) {
        eng.animator.updateDragProgress(pendingDeltaX);
        pendingDeltaX = null;
      }
      dragActive = false;
      startX = null;

      eng.animator.endDrag(
        render,
        (finishedIdx: number) => {
          // 確定: ページ送りが実際に起きた
          currentPageIdxRef.current = finishedIdx;
          currentSpreadRef.current = Math.floor(finishedIdx / 2);
          render();
          notify();
        },
        () => {
          // キャンセル: 位置は変わらないが元の見た目に戻すため再描画
          render();
          notify();
        },
        () => {
          // 確定が決まった瞬間（残りの自動補完アニメーションの前）に
          // 呼ばれる。ボタン操作と揃うタイミングでめくり音を鳴らす。
          onFlipStart?.();
        }
      );
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="book-canvas" />;
});

export default BookCanvas;
