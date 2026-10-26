import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { onTestFinished, vi } from 'vitest';

/**
 * Render a tree into a fresh element of the page, unmounted when the test
 * finishes.
 * @param tree - what to render
 * @returns the element it renders into
 */
export async function mount(tree: ReactNode): Promise<HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });
  await act(async () => {
    root.render(tree);
  });
  await settle();
  return host;
}

/**
 * Let every pending request and the renders it causes finish.
 */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    // eslint-disable-next-line no-await-in-loop -- each round lets the answers of the last land
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/**
 * Type a value into a field, or pick it in a select, the way React hears it:
 * through the native setter, then an `input` or a `change` event.
 * @param input - the field
 * @param value - what is typed
 */
export async function type(
  input: HTMLInputElement | HTMLSelectElement | null,
  value: string,
): Promise<void> {
  if (input === null) throw new Error('there is no such field');
  const select = input instanceof HTMLSelectElement;
  // React tracks the value it last set, so a plain assignment would read as
  // no change at all.
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      select ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value);
    input.dispatchEvent(
      new Event(select ? 'change' : 'input', { bubbles: true }),
    );
  });
  await settle();
}

/**
 * Click an element, then let what it asked for land.
 * @param element - what is clicked
 */
export async function click(
  element: Element | null | undefined,
): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new Error('there is nothing to click');
  }
  await act(async () => {
    element.click();
  });
  await settle();
}

/**
 * The button of a container whose text is exactly this.
 * @param container - where to look
 * @param text - its text
 * @returns the button
 */
export function button(container: ParentNode, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (each) => each.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`there is no "${text}" button`);
  return found;
}

/**
 * An element the test needs, failing the test at once when it is missing.
 * @param element - what a query found
 * @param what - what it is, for the failure
 * @returns the element
 */
export function required<T extends Element>(
  element: T | null,
  what: string,
): T {
  if (element === null) throw new Error(`there is no ${what}`);
  return element;
}
