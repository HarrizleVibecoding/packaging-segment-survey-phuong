# Chép toàn bộ khảo sát và ảnh từ Vercel Blob sang Netlify Blobs (chạy một lần).
# Cách chạy, trong PowerShell tại thư mục dự án:
#   powershell -ExecutionPolicy Bypass -File scripts\copy-to-netlify.ps1
# Thêm -Force để chép lại, ghi đè dữ liệu trên Netlify bằng dữ liệu mới nhất trên Vercel.
# Token được nhập ẩn, chỉ dùng trong cửa sổ này và được xóa khi chạy xong.
param([switch]$Force)

Set-Location (Split-Path $PSScriptRoot -Parent)
$env:NETLIFY_SITE_ID = 'e0196d65-9f1f-4f0d-8f14-4bb7a94fe6c0'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Chưa cài Node.js. Tải tại https://nodejs.org rồi chạy lại.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path 'node_modules\@netlify\blobs')) {
  Write-Host 'Đang cài thư viện (lần đầu mất khoảng 1 phút)...'
  npx -y pnpm@9.15.9 install
  if ($LASTEXITCODE -ne 0) { Write-Host 'Cài thư viện không thành công.' -ForegroundColor Red; exit 1 }
}

Write-Host ''
Write-Host '1) Kiểm tra dữ liệu trên Vercel...' -ForegroundColor Cyan
node scripts/copy-vercel-to-netlify.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ''
$secure = Read-Host '2) Dán Netlify Personal Access Token rồi nhấn Enter (sẽ không hiện ra màn hình)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:NETLIFY_BLOBS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
if (-not $env:NETLIFY_BLOBS_TOKEN) { Write-Host 'Chưa nhập token.' -ForegroundColor Red; exit 1 }

try {
  $answer = Read-Host '3) Chép dữ liệu trên sang Netlify? Gõ y rồi nhấn Enter để tiếp tục'
  if ($answer -ne 'y') { Write-Host 'Đã hủy, chưa chép gì.'; exit 0 }
  if ($Force) { node scripts/copy-vercel-to-netlify.mjs --write --force } else { node scripts/copy-vercel-to-netlify.mjs --write }
  if ($LASTEXITCODE -eq 0) { Write-Host 'Xong. Mở https://packaging-survey-phuong.netlify.app để kiểm tra.' -ForegroundColor Green }
  else { Write-Host 'Chép không thành công. Gửi dòng lỗi phía trên (không kèm token) để được hỗ trợ.' -ForegroundColor Red }
} finally {
  Remove-Item Env:NETLIFY_BLOBS_TOKEN -ErrorAction SilentlyContinue
}
