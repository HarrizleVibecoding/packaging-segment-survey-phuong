import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { initStorage, loadSurvey, saveSurvey, saveImage, dataDir, blobMode } from './storage.js';

const root = resolve(import.meta.dirname);
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const adminToken = process.env.ADMIN_TOKEN || '';
const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
const webhookSecret = process.env.GOOGLE_SHEETS_SECRET || '';
const groups = ['budget', 'mainstream', 'premium'];
const responseFile = join(dataDir, 'responses.jsonl');
const pendingSubmissions = new Set();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
await initStorage();

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req, max = 8_000_000) {
  let text = '';
  for await (const part of req) { text += part; if (text.length > max) throw new Error('Dữ liệu quá lớn.'); }
  return JSON.parse(text);
}
function auth(req) {
  if (!adminToken) return false;
  const given = req.headers.authorization?.replace(/^Bearer /, '') || '';
  const a = Buffer.from(given), b = Buffer.from(adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cleanSheet(value) { const s = String(value || '').trim(); return /^[=+\-@]/.test(s) ? `'${s}` : s; }
function validateSubmission(input, survey) {
  if (!input || typeof input !== 'object' || !/^[a-f0-9-]{36}$/i.test(input.submissionId || '')) throw new Error('Mã phản hồi không hợp lệ.');
  if (input.surveyVersion !== survey.version) throw new Error('Bộ ảnh đã thay đổi. Vui lòng tải lại khảo sát.');
  const selected = input.selections;
  if (!selected || typeof selected !== 'object') throw new Error('Vui lòng phân loại bao bì.');
  const all = [];
  for (const group of groups) {
    if (!Array.isArray(selected[group]) || selected[group].length !== 3) throw new Error('Mỗi nhóm cần đúng 3 bao bì.');
    all.push(...selected[group]);
  }
  if (new Set(all).size !== 9 || all.some(id => !survey.products.some(p => p.id === id))) throw new Error('Lựa chọn bao bì không hợp lệ.');
  const answers = input.answers;
  if (!answers || groups.concat('premiumSignals').some(key => typeof answers[key] !== 'string' || answers[key].trim().length < 10 || answers[key].length > 3000)) throw new Error('Vui lòng trả lời đủ 4 câu hỏi (ít nhất 10 ký tự mỗi câu).');
  const selectionNames = Object.fromEntries(groups.map(group => [group, selected[group].map(id => survey.products.find(p => p.id === id).name)]));
  return { submissionId: input.submissionId, submittedAt: new Date().toISOString(), surveyVersion: survey.version, selections: selected, selectionNames, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, cleanSheet(v)])) };
}
async function alreadySubmitted(id) { if (blobMode || !existsSync(responseFile)) return false; return (await readFile(responseFile, 'utf8')).split('\n').some(line => line.includes(`"submissionId":"${id}"`)); }
async function sendToSheet(record) {
  if (!webhook) throw new Error('Google Sheets chưa được cấu hình trên máy chủ.');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...record, secret: webhookSecret }), signal: controller.signal });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error('Google Sheets từ chối phản hồi.');
  } finally { clearTimeout(timeout); }
}
export async function handler(req, res) {
  try {
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (req.method === 'GET' && path === '/api/survey') { const { data } = await loadSurvey(); return json(res, 200, data); }
    if (req.method === 'GET' && path === '/api/admin/status') return json(res, auth(req) ? 200 : 401, { ok: auth(req), sheetConfigured: Boolean(webhook), adminConfigured: Boolean(adminToken) });
    if (req.method === 'POST' && path === '/api/admin/products') {
      if (!auth(req)) return json(res, 401, { error: 'Mã quản trị không đúng hoặc chưa được cấu hình.' });
      const input = await body(req);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || typeof input.image !== 'string') throw new Error('Tên hoặc ảnh không hợp lệ.');
      const match = input.image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error('Chỉ nhận ảnh PNG, JPEG hoặc WebP.');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 5_000_000) throw new Error('Ảnh tối đa 5 MB.');
      const kind = match[1];
      const valid = kind === 'png' ? bytes.subarray(0, 4).equals(Buffer.from([137,80,78,71])) : kind === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new Error('Nội dung ảnh không hợp lệ.');
      const id = randomUUID(), ext = kind === 'jpeg' ? 'jpg' : kind;
      const image = await saveImage(id, ext, bytes);
      const { data: survey, etag } = await loadSurvey(); survey.products.push({ id, name: input.name.trim(), image }); survey.version++;
      await saveSurvey(survey, etag); return json(res, 201, survey);
    }
    if (req.method === 'DELETE' && path.startsWith('/api/admin/products/')) {
      if (!auth(req)) return json(res, 401, { error: 'Không có quyền quản trị.' });
      const id = path.split('/').at(-1), { data: survey, etag } = await loadSurvey(), length = survey.products.length;
      survey.products = survey.products.filter(p => p.id !== id);
      if (length === survey.products.length) return json(res, 404, { error: 'Không tìm thấy bao bì.' });
      survey.version++; await saveSurvey(survey, etag); return json(res, 200, survey);
    }
    if (req.method === 'POST' && path === '/api/responses') {
      const input = await body(req, 100_000), { data: survey } = await loadSurvey();
      const record = validateSubmission(input, survey);
      if (await alreadySubmitted(record.submissionId)) return json(res, 200, { ok: true, duplicate: true });
      if (pendingSubmissions.has(record.submissionId)) return json(res, 409, { error: 'Phản hồi đang được gửi. Vui lòng chờ.' });
      pendingSubmissions.add(record.submissionId);
      try {
        await sendToSheet(record);
        if (!blobMode) await appendFile(responseFile, JSON.stringify(record) + '\n');
        return json(res, 201, { ok: true });
      } finally { pendingSubmissions.delete(record.submissionId); }
    }
    if (req.method === 'GET' && path.startsWith('/images/')) {
      const filename = path.slice(8); if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename)) return json(res, 404, { error: 'Không tìm thấy ảnh.' });
      const bytes = await readFile(join(dataDir, 'images', filename)); res.writeHead(200, { 'Content-Type': mime[extname(filename)], 'Cache-Control': 'public, max-age=86400' }); return res.end(bytes);
    }
    if (req.method === 'GET') {
      const requested = path === '/' ? 'index.html' : path.slice(1);
      if (!['index.html', 'app.js', 'style.css'].includes(requested)) return json(res, 404, { error: 'Không tìm thấy.' });
      const bytes = await readFile(join(publicDir, requested)); res.writeHead(200, { 'Content-Type': mime[extname(requested)] }); return res.end(bytes);
    }
    json(res, 404, { error: 'Không tìm thấy.' });
  } catch (error) { json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message || 'Có lỗi xảy ra.' }); }
}
if (process.env.VERCEL !== '1') createServer(handler).listen(port, host, () => console.log(`Survey: http://${host}:${port}`));
export { validateSubmission, cleanSheet };

