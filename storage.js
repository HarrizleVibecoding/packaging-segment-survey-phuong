import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { put, get, head, copy, del, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { getStore } from '@netlify/blobs';

const dataDir = resolve(process.env.DATA_DIR || join(import.meta.dirname, 'data'));
// Three places to keep images and survey config, picked in this order:
// - Netlify Blobs: inside a Netlify Function (STORAGE=netlify), or from anywhere else (e.g. the
//   Vercel deployment) when NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN are set. Both sites then share it.
// - Vercel Blob: when a Vercel Blob token is set.
// - Files in data/ when running locally.
// NETLIFY_BLOBS_API_URL only points tests at a local Netlify Blobs server.
const netlifySite = process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN ? { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN, ...(process.env.NETLIFY_BLOBS_API_URL ? { apiURL: process.env.NETLIFY_BLOBS_API_URL } : {}) } : null;
const netlifyMode = process.env.STORAGE === 'netlify' || Boolean(netlifySite);
const vercelMode = !netlifyMode && Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const blobMode = netlifyMode || vercelMode;
// Preview deployments keep their data apart (a "preview/" prefix on Vercel Blob, a separate
// Netlify store) so testing never touches production.
const isPreview = process.env.DATA_PREFIX === undefined ? process.env.VERCEL_ENV === 'preview' : process.env.DATA_PREFIX !== '';
const blobPrefix = process.env.DATA_PREFIX ?? (isPreview ? 'preview/' : '');
const netlifyStoreName = isPreview ? 'survey-preview' : 'survey';
const defaultSlug = 'khan-giay-goi';
const emptySurvey = () => ({ version: 1, products: [] });
const defaultRegistry = () => ({ surveys: [{ slug: defaultSlug, name: 'Khăn giấy gói', sheetTab: '', open: true }] });

// Thrown when another request saved the same file first; the caller reloads and retries.
export class StorageConflictError extends Error {}

// Strong consistency: an admin change is visible on the next read, on both sites.
let netlifyStore;
const store = () => netlifyStore ??= getStore({ name: netlifyStoreName, consistency: 'strong', ...netlifySite });

// The original single survey keeps its old storage location so existing data and links keep working.
const configKey = slug => slug === defaultSlug ? 'survey/config.json' : `survey/s/${slug}/config.json`;
const registryKey = 'survey/surveys.json';
const imageKey = filename => `survey/images/${filename}`;
const imageFilename = image => {
  const filename = String(image).split('?')[0].split('/').at(-1);
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename)) throw new Error('Đường dẫn ảnh không hợp lệ.');
  return filename;
};
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

async function loadJson(key, fallback) {
  if (netlifyMode) {
    const entry = await store().getWithMetadata(key, { type: 'json' });
    // Reads through the Netlify API (e.g. from Vercel) come back without an etag: '' means
    // "exists, but no etag to check", null means "does not exist yet".
    return entry === null ? { data: fallback(), etag: null } : { data: entry.data, etag: entry.etag ?? '' };
  }
  if (!vercelMode) {
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
  if (netlifyMode) {
    // With an etag, save only if nobody changed the file since it was read. A null etag means it did
    // not exist, so only create it if it still doesn't. Without an etag ('') the last write wins;
    // admin edits are rare and the admin page saves one change at a time.
    const { modified } = await store().setJSON(key, data, etag ? { onlyIfMatch: etag } : etag === null ? { onlyIfNew: true } : {});
    if (!modified) throw new StorageConflictError();
    return;
  }
  if (!vercelMode) {
    const file = localPath(key);
    await mkdir(dirname(file), { recursive: true });
    return writeFile(file, JSON.stringify(data, null, 2));
  }
  try { await put(blobPrefix + key, JSON.stringify(data), { access: 'public', contentType: 'application/json', allowOverwrite: true, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}) }); }
  catch (error) { if (error instanceof BlobPreconditionFailedError) throw new StorageConflictError(); throw error; }
}

export const loadRegistry = () => loadJson(registryKey, defaultRegistry);
export const saveRegistry = (data, etag) => saveJson(registryKey, data, etag);
export const loadSurvey = slug => loadJson(configKey(slug), emptySurvey);
export const saveSurvey = (slug, data, etag) => saveJson(configKey(slug), data, etag);

export async function removeSurveyConfig(slug) {
  const key = configKey(slug);
  if (netlifyMode) return store().delete(key);
  if (!vercelMode) { const file = localPath(key); if (existsSync(file)) await unlink(file); return; }
  try { await del((await head(blobPrefix + key)).url); }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
}

// Netlify Blobs and local files are served by the app at /images/<file>; Vercel Blob images
// keep their public blob URL.
export async function saveImage(id, ext, bytes) {
  const filename = `${id}.${ext}`;
  if (netlifyMode) { await store().set(imageKey(filename), new Blob([bytes])); return `/images/${filename}`; }
  if (!vercelMode) { await writeFile(join(dataDir, 'images', filename), bytes); return `/images/${filename}`; }
  const blob = await put(`${blobPrefix}${imageKey(filename)}`, bytes, { access: 'public', contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` });
  return blob.url;
}

export async function readImage(image) {
  const filename = imageFilename(image);
  if (netlifyMode) { const data = await store().get(imageKey(filename), { type: 'arrayBuffer' }); return data === null ? null : Buffer.from(data); }
  const file = join(dataDir, 'images', filename);
  return existsSync(file) ? readFile(file) : null;
}

export async function removeImage(image) {
  if (vercelMode && /^https?:/.test(image)) return del(image);
  const filename = imageFilename(image);
  if (netlifyMode) return store().delete(imageKey(filename));
  await unlink(join(dataDir, 'images', filename));
}

export { dataDir, blobMode, netlifyMode, netlifyStoreName, defaultSlug, isPreview };
