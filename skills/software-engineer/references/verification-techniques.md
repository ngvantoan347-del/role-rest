# Verification Techniques

Bảng tra cứu: **khi nào dừng**, và **bước kiểm chứng tiếp theo nào đáng tiền nhất**.

Điều kiện lọc: chỉ giữ kỹ thuật mà một agent lành nghề **không tự nghĩ ra** khi đang làm việc
bình thường. Cái này đã được đo: trên các task review và fix bug, model đã tự tìm được các
lỗi nghiêm trọng (missing backoff, `retries: 0` trả `undefined`, off-by-one, IDOR không
scope). Nó không tự làm là **mutation testing** và **prove-it-red**. Vậy nên file này tập
trung vào những bước đó, không lặp lại những gì ai cũng làm.

## 0. Thang dừng

Đừng chạy tất cả. Chạy tới khi **bước cuối cùng không còn đổi kết luận**.

| Tier của việc | Dừng ở đâu | Vì sao dừng ở đó |
| --- | --- | --- |
| Sửa typo, comment, config | Chạy test liên quan, xong | Full suite 20 phút cho một dòng là tự tạo lý do bỏ qua verification ở lần sau |
| Bug fix trong một module | **Prove-it-red** → fix → xanh | Test hồi quy là thứ duy nhất ngăn bug đó quay lại |
| Behavior mới | **Prove-it-red** + mutation có chọn lọc | Bạn mới viết cả code lẫn test: chỉ một trong hai có thể sai cùng lúc |
| Sửa / review code của người khác | **Mutation test phần bạn đụng** | Bạn không viết test đó, nên bạn không biết nó bảo vệ cái gì |
| Tác động lên dữ liệu, tiền, quyền | Tất cả, cộng rollback đã chạy thử | Không có bước nào ở trên bắt được việc dữ liệu bị ghi sai |

## 1. Prove-it-red

Ghi test **trước**, chạy, nhìn nó đỏ, rồi mới sửa.

Vì sao đây là bước có giá trị cao nhất trong toàn bộ file: một test bạn viết *sau* khi sửa xong
gần như luôn xanh, vì bạn viết nó để khớp với cái bạn vừa làm. Test viết trước là thứ chứng
minh test có hỏi gì.

```bash
# 1. viết test, chưa sửa code
npm test 2>&1 | tail -5     # kỳ vọng: đỏ, và đúng lý do
# 2. sửa
npm test 2>&1 | tail -5     # kỳ vọng: xanh
```

Đỏ vì `SyntaxError` không phải prove-it-red. Đỏ vì assertion sai mới là.

## 2. Xóa-thả để test có hỏi gì không

Câu hỏi: **xoá feature này thì test có đỏ không?**

```bash
git stash            # hoặc: sửa tạm cho nhánh chết
npm test 2>&1 | tail -3
git stash pop
```

Vì sao: một test khẳng định `handleWebhook({})` trả `{ ok: true }` là xanh, và cũng xanh với
mọi thứ. Nó bảo vệ một hành vi **không ai muốn**. Cách rẻ nhất để thấy điều đó không phải đọc
test — là xoá code rồi chạy.

Đây là kỹ thuật rẻ nhất trong file, và là kỹ thuật agent hay bỏ nhất vì nó phá code.

## 3. Mutation test — bước mà agent không tự làm

Sửa code **sai có chủ ý**, xem test có đỏ không. Đỏ nghĩa là test giữ được; xanh nghĩa là test
không bảo vệ cái đó.

```bash
# mutant: nuốt lỗi thay vì ném lại
cp src/client.js /tmp/client.bak
# sửa: catch (e) { }  -- xoá dòng `if (i === retries - 1) throw e`
npm test 2>&1 | tail -3      # kỳ vọng: ĐỎ. Xanh nghĩa là đường lỗi không được test.
cp /tmp/client.bak src/client.js
npm test 2>&1 | tail -3      # xác nhận đã trả lại
```

