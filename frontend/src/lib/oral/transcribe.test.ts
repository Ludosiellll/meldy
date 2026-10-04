import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscribeError, transcribeAudio } from './transcribe';

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts the piece as the body with its type and the question as a hint', async () => {
    const fetchMock = vi.fn(async () => reply(200, { text: 'Спрос эластичен.' }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['opus'], { type: 'audio/webm;codecs=opus' });
    await expect(transcribeAudio(blob, { hint: '  Что   такое эластичность? ' })).resolves.toBe('Спрос эластичен.');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/oral/transcribe?hint=${encodeURIComponent('Что такое эластичность?')}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(blob);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('audio/webm');
  });

  it('tries once more after a server failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(502, { detail: 'Не удалось распознать речь.', code: 'stt_failed' }))
      .mockResolvedValueOnce(reply(200, { text: 'Издержки.' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = transcribeAudio(new Blob(['x'], { type: 'audio/webm' }));
    await vi.advanceTimersByTimeAsync(900);
    await expect(result).resolves.toBe('Издержки.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a request the server refused for good', async () => {
    const fetchMock = vi.fn(async () => reply(415, { detail: 'Такой формат записи не поддерживается.' }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await transcribeAudio(new Blob(['x'], { type: 'video/mp4' })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TranscribeError);
    expect((error as TranscribeError).status).toBe(415);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
