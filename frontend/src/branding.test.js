import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const SOURCE_OFFER = 'https://github.com/jhonsnake/openGym/tree/branding/johngym-stable-hotfix'
describe('JohnGym web branding', () => {
  it('names the installed app and serves versioned original icons', () => {
    const manifest = JSON.parse(read('public/manifest.json'))
    expect(manifest.name).toBe('JohnGym')
    expect(manifest.theme_color).toBe('#07003c')
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^johngym-v1-/)
      expect(readFileSync(new URL('../public/' + icon.src, import.meta.url)).readUInt32BE(16)).toBe(Number(icon.sizes.split('x')[0]))
    }
    expect(read('index.html')).toContain('<title>JohnGym</title>')
    expect(read('index.html')).not.toContain('<svg')
    expect(read('src/views/Login.jsx')).toContain('className="wordmark"')
    expect(read('src/views/Login.jsx')).not.toContain('name="dumbbell"')
  })
  it('provides the evidence palette and visible focus through shared tokens', () => {
    const css = read('src/branding.css')
    for (const color of ['#14007d', '#07003c', '#210d67', '#1d0b6b', '#ffad2f', '#ffffff', '#c3bce8', '#3d2c8f']) expect(css).toContain(color)
    expect(css).toContain(':focus-visible')
    expect(read('src/main.jsx')).toContain("'./branding.css'")
  })
  it('uses Safari 15.5-safe static alpha colors only for the web brand root', () => {
    const css = read('src/branding.css')
    expect(css).not.toContain('color-mix(')
    for (const color of ['rgba(255,173,47,.16)', 'rgba(255,173,47,.38)', 'rgba(20,0,125,.1)', 'rgba(20,0,125,.38)']) expect(css).toContain(color)
    expect(css).toContain(':root[data-web-branding="true"]')
    expect(read('src/main.jsx')).toContain("if (!MOBILE) document.documentElement.dataset.webBranding = 'true'")
  })
  it('offers the corresponding modified JohnGym source from Settings and the demo', () => {
    expect(read('src/views/Settings.jsx')).toContain('href={REPO}')
    expect(read('src/lib/demo.js')).toContain(`REPO = '${SOURCE_OFFER}'`)
  })
})
