<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 1024, max: 32768 }"
    :context-help-text="`Context window size in tokens. Should match the context length KoboldCpp was launched with.`"
    provider="koboldcpp"
    :model="localApiConfig.model || ''"
  >
    <template #api-config>
      <div class="form-group">
        <label for="koboldBaseURL">Base URL</label>
        <input
          id="koboldBaseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="http://localhost:5001/api"
        />
        <small class="help-text">
          URL of your running KoboldCpp instance (default port 5001). The trailing <code>/api</code>
          is optional. If Writer's Guild runs in Docker and KoboldCpp runs on the host or another
          machine, use that host's IP or <code>host.docker.internal</code> instead of localhost.
        </small>
      </div>

      <div class="form-group">
        <label for="koboldPassword">Password <span class="optional">(optional)</span></label>
        <input
          id="koboldPassword"
          v-model="localApiConfig.password"
          type="password"
          class="text-input"
          placeholder="Leave empty if KoboldCpp has no --password set"
        />
        <small class="help-text">Only needed if KoboldCpp was launched with <code>--password</code>.</small>
      </div>

      <div class="form-group">
        <label>Loaded Model</label>
        <div class="model-row">
          <button
            type="button"
            class="btn btn-secondary btn-small"
            @click="detectEndpoint"
            :disabled="detecting || !localApiConfig.baseURL"
          >
            <i :class="detecting ? 'fas fa-spinner fa-spin' : 'fas fa-sync'"></i>
            {{ detecting ? 'Detecting...' : 'Detect Settings' }}
          </button>
          <span v-if="localApiConfig.model" class="model-name">{{ localApiConfig.model }}</span>
          <span v-else class="model-name model-empty">Not detected yet</span>
        </div>
        <div v-if="detectError" class="error-message">{{ detectError }}</div>
        <small class="help-text">
          Confirms the endpoint is reachable, then pulls the loaded model name plus Kobold's
          configured max context window and max generation length into the form below.
        </small>
      </div>
    </template>
  </BaseProviderConfig>
</template>

<script setup>
import { ref, computed } from 'vue'
import BaseProviderConfig from './shared/BaseProviderConfig.vue'
import { presetsAPI } from '../../services/api'
import { useToast } from '../../composables/useToast'

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:config'])

const toast = useToast()

const detecting = ref(false)
const detectError = ref(null)

const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
  }
})

async function detectEndpoint() {
  try {
    detecting.value = true
    detectError.value = null
    const response = await presetsAPI.getKoboldCppInfo(
      localApiConfig.value.baseURL,
      localApiConfig.value.password
    )
    const modelName = response.model || ''
    const maxContext = response.maxContextLength
    const maxLength = response.maxLength

    // Emit a single update so reactive computed props in the parent pick up everything.
    const nextConfig = {
      ...props.config,
      apiConfig: { ...(props.config.apiConfig || {}), model: modelName }
    }
    const nextGenSettings = { ...(props.config.generationSettings || {}) }
    let touched = false
    if (typeof maxContext === 'number' && maxContext > 0) {
      nextGenSettings.maxContextTokens = maxContext
      touched = true
    }
    if (typeof maxLength === 'number' && maxLength > 0) {
      nextGenSettings.maxTokens = maxLength
      touched = true
    }
    if (touched) nextConfig.generationSettings = nextGenSettings
    emit('update:config', nextConfig)

    const parts = []
    if (modelName) parts.push(`Model: ${modelName}`)
    if (typeof maxContext === 'number') parts.push(`Max context: ${maxContext}`)
    if (typeof maxLength === 'number') parts.push(`Max gen: ${maxLength}`)
    if (parts.length > 0) {
      toast.success(`Connected. ${parts.join(' · ')}`)
    } else {
      toast.success('Connected, but KoboldCpp did not report model or limits.')
    }
  } catch (error) {
    detectError.value = error.message || 'Failed to reach KoboldCpp'
    console.error('Failed to inspect KoboldCpp endpoint:', error)
  } finally {
    detecting.value = false
  }
}
</script>

<style scoped>
.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
}

.optional {
  font-weight: 400;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.text-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.help-text code {
  background-color: var(--bg-tertiary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.8rem;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.model-name {
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--text-primary);
  padding: 0.3rem 0.6rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.model-name.model-empty {
  color: var(--text-secondary);
  font-style: italic;
}

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background-color: var(--bg-quaternary);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-small {
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
}

.error-message {
  margin-top: 0.5rem;
  padding: 0.6rem;
  background-color: #fee;
  border: 1px solid #fcc;
  border-radius: 4px;
  color: #c33;
  font-size: 0.9rem;
}

.fa-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
