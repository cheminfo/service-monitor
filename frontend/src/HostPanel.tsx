import type { Intent } from '@blueprintjs/core';
import { ProgressBar } from '@blueprintjs/core';
import {
  formatBytes,
  formatDuration,
  formatPercent,
} from 'react-cheminfo/core';

import { shareOf } from './shareOf.ts';
import type { HostMetrics } from './types.ts';

/**
 * The machine the server runs on: processor, memory and the data volume, each
 * a bar that turns amber then red as it fills. The container's own share is
 * shown beside the machine's when the server runs in one.
 * @param props - The machine.
 * @param props.host - What the server read of it.
 * @returns The meters.
 */
export function HostPanel(props: { host: HostMetrics }) {
  const { cpu, memory, disk, uptimeSeconds, hostname } = props.host;
  const diskUsed = disk.total - disk.available;
  const memoryUsed = memory.total - memory.free;

  return (
    <div className="monitor-host">
      <dl className="monitor-meters">
        <Meter
          label="Processor, whole machine"
          share={shareOf(cpu.hostPercent ?? 0, 100)}
          detail={`${cpu.hostPercent === null ? '—' : `${cpu.hostPercent}%`} of ${cpu.cores} cores · load ${cpu.load.join(' / ')}`}
        />
        {cpu.containerPercent !== null && (
          <Meter
            label="Processor, server container"
            // A reading over two moments can run past the quota: the bar
            // stops at full, and the figures say by how much.
            share={shareOf(cpu.containerPercent / 100, cpu.quota ?? cpu.cores)}
            detail={`${cpu.containerPercent}% of one core${cpu.quota === null ? '' : `, ${cpu.quota} allowed`}`}
          />
        )}
        <Meter
          label="Memory, whole machine"
          share={shareOf(memoryUsed, memory.total)}
          detail={`${formatBytes(memoryUsed)} of ${formatBytes(memory.total)}, page cache counted as free`}
        />
        {memory.containerUsed !== null && (
          <Meter
            label="Memory, server container"
            share={shareOf(
              memory.containerUsed,
              memory.containerLimit ?? memory.total,
            )}
            detail={`${formatBytes(memory.containerUsed)} of ${memory.containerLimit === null ? 'no limit' : formatBytes(memory.containerLimit)}`}
          />
        )}
        <Meter
          label="Data volume"
          share={shareOf(diskUsed, disk.total)}
          detail={`${formatBytes(disk.available)} free of ${formatBytes(disk.total)}`}
        />
      </dl>
      <p className="monitor-note">
        {hostname}, up{' '}
        {formatDuration(uptimeSeconds * 1000, { style: 'spaced' })}.
      </p>
    </div>
  );
}

/**
 * One bar, with what it measures above it and the figures under it.
 * @param props - The measurement.
 * @param props.label - What is measured.
 * @param props.share - How full, from 0 to 1.
 * @param props.detail - The figures behind the share.
 * @returns The bar.
 */
function Meter(props: { label: string; share: number; detail: string }) {
  const { label, share, detail } = props;
  return (
    <div className="monitor-meter">
      <dt>
        {label}{' '}
        <span className="monitor-meter__share">{formatPercent(share, 0)}</span>
      </dt>
      <dd>
        <ProgressBar
          value={share}
          intent={intentOf(share)}
          animate={false}
          stripes={false}
        />
        <span className="monitor-meter__detail">{detail}</span>
      </dd>
    </div>
  );
}

/**
 * The colour of a bar as it fills.
 * @param share - how full, from 0 to 1
 * @returns the intent
 */
function intentOf(share: number): Intent {
  if (share >= 0.95) return 'danger';
  if (share >= 0.85) return 'warning';
  return 'primary';
}
