# Tích Đức 🪷

Mini game online lấy bối cảnh chính điện một ngôi chùa Việt. Người chơi tạo nhân vật, đi lại trên sàn chính điện, **dâng hương (+2)**, **gõ mõ (+1 mỗi nhịp)** và **ngồi thiền (+1 mỗi giây)** để tích lũy công đức, cùng nhìn thấy những người khác đang ở trong chính điện.

- Máy chủ: Node.js + Express + Socket.IO
- Cơ sở dữ liệu: SQLite (`better-sqlite3`, chế độ WAL)
- Giao diện: HTML/CSS/JavaScript thuần, vẽ bằng Canvas 2D, âm thanh tổng hợp bằng Web Audio

---

## 1. Chạy dự án

Cần **Node.js 22 trở lên** (thư viện `better-sqlite3` 13 yêu cầu bản này và có sẵn bản dựng cho Windows, macOS và Linux, nên không cần Visual Studio hay trình biên dịch).

```bash
npm install
npm start          # http://localhost:3000
```

- `npm run dev`: tự khởi động lại khi sửa mã phía máy chủ.
- `npm test`: chạy 22 bài kiểm tra xác thực và chống gian lận. Bài test tự bật một máy chủ riêng trên database tạm, nên **không đụng tới dữ liệu thật**.

Muốn thử chơi nhiều người: mở thêm một cửa sổ ẩn danh, hoặc vào từ điện thoại cùng mạng Wi-Fi qua `http://<IP-máy-tính>:3000`.

### Biến môi trường (đều không bắt buộc)

Xem `.env.example`. Máy chủ đọc trực tiếp từ môi trường, không cần file `.env`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng HTTP |
| `HOST` | `0.0.0.0` | Địa chỉ lắng nghe |
| `DATA_DIR` | `./data` | Thư mục chứa database |
| `DB_PATH` | `$DATA_DIR/tich-duc.db` | Đường dẫn file SQLite |
| `TRUST_PROXY` | (tắt) | Đặt `1` hoặc `true` khi chạy sau Nginx hoặc dịch vụ hosting, để giới hạn tần suất theo đúng IP người dùng |
| `CORS_ORIGINS` | (rỗng) | Danh sách domain, cách nhau bằng dấu phẩy, nếu giao diện được đặt ở domain khác máy chủ |
| `NODE_ENV` | | `production` khi triển khai |

Dự án **không có khóa bí mật nào** cần cấu hình và không có khóa nào nằm trong mã phía trình duyệt.

### Thiết lập cơ sở dữ liệu

Không cần làm gì. Lần chạy đầu, máy chủ tự tạo `data/tich-duc.db` và toàn bộ bảng. Phiên bản lược đồ được lưu trong `PRAGMA user_version`. Database từ bản thử nghiệm đầu tiên được **tự động chuyển đổi**, giữ nguyên nhân vật và công đức.

Sao lưu: chép file `data/tich-duc.db` khi máy chủ đã tắt, hoặc dùng `sqlite3 data/tich-duc.db ".backup backup.db"` khi đang chạy.

---

## 2. Tài khoản khách và lưu dữ liệu

Game không cần đăng ký. Khi tạo nhân vật, máy chủ cấp một **mã bí mật 160-bit**. Trình duyệt giữ mã này trong `localStorage`; máy chủ chỉ lưu **mã băm SHA-256** của nó.

- Nhân vật và công đức nằm trên máy chủ, nên tải lại trang vẫn còn nguyên.
- Đổi trình duyệt, đổi thiết bị hoặc xóa dữ liệu trình duyệt thì cần **mã khôi phục** (chính là mã bí mật đó). Mã xem được trong **Hồ sơ → Mã khôi phục**, và nhập lại ở màn hình chính qua nút "Đã có mã khôi phục?". Mất mã thì không lấy lại được nhân vật.
- Game chỉ lưu tên hiển thị và ngoại hình, không thu thập email, IP hay thông tin cá nhân nào khác vào database.
- Mỗi nhân vật chỉ mở được ở một nơi. Mở ở thẻ mới thì thẻ cũ được báo và ngắt kết nối.

---

## 3. Cách tính công đức (máy chủ quyết định)

Trình duyệt chỉ gửi *yêu cầu*, còn máy chủ (`server/realtime.js`) kiểm tra mọi điều kiện rồi mới ghi điểm.

| Hoạt động | Điểm | Điều kiện máy chủ kiểm tra |
|---|---|---|
| Dâng hương | +2 | Đứng trong phạm vi lư hương (theo vị trí máy chủ đang biết), không bận hoạt động khác, cách lần trước ≥ 6 giây |
| Gõ mõ | +1 mỗi nhịp | Đứng cạnh một chiếc mõ chưa có ai ngồi, cách nhịp trước ≥ 0,7 giây |
| Ngồi thiền | +1 mỗi giây | Máy chủ tự đếm giây khi kết nối còn sống. Đứng dậy, di chuyển hoặc mất kết nối thì phiên kết thúc. Mỗi phiên tối đa 30 phút |

Các cơ chế chống gian lận khác:

