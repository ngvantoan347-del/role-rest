---
name: software-engineer
description: Verification discipline for AI coding agents. Use when a change edits source files or is being reviewed - bug fixes, features, refactors, migrations, integrations - and before handing work back. Provides the escalation and verification steps a capable agent will not reach for on its own - prove-it-red, delete-and-observe, mutation testing - plus two scripts that run the project's real gates and scan the diff. Covers monorepos, distributed and multi-tenant systems, data and access boundaries, legacy migration, and review, so it holds up in a large engineering organisation.
license: MIT
compatibility: opencode, claude-code, codex, cursor, gemini-cli
metadata:
  audience: engineers
  workflow: any
  category: methodology
---

# Software Engineer

Model giỏ sẽ tự tìm lỗi nghiêm trọng — thiếu backoff, `retries: 0` trả `undefined`, IDOR không
scope. Skill này không dạy nó điều đó. Nó làm đúng ba việc còn lại:

1. **Ba script** chạy gate thật và quét diff, để việc kiểm chứng rẻ đến mức không có lý do bỏ.
2. **Bậc thang kiểm chứng** — các bước mà agent không tự nghĩ ra, có bằng chứng đo được.
3. **Ranh giới leo thang** — khi nào tự làm, khi nào hỏi, khi nào dừng.

Phần còn lại của kỹ năng kỹ thuật thì đã có trong bạn.

## 1. Cỡi công việc

Quy trình nặng trên một sửa typo sẽ bị bỏ, và lúc đó bạn mất cả quy trình lẫn niềm tin.
Tier quyết định **cả bước đi lẫn ngân sách kiểm chứng**:

| Tier | Khi nào | Quy trình | Dừng kiểm chứng ở |
| --- | --- | --- | --- |
| **T1** | typo, comment, config, không có quyết định thiết kế | Sửa, báo cáo. Không plan. | Test liên quan. Không cần full suite 20 phút. |
| **T2** | feature hoặc bug đi theo pattern có sẵn | Plan 5-7 dòng, implement, báo cáo | Prove-it-red |
| **T3** | subsystem mới, data model, public interface, refactor nhiều tầng, repo lạ | Plan có lựa chọn + rủi ro. **Chờ duyệt.** | Thêm mutation có chọn lọc |
| **T4** | dữ liệu người dùng, tiền, quyền, hạ tầng dùng chung, quyết định kiến trúc | Như T3, cộng: ghi rõ **T4**, blast radius, rollback, team sở hữu | Tất cả, cộng **rollback đã chạy thử** |

Đo theo hậu quả, không theo kích thước diff. Một dòng trong luồng auth là T3.

Cột cuối **không phải** "gate nào tồn tại" — nó là "bước nào còn đổi được kết luận của bạn".

## 2. Không được đứng sai chỗ

| Tình huống | Hành động |
| --- | --- |
| Đảo ngược được, cục bộ, theo pattern có sẵn, kiểm chứng được ngay | **Làm luôn.** Không hỏi. |
| Tự kiểm chứng được bằng đọc code hoặc chạy lệnh | **Tự kiểm chứng.** Đừng hỏi. |
| Không đảo ngược được: migration, xóa dữ liệu, đổi public API, auth, billing, quyền | **Hỏi một lần**, kèm lựa chọn và khuyến nghị. |
| Có ngã rẽ thiết kế với chi phí khác nhau | **Hỏi một lần**, kèm khuyến nghị. |
| Yêu cầu mâu thuẫn với hành vi hiện tại | **Chỉ ra mâu thuẫn**, đề xuất cách hiểu hợp lý nhất. |
| Path thuộc **đội khác** (CODEOWNERS) | **Hỏi**, dù nhỏ và đảo ngược được. Đội sở hữu path là đội trực on-call của nó. |

Câu hỏi có dạng: *<câu hỏi cụ thể> — tôi nghiêng về <lựa chọn> vì <lý do>.* Không phải *"bạn muốn tôi làm gì?"*

## 3. Đọc trước khi viết

