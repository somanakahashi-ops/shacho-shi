# 自分史ブック（マルチユーザー版）

問いと答えで綴る自分史を、誰でも自分の1冊として作れるWebアプリ。
Next.js (App Router) + Supabase。認証なしの共有リンク方式（MVP）。

- `/` … 新しい本を作る／この端末で作った本の一覧
- `/book/[id]` … 閲覧（見開き表示）
- `/book/[id]/manage` … 編集（見開き単位）

静的版（1冊もの・GitHub Pages公開）は同リポジトリの `docs/` にあります。

## セットアップ

### 1. Supabase プロジェクトを作る（無料枠でOK）

1. https://supabase.com → New project
2. ダッシュボード → **SQL Editor** → `supabase/schema.sql` の中身を貼り付けて実行
3. **Settings → API** で以下2つを控える
   - Project URL（例: `https://xxxx.supabase.co`）
   - `anon` `public` キー

### 2. ローカルで動かす

```bash
cd webapp
npm install
cp .env.local.example .env.local   # 値を書き込む
npm run dev
```

`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### 3. Vercel にデプロイ

1. https://vercel.com → Add New → Project → このGitHubリポジトリを選択
2. **Root Directory を `webapp` に設定**（重要）
3. Environment Variables に上記2つを設定
4. Deploy

## データ設計（MVP）

- `books` テーブル1つ。1行 = 1冊。`pages` (jsonb) にページ配列を保持
- ページの形は静的版 `docs/data/book-data.js` の PAGES と同じ
  （chapter / title / body / qLabel / question / answer）
- 「自分の本」= localStorage に覚えたUUIDのリスト（この端末で作った本）
- URL（UUID）を知っている人は誰でも閲覧・編集できる

## 今後の予定

- ページめくりアニメーション・TTS・写真の移植（静的版 `docs/js/` から）
- 認証（本の所有者だけが編集できるように）
- Xano等への保存先差し替え検討
