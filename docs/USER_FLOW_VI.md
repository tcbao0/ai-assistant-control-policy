# Luồng hoạt động của ứng dụng

## Tổng quan

Ứng dụng dùng Sui Move để lưu và thực thi các quyền chi tiêu mà người dùng đã phê duyệt. AI chỉ diễn giải yêu cầu và chuẩn bị giao dịch. Quyền hạn thực tế được giới hạn bởi subscription policy hoặc transfer grant trên chain; backend kiểm tra trước, sau đó Move kiểm tra lại khi giao dịch được thực thi.

Tiền agent chi trả trong luồng này lấy từ **vault dùng chung**, không lấy từ ví cá nhân của người dùng. Ví cá nhân ký các giao dịch tạo vault, tạo và chỉnh sửa quyền, whitelist người nhận, nạp/rút tiền và đăng nhập.

## 1. Cấu hình ứng dụng một lần

Người vận hành điền cấu hình chung trong `web/.env`:

- `PACKAGE_ID` và `SUI_NETWORK` của deployment.
- `AGENT_PRIVATE_KEY` và địa chỉ tương ứng `NEXT_PUBLIC_AGENT_ADDRESS`.
- MongoDB và Gemini API key.
- Các cấu hình cần thiết khác như Clock hoặc scheduler nếu sử dụng.

`POLICY_ID`, `ADMIN_CAP_ID`, `VAULT_ID` và các ID transfer grant không còn là cấu hình bắt buộc cho từng người dùng. Các ID này được đăng ký theo wallet owner trong MongoDB sau khi người dùng ký giao dịch. Một số biến env cũ vẫn được đọc trong nhánh tương thích để nhập workspace cũ chưa đăng ký.

## 2. Kết nối ví và tạo vault

1. Người dùng mở `/setup`, kết nối ví owner trên đúng network.
2. Người dùng chọn đăng nhập bằng ví và ký thông điệp xác thực.
3. Người dùng chọn **Create vault** và ký giao dịch tạo vault.
4. Backend kiểm tra giao dịch thành công, người ký trùng wallet đang đăng nhập, và vault thuộc package đang cấu hình.
5. Backend lưu owner, network, package và vault ID vào workspace trong MongoDB.

Sau bước này, người dùng không phải sao chép vault ID vào `.env`. Một owner có một vault cho mỗi network và package theo quy tắc hiện tại.

Giao diện tách 3 màn: **Agent** (chat), **Assets** (số dư vault, nạp/rút, sổ biến động), **Policies** (grant lệnh tay và subscription auto). Dashboard **Assets** hiện số dư vault, số SUI lệnh tay/auto còn chi được (`min` với trần grant), nút nạp và **rút về ví owner**. Owner ký `withdraw_to`; agent không rút được. Sổ **Vault movements** ghi nạp, rút, trả lệnh tay và trả auto.

## 3. Tạo subscription policy (tùy chọn, thanh toán tự động)

1. Trên dashboard, người dùng nhập tổng ngân sách tháng và chọn **Create shared policy**.
2. Ví owner ký giao dịch tạo policy gắn với vault.
3. Backend đọc digest giao dịch và xác minh policy thuộc đúng vault/owner, đồng thời admin capability được tạo cho policy đó.
4. Backend lưu `policyId` và `adminCapId` trong workspace MongoDB của owner.
5. Frontend tải các ID từ workspace đã xác thực khi cần thao tác.

Admin capability là object tham chiếu trên chain, không phải private key. Việc quản trị policy vẫn cần ví owner ký giao dịch.

Vault chỉ cho phép gắn một subscription policy theo thiết kế Move hiện tại. Chat không dùng policy này.

## 4. Đăng ký dịch vụ subscription tự động

Người dùng thêm dịch vụ bằng cách khai báo:

- Tên dịch vụ và địa chỉ nhận SUI.
- Khoản thanh toán định kỳ cố định.
- Ngân sách tối đa cho dịch vụ mỗi tháng.
- Số tháng đăng ký và ngày thanh toán trong tháng.

Ví owner ký giao dịch cập nhật policy; thông tin dịch vụ và giới hạn được lưu trên Sui. Khi scheduler chạy vào ngày đến hạn, backend đọc policy hiện hành và kiểm tra lịch, thời hạn, số tiền cùng ngân sách còn lại. Move thực thi các giới hạn trên chain khi giao dịch được gửi.

