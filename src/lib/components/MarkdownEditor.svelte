<script lang="ts">
  /**
   * A Markdown field with a preview toggle.
   *
   * Deliberately not a rich-text editor: reviews are stored as Markdown text so they
   * survive a backup/restore round trip as plain, readable data. The preview uses the same
   * safe-subset renderer the rest of the app does, so what you see here is exactly what a
   * reader sees.
   */
  import { renderMarkdown } from '../markdown';

  interface Props {
    value: string;
    onchange: (value: string) => void;
    label: string;
    /** Shown under the label — used to say when something is private. */
    hint?: string;
    placeholder?: string;
    rows?: number;
    id: string;
  }

  let {
    value = $bindable(''),
    onchange,
    label,
    hint = undefined,
    placeholder = '',
    rows = 8,
    id,
  }: Props = $props();

  let preview = $state(false);
  const html = $derived(preview ? renderMarkdown(value) : '');
</script>

<div class="editor stack">
  <div class="row spread">
    <div>
      <label for={id}>{label}</label>
      {#if hint}<p class="hint muted">{hint}</p>{/if}
    </div>
    <button
      type="button"
      class="btn small ghost"
      aria-pressed={preview}
      onclick={() => (preview = !preview)}
      disabled={!value.trim()}
    >
      {preview ? 'Write' : 'Preview'}
    </button>
  </div>

  {#if preview}
    <!-- `html` is renderMarkdown() output. That renderer escapes its input first and emits
         only the tags it generates itself; markdown.test.ts proves it against XSS payloads.
         This is the sanitiser's one intended sink. -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div class="md preview card">{@html html}</div>
  {:else}
    <textarea {id} {rows} {placeholder} bind:value oninput={(e) => onchange(e.currentTarget.value)}
    ></textarea>
    <p class="hint muted">
      Markdown: <code>**bold**</code>, <code>*italic*</code>, <code># heading</code>,
      <code>- list</code>, <code>&gt; quote</code>, <code>[link](url)</code>.
    </p>
  {/if}
</div>

<style>
  .editor {
    gap: var(--spacing-xs);
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-overline);
  }
  .preview {
    min-height: 8rem;
    padding: var(--spacing-md);
  }
</style>
