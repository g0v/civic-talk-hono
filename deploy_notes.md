# 部署須知

civic-talk-hono 的部署與環境設定參考。日常開發看 [`README.md`](./README.md)，agent 工作規範看 [`AGENTS.md`](./AGENTS.md)。

> 狀態：**已部署**於 <https://civic.vtaiwan.tw>（Worker 名稱 `civic-talk`，首次部署 2026-08-05）。第 1 節現在是**環境設定的參考**（換環境、換金鑰、新維護者接手時要看），不再是首次部署的待辦清單。

---

## 1. 環境設定（換環境／輪替金鑰時要重做）

### 1.1 Worker 名稱與正式網域

`package.json` 與 `wrangler.jsonc` 的 `name` 都是 **`civic-talk`**，已實際部署成功——當初擔心的「與舊 Pages 專案撞名」沒有發生（Cloudflare 帳號內 Workers 與 Pages 共用同一份名稱清單，改名前要先確認這點）。

⚠️ **正式網域 `civic.vtaiwan.tw` 沒有寫在 `wrangler.jsonc` 裡**（設定檔沒有 `routes`／`custom_domain` 設定），所以：

- 只讀設定檔的人找不到正式網址——需要時到 Cloudflare 儀表板的 Worker 設定看綁定方式。
- 要改動網域綁定前先確認它現在是怎麼綁的，不要憑猜測改設定檔。

### 1.2 OAuth 應用程式的 callback 網址

Google 與 GitHub 的 OAuth 應用程式**與 vTaiwan-hono 共用同一組**。允許清單裡必須同時有本機與正式站：

```
http://localhost:5173/api/auth/callback/google
http://localhost:5173/api/auth/callback/github
https://civic.vtaiwan.tw/api/auth/callback/google
https://civic.vtaiwan.tw/api/auth/callback/github
```

- 這是**只能在 Google Cloud Console 與 GitHub Developer settings 手動做**的動作。
- 沒加就是登不進去（OAuth 會回 `redirect_uri_mismatch`），程式碼端無解。
- 因為是共用的應用程式，**新增網址時不要動到 vTaiwan 既有的那幾筆**。
- 換正式網域時記得同步這裡，否則新網域一樣登不進去。

### 1.3 正式環境的機密

`.dev.vars` **只有本機吃得到**，不會隨 deploy 上傳。以下六個值必須另外設進 Worker（正式站已設好，這裡是輪替金鑰或建新環境時的清單）：

| 名稱                   | 說明                                                                                     | 建議設法              |
| ---------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| `BETTER_AUTH_SECRET`   | 簽章密鑰，**與 vTaiwan-hono 用同一個值**                                                 | `wrangler secret put` |
| `GOOGLE_CLIENT_ID`     | 與 vTaiwan-hono 共用                                                                     | `wrangler secret put` |
| `GOOGLE_CLIENT_SECRET` | 與 vTaiwan-hono 共用                                                                     | `wrangler secret put` |
| `GITHUB_CLIENT_ID`     | 與 vTaiwan-hono 共用                                                                     | `wrangler secret put` |
| `GITHUB_CLIENT_SECRET` | 與 vTaiwan-hono 共用                                                                     | `wrangler secret put` |
| `BETTER_AUTH_URL`      | **本站自己的 origin**（正式站是 `https://civic.vtaiwan.tw`），不要從 vTaiwan-hono 複製 | 見下方說明            |

