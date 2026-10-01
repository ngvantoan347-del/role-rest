# Compliance and Data

Các quyết định kỹ thuật mà sau nài ai đó sẽ phải **chứng minh bằng code**, không phải
bằng lời. Phân loại dữ liệu, audit trail, quyền truy cập, retention, provenance của
dependency, và các câu hỏi phải trả lời trước khi merge.

Vì sao tồn tại: chỉ số chấp nhận rủi ro lớn nhất trong sản phẩm là *"chúng tôi có audit
trail"*. Khi có incident, hoặc khi khách hàng hỏi, câu trả lời duy nhất có giá trị là
artefact — dòng log, config, commit — chứ không phải policy PDF. Thứ không hiện diện trong
hệ thống thì không tồn tại, và điều đó đúng cho compliance.

**Control không được implement trong code thì không phải control.** "Mọi thao tác đều được
ghi log" là ý định. Nó thành control khi log chạy, có đủ field, giữ lâu đúng hạn, và đã
có người đọc nó. Việc của kỹ sư là làm cho bằng chứng tồn tại — không phải để làm cho tài
liệu trông đúng. Mọi mục dưới đây đều hướng về việc đó.

Phần an toàn ở tầng code (authN/authZ, validate input, secret) đã nằm ở mục Security của
`references/design-guide.md`. Ở đây là phần cần hệ thống, chính sách, và bằng chứng.

## 1. "Compliant" nghĩa là gì khi vận hành

Định nghĩa mà team kỹ thuật nên dùng: một control **đã có** khi bạn chỉ ra được nó sống ở
đâu, và có bằng chứng nó đã chạy. Ba chỗ bằng chứng có thể nằm, theo thứ tự độ tin cậy
tăng dần:

- **Code** — kiểm tra authZ ở đúng chỗ, chạy trong mọi request.
- **Config** — giá trị có hiệu lực, đọc được, không phải giá trị mặc định mà chưa ai đổi.
- **Run log** — bằng chứng nó đã chạy, có timestamp, do chính hệ thống sinh ra.

Bảng dưới không phải tour khung pháp lý. Nó trả lời câu duy nhất kỹ sư thực sự gặp: *"cụ
thể thì phải có artefact gì trong repo của tôi?"*

| Khung | Chủ đề mà bạn phải có bằng chứng | Artefact trong hệ thống |
| --- | --- | --- |
| SOC 2 | Truy cập có kiểm soát, thay đổi có người review | authZ ở mọi route, config SSO/MFA, `CODEOWNERS`, log đăng nhập và thay đổi quyền |
| ISO 27001 | Kiểm soát đã định nghĩa, hoạt động có ghi | risk register, access review định kỳ có dấu vết, restore đã test |
| HIPAA | Bảo vệ PHI | encryption at rest + in transit, log truy cập từng record PHI, hợp đồng với bên xử lý dữ liệu |
| GDPR | Quyền của data subject | export / delete / anonymise theo id, record of processing, thời hạn đáp ứng |
| PCI DSS | Dữ liệu thẻ không chạm hệ thống của bạn | không lưu PAN/CVV ở đâu, tokenization, log truy cập secret vault, tách network |

Vì sao: một dòng bạn không map được sang file nào mình sở hữu là khoảng trống **của bạn**,
và nói ra sớm thì rẻ hơn nhiều lần so với lúc audit.

Đừng tự suy ra nghĩa vụ pháp lý từ bảng này. Nó là bản dịch sang ngôn ngữ kỹ thuật; câu
hỏi hợp pháp là câu hỏi của legal và security, không phải của bạn.

## 2. Phân loại dữ liệu tại biên

Phân loại trước khi ghi, không phải sau khi đã có vài triệu row.