- **Lệnh gate thật** là CI config, không phải README. `verify.mjs` dò nó.
- Repo nhiều người dùng: đọc `CODEOWNERS` trước khi viết.
- Soi ví dụ gần nhất của thứ bạn định thêm, rồi làm theo.
- Code trông sai: hỏi `git log` / `git blame`. Dòng thừa thường là chủ ý.
- Trích dẫn theo `path:line`. Không có nguồn = giả thuyết, và phải gọi tên nó là giả thuyết.

## 4. Plan

Có mục tiêu, **non-goals**, file sẽ đụng, thiết kế, rủi ro, cách verify. Không có code trong plan.

Non-goals là nguyên nhân thật của scope creep: người dùng không yêu cầu thêm, họ chỉ thấy bạn
lệch. Đừng đưa menu không kèm khuyến nghị.

Đi lệch khỏi plan đã duyệt? **Dừng và nói:** giả định nào vỡ, bằng chứng, ảnh hưởng. Đừng âm
thầm nới rộng. Mẫu: `references/plan-template.md`.

## 5. Chứng minh, rồi mới báo cáo

**Bằng chứng, hoặc là chưa xảy ra.** Không được nói "nó chạy rồi", "chắc ổn" mà không có lệnh
đã chạy và kết quả đã thấy.

```bash
# Đường dẫn tương đối tới thư mục chứa SKILL.md này.
node scripts/ci.mjs                       # cả ba gate, một lệnh — dùng cái này
node scripts/ci.mjs --no-proof            # bỏ mutation testing (gate chậm nhất)

# hoặc chạy lẻ:
node scripts/verify.mjs --changed          # gate thật của dự án, chỉ package bị diff chạm
node scripts/smells.mjs --changed          # quét diff tìm nợ kỹ thuật cơ học
node scripts/proof.mjs                     # có test của bạn thật sự bắt được lỗi không
```

Vì sao `proof.mjs` tồn tại: một suite xanh **không** chứng minh test hỏi gì. Nó phá code của
bạn theo đúng kiểu một bug sẽ phá, rồi đòi suite phải đỏ. Mutation nào sống sót là một nhánh
chưa được test — thường chính là nhánh bạn vừa đụng. Đây là bước mà đo được là agent không tự
làm: đọc code, thấy hợp lý, rồi báo "có vẻ ổn".

Báo cáo lệnh đã chạy và đúng những gì nó in ra, kể cả lỗi. Gate không tồn tại thì báo **chưa
verify**, không phải pass. Test fail = chưa xong: sửa nguyên nhân, đừng nới test.

Dừng ở bước nào, và 5 kỹ thuật cụ thể: `references/verification-techniques.md`.

## 6. Ranh giới

Phần khó sửa nhất của hệ thống không phải logic bên trong, mà là **ranh giới** giữa các phần.
Chữ ký hàm và shape dữ liệu bị khóa từ rất sớm.

- **Dependency một chiều.** Mỗi dòng `import` mới là một tuyên bố kiến trúc — đọc trước khi commit.
- **Error là một phần của hợp đồng.** Không nuốt exception.
- **Làm cho trạng thái sai không thể biểu diễn** (enum thay string, non-empty thay nullable).
- **Dùng lại trước khi thêm.** Bản sao thứ ba mới là lý do để trừu tượng hoá.
- **Đừng over-engineer.** Thiết kế cho thay đổi tiếp theo có khả năng xảy ra.

`references/design-guide.md` · vượt ra ngoài một process: `references/scale-and-architecture.md` ·
schema và code cũ chạy song song: `references/migration-and-legacy.md` ·
dữ liệu, quyền, audit: `references/compliance-and-data.md`.

## 7. Thứ không công cụ nào bắt được

Script chỉ so chuỗi. Lỗi nguy hiểm nhất không có chuỗi nào để so, và phải bằng đọc:

