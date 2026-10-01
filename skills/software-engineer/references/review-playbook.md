# Review Playbook

Review có hai hướng: đọc diff của người khác, và đọc lại thay đổi của chính mình trước khi
mở PR. Cùng một bộ câu hỏi cho cả hai.

Phần PR **tác giả** viết — mô tả, format, secret, khi nào split — đã nằm ở
`references/git-workflow.md`. File này là phần **reviewer-side**: đọc gì trước, hỏi gì,
comment thế nào để được nghe, và khi nào thì chặn.

Vì sao tồn tại: phần lớn tiêu chuẩn "review kỹ" trở thành đọc diff một lượt rồi bấm
merge. Đó là hành vi có hậu quả, không phải sự cẩn thận — hậu quả là người khác phải tìm ra
lỗi của bạn trong production, nơi tốn gấp bộ.

## 1. Reviewer đang làm gì

Review không phải để viết lại code của người khác. Ba việc, theo thứ tự ưu tiên:

1. **Có an toàn merge không.** Lỗi nào tốn nhiều hơn để tìm ra sau này.
2. **Contract có đúng không.** Ai bị ảnh hưởng, và caller cũ có còn chạy không.
3. **Có đọc được trong một lần ngồi không.** Diff không review được là review không xảy
   ra.

Bạn **không** phải làm: chứng minh code của mình đẹp hơn, thêm abstraction, hay sửa lỗi
thuộc phạm vi PR đó. Vì sao: mỗi thay đổi không được hỏi ý kiến đẩy lỗi về chỗ không ai
đọc, và nó làm diff tốt bị chôn trong diff không liên quan.

Đọc như kỹ sư đang cố **giữ** hệ thống chạy, không như người đang muốn nó chạy theo ý
mình.

## 2. Thứ tự đọc diff

| Thứ tự | Đọc gì | Vì sao ở đây |
| --- | --- | --- |
| 1 | **Contract và data shape**: chữ ký, schema, response, migration | Blast radius được quyết định ở ranh giới. Sửa ở đây sau này đắt gấp bộ |
| 2 | **Đường lỗi và failure**: ai xử lý, retry, timeout, phần bị nuốt | Lỗi im lặng là lỗi quay lại dưới lớp áo khác |
| 3 | **Concurrency và transaction**: idempotency, thứ tự ghi, race | Test tuần tự đều xanh; lỗi chỉ hiện khi chạy thật |
| 4 | **Logic thân hàm** | Thường đúng nhất trong diff |
| 5 | **Tên, format, comment** | Không ship incident. Để CI và formatter lo |

Sai thứ tự phổ biến nhất là đọc hết thân hàm trước khi nhìn contract — bạn sẽ đọc một
lần ngồi hiểu code rồi phát hiện contract sai ở dòng cuối.

Chi tiết phần contract và data: `references/design-guide.md`.

## 3. Checklist high-signal

Đọc một lượt không đủ. Chạy từng câu hỏi này, và **trả lời thành tiếng** trong review —
câu trả lời miệng là thứ buộc bạn nghĩ tới nó.

| Câu hỏi | Câu trả lời xấu trông như thế này | Kiểm tra rẻ |
| --- | --- | --- |
| Ai bị ảnh hưởng bởi diff này? | "Chỉ nội bộ" mà không nói nội bộ nào | Đọc từ caller thật, đếm ngược từ symbol mới |
| Cái gì hỏng ở 10× lưu lượng? | Vòng lặp trong vòng lặp, `SELECT *` không limit | Đếm query mỗi request, tìm thiếu pagination |
| Thất bại một phần thì sao? | Ghi 3 bảng không transaction, rồi trả lỗi | Liệt kê side effect, hỏi cái nào phải atomic |
| Retry thì sao? | Không idempotency key, side effect lặp | Giả định request đến lần hai với cùng payload |
| Caller phiên bản cũ gọi vào thì sao? | Đổi tên/xoá field trong schema | Đọc consumer thật, không đọc PR mô tả |
| Xoá feature này, test có đỏ không? | Test assert vào mock nên vẫn xanh | Xoá nhánh và chạy lại |
| Đường lỗi có tồn tại hay bị nuốt? | `catch` rỗng, `except: pass`, `.catch(() => {})` | Tìm exception bị bỏ qua trong diff |
| Dữ liệu ghi có atomic không? | Ghi file trước, update DB sau | Kiểm tra thứ tự side effect |
| Có gì được log mà lẽ ra không nên? | Log payload đầy đủ, PII, token trong request | Đọc từng log line mới thêm |
| Config/env mới có default an toàn không? | `TIMEOUT_MS` không default, thiếu thì bằng 0 | Đọc `.env.example` và cách config được load |
| Đường mới có authN + authZ? | Chỉ copy auth từ route bên cạnh mà chưa kiểm tra | So với route tương tự đã có |

