<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useI18n } from '../l10n'

const props = defineProps<{ readonly issueId: number }>()
const emit = defineEmits<{ vote: []; compose: [] }>()
const { t, locale } = useI18n()
const { authState, session } = useAuth()
const viewerId = computed(() => (authState.value === 'signed-in' ? session.value?.user.id : undefined))

const statusKeys = {
  insufficient: 'opinion_synthesis_insufficient',
  unclustered: 'opinion_synthesis_unclustered',
  clustered: 'opinion_synthesis_clustered',
  capacity: 'opinion_synthesis_capacity',
} as const
const statisticKeys = {
  common_agree: 'opinion_synthesis_common_agree',
  common_disagree: 'opinion_synthesis_common_disagree',
  tension: 'opinion_synthesis_tension',
} as const
const reportKeys = {
  unavailable: 'opinion_synthesis_report_unavailable',
  pending: 'opinion_synthesis_report_pending',
  ready: 'opinion_synthesis_report_unavailable',
  failed: 'opinion_synthesis_report_failed',
} as const
const sectionKeys = {
  common_ground: 'opinion_synthesis_common_ground',
  tensions: 'opinion_synthesis_tensions',
  group_perspectives: 'opinion_synthesis_group_perspectives',
} as const

type Group = { readonly id: number; readonly size: number; readonly x: number | null; readonly y: number | null }
type GroupSignal = { readonly id: number; readonly direction: 'agree' | 'disagree' }
type Statistic = { readonly opinionId: number; readonly body: string; readonly kind: keyof typeof statisticKeys; readonly groups: readonly GroupSignal[] }
type ReportSection = { readonly kind: keyof typeof sectionKeys; readonly text: string; readonly opinionIds: readonly number[] }
type Synthesis = {
  readonly status: keyof typeof statusKeys
  readonly qualifiedParticipants: number
  readonly votesRequired: number
  readonly groups: readonly Group[]
  readonly myGroup: number | null
  readonly statistics: readonly Statistic[]
  readonly reportStatus: keyof typeof reportKeys
  readonly report: { readonly sections: readonly ReportSection[]; readonly generatedAt: number } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCoordinate(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isSynthesis(value: unknown): value is Synthesis {
  if (!isRecord(value)) return false
  return (
    typeof value.status === 'string' &&
    Object.hasOwn(statusKeys, value.status) &&
    isCount(value.qualifiedParticipants) &&
    isCount(value.votesRequired) &&
    (value.myGroup === null || isCount(value.myGroup)) &&
    Array.isArray(value.groups) &&
    value.groups.every((group: unknown) => isRecord(group) && isCount(group.id) && isCount(group.size) && isCoordinate(group.x) && isCoordinate(group.y)) &&
    Array.isArray(value.statistics) &&
    value.statistics.every(
      (item: unknown) =>
        isRecord(item) &&
        isCount(item.opinionId) &&
        item.opinionId > 0 &&
        typeof item.body === 'string' &&
        typeof item.kind === 'string' &&
        Object.hasOwn(statisticKeys, item.kind) &&
        Array.isArray(item.groups) &&
        item.groups.every((group: unknown) => isRecord(group) && isCount(group.id) && (group.direction === 'agree' || group.direction === 'disagree'))
    ) &&
    typeof value.reportStatus === 'string' &&
    Object.hasOwn(reportKeys, value.reportStatus) &&
    (value.report === null ||
      (isRecord(value.report) &&
        isCount(value.report.generatedAt) &&
        Array.isArray(value.report.sections) &&
        value.report.sections.every(
          (section: unknown) =>
            isRecord(section) &&
            typeof section.kind === 'string' &&
            Object.hasOwn(sectionKeys, section.kind) &&
            typeof section.text === 'string' &&
            Array.isArray(section.opinionIds) &&
            section.opinionIds.every((id: unknown) => isCount(id) && id > 0)
        )))
  )
}

const mounted = ref(false)
const retry = ref(0)
const result = ref<Synthesis | null>(null)
const failed = ref(false)
const aggregate = computed(() => result.value?.status === 'unclustered')
const myGroup = computed(() => {
  const current = result.value
  if (!viewerId.value || current?.status !== 'clustered') return null
  return current.groups.find(group => group.id === current.myGroup)?.id ?? null
})

const opinionSlots = [
  [-37, -25],
  [29, -28],
  [-6, 19],
  [54, 5],
  [-53, 18],
  [26, 38],
  [-4, -14],
  [-33, 42],
  [12, -43],
  [67, 23],
  [-63, -9],
  [9, 48],
  [30, 5],
  [-25, 7],
  [49, -17],
  [-53, -36],
] as const

const mapGroups = computed(() => {
  const groups = result.value?.groups.flatMap(group => (group.x === null || group.y === null ? [] : [{ ...group, x: group.x, y: group.y }])) ?? []
  if (!groups.length) return []
  const statistics = result.value?.statistics ?? []
  const xs = groups.map(group => group.x)
  const ys = groups.map(group => group.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const spanX = Math.max(...xs) - minX
  const spanY = Math.max(...ys) - minY
  const scale = 1 / Math.max(spanX / 218, spanY / 40, Number.EPSILON)
  return groups.map(group => ({
    id: group.id,
    size: group.size,
    x: 220 + (group.x - minX - spanX / 2) * scale,
    y: 117 - (group.y - minY - spanY / 2) * scale,
    // 點位只排版公開的群組同意證據，不從投票者的位置、票數或群內分布推導。
    opinions: statistics
      .filter(opinion => opinion.groups.some(signal => signal.id === group.id && signal.direction === 'agree'))
      .slice(0, opinionSlots.length)
      .map((opinion, index) => ({ id: opinion.opinionId, body: opinion.body, x: opinionSlots[index][0], y: opinionSlots[index][1] })),
  }))
})

watch([mounted, () => props.issueId, locale, authState, viewerId, retry], ([active, issueId, language, auth], _, onCleanup) => {
  result.value = null
  failed.value = false
  if (!active || auth === 'loading') return

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    controller.abort()
    clearTimeout(timer)
  })

  async function load(remainingPolls: number) {
    let payload: unknown
    try {
      const response = await fetch(`/api/issues/${issueId}/opinions/synthesis?language=${language}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
      payload = response.ok ? await response.json() : null
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
    if (controller.signal.aborted) return
    if (!isSynthesis(payload)) {
      if (!result.value) failed.value = true
      return
    }
    result.value = payload
    if (payload.reportStatus === 'pending' && remainingPolls > 0) {
      timer = setTimeout(() => void load(remainingPolls - 1), 4000)
    }
  }

  void load(3)
})

onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <section class="mx-auto mb-8 max-w-prose space-y-6 wrap-anywhere" aria-labelledby="opinion-synthesis-title">
    <h3 id="opinion-synthesis-title" class="m-0 font-serif text-lg">{{ t('opinion_synthesis_view') }}</h3>
    <div v-if="failed" class="space-y-2">
      <p role="alert">{{ t('opinion_synthesis_load_error') }}</p>
      <button type="button" class="btn btn-secondary min-h-11 focus-visible:outline-2 focus-visible:outline-offset-4" @click="retry++">
        {{ t('op_card_retry') }}
      </button>
    </div>
    <p v-else-if="!result" role="status">{{ t('loading') }}</p>
    <template v-else>
      <div role="status" class="space-y-2">
        <p class="m-0 font-medium">{{ t(statusKeys[result.status]) }}</p>
        <p v-if="result.status !== 'capacity'" class="m-0 text-sm text-vt-fg-2 tabular-nums">
          {{ t('opinion_synthesis_progress', { count: result.qualifiedParticipants, votes: result.votesRequired }) }}
        </p>
      </div>
      <div v-if="result.status === 'insufficient' || result.status === 'unclustered'" class="flex flex-wrap gap-2">
        <button v-if="result.votesRequired > 0" type="button" class="btn btn-primary min-h-11 focus-visible:outline-2 focus-visible:outline-offset-4" @click="emit('vote')">
          {{ t('opinion_synthesis_vote') }}
        </button>
        <button type="button" class="btn btn-secondary min-h-11 focus-visible:outline-2 focus-visible:outline-offset-4" @click="emit('compose')">
          {{ t('op_start_commit') }}
        </button>
      </div>

      <template v-if="result.groups.length">
        <section aria-labelledby="opinion-synthesis-groups" class="space-y-3">
          <h4 id="opinion-synthesis-groups" class="m-0 font-serif text-base">{{ t('opinion_synthesis_groups') }}</h4>
          <p v-if="myGroup !== null" class="m-0 font-medium">{{ t('opinion_synthesis_my_group', { id: myGroup }) }}</p>
          <figure v-if="mapGroups.length" class="m-0 space-y-2">
            <svg viewBox="0 0 440 218" role="img" aria-labelledby="opinion-synthesis-map-caption" class="mx-auto block w-full max-w-lg rounded-xl border border-vt-border bg-vt-bg-2">
              <g v-for="(group, index) in mapGroups" :key="group.id" :class="index % 2 === 0 ? 'text-vt-jade-green' : 'text-vt-wheat-yellow'" :transform="`translate(${group.x},${group.y})`">
                <polygon
                  points="-90,-12 -70,-53 -22,-68 34,-64 76,-43 89,6 71,47 18,65 -35,61 -78,36"
                  :transform="aggregate ? 'scale(1.6 1)' : index % 2 === 0 ? undefined : 'scale(-1 1)'"
                  fill="currentColor"
                  fill-opacity=".16"
                  stroke="currentColor"
                  stroke-opacity=".64"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                />
                <circle v-for="opinion in group.opinions" :key="opinion.id" :cx="opinion.x" :cy="opinion.y" r="4.5" fill="currentColor">
                  <title>{{ opinion.body }}</title>
                </circle>
                <text y="-77" text-anchor="middle" class="fill-vt-fg-1 text-base font-semibold">
                  {{ aggregate ? t('opinion_synthesis_aggregate_size', { count: group.size }) : t('opinion_synthesis_group_size', { id: group.id, count: group.size }) }}
                </text>
              </g>
            </svg>
            <figcaption id="opinion-synthesis-map-caption" class="text-sm text-vt-fg-2">{{ t(aggregate ? 'opinion_synthesis_aggregate_map' : 'opinion_synthesis_map') }}</figcaption>
          </figure>
          <ul class="m-0 list-inside list-disc space-y-1 tabular-nums">
            <li v-for="group in result.groups" :key="group.id">
              {{ aggregate ? t('opinion_synthesis_aggregate_size', { count: group.size }) : t('opinion_synthesis_group_size', { id: group.id, count: group.size }) }}
            </li>
          </ul>
        </section>

        <section aria-labelledby="opinion-synthesis-statistics" class="space-y-3">
          <h4 id="opinion-synthesis-statistics" class="m-0 font-serif text-base">{{ t('opinion_synthesis_statistics') }}</h4>
          <p v-if="!result.statistics.length" class="m-0 text-vt-fg-2">{{ t(aggregate ? 'opinion_synthesis_aggregate_no_statistics' : 'opinion_synthesis_no_statistics') }}</p>
          <ul v-else class="m-0 list-none divide-y divide-vt-border p-0">
            <li v-for="item in result.statistics" :key="`${item.opinionId}-${item.kind}`" class="space-y-2 py-3">
              <p class="m-0 text-sm font-medium">
                {{ t(aggregate && item.kind !== 'tension' ? (item.kind === 'common_agree' ? 'opinion_synthesis_aggregate_agree' : 'opinion_synthesis_aggregate_disagree') : statisticKeys[item.kind]) }}
              </p>
              <p class="m-0 whitespace-pre-wrap">{{ item.body }}</p>
              <ul v-if="!aggregate && item.groups.length" class="m-0 list-inside list-disc text-sm text-vt-fg-2">
                <li v-for="group in item.groups" :key="group.id">
                  {{ t(group.direction === 'agree' ? 'opinion_synthesis_group_agree' : 'opinion_synthesis_group_disagree', { id: group.id }) }}
                </li>
              </ul>
              <a
                :href="`/issues/${issueId}/comment/${item.opinionId}`"
                class="inline-flex min-h-11 items-center text-vt-fg-1 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                {{ t('opinion_synthesis_citation', { id: item.opinionId }) }}
              </a>
            </li>
          </ul>
        </section>

        <section aria-labelledby="opinion-synthesis-report" class="space-y-3">
          <h4 id="opinion-synthesis-report" class="m-0 font-serif text-base">{{ t('opinion_synthesis_report') }}</h4>
          <p class="m-0 text-sm text-vt-fg-2">{{ t(aggregate ? 'opinion_synthesis_aggregate_report_notice' : 'opinion_synthesis_report_notice') }}</p>
          <template v-if="result.reportStatus === 'ready' && result.report?.sections.length">
            <div v-for="section in result.report.sections" :key="section.kind" class="space-y-2 border-t border-vt-border pt-3">
              <h5 class="m-0 font-medium">{{ t(aggregate && section.kind === 'common_ground' ? 'opinion_synthesis_aggregate_report_heading' : sectionKeys[section.kind]) }}</h5>
              <p class="m-0 whitespace-pre-wrap">{{ section.text }}</p>
              <ul class="m-0 flex list-none flex-wrap gap-x-4 p-0">
                <li v-for="id in section.opinionIds" :key="id">
                  <a
                    :href="`/issues/${issueId}/comment/${id}`"
                    class="inline-flex min-h-11 items-center text-vt-fg-1 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                  >
                    {{ t('opinion_synthesis_citation', { id }) }}
                  </a>
                </li>
              </ul>
            </div>
          </template>
          <p v-else class="m-0" role="status">{{ t(reportKeys[result.reportStatus]) }}</p>
        </section>
      </template>
    </template>

    <p class="m-0 border-t border-vt-border pt-4 text-sm text-vt-fg-2">{{ t('opinion_synthesis_privacy') }}</p>
  </section>
</template>
