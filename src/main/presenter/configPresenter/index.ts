import { IConfigPresenter } from '@shared/types/presenters'
import { ShortcutKeySetting, defaultShortcutKey } from './shortcutKeySettings'
import ElectronStore from 'electron-store'
import { app } from 'electron'
import { SendTarget, eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

// Define application settings interface
interface IAppSettings {
  // Define your configuration items here, for example:
  language: string
  providers: []
  closeToQuit: boolean // Whether to quit the program when clicking the close button
  appVersion?: string // Used for version checking and data migration
  proxyMode?: string // Proxy mode: system, none, custom
  customProxyUrl?: string // Custom proxy address
  customShortKey?: ShortcutKeySetting // Custom shortcut keys
  artifactsEffectEnabled?: boolean // Whether artifacts animation effects are enabled
  searchPreviewEnabled?: boolean // Whether search preview is enabled
  contentProtectionEnabled?: boolean // Whether content protection is enabled
  syncEnabled?: boolean // Whether sync functionality is enabled
  syncFolderPath?: string // Sync folder path
  lastSyncTime?: number // Last sync time
  customSearchEngines?: string // Custom search engines JSON string
  soundEnabled?: boolean // Whether sound effects are enabled
  copyWithCotEnabled?: boolean
  loggingEnabled?: boolean // Whether logging is enabled
  floatingButtonEnabled?: boolean // Whether floating button is enabled
  default_system_prompt?: string // Default system prompt
  webContentLengthLimit?: number // Web content truncation length limit, default 3000 characters
  updateChannel?: string // Update channel: 'stable' | 'beta'
  fontFamily?: string // Custom UI font
  codeFontFamily?: string // Custom code font
  [key: string]: unknown // Allow arbitrary keys, using unknown type instead of any
}

export class ConfigPresenter implements IConfigPresenter {
  private store: ElectronStore<IAppSettings>
  private currentAppVersion: string

  constructor() {
    this.currentAppVersion = app.getVersion()

    this.store = new ElectronStore<IAppSettings>({
      name: 'app-settings',
      defaults: {
        language: 'system',
        providers: [],
        closeToQuit: false,
        customShortKey: defaultShortcutKey,
        proxyMode: 'system',
        customProxyUrl: '',
        artifactsEffectEnabled: true,
        searchPreviewEnabled: true,
        contentProtectionEnabled: false,
        syncEnabled: false,
        syncFolderPath: '',
        lastSyncTime: 0,
        soundEnabled: false,
        copyWithCotEnabled: true,
        loggingEnabled: false,
        floatingButtonEnabled: false,
        fontFamily: '',
        codeFontFamily: '',
        default_system_prompt: '',
        webContentLengthLimit: 3000,
        updateChannel: 'stable', // Default to stable version
        appVersion: this.currentAppVersion
      }
    })
  }

  getSetting<T>(key: string): T | undefined {
    try {
      return this.store.get(key) as T
    } catch (error) {
      console.error(`[Config] Failed to get setting ${key}:`, error)
      return undefined
    }
  }

  setSetting<T>(key: string, value: T): void {
    try {
      this.store.set(key, value)
    } catch (error) {
      console.error(`[Config] Failed to set setting ${key}:`, error)
    }
  }

  // 获取快捷键
  getShortcutKey(): ShortcutKeySetting {
    return (
      this.getSetting<ShortcutKeySetting>('shortcutKey') || {
        ...defaultShortcutKey
      }
    )
  }

  // Get proxy mode
  getProxyMode(): string {
    return this.getSetting<string>('proxyMode') || 'system'
  }

  getLoggingEnabled(): boolean {
    return this.getSetting<boolean>('loggingEnabled') ?? false
  }

  // Get application current language, considering system language settings
  getLanguage(): string {
    const language = this.getSetting<string>('language') || 'system'

    if (language !== 'system') {
      return language
    }

    return this.getSystemLanguage()
  }

  // Set application language
  setLanguage(language: string): void {
    this.setSetting('language', language)
    // Trigger language change event (need to notify all tabs)
    eventBus.sendToRenderer(CONFIG_EVENTS.LANGUAGE_CHANGED, SendTarget.ALL_WINDOWS, language)
  }

  // Get system language and match supported language list
  private getSystemLanguage(): string {
    const systemLang = app.getLocale()
    const supportedLanguages = [
      'zh-CN',
      'zh-TW',
      'en-US',
      'zh-HK',
      'ko-KR',
      'ru-RU',
      'ja-JP',
      'fr-FR',
      'fa-IR',
      'pt-BR',
      'da-DK',
      'he-IL'
    ]

    // Exact match
    if (supportedLanguages.includes(systemLang)) {
      return systemLang
    }

    // Partial match (only match language code)
    const langCode = systemLang.split('-')[0]
    const matchedLang = supportedLanguages.find((lang) => lang.startsWith(langCode))
    if (matchedLang) {
      return matchedLang
    }

    // Default return English
    return 'en-US'
  }
}
