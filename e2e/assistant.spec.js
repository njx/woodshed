import { test, expect } from './app.js';

// A stand-in for the Anthropic API, answering in its real streaming (SSE) format.
// Script: search the library and check today's set → add the first two results → reply.
const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
function message(blocks, stop) {
  const ev = [['message_start', { type: 'message_start', message: { id: `msg_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0, output_tokens: 1 } } }]];
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
      for (const part of b.text.match(/.{1,12}/gs)) ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } }]);
    } else {
      ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }]);
      for (const part of JSON.stringify(b.input).match(/.{1,20}/gs)) ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } }]);
    }
    ev.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 400 } }]);
  ev.push(['message_stop', { type: 'message_stop' }]);
  return sse(ev);
}
const search = { query: null, type: 'tune', levels: ['familiar'], style: null, key: null, due_only: null, focus_only: null, not_played_in_days: null, sort: 'priority', limit: 5 };

async function mockApi(page) {
  const api = { requests: [], badKey: false, error: null };
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData());
    api.requests.push({ headers: req.headers(), body });
    // The real API's documented limits on strict tools (it answers 400 above them).
    const strict = body.tools.filter((t) => t.strict);
    const unions = strict.flatMap((t) => Object.values(t.input_schema.properties)).filter((p) => Array.isArray(p.type) || p.anyOf).length;
    const optional = strict.flatMap((t) => Object.keys(t.input_schema.properties).filter((k) => !t.input_schema.required.includes(k))).length;
    if (strict.length > 20 || unions > 16 || optional > 24) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation.' } }) });
    }
    if (api.error) return route.fulfill({ status: api.error.status, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: api.error.body }) });
    if (api.badKey) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    }
    const last = body.messages[body.messages.length - 1];
    const results = Array.isArray(last.content) ? last.content.filter((c) => c.type === 'tool_result') : [];
    let reply;
    if (!results.length) {
      reply = message([{ type: 'text', text: 'Let me look at your library.' }, { type: 'tool_use', id: 'tu1', name: 'search_library', input: search }, { type: 'tool_use', id: 'tu2', name: 'get_today', input: {} }], 'tool_use');
    } else if (results.some((r) => r.tool_use_id === 'tu1')) {
      const found = JSON.parse(results.find((r) => r.tool_use_id === 'tu1').content).items;
      reply = message([{ type: 'tool_use', id: 'tu3', name: 'add_to_today', input: { items: [{ item_id: found[0].id, keys: null }, { item_id: found[1].id, keys: null }] } }], 'tool_use');
    } else {
      reply = message([{ type: 'text', text: 'Added two tunes you know a little:\n- **Thing one**\n- **Thing two**' }], 'end_turn');
    }
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply });
  });
  return api;
}

async function connect(page) {
  await page.click('#today-ask');
  await page.fill('#key-input', 'sk-ant-test-1234');
  await page.click('#key-save');
  await expect(page.locator('[data-suggest]').first()).toBeVisible();
}

test('the assistant changes today’s set, shows the cost, and can undo', async ({ page, ui }) => {
  const api = await mockApi(page);
  await ui.start();
  const before = await ui.cardTitles();
  await connect(page);
  await page.locator('[data-suggest]').first().click();

  await expect(page.locator('.changes li')).toHaveCount(1);
  await expect(page.locator('.changes li')).toContainText('Added to today');
  await expect(page.locator('.tool-lines span')).toContainText(['Searched your library', 'Checked today’s set']);
  await expect(page.locator('.bot-text').last()).toContainText('Thing two');
  await expect(page.locator('.msg-cost')).toHaveText(/¢/);
  await expect(page.locator('#chat-cost')).toContainText('this chat');

  // What was sent: model, fallbacks, tools, the user's key, the app state first.
  const q = api.requests[0];
  expect(q.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium' }, stream: true });
  expect(q.body.tools).toHaveLength(13);
  expect(q.body.tools.every((t) => t.eager_input_streaming)).toBe(true);
  expect(q.headers['x-api-key']).toBe('sk-ant-test-1234');
  expect(q.headers['anthropic-beta']).toContain('server-side-fallback');
  expect(q.body.messages[0].content[0].text.startsWith('<app_state>')).toBe(true);
  // The history only grows: user, tool use, results, tool use, results.
  expect(api.requests[2].body.messages).toHaveLength(5);

  // Undo puts the set back, and the assistant is told next time.
  expect((await ui.cardTitles()).length).toBeGreaterThan(before.length);
  await page.click('[data-undo]');
  await expect(page.locator('.changes.undone')).toHaveCount(1);
  expect(await ui.cardTitles()).toEqual(before);
  await page.fill('#chat-text', 'thanks');
  await page.click('#chat-send');
  await expect.poll(() => api.requests.some((r) => JSON.stringify(r.body.messages.at(-1)).includes('I undid the changes'))).toBe(true);
});

test('no Undo for the assistant once you’ve changed things since', async ({ page, ui }) => {
  await mockApi(page);
  await ui.start();
  await connect(page);
  await page.locator('[data-suggest]').first().click();
  await expect(page.locator('[data-undo]')).toHaveCount(1);
  await ui.backdrop();
  await page.locator('.card .check').first().click(); // practice something
  await page.click('#today-ask');
  await expect(page.locator('.changes li')).toHaveCount(1);
  await expect(page.locator('[data-undo]')).toHaveCount(0);
  await ui.backdrop();
  await expect(page.locator('.card.done')).toHaveCount(1);
});

test('a rejected API key gets a clear message; spending shows in Settings', async ({ page, ui, pageErrors }) => {
  pageErrors.allow(/401/);
  const api = await mockApi(page);
  await ui.start();
  await connect(page);
  await page.locator('[data-suggest]').first().click();
  await expect(page.locator('.changes li')).toHaveCount(1);
  api.badKey = true;
  await page.click('#chat-new');
  await page.fill('#chat-text', 'hello');
  await page.click('#chat-send');
  await expect(page.locator('.chat-error')).toContainText('API key wasn’t accepted');
  await ui.backdrop();
  await ui.tab('settings');
  await expect(page.locator('#key-status')).toHaveText('Set (…1234)');
  await expect(page.locator('#spend-text')).toContainText('Today');
  await ui.expectNoSideScroll();
});

test('request errors show Anthropic’s explanation', async ({ page, ui, pageErrors }) => {
  pageErrors.allow(/400/);
  const api = await mockApi(page);
  await ui.start();
  await connect(page);

  api.error = { status: 400, body: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } };
  await page.fill('#chat-text', 'hello');
  await page.click('#chat-send');
  await expect(page.locator('.chat-error').last()).toContainText('out of credit');

  api.error = { status: 400, body: { type: 'invalid_request_error', message: 'tools.0.input_schema: something is wrong' } };
  await page.fill('#chat-text', 'hello again');
  await page.click('#chat-send');
  await expect(page.locator('.chat-error').last()).toContainText('tools.0.input_schema: something is wrong');
});
