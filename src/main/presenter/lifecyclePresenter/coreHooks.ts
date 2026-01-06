import { ILifecycleManager } from '@shared/types/presenters'
import * as hooks from './hooks'

/**
 * Register core application hooks with the lifecycle manager
 * This function should be called during lifecycle manager initialization
 */
export function registerCoreHooks(lifecycleManager: ILifecycleManager): void {
  console.log('Registering core application lifecycle hooks')
  Object.keys(hooks).forEach((key) => {
    lifecycleManager.registerHook(hooks[key])
  })
}
