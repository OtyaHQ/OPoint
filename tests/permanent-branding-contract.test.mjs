import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('Opoint presents the canonical Otya mark and correct product name', () => {
  const dashboard = read('app/dashboard.tsx')
  const layout = read('app/layout.tsx')
  const login = read('app/login/page.tsx')
  const inventory = read('app/inventory/page.tsx')
  const css = read('app/globals.css')

  assert.match(dashboard, /src="\/otya-app-icon\.webp"/)
  assert.match(dashboard, /alt="Otya"/)
  assert.match(dashboard, /Opoint/)
  assert.doesNotMatch(dashboard, /<Command size=/)
  assert.match(layout, /Opoint — Business Operations/)
  assert.match(layout, /themeColor: "#050812"/)
  assert.match(login, /Opoint/)
  assert.match(inventory, /Opoint/)
  assert.match(css, /--accent:#27e8ff/)
  assert.match(css, /--purple:#126bff/)
  assert.match(css, /--blue:#173bff/)
  assert.doesNotMatch(css, /#a8b8ff|#8c8bff|#75b9ff|#8585fa|#7c3aed/i)
  assert.equal(existsSync('public/otya-app-icon.webp'), true)
})
