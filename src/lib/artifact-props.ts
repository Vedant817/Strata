/**
 * The authoring contract for artifact props (PLAN.md §4.4, v3 author side).
 *
 * Two jobs, and the second one exists because of a bug this file fixes:
 *
 *  1. **A shape per component.** `Artifact.astro` reads four different prop
 *     shapes. A writer editing raw JSON has to know all four, and nothing on
 *     the page tells them which keys the figure they just picked actually reads.
 *  2. **Coercion that cannot destroy the post.** Props arrive from a form, so
 *     they are validated rather than trusted — but "validated" must not mean
 *     "discarded", because discarding is how a figure loses its data on save.
 *
 * That second point is not hypothetical. The previous coercion rule accepted
 * scalars and *flat arrays of scalars* only, on the reasoning that nothing the
 * renderer reads is deeper. That reasoning was wrong in a way nobody checked
 * against the renderer: `matrixCases()` reads `cases`, an array of objects, and
 * `timelineEvents()` reads `events`, also an array of objects. Both were dropped
 * on save. So opening any post carrying a matrix or a timeline artifact in the
 * studio and pressing "Save draft" silently emptied the figure — the writer
 * changed a paragraph and lost the data. Verified against the real function
 * before this was changed, not inferred from the schema.
 *
 * The rule now is: one level of nesting, values scalar, bounded size. Deep enough
 * for everything `Artifact.astro` reads, shallow enough that a consumer cannot
 * meet an `undefined` where it expected a number.
 */

export type ArtifactKind = 'curve' | 'breakdown' | 'matrix' | 'timeline';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['curve', 'breakdown', 'matrix', 'timeline'];

/** Same caps the draft saver has always applied. */
export const MAX_PROPS_BYTES = 4000;
export const MAX_ARRAY_LEN = 200;
export const MAX_SCALAR_CHARS = 500;

export type Scalar = string | number | boolean;
export type PropValue = Scalar | Scalar[] | Array<Record<string, Scalar>>;

/* -------------------------------------------------------------------------- */
/* Coercion                                                                    */
/* -------------------------------------------------------------------------- */

function scalar(value: unknown): Scalar | null {
  if (typeof value === 'string') return value.slice(0, MAX_SCALAR_CHARS);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
}

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/;

/** One level of nesting, every value scalar, every key well-formed. */
function row(value: unknown): Record<string, Scalar> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, Scalar> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!KEY_RE.test(key)) continue;
    const one = scalar(raw);
    // A row with an unusable value is kept with that key absent rather than
    // dropped whole: losing the author's verdict because one cell was blank
    // would be the same class of bug as losing the whole figure.
    if (one !== null) out[key] = one;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function array(value: unknown): PropValue | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const capped = value.slice(0, MAX_ARRAY_LEN);

  /* Three shapes are accepted, and a list mixing them is rejected whole: a
     half-understood list is what renders `undefined` inside a figure. */
  const allScalars = capped.every((v) => scalar(v) !== null);
  if (allScalars) return capped.map((v) => scalar(v)!);

  const allRows = capped.every((v) => row(v) !== null);
  if (allRows) return capped.map((v) => row(v)!);

  return null;
}

/**
 * Validate and coerce an author-supplied props payload.
 *
 * Accepts a JSON string (the draft form, and any import path) or an already
 * decoded object. Never throws: a payload it cannot understand becomes `{}`,
 * because refusing to save the draft is worse than saving a figure that renders
 * its empty state — the writer sees the empty state and knows.
 */
