# Anti-Patterns

`smells.mjs` bắt được phần cơ học. File này là phần **cần phán đoán** — những thứ
regex không bao giờ chạm tới, và cũng là những thứ thực sự làm hỏng hệ thống.

Vì sao tách riêng: một regex so khớp chuỗi. Nó không biết requirement là gì, không biết
module nào sở hữu behavior, không biết điều gì sẽ đúng ở 10.000 bản ghi. Toàn bộ bảng dưới
đây là loại lỗi mà bạn chỉ tìm ra bằng cách dừng lại và hỏi.

## A. Lỗi làm hỏng hệ thống — không công cụ nào thấy

| Smell | Tại sao script không thấy | Tại sao nó nguy hiểm | Cách phát hiện |
| --- | --- | --- | --- |
| **Abstraction sai tầng** | Code đúng, chạy, chỉ là ở chỗ sai | Mỗi thay đổi business rule phải sửa ở mọi nơi, và ai cũng sợ sửa | Hỏi: "khi yêu cầu này đổi, ai cần được hỏi?" Không ai → sai tầng |
| **Logic đúng, ý sai** | Không có cú pháp nào biết requirement | Feature ship nhưng làm sai đề bài, và test cũng xanh vì test viết theo cùng hiểu sai | Đi từng nhánh hỏi "nhánh này phục vụ điều gì?" |
| **Hỏng khi scale** | 10 bản ghi thì đúng | Hỏng lúc traffic lên, lúc đó fix tốn gấp 10 | Luôn hỏi về N: N+1 query, thiếu pagination, connection không bound, cache không giới hạn |
| **Hỏng khi chạy song song** | Test tuần tự đều xanh | Race condition hiếm, khó tái hiện, tốn kém nhất khi xảy ra | Hai request cùng lúc thì sao? Có idempotency key? Có transaction? |
| **Hỏng trên production** | Dev máy 8 nhân, prod 2 nhân | Vấn đề chỉ xuất hiện sau khi deploy | Config ở đây có giống production? Timeout có set? |
| **Lỗ hổng từ ý định** | Regex secret không hiểu "endpoint này lộ PII của user khác" | Rò dữ liệu là sự cố không hoàn tác | Mọi boundary có authN + authZ? Response có đúng mức dữ liệu cần? |
| **Test xanh nhưng vô nghĩa** | Pass, coverage đầy | Tạo cảm giác an toàn giả | Xóa feature: test có fail không? Test khẳng định contract hay implementation? |
| **Drift docs ↔ code** | Cả hai đều "chạy" | Người mới tin tài liệu sai và đi theo hướng sai | Sau mỗi thay đổi: docs nào giờ sai? |

## B. Unverifiable claims

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| "Chắc là chạy rồi" | Kết luận từ suy đoán được ship như sự thật | Chạy lệnh, dán output |
| "Đã fix" mà không giải thích nguyên nhân | Cùng một bug quay lại trong áo khác | Nguyên nhân gốc trong 2 câu ở phần bàn giao |
| Kết quả test mô tả từ trí nhớ | Output bịa phá hủy niềm tin mọi câu trả lời sau | Chỉ báo cáo thứ terminal in ra |
| "Tôi nghĩ vấn đề là X" mà không truy | Đoán tốn vòng lặp | Reproduce, rồi nêu nguyên nhân kèm `file:line` |

## C. Deferred debt

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| `TODO` không chủ, không issue | Không ai dọn, không ai thấy | Làm xong, hoặc tạo issue và link trong comment |
| "add later" quanh một capability thiếu | Contract có, behavior không | Làm xong hoặc gỡ bỏ surface đã expose |
| `return null` / thân rỗng ở nơi đã hứa | Caller dựa vào nó, crash dời lên production | Throw lỗi "chưa implement" rõ ràng, hoặc implement |
| Fake data trong production path | Demo data lọt tới user | Fixture chỉ thuộc về test |
| Code bị comment | Code chết và che mất ý định | Xóa. Git nhớ mọi thứ. |
| "Cleanup" là một mục backlog | Không bao giờ có ngày dọn | Dọn luôn trong thay đổi đang làm |

