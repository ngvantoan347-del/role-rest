# Migration and Legacy

Phần này cho những thay đổi không thể đảo ngược bằng `git revert`: đổi schema trên
bảng lớn, thay một subsystem đang chạy, nâng dependency hàng chục major, hoặc sửa code
mà không có test. Nội dung lọc theo đúng một tiêu chí: **những gì bị bỏ qua khi đang bị
deadline** — freeze behavior, rollback switch, idempotent, đo usage trước khi gỡ.

Vì sao tách riêng: đây là loại thay đổi mà "chạy được ở máy mình" không có giá trị gì.
Mọi quyết định ở đây đều xoay quanh một câu hỏi duy nhất: **khi nó hỏng lúc 3 giờ sáng
thì đảo ngược bằng cách nào, mất bao lâu?**

## 1. Legacy không test: mua lưới an toàn rẻ nhất

Không có test không phải lý do để viết chậm hơn — nó là lý do để làm **đúng thứ tự**.
Bắt đầu bằng "test ý tưởng của tôi" cho một hệ thống không ai hiểu là tự đặt mình vào
chỗ của người hiểu nó.

| Bước | Làm gì | Vì sao |
| --- | --- | --- |
| 1 | Chạy suite hiện có **y nguyên**, không sửa gì | Biết baseline đỏ hay xanh trước khi chạm. Suite đỏ sẵn có là phát hiện phải báo, không phải nợ của bạn |
| 2 | Ghi lại test flaky: chạy 3–5 lần, đánh dấu cái nào không ổn định | Flaky không có tên sẽ bị blame nhầm vào thay đổi của bạn |
| 3 | Chỉ disable flaky **kèm issue** và **kèm ngày** | Test bị tắt không ai chờ sẽ thành test không tồn tại |
| 4 | **Characterisation test** quanh behavior đang chạy: gọi hàm với input thật, assert output hiện tại — kể cả output bạn cho là sai | Bạn chưa biết ý định gốc. Ghi lại hiện trạng trước khi thay đổi nó |
| 5 | **Golden/snapshot** response thật cho endpoint hot, từ dữ liệu đã sanitize | Diff sau này là câu hỏi "cái gì đổi" trả lời bằng máy, không bằng trí nhớ |
| 6 | Test regression cho **từng bug** sắp sửa lại | Bug đã xảy ra một lần sẽ xảy ra lại nếu không có test giữ |

**Freeze behavior trước khi đổi nó.** Đây là luật cứng: một PR không được vừa refactor vừa
đổi behavior.

Vì sao: refactor đổi *cấu trúc*, behavior đổi *kết quả*. Khi cả hai nằm chung một diff,
reviewer không có cách nào biết cái nào sinh ra regression — và test mới thì bạn tự viết
cho cả hai phía, nên nó không bảo chứng gì. Tách ra thì mỗi cái một PR, mỗi cái một
rollback.

Test characterization viết sai thành test khẳng định bug: xử lý bằng cách viết rõ
`// hiện tại bug — issue #123, sẽ đổi ở PR sau`. Còn lại, đổi luôn.

## 2. Đọc code lạ và tin đúng chỗ

`references/discovery-playbook.md` đã có trình tự 10 phút và mẫu evidence table. Ở đây chỉ
bổ sung phần **legacy**: cách đọc khi code không có người giải thích.

```bash
git log --oneline -30 -- path/to/file        # nhịp sửa: sửa nhiều = vùng nóng
git log -S "symbolName" --oneline             # symbol này vào/ra khi nào
git log -S "endpoint/path" --oneline --all   # ai từng đụng contract này
git blame -L 40,90 path/to/file               # ý định nằm ở commit, không nằm ở dòng code
git log --format='%an %ad %s' --date=short -5 -- path/to/file   # người cuối đụng hot path
```

Tìm người cuối cùng đụng hot path rồi hỏi họ một câu. Câu trả lời giá trị hơn cả ngày đọc
code, và tốn một tin nhắn.

**Code archaeology: đi từ triệu chứng vào trong, không đi từ file vào trong.**

```text
symptom hoặc một dòng log  ->  entry point  ->  nhánh gọi  ->  invariant nó đang giả định
```

Vì sao: đi từ symptom thì mọi thứ bạn đọc đều liên quan. Đi từ "file này có vẻ logic"
nghĩa là đọc theo thứ tự alphabet, và bạn sẽ không bao giờ tới đúng chỗ.

