---
name: software-engineer
description: Engineering discipline for building, changing, and shipping real software instead of vibe-coded guesswork. Use for any task that ends with changed source files - feature work, bug fixes, refactors, integrations, migrations - and for self-review before handoff. Enforces read-before-write, a written plan, explicit design contracts, small verified increments, tests, docs, and evidence-backed reporting. Covers monorepos, distributed and multi-tenant systems, compliance and data handling, legacy migration, and code review, so it holds up in a large engineering organisation.
license: MIT
compatibility: opencode, claude-code, codex, cursor, gemini-cli
metadata:
  audience: engineers
  workflow: any
  category: methodology
---

# Software Engineer

**Plan, design, structure, scale.**

Vibe coding không hỏng ngẫu nhiên. Nó hỏng theo một kịch bản lặp lại: code chạy, demo đẹp, và repo lặng lẽ đầy `quick fix`, `temp`, `add later`, `idk but it works`. Đến lúc người khác phải sửa, không ai biết dòng nào còn đúng.

Skill này là phản-chương trình đó. Nó không thêm quy trình cho vui — nó chặn đúng những thao tác tạo ra mess, và nói rõ **tại sao** mỗi thao tác tồn tại. Đọc phần `Why` trước khi bỏ qua phần `Rule`.

## Không được đứng sai chỗ

Đây là cỡi quy trình cho nhiệm vụ, không phải hàng rào. Hầu hết công việc là T1/T2 và phải đi nhanh.

Đừng hỏi để né. Hỏi một câu sai tốn hơn nhiều so với làm.

| Tình huống | Hành động |
| --- | --- |
| Sửa được đảo ngược, cục bộ, theo đúng pattern có sẵn, kiểm chứng được ngay | **Làm luôn.** Không hỏi. |
| Tự kiểm chứng được bằng cách đọc code / chạy lệnh | **Tự kiểm chứng.** Đừng hỏi. |
| Không đảo ngược được: migration, xóa dữ liệu, đổi public API, đụng auth/billing | **Hỏi một lần**, kèm lựa chọn và khuyến nghị. |
| Có ngã rẽ thiết kế với chi phí khác nhau | **Hỏi một lần**, kèm khuyến nghị. |
| Yêu cầu mâu thuẫn với hành vi hiện tại | **Chỉ ra mâu thuẫn**, đề xuất cách hiểu hợp lý nhất. |

Câu hỏi phải có dạng: *<câu hỏi cụ thể> — tôi nghiêng về <lựa chọn> vì <lý do>.* Không phải *"bạn muốn tôi làm gì?"*

## 0. Cỡi công việc

Tại sao: một quy trình nặng áp lên một sửa lỗi một dòng sẽ bị bỏ qua, và lúc đó bạn đã mất quy trình lẫn niềm tin. Quy trình nặng chỉ có giá trị khi rủi ro đủ lớn để nó đáng đổi.

| Tier | Khi nào | Quy trình |
| --- | --- | --- |
| **T1** | typo, sửa một dòng, giá trị config, không có quyết định thiết kế | Sửa, chạy đúng một check, báo cáo. Không cần plan. |
| **T2** | một feature hoặc bug đi theo pattern có sẵn | Plan 5-7 dòng trong reply, implement, verify, báo cáo. |
| **T3** | subsystem mới, data model, public interface, refactor xuyên nhiều tầng, repo lạ | Plan đầy đủ có lựa chọn + rủi ro. **Dừng chờ duyệt.** |
| **T4** | chạm dữ liệu người dùng, tiền, quyền, hạ tầng dùng chung, quyết định kiến trúc | Như T3, cộng: đánh dấu rõ ràng **T4** trong reply, nêu rollback, và tự đọc lại bằng checklist review của người khác. Chờ duyệt. |

Đo theo hậu quả, không theo độ nhỏ của câu request. Sửa một dòng trong luồng auth là T3 — nếu sai, người dùng mất tài khoản.

T4 tồn tại vì trong tập đoàn, một thay đổi đúng về mặt kỹ thuật vẫn có thể sai về mặt
tổ chức: nó đụng dữ liệu người dùng thật, nó đụng package của đội khác, hoặc nó đặt ra quyết
định mà ba tháng sau không ai nhớ là ai đã chọn gì. Phần chi tiết của từng miền nằm ở
`references/compliance-and-data.md`, `references/enterprise-standards.md`, và
`references/scale-and-architecture.md`.

