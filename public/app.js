const app = document.querySelector('#app');
const dialog = document.querySelector('#zoomDialog');
const groups = [
  { id: 'budget', name: 'Economy', color: '#7b8f9b', short: 'Economy' },
  { id: 'mainstream', name: 'Mainstream', color: '#3187b5', short: 'Main' },
  { id: 'premium', name: 'Upper Mainstream', color: '#c69330', short: 'Upper M.' }
];
let survey = { version: 0, products: [] };
let selected = { budget: [], mainstream: [], premium: [] };
let answers = { budget: '', mainstream: '', premium: '', premiumSignals: '' };
let submissionId = crypto.randomUUID();
let step = 'sort';
let error = '';
let adminUnlocked = false;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const find = id => survey.products.find(p => p.id === id);
const total = () => groups.reduce((n, g) => n + selected[g.id].length, 0);
function persist() { sessionStorage.setItem('surveyDraft', JSON.stringify({ version: survey.version, selected, answers, submissionId, step })); }
function restore() { try { const d = JSON.parse(sessionStorage.getItem('surveyDraft')); if (d?.version === survey.version) { selected = d.selected; answers = d.answers; submissionId = d.submissionId; step = d.step === 'done' ? 'sort' : d.step; } } catch {} }
function hero(title, subtitle, eyebrow, number) { return `<section class="hero"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="sub">${subtitle}</p></div><span class="step">BƯỚC ${number} / 2</span></section>`; }
function renderSort() {
  const remaining = survey.products.filter(p => !groups.some(g => selected[g.id].includes(p.id)));
  const ready = groups.every(g => selected[g.id].length === 3);
  app.innerHTML = hero('Bạn cảm nhận bao bì thuộc phân khúc nào?', 'Chọn 3 bao bì cho mỗi nhóm. Kéo thả trên máy tính hoặc chạm vào ảnh rồi chọn nhóm trên điện thoại.', '01 / PHÂN LOẠI BAO BÌ', 1)
    + `<div class="toolbar"><div class="progress">Bạn đã chọn <span>${total()} / 9</span> bao bì</div><button id="next" class="button" ${ready ? '' : 'disabled'}>Tiếp tục →</button></div>`
    + (survey.products.length < 9 ? `<p class="notice">Hiện có ${survey.products.length} ảnh. Người quản trị cần tải lên ít nhất 9 ảnh để bắt đầu khảo sát.</p>` : '')
    + `<div class="segments">${groups.map(g => `<section class="segment" data-drop="${g.id}" style="--accent:${g.color}"><div class="segment-title"><span class="dot"></span>${g.name}<span class="count">${selected[g.id].length}/3</span></div>${selected[g.id].length ? `<div class="slot-items">${selected[g.id].map(id => { const p = find(id); return p ? `<div class="slot"><img src="${esc(p.image)}" alt=""><span title="${esc(p.name)}">${esc(p.name)}</span><button data-remove="${id}" aria-label="Bỏ ${esc(p.name)}">×</button></div>` : ''; }).join('')}</div>` : `<div class="hint">Thả bao bì vào đây</div>`}</section>`).join('')}</div>`
    + `<section class="pool"><div class="pool-head"><h2>Bao bì chờ bạn chọn nhóm <span>${remaining.length}</span></h2><small>Nhấn kính lúp để xem ảnh lớn</small></div><div class="cards">${remaining.map((p, i) => `<div class="card" draggable="true" data-id="${p.id}" tabindex="0"><span class="badge">${i + 1}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><button class="zoom" data-zoom="${p.id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><span class="card-name">${esc(p.name)}</span><div class="assign">${groups.map(g => `<button data-assign="${g.id}" data-id="${p.id}" aria-label="Xếp ${esc(p.name)} vào ${g.name}">${g.short}</button>`).join('')}</div></div>`).join('')}</div></section>`;
  app.querySelector('#next').onclick = () => { step = 'questions'; persist(); render(); window.scrollTo(0, 0); };
  app.querySelectorAll('[data-assign]').forEach(b => b.onclick = e => { e.stopPropagation(); assign(b.dataset.id, b.dataset.assign); });
  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { groups.forEach(g => selected[g.id] = selected[g.id].filter(id => id !== b.dataset.remove)); persist(); renderSort(); });
  app.querySelectorAll('[data-zoom]').forEach(b => b.onclick = e => { e.stopPropagation(); zoom(b.dataset.zoom); });
  app.querySelectorAll('.card').forEach(card => { card.ondragstart = e => e.dataTransfer.setData('text/plain', card.dataset.id); card.onkeydown = e => { if (e.key === 'Enter') card.querySelector('.assign button')?.focus(); }; });
  app.querySelectorAll('[data-drop]').forEach(zone => { zone.ondragover = e => e.preventDefault(); zone.ondrop = e => { e.preventDefault(); assign(e.dataTransfer.getData('text/plain'), zone.dataset.drop); }; });
}
function assign(id, group) { if (!find(id) || !groups.some(g => g.id === group)) return; groups.forEach(g => selected[g.id] = selected[g.id].filter(x => x !== id)); if (selected[group].length >= 3) { error = 'Mỗi nhóm chỉ nhận tối đa 3 bao bì.'; renderSort(); alert(error); return; } selected[group].push(id); persist(); renderSort(); }
function zoom(id) { const p = find(id); if (!p) return; document.querySelector('#zoomImage').src = p.image; document.querySelector('#zoomImage').alt = p.name; document.querySelector('#zoomCaption').textContent = p.name; dialog.showModal(); }
document.querySelector('#closeZoom').onclick = () => dialog.close(); dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
function renderQuestions() {
  app.innerHTML = hero('Điều gì khiến bạn xếp như vậy?', 'Không có câu trả lời đúng hay sai. Hãy chia sẻ cảm nhận thật của bạn về hình ảnh, màu sắc và thiết kế.', '02 / LÝ DO & CẢM NHẬN', 2)
    + (error ? `<p class="notice">${esc(error)}</p>` : '')
    + `<div class="questions">${groups.map((g, i) => `<div class="question"><label for="q-${g.id}">0${i + 1}. Vì sao bạn xếp các bao bì này vào nhóm ${g.name}?</label><p>Nhìn lại những bao bì bạn đã chọn trước khi trả lời.</p><div class="mini-products">${selected[g.id].map(id => `<img src="${esc(find(id)?.image)}" alt="${esc(find(id)?.name)}" title="${esc(find(id)?.name)}">`).join('')}</div><textarea id="q-${g.id}" data-answer="${g.id}" maxlength="3000" placeholder="Chia sẻ lý do của bạn...">${esc(answers[g.id])}</textarea></div>`).join('')}<div class="question"><label for="q-premiumSignals">04. Điều gì khiến bạn nghĩ một bao bì thuộc phân khúc Upper Mainstream? Những dấu hiệu nào giúp bạn nhận diện điều đó?</label><p>Hãy mô tả các chi tiết cụ thể mà bạn quan sát được.</p><textarea id="q-premiumSignals" data-answer="premiumSignals" maxlength="3000" placeholder="Những chi tiết khiến bạn nhận ra phân khúc Upper Mainstream...">${esc(answers.premiumSignals)}</textarea></div></div><div class="actions"><button id="back" class="button secondary">← Quay lại</button><button id="submit" class="button">Gửi phản hồi →</button></div>`;
  app.querySelectorAll('[data-answer]').forEach(t => t.oninput = () => { answers[t.dataset.answer] = t.value; persist(); });
  app.querySelector('#back').onclick = () => { error = ''; step = 'sort'; persist(); render(); window.scrollTo(0, 0); };
  app.querySelector('#submit').onclick = submit;
}
async function submit() {
  if (Object.values(answers).some(v => v.trim().length < 10)) { error = 'Vui lòng trả lời đủ 4 câu hỏi, mỗi câu ít nhất 10 ký tự.'; renderQuestions(); return; }
  const button = app.querySelector('#submit'); button.disabled = true; button.textContent = 'Đang gửi…'; error = '';
  try { const response = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId, surveyVersion: survey.version, selections: selected, answers }) }); const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể gửi phản hồi.'); step = 'done'; sessionStorage.removeItem('surveyDraft'); render(); window.scrollTo(0, 0); }
  catch (e) { error = `${e.message} Câu trả lời của bạn vẫn được giữ lại. Hãy thử gửi lại.`; renderQuestions(); }
}
function renderAdmin() {
  const token = sessionStorage.getItem('adminToken') || '';
  if (!adminUnlocked) {
    app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Nhập mã quản trị</h1><p class="sub">Chỉ người có mã đúng mới có thể thêm hoặc xóa hình ảnh bao bì.</p></div></section><section class="panel" style="max-width:420px;margin:20px 0 45px"><label class="field">Mã quản trị<input id="adminCode" type="password" value="${esc(token)}" autocomplete="off" placeholder="Nhập mã quản trị"></label><button id="unlockAdmin" class="button">Mở quản trị →</button><p id="adminMessage" class="sub" style="margin-top:15px"></p></section>`;
    const input = app.querySelector('#adminCode'), message = app.querySelector('#adminMessage');
    const unlock = async () => { const code = input.value.trim(); const r = await fetch('/api/admin/status', { headers: { Authorization: `Bearer ${code}` } }); if (!r.ok) { message.textContent = 'Mã quản trị không đúng.'; return; } sessionStorage.setItem('adminToken', code); adminUnlocked = true; renderAdmin(); };
    app.querySelector('#unlockAdmin').onclick = unlock;
    input.onkeydown = e => { if (e.key === 'Enter') unlock(); };
    return;
  }
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Thư viện bao bì</h1><p class="sub">Tải ảnh của bạn lên. Mỗi lần thay đổi danh sách sẽ tạo phiên bản khảo sát mới.</p></div><button id="lockAdmin" class="button secondary">Khóa quản trị</button></section><div class="admin-grid"><section class="panel"><h2>Thêm bao bì</h2><label class="field">Tên bao bì<input id="name" maxlength="100" placeholder="Ví dụ: Nước giặt A"></label><label class="field">Hình ảnh (PNG, JPG, WebP; tối đa 5 MB)<input id="image" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="upload" class="button">Tải ảnh lên</button><p id="adminMessage" class="sub" style="margin-top:16px"></p></section><section class="panel"><h2>Danh sách ảnh · ${survey.products.length}</h2><div class="admin-list">${survey.products.map(p => `<div class="admin-item"><img src="${esc(p.image)}" alt="${esc(p.name)}"><strong title="${esc(p.name)}">${esc(p.name)}</strong><button data-delete="${p.id}">Xóa khỏi khảo sát</button></div>`).join('')}</div>${survey.products.length ? '' : '<p class="sub">Chưa có ảnh nào. Hãy thêm ít nhất 9 ảnh.</p>'}</section></div><div class="actions"><a href="/" class="button secondary" style="text-decoration:none">← Xem khảo sát</a></div>`;
  const message = app.querySelector('#adminMessage');
  app.querySelector('#lockAdmin').onclick = () => { adminUnlocked = false; sessionStorage.removeItem('adminToken'); renderAdmin(); };
  app.querySelector('#upload').onclick = async () => { const name = app.querySelector('#name').value.trim(), image = app.querySelector('#image').files[0]; if (!name || !image) { message.textContent = 'Vui lòng nhập tên và chọn ảnh.'; return; } const button = app.querySelector('#upload'); button.disabled = true; message.textContent = 'Đang tải ảnh…'; try { const data = await new Promise((ok, fail) => { const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = fail; reader.readAsDataURL(image); }); const r = await fetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` }, body: JSON.stringify({ name, image: data }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error); survey = result; sessionStorage.removeItem('surveyDraft'); renderAdmin(); } catch (e) { message.textContent = e.message; button.disabled = false; } };
  app.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if (!confirm('Xóa bao bì này khỏi khảo sát hiện tại?')) return; const r = await fetch(`/api/admin/products/${b.dataset.delete}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` } }); const result = await r.json(); if (!r.ok) { message.textContent = result.error; return; } survey = result; sessionStorage.removeItem('surveyDraft'); renderAdmin(); });
}
function render() { if (location.hash === '#admin') renderAdmin(); else if (step === 'questions') renderQuestions(); else if (step === 'done') app.innerHTML = `<section class="success"><div class="icon">✓</div><h1>Cảm ơn bạn đã chia sẻ!</h1><p class="sub">Phản hồi của bạn đã được ghi nhận. Những cảm nhận này sẽ giúp phát triển thiết kế bao bì phù hợp hơn.</p></section>`; else renderSort(); }
window.onhashchange = render;
try { const r = await fetch('/api/survey'); survey = await r.json(); restore(); render(); } catch { app.innerHTML = '<p class="notice" style="margin-top:35px">Không thể tải khảo sát. Vui lòng thử lại sau.</p>'; }

