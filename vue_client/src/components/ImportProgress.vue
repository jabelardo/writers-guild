<template>
  <div v-if="progress && progress.total" class="image-progress">
    <div class="image-progress-label">
      <span>{{
        progress.stage === 'lorebook' ? 'Caching lorebook images' : 'Caching images'
      }}</span>
      <span>{{ progress.completed }} / {{ progress.total }}</span>
    </div>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="progress.completed"
      aria-valuemin="0"
      :aria-valuemax="progress.total"
    >
      <div
        class="progress-fill"
        :style="{ width: `${(progress.completed / progress.total) * 100}%` }"
      ></div>
    </div>
    <small v-if="progress.failed > 0" class="progress-failed">
      {{ progress.failed }} image(s) couldn't be downloaded — import will continue
    </small>
  </div>
</template>

<script setup>
defineProps({
  /** null | { completed, total, failed, stage } */
  progress: {
    type: Object,
    default: null
  }
});
</script>

<style scoped>
.image-progress {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.image-progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.progress-track {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-tertiary, rgba(127, 127, 127, 0.25));
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent, #4a9eff);
  transition: width 0.2s ease;
}

.progress-failed {
  color: var(--warning, #d08b28);
}
</style>