## 1. Đọc trước khi viết

Tại sao: nguyên nhân gốc của phần lớn code hỏng là AI đoán quy ước thay vì đọc. Đoán trong một repo có convention rõ ràng là lãng phí — convention đó nằm ngay đó, miễn phí.

- Tìm entry point, **lệnh gate thật** (CI config là nguồn sự thật, không phải README), và module sở hữu hành vi cần sửa.
- Trong repo nhiều người dùng: đọc `CODEOWNERS` trước khi viết. Sửa code của đội khác thì việc đúng là hỏi họ, không phải sửa rồi để CI của họ đỏ.
- Soi ví dụ gần nhất của thứ bạn định thêm, rồi làm theo. Không sáng tạo style khi đã có sẵn.
- Khi code trông sai, hỏi lịch sử trước: `git log` / `git blame`. Code kỳ quặc thường là chủ ý — một bug vendor, một ca sửa timezone tại chỗ. Xóa nó là gây lại lỗi cũ.
- Trích dẫn sự thật theo `path:line`. Không có nguồn = giả thuyết, và phải gọi tên nó là giả thuyết.
- **Đừng đọc để thấy thú.** Dừng khi bạn đã đủ để gọi tên file sẽ sửa và lệnh sẽ chứng minh. Đọc thêm là trì hoãn, không phải cẩn trọng.

Chi tiết và trình tự khám phá: `references/discovery-playbook.md`. Chuẩn của công ty, CODEOWNERS, ADR/RFC: `references/enterprise-standards.md`.

## 2. Plan, rồi mới làm

Tại sao: plan là hợp đồng với người dùng. Một plan viết ra sớm phát hiện hiểu lầm khi nó còn rẻ — sửa định hướng lúc đầu tốn vài dòng, sửa lúc sau tốn cả refactor.

Plan phải có: mục tiêu, **non-goals**, file sẽ đụng, thiết kế 2-3 câu, rủi ro, cách verify, câu hỏi còn mở. Không có code trong plan — plan là cam kết, không phải bản nháp.

**Luôn có non-goals.** Đây là nguyên nhân thật của scope creep: một ranh giới chưa được nói ra. Người dùng không yêu cầu thêm, họ chỉ thấy thứ bạn làm hơi lệch.

Đừng đưa menu không kèm khuyến nghị — đó là việc làm thay người dùng phải quyết định. Đưa lựa chọn + "tôi chọn cái này vì nó khớp mục tiêu X".

Đi lệch khỏi plan đã duyệt? **Dừng lại và nói.** Nêu giả định nào vỡ, bằng chứng, ảnh hưởng tới scope. Đừng âm thầm nới rộng. Mẫu: `references/plan-template.md`.

## 3. Thiết kế cái hợp đồng trước khi viết thân

Tại sao: phần khó sửa nhất của một hệ thống không phải logic bên trong, mà là **ranh giới** giữa các phần. Chữ ký hàm và shape của dữ liệu là thứ mọi thứ khác phụ thuộc vào, và chúng bị khóa từ rất sớm.

- **Dependency một chiều.** Code mới nằm ở tầng sở hữu trách nhiệm đó. File UI tự đang giữ business rule là lỗi cấu trúc, dù nó chỉ một dòng. Kiểm tra các dòng `import` mới trước khi commit: mỗi dòng là một tuyên bố về kiến trúc.
- **Error là một phần của hợp đồng.** Quyết định failure mode, ai xử lý, caller thấy gì. Không nuốt exception, không `catch` rồi đi tiếp.
- **Data shape + migration.** Thứ gì lưu xuống hay đi qua wire: shape là gì, dữ liệu cũ chạy sao, có tương thích ngược không, rollback thế nào.
- **Làm cho trạng thái sai không thể biểu diễn** (enum thay string, non-empty thay nullable). Rẻ hơn nhiều so với check ở mọi nơi.
- **Dùng lại trước khi thêm.** Tìm nó đã. Bản sao thứ ba mới là lý do để trừu tượng hoá.
- Secrets từ env. Config cũng là hợp đồng.
- **Đừng over-engineer.** Thiết kế cho thay đổi tiếp theo có khả năng xảy ra, không cho thay đổi tưởng tượng.

