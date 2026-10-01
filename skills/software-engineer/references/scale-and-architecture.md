# Scale and Architecture

Quyết định ở cấp hệ thống: có nên tách service, dùng event hay không, cache tới đâu, ai
nhìn thấy dữ liệu của ai, rollback bằng cách nào. Đây là phần bị bỏ nhanh nhất khi
deadline áp, vì mọi mục ở đây **chạy được** — không cái nào đỏ lúc viết.

Vì sao file này tồn tại: lỗi cấp này không nổ lúc viết và không nổ trong review của
người khác. Nó nổ khi traffic lên, khi tenant thứ hai xuất hiện, khi bản deploy thứ ba
trong ngày — lúc đó giá sửa tăng hàng trăm lần và thường phải viết lại.
`references/design-guide.md` nói cách đặt hợp đồng bên trong một process; file này nói
điều gì xảy ra khi hợp đồng đó đi qua wire, qua queue, và qua hàng trăm package.

Điều kiện lọc: chỉ giữ phần dễ bị bỏ dưới áp lực deadline. Định nghĩa kỹ thuật thuần
túy không có ở đây — thuật ngữ không phải nội dung.

## 1. Monorepo và polyrepo

Layout quyết định **cách bạn verify**, trước khi bạn kịp nghĩ tới chất lượng code. Monorepo cho một commit, một search, một dependency graph, và refactor xuyên package không cần version dance; nó lấy giá bằng blast radius của cả repo cho mỗi commit. Polyrepo đổi chiều đó lấy: deploy độc lập, contract rõ bằng version, đổi giá bằng việc không search toàn cục và phải chốt version thủ công.

Vấn đề thật của monorepo là **gate quá đắt**, không phải công cụ build. Full suite 20-25 phút cho một sửa một dòng nghĩa là "tôi sẽ verify sau" trở thành lựa chọn mặc định — bạn vừa tự tạo ra lý do để bỏ qua verification. Số 200 package là do kiến trúc repo, không phải do bạn cẩu thả. Gate rẻ là một yêu cầu kiến trúc.

```bash
nx affected -t typecheck,lint,test --base=origin/main   # package bị ảnh hưởng
turbo run test --filter=...[origin/main]                 # task + package bị ảnh hưởng
bazel query 'rdeps(//..., //libs/shared:all)'          # reverse deps = bề mặt tương thích
pnpm -F <pkg> test && pnpm why <dep>                    # gate một package, ai phụ thuộc
```

Đừng tự chế lệnh "affected" bằng script shell so sánh path — nó bỏ sót case đụng nhiều package, đúng case bạn cần gate nhất. Chi tiết ecosystem: `references/stack-commands.md`.

| Sai lầm | Vì sao |
| --- | --- |
| Chạy `nx run-many -t test --all` | Trả tiền cho 199 package không liên quan để tránh lập bản đồ dependency |
| Chỉ test package sửa, bỏ package import nó | Lỗi nằm ở consumer, không ở package sửa |
| Bỏ qua lockfile trong diff | Lockfile đổi là toàn bộ cây phụ thuộc có thể đổi phiên bản |
| Coi file config là không ảnh hưởng | Config thường nằm ở package khác; build tag và path alias theo nó |

Một package dùng chung có N consumer nội bộ là **một public API với N caller** — đổi signature của nó là breaking change cho cả N, và nó là nơi một lỗi nhỏ đụng nhiều người nhất. Hỏi `rdeps` / `pnpm why` trước khi đổi, và hỏi luôn consumer ở repo khác hay không.

## 2. Services và ranh giới

Tách service là quyết định tổ chức mạng hơn quyết định kỹ thuật, và đắt hơn một interface rất nhiều. Đừng tách chỉ vì "nó sẽ scale" — đó là lý do của người chưa đo.

