-- ================================================================
-- 自分史ブック（マルチユーザー版）― Supabase スキーマ
--
-- 使い方: Supabase ダッシュボード → SQL Editor に貼り付けて実行。
--
-- 認証なしMVPの設計:
--   ・1行 = 1冊。id (UUID) がそのまま共有URLのキーになる。
--   ・anon キーで insert / select / update を許可する。
--     「UUIDを知っている人だけが読める・編集できる」共有リンク方式。
--   ・一覧の列挙（全件select）を防ぐ手段はRLSだけでは不完全なため、
--     本格運用（認証導入）時に owner 列 + auth.uid() ベースへ移行する。
-- ================================================================

create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default 'わたしの自分史',
  pages       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS を有効化し、anon ロールに必要最小限の操作を許可する
alter table public.books enable row level security;

drop policy if exists "anon can insert books" on public.books;
create policy "anon can insert books"
  on public.books for insert
  to anon
  with check (true);

drop policy if exists "anon can read books" on public.books;
create policy "anon can read books"
  on public.books for select
  to anon
  using (true);

drop policy if exists "anon can update books" on public.books;
create policy "anon can update books"
  on public.books for update
  to anon
  using (true)
  with check (true);

-- 削除はMVPでは提供しない（誤削除・荒らし防止）
