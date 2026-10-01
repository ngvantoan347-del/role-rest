# Stack Commands

Các gate thật theo từng ecosystem.

**Quy tắc trên hết: config của dự án thắng.** `scripts` trong `package.json`, CI workflow,
hoặc `Makefile` là nguồn sự thật — không phải bảng dưới đây. `node "$SKILL_BASE/scripts/verify.mjs"`
phát hiện chúng; bảng này để bạn biết **nên tìm gì**.

`SKILL_BASE` là thư mục chứa `SKILL.md`; mục 5 của `SKILL.md` nói cách lấy nó. Đừng hardcode
đường dẫn tuyệt đối: skill được cài vào `.agents/skills/`, `.claude/skills/`, hay cache của
OpenCode, mỗi nơi một vị trí.

Không bịa lệnh rồi báo kết quả. Nếu dự án không có linter, hãy nói không có — đừng giả vờ
lint pass.

## Thứ tự tìm

1. CI config — `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`.
   **CI chạy gì thì "xanh" nghĩa là gì.**
2. `package.json` scripts, `Makefile`, `justfile`, `Taskfile.yml`.
3. `pyproject.toml` / `tox.ini` / `noxfile.py`, `Cargo.toml`, `go.mod`, `composer.json`,
   `Gemfile`, `build.gradle`, `*.csproj`, `Rakefile`.

Cần phải biết gate **chạy bao lâu**. Trong monorepo lớn, full suite có thể 20 phút — chạy
nó mỗi lần sửa một dòng là tự tạo ra lý do bỏ qua verification.

## JavaScript / TypeScript

| Gate | Lệnh |
| --- | --- |
| typecheck | `npx tsc --noEmit` |
| lint | `npm run lint` (eslint / biome) |
| format check | `npx prettier --check .` |
| test | `npm test` |
| build | `npm run build` |
| audit | `npm audit --omit=dev` |
| deps thừa | `npx depcheck` |

```bash
# thường khớp với CI
npm run lint && npx tsc --noEmit && npm test
```

Kiểm tra thêm: `strict` trong `tsconfig.json`, lockfile đã commit, `engines` khớp runtime,
`any` không tích tụ trong public signature.

## Python

| Gate | Lệnh |
| --- | --- |
| lint | `ruff check .` hoặc `flake8 .` |
| format | `ruff format --check .` hoặc `black --check .` |
| typecheck | `mypy .` (strict) |
| test | `pytest -q` |
| coverage | `pytest --cov --cov-report=term-missing` |
| deps | `pip-audit` hoặc `safety check` |

```bash
ruff check . && ruff format --check . && mypy . && pytest -q
```

## Go

```bash
gofmt -l .            # output khác rỗng = sai format
go vet ./...
go build ./...
go test -race -cover ./...
```

`-race` đáng bỏ thời gian: nó bắt được lỗi mà test tuần tự không thấy, đúng nhóm lỗi
"chạy thì hỏng" trong bảng ở SKILL.md. Thêm: error phải bọc `%w` chứ không nuốt, context
phải được truyền hết, và mọi goroutine cần đường shutdown rõ ràng.

## Rust

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo audit        # hoặc cargo deny check
```

## Java / Kotlin

```bash
./gradlew build          # compile + test + lint
./gradlew check          # test + static analysis
./gradlew spotlessCheck  # hoặc ktlint
```

## C / C++

```bash
clang-format --dry-run -Werror .
cmake --build build --target all
ctest --test-dir build --output-on-failure
```

Nếu project bật sanitizer, hãy chạy — chúng tìm bug mà test bỏ sót.

## SQL

```bash
sqlfluff lint .
your-db-migrate --dry-run     # dry run trên database sạch
```

Không bao giờ apply migration lên database thật để "xem có chạy không".

## Docker / infra

```bash
docker build -t test .
docker run --rm test          # image có thực sự start được không?
docker compose config         # compose file có hợp lệ không?
```

Một Dockerfile build ra image không start được thì chưa xong. Tương tự: Terraform apply
trên workspace thật thì chưa xong — `plan` thôi.

## Shell

```bash
shellcheck script.sh
bash -n script.sh
```

## Monorepo

- Chạy gate cho **package bị ảnh hưởng**, không phải cả cây, rồi xác nhận phía dưới không hỏng.
- Sau mỗi thay đổi package, kiểm tra lockfile và graph phụ thuộc: `pnpm list --depth 1`, `npm ls`.
- Script workspace thường đã có lời gọi đúng (`pnpm -F pkg test`).

## Báo cáo

Nêu lệnh và kết quả **thật**:

```text
Verification
- `npx tsc --noEmit`  -> sạch, 0 lỗi
- `npm test`          -> 42 pass, 2 fail (cả hai có trước, xem bên dưới)
- `npm run build`     -> dist/ build trong 3.1s
- `npm run lint`      -> dự án này không cấu hình
```

Đó là đáng tin. "Test pass" thì không, và im lặng về gate đã bỏ qua cũng không.