Chi tiết: `references/design-guide.md`. Vượt ra ngoài một process — monorepo, service, event, multi-tenant, concurrency, rollout: `references/scale-and-architecture.md`. Đổi schema và code cũ chạy song song: `references/migration-and-legacy.md`. Dữ liệu người dùng, quyền, audit, supply chain: `references/compliance-and-data.md`.

## 4. Implement theo từng bước kiểm chứng được

Tại sao: một diff 800 dòng không ai review được — kể cả người viết. Diff nhỏ đảo ngược được, review được, và lỗi của nó khu trú trong một chỗ.

- Một bước = một mục đích = tự build và tự pass.
- Giữ diff đúng phạm vi. Dọn dẹp không liên quan là một thay đổi riêng, không được tràm vào.
- Giữ tương thích ngược cho mọi thứ đã có người dùng, hoặc nói to breaking change.
- **Không để lại giàn giáo.** Không file tạm, không block code bị comment, không log debug. Xóa thứ bạn dùng để làm xong việc.
- Thấy thứ khác đang hỏng: **báo cáo**, đừng sửa lặng lẽ và đừng giả vờ không thấy.

## 5. Chứng minh, rồi mới báo cáo

Tại sao: "chắc là chạy rồi" là nguồn của mọi bug lọt xuống production. Người dùng không kiểm tra lại lời bạn — họ tin, và lần đầu bạn sai là lần cuối họ tin.

**Bằng chứng, hoặc là chưa xảy ra.** Không được nói "nó chạy rồi", "chắc ổn", "đã fix" mà không có lệnh đã chạy và kết quả bạn đã thấy.

Chạy từ hẹp tới rộng: test cụ thể → typecheck → lint → full suite → build.

Script của skill nằm **cạnh file `SKILL.md` này**, không phải ở đường dẫn tuyệt đối. Lấy
đường dẫn từ vị trí file bạn đang đọc:

```bash
# <skill-base> = thư mục chứa SKILL.md. Đổi lệnh này nếu skill nằm ở chỗ khác.
SKILL_BASE="$(dirname "$(find . -name SKILL.md -path '*software-engineer*' | head -1)")"

node "$SKILL_BASE/scripts/verify.mjs"                    # tìm và chạy gate thật của dự án
node "$SKILL_BASE/scripts/verify.mjs" --changed          # chỉ gate của package bị diff chạm
node "$SKILL_BASE/scripts/smells.mjs" --changed          # quét diff tìm nợ kỹ thuật cơ học
node "$SKILL_BASE/scripts/smells.mjs" --changed --strict # thêm `any`, non-null assert, dòng dài
```

Đừng hardcode một đường dẫn tuyệt đối và mong nó còn đúng: skill được cài vào `.agents/skills/`,
`.claude/skills/`, hay cache của OpenCode — mỗi nơi một vị trí, và một đường dẫn tuyệt đối
sai nghĩa là skill hỏng sau khi cài.

Trong monorepo, `--changed` là bắt buộc: chạy full suite của 200 package để sửa một dòng nghĩa
là tự tạo lý do bỏ qua verification. Trong CI, dùng `--format json|sarif|github` để kết quả
lên được đúng chỗ. Chi tiết: `references/ci-integration.md`.

Khi một finding là thật mà bạn vẫn giữ, suppress **đúng rule đó** và ghi lý do ngay tại dòng đó.
Một allow không có `-- reason` cũng bị báo, vì suppression không ai giải thích được chính là
một rule đã bị xóa:

```ts
const key = process.env.API_KEY // smells:allow env-default-secret -- platform team owns this, PLAT-4821
```

Hai script này là **lưới an toàn**, không phải bộ phận giám định. Chúng bắt được ~20% cái sai (marker, secret, exception bị nuốt, test bị tắt) và **không bắt được** phần còn lại — abstraction sai, logic đúng nhưng ý sai, dữ liệu hỏng khi scale, lỗ hổng đến từ ý định chứ không phải pattern. Phần đó nằm ở mục 6 và trong `references/anti-patterns.md`. Chạy script xanh **không** phải bằng chứng hoàn thành.

Báo cáo lệnh đã chạy và đúng những gì nó in ra, kể cả lỗi. Gate không tồn tại ở đây thì báo là **chưa verify**, không phải là pass. Test fail = chưa xong: sửa nguyên nhân, không nới test. Test fail sẵn có = phát hiện cần báo, không phải thứ để chôn.

## 6. Thứ không công cụ nào bắt được

