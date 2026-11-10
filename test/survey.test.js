import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('upload, phân loại, gửi Sheet và chống gửi trùng', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pack-survey-'));
  let sheetRows = 0;
  const sheet = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const input = JSON.parse(raw); assert.equal(input.secret, 'secret'); sheetRows++;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  sheet.listen(0, '127.0.0.1'); await once(sheet, 'listening');
  const appPort = 41000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '', PORT: String(appPort), DATA_DIR: dir, ADMIN_TOKEN: 'admin-secret', GOOGLE_SHEETS_WEBHOOK_URL: `http://127.0.0.1:${sheet.address().port}`, GOOGLE_SHEETS_SECRET: 'secret' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${appPort}`;
  const api = async (path, method, data, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json() }; };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { const r = await fetch(base); ready = r.ok; if (ready) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert.equal(ready, true, 'Máy chủ khảo sát phải khởi động trước khi kiểm thử API.');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=';
    assert.equal((await api('/api/admin/products', 'POST', { name: 'A', image: png })).status, 401);
    for (let i = 1; i <= 9; i++) assert.equal((await api('/api/admin/products', 'POST', { name: `Bao bì ${i}`, image: png }, 'admin-secret')).status, 201);
    const survey = (await api('/api/survey', 'GET')).data;
    assert.equal(survey.products.length, 9);
    const ids = survey.products.map(p => p.id);
    const payload = { submissionId: crypto.randomUUID(), surveyVersion: survey.version, selections: { budget: ids.slice(0, 3), mainstream: ids.slice(3, 6), premium: ids.slice(6, 9) }, answers: { budget: 'Lý do nhóm giá rẻ', mainstream: 'Lý do nhóm phổ thông', premium: 'Lý do nhóm cao cấp', premiumSignals: 'Dấu hiệu bao bì cao cấp' } };
    assert.equal((await api('/api/responses', 'POST', { ...payload, selections: { ...payload.selections, premium: ids.slice(0, 3) } })).status, 400);
    assert.equal((await api('/api/responses', 'POST', payload)).status, 201);
    assert.equal((await api('/api/responses', 'POST', payload)).data.duplicate, true);
    assert.equal(sheetRows, 1);
    assert.equal((await api('/api/admin/products', 'POST', { name: 'Quá lớn', image: 'data:image/png;base64,' + Buffer.alloc(3_000_001).toString('base64') }, 'admin-secret')).status, 400);
    assert.equal((await api('/api/admin/products', 'POST', { name: 'Bao bì mới', image: png }, 'admin-secret')).status, 201);
    assert.equal((await api('/api/responses', 'POST', { ...payload, submissionId: crypto.randomUUID() })).status, 201, 'Thêm ảnh không được làm mất phản hồi đang thực hiện.');
    assert.equal((await api(`/api/admin/products/${ids[0]}`, 'DELETE', undefined, 'admin-secret')).status, 200);
    const changed = await api('/api/responses', 'POST', { ...payload, submissionId: crypto.randomUUID() });
    assert.equal(changed.status, 409);
    assert.equal(changed.data.code, 'SURVEY_CHANGED');
    assert.equal(sheetRows, 2);
  } finally { child.kill(); sheet.close(); await rm(dir, { recursive: true, force: true }); }
});