## 5. Tạo grant lệnh tay và whitelist người nhận

1. Người dùng tạo passcode trong giao diện.
2. Người dùng đặt giới hạn mỗi giao dịch, ngân sách **ngày** và thời điểm hết hạn cho command grant (`TransferGrant`).
3. Ví owner ký giao dịch tạo grant.
4. Backend xác minh giao dịch và lưu `transferGrantId` cùng `transferAdminCapId` vào workspace.
5. Người dùng thêm người nhận bằng tên và địa chỉ, nhập passcode rồi ký giao dịch bằng ví owner.

Passcode được kiểm tra ở server và lưu dưới dạng verifier đã băm trong MongoDB. Passcode không được gửi lên Sui và không thay thế chữ ký ví. Tên cùng địa chỉ whitelist được lưu trên chain nên là dữ liệu công khai.

Subscription tự động dùng whitelist **riêng** trên `SubscriptionPolicy` (ngày trả, số tháng, phí cố định). Chat không dùng grant này.

## 6. Ra lệnh và duyệt thanh toán

Người dùng yêu cầu trả cho một tên trong command whitelist, hoặc tải ảnh bill/nhập hóa đơn khớp whitelist đó. Số tiền lấy từ lệnh hoặc bill, không phải phí subscription cố định.

Luồng xử lý:

1. AI phân loại yêu cầu; nó không tự quyết định quyền chi.
2. Backend phân giải tên và số tiền bằng dữ liệu on-chain, rồi kiểm tra grant lệnh tay, người nhận, trần mỗi giao dịch và ngân sách ngày.
3. Nếu yêu cầu hợp lệ, giao diện hiển thị bản xem trước gồm người nhận, địa chỉ, số tiền, vault và grant.
4. Người dùng kiểm tra bản xem trước và bấm **Confirm agent action**.
5. Agent ký giao dịch. Sui Move kiểm tra lại quyền và giới hạn trước khi tiền rời vault.

Yêu cầu mơ hồ, không nằm trong whitelist, sai số tiền hoặc vượt giới hạn sẽ bị từ chối hoặc yêu cầu làm rõ. Agent không có quyền tự sửa policy hoặc tự thêm người nhận.

## 7. Trạng thái giao dịch và retry

MongoDB lưu yêu cầu, bản xem trước, transaction digest và trạng thái xử lý. Trạng thái điển hình là `ready`, `signing`, `submitted`, rồi `confirmed` hoặc `failed`.

Nếu một giao dịch đã ký nhưng phản hồi bị gián đoạn, lần retry sẽ kiểm tra digest/trạng thái của giao dịch đó và dùng lại bytes đã ký. Hệ thống không ký một giao dịch thanh toán mới chỉ vì người dùng retry cùng yêu cầu. Transfer grant còn có nonce trên chain để ngăn replay.

## 8. Thu hồi quyền

Owner có thể revoke subscription policy hoặc transfer grant bằng ví owner và admin capability tương ứng. Backend đọc trạng thái mới nhất trên chain; một grant đã revoke không được dùng để chi tiếp. Các giao dịch trực tiếp lên Move cũng bị từ chối nếu grant không còn hợp lệ.

## 9. Scheduler subscription

Ứng dụng có endpoint scheduler để xử lý subscription đến hạn khi được gọi bởi cron bên ngoài có `SCHEDULER_SECRET`. Scheduler không tự chạy trong quá trình phát triển local. Nếu được bật, scheduler dùng `SubscriptionPolicy`, vault và ngân sách của từng workspace đã đăng ký. Chat không kích hoạt luồng này.

## Phân chia trách nhiệm

| Thành phần | Trách nhiệm |
| --- | --- |
| Ví owner | Đăng nhập; ký tạo vault/policy/grant; quản lý whitelist; nạp/rút và revoke quyền |
| AI | Phân loại câu lệnh, trích xuất thông tin bill và hỗ trợ lập yêu cầu |
| Backend và MongoDB | Gắn workspace với owner, xác minh dữ liệu, lưu proposal/trạng thái/digest, kiểm tra trước giao dịch |
| Sui Move | Lưu policy/grant và whitelist; cưỡng chế quyền, recipient, thời hạn, ngân sách, trạng thái revoke và nonce |
| Agent signer | Ký giao dịch thanh toán đã qua xác minh, dùng quyền của grant trên chain |

