import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { HostPanel } from '../HostPanel.tsx';
import type { HostMetrics } from '../types.ts';

import { HOST } from './fixtures.ts';
import { decodeEntities } from './markup.ts';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

const METER =
  /<dt>(?<label>[^<]+) <span class="monitor-meter__share">(?<share>[^<]+)<\/span><\/dt><dd><div aria-valuemax="100" aria-valuemin="0" aria-valuenow="(?<bar>\d+)" class="bp6-progress-bar bp6-intent-(?<intent>\w+)[^"]*"[^>]*>.*?<span class="monitor-meter__detail">(?<detail>[^<]+)<\/span>/g;

/**
 * The meters a panel draws, each as a reader sees it.
 * @param host - the machine
 * @returns the label, the share written, the bar's value and colour, and the figures
 */
function metersOf(host: HostMetrics) {
  const html = renderToStaticMarkup(<HostPanel host={host} />);
  return Array.from(html.matchAll(METER), ({ groups }) => ({
    label: groups?.label,
    share: groups?.share,
    bar: Number(groups?.bar),
    intent: groups?.intent,
    detail: decodeEntities(groups?.detail ?? ''),
  }));
}

/**
 * A machine whose processor is as busy as given.
 * @param hostPercent - how busy every core was, in percent
 * @returns the machine
 */
function busyHost(hostPercent: number): HostMetrics {
  return { ...HOST, cpu: { ...HOST.cpu, hostPercent } };
}

test('outside a container, the processor, the memory and the data volume of the machine are three bars', () => {
  expect(metersOf(HOST)).toStrictEqual([
    {
      label: 'Processor, whole machine',
      share: '22 %',
      bar: 22,
      intent: 'primary',
      detail: '21.5% of 16 cores · load 2.4 / 1.8 / 1.2',
    },
    {
      label: 'Memory, whole machine',
      share: '63 %',
      bar: 63,
      intent: 'primary',
      detail: '40.0 GB of 64.0 GB, page cache counted as free',
    },
    {
      label: 'Data volume',
      share: '88 %',
      bar: 88,
      intent: 'warning',
      detail: '60.0 GB free of 500 GB',
    },
  ]);
});

test('the machine is named under the bars, with how long it has been up', () => {
  const html = renderToStaticMarkup(<HostPanel host={HOST} />);

  expect(html).toContain('<p class="monitor-note">web-1, up 76 h 05 min.</p>');
});

test('in a container, its processor is read against its quota and its memory against its limit', () => {
  const meters = metersOf({
    ...HOST,
    cpu: { ...HOST.cpu, quota: 2, containerPercent: 150 },
    memory: { ...HOST.memory, containerUsed: 768 * MIB, containerLimit: GIB },
  });

  expect(meters.map((meter) => meter.label)).toStrictEqual([
    'Processor, whole machine',
    'Processor, server container',
    'Memory, whole machine',
    'Memory, server container',
    'Data volume',
  ]);
  expect([meters[1], meters[3]]).toStrictEqual([
    {
      label: 'Processor, server container',
      share: '75 %',
      bar: 75,
      intent: 'primary',
      detail: '150% of one core, 2 allowed',
    },
    {
      label: 'Memory, server container',
      share: '75 %',
      bar: 75,
      intent: 'primary',
      detail: '768 MB of 1.0 GB',
    },
  ]);
});

test('a container running past its quota fills its bar, and its figures say by how much', () => {
  const meters = metersOf({
    ...HOST,
    cpu: { ...HOST.cpu, quota: 2, containerPercent: 250 },
  });

  expect(meters[1]).toStrictEqual({
    label: 'Processor, server container',
    share: '100 %',
    bar: 100,
    intent: 'danger',
    detail: '250% of one core, 2 allowed',
  });
});

test('a container with no quota is read against the cores, and one with no limit against the memory of the machine', () => {
  const meters = metersOf({
    ...HOST,
    cpu: { ...HOST.cpu, containerPercent: 400 },
    memory: { ...HOST.memory, containerUsed: 16 * GIB },
  });

  expect([meters[1], meters[3]]).toStrictEqual([
    {
      label: 'Processor, server container',
      share: '25 %',
      bar: 25,
      intent: 'primary',
      detail: '400% of one core',
    },
    {
      label: 'Memory, server container',
      share: '25 %',
      bar: 25,
      intent: 'primary',
      detail: '16.0 GB of no limit',
    },
  ]);
});

test('a bar turns amber from 85 % and red from 95 %', () => {
  expect(
    [84, 85, 94, 95, 100].map((percent) => {
      const [meter] = metersOf(busyHost(percent));
      return [meter?.share, meter?.intent];
    }),
  ).toStrictEqual([
    ['84 %', 'primary'],
    ['85 %', 'warning'],
    ['94 %', 'warning'],
    ['95 %', 'danger'],
    ['100 %', 'danger'],
  ]);
});

test('before a second reading, the busyness of the processor is a dash over an empty bar', () => {
  const host: HostMetrics = {
    ...HOST,
    cpu: { ...HOST.cpu, hostPercent: null },
  };

  expect(metersOf(host)[0]).toStrictEqual({
    label: 'Processor, whole machine',
    share: '0 %',
    bar: 0,
    intent: 'primary',
    detail: '— of 16 cores · load 2.4 / 1.8 / 1.2',
  });
  expect(renderToStaticMarkup(<HostPanel host={host} />)).toContain(
    '<div class="bp6-progress-meter" style="width:0%"></div>',
  );
});
