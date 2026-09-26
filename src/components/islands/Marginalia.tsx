import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The reading loop's only interaction: select a sentence, say something about
 * it. No account, no modal, no sign-up wall between the impulse and the note.
 *
 * The client sends the selected *text*, never character offsets. The rendered
 * DOM has already consumed its inline markup, so DOM offsets do not correspond
 * to source offsets, and a client-computed anchor would be wrong the moment a
 * paragraph contained a code span. The server resolves the quote against the
 * real block text.
 *
 * Notes are server-rendered and readable with JavaScript off. This island only
 * *adds* the ability to write.
 */

type Kind =
  | 'comment'
  | 'correction'
  | 'extension'
  | 'disagreement'
  | 'worked_example'
  | 'update';

const KINDS: Array<{ value: Kind; label: string; hint: string }> = [
  { value: 'comment', label: 'Comment', hint: 'A general response to this sentence.' },
  { value: 'correction', label: 'Correction', hint: 'This is wrong. Say what is right.' },
  { value: 'extension', label: 'Extension', hint: 'It goes further than the post claims.' },
  { value: 'disagreement', label: 'Disagreement', hint: 'The conclusion does not follow.' },
  { value: 'worked_example', label: 'Worked example', hint: 'Concrete numbers or a case.' },
  { value: 'update', label: 'Update', hint: 'This has since changed in the world.' },
];

interface Props {
  postId: string;
  versionId: string;
  canWriteAuthorNote: boolean;
  signedInAs: string | null;
}

interface Selection {
  blockId: string;
  quote: string;
  prefixHint: string;
  suffixHint: string;
  /** Viewport position of the selection, for the affordance. */
  x: number;
  y: number;
}

type Phase = 'loading' | 'idle' | 'composing' | 'saving' | 'error' | 'done';

