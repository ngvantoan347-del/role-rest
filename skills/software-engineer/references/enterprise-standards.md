# Enterprise Standards

Trong một công ty lớn, quy tắc đã tồn tại trước khi bạn tới. File này nói cách tìm ra
chúng, cách làm việc trong chúng mà không phá chúng, và cách biết thay đổi có thuộc về
bạn hay không.

Vì sao: ở nơi có hàng trăm kỹ sư, thứ bị bỏ qua dưới áp lực deadline không phải kỹ
thuật — mà là **ranh giới trách nhiệm**. Sửa đúng code của team khác là cách nhanh nhất để
biến một ticket T2 thành sự cố vận hành lúc nửa đêm.

## 1. Chuẩn nằm ở đâu, và ai đổi được

Repo đã encode sẵn những quy tắc mà không ai viết ra. Đọc chúng trước khi đoán. Thứ tự
khám phá tổng quát nằm ở `references/discovery-playbook.md`; bảng dưới chỉ liệt kê những
artefact đặc thù của công ty lớn.

| Artefact | Nói cho bạn biết | Ai sở hữu việc đổi nó |
| --- | --- | --- |
| `.github/workflows/*.yml` | **Định nghĩa "xong" thật**: check bắt buộc nào chạy, với lệnh gì | Platform/build team |
| `CODEOWNERS` (`.github/CODEOWNERS`) | Ai duyệt path nào, và khi nào cần approval của owner | Từng team giữ dòng của mình |
| Linter / formatter config | Cái gì bị cấm, ở mức phạt nào | Repo maintainer |
| `.editorconfig` | Indent, khoảng trắng, newline cuối file | Repo, đổi bằng PR riêng |
| ADR trong `docs/adr/` | Quyết định kiến trúc đã chốt — và cái gì đã bị loại với lý do | Tác giả ADR, chốt bởi team kiến trúc |
| RFC doc | Thứ đang được đề xuất, ai chờ duyệt, hạn comment | Người mở RFC |
| Architecture doc | Ranh giới tầng, dependency nào được phép | Team kiến trúc |
| `CHANGELOG.md` | Hành vi nào đã đổi khi nào, và ai từng đụng | Người viết entry |
| `CONTRIBUTING.md` | Quy trúc branch, commit, PR, review, release | Maintainer |
| Release doc, config release tự động, tag | Cách release thực sự được phát hành | Release manager |

**README là một claim. CI config là nguồn sự thật.** README nói "chạy `npm test`" trong
khi CI chạy `npm run test:ci && npm run lint` với coverage threshold — đó là hai định nghĩa
khác nhau về việc xong, và CI là cái thứ hai. Chi tiết về cách đọc CI config:
`references/stack-commands.md`.

- README và CI lệch nhau: **báo cáo lệch**, và sửa trong thay đổi đầu tiên bạn mở có liên
  quan. Đừng mở PR dọn doc khi chưa có uy tín trong repo.
- Không tìm thấy artefact nào: đó là dữ kiện, không phải lời xin lỗi. Nói "repo này
  không có CODEOWNERS, tôi sẽ tag owner khi mở PR" — đừng đoán owner.
- Config của dự án thắng mọi hướng dẫn chung, kể cả file này.

## 2. Ownership: code của bạn và code của họ

Check CODEOWNERS **trước khi** sửa, không phải sau khi CI đỏ.

| Tình huống | Hành động |
| --- | --- |
| Path không có owner, hoặc owner là chính bạn | Làm bình thường |
| Path có owner là team khác, thay đổi nhỏ và không đổi behavior | Hỏi họ trước, hoặc mở ticket của họ rồi chờ |
| Phải sửa ngay, không có ai để hỏi | Sửa tối thiểu, nói rõ lý do, ghi rõ ai đã duyệt trong PR |
| Team khác đang làm đúng chỗ đó | Route qua ticket của họ, không fork |

Vì sao: **team sở hữu một path sở hữu on-call của path đó.** Dòng code bạn sửa lúc 23h
là việc của họ lúc 23h, và họ không biết bạn đã đụng vào nó.

Khi buộc phải đụng code của team khác, ba điều bắt buộc:

1. **Diff tối thiểu.** Không format lại file, không đổi tên biến, không dọn comment.
2. **Lý do nhìn thấy được** trong PR description và commit message — không phải trong
   đầu người đọc.
3. **Owner được thông báo** — tag team trong PR, không chỉ nhờ approval tự động.

Còn một điều nữa: nếu thay đổi của bạn làm CI của họ đỏ, đó là sự cố của bạn cho tới
khi bạn đẩy nó qua. Đừng để người khác phát hiện.

## 3. Convention của codebase lạ

