import type { ReactElement } from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

/**
 * A component drawn into the document.
 */
export interface Mounted {
  host: HTMLDivElement;
  /**
   * Draw it again with other props.
   */
  render: (element: ReactElement) => void;
  /**
   * Take it out of the document.
   */
  unmount: () => void;
}

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];

/**
 * Draw a component into a fresh element of the document.
 * @param element - what to draw
 * @returns the element, and the means to draw it again or take it out
 */
export function mount(element: ReactElement): Mounted {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const entry = { root, host };
  mounted.push(entry);
  act(() => {
    root.render(element);
  });
  return {
    host,
    render: (next) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      unmountEntry(entry);
    },
  };
}

/**
 * Take every component still drawn out of the document.
 */
export function unmountAll(): void {
  for (const entry of mounted.toReversed()) unmountEntry(entry);
}

/**
 * Let the fake clock run, and every answer due by then land.
 * @param milliseconds - how long
 */
export async function advance(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

/**
 * Click an element.
 * @param element - what to click
 */
export function click(element: Element | null | undefined): void {
  if (!element) throw new Error('there is nothing to click');
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * Type a value into a field, as React hears it: through the native setter,
 * then an input event.
 * @param input - the field
 * @param value - what it now holds
 */
export function typeInto(input: HTMLInputElement | null, value: string): void {
  if (input === null) throw new Error('there is no field to type into');
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * The text of every element a selector matches, in document order.
 * @param root - where to look
 * @param selector - what to look for
 * @returns the texts
 */
export function textsOf(root: ParentNode, selector: string): string[] {
  const texts: string[] = [];
  for (const element of root.querySelectorAll(selector)) {
    texts.push(element.textContent);
  }
  return texts;
}

/**
 * The first element a selector matches whose text is the one given.
 * @param root - where to look
 * @param selector - what to look for
 * @param text - its exact text
 * @returns the element
 */
export function byText(
  root: ParentNode,
  selector: string,
  text: string,
): Element {
  for (const element of root.querySelectorAll(selector)) {
    if (element.textContent === text) return element;
  }
  throw new Error(`no ${selector} reads "${text}"`);
}

/**
 * Take one component out of the document.
 * @param entry - the component
 * @param entry.root - its React root
 * @param entry.host - the element it was drawn into
 */
function unmountEntry(entry: { root: Root; host: HTMLDivElement }): void {
  const index = mounted.indexOf(entry);
  if (index === -1) return;
  mounted.splice(index, 1);
  act(() => {
    entry.root.unmount();
  });
  entry.host.remove();
}
