#!/usr/bin/env python3
# ================================================================
# generate_tts.py
# ── 事前生成TTS：Kokoro で各「読み上げ単位」の高音質音声を作る
#
# 前提:
#   ・ネットワークで huggingface.co に到達できること
#     （初回に Kokoro-82M のモデル重みを取得するため）
#   ・先に `node scripts/tts/extract_read_units.js` を実行して
#     scripts/tts/read-units.json を作っておくこと
#
# 出力:
#   ・audio/tts/f_<hash>.mp3（女性）, m_<hash>.mp3（男性）
#   ・data/tts-manifest.js（ハッシュ→ファイルの対応表・JSグローバル）
#
# ライセンス: Kokoro-82M は Apache-2.0（商用可・帰属不要）
#
# 使い方:  python3 scripts/tts/generate_tts.py
# ================================================================
import json, os, sys, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUTDIR = os.path.join(ROOT, 'audio', 'tts')
UNITS = os.path.join(HERE, 'read-units.json')

VOICES = {'female': 'jf_alpha', 'male': 'jm_kumo'}  # Kokoro 日本語ボイス
SR = 24000

def main():
    if not os.path.exists(UNITS):
        sys.exit('read-units.json がありません。先に `node scripts/tts/extract_read_units.js` を実行してください。')
    units = json.load(open(UNITS, encoding='utf-8'))
    os.makedirs(OUTDIR, exist_ok=True)

    import soundfile as sf
    from kokoro import KPipeline
    pipeline = KPipeline(lang_code='j', repo_id='hexgrad/Kokoro-82M')

    def synth(text, voice):
        chunks = []
        for _, _, audio in pipeline(text, voice=voice):
            chunks.append(audio if isinstance(audio, np.ndarray) else audio.numpy())
        return np.concatenate(chunks) if chunks else None

    def write_mp3(path_noext, audio):
        try:  # 新しめの libsndfile は mp3 書き出しに対応
            sf.write(path_noext + '.mp3', audio, SR)
            return os.path.basename(path_noext) + '.mp3'
        except Exception:
            import lameenc
            enc = lameenc.Encoder()
            enc.set_bit_rate(96); enc.set_in_sample_rate(SR)
            enc.set_channels(1); enc.set_quality(2)
            pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
            open(path_noext + '.mp3', 'wb').write(enc.encode(pcm) + enc.flush())
            return os.path.basename(path_noext) + '.mp3'

    manifest = {'female': {}, 'male': {}}
    for gender, voice in VOICES.items():
        for u in units:
            audio = synth(u['text'], voice)
            if audio is None:
                continue
            fname = write_mp3(os.path.join(OUTDIR, f"{gender[0]}_{u['hash']}"), audio)
            manifest[gender][u['hash']] = 'audio/tts/' + fname
            print(f"  {gender} {u['hash']} -> {fname} ({len(audio)/SR:.1f}s)")

    header = (
        '/* ================================================================\n'
        '   tts-manifest.js（自動生成 / scripts/tts/generate_tts.py）\n'
        '   ── 事前生成した読み上げ音声の対応表（ハッシュ→MP3パス）\n'
        '   手で編集しないこと。文章を変えたら生成スクリプトを再実行する。\n'
        '   ================================================================ */\n'
    )
    js = header + 'const TTS_MANIFEST = ' + json.dumps(manifest, ensure_ascii=False) + ';\n'
    open(os.path.join(ROOT, 'data', 'tts-manifest.js'), 'w', encoding='utf-8').write(js)
    print('manifest entries:', sum(len(v) for v in manifest.values()))

if __name__ == '__main__':
    main()