Ba cái bẫy trong legacy, cả ba đều trông như lỗi của bạn:

| Bẫy | Dấu hiệu | Xử lý |
| --- | --- | --- |
| **Dead code vẫn được deploy** | Nhánh không bao giờ vào từ nguồn nào, nhưng còn feature flag trỏ tới, còn entry trong config, còn cron job gọi | Đọc config và flag registry trước khi kết luận "chết". Đã deploy = còn chạy. Xóa flag và deploy một lần trước khi xóa code |
| **Behavior khớp bug report, không khớp doc** | Doc mô tả X, bug report nói Y, code làm Z | **Code là sự thật về hành vi**, bug report là bằng chứng người dùng đã gặp, doc chỉ là ý định. Sửa doc, và ghi lại sự lệch đó vào issue |
| **Vendor workaround trông thừa** | Retry lặp, kiểm tra null hai lần, offset timezone một chỗ | `git blame` cho thấy nó vá cái gì. Xem issue/commit gốc. Xóa nó là tái tạo bug đã sửa từ 2 năm trước |

Không có commit giải thích, blame chỉ ra một dòng merge từ năm ngoái → đó là **quyết
định đã mất**, không phải ý định. Ghi nó thành comment hoặc ADR ngay khi bạn hiểu, vì
người sau sẽ không có cách nào biết.

## 3. Strangler fig: thay từng phần, không viết lại

```text
client -> [seam / router] -> legacy impl   (mặc định)
                        \-> new impl        (flag: canary 1% -> 10% -> 100%)
```

Nguyên tắc: **một boundary, một lần đổi traffic.**

| Bước | Hành động | Rollback khi hỏng |
| --- | --- | --- |
| 1 | Đặt seam ở ranh giới đã tồn tại: HTTP route, queue consumer, module interface | Xóa route mới, gỡ import |
| 2 | Chạy **cả hai** impl trên shadow/canary, so kết quả | Không có side effect ở bước này |
| 3 | Chuyển traffic theo tỷ lệ nhỏ, giữ feature flag | Bật lại flag: đổi lại trong giây |
| 4 | Giữ legacy impl trong tree cho tới khi số liệu usage về 0 | Không còn đường lùi nếu đã xóa |
| 5 | Gỡ legacy **một lần riêng**, sau khi có test coverage trên new impl | PR riêng, revert được |

Flag phải tồn tại ở code và tắt được **không cần deploy**. Vì sao: nếu bật/tắt cần deploy,
thì mỗi lần bật lại là một deploy nữa, và lúc 3 giờ sáng bạn sẽ không muốn deploy.

**Big rewrite là failure mode mặc định.** Bốn lý do, đủ để bác bỏ nó ngay từ kế hoạch:
không verify được từng phần (đến cuối mới biết đúng hay sai), không giao được sớm (sáu
tháng không có gì chạy được để người khác dùng), mất kiến thức (người hiểu quirk biến mất
giữa lúc bắt đầu và lúc viết xong), và diff không review được (PR 8000 dòng được merge vì
không ai đọc nổi — tức là không có review nào).

Điều kiện để strangler fig hoạt động: **đường mới phải verify được một mình.** Nếu bạn
không chạy được new impl mà không có legacy, thì bạn đang viết lại với tên khác.

## 4. Expand-contract: đổi schema khi code cũ vẫn đang phục vụ traffic

Vì sao `ALTER TABLE` trên bảng lớn, hot, là việc nguy hiểm: lock lâu tuỳ engine và
phiên bản, và `ADD NOT NULL DEFAULT` cần full table rewrite. Trên bảng 200M dòng, "chạy
nhanh" có thể là vài giờ downtime. Trên đúng bảng đó, một `ALTER` không lặp lại được là
một migration không tồn tại.

Thứ tự chuẩn, mỗi bước là một lần deploy riêng và đảo ngược được:

| Bước | Hành động | Vì sao đứng riêng |
| --- | --- | --- |
| 1. **Expand** | Thêm cột mới nullable, hoặc cột mới có default | Additive, code cũ không biết là an toàn |
| 2. **Backfill** | Job batched điền cột mới | Chạy nhiều lần được, không khóa bảng |
| 3. **Dual-write** | Code mới ghi cả hai cột; đọc vẫn từ cột cũ | Reader chưa đổi nên không cần dữ liệu hoàn chỉnh ngay |
| 4. **Switch read** | Đọc cột mới, bằng flag; đo diff với cột cũ | Có fallback nếu cột mới bị sót dữ liệu |
| 5. **Contract** | Xóa cột cũ | Chỉ khi đọc đã về 0 ở cột cũ |