## D. Structural chaos

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Business rule nằm trong UI/controller/route | Rule không tái dùng, không test được | Chuyển sang tầng application/domain |
| Vi phạm layer (UI import DB) | Thay đổi lan khắp, không còn đường lùi | One-way dependency; soi dòng import mới |
| Import cycle | Không module nào tách ra được an toàn | Tách khái niệm chung ra module thứ ba |
| `utils.ts` / `helpers.ts` | Tên vô nghĩa, không ai sở hữu | Tách theo trách nhiệm, đặt tên thật |
| God object làm cả IO, rule, format | Không test được, không đổi được | Một đơn vị, một trách nhiệm |
| File 1000+ dòng | Không ai review nổi, mọi thay đổi đều conflict | Tách theo trách nhiệm |
| File >500 dòng, hàm >80 dòng | Dấu hiệu thiết kế chưa ngã ngũ | Tách tại các seam bạn gọi tên được |

Đây chính là bức tranh trong ảnh: một bó dây ai cũng nối vào thứ gần nhất nhất. Nó vẫn "chạy"
— nhưng không ai dám tháo một sợi mà chắc chắn nó không quan trọng. Cách sửa là **đặt tên các
đầu mối và định hình có chủ đích**, không phải cố gắng hơn với đống dây.

## E. Copy-paste

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Hai khối giống nhau | Bản thứ ba mới là lúc phải xử lý | Trừu tượng hoá ở lần ba (hoặc ở lần hai nếu chắc chắn sẽ phân kỳ) |
| Copy validation / error handling | Message lệch nhau, rule lệch nhau | Một validator dùng chung |
| Copy config / hằng số | Drift là chuyện thời gian | Một nguồn sự thật duy nhất |
| "Copy file cũ rồi sửa" | Kế thừa luôn bug và code chết của file cũ | Bắt đầu từ cấu trúc đúng nhỏ nhất |

## F. Data và failure

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Không validate ở boundary | Rác vào, sự cố ra | Validate và normalize một lần ở biên |
| SQL dựng bằng string | Injection | Luôn parameterized query |
| Secret/token trong code, log, fixture | Lọt rồi là mất | Env hoặc secret store; `.env.example` mô tả shape |
| Dữ liệu user thật trong test | Vi phạm riêng tư và pháp lý | Dữ liệu giả có cùng shape |
| Migration không rollback | Mất dữ liệu không cứu được | Additive, reversible, chạy được với traffic cũ |
| Query/upload không giới hạn | DoS dễ dàng | Limit, pagination, timeout |
| `catch` rỗng | Lỗi biến mất, bug thành bí mật | Xử lý, hoặc log kèm context và lý do |
| "Something went wrong" | Vô dụng lúc 3 giờ sáng | Có gì fail, id nào, nguyên nhân khả dĩ |
| `null` cho cả "không có" lẫn "lỗi" | Caller không phân biệt được | Kiểu riêng hoặc trả lỗi tường minh |
| Retry không giới hạn | Giấu lỗi thật, khuếch đại tải | Retry có hạn + backoff, rồi báo ra |

## G. Process shortcuts

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| Commit thẳng branch được bảo vệ | Không review được, không bisect được | Feature branch, commit nhỏ, PR |
| Một commit chứa việc không liên quan | Không tách lẻ được | Một commit một concern |
| Viết lại history đã public | Phá việc của người khác | Chỉ rebase commit chưa ai lấy |
| `git add .` khi chưa biết có gì | Commit secret của người khác | Đọc `git status` + diff trước |
| Bỏ qua test fail sẵn có | Giấu hỏng hóc thật | Báo cáo, không chôn |
| "Thử cái này" để lại trong tree | Behavior lạ ship lên production | Revert, rồi áp dụng fix có lý do |
| Cross-cutting change không plan | Refactor giả dạng feature | Plan, rồi làm theo từng bước |

## H. Documentation debt

| Smell | Why it hurts | Fix |
| --- | --- | --- |
| README mô tả hành vi cũ | Gây hiểu sai có chủ đích | Sửa trong cùng thay đổi |
| Quyết định không ai giải thích được | Người sau tranh lại từ đầu | Comment lý do, hoặc ADR |
| Comment thuần túy tự tán | Che mất comment có nghĩa | Xóa |
| Ví dụ lệch với config thật | Người mới không chạy được | Sinh lại và kiểm chứng |

## Hai kiểu hỏng duy nhất

Mọi dòng trên thuộc về **chưa verify** hoặc **chưa có chủ**. Sửa verification trước, rồi
gắn chủ và thiết kế cho phần còn lại.
