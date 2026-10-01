# CI Integration

Hai script đi kèm skill này được viết để chạy **trong CI của công ty**, không chỉ trên máy
lập trình viên. Trang này là phần nối: cách cắm chúng vào pipeline, cách đọc exit code, và
những chỗ dễ cắm sai.

Vì sao file này tồn tại: script chạy được trên laptop nhưng hỏng trong CI thì chỉ tệ hơn
không có script — nó biến một gate thành pass giả. Nguyên nhân phổ biến nhất là hiểu sai
`MISSING` là `PASS`, và là copy lệnh mà không chạy thử trên cùng image.

Điều kiện lọc: chỉ phần liên quan tới hai script này. Cách tổ chức pipeline, branch
protection, release train nằm ở `references/enterprise-standards.md`.

## Exit code là contract

Đọc đúng bảng này. Nếu bạn map `2` thành `success`, bạn đã tự tạo ra một gate không tồn tại.

| Script | Code | Nghĩa là gì | Trong CI |
| --- | --- | --- | --- |
| cả hai | `0` | Trong ngân sách | Xanh |
| `verify` | `1` | Có gate fail | Đỏ — đúng mục đích |
| `smells` | `1` | Có error, **hoặc** vượt `--max-warnings` | Đỏ |
| `verify` | `2` | Không phát hiện được gate nào để chạy | Đỏ. Đây không phải pass |
| cả hai | `2` | Dùng sai flag, config hỏng, rule pattern hỏng | Đỏ — lỗi cấu hình |
| `verify` | `3` | Sai `--format` | Đỏ |

Điểm dễ sai nhất: `verify` trả `2` khi repo không có lệnh nào để chạy. Một repo không có
linter là quyết định của ai đó; một repo mà script **không tìm thấy** linter thì là lỗi cấu
hình. Đừng gộp hai trường hợp đó, và đừng để CI coi `2` là xanh.

## Ba nơi cắm

| Nơi | Lệnh | Vì sao ở đó |
| --- | --- | --- |
| Pre-commit | `smells.mjs --staged` | Rẻ, chạy mili giây, chặn secret và test bị tắt trước khi nó tồn tại trong history |
| Required check mỗi PR | `verify.mjs --changed` + `smells.mjs --changed --base origin/main` | Đây là định nghĩa "xong" mà mọi người thực sự bị chặn |
| Nightly / main | `verify.mjs` (không `--changed`) | Toàn bộ workspace, bắt được package bị bỏ sót bởi bản đồ affected |

Cột "Vì sao" quan trọng hơn trực giác: `--changed` ở PR và full ở main là hai lớp khác
nhau. Chỉ có `--changed` thì một lỗi mapping package sẽ sống mãi; chỉ có full thì không ai
chạy được vì quá chậm. Cần cả hai.

## GitHub Actions

```yaml
- name: Gate
  run: |
    node .opencode/skills/software-engineer/scripts/verify.mjs --changed --format github
    node .opencode/skills/software-engineer/scripts/smells.mjs --changed \
      --base origin/${{ github.base_ref }} --max-warnings 20 --format github
```

`--format github` in ra workflow command (`::error file=...,line=...`) nên finding hiện thẳng
trên tab **Checks**, đúng dòng. Bỏ `--base` và nó chỉ so với `HEAD` — tức là PR 400 dòng bị
quét rỗng và xanh.

Nếu dùng Code scanning, `smells.mjs --format sarif` ra SARIF 2.1.0 để upload; `verify.mjs
--format sarif` cũng có, để gate thiếu hiện thành warning thay vì im lặng.

```yaml
- run: node .../smells.mjs --changed --format sarif > smells.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: smells.sarif }
```

## GitLab CI

```yaml
gate:
  script:
    - node .opencode/skills/software-engineer/scripts/verify.mjs --changed
    - node .opencode/skills/software-engineer/scripts/smells.mjs --changed --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
  artifacts:
    when: always
    paths: [smells.json]
    expire_in: 1 week
```

