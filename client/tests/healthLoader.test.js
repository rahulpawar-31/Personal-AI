import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthLoader } from '../src/healthLoader.js';

function setup(request) {
  const shown = [];
  const loader = createHealthLoader(request, h => shown.push(h));
  return { loader, shown };
}

// A request whose answer the test hands over by hand.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('load shows the connected services the server reports', async () => {
  const { loader, shown } = setup(async () => ({ google: true, github: false }));
  await loader.load();
  assert.deepEqual(shown, [{ google: true, github: false }]);
});

test('a disconnected account is shown as disconnected', async () => {
  const { loader, shown } = setup(async () => ({ google: false }));
  await loader.load();
  assert.deepEqual(shown, [{ google: false }]);
});

test('a failed or unusable answer keeps what is shown', async () => {
  for (const bad of [() => Promise.reject(new Error('offline')), async () => null, async () => undefined, async () => 'oops']) {
    const { loader, shown } = setup(bad);
    await loader.load();
    assert.deepEqual(shown, []);
  }
});

test('reset clears the status straight away', () => {
  const { loader, shown } = setup(async () => ({ google: true }));
  loader.reset();
  assert.deepEqual(shown, [{}]);
});

test('an answer for a request that started before reset is dropped (one account must not see the last one\'s services)', async () => {
  const slow = deferred();
  const { loader, shown } = setup(() => slow.promise);
  const pending = loader.load(); // account A is signed in
  loader.reset();                // A signs out
  slow.resolve({ google: true });
  await pending;
  assert.deepEqual(shown, [{}], 'only the reset was shown');
});

test('sign out then sign in as another account: only the new account\'s status is shown', async () => {
  const answers = [deferred(), deferred()];
  let n = 0;
  const { loader, shown } = setup(() => answers[n++].promise);
  const first = loader.load();   // account A
  loader.reset();                // A signs out
  const second = loader.load();  // account B signs in
  answers[1].resolve({ google: false });
  answers[0].resolve({ google: true }); // A's late answer arrives last
  await Promise.all([first, second]);
  assert.deepEqual(shown, [{}, { google: false }]);
});

test('the newest load wins when two overlap', async () => {
  const answers = [deferred(), deferred()];
  let n = 0;
  const { loader, shown } = setup(() => answers[n++].promise);
  const a = loader.load();
  const b = loader.load();
  answers[1].resolve({ v: 2 });
  answers[0].resolve({ v: 1 });
  await Promise.all([a, b]);
  assert.deepEqual(shown, [{ v: 2 }]);
});

test('a failed newer refresh does not discard an overlapping successful answer', async () => {
  for (const failFirst of [true, false]) {
    const answers = [deferred(), deferred()];
    let n = 0;
    const { loader, shown } = setup(() => answers[n++].promise);
    loader.reset();
    const first = loader.load();
    const second = loader.load();
    if (failFirst) {
      answers[1].reject(new Error('offline'));
      await second;
    }
    answers[0].resolve({ google: true });
    await first;
    if (!failFirst) answers[1].resolve(null);
    await second;
    assert.deepEqual(shown, [{}, { google: true }]);
  }
});

test('reset still rejects an old account answer when the new account request fails', async () => {
  const answers = [deferred(), deferred()];
  let n = 0;
  const { loader, shown } = setup(() => answers[n++].promise);
  const oldAccount = loader.load();
  loader.reset();
  const newAccount = loader.load();
  answers[1].reject(new Error('offline'));
  await newAccount;
  answers[0].resolve({ google: true });
  await oldAccount;
  assert.deepEqual(shown, [{}]);
});
