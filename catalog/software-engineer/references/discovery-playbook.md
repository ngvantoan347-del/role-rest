# Discovery Playbook

Cách đọc codebase lạ đủ nhanh để sửa nó an toàn. Mục tiêu: **10 phút để có một plan đúng**,
không phải đi hết một dự án.

Vì sao phải kỷ luật thời gian: đọc sâu có giá trị, nhưng chỉ trong phạm vi dẫn tới quyết
định. Đọc quá chỗ đó là trì hoãn đang mạo danh là cẩn trọng — và nó làm người dùng chờ.

## 0. Đặt câu hỏi trước

Trước khi đọc gì, viết một câu:

> **Hành vi quan sát được nào phải thay đổi, và cái gì phải giữ nguyên y hệt?**

Mọi thứ bạn đọc phải phục vụ câu đó. File thú vị nhưng không liên quan thì bỏ qua. Câu này
cũng là câu hỏi để tự kiểm tra khi đến lúc bàn giao.

## 1. Trình tự 10 phút

Chạy theo thứ tự, dừng khi đã đủ để gọi tên file và lệnh chứng minh.

| Bước | Lệnh | Biết được gì |
| --- | --- | --- |
| 1. Hình dạng | `ls`, `tree -L 2`, `git ls-files \| head -100` | Layout, monorepo hay đơn |
| 2. Manifest | `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` | Ngôn ngữ, framework, entry point |
| 3. **CI config** | `.github/workflows/*.yml`, `.gitlab-ci.yml` | **Lệnh lint/typecheck/test/build chuẩn** |
| 4. Entry point | `src/main.*`, `cmd/`, `server.ts` | Hệ thống khởi động thế nào |
| 5. Seam | tìm symbol / route / config key cần đổi | Module sở hữu behavior |
| 6. Ví dụ gần nhất | code đang làm việc tương tự | Pattern phải theo |
| 7. Test | test của module sắp sửa | Behavior đúng, và pattern test |
| 8. History | `git log --oneline -20 -- <path>`, `git blame` | Tại sao code trông như vậy |
| 9. Lock | lockfile, `engines`, `.nvmrc`, `rust-toolchain` | Ràng buộc toolchain |

Bước 3 là bước quan trọng nhất và thường bị bỏ qua. **CI config là nguồn sự thật** về
"xanh" nghĩa là gì. README nói "chạy `npm test`" còn CI chạy `npm run test:ci && npm run
lint` với coverage threshold — đó là hai định nghĩa khác nhau về việc xong.

## 2. Tìm seam

Tại sao: cấu trúc thật nằm ở chỗ module nào gọi module nào, không nằm ở cây thư mục. Cây
thư mục nói cho biết tác giả *định* tổ chức thế nào; import mới là bằng chứng.

- **Tìm theo symbol, không lần theo cây thư mục.** Search tên hàm, route, config key, hoặc
  chuỗi lỗi bạn cần. Đi từng bước một.
- **Import graph là ranh giới.** Ai import module sắp sửa? Đó là **bề mặt tương thích**.
  Nếu `frontend` import `db`, bạn đang chuẩn bị tạo vi phạm layer.
- **Wiring nói thật.** Route table, DI container, plugin registry cho biết cái gì thực sự
  nối với nhau — khác với cái gì chỉ tồn tại trên giấy.
- **Data là nơi rủi ro.** Schema, migration, ranh giới serialize phải được đọc **trước khi**
  thiết kế bất cứ thứ gì lưu hoặc gửi data.

## 3. Đọc history khi code trông sai

```bash
git log --oneline -20 -- path/to/file
git log -S "someSymbol" --oneline        # symbol này vào/ra khi nào
git blame -L 40,90 path/to/file
```

Code kỳ quặc thường là chủ ý: bug vendor, ca sửa timezone tại chỗ, workaround cho bug
framework. Nếu `git blame` cho thấy một commit sửa bệnh ngay cạnh dòng trông thừa, giữ
nó — và thêm comment giải thích nếu chưa có.

Xóa một dòng "thừa" là cách nhanh nhất để tái tạo bug đã sửa từ 2 năm trước.

## 4. Evidence table

Giữ sự thật kèm nguồn để plan kiểm chứng được và bàn giao trích dẫn được.

| Sự thật | Nguồn | Độ tin cậy |
| --- | --- | --- |
| Unit test chạy bằng `npm test` | `package.json:scripts.test`, CI workflow dòng 42 | Đã verify |
| Tạo user ghi vào bảng `users` | `src/repo/user-repository.ts:88` | Đã verify |
| Rate limit áp ở gateway | chỉ có claim trong README, không thấy code | **Chưa verify — hỏi** |

- Claim không có `path:line` hoặc output lệnh là **giả thuyết**, và phải gọi đúng tên nó.
- Giả thuyết quan trọng thì đọc thêm một phút để xác nhận. Rẻ lúc này, đắt lúc sau.
- Không xác nhận được thì **hỏi người dùng**, đừng build trên nó.

## 5. Dấu hiệu đã khám phá xong

- Gọi tên được chính xác file sẽ sửa, kèm lý do từng file.
- Biết lệnh nào chứng minh thay đổi hoạt động.
- Biết file test hiện có để mở rộng.
- Biết bề mặt tương thích: ai phụ thuộc vào thứ bạn đổi.
- Mô tả được thiết kế trong hai câu.

Dừng tại đây.

## 6. Khi nào hỏi thay vì đọc

Hỏi sớm, hỏi cụ thể, kèm lựa chọn:

- Hai thiết kế khả dĩ có chi phí khác nhau rõ rệt.
- Yêu cầu mâu thuẫn với hành vi hiện tại ("thêm toggle" mà không có toggle).
- Bất cứ thứ gì chạm auth, billing, xóa dữ liệu, hoặc compliance.
- Migration không thể rollback rẻ.

Một câu hỏi chính xác rẻ hơn nhiều so với một giả định sai bị đóng vào diff lớn.
