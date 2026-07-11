<template>
  <Modal title="Import Character" @close="$emit('close')">
    <div class="import-content">
      <!-- Import from Photos -->
      <section class="import-section">
        <h3><i class="fas fa-images"></i> Import from Photos</h3>
        <p class="help-text">Pick a character card image from your photo gallery</p>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg"
          @change="handleFileSelect"
          class="file-input"
        />
        <button
          class="btn btn-primary full-width"
          :disabled="!selectedFile || !!importing"
          @click="importFromPhoto"
        >
          <i :class="importing === 'photo' ? 'fas fa-spinner fa-spin' : 'fas fa-upload'"></i>
          {{ importing === 'photo' ? 'Importing...' : 'Import from Photos' }}
        </button>
      </section>

      <div class="divider">
        <span>OR</span>
      </div>

      <!-- Import from Storage -->
      <section class="import-section">
        <h3><i class="fas fa-folder-open"></i> Import from Storage</h3>
        <p class="help-text">Browse local files for character card JSON or images</p>
        <input
          ref="storageFileInput"
          type="file"
          @change="handleStorageFileSelect"
          class="file-input"
        />
        <button
          class="btn btn-primary full-width"
          :disabled="!selectedStorageFile || !!importing"
          @click="importFromStorage"
        >
          <i :class="importing === 'storage' ? 'fas fa-spinner fa-spin' : 'fas fa-upload'"></i>
          {{ importing === 'storage' ? 'Importing...' : 'Import from Storage' }}
        </button>
      </section>

      <div class="divider">
        <span>OR</span>
      </div>

      <!-- Import from URL -->
      <section class="import-section">
        <h3><i class="fas fa-link"></i> Import from URL</h3>
        <p class="help-text">Paste a character URL from CHUB or a direct image URL (PNG, JPEG, WebP)</p>
        <input
          v-model="characterUrl"
          type="text"
          class="text-input"
          placeholder="https://chub.ai/characters/... or https://example.com/character.png"
          @keydown.enter="importFromURL"
        />
        <button
          class="btn btn-primary full-width"
          :disabled="!characterUrl.trim() || !!importing"
          @click="importFromURL"
        >
          <i :class="importing === 'url' ? 'fas fa-spinner fa-spin' : 'fas fa-download'"></i>
          {{ importing === 'url' ? 'Importing...' : 'Import from URL' }}
        </button>
        <small class="hint">Supported: chub.ai, direct image URLs (PNG, JPEG, WebP)</small>
      </section>
    </div>
  </Modal>
</template>

<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { charactersAPI } from '../services/api'
import { useToast } from '../composables/useToast'

const emit = defineEmits(['close', 'imported'])
const toast = useToast()

const selectedFile = ref(null)
const fileInput = ref(null)
const selectedStorageFile = ref(null)
const storageFileInput = ref(null)
const characterUrl = ref('')
const importing = ref(null) // null | 'photo' | 'storage' | 'url'

function handleFileSelect(event) {
  const file = event.target.files[0]
  if (file) {
    selectedFile.value = file
  }
}

function handleStorageFileSelect(event) {
  const file = event.target.files[0]
  if (file) {
    selectedStorageFile.value = file
  }
}

async function importFromPhoto() {
  if (!selectedFile.value || importing.value) return

  try {
    importing.value = 'photo'
    const result = await charactersAPI.importPNG(selectedFile.value)

    toast.success(`Successfully imported "${result.name}"!`)
    emit('imported', result)
    emit('close')
  } catch (error) {
    console.error('Failed to import photo:', error)
    toast.error('Failed to import character: ' + error.message)
  } finally {
    importing.value = false
  }
}

async function importFromURL() {
  if (!characterUrl.value.trim() || importing.value) return

  try {
    importing.value = 'url'
    const result = await charactersAPI.importFromURL(characterUrl.value.trim())

    toast.success(`Successfully imported "${result.name}"!`)
    emit('imported', result)
    emit('close')
  } catch (error) {
    console.error('Failed to import from URL:', error)
    toast.error('Failed to import character: ' + error.message)
  } finally {
    importing.value = false
  }
}

async function importFromStorage() {
  if (!selectedStorageFile.value || importing.value) return

  try {
    importing.value = 'storage'

    // Detect if it's an image file (PNG/JPEG) and route accordingly
    const file = selectedStorageFile.value
    const isImage = file.type === 'image/png' || file.type === 'image/jpeg' ||
      file.name.match(/\.(png|jpg|jpeg|webp)$/i)

    let result
    if (isImage) {
      result = await charactersAPI.importPNG(file)
    } else {
      result = await charactersAPI.importJSON(file)
    }

    toast.success(`Successfully imported "${result.name}"!`)
    emit('imported', result)
    emit('close')
  } catch (error) {
    console.error('Failed to import character from storage:', error)
    toast.error('Failed to import character: ' + error.message)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.import-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.import-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.import-section h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.help-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.file-input {
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.file-input:hover {
  border-color: var(--accent-primary);
}

.text-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  outline: none;
}

.text-input:focus {
  border-color: var(--accent-primary);
}

.full-width {
  width: 100%;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 0.5rem 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid var(--border-color);
}

.divider span {
  padding: 0 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
}

.hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-style: italic;
}
</style>
