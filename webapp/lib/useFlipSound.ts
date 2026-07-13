'use client';
/* ================================================================
   useFlipSound ── ページめくり音のフック

   静的版の AudioPlayer（docs/js/AudioPlayer.js）に相当。
   ・音源は /rustling.mp3（public/ に配置。静的版と同じ効果音）
   ・ON/OFF は localStorage に保存して次回も覚えている
   ・連打時は再生位置を先頭に戻して鳴らし直す
   ================================================================ */
import { useEffect, useRef, useState } from 'react';

const SOUND_KEY = 'jibunshi-sound-enabled'; // '1' | '0'

export function useFlipSound() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const enabledRef = useRef(true);
    const [enabled, setEnabledState] = useState(true);

    // 保存済みの ON/OFF を復元
    useEffect(() => {
        const saved = localStorage.getItem(SOUND_KEY);
        if (saved !== null) {
            enabledRef.current = saved === '1';
            setEnabledState(saved === '1');
        }
    }, []);

    const setEnabled = (on: boolean) => {
        enabledRef.current = on;
        setEnabledState(on);
        try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* 保存不可でも動作は継続 */ }
    };

    const play = () => {
        if (!enabledRef.current) return;
        if (!audioRef.current) audioRef.current = new Audio('/rustling.mp3');
        const a = audioRef.current;
        a.currentTime = 0;
        // 自動再生制限などで失敗しても無視（音はあくまで演出）
        a.play().catch(() => {});
    };

    return { play, enabled, setEnabled };
}
