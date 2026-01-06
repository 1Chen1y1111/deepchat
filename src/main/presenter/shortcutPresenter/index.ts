import { IConfigPresenter, IShortcutPresenter } from '@shared/types/presenters'
import {
  CommandKey,
  ShortcutKeySetting,
  defaultShortcutKey
} from '../configPresenter/shortcutKeySettings'
import { app, globalShortcut } from 'electron'
import { presenter } from '..'
import { SHORTCUT_EVENTS, TRAY_EVENTS } from '@/events'
import { SendTarget, eventBus } from '@/eventbus'

export class ShortcutPresenter implements IShortcutPresenter {
  private isActive: boolean = false
  private configPresenter: IConfigPresenter
  private shortcutKeys: ShortcutKeySetting = {
    ...defaultShortcutKey
  }

  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
  }

  registerShortcuts(): void {
    if (this.isActive) return
    console.log('reg shortcuts')

    this.shortcutKeys = {
      ...defaultShortcutKey,
      ...this.configPresenter?.getShortcutKey()
    }
  }

  registerShortcuts2(): void {
    if (this.isActive) return
    console.log('reg shortcuts')

    this.shortcutKeys = {
      ...defaultShortcutKey,
      ...this.configPresenter?.getShortcutKey()
    }

    // Command+N or Ctrl+N create new conversation
    if (this.shortcutKeys.NewConversation) {
      globalShortcut.register(this.shortcutKeys.NewConversation, async () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION
          )
        }
      })
    }

    // Command+Shift+N or Ctrl+Shift+N create new window
    if (this.shortcutKeys.NewWindow) {
      globalShortcut.register(this.shortcutKeys.NewWindow, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.CREATE_NEW_WINDOW)
        }
      })
    }

    // Command+T or Ctrl+T in current window create new tab
    if (this.shortcutKeys.NewTab) {
      globalShortcut.register(this.shortcutKeys.NewTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.CREATE_NEW_TAB, focusedWindow.id)
        }
      })
    }

    // Command+W or Ctrl+W close current tab
    if (this.shortcutKeys.CloseTab) {
      globalShortcut.register(this.shortcutKeys.CloseTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          if (focusedWindow.id === presenter.windowPresenter.getSettingsWindowId()) {
            // If it's the settings window, close the settings window
            presenter.windowPresenter.closeSettingsWindow()
            return
          }
          eventBus.sendToMain(SHORTCUT_EVENTS.CLOSE_CURRENT_TAB, focusedWindow.id)
        }
      })
    }

    // Command+Q or Ctrl+Q quit application
    if (this.shortcutKeys.Quit) {
      globalShortcut.register(this.shortcutKeys.Quit, () => {
        app.quit() // Exit trigger: shortcut key
      })
    }

    // Command+= or Ctrl+= enlarge font
    if (this.shortcutKeys.ZoomIn) {
      globalShortcut.register(this.shortcutKeys.ZoomIn, () => {
        eventBus.send(SHORTCUT_EVENTS.ZOOM_IN, SendTarget.ALL_WINDOWS)
      })
    }

    // Command+- or Ctrl+- reduce font size
    if (this.shortcutKeys.ZoomOut) {
      globalShortcut.register(this.shortcutKeys.ZoomOut, () => {
        eventBus.send(SHORTCUT_EVENTS.ZOOM_OUT, SendTarget.ALL_WINDOWS)
      })
    }

    // Command+0 or Ctrl+0 reset font size
    if (this.shortcutKeys.ZoomResume) {
      globalShortcut.register(this.shortcutKeys.ZoomResume, () => {
        eventBus.send(SHORTCUT_EVENTS.ZOOM_RESUME, SendTarget.ALL_WINDOWS)
      })
    }

    // Command+, or Ctrl+, open settings window
    if (this.shortcutKeys.GoSettings) {
      globalShortcut.register(this.shortcutKeys.GoSettings, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          eventBus.sendToMain(SHORTCUT_EVENTS.GO_SETTINGS, focusedWindow.id)
        }
      })
    }
    console.log('clean chat history shortcut', this.shortcutKeys.CleanChatHistory)
    // Command+L or Ctrl+L clear chat history
    if (this.shortcutKeys.CleanChatHistory) {
      globalShortcut.register(this.shortcutKeys.CleanChatHistory, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        console.log('clean chat history')
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY
          )
        }
      })
    }

    // Command+D or Ctrl+D delete conversation
    if (this.shortcutKeys.DeleteConversation) {
      globalShortcut.register(this.shortcutKeys.DeleteConversation, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        console.log('delete conversation')
        if (focusedWindow?.isFocused()) {
          presenter.windowPresenter.sendToActiveTab(
            focusedWindow.id,
            SHORTCUT_EVENTS.DELETE_CONVERSATION
          )
        }
      })
    }

    // add more tab shortcuts here

    // Command+Tab or Ctrl+Tab switch to next tab
    if (this.shortcutKeys.SwitchNextTab) {
      globalShortcut.register(this.shortcutKeys.SwitchNextTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToNextTab(focusedWindow.id)
        }
      })
    }

    // Ctrl+Shift+Tab switch to previous tab
    if (this.shortcutKeys.SwitchPrevTab) {
      globalShortcut.register(this.shortcutKeys.SwitchPrevTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToPreviousTab(focusedWindow.id)
        }
      })
    }

    // Registration tab number shortcut (1-8)
    if (this.shortcutKeys.NumberTabs) {
      for (let i = 1; i <= 8; i++) {
        globalShortcut.register(`${CommandKey}+${i}`, () => {
          const focusedWindow = presenter.windowPresenter.getFocusedWindow()
          if (focusedWindow?.isFocused()) {
            this.switchToTabByIndex(focusedWindow.id, i - 1) // 索引从0开始
          }
        })
      }
    }

    // Command+9 or Ctrl+9 Switch to the last tab
    if (this.shortcutKeys.SwitchToLastTab) {
      globalShortcut.register(this.shortcutKeys.SwitchToLastTab, () => {
        const focusedWindow = presenter.windowPresenter.getFocusedWindow()
        if (focusedWindow?.isFocused()) {
          this.switchToLastTab(focusedWindow.id)
        }
      })
    }

    this.showHideWindow()

    this.isActive = true
  }

  // Switch to the next tab
  private async switchToNextTab(windowId: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || tabsData.length <= 1) return // 只有一个or没有标签页时不执行切换

      // find the index of the currently active tab
      const activeTabIndex = tabsData.findIndex((tab) => tab.isActive)
      if (activeTabIndex === -1) return

      // calculate the index of the next tab (loop to the first one)
      const nextTabIndex = (activeTabIndex + 1) % tabsData.length

      // switch to the next tab
      await presenter.tabPresenter.switchTab(tabsData[nextTabIndex].id)
    } catch (error) {
      console.error('Failed to switch to next tab:', error)
    }
  }

  // switch to the previous tab
  private async switchToPreviousTab(windowId: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || tabsData.length <= 1) return // 只有一个or没有标签页时不执行切换

      // find the index of the currently active tab
      const activeTabIndex = tabsData.findIndex((tab) => tab.isActive)
      if (activeTabIndex === -1) return

      // calculate the index of the previous tab (loop to the last one)
      const previousTabIndex = (activeTabIndex - 1 + tabsData.length) % tabsData.length

      // switch to the previous tab
      await presenter.tabPresenter.switchTab(tabsData[previousTabIndex].id)
    } catch (error) {
      console.error('Failed to switch to previous tab:', error)
    }
  }

  // switch to tab by index
  private async switchToTabByIndex(windowId: number, index: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || index >= tabsData.length) return // 索引超出范围

      // switch to the specified tab
      await presenter.tabPresenter.switchTab(tabsData[index].id)
    } catch (error) {
      console.error(`Failed to switch to tab at index ${index}:`, error)
    }
  }

  // switch to the last tab
  private async switchToLastTab(windowId: number): Promise<void> {
    try {
      const tabsData = await presenter.tabPresenter.getWindowTabsData(windowId)
      if (!tabsData || tabsData.length === 0) return

      await presenter.tabPresenter.switchTab(tabsData[tabsData.length - 1].id)
    } catch (error) {
      console.error('Failed to switch to last tab:', error)
    }
  }

  // Command+O or Ctrl+O show/hide window
  private async showHideWindow() {
    // Command+O or Ctrl+O show/hide window
    if (this.shortcutKeys.ShowHideWindow) {
      globalShortcut.register(this.shortcutKeys.ShowHideWindow, () => {
        eventBus.sendToMain(TRAY_EVENTS.SHOW_HIDDEN_WINDOW)
      })
    }
  }

  unregisterShortcuts(): void {
    console.log('unreg shortcuts')
    globalShortcut.unregisterAll()

    this.showHideWindow()
    this.isActive = false
  }

  destroy(): void {
    this.unregisterShortcuts()
  }
}
