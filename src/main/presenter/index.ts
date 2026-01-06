import {
  IConfigPresenter,
  ILifecycleManager,
  IPresenter,
  IShortcutPresenter,
  ITabPresenter,
  IWindowPresenter
} from '@shared/types/presenters'
import { WindowPresenter } from './windowPresenter'
import { eventBus } from '@/eventbus'
import { WINDOW_EVENTS } from '@/events'
import { TrayPresenter } from './trayPresenter'
import { TabPresenter } from './tabPresenter'
import { ShortcutPresenter } from './shortcutPresenter'
import { IpcMain, IpcMainInvokeEvent, ipcMain } from 'electron'

// 注意: 现在大部分事件已在各自的 presenter 中直接发送到渲染进程
// 剩余的自动转发事件已在 EventBus 的 DEFAULT_RENDERER_EVENTS 中定义

// 主 Presenter 类，负责协调其他 Presenter 并处理 IPC 通信
export class Presenter implements IPresenter {
  // 私有静态实例
  private static instance: Presenter

  // TODO:
  // 添加其他子 Presenter 属性
  windowPresenter: IWindowPresenter
  tabPresenter: ITabPresenter
  shortcutPresenter: IShortcutPresenter
  trayPresenter: TrayPresenter
  configPresenter: IConfigPresenter
  lifecycleManager: ILifecycleManager

  private constructor(lifecycleManager: ILifecycleManager) {
    // Store lifecycle manager reference for component access
    // If the initialization is successful, there should be no null here
    this.lifecycleManager = lifecycleManager
    const context = lifecycleManager.getLifecycleContext()
    this.configPresenter = context.config as IConfigPresenter

    // initialize other presenters
    this.windowPresenter = new WindowPresenter(this.configPresenter)
    this.tabPresenter = new TabPresenter(this.windowPresenter)
    this.shortcutPresenter = new ShortcutPresenter(this.configPresenter)
    this.trayPresenter = new TrayPresenter()

    this.setupEventBus() // 设置事件总线监听
  }

  setupTray() {
    console.info('setupTray', !!this.trayPresenter)
    if (!this.trayPresenter) {
      this.trayPresenter = new TrayPresenter()
    }
    this.trayPresenter.init()
  }

  init() {
    console.log('Presenter initialized')
  }

  destroy() {
    console.log('Presenter destroyed')
  }

  public static getInstance(lifecycleManager: ILifecycleManager): Presenter {
    if (!Presenter.instance) {
      // 只能在类内部调用私有构造函数
      Presenter.instance = new Presenter(lifecycleManager)
    }
    return Presenter.instance
  }

  // 设置事件总线监听和转发
  setupEventBus() {
    // 设置 WindowPresenter 和 TabPresenter 到 EventBus
    eventBus.setWindowPresenter(this.windowPresenter)
    // eventBus.setTabPresenter(this.tabPresenter)

    // 应用主窗口准备就绪时触发初始化（只执行一次）
    let initCalled = false
    eventBus.on(WINDOW_EVENTS.READY_TO_SHOW, () => {
      if (!initCalled) {
        initCalled = true
        this.init()
      }
    })
  }
}

// Initialize presenter with database instance and optional lifecycle manager
export function getInstance(lifecycleManager: ILifecycleManager): Presenter {
  // only allow initialize once
  if (presenter == null) presenter = Presenter.getInstance(lifecycleManager)
  return presenter
}

// Export presenter instance - will be initialized with database during lifecycle
export let presenter: Presenter

// 检查对象属性是否为函数 (用于动态调用)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFunction(obj: any, prop: string): obj is { [key: string]: (...args: any[]) => any } {
  return typeof obj[prop] === 'function'
}

// IPC调用上下文接口
interface IPCCallContext {
  tabId?: number
  windowId?: number
  webContentsId: number
  presenterName: string
  methodName: string
  timestamp: number
}

// IPC 主进程处理程序：动态调用 Presenter 的方法 (支持Tab上下文)
ipcMain.handle(
  'presenter:call',
  (event: IpcMainInvokeEvent, name: string, method: string, ...payloads: unknown[]) => {
    try {
      // 构建调用上下文
      const webContentsId = event.sender.id
      const tabId = presenter.tabPresenter.getTabIdByWebContentsId(webContentsId)
      const windowId = presenter.tabPresenter.getWindowIdByWebContentsId(webContentsId)

      const context: IPCCallContext = {
        tabId,
        windowId,
        webContentsId,
        presenterName: name,
        methodName: method,
        timestamp: Date.now()
      }

      // 记录调用日志 (包含tab上下文)
      if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
        console.log(
          `[IPC Call] Tab:${context.tabId || 'unknown'} Window:${context.windowId || 'unknown'} -> ${context.presenterName}.${context.methodName}`
        )
      }

      // 通过名称获取对应的 Presenter 实例
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calledPresenter: any = presenter[name as keyof Presenter]

      if (!calledPresenter) {
        console.warn(`[IPC Warning] Tab:${context.tabId} calling wrong presenter: ${name}`)
        return { error: `Presenter "${name}" not found` }
      }

      // 检查方法是否存在且为函数
      if (isFunction(calledPresenter, method)) {
        // 调用方法并返回结果
        return calledPresenter[method](...payloads)
      } else {
        console.warn(
          `[IPC Warning] Tab:${context.tabId} called method is not a function or does not exist: ${name}.${method}`
        )
        return { error: `Method "${method}" not found or not a function on "${name}"` }
      }
    } catch (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e: any
    ) {
      // 尝试获取调用上下文以改进错误日志
      const webContentsId = event.sender.id
      const tabId = presenter.tabPresenter.getTabIdByWebContentsId(webContentsId)

      console.error(`[IPC Error] Tab:${tabId || 'unknown'} ${name}.${method}:`, e)
      return { error: e.message || String(e) }
    }
  }
)
