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
     ・ドラッグ（スマホはタッチ、PC/スマホ問わずマウス）でのページめくり
     ・目次から遠くへジャンプするときのパラパラめくり（リフル）演出
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
import { exportBookToPdf } from '@/lib/pdfExport';
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
  /** 全ページをPDFに変換してダウンロードする */
  exportPdf: (title: string, onProgress?: (current: number, total: number) => void) => Promise<void>;
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

  /**
   * 複数ページ/見開きを「ひとまとめに」めくるパラパラめくり（リフル）。
   * 静的版 BookController._runFlutter の移植。常に「小さいインデックス
   * lo → 大きいインデックス hi」へ進む順方向リフルとして実装し、
   * 後ろへ戻るときは時間を逆回しして同じロジックを再利用する。
   */
  const runFlutter = (targetIdx: number): Promise<void> => {
    return new Promise((resolve) => {
      const eng = engineRef.current;
      if (!eng) { resolve(); return; }
      const isMobile = isMobileRef.current;
      const startIdx = isMobile ? currentPageIdxRef.current : currentSpreadRef.current;
      if (targetIdx === startIdx) { resolve(); return; }

      const forward = targetIdx > startIdx;
      const loIdx = Math.min(startIdx, targetIdx);
      const hiIdx = Math.max(startIdx, targetIdx);
      const N = hiIdx - loIdx;
      const cr = eng.contentRenderer;

      const fronts: HTMLCanvasElement[] = [];
      const backs: HTMLCanvasElement[] = [];
      for (let k = 0; k < N; k++) {
        const i = loIdx + k;
        if (isMobile) {
          const pg = cr.pages[i];
          fronts.push(cr.preRenderPage(pg.fn, pg.isRight));
        } else {
          fronts.push(cr.preRenderPage(cr.spreads[i].right, true));
          backs.push(cr.preRenderPage(cr.spreads[i + 1].left, false));
        }
      }

      const C = BOOK_CONST;
      let sheetMs = C.FLUTTER_SHEET_MS;
      let stagger = C.FLUTTER_STAGGER_MS;
      let total = stagger * (N - 1) + sheetMs;
      if (total > C.FLUTTER_MAX_MS) {
        const s = C.FLUTTER_MAX_MS / total;
        sheetMs *= s; stagger *= s; total = C.FLUTTER_MAX_MS;
      }

      eng.animator.state.isAnimating = true;
      const t0 = performance.now();
      onFlipStart?.();
      let soundsPlayed = 1;
      const soundCap = Math.min(N, 8);

      const frame = (now: number) => {
        const elapsed = Math.min(now - t0, total);
        const tau = forward ? elapsed : total - elapsed;
        const tk = (k: number) => {
          const v = (tau - k * stagger) / sheetMs;
          return v < 0 ? 0 : v > 1 ? 1 : v;
        };

        let landedMax = -1;
        for (let k = N - 1; k >= 0; k--) { if (tk(k) >= 1) { landedMax = k; break; } }
        let m = -1;
        for (let k = 0; k < N; k++) { if (tk(k) <= 0) { m = k; break; } }

        if (isMobile) {
          const basePage = cr.preRenderPage(cr.pages[hiIdx].fn, cr.pages[hiIdx].isRight);
          const pileTop = m >= 0 ? cr.preRenderPage(cr.pages[loIdx + m].fn, cr.pages[loIdx + m].isRight) : null;
          const curls: { t: number; front: HTMLCanvasElement }[] = [];
          for (let k = N - 1; k >= 0; k--) {
            const t = tk(k);
            if (t > 0 && t < 1) curls.push({ t, front: fronts[k] });
          }
          eng.bookRenderer.renderFlutterMobile(basePage, pileTop, curls);
        } else {
          const spreads = cr.spreads;
          const leftBaseImg = cr.preRenderPage(spreads[loIdx + landedMax + 1].left, false);
          const rightBaseImg = cr.preRenderPage(spreads[hiIdx].right, true);
          const pileTopImg = m >= 0 ? cr.preRenderPage(spreads[loIdx + m].right, true) : null;
          const curls: { t: number; front: HTMLCanvasElement; back: HTMLCanvasElement; reverse: boolean }[] = [];
          for (let k = 0; k < N; k++) {
            const t = tk(k);
            if (t > 0 && t < 1) curls.push({ t, front: fronts[k], back: backs[k], reverse: false });
          }
          curls.sort((a, b) => Math.abs(b.t - 0.5) - Math.abs(a.t - 0.5));
          eng.bookRenderer.renderFlutterPC(leftBaseImg, rightBaseImg, pileTopImg, curls);
        }

        const wantSounds = Math.min(soundCap, 1 + Math.floor((elapsed / total) * soundCap));
        while (soundsPlayed < wantSounds) { onFlipStart?.(); soundsPlayed++; }

        if (elapsed >= total) {
          eng.animator.state.isAnimating = false;
          currentPageIdxRef.current = isMobile ? targetIdx : targetIdx * 2;
          currentSpreadRef.current = isMobile ? Math.floor(targetIdx / 2) : targetIdx;
          render();
          notify();
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    });
  };

  /**
   * 目次からのジャンプ。近ければ即切り替え、FLUTTER_THRESHOLD以上
   * 離れていればパラパラめくり（リフル）でひとまとめにめくる。
   */
  const jumpToSpread = (spreadIndex: number) => {
    const eng = engineRef.current;
    if (!eng || eng.animator.state.isAnimating || eng.animator.state.dragging) return;
    const count = eng.contentRenderer.spreads.length;
    const next = Math.min(Math.max(spreadIndex, 0), count - 1);

    if (isMobileRef.current) {
      const targetPageIdx = next * 2;
      const distance = Math.abs(targetPageIdx - currentPageIdxRef.current);
      if (distance === 0) return;
      if (distance >= BOOK_CONST.FLUTTER_THRESHOLD) { runFlutter(targetPageIdx); return; }
      onFlipStart?.();
      currentPageIdxRef.current = targetPageIdx;
      currentSpreadRef.current = next;
      render();
      notify();
    } else {
      const distance = Math.abs(next - currentSpreadRef.current);
      if (distance === 0) return;
      if (distance >= BOOK_CONST.FLUTTER_THRESHOLD) { runFlutter(next); return; }
      onFlipStart?.();
      currentSpreadRef.current = next;
      currentPageIdxRef.current = next * 2;
      render();
      notify();
    }
  };

  /** 静的版 PageContentRenderer.getSpreadReadText/getPageReadTextByIndex を利用 */
  const getReadText = () => {
    const eng = engineRef.current;
    if (!eng) return '';
    return isMobileRef.current
      ? eng.contentRenderer.getPageReadTextByIndex(currentPageIdxRef.current)
      : eng.contentRenderer.getSpreadReadText(currentSpreadRef.current);
  };

  const exportPdf = async (title: string, onProgress?: (current: number, total: number) => void) => {
    const eng = engineRef.current;
    if (!eng) return;
    await exportBookToPdf(eng.contentRenderer, title, onProgress);
  };

  useImperativeHandle(ref, () => ({ goNext, goPrev, jumpToSpread, getReadText, exportPdf }));

  // ── ドラッグ（スワイプ/マウス）でのページめくり。──
  // 静的版 BookController._bindSwipeGesture と同じロジック:
  //   start → beginDrag()
  //   move  → updateDragProgress(deltaX)（rAFで1フレームに間引く）
  //   end   → endDrag() で確定/キャンセルを判定し、残りを自動補完
  // タッチはスマホのみ、マウスはPC/スマホ問わず有効（静的版と同じ）。
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

    const onStart = (clientX: number) => {
      const eng = engineRef.current;
      if (!eng) return;
      const items = isMobileRef.current ? eng.contentRenderer.pages : eng.contentRenderer.spreads;
      const currentIdx = isMobileRef.current ? currentPageIdxRef.current : currentSpreadRef.current;
      const started = eng.animator.beginDrag(items, currentIdx, isMobileRef.current);
      if (!started) return;
      startX = clientX;
      dragActive = true;
    };

    const onMove = (clientX: number) => {
      if (!dragActive || startX === null) return;
      scheduleRender(clientX - startX);
    };

    const onEnd = () => {
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
          if (isMobileRef.current) {
            currentPageIdxRef.current = finishedIdx;
            currentSpreadRef.current = Math.floor(finishedIdx / 2);
          } else {
            currentSpreadRef.current = finishedIdx;
            currentPageIdxRef.current = finishedIdx * 2;
          }
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

    // ── タッチイベント（スマホのみ） ──
    const onTouchStart = (e: TouchEvent) => {
      if (!isMobileRef.current) return;
      onStart(e.touches[0].clientX);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragActive) return;
      e.preventDefault(); // ページ全体のスクロールを止める
      onMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => onEnd();

    // ── マウスイベント（PC/スマホ問わず有効。動作確認用も兼ねる） ──
    const onMouseDown = (e: MouseEvent) => onStart(e.clientX);
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onMouseUp = () => onEnd();

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="book-canvas" />;
});

export default BookCanvas;