Vì sao đây là bước quan trọng nhất ở đây, và là thứ đo được là model **không** tự làm: nó
đọc code, thấy hợp lý, rồi báo "có vẻ ổn". Không có mutant nào thì "có vẻ ổn" là cảm giác.
Đo được: trên một helper retry, mutant "nuốt lỗi" xanh hoàn toàn — tức là bản build mà mọi lỗi
đều bị báo là thành công vẫn pass toàn bộ suite.

Chọn mutant nào đáng tiền: lấy từ **nhánh lỗi** chứ không phải từ toàn bộ code. Xoá throw,
xoá `await`, đảo điều kiện, đổi `===` thành `!==`. 3-5 mutant trên phần bạn vừa đụng là đủ;
mutation toàn bộ codebase là một việc khác và đắt hơn nhiều.

## 4. Chạy code, không chỉ đọc

Với logic thuần tuý, một script thăm dè trả lời thứ đọc không trả lời.

```js
// `retries: 0` là gì? Chạy thay vì suy luận.
for (const n of [0, -1, 1, 3]) {
  const r = await call(() => { throw new Error('x') }, { retries: n })
  console.log(`retries=${n} ->`, r)
}
```

Vì sao: đây là cách tìm ra `retries: 0` resolve `undefined` mà không ném lỗi, và `retries: N`
nghĩa là N lần **thử** chứ không phải N lần **thử lại**. Cả hai đều là bug chỉ hiện khi chạy,
và cả hai đều bị một model đọc code bỏ qua.

## 5. So với người thật trong repo

Đừng hỏi "code này đúng không" — hỏi "repo này làm việc tương tự thế nào ở chỗ khác".

```bash
grep -rn "catch" --include='*.ts' src/ | head   # ở đây họ nuốt lỗi hay log?
grep -rn "retries" --include='*.ts' src/       # naming convention: attempts hay retries?
```

Vì sao: một implementation đúng nhưng lệch convention là một future incident — người sau đọc
hiểu sai vì mọi thứ xung quanh nói ngược lại.

## 6. Đo cái đo được

Khi có một con số, đo thay vì tranh luận. Với mọi thay đổi có tác động thời gian hoặc kích
thước:

```bash
time npm test                       # trước
# sửa
time npm test                       # sau
```

Vì sao: "nhanh hơn" không kiểm chứng được và không ai kiểm tra lại. `0.047ms cho 3 lần thử`
là con số có sức nặng; nó biến "không có backoff" từ nhận xét thành phát hiện.

## 7. Những thứ đo không được

Đừng chạy, vì chúng tốn thời gian mà không đổi quyết định:

| Kỹ thuật | Khi nào bỏ qua |
| --- | --- |
| Coverage % | Dùng nó để **tìm** nhánh chưa test, không phải để đạt một con số |
| Load test | Trước khi có số liệu cho thấy nút thắt |
| Full E2E | Thay đổi không chạm đường user quan trọng |
| Refactor cho "sạch hơn" | Không nằm trong phạm vi ticket |
| Thêm test cho code sẽ xoá | Nợ có hạn, không phải tài sản |

## 8. Khi nào bước kiểm chứng cuối cùng đã đủ

Dừng khi bước cuối **không đổi kết luận** — tức là bạn đã thử thứ mà nếu nó thất bại thì bạn sẽ
làm khác đi, và nó không thất bại.

| Bạn sắp nói | Bước kiểm chứng còn thiếu |
| --- | --- |
| "Xong rồi" | Chạy gate thật, dán output thật |
| "Test pass" | Prove-it-red, để chắc test hỏi đúng câu |
| "Test cover cái này rồi" | Xóa-thả |
| "Nó chỉ là thay đổi nhỏ" | Chạy script, đừng tin mắt thường |
| "Review xong, không thấy vấn đề gì" | Mutation phần bạn đụng |

## Bối cảnh

Các kỹ thuật trong mục 1, 2, 4, 5, 6 là những gì model đã tự làm khi đọc code cẩn thận — vì
vậy chúng ở đây để nhắc, không phải để dạy. **Mục 3 là thứ nó không tự làm**, và đo được là
một suite xanh vẫn có thể che một nhánh lỗi hoàn toàn không được bảo vệ.