```bash
npx wrangler secret put BETTER_AUTH_SECRET     # 逐一設定，值用貼的、不要放進指令歷史
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

**`BETTER_AUTH_URL` 不是機密**，可以改放進 `wrangler.jsonc` 的 `vars`（進版控、部署時自動帶上、不會有人忘了設）：

```jsonc
"vars": { "BETTER_AUTH_URL": "https://civic.vtaiwan.tw" }
```

目前設定檔**沒有** `vars` 這一段，所以正式站的 `BETTER_AUTH_URL` 只能是設在 Worker 上（儀表板或 `wrangler secret put`）——`src/auth/createAuth.ts` 直接把它當 `baseURL`，值不對（例如還留著 localhost）就會在登入時導到錯的網域。要改成寫進設定檔前先讀下面那條 `keep_vars` 警告。本機開發時 `.dev.vars` 的值仍會覆蓋它，所以不影響 `vp run dev`。

⚠️ **若你打算在 Cloudflare 儀表板上手動設定 vars**：wrangler 預設把設定檔當成唯一真相，**deploy 會覆蓋或刪除儀表板上的 vars**。要保留儀表板設定得在 `wrangler.jsonc` 加 `"keep_vars": true`（vTaiwan-hono 就有這一行，本專案沒有）。用 `wrangler secret put` 設的機密不寫在設定檔裡，不受這條規則影響——這也是建議走 secret 的原因之一。

---

## 2. 絕對不要做的事

### 2.1 🚫 不要對 `vtaiwan-auth` 跑 migration

`vtaiwan-auth` 是 **vTaiwan-hono 的正式認證資料庫**（`user`／`session`／`account`／`verification`），本專案只是消費端（AGENTS.md 不變量 11）。

⚠️ **這裡有一個真實的陷阱**：`wrangler.jsonc` 的 `DB_AUTH` 雖然沒寫 `migrations_dir`，但 **wrangler 會自動填入預設值 `./migrations`**（可在 `dist/civic_talk/wrangler.json` 看到實際值）。也就是說：

```bash
# 🚫 千萬不要跑這個指令
npx wrangler d1 migrations apply vtaiwan-auth --remote
```

它會把 **civic-talk 的 `0001_init.sql`（建立 `ct_*` 業務表）套用到 vTaiwan 的認證資料庫**，在別人的正式庫裡憑空長出四張 `ct_` 表。這不會刪掉 auth 資料，但屬於明確違反不變量 11 的污染，且要清掉得再手動下 DDL。

auth schema 的唯一來源是 `../vTaiwan-hono/migrations/auth/`；要改 schema 就去那邊改。

### 2.2 🚫 不要覆蓋別人的 Worker／Pages 專案

`civic-talk` 這個名字現在屬於本專案（見 1.1）。要改名或改網域綁定前先確認新名字目前屬於誰，不要用 `--force` 之類的方式硬推。

### 2.3 🚫 不要以為部署後 vTaiwan 的登入狀態會自動延續

兩站共用 `user`／`account` 資料與 `BETTER_AUTH_SECRET`，所以**同一個 email 在兩站是同一個帳號**；但 session cookie 綁 origin，**兩個網域仍要各自登入一次**。除非兩站在同一個父網域下並刻意設定 cookie `domain`（要做先討論），否則不要對外宣稱「單一登入」。

---

## 3. 部署指令與實際上傳的內容

```bash
vp run deploy    # = vp run build + wrangler deploy
```

實際部署的東西：

| 項目                      | 來源                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| Worker 程式               | `dist/civic_talk/`（`vite build` 產物）                                   |
| 靜態資產（`ASSETS` 綁定） | **`dist/client/`**——build 時由 `public/` 複製而來，不是直接上傳 `public/` |
| 部署設定                  | `dist/civic_talk/wrangler.json`（由 `wrangler.jsonc` 產生）               |

幾個容易誤解的點：

- **`public/styles.css`（與 build 產生的 client bundle）是建置產物**。改了 `.vue` 或樣式後若沒重跑 build，deploy 上去的會是舊的前端程式碼。`vp run deploy` 內含 build，所以走這條指令不會出錯；但**不要**手動 `wrangler deploy` 而跳過 build。
- **`wrangler.jsonc` 裡 D1 綁定的 `"remote": true` 只影響本機開發**（`vp run dev` 用本機模擬、`vp run dev:remote` 連遠端）。正式環境本來就是真的資料庫，這個欄位不改變部署行為。
- **正式網域不在設定檔裡**（見 1.1）——`vp run deploy` 不會重建網域綁定，也不會因為設定檔沒寫就把它拆掉。
- **`compatibility_flags: ["nodejs_compat"]` 不能拿掉**。better-auth 直接 import `node:crypto` 與 `node:async_hooks`，少了這個 flag 連本機 dev 都起不來。
- 業務資料庫 `vtaiwan-civic-talks` 的 migration 需要另外跑，且 `--remote` 依不變量 7 **要先取得授權**：
  ```bash
  npx wrangler d1 migrations apply vtaiwan-civic-talks --remote
  ```

---

## 4. 部署後的煙霧測試

正式站 origin 是 `https://civic.vtaiwan.tw`。「已驗」欄記的是最近一次確認的日期；每次 deploy 後至少重跑前段那幾條。

