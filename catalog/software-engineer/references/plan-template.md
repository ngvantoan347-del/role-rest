# Plan Templates

Plan là hợp đồng với người dùng, không phải phần diễn tập. Nó nói **cái gì đổi, cái gì
không đổi, chứng minh bằng cách nào, và có thể hỏng ở đâu**. Nó không chứa code.

Vì sao viết plan sớm: nó làm lộ hiểu lầm khi hiểu lầm còn rẻ. Đổi hướng lúc đầu tốn vài
dòng text. Đổi hướng sau khi đã viết 600 dòng code tốn một refactor và niềm tin.

## T2 — inline, 5-7 dòng

```text
Plan
- Goal: <thay đổi behavior quan sát được, một câu>
- Approach: <2-3 câu: thiết kế và nó sống ở đâu>
- Files: <các path dự kiến đụng>
- Verify: <lệnh cụ thể và kết quả mong đợi>
- Risk: <một thứ khả năng cao sẽ bất ngờ nhất>
```

Trình bày xong thì làm tiếp, trừ khi chạm đường rủi ro. Không cần duyệt nghi thức cho một
thay đổi nhỏ đã hiểu rõ.

Một plan T2 tốt là **một lần đọc đủ để bắt đầu**. Nếu người đọc phải hỏi lại thì nó chưa
đủ.

## T3 — có cấu trúc, rồi dừng lại

```text
Problem     <cái gì thực sự sai, kèm bằng chứng: file:line, log, docs>
Goal        <một câu: thế giới sau thay đổi này trông thế nào>
Non-goals   <ngoài phạm vi, tường minh>
Current     <entry point, module sở hữu, pattern sẵn có, test hiện khẳng định gì>

Options     1. <tên> - <cơ chế> - cost: <effort, blast radius> - risk: <cái gì hỏng>
            2. <tên> - <cơ chế> - cost: <effort, blast radius> - risk: <cái gì hỏng>
            Recommend: <phương án> vì <lý do gắn với Goal>

Design      <signature, data shape, error case, config surface, hướng dependency>
Data        <thay đổi schema, backfill, cửa sổ tương thích ngược, rollback>
Steps       1. <bước verify được độc lập>  2. ...  3. ...
Verify      <lệnh> -> <kết quả mong đợi>, cho từng gate, cộng check quan sát được
Risks       <rủi ro> -> <giảm thiểu>
Questions   <cái người dùng phải trả lời trước hoặc trong bước N>
```

## Chất lượng

Mục tiêu verify được (người khác tự biết đã đạt chưa mà không phải hỏi bạn) · **non-goals
tường minh** (nguyên nhân thật của scope creep là ranh giới chưa nói) · file được gọi tên,
không phải "cập nhật backend" · thiết kế viết ra như hợp đồng · lệnh thật có trong dự án ·
rủi ro nói thẳng, vì plan không rủi ro là plan **chưa xong** · **lựa chọn kèm khuyến
nghị**, không phải menu trần.

## Plan drift

Khi thực tế phá một giả định:

1. **Dừng.** Không tiếp tục với plan cũ trong khi giả định mới đang nạp vào.
2. Nói cái gì đổi: giả định nào vỡ, bằng chứng, ảnh hưởng tới scope và rủi ro.
3. Trình bày **phần delta**, không viết lại cả plan — người đọc cần thấy phần nào còn đúng.
4. T3: chờ duyệt lại. T2: nói delta rồi đi tiếp.

```text
Plan update: <cái gì đổi và vì sao>
Impact: <file, rủi ro, effort>
Revised step N: <cũ> -> <mới>
Continuing unless you say stop.
```

Drift lặng lẽ là failure mode mà phần này sinh ra để chặn. Nó xấu hơn kế hoạch hơi lệch,
vì người dùng đang duyệt một thứ không còn là thứ bạn đang làm.

## Khi nào plan là thừa

Không cần plan cho T1 — typo và sửa một dòng không có quyết định thiết kế để trình bày.
Viết plan cho việc mà bạn không cần hỏi ý kiến ai là lãng phí thời gian của cả hai bên.
