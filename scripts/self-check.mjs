import assert from 'node:assert/strict';
import { analyzeHaiku, isHaiku } from './haiku.mjs';

assert.equal(isHaiku('autumn rain falls down\ngentle rivers flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku('autumn rain falls down\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':77:\ngentle rivers flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':101777:'), true);
assert.deepEqual(analyzeHaiku(':101777:').counts, [5, 7, 5]);
assert.deepEqual(analyzeHaiku(':101777:').lines, ['one hundred and one', 'thousand seven hundred and', 'seventy seven']);
assert.equal(isHaiku(':77: gentle rivers flowing slow night birds sing softly'), true);
assert.equal(isHaiku('<https://example.com|autumn> rain falls down\nsoft rivers are flowing slow\nnight birds sing softly'), false);
assert.equal(isHaiku('<slack://canvas/C123|autumn rain falls down\nsoft rivers are flowing slow\nnight birds sing softly>'), false);
assert.equal(isHaiku('<F123ABC|autumn rain falls down\nsoft rivers are flowing slow\nnight birds sing softly>'), false);
assert.equal(isHaiku("if u mean the first there's a canvas we're making here https://hackclub.enterprise.slack.com/docs/T0266FRGM/F0BJ8GR09TK"), false);
assert.equal(isHaiku("if u mean the first there's a canvas we're making here F0BJ8GR09TK"), false);
assert.equal(isHaiku('*autumn* rain falls down\n_soft_ rivers are flowing slow\n~night~ birds sing softly'), true);
assert.equal(isHaiku("poet's rain falls down\nsoft rivers are flowing slow\nnight birds sing softly"), true);
assert.equal(isHaiku("don't wake the old dog\nwe're walking under starlight\nnight birds sing softly"), true);
assert.equal(isHaiku("winter’s cold moon glows\nsoft rivers are flowing slow\nnight birds sing softly"), true);
assert.equal(isHaiku('old fire burns bright\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku('`autumn rain falls down`\nsoft rivers are flowing slow\nnight birds sing softly'), false);
assert.equal(isHaiku('not\na haiku\nat all'), false);
assert.equal(isHaiku('thanks'), false);
assert.deepEqual(analyzeHaiku(':77: gentle rivers flowing slow night birds sing softly').counts, [5, 7, 5]);

console.log('ok');