| Lớp | Ví dụ | Phải có |
| --- | --- | --- |
| Public | docs, marketing page, giá công khai | Không có yêu cầu bảo mật. Vẫn không để input của user đi thẳng ra giao diện. |
| Internal | feature flag, log ứng dụng không chứa PII, ticket nội bộ | Không lộ ra ngoài. Retention đã định nghĩa. Không dùng làm dữ liệu test. |
| Confidential | hợp đồng, giá nội bộ, hồ sơ ứng viên | authZ thật ở server, encryption khi truyền, log truy cập, không đưa vào log ứng dụng |
| Regulated PII | email, địa chỉ, số điện thoại, dữ liệu sức khoẻ, dữ liệu thẻ | Tất cả mục trên, **cộng**: retention theo lớp, đường anonymise/export/delete, audit trail, masking ở mọi log |

Phân loại phải **sống trong schema**, không sống trong wiki:

- Kiểu riêng cho trường nhạy cảm (`CustomerEmail` khác `FreeText`) để compiler chặn chỗ
  ghi sai. Nguyên tắc làm trạng thái sai không thể biểu diễn của `references/design-guide.md`
  áp dụng nguyên vẹn cho data classification.
- Danh sách cột PII nằm cạnh schema và được soi mỗi lần có migration, vì đó là thời điểm
  trường hợp xấu nhất: field mới lọt vào bảng production mà không ai kịp nghĩ tới hậu quả.
- Validate ở boundary chặn trường cấm đi vào nơi không được lưu — ví dụ endpoint read-only
  từ chối nhận `national_id` trong payload, thay vì nhận rồi bỏ đi.

Vì sao: phân loại ghi trong tài liệu thì không ai tra lúc viết query mới. Phân loại nằm
trong migration thì người lạ đọc diff là biết ngay cái gì nhạy cảm.

## 3. PII và secrets từ đầu đến cuối

- **Thu thập tối thiểu.** Trường không tồn tại thì không có nghĩa vụ lưu trữ, không có rủi ro,
  không có câu hỏi "cái này dùng để làm gì nữa".
  Vì sao: mỗi field bạn lưu là một nghĩa vụ dài hạn. Xoá một field sau ba năm dữ liệu tốn
  hơn hàng trăm lần so với việc không lưu nó.
- **Không có PII trong** log, trace, span attribute, error message, URL path hay query string,
  analytics event, crash report, screenshot trong ticket.
  Vì sao: ba chỗ lọt phổ biến nhất là **URL** (nằm trong access log của mọi hạ tầng phía sau
  và trong `Referer` của request kế tiếp), **log** (được gửi ra ngoài qua bên thứ ba), và
  **analytics** (gần như không ai mở cấu hình để kiểm).
- **Mask, không truncate.** `a***@example.com` giữ shape để debug còn `ada...` là dữ liệu
  vô dụng mà vẫn là dữ liệu cá nhân.
  Vì sao: log cần giá trị để debug, nhưng log không cần phần định danh.
- **Test data phải synthetic, có cùng shape**: cùng độ dài, cùng edge case unicode, cùng
  định dạng ngày và timezone, không có id thật, không lấy từ production.
  Vì sao: dữ liệu thật trong fixture sống lâu hơn cả hệ thống, và repo thường có quyền đọc
  rộng hơn bạn nghĩ. Xoá khỏi git không phải là xoá.
- Secret không bao giờ nằm trong cùng diff với thứ khác — quy trì ở `references/git-workflow.md`.
- **Lọt rồi thì sao**: đây không còn là bug. Nó là sự cố có nghĩa vụ thông báo, và đồng hồ
  chạy từ lúc bạn *biết*, không phải từ lúc bạn chắc chắn.
  Vì sao: khoảng thời gian giữa lúc phát hiện và lúc thông báo là thứ quyết định mức độ
  nghiêm trọng của sự cố. "Chắc không ai thấy" không phải kế hoạch xử lý.

## 4. Audit trail

Mỗi event phải có đủ bảy field, thiếu một là không dùng để trả lời được câu hỏi:

