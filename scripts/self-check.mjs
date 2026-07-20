import assert from 'node:assert/strict';
import { analyzeHaiku, isHaiku } from './haiku.mjs';

assert.equal(isHaiku('autumn rain falls down\ngentle rivers flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku('autumn rain falls down\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':77:\ngentle rivers flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':101777:\ngentle rivers flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':101777: gentle rivers flowing slow night birds sing softly'), true);
assert.equal(isHaiku('<https://example.com|autumn> rain falls down\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku("poet's rain falls down\nsoft rivers are flowing slow\nnight birds sing softly"), true);
assert.equal(isHaiku('`autumn rain falls down`\nsoft rivers are flowing slow\nnight birds sing softly'), false);
assert.equal(isHaiku('not\na haiku\nat all'), false);
assert.deepEqual(analyzeHaiku(':101777: gentle rivers flowing slow night birds sing softly').counts, [5, 7, 5]);

console.log('ok');
