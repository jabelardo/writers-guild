/**
 * Comprehensive provider configuration
 * Contains display info, capabilities, and default settings for each provider
 */

/**
 * Provider metadata including display info and capabilities
 */
export const PROVIDERS = {
  deepseek: {
    // Display information
    name: 'DeepSeek',
    description: 'DeepSeek with reasoning capabilities',
    icon: 'fa-brain',
    // Capabilities
    supportsReasoning: true,
    supportsStreaming: true,
    // Default configuration
    defaults: {
      provider: 'deepseek',
      apiConfig: {
        apiKey: '',
        baseURL: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        models: []
      },
      generationSettings: {
        maxTokens: 4000,
        temperature: 1.0,
        maxContextTokens: 8000,
        includeDialogueExamples: false,
        thinking: false,
        reasoningEffort: 'high'
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  },

  aihorde: {
    // Display information
    name: 'AI Horde',
    description: 'Free, queue-based distributed AI',
    icon: 'fa-users',
    // Capabilities
    supportsReasoning: false,
    supportsStreaming: false,
    requiresModelSelection: true,
    // Default configuration
    defaults: {
      provider: 'aihorde',
      apiConfig: {
        apiKey: '0000000000', // Anonymous access
        baseURL: 'https://aihorde.net/api/v2',
        model: '',
        models: [] // Will be populated when user selects models
      },
      generationSettings: {
        maxTokens: 300,
        temperature: 0.7,
        maxContextTokens: 2048,
        includeDialogueExamples: false,
        // AI Horde specific settings
        top_p: 0.9,
        top_k: 0,
        top_a: 0,
        typical: 1,
        tfs: 1,
        rep_pen: 1.1,
        rep_pen_range: 320,
        rep_pen_slope: 0.7
      },
      lorebookSettings: {
        scanDepth: 1000,
        tokenBudget: 800,
        recursionDepth: 2,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  },

  openai: {
    // Display information
    name: 'OpenAI',
    description: 'OpenAI API models',
    icon: 'fa-robot',
    // Capabilities
    supportsReasoning: false,
    supportsStreaming: true,
    // Default configuration
    defaults: {
      provider: 'openai',
      apiConfig: {
        apiKey: '',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4-turbo-preview',
        models: []
      },
      generationSettings: {
        maxTokens: 4000,
        temperature: 1.0,
        maxContextTokens: 8000,
        includeDialogueExamples: false,
        // OpenAI specific settings
        top_p: 1.0,
        frequency_penalty: 0,
        presence_penalty: 0
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  },

  anthropic: {
    // Display information
    name: 'Anthropic',
    description: 'Anthropic Claude models',
    icon: 'fa-comment',
    // Capabilities
    supportsReasoning: false,
    supportsStreaming: true,
    // Default configuration
    defaults: {
      provider: 'anthropic',
      apiConfig: {
        apiKey: '',
        baseURL: 'https://api.anthropic.com/v1',
        model: 'claude-3-5-sonnet-20241022',
        models: []
      },
      generationSettings: {
        maxTokens: 4000,
        temperature: 1.0,
        maxContextTokens: 8000,
        includeDialogueExamples: false,
        // Anthropic specific settings
        // Note: Anthropic doesn't allow both temperature and top_p
        top_k: 0
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  },

  ollama: {
    // Display information
    name: 'Ollama',
    description: 'Local Ollama endpoint (native API)',
    icon: 'fa-cube',
    // Capabilities
    supportsReasoning: false,
    supportsStreaming: true,
    requiresModelSelection: true,
    // Default configuration
    defaults: {
      provider: 'ollama',
      apiConfig: {
        baseURL: 'http://localhost:11434',
        password: '',
        model: ''
      },
      generationSettings: {
        maxTokens: 200,
        temperature: 0.7,
        maxContextTokens: 4096,
        includeDialogueExamples: false,
        // Ollama-tunable samplers (null = use Ollama defaults). UI uses preset
        // names; provider maps them to Ollama's `options` keys.
        top_p: null,
        top_k: null,
        min_p: null,
        typical: null,
        tfs: null,
        rep_pen: null,
        rep_pen_range: null,
        // Mirostat
        mirostat: null,
        mirostat_tau: null,
        mirostat_eta: null
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  },

  koboldcpp: {
    // Display information
    name: 'KoboldCpp',
    description: 'Local KoboldCpp endpoint (native API)',
    icon: 'fa-server',
    // Capabilities
    supportsReasoning: false,
    supportsStreaming: true,
    // Default configuration
    defaults: {
      provider: 'koboldcpp',
      apiConfig: {
        baseURL: 'http://localhost:5001/api',
        password: '',
        model: ''
      },
      generationSettings: {
        maxTokens: 200,
        temperature: 0.7,
        maxContextTokens: 4096,
        includeDialogueExamples: false,
        // KoboldCpp-tunable samplers (null = use Kobold defaults)
        top_p: null,
        top_k: null,
        top_a: null,
        typical: null,
        tfs: null,
        min_p: null,
        rep_pen: null,
        rep_pen_range: null,
        rep_pen_slope: null,
        // Mirostat (KoboldCpp-specific)
        mirostat: null,
        mirostat_tau: null,
        mirostat_eta: null
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  },

  openrouter: {
    // Display information
    name: 'OpenRouter',
    description: 'Multi-model API router',
    icon: 'fa-route',
    // Capabilities
    supportsReasoning: true,
    supportsStreaming: true,
    // Default configuration
    defaults: {
      provider: 'openrouter',
      apiConfig: {
        apiKey: '',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-3.5-sonnet',
        models: []
      },
      generationSettings: {
        maxTokens: 4000,
        temperature: 1.0,
        maxContextTokens: 8000,
        includeDialogueExamples: false,
        // OpenRouter follows OpenAI-compatible settings
        top_p: 1.0,
        frequency_penalty: 0,
        presence_penalty: 0
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null
      }
    }
  }
}

/**
 * Get default configuration for a specific provider
 * @param {string} provider - Provider name
 * @returns {object} Default configuration object
 */
export function getProviderDefaults(provider) {
  const providerConfig = PROVIDERS[provider]
  if (!providerConfig) {
    console.warn(`No defaults found for provider: ${provider}`)
    return JSON.parse(JSON.stringify(PROVIDERS.deepseek.defaults)) // Fallback to deepseek
  }

  // Deep clone to avoid mutations
  return JSON.parse(JSON.stringify(providerConfig.defaults))
}

/**
 * Get provider information (name, icon, description)
 * @param {string} provider - Provider name
 * @returns {object} Provider info object
 */
export function getProviderInfo(provider) {
  const providerConfig = PROVIDERS[provider]
  if (!providerConfig) {
    return { name: provider, description: '', icon: 'fa-robot' }
  }

  return {
    name: providerConfig.name,
    description: providerConfig.description,
    icon: providerConfig.icon
  }
}

/**
 * Legacy export for backwards compatibility
 * @deprecated Use PROVIDERS instead
 */
export const PROVIDER_INFO = Object.fromEntries(
  Object.entries(PROVIDERS).map(([key, config]) => [
    key,
    {
      name: config.name,
      description: config.description,
      icon: config.icon
    }
  ])
)
