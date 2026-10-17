import { describe, expect, it } from 'vitest'
import { escapeHtml, html, raw } from '../../src/modules/admin/html.js'
import { renderLayout } from '../../src/modules/admin/layout.js'

// Caso 10
describe('html (tagged template)', () => {
  it('escapa <, >, comillas, apóstrofes y &', () => {
    const out = html`<p>${'<script>alert("x")</script> & \'y\''}</p>`.toString()
    expect(out).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>'
    )
  })

  it('escapa valores dentro de atributos', () => {
    const out = html`<input value="${'"><script>x</script>'}" />`.toString()
    expect(out).not.toContain('<script>')
    expect(out).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('no escapa dos veces un html anidado', () => {
    const inner = html`<b>${'a&b'}</b>`
    expect(html`<p>${inner}</p>`.toString()).toBe('<p><b>a&amp;b</b></p>')
  })

  it('raw inserta el texto sin escapar, solo si se marca de forma explícita', () => {
    expect(html`<p>${raw('<i>ok</i>')}</p>`.toString()).toBe('<p><i>ok</i></p>')
    expect(html`<p>${'<i>no</i>'}</p>`.toString()).toBe('<p>&lt;i&gt;no&lt;/i&gt;</p>')
  })

  it('une listas de html y de texto', () => {
    const items = ['<a>', 'b'].map((x) => html`<li>${x}</li>`)
    expect(
      html`<ul>
        ${items}
      </ul>`.toString()
    ).toBe('<ul><li>&lt;a&gt;</li><li>b</li></ul>')
  })

  it('trata null, undefined y false como vacío y los números como texto', () => {
    expect(html`<p>${null}${undefined}${false}${42}</p>`.toString()).toBe('<p>42</p>')
  })

  it('escapeHtml escapa texto suelto', () => {
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;')
  })
})

describe('renderLayout', () => {
  const page = (
    overrides: Parameters<typeof renderLayout>[0] extends infer T
      ? Partial<T>
      : never = {}
  ) => renderLayout({ title: 'Título', body: html`<p>cuerpo</p>`, ...overrides })

  it('es un documento HTML con el cuerpo, el título y el menú', () => {
    const out = page({ active: 'settings', csrfToken: 'tok' })
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<title>Título')
    expect(out).toContain('<p>cuerpo</p>')
    expect(out).toContain('href="/admin"')
    expect(out).toContain('href="/admin/settings"')
    expect(out).toContain('action="/admin/logout"')
    expect(out).toContain('name="_csrf" value="tok"')
  })

  it('sin menú (login) no muestra el cierre de sesión', () => {
    const out = page({ showNav: false })
    expect(out).not.toContain('/admin/logout')
  })

  it('carga Bootstrap 5 (solo CSS) por jsDelivr con versión exacta y SRI, sin JS externo', () => {
    const out = page()
    expect(out).toMatch(
      /href="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@5\.\d+\.\d+\/dist\/css\/bootstrap\.min\.css"/
    )
    expect(out).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/)
    expect(out).toContain('crossorigin="anonymous"')
    expect(out).not.toMatch(/<script[^>]+src="https?:\/\//)
    expect(out).not.toContain('bootstrap.bundle')
  })

  it('escapa el título y el mensaje flash', () => {
    const out = page({
      title: '<img src=x onerror=alert(1)>',
      flash: { kind: 'danger', message: '<script>alert(1)</script>' }
    })
    expect(out).not.toContain('<img src=x')
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
