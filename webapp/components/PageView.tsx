/* ================================================================
   PageView ── 本の1ページ分の表示コンポーネント

   静的版では canvas（PageContentRenderer）で描いていた内容を、
   マルチユーザー版ではまず HTML/CSS で表現する（MVP）。
   ページめくりアニメーション等は後続で強化する。
   ================================================================ */
import { BookPage } from '@/lib/types';

export default function PageView({
  page,
  side,
  pageNum,
}: {
  page: BookPage | null;
  side: 'left' | 'right';
  pageNum: string;
}) {
  const cls = `page page-${side}`;
  if (!page) {
    return <div className={cls} />;
  }
  const isQA = !!(page.question || page.answer);
  return (
    <div className={cls}>
      {isQA ? (
        <>
          {page.qLabel && <div className="qa-label">{page.qLabel}</div>}
          {page.question && <div className="qa-question">{page.question}</div>}
          {page.answer ? (
            <div className="qa-answer">{page.answer}</div>
          ) : (
            <div className="qa-answer qa-answer-empty">（まだ書かれていません）</div>
          )}
        </>
      ) : (
        <>
          {page.chapter && <div className="page-chapter">{page.chapter}</div>}
          {page.title && (
            <>
              <div className="page-title">{page.title}</div>
              <div className="page-title-rule" />
            </>
          )}
          {page.body && <div className="page-body">{page.body}</div>}
        </>
      )}
      <span className="page-num">{pageNum}</span>
    </div>
  );
}
