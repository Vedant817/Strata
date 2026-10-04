/**
 * Invisible characters, removed before anything renders them.
 *
 * Found by publishing a post whose title carried bidirectional control characters
 * — the sort of thing an imported archive contains without anyone noticing — and
 * watching `/og/{slug}.png` return **500**. Satori's font handling throws on them,
 * so a post with an invisible character in its title had no share card at all.
 *
 * That is the crash. The reason to strip them rather than to special-case the
 * renderer is that these characters are a **text-spoofing vector**. `U+202E`
 * RIGHT-TO-LEFT OVERRIDE changes how the *rest* of a string is displayed without
 * changing a single byte of it, so a filename ending in `gnp.exe` can be made to
 * render as `exe.png` in a feed reader, a search result, or a browser tab. A
 * reader who cannot trust what the title says is looking at a title this site
 * chose to show them, on a publication whose argument is that it does not
 * manipulate what it presents.
 *
 * So: no invisible formatting character survives into rendered text, a card, a
 * feed, or a `<title>`.
 *
 * What is deliberately **kept**: ZWJ (U+200D) and ZWNJ (U+200C). Those are not
 * invisible formatting — they are how a family emoji or a Persian letter is
 * encoded, and removing them splits one family emoji into four separate people
 * and breaks Arabic and Indic script. The same goes for combining marks: `e` plus
 * U+0301 is one accented letter, not two characters.
 *
 * Every range is written as a `\u` escape rather than as a literal glyph. A
 * literal invisible character is unreviewable in a diff, does not survive a copy
 * and paste, and one editor pass can silently destroy it — which is also how the
 * first version of this file shipped with the very characters it was written to
 * remove.
 */

/**
 * Invisible formatting characters.
 *
 * Explicit ranges rather than `\p{Cf}`, because `Cf` also contains the two
 * joiners above. Being wrong in the direction of *stripping* would silently
 * corrupt emoji and non-Latin scripts, a far worse outcome than the crash this
 * fixes.
 *
 *   00AD      soft hyphen
 *   180E      Mongolian vowel separator
 *   200B      zero-width space
 *   200C/200D ZWNJ / ZWJ — kept on purpose, see above
 *   200E/200F LTR mark, RTL mark
 *   202A-202E LRE, RLE, PDF, LRO, RLO
 *   2060-2064 word joiner, invisible operators
 *   2066-206F LRI, RLI, FSI, PDI, deprecated formatting
 *   3164      Hangul filler
 *   FE00-FE0F variation selectors, including emoji presentation
 *   FFFC      object replacement
 *   FFF9-FFFB interlinear annotation
 */
const INVISIBLE_FORMATTING = new RegExp(
  '[\\u00AD\\u180E\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F' +
    '\\u3164\\uFE00-\\uFE0F\\uFFFC\\uFFF9-\\uFFFB]',
  'g',
);

/**
 * C0 and C1 control characters, minus tab, newline and carriage return.
 *
 * Those three are legitimate and are collapsed by the whitespace pass below.
 * Everything else in these ranges is a device that changes what a renderer does
 * without changing what a reader can select or copy.
 */
const CONTROL = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  'g',
);

/** Longest sensible title, and the card's line budget. */
const MAX_TEXT = 400;

/**
 * Remove invisible formatting characters and collapse the result to something a
 * renderer, a feed reader and a human can all agree on.
 *
 * Collapsing whitespace matters as much as the stripping does: an archive that
 * imported a title containing a newline and forty tabs otherwise produces a share
 * card with a blank band across the middle of it.
 */
export function visibleText(input: unknown, maxLength = MAX_TEXT): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(INVISIBLE_FORMATTING, '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}