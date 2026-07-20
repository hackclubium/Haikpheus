import { analyzeHaiku } from './haiku.mjs';

console.log(JSON.stringify(analyzeHaiku(process.argv.slice(2).join(' ')), null, 2));
