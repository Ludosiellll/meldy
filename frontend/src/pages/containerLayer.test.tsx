import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import type { ContainersOverview } from '../types/container';

const hook = vi.hoisted(() => ({ answer: null as null | (() => unknown) }));
vi.mock('../lib/containers/hooks', () => ({
  useContainersOverview: () => {
    if (!hook.answer) throw new Error('not mocked');
    return hook.answer();
  },
}));

import { cleanOverview, LAYER_WAIT, layerKey, layerOf, useContainerLayer, type ContainerLayer } from './containerLayer';

const OVERVIEW: ContainersOverview = {
  v: 1,
  day: '2026-10-10',
  containers: [
    {
      id: 'c-1',
      title: 'Аккредитация',
      exam_date: '2026-10-28',
      created_at: '2026-10-01T10:00:00Z',
      role: 'owner',
      items: 960,
      items_updated_at: '2026-10-01T10:05:00Z',
      subjects: [
        { id: 's-1', position: 1, title: 'Базы данных', exam_date: '2026-10-28', oral_exam_id: null, has_oral: false, keyed: 240, no_key: 0, seen: 60, two_days: 12, open_errors: 9, seen_today: 20, doubted: 0, stale: 0 },
      ],
      answers_today: 20,
      settings: null,
    },
  ],
  attached_exam_ids: ['e-oral'],
};

const answer = (over: Record<string, unknown>) => () => ({ data: null, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined, ...over });

describe('the overview as the screens trust it', () => {
  it('keeps a well-formed overview as it is', () => {
    expect(cleanOverview(OVERVIEW)).toEqual(OVERVIEW);
  });

  it('reads an answer of another shape as no answer: the screens stay today’s', () => {
    expect(cleanOverview(null)).toBeNull();
    expect(cleanOverview({ v: 1, containers: 'x', attached_exam_ids: [] })).toBeNull();
    expect(cleanOverview({ v: 1, containers: [] })).toBeNull();
    expect(cleanOverview([])).toBeNull();
  });

  it('leaves out containers without an id or a title and repairs odd numbers', () => {
    const clean = cleanOverview({
      v: 1,
      day: '2026-10-10',
      containers: [{ id: '', title: 'x' }, { title: 'Без id' }, { id: 'c-2', title: 'Сессия', items: -4, subjects: [{ id: 's', keyed: '7', seen: 3.7 }, { keyed: 1 }] }],
      attached_exam_ids: ['e-1', 7, ''],
    })!;
    expect(clean.containers.map((container) => container.id)).toEqual(['c-2']);
    expect(clean.containers[0].items).toBe(0);
    expect(clean.containers[0].subjects).toHaveLength(1);
    expect(clean.containers[0].subjects[0]).toMatchObject({ id: 's', keyed: 0, seen: 3, position: 1, exam_date: null });
    expect(clean.attached_exam_ids).toEqual(['e-1']);
  });
});

describe('the layer from the hook’s answer', () => {
  it('is on with the overview (from the device without network), off without the functions or on an error, open while loading', () => {
    expect(layerOf(answer({ data: OVERVIEW })())).toEqual({ mode: 'on', overview: OVERVIEW, offline: false });
    expect(layerOf(answer({ data: OVERVIEW, offline: true })())).toEqual({ mode: 'on', overview: OVERVIEW, offline: true });
    expect(layerOf(answer({ unavailable: true })())).toEqual({ mode: 'off' });
    expect(layerOf(answer({ unavailable: true, data: OVERVIEW })())).toEqual({ mode: 'off' });
    expect(layerOf(answer({ error: 'boom' })())).toEqual({ mode: 'off' });
    expect(layerOf(answer({ offline: true, error: 'Нет сети.' })())).toEqual({ mode: 'off' });
    expect(layerOf(answer({ data: { broken: true } })())).toEqual({ mode: 'off' });
    expect(layerOf(answer({ loading: true })())).toBeNull();
    // Still loading but with the device's copy: drawn from the copy.
    expect(layerOf(answer({ loading: true, data: OVERVIEW, offline: true })())).toEqual({ mode: 'on', overview: OVERVIEW, offline: true });
    expect(layerOf(undefined)).toEqual({ mode: 'off' });
  });

  it('keys what the screens depend on: the mode, the containers and the attached exams, never the network', () => {
    const on: ContainerLayer = { mode: 'on', overview: OVERVIEW, offline: false };
    expect(layerKey(on)).toBe('on|c-1|e-oral');
    expect(layerKey({ ...on, offline: true })).toBe(layerKey(on));
    expect(layerKey({ mode: 'off' })).toBe('off');
    expect(layerKey({ mode: 'loading' })).toBe('loading');
  });
});

