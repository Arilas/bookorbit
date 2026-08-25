import { describe, expect, it } from 'vitest'

import { escapeHtml } from './escape-html'

describe('escapeHtml', () => {
  it('escapes App Password labels before they are interpolated into chart tooltip HTML', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> & Phone`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; Phone')
  })
})
