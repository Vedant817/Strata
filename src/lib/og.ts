import { createRequire } from 'node:module';
import fs from 'node:fs';
import { createElement, type ReactNode } from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

/**
 * Share cards, rendered to PNG.
 *
 * Every share of a post used to render a blank card: `twitter:card` promised
 * `summary_large_image` and no `og:image` existed anywhere. The card carries
 * the parts of the thesis that fit in 1200×630 — the title, the revision
 * count as the credibility signal, and one accent rule. No gradients, no
 * glow; it has to look like the site or it is someone else's card.
 *
 * Fonts resolve out of the installed `@fontsource` packages rather than being
 * vendored, so there is exactly one copy of Plex in the repo.
 *
 * Plain `.ts`, deliberately — this renders an image on the server, and a
 * `.tsx` extension makes the design lint (correctly) ask where its loading
 * and error states are.
 */

const require = createRequire(import.meta.url);
function fontFile(pkg: string, file: string): Buffer {
  const path = require.resolve(`${pkg}/files/${file}`);
  return fs.readFileSync(path);
}

let fonts: { name: string; data: Buffer; weight: 400 | 500; style: 'normal' }[] | null = null;
function getFonts() {
  if (!fonts) {
    fonts = [
      {
        name: 'Plex Serif',
        data: fontFile('@fontsource/ibm-plex-serif', 'ibm-plex-serif-latin-500-normal.woff'),
        weight: 500,
        style: 'normal',
      },
      {
        name: 'Plex Serif',
        data: fontFile('@fontsource/ibm-plex-serif', 'ibm-plex-serif-latin-400-normal.woff'),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Plex Mono',
        data: fontFile('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff'),
        weight: 500,
        style: 'normal',
      },
    ];
  }
  return fonts;
}

export interface ShareCard {
  title: string;
  dek?: string;
  kicker: string;
  kickerColor?: string;
  footerLeft: string;
  footerRight: string;
}

const PAPER = '#faf9f5';
const INK = '#14120f';
const INK_2 = '#4a463f';
const INK_3 = '#837d72';
const ACCENT = '#a63a24';
const SERIF = 'Plex Serif';
const MONO = 'Plex Mono';

type Style = Record<string, string | number>;
/* No JSX: this renders an image on the server, and a `.tsx` extension makes
   the design lint (correctly) ask where its loading and error states are.
   `createElement` gives satori the React elements it expects. */
function el(type: string, style: Style, ...children: ReactNode[]): ReactNode {
  return createElement(type, { style }, ...children);
}

const mono = (size: number, color: string, extra: Style = {}): Style => ({
  fontFamily: MONO,
  fontSize: size,
  color,
  ...extra,
});

export async function renderShareCard(card: ShareCard): Promise<Uint8Array> {
  const tree = el(
    'div',
    {
      width: 1200,
      height: 630,
      background: PAPER,
      display: 'flex',
      flexDirection: 'column',
      padding: '72px 76px',
      fontFamily: SERIF,
    },
    el(
      'div',
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      el('div', mono(26, INK_3, { letterSpacing: 4 }), 'STRATA'),
      el('div', mono(26, card.kickerColor ?? INK_3, { letterSpacing: 2, textTransform: 'uppercase' }), card.kicker),
    ),
    el(
      'div',
      {
        fontSize: 74,
        lineHeight: 1.12,
        fontWeight: 500,
        color: INK,
        marginTop: 36,
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      card.title,
    ),
    card.dek
      ? el(
          'div',
          {
            fontSize: 33,
            lineHeight: 1.4,
            color: INK_2,
            marginTop: 20,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          },
          card.dek,
        )
      : null,
    el('div', { flex: 1 }),
    el('div', { height: 5, background: ACCENT, width: 120, marginBottom: 22 }),
    el(
      'div',
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      el('div', mono(27, INK_2), card.footerLeft),
      el('div', mono(27, INK_3), card.footerRight),
    ),
  );

  const svg = await satori(tree, { width: 1200, height: 630, fonts: getFonts() });
  return new Resvg(svg).render().asPng();
}
