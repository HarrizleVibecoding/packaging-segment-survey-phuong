import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=';

test('phần 2.4: bật/tắt, ảnh so sánh, câu hỏi tự soạn và ghi Sheet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pack-extra-'));
  const payloads = [];
  const sheet = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    payloads.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  sheet.listen(0, '127.0.0.1'); await once(sheet, 'listening');
  const port = 41000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '', VERCEL_ENV: '', BLOB_READ_WRITE_TOKEN: '', NETLIFY_SITE_ID: '', STORAGE: '', PORT: String(port), DATA_DIR: dir, ADMIN_TOKEN: 'admin-secret', GOOGLE_SHEETS_WEBHOOK_URL: `http://127.0.0.1:${sheet.address().port}`, GOOGLE_SHEETS_SECRET: 'secret' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const api = async (path, method = 'GET', data, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const admin = (path, method, data) => api(path, method, data, 'admin-secret');
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    for (let i = 1; i <= 9; i++) assert.equal((await admin('/api/admin/products', 'POST', { name: `Bao bì ${i}`, image: png })).status, 201);
    const ids = (await api('/api/survey')).data.products.map(p => p.id);
    const submission = extraAnswers => ({ submissionId: crypto.randomUUID(), surveyVersion: 0, selections: { budget: ids.slice(0, 3), mainstream: ids.slice(3, 6), premium: ids.slice(6, 9) }, answers: { budget: 'Lý do nhóm giá rẻ', mainstream: 'Lý do nhóm phổ thông', premium: 'Lý do nhóm cao cấp' }, respondent: { name: 'Nguyễn Văn D', phone: '' }, ...(extraAnswers ? { extraAnswers } : {}) });

    // Off by default: respondents see nothing and submit as before.
    assert.equal((await api('/api/survey')).data.extra, null);
    assert.equal((await api('/api/responses', 'POST', submission())).status, 201);
    assert.equal(payloads.at(-1).extra, null);

    const library = (await admin('/api/admin/library')).data;
    assert.equal(library.extra.enabled, false);
    assert.deepEqual(library.extra.questions.map(q => q.type), ['choice', 'text', 'segment'], 'Có sẵn 3 câu mặc định.');
    const settings = { intro: 'So sánh 2 nhóm', groupA: { name: 'Hiện tại', imageId: '' }, groupB: { name: 'Mới', imageId: '' }, questions: library.extra.questions };

    assert.equal((await api('/api/admin/extra', 'PUT', { ...settings, enabled: false })).status, 401);
    assert.equal((await api('/api/admin/extra/images', 'POST', { image: png })).status, 401);
    assert.equal((await admin('/api/admin/extra', 'PUT', { ...settings, enabled: true })).status, 400, 'Không bật được khi chưa chọn ảnh.');

    let images;
    for (let i = 1; i <= 5; i++) { const r = await admin('/api/admin/extra/images', 'POST', { image: png }); assert.equal(r.status, 201); images = r.data.extra.images; }
    assert.equal((await admin('/api/admin/extra/images', 'POST', { image: png })).status, 409, 'Tối đa 5 ảnh.');
    assert.equal((await api('/api/survey')).data.products.length, 9, 'Ảnh 2.4 không lẫn vào thư viện bao bì.');

    const six = [...settings.questions, ...settings.questions, ...settings.questions].slice(0, 6);
    assert.equal((await admin('/api/admin/extra', 'PUT', { ...settings, enabled: false, questions: six })).status, 400, 'Tối đa 5 câu hỏi.');
    assert.equal((await admin('/api/admin/extra', 'PUT', { ...settings, enabled: true, groupA: { name: 'Hiện tại', imageId: images[0].id }, groupB: { name: 'Mới', imageId: images[0].id } })).status, 400, '2 nhóm cần 2 ảnh khác nhau.');
    const on = { ...settings, enabled: true, groupA: { name: 'Hiện tại', imageId: images[0].id }, groupB: { name: 'Mới', imageId: images[1].id } };
    assert.equal((await admin('/api/admin/extra', 'PUT', on)).status, 200);

    const extra = (await api('/api/survey')).data.extra;
    assert.equal(extra.groupA.image, images[0].image);
    assert.equal(extra.groupB.name, 'Mới');
    assert.equal(extra.images, undefined, 'Người làm khảo sát chỉ nhận 2 ảnh đang dùng.');
    const [choice, text, segment] = extra.questions;

    const missing = await api('/api/responses', 'POST', submission());
    assert.equal(missing.status, 409);
    assert.equal(missing.data.code, 'EXTRA_CHANGED', 'Bản nháp cũ được đưa về trả lời phần 2.4.');
    const good = { [choice.id]: 'B', [text.id]: 'Vì trông sang hơn nhiều', [segment.id]: { A: 'mainstream', B: 'premium' } };
    assert.equal((await api('/api/responses', 'POST', submission({ ...good, [choice.id]: 'C' }))).status, 400);
    assert.equal((await api('/api/responses', 'POST', submission({ ...good, [text.id]: 'ngắn' }))).status, 400);
    assert.equal((await api('/api/responses', 'POST', submission({ ...good, [segment.id]: { A: 'mainstream' } }))).status, 400);
    assert.equal((await api('/api/responses', 'POST', submission(good))).status, 201);
    assert.deepEqual(payloads.at(-1).extra, { groupA: 'Hiện tại', groupB: 'Mới', items: [
      { question: 'Bạn thích nhóm bao bì nào hơn?', answer: 'Nhóm B (Mới)' },
      { question: 'Lý do vì sao bạn thích nhóm bao bì đó?', answer: 'Vì trông sang hơn nhiều' },
      { question: 'Bạn xếp 2 nhóm bao bì này ở phân khúc nào?', answer: 'Nhóm A (Hiện tại): Mainstream; Nhóm B (Mới): Upper Mainstream' }
    ] });

    // Deleting an image in use turns 2.4 off and removes the file.
    assert.equal((await admin(`/api/admin/extra/images/${images[2].id}`, 'DELETE')).status, 200);
    assert.notEqual((await api('/api/survey')).data.extra, null, 'Xóa ảnh không dùng thì 2.4 vẫn bật.');
    const removed = await admin(`/api/admin/extra/images/${images[1].id}`, 'DELETE');
    assert.equal(removed.data.extra.enabled, false);
    assert.equal((await api('/api/survey')).data.extra, null);
    assert.equal((await fetch(base + images[1].image)).status, 404);
    assert.equal((await readdir(join(dir, 'images'))).length, 9 + 3);
    assert.equal((await api('/api/responses', 'POST', submission())).status, 201, 'Tắt 2.4 thì gửi như bình thường.');
  } finally { child.kill(); sheet.close(); await rm(dir, { recursive: true, force: true }); }
});