export function parseArtifactProps(raw: string | Record<string, unknown> | undefined): Record<string, PropValue> {
  if (raw === undefined || raw === null) return {};

  let decoded: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length === 0) return {};
    if (raw.length > MAX_PROPS_BYTES) return {};
    try {
      decoded = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return {};

  const out: Record<string, PropValue> = {};
  for (const [key, value] of Object.entries(decoded as Record<string, unknown>)) {
    if (!KEY_RE.test(key)) continue;
    const one = scalar(value);
    if (one !== null) {
      out[key] = one;
      continue;
    }
    const many = array(value);
    if (many !== null) out[key] = many;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Form values -> props                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Split a list field.
 *
 * Commas and newlines separate every list, because that is what a writer types
 * and what a pasted spreadsheet column contains. Whitespace separates numeric
 * lists *only*: `8 12 30` is four readings, but `context precision` is one axis
 * label, and a parser that shredded it would turn a writer's prose into two
 * columns the figure then renders as nonsense.
 */
function splitList(value: string, kind: 'number' | 'text'): string[] {
  const parts = kind === 'number' ? value.split(/[\s,]+/) : value.split(/[,\n]+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

export type FormFieldKind = 'text' | 'number' | 'boolean' | 'numberList' | 'textList';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FormFieldKind;
  help?: string;
  placeholder?: string;
}

export interface RowSpec {
  key: string;
  fields: FieldSpec[];
}

/**
 * One entry per component: which scalar fields it reads, which repeating rows it
 * reads, and in what order. This table *is* the builder's contract — the form is
 * generated from it and the JSON shown to the writer is produced from it, so the
 * two cannot describe different shapes.
 */
export const ARTIFACT_FIELDS: Record<ArtifactKind, { fields: FieldSpec[]; rows?: RowSpec }> = {
  curve: {
    fields: [
      {
        key: 'model',
        label: 'Model',
        kind: 'text',
        help: 'staleness models a TTL; recall plots numbers you measured. Anything else falls back to staleness.',
      },
      { key: 'unit', label: 'Unit', kind: 'text', placeholder: 's' },
      { key: 'min', label: 'X minimum', kind: 'number' },
      { key: 'max', label: 'X maximum', kind: 'number' },
      {
        key: 'changeEvery',
        label: 'Change every N units',
        kind: 'number',
        help: 'How often the value changes, for a staleness curve.',
      },
      {
        key: 'measured',
        label: 'Measured values',
        kind: 'numberList',
        help: 'Required for model = recall. One number per reading, in order.',
      },
    ],
  },
  breakdown: {
    fields: [
      {
        key: 'hops',
        label: 'Hops',
        kind: 'textList',
        help: 'One hop per line, in request order.',
      },
      { key: 'latencies', label: 'Median latency per hop', kind: 'numberList' },
      { key: 'variance', label: 'Spread per hop', kind: 'numberList' },
    ],
  },
  matrix: {
    fields: [
      { key: 'axes', label: 'Axes', kind: 'textList', help: 'One axis per line.' },
    ],
    rows: {
      key: 'cases',
      fields: [
        { key: 'name', label: 'Case', kind: 'text' },
        { key: 'recall', label: 'Recall', kind: 'number' },
        { key: 'precision', label: 'Precision', kind: 'number' },
        { key: 'grounded', label: 'Grounded', kind: 'number' },
        { key: 'verdict', label: 'Verdict', kind: 'text' },
      ],
    },
  },
  timeline: {
    fields: [],
    rows: {
      key: 'events',
      fields: [
        { key: 'at', label: 'When', kind: 'text', placeholder: '2025-03' },
        { key: 'label', label: 'What', kind: 'text' },
        { key: 'note', label: 'Note', kind: 'text' },
      ],
    },
  },
};

/** Flatten a props object back into the form values that would produce it. */
export function propsToForm(kind: ArtifactKind, props: Record<string, unknown>): Record<string, string> {
  const spec = ARTIFACT_FIELDS[kind] ?? ARTIFACT_FIELDS.curve;
  const out: Record<string, string> = {};
  for (const field of spec.fields) {
    const v = props[field.key];
    out[field.key] = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/** The repeating rows of a component, for rendering one input per cell. */
export function rowsOf(kind: ArtifactKind, props: Record<string, unknown>): Array<Record<string, string>> {
  const spec = ARTIFACT_FIELDS[kind] ?? ARTIFACT_FIELDS.curve;
  if (!spec.rows) return [];
  const raw = props[spec.rows.key];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r))
    .slice(0, MAX_ARRAY_LEN)
    .map((r) => {
      const row: Record<string, string> = {};
      for (const field of spec.rows!.fields) {
        const v = r[field.key];
        row[field.key] = v === undefined || v === null ? '' : String(v);
      }
      return row;
    });
}

/**
 * Turn submitted form values into props.
 *
 * Blank is not zero. A writer who has not filled in "spread per hop" should get
 * no key rather than a 0, because `breakdownData` reads `variance[h] ?? 0` and a
 * zero would claim the measurement was taken and found to be zero.
 */
export function formToProps(
  kind: ArtifactKind,
  values: Record<string, string | string[] | undefined>,
): Record<string, PropValue> {
  const spec = ARTIFACT_FIELDS[kind] ?? ARTIFACT_FIELDS.curve;
  const out: Record<string, PropValue> = {};

  const one = (field: FieldSpec): PropValue | null => {
    const raw = values[field.key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const text = (value ?? '').toString().trim();
    if (text === '') return null;
    switch (field.kind) {
      case 'text':
        return text.slice(0, MAX_SCALAR_CHARS);
      case 'number': {
        const n = Number(text);
        return Number.isFinite(n) ? n : null;
      }
      case 'boolean':
        return text === 'on' || text === 'true';
      case 'numberList': {
        const nums = splitList(text, 'number')
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .slice(0, MAX_ARRAY_LEN);
        return nums.length > 0 ? nums : null;
      }
      case 'textList': {
        const list = splitList(text, 'text')
          .slice(0, MAX_ARRAY_LEN)
          .map((s) => s.slice(0, MAX_SCALAR_CHARS));
        return list.length > 0 ? list : null;
      }
    }
  };

  for (const field of spec.fields) {
    const v = one(field);
    if (v !== null) out[field.key] = v;
  }

  if (spec.rows) {
    const raw = values[`${spec.rows.key}__count`];
    const count = Math.min(MAX_ARRAY_LEN, Math.max(0, Number(raw ?? 0) || 0));
    const rows: Array<Record<string, Scalar>> = [];
    for (let i = 0; i < count; i++) {
      const row: Record<string, Scalar> = {};
      for (const field of spec.rows.fields) {
        const v = one({ ...field, key: `${spec.rows.key}.${i}.${field.key}` });
        if (v !== null) row[field.key] = v as Scalar;
      }
      if (Object.keys(row).length > 0) rows.push(row);
    }
    if (rows.length > 0) out[spec.rows.key] = rows;
  }

  return parseArtifactProps(out);
}

/**
 * Read the builder's fields out of a submitted form.
 *
 * The form posts one input per cell — `b_3__f_cases.0.recall` — and this maps
 * them back to the flat shape `formToProps` expects. The alternative was having
 * the browser serialise the props JSON itself, which would put a second copy of
 * the coercion rules in the client where nothing tests it and it will drift.
 * So the client moves inputs around and the server decides what they mean.
 */
export function fieldsFromForm(prefix: string, form: Record<string, unknown>): Record<string, string> {
  const head = `${prefix}__f_`;
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(form)) {
    if (!name.startsWith(head)) continue;
    const value = raw;
    if (Array.isArray(value)) {
      // A name that appears twice — two rows sharing a field name because a
      // client-side renumber was missed. First one wins, which is the same
      // answer a correct form would give.
      if (name in out) continue;
      out[name.slice(head.length)] = value[0] == null ? '' : String(value[0]);
      continue;
    }
    if (name in out) continue;
    out[name.slice(head.length)] = value == null ? '' : String(value).slice(0, 2000);
  }
  return out;
}

/** What the writer will actually have stored, for the read-only JSON panel. */
export function previewJson(kind: ArtifactKind, values: Record<string, string | string[] | undefined>): string {
  return JSON.stringify(formToProps(kind, values), null, 2);
}