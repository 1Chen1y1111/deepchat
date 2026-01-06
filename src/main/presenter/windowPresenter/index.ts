// src\main\presenter\windowPresenter\index.ts

import { BrowserWindow, ipcMain, nativeImage, screen } from 'electron'
import { eventBus } from '@/eventbus'
import { SHORTCUT_EVENTS, WINDOW_EVENTS } from '@/events'
import icon from '../../../../resources/icon.png?asset' // App icon (macOS/Linux)
import iconWin from '../../../../resources/icon.ico?asset' // App icon (Windows)
import windowStateManager from 'electron-window-state' // Window state manager
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { presenter } from '..'
import { TabPresenter } from '../tabPresenter'
import { IConfigPresenter, IWindowPresenter } from '@shared/types/presenters'
import { FloatingChatWindow } from './FloatingChatWindow'

/**
 * 窗口呈现器，负责管理所有浏览器窗口实例及其生命周期，
 * 包括创建、销毁、最小化、最大化、隐藏、显示、焦点管理以及与选项卡的交互。
 */
export class WindowPresenter implements IWindowPresenter {
  // Map managing all BrowserWindow instances, key is window ID
  windows: Map<number, BrowserWindow>
  private configPresenter: IConfigPresenter
  // Exit flag indicating if app is in the process of quitting (set by 'before-quit' hook)
  private isQuitting: boolean = false
  // Current focused window ID (internal record)
  private focusedWindowId: number | null = null
  // Main window ID
  private mainWindowId: number | null = null
  // Window focus state management
  private windowFocusStates = new Map<
    number,
    {
      lastFocusTime: number
      shouldFocus: boolean
      isNewWindow: boolean
      hasInitialFocus: boolean
    }
  >()
  private floatingChatWindow: FloatingChatWindow | null = null
  private settingsWindow: BrowserWindow | null = null
  private tooltipOverlayWindows = new Map<number, BrowserWindow>()
  private pendingTooltipPayload = new Map<number, { x: number; y: number; text: string }>()

  constructor(configPresenter: IConfigPresenter) {
    this.windows = new Map()
    this.configPresenter = configPresenter

    // Register IPC handlers for Renderer to call to get window and WebContents IDs
    ipcMain.on('get-window-id', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      event.returnValue = window ? window.id : null
    })

    ipcMain.on('get-web-contents-id', (event) => {
      event.returnValue = event.sender.id
    })

    ipcMain.on('close-floating-window', (event) => {
      // Check if sender is the floating chat window
      const webContentsId = event.sender.id
      if (
        this.floatingChatWindow &&
        this.floatingChatWindow.getWindow()?.webContents.id === webContentsId
      ) {
        this.hideFloatingChatWindow()
      }
    })

    ipcMain.on(
      'shell-tooltip:show',
      (event, payload: { x: number; y: number; text: string } | undefined) => {
        if (!payload) return

        const parentWindow = BrowserWindow.fromWebContents(event.sender)
        if (!parentWindow || parentWindow.isDestroyed()) return

        const overlay = this.getOrCreateTooltipOverlay(parentWindow)
        if (!overlay) return

        this.pendingTooltipPayload.set(parentWindow.id, payload)

        if (!overlay.webContents.isLoadingMainFrame()) {
          overlay.webContents.send('shell-tooltip-overlay:show', payload)
          return
        }

        overlay.webContents.once('did-finish-load', () => {
          const pending = this.pendingTooltipPayload.get(parentWindow.id)
          if (!pending) return
          if (overlay.isDestroyed()) return
          overlay.webContents.send('shell-tooltip-overlay:show', pending)
        })
      }
    )

    ipcMain.on('shell-tooltip:hide', (event) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender)
      if (!parentWindow || parentWindow.isDestroyed()) return

      const overlay = this.tooltipOverlayWindows.get(parentWindow.id)
      if (!overlay || overlay.isDestroyed()) return

