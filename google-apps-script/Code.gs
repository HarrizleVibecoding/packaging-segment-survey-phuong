// Dán vào Apps Script gắn với Google Sheet PHẢN HỒI SURVEY.
// Trong Project Settings > Script Properties, tạo khóa SURVEY_SECRET.
// Khảo sát gốc (khăn giấy gói) ghi vào tab đầu tiên (gid 0). Mỗi khảo sát khác ghi vào
// tab mang tên khảo sát (sheetTab); tab được tự tạo khi có phản hồi đầu tiên.
const SPREADSHEET_ID = '1nTNtNffh-yh5y36Fq-sWLxf1Fw9_Or2Ggx375bfOpfM';
const SHEET_ID = 0;
const HEADERS = [
  'submission_id', 'submitted_at', 'survey_version',
  'economy_ids', 'economy_names', 'mainstream_ids', 'mainstream_names',
  'upper_mainstream_ids', 'upper_mainstream_names', 'why_economy', 'why_mainstream',
  'why_upper_mainstream', 'upper_mainstream_signals', 'full_name', 'phone', 'survey'
];
// Phần 2.4 (chỉ có khi quản trị viên bật): tên 2 nhóm so sánh, rồi câu hỏi + trả lời cho tối đa 5 câu.
const EXTRA_HEADERS = ['extra_group_a', 'extra_group_b'];
for (let i = 1; i <= 5; i++) EXTRA_HEADERS.push('extra_q' + i, 'extra_a' + i);

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const data = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('SURVEY_SECRET');
    // Requests for named tabs send the secret as "auth", so an outdated script rejects them
    // instead of writing them into the first tab.
    const given = data.auth || data.secret;
    if (!secret || given !== secret) return out({ ok: false, error: 'unauthorized' });
    if (!/^[a-f0-9-]{36}$/i.test(data.submissionId || '')) return out({ ok: false, error: 'invalid_id' });
    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tab = String(data.sheetTab || '').trim();
    let sheet = tab ? book.getSheetByName(tab) : book.getSheetById(SHEET_ID);
    if (!sheet && tab) sheet = book.insertSheet(tab);
    if (!sheet) return out({ ok: false, error: 'sheet_not_found' });
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
    if (sheet.getRange(1, 14).getValue() !== 'full_name') sheet.getRange(1, 14, 1, 2).setValues([['full_name', 'phone']]);
    if (sheet.getRange(1, 16).getValue() !== 'survey') sheet.getRange(1, 16).setValue('survey');
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
    if (ids.includes(data.submissionId)) return out({ ok: true, duplicate: true });
    const safe = value => { const s = String(value || '').trim(); return /^[=+\-@]/.test(s) ? "'" + s : s; };
    // A leading apostrophe stores the phone as text, so Sheets keeps the leading 0 (0900... not 900...).
    const text = value => { const s = safe(value); return s && !s.startsWith("'") ? "'" + s : s; };
    const join = values => (Array.isArray(values) ? values : []).map(safe).join(' | ');
    const extra = [];
    if (data.extra) {
      if (sheet.getRange(1, HEADERS.length + 1).getValue() !== EXTRA_HEADERS[0]) sheet.getRange(1, HEADERS.length + 1, 1, EXTRA_HEADERS.length).setValues([EXTRA_HEADERS]);
      extra.push(safe(data.extra.groupA), safe(data.extra.groupB));
      (Array.isArray(data.extra.items) ? data.extra.items : []).slice(0, 5).forEach(item => extra.push(safe(item.question), safe(item.answer)));
    }
    sheet.appendRow([
      data.submissionId, data.submittedAt, data.surveyVersion,
      join(data.selections.budget), join(data.selectionNames.budget),
      join(data.selections.mainstream), join(data.selectionNames.mainstream),
      join(data.selections.premium), join(data.selectionNames.premium),
      safe(data.answers.budget), safe(data.answers.mainstream),
      safe(data.answers.premium), safe(data.answers.premiumSignals),
      safe(data.respondent.name), text(data.respondent.phone),
      safe(data.surveyName || data.survey)
    ].concat(extra));
    return out({ ok: true });
  } catch (error) { return out({ ok: false, error: String(error) }); }
  finally { lock.releaseLock(); }
}

function out(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

