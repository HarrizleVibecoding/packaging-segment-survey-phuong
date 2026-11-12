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
  let lastSheetPayload;
  const sheet = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const input = JSON.parse(raw); assert.equal(input.secret, 'secret'); lastSheetPayload = input; sheetRows++;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  sheet.listen(0, '127.0.0.1'); await once(sheet, 'listening');
  const appPort = 41000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '', PORT: String(appPort), DATA_DIR: dir, ADMIN_TOKEN: 'admin-secret', GOOGLE_SHEETS_WEBHOOK_URL: `http://127.0.0.1:${sheet.address().port}`, GOOGLE_SHEETS_SECRET: 'secret' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${appPort}`;
  const api = async (path, method, data, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json() }; };
  try {
    let ready = false;
    for (let i = 0; i < 300; i++) { try { const r = await fetch(base); ready = r.ok; if (ready) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert.equal(ready, true, 'Máy chủ khảo sát phải khởi động trước khi kiểm thử API.');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=';
    assert.equal((await api('/api/admin/products', 'POST', { name: 'A', image: png })).status, 401);
    for (let i = 1; i <= 9; i++) assert.equal((await api('/api/admin/products', 'POST', { name: `Bao bì ${i}`, image: png }, 'admin-secret')).status, 201);
    const survey = (await api('/api/survey', 'GET')).data;
    assert.equal(survey.products.length, 9);
    assert.ok(survey.products.every(p => p.id && p.image && !('name' in p)), 'Người làm khảo sát không nhận tên Brand.');
    assert.equal((await api('/api/admin/library', 'GET')).status, 401, 'Thư viện có tên Brand cần mã quản trị.');
    const library = (await api('/api/admin/library', 'GET', undefined, 'admin-secret')).data;
    assert.deepEqual(library.products.map(p => p.name), Array.from({ length: 9 }, (_, i) => `Bao bì ${i + 1}`));
    const ids = survey.products.map(p => p.id);
    const payload = { submissionId: crypto.randomUUID(), surveyVersion: survey.version, selections: { budget: ids.slice(0, 3), mainstream: ids.slice(3, 6), premium: ids.slice(6, 9) }, answers: { budget: 'Lý do nhóm giá rẻ', mainstream: 'Lý do nhóm phổ thông', premium: 'Lý do nhóm cao cấp' }, respondent: { name: 'Nguyễn Văn A', phone: '' } };
    assert.equal((await api('/api/responses', 'POST', { ...payload, selections: { ...payload.selections, premium: ids.slice(0, 3) } })).status, 400);
    assert.equal((await api('/api/responses', 'POST', { ...payload, respondent: { name: '', phone: '' } })).status, 400);
    assert.equal((await api('/api/responses', 'POST', { ...payload, respondent: { name: 'Nguyễn Văn A', phone: 'không phải số' } })).status, 400);
    assert.equal((await api('/api/responses', 'POST', payload)).status, 201);
    assert.equal(lastSheetPayload.answers.premiumSignals, '', 'Cột cũ trên Sheet được giữ trống.');
    assert.deepEqual(lastSheetPayload.respondent, { name: 'Nguyễn Văn A', phone: '' }, 'SĐT có thể bỏ trống.');
    assert.equal((await api('/api/responses', 'POST', payload)).data.duplicate, true);
    assert.equal(sheetRows, 1);
    assert.equal((await api('/api/admin/products', 'POST', { name: 'Quá lớn', image: 'data:image/png;base64,' + Buffer.alloc(3_000_001).toString('base64') }, 'admin-secret')).status, 400);
    assert.equal((await api('/api/admin/products', 'POST', { name: 'Bao bì mới', image: png }, 'admin-secret')).status, 201);
    assert.equal((await api('/api/responses', 'POST', { ...payload, submissionId: crypto.randomUUID() })).status, 201, 'Thêm ảnh không được làm mất phản hồi đang thực hiện.');
    assert.equal((await api(`/api/admin/products/${ids[3]}`, 'PATCH', { name: 'Tên mới' })).status, 401, 'Đổi tên cần mã quản trị.');
    assert.equal((await api(`/api/admin/products/${ids[3]}`, 'PATCH', { name: '   ' }, 'admin-secret')).status, 400);
    assert.equal((await api(`/api/admin/products/${ids[3]}`, 'PATCH', { name: 'x'.repeat(101) }, 'admin-secret')).status, 400);
    assert.equal((await api('/api/admin/products/khong-co', 'PATCH', { name: 'Tên mới' }, 'admin-secret')).status, 404);
    const renamed = await api(`/api/admin/products/${ids[3]}`, 'PATCH', { name: '  Tên mới  ' }, 'admin-secret');
    assert.equal(renamed.status, 200);
    const product = renamed.data.products.find(p => p.id === ids[3]);
    assert.equal(product.name, 'Tên mới');
    assert.equal(product.image, survey.products[3].image, 'Đổi tên giữ nguyên ảnh.');
    assert.equal((await api('/api/responses', 'POST', { ...payload, submissionId: crypto.randomUUID() })).status, 201, 'Đổi tên không làm mất phản hồi đang thực hiện.');
    assert.deepEqual(lastSheetPayload.selectionNames.mainstream, ['Tên mới', 'Bao bì 5', 'Bao bì 6'], 'Phản hồi sau khi đổi tên ghi tên mới.');
    assert.equal((await api(`/api/admin/products/${ids[0]}`, 'DELETE', undefined, 'admin-secret')).status, 200);
    const changed = await api('/api/responses', 'POST', { ...payload, submissionId: crypto.randomUUID() });
    assert.equal(changed.status, 409);
    assert.equal(changed.data.code, 'SURVEY_CHANGED');
    assert.equal(sheetRows, 3);
    for (let i = 10; i <= 30; i++) {
      const added = await api('/api/admin/products', 'POST', { name: `Bao bì ${i}`, image: png }, 'admin-secret');
      assert.equal(added.status, 201);
      assert.equal(added.data.products.length, i);
    }
    const full = await api('/api/admin/products', 'POST', { name: 'Bao bì 31', image: png }, 'admin-secret');
    assert.equal(full.status, 409);
    assert.match(full.data.error, /tối đa 30 ảnh/);
    assert.equal((await api('/api/survey', 'GET')).data.products.length, 30);
  } finally { child.kill(); sheet.close(); await rm(dir, { recursive: true, force: true }); }
});

