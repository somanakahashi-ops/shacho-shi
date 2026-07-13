'use client';
/* ================================================================
   TocPanel ── 目次サイドバー（静的版の toc-panel 相当）

   ・ハンバーガーボタンで左からスライドイン
   ・章（chapter を持つページ）の一覧から見開きへジャンプ
   ・設定: ページめくり音の ON/OFF
   ・背景オーバーレイのクリックでも閉じる
   ================================================================ */
import { BookPage } from '@/lib/types';

export interface TocChapter {
    label: string;       // 例: 「第一章　誕生」
    spreadIndex: number; // ジャンプ先の見開き
}

/** ページ配列から章一覧を作る（表紙=Cover も先頭に入れる） */
export function buildToc(pages: BookPage[]): TocChapter[] {
    const toc: TocChapter[] = [{ label: '表紙', spreadIndex: 0 }];
    pages.forEach((p, idx) => {
        if (p?.chapter) {
            toc.push({
                label: `${p.chapter}　${p.title ?? ''}`,
                spreadIndex: Math.floor(idx / 2),
            });
        }
    });
    return toc;
}

export default function TocPanel({
    open,
    onClose,
    toc,
    currentSpread,
    onJump,
    soundEnabled,
    onToggleSound,
}: {
    open: boolean;
    onClose: () => void;
    toc: TocChapter[];
    currentSpread: number;
    onJump: (spreadIndex: number) => void;
    soundEnabled: boolean;
    onToggleSound: (on: boolean) => void;
}) {
    return (
        <>
            <div className={`toc-overlay ${open ? 'show' : ''}`} onClick={onClose} />
            <nav className={`toc-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
                <div className="toc-header">
                    <span className="toc-title">目次</span>
                    <button className="toc-close" onClick={onClose} aria-label="目次を閉じる">×</button>
                </div>
                <ul className="toc-list">
                    {toc.map((c) => (
                        <li key={c.spreadIndex}>
                            <button
                                className={`toc-item ${c.spreadIndex === currentSpread ? 'active' : ''}`}
                                onClick={() => { onJump(c.spreadIndex); onClose(); }}
                            >
                                {c.label}
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="toc-settings">
                    <label className="toc-toggle-row">
                        <span>ページめくり音</span>
                        <input
                            type="checkbox"
                            checked={soundEnabled}
                            onChange={(e) => onToggleSound(e.target.checked)}
                        />
                    </label>
                </div>
            </nav>
        </>
    );
}
