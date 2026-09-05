# English Lab — Speaking Room

Trang luyện nói độc lập cho web app English Lab trên Google Apps Script.

## Luồng hoạt động

1. English Lab mở trang này bằng `window.open()` với một session ID ngẫu nhiên.
2. Hai cửa sổ bắt tay bằng `postMessage`; GAS gửi toàn bộ bài gồm câu, bản dịch, `videoId` và timestamp.
3. Speaking Room chạy trọn phiên nhiều câu, phát đúng đoạn video gốc bằng YouTube IFrame API và dùng Web Speech API để nhận dạng tiếng Anh.
4. Sau khi chấm, các từ sai liền nhau được gộp thành cụm, hiện IPA ngay bên dưới và có thể nhấn để nghe riêng. IPA/audio ưu tiên dữ liệu Vocab và từ điển phía GAS; khi thiếu audio, trình duyệt dùng giọng tiếng Anh làm phương án dự phòng.
5. Mỗi transcript được gửi ngầm về đúng cửa sổ English Lab. GAS kiểm tra origin + source + session, tự tính lại điểm và lưu tiến độ qua `google.script.run`.

Không có API key trong frontend. Trang không tải hoặc lưu file âm thanh trên GitHub.

## Chạy thử tại máy

```bash
python3 -m http.server 8080
```

Mở `http://localhost:8080/#target=How%20are%20you%20today%3F`. Chế độ URL trực tiếp chỉ dùng để xem thử một câu; phiên đầy đủ phải được mở từ English Lab. Micro được phép trên `localhost`; khi xuất bản phải dùng HTTPS.

## Xuất bản

Repository được cấu hình để GitHub Pages phục vụ trực tiếp từ nhánh `main` và thư mục gốc.
