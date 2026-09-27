/** @jsxImportSource react */
import { createRequire } from 'node:module';
import fs from 'node:fs';
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

export async function renderShareCard(card: ShareCard): Promise<Uint8Array> {
  const svg = await satori(
    <div
      style={{
        width: 1200,
        height: 630,
        background: PAPER,
        display: 'flex',
        flexDirection: 'column',
        padding: '72px 76px',
        fontFamily: 'Plex Serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div
          style={{
            fontFamily: 'Plex Mono',
            fontSize: 26,
            letterSpacing: 4,
            color: INK_3,
          }}
        >
          STRATA
        </div>
        <div
          style={{
            fontFamily: 'Plex Mono',
            fontSize: 26,
            letterSpacing: 2,
            color: card.kickerColor ?? INK_3,
            textTransform: 'uppercase',
          }}
        >
          {card.kicker}
        </div>
      </div>

      <div
        style={{
          fontSize: 74,
          lineHeight: 1.12,
          fontWeight: 500,
          color: INK,
          marginTop: 36,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {card.title}
      </div>

      {card.dek ? (
        <div
          style={{
            fontSize: 33,
            lineHeight: 1.4,
            color: INK_2,
            marginTop: 20,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {card.dek}
        </div>
      ) : null}

      <div style={{ flex: 1 }} />

      <div style={{ height: 5, background: ACCENT, width: 120, marginBottom: 22 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'Plex Mono', fontSize: 27, color: INK_2 }}>{card.footerLeft}</div>
        <div style={{ fontFamily: 'Plex Mono', fontSize: 27, color: INK_3 }}>{card.footerRight}</div>
      </div>
    </div>,
    { width: 1200, height: 630, fonts: getFonts() },
  );
  return new Resvg(svg).render().asPng();
}
