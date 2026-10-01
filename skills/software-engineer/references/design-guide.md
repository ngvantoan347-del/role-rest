# Design Guide

Những quyết định đắt để đảo ngược. Đọc trước thay đổi T3, đọc lướt phần liên quan cho
T2.

Điều kiện lọc: ở đây chỉ giữ phần **dễ bị bỏ qua khi đang vội**, kèm lý do. Kiến thức
kỹ thuật thuần tuý — HTTP là gì, transaction là gì — không cần ở đây vì bạn đã biết. Cái
cần là phần mà bạn biết nhưng dưới áp lực deadline sẽ bỏ qua.

## Boundary — tại sao đây là thứ đắt nhất sửa

Phần khó nhất của một hệ thống không phải logic bên trong, mà là ranh giới giữa các phần.
Chữ ký hàm và shape dữ liệu là thứ **mọi thứ khác phụ thuộc vào**, và chúng bị khóa từ
rất sớm — sửa lúc sau tốn gấp bậc so với lúc đầu.

```text
UI / CLI  ->  Application (use case)  ->  Domain (rule)  ->  Port
                                                        ^
                                          Adapter (IO) --+
```

- Dependency một chiều. `domain` không import gì từ `adapter` hay `ui`.
- Giao tiếp liên module đi qua interface có tên, không qua import thẳng vào internal state.
- **Mỗi dòng import mới là một tuyên bố kiến trúc.** Đọc chúng trước khi commit.
- Public API của module = những gì nó export. Phần còn lại là private và muốn đổi thì đổi.
- Cycle nghĩa là khái niệm chung thuộc về module thứ ba, chứ không phải lỗi import.

## Contract — khai báo gì cho mọi boundary mới

| Yếu tố | Câu hỏi phải trả lời |
| --- | --- |
| Input | type, bắt buộc hay tuỳ chọn, đơn vị, nullability, giới hạn |
| Output | shape, thứ tự, phân trang, rỗng khác null thế nào |
| Failure | lỗi nào, throw hay trả về, cái nào retry được, ai xử lý |
| Side effect | ghi gì, network, file, event, transaction, idempotent không |
| Giới hạn | rate, size, timeout, retry count, backpressure |
| Tương thích | ai đang consume, caller cũ còn chạy không |

Trả lỗi **dưới dạng giá trị** ở core và throw ở edge, để compiler buộc caller xử lý. Để
exception cho những case thực sự hiếm.

Mỗi export là một lời hứa bạn phải giữ. Giữ public surface nhỏ.

## Tương thích ngược

- **Thêm, không đổi tên hoặc tái sử dụng ý nghĩa**, trong cùng một thay đổi.
- Hỗ trợ cả hai shape trong suốt cửa sổ deprecation, đo mức dùng, gỡ khi về 0.
- Breaking change = major version + ghi chú migration + mốc thời gian.
- Với dữ liệu bạn không kiểm soát — row đã lưu, payload cache, callback của bên thứ ba —
  **giả định bản cũ và bản mới cùng tồn tại** và làm reader chấp nhận cả hai.

Migration là một loại breaking change nữa: đọc nó như vậy.

## Data

- Model **domain**, không phải database. Business rule thuộc về type, không nằm trong query.
- **Làm cho trạng thái sai không thể biểu diễn**: enum thay string, `Email` thay `string`,
  `PositiveAmount` thay `number`, non-empty thay nullable. Rẻ hơn nhiều so với check ở mọi nơi.
- Id ổn định + `createdAt`/`updatedAt` cho thứ được lưu.
- UTC khi lưu, hiển thị theo local, **luôn ghi rõ đơn vị**.
- Tiền: số nguyên của đơn vị nhỏ nhất hoặc kiểu decimal. **Không bao giờ float nhị phân.**
- Xóa: chọn soft hay hard theo từng entity và nhất quán. Row soft-delete phải bị loại mặc
  định ở **mọi** query.
- Migrations: forward-only, additive là mặc định, phải chạy an toàn khi code cũ vẫn đang
  phục vụ traffic, có rollback hoặc nói rõ là không thể.

## Error và observability

- **Không bao giờ nuốt.** Thực sự bỏ qua được thì log kèm context và lý do.
- Giữ nguyên nhân khi bọc lỗi.
- Message dành cho operator: cái gì fail, id nào, nguyên nhân khả dĩ. Không phải copy cho
  user và không được lộ internal hay secret.
- Log field có cấu trúc kèm correlation id, không phải câu văn xuôi.
- Nếu bàn giao nói "monitoring", thì phải có metric, log line, hoặc alert thật.

## Security

Vì sao đây là phần dễ bỏ nhất: nó không có test nào fail khi bạn quên.

- Secrets chỉ từ env. Không literal, không config commit.
- Validate **mọi** input ở boundary: từ client, từ network, từ file.
- Parameterize query. Không dựng SQL bằng string.
- Escape output. Không `dangerouslySetInnerHTML`, `eval`, `exec`, hay shell interpolation
  của giá trị không tin.
- AuthN + authZ ở **mọi** boundary. Mặc định là từ chối.
- **Đừng log hoặc trả về nhiều dữ liệu cá nhân hơn feature cần.**
- Rate limit và giới hạn payload cho mọi thứ public.
- Dependency: ưu tiên package được duy trì, đọc install script, audit trước khi thêm thứ
  chạm network, filesystem, hay crypto.

## Extensibility mà không over-engineer

- Giải quyết vấn đề hôm nay bằng cấu trúc đơn giản nhất thoả contract.
- Trừu tượng hoá khi có **hai** biến thể thực sự khác nhau, hoặc khi bản sao thứ ba xuất
  hiện — không phải khi biến thể tương lai được tưởng tượng.
- Config và composition hơn inheritance và monkey-patching.
- Khi thêm một seam, hãy làm nó hẹp: một interface, một implementation rõ ràng.

Chi phí của abstraction sớm: nó đóng băng dự đoán sai. Chi phí của chưa trừu tượng hoá:
mỗi bản sao nhân mọi bug lên N.

## Kích thước

- Một trách nhiệm mỗi file; tên file khớp nội dung.
- Gom theo **feature**, không theo loại file, khi dự án vượt vài module.
  (`features/checkout/`, không phải các chỗ `services/`, `utils/`, `helpers/`.)
- Cảnh báo ở ~300 dòng, không tạo file mới quá ~500. File to là tín hiệu phải tách, không
  phải lý do tiếp tục nối thêm.
- Hàm cần comment để giải thích nhánh là hàm quá dài.
- Config, secrets, generated code nằm ngoài cây source.

## Performance

**Chỉ tối ưu thứ đã đo.** Vì sao: tối ưu theo cảm giác thường làm chậm hơn, thêm độ phức
tạp, và tạo cảm giác an toàn giả — tệ hơn cả việc không tối ưu.

1. Có con số: profile, benchmark, hoặc đọc slow query plan.
2. Tìm bottleneck thật (thường là I/O hoặc N+1 query, không phải ngôn ngữ).
3. Thay đổi nhỏ nhất làm dịch chuyển con số.
4. Đo lại và báo before/after.

Kiểm tra mặc định, theo thứ tự phổ biến: N+1 query, `SELECT *` không giới hạn, thiếu
pagination, sync IO trong request path, thiếu timeout cho outbound call, cache trong bộ
nhớ không giới hạn.
