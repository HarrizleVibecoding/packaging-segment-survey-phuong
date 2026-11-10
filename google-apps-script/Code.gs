// Dán vào Apps Script gắn với Google Sheet PHẢN HỒI SURVEY.
// Trong Project Settings > Script Properties, tạo khóa SURVEY_SECRET.
const SPREADSHEET_ID = '1nTNtNffh-yh5y36Fq-sWLxf1Fw9_Or2Ggx375bfOpfM';
const SHEET_ID = 0;
const HEADERS = [
  'submission_id', 'submitted_at', 'survey_version',
  'economy_ids', 'economy_names', 'mainstream_ids', 'mainstream_names',
  'upper_mainstream_ids', 'upper_mainstream_names', 'why_economy', 'why_mainstream',
  'why_upper_mainstream', 'upper_mainstream_signals', 'full_name', 'phone'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const data = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('SURVEY_SECRET');
    if (!secret || data.secret !== secret) return out({ ok: false, error: 'unauthorized' });
    if (!/^[a-f0-9-]{36}$/i.test(data.submissionId || '')) return out({ ok: false, error: 'invalid_id' });
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetById(SHEET_ID);
    if (!sheet) return out({ ok: false, error: 'sheet_not_found' });
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
    if (sheet.getRange(1, 14).getValue() !== 'full_name') sheet.getRange(1, 14, 1, 2).setValues([['full_name', 'phone']]);
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
    if (ids.includes(data.submissionId)) return out({ ok: true, duplicate: true });
    const safe = value => { const s = String(value || '').trim(); return /^[=+\-@]/.test(s) ? "'" + s : s; };
    const join = values => (Array.isArray(values) ? values : []).map(safe).join(' | ');
    sheet.appendRow([
      data.submissionId, data.submittedAt, data.surveyVersion,
      join(data.selections.budget), join(data.selectionNames.budget),
      join(data.selections.mainstream), join(data.selectionNames.mainstream),
      join(data.selections.premium), join(data.selectionNames.premium),
      safe(data.answers.budget), safe(data.answers.mainstream),
      safe(data.answers.premium), safe(data.answers.premiumSignals),
      safe(data.respondent.name), safe(data.respondent.phone)
    ]);
    return out({ ok: true });
  } catch (error) { return out({ ok: false, error: String(error) }); }
  finally { lock.releaseLock(); }
}

function out(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