File bạn đụng **không phải của bạn để restyle**. Đọc hai ba file cùng loại trước khi viết
dòng đầu tiên, rồi bám theo: cách đặt tên, cách trả lỗi, cách comment, cách test.

- Không đổi indent, không đổi tên biến cục bộ, không "cho gọn" trong PR feature.
- Nếu convention đó thực sự sai hoặc đang gây bug: **tách thành PR riêng**, sau khi PR
  chính merge. Sửa lặng lẽ là thay đổi mà không ai review.
- Convention trông kỳ quặc: hỏi `git log` trước khi kết luận. Xoá dòng "thừa" là cách
  nhanh nhất để tái tạo bug đã sửa từ hai năm trước.

Vì sao: convention xấu nhưng nhất quán rẻ hơn convention đẹp nhưng chia nhánh. Diff
thẩm mỹ trộn vào diff tính năng làm cả hai đều không review được.

## 4. Contract xuyên team

Shared library, shared schema, event payload, protobuf — chúng là **public API có
consumer nội bộ công ty**. Blast radius của chúng không nằm trong repo bạn đang mở; xem
`references/scale-and-architecture.md` cho cách đo và lan truyền trong monorepo và shared
package.

| Thay đổi | Blast radius | Cần gì |
| --- | --- | --- |
| Thêm field optional, giữ field cũ | Consumer cũ vẫn chạy | Cùng thay đổi, không cần cửa sổ |
| Đổi kiểu, đổi nghĩa, đổi tên field | Mọi consumer đọc field đó | Đo usage, cửa sổ deprecation có ngày, migration note |
| Xoá export | Call site biên dịch lỗi ở consumer | Đo usage về 0 trước, hoặc major version |
| Đổi hành vi mặc định | Consumer không hề biết mình đổi | Nâng major + changelog nói rõ |

- Đo trước khi gỡ: grep **toàn workspace**, không chỉ repo của bạn. Owner của shared
  package thường có số liệu usage sẵn — hỏi, đừng tự suy.
- Breaking change trong contract dùng chung = major version + ghi chú migration + mốc
  thời gian gỡ, nói to trong `CHANGELOG.md`.

Vì sao: trong một công ty, "một team" là cái bạn nhìn thấy. Team thứ tư mà bạn không biết
tên vẫn đang gọi hàm đó lúc bạn xoá nó.

## 5. Decision record

Một thay đổi là **quyết định kiến trúc** khi nó ảnh hưởng >1 team, hoặc khó đảo ngược
chi phí bằng một revert. Lúc đó viết ADR hoặc RFC: Context, Options, Decision,
Consequences. Không mô tả code, không tóm tắt diff.

| Kích thước thay đổi | Artefact cần |
| --- | --- |
| Local fix, một file, đảo ngược bằng một revert | Không. Ghi lý do trong commit |
| Đổi internal của một service, không ai gọi từ ngoài | Không. Comment tại chỗ |
| Thêm abstraction từ biến thể thứ hai, ngay trong repo | Không. ADR là thừa |
| Đổi contract dùng chung, đổi hạ tầng, đổi lưu trữ, thêm service | **ADR/RFC** |
| Quyết định khó đảo ngược mà có hai phương án ngang nhau thật | **ADR/RFC**, kể cả khi code nhỏ |

Vì sao ADR cho quyết định nhỏ là noise. Noise làm mọi ADR thật bị bỏ qua trong lúc đọc,
và người sau đó lại tranh lại quyết định cũ.

## 6. Branch protection, merge queue, release train

| Cơ chế | Nó cấm gì | Bạn phải làm gì |
| --- | --- | --- |
| Protected branch | Push thẳng, bypass review | Mọi thay đổi qua branch + PR |
| Required checks | Merge khi CI đỏ | Verify local **trước khi push** |
| Merge queue | Push lên branch cũ, merge lúc branch lệch | Rebase/re-merge khi báo đỏ vì queue chỉ build commit mới |
| Release train | "Ship khi nào xong" | Hỏi ngay mốc cắt khi nhận việc, không hỏi khi đã viết xong |

**Nhánh của bạn bây giờ là latency của người khác.** Một commit hỏng build giữa lúc merge
queue đang xếp hàng chặn mọi người phía sau — kể cả những người không liên quan gì.

Với release train: hỏi mốc cắt ở lúc nhận việc. Hỏi sau khi đã viết xong nghĩa là bạn
đã tự quyết định rồi mới đi hỏi, và thường phải viết lại.

## 7. Làm việc với review và CI

Pipeline đỏ nói **đúng một điều**: có cái gì fail. Đọc log từ dòng fail đầu tiên, không
phải dòng cuối — dòng cuối thường là hậu quả của một lỗi dependency hoặc môi trường.

