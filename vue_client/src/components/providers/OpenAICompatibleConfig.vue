<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 1024, max: 131072 }"
    :context-help-text="`Context window in tokens. Set this to whatever the loaded model can actually handle.`"
    provider="openaicompatible"
    :model="localApiConfig.model || ''"
  >
    <template #api-config>
      <div class="form-group">
        <label for="oaiCompatBaseURL">Base URL</label>
        <input
          id="oaiCompatBaseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="http://localhost:1234/v1"
        />
        <small class="help-text">
          OpenAI-shaped endpoint, e.g. LM Studio (port 1234), llama.cpp <code>--api</code> (port
          8080), or vLLM. The URL should end in <code>/v1</code> so request paths like
          <code>/chat/completions</code> resolve correctly.
        </small>
      </div>

      <div class="form-group">
        <label for="oaiCompatApiKey">Bearer Token <span class="optional">(optional)</span></label>
        <input
          id="oaiCompatApiKey"
          v-model="localApiConfig.apiKey"
          type="password"
          class="text-input"
          placeholder="Leave empty if your endpoint doesn't require auth"
        />
        <small class="help-text">
          Only needed if you've put auth in front of the endpoint. Most local servers accept any
          token (or none).
        </small>
      </div>

      <ModelSelector
        :models="availableModels"
        :selected-model="localApiConfig.model"
        :loading="loadingModels"
        :error="modelsError"
        :can-fetch="!!localApiConfig.baseURL"
        :requires-api-key="false"
        description="Pick which model the endpoint should use. Load a model in your server first (LM Studio, llama.cpp, etc.) and click Fetch again to refresh."
        empty-state-text="Enter your endpoint URL above and click Fetch Available Models."
        @fetch="fetchModels"
        @select="selectModel"
      />
    </template>
  </BaseProviderConfig>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseProviderConfig from './shared/BaseProviderConfig.vue';
import ModelSelector from './shared/ModelSelector.vue';
import { presetsAPI } from '../../services/api';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  config: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['update:config']);

const toast = useToast();

const availableModels = ref([]);
const loadingModels = ref(false);
const modelsError = ref(null);

const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {};
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value });
  },
});

async function fetchModels(silent = false) {
  if (!localApiConfig.value.baseURL) {
    modelsError.value = 'Base URL is required to fetch models';
    return;
  }

  try {
    loadingModels.value = true;
    modelsError.value = null;
    const response = await presetsAPI.getOpenAICompatibleModels(
      localApiConfig.value.baseURL,
      localApiConfig.value.apiKey,
    );
    availableModels.value = response.models || [];
    if (availableModels.value.length === 0) {
      modelsError.value = 'Endpoint returned no models. Load one in your server first.';
    } else if (!silent) {
      toast.success(
        `Loaded ${availableModels.value.length} model${availableModels.value.length !== 1 ? 's' : ''}`,
      );
    }
  } catch (error) {
    modelsError.value = error.message || 'Failed to reach endpoint';
    console.error('Failed to fetch OpenAI-compatible models:', error);
  } finally {
    loadingModels.value = false;
  }
}

function selectModel(model) {
  localApiConfig.value = {
    ...localApiConfig.value,
    model: model.id,
  };
  toast.success(`Selected model: ${model.name || model.id}`);
}

onMounted(() => {
  if (localApiConfig.value.baseURL && localApiConfig.value.model) {
    fetchModels(true);
  }
});
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
</style>
