/**
 * A writable memo that throws keeps throwing for every later reader. Clearing
 * STATUS_ERROR only happens on a recompute or an async settle, and a direct
 * write deliberately does neither, so the written value commits underneath a
 * node that still reports an error and the memo cannot be recovered.
 *
 * @see https://github.com/solidjs/solid/issues/4110
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  resetErrorHalt
} from "../src/index.js";

it("a write clears an error the derivation left behind", () => {
  const seen: unknown[] = [];
  const { value, setValue } = createRoot(() => {
    const [failing] = createSignal(true);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    createEffect(() => value(), {
      effect: v => void seen.push({ ok: v }),
      error: e => void seen.push({ err: (e as Error).message })
    });
    return { value, setValue };
  });

  flush();
  expect(seen).toEqual([{ err: "boom" }]);

  setValue(2);
  flush();
  expect(seen).toEqual([{ err: "boom" }, { ok: 2 }]);
  expect(value()).toBe(2);
});

it("a write of the last good value still recovers the memo", () => {
  const { value, setValue, setFailing } = createRoot(() => {
    const [failing, setFailing] = createSignal(false);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    return { value, setValue, setFailing };
  });

  expect(value()).toBe(1);

  setFailing(true);
  flush();
  expect(() => value()).toThrow("boom");

  // equal to the last good value, so the equality gate must not drop it
  setValue(1);
  flush();
  expect(value()).toBe(1);
});

it("keeps the error on screen until the replacement write commits", () => {
  const { value, setValue, setFailing } = createRoot(() => {
    const [failing, setFailing] = createSignal(false);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    return { value, setValue, setFailing };
  });

  expect(value()).toBe(1);
  setFailing(true);
  flush();
  expect(() => value()).toThrow("boom");

  setValue(2);
  expect(() => value()).toThrow("boom");
  const derived = createRoot(() => createMemo(value));
  expect(() => derived()).toThrow("boom");
  flush();
  expect(value()).toBe(2);
  expect(derived()).toBe(2);
});

it("keeps the error visible while an action holds the replacement", async () => {
  const { value, setValue, setFailing } = createRoot(() => {
    const [failing, setFailing] = createSignal(false);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    return { value, setValue, setFailing };
  });

  expect(value()).toBe(1);
  setFailing(true);
  flush();
  expect(() => value()).toThrow("boom");

  let release!: () => void;
  const run = action(function* () {
    setValue(3);
    yield new Promise<void>(resolve => (release = resolve));
  });
  const done = run();
  flush();
  expect(() => value()).toThrow("boom");
  const derived = createRoot(() => createMemo(value));
  expect(() => derived()).toThrow();

  release();
  await done;
  flush();
  expect(value()).toBe(3);
  expect(derived()).toBe(3);
});

it("a manual write replaces an error staged behind a held frame", async () => {
  const request = Promise.withResolvers<number>();
  const [step, setStep] = createSignal(0);
  const seen: number[] = [];
  const { value, setValue, dispose } = createRoot(dispose => {
    const slow = createMemo(() => (step() === 0 ? 1 : request.promise));
    const [value, setValue] = createSignal(() => {
      if (step() === 1) throw new Error("boom");
      return 1;
    });
    const sum = createMemo(() => slow() + value());
    createRenderEffect(sum, v => void seen.push(v), { schedule: true });
    createEffect(sum, { effect: () => {}, error: () => {} });
    return { value, setValue, dispose };
  });

  try {
    flush();
    expect(seen).toEqual([2]);
    let resume!: () => void;
    const run = action(function* () {
      setStep(1);
      yield new Promise<void>(resolve => (resume = resolve));
      setValue(3);
    });
    const done = run();
    flush();
    expect(seen).toEqual([2]);

    resume();
    await done;
    flush();
    expect(seen).toEqual([2]);

    request.resolve(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(seen).toEqual([2, 5]);
    expect(value()).toBe(3);
  } finally {
    dispose();
    resetErrorHalt();
  }
});
