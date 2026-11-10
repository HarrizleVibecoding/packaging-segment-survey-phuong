const app = document.querySelector('#app');
const dialog = document.querySelector('#zoomDialog');
const assignDialog = document.querySelector('#assignDialog');
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
let sheetConfigured = false;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const find = id => survey.products.find(p => p.id === id);
const total = () => groups.reduce((n, g) => n + selected[g.id].length, 0);
function persist() { sessionStorage.setItem('surveyDraft', JSON.stringify({ version: survey.version, selected, answers, submissionId, step })); }
function restore() {
  try {
    const d = JSON.parse(sessionStorage.getItem('surveyDraft'));
    if (!d?.selected || !d.answers) return;
    const validIds = new Set(survey.products.map(p => p.id));
    const used = new Set();
    for (const g of groups) {
      if (!Array.isArray(d.selected[g.id])) return;
      selected[g.id] = d.selected[g.id].filter(id => {
        if (!validIds.has(id) || used.has(id)) return false;
        used.add(id); return true;
      }).slice(0, 3);
    }
    for (const key of ['budget', 'mainstream', 'premium', 'premiumSignals']) answers[key] = typeof d.answers[key] === 'string' ? d.answers[key].slice(0, 3000) : '';
    submissionId = /^[a-f0-9-]{36}$/i.test(d.submissionId || '') ? d.submissionId : crypto.randomUUID();
    step = d.step === 'questions' && groups.every(g => selected[g.id].length === 3) ? 'questions' : 'sort';
  } catch { sessionStorage.removeItem('surveyDraft'); }
}
function hero(title, subtitle, eyebrow, number) { return `<section class="hero"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="sub">${subtitle}</p></div><span class="step">BƯỚC ${number} / 2</span></section>`; }
function renderSort() {
  const remaining = survey.products.filter(p => !groups.some(g => selected[g.id].includes(p.id)));
  const ready = groups.every(g => selected[g.id].length === 3);
  app.innerHTML = hero('Bạn cảm nhận bao bì thuộc phân khúc nào?', 'Chọn 3 bao bì cho mỗi nhóm. Kéo thả trên máy tính hoặc chạm vào ảnh rồi chọn nhóm trên điện thoại.', '01 / PHÂN LOẠI BAO BÌ', 1)
    + `<div class="toolbar"><div class="progress">Bạn đã chọn <span>${total()} / 9</span> bao bì</div><button id="next" class="button" ${ready && sheetConfigured ? '' : 'disabled'}>Tiếp tục →</button></div>`
    + (error ? `<p class="notice" role="alert">${esc(error)}</p>` : '')
    + `<div class="segments">${groups.map(g => `<section class="segment" data-drop="${g.id}" style="--accent:${g.color}"><div class="segment-title"><span class="dot"></span>${g.name}<span class="count">${selected[g.id].length}/3</span></div>${selected[g.id].length ? `<div class="slot-items">${selected[g.id].map(id => { const p = find(id); return p ? `<div class="slot"><img src="${esc(p.image)}" alt=""><span title="${esc(p.name)}">${esc(p.name)}</span><button class="slot-zoom" data-zoom="${id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><button data-remove="${id}" aria-label="Bỏ ${esc(p.name)}">×</button></div>` : ''; }).join('')}</div>` : `<div class="hint">Thả bao bì vào đây</div>`}</section>`).join('')}</div>`
    + `<section class="pool"><div class="pool-head"><h2>Bao bì chờ bạn chọn nhóm <span>${remaining.length}</span></h2><small>Nhấn kính lúp để xem ảnh lớn</small></div><div class="cards">${remaining.map((p, i) => `<div class="card" draggable="true" data-id="${p.id}" tabindex="0"><span class="badge">${i + 1}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><button class="zoom" data-zoom="${p.id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><span class="card-name">${esc(p.name)}</span><div class="assign">${groups.map(g => `<button data-assign="${g.id}" data-id="${p.id}" aria-label="Xếp ${esc(p.name)} vào ${g.name}">${g.short}</button>`).join('')}</div></div>`).join('')}</div></section>`;
  app.querySelector('#next').onclick = () => { step = 'questions'; persist(); render(); window.scrollTo(0, 0); };
  app.querySelectorAll('[data-assign]').forEach(b => b.onclick = e => { e.stopPropagation(); assign(b.dataset.id, b.dataset.assign); });
  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { groups.forEach(g => selected[g.id] = selected[g.id].filter(id => id !== b.dataset.remove)); persist(); renderSort(); });
  app.querySelectorAll('[data-zoom]').forEach(b => b.onclick = e => { e.stopPropagation(); zoom(b.dataset.zoom); });
  app.querySelectorAll('.card').forEach(card => { card.ondragstart = e => e.dataTransfer.setData('text/plain', card.dataset.id); card.onclick = e => { if (!e.target.closest('button')) openAssign(card.dataset.id); }; card.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openAssign(card.dataset.id); } }; });
  app.querySelectorAll('[data-drop]').forEach(zone => { zone.ondragover = e => e.preventDefault(); zone.ondrop = e => { e.preventDefault(); assign(e.dataTransfer.getData('text/plain'), zone.dataset.drop); }; });
}
function assign(id, group) { if (!find(id) || !groups.some(g => g.id === group)) return; if (!selected[group].includes(id) && selected[group].length >= 3) { error = 'Mỗi nhóm chỉ nhận tối đa 3 bao bì.'; renderSort(); return; } groups.forEach(g => selected[g.id] = selected[g.id].filter(x => x !== id)); selected[group].push(id); error = ''; persist(); renderSort(); }
function openAssign(id) { const p = find(id); if (!p) return; assignDialog.querySelector('#assignCaption').textContent = p.name; assignDialog.querySelector('#assignOptions').innerHTML = groups.map(g => `<button class="button" data-group="${g.id}" ${selected[g.id].length >= 3 ? 'disabled' : ''}>${g.name} · ${selected[g.id].length}/3</button>`).join(''); assignDialog.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { assignDialog.close(); assign(id, b.dataset.group); }); assignDialog.showModal(); }
assignDialog.querySelector('#closeAssign').onclick = () => assignDialog.close();
assignDialog.onclick = e => { if (e.target === assignDialog) assignDialog.close(); };
function zoom(id) { const p = find(id); if (!p) return; document.querySelector('#zoomImage').src = p.image; document.querySelector('#zoomImage').alt = p.name; document.querySelector('#zoomCaption').textContent = p.name; dialog.showModal(); }
document.querySelector('#closeZoom').onclick = () => dialog.close(); dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
function renderQuestions() {
  app.innerHTML = hero('Điều gì khiến bạn xếp như vậy?', 'Không có câu trả lời đúng hay sai. Hãy chia sẻ cảm nhận thật của bạn về hình ảnh, màu sắc và thiết kế.', '02 / LÝ DO & CẢM NHẬN', 2)
    + (error ? `<p class="notice">${esc(error)}</p>` : '')
    + `<div class="questions">${groups.map((g, i) => `<div class="question"><label for="q-${g.id}">0${i + 1}. Vì sao bạn xếp các bao bì này vào nhóm ${g.name}?</label><p>Nhìn lại những bao bì bạn đã chọn trước khi trả lời.</p><div class="mini-products">${selected[g.id].map(id => `<button data-zoom="${id}" aria-label="Phóng to ${esc(find(id)?.name)}"><img src="${esc(find(id)?.image)}" alt="${esc(find(id)?.name)}"></button>`).join('')}</div><textarea id="q-${g.id}" data-answer="${g.id}" maxlength="3000" placeholder="Chia sẻ lý do của bạn...">${esc(answers[g.id])}</textarea></div>`).join('')}<div class="question"><label for="q-premiumSignals">04. Điều gì khiến bạn nghĩ một bao bì thuộc phân khúc Upper Mainstream? Những dấu hiệu nào giúp bạn nhận diện điều đó?</label><p>Hãy mô tả các chi tiết cụ thể mà bạn quan sát được.</p><textarea id="q-premiumSignals" data-answer="premiumSignals" maxlength="3000" placeholder="Những chi tiết khiến bạn nhận ra phân khúc Upper Mainstream...">${esc(answers.premiumSignals)}</textarea></div></div><div class="actions"><button id="back" class="button secondary">← Quay lại</button><button id="submit" class="button" ${sheetConfigured ? '' : 'disabled'}>Gửi phản hồi →</button></div>`;
  app.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => zoom(b.dataset.zoom));
  app.querySelectorAll('[data-answer]').forEach(t => t.oninput = () => { answers[t.dataset.answer] = t.value; persist(); });
  app.querySelector('#back').onclick = () => { error = ''; step = 'sort'; persist(); render(); window.scrollTo(0, 0); };
  app.querySelector('#submit').onclick = submit;
}
async function submit() {
  if (Object.values(answers).some(v => v.trim().length < 10)) { error = 'Vui lòng trả lời đủ 4 câu hỏi, mỗi câu ít nhất 10 ký tự.'; renderQuestions(); return; }
  const button = app.querySelector('#submit'); button.disabled = true; button.textContent = 'Đang gửi…'; error = '';
  try { const response = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId, surveyVersion: survey.version, selections: selected, answers }) }); const result = await response.json(); if (response.status === 409 && result.code === 'SURVEY_CHANGED') { const latest = await fetch('/api/survey'); if (latest.ok) { survey = await latest.json(); sheetConfigured = survey.acceptingResponses; groups.forEach(g => selected[g.id] = selected[g.id].filter(id => find(id))); step = 'sort'; error = result.error; persist(); render(); return; } } if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể gửi phản hồi.'); step = 'done'; sessionStorage.removeItem('surveyDraft'); render(); window.scrollTo(0, 0); }
  catch (e) { error = `${e.message} Câu trả lời của bạn vẫn được giữ lại. Hãy thử gửi lại.`; renderQuestions(); }
}
function renderAdmin() {
  const token = sessionStorage.getItem('adminToken') || '';
  if (!adminUnlocked) {
    app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Nhập mã quản trị</h1><p class="sub">Chỉ người có mã đúng mới có thể thêm hoặc xóa hình ảnh bao bì.</p></div></section><section class="panel" style="max-width:420px;margin:20px 0 45px"><label class="field">Mã quản trị<input id="adminCode" type="password" value="${esc(token)}" autocomplete="off" placeholder="Nhập mã quản trị"></label><button id="unlockAdmin" class="button">Mở quản trị →</button><p id="adminMessage" class="sub" style="margin-top:15px"></p></section>`;
    const input = app.querySelector('#adminCode'), message = app.querySelector('#adminMessage');
    const unlock = async () => { const code = input.value.trim(); const button = app.querySelector('#unlockAdmin'); button.disabled = true; message.textContent = ''; try { const r = await fetch('/api/admin/status', { headers: { Authorization: `Bearer ${code}` } }); if (!r.ok) { message.textContent = 'Mã quản trị không đúng.'; return; } const status = await r.json(); sheetConfigured = status.sheetConfigured; sessionStorage.setItem('adminToken', code); adminUnlocked = true; renderAdmin(); } catch { message.textContent = 'Không thể kết nối máy chủ. Vui lòng thử lại.'; } finally { button.disabled = false; } };
    app.querySelector('#unlockAdmin').onclick = unlock;
    input.onkeydown = e => { if (e.key === 'Enter') unlock(); };
    return;
  }
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Thư viện bao bì</h1><p class="sub">Tải ảnh của bạn lên. Mỗi lần thay đổi danh sách sẽ tạo phiên bản khảo sát mới.</p></div><button id="lockAdmin" class="button secondary">Khóa quản trị</button></section>${sheetConfigured ? '' : '<p class="notice">Khảo sát tạm chưa nhận phản hồi vì Google Sheet chưa được kết nối. Vui lòng quay lại sau.</p>'}${survey.products.length < 9 ? `<p class="notice">Hiện có ${survey.products.length} ảnh. Người quản trị cần tải lên ít nhất 9 ảnh để bắt đầu khảo sát.</p>` : ''}<div class="admin-grid"><section class="panel"><h2>Thêm bao bì</h2><label class="field">Tên Brand/Packaging<input id="name" maxlength="100" placeholder="Ví dụ: Khăn giấy gói A"></label><label class="field">Hình ảnh (PNG, JPG, WebP; tối đa 3 MB)<input id="image" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="upload" class="button" ${survey.products.length >= 30 ? "disabled" : ""}>Tải ảnh lên</button><p id="adminMessage" class="sub" style="margin-top:16px"></p></section><section class="panel"><h2>Danh sách ảnh · ${survey.products.length}/30</h2><div class="admin-list">${survey.products.map(p => `<div class="admin-item"><img src="${esc(p.image)}" alt="${esc(p.name)}"><strong title="${esc(p.name)}">${esc(p.name)}</strong><button data-delete="${p.id}">Xóa khỏi khảo sát</button></div>`).join('')}</div>${survey.products.length ? '' : '<p class="sub">Chưa có ảnh nào. Hãy thêm ít nhất 9 ảnh.</p>'}</section></div><div class="actions"><a href="/" class="button secondary" style="text-decoration:none">← Xem khảo sát</a></div>`;
  const message = app.querySelector('#adminMessage');
  if (survey.products.length >= 30) message.textContent = 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.';
  app.querySelector('#lockAdmin').onclick = () => { adminUnlocked = false; sessionStorage.removeItem('adminToken'); renderAdmin(); };
  app.querySelector('#upload').onclick = async () => { if (survey.products.length >= 30) { message.textContent = 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.'; return; } const name = app.querySelector('#name').value.trim(), image = app.querySelector('#image').files[0]; if (!name || !image) { message.textContent = 'Vui lòng nhập tên và chọn ảnh.'; return; } if (image.size > 3_000_000) { message.textContent = 'Ảnh tối đa 3 MB.'; return; } const button = app.querySelector('#upload'); button.disabled = true; message.textContent = 'Đang tải ảnh…'; try { const data = await new Promise((ok, fail) => { const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = fail; reader.readAsDataURL(image); }); const r = await fetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` }, body: JSON.stringify({ name, image: data }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error); survey = result; sessionStorage.removeItem('surveyDraft'); renderAdmin(); } catch (e) { message.textContent = e.message; button.disabled = false; } };
  app.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if (!confirm('Xóa bao bì này khỏi khảo sát hiện tại?')) return; b.disabled = true; try { const r = await fetch(`/api/admin/products/${b.dataset.delete}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` } }); const result = await r.json(); if (!r.ok) throw new Error(result.error); survey = result; sessionStorage.removeItem('surveyDraft'); renderAdmin(); } catch (e) { message.textContent = e.message || 'Không thể xóa ảnh. Vui lòng thử lại.'; b.disabled = false; } });
}
function render() { if (location.hash === '#admin') renderAdmin(); else if (step === 'questions') renderQuestions(); else if (step === 'done') app.innerHTML = `<section class="success"><div class="icon">✓</div><h1>Cảm ơn bạn đã chia sẻ!</h1><p class="sub">Phản hồi của bạn đã được ghi nhận. Những cảm nhận này sẽ giúp phát triển thiết kế bao bì phù hợp hơn.</p></section>`; else renderSort(); }
window.onhashchange = render;
try { const r = await fetch('/api/survey'); if (!r.ok) throw new Error(); survey = await r.json(); sheetConfigured = Boolean(survey.acceptingResponses); restore(); render(); } catch { app.innerHTML = '<p class="notice" style="margin-top:35px">Không thể tải khảo sát. Vui lòng thử lại sau.</p>'; }

