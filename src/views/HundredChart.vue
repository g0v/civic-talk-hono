<script setup lang="ts">
import { computed, ref } from 'vue'
import NavBar from '../components/NavBar.vue'

/** v-model 綁定的原始字串；SSR 與首次 hydrate 皆為空字串，避免 mismatch */
const factorRaw = ref('')

const factor = computed(() => {
  const n = Number(factorRaw.value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
})

function cellStyle(n: number): Record<string, string> {
  const f = factor.value
  if (f == null) return {}
  if (n % f === 0) return { backgroundColor: '#e9d5ff' }
  return {}
}

const rows = computed(() =>
  Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 10 }, (_, col) => row * 10 + col + 1),
  ),
)
</script>

<template>
  <div class="hundred-root">
    <NavBar current="hundred" />
    <main class="container hundred-main">
      <h1>百數表 · Hydration 示範</h1>
      <p class="lead">
        此頁在 Worker 端 SSR 後，由瀏覽器載入 client bundle 進行
        <strong>hydration</strong>。下方使用 <code>v-model</code>、雙層
        <code>v-for</code>、以及 <code>:style</code> 動態著色，可在無重新整理的情況下互動。
      </p>

      <section class="hundred-controls" aria-label="倍數著色">
        <label class="control-label" for="factor-input">
          倍數（輸入正整數，例如 3，將 3 的倍數格以淺紫底色標示）
        </label>
        <input
          id="factor-input"
          v-model="factorRaw"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          class="factor-input"
          placeholder="例如 3"
        />
      </section>

      <div class="table-wrap" role="region" aria-label="1 到 100 百數表">
        <table class="hundred-table">
          <tbody>
            <tr v-for="(cells, r) in rows" :key="r">
              <td
                v-for="n in cells"
                :key="n"
                class="hundred-cell"
                :style="cellStyle(n)"
              >
                {{ n }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>
</template>