Đây là phần quan trọng nhất. Mọi script chỉ so khớp chuỗi; lỗi nguy hiểm nhất thì không có chuỗi nào để so. Chúng được tìm ra bằng cách **đọc và suy luận**. Bảng dưới là các lỗi phổ biến nhất trong một repo; mỗi miền có bảng riêng, đầy đủ hơn:

| Lỗi | Vì sao script không thấy | Cách phát hiện |
| --- | --- | --- |
| **Abstraction sai** | Code đúng, chạy, chỉ là ở tầng/lớp sai | Hỏi: ai là người được hỏi khi thay đổi behavior này? Không ai → abstraction sai. |
| **Logic đúng, ý sai** | Không có syntax nào cho biết requirement là gì | Đọc lại requirement, đi từng nhánh hỏi "nhánh này phục vụ điều gì?" |
| **Test đúng nhưng sai chỗ** | Test pass, coverage xanh, hành vi chưa được bảo vệ | Hỏi: test này fail khi xóa feature? Hỏi: nó khẳng định contract hay chỉ implementation? |
| **Hỏng khi scale** | 10 bản ghi thì đúng | Luôn nghĩ về N: N+1 query, pagination, N+1 connection, cache không bound. |
| **Hỏng khi đồng thời** | Test tuần tự đều xanh | Hỏi: hai request đến cùng lúc thì sao? Có idempotency key không? |
| **Hỏng khi chạy thật** | Dev máy 8 nhân, production 2 nhân | Hỏi: cấu hình ở đây có đúng như production không? |
| **Lỗ hổng từ ý định** | Regex secret không thấy "endpoint này leak PII của user khác" | So quyền: mọi boundary có authN + authZ? Dữ liệu trả về có đúng mức cần? |
| **Drift giữa docs và code** | Cả hai đều "chạy" | Sau mỗi thay đổi: cái gì trong docs giờ sai? |
| **Hỏng khi có người thứ hai** | Đúng với một người, sai khi đồng thời có người khác sửa | Ai đang sở hữu path này? Ai review được? |
| **Rò dữ liệu chéo tenant** | Không có pattern nội bộ nào lộ ra | Mọi query, cache key, log có tenant id không? |

Nguyên tắc chẩn đoán: **mọi thứ mà câu hỏi "làm sao tôi biết nó đúng?" không trả lời bằng một lệnh, đều cần đọc thêm.** Đừng dừng lại ở chỗ script xanh. Bản checklist mở rộng theo từng miền: `references/scale-and-architecture.md`, `references/compliance-and-data.md`.

## 7. Non-negotiables

Mỗi dòng ở đây có một câu chuyện đằng sau; đọc cột phải trước khi phá.

| Rule | Why |
| --- | --- |
| Không để `TODO`/`FIXME`/`HACK`/`temp` không chủ và không issue | Nợ có tên thì quản được. Nợ ghi "later" thì thối và chôn người sau. |
| Không placeholder trong đường chạy thật: `return null`, thân rỗng, fake data, feature nửa vời | Contract đã hứa với caller. Hoặc làm xong, hoặc đừng expose. |
| Không code không giải thích được. Comment nói **tại sao**, không phải **làm gì** | "IDK but it works" là quả mìn có đuôi. |
| Không copy-paste. Lần thứ ba thì trừu tượng hoá | Nhân bản nhân mọi bug tương lai lên N. |
| Không kết quả bịa, không output tưởng tượng | Trust là sản phẩm. Mất một lần là mất hết. |
| Không đổi scope lặng lẽ, không rename đột ngột | Bất ngờ là phần đắt nhất, không phải phần kỹ thuật. |
| Không secret, không dữ liệu thật — kể cả trong log và fixture | Lọt rồi là không hoàn tác được. |
| Không god file, không vi phạm layer, không import cycle | Spaghetti không được cứu bởi việc nó chạy. |
| Không thay đổi dữ liệu, quyền, tiền, hay config dùng chung mà không nói rollback | Ở quy mô lớn, thay đổi đó không chỉ là của bạn — nó là của hàng trăm người đang dùng hệ thống. |
| Không tự sửa code của đội khác, không sửa CODEOWNERS để lách review | Đội sở hữu một path là đội trực on-call của nó. Bạn lách review là bạn gánh hậu quả cho họ. |

## 8. Bug

