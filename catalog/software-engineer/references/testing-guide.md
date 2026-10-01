# Testing Guide

Test không phải nghi thức coverage. Nó là cách rẻ nhất để một thay đổi vừa an toàn khi thực
hiện vừa an toàn khi giữ.

Điều kiện lọc: chỉ giữ phần quyết định **có test hay không** và **test có đáng tin
không**. Cú pháp framework thì bạn tra nhanh hơn đọc ở đây.

## Cái nào đáng có test

| Thay đổi | Test |
| --- | --- |
| Sửa bug | Test hồi quy: fail trước fix, pass sau fix |
| Behavior public mới | Một test cho mỗi behavior đã tài liệu hoá, **kể cả nhánh lỗi** |
| Refactor | Không. Suite hiện tại chứng minh behavior không đổi |
| Migration | Up, down, và shape sau migration |
| Sửa perf | Benchmark hoặc số đo ghi trong PR, **không** assert thời gian trong test |
| Typo, comment, log message, format | Không |

Không test: internal private, getter trả về cái vừa set, chính framework, hay giá trị trả
về của một mock.

Một test vỡ mỗi lần refactor trong khi behavior không đổi là **chi phí không lợi ích gì**.
Test đó đang bảo vệ code thay vì behavior — và khi behavior thật sự hỏng, nó vẫn xanh.

## Test đáng tin

- **Một behavior mỗi test.** Tên là một mệnh đề:
  `rejects orders after expiry` hơn `test order 3`. Khi test fail, tên phải nói lỗi ở đâu.
- **Tất định.** Không network thật, không clock thật, không `sleep`, không random không
  seed cố định, không phụ thuộc thứ tự chạy, không state dùng chung giữa test.
  Flaky test tệ hơn không có test: nó dạy team bỏ qua cả suite.
- **Assert vào behavior và contract** — giá trị trả về, row đã lưu, event phát ra,
  HTTP response — không phải vào việc private method nào được gọi.
- **Một lần mỗi test:** xóa feature thì test có fail không? Nếu vẫn xanh, test vô
  dụng. Đây là cách rẻ nhất phát hiện test rỗng.
- **Assert rõ ràng.** Không pass âm thầm do assertion library cấu hình sai.
- **Dọn dẹp.** Mỗi test để hệ thống như lúc nó tìm thấy: temp dir, DB row, env var,
  global state, timer.

## Kim tự tháp

- **Unit** — nhanh, thuần, không IO. Một behavior mỗi test.
- **Integration** — biên thật: database, filesystem, queue, HTTP handler. Ít hơn, chậm
  hơn, và là nơi lỗi wiring thực sự sống. Lỗi phần lớn nằm ở biên, nên test integration
  hoàn trả chi phí tốt nhất.
- **End-to-end** — chỉ đường user quan trọng. Đắt và flaky; giữ số lượng nhỏ và selector
  bền.

Phần lớn tốc độ đến từ việc unit test không dính IO. Phần lớn bug đến từ biên. Đó là lý do
không nên tối ưu cái này bằng cách cắt integration test.

## Test doubles

**Fake cái chậm và không ổn định. Không bao giờ fake thứ đang được test.**

- Ưu tiên **fake** hơn mock: một implementation trong bộ nhớ hành xử giống thật thì sống
  sót qua refactor; mock gắn với call count thì không.
- Nếu một fake thay thế dependency thật trong test, nó phải pass **cùng một contract
  suite** — nếu không nó trôi thành implementation thứ hai, sai.
- **Tiêm clock.** Test phụ thuộc "bây giờ" là test flaky nhất trong bất kỳ suite nào.
- Pin timezone và locale trong test env. Timezone không pin sinh lỗi chỉ xuất hiện trên
  máy của một người đóng góp.
- Snapshot chỉ cho cấu trúc lớn ổn định. Snapshot nhỏ thay đổi ở mọi refactor và không
  ai đọc kỹ chúng.

## Coverage

Coverage là công cụ khám phá, không phải mục tiêu.

- Dùng nó để tìm **nhánh chưa test**, không để đuổi một tỷ lệ phần trăm.
- Hướng 100% sinh ra test khẳng định ngôn ngữ lập trình, không phải hành vi.
- Cái đáng theo dõi là coverage trên **dòng vừa thay đổi**: giảm ở đó là phát hiện thật.

## Suite đang đỏ

1. Xác nhận lỗi có trước thay đổi của bạn không (`git stash` rồi chạy lại, hoặc đọc
   history của test đó).
2. **Đừng làm nó biến mất.** Không skip, không xóa, không nới, không `.only`.
3. Báo cáo: test nào fail, lệnh gì, và thay đổi của bạn có liên quan không.
4. Nếu nó chặn verification của bạn, nói rõ verification đang bị chặn và vì sao.

Suite xanh bằng cách nới test là một lời nói dối, và lời nói dối đó sống tới production.

## Chạy gate

Từ hẹp tới rộng — test cụ thể, typecheck, lint, full suite, build — rồi
`node <skill-base>/scripts/smells.mjs --changed`.

Suite chưa chạy là một claim chưa verify, và claim chưa verify không phải output chấp
nhận được.