Đây là cùng nhóm lỗi mà `references/anti-patterns.md` liệt kê — viết từ phía reviewer, và
chỉ giữ những cái đọc được trong một diff. Chi tiết policy test: `references/testing-guide.md`.

Hai dòng cuối của bảng — log dữ liệu nhạy cảm và auth trên đường mới — là phần bị bỏ nhanh
nhất vì không có test nào đỏ khi bạn quên. Yêu cầu cụ thể cho chúng nằm ở
`references/compliance-and-data.md`.

## 4. Viết comment được nghe

Comment bị bỏ qua **không phải vì sai**, mà vì không hành động được. Một comment phải có bốn
thứ: **defect · input kích hoạt · hậu quả · gợi ý**. Thiếu một cái thì người kia phải tự
suy ra, và họ sẽ không làm.

| Comment | Điều gì xảy ra |
| --- | --- |
| "Nit: dùng `let` chứ không cần `const`" | Bỏ qua. Không ai sửa vì hậu quả bằng không |
| "Cái này hơi kỳ?" | Tác giả đoán ý reviewer, đoán sai, sửa theo hướng ngược |
| "Why?" | Không có context, tốn một vòng đi lại để lấy thông tin bạn đã có |
| "Nên dùng `Optional` ở đây" | Sửa hoặc không sửa tùy hứng — không ai biết hậu quả khi không sửa |
| Defect + input + hậu quả + gợi ý | Sửa ngay, hoặc giải thích tại sao không cần |

```text
Xấu:  "check empty trước khi ghi không?"

Tốt:  "Ở dòng 84, `saveOrder` nhận `order.items = []` khi payload thiếu trường
       `items`, và ghi luôn.
       Input: POST /orders với body không có `items`.
       Hậu quả: tạo order rỗng, không có lỗi trả về cho client.
       Gợi ý: trả 400 ở boundary nếu `items` rỗng, hoặc chặn bằng non-empty type."
```

```text
Xấu:  "Race condition ở đây."

Tốt:  "Nhánh `if (await exists(id))` rồi `insert` ở dòng 112-118 chạy ngoài
       transaction, và `id` tới từ client.
       Input: hai request giống nhau cùng lúc.
       Hậu quả: hai row trùng `id`, unique constraint fail ngẫu nhiên.
       Gợi ý: để DB chặn (unique index) và map lỗi đó thành 409, hoặc bọc
       vào transaction với idempotency key."
```

```text
Xấu:  "Rename `getUsers` thành `listUsers` cho đồng bộ."

Tốt:  "Contract: `getUsers` đang được import ở 4 chỗ khác repo và một service
       khác. `references/git-workflow.md` nói đổi tên đột ngột là phần đắt nhất.
       Nếu muốn đổi: giữ `getUsers` làm alias deprecated, đo usage, gỡ sau.
       Còn nếu chỉ là chuyện thẩm mỹ — để PR này yên."
```

```text
Xấu:  "Sửa lại lỗi timestamp này luôn."

Tốt:  "Dòng 201 so sánh `createdAt` với `now()` nhưng query đã lọc theo timezone
       UTC — lệch một giờ ở giữa ngày.
       Tôi chưa tái hiện được, nên đây là giả thuyết: cho tôi một case cụ thể để
       kiểm, hoặc bỏ comment này nếu bạn đã thấy rồi."
```

