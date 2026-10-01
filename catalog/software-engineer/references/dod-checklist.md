# Definition of Done

Ô nào chưa tick thì hoặc sửa ngay, hoặc báo là khoảng trống đã biết. **"Nó chạy rồi" không
phải một mục trong danh sách này — bằng chứng mới là.**

Điều kiện lọc: checklist này chỉ hữu ích nếu bạn thực sự chạy nó, không phải đọc cho có.
Các mục bỏ qua cũng phải được **báo**, chứ im lặng là dạng tệ nhất của im lặng.

## Đúng đắn

- [ ] Làm đúng cái được yêu cầu, và **chỉ** cái được yêu cầu.
- [ ] Nguyên nhân gốc đã hiểu và nói ra, không chỉ vá.
- [ ] Gate đã chạy: test cụ thể, typecheck, lint, full suite, build — output đã lưu.
- [ ] Edge case đã cân nhắc: rỗng, null, 0, âm, rất lớn, unicode, đồng thời.
- [ ] Lỗi được xử lý có chủ đích; không gì bị nuốt.
- [ ] Không thay đổi ngoài phạm vi trong diff.

## Thiết kế

- [ ] Nằm ở tầng sở hữu trách nhiệm; dependency một chiều; không cycle mới.
- [ ] Interface public và data shape được tài liệu hoá ở nơi consume.
- [ ] Tương thích ngược được giữ, hoặc breaking change được nói to.
- [ ] Dùng lại code sẵn có thay vì nhân bản.
- [ ] Không god file, không hàm không giới hạn; nhất quán với quy ước dự án.

## Test

- [ ] Mỗi bug fix có test hồi quy **fail trước khi fix**.
- [ ] Behavior public mới có test, kể cả nhánh lỗi.
- [ ] Tất định: không network thật, clock thật, `sleep`, hay state dùng chung.
- [ ] Không có gì bị skip, nới, hoặc xóa để lấy xanh.

## Hygiene

- [ ] `node <skill-base>/scripts/smells.mjs --changed` sạch, hoặc phát hiện đã được giải thích.
- [ ] Không còn `TODO`/`FIXME`/`HACK`/`temp`/`quick fix` trong cây.
- [ ] Không code bị comment, log debug, hay file giàn giáo.
- [ ] README, docs, ví dụ, `.env.example` đã cập nhật chỗ thay đổi làm sai.
- [ ] Comment giải thích **tại sao**; comment thuần túy đã xóa. Changelog entry nếu có.
- [ ] `git status` chỉ hiện thay đổi đã định.

**Nhắc lại:** mục `smells.mjs` ở trên chỉ là một phần. Checklist này không thay được phần
judgment ở `references/anti-patterns.md`. Xanh script **không** phải là xong.

## Security và data

- [ ] Không secret, token, dữ liệu user thật trong code, log, test, hay commit.
- [ ] Input validated ở boundary; query parameterized; output escaped.
- [ ] Auth và authorization được kiểm ở đường mới.
- [ ] Migration additive, reversible, an toàn với traffic đang chạy.

## Bàn giao

- [ ] Tóm tắt mô tả **behavior**, không phải liệt kê file; file gom theo mục đích.
- [ ] Quyết định thiết kế và lý do đã nêu.
- [ ] Lệnh cụ thể và kết quả của chúng đã liệt kê.
- [ ] "Not done / risks" trung thực và cụ thể.
- [ ] Quyết định mở cần người dùng chọn được nói tường minh.

```text
## What changed
## Files          - <path> - <mục đích>
## Design         - <hợp đồng đã chọn, và vì sao chọn thay vì phương án khác>
## Verification   - `<lệnh>` -> <kết quả>
## Not done / risks
## Decisions needed
```

## Một câu hỏi duy nhất

> Nếu kỹ sư kế tiếp chỉ đọc diff và phần bàn giao của tôi — họ có sửa được code này an
> toàn không, và họ có tin lời tôi không?

Nếu không, thì chưa xong.
