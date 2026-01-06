import { app, dialog } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import log from 'electron-log'
import { SendTarget, eventBus } from './eventbus'
import { NOTIFICATION_EVENTS, WINDOW_EVENTS } from './events'
import { Presenter, getInstance } from './presenter'
import { LifecycleManager } from './presenter/lifecyclePresenter'
import { registerCoreHooks } from './presenter/lifecyclePresenter/coreHooks'

// Handle unhandled exceptions to prevent app crash or error dialogs
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error)

  const msg = error.message || 'Unknown error'
  const isNetworkError = [
    'net::ERR',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'Network Error',
    'fetch failed'
  ].some((k) => msg.includes(k))

  if (isNetworkError) {
    // Send error to renderer to show a toast notification
    // This is "elegant" and non-blocking
    eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
      id: Date.now().toString(),
      title: 'Network Error',
      message: msg,
      type: 'error'
    })
  }
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Rejection:', reason)
})

// Set application command line arguments
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required') // Allow video autoplay
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100') // Set WebRTC max CPU usage
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096') // Set V8 heap memory size
app.commandLine.appendSwitch('ignore-certificate-errors') // Ignore certificate errors (for dev or specific scenarios)

// Set platform-specific command line arguments
if (process.platform == 'win32') {
  // Windows platform specific parameters (currently commented out)
  // app.commandLine.appendSwitch('in-process-gpu')
  // app.commandLine.appendSwitch('wm-window-animations-disabled')
}
if (process.platform === 'darwin') {
  // macOS platform specific parameters
  app.commandLine.appendSwitch('disable-features', 'DesktopCaptureMacV2,IOSurfaceCapturer')
}

// Initialize lifecycle manager and register core hooks
const lifecycleManager = new LifecycleManager()
registerCoreHooks(lifecycleManager)

// Initialize presenter after ready
let presenter: Presenter

// Start the lifecycle management system instead of using app.whenReady()
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.1Chen1y1111.deepchat')

  try {
    console.log('main: Application lifecycle startup')
    await lifecycleManager.start()
    presenter = getInstance(lifecycleManager)
    console.log('main: Application lifecycle startup completed successfully')
  } catch (error) {
    console.error('main: Application lifecycle startup failed:', error)
    dialog.showErrorBox(
      'Application startup failed',
      error instanceof Error ? error.message : String(error)
    )
    app.quit() // Serious error, exit the program
  }
})

// Handle window-all-closed event
app.on('window-all-closed', () => {
  if (!presenter) return

  // Check if there are any non-floating-button windows
  const mainWindows = presenter.windowPresenter.getAllWindows()

  if (mainWindows.length === 0) {
    // When only floating button windows exist, quit app on non-macOS platforms
    console.log('main: All main windows closed, requesting shutdown')
    app.quit() // Keep this event to avoid unexpected situations
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