Quy tắc: comment **không đúng** vẫn viết, nhưng gọi đúng tên nó là giả thuyết. Comment
không phản hồi cũng vẫn bỏ lại — im lặng khi có ý kiến là loại comment tệ nhất.

## 5. Khi diff quá lớn để review

Ngưỡng 400 dòng trong `references/git-workflow.md` là giới hạn **tác giả** tự đặt. Bạn là
reviewer, bạn không có quyền đổi ngưỡng đó — nhưng bạn có quyền **thừa nhận mình không
review được**, và đó là hành vi duy nhất chấp nhận được khi diff vượt sức.

| Kích thước diff | Hành động trung thực |
| --- | --- |
| < 200 dòng, một concern | Review đầy đủ |
| 200-400 dòng | Review đầy đủ, cần thời gian thật — đặt lịch, đừng đọc vội |
| 400-800 dòng | Nói "tôi cần tách" và đề xuất mốc tách cụ thể |
| > 800 dòng | Yêu cầu tách trước khi bắt đầu review |
| Diff vi phạm CODEOWNERS | Chặn cho tới khi đúng owner review |

Ba cách hợp lệ khi không review nổi, theo thứ tự ưu tiên:

1. **Nói thẳng và đề xuất cách tách.** Nêu ranh giới: "refactor này tách riêng được,
   feature giữ lại 120 dòng".
2. **Approve có điều kiện với rủi ro được gọi tên.** "Tôi approve phần X, đã đọc kỹ.
   Phần Y tôi chưa đọc — rủi ro chưa được kiểm chứng ở đó."
3. **Từ chối review.** Không phải lúc nào cũng có capacity để làm đúng.

Điều **không** bao giờ chấp nhận: approve vì diff dài, để lịch sử đầy approval. Diff dài
không phải tín hiệu an toàn; nó là tín hiệu rằng có nhiều thứ chưa được nhìn.

## 6. Review thay đổi của chính mình

Tự approve không phải bằng chứng đúng. Người đọc lại code vừa viết đang đọc ý mình, chứ
không đọc code — bạn không có khả năng thấy cái mình không nghĩ tới.

Cách làm: đóng cửa sổ, đọc `git diff` từ đầu như người khác vừa viết, và chạy checklist
mục 3 **cùng thứ tự** — contract trước, tên sau.

Sáu thứ phải soi lại, vì đây là chỗ đầu tiên bản thân bạn quên:

| Soi lại | Câu hỏi | Vì sao |
| --- | --- | --- |
| **Code đã bị xoá** | Khối xoá này còn ai dùng không? Đó là dòng sửa vendor hay dòng chết? | Xoá nhầm là lỗi đắt nhất ở thời điểm sai |
| **Default đổi lặng lẽ** | Timeout, retry count, limit, flag, giá trị null — có cái nào đổi mà PR không nói? | Người đọc không đọc được default trong diff |
| **Error handling** | Nhánh lỗi có thật không, hay mới chỉ là `catch` và log? | Code chạy được vì lỗi chưa tới |
| **Test bắt hồi quy** | Xoá feature, test có đỏ không? Test khẳng định contract hay implementation? | Test xanh nhưng vô nghĩa là cảm giác an toàn giả |
| **Docs còn khớp** | Câu nào trong README/ADR/runbook giờ sai? | Docs sai còn nguy hiểm hơn docs thiếu |
| **Scope** | Có dòng nào trong diff không thuộc PR này? | Dọn dẹp tràm vào là thay đổi không ai duyệt |

Sau đó chạy `references/dod-checklist.md`. Ô nào không tick thì sửa hoặc báo — không có ô
nào bị bỏ qua trong im lặng.

## 7. Khi nào block

**Block khi bạn có một input cụ thể làm nó hỏng.** Đó là tiêu chuẩn duy nhất. Block không
cần sự đồng ý của tác giả; nó chỉ cần bằng chứng.

