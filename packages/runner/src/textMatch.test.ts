import { describe, expect, it } from 'vitest'
import { isExactTextMatch, pickExactTextMatch, pickExactTextRows } from './textMatch.js'
interface RegistryRow { text?: string; grade?: string; proof?: string; binding?: string }
describe('exact text matching (waitForKey toast fallback)', () => {
  it('matches leaf text by exact trimmed equality', () => {
    expect(isExactTextMatch({ text: '设置已保存' }, '设置已保存')).toBe(true)
    expect(isExactTextMatch({ text: ' 设置已保存 ' }, '设置已保存')).toBe(true)
    expect(isExactTextMatch({ text: '设置已保存，请重试' }, '设置已保存')).toBe(false)
    expect(isExactTextMatch({ text: '设置已保存' }, '设置已保存2')).toBe(false)
    expect(isExactTextMatch({ text: undefined }, '设置已保存')).toBe(false)
  })
  it('picks only rows whose complete text equals the needle', () => {
    const rows = [
      { text: '设置已保存', id: 1 } as RegistryRow & { id: number },
      { text: '设置已保存，请重试', id: 2 } as RegistryRow & { id: number },
      { text: '设置已保存', id: 3 } as RegistryRow & { id: number },
      { text: undefined, id: 4 } as RegistryRow & { id: number },
    ]
    const picked = pickExactTextRows(rows, '设置已保存')
    expect(picked.map((row) => row.id)).toEqual([1, 3])
  })
  it('production usage: registry rows matched for a leaf needle keep their metadata (collector waitForKey path)', () => {
    const registeredTexts: RegistryRow[] = [
      { text: '设置已保存', grade: 'B', proof: 'imperative-text-scan', binding: 'imperative-service' },
      { text: '设置已保存，请重试', grade: 'B' },
      { text: '网络异常', proof: 'canary-token', binding: 'imperative-service' },
    ]
    const leafNeedle = '设置已保存'
    const [matched] = pickExactTextRows(registeredTexts, leafNeedle)
    expect(matched).toBeDefined()
    expect(matched?.grade).toBe('B')
    expect(matched?.proof).toBe('imperative-text-scan')
    expect(matched?.binding).toBe('imperative-service')
    expect(isExactTextMatch(matched as RegistryRow, leafNeedle)).toBe(true)
    // the needle must not collide with interpolated or partial texts
    expect(pickExactTextRows(registeredTexts, '设置已保存，请重试')[0]?.proof).toBeUndefined()
  })
  it('production decision: first imperative-priority hit wins, unmatched hits are skipped', () => {
    const registeredTexts: RegistryRow[] = [
      { text: '操作成功', grade: 'B', proof: 'imperative-text-scan', binding: 'imperative-service' },
      { text: '保存成功', grade: 'B', proof: 'imperative-text-scan', binding: 'imperative-service' },
    ]
    // Leaf hits as the browser harvest emits them: imperative-host leaves first.
    const hits = [
      { needle: '操作成功', x: 720, y: 24, width: 96, height: 32 },
      { needle: '保存成功', x: 720, y: 64, width: 96, height: 32 },
    ]
    const decision = pickExactTextMatch(registeredTexts, hits)
    expect(decision?.hit.needle).toBe('操作成功')
    expect(decision?.row.text).toBe('操作成功')
    // A static same-text element before any registered match does not win,
    // and hits without a registered text are skipped, not fatal.
    const reordered = pickExactTextMatch(registeredTexts, [hits[1], { needle: '页面静态文案' }, hits[0]])
    expect(reordered?.hit.needle).toBe('保存成功')
    expect(pickExactTextMatch(registeredTexts, [{ needle: '未注册文本' }])).toBeUndefined()
    expect(pickExactTextMatch([], hits)).toBeUndefined()
  })
})
