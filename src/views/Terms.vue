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
          <h1 class="mb-8 font-serif text-3xl font-bold">{{ t('terms_page_title') }}</h1>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">引言</h2>
            <p class="mb-3 leading-relaxed text-gray-700">
              歡迎使用 Civic Talk 公民審議平台。本使用條款規範您對本平台服務的使用。本平台由 vTaiwan 公民科技社群維護，目的是降低公眾參與公共議題的門檻。使用本平台即表示您同意遵守本條款。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">接受條款</h2>
            <p class="leading-relaxed text-gray-700">
              透過使用本平台服務，您表示已閱讀、理解並同意本使用條款及
              <a href="/privacy" class="text-red underline hover:opacity-80">隱私權政策</a>。
              如不同意，請勿使用本平台。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">具名行為與責任</h2>
            <div class="mb-4 border-l-4 border-red-400 bg-red-50 p-4">
              <p class="font-semibold text-red-800">重要：在本平台提交任何內容均為具名行為</p>
            </div>
            <p class="mb-3 leading-relaxed text-gray-700">
              <strong>建立議題、提交素材、發表意見</strong>均為具名行為。提交後，您的 OAuth 顯示名稱（即您在 Google 或 GitHub 上的帳號名稱）將公開附在對應內容上，所有訪客均可查看。
            </p>
            <p class="mb-3 leading-relaxed text-gray-700">
              提交時，您可以勾選「公開我的 email」選項。若選擇公開，您的 email 將隨顯示名稱一同公開顯示；若未選擇，email 僅供平台內部使用及在必要時配合調查（見「執法配合」）。
            </p>
            <p class="leading-relaxed text-gray-700">
              具名提交的目的是確保內容品質與可追溯性，讓每一份議題、素材與意見都有明確的提交者負責。請在提交前確認您願意以自己的名字為該內容負責。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">帳戶要求</h2>
            <p class="mb-3 leading-relaxed text-gray-700">建立議題、提交素材及發表意見均需以 Google 或 GitHub 帳號登入。登入帳號與 vTaiwan 平台共用。您有責任妥善保管您的帳號安全，不得讓他人使用您的帳號提交內容。</p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">素材授權規範</h2>
            <div class="mb-4 border-l-4 border-amber-400 bg-amber-50 p-4">
              <p class="font-semibold text-amber-800">提交素材前，請查明來源的授權或合理使用範圍</p>
            </div>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li>若來源授權允許轉載（如 CC 授權、官方開放資料），可提交全文，但請在來源欄位標明出處。</li>
              <li>若授權不明確，建議僅摘要原文 <strong>1/3 以下</strong>的篇幅，並附上來源連結，以符合合理引用原則，降低侵權風險。</li>
              <li>請勿提交您無權轉載的完整著作內容。</li>
            </ul>
            <p class="leading-relaxed text-gray-700">
              素材的授權責任由提交者自行承擔。平台保留移除侵權疑慮內容的權利。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">行為規範</h2>
            <p class="mb-3 leading-relaxed text-gray-700">使用本平台時，您同意：</p>
            <ul class="mb-3 list-disc pl-6 leading-relaxed text-gray-700">
              <li>尊重其他使用者，進行建設性的公民討論</li>
              <li>不提交違法、虛假、有害、騷擾性或攻擊性的內容</li>
              <li>不濫用平台機制（如大量重複提交、惡意操作）</li>
              <li>遵守中華民國（台灣）及您所在地的相關法律法規</li>
            </ul>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">執法配合</h2>
            <div class="mb-4 border-l-4 border-amber-400 bg-amber-50 p-4">
              <p class="font-semibold text-amber-800">平台保留依法配合調查的權利</p>
              <p class="mt-1 text-amber-900">
                若有使用者濫用平台（包含但不限於散布不實資訊、騷擾、非法內容），平台保留依法配合主管機關（包含警察機關）調查、提供相關使用記錄與帳號資料的權利。<strong>上述資料包括但不限於：帳號 ID、OAuth 顯示名稱、email（無論使用者是否選擇公開）、提交時間與 IP 位址等技術資料。</strong>若有必要，平台將依法律程序配合提供前述資料。
              </p>
            </div>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">內容授權</h2>
            <p class="leading-relaxed text-gray-700">
              您在本平台發布的意見摘要，以 <strong>CC-BY-SA 4.0</strong> 授權公開。素材的授權依各來源的授權條款為準；提交者須自行確認授權範圍（見「素材授權規範」）。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">免責聲明</h2>
            <p class="leading-relaxed text-gray-700">
              本平台按「現狀」提供服務，不提供任何明示或暗示的保證。平台不承擔因使用服務（包含素材內容、意見觀點）而產生的任何直接或間接損失。平台上的素材與意見僅代表提交者個人立場，不代表 vTaiwan 或平台的官方立場。
            </p>
          </section>

          <section class="mb-8">
            <h2 class="mb-3 text-xl font-semibold">條款修改</h2>
            <p class="mb-2 leading-relaxed text-gray-700">
              我們保留隨時修改本使用條款的權利。修改後的條款將在平台上公告；繼續使用本平台即表示接受修改後的條款。
            </p>
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
            <h2 class="mb-3 text-xl font-semibold">生效日期</h2>
            <p class="text-sm text-muted">本使用條款自公佈之日起生效。最後更新：2026 年 8 月</p>
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
