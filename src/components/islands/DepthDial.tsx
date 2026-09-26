import { useEffect, useState } from 'react';

/**
 * The depth dial.
 *
 * The article renders server-side at the reader's stored depth, so this island
 * only has to flip an attribute on an element it does not own. It deliberately
 * does not re-render the article through React — the prose is not a React tree,
 * and making it one would cost the reader the whole point of HTML-first.
 */

type Depth = 'skim' | 'understand' | 'master';

const OPTIONS: Array<{ value: Depth; label: string; minutes: number; hint: string }> = [
  { value: 'skim', label: 'Skim', minutes: 0, hint: 'The argument only.' },
  { value: 'understand', label: 'Read', minutes: 0, hint: 'Full argument, prerequisites explained inline.' },
  { value: 'master', label: 'Study', minutes: 0, hint: 'Everything — footnotes, citations, author notes.' },
];

const COOKIE = 'strata_depth';
const YEAR = 60 * 60 * 24 * 365;

interface Props {
  initial: Depth;
  /** Per-depth reading time in minutes, precomputed server-side. */
  minutes: Record<string, number>;
  hasUnderstand: boolean;
  hasMaster: boolean;
}

export default function DepthDial({ initial, minutes, hasUnderstand, hasMaster }: Props) {
  const [depth, setDepth] = useState<Depth>(initial);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Keep the server-rendered article in sync without re-rendering it in React.
  useEffect(() => {
    const root = document.querySelector('[data-depth-host]');
    if (root) root.setAttribute('data-depth', depth);
  }, [depth]);

  function choose(next: Depth) {
    setDepth(next);
    document.cookie = `${COOKIE}=${next};path=/;max-age=${YEAR};samesite=lax`;
  }

  const available = OPTIONS.filter((o) => {
    if (o.value === 'understand' && !hasUnderstand) return false;
    if (o.value === 'master' && !hasMaster) return false;
    return true;
  });

  // A one-button control is not a control. If the post has nothing deeper to
  // offer, say what it costs to read and get out of the way.
  if (available.length < 2) {
    const only = available[0] ?? OPTIONS[0]!;
    const mins = minutes[only.value] ?? 0;
    return (
      <div className="flex items-baseline justify-between gap-4 border border-rule bg-surface px-4 py-3">
        <p className="text-[0.9375rem] text-ink-2">{only.hint}</p>
        <p className="meta shrink-0 tabular-nums">{mins > 0 ? `${mins} min` : ''}</p>
      </div>
    );
  }

  const active = available.find((o) => o.value === depth) ?? available[0]!;

  return (
    <div className="border border-rule bg-surface">
      <div className="flex items-stretch" role="group" aria-label="Reading depth">
        {available.map((o) => {
          const on = o.value === depth;
          const mins = minutes[o.value] ?? o.minutes;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(o.value)}
              aria-pressed={on}
              title={o.hint}
              className={[
                'flex-1 border-r border-rule px-2 py-2 text-left transition-colors last:border-r-0',
                on ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-sunken hover:text-ink',
              ].join(' ')}
            >
              <span className="block font-sans text-[0.9375rem] leading-tight font-medium">{o.label}</span>
              <span
                className={[
                  'meta block leading-tight tabular-nums',
                  on ? 'text-paper/70' : 'text-ink-3',
                ].join(' ')}
              >
                {mins > 0 ? `${mins} min` : '—'}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-rule px-3 py-1.5 text-[0.8125rem] leading-snug text-ink-3">
        {mounted ? active.hint : ' '}
      </p>
    </div>
  );
}
