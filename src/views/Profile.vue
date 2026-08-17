<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppFooter from '../components/AppFooter.vue'
import AppHeader from '../components/AppHeader.vue'
import SignInButtons from '../components/SignInButtons.vue'
import { updateProfileName } from '../client/auth-session'
import { useAuth } from '../composables/useAuth'
import { DISPLAY_NAME_MAX_LENGTH, isNameChangeCooldownPayload, NAME_CHANGE_COOLDOWN_DAYS, normalizeDisplayName } from '../lib/profile-name'
import { useI18n } from '../l10n'
const { t } = useI18n()
const { authState, session, ensureAuthSession, signOutAndReload, updateSessionName } = useAuth()
const editing = ref(false)
const saving = ref(false)
const draftName = ref('')
const errorMessage = ref('')
const localCooldownDays = ref<number | null>(null)
const cooldownDays = computed(() => localCooldownDays.value ?? session.value?.nameChangeCooldownDays ?? null)
const displayName = computed(() => session.value?.user.name || session.value?.user.email || t('profile_name_not_set'))
const avatarImage = computed(() => session.value?.user.image ?? null)
const avatarInitial = computed(() => displayName.value.charAt(0).toUpperCase())
const hasChanges = computed(() => !!session.value && draftName.value !== session.value.user.name)

onMounted(async () => {
  await ensureAuthSession()
})

function startEditing() {
  draftName.value = session.value?.user.name ?? ''
  errorMessage.value = ''
  editing.value = true
}

function cancelEditing() {
  draftName.value = session.value?.user.name ?? ''
  errorMessage.value = ''
  editing.value = false
}

async function saveName() {
  if (!session.value || saving.value || !hasChanges.value || cooldownDays.value !== null) return

  const name = normalizeDisplayName(draftName.value)
  if (!name) {
    errorMessage.value = t('profile_name_invalid')
    return
  }
  if (!window.confirm(t('profile_name_confirm', { days: NAME_CHANGE_COOLDOWN_DAYS }))) return

  try {
    saving.value = true
    errorMessage.value = ''
    const { error } = await updateProfileName(name)
    if (error) throw error

    updateSessionName(name)
    localCooldownDays.value = NAME_CHANGE_COOLDOWN_DAYS
    editing.value = false
  } catch (error) {
    errorMessage.value = t(isNameChangeCooldownPayload(error) ? 'profile_name_cooldown' : 'profile_update_failed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <AppHeader current="profile" />

    <main class="py-10">
      <div class="container max-w-2xl">
        <!-- SSR 與 hydration 首幀都不猜登入狀態，避免 cookie 導致 mismatch。 -->
        <section v-if="authState === 'loading'" class="card" aria-busy="true">
          <div class="h-8 w-32 animate-pulse rounded bg-gray-200" />
          <div class="mt-8 h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        </section>

        <section v-else-if="authState === 'anonymous'" class="card">
          <p class="section-label">{{ t('profile_eyebrow') }}</p>
          <h1 class="page-title">{{ t('profile_title') }}</h1>
          <p class="page-subtitle">{{ t('profile_login_required') }}</p>
          <SignInButtons callback-url="/profile" />
        </section>

        <section v-else class="card">
          <p class="section-label">{{ t('profile_eyebrow') }}</p>
          <div class="mb-8 flex items-center gap-4 border-b border-border pb-6">
            <div class="avatar avatar-lg h-14 w-14 text-lg" aria-hidden="true">
              <img v-if="avatarImage" :src="avatarImage" :alt="displayName" referrerpolicy="no-referrer" />
              <span v-else>{{ avatarInitial }}</span>
            </div>
            <div class="min-w-0">
              <h1 class="page-title mb-1 truncate">{{ displayName }}</h1>
              <p class="m-0 truncate text-sm text-muted">{{ session?.user.email }}</p>
            </div>
          </div>

          <div v-if="!editing" class="space-y-6">
            <dl class="grid gap-4 sm:grid-cols-2">
              <div class="rounded-lg border border-border bg-gray-50 dark:bg-gray-800 p-4">
                <dt class="mb-1 text-sm font-medium text-muted">{{ t('profile_name_label') }}</dt>
                <dd class="m-0 break-words font-medium">{{ displayName }}</dd>
              </div>
              <div class="rounded-lg border border-border bg-gray-50 dark:bg-gray-800 p-4">
                <dt class="mb-1 text-sm font-medium text-muted">{{ t('profile_email_label') }}</dt>
                <dd class="m-0 break-all">{{ session?.user.email }}</dd>
              </div>
            </dl>

            <div v-if="cooldownDays !== null" class="alert alert-info">
              {{ t('profile_name_cooldown_remaining', { days: cooldownDays }) }}
            </div>

            <div class="flex flex-wrap gap-3">
              <button type="button" class="btn btn-primary" :disabled="cooldownDays !== null" @click="startEditing">
                {{ t('profile_edit_name') }}
              </button>
              <button type="button" class="btn btn-secondary" @click="signOutAndReload">
                {{ t('logout') }}
              </button>
            </div>
          </div>

          <form v-else class="space-y-5" @submit.prevent="saveName">
            <div class="form-group mb-0">
              <label for="profile-name">{{ t('profile_name_label') }}</label>
              <input id="profile-name" v-model="draftName" required :maxlength="DISPLAY_NAME_MAX_LENGTH" autocomplete="name" :disabled="saving" />
              <p class="mt-2 mb-0 text-sm text-muted">{{ t('profile_name_hint') }}</p>
              <p v-if="cooldownDays !== null" class="mt-2 mb-0 text-sm text-red">
                {{ t('profile_name_cooldown_remaining', { days: cooldownDays }) }}
              </p>
            </div>

            <div>
              <p class="mb-2 text-sm font-medium">{{ t('profile_email_label') }}</p>
              <p class="m-0 rounded-lg border border-border bg-gray-50 dark:bg-gray-800 px-3 py-2 text-muted">{{ session?.user.email }}</p>
            </div>

            <p v-if="errorMessage" class="alert alert-warn mb-0" role="alert">{{ errorMessage }}</p>

            <div class="flex flex-wrap gap-3">
              <button type="submit" class="btn btn-primary" :disabled="saving || !hasChanges || cooldownDays !== null">
                {{ saving ? t('profile_saving') : t('save') }}
              </button>
              <button type="button" class="btn btn-secondary" :disabled="saving" @click="cancelEditing">
                {{ t('cancel') }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>

    <AppFooter />
  </div>
</template>