| Field | Vì sao cần |
| --- | --- |
| actor | Ai hoặc cái gì. Không có nó thì log chỉ chứng minh *đã có gì đó xảy ra* |
| action | Verb cụ thể, không phải `access` chung chung |
| target | Resource nào, bằng id tồn tại thật |
| outcome | Cho phép, từ chối, lỗi. Từ chối mới là phần đáng đọc nhất khi có sự cố |
| timestamp | UTC, có timezone, không phải giờ máy local |
| source | IP, service identity, credential id |
| correlation id | Nối app log, trace, và audit event của cùng một request |

| Không phải audit log | Vì sao |
| --- | --- |
| `console.log` trong handler | Không ai giữ lâu, không có cấu trúc, và xoá được |
| Dòng log bạn grep để debug | Đổi format là mất lịch sử; không ai đặt retention riêng cho nó |
| Metric đếm số lần gọi | Nói có *bao nhiêu*, không nói *ai làm gì lên cái gì* |
| Bảng audit nằm cùng DB với app data | `DROP TABLE` là xoá bằng chứng |

- **Append-only.** Không `UPDATE`, không `DELETE` trong bất kỳ code path nào.
  Vì sao: log sửa được thì không chứng minh được điều gì.
- **Tamper-evident.** Hash chain, chữ ký, hoặc lưu ở nơi không ghi đè được; kiểm tra
  định kỳ. Vì sao: kẻ gây thiệt hại cũng có quyền ghi log.
- **Retention dài hơn log ứng dụng**, và nằm ở nơi app không xoá được — bucket riêng, retention
  lock, đã ký. Vì sao: bằng chứng hết hạn cùng lúc với log debug là bằng chứng không tồn tại.
- **Bắt buộc phải có**: đăng nhập / đăng xuất kể cả lần fail, thay đổi role và quyền, đọc /
  ghi / xoá dữ liệu theo data subject, export hàng loạt, mọi lần truy cập bằng đường admin.
- **Ghi ở tầng application, không ở tầng database.** Vì sao: trigger ở DB bỏ sót những lần đọc
  mà app đã chặn, và — nghiêm trọng hơn — nó không biết actor là ai.

## 5. Access control là code

`references/design-guide.md` đã nói authN + authZ ở mọi boundary, mặc định từ chối. Ở đây là
phần mà một linter không thấy và một endpoint mới hay quên.

- **"Nó nằm trong internal network" không phải quyết định authorization.**
  Vì sao: một credential bị copy ra container khác là một quyền truy cập, và network không có
  ý tưởng credential đó tồn tại. Cách kiểm chứng: gọi service A tới service B bằng
  credential lấy được — nếu thành công thì đó là lỗ hổng, không phải cấu hình.
- **Service-to-service: mTLS, hoặc token có chữ ký với audience và thời hạn ngắn.**
  Vì sao: static secret chia sẻ qua env không trả lời được câu "ai đã lấy ra" — và mọi
  request sau đó là mù.
- **Server kiểm tra, kể cả khi UI đã ẩn nút.** Vì sao: UI là gợi ý cho người dùng, không
  phải rào.
- **AuthZ ở tầng truy cập dữ liệu, không chỉ ở route.** Query mà quên gắn
  `WHERE tenant_id = ?` là toàn bộ tenant nhìn thấy nhau, và test ở tầng route vẫn xanh.
  Vì sao: đây là bug đắt nhất trong danh sách, và không test tầng nào theo mặc định bắt được.
- **Phân tách role.** Role đọc thường và role privileged tách nhau; role privileged có
  thời hạn hoặc cần lý do được ghi.
  Vì sao: một tài khoản bị chiếm đoạt mang toàn bộ quyền admin là sự cố khác loại với việc
  lộ một bản ghi.
