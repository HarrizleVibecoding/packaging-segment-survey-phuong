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
let answers = { budget: '', mainstream: '', premium: '' };
let respondent = { name: '', phone: '' };
let submissionId = crypto.randomUUID();
let step = 'sort';
let questionIndex = 0;
let error = '';
let adminUnlocked = false;
let sheetConfigured = false;
let responseEndpoint = '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const find = id => survey.products.find(p => p.id === id);
const productNumber = id => String(survey.products.findIndex(p => p.id === id) + 1).padStart(2, '0');
const total = () => groups.reduce((n, g) => n + selected[g.id].length, 0);
function persist() { sessionStorage.setItem('surveyDraft', JSON.stringify({ version: survey.version, selected, answers, respondent, submissionId, step, questionIndex })); }
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
    for (const key of ['budget', 'mainstream', 'premium']) answers[key] = typeof d.answers[key] === 'string' ? d.answers[key].slice(0, 3000) : '';
    respondent.name = typeof d.respondent?.name === 'string' ? d.respondent.name.slice(0, 100) : '';
    respondent.phone = typeof d.respondent?.phone === 'string' ? d.respondent.phone.slice(0, 30) : '';
    submissionId = /^[a-f0-9-]{36}$/i.test(d.submissionId || '') ? d.submissionId : crypto.randomUUID();
    step = ['questions', 'details'].includes(d.step) && groups.every(g => selected[g.id].length === 3) ? d.step : 'sort';
    questionIndex = Number.isInteger(d.questionIndex) && d.questionIndex >= 0 && d.questionIndex < groups.length ? d.questionIndex : 0;
  } catch { sessionStorage.removeItem('surveyDraft'); }
}
function hero(title, subtitle, eyebrow, number) { return `<section class="hero"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="sub">${subtitle}</p></div><span class="step">BƯỚC ${number} / 3</span></section>`; }
function renderSort() {
  const remaining = survey.products.filter(p => !groups.some(g => selected[g.id].includes(p.id)));
  const ready = groups.every(g => selected[g.id].length === 3);
  app.innerHTML = hero('Bạn cảm nhận bao bì thuộc phân khúc nào?', 'Chọn 3 bao bì cho mỗi nhóm. Kéo thả trên máy tính hoặc chạm vào ảnh rồi chọn nhóm trên điện thoại.', '01 / PHÂN LOẠI BAO BÌ', 1)
    + `<div class="toolbar"><div class="progress">Bạn đã chọn <span>${total()} / 9</span> bao bì</div><button id="next" class="button" ${ready && sheetConfigured ? '' : 'disabled'}>Tiếp tục →</button></div>`
    + (error ? `<p class="notice" role="alert">${esc(error)}</p>` : '')
    + `<div class="segments">${groups.map(g => `<section class="segment" data-drop="${g.id}" style="--accent:${g.color}"><div class="segment-title"><span class="dot"></span>${g.name}<span class="count">${selected[g.id].length}/3</span></div>${selected[g.id].length ? `<div class="slot-items">${selected[g.id].map(id => { const p = find(id); return p ? `<div class="slot"><img src="${esc(p.image)}" alt=""><span title="${esc(p.name)}">${productNumber(id)} · ${esc(p.name)}</span><button class="slot-zoom" data-zoom="${id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><button data-remove="${id}" aria-label="Bỏ ${esc(p.name)}">×</button></div>` : ''; }).join('')}</div>` : `<div class="hint">Thả bao bì vào đây</div>`}</section>`).join('')}</div>`
    + `<section class="pool"><div class="pool-head"><h2>Bao bì chờ bạn chọn nhóm <span>${remaining.length}</span></h2><small>Nhấn kính lúp để xem ảnh lớn</small></div><div class="cards">${remaining.map(p => `<div class="card" draggable="true" data-id="${p.id}" tabindex="0"><span class="badge">${productNumber(p.id)}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><button class="zoom" data-zoom="${p.id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><span class="card-name">${esc(p.name)}</span><div class="assign">${groups.map(g => `<button data-assign="${g.id}" data-id="${p.id}" aria-label="Xếp ${esc(p.name)} vào ${g.name}">${g.short}</button>`).join('')}</div></div>`).join('')}</div></section>`;
  app.querySelector('#next').onclick = () => { step = 'questions'; questionIndex = 0; persist(); render(); window.scrollTo(0, 0); };
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
function zoom(id) { const p = find(id); if (!p) return; document.querySelector('#zoomImage').src = p.image; document.querySelector('#zoomImage').alt = p.name; document.querySelector('#zoomCaption').textContent = `Bao bì ${productNumber(id)} · ${p.name}`; dialog.showModal(); }
document.querySelector('#closeZoom').onclick = () => dialog.close(); dialog.onclick = e => { if (e.target === dialog) dialog.close(); };
function renderQuestions() {
  const group = groups[questionIndex];
  const key = group.id;
  const nextUnanswered = groups.findIndex((g, i) => i !== questionIndex && answers[g.id].trim().length < 10);
  app.innerHTML = hero(`Vì sao bạn xếp các bao bì này vào nhóm ${group.name}?`, 'Chạm vào ảnh để phóng to trước khi viết đánh giá của bạn.', `02 / LÝ DO & CẢM NHẬN · ${questionIndex + 1}/3`, 2)
    + `<nav class="question-tabs" aria-label="Các nhóm đánh giá">${groups.map((g, i) => `<button type="button" class="question-tab ${i === questionIndex ? 'active' : ''}" data-question="${i}" ${i === questionIndex ? 'aria-current="step"' : ''}>2.${i + 1} ${g.name}</button>`).join('')}</nav>`
    + (error ? `<p class="notice" role="alert">${esc(error)}</p>` : '')
    + `<section class="question-stage"><p class="question-intro">3 bao bì bạn đã xếp vào ${group.name}</p><div class="question-products">${selected[group.id].map(id => { const p = find(id); return p ? `<div class="question-product"><button type="button" data-zoom="${id}" aria-label="Phóng to bao bì ${productNumber(id)}: ${esc(p.name)}"><span class="product-badge">${productNumber(id)}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><span class="product-magnify" aria-hidden="true">⌕</span></button><strong>${esc(p.name)}</strong></div>` : ''; }).join('')}</div><label for="questionAnswer">Đánh giá của bạn cho nhóm ${group.name}</label><textarea id="questionAnswer" maxlength="3000" placeholder="Viết lý do bạn xếp các bao bì này vào nhóm ${group.name}...">${esc(answers[key])}</textarea></section>`
    + `<div class="actions question-actions"><button id="back" class="button secondary">← Quay lại chọn nhóm</button><button id="nextQuestion" class="button" ${nextUnanswered === -1 && !sheetConfigured ? 'disabled' : ''}>${nextUnanswered === -1 ? 'Tiếp tục →' : `Tiếp: ${groups[nextUnanswered].name} →`}</button></div>`;
  app.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => zoom(b.dataset.zoom));
  app.querySelector('#questionAnswer').oninput = e => { answers[key] = e.target.value; persist(); };
  app.querySelectorAll('[data-question]').forEach(b => b.onclick = () => { questionIndex = Number(b.dataset.question); error = ''; persist(); render(); window.scrollTo(0, 0); });
  app.querySelector('#back').onclick = () => { error = ''; step = 'sort'; persist(); render(); window.scrollTo(0, 0); };
  app.querySelector('#nextQuestion').onclick = () => { if (answers[key].trim().length < 10) { error = 'Vui lòng viết ít nhất 10 ký tự trước khi tiếp tục.'; renderQuestions(); app.querySelector('#questionAnswer').focus(); return; } error = ''; if (nextUnanswered === -1) step = 'details'; else questionIndex = nextUnanswered; persist(); render(); window.scrollTo(0, 0); };
}
function renderDetails() {
  app.innerHTML = hero('Thông tin của bạn', 'Chỉ còn một bước nữa. Cảm ơn bạn đã dành thời gian chia sẻ cảm nhận về bao bì.', '03 / HOÀN TẤT KHẢO SÁT', 3)
    + `<section class="details-panel"><p class="details-intro">Thông tin này sẽ được lưu cùng câu trả lời khảo sát của bạn.</p>${error ? `<p class="notice" role="alert">${esc(error)}</p>` : ''}<label for="respondentName">Họ và Tên <span class="required">*</span></label><input id="respondentName" type="text" autocomplete="name" maxlength="100" value="${esc(respondent.name)}" placeholder="Nhập họ và tên của bạn" required><label for="respondentPhone">SĐT <span class="optional">(không bắt buộc)</span></label><input id="respondentPhone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30" value="${esc(respondent.phone)}" placeholder="Nhập số điện thoại nếu bạn muốn"></section><div class="actions details-actions"><button id="backToQuestions" class="button secondary">← Quay lại đánh giá</button><button id="submit" class="button" ${sheetConfigured ? '' : 'disabled'}>Gửi khảo sát →</button></div>`;
  app.querySelector('#respondentName').oninput = e => { respondent.name = e.target.value; persist(); };
  app.querySelector('#respondentPhone').oninput = e => { respondent.phone = e.target.value; persist(); };
  app.querySelector('#backToQuestions').onclick = () => { error = ''; step = 'questions'; persist(); render(); window.scrollTo(0, 0); };
  app.querySelector('#submit').onclick = submit;
}
async function submit() {
  const missing = groups.findIndex(g => answers[g.id].trim().length < 10);
  if (missing !== -1) { step = 'questions'; questionIndex = missing; error = 'Vui lòng trả lời đủ 3 câu hỏi, mỗi câu ít nhất 10 ký tự.'; persist(); render(); return; }
  if (respondent.name.trim().length < 2) { error = 'Vui lòng nhập Họ và Tên (ít nhất 2 ký tự).'; renderDetails(); app.querySelector('#respondentName').focus(); return; }
  const phone = respondent.phone.trim();
  if (phone && (!/^[+()\d .-]{6,30}$/.test(phone) || (phone.match(/\d/g) || []).length < 7 || (phone.match(/\d/g) || []).length > 15)) { error = 'SĐT chưa đúng định dạng. Bạn có thể sửa hoặc để trống.'; renderDetails(); app.querySelector('#respondentPhone').focus(); return; }
  const button = app.querySelector('#submit'); button.disabled = true; button.textContent = 'Đang gửi…'; error = '';
  try { const response = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId, surveyVersion: survey.version, selections: selected, answers, respondent }) }); const result = await response.json(); if (response.status === 409 && result.code === 'SURVEY_CHANGED') { const latest = await fetch('/api/survey'); if (latest.ok) { survey = await latest.json(); sheetConfigured = survey.acceptingResponses; groups.forEach(g => selected[g.id] = selected[g.id].filter(id => find(id))); step = 'sort'; questionIndex = 0; error = result.error; persist(); render(); return; } } if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể gửi phản hồi.'); step = 'done'; sessionStorage.removeItem('surveyDraft'); render(); window.scrollTo(0, 0); }
  catch (e) { error = `${e.message} Câu trả lời của bạn vẫn được giữ lại. Hãy thử gửi lại.`; renderDetails(); }
}
function renderAdmin() {
  const token = sessionStorage.getItem('adminToken') || '';
  if (!adminUnlocked) {
    app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Nhập mã quản trị</h1><p class="sub">Chỉ người có mã đúng mới có thể thêm hoặc xóa hình ảnh bao bì.</p></div></section><section class="panel" style="max-width:420px;margin:20px 0 45px"><label class="field">Mã quản trị<input id="adminCode" type="password" value="${esc(token)}" autocomplete="off" placeholder="Nhập mã quản trị"></label><div class="actions"><button id="unlockAdmin" class="button">Mở quản trị →</button><a href="/" class="button secondary" style="text-decoration:none">← Quay lại</a></div><p id="adminMessage" class="sub" style="margin-top:15px"></p></section>`;
    const input = app.querySelector('#adminCode'), message = app.querySelector('#adminMessage');
    const unlock = async () => { const code = input.value.trim(); const button = app.querySelector('#unlockAdmin'); button.disabled = true; message.textContent = ''; try { const r = await fetch('/api/admin/status', { headers: { Authorization: `Bearer ${code}` } }); if (!r.ok) { message.textContent = 'Mã quản trị không đúng.'; return; } const status = await r.json(); sheetConfigured = status.sheetConfigured; responseEndpoint = status.responseEndpoint || ''; sessionStorage.setItem('adminToken', code); adminUnlocked = true; renderAdmin(); } catch { message.textContent = 'Không thể kết nối máy chủ. Vui lòng thử lại.'; } finally { button.disabled = false; } };
    app.querySelector('#unlockAdmin').onclick = unlock;
    input.onkeydown = e => { if (e.key === 'Enter') unlock(); };
    return;
  }
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Thư viện bao bì</h1><p class="sub">Tải ảnh của bạn lên. Mỗi lần thay đổi danh sách sẽ tạo phiên bản khảo sát mới.</p></div><button id="lockAdmin" class="button secondary">Khóa quản trị</button></section>${sheetConfigured ? '' : '<p class="notice">Khảo sát tạm chưa nhận phản hồi vì Google Sheet chưa được kết nối. Vui lòng quay lại sau.</p>'}${survey.products.length < 9 ? `<p class="notice">Hiện có ${survey.products.length} ảnh. Người quản trị cần tải lên ít nhất 9 ảnh để bắt đầu khảo sát.</p>` : ''}<div class="admin-grid"><section class="panel"><h2>Thêm bao bì</h2><label class="field">Tên Brand/Packaging<input id="name" maxlength="100" placeholder="Ví dụ: Khăn giấy gói A"></label><label class="field">Hình ảnh (PNG, JPG, WebP; tối đa 3 MB)<input id="image" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="upload" class="button" ${survey.products.length >= 30 ? "disabled" : ""}>Tải ảnh lên</button><p id="adminMessage" class="sub" style="margin-top:16px"></p></section><section class="panel"><h2>Danh sách ảnh · ${survey.products.length}/30</h2><div class="admin-list">${survey.products.map(p => `<div class="admin-item"><span class="admin-number">${productNumber(p.id)}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><strong title="${esc(p.name)}">${esc(p.name)}</strong><button data-delete="${p.id}">Xóa khỏi khảo sát</button></div>`).join('')}</div>${survey.products.length ? '' : '<p class="sub">Chưa có ảnh nào. Hãy thêm ít nhất 9 ảnh.</p>'}</section></div><section class="integration-panel"><div><p class="eyebrow">DỮ LIỆU KHẢO SÁT</p><h2>Nguồn nhận phản hồi</h2><p class="sub"><span class="status-dot ${sheetConfigured ? 'connected' : ''}"></span>${sheetConfigured ? `Đang kết nối qua ${esc(responseEndpoint || 'Google Apps Script')}` : 'Chưa có nguồn nhận phản hồi hoạt động'}</p></div><div class="integration-steps"><p>Để chuyển sang Google Sheet khác:</p><ol><li>Tạo Sheet mới, mở <strong>Extensions → Apps Script</strong> và dán mã kết nối.</li><li>Đổi <code>SPREADSHEET_ID</code> thành ID của Sheet mới, sau đó triển khai Web app.</li><li>Trong Vercel, thay <code>GOOGLE_SHEETS_WEBHOOK_URL</code> và <code>GOOGLE_SHEETS_SECRET</code>, rồi redeploy.</li></ol><p class="integration-note">Khóa bí mật không hiển thị trong trang quản trị để bảo vệ dữ liệu người tham gia.</p><div class="actions integration-actions"><a class="button secondary" href="https://script.google.com/home/projects/1Yd9oOfDwcO2F8d-90vHKHsl2ddGrdUam_MVDDFFWPSnmmj4YPNXIPodX/edit" target="_blank" rel="noopener">Mở Apps Script</a><a class="button" href="https://vercel.com/phuonglevietwork-2481s-projects/packaging-survey-app/settings/environment-variables" target="_blank" rel="noopener">Mở Vercel để đổi nguồn →</a></div></div></section><div class="actions"><a href="/" class="button secondary" style="text-decoration:none">← Xem khảo sát</a></div>`;
  const message = app.querySelector('#adminMessage');
  if (survey.products.length >= 30) message.textContent = 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.';
  app.querySelector('#lockAdmin').onclick = () => { adminUnlocked = false; sessionStorage.removeItem('adminToken'); renderAdmin(); };
  app.querySelector('#upload').onclick = async () => { if (survey.products.length >= 30) { message.textContent = 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.'; return; } const name = app.querySelector('#name').value.trim(), image = app.querySelector('#image').files[0]; if (!name || !image) { message.textContent = 'Vui lòng nhập tên và chọn ảnh.'; return; } if (image.size > 3_000_000) { message.textContent = 'Ảnh tối đa 3 MB.'; return; } const button = app.querySelector('#upload'); button.disabled = true; message.textContent = 'Đang tải ảnh…'; try { const data = await new Promise((ok, fail) => { const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = fail; reader.readAsDataURL(image); }); const r = await fetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` }, body: JSON.stringify({ name, image: data }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error); survey = result; sessionStorage.removeItem('surveyDraft'); renderAdmin(); } catch (e) { message.textContent = e.message; button.disabled = false; } };
  app.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if (!confirm('Xóa bao bì này khỏi khảo sát hiện tại?')) return; b.disabled = true; try { const r = await fetch(`/api/admin/products/${b.dataset.delete}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` } }); const result = await r.json(); if (!r.ok) throw new Error(result.error); survey = result; sessionStorage.removeItem('surveyDraft'); renderAdmin(); } catch (e) { message.textContent = e.message || 'Không thể xóa ảnh. Vui lòng thử lại.'; b.disabled = false; } });
}
function render() { if (location.hash === '#admin') renderAdmin(); else if (step === 'questions') renderQuestions(); else if (step === 'details') renderDetails(); else if (step === 'done') app.innerHTML = `<section class="thank-you"><div class="thank-mark" aria-hidden="true">✓</div><p class="eyebrow">KHẢO SÁT ĐÃ HOÀN TẤT</p><h1>Cảm ơn ${esc(respondent.name.trim())}!</h1><p class="thank-lead">Chúng tôi thật sự trân trọng thời gian và góc nhìn bạn đã dành cho khảo sát này.</p><div class="thank-divider"></div><p class="thank-note">Câu trả lời của bạn đã được ghi nhận. Những chia sẻ này sẽ giúp chúng tôi hiểu rõ hơn cảm nhận của người tiêu dùng về thiết kế bao bì.</p></section>`; else renderSort(); }
window.onhashchange = render;
try { const r = await fetch('/api/survey'); if (!r.ok) throw new Error(); survey = await r.json(); sheetConfigured = Boolean(survey.acceptingResponses); restore(); render(); } catch { app.innerHTML = '<p class="notice" style="margin-top:35px">Không thể tải khảo sát. Vui lòng thử lại sau.</p>'; }

