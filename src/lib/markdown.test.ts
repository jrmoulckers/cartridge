import { describe, it, expect } from 'vitest';
import { renderMarkdown, markdownExcerpt, isSafeUrl, escapeHtml } from './markdown';

describe('escapeHtml', () => {
  it('escapes every character that could open an HTML context', () => {
    expect(escapeHtml(`<&">'`)).toBe('&lt;&amp;&quot;&gt;&#39;');
  });
});

describe('renderMarkdown — safety', () => {
  it('never emits raw HTML from the source', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an img onerror payload', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="');
  });

  it('refuses javascript: links, leaving the literal text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('javascript');
  });

  it('refuses data: and vbscript: links', () => {
    expect(renderMarkdown('[x](data:text/html;base64,PHN2Zz4=)')).not.toContain('<a ');
    expect(renderMarkdown('[x](vbscript:msgbox)')).not.toContain('<a ');
  });

  it('refuses a scheme hidden behind whitespace or case', () => {
    expect(renderMarkdown('[x](JaVaScRiPt:alert(1))')).not.toContain('<a ');
  });

  it('marks allowed links noopener noreferrer', () => {
    const html = renderMarkdown('[IGDB](https://igdb.com/games/x)');
    expect(html).toContain('href="https://igdb.com/games/x"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not treat markup inside inline code as markup', () => {
    const html = renderMarkdown('use `<b>**bold**</b>` here');
    expect(html).toContain('<code>&lt;b&gt;**bold**&lt;/b&gt;</code>');
    expect(html).not.toContain('<strong>');
  });
});

describe('isSafeUrl', () => {
  it('allows http, https, mailto, relative and anchor links', () => {
    for (const url of ['https://a.test', 'http://a.test', 'mailto:a@b.test', '/local', '#top']) {
      expect(isSafeUrl(url)).toBe(true);
    }
  });

  it('rejects other schemes and protocol-relative urls', () => {
    for (const url of ['javascript:x', 'data:text/html,x', 'vbscript:x', '//evil.test']) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });
});

describe('renderMarkdown — structure', () => {
  it('renders paragraphs', () => {
    expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });

  it('renders bold and italic', () => {
    expect(renderMarkdown('**loud** and *soft*')).toContain(
      '<strong>loud</strong> and <em>soft</em>',
    );
  });

  it('clamps headings to h2-h4 so a review cannot outrank the page', () => {
    expect(renderMarkdown('# Top')).toContain('<h2>Top</h2>');
    expect(renderMarkdown('##### Deep')).toContain('<h4>Deep</h4>');
  });

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('renders blockquotes and rules', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
    expect(renderMarkdown('---')).toBe('<hr />');
  });

  it('renders fenced code without interpreting its contents', () => {
    const html = renderMarkdown('```\n<b>x</b>\n```');
    expect(html).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  });

  it('closes an unterminated fence rather than dropping the content', () => {
    expect(renderMarkdown('```\nstill here')).toContain('still here');
  });

  it('returns an empty string for blank input', () => {
    expect(renderMarkdown('   \n  ')).toBe('');
  });
});

describe('markdownExcerpt', () => {
  it('strips markup and collapses whitespace', () => {
    expect(markdownExcerpt('# Title\n\n**Great**  game')).toBe('Title Great game');
  });

  it('truncates with an ellipsis', () => {
    expect(markdownExcerpt('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});