| Tình huống | Lựa chọn | Vì sao |
| --- | --- | --- |
| Cùng domain, cùng nhịp deploy, cùng team | Module boundary | Tách service mua network, deploy và version contract mà không mua được khả năng độc lập |
| Sở hữu dữ liệu riêng, nhịp deploy khác nhau, team khác nhau | Service | Đây là chỗ service trả lời được: độc lập về deploy và blast radius |
| Cần scale profile khác nhau (CPU-bound vs IO-bound) | Tách process trước | Rẻ hơn nhiều và vẫn giữ được transaction nội bộ |
| Không ai sở hữu cái gì sau khi tách | Chưa tách | Ownership là lý do thật của việc tách, network chỉ là hậu quả |

**Sync hay event.** Dùng sync khi caller cần kết quả để quyết định bước tiếp, hoặc cần backpressure tức thời. Dùng event khi chỉ cần biết "nó đã xảy ra" và consumer chịu được chậm. Vì sao: sync biến latency của hạ tầng thành latency của bạn, và hạ tầng không chịu SLA của bạn; sync cũng làm lỗi lan, còn event thì cô lập được lỗi. Query dữ liệu bên kia bằng sync call là cách bạn tự viết distributed join rồi tự debug nó. Bất cứ lựa chọn nào, contract vẫn phải khai báo những mục trong bảng Contract ở `references/design-guide.md`.

### Khi dependency đổi

Đây là phần không ai test cho tới khi xảy ra thật, vì ở local mọi thứ nhanh và còn sống.

| Dependency làm gì | Nó hỏng gì, và cơ chế nào chặn lại | Vì sao |
| --- | --- | --- |
| Latency tăng 10x | Pool connection đầy — cần timeout | Không có timeout nghĩa là mỗi request giữ một connection tới hết hạn mặc định. Budget tính ngược từ SLA của bạn, và phải có cả timeout `pool` chứ không chỉ read/write |
| Availability giảm | Mất capacity — cần retry + backoff + jitter, rồi circuit breaker | Retry không giới hạn biến sự cố của họ thành tải của bạn; không có breaker thì retry bay hết vào đúng chỗ đang cháy |
| Chậm ở hop giữa | Budget latency của cả chain bị ăn hết | 3 hop × 200ms = 600ms trong khi SLA là 300ms. Chuỗi gọi cộng dồn, và không ai cộng |
| Một dependency chậm chiếm hết pool | Phần còn lại của app chết theo — cần bulkhead | Pool chung không cô lập được, nên một bên yếu kéo tất cả |
| Deploy không tương thích | `null` lọt vào logic của bạn | Lỗi của bạn nổ ở deploy của họ, và bạn không có bằng chứng nào |

### Retry không có idempotency key là bug ghi trùng

Client nhận timeout không biết bạn đã ghi chưa, nên nó retry — đúng như mong muốn. Nhưng nếu server không có key, lần hai là một lần ghi thứ hai. Với payment hay inventory, đó là bug dữ liệu, không phải bug hành vi.

- Key do **caller** sinh và giữ qua các lần retry. Server tự sinh key thì mỗi lần retry là
  một key khác, tức là không có idempotency.
- Server lưu key cùng **kết quả trả về** trong cùng transaction với side effect. Không
  lưu kết quả thì lần retry trả 2xx mà không làm gì — client nghĩ thành công, dữ liệu vẫn
  sai.
- TTL của khoá phải **dài hơn cửa sổ retry** của client. `UNIQUE` trên key chống được cả
  race giữa hai instance.

## 3. Events và async

Broker bảo đảm "không mất", không bảo đảm "không lặp". Mọi consumer phải giả định message đến lại từ một đến ba lần, và phải idempotent ngay từ đầu — sửa sau khi đã có dữ liệu trùng trong production tốn hơn nhiều so với viết đúng lần đầu.

