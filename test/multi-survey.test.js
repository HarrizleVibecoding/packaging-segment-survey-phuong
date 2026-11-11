import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=';

async function startApp(extraEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pack-multi-'));
  const payloads = [];
  const sheet = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    payloads.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  sheet.listen(0, '127.0.0.1'); await once(sheet, 'listening');
  const port = 41000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '', VERCEL_ENV: '', PORT: String(port), DATA_DIR: dir, ADMIN_TOKEN: 'admin-secret', GOOGLE_SHEETS_WEBHOOK_URL: `http://127.0.0.1:${sheet.address().port}`, GOOGLE_SHEETS_SECRET: 'secret', ...extraEnv }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  const api = async (path, method = 'GET', data, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const stop = async () => { child.kill(); sheet.close(); await rm(dir, { recursive: true, force: true }); };
  return { base, api, payloads, stop };
}
const answer = (survey, ids) => ({ survey, submissionId: crypto.randomUUID(), surveyVersion: 0, selections: { budget: ids.slice(0, 3), mainstream: ids.slice(3, 6), premium: ids.slice(6, 9) }, answers: { budget: 'Lý do nhóm giá rẻ', mainstream: 'Lý do nhóm phổ thông', premium: 'Lý do nhóm cao cấp' }, respondent: { name: 'Nguyễn Văn B', phone: '' } });

test('nhiều khảo sát: link riêng, thư viện riêng, tab Sheet riêng, đóng/mở', async () => {
  const { base, api, payloads, stop } = await startApp();
  const token = 'admin-secret';
  try {
    const original = (await api('/api/survey')).data;
    assert.equal(original.slug, 'khan-giay-goi', 'Link gốc vẫn là khảo sát khăn giấy gói.');
    assert.equal(original.acceptingResponses, false, 'Dưới 9 ảnh thì chưa nhận phản hồi.');
    assert.equal((await api('/api/admin/surveys')).status, 401);
    assert.equal((await api('/api/admin/surveys', 'POST', { name: 'Khăn giấy ướt' })).status, 401);

    const created = await api('/api/admin/surveys', 'POST', { name: 'Khăn giấy ướt' }, token);
    assert.equal(created.status, 201);
    assert.equal(created.data.survey.slug, 'khan-giay-uot');
    assert.equal(created.data.survey.sheetTab, 'Khăn giấy ướt');
    assert.equal((await api('/api/admin/surveys', 'POST', { name: 'khăn giấy ướt' }, token)).status, 409, 'Không tạo trùng tên.');
    assert.equal((await fetch(`${base}/s/khan-giay-uot`)).headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal((await api('/api/survey?s=khong-ton-tai')).status, 404);

    for (let i = 1; i <= 9; i++) assert.equal((await api('/api/admin/products?s=khan-giay-uot', 'POST', { name: `Ướt ${i}`, image: png }, token)).status, 201);
    assert.equal((await api('/api/admin/products', 'POST', { name: 'Gói 1', image: png }, token)).status, 201);
    const wet = (await api('/api/survey?s=khan-giay-uot')).data;
    assert.equal(wet.products.length, 9);
    assert.equal(wet.name, 'Khăn giấy ướt');
    assert.equal(wet.acceptingResponses, true);
    assert.equal((await api('/api/survey')).data.products.length, 1, 'Ảnh của khảo sát này không lẫn sang khảo sát kia.');

    const ids = wet.products.map(p => p.id);
    assert.equal((await api('/api/responses', 'POST', { ...answer('khan-giay-uot', ids), surveyVersion: wet.version })).status, 201);
    const sent = payloads.at(-1);
    assert.equal(sent.sheetTab, 'Khăn giấy ướt');
    assert.equal(sent.survey, 'khan-giay-uot');
    assert.equal(sent.auth, 'secret');
    assert.equal(sent.secret, undefined, 'Tab mới gửi "auth" để Apps Script cũ từ chối thay vì ghi nhầm tab.');
    const sentBefore = payloads.length;
    assert.ok((await api('/api/responses', 'POST', { ...answer('khan-giay-goi', ids), surveyVersion: wet.version })).status >= 400, 'Không gửi được ảnh của khảo sát khác.');
    assert.equal(payloads.length, sentBefore);

    const list = (await api('/api/admin/surveys', 'GET', undefined, token)).data.surveys;
    assert.deepEqual(list.map(s => [s.slug, s.productCount]), [['khan-giay-goi', 1], ['khan-giay-uot', 9]]);

    assert.equal((await api('/api/admin/surveys/khan-giay-uot', 'PATCH', { open: false }, token)).status, 200);
    assert.equal((await api('/api/survey?s=khan-giay-uot')).data.acceptingResponses, false);
    const closed = await api('/api/responses', 'POST', { ...answer('khan-giay-uot', ids), surveyVersion: wet.version });
    assert.equal(closed.status, 409);
    assert.equal(closed.data.code, 'SURVEY_CLOSED');
    assert.equal((await api('/api/admin/surveys/khan-giay-uot', 'PATCH', { open: true }, token)).status, 200);
    assert.equal((await api('/api/survey?s=khan-giay-uot')).data.acceptingResponses, true);

    const removed = await api(`/api/admin/products/${ids[0]}?s=khan-giay-uot`, 'DELETE', undefined, token);
    assert.equal(removed.status, 200);
    assert.equal(removed.data.products.length, 8);
    assert.equal((await api(`/api/admin/products/${ids[1]}`, 'DELETE', undefined, token)).status, 404, 'Xóa phải đúng khảo sát.');
  } finally { await stop(); }
});

test('bản preview ghi vào tab "TEST - ..." kể cả khảo sát gốc', async () => {
  const { api, payloads, stop } = await startApp({ DATA_PREFIX: 'preview/' });
  try {
    for (let i = 1; i <= 9; i++) await api('/api/admin/products', 'POST', { name: `Gói ${i}`, image: png }, 'admin-secret');
    const survey = (await api('/api/survey')).data;
    assert.equal((await api('/api/admin/status', 'GET', undefined, 'admin-secret')).data.preview, true);
    const ids = survey.products.map(p => p.id);
    assert.equal((await api('/api/responses', 'POST', { ...answer(undefined, ids), surveyVersion: survey.version })).status, 201);
    assert.equal(payloads.at(-1).sheetTab, 'TEST - Khăn giấy gói');
    assert.equal(payloads.at(-1).secret, undefined);
  } finally { await stop(); }
});
