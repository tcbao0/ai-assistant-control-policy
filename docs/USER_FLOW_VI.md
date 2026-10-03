# Luồng hoạt động của ứng dụng

## Tổng quan

Ứng dụng dùng Sui Move để lưu và thực thi quyền chi tiêu mà owner đã ký trước. AI chỉ diễn giải câu lệnh hoặc bill và chuẩn bị giao dịch. Backend kiểm tra grant hiện hành, rồi Move kiểm tra lại khi agent gửi giao dịch.

Tiền agent chi lấy từ **vault dùng chung**, không lấy từ ví cá nhân. Ví owner ký đăng nhập, tạo vault, nạp, rút, tạo và sửa grant, whitelist, và revoke. Agent chỉ ký lệnh chi sau khi owner bấm **Confirm agent action**.

Header: **Sui Agent Control Plane**. Dòng phụ: *Agent proposes · Owner holds · Chain enforces*.

Ba màn sau khi đã có vault:

| Màn | Route | Việc owner làm ở đây |
| --- | --- | --- |
| Agent | `/` | Xem số dư tóm tắt, chat, dán bill, tải ảnh bill, duyệt proposal |
| Assets | `/assets` | Xem SUI trong vault, nạp, rút, xem trần còn chi được, sổ biến động |
| Policies | `/policies` | Tạo command grant và (tuỳ chọn) subscription tự động theo tháng |

Chưa đăng nhập: mọi màn dashboard hiện **Start here** (kết nối ví, **Sign in with wallet**, hoặc **Open first-time setup**). Đã đăng nhập nhưng chưa có vault: app chuyển sang `/setup`.

## 1. Cấu hình một lần (người vận hành)

Điền `web/.env` từ `web/.env.example`. File này không commit.

- `PACKAGE_ID`, `NEXT_PUBLIC_PACKAGE_ID`, `SUI_NETWORK`, `NEXT_PUBLIC_SUI_NETWORK` của package đã publish. Hai biến network phải trùng nhau.
- `AGENT_PRIVATE_KEY` và `NEXT_PUBLIC_AGENT_ADDRESS` của một key agent riêng, khác ví owner.
- `MONGODB_URI`, `MONGODB_DB`, `GEMINI_API_KEY`.
- `SCHEDULER_SECRET` (ít nhất 32 ký tự) nếu cron bên ngoài gọi `POST /api/scheduler/run`.
- `CLOCK_ID` / `NEXT_PUBLIC_CLOCK_ID` mặc định `0x6`.

`POLICY_ID`, `ADMIN_CAP_ID`, `VAULT_ID` và ID transfer grant **không** cấu hình theo từng user. App lưu chúng trong MongoDB theo ví owner sau khi owner ký. `NEXT_PUBLIC_LEGACY_*` chỉ dùng để revoke policy testnet cũ, nếu còn.

## 2. Lần đầu: `/setup`

Wizard **First-time setup**, năm bước:

1. **Connect wallet.** Ví Sui (Slush, Suiet, hoặc ví khác) trên đúng network. Ví này là owner của vault.
2. **Sign in.** Ký một message để phiên trình duyệt gắn với ví. Nút **Sign in with wallet**.
3. **Create vault.** Nút **Create vault on Sui**. Một giao dịch `vault::create_vault`. Backend kiểm tra digest, người ký, và package, rồi lưu `vaultId` vào workspace. Owner không copy ID vào `.env`.
4. **Fund vault.** Nhập số SUI (mặc định gợi ý `10`), nút **Fund vault**, hoặc **Skip for now**. Nạp sau được ở Assets. Tiền đi từ ví owner vào vault.
5. **Automatic monthly policy (optional).** Nhập **Total monthly budget (SUI)** (mặc định gợi ý `50`), nút **Create automatic subscription policy**, hoặc **Skip for now**. Chat không dùng policy này.

**Setup complete** hiện vault ID và trạng thái auto policy. **Go to agent home** về `/`. Bước tiếp theo trên UI: tạo command grant ở Policies trước khi chat. Nạp hoặc rút ở Assets.

Đã có vault mà chưa có auto policy: có thể **open the home page** và tạo policy sau ở Policies. Một owner có một vault cho mỗi network và package.

## 3. Vào lại app

1. Mở `/`. Nếu phiên hết hạn, **Start here** hiện lại.
2. Kết nối đúng ví owner, đúng network, bấm **Sign in with wallet**.
3. Có vault thì vào Agent. Header có **Log out** và nút kết nối ví.

## 4. Agent (`/`)