Pipeline xanh chỉ nói các check trong pipeline đó xanh. Nó **không** nói logic đúng,
**không** nói không có hồi quy, **không** nói an toàn khi scale.

- **Không bao giờ nới gate để lấy xanh.** Không skip test, không tắt lint rule, không
  `--no-verify`, không thêm `|| true`, không hạ coverage threshold. Xem mục 7 của
  `SKILL.md`.
- Gate hỏng trên nhánh bạn sở hữu: sửa ở đó, PR nhỏ riêng, kèm lý do vì sao lỗi tồn tại.
- Gate hỏng sẵn có, hoặc thuộc team khác: **không sửa lặng**. Ghi lại, báo lên, và nếu nó
  chặn verification của bạn thì nói rõ verification đang bị chặn.
- Lệnh gate thật theo từng ecosystem: `references/stack-commands.md`.

## 8. Nói ra giả định ngay lúc bạn giữ nó

Một giả định giữ trong đầu là việc của người khác phải gánh. Nói ra **tại lúc bạn giả định**,
không phải lúc nó sai — lúc nó sai thì người khác đã tốn công rồi.

Mỗi giả định đáng nói cần một câu: điều tôi đang coi là đúng, và vì sao tôi tin điều đó.

| Tình huống | Nói gì |
| --- | --- |
| Sửa code team khác, bị chặn | "Tôi cần sửa `<path>` vì `<lý do cụ thể>`. Diff N dòng, không đổi behavior cũ. Ai review phần này được?" |
| Đổi contract dùng chung | "Tôi đề xuất thêm field X, giữ nguyên field cũ trong release này. Tôi cần số liệu consumer của field cũ — ai đang giữ?" |
| Chưa chắc về hạn release | "Train kế tiếp cắt ngày `<date>`. Tôi cần biết cái này có kịp không trước khi đầu tư vào nó." |
| Yêu cầu mơ hồ | "Có hai cách: A `<...>`, B `<...>`. Tôi nghiêng về A vì `<lý do gắn với mục tiêu>`." |
| Gate đỏ không phải của mình | "Pipeline đỏ ở `<check>` từ commit `<sha>`, không liên quan thay đổi của tôi. Tôi để nguyên và báo." |
| Đang đoán | "Tôi chưa xác nhận được `<điều đó>`. Tôi đang giả định `<giả định>` — nếu sai thì `<hậu quả>`." |

**Khi nào dừng và hỏi, khi nào đi tiếp và ghi cờ:** dừng khi đảo ngược được đắt — migration,
xóa dữ liệu, đổi public contract, chạm auth hoặc billing, hoặc đụng path của team khác.
Đi tiếp khi đảo ngược được một lệnh, và ghi cờ giả định trong PR. Bảng đầy đủ ở mục
"Không được đứng sai chỗ" trong `SKILL.md`.

Khi thay đổi đó có chạm dữ liệu người dùng, phần cần chứng minh bằng code không nằm ở
đây — nó ở `references/compliance-and-data.md`.

## 9. Vào một service lạ

Thứ tự đọc, dừng khi đã đủ để sửa nó an toàn:

1. **Architecture doc / README** — coi là claim, chưa phải sự thật.
2. **Entry point và một request thật** đi từ trên xuống: route → handler → service →
   storage. Ghi lại những chỗ không nối với nhau.
3. **Hai module sở hữu phần lớn traffic** — chúng là nơi bug tốn tiền nhất.
4. **On-call runbook và alert đang bật** — đọc để biết lúc 3h sáng người ta nhìn vào đâu.
5. **Ba incident gần nhất** (incident tracker, `git log --grep`). Chúng nói hệ thống thật sự
   hỏng ở đâu, viết bằng ngôn ngữ của sự cố chứ không phải của kiến trúc.
6. **Config và biến môi trường** — cái nào không có default là cơ hội hỏng lúc deploy.
7. **CODEOWNERS** — để biết hỏi ai.

**Doc cũ là bình thường.** Hệ thống chạy lâu hơn doc của nó. Đừng sửa doc ngay khi mới
vào; kiểm chứng, ghi nhận chỗ lệch, rồi sửa trong PR đầu tiên có liên quan.

Cách biết thật: đọc code, đọc test (test là hành vi đã được khẳng định), đọc config đang
deploy thật, và hỏi đúng một người trong team đó. Bốn nguồn đó hợp lại gần với nhau thì
bạn đã hiểu service.

## Liên tục

`references/review-playbook.md` cho phía còn lại của vòng lặp: đọc diff của người khác,
tự review thay đổi của chính mình trước khi mở PR, và khi nào block.