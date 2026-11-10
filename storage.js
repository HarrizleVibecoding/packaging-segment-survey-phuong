import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { put, get, head, copy, del, BlobNotFoundError } from '@vercel/blob';

const dataDir = resolve(process.env.DATA_DIR || join(import.meta.dirname, 'data'));
const file = join(dataDir, 'survey.json');
const blobMode = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const configPath = 'survey/config.json';
const empty = () => ({ version: 1, products: [] });

export async function initStorage() {
  if (blobMode) return;
  await mkdir(join(dataDir, 'images'), { recursive: true });
  if (!existsSync(file)) await writeFile(file, JSON.stringify(empty(), null, 2));
}

export async function loadSurvey() {
  if (!blobMode) return { data: JSON.parse(await readFile(file, 'utf8')), etag: null };
  let metadata;
  try { metadata = await head(configPath); }
  catch (error) { if (error instanceof BlobNotFoundError) return { data: empty(), etag: null }; throw error; }
  const url = new URL(metadata.url);
  url.searchParams.set('v', randomUUID());
  const result = await get(url.toString(), { access: 'public' });
  if (!result || result.statusCode !== 200) throw new Error('Không thể đọc cấu hình khảo sát.');
  if (result.blob.etag === metadata.etag) return { data: JSON.parse(await new Response(result.stream).text()), etag: metadata.etag };
  await result.stream.cancel();
  const snapshot = await copy(configPath, `survey/read-${randomUUID()}.json`, { access: 'public', contentType: 'application/json' });
  try {
    const fresh = await get(snapshot.url, { access: 'public' });
    if (!fresh || fresh.statusCode !== 200) throw new Error('Không thể đọc cấu hình khảo sát mới nhất.');
    return { data: JSON.parse(await new Response(fresh.stream).text()), etag: metadata.etag };
  } finally { await del(snapshot.url).catch(error => console.error('Không thể dọn bản đọc cấu hình:', error)); }
}

export async function saveSurvey(data, etag) {
  if (!blobMode) return writeFile(file, JSON.stringify(data, null, 2));
  await put(configPath, JSON.stringify(data), { access: 'public', contentType: 'application/json', allowOverwrite: true, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}) });
}

export async function saveImage(id, ext, bytes) {
  if (!blobMode) { await writeFile(join(dataDir, 'images', `${id}.${ext}`), bytes); return `/images/${id}.${ext}`; }
  const blob = await put(`survey/images/${id}.${ext}`, bytes, { access: 'public', contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` });
  return blob.url;
}

export async function removeImage(image) {
  if (blobMode) return del(image);
  const filename = image.split('/').at(-1);
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename)) throw new Error('Đường dẫn ảnh không hợp lệ.');
  await unlink(join(dataDir, 'images', filename));
}

export { dataDir, blobMode };

