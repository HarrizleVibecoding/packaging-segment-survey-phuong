import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { put, get } from '@vercel/blob';

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
  const result = await get(configPath, { access: 'public' });
  if (!result || result.statusCode !== 200) return { data: empty(), etag: null };
  return { data: JSON.parse(await new Response(result.stream).text()), etag: result.blob.etag };
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

export { dataDir, blobMode };