**Rolling deploy = code cũ và code mới chạy cùng nhau hàng giờ.** Đây không phải rủi ro
hiếm, đây là trạng thái bình thường. Vì vậy:

- Reader phải chấp nhận cả hai shape cho tới khi mọi instance đã lên bản mới — nguyên tắc
  chung ở `references/design-guide.md` mục "Tương thích ngược".
- Deploy xong **không** đồng nghĩa migrate xong: cần một cửa sổ chờ đủ lâu để chắc không còn
  instance cũ, rồi mới phá thứ chỉ instance cũ cần.
- Row tạo sau khi deploy lại không có ở cột cũ. Rollback về code cũ là mất dữ liệu đó. Đây
  là lý do dual-write tồn tại, và là lý do rollback sau bước 3 không còn rẻ.

Bước Contract không có đường lùi rẻ. Nói rõ điều đó trước khi làm, và đừng làm nó cùng PR
với bước khác.

## 5. Data migration

| Yêu cầu | Cụ thể | Vì sao |
| --- | --- | --- |
| **Idempotent** | Chạy lại hai lần cho cùng kết quả; điều kiện `WHERE ... IS NULL` hoặc `ON CONFLICT DO NOTHING` | Một migration chết giữa chừng sẽ được chạy lại. Không idempotent = phải khôi phục tay |
| **Resumable** | Commit theo batch, lưu con trỏ, exit sạch | Job backfill chạy nhiều giờ; không muốn bắt đầu lại từ đầu |
| **Batched** | Theo khoá chính, batch vài nghìn, `sleep` giữa các batch | Query không giới hạn giết connection pool và replication lag |
| **Có kill switch** | Feature flag tắt job ngay | Cần dừng trong vài phút khi nó làm chậm production |
| **Có rate limit** | Giới hạn theo batch/giây, giảm tự động khi lag tăng | Backfill cạnh tranh với traffic thật cho cùng một bảng |
| **Báo tiến độ** | Log số row đã xử lý, tốc độ, ETA | Job 3 giờ không có tiến độ thì không ai dám để chạy |
| **Validate** | So row count, checksum, và invariant nghiệp vụ trước/sau | "Xong" phải là so khớp, không phải là job kết thúc |

**Dry run trên bản copy, không bao giờ thử trên production.** Đo thời gian, số row bị skip,
và tỉ lệ lỗi — trên dữ liệu đã sanitize, không phải dữ liệu user thật.

Vì sao: lần chạy đầu tiên trên production là lần duy nhất bạn không thể quay lại, và nó
chạy với dữ liệu lớn hơn, đồng thời, và chậm hơn bản copy. Câu "chắc là chạy được" là
lý do đắt nhất trong cả file này.

Khi hai shape phải cùng tồn tại lâu (tháng, quý):

- Định nghĩa **nguồn sự thật duy nhất** và ghi rõ nó ở đâu trong repo. Hai nguồn sống
  cùng nhau là drift chờ đến ngày nó thành incident.
- Nếu buộc phải đọc cả hai, đọc theo thứ tự ưu tiên rõ ràng và **log disagreement rate**.
  Tỉ lệ đó là metric bạn đưa vào dashboard để biết khi nào an toàn để gỡ.
- Feature flag tắt đường cũ phải là một config value đọc lập tức, không phải code path.

## 6. API versioning và tương thích client

Phân loại trước khi viết bất kỳ dòng nào:

| Thay đổi | Phân loại | Hành động |
| --- | --- | --- |
| Thêm field mới, thêm endpoint, thêm query param tuỳ chọn | **Additive** | Ship được |
| Đổi tên/xoá field, đổi kiểu, đổi semantics, thêm bắt buộc | **Breaking** | Cả hai shape trong suốt deprecation window, đo usage, rồi gỡ |
| Đổi status code hoặc error shape | **Breaking** | Client cũ có thể đang dựa vào nó để hiển thị lỗi |

