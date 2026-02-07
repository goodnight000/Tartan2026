import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});
import { POST } from './route';

const ORIGINAL_ENV = { ...process.env };

function mockFetchOnce(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

describe('/api/agent POST', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('returns an error when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe('Missing ANTHROPIC_API_KEY.');
  });

  it('returns assistant reply from Anthropic payload', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const fetchMock = mockFetchOnce({
      content: [{ type: 'text', text: 'Hello from Claude.' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.reply).toBe('Hello from Claude.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('includes the agent guide in the system prompt when present', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const fetchMock = mockFetchOnce({
      content: [{ type: 'text', text: 'Guide received.' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const fs = await import('node:fs');
    (fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue('# Agent Guide');

    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });

    await POST(request);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.system).toContain('CareBase Agent Guide');
    expect(body.system).toContain('# CareBase Agent Guide');
  });
});