| Block | Không block |
| --- | --- |
| Có input → hỏng (kèm input đó trong comment) | Sở thích về tên, layout, comment style |
| Vi phạm required check, không có cách nào xanh | Chưa tối ưu, chưa refactor |
| Behavior mới không có test theo `references/testing-guide.md` | "Tôi sẽ làm khác" mà không chỉ ra được hậu quả |
| Vi phạm CODEOWNERS, hoặc đụng auth/data/migration | Diff chưa tách đủ — đó là lời nhắc, vẫn nên nhắc |
| Không ai có thể đọc lại thay đổi này | Chậm — reviewer có nghĩa vụ nói sớm |
| Claim trong PR không khớp code | Không thích cách tách lớp, chưa có ví dụ hỏng |

Block về **hướng đi** khi thay đổi đảo ngược được: nói bạn nghĩ gì và bạn sẽ đồng ý nếu
gì. Block hướng đi mà vẫn để lại lựa chọn cụ thể là block vô điều kiện — tệ hơn, vì nó
dạy cả team rằng review là cuộc đấu.

**Urgent change bỏ qua review.** Khi có việc gấp thực sự — sự cố đang cháy, patch bảo
mật — quy trình đúng không phải là rubber-stamp. Nó là:

- Review tối thiểu, **tại chỗ**, với người đang trực: đọc diff cùng nhau, 10 phút.
- Ghi rõ ai đã duyệt và đã xem phần nào, trong chính PR hoặc ticket.
- Nêu phần **chưa** xem và rủi ro còn lại, thay vì để trống.
- Một task follow-up có owner và deadline, tạo ngay khi merge chứ không đợi "sau này".

Approve phẳng một thứ chưa ai đọc là đặt tên mình làm chữ ký cho thứ không hiểu. Khi nó
nổ, tên đó xuất hiện trong postmortem.

## 8. Convention, sở thích, và bất đồng

**Convention của team thắng sở thích của bạn.** Nếu repo có formatter, có linter, có
test đang khẳng định một style — đó là quyết định đã có người trả giá, và sửa nó tốn
thời gian nhiều hơn lợi ích. Khi bạn muốn đổi convention, đó là một thay đổi riêng.

Mỗi comment gắn nhãn rõ: **bắt buộc** (có hậu quả), **gợi ý** (tôi thích hơn), hoặc **hỏi**
(tôi chưa hiểu). Comment không nhãn bị hiểu là bắt buộc, và thế bạn tự tạo ra blocker
mà không tạo ra giá trị.

**Hai người review bất đồng** — đừng giải quyết bằng cách người có quyền hơn bấm nút:

1. **Gọi tên khác biệt:** đây là hiểu sai requirement, là quyết định kiến trúc, hay là
   sở thích? Ba cái đó có cách giải khác nhau.
2. **Đưa ra bằng chứng, không ý kiến.** "Tôi nghĩ sai" không thành gì. "Ở input X, kết
   quả là Y, đây là hậu quả Z" thì có.
3. **Đưa câu hỏi lên đúng người quyết.** Quyết định kiến trúc thuộc ADR hoặc owner
   service, không thuộc thread review. Cách mở một: `references/enterprise-standards.md`.
4. **Khi vẫn bất đồng về một điểm nhỏ:** approve phần đã rõ và ghi rõ phần nào bạn chưa
   đồng ý. Chặn cả PR vì một comment phong cách là cách tạo thói quen bỏ qua review.

Còn một trường hợp không phải bất đồng: **thấy bug thật trong PR, không liên quan tới
thay đổi.** Đừng sửa lặng, cũng đừng im. Một PR nhỏ riêng, có owner, hoặc ghi vào hàng
đợi. Im lặng là lựa chọn của người chịu trách nhiệm về bug đó — thường không phải bạn.

## Vòng lặp đầy đủ

Đọc → plan (`references/plan-template.md`) → implement → verify
(`references/stack-commands.md`) → **review** → bàn giao (`references/dod-checklist.md`).
Review không phải điểm dừng; nó là điểm mà lỗi còn rẻ để sửa.