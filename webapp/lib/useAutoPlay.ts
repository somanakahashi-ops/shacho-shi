'use client';
/* ================================================================
   useAutoPlay ── 自動ページ送り（スライドショー）

   静的版 BookController._toggleAutoPlay/_stopAutoPlay を移植。
   一定間隔で goNext() を呼び続け、最終ページに到達したら自動停止する。
   ================================================================ */
import { useRef, useState } from 'react';

const INTERVAL_MS = 3500; // 1ページ表示する時間（めくり時間込み、静的版と同じ）

interface Options {
    advance: () => void;
    atEnd: () => boolean;
}

export function useAutoPlay({ advance, atEnd }: Options) {
    const [active, setActive] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const optsRef = useRef({ advance, atEnd });
    optsRef.current = { advance, atEnd };

    const stop = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setActive(false);
    };

    const toggle = () => {
        if (timerRef.current) { stop(); return; }
        setActive(true);
        timerRef.current = setInterval(() => {
            const { advance, atEnd } = optsRef.current;
            if (atEnd()) { stop(); return; }
            advance();
        }, INTERVAL_MS);
    };

    return { active, toggle, stop };
}
