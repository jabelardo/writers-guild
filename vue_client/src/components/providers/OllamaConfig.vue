<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 1024, max: 131072 }"
    :context-help-text="`Context window in tokens. Becomes Ollama's options.num_ctx — Ollama defaults to 2048 unless overridden, so set this to whatever the model can actually handle.`"
    provider="ollama"
    :model="localApiConfig.model || ''"
  >
    <template #api-config>
      <div class="form-group">
        <label for="ollamaBaseURL">Base URL</label>
        <input
          id="ollamaBaseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="http://localhost:11434"
        />
        <small class="help-text">
          URL of your running Ollama instance (default port 11434). If Writer's Guild runs in Docker
          and Ollama runs on the host or another machine, use that host's IP or
          <code>host.docker.internal</code> instead of localhost.
        </small>
      </div>

      <div class="form-group">
        <label for="ollamaPassword">Bearer Token <span class="optional">(optional)</span></label>
        <input
          id="ollamaPassword"
          v-model="localApiConfig.password"
          type="password"
          class="text-input"
          placeholder="Leave empty if Ollama is not behind auth"
        />
        <small class="help-text">
          Only needed if you've put a reverse proxy in front of Ollama that requires
          <code>Authorization: Bearer</code> auth.
        </small>
      </div>

      <ModelSelector
        :models="availableModels"
        :selected-model="localApiConfig.model"
        :loading="loadingModels"
        :error="modelsError"
        :can-fetch="!!localApiConfig.baseURL"
        :requires-api-key="false"
        description="Pick which installed Ollama model to use. To add a new model, run `ollama pull <name>` on the host machine and click Fetch again."
        empty-state-text="Enter your Ollama URL above and click Fetch Available Models."
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
    required: true
  }
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
  }
});

async function fetchModels(silent = false) {
  if (!localApiConfig.value.baseURL) {
    modelsError.value = 'Base URL is required to fetch models';
    return;
  }

  try {
    loadingModels.value = true;
    modelsError.value = null;
    const response = await presetsAPI.getOllamaModels(
      localApiConfig.value.baseURL,
      localApiConfig.value.password
    );
    availableModels.value = response.models || [];
    if (availableModels.value.length === 0) {
      modelsError.value = 'No models installed. Run `ollama pull <name>` on the host first.';
    } else if (!silent) {
      toast.success(
        `Loaded ${availableModels.value.length} model${availableModels.value.length !== 1 ? 's' : ''}`
      );
    }
  } catch (error) {
    modelsError.value = error.message || 'Failed to reach Ollama';
    console.error('Failed to fetch Ollama models:', error);
  } finally {
    loadingModels.value = false;
  }
}

// Ollama parameter name → preset field name. Mirrors the provider's request-side
// mapping but in the opposite direction: we read Modelfile defaults and write
// them onto our preset fields.
const PARAM_TO_PRESET = {
  top_p: 'top_p',
  top_k: 'top_k',
  min_p: 'min_p',
  typical_p: 'typical',
  tfs_z: 'tfs',
  repeat_penalty: 'rep_pen',
  repeat_last_n: 'rep_pen_range',
  mirostat: 'mirostat',
  mirostat_tau: 'mirostat_tau',
  mirostat_eta: 'mirostat_eta'
};

function applyModelDefaults(baseConfig, info) {
  const currentGen = baseConfig.generationSettings || {};
  const nextGen = { ...currentGen };
  const applied = [];

  // Context length: the architectural max is the real ceiling. If parameters
  // override it (some Modelfiles do via num_ctx), prefer that — Ollama uses it.
  const modelfileCtx = info.parameters?.num_ctx;
  const ctx =
    typeof modelfileCtx === 'number' && modelfileCtx > 0 ? modelfileCtx : info.contextLength;
  if (typeof ctx === 'number' && ctx > 0 && ctx !== currentGen.maxContextTokens) {
    nextGen.maxContextTokens = ctx;
    applied.push(`max ctx ${ctx}`);
  }

  // Sampler fields: only fill ones the user hasn't explicitly set (null = blank).
  // Don't clobber existing tuning.
  const params = info.parameters || {};
  for (const [ollamaKey, presetKey] of Object.entries(PARAM_TO_PRESET)) {
    const value = params[ollamaKey];
    if (value === undefined || value === null) continue;
    if (currentGen[presetKey] != null) continue; // user has set it; respect that
    nextGen[presetKey] = value;
    applied.push(`${presetKey}=${value}`);
  }

  // Stop sequences: union with existing (some user-set, some from Modelfile).
  if (Array.isArray(params.stop) && params.stop.length > 0) {
    const existing = Array.isArray(currentGen.stop_sequences) ? currentGen.stop_sequences : [];
    const combined = [...new Set([...existing, ...params.stop])];
    if (combined.length > existing.length) {
      nextGen.stop_sequences = combined;
      applied.push(`${combined.length - existing.length} stop seq`);
    }
  }

  return {
    config: applied.length > 0 ? { ...baseConfig, generationSettings: nextGen } : baseConfig,
    applied
  };
}

async function selectModel(model) {
  // Start with the model assignment. Auto-applied defaults layer on top so we
  // can emit a single atomic update to the parent.
  let nextConfig = {
    ...props.config,
    apiConfig: { ...(props.config.apiConfig || {}), model: model.id }
  };

  let toastMsg = `Selected ${model.name || model.id}`;

  try {
    const info = await presetsAPI.getOllamaModelInfo(
      props.config.apiConfig?.baseURL,
      model.id,
      props.config.apiConfig?.password
    );
    const { config: enriched, applied } = applyModelDefaults(nextConfig, info);
    nextConfig = enriched;
    if (applied.length > 0) {
      toastMsg += ` · Applied: ${applied.join(', ')}`;
    }
  } catch (err) {
    // Model selection succeeds even if /api/show isn't reachable — just less smart.
    console.warn('Could not load Ollama model info:', err);
  }

  emit('update:config', nextConfig);
  toast.success(toastMsg);
}

// If a model was already saved on this preset and the user has a URL, prefetch
// the list so the picker is populated immediately. Silent so it doesn't spam
// errors when Ollama isn't running while the user is editing.
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