Reproduce bằng lệnh tất định → viết test fail → truy nguyên tới nguyên nhân gốc, phát biểu giả thuyết trong một câu → sửa **nguyên nhân**, giữ test hồi quy → verify và giải thích nguyên nhân trong hai câu.

Vá triệu chứng (`thử cái này`, `thêm null check ở đây`) không phải fix cho tới khi nguyên nhân được chứng minh. Vì sao: vá triệu chứng che mất tín hiệu, và bug quay lại dưới lớp áo khác.

Không sửa bug mà bạn không reproduce được và không giải thích được. Báo cáo điều bạn biết, điều bạn đã loại trừ, và điều bạn cần.

## 9. Test đúng thứ

Bug → test hồi quy. Behavior public mới → test cho behavior đó, kể cả nhánh lỗi. Trivial thì không test. Tất định: không network thật, không clock thật, không `sleep`, không phụ thuộc thứ tự, không state dùng chung. Assert vào behavior, không vào thứ tự lời gọi nội bộ. Fake biên chậm và không ổn định — **không bao giờ fake thứ đang được test**.

Vì sao test sai chỗ vẫn xanh: nó xanh vì nó không hỏi gì cả. Policy đầy đủ: `references/testing-guide.md`.

## 10. Docs là một phần của thay đổi

Vì sao docs sai còn nguy hiểm hơn docs thiếu: nó làm người mới tin sai và đi theo hướng sai. Cập nhật README, API doc, ví dụ, `.env.example` mà thay đổi của bạn làm sai — ngay trong thay đổi đó, không phải ticket sau. Xóa comment thuần túy tự tán. Changelog entry nếu dự án có.

## 11. Bàn giao

Đọc lại diff của chính mình như đang review PR của người khác — theo
`references/review-playbook.md`, không phải theo cảm giác — rồi chạy
`references/dod-checklist.md`. Ô nào chưa tick thì hoặc sửa, hoặc báo.

```text
What changed      - mô tả behavior, không phải liệt kê file
Files             - path, gom theo mục đích
Design            - hợp đồng đã chọn và vì sao chọn nó thay vì phương án khác
Verification      - lệnh cụ thể + đúng những gì nó in ra
Not done / risks  - nợ hoãn, vùng chưa verify, rủi ro còn lại
Decisions needed  - điều người dùng phải chọn
```

Báo lỗi thẳng thắn. "Cái này hỏng, và đây là lý do" là kết quả tốt. Một câu khẳng định sai làm hỏng niềm tin vào **mọi** câu trả lời sau đó.

## Ngôn ngữ

Thẳng, cụ thể, không tán tỉnh. Sự thật kèm nguồn. Tách rõ cái gì đã verify, cái gì là suy luận, cái gì chưa biết. Không xin lỗi, không kể lại quá trình của bản thân, không rào "bạn cần gì thêm".

## Bản đồ tham chiếu

Đọc theo tình huống, không đọc hết. Mỗi file có điều kiện lọc riêng; đọc sai file tốn thời
gian hơn là không đọc.

| File | Dùng khi |
| --- | --- |
| `references/discovery-playbook.md` | Repo lạ: thứ tự khám phá, tìm seam, evidence table |
| `references/enterprise-standards.md` | Repo nhiều người dùng: CODEOWNERS, chuẩn công ty, ADR/RFC, branch protection, release train |
| `references/stack-commands.md` | Lệnh gate thật theo từng ecosystem |
| `references/ci-integration.md` | Cắm script vào pipeline, đọc exit code, config dùng chung cho repo |
| `references/plan-template.md` | Mẫu plan T2/T3/T4, xử lý plan drift |
| `references/design-guide.md` | Boundary, contract, data, migration, security |
| `references/scale-and-architecture.md` | Monorepo, service, event, multi-tenant, concurrency, rollout/rollback |
| `references/migration-and-legacy.md` | Code cũ không test, strangler fig, expand-contract, migration dữ liệu, API versioning |
| `references/compliance-and-data.md` | PII, phân quyền, audit trail, retention, SBOM, provenance, change control |
| `references/testing-guide.md` | Test cái gì, test double, CI gate, suite đỏ |
| `references/anti-patterns.md` | Smell cần phán đoán — thứ regex không bắt được |
| `references/git-workflow.md` | Commit, branch, PR, secret, khôi phục history |
| `references/review-playbook.md` | Review của người khác và tự review trước khi bàn giao |
| `references/dod-checklist.md` | Definition of Done + mẫu bàn giao |
