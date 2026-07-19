/* ================================================================
   buildSpreads ── Supabase の pages 配列を、静的版と同じ
   「見開き単位（{spreads:[{left,right}]}）」の形に変換する。

   静的版 docs/data/book-data.js の末尾でやっていることと同一。
   PageContentRenderer はこの形（bookData.spreads）を要求する。
   ================================================================ */
import { BookPage } from './types';

export function buildSpreadData(pages: BookPage[]) {
    // ページごとにコピーしてページ番号・背景色を付与する
    // （元データを書き換えないよう複製する）
    const withMeta = pages.map((p, idx) => ({
        ...p,
        pageNum: idx === 0 ? 'Cover' : String(idx),
    }));

    const padded = withMeta.length % 2 === 0 ? withMeta : [...withMeta, { pageNum: '' }];

    const spreads: { left: any; right: any }[] = [];
    for (let i = 0; i < padded.length; i += 2) {
        const left = { ...padded[i], bg: '#faf8f2' };
        const right = { ...padded[i + 1], bg: '#fdfcf8' };
        spreads.push({ left, right });
    }
    return { spreads };
}
