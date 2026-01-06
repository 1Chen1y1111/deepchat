import { LifecyclePhase } from '@shared/lifecycle'
import {
  HookExecutionResult,
  ILifecycleManager,
  ISplashWindowManager,
  LifecycleContext,
  LifecycleHook,
  LifecycleState
} from '@shared/types/presenters'
import { SplashWindowManager } from './SplashWindowManager'
import { LIFECYCLE_EVENTS } from '@/events'
import {
  BaseLifecycleEvent,
  ErrorOccurredEventData,
  HookExecutedEventData,
  HookFailedEventData,
  PhaseCompletedEventData,
  PhaseStartedEventData
} from './types'
import { SendTarget, eventBus } from '@/eventbus'
import { is } from '@electron-toolkit/utils'

export class LifecycleManager implements ILifecycleManager {
  private state: LifecycleState
  private hookIdCounter = 0
  private splashManager: ISplashWindowManager
  private lifecycleContext: LifecycleContext
  private isUpdateInProgress = false

  constructor() {
    this.state = {
      currentPhase: null,
      completedPhases: new Set(),
      startTime: 0,
      phaseStartTimes: new Map(),
      hooks: new Map(),
      isShuttingDown: false
    }

    // Initialize hook maps for all phases
    Object.values(LifecyclePhase).forEach((phase) => {
      this.state.hooks.set(phase, [])
    })

    // Initialize splash window manager
    this.splashManager = new SplashWindowManager()

    // Initialize single lifecycle context instance
    this.lifecycleContext = {
      phase: LifecyclePhase.INIT, // Will be updated during execution
      manager: this
    }
  }

  /**
   * Start the lifecycle management system and execute all phases
   */
  async start(): Promise<void> {
    if (this.state.currentPhase !== null) {
      throw new Error('Lifecycle manager has already been started')
    }

    this.state.startTime = Date.now()

    try {
      // Create and show splash window
      await this.splashManager.create()

      // Execute startup phases in sequence
      await this.executePhase(LifecyclePhase.INIT)
      await this.executePhase(LifecyclePhase.BEFORE_START)
      await this.executePhase(LifecyclePhase.READY)
      await this.executePhase(LifecyclePhase.AFTER_START)

      // Close splash window after startup is complete
      await this.splashManager.close()
    } catch (error) {
      // Close splash window on error
      if (this.splashManager.isVisible()) {
        await this.splashManager.close()
      }

      this.notifyMessage(LIFECYCLE_EVENTS.ERROR_OCCURRED, {
        phase: this.state.currentPhase,
        reason: error instanceof Error ? error.message : String(error)
      } as unknown as ErrorOccurredEventData)
      throw error
    }
  }

  /**
   * Register a hook for a specific lifecycle phase
   */
  registerHook(hook: LifecycleHook): string {
    const hookId = `hook_${++this.hookIdCounter}_${Date.now()}`
    const phase = hook.phase
    const phaseHooks = this.state.hooks.get(phase)

    if (!phaseHooks) {
      throw new Error(`Invalid lifecycle phase: ${phase}`)
    }

    // Insert hook in priority order (lower priority numbers execute first)
    const priority = hook.priority
    const insertIndex = phaseHooks.findIndex((h) => h.hook.priority > priority)

    if (insertIndex === -1) {
      phaseHooks.push({ id: hookId, hook })
    } else {
      phaseHooks.splice(insertIndex, 0, { id: hookId, hook })
    }

    console.log(
      `Registered lifecycle hook '${hook.name}' for phase '${phase}' with priority ${priority}`
    )
    return hookId
  }

  /**
   * Request application shutdown with hook interception
   */
  async requestShutdown(): Promise<boolean> {
    return true
  }

  /**
   * Get the single lifecycle context instance
   */
  getLifecycleContext(): LifecycleContext {
    return this.lifecycleContext
  }

