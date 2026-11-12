import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { put, get, head, copy, del, BlobNotFoundError } from '@vercel/blob';

const dataDir = resolve(process.env.DATA_DIR || join(import.meta.dirname, 'data'));
const blobMode = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
// Vercel preview deployments keep their data under a separate prefix so testing never touches production.
const isPreview = process.env.DATA_PREFIX === undefined ? process.env.VERCEL_ENV === 'preview' : process.env.DATA_PREFIX !== '';
const blobPrefix = process.env.DATA_PREFIX ?? (isPreview ? 'preview/' : '');
const defaultSlug = 'khan-giay-goi';
const emptySurvey = () => ({ version: 1, products: [] });
const defaultRegistry = () => ({ surveys: [{ slug: defaultSlug, name: 'Khăn giấy gói', sheetTab: '', open: true }] });

// The original single survey keeps its old storage location so existing data and links keep working.
const configKey = slug => slug === defaultSlug ? 'survey/config.json' : `survey/s/${slug}/config.json`;
const registryKey = 'survey/surveys.json';
function localPath(key) {
  if (key === 'survey/config.json') return join(dataDir, 'survey.json');
  if (key === registryKey) return join(dataDir, 'surveys.json');
  return join(dataDir, 'surveys', key.split('/')[2] + '.json');
}

export async function initStorage() {
  if (blobMode) return;
  await mkdir(join(dataDir, 'images'), { recursive: true });
  const file = localPath(configKey(defaultSlug));
  if (!existsSync(file)) await writeFile(file, JSON.stringify(emptySurvey(), null, 2));
}

// The Blob API and the CDN can write the same ETag differently (quoted, weak "W/" prefix).
const bareEtag = etag => String(etag || '').trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
const sameEtag = (a, b) => Boolean(bareEtag(a)) && bareEtag(a) === bareEtag(b);
let loggedEtagFormat = false;

async function loadJson(key, fallback) {
  if (!blobMode) {
    const file = localPath(key);
    if (!existsSync(file)) return { data: fallback(), etag: null };
    return { data: JSON.parse(await readFile(file, 'utf8')), etag: null };
  }
  const path = blobPrefix + key;
  let metadata;
  try { metadata = await head(path); }
  catch (error) { if (error instanceof BlobNotFoundError) return { data: fallback(), etag: null }; throw error; }
  // A fresh URL skips the CDN cache. Reading again is a cheap Simple Operation; the copy below
  // is an Advanced Operation (2,000/month on Hobby), so it is only the last resort.
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = new URL(metadata.url);
    url.searchParams.set('v', randomUUID());
    const result = await get(url.toString(), { access: 'public' });
    if (!result || result.statusCode !== 200) throw new Error('Không thể đọc cấu hình khảo sát.');
    if (!loggedEtagFormat) { loggedEtagFormat = true; console.log('Blob etag formats', { head: metadata.etag, get: result.blob.etag, rawEqual: result.blob.etag === metadata.etag }); }
    if (sameEtag(result.blob.etag, metadata.etag)) return { data: JSON.parse(await new Response(result.stream).text()), etag: metadata.etag };
    await result.stream.cancel();
    if (attempt === 1) console.warn('Blob read used a copy (etag mismatch)', { key, head: metadata.etag, get: result.blob.etag });
  }
  const snapshot = await copy(path, `${blobPrefix}survey/read-${randomUUID()}.json`, { access: 'public', contentType: 'application/json' });
  try {
    const fresh = await get(snapshot.url, { access: 'public' });
    if (!fresh || fresh.statusCode !== 200) throw new Error('Không thể đọc cấu hình khảo sát mới nhất.');
    return { data: JSON.parse(await new Response(fresh.stream).text()), etag: metadata.etag };
  } finally { await del(snapshot.url).catch(error => console.error('Không thể dọn bản đọc cấu hình:', error)); }
}

async function saveJson(key, data, etag) {
  if (!blobMode) {
    const file = localPath(key);
    await mkdir(dirname(file), { recursive: true });
    return writeFile(file, JSON.stringify(data, null, 2));
  }
  await put(blobPrefix + key, JSON.stringify(data), { access: 'public', contentType: 'application/json', allowOverwrite: true, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}) });
}

export const loadRegistry = () => loadJson(registryKey, defaultRegistry);
export const saveRegistry = (data, etag) => saveJson(registryKey, data, etag);
export const loadSurvey = slug => loadJson(configKey(slug), emptySurvey);
export const saveSurvey = (slug, data, etag) => saveJson(configKey(slug), data, etag);

export async function removeSurveyConfig(slug) {
  const key = configKey(slug);
  if (!blobMode) { const file = localPath(key); if (existsSync(file)) await unlink(file); return; }
  try { await del((await head(blobPrefix + key)).url); }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
}

export async function saveImage(id, ext, bytes) {
  if (!blobMode) { await writeFile(join(dataDir, 'images', `${id}.${ext}`), bytes); return `/images/${id}.${ext}`; }
  const blob = await put(`${blobPrefix}survey/images/${id}.${ext}`, bytes, { access: 'public', contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` });
  return blob.url;
}

export async function removeImage(image) {
  if (blobMode) return del(image);
  const filename = image.split('/').at(-1);
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename)) throw new Error('Đường dẫn ảnh không hợp lệ.');
  await unlink(join(dataDir, 'images', filename));
}

export { dataDir, blobMode, defaultSlug, isPreview };
