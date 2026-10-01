# Git Workflow

Git là trí nhớ của dự án. Những quy tắc dưới giữ history đọc được, thay đổi đảo ngược
được, và secret ở ngoài nó.

## Trước khi stage

`git status` và `git diff`, **mọi lần**, trước **mọi** lần stage. Không bao giờ commit thứ
bạn chưa đọc. Xác nhận đúng branch. Quét diff tìm `.env`, credential, token, key, dữ liệu
user thật, URL nội bộ có mật khẩu nhúng. Giữ build output và dependency ngoài commit.

## Branch và commit

- Một branch cho một đơn vị công việc. Một commit cho **một concern** — commit làm hai việc
  thì chỉ revert được tất cả hoặc không gì.
- **Mỗi commit để lại cây làm việc được**: compile được, test pass. Commit để lại `main`
  hỏng là một sự cố release đang chờ deploy.
- Tách refactor khỏi thay đổi behavior. Trộn chúng làm diff không review được và
  revert không an toàn.
- Message: subject dạng mệnh lệnh dưới ~72 ký tự, dòng trống, rồi phần **tại sao**.
  Message chỉ lặp lại diff là message thiếu.

```text
fix(order): reject orders placed after the cutoff

The cutoff was compared against request time instead of created_at, so a
delayed request could place a stale order. Compare against created_at and
add a regression test for a 23:59 order.
```

Đọc message như một mục changelog. Đó là mục đích của format này.

## Không bao giờ

- `git commit -a` hoặc `git add .` khi chưa đọc status và diff.
- Commit secret hay credential thật. Nếu nó lỡ vào, **rotate ngay** và coi là đã lộ.
- Force-push branch dùng chung, hoặc viết lại history đã public. Chỉ rebase commit chưa ai
  lấy.
- Amend hoặc squash commit của người khác.
- `--no-verify` để né hook đang fail.
- `git checkout .` / `restore .` để huỷ thay đổi bạn chưa kiểm tra.

## Khôi phục

```bash
git reflog                    # tìm commit tưởng mất
git reset --soft HEAD~1       # undo commit, giữ thay đổi ở staged
git restore --staged <path>   # bỏ stage
git revert <sha>              # undo an toàn, có audit trail, cho đã push
```

Việc mất thường **gần như luôn** khôi phục được. Hãy kiểm tra trước khi kết luận là mất,
và ưu tiên `revert` cho mọi thứ đã publish.

## Pull request

PR là **artifact để review**, không phải thông báo. Đủ nhỏ để đọc trong một lần ngồi —
400 dòng đã là nhiều.

```text
<type>(<scope>): <cái gì đổi>

Why             <vấn đề, link issue>
What            <thiết kế, và quyết định nào quan trọng>
Verification    <lệnh> -> <kết quả>, cho từng gate
Risk/rollback   <cái gì có thể hỏng, phát hiện ra sao, undo thế nào>
Out of scope    <cái gì cố ý không làm>
```

Chỉ ra thứ reviewer **phải** soi kỹ: security, data, concurrency. Kèm screenshot hoặc
trace cho thay đổi UI và log. Khi review yêu cầu sửa: sửa hoặc giải thích — đừng âm thầm
viết lại PR.

## Release

- Sem versioning trung thực. Breaking API change là major **kể cả khi cảm thấy nhỏ**.
- Changelog trong cùng thay đổi làm thay đổi behavior.
- Tag đúng commit được release. Build **từ tag**, không bao giờ từ branch tip.
- Release notes viết cho người dùng: cái gì đổi, cái gì vỡ, cần làm gì.

## History sẵn có của người dùng

- Đừng viết lại, format lại, hoặc sắp xếp lại history bạn không được yêu cầu đụng tới.
- Nếu cây làm việc đã có thay đổi chưa commit trước khi bạn bắt đầu, hãy tôn trọng và
  nói ra chúng.
- Khi xong việc, để lại cây sạch: không file rác, không branch thừa, không gì ở trạng
  thái nửa stage.
