import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { initStorage, loadRegistry, saveRegistry, loadSurvey, saveSurvey, removeSurveyConfig, saveImage, removeImage, dataDir, blobMode, defaultSlug, isPreview } from './storage.js';

const root = resolve(import.meta.dirname);
const staticFiles = {
  'index.html': new URL('./public/index.html', import.meta.url),
  'app.js': new URL('./public/app.js', import.meta.url),
  'style.css': new URL('./public/style.css', import.meta.url)
};
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.VERCEL ? '0.0.0.0' : '127.0.0.1');
const adminToken = process.env.ADMIN_TOKEN || '';
const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
const webhookSecret = process.env.GOOGLE_SHEETS_SECRET || '';
const sheetReady = Boolean(webhook && webhookSecret);
const groups = ['budget', 'mainstream', 'premium'];
const maxProducts = 30;
const minProducts = 9;
const maxSurveys = 20;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
function tokenMatches(given) {
  if (!adminToken || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
const auth = req => tokenMatches(req.headers.authorization?.replace(/^Bearer /, '') || '');
function cleanSheet(value) { const s = String(value || '').trim(); return /^[=+\-@]/.test(s) ? `'${s}` : s; }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
// Load → change → save with an etag check, retrying when another request saved in between.
async function updateJson(load, save, change, firstLoad) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = attempt === 0 && firstLoad ? firstLoad : await load();
    const result = change(data);
    try { await save(data, etag); return { data, result }; }
    catch (error) {
      if (!(error instanceof BlobPreconditionFailedError)) throw error;
      if (attempt === 4) throw httpError(503, 'Dữ liệu đang được cập nhật. Vui lòng thử lại sau vài giây.');
    }
  }
}
async function updateSurvey(slug, change, firstLoad) {
  const { data, result } = await updateJson(() => loadSurvey(slug), (data, etag) => saveSurvey(slug, data, etag), data => { const result = change(data); data.version++; return result; }, firstLoad);
  return { survey: data, result };
}
const updateRegistry = change => updateJson(loadRegistry, saveRegistry, change);

