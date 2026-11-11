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
const defaultSlug = 'khan-giay-goi';
const pathSlug = (globalThis.location?.pathname || '').match(/^\/s\/([a-z0-9-]+)\/?$/)?.[1] || '';
const surveyUrl = slug => `/api/survey${slug ? `?s=${encodeURIComponent(slug)}` : ''}`;
// The original survey keeps the old draft key so drafts already in progress survive this update.
const draftKey = (slug = survey.slug) => !slug || slug === defaultSlug ? 'surveyDraft' : `surveyDraft:${slug}`;
const productType = () => survey.name ? `${survey.name.charAt(0).toLowerCase()}${survey.name.slice(1)} ` : '';
// "?preview=1" shows the survey even when it cannot accept responses yet (e.g. fewer than 9 images),
// so it can be checked while it is being prepared. Submitting stays disabled until it really opens.
const previewMode = new URLSearchParams(globalThis.location?.search || '').get('preview') === '1';
const canContinue = () => sheetConfigured || previewMode;
const maxUploadBatch = 3;
// "Tempo_Premium-01.png" -> "Tempo Premium 01"
const nameFromFile = file => file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
let isPreviewEnv = false, adminLoaded = false, adminSurveys = [], adminSurvey = { products: [] }, adminSlug = '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const find = id => survey.products.find(p => p.id === id);
const productNumber = id => String(survey.products.findIndex(p => p.id === id) + 1).padStart(2, '0');
const total = () => groups.reduce((n, g) => n + selected[g.id].length, 0);
function persist() { sessionStorage.setItem(draftKey(), JSON.stringify({ version: survey.version, selected, answers, respondent, submissionId, step, questionIndex })); }
function restore() {
  try {
    const d = JSON.parse(sessionStorage.getItem(draftKey()));
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
  } catch { sessionStorage.removeItem(draftKey()); }
}
function hero(title, subtitle, eyebrow, number) { return `<section class="hero"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="sub">${subtitle}</p></div><span class="step">BƯỚC ${number} / 3</span></section>`; }
function renderSort() {
  const remaining = survey.products.filter(p => !groups.some(g => selected[g.id].includes(p.id)));
  const ready = groups.every(g => selected[g.id].length === 3);
  app.innerHTML = hero(`Bạn cảm nhận bao bì ${esc(productType())}thuộc phân khúc nào?`, 'Chọn 3 bao bì cho mỗi nhóm. Kéo thả trên máy tính hoặc chạm vào ảnh rồi chọn nhóm trên điện thoại.', '01 / PHÂN LOẠI BAO BÌ', 1)
    + `<div class="toolbar"><div class="progress">Bạn đã chọn <span>${total()} / 9</span> bao bì</div><button id="next" class="button" ${ready && canContinue() ? '' : 'disabled'}>Tiếp tục →</button></div>`
    + (error ? `<p class="notice" role="alert">${esc(error)}</p>` : '')
    + `<div class="segments">${groups.map(g => `<section class="segment" data-drop="${g.id}" style="--accent:${g.color}"><div class="segment-title"><span class="dot"></span>${g.name}<span class="count">${selected[g.id].length}/3</span></div>${selected[g.id].length ? `<div class="slot-items">${selected[g.id].map(id => { const p = find(id); return p ? `<div class="slot" draggable="true" data-id="${id}" data-group="${g.id}"><button type="button" class="slot-media" data-move="${id}" aria-label="Chuyển nhóm hoặc đổi chỗ ${esc(p.name)}" title="Kéo sang nhóm khác hoặc chạm để chuyển nhóm"><span class="slot-badge">${productNumber(id)}</span><img src="${esc(p.image)}" alt="${esc(p.name)}" draggable="false"></button><div class="slot-bar"><span class="slot-name" title="${esc(p.name)}">${esc(p.name)}</span><button type="button" class="slot-zoom" data-zoom="${id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><button type="button" class="slot-remove" data-remove="${id}" aria-label="Bỏ ${esc(p.name)}">×</button></div></div>` : ''; }).join('')}</div>` : `<div class="hint">Thả bao bì vào đây</div>`}</section>`).join('')}</div>`
    + `<section class="pool" data-pool><div class="pool-head"><h2>Bao bì chờ bạn chọn nhóm <span>${remaining.length}</span></h2><small>Nhấn kính lúp để xem ảnh lớn</small></div><div class="cards">${remaining.map(p => `<div class="card" draggable="true" data-id="${p.id}" tabindex="0"><span class="badge">${productNumber(p.id)}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><button class="zoom" data-zoom="${p.id}" aria-label="Phóng to ${esc(p.name)}">⌕</button><span class="card-name">${esc(p.name)}</span><div class="assign">${groups.map(g => `<button data-assign="${g.id}" data-id="${p.id}" aria-label="Xếp ${esc(p.name)} vào ${g.name}">${g.short}</button>`).join('')}</div></div>`).join('')}</div></section>`;
  app.querySelector('#next').onclick = () => { step = 'questions'; questionIndex = 0; persist(); render(); window.scrollTo(0, 0); };
  app.querySelectorAll('[data-assign]').forEach(b => b.onclick = e => { e.stopPropagation(); assign(b.dataset.id, b.dataset.assign); });
  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { unselect(b.dataset.remove); persist(); renderSort(); });
  app.querySelectorAll('[data-zoom]').forEach(b => b.onclick = e => { e.stopPropagation(); zoom(b.dataset.zoom); });
  app.querySelectorAll('[data-move]').forEach(b => b.onclick = () => openAssign(b.dataset.move));
  app.querySelectorAll('.card, .slot').forEach(el => { el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); }; el.ondragend = clearDropMarks; });
  app.querySelectorAll('.card').forEach(card => { card.onclick = e => { if (!e.target.closest('button')) openAssign(card.dataset.id); }; card.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openAssign(card.dataset.id); } }; });
  app.querySelectorAll('.slot').forEach(slot => {
    slot.ondragover = e => { e.preventDefault(); e.stopPropagation(); clearDropMarks(false); if (!slot.classList.contains('dragging')) slot.classList.add('swap-target'); slot.closest('[data-drop]').classList.add('drag-over'); };
    slot.ondrop = e => { e.preventDefault(); e.stopPropagation(); assign(e.dataTransfer.getData('text/plain'), slot.dataset.group, slot.dataset.id); };
  });
  app.querySelectorAll('[data-drop]').forEach(zone => {
    zone.ondragover = e => { e.preventDefault(); clearDropMarks(false); zone.classList.add('drag-over'); };
    zone.ondragleave = e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); };
    zone.ondrop = e => { e.preventDefault(); assign(e.dataTransfer.getData('text/plain'), zone.dataset.drop); };
  });
  const pool = app.querySelector('[data-pool]');
  pool.ondragover = e => { e.preventDefault(); clearDropMarks(false); pool.classList.add('drag-over'); };
  pool.ondragleave = e => { if (!pool.contains(e.relatedTarget)) pool.classList.remove('drag-over'); };
  pool.ondrop = e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (groupOf(id)) { unselect(id); error = ''; persist(); } renderSort(); };
}
function clearDropMarks(all = true) { app.querySelectorAll(all ? '.drag-over, .swap-target, .dragging' : '.drag-over, .swap-target').forEach(el => el.classList.remove('drag-over', 'swap-target', 'dragging')); }
const groupOf = id => groups.find(g => selected[g.id].includes(id))?.id || null;
function unselect(id) { groups.forEach(g => selected[g.id] = selected[g.id].filter(x => x !== id)); }
// Move a package into a group. With targetId, swap places with that package:
// the target takes the moved package's old spot (or returns to the pool).
function assign(id, group, targetId) {
  if (!find(id) || !groups.some(g => g.id === group)) return;
  const from = groupOf(id);
  if (targetId && targetId !== id && selected[group].includes(targetId)) {
    const ti = selected[group].indexOf(targetId);
    if (from) { const fi = selected[from].indexOf(id); selected[from][fi] = targetId; }
    selected[group][ti] = id;
  } else if (from !== group) {
    if (selected[group].length >= 3) { error = `Nhóm ${groups.find(g => g.id === group).name} đã đủ 3 bao bì. Hãy thả lên bao bì bạn muốn đổi chỗ.`; renderSort(); return; }
    unselect(id); selected[group].push(id);
  }
  error = ''; persist(); renderSort();
}
function openAssign(id) {
  const p = find(id); if (!p) return;
  const from = groupOf(id);
  const options = assignDialog.querySelector('#assignOptions');
  assignDialog.querySelector('#assignTitle').textContent = from ? 'Chuyển bao bì sang nhóm khác' : 'Chọn nhóm cho bao bì';
  assignDialog.querySelector('#assignCaption').textContent = p.name;
  options.className = '';
  options.innerHTML = groups.map(g => g.id === from ? `<button class="button" disabled>${g.name} · nhóm hiện tại</button>` : `<button class="button" data-group="${g.id}">${g.name} · ${selected[g.id].length}/3${selected[g.id].length >= 3 ? ' · đổi chỗ' : ''}</button>`).join('');
  options.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { const group = b.dataset.group; if (selected[group].length < 3) { assignDialog.close(); assign(id, group); } else openSwap(id, group); });
  if (!assignDialog.open) assignDialog.showModal();
}
function openSwap(id, group) {
  const p = find(id), g = groups.find(x => x.id === group), from = groupOf(id);
  const options = assignDialog.querySelector('#assignOptions');
  assignDialog.querySelector('#assignTitle').textContent = `Nhóm ${g.name} đã đủ 3`;
  assignDialog.querySelector('#assignCaption').textContent = `Chọn bao bì sẽ đổi chỗ với "${p.name}". Bao bì đó sẽ ${from ? `chuyển sang nhóm ${groups.find(x => x.id === from).name}` : 'quay về khu vực chờ'}.`;
  options.className = 'swap-options';
  options.innerHTML = selected[group].map(tid => { const t = find(tid); return t ? `<button type="button" class="swap-choice" data-target="${tid}"><span class="slot-badge">${productNumber(tid)}</span><img src="${esc(t.image)}" alt=""><span>${esc(t.name)}</span></button>` : ''; }).join('') + `<button type="button" class="button secondary swap-back">← Chọn nhóm khác</button>`;
  options.querySelectorAll('[data-target]').forEach(b => b.onclick = () => { assignDialog.close(); assign(id, group, b.dataset.target); });
  options.querySelector('.swap-back').onclick = () => openAssign(id);
}
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
    + `<div class="actions question-actions"><button id="back" class="button secondary">← Quay lại chọn nhóm</button><button id="nextQuestion" class="button" ${nextUnanswered === -1 && !canContinue() ? 'disabled' : ''}>${nextUnanswered === -1 ? 'Tiếp tục →' : `Tiếp: ${groups[nextUnanswered].name} →`}</button></div>`;
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
  try { const response = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ survey: survey.slug, submissionId, surveyVersion: survey.version, selections: selected, answers, respondent }) }); const result = await response.json(); if (response.status === 409 && result.code === 'SURVEY_CHANGED') { const latest = await fetch(surveyUrl(survey.slug)); if (latest.ok) { survey = await latest.json(); sheetConfigured = survey.acceptingResponses; groups.forEach(g => selected[g.id] = selected[g.id].filter(id => find(id))); step = 'sort'; questionIndex = 0; error = result.error; persist(); render(); return; } } if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể gửi phản hồi.'); step = 'done'; sessionStorage.removeItem(draftKey()); render(); window.scrollTo(0, 0); }
  catch (e) { error = `${e.message} Câu trả lời của bạn vẫn được giữ lại. Hãy thử gửi lại.`; renderDetails(); }
}
function eyeIcon(visible) { return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${visible ? '' : '<path d="M3 3l18 18"/>'}</svg>`; }
function renderAdmin() {
  const token = sessionStorage.getItem('adminToken') || '';
  if (!adminUnlocked) {
    app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Nhập mã quản trị</h1><p class="sub">Chỉ người có mã đúng mới có thể thêm hoặc xóa hình ảnh bao bì.</p></div></section><section class="panel" style="max-width:420px;margin:20px 0 45px"><label class="field">Mã quản trị<span class="password-field"><input id="adminCode" type="password" value="${esc(token)}" autocomplete="off" placeholder="Nhập mã quản trị"><button type="button" id="toggleAdminCode" class="password-toggle" aria-label="Hiện mã quản trị" aria-pressed="false" title="Hiện mã quản trị">${eyeIcon(false)}</button></span></label><div class="actions"><button id="unlockAdmin" class="button">Mở quản trị →</button><a href="/" class="button secondary" style="text-decoration:none">← Quay lại</a></div><p id="adminMessage" class="sub" style="margin-top:15px"></p></section>`;
    const input = app.querySelector('#adminCode'), message = app.querySelector('#adminMessage');
    const unlock = async () => { const code = input.value.trim(); const button = app.querySelector('#unlockAdmin'); button.disabled = true; message.textContent = ''; try { const r = await fetch('/api/admin/status', { headers: { Authorization: `Bearer ${code}` } }); if (!r.ok) { message.textContent = 'Mã quản trị không đúng.'; return; } const status = await r.json(); sheetConfigured = status.sheetConfigured; isPreviewEnv = Boolean(status.preview); sessionStorage.setItem('adminToken', code); adminUnlocked = true; renderAdmin(); } catch { message.textContent = 'Không thể kết nối máy chủ. Vui lòng thử lại.'; } finally { button.disabled = false; } };
    app.querySelector('#unlockAdmin').onclick = unlock;
    input.onkeydown = e => { if (e.key === 'Enter') unlock(); };
    const toggle = app.querySelector('#toggleAdminCode');
    toggle.onclick = () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; const label = show ? 'Ẩn mã quản trị' : 'Hiện mã quản trị'; toggle.setAttribute('aria-pressed', String(show)); toggle.setAttribute('aria-label', label); toggle.title = label; toggle.innerHTML = eyeIcon(show); input.focus(); };
    return;
  }
  if (!adminLoaded) {
    app.innerHTML = '<p class="sub" style="margin:40px 0">Đang tải danh sách khảo sát…</p>';
    loadAdmin(adminSlug || sessionStorage.getItem('adminSurvey') || pathSlug).then(() => { adminLoaded = true; renderAdmin(); }).catch(e => { app.innerHTML = `<p class="notice" style="margin-top:35px">${esc(e.message)}</p>`; });
    return;
  }
  const current = adminSurveys.find(s => s.slug === adminSlug) || adminSurveys[0];
  const products = adminSurvey.products;
  const link = `${location.origin}/s/${current.slug}`;
  const reason = !sheetConfigured ? 'Google Sheet chưa được kết nối' : !current.open ? 'khảo sát đang đóng' : products.length < 9 ? `cần thêm ${9 - products.length} ảnh (tối thiểu 9)` : '';
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">QUẢN TRỊ KHẢO SÁT</p><h1>Thư viện bao bì</h1><p class="sub">Mỗi khảo sát có link, thư viện ảnh và tab Google Sheet riêng. Thay đổi ảnh sẽ tạo phiên bản khảo sát mới.</p></div><button id="lockAdmin" class="button secondary">Khóa quản trị</button></section>`
    + (isPreviewEnv ? '<p class="notice preview-notice">Đây là bản thử nghiệm (preview). Ảnh và khảo sát ở đây tách riêng khỏi bản thật; phản hồi ghi vào các tab Sheet bắt đầu bằng "TEST -".</p>' : '')
    + `<section class="panel survey-panel"><div class="survey-row"><label class="field survey-select">Khảo sát đang quản lý<select id="surveySelect">${adminSurveys.map(s => `<option value="${s.slug}" ${s.slug === current.slug ? 'selected' : ''}>${esc(s.name)} · ${s.productCount} ảnh${s.open ? '' : ' · đã đóng'}</option>`).join('')}</select></label><div class="survey-actions"><button id="copyLink" class="button secondary" type="button">Sao chép link</button><a class="button secondary" href="/s/${current.slug}${reason ? '?preview=1' : ''}" target="_blank" rel="noopener" style="text-decoration:none">${reason ? 'Xem thử khảo sát ↗' : 'Mở trang khảo sát ↗'}</a><button id="toggleOpen" class="button ${current.open ? 'danger' : ''}" type="button">${current.open ? 'Đóng khảo sát' : 'Mở lại khảo sát'}</button>${current.slug === defaultSlug ? '' : '<button id="deleteSurvey" class="button danger" type="button">Xóa khảo sát</button>'}</div></div>`
    + (current.slug === defaultSlug ? '' : `<div id="deletePanel" class="delete-panel" hidden><p><strong>Xóa vĩnh viễn khảo sát "${esc(current.name)}"?</strong> Link khảo sát và ${products.length} ảnh sẽ bị xóa, không khôi phục được. Dữ liệu đã ghi trên Google Sheet vẫn được giữ.</p><label class="field">Nhập lại mã quản trị để xác nhận<span class="password-field"><input id="deleteCode" type="password" autocomplete="off" placeholder="Mã quản trị"><button type="button" id="toggleDeleteCode" class="password-toggle" aria-label="Hiện mã quản trị" aria-pressed="false" title="Hiện mã quản trị">${eyeIcon(false)}</button></span></label><div class="delete-actions"><button id="cancelDelete" class="button secondary" type="button">Hủy</button><button id="confirmDelete" class="button danger" type="button">Xóa vĩnh viễn</button></div><p id="deleteMessage" class="sub" role="alert"></p></div>`)
    + `<p class="survey-status ${reason ? 'off' : 'on'}"><span class="status-dot" aria-hidden="true"></span>${reason ? `Chưa nhận phản hồi: ${esc(reason)}` : 'Đang nhận phản hồi'}</p>`
    + `<dl class="survey-meta"><div><dt>Link khảo sát</dt><dd><code>${esc(link)}</code></dd></div><div><dt>Ghi vào tab Sheet</dt><dd>${esc(current.sheetTab)}</dd></div></dl>`
    + `<details class="new-survey"><summary>Tạo khảo sát mới</summary><div class="new-survey-row"><input id="newSurveyName" maxlength="60" placeholder="Ví dụ: Khăn giấy ướt" aria-label="Tên khảo sát mới"><button id="createSurvey" class="button" type="button">Tạo khảo sát</button></div></details><p id="surveyMessage" class="sub" role="status"></p></section>`
    + `<div class="admin-grid"><section class="panel"><h2>Thêm bao bì · ${esc(current.name)}</h2><label class="field">Hình ảnh (PNG, JPG, WebP; tối đa 3 MB/ảnh)<input id="image" type="file" multiple accept="image/png,image/jpeg,image/webp"></label><div id="uploadList" class="upload-list"></div><button id="upload" class="button" disabled>Tải ảnh lên</button><p id="adminMessage" class="sub" style="margin-top:16px"></p></section><section class="panel"><h2>Danh sách ảnh · ${products.length}/30</h2><div class="admin-list">${products.map((p, i) => `<div class="admin-item"><span class="admin-number">${String(i + 1).padStart(2, '0')}</span><img src="${esc(p.image)}" alt="${esc(p.name)}"><strong title="${esc(p.name)}">${esc(p.name)}</strong><button data-delete="${p.id}" aria-label="Xóa ${esc(p.name)} khỏi khảo sát">Xóa</button></div>`).join('')}</div>${products.length ? '' : '<p class="sub">Chưa có ảnh nào. Hãy thêm ít nhất 9 ảnh.</p>'}</section></div><div class="actions"><a href="/s/${current.slug}" class="button secondary" style="text-decoration:none">← Xem khảo sát</a></div>`;
  const message = app.querySelector('#adminMessage'), surveyMessage = app.querySelector('#surveyMessage');
  if (products.length >= 30) message.textContent = 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.';
  const refresh = async (slug = adminSlug) => { await loadAdmin(slug); renderAdmin(); };
  app.querySelector('#lockAdmin').onclick = () => { adminUnlocked = false; adminLoaded = false; sessionStorage.removeItem('adminToken'); renderAdmin(); };
  app.querySelector('#surveySelect').onchange = e => refresh(e.target.value).catch(err => { surveyMessage.textContent = err.message; });
  app.querySelector('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(link); surveyMessage.textContent = 'Đã sao chép link khảo sát.'; } catch { surveyMessage.textContent = `Hãy sao chép link: ${link}`; } };
  app.querySelector('#toggleOpen').onclick = async e => {
    if (current.open && !confirm(`Đóng khảo sát "${current.name}"? Người tham gia sẽ không gửi được phản hồi cho tới khi bạn mở lại.`)) return;
    e.target.disabled = true;
    try { await adminFetch(`/api/admin/surveys/${current.slug}`, { method: 'PATCH', body: JSON.stringify({ open: !current.open }) }); await refresh(); } catch (err) { surveyMessage.textContent = err.message; e.target.disabled = false; }
  };
  const deletePanel = app.querySelector('#deletePanel');
  if (deletePanel) {
    const codeInput = app.querySelector('#deleteCode'), deleteMessage = app.querySelector('#deleteMessage'), toggleCode = app.querySelector('#toggleDeleteCode');
    app.querySelector('#deleteSurvey').onclick = () => { deletePanel.hidden = false; codeInput.focus(); };
    app.querySelector('#cancelDelete').onclick = () => { deletePanel.hidden = true; codeInput.value = ''; deleteMessage.textContent = ''; };
    toggleCode.onclick = () => { const show = codeInput.type === 'password'; codeInput.type = show ? 'text' : 'password'; const label = show ? 'Ẩn mã quản trị' : 'Hiện mã quản trị'; toggleCode.setAttribute('aria-pressed', String(show)); toggleCode.setAttribute('aria-label', label); toggleCode.title = label; toggleCode.innerHTML = eyeIcon(show); codeInput.focus(); };
    const confirmDelete = async () => {
      const code = codeInput.value.trim();
      if (!code) { deleteMessage.textContent = 'Vui lòng nhập lại mã quản trị.'; codeInput.focus(); return; }
      const button = app.querySelector('#confirmDelete'); button.disabled = true; deleteMessage.textContent = 'Đang xóa khảo sát…';
      try {
        await adminFetch(`/api/admin/surveys/${current.slug}`, { method: 'DELETE', body: JSON.stringify({ confirm: code }) });
        sessionStorage.removeItem(draftKey(current.slug));
        await refresh(defaultSlug);
        app.querySelector('#surveyMessage').textContent = `Đã xóa khảo sát "${current.name}".`;
      } catch (err) { deleteMessage.textContent = err.message; button.disabled = false; codeInput.select(); }
    };
    app.querySelector('#confirmDelete').onclick = confirmDelete;
    codeInput.onkeydown = e => { if (e.key === 'Enter') confirmDelete(); };
  }
  const nameInput = app.querySelector('#newSurveyName');
  const create = async () => {
    const name = nameInput.value.trim();
    if (name.length < 2) { surveyMessage.textContent = 'Vui lòng nhập tên khảo sát (ít nhất 2 ký tự).'; nameInput.focus(); return; }
    const button = app.querySelector('#createSurvey'); button.disabled = true; surveyMessage.textContent = 'Đang tạo khảo sát…';
    try { const result = await adminFetch('/api/admin/surveys', { method: 'POST', body: JSON.stringify({ name }) }); await refresh(result.survey.slug); } catch (err) { surveyMessage.textContent = err.message; button.disabled = false; }
  };
  app.querySelector('#createSurvey').onclick = create;
  nameInput.onkeydown = e => { if (e.key === 'Enter') create(); };
  // Up to maxUploadBatch images per upload. Each gets a name prefilled from its file name that can be edited.
  const fileInput = app.querySelector('#image'), uploadList = app.querySelector('#uploadList');
  let picked = [];
  fileInput.onchange = () => {
    const files = [...fileInput.files], room = 30 - products.length;
    message.textContent = '';
    if (files.length > maxUploadBatch) message.textContent = `Mỗi lần chỉ chọn tối đa ${maxUploadBatch} ảnh. Đã giữ ${maxUploadBatch} ảnh đầu tiên.`;
    if (Math.min(files.length, maxUploadBatch) > room) message.textContent = `Thư viện chỉ còn chỗ cho ${room} ảnh (tối đa 30). Đã giữ ${room} ảnh đầu tiên.`;
    picked.forEach(p => URL.revokeObjectURL(p.url));
    picked = files.slice(0, Math.min(maxUploadBatch, room)).map(file => ({ file, name: nameFromFile(file.name), url: URL.createObjectURL(file) }));
    renderPicked();
  };
  function renderPicked() {
    uploadList.innerHTML = picked.map((p, i) => `<div class="upload-row"><img src="${p.url}" alt=""><label>Tên Brand/Packaging<input data-upload-name="${i}" maxlength="100" value="${esc(p.name)}"></label><span class="upload-size ${p.file.size > 3_000_000 ? 'too-big' : ''}">${p.file.size >= 1_048_576 ? `${(p.file.size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(p.file.size / 1024))} KB`}${p.file.size > 3_000_000 ? ' · quá 3 MB' : ''}</span><button type="button" class="upload-remove" data-unpick="${i}" aria-label="Bỏ ảnh ${esc(p.name)}" title="Bỏ ảnh này">×</button></div>`).join('');
    uploadList.querySelectorAll('[data-upload-name]').forEach(input => input.oninput = () => { picked[input.dataset.uploadName].name = input.value; });
    uploadList.querySelectorAll('[data-unpick]').forEach(b => b.onclick = () => {
      const [removed] = picked.splice(Number(b.dataset.unpick), 1); URL.revokeObjectURL(removed.url);
      // Keep the file input in step with the list so it shows "2 tệp" instead of "3 tệp".
      const files = new DataTransfer(); picked.forEach(p => files.items.add(p.file)); fileInput.files = files.files;
      message.textContent = ''; renderPicked();
    });
    app.querySelector('#upload').disabled = !picked.length || products.length >= 30;
  }
  app.querySelector('#upload').onclick = async () => {
    if (products.length >= 30) { message.textContent = 'Thư viện đã đạt tối đa 30 ảnh. Hãy xóa ảnh cũ trước khi tải thêm.'; return; }
    if (!picked.length) { message.textContent = 'Vui lòng chọn ảnh.'; return; }
    if (picked.some(p => !p.name.trim())) { message.textContent = 'Vui lòng nhập tên cho mỗi ảnh.'; return; }
    if (picked.some(p => p.file.size > 3_000_000)) { message.textContent = 'Mỗi ảnh tối đa 3 MB. Hãy bỏ chọn ảnh quá lớn.'; return; }
    const button = app.querySelector('#upload'), unpick = [...uploadList.querySelectorAll('[data-unpick]')];
    button.disabled = true; fileInput.disabled = true; unpick.forEach(b => b.disabled = true);
    let done = 0;
    try {
      // One after another: each upload updates the survey library, so they must not race.
      for (const p of picked) {
        message.textContent = `Đang tải ảnh ${done + 1}/${picked.length}…`;
        const data = await new Promise((ok, fail) => { const reader = new FileReader(); reader.onload = () => ok(reader.result); reader.onerror = fail; reader.readAsDataURL(p.file); });
        await adminFetch(`/api/admin/products?s=${current.slug}`, { method: 'POST', body: JSON.stringify({ name: p.name.trim(), image: data }) });
        done++;
      }
      sessionStorage.removeItem(draftKey(current.slug)); await refresh();
      app.querySelector('#adminMessage').textContent = `Đã tải lên ${done} ảnh.`;
    } catch (e) {
      if (done) { sessionStorage.removeItem(draftKey(current.slug)); await refresh().catch(() => {}); }
      app.querySelector('#adminMessage').textContent = `${done ? `Đã tải ${done}/${picked.length} ảnh. ` : ''}Ảnh "${picked[done].name}" lỗi: ${e.message}`;
      button.disabled = false; fileInput.disabled = false; unpick.forEach(b => b.disabled = false);
    }
  };
  app.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if (!confirm('Xóa bao bì này khỏi khảo sát hiện tại?')) return; b.disabled = true; try { await adminFetch(`/api/admin/products/${b.dataset.delete}?s=${current.slug}`, { method: 'DELETE' }); sessionStorage.removeItem(draftKey(current.slug)); await refresh(); } catch (e) { message.textContent = e.message || 'Không thể xóa ảnh. Vui lòng thử lại.'; b.disabled = false; } });
}
async function adminFetch(path, options = {}) {
  const r = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${sessionStorage.getItem('adminToken') || ''}` } });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(result.error || 'Có lỗi xảy ra. Vui lòng thử lại.');
  return result;
}
async function loadAdmin(slug) {
  adminSurveys = (await adminFetch('/api/admin/surveys')).surveys;
  adminSlug = adminSurveys.some(s => s.slug === slug) ? slug : adminSurveys[0].slug;
  sessionStorage.setItem('adminSurvey', adminSlug);
  const r = await fetch(surveyUrl(adminSlug));
  if (!r.ok) throw new Error('Không thể tải thư viện ảnh của khảo sát.');
  adminSurvey = await r.json();
}
function renderClosed() {
  const title = survey.open === false ? 'Khảo sát này đã đóng' : 'Khảo sát chưa mở';
  const note = survey.open === false ? 'Cảm ơn bạn đã quan tâm. Khảo sát hiện không nhận thêm phản hồi.' : 'Khảo sát đang được chuẩn bị. Vui lòng quay lại sau hoặc liên hệ người gửi link cho bạn.';
  app.innerHTML = `<section class="thank-you"><div class="thank-mark closed-mark" aria-hidden="true">!</div><p class="eyebrow">${esc(survey.name || 'KHẢO SÁT BAO BÌ')}</p><h1>${title}</h1><p class="thank-lead">${note}</p></section>`;
}
function render() { if (location.hash === '#admin') renderAdmin(); else if (step === 'done') app.innerHTML = `<section class="thank-you"><div class="thank-mark" aria-hidden="true">✓</div><p class="eyebrow">KHẢO SÁT ĐÃ HOÀN TẤT</p><h1>Thank you<span class="thank-name">${esc(respondent.name.trim())}</span></h1><p class="thank-lead">Chúng tôi thật sự trân trọng thời gian và góc nhìn bạn đã dành cho khảo sát này.</p><div class="thank-divider"></div><p class="thank-note">Câu trả lời của bạn đã được ghi nhận. Những chia sẻ này sẽ giúp chúng tôi hiểu rõ hơn cảm nhận của người tiêu dùng về thiết kế bao bì.</p></section>`; else if (!sheetConfigured && !previewMode) renderClosed(); else if (step === 'questions') renderQuestions(); else if (step === 'details') renderDetails(); else renderSort(); }
// Switching between the survey and #admin reloads so each view starts from fresh server data.
window.onhashchange = () => location.reload();
try {
  if (location.hash === '#admin') render();
  else {
    const r = await fetch(surveyUrl(pathSlug));
    if (r.status === 404) app.innerHTML = '<p class="notice" style="margin-top:35px">Không tìm thấy khảo sát. Vui lòng kiểm tra lại link bạn nhận được.</p>';
    else { if (!r.ok) throw new Error(); survey = await r.json(); sheetConfigured = Boolean(survey.acceptingResponses); restore(); render(); }
  }
} catch { app.innerHTML = '<p class="notice" style="margin-top:35px">Không thể tải khảo sát. Vui lòng thử lại sau.</p>'; }

