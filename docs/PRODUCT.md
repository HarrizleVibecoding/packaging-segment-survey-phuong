# Đặc tả khảo sát bao bì · 2026-11-10

## Brief (Kry debrief)

**Mục tiêu:** tìm hiểu cách người tiêu dùng nhận diện phân khúc bao bì và các dấu hiệu tạo cảm nhận cao cấp để phục vụ phát triển nhận diện sản phẩm.

**Vai:** người quản trị tải ảnh; người tiêu dùng phân loại và trả lời; Google Sheet là nơi nhận phản hồi.

**Quy tắc:** ảnh mẫu ghi chọn đúng 3 ảnh cho mỗi nhóm, nên phiên bản này yêu cầu 3 ảnh/nhóm (tổng 9); “tối đa 3” được hiểu là giới hạn cho mỗi nhóm. Các nhóm hiển thị là Economy, Mainstream, Upper Mainstream. Người dùng có thể bỏ chọn và chọn lại. Thư viện chứa tối đa 30 ảnh.

## Intent và luồng (Kry UX)

| Khoảnh khắc | Ý định | Đáp ứng |
| --- | --- | --- |
| Thấy nhiều ảnh | Xem rõ bao bì | Kính lúp mở ảnh lớn, đóng được bằng Esc |
| Phân loại | Đưa ảnh vào nhóm cảm nhận | Kéo thả hoặc bấm nút nhóm; 3 ô có bộ đếm |
| Đổi ý | Sửa lựa chọn | Nút × trên ảnh đã chọn; ảnh trở lại khu vực chờ |
| Giải thích | Nhớ mình đã chọn gì | 3 ảnh đã chọn hiển thị ở mỗi câu hỏi nhóm |
| Gửi | Biết phản hồi đã nhận | Chỉ hiện hoàn tất sau khi Sheet xác nhận; lỗi giữ bản nháp |

**Các màn:** phân loại, 3 câu hỏi theo nhóm (chuyển tab tự do), hoàn tất, quản trị ảnh, phóng to ảnh.

**Điều kiện nghiệm thu:** 9 ID ảnh không trùng; đúng 3/nhóm; 3 câu mở đủ ít nhất 10 ký tự; không thể gửi lại thành 2 hàng; thay đổi thư viện làm tăng phiên bản khảo sát.

## Nền hệ thống (Kry system)

- Cấu hình: `version` và mảng sản phẩm `{ id, name, image }`, lưu trong Vercel Blob khi deploy, trong `data/survey.json` khi chạy cục bộ.
- Phản hồi: Google Sheet là nguồn dữ liệu trên Vercel. Bản cục bộ sao lưu thêm `responses.jsonl` sau khi Sheet nhận. Mỗi bản ghi gồm `submissionId`, thời gian, `surveyVersion`, ID và tên ảnh theo nhóm, 3 câu trả lời. Cột `upper_mainstream_signals` cũ trên Sheet được để trống.
- Ảnh lưu bền vững trong Vercel Blob hoặc `data/images` khi chạy cục bộ, tối đa 3 MB/ảnh và 30 ảnh trong thư viện, kiểm tra định dạng.
- `ADMIN_TOKEN` chỉ ở server; endpoint tải/xóa ảnh cần Bearer token.
- Gửi Sheet qua Apps Script với `GOOGLE_SHEETS_SECRET`; Apps Script khóa khi ghi, khử trùng `submissionId` và chặn công thức Sheets.
- Khi Sheet lỗi, server không báo thành công. Bản nháp ở `sessionStorage` để người trả lời thử lại.

## Hướng UI (Kry UI)

Trục chính là **ra quyết định nhanh trên nhiều bao bì**: ba vùng phân khúc hiển thị đồng thời, bộ đếm rõ, ảnh chờ xếp trong lưới dày nhưng có khoảng thở. Tông nền giấy ấm; xanh đậm cho thao tác chính; ba màu nhận diện nhóm. Trên màn hẹp, vùng nhóm xếp dọc và thao tác chuyển sang chạm nút.

## Việc cần trước khi mở khảo sát công khai

Kết nối Apps Script vào Sheet thật và cấu hình biến môi trường; chạy trên host có HTTPS và ổ lưu trữ bền vững; thêm rate limit ở reverse proxy theo lượng truy cập dự kiến.

