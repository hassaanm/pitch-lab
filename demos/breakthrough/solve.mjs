// Verifies every puzzle with the same rules module the game uses.
//   node demos/breakthrough/solve.mjs          -> table of all puzzles
//   node demos/breakthrough/solve.mjs e3 -v    -> one puzzle with its solution
// Checks: solvable, par matches puzzles.js, and NOT solvable with one fewer
// turn (so the turn limit is doing real work).
import { solve, initState, apply, describe } from './rules.js';
import { PUZZLES } from './puzzles.js';

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const only = args.filter((a) => !a.startsWith('-'));
let bad = 0;

for (const p of PUZZLES) {
  if (only.length && !only.includes(p.id)) continue;
  const t0 = Date.now();
  const r = solve(p);
  const fewer = p.turns > 1 ? solve({ ...p, turns: p.turns - 1 }) : { solved: false };
  const ms = Date.now() - t0;
  const problems = [];
  if (!r.solved) problems.push(r.aborted ? 'ABORTED' : 'UNSOLVABLE');
  if (r.solved && p.par !== undefined && p.par !== r.par) problems.push(`par in file ${p.par} != ${r.par}`);
  if (fewer.solved) problems.push(`solvable in ${p.turns - 1} turn(s)`);
  if (problems.length) bad++;
  console.log(`${p.id.padEnd(3)} ${p.name.padEnd(16)} turns ${p.turns}  par ${r.par ?? '-'}  used ${r.turns ?? '-'}  states ${String(r.states).padStart(8)}  ${ms}ms  ${problems.join('; ') || 'OK'}`);
  if (verbose && r.solved) {
    let s = initState(p);
    for (const a of r.path) { console.log('    ' + describe(s, a)); s = apply(s, a).state; }
  }
}
if (bad) { console.log(`\n${bad} puzzle(s) need work`); process.exitCode = 1; }
else console.log('\nAll puzzles verified.');
