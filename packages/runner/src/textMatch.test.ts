import { describe, expect, it } from 'vitest'
import { isExactTextMatch, pickExactTextRows } from './textMatch.js'
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
      { text: '设置已保存', id: 1 },
      { text: '设置已保存，请重试', id: 2 },
      { text: '设置已保存', id: 3 },
      { text: undefined, id: 4 },
    ]
    const picked = pickExactTextRows(rows, '设置已保存')
    expect(picked.map((row) => row.id)).toEqual([1, 3])
  })
})