Đổi script thành SARIF nếu GitLab của công ty có bật code quality. Artifact giữ lại kết
quả để debug pipeline đã xoá.

## Điều kiện để script cho kết quả đúng

Ba thứ này là nguyên nhân của mọi lần script "xanh một cách sai".

1. **Cùng image với pipeline.** Node ở đây phải là node ở đó. Khác version là khác toolchain
   và khác kết quả, và bạn sẽ debug sai thứ.
2. **Toolchain đã cài, chưa cài tối thiểu.** Script không cài gì cả. Trong container sạch,
   `cargo` hay `go` có thể không có; đó là lỗi setup, không phải kết quả verify. Cài dependency
   ở step trước, và nếu cố tình bỏ qua thì báo `MISSING`, đừng giả vờ pass.
3. **`fetch` đủ depth.** `verify.mjs --changed` cần `origin/main` để tính diff. Checkout mặc
   định của GitHub Actions là shallow 1 commit, nên `merge-base` không có gì để so — script
   rơi về "không có base" và báo quét 0 file. Sửa bằng `fetch-depth: 0`.

Điểm 3 là cái âm thầm nhất: script chạy, exit 0, không quét gì cả. Nếu pipeline của bạn dùng
shallow checkout, hãy kiểm tra nó **một lần** bằng cách cố tình làm hỏng một file trong PR và
xem script có bắt không.

## Config dùng chung cho cả repo

Commit `.software-engineer.json` ở root, cùng file cho cả hai script:

```json
{
  "verify": {
    "gates": { "test": ["npm", "run", "test:ci"] },
    "ignore": ["packages/legacy-*"],
    "timeout": 900000
  },
  "smells": {
    "ignore": ["packages/legacy-*/**"],
    "maxWarnings": 0,
    "rules": [
      {
        "id": "internal-legacy-client",
        "severity": "error",
        "pattern": "\\bv1_legacy_client\\b",
        "message": "the legacy client is decommissioned; use @internal/sdk v2"
      }
    ]
  }
}
```

Vì sao để rule của công ty ở file này thay vì fork `smells.mjs`: rule đó là chính sách của bạn,
nó đổi theo chính sách, và nó phải review được như mọi thay đổi khác. Fork script là cách
đảm bảo nó lệch với policy sau hai sprint.

`disable` và `severity` dùng khi công ty đã có linter riêng làm việc đó: `disable` bỏ hẳn,
`severity` hạ xuống `warn` để vẫn thấy mà không chặn build.

## Pre-commit hook

```bash
#!/usr/bin/env sh
node .opencode/skills/software-engineer/scripts/smells.mjs --staged --max-warnings 999 || exit 1
```

`--max-warnings 999` ở hook là có chủ ý: chặn error ngay, còn warning thì để cho commit đi
vì hook chạy trên mọi commit và một warning đủ để khiến cả team bỏ qua nó. Budget thật đặt ở
CI. Không dùng `--no-verify` để né nó — đó là điều tự ghi vào non-negotiables của skill.

## Khi script không phù hợp repo

Nếu script không tìm được gate trong repo của bạn, **cấu hình nó** bằng `gates` trong config,
hoặc bỏ qua và chạy lệnh thật của CI. Đừng viết `|| true` để làm nó xanh: đó là cách nhanh
nhất để biến một gate thành trang trí, và nó sẽ sống lâu hơn mọi ticket kỹ thuật bạn đang
mở.

## Câu hỏi tự kiểm trước khi tin CI

- Nếu bỏ toàn bộ thay đổi của tôi, script có còn xanh không? Nếu có, nó đang không soát
  thứ cần soát.
- Tôi đã thấy nó đỏ chưa, hay chỉ thấy nó xanh? Một gate chưa từng fail là một gate chưa
  được kiểm chứng.
- Số file nó báo đã quét có khớp với số file trong diff không? Lệch là scope đang sai.