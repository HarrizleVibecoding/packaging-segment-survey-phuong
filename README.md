# Khảo sát cảm nhận bao bì

Web app tiếng Việt gồm hai phần: trang phân loại cho người tiêu dùng và trang quản trị ảnh tại `/#admin`.

## Chạy thử

Yêu cầu Node.js 20+. Trong PowerShell:

```powershell
$env:ADMIN_TOKEN = 'mot-ma-quan-tri-dai-va-rieng'
node server.js
```

Mở `http://127.0.0.1:3000`. Vào `/#admin`, nhập mã quản trị, tải lên ít nhất 9 ảnh PNG/JPG/WebP (tối đa 3 MB/ảnh). Ảnh và cấu hình được lưu trong `data/`, phản hồi cũng được sao lưu tại `data/responses.jsonl` sau khi Google Sheets xác nhận.

## Kết nối Google Sheets

1. Mở [Google Sheet phản hồi](https://docs.google.com/spreadsheets/d/1nTNtNffh-yh5y36Fq-sWLxf1Fw9_Or2Ggx375bfOpfM/edit?gid=0#gid=0), rồi mở **Extensions → Apps Script**.
2. Dán nội dung [`google-apps-script/Code.gs`](google-apps-script/Code.gs) vào `Code.gs`.
3. Trong **Project Settings → Script Properties**, tạo `SURVEY_SECRET` bằng một chuỗi ngẫu nhiên dài.
4. **Deploy → New deployment → Web app**. Chọn **Execute as: Me**, **Who has access: Anyone**; cấp quyền rồi lấy URL Web app kết thúc bằng `/exec`.
5. Chạy server với các biến môi trường sau:

```powershell
$env:ADMIN_TOKEN = 'mot-ma-quan-tri-dai-va-rieng'
$env:GOOGLE_SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/.../exec'
$env:GOOGLE_SHEETS_SECRET = 'chuoi-trung-voi-SURVEY_SECRET'
node server.js
```

Mỗi phản hồi hợp lệ tạo một hàng trong tab `Trang tính1` (gid 0), chứa ID và tên 3 bao bì mỗi nhóm, 3 câu trả lời, Họ và Tên, SĐT (có thể trống), thời điểm và phiên bản bộ ảnh. Cột `upper_mainstream_signals` cũ được giữ trống để tương thích với dữ liệu trước đây. `submission_id` chống trùng khi gửi lại. Nếu Sheet chưa kết nối, khảo sát tạm dừng nhận phản hồi. Nếu gửi lỗi, giao diện giữ câu trả lời và cho thử lại. Không đưa secret vào mã frontend.

## Quy tắc khảo sát

- Đúng 3 bao bì mỗi nhóm: Economy, Mainstream, Upper Mainstream (9 bao bì không trùng nhau), theo ảnh mẫu.
- Có thể tải lên tối đa 30 ảnh; ảnh chưa chọn vẫn ở khu vực chờ.
- Xem lớn ảnh qua nút kính lúp, kể cả ảnh đã chọn và ảnh ở màn hình câu hỏi. Chạm hoặc nhấn Enter trên bao bì để chọn nhóm; trên máy tính có thể kéo thả.
- Sau phân loại là 3 câu hỏi lý do cho 3 nhóm. Người trả lời có thể bấm tab để đánh giá theo thứ tự bất kỳ; mỗi câu cần ít nhất 10 ký tự.
- Sau khi trả lời đủ 3 câu, người tham gia nhập Họ và Tên (bắt buộc) và SĐT (không bắt buộc), rồi gửi để xem màn hình cảm ơn.
- Thay đổi thư viện ảnh sẽ tăng `surveyVersion`. Bản nháp vẫn được giữ nếu ảnh đã chọn còn tồn tại; nếu một ảnh đã chọn bị xóa, người trả lời được đưa về bước phân loại để chọn lại.

## Triển khai

Khi deploy trên Vercel, dự án dùng `server.js` làm Node entrypoint và Vercel Blob để lưu ảnh cùng cấu hình khảo sát. Cần kết nối một Blob store công khai với project để Vercel tự cấp `BLOB_READ_WRITE_TOKEN` hoặc `BLOB_STORE_ID`. Đặt `ADMIN_TOKEN` trong môi trường Production và Preview. Cấu hình thêm `GOOGLE_SHEETS_WEBHOOK_URL` và `GOOGLE_SHEETS_SECRET` để bật nhận phản hồi.

Sau khi mở khóa quản trị, phần **Nguồn nhận phản hồi** hiển thị trạng thái kết nối và nút mở Apps Script hoặc Vercel. Để đổi sang Sheet khác, cập nhật `SPREADSHEET_ID` trong Apps Script mới, triển khai lại Web app, sau đó thay hai biến `GOOGLE_SHEETS_WEBHOOK_URL` và `GOOGLE_SHEETS_SECRET` trong Vercel Production rồi redeploy. Khóa không được nhập hay hiển thị trong trang quản trị.

Khi chạy bằng Node trên máy riêng, ảnh và cấu hình nằm trong `data/`. Đặt `HOST=0.0.0.0`, `PORT`, `DATA_DIR` nếu cần truy cập qua mạng. Dùng HTTPS và không công khai mã quản trị. Bản hiện tại chưa có giới hạn tốc độ gửi công khai; nên thêm ở lớp hosting khi mở khảo sát rộng rãi.