Thanh trạng thái trên đầu:

- **Vault**, **Command**, **Auto**: số SUI, bấm vào là sang Assets.
- Command là phần còn chi được hôm nay (`min` giữa trần ngày còn lại và số dư vault). Auto là phần còn chi được trong tháng UTC. Chưa có grant thì hiện `0`.
- Badge **Vault**, **Command ready / needed**, **Auto ready / optional**.
- Chưa có command grant: dòng vàng bảo mở **Policies**.

Card **Ask the agent**. Mô tả: *Pay a command-whitelist name. Review, then confirm.* Ba chế độ:

| Chế độ | Owner làm | Nút |
| --- | --- | --- |
| **Chat command** | Gõ một lệnh, tối đa 500 ký tự. Gợi ý: `Pay Spotify 1 SUI` hoặc `Transfer 0.1 SUI to An` | **Check instruction** |
| **Bill text** | Dán text hóa đơn, tối đa 20.000 ký tự | **Read and review bill** |
| **Bill image** | Chọn PNG, JPEG hoặc WebP, tối đa 8 MB. Ảnh không lưu trong lịch sử | **Read and review bill** |

Tên nhận phải nằm trên command whitelist. Chat không trả subscription tự động.

Khi hợp lệ, panel **Review agent proposal** hiện:

- Action: *Whitelisted command payment*
- Recipient, Sui address, Amount
- Source: *Shared vault*

Owner bấm **Confirm agent action** hoặc **Cancel**. Confirm không ký bằng ví owner. Agent ký. Move kiểm tra lại grant trên chain. Proposal khóa 10 phút. Confirm không cho model diễn giải lại câu lệnh.

Cột **Recent** (desktop; trên mobile nằm dưới form) hiện tối đa 3 proposal: người nhận, số tiền, thời điểm, trạng thái. Proposal `ready` còn hạn có nút **Review**. Trạng thái `signing` hoặc `submitted` có **Check status**. Có digest thì có link **tx**.

Dòng trả lời ghi nguồn quyết định: **AI decision**, **Server validation**, hoặc **Sui Move contract**.

Lệnh mơ hồ, nhiều hành động, tên không có trên whitelist, sai địa chỉ, hoặc vượt trần bị từ chối hoặc yêu cầu làm rõ trước khi ký. Agent không sửa grant và không tự thêm người nhận.

## 5. Assets (`/assets`)

Tiêu đề **Digital assets**. SUI trong vault là tài sản. Grant chỉ là trần agent được chi.

Ba card:

1. **Shared vault.** Số dư on-chain, *Command can spend now*, *Auto can spend now*, và vault ID.
   - **Add SUI to vault** / **Fund vault**: ví owner ký `fund_vault`. Không cần passcode. Cả hai grant dùng chung khoản này.
   - **Withdraw SUI to owner wallet** / **Withdraw**: ví owner ký `withdraw_to` về chính ví đó. Agent không rút được. Grant không chặn owner rút.
2. **Command grant.** Số còn lại trong ngày UTC, daily cap, spent today, per payment, số tên whitelist. Badge Active hoặc Revoked. Chưa có grant: link sang Policies.
3. **Automatic monthly.** Số còn lại trong tháng UTC, monthly cap, spent this month, từng dịch vụ (tên, payment day, còn lại / trần dịch vụ). Chat không đụng ngân sách này. Chưa có policy: ghi là tuỳ chọn dưới Policies.

**Vault movements** ghi **Fund**, **Withdraw**, **Command pay**, **Auto pay**, kèm số tiền và link giao dịch. Chưa có bản ghi: *No movements recorded yet.*

## 6. Policies: Pay on command

Card **Pay on command**. Whitelist tên và địa chỉ cho chat. Agent chỉ gửi SUI trong vault sau khi owner confirm, trong trần mỗi lệnh và ngân sách ngày lưu trên Sui.

