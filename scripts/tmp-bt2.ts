import { blockTextFor } from '../src/lib/repo/annotations';
const t = await blockTextFor('p_the-p99-is-a', 'v_p_the-p99-is-a_2', 'b_p_10');
console.log('LEN=' + (t === null ? 'null' : t.length));
console.log(JSON.stringify(t).slice(0, 320));