- **Break-glass access**: cơ chế riêng, credential riêng, log riêng, có người duyệt hậu kiểm.
  Vì sao: không có break-glass thì lúc sự cố người ta dùng credential cá nhân — và bạn mất
  đúng dấu vết bạn cần nhất.
- **Test negative cho mọi route mới**: gọi bằng role khác, không chỉ test đường hợp lệ.
  Vì sao: test chỉ test đường thành công là dạng hỏng authZ phổ biến nhất, và nó trông xanh
  hoàn toàn bình thường. Chi tiết phần này ở `references/testing-guide.md`.

## 6. Vòng đời dữ liệu

| Cơ chế | Bạn còn làm được gì sau đó | Vì sao khác nhau |
| --- | --- | --- |
| Xoá | Không còn gì để dùng | Đơn giản nhất và đắt nhất khi phát hiện muộn |
| Pseudonymise — giữ id, bỏ trường nhận diện | Vẫn join và tổng hợp được | Rẻ hơn xoá, nhưng **vẫn là PII** ở hầu hết khung pháp lý |
| Anonymise | Dùng cho thống kê, không truy ngược được về cá nhân | Khó đảm bảo: phải xử lý free text, tên, IP, số điện thoại, id suy ra |

Nhầm ba cái này là nguồn của phần lớn câu trả lời sai khi có data subject request.

- **Retention theo data class và theo region.** Vì sao: một con số toàn cục nghĩa là bạn
  hoặc giữ lâu hơn mức được chấp nhận, hoặc xoá sớm hơn mức business chịu được.
- **Xoá ở bảng chính không phải xoá.** Vì sao: replica, snapshot, backup, search index,
  cache, và dữ liệu đã gửi sang bên thứ ba vẫn còn đó. Trước khi viết hàm delete, hãy lập
  danh sách một row có thể tồn tại ở đâu — việc đó là một task, không phải một suy nghĩ.
- **Backup expiry là một job có lịch và có bằng chứng chạy.** Vì sao: đây là câu trả lời dễ
  nói sai nhất trong một data subject request — "chúng tôi đã xoá" rồi phát hiện dữ liệu còn
  trong backup 30 ngày.
- **Export/right-to-access phải bao phủ cache, replica, warehouse analytics, và các bên
  thứ ba.** Vì sao: export thiếu một phần là export sai, và người nhận không có cách nào biết
  là thiếu.
- **Legal hold phải là một cờ trong schema**, không phải một quyết định miệng. Vì sao: xoá khi
  đang có hold là sự cố tệ hơn nhiều so với giữ lâu hơn mức cần.

## 7. Supply chain và provenance

### Dependency

- **Lockfile phải commit.** Vì sao: build không tái lập được thì "cái gì đã chạy lúc sự cố"
  là câu hỏi không có câu trả lời — và mọi câu trả lời bắt đầu bằng một con số version.
- **Thêm dependency là một quyết định, không phải một dòng lệnh.** Đọc `install script` trước
  khi chạy. Vì sao: install script thực thi code của người lạ trước khi code của bạn chạy, và
  nó là chỗ ít được review nhất trong toàn bộ supply chain.
- **Pin version cho thư viện lõi.** Vì sao: range kiểu `^` nghĩa là bạn đang chạy thử một bản
  phát hành mới trên production mỗi lần ai đó push lên registry.
- **SBOM sinh trong CI** theo CycloneDX hoặc SPDX, gắn với release, lưu lâu hơn vòng đời
  build. Vì sao: SBOM dựng tay lúc sự cố là SBOM không có — và thứ duy nhất nó để lại là cảm
  giác đã có.
- **Vulnerability scan phải có chính sách severity thật.** Vì sao: firehose không ai triage tạo
  cảm giác an toàn giả và làm team tắt cảnh báo, tức là nó làm giảm khả năng phát hiện thật.
  Chính sách phải nói rõ cái gì chặn release, cái gì tạo ticket, và ai xử lý.
