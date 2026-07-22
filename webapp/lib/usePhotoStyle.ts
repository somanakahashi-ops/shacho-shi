'use client';
/* ================================================================
   usePhotoStyle ── 写真の留め方（コーナー/画鋲/マステ/テープ）の設定

   静的版 SettingsStore.getPhotoStyle/setPhotoStyle に相当。
   localStorage に保存し、次回も同じ留め方で表示する。
   ================================================================ */
import { useEffect, useState } from 'react';

const KEY = 'jibunshi-photo-style';
const DEFAULT_STYLE = 'corners';

export function usePhotoStyle() {
    const [style, setStyleState] = useState(DEFAULT_STYLE);

    useEffect(() => {
        const saved = localStorage.getItem(KEY);
        if (saved) setStyleState(saved);
    }, []);

    const setStyle = (s: string) => {
        setStyleState(s);
        try { localStorage.setItem(KEY, s); } catch { /* 保存不可でも動作は継続 */ }
    };

    return { style, setStyle };
}