let seen: ContainerLayer[] = [];
let settledWith: Array<ContainerLayer['mode']> = [];

function Screen() {
  const { layer, probe, settled } = useContainerLayer();
  useEffect(() => {
    seen.push(layer);
  }, [layer]);
  useEffect(() => {
    void settled().then((value) => settledWith.push(value.mode));
  }, [settled]);
  return (
    <>
      {probe}
      <p>{layer.mode === 'on' ? `on: ${layer.overview.containers.length}${layer.offline ? ', offline' : ''}` : layer.mode}</p>
    </>
  );
}

describe('the layer of a screen', () => {
  beforeEach(() => {
    seen = [];
    settledWith = [];
    LAYER_WAIT.ms = 60;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    LAYER_WAIT.ms = 2500;
  });

  it('turns on with the overview and settles once', async () => {
    hook.answer = answer({ data: OVERVIEW });
    render(<Screen />);
    expect(await screen.findByText('on: 1')).toBeInTheDocument();
    expect(settledWith).toEqual(['on']);
  });

  it('turns off when the database has no container functions', async () => {
    hook.answer = answer({ unavailable: true });
    render(<Screen />);
    expect(await screen.findByText('off')).toBeInTheDocument();
    expect(settledWith).toEqual(['off']);
  });

  it('turns off when the hook crashes, and the page goes on', async () => {
    hook.answer = () => {
      throw new Error('broken');
    };
    // React re-throws a caught render error once in development; jsdom would print it.
    const quiet = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', quiet);
    try {
      render(<Screen />);
      expect(await screen.findByText('off')).toBeInTheDocument();
      expect(settledWith).toEqual(['off']);
    } finally {
      window.removeEventListener('error', quiet);
    }
  });

  it('turns off after the wait when the hook does not answer, and on when it answers later', async () => {
    let late = false;
    hook.answer = () => (late ? answer({ data: OVERVIEW, offline: true })() : answer({ loading: true })());
    const view = render(<Screen />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('off')).toBeInTheDocument();
    expect(settledWith).toEqual(['off']);
    late = true;
    view.rerender(<Screen />);
    expect(await screen.findByText('on: 1, offline')).toBeInTheDocument();
    // The first settled answer stays what loadings waited for; the screen follows the latest.
    expect(settledWith).toEqual(['off']);
  });

  it('does not draw the same answer twice', async () => {
    hook.answer = answer({ data: OVERVIEW });
    const view = render(<Screen />);
    await screen.findByText('on: 1');
    const before = seen.length;
    // A new object with the same overview (the hook re-rendered).
    hook.answer = answer({ data: JSON.parse(JSON.stringify(OVERVIEW)) });
    view.rerender(<Screen />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(seen.length).toBe(before);
  });

  it('reads the overview again on the screen’s word (an exam moved on «Сегодня», release 47); nothing breaks without the hook’s reload', async () => {
    const reload = vi.fn();
    hook.answer = answer({ data: OVERVIEW, reload });
    let again: () => void = () => undefined;
    function Mover() {
      const { probe, reload: read } = useContainerLayer();
      again = read;
      return <>{probe}</>;
    }
    const view = render(<Mover />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    again();
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
    hook.answer = () => ({ data: OVERVIEW, loading: false, offline: false, unavailable: false, error: null });
    render(<Mover />);
    expect(() => again()).not.toThrow();
  });
});