      this.pendingTooltipPayload.delete(parentWindow.id)
      overlay.webContents.send('shell-tooltip-overlay:hide')
    })

    // Listen for shortcut event: create new window
    eventBus.on(SHORTCUT_EVENTS.CREATE_NEW_WINDOW, () => {
      console.log('Creating new shell window via shortcut.')
      this.createShellWindow({ initialTab: { url: 'local://chat' } })
    })

    // Listen for shortcut event: create new tab
    eventBus.on(SHORTCUT_EVENTS.CREATE_NEW_TAB, async (windowId: number) => {
      console.log(`Creating new tab via shortcut for window ${windowId}.`)
      // const window = this.windows.get(windowId)
      // if (window && !window.isDestroyed()) {
      //   await (presenter.tabPresenter as TabPresenter).createTab(windowId, 'local://chat', {
      //     active: true
      //   })
      // } else {
      //   console.warn(
      //     `Cannot create new tab for window ${windowId}, window does not exist or is destroyed.`
      //   )
      // }
    })
  }

  /**
   * 获取当前主窗口 (优先返回焦点窗口，否则返回第一个有效窗口)。
   */
  get mainWindow(): BrowserWindow | undefined {
    const focused = this.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      return focused
    }
    const allWindows = this.getAllWindows()
    return allWindows.length > 0 && !allWindows[0].isDestroyed() ? allWindows[0] : undefined
  }

  /**
   * 获取当前获得焦点的 BrowserWindow 实例 (由 Electron 报告并经内部 Map 验证)。
   * @returns 获得焦点的 BrowserWindow 实例，如果无焦点窗口或窗口无效则返回 undefined。
   */
  getFocusedWindow(): BrowserWindow | undefined {
    const electronFocusedWindow = BrowserWindow.getFocusedWindow()

    if (electronFocusedWindow) {
      const windowId = electronFocusedWindow.id
      console.log(this.windows)
      const ourWindow = this.windows.get(windowId)

      // 验证 Electron 报告的窗口是否在我们管理范围内且有效
      if (ourWindow && !ourWindow.isDestroyed()) {
        this.focusedWindowId = windowId // 更新内部记录
        return ourWindow
      } else if (this.settingsWindow) {
        if (windowId === this.settingsWindow.id) {
          return this.settingsWindow
        } else {
          return
        }
      } else {
        // Electron 报告的窗口不在 Map 中或已销毁
        console.warn(
          `Electron reported window ${windowId} focused, but it is not managed or is destroyed.`
        )
        this.focusedWindowId = null
        return undefined
      }
    } else {
      this.focusedWindowId = null // 清空内部记录
      return undefined
    }
  }

  /**
   * 获取所有有效 (未销毁) 的 BrowserWindow 实例数组。
   * @returns BrowserWindow 实例数组。
   */
  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values()).filter((window) => !window.isDestroyed())
  }

  /**
   * 向所有有效窗口的主 WebContents 和所有标签页的 WebContents 发送消息。
   * @param channel IPC 通道名。
   * @param args 消息参数。
   */
  async sendToAllWindows(channel: string, ...args: unknown[]): Promise<void> {
    // 遍历 Map 的值副本，避免迭代过程中 Map 被修改
    for (const window of Array.from(this.windows.values())) {
      if (!window.isDestroyed()) {
        // 向窗口主 WebContents 发送
        window.webContents.send(channel, ...args)

        // TODO: 向窗口内所有标签页的 WebContents 发送 (异步执行)
        // try {
        //   const tabPresenterInstance = presenter.tabPresenter as TabPresenter
        //   const tabsData = await tabPresenterInstance.getWindowTabsData(window.id)
        //   if (tabsData && tabsData.length > 0) {
        //     for (const tabData of tabsData) {
        //       const tab = await tabPresenterInstance.getTab(tabData.id)
        //       if (tab && !tab.webContents.isDestroyed()) {
        //         tab.webContents.send(channel, ...args)
        //       }
        //     }
        //   }
        // } catch (error) {
        //   console.error(`Error sending message "${channel}" to tabs of window ${window.id}:`, error)
        // }
      } else {
        console.warn(`Skipping sending message "${channel}" to destroyed window ${window.id}.`)
      }
    }

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      try {
        this.settingsWindow.webContents.send(channel, ...args)
      } catch (error) {
        console.error(`Error sending message "${channel}" to settings window:`, error)
      }
    }

    if (this.floatingChatWindow && this.floatingChatWindow.isShowing()) {
      const floatingWindow = this.floatingChatWindow.getWindow()
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        try {
          floatingWindow.webContents.send(channel, ...args)
        } catch (error) {
          console.error(`Error sending message "${channel}" to floating chat window:`, error)
        }
      }
    }
  }

  async createShellWindow(options?: {
    activateTabId?: number // 要关联并激活的现有标签页 ID
    initialTab?: {
      // 窗口创建时要创建的新标签页选项
      url: string
      icon?: string
    }
    windowType?: 'chat' | 'browser'
    x?: number // 初始 X 坐标
    y?: number // 初始 Y 坐标
  }): Promise<number | null> {
    console.log('Creating new shell window.')
    const windowType = options?.windowType ?? 'chat'

    // 根据平台选择图标
    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

    // 根据窗口类型设置默认宽度
    const defaultWidth = windowType === 'browser' ? 600 : 800
    const defaultHeight = 620

    // 使用窗口状态管理器恢复位置和尺寸
    const shellWindowState = windowStateManager({
      defaultWidth,
      defaultHeight
    })

    // 计算初始位置，确保窗口完全在屏幕范围内
    const initialX =
      options?.x !== undefined
        ? options.x
        : this.validateWindowPosition(
            shellWindowState.x,
            shellWindowState.width,
            shellWindowState.y,
            shellWindowState.height
          ).x
    let initialY =
      options?.y !== undefined
        ? options?.y
        : this.validateWindowPosition(
            shellWindowState.x,
            shellWindowState.width,
            shellWindowState.y,
            shellWindowState.height
          ).y

    const shellWindow = new BrowserWindow({
      width: shellWindowState.width,
      height: shellWindowState.height,
      x: initialX,
      y: initialY,
      show: false, // 先隐藏窗口，等待 ready-to-show 以避免白屏
      autoHideMenuBar: false, // 隐藏菜单栏
      icon: iconFile, // 设置图标
      titleBarStyle: 'hiddenInset', // macOS 风格标题栏
      transparent: process.platform === 'darwin', // macOS 标题栏透明
      vibrancy: process.platform === 'darwin' ? 'hud' : undefined, // macOS 磨砂效果
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined, // Windows 11 材质效果
      backgroundColor: '#00ffffff', // 透明背景色
      maximizable: true, // 允许最大化
      frame: process.platform === 'darwin', // macOS 无边框
      hasShadow: true, // macOS 阴影
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 10 } : undefined, // macOS 红绿灯按钮位置
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'), // Preload 脚本路径
        sandbox: false, // 禁用沙箱，允许 preload 访问 Node.js API
        devTools: is.dev // 开发模式下启用 DevTools
      },
      roundedCorners: true // Windows 11 圆角
    })

    if (!shellWindow) {
      console.error('Failed to create shell window.')
      return null
    }

    const windowId = shellWindow.id
    this.windows.set(windowId, shellWindow) // 将窗口实例存入 Map
    // ;(presenter.tabPresenter as TabPresenter).setWindowType(windowId, windowType)

    this.windowFocusStates.set(windowId, {
      lastFocusTime: 0,
      shouldFocus: true,
      isNewWindow: true,
      hasInitialFocus: false
    })

    shellWindowState.manage(shellWindow) // 管理窗口状态

    // --- 窗口事件监听 ---
    // 窗口准备就绪时显示
    shellWindow.on('ready-to-show', () => {
      console.log(`Window ${windowId} is ready to show.`)
      if (!shellWindow.isDestroyed()) {
        // For browser windows, don't auto-show/focus to prevent stealing focus from chat windows
        // Browser windows should only be shown when explicitly requested by user (e.g., clicking browser button)
        // const tabPresenterInstance = presenter.tabPresenter as TabPresenter
        // const windowType = tabPresenterInstance.getWindowType(windowId)
        const shouldAutoShow = windowType !== 'browser'
        if (shouldAutoShow) {
          shellWindow.show()
          shellWindow.focus()
        }
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, windowId)
      } else {
        console.warn(`Window ${windowId} was destroyed before ready-to-show.`)
      }
    })

    // --- 加载 Renderer HTML 文件 ---
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      console.log(
        `Loading renderer URL in dev mode: ${process.env['ELECTRON_RENDERER_URL']}/shell/index.html`
      )
      shellWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/shell/index.html')
    } else {
      // 生产模式下加载打包后的 HTML 文件
      console.log(
        `Loading packaged renderer file: ${join(__dirname, '../renderer/shell/index.html')}`
      )
      shellWindow.loadFile(join(__dirname, '../renderer/shell/index.html'))
    }

    // DevTools 不再自动打开，需要手动通过菜单或快捷键打开

    console.log(`Shell window ${windowId} created successfully.`)

    if (this.mainWindowId == null) {
      this.mainWindowId = windowId // 如果这是第一个窗口，设置为主窗口 ID
    }
    return windowId // 返回新创建窗口的 ID
  }

  /**
   * 验证窗口位置是否在屏幕工作区范围内
   * 如果窗口位置超出屏幕边界，则将其居中显示
   *
   * @param x 窗口的 X 坐标（左上角）
   * @param width 窗口的宽度
   * @param y 窗口的 Y 坐标（左上角）
   * @param height 窗口的高度
   * @returns 返回有效的窗口位置坐标 { x, y }，如果原位置无效则返回居中后的坐标
   */
  private validateWindowPosition(
    x: number,
    width: number,
    y: number,
    height: number
  ): { x: number; y: number } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const isXValid = x >= workArea.x && x + width <= workArea.x + workArea.width
    const isYValid = y >= workArea.y && y + height <= workArea.y + workArea.height
    if (!isXValid || !isYValid) {
      console.log(
        `Window position out of bounds (x: ${x}, y: ${y}, width: ${width}, height: ${height}), centering window`
      )
      return {
        x: workArea.x + Math.max(0, (workArea.width - width) / 2),
        y: workArea.y + Math.max(0, (workArea.height - height) / 2)
      }
    }
    return { x, y }
  }

  /**
   * 隐藏指定 ID 的窗口。在全屏模式下，会先退出全屏再隐藏。
   * @param windowId 窗口 ID。
   */
  hide(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Hiding window ${windowId}.`)
      // 处理全屏窗口隐藏时的黑屏问题
      if (window.isFullScreen()) {
        console.log(`Window ${windowId} is fullscreen, exiting fullscreen before hiding.`)
        // 退出全屏后监听 leave-full-screen 事件再隐藏
        window.once('leave-full-screen', () => {
          console.log(`Window ${windowId} left fullscreen, proceeding with hide.`)
          if (!window.isDestroyed()) {
            window.hide()
          } else {
            console.warn(`Window ${windowId} was destroyed after leaving fullscreen, cannot hide.`)
          }
        })
        window.setFullScreen(false) // 请求退出全屏
      } else {
        console.log(`Window ${windowId} is not fullscreen, hiding directly.`)
        window.hide() // 直接隐藏
      }
    } else {
      console.warn(`Failed to hide window ${windowId}, window does not exist or is destroyed.`)
    }
  }

  /**
   * 显示指定 ID 的窗口。如果未指定 ID，则显示焦点窗口或第一个窗口。
   * @param windowId 可选。要显示的窗口 ID。
   * @param shouldFocus 可选。是否获取焦点，默认为 true。
   */
  show(windowId?: number, shouldFocus: boolean = true): void {
    let targetWindow: BrowserWindow | undefined
    if (windowId === undefined) {
      // 未指定 ID，查找焦点窗口或第一个窗口
      targetWindow = this.getFocusedWindow() || this.getAllWindows()[0]
      if (targetWindow && !targetWindow.isDestroyed()) {
        console.log(`Showing default window ${targetWindow.id}.`)
      } else {
        console.warn('No window found to show.')
        return
      }
    } else {
      targetWindow = this.windows.get(windowId)
      if (targetWindow && !targetWindow.isDestroyed()) {
        console.log(`Showing window ${windowId}.`)
      } else {
        console.warn(`Failed to show window ${windowId}, window does not exist or is destroyed.`)
        return
      }
    }

    targetWindow.show()
    if (shouldFocus) {
      targetWindow.focus() // Bring to foreground
    }
    // // 触发恢复逻辑以确保活动标签页可见且位置正确
    // this.handleWindowRestore(targetWindow.id).catch((error) => {
    //   console.error(`Error handling restore logic after showing window ${targetWindow!.id}:`, error)
    // })
  }

  /** ----------------------------- FloatingWindow   ------------------------------------ */
  public async createFloatingChatWindow(): Promise<void> {
    if (this.floatingChatWindow) {
      console.log('FloatingChatWindow already exists')
      return
    }

    try {
      this.floatingChatWindow = new FloatingChatWindow()
      await this.floatingChatWindow.create()
      console.log('FloatingChatWindow created successfully')
    } catch (error) {
      console.error('Failed to create FloatingChatWindow:', error)
      this.floatingChatWindow = null
      throw error
    }
  }

  public async showFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> {
    if (!this.floatingChatWindow) {
      await this.createFloatingChatWindow()
    }

    if (this.floatingChatWindow) {
      this.floatingChatWindow.show(floatingButtonPosition)
      console.log('FloatingChatWindow shown')
    }
  }

  public hideFloatingChatWindow(): void {
    if (this.floatingChatWindow) {
      this.floatingChatWindow.hide()
      console.log('FloatingChatWindow hidden')
    }
  }

  public async toggleFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> {
    if (!this.floatingChatWindow) {
      await this.createFloatingChatWindow()
    }

    if (this.floatingChatWindow) {
      this.floatingChatWindow.toggle(floatingButtonPosition)
      console.log('FloatingChatWindow toggled')
    }
  }

  public destroyFloatingChatWindow(): void {
    if (this.floatingChatWindow) {
      this.floatingChatWindow.destroy()
      this.floatingChatWindow = null
      console.log('FloatingChatWindow destroyed')
    }
  }

  public isFloatingChatWindowVisible(): boolean {
    return this.floatingChatWindow?.isShowing() || false
  }

  public getFloatingChatWindow(): FloatingChatWindow | null {
    return this.floatingChatWindow
  }

  /**
   * 窗口恢复、显示或尺寸变更后的处理逻辑。
   * 主要确保当前活动标签页的 WebContentsView 可见且位置正确。
   * @param windowId 窗口 ID。
   */
  private async handleWindowRestore(windowId: number): Promise<void> {
    console.log(`Handling restore/show logic for window ${windowId}.`)
    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      console.warn(
        `Cannot handle restore/show logic for window ${windowId}, window does not exist or is destroyed.`
      )
      return
    }

    try {
      // 通过 TabPresenter 获取活动标签页 ID
      const tabPresenterInstance = presenter.tabPresenter as TabPresenter
      const activeTabId = await tabPresenterInstance.getActiveTabId(windowId)

      if (activeTabId) {
        console.log(`Window ${windowId} restored/shown: activating active tab ${activeTabId}.`)
        // 调用 switchTab 会确保视图被关联、可见并更新 bounds
        await tabPresenterInstance.switchTab(activeTabId)
      } else {
        console.warn(
          `Window ${windowId} restored/shown: no active tab found, ensuring all views are hidden.`
        )
        // 如果没有活动标签页，确保所有视图都隐藏
        const tabsInWindow = await tabPresenterInstance.getWindowTabsData(windowId)
        for (const tabData of tabsInWindow) {
          const tabView = await tabPresenterInstance.getTab(tabData.id)
          if (tabView && !tabView.webContents.isDestroyed()) {
            tabView.setVisible(false) // 显式隐藏所有标签页视图
          }
        }
      }
    } catch (error) {
      console.error(`Error handling restore/show logic for window ${windowId}:`, error)
    }
  }

  /**
   * 检查指定 ID 的窗口是否已最大化。
   * @param windowId 窗口 ID。
   * @returns 如果窗口存在、有效且已最大化，则返回 true，否则返回 false。
   */
  isMaximized(windowId: number): boolean {
    const window = this.windows.get(windowId)
    return window && !window.isDestroyed() ? window.isMaximized() : false
  }

  /**
   * 最小化指定 ID 的窗口。
   * @param windowId 窗口 ID。
   */
  minimize(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Minimizing window ${windowId}.`)
      window.minimize()
    } else {
      console.warn(`Failed to minimize window ${windowId}, window does not exist or is destroyed.`)
    }
  }

  /**
   * 最大化/还原指定 ID 的窗口。
   * @param windowId 窗口 ID。
   */
  maximize(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Maximizing/unmaximizing window ${windowId}.`)
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
      // 触发恢复逻辑以确保活动标签页的 bounds 更新
      this.handleWindowRestore(windowId).catch((error) => {
        console.error(
          `Error handling restore logic after maximizing/unmaximizing window ${windowId}:`,
          error
        )
      })
    } else {
      console.warn(
        `Failed to maximize/unmaximize window ${windowId}, window does not exist or is destroyed.`
      )
    }
  }

  /**
   * 请求关闭指定 ID 的窗口。这将触发窗口的 'close' 事件。
   * 实际关闭或隐藏行为由 'close' 事件处理程序决定。
   * @param windowId 窗口 ID。
   */
  close(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Requesting to close window ${windowId}, calling window.close().`)
      window.close() // 触发 'close' 事件
    } else {
      console.warn(
        `Failed to request close for window ${windowId}, window does not exist or is destroyed.`
      )
    }
  }

  private getOrCreateTooltipOverlay(parentWindow: BrowserWindow): BrowserWindow | null {
    if (parentWindow.isDestroyed()) return null

    const existing = this.tooltipOverlayWindows.get(parentWindow.id)
    if (existing && !existing.isDestroyed()) {
      this.syncTooltipOverlayBounds(parentWindow, existing)
      return existing
    }

    const bounds = parentWindow.getContentBounds()

    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      parent: parentWindow,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        devTools: is.dev
      }
    })

    if (process.platform === 'darwin') {
      overlay.setHiddenInMissionControl(true)
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    overlay.setIgnoreMouseEvents(true, { forward: true })

    const syncOnMoved = () => {
      const current = this.tooltipOverlayWindows.get(parentWindow.id)
      if (!current || current.isDestroyed() || parentWindow.isDestroyed()) return
      this.syncTooltipOverlayBounds(parentWindow, current)
    }

    // Debounce resize to avoid excessive sync during window resize.
    let resizeSyncTimer: NodeJS.Timeout | null = null
    const syncOnResize = () => {
      const current = this.tooltipOverlayWindows.get(parentWindow.id)
      if (!current || current.isDestroyed() || parentWindow.isDestroyed()) return

      if (resizeSyncTimer) {
        clearTimeout(resizeSyncTimer)
      }

      resizeSyncTimer = setTimeout(() => {
        this.syncTooltipOverlayBounds(parentWindow, current)
        resizeSyncTimer = null
      }, 100)
    }

    parentWindow.on('moved', syncOnMoved)
    parentWindow.on('resize', syncOnResize)
    parentWindow.on('hide', () => {
      if (!overlay.isDestroyed()) overlay.hide()
    })
    parentWindow.on('minimize', () => {
      if (!overlay.isDestroyed()) overlay.hide()
    })

    overlay.on('closed', () => {
      this.tooltipOverlayWindows.delete(parentWindow.id)
      this.pendingTooltipPayload.delete(parentWindow.id)
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      overlay.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/shell/tooltip-overlay/index.html')
    } else {
      overlay.loadFile(join(__dirname, '../renderer/shell/tooltip-overlay/index.html'))
    }

    overlay.webContents.once('did-finish-load', () => {
      if (overlay.isDestroyed()) return
      overlay.webContents.send('shell-tooltip-overlay:clear')

      const pending = this.pendingTooltipPayload.get(parentWindow.id)
      if (pending) {
        if (!overlay.isVisible()) {
          overlay.showInactive()
        }
        overlay.webContents.send('shell-tooltip-overlay:show', pending)
      }
    })

    this.tooltipOverlayWindows.set(parentWindow.id, overlay)
    return overlay
  }

  private syncTooltipOverlayBounds(parentWindow: BrowserWindow, overlay: BrowserWindow): void {
    if (parentWindow.isDestroyed() || overlay.isDestroyed()) return
    const bounds = parentWindow.getContentBounds()
    overlay.setBounds(bounds)
  }

  private clearTooltipOverlay(windowId: number): void {
    const overlay = this.tooltipOverlayWindows.get(windowId)
    if (!overlay || overlay.isDestroyed()) return
    this.pendingTooltipPayload.delete(windowId)
    overlay.webContents.send('shell-tooltip-overlay:hide')
    if (overlay.isVisible()) {
      overlay.hide()
    }
  }

  private destroyTooltipOverlay(windowId: number): void {
    const overlay = this.tooltipOverlayWindows.get(windowId)
    if (overlay && !overlay.isDestroyed()) {
      overlay.destroy()
    }
    this.tooltipOverlayWindows.delete(windowId)
    this.pendingTooltipPayload.delete(windowId)
  }
}
