# 事前生成TTS（読み上げ音声）の作り方

本の文章を、無料・商用可のニューラル音声モデル **Kokoro-82M**（Apache-2.0）で
高音質MP3に事前変換し、`audio/tts/` と対応表 `data/tts-manifest.js` を作ります。

実行時（本のページ）は、読み上げる文章を `js/util.js` の `ttsHash()` で
ハッシュ化し、対応表に一致するMP3があればそれを再生します。無ければ
ブラウザ内蔵の音声にフォールバックします（＝文章を編集した箇所などは内蔵音声）。

## 前提

- **ネットワークで `huggingface.co` に到達できること**（初回にモデル重みを取得）
- Python 3.10+ と Node.js

> メモ: Claude Code on the web の環境で実行する場合、環境の
> ネットワークポリシーで `huggingface.co` を許可した上で
> **新しいセッション**を開始してください（実行中セッションの
> ポリシーは後から変えられません）。

## 手順

```bash
# 1) 依存をインストール（venv 推奨。Debian系は system の setuptools を避けるため venv 必須）
python3 -m venv .venv
.venv/bin/pip install -U pip setuptools wheel
.venv/bin/pip install kokoro soundfile "misaki[ja]" lameenc

# 2) 本文から読み上げ単位を抽出（read-units.json を生成）
node scripts/tts/extract_read_units.js

# 3) 音声を生成（audio/tts/*.mp3 と data/tts-manifest.js を出力）
.venv/bin/python scripts/tts/generate_tts.py

# 4) 生成物をコミット
git add audio/tts data/tts-manifest.js
git commit -m "読み上げ音声を事前生成（Kokoro）"
```

## 文章を変えたら

`data/book-data.js`（または管理画面での編集を反映した内容）を変えたら、
`2)`→`3)` を再実行してください。文章が変わったページはハッシュが変わるので
新しいMP3が作られ、古いMP3は使われなくなります（不要なら削除可）。

## 使っているボイス

- 女性: `jf_alpha`
- 男性: `jm_kumo`

他のボイスに変えたい場合は `scripts/tts/generate_tts.py` の `VOICES` を編集。
