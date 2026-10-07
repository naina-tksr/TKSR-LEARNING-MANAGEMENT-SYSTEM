// Minimal, safe markdown renderer for lesson content.
// Input is HTML-escaped first, so no raw HTML can pass through; only the
// formatting produced by this module ends up in the DOM.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

const BLOCK_START = /^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+\.\s+|\s*>\s?)/

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source ?? '').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let index = 0

  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }

  while (index < lines.length) {
    const line = lines[index]

    if (line.startsWith('```')) {
      closeList()
      const buffer: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        buffer.push(lines[index])
        index += 1
      }
      index += 1
      out.push(`<pre class="md-code"><code>${buffer.join('\n')}</code></pre>`)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (list !== 'ul') {
        closeList()
        out.push('<ul>')
        list = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      index += 1
      continue
    }

    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      if (list !== 'ol') {
        closeList()
        out.push('<ol>')
        list = 'ol'
      }
      out.push(`<li>${inline(ordered[1])}</li>`)
      index += 1
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      closeList()
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      index += 1
      continue
    }

    if (line.trim() === '') {
      closeList()
      index += 1
      continue
    }

    // Paragraph: gather consecutive plain lines.
    closeList()
    const buffer = [line]
    index += 1
    while (index < lines.length && lines[index].trim() !== '' && !BLOCK_START.test(lines[index])) {
      buffer.push(lines[index])
      index += 1
    }
    out.push(`<p>${inline(buffer.join(' '))}</p>`)
  }

  closeList()
  return out.join('\n')
}