Nguyên tắc deprecation: **cái không được đo thì không tồn tại.** Endpoint bị đánh dấu
deprecated mà không có metric theo `endpoint` và theo `user/client id` thì không bao giờ bị
gỡ, chỉ bị dời sang backlog của năm sau.

Đo mức dùng cần cả hai: theo endpoint (còn ai gọi) và theo phiên bản client (ai chưa
lên được bản mới). Con số thứ hai mới quyết định **mốc gỡ**, vì client cũ sẽ không tự
lên.

**Client mà bạn không ép được lên** — mobile app đã cài trên máy người dùng, integration
script trong cron của khách, browser cache và service worker:

- Server phải chịu được client cũ **lâu hơn mức bạn muốn**.
- Endpoint versioned (`/v1`, `/v2`) tách contract: `v1` được đóng băng, `v2` là nơi thay
  đổi. Đây là lựa chọn khác với additive+deprecation — dùng khi contract đổi nhiều, không
  phải khi thêm một field.
- Sunset header + ngày cụ thể trong response, để client có thể tự cảnh báo và log lỗi.
- Nếu không đo được usage, giữ cả hai vô thời hạn. Rẻ hơn một lần incident vì đã cắt
  nhầm.

## 7. Nâng dependency và framework

| Điều | Chuyện gì thật sự xảy ra |
| --- | --- |
| Nhảy nhiều major trong một PR | Diff không review được và **không revert được**: revert sẽ cần biến về đúng set version cũ, mà bạn đã quên nó là gì |
| Đi từng major | Mỗi bước là một PR nhỏ, review được, revert được. Chi phí cao hơn về số PR, rẻ hơn hàng bậc về rủi ro |
| Codemod | Sinh ra diff hàng nghìn dòng **đúng về cú pháp, sai về ngữ nghĩa** |
| Lockfile churn | Che mất thay đổi thật, hoặc chứa thay đổi thật mà không ai đọc |

Về codemod: output sinh ra là **bản nháp cần review**, không phải kết quả. Dành thời
gian đọc chỗ ngữ nghĩa đổi — lifecycle hook, error handling, dependency đổi hành vi mặc
định. Đây là phần hay hỏng nhất. Nếu codemod chạm >~50 file, tách PR: phần cơ học một
PR, phần sửa semantic một PR. Xem `references/testing-guide.md` — ở đây test đỏ sau codemod
thường là tín hiệu thật, không phải thứ cần làm xanh bằng cách nới.

Phân biệt lockfile-only diff với diff thật — `npm ls <pkg>` cho biết dependency thật của
dự án (không phải transitive), `git diff --stat -- <lockfile>` cho biết mức churn.

Lockfile-only = version của dependency **thật** không đổi, chỉ transitive đổi. Đó vẫn
cần build + test + attention, nhưng không cần rà lại code. Ngược lại, khi manifest
không đổi mà lockfile đổi hàng nghìn dòng: đây là security hoặc reproducibility, và
cần chạy full suite chứ không chỉ typecheck.

Nâng framework lớn: chạy suite **trước** để có baseline, và có sẵn một branch để lấy
output của suite cũ làm tham chiếu. Không có baseline thì mọi fail đều mơ hồ.

## 8. Thay đổi xuyên nhiều runtime

Frontend TypeScript + service Go + migration SQL là **ba release train khác nhau**, có ba
tốc độ deploy khác nhau. Vấn đề không phải kỹ thuật — vấn đề là thiết kế để không bao
giờ có lúc cả ba bắt buộc phải đi cùng nhau.

| Cơ chế | Cách dùng | Vì sao cần |
| --- | --- | --- |
| **Additive trước** | Backend thêm field mới trước, frontend đọc sau | Frontend cũ không break; backend mới không phụ thuộc frontend |
| **Expand-contract** | Cột mới trước, contract sau (mục 4) | SQL chạy một lần, code chạy nhiều lần — thứ tự ngược lại là bản deploy không bao giờ đồng bộ |
| **Feature flag** | Đường cũ giữ nguyên sau khi đường mới lên | Ba runtime lên lệch nhau vẫn có một đường đi đúng |
| **Compatibility matrix** | Bảng: phiên bản nào của A tương thích với B | Test matrix trở thành thứ có thật, thay vì giả định |

