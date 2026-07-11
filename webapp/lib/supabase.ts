/* ================================================================
   supabase.ts ── Supabase クライアントの生成

   認証なしMVP:
     ・anon キーでブラウザから直接 books テーブルを読み書きする。
     ・「URL（本のUUID）を知っている人だけが読める/編集できる」
       という共有リンク方式。RLS は supabase/schema.sql を参照。

   環境変数（Vercel の Project Settings → Environment Variables）:
     NEXT_PUBLIC_SUPABASE_URL      … SupabaseプロジェクトのURL
     NEXT_PUBLIC_SUPABASE_ANON_KEY … anon public キー
   ================================================================ */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** 設定済みなら Supabase クライアントを返す。未設定なら null（設定案内を出す用） */
export function getSupabase(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    if (!client) client = createClient(url, key);
    return client;
}
