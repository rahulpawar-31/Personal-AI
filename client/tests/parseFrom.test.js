import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrom } from '../src/lib/parseFrom.js';

test('a name and address are split', () => {
  assert.deepEqual(parseFrom('Ada Lovelace <ada@example.com>'), { name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.deepEqual(parseFrom('  "Ada Lovelace"  <ada@example.com>  '), { name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.deepEqual(parseFrom('"Lovelace, Ada" <ada@example.com>'), { name: 'Lovelace, Ada', email: 'ada@example.com' });
});

test('a bare address, a bare name and an empty header are left whole', () => {
  assert.deepEqual(parseFrom('ada@example.com'), { name: 'ada@example.com', email: '' });
  assert.deepEqual(parseFrom('  Ada  '), { name: 'Ada', email: '' });
  assert.deepEqual(parseFrom(), { name: '', email: '' });
  assert.deepEqual(parseFrom(''), { name: '', email: '' });
});

test('with no name before the brackets the address is the name', () => {
  assert.deepEqual(parseFrom('<ada@example.com>'), { name: 'ada@example.com', email: 'ada@example.com' });
  assert.deepEqual(parseFrom('"" <ada@example.com>'), { name: 'ada@example.com', email: 'ada@example.com' });
});

test('empty or unclosed brackets are not an address', () => {
  assert.deepEqual(parseFrom('Ada <>'), { name: 'Ada <>', email: '' });
  assert.deepEqual(parseFrom('Ada <ada@example.com'), { name: 'Ada <ada@example.com', email: '' });
  assert.deepEqual(parseFrom('Ada > <'), { name: 'Ada > <', email: '' });
  assert.deepEqual(parseFrom('<ada@example.com> Ada'), { name: '<ada@example.com> Ada', email: '' }, 'text after the closing bracket');
});

test('hostile headers are parsed in milliseconds', () => {
  const cases = [' '.repeat(50_000) + 'x', '<'.repeat(50_000), '"'.repeat(50_000), ' "'.repeat(25_000) + '<', 'a <'.repeat(20_000)];
  for (const input of cases) {
    const start = performance.now();
    parseFrom(input);
    assert.ok(performance.now() - start < 200, `slow on ${JSON.stringify(input.slice(0, 12))}…`);
  }
});