- **Di chuyển:** máy chủ chặn đi vào bệ thờ, vật cản hoặc đi nhanh hơn tốc độ cho phép, rồi trả vị trí đúng về client. Đang làm một hoạt động thì không di chuyển được.
- **Chống ghi trùng:** mỗi hành động có một `eventId`. Bảng `merit_transactions` có ràng buộc `UNIQUE(user_id, event_id)`. Khi mạng chập chờn, client gửi lại với **cùng** mã, nên điểm không bị cộng hai lần.
- **Sổ công đức:** `player_stats.merit_points` chỉ được cập nhật trong cùng một giao dịch với dòng ghi vào sổ `merit_transactions`. Không API nào cho client sửa trực tiếp tổng điểm. `PUT /api/me` chỉ đổi tên và ngoại hình.
- **Tên hiển thị:** 2–16 ký tự, được kiểm tra cả ở trình duyệt lẫn máy chủ (`public/js/shared/profile-rules.js`). Bộ lọc hiểu dấu tiếng Việt: "Các", "Lớn" hợp lệ, còn viết tắt hoặc từ tục bị chặn. Màu sắc phải thuộc bảng màu có sẵn.
- **Giới hạn tần suất API:** tạo nhân vật tối đa 10 lần/giờ/IP. Kết nối socket phải có token hợp lệ.

Thiền được ghi vào sổ theo từng đợt 10 giây, và khi phiên kết thúc. Nếu máy chủ bị **tắt cưỡng bức** (mất điện, `kill -9`) thì có thể mất tối đa 10 giây thiền chưa ghi. Tắt bình thường bằng Ctrl+C hoặc SIGTERM thì máy chủ ghi đủ trước khi thoát.

---

## 4. Cơ sở dữ liệu

```
accounts            id, token_hash (UNIQUE), created_at, last_login_at
profiles            id → accounts.id, display_name, gender, skin_color, hair_color,
                    hair_style, robe_color, created_at, updated_at
player_stats        user_id → profiles.id, merit_points (CHECK ≥ 0), updated_at
merit_transactions  id, user_id → profiles.id, activity_type (incense|meditation|wooden_fish|adjustment),
                    points_delta, event_id, session_id, created_at,
                    UNIQUE(user_id, event_id), INDEX(user_id, created_at), INDEX(session_id)
player_presence     user_id → profiles.id, room_id, position_x, position_y,
                    facing_direction, activity_state, last_seen_at   (xóa sạch mỗi lần khởi động)
```

Khóa ngoại dùng `ON DELETE CASCADE`, nên xóa một `accounts` thì toàn bộ dữ liệu của người đó cũng bị xóa. Muốn chuyển sang PostgreSQL hoặc Supabase thì giữ nguyên các bảng và ràng buộc trên. Ở Supabase, `accounts` được thay bằng `auth.users`, và việc cộng điểm nên đặt trong một hàm `SECURITY DEFINER`, với RLS chỉ cho phép đọc và ghi hồ sơ của chính mình.

---

## 5. Cấu trúc mã nguồn

```
server.js                REST API, xác thực Bearer token, header bảo mật, giới hạn tần suất
server/realtime.js       Phòng, presence, kiểm tra di chuyển, mọi hoạt động tính công đức
db.js                    Lược đồ, migration, giao dịch cộng điểm idempotent
public/
  index.html             Các màn hình: chào, tạo nhân vật, tải, chơi, hồ sơ, cài đặt, khôi phục, lỗi
  css/style.css          Giao diện, bố cục cảm ứng (joystick trái, nút phải), responsive
  assets/img/            Nền chính điện (WebP, từ ẢNH/lobby.png) và biểu tượng
  js/shared/world.js     Bản đồ: sàn đi được, vật cản, lư hương, mõ, luật chơi (dùng chung client/server)
  js/shared/profile-rules.js  Bảng màu, kiểu tóc, kiểm tra tên (dùng chung client/server)
  js/renderer.js         Canvas, camera bám theo nhân vật
  js/temple.js           Nền + khói hương, ánh nến, đèn lồng, bụi sáng, chiếc mõ
  js/character.js        Nhân vật chibi 4 hướng: đứng, đi, thiền, dâng hương, gõ mõ
  js/input.js            Bàn phím (WASD/mũi tên, E/Space, Esc) và joystick cảm ứng
  js/audio.js            Nhạc thiền tổng hợp, tiếng mõ, chuông, cài đặt âm lượng
  js/network.js          REST + Socket.IO, hàng đợi gửi lại hành động
  js/ui.js               Màn hình, form tạo nhân vật, HUD, thông báo, bảng hồ sơ
  js/game.js             Luồng chơi, vòng lặp, hoạt động, người chơi khác
tests/smoke.test.js      Kiểm tra xác thực và chống gian lận (npm test)
ẢNH/                     Ảnh gốc tham khảo
```

Thêm phòng hoặc khu vực mới: khai báo trong `ROOMS` ở `public/js/shared/world.js` (ảnh nền, sàn, vật cản, điểm tương tác). Máy chủ đã quản lý người chơi theo `roomId`.

---

## 6. Điều khiển

| | Máy tính | Điện thoại / máy tính bảng |
|---|---|---|
| Di chuyển | W A S D hoặc phím mũi tên (giữ để đi liên tục) | Joystick góc dưới bên trái |
| Dâng hương / gõ mõ / ngồi thiền | E hoặc Space (nút hiện theo vị trí) | Nút tròn lớn góc dưới bên phải |
| Đứng dậy | Esc, hoặc bấm phím di chuyển | Nút "Đứng dậy", hoặc kéo joystick |

Âm thanh chỉ bắt đầu sau lần chạm hoặc bấm đầu tiên, và bật/tắt được ở góc trên bên trái hoặc trong Cài đặt.

---

## 7. Triển khai

Chạy `npm ci --omit=dev && NODE_ENV=production npm start` trên máy chủ có Node 22+. Thư mục `data/` phải nằm trên ổ lưu trữ bền vững. Nếu đứng sau reverse proxy thì bật WebSocket (`Upgrade`/`Connection`) cho đường dẫn `/socket.io/` và đặt `TRUST_PROXY=1`. Game chạy được ở dạng một tiến trình. Muốn chạy nhiều tiến trình thì cần chuyển trạng thái phòng sang Redis và database sang PostgreSQL.
