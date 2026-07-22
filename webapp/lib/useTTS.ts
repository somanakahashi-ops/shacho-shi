'use client';
/* ================================================================
   useTTS ── 読み上げ（Web Speech API）の状態管理フック

   静的版 BookController の _toggleTTS/_speakCurrent/_advanceForTTS/
   _stopTTS を移植したもの。事前生成音声（Kokoro等）は使わず、
   ブラウザ内蔵の音声合成のみを使う（webapp では未導入のため）。

   使い方:
     const tts = useTTS({
       getText: () => canvasHandle.current!.getReadText(),
       advance: () => canvasHandle.current!.goNext(),  // 次へ進める
       atEnd:   () => viewState.isMobile ? ... : ...,  // これ以上進めないか
       flipDelayMs: BOOK_CONST.FLIP_MS,
     });
     <button onClick={tts.toggle}>{tts.active ? '⏹ 読み上げ停止' : '🔊 読み上げ'}</button>
   ================================================================ */
import { useEffect, useRef, useState } from 'react';
import { resolveVoice, VoicePref } from './ttsVoice';

const VOICE_PREF_KEY = 'jibunshi-tts-voice-pref';

interface Options {
    getText: () => string;
    advance: () => void; // 次のページ/見開きへ進める（アニメーション付き）
    atEnd: () => boolean; // これ以上進められないか
    flipDelayMs: number; // ページめくりの完了を待つ時間
}

export function useTTS({ getText, advance, atEnd, flipDelayMs }: Options) {
    const [active, setActive] = useState(false);
    const [voicePref, setVoicePrefState] = useState<VoicePref>('female');
    const activeRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 再生の連鎖（onend→advance→setTimeout→speakCurrent…）は非同期にまたがるため、
    // 呼び出し時点で古いレンダーのクロージャを掴まないよう、常に最新の
    // getText/advance/atEnd を ref 経由で参照する。
    const optsRef = useRef({ getText, advance, atEnd, flipDelayMs });
    optsRef.current = { getText, advance, atEnd, flipDelayMs };

    useEffect(() => {
        const saved = localStorage.getItem(VOICE_PREF_KEY) as VoicePref | null;
        if (saved === 'female' || saved === 'male' || saved === 'auto') setVoicePrefState(saved);
    }, []);

    const setVoicePref = (prefRaw: string) => {
        const pref = (prefRaw === 'male' || prefRaw === 'auto' ? prefRaw : 'female') as VoicePref;
        setVoicePrefState(pref);
        try { localStorage.setItem(VOICE_PREF_KEY, pref); } catch { /* 保存不可でも継続 */ }
        // 読み上げ中なら選んだ声で今のページから読み直す
        if (activeRef.current) {
            window.speechSynthesis?.cancel();
            speakCurrent(pref);
        }
    };

    const stop = () => {
        activeRef.current = false;
        setActive(false);
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        window.speechSynthesis?.cancel();
    };

    const speakCurrent = (prefOverride?: VoicePref) => {
        if (!activeRef.current) return;
        const { getText, advance, atEnd, flipDelayMs } = optsRef.current;
        const text = getText();

        if (!text) {
            if (atEnd()) { stop(); return; }
            advance();
            timerRef.current = setTimeout(() => speakCurrent(prefOverride), flipDelayMs + 200);
            return;
        }

        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        u.rate = 1.0;
        const voice = resolveVoice(prefOverride ?? voicePref);
        if (voice) u.voice = voice;
        u.onend = () => {
            if (!activeRef.current) return;
            const { advance, atEnd, flipDelayMs } = optsRef.current;
            if (atEnd()) { stop(); return; }
            advance();
            timerRef.current = setTimeout(() => speakCurrent(), flipDelayMs + 200);
        };
        u.onerror = () => { /* 中断時など。状態はトグルで管理しているので無視 */ };
        window.speechSynthesis.speak(u);
    };

    const toggle = () => {
        if (activeRef.current) { stop(); return; }
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            alert('お使いのブラウザは読み上げ（音声合成）に対応していません。');
            return;
        }
        activeRef.current = true;
        setActive(true);
        speakCurrent();
    };

    // アンマウント時に読み上げを止める
    useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

    return { active, toggle, stop, voicePref, setVoicePref };
}
