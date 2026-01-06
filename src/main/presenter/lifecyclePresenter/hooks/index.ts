/**
 * Lifecycle hooks index
 * Exports all available lifecycle hooks for registration with the LifecycleManager
 */

export { configInitHook } from './init/configInitHook'
export { protocolRegistrationHook } from './before-start/protocolRegistrationHook'
export { presenterInitHook as presenterHook } from './ready/presenterInitHook'
export { eventListenerSetupHook } from './ready/eventListenerSetupHook'
export { traySetupHook } from './after-start/traySetupHook'
export { windowCreationHook } from './after-start/windowCreationHook'
