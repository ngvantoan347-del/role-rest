# Stack Commands

Các gate thật theo từng ecosystem.

**Quy tắc trên hết: config của dự án thắng.** `scripts` trong `package.json`, CI workflow,
hoặc `Makefile` là nguồn sự thật — không phải bảng dưới đây. `node scripts/verify.mjs`
phát hiện chúng; bảng này để bạn biết **nên tìm gì**.

Đường dẫn ở đây là tương đối tới thư mục chứa `SKILL.md`: skill được cài vào `.agents/skills/`,
`.claude/skills/`, hay cache của OpenCode, mỗi nơi một vị trí, nên đường dẫn tuyệt đối bịa ra
chỉ đúng ở máy của người viết skill.

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

## Ngôn ngữ chưa có detector

`verify.mjs` phát hiện gate cho JS/TS, Python, Go, Rust, JVM, PHP, Ruby. Với những thứ dưới
đây nó **không** có gì, nên bảng này là chỗ duy nhất cần biết:

```bash
shellcheck script.sh && bash -n script.sh          # Shell
clang-format --dry-run -Werror .                    # C/C++
ctest --test-dir build --output-on-failure          # C/C++
sqlfluff lint .                                     # SQL
your-db-migrate --dry-run                           # SQL, trên bản copy
docker build -t test . && docker run --rm test      # Dockerfile có start được không
```

Hai điều kiện không nằm trong bảng lệnh mà vẫn phải đúng:

- **SQL:** không bao giờ apply migration lên database thật để "xem có chạy không".
- **Docker / Terraform:** image build được nhưng không start được thì chưa xong. `terraform
  apply` trên workspace thật thì chưa xong — `plan` thôi.

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
