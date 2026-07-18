<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 32000, max: 1000000 }"
    :context-help-text="`Context window up to 1M tokens on V4 models. Larger = more story content but higher costs.`"
    provider="deepseek"
    :model="config.apiConfig?.model || ''"
  >
    <template #api-config>
      <!-- API Configuration Section -->
      <ApiConfigSection
        v-model="localApiConfig"
        provider-id="deepseek"
        placeholder="sk-..."
        help-text="Get your API key from https://platform.deepseek.com"
        base-u-r-l-placeholder="https://api.deepseek.com/v1"
      />

      <!-- Model Selection Section -->
      <ModelSelector
        :models="availableModels"
        :selected-model="localApiConfig.model"
        :loading="loadingModels"
        :error="modelsError"
        :can-fetch="!!localApiConfig.apiKey"
        description="Choose a DeepSeek V4 model. Both v4-flash (cheaper) and v4-pro (higher quality) support optional thinking mode — toggle it below independently of the model."
        empty-state-text="Enter your API key and click 'Fetch Available Models' to see available DeepSeek models."
        @fetch="fetchModels"
        @select="selectModel"
      />

      <!-- Thinking Mode Section -->
      <div class="thinking-mode-section">
        <div class="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              :checked="localGenerationSettings.thinking === true"
              @change="updateThinking($event.target.checked)"
            />
            Enable thinking mode
          </label>
          <small class="help-text">
            When enabled, the model produces a chain-of-thought before its answer. Reasoning
            consumes output tokens — if responses come back empty, raise Max Tokens. Sampling
            parameters (temperature, top_p, etc.) are ignored while thinking is on.
          </small>
        </div>

        <div v-if="localGenerationSettings.thinking === true" class="form-group">
          <label for="reasoningEffort">Reasoning Effort</label>
          <select
            id="reasoningEffort"
            :value="localGenerationSettings.reasoningEffort || 'high'"
            @change="updateReasoningEffort($event.target.value)"
            class="select-input"
          >
            <option value="high">High (default)</option>
            <option value="max">Max (longer reasoning, slower, more expensive)</option>
          </select>
          <small class="help-text"> Controls how much the model reasons before answering. </small>
        </div>
      </div>
    </template>
  </BaseProviderConfig>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import BaseProviderConfig from './shared/BaseProviderConfig.vue';
import ApiConfigSection from './shared/ApiConfigSection.vue';
import ModelSelector from './shared/ModelSelector.vue';
import { presetsAPI } from '../../services/api';
import { useModelSelector } from '../../composables/useModelSelector';

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['update:config']);

// Local computed for API config
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {};
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value });
  }
});

const localGenerationSettings = computed(() => props.config.generationSettings || {});

function updateThinking(enabled) {
  emit('update:config', {
    ...props.config,
    generationSettings: {
      ...localGenerationSettings.value,
      thinking: enabled
    }
  });
}

function updateReasoningEffort(value) {
  emit('update:config', {
    ...props.config,
    generationSettings: {
      ...localGenerationSettings.value,
      reasoningEffort: value
    }
  });
}

// Use the shared model selector composable
const {
  availableModels,
  loadingModels,
  modelsError,
  fetchAvailableModels,
  selectModel: baseSelectModel,
  formatContextLength
} = useModelSelector({
  apiConfig: localApiConfig,
  fetchModels: presetsAPI.getDeepSeekModels,
  updateConfig: (updates) => {
    // Update both API config and generation settings
    emit('update:config', {
      ...props.config,
      apiConfig: {
        ...localApiConfig.value,
        model: updates.model
      },
      generationSettings: {
        ...props.config.generationSettings,
        maxContextTokens: updates.contextLength
      }
    });
  }
});

// Wrapper to handle model selection
function selectModel(model) {
  baseSelectModel(model);
}

// Wrapper for fetch to make it simpler
function fetchModels() {
  fetchAvailableModels();
}

// Auto-fetch models on mount if API key is present
onMounted(() => {
  if (localApiConfig.value.apiKey) {
    fetchAvailableModels(true); // silent fetch on mount
  }
});

// Watch for API key changes and auto-fetch
let hasAutoFetched = false;
watch(
  () => localApiConfig.value.apiKey,
  (newKey) => {
    if (newKey && !hasAutoFetched && availableModels.value.length === 0) {
      hasAutoFetched = true;
      fetchAvailableModels(true);
    }
  }
);
</script>

<style scoped>
.thinking-mode-section {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-color);
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: normal;
}

.checkbox-group input[type='checkbox'] {
  width: auto;
  margin: 0;
}

.select-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.95rem;
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
</style>
