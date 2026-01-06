import '@/assets/main.css'
import { CONFIG_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import { DEFAULT_CODE_FONT_STACK, DEFAULT_TEXT_FONT_STACK, buildFontStack } from '@/lib/fontStack'

type TooltipOverlayShowPayload = {
  x: number
  y: number
  text: string
}

const configPresenter = usePresenter('configPresenter')

const applyFontVariables = (textFont: string, codeFont: string) => {
  document.documentElement.style.setProperty('--dc-font-family', textFont)
  document.documentElement.style.setProperty('--dc-code-font-family', codeFont)
}

const toTextFontStack = (font: unknown) =>
  buildFontStack(typeof font === 'string' ? font : '', DEFAULT_TEXT_FONT_STACK)
const toCodeFontStack = (font: unknown) =>
  buildFontStack(typeof font === 'string' ? font : '', DEFAULT_CODE_FONT_STACK)

const root = document.getElementById('app')
if (!root) {
  throw new Error('Tooltip overlay: missing #app')
}

root.className = 'fixed inset-0 pointer-events-none'

const tooltip = document.createElement('div')
tooltip.className =
  'fixed left-0 top-0 z-[2147483647] hidden select-none whitespace-nowrap rounded-md border border-border bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg'

const arrow = document.createElement('div')
arrow.className =
  'absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-primary'

const textNode = document.createElement('div')

tooltip.appendChild(textNode)
tooltip.appendChild(arrow)
root.appendChild(tooltip)

const { ipcRenderer } = window.electron

const initFonts = async () => {
  const [fontFamily, codeFontFamily] = await Promise.all([
    configPresenter.getFontFamily(),
    configPresenter.getCodeFontFamily()
  ])
  applyFontVariables(toTextFontStack(fontFamily), toCodeFontStack(codeFontFamily))
}

initFonts().catch((error) => {
  console.warn('Tooltip overlay: failed to initialize fonts', error)
})

ipcRenderer.on(CONFIG_EVENTS.FONT_FAMILY_CHANGED, (_event, value) => {
  document.documentElement.style.setProperty('--dc-font-family', toTextFontStack(value))
})

ipcRenderer.on(CONFIG_EVENTS.CODE_FONT_FAMILY_CHANGED, (_event, value) => {
  document.documentElement.style.setProperty('--dc-code-font-family', toCodeFontStack(value))
})

const hide = () => {
  tooltip.classList.add('hidden')
}

const show = (payload: TooltipOverlayShowPayload) => {
  textNode.textContent = payload.text

  // First, show the tooltip to measure its width
  tooltip.classList.remove('hidden')

  // Get tooltip width for boundary calculation
  const tooltipRect = tooltip.getBoundingClientRect()
  const tooltipWidth = tooltipRect.width
  const windowWidth = window.innerWidth

  // Calculate horizontal position with boundary check
  let x = payload.x
  let transform = 'translate(-50%, 0)' // Default: center aligned
  let arrowPosition = '50%' // Default: center of tooltip

  // Check if tooltip would overflow on the left
  if (x - tooltipWidth / 2 < 0) {
    // Align to left edge with small padding
    const leftPadding = 8
    arrowPosition = `${Math.max(12, x - leftPadding)}px` // Position arrow at original x
    x = leftPadding
    transform = 'translate(0, 0)'
  }
  // Check if tooltip would overflow on the right
  else if (x + tooltipWidth / 2 > windowWidth) {
    // Align to right edge with small padding
    const rightPadding = 8
    const tooltipLeft = windowWidth - tooltipWidth - rightPadding
    arrowPosition = `${x - tooltipLeft}px` // Position arrow at original x relative to tooltip
    x = tooltipLeft
    transform = 'translate(0, 0)'
  }

  tooltip.style.left = `${x}px`
  tooltip.style.top = `${payload.y}px`
  tooltip.style.transform = transform
  arrow.style.left = arrowPosition
}

ipcRenderer.on('shell-tooltip-overlay:show', (_event, payload: TooltipOverlayShowPayload) => {
  show(payload)
})

ipcRenderer.on('shell-tooltip-overlay:hide', () => {
  hide()
})

ipcRenderer.on('shell-tooltip-overlay:clear', () => {
  hide()
})
