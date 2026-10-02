import { parseArtifactPropsForTest } from '../src/lib/repo/drafts';

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

let failed = 0;
for (const [name, pass, detail] of results) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  -> ${JSON.stringify(detail)}`}`);
}
console.log(failed === 0 ? '\nall artifact-prop assertions passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);