| Consumer buộc phải làm | Vì sao |
| --- | --- |
| Handler idempotent, dedup key lưu cạnh side effect với TTL > cửa sổ redelivery | Dedupe không TTL là bảng phình vô hạn, tức là không dedupe gì |
| Chỉ giả định thứ tự khi partition bảo đảm nó | Broker bảo đảm thứ tự **trong một partition**, không bảo đảm giữa các partition |
| Handler nhạy thứ tự thì dùng state machine, không last-write-wins | Ở thứ tự không bảo đảm, last-write-wins âm thầm nuốt cập nhật hợp lệ |
| Poison message → DLQ sau N lần, giữ payload gốc và lý do | Retry mãi một message hỏng nghĩa là consumer kẹt vĩnh viễn, phần còn lại dồn phía sau |
| Acknowledge **sau** khi side effect xong | Ack trước là mất message vĩnh viễn khi process chết giữa chừng |
| Handler không gọi blocking IO lâu | Partition xử lý tuần tự; handler 2 giây giới hạn throughput của cả topic |
| Replay được từ log | Khi phát hiện bug ở handler, chạy lại dữ liệu lịch sử là lựa chọn cuối, và nó phải khả thi |

Event schema là public contract, không phải shape nội bộ. Thêm field mới optional thì
được, vì consumer cũ bỏ qua field lạ. Đổi kiểu field hoặc đổi tên key thì không, vì
consumer deserialize fail lúc **chạy** chứ không lúc build. Đổi *nghĩa* field (cents
thay dollars, UTC thay local) thì không bao giờ — dữ liệu sai mà không có gì báo lỗi, và
đây là loại bug đắt nhất. Xóa field thì chỉ sau khi mọi consumer đã bỏ nó: đo mức dùng
trước, đừng đoán. Đừng publish toàn bộ row lên bus — publish **payload tối thiểu** consumer
cần, kèm id để nó tra cứu nếu thật sự cần. Payload đã đi ra ngoài ranh giới của bạn và
sẽ tồn tại lâu hơn code đã sinh ra nó.

**Dual-write.** "Ghi vào DB rồi publish event" là hai hệ thống và không transaction nào bao trọn cả hai. Luôn có một khe hở, và nó được tìm ra bởi sự cố khác, vào lúc tệ nhất. Transactional outbox — ghi event vào bảng `outbox` trong cùng transaction, một process riêng đọc và publish — loại bỏ mất event, và trả lại ba thứ: vẫn at-least-once nên consumer vẫn phải idempotent; độ trễ publish bằng độ trễ poll; và một thành phần vận hành nữa phải deploy, monitor, và dọn bảng. Đừng coi đây là thứ làm sau — đường ghi event không có outbox là nợ đã phát sinh, và nó được trả bằng mất dữ liệu chứ không phải bằng một ticket.

## 4. Multi-tenant SaaS

Cách rẻ nhất để rò dữ liệu giữa các khách hàng trả tiền là để lọc quên ở đúng một chỗ.
Và chỗ bị quên nhiều nhất không phải SQL — nó là **cache key**.

| Rule | Vì sao |
| --- | --- |
| `tenant_id` là `NOT NULL` trên mọi bảng chứa dữ liệu khách hàng, có index | Dữ liệu không thuộc tenant nào sẽ không ai nhớ tới lúc truy vấn |
| Tenant lấy từ token/session, **không bao giờ** từ request body | Body là do client kiểm soát. Đây là IDOR kinh điển |
| Mọi query đi qua một entry point duy nhất đã gắn tenant từ context | Ràng buộc thủ công ở từng call site là ràng buộc sẽ có một chỗ sót |
| Mọi cache key, object path, search index, log field có tenant prefix | Cache dùng chung key là rò dữ liệu, và nó không để lại dấu vết ở log |
| Row-level security ở DB là lớp phòng thủ thứ hai | RLS bảo vệ khi app code sai. App code đúng là điều kiện để RLS có tác dụng |

Test rẻ và hiệu quả nhất cho phần này: lấy token của tenant A, gọi API với `id` thuộc tenant B, khẳng định **404 chứ không phải 403** — 403 để lộ sự tồn tại của dữ liệu.

