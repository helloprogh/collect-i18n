// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createElementPlusCommandAdapter,
  enqueueDescriptors,
  installCollectorRuntime,
  uninstallGlobalCollector,
} from './index.js'

function testRect(
  { x = 10, y = 20, width = 120, height = 30 }: Partial<DOMRect> = {},
): DOMRect {
  return {
    x,
    y,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

function visibleRect(element: Element): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(testRect())
}

async function mutationsSettled(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  if (window.__COLLECT_I18N__) uninstallGlobalCollector(window)
  delete window.__COLLECT_I18N_PENDING__
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('CollectorRegistry', () => {
  it('discovers native markers and publishes a visible target event', () => {
    const button = document.createElement('button')
    button.dataset.i18nKey = 'actions.save'
    button.dataset.i18nOccurrence = 'save-button'
    button.textContent = '保存'
    visibleRect(button)
    document.body.append(button)

    const registry = installCollectorRuntime({ overlay: true })
    const events: string[] = []
    registry.subscribe((event) => events.push(event.type))
    registry.setTarget({ key: 'actions.save' })

    expect(registry.getOccurrence('save-button')).toMatchObject({
      key: 'actions.save',
      anchorType: 'element',
      connected: true,
      visible: true,
      text: '保存',
    })
    expect(events).toContain('target-found')
    expect(document.querySelector<HTMLElement>('[data-collect-i18n-overlay]')?.style.display).toBe(
      'block',
    )
  })

  it('does not create an endless mutation loop while a target overlay is visible', async () => {
    const button = document.createElement('button')
    button.dataset.i18nKey = 'actions.save'
    button.dataset.i18nOccurrence = 'save-button'
    button.textContent = '保存'
    visibleRect(button)
    document.body.append(button)

    const registry = installCollectorRuntime({ overlay: true })
    registry.setTarget({ key: 'actions.save' })
    const overlay = document.querySelector('[data-collect-i18n-overlay]')!
    const originalLabelNode = overlay.firstElementChild?.firstChild
    registry.rescan(document)

    // MutationObserver callbacks run before timers. This timer could never
    // execute when overlay refreshes continuously rewrote the same label.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(overlay.textContent).toContain('actions.save')
    expect(overlay.firstElementChild?.firstChild).toBe(originalLabelNode)
  })

  it('only reports positive-size anchors as visible when they intersect the viewport', () => {
    const button = document.createElement('button')
    button.dataset.i18nKey = 'actions.offscreen'
    button.dataset.i18nOccurrence = 'offscreen-button'
    button.textContent = '视口外按钮'
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
      testRect({ y: window.innerHeight + 20 }),
    )
    document.body.append(button)

    const registry = installCollectorRuntime({ overlay: false })

    expect(registry.getOccurrence('offscreen-button')).toMatchObject({
      connected: true,
      visible: false,
    })
  })

  it('focuses an element anchor, scrolls it into view, and returns a fresh snapshot', () => {
    let top = window.innerHeight + 20
    const button = document.createElement('button')
    button.dataset.i18nKey = 'actions.focus'
    button.dataset.i18nOccurrence = 'focus-button'
    button.textContent = '定位按钮'
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => testRect({ y: top }))
    const scrollIntoView = vi.fn(() => {
      top = 100
    })
    Object.defineProperty(button, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    document.body.append(button)

    const registry = installCollectorRuntime({ overlay: false })
    expect(registry.getOccurrence('focus-button')?.visible).toBe(false)

    const focused = registry.focus('actions.focus')

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'center',
    })
    expect(focused).toMatchObject({ occurrenceId: 'focus-button', visible: true })
  })

  it('focuses a Range anchor through its containing element', () => {
    let top = window.innerHeight + 20
    const label = document.createElement('span')
    label.textContent = '范围定位'
    const scrollIntoView = vi.fn(() => {
      top = 80
    })
    Object.defineProperty(label, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    document.body.append(label)
    const range = document.createRange()
    range.selectNodeContents(label.firstChild!)
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => testRect({ y: top }),
    })

    const registry = installCollectorRuntime({ overlay: false })
    registry.registerRange(
      { occurrenceId: 'range-label', key: 'labels.range', kind: 'text' },
      range,
    )

    const focused = registry.focus({ occurrenceId: 'range-label' })

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(focused).toMatchObject({ anchorType: 'range', visible: true })
  })

  it('upgrades compiled slot text from a virtual descriptor to a Range anchor', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'slot-label',
        key: 'actions.submit',
        kind: 'text',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const button = document.createElement('button')
    button.textContent = '提交表单'
    document.body.append(button)

    registry.recordRenderedValue('slot-label', '提交表单')
    await mutationsSettled()

    expect(registry.getOccurrence('slot-label')).toMatchObject({
      anchorType: 'range',
      connected: true,
      text: '提交表单',
    })
  })

  it('resolves component props by their rendered DOM attributes', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'name-placeholder',
        key: 'form.name.placeholder',
        kind: 'component-prop',
        component: 'el-input',
        prop: 'placeholder',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const input = document.createElement('input')
    input.placeholder = '请输入姓名'
    document.body.append(input)

    registry.recordRenderedValue('name-placeholder', '请输入姓名')
    await mutationsSettled()

    expect(registry.getOccurrence('name-placeholder')).toMatchObject({
      anchorType: 'element',
      connected: true,
    })
  })

  it('falls back to a Range for a component prop only when its text node is unique', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'unique-component-label',
        key: 'form.unique.label',
        kind: 'component-prop',
        component: 'el-form-item',
        prop: 'label',
      },
      {
        occurrenceId: 'ambiguous-component-label',
        key: 'form.ambiguous.label',
        kind: 'component-prop',
        component: 'el-form-item',
        prop: 'label',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const unique = document.createElement('span')
    unique.textContent = '唯一标签'
    const duplicateOne = document.createElement('span')
    duplicateOne.textContent = '重复标签'
    const duplicateTwo = document.createElement('span')
    duplicateTwo.textContent = '重复标签'
    document.body.append(unique, duplicateOne, duplicateTwo)

    registry.recordRenderedValue('unique-component-label', '唯一标签')
    registry.recordRenderedValue('ambiguous-component-label', '重复标签')
    await mutationsSettled()

    expect(registry.getOccurrence('unique-component-label')).toMatchObject({
      anchorType: 'range',
      connected: true,
    })
    expect(registry.getOccurrence('ambiguous-component-label')).toMatchObject({
      anchorType: 'virtual',
      connected: false,
    })

    const newlyAmbiguous = document.createElement('span')
    newlyAmbiguous.textContent = '唯一标签'
    document.body.append(newlyAmbiguous)
    registry.rescan(document)
    await mutationsSettled()
    expect(registry.getOccurrence('unique-component-label')?.anchorType).toBe('virtual')

    unique.setAttribute('label', '唯一标签')
    registry.rescan(document)
    await mutationsSettled()
    expect(registry.getOccurrence('unique-component-label')?.anchorType).toBe('element')
  })

  it('binds multiple instrumented descriptors inside real ElNotification Teleport DOM', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'notification-title',
        key: 'notification.failureTitle',
        kind: 'imperative-service',
        service: 'ElNotification',
      },
      {
        occurrenceId: 'notification-message',
        key: 'notification.failureMessage',
        kind: 'imperative-service',
        service: 'ElNotification',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    registry.recordRenderedValue('notification-title', '提交失败')
    registry.recordRenderedValue('notification-message', '请检查网络后重试')

    const notification = document.createElement('div')
    notification.className = 'el-notification'
    const title = document.createElement('h2')
    title.className = 'el-notification__title'
    title.textContent = '提交失败'
    const message = document.createElement('div')
    message.className = 'el-notification__content'
    message.textContent = '请检查网络后重试'
    notification.append(title, message)
    document.body.append(notification)
    await mutationsSettled()

    expect(registry.getOccurrence('notification-title')).toMatchObject({
      service: 'ElNotification',
      anchorType: 'range',
      connected: true,
    })
    expect(registry.getOccurrence('notification-message')).toMatchObject({
      service: 'ElNotification',
      anchorType: 'range',
      connected: true,
    })
  })

  it('retries an initially unmatched ElMessageBox when it is rescanned after rendering', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'messagebox-title',
        key: 'messagebox.confirmTitle',
        kind: 'imperative-service',
        service: 'ElMessageBox',
      },
      {
        occurrenceId: 'messagebox-message',
        key: 'messagebox.confirmMessage',
        kind: 'imperative-service',
        service: 'ElMessageBox',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    registry.recordRenderedValue('messagebox-title', '删除记录')
    registry.recordRenderedValue('messagebox-message', '此操作不可撤销')

    const messageBox = document.createElement('div')
    messageBox.className = 'el-message-box'
    document.body.append(messageBox)
    registry.rescan(messageBox)
    expect(registry.getOccurrence('messagebox-title')?.anchorType).toBe('virtual')

    const title = document.createElement('span')
    title.className = 'el-message-box__title'
    title.textContent = '删除记录'
    const message = document.createElement('div')
    message.className = 'el-message-box__message'
    message.textContent = '此操作不可撤销'
    messageBox.append(title, message)
    registry.rescan(messageBox)
    await mutationsSettled()

    expect(registry.getOccurrence('messagebox-title')).toMatchObject({
      anchorType: 'range',
      connected: true,
    })
    expect(registry.getOccurrence('messagebox-message')).toMatchObject({
      anchorType: 'range',
      connected: true,
    })
  })

  it('matches a wrapped ElMessage invocation to Teleport DOM and cleans it up', async () => {
    const registry = installCollectorRuntime({ overlay: false })
    const service = vi.fn((options: unknown) => options)
    const wrapped = createElementPlusCommandAdapter(service, 'ElMessage', { registry })

    wrapped({
      message: '保存失败',
      __collectI18n: {
        occurrenceId: 'save-error-message',
        key: 'errors.save',
      },
    })
    expect(service).toHaveBeenCalledWith({ message: '保存失败' })

    const message = document.createElement('div')
    message.className = 'el-message'
    message.textContent = '保存失败'
    document.body.append(message)
    await mutationsSettled()

    expect(registry.getOccurrence('save-error-message')).toMatchObject({
      kind: 'imperative-service',
      service: 'ElMessage',
      anchorType: 'element',
      connected: true,
    })

    message.remove()
    await mutationsSettled()
    expect(registry.getOccurrence('save-error-message')).toBeUndefined()
  })
})
