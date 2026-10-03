import { parseArtifactPropsForTest } from '../src/lib/repo/drafts';
import {
  ARTIFACT_FIELDS,
  formToProps,
  parseArtifactProps,
  propsToForm,
  rowsOf,
} from '../src/lib/artifact-props';
import { matrixCases, timelineEvents } from '../src/lib/artifact';

/** The payload the p99 post already had: paired label/number lists. */
const real = JSON.stringify({
  hops: ['edge', 'auth', 'service', 'db'],
  latencies: [8, 12, 30, 44],
  caption: 'Latency by hop',
  budget: 50,
  dense: false,
  deep: { nested: true },
  bad: [1, { b: 2 }],
  '<script>': 'x()',
});

const kept = parseArtifactPropsForTest(real, 'breakdown');
const labels = kept.hops;
const nums = kept.latencies;

const results: [string, boolean, unknown][] = [
  ['string array survives', Array.isArray(labels) && labels[0] === 'edge', labels],
  ['number array survives', Array.isArray(nums) && nums[3] === 44, nums],
  ['length preserved', Array.isArray(nums) && nums.length === 4, Array.isArray(nums) ? nums.length : null],
  ['string scalar survives', kept.caption === 'Latency by hop', kept.caption],
  ['number scalar survives', kept.budget === 50, kept.budget],
  ['boolean scalar survives', kept.dense === false, kept.dense],
  ['nested object dropped', kept.deep === undefined, kept.deep],
  ['array of objects dropped', kept.bad === undefined, kept.bad],
  ['malformed json -> {}', Object.keys(parseArtifactPropsForTest('{oops', 'curve')).length === 0, null],
  ['array json -> {}', Object.keys(parseArtifactPropsForTest('[1,2]', 'curve')).length === 0, null],
  ['oversized -> {}', Object.keys(parseArtifactPropsForTest(JSON.stringify({ a: 'x'.repeat(5000) }), 'curve')).length === 0, null],
  ['bad key dropped', kept['<script>'] === undefined, null],
  ['non-finite number dropped', parseArtifactPropsForTest('{"n":1e999}', 'curve').n === undefined, null],
  ['mixed array dropped whole', parseArtifactPropsForTest('{"m":[1,"a",{"b":2}]}', 'curve').m === undefined, null],
];

/* -------------------------------------------------------------------------- */
/* The data-loss bug this file exists to prevent                               */
/* -------------------------------------------------------------------------- */

/* `Artifact.astro` reads `cases` and `events` as arrays of objects. The previous
   coercion rule accepted only scalars and flat arrays of scalars, so both were
   dropped on save: a writer editing a paragraph in a post carrying a matrix or a
   timeline figure emptied the figure by pressing Save. Every assertion here is
   the round trip a real save performs — props in, props out, figure still has
   its data — rather than a check on the coercion function in isolation. */

const MATRIX = {
  axes: ['recall@10', 'context precision'],
  cases: [
    { name: 'retrieval', recall: 0.4, precision: 0.3, grounded: 0.5, verdict: 'Fix the index' },
    { name: 'generation', recall: 0.9, precision: 0.8, grounded: 0.4, verdict: 'Fix the generator' },
  ],
};
const TIMELINE = {
  events: [{ at: '2025-03', label: 'v1', note: 'first cut' }],
};

const matrixSurvives = parseArtifactPropsForTest(JSON.stringify(MATRIX), 'matrix');
const matrixRead = matrixCases(matrixSurvives);
const timelineSurvives = parseArtifactPropsForTest(JSON.stringify(TIMELINE), 'timeline');
const timelineRead = timelineEvents(timelineSurvives);

const nestedRejected = parseArtifactPropsForTest(
  '{"rows":[{"a":1,"b":{"deep":true}}]}',
  'matrix',
);

/* A stored prop may be a scalar, a list or a list of rows, so every assertion that
   looks inside one narrows first. Without that the test is asserting on the type
   rather than on the value. */
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRow = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
results.push(
  ['matrix cases survive a save', matrixRead.length === 2, matrixSurvives.cases],
  [
    'and every cell survives',
    matrixRead[1]?.name === 'generation' && matrixRead[1]?.verdict === 'Fix the generator',
    matrixRead[1],
  ],
  ['matrix axes survive', asList(matrixSurvives.axes).length === 2, matrixSurvives.axes],
  ['timeline events survive a save', timelineRead.length === 1, timelineSurvives.events],
  ['and so does the event note', timelineRead[0]?.note === 'first cut', timelineRead[0]],
  [
    'a row with a nested object keeps its scalar cells',
    asRow(asList(nestedRejected.rows)[0]).a === 1,
    nestedRejected.rows,
  ],
  [
    'and drops only the nested key',
    asRow(asList(nestedRejected.rows)[0]).b === undefined,
    nestedRejected.rows,
  ],
);

/* The authoring form and the stored props must not be able to disagree, because
   the form is generated from the same table the validator uses. */
const formValues = {
  'cases.0.name': 'retrieval',
  'cases.0.recall': '0.4',
  'cases.0.verdict': 'Fix the index',
  'cases.1.name': 'generation',
  'cases.1.recall': '0.9',
  'cases__count': '2',
  axes: 'recall@10, context precision',
};
const fromForm = formToProps('matrix', formValues);
results.push(
  ['the form produces two rows', asList(fromForm.cases).length === 2, fromForm.cases],
  [
    'with numbers as numbers, not strings',
    asRow(asList(fromForm.cases)[0]).recall === 0.4,
    asList(fromForm.cases)[0],
  ],
  ['and the axes list round-trips', asList(fromForm.axes).length === 2, fromForm.axes],
  [
    'a blank number is absent, not zero',
    formToProps('breakdown', { variance: '', latencies: '8, 12' }).variance === undefined,
    formToProps('breakdown', { variance: '', latencies: '8, 12' }),
  ],
  [
    'whitespace in a list field is not a value',
    formToProps('curve', { measured: '  ' }).measured === undefined,
    formToProps('curve', { measured: '  ' }),
  ],
  [
    'a two-word label is one list item, not two',
    asList(formToProps('breakdown', { hops: 'auth service\nedge cache' }).hops).length === 2,
    formToProps('breakdown', { hops: 'auth service\nedge cache' }).hops,
  ],
  [
    'while a run of numbers still splits on spaces',
    asList(formToProps('curve', { measured: '0.1 0.4 0.9' }).measured).length === 3,
    formToProps('curve', { measured: '0.1 0.4 0.9' }).measured,
  ],
  [
    'props round-trip back into the form',
    propsToForm('matrix', MATRIX).axes === 'recall@10, context precision',
    propsToForm('matrix', MATRIX),
  ],
  [
    'rows come back for the form to render',
    rowsOf('matrix', MATRIX).length === 2 && rowsOf('timeline', TIMELINE).length === 1,
    rowsOf('matrix', MATRIX),
  ],
  [
    'every component in the table is one the renderer knows',
    Object.keys(ARTIFACT_FIELDS).length === 4,
    Object.keys(ARTIFACT_FIELDS),
  ],
);

results.push(
  ['a non-object payload is refused', Object.keys(parseArtifactProps('[1,2]')).length === 0, null],
  ['undefined is an empty object, not a throw', Object.keys(parseArtifactProps(undefined)).length === 0, null],
);

let failed = 0;
for (const [name, pass, detail] of results) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  -> ${JSON.stringify(detail)}`}`);
}
console.log(failed === 0 ? '\nall artifact-prop assertions passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);