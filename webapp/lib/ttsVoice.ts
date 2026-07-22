/* ================================================================
   ttsVoice ── 読み上げの声（女性/男性/自動）の解決ロジック

   静的版 BookController の _jaVoices/_resolveVoice/_scoreVoice/
   _guessVoiceGender をそのまま移植したもの。
   環境（ブラウザ/OS）で使える日本語音声の中から、Natural/Neural/
   Wavenet などの高品質モデルを性別ごとに自動で選ぶ。
   ================================================================ */

export type VoicePref = 'female' | 'male' | 'auto';

/** この環境で使える日本語音声の一覧 */
export function jaVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined' || !window.speechSynthesis) return [];
    return window.speechSynthesis.getVoices().filter((v) => /^ja(-|_|$)/i.test(v.lang));
}

/** 声の名前から性別を推測する（確信が持てないときは ''） */
export function guessVoiceGender(name: string): 'female' | 'male' | '' {
    const n = (name || '').toLowerCase();
    const female = ['nanami', 'ayumi', 'haruka', 'sayaka', 'kyoko', 'o-ren', 'oren',
        'mizuki', 'ichika', 'sara', 'female', '女性', '女'];
    const male = ['keita', 'ichiro', 'otoya', 'hattori', 'daichi', 'male', '男性', '男'];
    if (female.some((k) => n.includes(k))) return 'female';
    if (male.some((k) => n.includes(k))) return 'male';

    // Android/Google の命名規則（ja-JP-Standard/Wavenet/Neural2-A…）:
    //   末尾 A・B は女性、C・D は男性、というのが Google の慣例。
    const g = n.match(/ja[-_]jp[-_](?:standard|wavenet|neural2?)[-_]([a-d])/);
    if (g) return g[1] === 'a' || g[1] === 'b' ? 'female' : 'male';
    return '';
}

/** 音声に点数を付ける。高品質モデルほど高得点。反対の性別は除外。 */
function scoreVoice(v: SpeechSynthesisVoice, pref: VoicePref): number {
    const n = (v.name || '').toLowerCase();
    let score = 0;
    const quality: [string, number][] = [
        ['natural', 100], ['neural', 90], ['wavenet', 85],
        ['premium', 80], ['enhanced', 60], ['online', 30],
    ];
    quality.forEach(([k, pts]) => { if (n.includes(k)) score += pts; });

    const known = ['nanami', 'keita', 'kyoko', 'otoya', 'o-ren', 'haruka'];
    if (known.some((k) => n.includes(k))) score += 20;

    if (pref === 'female' || pref === 'male') {
        const g = guessVoiceGender(v.name);
        if (g === pref) score += 500;
        else if (g && g !== pref) return -Infinity;
    }
    return score;
}

/** 希望（女性/男性/自動）に対して、この環境で最も高品質な日本語音声を返す */
export function resolveVoice(pref: VoicePref): SpeechSynthesisVoice | null {
    const voices = jaVoices();
    if (voices.length === 0) return null;
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -Infinity;
    voices.forEach((v) => {
        const s = scoreVoice(v, pref);
        if (s > bestScore) { bestScore = s; best = v; }
    });
    return bestScore <= -Infinity ? voices[0] : best;
}