function slugify(name) {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return slug || 'khao-sat';
}
const tabName = name => name.replace(/[\[\]*?:/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
// Production: the original survey writes to the first tab (gid 0), others to a tab named after them.
// Preview deployments always write to "TEST - ..." tabs so test answers never mix with real ones.
const sheetTabFor = meta => isPreview ? `TEST - ${meta.sheetTab || tabName(meta.name)}` : meta.sheetTab;
function requestedSlug(value) {
  const slug = value || defaultSlug;
  if (typeof slug !== 'string' || slug.length > 40 || !slugPattern.test(slug)) throw httpError(404, 'Không tìm thấy khảo sát.');
  return slug;
}
async function surveyMeta(slug) {
  const meta = (await loadRegistry()).data.surveys.find(s => s.slug === slug);
  if (!meta) throw httpError(404, 'Không tìm thấy khảo sát.');
  return meta;
}
const accepting = (meta, survey) => sheetReady && meta.open && survey.products.length >= minProducts;

function validateSubmission(input, survey) {
  if (!input || typeof input !== 'object' || !/^[a-f0-9-]{36}$/i.test(input.submissionId || '')) throw new Error('Mã phản hồi không hợp lệ.');
  if (!Number.isSafeInteger(input.surveyVersion) || input.surveyVersion < 0 || input.surveyVersion > survey.version) throw new Error('Phiên bản khảo sát không hợp lệ.');
  const selected = input.selections;
  if (!selected || typeof selected !== 'object') throw new Error('Vui lòng phân loại bao bì.');
  const all = [];
  for (const group of groups) {
    if (!Array.isArray(selected[group]) || selected[group].length !== 3) throw new Error('Mỗi nhóm cần đúng 3 bao bì.');
    all.push(...selected[group]);
  }
  if (new Set(all).size !== 9 || all.some(id => !survey.products.some(p => p.id === id))) throw new Error('Lựa chọn bao bì không hợp lệ.');
  const answers = input.answers;
  if (!answers || groups.some(key => typeof answers[key] !== 'string' || answers[key].trim().length < 10 || answers[key].length > 3000)) throw new Error('Vui lòng trả lời đủ 3 câu hỏi (ít nhất 10 ký tự mỗi câu).');
  const respondent = input.respondent;
  if (!respondent || typeof respondent.name !== 'string' || respondent.name.trim().length < 2 || respondent.name.length > 100) throw new Error('Vui lòng nhập Họ và Tên (ít nhất 2 ký tự).');
  if (typeof respondent.phone !== 'string' || respondent.phone.length > 30) throw new Error('SĐT không hợp lệ.');
  const phone = respondent.phone.trim();
  if (phone && (!/^[+()\d .-]{6,30}$/.test(phone) || (phone.match(/\d/g) || []).length < 7 || (phone.match(/\d/g) || []).length > 15)) throw new Error('SĐT chưa đúng định dạng. Bạn có thể sửa hoặc để trống.');
  const selectionNames = Object.fromEntries(groups.map(group => [group, selected[group].map(id => survey.products.find(p => p.id === id).name)]));
  return { submissionId: input.submissionId, submittedAt: new Date().toISOString(), surveyVersion: input.surveyVersion, selections: selected, selectionNames, answers: { ...Object.fromEntries(groups.map(key => [key, cleanSheet(answers[key])])), premiumSignals: '' }, respondent: { name: cleanSheet(respondent.name), phone: cleanSheet(phone) } };
}
async function alreadySubmitted(id) { if (blobMode || !existsSync(responseFile)) return false; return (await readFile(responseFile, 'utf8')).split('\n').some(line => line.includes(`"submissionId":"${id}"`)); }
// Named tabs send the secret as "auth": an Apps Script that predates multi-survey support rejects
// those requests (unauthorized) instead of silently writing them into the first tab.
async function sendToSheet(record) {
  if (!sheetReady) throw new Error('Google Sheets chưa được cấu hình trên máy chủ.');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...record, ...(record.sheetTab ? { auth: webhookSecret } : { secret: webhookSecret }) }), signal: controller.signal });
    const result = await response.json().catch(() => ({ error: `non-JSON response (HTTP ${response.status})` }));
    if (!response.ok || result.ok !== true) {
      console.error('Google Sheets rejected response', { status: response.status, tab: record.sheetTab || '(gid 0)', error: result.error });
      throw new Error(result.error === 'unauthorized' && record.sheetTab ? 'Google Sheets từ chối phản hồi (Apps Script có thể chưa được cập nhật bản mới).' : 'Google Sheets từ chối phản hồi.');
    }
  } finally { clearTimeout(timeout); }
}
async function adminSurveyList() {
  const { data } = await loadRegistry();
  return Promise.all(data.surveys.map(async meta => {
    const { data: survey } = await loadSurvey(meta.slug);
    return { slug: meta.slug, name: meta.name, open: meta.open, productCount: survey.products.length, acceptingResponses: accepting(meta, survey), sheetTab: sheetTabFor(meta) || 'Trang đầu tiên (gid 0)' };
  }));
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
    if (req.method === 'GET' && path === '/api/survey') {
      const slug = requestedSlug(url.searchParams.get('s')), meta = await surveyMeta(slug), { data } = await loadSurvey(slug);
      return json(res, 200, { ...data, slug, name: meta.name, open: meta.open, acceptingResponses: accepting(meta, data) });
    }
    if (req.method === 'GET' && path === '/api/admin/status') return json(res, auth(req) ? 200 : 401, { ok: auth(req), sheetConfigured: sheetReady, adminConfigured: Boolean(adminToken), preview: isPreview });
    if (path === '/api/admin/surveys' || path.startsWith('/api/admin/surveys/') || path.startsWith('/api/admin/products')) {
      if (!auth(req)) return json(res, 401, { error: 'Mã quản trị không đúng hoặc chưa được cấu hình.' });
    }
    if (req.method === 'GET' && path === '/api/admin/surveys') return json(res, 200, { surveys: await adminSurveyList() });
    if (req.method === 'POST' && path === '/api/admin/surveys') {
      const input = await body(req, 10_000);
      const name = typeof input?.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
      if (name.length < 2 || name.length > 60) throw new Error('Tên khảo sát cần từ 2 đến 60 ký tự.');
      const { result: created } = await updateRegistry(data => {
        if (data.surveys.length >= maxSurveys) throw httpError(409, `Tối đa ${maxSurveys} khảo sát.`);
        if (data.surveys.some(s => s.name.toLowerCase() === name.toLowerCase())) throw httpError(409, 'Đã có khảo sát cùng tên.');
        const base = slugify(name); let slug = base;
        for (let i = 2; data.surveys.some(s => s.slug === slug); i++) slug = `${base}-${i}`;
        let sheetTab = tabName(name) || slug;
        for (let i = 2; data.surveys.some(s => s.sheetTab === sheetTab); i++) sheetTab = `${tabName(name)} (${i})`;
        const meta = { slug, name, sheetTab, open: true };
        data.surveys.push(meta);
        return meta;
      });
      return json(res, 201, { survey: created, surveys: await adminSurveyList() });
    }
    // Deleting needs the admin code typed again (not just the stored session), and the original
    // survey behind the root link cannot be deleted. Responses already in Google Sheets are kept.
    if (req.method === 'DELETE' && path.startsWith('/api/admin/surveys/')) {
      const slug = requestedSlug(path.split('/').at(-1)), input = await body(req, 10_000);
      if (!tokenMatches(input?.confirm)) throw httpError(403, 'Mã quản trị nhập lại không đúng.');
      if (slug === defaultSlug) throw httpError(409, 'Không thể xóa khảo sát gốc (link chính). Bạn có thể đóng khảo sát này.');
      await updateRegistry(data => {
        if (!data.surveys.some(s => s.slug === slug)) throw httpError(404, 'Không tìm thấy khảo sát.');
        data.surveys = data.surveys.filter(s => s.slug !== slug);
      });
      const { data: survey } = await loadSurvey(slug);
      await Promise.all(survey.products.map(p => removeImage(p.image).catch(error => console.error('Ảnh không thể xóa khỏi kho:', error))));
      await removeSurveyConfig(slug).catch(error => console.error('Không thể xóa cấu hình khảo sát:', error));
      return json(res, 200, { surveys: await adminSurveyList() });
    }
    if (req.method === 'PATCH' && path.startsWith('/api/admin/surveys/')) {
      const slug = requestedSlug(path.split('/').at(-1)), input = await body(req, 10_000);
      if (typeof input?.open !== 'boolean') throw new Error('Trạng thái không hợp lệ.');
      await updateRegistry(data => {
        const meta = data.surveys.find(s => s.slug === slug);
        if (!meta) throw httpError(404, 'Không tìm thấy khảo sát.');
        meta.open = input.open;
      });
      return json(res, 200, { surveys: await adminSurveyList() });
    }
    if (req.method === 'POST' && path === '/api/admin/products') {
      const slug = requestedSlug(url.searchParams.get('s')); await surveyMeta(slug);
      const input = await body(req);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || typeof input.image !== 'string') throw new Error('Tên hoặc ảnh không hợp lệ.');
      const match = input.image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error('Chỉ nhận ảnh PNG, JPEG hoặc WebP.');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 3_000_000) throw new Error('Ảnh tối đa 3 MB.');
      const kind = match[1];
      const valid = kind === 'png' ? bytes.subarray(0, 4).equals(Buffer.from([137,80,78,71])) : kind === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new Error('Nội dung ảnh không hợp lệ.');
      const id = randomUUID(), ext = kind === 'jpeg' ? 'jpg' : kind;
      const firstLoad = await loadSurvey(slug);
      if (firstLoad.data.products.length >= maxProducts) throw httpError(409, 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.');
      const image = await saveImage(id, ext, bytes);
      try {
        const { survey } = await updateSurvey(slug, data => {
          if (data.products.length >= maxProducts) throw httpError(409, 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.');
          data.products.push({ id, name: input.name.trim(), image });
        }, firstLoad);
        return json(res, 201, survey);
      } catch (error) { await removeImage(image).catch(() => {}); throw error; }
    }
    if (req.method === 'DELETE' && path.startsWith('/api/admin/products/')) {
      const slug = requestedSlug(url.searchParams.get('s')); await surveyMeta(slug);
      const id = path.split('/').at(-1);
      const { survey, result: removed } = await updateSurvey(slug, data => {
        const removed = data.products.find(p => p.id === id);
        if (!removed) throw httpError(404, 'Không tìm thấy bao bì.');
        data.products = data.products.filter(p => p.id !== id);
        return removed;
      });
      await removeImage(removed.image).catch(error => console.error('Ảnh không thể xóa khỏi kho:', error));
      return json(res, 200, survey);
    }
    if (req.method === 'POST' && path === '/api/responses') {
      const input = await body(req, 100_000);
      const slug = requestedSlug(input?.survey), meta = await surveyMeta(slug), { data: survey } = await loadSurvey(slug);
      if (input?.surveyVersion !== survey.version && groups.some(group => input?.selections?.[group]?.some(id => !survey.products.some(p => p.id === id)))) return json(res, 409, { code: 'SURVEY_CHANGED', error: 'Một bao bì đã chọn không còn trong khảo sát. Vui lòng chọn lại.' });
      if (!meta.open) return json(res, 409, { code: 'SURVEY_CLOSED', error: 'Khảo sát này đã đóng, không nhận thêm phản hồi.' });
      if (!sheetReady) return json(res, 503, { error: 'Khảo sát chưa sẵn sàng nhận phản hồi.' });
      const record = { survey: slug, surveyName: meta.name, sheetTab: sheetTabFor(meta), ...validateSubmission(input, survey) };
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
      // Survey links (/s/<slug>) serve the same page; the frontend reads the slug from the URL.
      const requested = path === '/' || /^\/s\/[a-z0-9-]+\/?$/.test(path) ? 'index.html' : path.slice(1);
      if (!staticFiles[requested]) return json(res, 404, { error: 'Không tìm thấy.' });
      const bytes = await readFile(staticFiles[requested]); res.writeHead(200, { 'Content-Type': mime[extname(requested)] }); return res.end(bytes);
    }
    json(res, 404, { error: 'Không tìm thấy.' });
  } catch (error) { json(res, error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.message || 'Có lỗi xảy ra.' }); }
}
export default handler;
if (process.env.VERCEL !== '1') createServer(handler).listen(port, host, () => console.log(`Survey: http://${host}:${port}`));
export { validateSubmission, cleanSheet, slugify };
