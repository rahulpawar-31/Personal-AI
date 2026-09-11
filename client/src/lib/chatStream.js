import { apiFetch } from '../api.js';

// Streams /api/chat's SSE response as parsed events. Yields the raw
// { type: 'status' | 'token' | 'done' | 'error', ... } objects the server
// writes as `data: <json>\n\n` lines — callers decide what each event means.
// This is wire-protocol parsing only: transcript accumulation (push a new
// message vs. append to the last one) stays the caller's job.
export async function* streamChat({ message, history }) {
  const response = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(err.error ?? 'Server error');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // keep the incomplete trailing line for the next chunk

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let data;
      try { data = JSON.parse(line.slice(6)); } catch { continue; }
      yield data;
    }
  }
}
