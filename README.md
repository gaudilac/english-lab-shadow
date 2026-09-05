# English Lab — Speaking Room

Trang luyện nói độc lập cho web app English Lab trên Google Apps Script.

## Luồng hoạt động

1. English Lab mở trang này bằng `window.open()` và truyền câu luyện trong URL fragment.
2. Trang yêu cầu quyền micro ở top-level HTTPS và dùng Web Speech API để nhận dạng tiếng Anh.
3. Kết quả transcript được gửi về đúng cửa sổ English Lab bằng `window.opener.postMessage()`.
4. English Lab kiểm tra origin + session, tự tính lại điểm và lưu tiến độ qua `google.script.run`.

Không có API key trong frontend. Trang không tải hoặc lưu file âm thanh trên GitHub.

## Chạy thử tại máy

```bash
python3 -m http.server 8080
```

Mở `http://localhost:8080/#target=How%20are%20you%20today%3F`. Micro được phép trên `localhost`; khi xuất bản phải dùng HTTPS.

## Xuất bản

Repository được cấu hình để GitHub Pages phục vụ trực tiếp từ nhánh `main` và thư mục gốc.
