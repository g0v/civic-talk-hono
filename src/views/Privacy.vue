<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue'
import AppFooter from '../components/AppFooter.vue'
import { useI18n } from '../l10n'

const { t } = useI18n()
</script>

<template>
  <div>
    <AppHeader current="home" />

    <main class="py-10">
      <div class="container max-w-3xl">
        <div class="card">
          <h1 class="mb-8 font-serif text-3xl font-bold">{{ t('privacy_page_title') }}</h1>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">引言</h2>
            <p class="mb-3 leading-relaxed text-gray-700">
              Civic Talk（以下簡稱「平台」）致力於保護使用者的隱私。本隱私權政策說明平台如何收集、使用、儲存及保護您的個人資料。平台由 vTaiwan 公民科技社群維護，作為開放原始碼的公共審議工具。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">我們收集的資料</h2>
            <p class="mb-3 leading-relaxed text-gray-700">平台透過以下方式收集資料：</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li><strong>OAuth 帳號資訊</strong>：當您以 Google 或 GitHub 登入時，平台取得您的顯示名稱與 email，並由 Better Auth 建立平台內部使用的 user ID。</li>
              <li>
                <strong>使用者生成內容與作者快照</strong>：您建立的議題、提交的素材、發表的意見或志願者送出的彙整，以及提交時間、user ID、提交當下的顯示名稱與 email 快照、是否公開 email 的選擇。
              </li>
              <li><strong>條款同意記錄</strong>：建立議題、投稿素材或意見時所接受的條款版本與伺服器記錄的同意時間。</li>
              <li><strong>技術資料</strong>：IP 位址、瀏覽器類型、存取時間等伺服器日誌，用於安全與效能監控。</li>
            </ul>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">具名行為說明</h2>
            <div class="mb-4 border-l-4 border-red-400 bg-red-50 p-4">
              <p class="font-semibold text-red-800">重要：在本平台建立議題、提交素材、發表意見均為具名行為</p>
            </div>
            <p class="mb-3 leading-relaxed text-gray-700">
              為確保內容品質與可追溯性，上述行為提交後，您提交當下的 OAuth 顯示名稱將公開附在對應的議題、素材或意見上，所有訪客均可查看。日後修改帳號名稱不會追溯變更既有內容的署名。
            </p>
            <p class="mb-3 leading-relaxed text-gray-700">若 OAuth 帳號沒有提供顯示名稱，平台會顯示固定的「未提供顯示名稱」提示，不會以 email 代替。</p>
            <p class="mb-3 leading-relaxed text-gray-700">提交時，您可以選擇是否公開您的 email：</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li><strong>選擇公開 email</strong>：提交當下的 email 快照將隨顯示名稱一同公開呈現在該筆內容上，供其他訪客查看。</li>
              <li><strong>不公開 email</strong>：email 快照仍會為濫用追溯而保存在業務資料庫，但公開 API、頁面與 SSR 原始碼不會回傳；僅限具管理權限者於必要時存取。</li>
            </ul>
            <p class="leading-relaxed text-gray-700">user ID 是 Better Auth 產生的平台內部識別碼，不是 Google 或 GitHub 的公開帳號名稱；一律不公開顯示。志願者送出的彙整目前也不公開任何作者欄位。</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">資料使用目的</h2>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li>提供並維護平台服務（議題建立、素材收集、意見匯聚）</li>
              <li>確保內容品質：具名提交可降低惡意投稿的風險</li>
              <li>在有濫用情形時進行追溯與調查</li>
            </ul>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">資料分享</h2>
            <p class="mb-3 leading-relaxed text-gray-700">除必要的基礎設施服務（Cloudflare Workers 平台）外，平台不會將您的個人資料出售、出租或分享給第三方用於商業目的。</p>
            <div class="mb-3 border-l-4 border-amber-400 bg-amber-50 p-4">
              <p class="font-semibold text-amber-800">執法配合聲明</p>
              <p class="mt-1 text-amber-900">
                若有使用者濫用平台（包含但不限於散布不實資訊、騷擾他人、非法內容等），平台保留依法配合主管機關（包含警察機關）調查、提供相關使用記錄的權利。<strong
                  >上述記錄包括但不限於：帳號 ID、OAuth 顯示名稱、email（無論使用者是否選擇公開）、提交時間與 IP 位址等技術資料。</strong
                >
              </p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">資料安全</h2>
            <p class="leading-relaxed text-gray-700">平台以 Cloudflare Workers 部署，並以 D1（SQLite）儲存資料。我們採取合理的技術措施保護資料安全，防止未經授權的存取。</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">使用者權利</h2>
            <p class="mb-3 leading-relaxed text-gray-700">您對自己的個人資料享有以下權利：</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li><strong>存取權</strong>：要求查看平台持有的您的個人資料</li>
              <li><strong>更正權</strong>：若您的 OAuth 顯示名稱已更新，下次登入後提交的內容將反映新名稱；歷史記錄中的顯示名稱為提交當下的快照，平台不提供追溯修改。</li>
              <li>
                <strong>刪除與匿名化權</strong
                >：要求刪除帳號或匿名化內容中的作者快照。由於內容資料與共用認證資料庫分開保存，刪除登入帳號不會自動刪除既有內容的作者快照；平台收到請求後會另行處理，惟依法或為處理爭議所需者可能在必要期間內保留。
              </li>
            </ul>
            <p class="leading-relaxed text-gray-700">如需行使上述權利，請透過下方聯絡方式與我們聯絡。</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">聯絡我們</h2>
            <div class="rounded-lg bg-gray-50 p-4">
              <p class="mb-2"><strong>電子郵件：</strong> info@vtaiwan.tw</p>
              <p class="mb-0">
                <strong>GitHub：</strong>
                <a href="https://github.com/g0v/civic-talk-hono" class="text-red underline hover:opacity-80" target="_blank" rel="noopener noreferrer">github.com/g0v/civic-talk-hono</a>
              </p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">政策更新</h2>
            <p class="mb-2 leading-relaxed text-gray-700">我們可能不時更新本隱私權政策。重大變更將在平台上公告。</p>
            <p class="text-sm text-muted">最後更新：2026 年 8 月</p>
          </section>

          <div class="mt-8">
            <a href="/" class="btn btn-secondary">{{ t('policy_back_home') }}</a>
          </div>
        </div>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