Tenant filter trong SQL bảo vệ **dữ liệu**, không bảo vệ **quyền** — hai câu hỏi riêng, hai lớp riêng. Global role không gắn tenant là đường đi vòng toàn bộ tenant scope. Tenant-scoped role (`owner` / `member` của tenant X) đủ cho phần lớn SaaS B2B, nhưng không đủ khi dữ liệu nhạy cảm hơn mức "cả tenant". Resource-level thì cần khi tenant có cấu trúc nội bộ: team, project, dòng sản phẩm.

| Tier cách ly dữ liệu | Được gì | **Không** cho bạn |
| --- | --- | --- |
| Shared schema, `tenant_id` là cột | Rẻ nhất, một migration cho tất cả | Một query quên filter là rò dữ liệu. Một index hỏng đụng mọi tenant. Backup, restore và downtime cũng chung |
| Schema per tenant | Query không cần filter, cách ly ở mức namespace | Không sống được với hàng nghìn tenant: migration = N schema, connection = N schema, vẫn chung một failure domain |
| DB per tenant | Cách ly gần như tuyệt đối, restore riêng, noisy neighbour gần như biến mất | Chi phí vận hành mỗi tenant, cross-tenant query phải làm riêng, và nó **không** miễn nhiễm với một tenant dùng sai — chỉ chuyển thành bài toán vận hành |

Chọn tier là chọn loại sự cố bạn chịu. Không tier nào miễn nhiễm; khác nhau ở chỗ sự cố lộ ra sớm hay muộn. Và noisy neighbour vẫn cần quota riêng dù tier nào: rate limit theo IP không phải rate limit theo tenant — một tenant 500 seat sau một proxy NAT vẫn là một IP.

**Migration và backfill khi đã có nhiều tenant:** thành công ở 3 tenant không nghĩa là thành công ở tenant có 40 triệu row. Backfill phải **batched** (không phải một `UPDATE` không giới hạn — nó giữ transaction mở và chặn vacuum), **resumable** với checkpoint để chạy lại nhiều lần không hỏng, **chịu được cả hai shape** trong suốt backfill (cùng luật tương thích ngược ở `references/design-guide.md`), **giới hạn tốc độ** để không cạnh tranh với traffic thật, và **có số liệu** bao nhiêu row đã xong. Backfill là một deploy không có rollback, nên "resumable" là thứ duy nhất cứu được nó khi hỏng giữa chừng.

**Test isolation:** mỗi test tạo tenant của riêng nó, và fixture không mang sẵn `tenant_id` — fixture có tenant cứng là đường rò dữ liệu đi vào suite một cách âm thầm. Phải có ít nhất một test chứng minh tenant A không đọc được dữ liệu tenant B; đó là test duy nhất bảo vệ được từ layer này trở xuống. Cache và background job cũng phải có tenant, vì cache key thiếu tenant trong test vẫn xanh và vẫn hỏng ở production.

## 5. Data at scale

| Cách phân trang | Khi nào hỏng | Vì sao |
| --- | --- | --- |
| `OFFSET` | Có insert hoặc delete giữa hai lần đọc | Row mới chèn ở đầu đẩy record cuối xuống, client thấy lặp hoặc sót. Đọc trang 500 vẫn phải scan 500 trang |
| Keyset / cursor | Không hỏng nếu cursor là cột có index | Chỉ đọc đúng số row cần, thứ tự là thứ tự vật lý của index nên ổn định |
| Cursor trên `updated_at` | Có update giữa hai lần đọc | `updated_at` đổi thì item bị sót hoặc lặp; cursor phải dựa trên khóa bất biến |
| Page size không cap | Client tự gửi `?limit=100000` | Một request giết cả database |

Cursor nên là cặp `(created_at, id)` để thứ tự là duy nhất — chỉ `created_at` thì hai row cùng timestamp làm cursor mơ hồ.

