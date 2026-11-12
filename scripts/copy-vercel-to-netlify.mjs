// One-time copy of all surveys and images from Vercel Blob to Netlify Blobs, keeping every
// package ID so the ID columns already in Google Sheets still match.
//
// Usage (PowerShell):
//   $env:NETLIFY_SITE_ID = '<Netlify Site ID>'
//   $env:NETLIFY_BLOBS_TOKEN = '<Netlify personal access token>'
//   node scripts/copy-vercel-to-netlify.mjs            # shows what would be copied
//   node scripts/copy-vercel-to-netlify.mjs --write    # copies it
//
// Vercel Blob is only read (its files are public), never changed, so it stays as a backup.
import { getStore } from '@netlify/blobs';

const vercelBase = (process.argv.find(arg => arg.startsWith('--from='))?.slice(7) || 'https://mmujgvbo3v7mia97.public.blob.vercel-storage.com').replace(/\/$/, '');
const write = process.argv.includes('--write');
const force = process.argv.includes('--force');
const { NETLIFY_SITE_ID: siteID, NETLIFY_BLOBS_TOKEN: token, NETLIFY_BLOBS_API_URL: apiURL } = process.env;
if (write && (!siteID || !token)) { console.error('Đặt NETLIFY_SITE_ID và NETLIFY_BLOBS_TOKEN trước khi chạy với --write.'); process.exit(1); }

// Same store and keys as storage.js uses in production. NETLIFY_BLOBS_API_URL is only for tests.
const store = write ? getStore({ name: 'survey', siteID, token, ...(apiURL ? { apiURL } : {}) }) : null;
const defaultSlug = 'khan-giay-goi';
const registryKey = 'survey/surveys.json';
const configKey = slug => slug === defaultSlug ? 'survey/config.json' : `survey/s/${slug}/config.json`;

async function fetchJson(key) {
  const response = await fetch(`${vercelBase}/${key}?v=${Date.now()}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Không đọc được ${key} từ Vercel (HTTP ${response.status}).`);
  return response.json();
}

const registry = await fetchJson(registryKey);
if (!registry?.surveys?.length) { console.error('Không tìm thấy danh sách khảo sát trên Vercel Blob.'); process.exit(1); }
if (write && !force && await store.get(registryKey) !== null) {
  console.error('Netlify Blobs đã có dữ liệu khảo sát. Chạy lại với --force nếu muốn ghi đè.');
  process.exit(1);
}

let imageCount = 0;
for (const meta of registry.surveys) {
  const survey = await fetchJson(configKey(meta.slug)) ?? { version: 1, products: [] };
  console.log(`- ${meta.name} (/s/${meta.slug}): ${survey.products.length} ảnh, phiên bản ${survey.version}`);
  for (const product of survey.products) {
    const filename = new URL(product.image, vercelBase).pathname.split('/').at(-1);
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename)) throw new Error(`Ảnh không hợp lệ: ${product.image}`);
    if (write) {
      const response = await fetch(new URL(product.image, vercelBase));
      if (!response.ok) throw new Error(`Không tải được ảnh ${product.name} (HTTP ${response.status}).`);
      await store.set(`survey/images/${filename}`, await response.blob());
    }
    product.image = `/images/${filename}`;
    imageCount++;
  }
  if (write) await store.setJSON(configKey(meta.slug), survey);
}
// The survey list goes last, so a copy that stops halfway is never mistaken for a finished one.
if (write) await store.setJSON(registryKey, registry);

console.log(write
  ? `Đã chép ${registry.surveys.length} khảo sát và ${imageCount} ảnh sang Netlify Blobs.`
  : `Sẽ chép ${registry.surveys.length} khảo sát và ${imageCount} ảnh. Chạy lại với --write để chép.`);
