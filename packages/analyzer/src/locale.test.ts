import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildLocaleCatalog,
  discoverLocaleFiles,
  flattenLocaleObject,
  unflattenLocaleObject,
} from './index.js'

const workspaces: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'collect-i18n-analyzer-'))
  workspaces.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) =>
      rm(workspace, { recursive: true, force: true }),
    ),
  )
})

describe('locale discovery and catalog construction', () => {
  it('discovers nested locale folders and pairs files by relative path', async () => {
    const root = await createWorkspace()
    const zh = path.join(root, 'src', 'i18n', 'zh-cn', 'account')
    const en = path.join(root, 'src', 'i18n', 'en-us', 'account')
    await mkdir(zh, { recursive: true })
    await mkdir(en, { recursive: true })
    await writeFile(
      path.join(zh, 'form.json'),
      JSON.stringify({ title: '新增用户', validation: { required: '请输入姓名' } }),
    )
    await writeFile(
      path.join(en, 'form.json'),
      JSON.stringify({ title: 'Add user' }),
    )

    const files = await discoverLocaleFiles({ projectRoot: root })
    expect(files).toHaveLength(2)
    expect(files.map((file) => `${file.locale}:${file.relativeFile}`)).toEqual([
      'en-us:account/form.json',
      'zh-cn:account/form.json',
    ])

    const catalog = await buildLocaleCatalog({ projectRoot: root })
    expect(catalog.keys.map((key) => key.keyPath)).toEqual([
      'account.form.title',
      'account.form.validation.required',
    ])
    expect(catalog.keys[0]).toMatchObject({
      relativeFile: 'account/form.json',
      jsonPath: ['title'],
      sourceText: '新增用户',
      targetText: 'Add user',
    })
  })

  it('round-trips nested objects and arrays', () => {
    const input = {
      common: { actions: ['保存', '取消'], prompt: '继续吗？' },
    }
    const flat = flattenLocaleObject(input)
    expect(flat).toEqual({
      'common.actions.0': '保存',
      'common.actions.1': '取消',
      'common.prompt': '继续吗？',
    })
    expect(unflattenLocaleObject(flat)).toEqual(input)
  })
})