**Không cap thì chết theo kiểu riêng.** Query không `LIMIT` giết database; `IN (...)` build từ user input làm query plan nổ. Thread, goroutine, connection per request không cap biến tăng tải thành tăng tài nguyên thay vì tăng throughput. Queue không cap độ dài thì buffer đầy là drop hoặc nghẽn ngược, và cả hai đều cần quyết định tường minh. In-memory cache không cap thì OOM, đúng lúc traffic cao nhất. Retry không cap thì sự cố nhân với chính nó.

**N+1 ở tầng ORM:** lazy loading mặc định là N+1 — một query lấy N row rồi N query cho mỗi row. Nó không nổ lúc có 10 dữ liệu và nổ khi bảng đó có 10 nghìn. Cách bắt: đếm số query trên **một endpoint thật**. Tắt lazy loading ở dev để N+1 thành exception ngay lần chạy đầu — đó là lý do nó đáng cấu hình.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;   -- Postgres
EXPLAIN SELECT ...;                        -- MySQL
```

Bốn thứ cần nhìn trong plan: index có thực sự được dùng không, rows ước tính so với rows thực, có sort/temp sort bất ngờ không, và index nào đang bị scan toàn bộ. Tạo index trên bảng lớn bằng `CREATE INDEX CONCURRENTLY` (Postgres) — index thường khóa ghi suốt thời gian build. Và index là chi phí ghi: thêm index cho mọi cột trong một `WHERE` là tối ưu bằng cách làm chậm mọi thứ.

**Partition và archival.** Partition theo thời gian khi bảng có retention: nó biến "dọn dữ liệu cũ" từ một `DELETE` hàng loạt — lâu, khóa, sinh WAL khổng lồ, làm sập replication — thành một `DROP` gần như tức thì. Bảng không ai query nữa thì chuyển sang cold storage; giữ nó ở đó chỉ tốn tiền mà không tạo giá trị.

**Cache.** TTL luôn có, kể cả khi bạn nghĩ không cần — cache không TTL sống mãi và sống sai. Invalidate tường minh khi ghi theo key đã biết, vì dựa vào TTL cho dữ liệu user đọc ngay sau khi ghi nghĩa là họ thấy dữ liệu cũ. Key phải phản ánh **mọi** chiều thay đổi kết quả, gồm cả identity và tenant — key thiếu một chiều quyền là cache đọc trộm. Dùng single-flight cho key nóng, vì cache stampede nghĩa là N request cùng hỏi DB cùng lúc ngay khi key hết hạn.

**Backpressure.** Khi consumer chậm hơn producer, ba lựa chọn và cả ba đều phải nói to trước khi cài: giới hạn đầu vào (503) đánh đổi một phần traffic nhưng rõ ràng và đo được; buffer có giới hạn rồi drop có kiểm soát, chỉ cho event thuộc loại drop được, và khi đó mất dữ liệu là thiết kế chứ không phải sự cố; hoặc chặn producer, giữ dữ liệu và giảm throughput toàn hệ thống. Im lặng là lựa chọn thứ tư, và nó thành OOM vào lúc tải cao nhất.

## 6. Concurrency và distributed correctness

| Lỗi | Cơ chế | Vì sao |
| --- | --- | --- |
| Lost update | `UPDATE ... WHERE version = $1`, hoặc `SELECT ... FOR UPDATE` | Đọc-rồi-ghi không atomic; hai request đọc cùng giá trị rồi mỗi đứa ghi đè |
| Double submit | Idempotency key từ client | Không có key thì đó là hai giao dịch **hợp lệ về mặt kỹ thuật** — hệ thống đang làm đúng yêu cầu |
| TOCTOU | `UNIQUE` constraint, `INSERT ... ON CONFLICT DO NOTHING` | Khoảng trống giữa `SELECT` và `INSERT` là chỗ để request thứ hai chen vào |
| Hai worker claim một việc | `SELECT ... FOR UPDATE SKIP LOCKED` trong transaction, kèm lease có thời hạn | Worker chết không giải phóng việc → lease hết hạn thì được claim lại → handler phải idempotent |
| Distributed lock | `SET key value NX PX ttl` **và** một primitive phân giải lock | Lock hết TTL giữa lúc bạn còn giữ nó → hai owner cùng lúc. Và không ai giữ được hợp đồng giữa lock và DB transaction |
| Cache stampede | Single-flight, jitter TTL | Hết TTL của key nóng = N request cùng hỏi DB cùng lúc |

Một `UNIQUE` constraint thường thắng một distributed lock: lock bảo vệ bạn khỏi hai process cùng hành động, còn constraint bảo vệ bạn khỏi **mọi** client kể cả client không đi qua lock. Constraint nằm trong storage nên không mất khi process chết. Khi quy tắc có thể diễn tả bằng constraint, hãy dùng constraint — lock là giải pháp cho thứ bạn chưa biết có thể biểu diễn không.

**Clock skew.** Host lệch vài giây là đủ phá token hết hạn, xác minh chữ ký webhook và lease của work queue. Vì sao: bạn đang so `now()` của host A với `now()` của host B, và không host nào đúng về mặt tuyệt đối — thứ tạo ra "5 phút trước" lại là "5 phút sau" chỉ với vài giây drift. Cho token và chữ ký: vòng xoay secret với **giới hạn skew chấp nhận được** viết tường minh. Cho leasing và dedup: dùng version counter từ storage, không dùng giờ. Cho báo cáo: dùng đồng hồ server làm nguồn, ghi rõ timezone.

**"Exactly-once" là lời nói dối được kể bằng transaction đặt sai chỗ.** Transaction của database là local cho **một** database: nó không bao được HTTP call, không bao được broker, không bao được hàng đợi. Cái bạn thực sự đạt được là at-least-once cộng idempotent consumer, và trong phần lớn hệ thống thế là đủ. Khi ai đó nói "exactly-once", hỏi hai câu: boundary nào, và khi nó gãy thì dữ liệu ở trạng thái nào. Câu thứ hai thường không có câu trả lời, và đó là câu trả lời.

## 7. Observability là một yêu cầu giao hàng

Một thay đổi không có observability là một thay đổi chưa xong — không phải "làm sau".

| Phải ship cùng | Vì sao |
| --- | --- |
| Structured log có correlation id | Câu hỏi duy nhất lúc 3 giờ sáng là "request này đi qua những đâu" |
| Metric cho hành vi mới | Metric là thứ có số đo trước/sau. Log là thứ bạn đọc sau khi đã biết có vấn đề |
| Trace propagation qua mọi outbound call | Không có trace thì chuỗi chẩn đoán là suy đoán |
| Dashboard nếu metric đủ nguy hiểm để cần alert | Metric không ai nhìn thì không tồn tại |

Phần log cấp module đã nằm ở `references/design-guide.md`. Ở đây là phần cấp hệ thống: những thứ phải có **trước** khi nó chạm người dùng.

**Correlation id phải đi qua ranh giới async.** Đặt nó vào header/message metadata khi phát; consumer nhận lại, giữ khi log, và tạo id mới cho span con. Nếu không, bạn có log ở producer và log ở consumer không nối được — tức là đúng lúc cần trace nhất thì bạn không có nó. Cùng cơ chế cho trace context qua HTTP và qua message broker. Và **metric không được gắn id**: metric mang label user id, tenant id hay request id là metric đã chết — cardinality nổ, và nó tốn tiền theo cách không đo được.

**Alert trên symptom, không trên cause.** CPU > 80% là alert tệ: nó không phải lúc nào cũng là vấn đề, và nó bắn đúng lúc bạn đang scale hợp lý. Tốt là tỷ lệ 5xx hoặc p99 latency vượt SLO — thứ user cảm được. Tương tự, queue depth là hậu quả trong khi latency end-to-end là thứ người dùng đang chờ; pod restart là việc của ops trong khi error rate theo endpoint là việc của bạn. Alert cần action rõ ràng: "endpoint chậm" thì không làm được gì, "checkout p99 > 2s trong 15 phút" thì có.

**SLO và error budget.** Đo theo user journey, không theo từng service, rồi nó quyết định hành vi — còn budget thì ship nhanh, hết thì dừng sửa trước. Đây là thứ biến "cẩn thận" từ cảm xúc thành quy tắc và là thứ duy nhất chống được alert fatigue. Con số phải được ký chứ không phải mặc định: SLO 99.9% nghĩa là khoảng 43 phút downtime mỗi tháng cho **mọi** người dùng cùng lúc, và cần một người chịu trách nhiệm đọc và chấp nhận.

**"Sẽ thêm monitoring sau"** sẽ không bao giờ được thêm, vì lúc đó sự cố đã qua và không ai còn những chi tiết đó. Thêm observability cho một thay đổi đã ba tháng là gần như viết lại từ đầu.

## 8. Release và rollback trong tổ chức lớn

**Feature flag là một hợp đồng**, và mỗi thuộc tính đều có lý do: có owner, ghi tên người hoặc team, vì flag không ai sở hữu là flag không ai xóa. Có ngày hết hạn viết trong code, vì flag sống mãi là một nhánh mã bạn không còn test và không ai dám xóa vì sợ nó đang bật ở đâu đó. Có bước đánh giá lại ở mỗi deploy, nếu không tỷ lệ flag chết tăng đơn điệu. Cả hai trạng thái đều phải được test — flag off là code chưa từng chạy, flag on là đường đã test, thiếu một nghĩa là bạn có một nhánh không ai verify. Và flag là đường thoát, không phải cơ chế cấu hình: biến thể thuần đổi label. Flag debt là cùng loại nợ với `TODO` debt.

| Bước rollout | Dừng khi | Vì sao |
| --- | --- | --- |
| Canary: traffic thật vào instance mới, cũ giữ nguyên | Error rate hoặc latency của instance mới tệ hơn | So sánh trực tiếp, không cần control group |
| Percentage: 1% → 10% → 50% → 100% | Metric xấu đi vượt nhiễu nền | Cần so sánh nhóm có và không, nếu không thì không biết do mình hay do hôm nay |
| Vòng người dùng nội bộ | Người nội bộ thấy lỗi mà user ngoài không thấy | Đó là lúc bạn đang test ở sai chỗ và sẽ ship cái đó |

Bất biến: **tăng phạm vi chậm, giảm nhanh**. Nếu cần họp để rollback thì đó không phải là rollout có kiểm soát.

**Rollback nhàm chán** cần bốn điều kiện, và thiếu một cái là mất cả ba:

1. Rollback chỉ là deploy bản cũ, không cần viết code đảo ngược.
2. **Code cũ đọc được dữ liệu mới.** Đây là điều kiện bị bỏ nhiều nhất: thêm cột
   `NOT NULL`, đổi kiểu, `RENAME` cột, hay thêm giá trị vào enum mà code cũ không biết —
   tất cả đều làm code cũ crash **sau khi** bạn rollback. Deploy lại version cũ rồi phát
   hiện nó không chạy là tình huống tệ nhất có thể xảy ra.
3. Đường lỗi đã tách khỏi đường happy bằng flag, nên tắt được mà không rollback.
4. Đã biết trước ai quyết định rollback và cần bao lâu để có họ.

Điều kiện 2 là lý do `design-guide.md` yêu cầu migration additive và reader chấp nhận cả hai shape.

**Config change cũng là một deploy.** Nó đi qua cùng pipeline, có cùng khả năng hỏng, và thường **không** có feature flag, **không** có test, **không** ai từng rollback nó. Config sai làm hỏng production nhiều không kém deploy sai, và nó bị bỏ qua trong mọi kế hoạch rollback. Config thay đổi hành vi phải được version, review, và có giá trị mặc định an toàn.

| Bước migration | Nội dung | Chạy được với code cũ không |
| --- | --- | --- |
| Expand | Thêm cột mới nullable, không xóa gì | Có |
| Migrate | Backfill, ghi vào cột mới, đọc từ cột mới khi sẵn sàng | Có |
| Contract | Xóa cột cũ, thêm `NOT NULL` | Chỉ khi **không còn** instance nào chạy code cũ |

Thứ tự này bắt buộc vì code cũ và mới luôn tồn tại cùng lúc trong một lần deploy lớn, nên
contract trước expand là cách bạn tự tạo ra sự cố không rollback được. Và "code cũ đã chết"
là khẳng định cần đo bằng metric, không phải suy đoán từ "mình deploy xong rồi".

## 9. Câu hỏi phải trả lời trước khi gọi một thay đổi là xong

Đây là bản độ cao enterprise của bảng ở mục 6 của `SKILL.md`. Mỗi câu phải trả lời được
bằng một con số, một câu lệnh, hoặc một `path:line`. Không trả lời được thì đó là khoảng
trống cần **báo**, không phải chi tiết để bỏ qua.

| Câu hỏi | Trả lời bằng gì |
| --- | --- |
| Ở quy mô N nào thì hành vi này đổi? | Con số: số row, số tenant, message/s, số package |
| Thay đổi này ảnh hưởng package nào, tôi đã chạy gate của chúng chưa? | Output của `nx affected` hoặc `turbo --filter` |
| Ai đang phụ thuộc vào cái tôi đổi, trong repo này và repo khác? | `rdeps`, `pnpm why`, import graph |
| Nếu dependency chậm hoặc chết, request path này làm gì? | Timeout, breaker, bulkhead đã đặt chưa |
| Message này đến hai lần thì sao? | Idempotency key hoặc dedup key |
| Payload này mang dữ liệu cá nhân nào, và nó được lưu ở đâu? | Danh sách field và nơi lưu |
| Query này ở N triệu row thì plan ra gì? | `EXPLAIN (ANALYZE, BUFFERS)` |
| Tenant này dùng 1% dữ liệu nhưng 100% connection thì sao? | Limit per tenant đã đặt chưa |
| Có đường nào đọc dữ liệu này mà không có `tenant_id` không? | Query audit; test chứng minh tenant A không đọc được dữ liệu B |
| Hai request đến cùng lúc thì state có hỏng không? | Test song song, `go test -race`, constraint đã đặt |
| Khi rollback, code cũ có đọc được dữ liệu mới không? | So schema trước và sau, gọi tên cột mới |
| Tôi biết nó hỏng bằng tín hiệu nào, trong bao lâu? | Metric + alert + dashboard, kèm tên |
| Thay đổi này có flag không, và flag hết hạn ngày nào? | Tên flag, owner, ngày |
| Nếu tầng dưới sập 100% thì hệ thống này làm gì? | Hành vi khi dependency chết: chặn, hạn chế, hay sập theo |

## Khi nào cần đọc file này

- Thay đổi chạm nhiều hơn một package, một process, hoặc một service.
- Diff của bạn chứa `tenant_id`, cache, queue, event, retry, lock, hoặc `idempotency`.
- Nhiều khách hàng dùng chung hệ thống và dữ liệu của họ không được lẫn.
- Trước khi gọi một design là "đủ lớn" — hãy hỏi nó sẽ hỏng thế nào khi N tăng gấp trăm
  lần.

Cái bạn chưa cần: dự án một người, chưa có khách hàng thứ hai, một process duy nhất. Ở đó
phần lớn mục ở đây là over-engineering, và `references/design-guide.md` là đủ.

## Phán đoán cuối

Không mục nào ở trên nhằm làm hệ thống phức tạp hơn. Tất cả đều hướng về một câu hỏi:
**khi có gì hỏng, bạn có biết chính xác nó hỏng ở đâu, và có quay lại được không.**

Một thay đổi không có câu trả lời cho cả hai thì nó chưa xong — dù code sạch, test xanh,
và PR được duyệt.