- **Kiểm tra licence trước khi thêm dependency.** Vì sao: đây là quyết định pháp lý, và gỡ
  một dependency đã đóng gói vào release gần như không hoàn tác được. Kiểm tra lúc
  `npm install` tốn ba mươi giây; kiểm tra lúc audit tốn hàng tháng.

### Provenance của code được sinh ra

- **Điều khoản của một package là điều khoản của người publish nó, không phải của
  upstream.** Vì sao: chuỗi sublicense và điều khoản phái sinh là chỗ mâu thuẫn xuất hiện muộn
  nhất, và bạn không tự quyết được.
- **Code do công cụ sinh ra vẫn phải qua cùng quy tắc.** Ai là tác giả được ghi nhận, điều
  khoản nào áp dụng, được phép đóng gói và phân phối không.
- **Điều khoản vendor và phần bồi thường trong hợp đồng quyết định ai chịu trách nhiệm khi có
  claim.** Đó là điều khoản hợp đồng, không phải thứ bạn tự suy ra từ tài liệu công cụ.
- **Nguồn gốc của tài liệu hay mã mà công cụ dựa vào không phải phạm vi kỹ sư kết luận
  được.** Câu trả lời trung thực khi bị hỏi là "chúng tôi không biết và không kiểm chứng
  được". Vì sao: đây là chỗ dễ nhất để khẳng định quá mức, và một claim sai về IP tốn nhiều
  hơn nhiều so với một câu "không rõ".
- **Khi scanner hoặc reviewer gắn cờ:** dừng, tách phần bị gắn cờ khỏi phần đã xác minh, ghi
  lại cách đã xử lý và kết luận. Vì sao: xoá im lặng rồi merge là kết quả tệ nhất — mất cả
  tín hiệu lẫn dấu vết, và làm người sau tin nhầm rằng nó đã được xử lý.

| Signal | Nghĩa là gì | Ai quyết | Bằng chứng để ở đâu |
| --- | --- | --- | --- |
| Lockfile diff trong PR | Build có tái lập được hay không | Người review | Diff lockfile trong chính PR đó |
| Advisory có CVE và code tới được | Phản ứng trước, bất kể severity | Kỹ sư sửa | PR fix + link advisory |
| Advisory không tới được | Ghi nhận, không sửa gấp | Owner chính sách severity | Ticket kèm phân tích reachability |
| Licence không tương thích cách bạn phân phối | **Dừng merge** | Legal + tech lead | Ghi quyết định trong ticket |
| Package không còn được duy trì, hoặc có install script mới | Rủi ro supply chain | Tech lead | Ghi quyết định trong ticket |
| Job sinh SBOM fail | Đã release thứ không truy vết được | Release owner | Build log + artifact lưu lâu |
| Material sinh ra bị gắn cờ về IP hoặc licence | Chưa xác minh được nguồn gốc | Legal | Kết quả điều tra, ghi lại kết luận |

Cột "ai quyết" quan trọng bằng cột "nghĩa là gì". Tín hiệu không có chủ thì nó không đi đến
đâu.

## 8. Change control

| Thay đổi | Điều phải có trước khi merge |
| --- | --- |
| Schema hoặc data migration | Migration plan trong PR: additive?, rollback thế nào?, dữ liệu đang tồn tại chịu thế nào |
| AuthN / authZ / permission | Review của owner auth, bắt buộc |
| Đường tiền hoặc billing | Review của owner billing; chứng minh idempotency khi chạy lặp |
| Retention hoặc deletion | Review của owner data; xác nhận đường xoá vẫn còn đúng sau thay đổi |
| Log field hoặc đường PII mới | Xác nhận field đó được mask và có retention riêng |
| Thêm dependency | Kiểm tra licence và advisory, ghi kết quả vào PR |

- **Approval record là dấu vết trong hệ thống** — PR approval, `CODEOWNERS` bắt buộc review —
  không phải lời nhắn. Vì sao: *"chúng tôi đã báo trong Slack"* không trả lời được câu "ai cho
  phép cái này vào lúc nào", và đó chính là câu audit hỏi.