Nguồn sự thật cho schema dùng chung: **một nơi sinh ra, không ai gõ tay.** Tạo type /
schema từ một nguồn và phát tán (`codegen` từ schema, hoặc generated client từ
OpenAPI). Vì sao: ba bản schema gõ tay của cùng một thứ drift trong khoảng một sprint,
và lỗi xuất hiện ở runtime thay vì ở compile time.

Định nghĩa rõ ba câu, viết vào plan, trước khi code:

1. **Ai deploy trước** và cái gì phải tồn tại để nó không break.
2. **Phiên bản nào là hợp lệ** trong khoảng thời gian hai runtime lệch nhau — dài bằng
   số deploy dài nhất, không phải số phút bạn đo được.
3. **Điều kiện gỡ** cờ: metric nào về 0 thì xóa đường cũ, và ai xóa.

## 9. Dấu hiệu migration đi sai

Đây là những dấu hiệu không sửa được bằng cách chạy thêm một feature flag.

| Dấu hiệu | Nghĩa là gì | Cách thoát cụ thể |
| --- | --- | --- |
| **Rollback cần can thiệp dữ liệu** | Đã vượt bước contract, hoặc dual-write đã dừng mà contract đã xong | Dừng mọi deploy mới. Xác định bước expand-contract đang dở. Khôi phục khả năng đọc bằng công việc chuyển dữ liệu **một chiều, có script, chạy lại được**, không phải sửa tay. Ghi mọi row đã tay vào script |
| **Hai nguồn sự thật cùng sống trong production** | Ai đó đã bắt đầu ghi vào chỗ thứ hai khi đang cố di chuyển | Chọn một nguồn, ghi tên nó vào schema comment và vào doc. Đường còn lại thành read-only projection, không phải nguồn thứ hai có thể ghi |
| **Cờ "tạm" đã 8 tháng** | Cửa sổ deprecation không bao giờ đóng; phần cũ giờ là đường chính | Đặt ngày Xóa ngay khi tạo cờ, gắn issue và milestone. Nếu quá hạn, đổi cờ thành owner + deadline chứ không phải cờ nữa |
| **Không ai gọi tên được ai sở hữu đường legacy** | Không ai chịu trách nhiệm; nó sẽ không bao giờ tự biến mất | Gắn owner bằng tên. Nếu tìm không ra owner, coi đường cũ là production system cần capacity và on-call |
| **Deploy phải canh giờ thủ công** | Đang có coupling ngầm giữa runtime | Chạy lại deploy sai thứ tự một lần. Nếu hỏng, coupling đó là thật: chuyển sang additive + flag |
| **Số liệu "migration xong" là "job đã kết thúc"** | Đang đo completion, không đo correctness | So row count và checksum trước/sau. Dữ liệu sai mà job exit 0 là incident, không phải hoàn thành |
| **Không còn test nào chạm vào đường cũ** | Cờ tắt được, nên đường cũ đã chết | Đây là điều kiện để gỡ. Không phải vấn đề |

## Khi nào dừng lại và hỏi

Hỏi trước khi chạm, với câu hỏi cụ thể và kèm khuyến nghị:

- Migration không rollback rẻ: `DROP`, `NOT NULL` lên cột cũ, đổi tên cột đang được ghi.
- Backfill trên bảng lớn, hot, không có batch limit.
- Xóa endpoint đang có traffic.
- Nâng dependency lớn ở cùng thời điểm với thay đổi kiến trúc.
- Hai người đang sửa cùng một seam migration.

## Câu hỏi tự kiểm trước khi bàn giao

| Câu hỏi | Trả lời không trả lời được = chưa xong |
| --- | --- |
| Nếu hỏng lúc 3 giờ sáng, tắt bằng cách nào, ai làm? | Rollback chưa nghĩ tới |
| Migration này chạy lần hai có an toàn không? | Chưa idempotent |
| Tôi đang ở bước nào của expand-contract, và bước trước nó đã đo chưa? | Đang nhảy cóc |
| Client nào chưa lên được bản mới, và tôi đo ra bao nhiêu? | Đang cắt nhầm |
| Đường cũ còn được gọi bởi ai? | Chưa gỡ được |
| Mô tả ngắn gọn cái đã đổi, tách khỏi cái chỉ được refactor | PR chưa tách |

Bất kỳ dòng nào trong bảng trên không có câu trả lời bằng lệnh và số liệu thì việc đó
**chưa verify**. Và đó là phần lớn việc ở đây — không phải viết code.