1. **Create a passcode** nếu chưa có. Passcode ít nhất 12 ký tự, nhập hai lần. Server lưu verifier scrypt trong MongoDB. Passcode không lên Sui. Đổi passcode nằm trong **Change passcode** (passcode cũ, passcode mới, nhắc lại).
2. Chưa có grant: nhập **Max per payment (SUI)**, **Daily budget (SUI)** (daily budget phải lớn hơn hoặc bằng trần mỗi lệnh), **Grant expires at (your local time)**. Nút **Create command grant**. Hết hạn phải ở tương lai. Mặc định form gợi ý 1 SUI / lệnh, 5 SUI / ngày, hết hạn sau một năm theo giờ máy.
3. App hỏi passcode, nút **Verify and sign**. Ví owner ký. `TransferAdminCap` là quyền on-chain. Backend ghi `transferGrantId` và `transferAdminCapId` vào workspace.
4. Grant active hiện Status, Vault SUI, Remaining today, Per payment, Expiry, Authorized agent.
5. **Command whitelist (name + address):** Name (tối đa 64 ký tự, ví dụ `An`), Sui address, **Add recipient**. Mỗi dòng có **Remove**. Tên và địa chỉ trên Sui là dữ liệu công khai. Danh sách trống thì chưa chat được.
6. **Change grant limits, expiry, or agent:** **Update limits**, **Update expiry**, **Change agent**.
7. **Revoke transfer grant** tắt grant. Grant đã revoke không chi tiếp. **Replace grant** tạo object mới trên cùng vault; whitelist bắt đầu trống, owner thêm lại từng tên.

Vault trống: UI trỏ sang **Fund on Assets**. Hết ngân sách ngày: đợi ngày UTC kế tiếp, hoặc nâng daily cap.

Mọi sửa grant (tạo, thêm, xoá, đổi hạn mức, hạn, agent, revoke, thay) đều qua passcode rồi chữ ký ví. Passcode không thay chữ ký.

## 7. Policies: Automatic monthly

Card **Automatic monthly**. Scheduler trả dịch vụ đã đăng ký vào đúng ngày. Chat không dùng whitelist này. Nạp vault ở Assets.

Chưa có policy: nhập **Total monthly budget (SUI)**, nút **Create shared policy**. Ví owner ký `policy::create_policy` gắn vault và địa chỉ agent trong env. Một vault chỉ gắn một subscription policy. Backend lưu `policyId` và admin cap.

Đã có policy, đăng ký dịch vụ:

- **Service name**
- **Recipient address**
- **Charge (SUI)**: khoản cố định mỗi lần đến hạn
- **Monthly cap (SUI)**: trần của riêng dịch vụ
- **Months**: 1–120
- **Payment day (UTC)**: ngày trong tháng, 1 đến số ngày của tháng UTC hiện tại

Nút **Register service and whitelist address**. Mỗi dịch vụ có **Remove**.

**Update budget**, **Revoke policy**, **Reactivate**. Revoke tắt chi; reactivate bật lại cùng policy, không tạo object mới.

**Test automatic pay.** Scheduler không tự chạy. Điều kiện trên UI: dịch vụ có payment day ≤ ngày UTC hôm nay, vault có SUI, ví agent còn gas. Nút **Run due payments now** gọi `POST /api/scheduler/mine` bằng phiên owner đang đăng nhập, chỉ workspace này. Kết quả hiện tên dịch vụ: đã trả (kèm digest), bỏ qua, hoặc lỗi.

Cron bên ngoài là đường khác: `POST /api/scheduler/run` (hoặc `GET`) với `Authorization: Bearer <SCHEDULER_SECRET>`. Cron duyệt mọi workspace của network và package hiện tại, bỏ qua workspace không có policy. Local không có cron sẵn.

## 8. Trạng thái proposal và retry

`POST /api/chat` và `POST /api/chat/bill` không chuyển tiền. Chúng tạo proposal. `POST /api/chat/confirm` mới cho agent ký.

MongoDB lưu proposal, preview, bytes đã ký, digest và trạng thái. Trạng thái trên Recent: `ready`, `signing`, `submitted`, rồi `confirmed` hoặc `failed`.

Proposal `ready` hết hạn sau 10 phút. Retry một proposal đã ký thì đối chiếu digest và dùng lại bytes đã ký, không ký một lệnh chi mới và không diễn giải lại câu lệnh. Nonce trên TransferGrant chặn replay của transfer đã thực thi.

## 9. Phân chia trách nhiệm

| Thành phần | Trách nhiệm |
| --- | --- |
| Ví owner | Đăng nhập; ký tạo vault, nạp, rút, policy, grant, whitelist, revoke và thay grant |
| AI | Phân loại câu lệnh và trích merchant, số tiền, địa chỉ từ bill |
| Backend và MongoDB | Workspace theo owner; kiểm tra grant trước khi ký; passcode; proposal, digest, sổ biến động |
| Sui Move | Lưu vault, grant, whitelist; cưỡng chế agent, người nhận, hạn, ngân sách ngày hoặc tháng, revoke, nonce |
| Agent signer | Ký thanh toán đã confirm hoặc thanh toán subscription đến hạn. Không cầm admin cap |
