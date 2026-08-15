/**
 * A deliberately small Markdown renderer for reviews and notes.
 *
 * Cartridge stores review bodies as Markdown, but pulling in a full CommonMark parser
 * plus a sanitiser for that is a poor trade in an app whose whole runtime dependency
 * list is `idb`. So: a safe subset, and one hard rule — **the input is HTML-escaped
 * first, and only markup this file generates is ever emitted.** There is no raw-HTML
 * passthrough, so there is no sanitiser to get wrong.
 *
 * Supported: ATX headings, bold, italic, inline code, fenced code, links, unordered and
 * ordered lists, blockquotes, horizontal rules, paragraphs, hard line breaks.
 * Anything else renders as literal text, which is the safe failure mode.
 */

/** Escape the five characters that could otherwise open an HTML context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s) and mailto links are rendered as links. Anything else — `javascript:`,
 * `data:`, `vbscript:`, a protocol-relative oddity — falls back to plain text.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return true;
  // Relative and anchor links are fine; anything with a scheme we didn't allow is not.
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('//');
}

/** Placeholder-protect inline code so its contents are never treated as markup. */
function renderInline(escaped: string): string {
  const codes: string[] = [];
  let text = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // Links: [label](url)
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    // The url arrives HTML-escaped; &amp; must go back to & before it is used.
    const href = url.replace(/&amp;/g, '&');
    if (!isSafeUrl(href)) return match;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold before italic so ** isn't consumed by the single-* rule.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Two trailing spaces = hard break.
  text = text.replace(/ {2,}\n/g, '<br />\n');

  // The NUL sentinel is deliberate: code spans are lifted out before inline rules run and
  // restored here. NUL cannot survive escapeHtml's input, so it can never come from a user.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => `<code>${codes[+index]}</code>`);
}

/** Render a Markdown subset to HTML that is safe to inject with `{@html}`. */
export function renderMarkdown(source: string): string {
  if (!source?.trim()) return '';

  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];

  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join('\n'))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${renderInline(quote.join('\n'))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    // Fenced code: everything inside is literal (already escaped).
    const fenceMatch = /^\s*```/.test(line);
    if (fence !== null) {
      if (fenceMatch) {
        out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (fenceMatch) {
      flushAll();
      fence = [];
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const [, hashes = '', title = ''] = heading;
      // Clamp to h2–h4: a review body must not outrank the page's own headings.
      const level = Math.min(4, Math.max(2, hashes.length + 1));
      out.push(`<h${level}>${renderInline(title.trim())}</h${level}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushAll();
      out.push('<hr />');
      continue;
    }

    const quoted = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? '');
      continue;
    }
    flushQuote();

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (listType !== wanted) {
        flushList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${renderInline((bullet ?? ordered)?.[1] ?? '')}</li>`);
      continue;
    }
    flushList();

    paragraph.push(line);
  }

  if (fence !== null) out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
  flushAll();

  return out.join('\n');
}

/** Plain-text preview of a Markdown body — for cards and list rows. */
export function markdownExcerpt(source: string, max = 160): string {
  const text = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