- **`CODEOWNERS` là control rẻ nhất và bị bỏ nhiều nhất.** File được đánh dấu mà không ai
  thực sự sửa là bằng chứng không tồn tại.
  Vì sao: ownership giả làm mọi claim "đã review" trở nên vô nghĩa, và nó hỏng âm thầm —
  không có gì đỏ để nhìn thấy.
- **Emergency change vẫn đi qua PR**, được gắn nhãn, và có hạn retro-review.
  Vì sao: deploy thẳng lúc sự cố là hợp lý vận hành; việc không ai nhìn lại nó là chỗ sự cố
  thứ hai bắt đầu.
- **PR template buộc trả lời các câu ở mục 9.** Vì sao: một ô trong template là câu hỏi
  được hỏi mỗi lần; không có ô thì câu hỏi không bao giờ được hỏi. Định dạng PR ở
  `references/git-workflow.md`.

## 9. Câu hỏi phải hỏi trước khi merge

Đây là bảng ở mục 6 của `SKILL.md` ở tầm doanh nghiệp. Chỉ áp dụng khi diff chạm **data,
quyền, tiền, hoặc trường regulated** — còn lại thì bảng ở `SKILL.md` là đủ.

| Câu hỏi | Nếu không trả lời được |
| --- | --- |
| Field này thuộc data class nào, ai đã phân loại? | Chưa phân loại thì xử lý như confidential |
| Dữ liệu này còn tồn tại ở những nơi nào nữa? | Sẽ phát hiện ra khi cần xoá, tức là muộn |
| Có đường xoá không, và xoá hết ở đâu? | Không xoá được = không xử lý được data subject request |
| Nếu bỏ hết UI, ai vẫn gọi được endpoint này? | Route mới chưa có authZ |
| Query này có scope theo tenant/user không? | Rò dữ liệu chéo tenant; test tầng route không bắt |
| Event này có vào audit log đủ field không? | Khi có sự cố, không trả lời được "ai đã làm gì" |
| Log, error, trace mới đẩy dữ liệu gì ra ngoài? | PII lọt qua log — không hoàn tác được |
| Nếu đây là con đường tiền, nó chạy hai lần thì sao? | Charge hai lần, ship hai lần |
| Dependency mới có licence nói gì? | Một quyết định pháp lý gần như không hoàn tác được |
| Rollback của thay đổi này là gì? | Sự cố thứ hai, và lúc này không còn dữ liệu sạch |

## Khi nào file này liên quan

| Tình huống | Đọc mục |
| --- | --- |
| Thêm endpoint, storage, log field, hay bên thứ ba mới | 2, 3, 5 |
| Đụng dữ liệu thật, retention, export, delete | 6 |
| Thêm dependency, hoặc đổi pipeline build/release | 7 |
| Câu hỏi "cái này có hợp pháp không" | 1 — rồi hỏi legal, đừng tự suy ra |
| Diff chạm quyền, tiền, hoặc data subject | 9 |
| Sự cố liên quan dữ liệu hoặc truy cập | 4 — và bắt đầu từ correlation id |

Không cần file này cho T1. Cần nó trước khi viết dòng code đầu tiên, không phải sau khi
deploy — vì cả hai điều chỉnh sửa được sau khi deploy đều tốn hơn viết đúng ngay từ đầu.

## Một câu hỏi duy nhất

> Nếu hôm nay có người hỏi *"ai đã xem dữ liệu này, từ lúc nào, và bằng bằng chứng gì?"*
> — bạn trả lời bằng artefact, hay bằng ý kiến?

Câu trả lời thứ hai không qua được bất kỳ audit nào. Và phần lớn repo trả lời bằng ý kiến
vì lúc sự cố không ai nhớ mình đã log gì.