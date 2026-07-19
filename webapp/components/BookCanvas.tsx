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
}

interface Props {
  pages: BookPage[];
  onStateChange: (s: BookCanvasState) => void;
  onFlipStart?: () => void; // 実際に移動が起きる瞬間に呼ぶ（めくり音用）
}

const BookCanvas = forwardRef<BookCanvasHandle, Props>(function BookCanvas(
  { pages, onStateChange, onFlipStart },
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
      eng.bookRenderer.renderMobile(
        animState,
        eng.contentRenderer.pages,
        currentPageIdxRef.current,
        null // 画像オーバーレイは未対応（後続で移植）
      );
    } else {
      eng.bookRenderer.renderPC(
        animState,
        eng.contentRenderer.spreads,
        currentSpreadRef.current,
        pcNextIdxRef.current,
        null
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

  useImperativeHandle(ref, () => ({ goNext, goPrev, jumpToSpread }));

  return <canvas ref={canvasRef} className="book-canvas" />;
});

export default BookCanvas;
