// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAUSAL_PROBE_STORAGE_KEY,
  createDerivedOccurrenceId,
  createElementPlusCommandAdapter,
  enqueueDescriptors,
  installCollectorRuntime,
  recordRenderedValue,
  runImperativeInvocation,
  uninstallGlobalCollector,
  vnodeProvenanceMounted,
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
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('CollectorRegistry', () => {
  it('substitutes a canary only for compiler-approved visual occurrences', () => {
    enqueueDescriptors([
      {
        occurrenceId: 'safe-label',
        key: 'form.label',
        kind: 'text',
        metadata: { canarySafe: true },
      },
      {
        occurrenceId: 'unsafe-service',
        key: 'message.saved',
        kind: 'imperative-service',
        metadata: { canarySafe: false },
      },
    ])
    installCollectorRuntime({ overlay: false })
    window.sessionStorage.setItem(
      CAUSAL_PROBE_STORAGE_KEY,
      JSON.stringify({ occurrenceId: 'safe-label', token: '__COLLECT_CANARY_SAFE__' }),
    )

    expect(recordRenderedValue('Original', 'safe-label')).toBe('__COLLECT_CANARY_SAFE__')
    expect(recordRenderedValue('Saved', 'unsafe-service')).toBe('Saved')
  })

  it('substitutes a canary for only one actual key at a dynamic call site', () => {
    enqueueDescriptors([
      {
        occurrenceId: 'dynamic-label',
        keyExpression: '`actions.${action}`',
        kind: 'text',
        component: 'el-button',
        metadata: { canarySafe: false },
      },
    ])
    installCollectorRuntime({ overlay: false })
    window.sessionStorage.setItem(
      CAUSAL_PROBE_STORAGE_KEY,
      JSON.stringify({
        occurrenceId: createDerivedOccurrenceId('dynamic-label', 'actions.delete'),
        token: '__COLLECT_DYNAMIC_CANARY__',
      }),
    )

    expect(recordRenderedValue('Create', 'dynamic-label', 'actions.create')).toBe('Create')
    expect(recordRenderedValue('Delete', 'dynamic-label', 'actions.delete')).toBe(
      '__COLLECT_DYNAMIC_CANARY__',
    )
  })

  it('substitutes a canary from a token map for batched probes', () => {
    enqueueDescriptors([
      {
        occurrenceId: 'map-label-a',
        key: 'orders.row.1.label',
        kind: 'text',
        metadata: { canarySafe: true },
      },
      {
        occurrenceId: 'map-label-b',
        key: 'orders.row.2.label',
        kind: 'text',
        metadata: { canarySafe: true },
      },
      {
        occurrenceId: 'map-unsafe',
        key: 'message.saved',
        kind: 'text',
        metadata: { canarySafe: false },
      },
    ])
    installCollectorRuntime({ overlay: false })
    window.sessionStorage.setItem(
      CAUSAL_PROBE_STORAGE_KEY,
      JSON.stringify({
        tokens: {
          'map-label-a': '__COLLECT_CANARY_A_12345678__',
          'map-label-b': '__COLLECT_CANARY_B_12345678__',
        },
      }),
    )

    expect(recordRenderedValue('一', 'map-label-a')).toBe('__COLLECT_CANARY_A_12345678__')
    expect(recordRenderedValue('二', 'map-label-b')).toBe('__COLLECT_CANARY_B_12345678__')
    expect(recordRenderedValue('已保存', 'map-unsafe')).toBe('已保存')
  })

  it('transports script display provenance through an invisible string marker', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'role-name-required',
        key: 'permissions.validation.nameRequired',
        kind: 'virtual',
        metadata: {
          inlineTransport: true,
          canarySafe: true,
        },
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const transported = recordRenderedValue(
      '请输入角色名称',
      'role-name-required',
    )
    expect(String(transported).length - '请输入角色名称'.length).toBeLessThanOrEqual(6)
    expect(String(transported)).not.toMatch(/[\u{e0000}-\u{e007f}]/u)
    const error = document.createElement('div')
    error.textContent = transported
    document.body.append(error)

    await mutationsSettled()

    expect(error.textContent).toContain('请输入角色名称')
    expect(error.textContent).not.toContain('role-name-required')
    expect(registry.getOccurrence('role-name-required')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'A',
      evidenceProof: 'compiler-inline-transport',
      connected: true,
      text: '请输入角色名称',
    })
  })

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

  it('keeps native text ranges inside their registered owner when page text is duplicated', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'jobs-title',
        key: 'jobs.title',
        kind: 'text',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const navigation = document.createElement('a')
    navigation.textContent = '同步任务'
    const heading = document.createElement('h1')
    heading.textContent = '同步任务'
    const navigationScroll = vi.fn()
    const headingScroll = vi.fn()
    Object.defineProperty(navigation, 'scrollIntoView', {
      configurable: true,
      value: navigationScroll,
    })
    Object.defineProperty(heading, 'scrollIntoView', {
      configurable: true,
      value: headingScroll,
    })
    document.body.append(navigation, heading)

    registry.recordRenderedValue('jobs-title', '同步任务')
    await mutationsSettled()

    // Descriptor-only text cannot choose between identical global candidates.
    expect(registry.getOccurrence('jobs-title')).toMatchObject({
      anchorType: 'virtual',
      connected: false,
    })
    expect(registry.focus({ occurrenceId: 'jobs-title' })).toBeUndefined()
    expect(navigationScroll).not.toHaveBeenCalled()

    registry.registerOwner(
      { occurrenceId: 'jobs-title', key: 'jobs.title', kind: 'text' },
      heading,
      { grade: 'A', proof: 'compiler-text-sink' },
    )
    await mutationsSettled()

    const focused = registry.focus({ occurrenceId: 'jobs-title' })

    expect(focused).toMatchObject({ anchorType: 'range', text: '同步任务' })
    expect(headingScroll).toHaveBeenCalledOnce()
    expect(navigationScroll).not.toHaveBeenCalled()
  })

  it('prefers an exact text match so a short label is not shadowed by a longer substring', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'confirm-button',
        key: 'dialog.confirm',
        kind: 'text',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    // A longer heading whose text merely CONTAINS the label must not make the
    // label ambiguous (regression: substring matching shadowed confirm buttons
    // such as "Confirm" beneath a dialog title "Confirm Submission").
    const heading = document.createElement('h2')
    heading.textContent = 'Confirm Submission'
    const button = document.createElement('button')
    button.textContent = 'Confirm'
    document.body.append(heading, button)

    registry.recordRenderedValue('confirm-button', 'Confirm')
    await mutationsSettled()

    expect(registry.getOccurrence('confirm-button')).toMatchObject({
      anchorType: 'range',
      connected: true,
      text: 'Confirm',
    })
  })

  it('discards a stale global text range when its owner has not rendered a match yet', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'delayed-title',
        key: 'jobs.delayedTitle',
        kind: 'text',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const unrelated = document.createElement('a')
    unrelated.textContent = '同步任务'
    const heading = document.createElement('h1')
    heading.textContent = '正在加载'
    const unrelatedScroll = vi.fn()
    const headingScroll = vi.fn()
    Object.defineProperty(unrelated, 'scrollIntoView', {
      configurable: true,
      value: unrelatedScroll,
    })
    Object.defineProperty(heading, 'scrollIntoView', {
      configurable: true,
      value: headingScroll,
    })
    document.body.append(unrelated, heading)

    registry.recordRenderedValue('delayed-title', '同步任务')
    await mutationsSettled()
    expect(registry.getOccurrence('delayed-title')?.anchorType).toBe('range')

    registry.registerOwner(
      { occurrenceId: 'delayed-title', key: 'jobs.delayedTitle', kind: 'text' },
      heading,
      { grade: 'A', proof: 'compiler-text-sink' },
    )
    await mutationsSettled()

    expect(registry.getOccurrence('delayed-title')?.anchorType).toBe('owner')
    registry.focus({ occurrenceId: 'delayed-title' })
    expect(headingScroll).toHaveBeenCalledOnce()
    expect(unrelatedScroll).not.toHaveBeenCalled()
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

  it('uses an opaque compiler sink to scope duplicate component text', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'opaque-component-label',
        key: 'form.actions.submit',
        kind: 'text',
        component: 'el-button',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const unrelated = document.createElement('span')
    unrelated.textContent = 'Submit'
    const componentRoot = document.createElement('button')
    componentRoot.setAttribute('data-collect-i18n-sink', 'opaque-component-label')
    componentRoot.textContent = 'Submit'
    document.body.append(unrelated, componentRoot)

    registry.recordRenderedValue('opaque-component-label', 'Submit')
    registry.rescan(document)
    await mutationsSettled()

    expect(registry.getOccurrence('opaque-component-label')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'compiler-component-scope',
      connected: true,
      text: 'Submit',
    })
  })

  it('uses VNode provenance across fragment and Teleport host roots', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'fragment-placeholder',
        key: 'form.email.placeholder',
        kind: 'component-prop',
        component: 'multi-root-input',
        prop: 'placeholder',
      },
      {
        occurrenceId: 'teleported-label',
        key: 'dialog.confirm',
        kind: 'text',
        component: 'teleported-dialog',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const unrelatedInput = document.createElement('input')
    unrelatedInput.placeholder = 'Enter email'
    const unrelatedText = document.createElement('span')
    unrelatedText.textContent = 'Confirm'
    const fragmentRoot = document.createElement('section')
    const input = document.createElement('input')
    input.placeholder = 'Enter email'
    fragmentRoot.append(input)
    const teleportedRoot = document.createElement('div')
    teleportedRoot.textContent = 'Confirm'
    document.body.append(unrelatedInput, unrelatedText, fragmentRoot, teleportedRoot)

    registry.recordRenderedValue('fragment-placeholder', 'Enter email')
    registry.recordRenderedValue('teleported-label', 'Confirm')
    vnodeProvenanceMounted(
      {
        component: {
          subTree: {
            el: document.createComment('fragment'),
            children: [{ el: fragmentRoot }, { el: teleportedRoot }],
          },
        },
      },
      ['fragment-placeholder', 'teleported-label'],
    )
    await mutationsSettled()

    expect(registry.getOccurrence('fragment-placeholder')).toMatchObject({
      anchorType: 'element',
      evidenceGrade: 'B',
      evidenceProof: 'compiler-vnode-provenance',
      connected: true,
    })
    expect(registry.getOccurrence('teleported-label')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'compiler-vnode-provenance',
      connected: true,
      text: 'Confirm',
    })
  })

  it('selects one valid component instance when a v-for repeats the same occurrence', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'repeated-row-label',
        key: 'orders.actions.open',
        kind: 'text',
        component: 'el-button',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const first = document.createElement('button')
    const second = document.createElement('button')
    first.textContent = second.textContent = 'Open'
    document.body.append(first, second)

    registry.recordRenderedValue('repeated-row-label', 'Open')
    vnodeProvenanceMounted(
      { component: { subTree: { el: first } } },
      ['repeated-row-label'],
    )
    vnodeProvenanceMounted(
      { component: { subTree: { el: second } } },
      ['repeated-row-label'],
    )
    await mutationsSettled()

    expect(registry.getOccurrence('repeated-row-label')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'compiler-vnode-provenance',
      connected: true,
      text: 'Open',
    })
  })

  it('keeps each actual key rendered by one dynamic v-for occurrence', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'dynamic-action',
        keyExpression: '`actions.${action}`',
        kind: 'text',
        component: 'el-button',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const createButton = document.createElement('button')
    const deleteButton = document.createElement('button')
    createButton.textContent = 'Create'
    deleteButton.textContent = 'Delete'
    document.body.append(createButton, deleteButton)

    registry.recordRenderedValue('dynamic-action', 'Create', 'actions.create')
    registry.recordRenderedValue('dynamic-action', 'Delete', 'actions.delete')
    vnodeProvenanceMounted(
      { component: { subTree: { el: createButton } } },
      ['dynamic-action'],
    )
    vnodeProvenanceMounted(
      { component: { subTree: { el: deleteButton } } },
      ['dynamic-action'],
    )
    await mutationsSettled()

    expect(registry.getOccurrence('dynamic-action')?.key).toBeUndefined()
    expect(registry.getDerivedOccurrences('dynamic-action')).toHaveLength(2)
    expect(registry.getSnapshot().find((item) => item.key === 'actions.create')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'compiler-vnode-provenance',
      connected: true,
      text: 'Create',
    })
    expect(registry.getSnapshot().find((item) => item.key === 'actions.delete')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'compiler-vnode-provenance',
      connected: true,
      text: 'Delete',
    })
  })

  it('abstains when two occurrences share the same text inside one compiler owner', async () => {
    enqueueDescriptors([
      { occurrenceId: 'same-owner-a', key: 'labels.a', kind: 'text' },
      { occurrenceId: 'same-owner-b', key: 'labels.b', kind: 'text' },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const owner = document.createElement('p')
    owner.setAttribute('data-collect-i18n-sink', 'same-owner-a same-owner-b')
    owner.append('Duplicate', document.createTextNode('Duplicate'))
    document.body.append(owner)

    registry.recordRenderedValue('same-owner-a', 'Duplicate')
    registry.recordRenderedValue('same-owner-b', 'Duplicate')
    registry.rescan(document)
    await mutationsSettled()

    expect(registry.getOccurrence('same-owner-a')).toMatchObject({
      anchorType: 'owner',
      visible: false,
    })
    expect(registry.getOccurrence('same-owner-b')).toMatchObject({
      anchorType: 'owner',
      visible: false,
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
    const containing = document.createElement('p')
    containing.textContent = '说明文字中包含唯一标签但不是目标'
    const duplicateOne = document.createElement('span')
    duplicateOne.textContent = '重复标签'
    const duplicateTwo = document.createElement('span')
    duplicateTwo.textContent = '重复标签'
    document.body.append(unique, containing, duplicateOne, duplicateTwo)

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
    expect(registry.getOccurrence('unique-component-label')?.anchorType).toBe('virtual')
  })

  it('does not expose title-only component props as visible screenshot targets', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'card-title',
        key: 'card.tooltip',
        kind: 'component-prop',
        component: 'el-card',
        prop: 'title',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const card = document.createElement('section')
    card.title = 'Release preview'
    document.body.append(card)

    registry.recordRenderedValue('card-title', 'Release preview')
    vnodeProvenanceMounted({ component: { subTree: { el: card } } }, ['card-title'])
    await mutationsSettled()

    expect(registry.getOccurrence('card-title')).toMatchObject({
      anchorType: 'owner',
      connected: true,
      visible: false,
    })
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

  it('promotes an instrumented Element Plus call to invocation-scoped B evidence', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'compiled-message',
        key: 'messages.saved',
        kind: 'imperative-service',
        service: 'ElMessage',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })

    runImperativeInvocation('ElMessage', ['compiled-message'], () => {
      recordRenderedValue('Saved', 'compiled-message')
      const message = document.createElement('div')
      message.className = 'el-message'
      message.textContent = 'Saved'
      document.body.append(message)
    })
    await mutationsSettled()

    expect(registry.getOccurrence('compiled-message')).toMatchObject({
      anchorType: 'element',
      evidenceGrade: 'B',
      evidenceProof: 'element-plus-invocation',
      text: 'Saved',
    })
  })

  it('promotes the actual derived key for a dynamic Element Plus invocation', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'compiled-dynamic-message',
        keyExpression: '`messages.${messageType}.text`',
        kind: 'imperative-service',
        service: 'ElMessage',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    const derivedId = createDerivedOccurrenceId(
      'compiled-dynamic-message',
      'messages.warning.text',
    )

    runImperativeInvocation('ElMessage', ['compiled-dynamic-message'], () => {
      recordRenderedValue(
        'Check required fields',
        'compiled-dynamic-message',
        'messages.warning.text',
      )
      const message = document.createElement('div')
      message.className = 'el-message'
      message.textContent = 'Check required fields'
      document.body.append(message)
    })
    await mutationsSettled()

    expect(registry.getOccurrence(derivedId)).toMatchObject({
      key: 'messages.warning.text',
      anchorType: 'element',
      evidenceGrade: 'B',
      evidenceProof: 'element-plus-invocation',
      text: 'Check required fields',
    })
    expect(registry.getOccurrence('compiled-dynamic-message')).toMatchObject({
      anchorType: 'virtual',
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

  it('pairs repeated ElMessageBox nodes when they come from the same key', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'prompt-title-a',
        key: 'prompt.title',
        kind: 'imperative-service',
        service: 'ElMessageBox',
      },
      {
        occurrenceId: 'prompt-title-b',
        key: 'prompt.title',
        kind: 'imperative-service',
        service: 'ElMessageBox',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    runImperativeInvocation('ElMessageBox', ['prompt-title-a'], () => {
      recordRenderedValue('Enter a reason', 'prompt-title-a')
    })
    runImperativeInvocation('ElMessageBox', ['prompt-title-b'], () => {
      recordRenderedValue('Enter a reason', 'prompt-title-b')
    })

    const messageBox = document.createElement('div')
    messageBox.className = 'el-message-box'
    const title = document.createElement('span')
    title.textContent = 'Enter a reason'
    const message = document.createElement('p')
    message.textContent = 'Enter a reason'
    messageBox.append(title, message)
    document.body.append(messageBox)
    await mutationsSettled()

    expect(registry.getOccurrence('prompt-title-a')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'element-plus-invocation',
      connected: true,
    })
    expect(registry.getOccurrence('prompt-title-b')).toMatchObject({
      anchorType: 'range',
      evidenceGrade: 'B',
      evidenceProof: 'element-plus-invocation',
      connected: true,
    })
  })

  it('binds an invoked ElMessageBox input placeholder to its painted input', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'prompt-placeholder',
        key: 'prompt.placeholder',
        kind: 'imperative-service',
        service: 'ElMessageBox',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    runImperativeInvocation('ElMessageBox', ['prompt-placeholder'], () => {
      recordRenderedValue('Enter a reason', 'prompt-placeholder')
    })

    const messageBox = document.createElement('div')
    messageBox.className = 'el-message-box'
    const input = document.createElement('input')
    input.placeholder = 'Enter a reason'
    messageBox.append(input)
    document.body.append(messageBox)
    await mutationsSettled()

    expect(registry.getOccurrence('prompt-placeholder')).toMatchObject({
      anchorType: 'element',
      evidenceGrade: 'B',
      evidenceProof: 'element-plus-invocation',
      connected: true,
      text: 'Enter a reason',
    })
  })

  it('keeps invocation provenance for an asynchronous MessageBox validator', async () => {
    enqueueDescriptors([
      {
        occurrenceId: 'prompt-validation',
        key: 'prompt.validation',
        kind: 'imperative-service',
        service: 'ElMessageBox',
      },
    ])
    const registry = installCollectorRuntime({ overlay: false })
    let validate!: () => void
    let settle!: () => void
    const pending = new Promise<void>((resolve) => { settle = resolve })

    runImperativeInvocation('ElMessageBox', ['prompt-validation'], () => {
      validate = () => {
        const rendered = recordRenderedValue('Reason is required', 'prompt-validation')
        const messageBox = document.createElement('div')
        messageBox.className = 'el-message-box'
        const error = document.createElement('div')
        error.textContent = rendered
        messageBox.append(error)
        document.body.append(messageBox)
      }
      return pending
    })

    validate()
    await mutationsSettled()
    expect(registry.getOccurrence('prompt-validation')).toMatchObject({
      anchorType: 'element',
      evidenceGrade: 'B',
      evidenceProof: 'element-plus-invocation',
      connected: true,
      text: 'Reason is required',
    })
    settle()
    await pending
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
