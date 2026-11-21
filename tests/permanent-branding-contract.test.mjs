import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('Opoint uses its exact product icon, tagline and approved Otya palette', () => {
  const dashboard = read('app/dashboard.tsx')
  const layout = read('app/layout.tsx')
  const login = read('app/login/page.tsx')
  const inventory = read('app/inventory/page.tsx')
  const css = read('app/globals.css')

  assert.match(dashboard, /src="https:\/\/assets\.otya\.site\/brand\/otya\/v4\/icons\/opoint\.webp"/)
  assert.match(dashboard, /alt="Opoint"/)
  assert.match(dashboard, /Shop\. Pay\. More\./)
  assert.doesNotMatch(dashboard, /OTYAPOINT|OtyaPoint/)
  assert.match(layout, /Opoint — Business Operations/)
  assert.match(layout, /themeColor: "#08265C"/)
  assert.match(login, /Opoint/)
  assert.match(login, /Shop\. Pay\. More\./)
  assert.match(inventory, /Opoint · Retail operations/)
  assert.match(css, /--accent:#00bdeb/)
  assert.match(css, /--purple:#1677ff/)
  assert.match(css, /--blue:#08265c/)
  assert.doesNotMatch(css, /#a8b8ff|#8c8bff|#75b9ff|#8585fa|#7c3aed/i)
  assert.equal(existsSync('public/otya-app-icon.webp'), true)
})
