/* Tiny shared assertion harness. No dependencies, works on Node and gjs. */

let pass = 0;
const failures = [];

export function ok(cond, name) {
  if (cond) {
    pass++;
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}

export function eq(actual, expected, name) {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const b = expected instanceof Date ? expected.toISOString() : expected;
  if (a !== b) console.log(`        got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  ok(a === b, name);
}

export function near(actual, expected, tol, name) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
    console.log(`        got ${actual} want ${expected} ±${tol}`);
    ok(false, name);
    return;
  }
  ok(true, name);
}

export function throws(fn, name) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(threw, name);
}

export function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

export function report(label = 'assertions') {
  const total = pass + failures.length;
  console.log(`\n${pass}/${total} ${label} passed${failures.length ? ` — ${failures.length} FAILED` : ''}`);
  if (failures.length) console.log(failures.map((f) => ` · ${f}`).join('\n'));
  const code = failures.length ? 1 : 0;
  if (typeof process !== 'undefined' && process.exit) process.exit(code);
  else imports.system.exit(code);
}
