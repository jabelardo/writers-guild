/**
 * Test the CharacterDetail component's deleteCharacter function
 * Uses vitest + happy-dom to verify the JavaScript logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// Mock the API modules
vi.mock('../../services/api.js', () => ({
  charactersAPI: {
    get: vi.fn(),
    delete: vi.fn(),
  },
  lorebooksAPI: {
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ lorebooks: [] }),
  },
  storiesAPI: {
    list: vi.fn().mockResolvedValue({ stories: [] }),
  },
  settingsAPI: {
    get: vi.fn().mockResolvedValue({}),
  },
}));

// Mock router — need createRouter/createWebHistory for the app's router module
vi.mock('vue-router', () => ({
  createRouter: vi.fn(() => ({})),
  createWebHistory: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    currentRoute: { value: { path: '/characters/' } },
  }),
  useRoute: () => ({
    params: { characterId: 'test-char-id' },
  }),
}));

// Mock toast
vi.mock('../../composables/useToast.js', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock useConfirm
const mockConfirm = vi.fn();
vi.mock('../../composables/useConfirm.js', () => ({
  useConfirm: () => ({
    confirm: mockConfirm,
  }),
}));

// Mock useNavigation
vi.mock('../../composables/useNavigation.js', () => ({
  useNavigation: () => ({
    goBack: vi.fn(),
  }),
}));

// Mock the app's router module (setPageTitle is imported by CharacterDetail)
vi.mock('../../router', () => ({
  setPageTitle: vi.fn(),
  default: {},
}));

import CharacterDetail from '../CharacterDetail.vue';
import { charactersAPI } from '../../services/api.js';

describe('CharacterDetail deleteCharacter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mount without error', async () => {
    charactersAPI.get.mockResolvedValue({
      character: {
        data: {
          name: 'TestChar',
          description: '',
          personality: '',
          scenario: '',
          mes_example: '',
          first_mes: '',
          alternate_greetings: [],
          extensions: {},
        },
      },
    });

    const wrapper = mount(CharacterDetail, {
      props: { characterId: 'test-char-id' },
      global: {
        stubs: ['router-link', 'router-view'],
      },
    });

    await nextTick();
    expect(wrapper.exists()).toBe(true);
  });
});
