import { Menu, NativeImage, Tray, app, nativeImage } from 'electron'
import path from 'path'
import { presenter } from '..'
import { getContextMenuLabels } from '@shared/i18n'
import { eventBus } from '@/eventbus'
import { TRAY_EVENTS } from '@/events'

export class TrayPresenter {
  private tray: Tray | null = null
  private iconPath: string

  constructor() {
    this.iconPath = path.join(app.getAppPath(), 'resources')
  }

  // Initialize the system tray icon and menu
  private createTray() {
    // according to different OS, set different icon
    let image: NativeImage | undefined = undefined

    if (process.platform === 'darwin') {
      // macOS platform
      image = nativeImage.createFromPath(path.join(this.iconPath, 'macTrayTemplate.png'))
      image = image.resize({ width: 24, height: 24 })
      image.setTemplateImage(true)
    } else if (process.platform === 'win32') {
      // Windows platform
      image = nativeImage.createFromPath(path.join(this.iconPath, 'win_tray.ico'))
    } else {
      // Linux or other platforms
      image = nativeImage.createFromPath(path.join(this.iconPath, 'linux_tray.png'))
      // linux usually use smaller icon
      image = image.resize({ width: 22, height: 22 })
    }

    this.tray = new Tray(image)
    this.tray.setToolTip('DeepChat')

    // get current language from config presenter
    const locale = presenter.configPresenter.getLanguage?.() || 'zh-CN'
    const labels = getContextMenuLabels(locale)
    const contextMenu = Menu.buildFromTemplate([
      {
        label: labels.open || '打开/隐藏',
        click: () => {
          eventBus.sendToMain(TRAY_EVENTS.SHOW_HIDDEN_WINDOW)
        }
      },
      {
        label: labels.checkForUpdates || '检查更新',
        click: () => {
          eventBus.sendToMain(TRAY_EVENTS.CHECK_FOR_UPDATES)
        }
      },
      {
        label: labels.quit || '退出',
        click: async () => {
          app.quit() // Exit trigger: tray menu
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)

    // when tray icon is clicked, show or hide the main window
    this.tray.on('click', () => {
      eventBus.sendToMain(TRAY_EVENTS.SHOW_HIDDEN_WINDOW, true)
    })
  }

  public init() {
    this.createTray()
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