  /**
   * Execute a lifecycle phase and all its registered hooks
   */
  private async executePhase(phase: LifecyclePhase): Promise<void> {
    const phaseStartTime = Date.now()

    this.state.currentPhase = phase
    this.state.phaseStartTimes.set(phase, phaseStartTime)

    // Calculate progress based on phase
    const phaseProgress = this.calculatePhaseProgress(phase)
    this.splashManager.updateProgress(phase, phaseProgress.start)

    // Emit phase started event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_STARTED, {
      phase,
      hookCount: this.state.hooks.get(phase)?.length || 0
    } as PhaseStartedEventData)

    const phaseHooks = this.state.hooks.get(phase) || []

    // Update the single context instance with current phase
    this.lifecycleContext.phase = phase

    // Use priority-based execution for all hooks in this phase
    await this.executeHooksByPriority(phaseHooks, this.lifecycleContext, phase, false)

    // Update progress to phase completion
    this.splashManager.updateProgress(phase, phaseProgress.end)

    this.state.completedPhases.add(phase)

    const phaseDuration = Date.now() - phaseStartTime

    // Emit phase completed event to both main and renderer processes
    this.notifyMessage(LIFECYCLE_EVENTS.PHASE_COMPLETED, {
      phase,
      duration: phaseDuration
    } as PhaseCompletedEventData)
  }

  /**
   * Execute hooks grouped by priority with parallel execution within groups
   * and sequential execution between groups
   */
  private async executeHooksByPriority(
    phaseHooks: Array<{ id: string; hook: LifecycleHook }>,
    context: LifecycleContext,
    phase: LifecyclePhase,
    isShutdownPhase: boolean = false
  ): Promise<boolean> {
    // Group hooks by priority
    const priorityGroups = new Map<number, Array<{ id: string; hook: LifecycleHook }>>()

    for (const hookEntry of phaseHooks) {
      const priority = hookEntry.hook.priority
      if (!priorityGroups.has(priority)) {
        priorityGroups.set(priority, [])
      }
      priorityGroups.get(priority)!.push(hookEntry)
    }

    // Sort priority groups by priority value (lower numbers first)
    const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b)

    let totalCompletedHooks = 0
    const totalHooks = phaseHooks.length

    // Execute each priority group sequentially
    for (const priority of sortedPriorities) {
      const groupHooks = priorityGroups.get(priority)!

      // Execute all hooks in this priority group in parallel
      const hookPromises = groupHooks.map(async ({ id, hook }): Promise<HookExecutionResult> => {
        try {
          const result = await this.executeHook(hook, context)
          return {
            hookId: id,
            hook,
            success: true,
            result
          }
        } catch (error) {
          return {
            hookId: id,
            hook,
            success: false,
            error: error instanceof Error ? error : new Error(String(error))
          }
        }
      })

      // Wait for all hooks in this priority group to complete
      const groupResults = await Promise.allSettled(hookPromises)

      // Process results and handle errors
      for (const promiseResult of groupResults) {
        if (promiseResult.status === 'fulfilled') {
          const hookResult = promiseResult.value

          if (!hookResult.success) {
            // Hook failed
            if (hookResult.hook.critical) {
              if (isShutdownPhase) {
                // For shutdown phases, log critical errors but continue
                console.error(
                  `[LifecycleManager] Critical shutdown hook '${hookResult.hook.name}' failed, but continuing shutdown:`,
                  hookResult.error?.message || 'Unknown error'
                )
              } else {
                // For startup phases, throw the error to stop execution
                throw (
                  hookResult.error || new Error(`Critical hook '${hookResult.hook.name}' failed`)
                )
              }
            } else {
              // Non-critical hook failure - log and continue
              console.warn(
                `[LifecycleManager] Non-critical hook '${hookResult.hook.name}' failed:`,
                hookResult.error?.message || 'Unknown error'
              )
            }
          } else {
            // Hook succeeded - check for shutdown prevention
            if (
              isShutdownPhase &&
              phase === LifecyclePhase.BEFORE_QUIT &&
              hookResult.result === false
            ) {
              return false // Shutdown prevented
            }
          }
        } else {
          // Promise itself was rejected (shouldn't happen with our error handling, but just in case)
          console.error(
            '[LifecycleManager] Unexpected promise rejection in hook execution:',
            promiseResult.reason
          )
        }
      }

      // Update progress after completing this priority group
      totalCompletedHooks += groupHooks.length
      if (!isShutdownPhase && this.splashManager) {
        const phaseProgress = this.calculatePhaseProgress(phase)
        const hookProgress =
          phaseProgress.start +
          ((phaseProgress.end - phaseProgress.start) * totalCompletedHooks) /
            Math.max(totalHooks, 1)
        this.splashManager.updateProgress(phase, hookProgress)
      }
    }

    return true // All hooks completed successfully or shutdown not prevented
  }

  /**
   * Execute a single lifecycle hook with error handling based on critical property
   */
  private async executeHook(
    hook: LifecycleHook,
    context: LifecycleContext
  ): Promise<void | boolean> {
    const { name, phase, priority, critical } = hook

    // Emit hook execution start event
    const executedMessage: HookExecutedEventData = {
      name,
      phase,
      critical,
      priority
    }
    this.notifyMessage(LIFECYCLE_EVENTS.HOOK_EXECUTED, executedMessage)

    try {
      const result = await hook.execute(context)

      if (is.dev) {
        const hookDelay = Number(import.meta.env.VITE_APP_LIFECYCLE_HOOK_DELAY)
        await new Promise((resolve) => setTimeout(resolve, hookDelay))
      }

      this.notifyMessage(LIFECYCLE_EVENTS.HOOK_COMPLETED, executedMessage)

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Send notification about the failure
      this.notifyMessage(LIFECYCLE_EVENTS.HOOK_FAILED, {
        ...executedMessage,
        error: errorMessage
      } as HookFailedEventData)

      throw error
    }
  }

  /**
   * Calculate progress percentage for each lifecycle phase
   */
  private calculatePhaseProgress(phase: LifecyclePhase): { start: number; end: number } {
    const phaseProgressMap = {
      [LifecyclePhase.INIT]: { start: 0, end: 25 },
      [LifecyclePhase.BEFORE_START]: { start: 25, end: 50 },
      [LifecyclePhase.READY]: { start: 50, end: 75 },
      [LifecyclePhase.AFTER_START]: { start: 75, end: 100 }
    }

    return phaseProgressMap[phase] || { start: 0, end: 100 }
  }

  private notifyMessage(event: string, data: BaseLifecycleEvent) {
    eventBus.sendToMain(event, data)
    if (this.lifecycleContext.presenter) {
      eventBus.sendToRenderer(event, SendTarget.ALL_WINDOWS, data)
    }
  }
}
