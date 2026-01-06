/**
 * Presenter lifecycle hook
 */

import { LifecyclePhase } from '@shared/lifecycle'
import { getInstance } from '@/presenter'
import { LifecycleContext, LifecycleHook } from '@shared/types/presenters'

export const presenterInitHook: LifecycleHook = {
  name: 'presenter-initialization',
  phase: LifecyclePhase.READY,
  priority: 1,
  critical: true, // Presenter initialization is critical for app functionality
  async execute(context: LifecycleContext): Promise<void> {
    // init presenter
    console.log('presenterInitHook: Create Presenter Instance')
    const presenter = getInstance(context.manager)
    // TODO: presenter.deeplinkPresenter.init()
    presenter.init()
    context.presenter = presenter
  }
}
