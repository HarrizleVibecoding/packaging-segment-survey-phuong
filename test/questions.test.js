import test from 'node:test';
import assert from 'node:assert/strict';

test('lý do hiển thị từng nhóm, giữ câu trả lời và số bao bì', async () => {
  const products = Array.from({ length: 9 }, (_, i) => ({ id: `p${i + 1}`, name: `Bao bì ${i + 1}`, image: `/image-${i + 1}.png` }));
  const selected = { budget: ['p1', 'p2', 'p3'], mainstream: ['p4', 'p5', 'p6'], premium: ['p7', 'p8', 'p9'] };
  const answers = { budget: 'Lý do Economy đầy đủ', mainstream: 'Lý do Mainstream đầy đủ', premium: 'Lý do Upper Mainstream đầy đủ', premiumSignals: 'Dấu hiệu nhận diện đầy đủ' };
  const values = new Map([['surveyDraft', JSON.stringify({ version: 1, selected, answers, submissionId: crypto.randomUUID(), step: 'questions', questionIndex: 0 })]]);
  const controls = new Map();
  const control = id => { if (!controls.has(id)) controls.set(id, { focus() {} }); return controls.get(id); };
  const app = { innerHTML: '', querySelector: control, querySelectorAll: () => [] };
  const dialog = { querySelector: control };
  globalThis.document = { querySelector: id => id === '#app' ? app : dialog };
  globalThis.window = { scrollTo() {} };
  globalThis.location = { hash: '' };
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 1, products, acceptingResponses: true }) });

  await import(`../public/app.js?test=${crypto.randomUUID()}`);
  assert.match(app.innerHTML, /nhóm Economy/);
  assert.doesNotMatch(app.innerHTML, /Đánh giá của bạn cho nhóm Mainstream/);
  assert.match(app.innerHTML, /product-badge">01/);
  assert.match(app.innerHTML, /product-badge">03/);
  assert.doesNotMatch(app.innerHTML, /product-badge">04/);

  control('#nextQuestion').onclick();
  assert.match(app.innerHTML, /Đánh giá của bạn cho nhóm Mainstream/);
  assert.match(app.innerHTML, /product-badge">04/);
  control('#nextQuestion').onclick();
  assert.match(app.innerHTML, /Đánh giá của bạn cho nhóm Upper Mainstream/);
  control('#nextQuestion').onclick();
  assert.match(app.innerHTML, /Dấu hiệu nào giúp bạn nhận diện/);
  assert.match(app.innerHTML, /product-badge">09/);
  control('#back').onclick();
  assert.match(app.innerHTML, /Đánh giá của bạn cho nhóm Upper Mainstream/);
  assert.match(app.innerHTML, /Lý do Upper Mainstream đầy đủ/);
});

