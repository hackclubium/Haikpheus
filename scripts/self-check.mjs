import assert from 'node:assert/strict';
import { isHaiku } from './run-haikpheus.mjs';

assert.equal(isHaiku('autumn rain falls down\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':77:\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku(':101777:\nsoft rivers are flowing slow\nnight birds sing softly'), true);
assert.equal(isHaiku('not\na haiku\nat all'), false);

console.log('ok');
