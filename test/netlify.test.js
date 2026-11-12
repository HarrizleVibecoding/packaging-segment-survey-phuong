import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { BlobsServer } from '@netlify/blobs/server';
import { getStore } from '@netlify/blobs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=';
const siteID = 'test-site', token = 'blobs-token';

async function startApp(blobsURL, extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pack-netlify-'));
  const payloads = [];
  const sheet = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    payloads.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  sheet.listen(0, '127.0.0.1'); await once(sheet, 'listening');
  const port = 41000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '', VERCEL_ENV: '', BLOB_READ_WRITE_TOKEN: '', PORT: String(port), DATA_DIR: dir, ADMIN_TOKEN: 'admin-secret', GOOGLE_SHEETS_WEBHOOK_URL: `http://127.0.0.1:${sheet.address().port}`, GOOGLE_SHEETS_SECRET: 'secret', NETLIFY_SITE_ID: siteID, NETLIFY_BLOBS_TOKEN: token, NETLIFY_BLOBS_API_URL: blobsURL, ...extraEnv }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  const api = async (path, method = 'GET', data, auth) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const stop = async () => { child.kill(); sheet.close(); await rm(dir, { recursive: true, force: true }); };
  return { base, api, payloads, dir, stop };
}

test('Netlify Blobs: ảnh và cấu hình lưu trong kho Netlify, dùng chung giữa các bản deploy', async () => {
  const blobsDir = await mkdtemp(join(tmpdir(), 'pack-blobs-'));
  const blobs = new BlobsServer({ directory: blobsDir, token });
  const { port } = await blobs.start();
  const blobsURL = `http://127.0.0.1:${port}`;
  const site = await startApp(blobsURL), other = await startApp(blobsURL), preview = await startApp(blobsURL, { DATA_PREFIX: 'preview/' });
  try {
    // The admin page uploads one image at a time; through the Netlify API there is no etag to
    // guard simultaneous saves, so this test does the same.
    for (let i = 1; i <= 9; i++) assert.equal((await site.api('/api/admin/products', 'POST', { name: `Bao bì ${i}`, image: png }, 'admin-secret')).status, 201);

    const survey = (await other.api('/api/survey')).data;
    assert.equal(survey.products.length, 9, 'Bản deploy khác thấy cùng dữ liệu.');
    assert.match(survey.products[0].image, /^\/images\/[a-f0-9-]{36}\.png$/);
    assert.deepEqual(await readdir(site.dir), [], 'Không ghi gì vào thư mục data/ trên máy.');

    const image = await fetch(other.base + survey.products[0].image);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(other.base + '/images/00000000-0000-0000-0000-000000000000.png')).status, 404);

    const ids = survey.products.map(p => p.id);
    assert.equal((await other.api(`/api/admin/products/${ids[0]}`, 'PATCH', { name: 'Tên mới' }, 'admin-secret')).status, 200);
    assert.equal((await site.api('/api/admin/library', 'GET', undefined, 'admin-secret')).data.products[0].name, 'Tên mới');

    const submission = { submissionId: crypto.randomUUID(), surveyVersion: survey.version, selections: { budget: ids.slice(0, 3), mainstream: ids.slice(3, 6), premium: ids.slice(6, 9) }, answers: { budget: 'Lý do nhóm giá rẻ', mainstream: 'Lý do nhóm phổ thông', premium: 'Lý do nhóm cao cấp' }, respondent: { name: 'Nguyễn Văn C', phone: '' } };
    assert.equal((await site.api('/api/responses', 'POST', submission)).status, 201);
    assert.deepEqual(site.payloads[0].selectionNames.budget, ['Tên mới', 'Bao bì 2', 'Bao bì 3']);

    assert.equal((await site.api(`/api/admin/products/${ids[8]}`, 'DELETE', undefined, 'admin-secret')).status, 200);
    assert.equal((await fetch(site.base + survey.products[8].image)).status, 404, 'Xóa bao bì xóa luôn ảnh trong kho.');

    assert.equal((await preview.api('/api/survey')).data.products.length, 0, 'Bản preview dùng kho riêng.');
    const store = getStore({ name: 'survey', siteID, token, apiURL: blobsURL });
    assert.equal((await store.get('survey/config.json', { type: 'json' })).products.length, 8);
  } finally {
    await Promise.all([site.stop(), other.stop(), preview.stop()]);
    await blobs.stop(); await rm(blobsDir, { recursive: true, force: true });
  }
});

test('Netlify Function chuyển Request/Response sang handler của server.js', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pack-fn-'));
  Object.assign(process.env, { DATA_DIR: dir, ADMIN_TOKEN: 'admin-secret', VERCEL: '', VERCEL_ENV: '', BLOB_READ_WRITE_TOKEN: '', NETLIFY_SITE_ID: '', STORAGE: '' });
  const { handler } = await import('../server.js');
  const { runNodeHandler } = await import('../netlify/functions/api.mjs');
  try {
    const call = (path, init) => runNodeHandler(handler, new Request(`https://example.netlify.app${path}`, init));
    const created = await call('/api/admin/products', { method: 'POST', headers: { Authorization: 'Bearer admin-secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bao bì 1', image: png }) });
    assert.equal(created.status, 201);
    const survey = await (await call('/api/survey')).json();
    assert.equal(survey.products.length, 1);
    assert.equal(survey.products[0].name, undefined);
    const image = await call(survey.products[0].image);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.ok((await image.arrayBuffer()).byteLength > 0);
    assert.equal((await call('/api/admin/library')).status, 401);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
