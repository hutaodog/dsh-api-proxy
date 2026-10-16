/**
 * release-notes — 从 CHANGELOG.md 里抽出当前 tag 对应的那一节，写成 release-notes.md。
 *
 * 给 `.github/workflows/release.yml` 用：Release 正文优先用手写的更新说明，
 * 比 `--generate-notes` 堆出来的 commit 列表有用得多。
 *
 * 抽不到就**不写文件**（退出码仍是 0）—— workflow 那边会退回 `--generate-notes`。
 * 发版流程不该因为 CHANGELOG 少写一节就整个挂掉。
 *
 * 用法：GITHUB_REF_NAME=v1.0.0 node scripts/release-notes.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const refName = process.env.GITHUB_REF_NAME ?? process.argv[2] ?? ''
if (refName === '') {
  // 不写文件、也不失败：workflow 那边会退回 `--generate-notes`。
  // 发版流程不该因为读不到环境变量就整个挂掉。
  console.log('拿不到 tag 名（GITHUB_REF_NAME 为空），退回自动生成的说明')
  process.exit(0)
}
const version = refName.replace(/^v/, '')

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/)
const out = []
let inside = false
for (const line of lines) {
  if (/^##\s+\[/.test(line)) {
    // 遇到下一个版本标题就收工。
    if (inside) break
    if (line.startsWith(`## [${version}]`)) {
      inside = true
      continue
    }
  }
  if (inside) out.push(line)
}

// 结尾那个分隔线是给 Markdown 阅读用的，Release 正文里不需要。
const body = out.join('\n').replace(/\n+---\s*$/, '').trim()
if (body === '') {
  console.log(`CHANGELOG.md 里没有 ${version} 一节，退回自动生成的说明`)
  process.exit(0)
}

writeFileSync('release-notes.md', `${body}\n`, 'utf8')
console.log(`release-notes.md 已生成：${body.length} 字符（${version}）`)
