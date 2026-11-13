import { randomUUID } from 'node:crypto';

// Optional part 2.4, switched on per survey: respondents compare two packages (group A and B)
// that the admin uploads just for it, and answer up to 5 admin-written questions.
export const maxExtraImages = 5;
export const maxExtraQuestions = 5;
const questionTypes = ['choice', 'text', 'segment'];
const segments = { budget: 'Economy', mainstream: 'Mainstream', premium: 'Upper Mainstream' };

export class ExtraChangedError extends Error {}

const defaultQuestions = () => [
  { id: randomUUID(), text: 'Bạn thích nhóm bao bì nào hơn?', type: 'choice' },
  { id: randomUUID(), text: 'Lý do vì sao bạn thích nhóm bao bì đó?', type: 'text' },
  { id: randomUUID(), text: 'Bạn xếp 2 nhóm bao bì này ở phân khúc nào?', type: 'segment' }
];
export const emptyExtra = () => ({ enabled: false, intro: 'Bạn cảm nhận 2 nhóm bao bì dưới đây thế nào?', groupA: { name: 'Nhóm A', imageId: '' }, groupB: { name: 'Nhóm B', imageId: '' }, questions: defaultQuestions(), images: [] });

const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

// Admin settings from a request, checked against the images already uploaded for 2.4.
export function cleanExtraSettings(input, images) {
  if (!input || typeof input !== 'object') throw new Error('Thiết lập phần 2.4 không hợp lệ.');
  const imageIds = new Set(images.map(image => image.id));
  const group = (value, fallback) => {
    const name = text(value?.name) || fallback;
    if (name.length > 40) throw new Error('Tên nhóm tối đa 40 ký tự.');
    const imageId = typeof value?.imageId === 'string' && imageIds.has(value.imageId) ? value.imageId : '';
    return { name, imageId };
  };
  const intro = text(input.intro);
  if (intro.length > 200) throw new Error('Lời dẫn tối đa 200 ký tự.');
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > maxExtraQuestions) throw new Error(`Phần 2.4 cần từ 1 đến ${maxExtraQuestions} câu hỏi.`);
  const questions = input.questions.map(q => {
    const question = text(q?.text);
    if (question.length < 2 || question.length > 200) throw new Error('Mỗi câu hỏi cần từ 2 đến 200 ký tự.');
    if (!questionTypes.includes(q?.type)) throw new Error('Kiểu trả lời không hợp lệ.');
    return { id: typeof q.id === 'string' && /^[a-f0-9-]{36}$/i.test(q.id) ? q.id : randomUUID(), text: question, type: q.type };
  });
  const settings = { enabled: input.enabled === true, intro, groupA: group(input.groupA, 'Nhóm A'), groupB: group(input.groupB, 'Nhóm B'), questions };
  if (settings.enabled && (!settings.groupA.imageId || !settings.groupB.imageId)) throw new Error('Hãy chọn ảnh cho cả Nhóm A và Nhóm B trước khi bật phần 2.4.');
  if (settings.enabled && settings.groupA.imageId === settings.groupB.imageId) throw new Error('Nhóm A và Nhóm B cần 2 ảnh khác nhau.');
  return settings;
}

// What respondents get: null unless 2.4 is switched on and complete.
export function publicExtra(survey) {
  const extra = survey.extra;
  if (!extra?.enabled || !extra.questions?.length) return null;
  const image = id => extra.images?.find(item => item.id === id)?.image;
  const a = image(extra.groupA?.imageId), b = image(extra.groupB?.imageId);
  if (!a || !b) return null;
  return { intro: extra.intro, groupA: { name: extra.groupA.name, image: a }, groupB: { name: extra.groupB.name, image: b }, questions: extra.questions.map(({ id, text, type }) => ({ id, text, type })) };
}

// Checks a respondent's 2.4 answers and turns them into Sheet text; null when 2.4 is off.
// Answers that don't match the current questions mean the admin changed 2.4 meanwhile.
export function extraRecord(extra, answers, clean) {
  if (!extra) return null;
  if (!answers || typeof answers !== 'object' || extra.questions.some(q => !(q.id in answers))) throw new ExtraChangedError('Phần 2.4 vừa được cập nhật. Vui lòng xem lại và trả lời phần 2.4.');
  const label = side => side === 'A' ? `Nhóm A (${extra.groupA.name})` : `Nhóm B (${extra.groupB.name})`;
  const items = extra.questions.map(q => {
    const answer = answers[q.id];
    if (q.type === 'choice') {
      if (answer !== 'A' && answer !== 'B') throw new Error('Vui lòng chọn nhóm bao bì ở phần 2.4.');
      return { question: q.text, answer: label(answer) };
    }
    if (q.type === 'segment') {
      if (!segments[answer?.A] || !segments[answer?.B]) throw new Error('Vui lòng chọn phân khúc cho cả 2 nhóm ở phần 2.4.');
      return { question: q.text, answer: `${label('A')}: ${segments[answer.A]}; ${label('B')}: ${segments[answer.B]}` };
    }
    if (typeof answer !== 'string' || answer.trim().length < 10 || answer.length > 3000) throw new Error('Vui lòng trả lời các câu hỏi ở phần 2.4 (ít nhất 10 ký tự mỗi câu).');
    return { question: q.text, answer };
  });
  return { groupA: clean(extra.groupA.name), groupB: clean(extra.groupB.name), items: items.map(item => ({ question: clean(item.question), answer: clean(item.answer) })) };
}