export default function Marginalia({ postId, versionId, canWriteAuthorNote, signedInAs }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [kind, setKind] = useState<Kind>('comment');
  const [body, setBody] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [mine, setMine] = useState(0);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const composer = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setSelection(null);
    setBody('');
    setPhase('idle');
    setMessage('');
    setKind('comment');
  }, []);

  /* --- selection capture ------------------------------------------------- */
  useEffect(() => {
    setPhase('idle');

    function onSelect() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 3) return;
      if (text.length > 600) return;

      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest('[data-block-id]');
      if (!block) return;
      // Headings, code and figures are not annotatable; the affordance only
      // appears on prose, which is where an argument actually lives.
      const type = block.getAttribute('data-block-type');
      if (!type || !['paragraph', 'quote', 'tldr', 'callout', 'list'].includes(type)) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Context hints only help disambiguate; the server has the real text.
      const blockText = block.textContent ?? '';
      const at = blockText.indexOf(text);
      scrollAtSelection = window.scrollY;
      setSelection({
        blockId: block.getAttribute('data-block-id')!,
        quote: text,
        prefixHint: at > 0 ? blockText.slice(Math.max(0, at - 64), at) : '',
        suffixHint: at >= 0 ? blockText.slice(at + text.length, at + text.length + 64) : '',
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
      setPhase('idle');
    }

    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (composer.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.affordance')) return;
      if (target instanceof Element && target.closest('[data-note-anchor]')) return;
      setSelection((s) => (s ? null : s));
      setPhase('idle');
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }

    /* The affordance is pinned to viewport coordinates taken at selection time,
     * so scrolling invalidates them. Dismiss on a *meaningful* scroll only —
     * momentum scrolling on a phone produces a constant trickle of small deltas
     * and a strict listener would kill the affordance before it could be
     * clicked. */
    let scrollAtSelection = window.scrollY;
    function onScroll() {
      if (Math.abs(window.scrollY - scrollAtSelection) < 40) return;
      setSelection((s) => (s ? null : s));
      setPhase('idle');
    }

    document.addEventListener('selectionchange', onSelect);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', onSelect);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, [close]);

  useEffect(() => {
    if (phase === 'composing') textarea.current?.focus();
  }, [phase]);

  /* --- optimistic insert ------------------------------------------------- */
  function insertLocally(id: string) {
    if (!selection) return;
    const block = document.querySelector(`[data-block-id="${CSS.escape(selection.blockId)}"]`);
    if (!block) return;

    let rail = block.querySelector<HTMLElement>('.block-notes');
    if (!rail) {
      rail = document.createElement('div');
      rail.className = 'block-notes';
      rail.setAttribute('data-notes-for', selection.blockId);
      block.appendChild(rail);
    }
    const count = rail.querySelector('.meta');
    if (count) count.textContent = '1 note';
    rail.insertAdjacentHTML(
      'afterbegin',
      `<article class="border-b border-rule py-3" data-note-id="${id}">
         <p class="meta note-kind-${kind}">${KINDS.find((k) => k.value === kind)?.label}</p>
         <blockquote class="mt-1.5 border-l-2 border-rule-strong pl-2 text-[0.8125rem] leading-snug text-ink-3 italic"></blockquote>
         <p class="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2"></p>
         <p class="meta mt-1.5">${signedInAs ?? 'Anonymous'} · just now</p>
       </article>`,
    );
    const article = rail.querySelector<HTMLElement>('[data-note-id]');
    if (article) {
      const q = article.querySelector('blockquote');
      const p = article.querySelectorAll('p')[1];
      if (q) q.textContent = selection.quote;
      if (p) p.textContent = body;
    }
    setMine((n) => n + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selection || !body.trim()) return;
    setPhase('saving');
    setMessage('');

    try {
      const res = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postId,
          versionId,
          blockId: selection.blockId,
          quote: selection.quote,
          prefixHint: selection.prefixHint,
          suffixHint: selection.suffixHint,
          kind,
          body: body.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setPhase('error');
        setMessage(json.error ?? 'Could not save that note.');
        return;
      }
      insertLocally(json.id);
      setPhase('done');
      // Leave the panel open briefly so the reader sees their note land, then
      // dismiss. Dismissing instantly reads as the note being swallowed.
      setTimeout(close, 700);
    } catch {
      setPhase('error');
      setMessage('Network error. Your note was not saved.');
    }
  }

  const kinds = canWriteAuthorNote
    ? [...KINDS, { value: 'author_note' as Kind, label: 'Author’s note', hint: 'Only visible to you and claimed readers.' }]
    : KINDS;
  const active = kinds.find((k) => k.value === kind) ?? kinds[0]!;

  return (
    <>
      {/* Discoverability. Before the island hydrates there is no affordance at
          all, so a reader who selects a sentence gets nothing and concludes the
          feature does not exist. This is the hint that closes that gap, and it
          is a real state rather than a decoy. */}
      {phase === 'loading' && (
        <p className="fixed bottom-3 left-3 z-40 hidden border border-rule bg-surface px-3 py-2 lg:block">
          <span className="meta">Loading marginalia…</span>
        </p>
      )}

      {phase !== 'loading' && !selection && (
        <p className="fixed bottom-3 left-3 z-40 hidden border border-rule bg-surface px-3 py-2 lg:block">
          <span className="meta">Select any sentence to leave a note</span>
        </p>
      )}

      {/* Once the composer is open the affordance is redundant and sits on top
          of the text it points at. */}
      {selection && phase === 'idle' && (
        <button
          type="button"
          className="affordance"
          /* Clamped: a selection in the first line of the document would put the
             button above the viewport, and one near the right edge would push it
             off-screen on a phone. */
          style={{
            left: Math.min(Math.max(selection.x, 90), window.innerWidth - 90),
            top: Math.max(selection.y - 8, 40),
          }}
          onClick={() => {
            setPhase('composing');
            requestAnimationFrame(() => textarea.current?.focus());
          }}
        >
          Leave a note →
        </button>
      )}

      {selection && phase !== 'idle' && phase !== 'done' && (
        <div
          ref={composer}
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg border border-rule-strong bg-surface p-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:left-auto sm:mx-0"
          role="dialog"
          aria-label="Leave a note"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="meta">Attached to</p>
              <p className="mt-1 line-clamp-2 border-l-2 border-accent pl-2 text-[0.8125rem] leading-snug text-ink-2 italic">
                {selection.quote}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="meta shrink-0 px-1 text-ink-3 hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <form onSubmit={submit} className="mt-3">
            <label className="meta" htmlFor="note-kind">
              What kind of note?
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {kinds.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  aria-pressed={kind === k.value}
                  className={[
                    'border px-2 py-1 text-[0.75rem] transition-colors',
                    kind === k.value
                      ? 'border-accent text-accent'
                      : 'border-rule text-ink-3 hover:border-rule-strong hover:text-ink',
                  ].join(' ')}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-3">{active.hint}</p>

            <label className="meta mt-3 block" htmlFor="note-body">
              Your note
            </label>

            {/* Empty state for the composer's only field. A blank textarea with
                no guidance is the most common way a note gets abandoned. */}
            {phase === 'composing' && !body.trim() && (
              <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-3">
                Empty for now. The notes that survive on a post are the ones that
                would be worth reading on their own — a number, a case, or the
                sentence you think is wrong.
              </p>
            )}

            <textarea
              id="note-body"
              ref={textarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Be specific. The best notes here are the ones that would be worth reading on their own."
              className="mt-1.5 w-full resize-y border border-rule bg-paper px-3 py-2 text-[0.9375rem] leading-relaxed focus:border-accent focus:outline-none"
            />

            {phase === 'error' && (
              <p className="mt-2 border border-danger px-3 py-2 text-[0.8125rem] text-danger" role="alert">
                {message}
              </p>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[0.75rem] leading-snug text-ink-3">
                {signedInAs
                  ? `Posting as ${signedInAs}.`
                  : 'Posting anonymously. You can claim these notes later.'}
              </p>
              <button
                type="submit"
                disabled={phase === 'saving' || !body.trim()}
                className="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[0.875rem] text-paper transition-colors hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-ink-3"
              >
                {phase === 'saving' ? 'Saving…' : 'Post note'}
              </button>
            </div>
          </form>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {phase === 'done' ? 'Note posted.' : message}
      </p>
    </>
  );
}
