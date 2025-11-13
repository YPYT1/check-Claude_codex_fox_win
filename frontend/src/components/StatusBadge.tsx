interface StatusBadgeProps {
  status: 'ok' | 'fail' | 'error' | 'timeout' | 'unknown' | 'degraded' | 'down';
  size?: 'sm' | 'default';
}

const STATUS_CONFIG: Record<
  StatusBadgeProps['status'],
  { label: string; textClass: string; dotClass: string }
> = {
  ok: {
    label: 'Operational',
    textClass: 'text-green-600',
    dotClass: 'bg-green-600',
  },
  degraded: {
    label: 'Degraded',
    textClass: 'text-yellow-600',
    dotClass: 'bg-yellow-600',
  },
  fail: {
    label: 'Outage',
    textClass: 'text-red-600',
    dotClass: 'bg-red-600',
  },
  error: {
    label: 'Error',
    textClass: 'text-red-600',
    dotClass: 'bg-red-600',
  },
  timeout: {
    label: 'Timeout',
    textClass: 'text-orange-600',
    dotClass: 'bg-orange-500',
  },
  down: {
    label: 'Down',
    textClass: 'text-red-600',
    dotClass: 'bg-red-600',
  },
  unknown: {
    label: 'Unknown',
    textClass: 'text-gray-500',
    dotClass: 'bg-gray-400',
  },
};

export function StatusBadge({ status, size = 'default' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';

  return (
    <span className={`inline-flex items-center gap-2 font-medium ${textSize} ${config.textClass}`}>
      <span className={`rounded-full ${dotSize} ${config.dotClass}`} />
      {config.label}
    </span>
  );
}