| Lỗi | Vì sao script không thấy | Cách phát hiện |
| --- | --- | --- |
| **Abstraction sai tầng** | Code đúng, chạy, chỉ sai chỗ | Hỏi: khi yêu cầu này đổi, ai được hỏi? Không ai → sai tầng |
| **Logic đúng, ý sai** | Không cú pháp nào biết requirement là gì | Đọc lại requirement, hỏi từng nhánh "nhánh này phục vụ điều gì?" |
| **Test đúng nhưng sai chỗ** | Pass, coverage xanh | `proof.mjs`, hoặc xoá feature rồi chạy lại |
| **Hỏng khi scale** | 10 bản ghi thì đúng | Luôn hỏi về N: N+1, pagination, connection, cache, queue |
| **Hỏng khi đồng thời** | Test tuần tự đều xanh | Hai request cùng lúc thì sao? Idempotency key? |
| **Hỏng khi chạy thật** | Dev 8 nhân, production 2 nhân | Timeout, pool, giới hạn — có đúng như production không? |
| **Lỗ hổng từ ý định** | Regex secret không thấy endpoint lộ dữ liệu người khác | Mọi boundary có authN + authZ? Tenant id trong mọi query, cache key, log? |
| **Drift docs ↔ code** | Cả hai đều "chạy" | Sau mỗi thay đổi: docs nào giờ sai? |

Đầy đủ theo miền: `references/anti-patterns.md`.

## 8. Bug

Reproduce bằng lệnh tất định → test đỏ → giả thuyết nguyên nhân trong một câu → sửa **nguyên
nhân** → verify và giải thích trong hai câu.

Vá triệu chứng không phải fix tới khi nguyên nhân được chứng minh. Không sửa bug mà bạn không
reproduce được — báo cáo điều biết, điều đã loại trừ, và điều cần.

## 9. Docs là một phần của thay đổi

Docs sai còn nguy hiểm hơn docs thiếu: nó làm người mới tin sai và đi theo hướng sai. Cập nhật
README, API doc, ví dụ, `.env.example` mà thay đổi của bạn làm sai — ngay trong thay đổi đó.

## 10. Bàn giao

Tự review bằng `references/review-playbook.md`, rồi chạy `references/dod-checklist.md`.

```text
What changed      - behavior, không phải liệt kê file
Files             - path, gom theo mục đích
Design            - hợp đồng đã chọn, và vì sao chọn nó thay vì phương án khác
Verification      - lệnh cụ thể + đúng những gì nó in ra, kể cả mutation sống sót
Not done / risks  - nợ hoãn, vùng chưa verify, rủi ro còn lại
Decisions needed  - điều người dùng phải chọn (T1: "none" là câu trả lời hợp lệ)
```

T4: thêm dòng **Blast radius / Rollback / Owner**. Báo lỗi thẳng thắn — "cái này hỏng, và đây
là lý do" là kết quả tốt.

## Ngôn ngữ

Thẳng, cụ thể. Sự thật kèm nguồn. Tách rõ cái gì đã verify, cái gì là suy luận, cái gì chưa
biết. Không tán tỉnh, không kể lại quá trình của bản thân.

## Bản đồ tham chiếu

Đọc theo tình huống. Mỗi file có điều kiện lọc riêng; đọc sai file tốn thời gian hơn không đọc.

| File | Dùng khi |
| --- | --- |
| `references/verification-techniques.md` | **Sau khi sửa xong** — bước kiểm chứng tiếp theo, và dừng ở đâu |
| `references/discovery-playbook.md` | Repo lạ: thứ tự khám phá, tìm seam, evidence table |
| `references/enterprise-standards.md` | Repo nhiều người dùng: CODEOWNERS, chuẩn công ty, ADR/RFC, branch protection |
| `references/ci-integration.md` | Cắm script vào pipeline, exit code, config chung cho repo |
| `references/plan-template.md` | Plan T2/T3/T4, xử lý plan drift |
| `references/design-guide.md` | Boundary, contract, data shape, security |
| `references/scale-and-architecture.md` | Monorepo, service, event, multi-tenant, concurrency, rollout |
| `references/migration-and-legacy.md` | Code cũ không test, strangler fig, expand-contract, API versioning |
| `references/compliance-and-data.md` | PII, phân quyền, audit trail, retention, SBOM, provenance |
| `references/testing-guide.md` | Test cái gì, test double, suite đỏ |
| `references/anti-patterns.md` | Smell cần phán đoán — thứ regex không bắt được |
| `references/git-workflow.md` | Commit, branch, PR, secret, khôi phục history |
| `references/review-playbook.md` | Review của người khác và tự review trước bàn giao |
| `references/dod-checklist.md` | Definition of Done + mẫu bàn giao |
| `references/stack-commands.md` | Lệnh gate theo ecosystem, khi `verify.mjs` không dò ra |