| 檢查                               | 預期                                                                            | 已驗       |
| ---------------------------------- | ------------------------------------------------------------------------------- | ---------- |
| `GET /`                            | 200，議題列表正常渲染                                                           | 2026-08-11 |
| `GET /api/issues`                  | 200                                                                             | 2026-08-11 |
| `GET /api/me`（未登入）            | 401                                                                             | 2026-08-11 |
| `GET /api/auth/get-session`        | 200                                                                             | 2026-08-11 |
| `GET /api/auth/admin/list-users`   | **404**（本站刻意不開成員管理端點）                                             | 2026-08-11 |
| `GET /api/admin/stats`（未登入）   | 401                                                                             | 2026-08-11 |
| `GET /index.html`                  | 301 → `/`                                                                       | 2026-08-11 |
| `GET /privacy`、`GET /terms`       | 200                                                                             | 2026-08-11 |
| `GET /issue.html?id=1`             | 302 → `/issues/1`                                                               | —          |
| 瀏覽器開 `/admin`                  | 顯示 Google／GitHub 登入卡片                                                    | 2026-08-11 |
| 用 Google 登入                     | 導回 `/admin`；角色是 `admin`／`super-admin` 就進後台，否則顯示「沒有管理權限」 | 2026-08-11 |
| 用 GitHub 登入                     | 同樣能登入並導回原頁                                                            | 2026-08-11 |
| 用同一個 email 換 provider 登入    | 同一個帳號、同樣權限，**不會變成新帳號**                                        | —          |
| 登入後投稿素材／意見／議題         | 寫入成功，且該筆內容顯示投稿者名稱（email 只在勾選公開時才出現）                | 2026-08-11 |
| 登入後送出說明頁                   | 寫入成功且記錄 `author_id`；管理端看得到完整作者快照                            | —          |
| 登出後 `GET /api/me`               | 401                                                                             | —          |

> ⚠️ **`/api/auth/get-session` 回 200 不代表登入設定正確**——沒有 cookie 時它跟 callback 網址設錯或 `BETTER_AUTH_URL` 設錯的情況長得一樣。登入相關的列只能靠人工在瀏覽器實測；改網域或換金鑰後要重跑。

登入失敗時的判讀：

- `redirect_uri_mismatch` → 1.2 的 callback 網址沒設好（正式站要有 `https://civic.vtaiwan.tw/api/auth/callback/{google,github}`）。
- `/api/me` 回 **500**（而不是 401）→ `DB_AUTH` 綁定或 auth 表有問題，看 Worker log。
- 停在「沒有管理權限」→ 該帳號在 `vtaiwan-auth` 的 `role` 不是 `admin`／`super-admin`。**要調角色請到 vTaiwan-hono 的後台**，本站依不變量 11 不寫 `user.role`。

---

## 5. 已知限制

- **登入主流程已實測**（Google／GitHub 登入、admin 進後台、登入後投稿，2026-08-11）；**尚未實證**：同一個 email 換 provider 登入是否落到同一個帳號、說明頁寫入的作者快照與管理端完整快照。
- **有自動化測試但沒有 CI**：`src/tests/` 有三個 Vitest 檔（i18n key 同步、作者隱私投影、markdown 安全渲染），跑 `vp test`；但沒有任何 CI 會自動跑，上述煙霧測試也全靠人工。
- **管理端不支援跨來源呼叫**：session 走 cookie，而回應刻意不給 `Access-Control-Allow-Credentials`，因此跨來源請求帶不到 cookie，一律得到 401。公開的讀取端點仍維持 `Access-Control-Allow-Origin: *`。
