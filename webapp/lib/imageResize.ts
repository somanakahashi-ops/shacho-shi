/* ================================================================
   imageResize ── 画像ファイルを縮小してデータURLにする

   静的版 docs/js/ImageStore.js の _resizeImage/_readFileAsDataUrl を
   移植したもの。DB（Supabase の jsonb 列）に直接保存するため、
   保存前にサイズを抑える（長辺 maxDimension、JPEG品質0.85）。
   ================================================================ */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = src;
  });
}

/**
 * 画像ファイルを maxDimension 以下に縮小し、JPEGデータURLとして返す。
 * @param file 入力ファイル
 * @param maxDimension 長辺の最大px（既定1000。静的版と同じ）
 */
export async function resizeImageFile(file: File, maxDimension = 1000): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', 0.85);
}
