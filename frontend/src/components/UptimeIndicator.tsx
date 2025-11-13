import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Check } from '@/lib/api';
import { cn } from '@/lib/utils';

interface UptimeIndicatorProps {
  checks?: Check[];
  maxDisplay?: number;
}

type TimelineEntry = Pick<Check, 'status' | 'timestamp' | 'responseTime'> | null;

function resolveStatusColor(status: Check['status'] | null | undefined) {
  switch (status) {
    case 'ok':
      return 'bg-green-500';
    case 'timeout':
      return 'bg-yellow-400';
    case 'fail':
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-200';
  }
}

function buildTooltip(entry: TimelineEntry) {
  if (!entry) {
    return '暂无检查数据';
  }

  const { timestamp, status, responseTime } = entry;
  const date = timestamp ? new Date(timestamp) : null;
  const formatted =
    date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '时间未知';
  const response = Number.isFinite(responseTime) ? `${responseTime}ms` : '--';

  let statusLabel = '状态未知';
  switch (status) {
    case 'ok':
      statusLabel = '正常';
      break;
    case 'timeout':
      statusLabel = '超时';
      break;
    case 'fail':
      statusLabel = '失败';
      break;
    case 'error':
      statusLabel = '错误';
      break;
    default:
      statusLabel = '状态未知';
  }

  return `${formatted} · ${statusLabel} · ${response}`;
}

function formatRelativeLabel(input: string | null | undefined) {
  if (!input) {
    return '暂无数据';
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }
  const raw = formatDistanceToNow(date, { locale: zhCN }).replace(/\s/g, '');
  const normalized = raw.startsWith('大约') ? raw.slice(2) : raw;
  return `${normalized}前`;
}

export function UptimeIndicator({ checks = [], maxDisplay = 90 }: UptimeIndicatorProps) {
  const { timeline, oldestLabel, newestLabel, uptimeLabel } = useMemo(() => {
    if (!Array.isArray(checks) || checks.length === 0) {
      return {
        timeline: Array.from<TimelineEntry>({ length: maxDisplay }).fill(null),
        oldestLabel: '暂无数据',
        newestLabel: '暂无数据',
        uptimeLabel: '--',
      };
    }

    const sanitized = checks.filter(
      (item): item is Check =>
        item != null &&
        typeof item.timestamp === 'string' &&
        typeof item.status === 'string',
    );

    if (sanitized.length === 0) {
      return {
        timeline: Array.from<TimelineEntry>({ length: maxDisplay }).fill(null),
        oldestLabel: '暂无数据',
        newestLabel: '暂无数据',
        uptimeLabel: '--',
      };
    }

    const sorted = sanitized
      .slice()
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    const limited = sorted.slice(-maxDisplay);
    const fillerCount = Math.max(0, maxDisplay - limited.length);
    const filler = Array.from<TimelineEntry>({ length: fillerCount }).fill(null);
    const timeline: TimelineEntry[] = [...filler, ...limited];

    const successCount = limited.filter((item) => item.status === 'ok').length;
    const successRate =
      limited.length > 0 ? (successCount / limited.length) * 100 : null;

    const oldest = limited[0] ?? null;
    const newest = limited[limited.length - 1] ?? null;

    return {
      timeline,
      oldestLabel: formatRelativeLabel(oldest?.timestamp),
      newestLabel: formatRelativeLabel(newest?.timestamp),
      uptimeLabel:
        successRate != null && Number.isFinite(successRate)
          ? `${successRate.toFixed(2)}% uptime`
          : '--',
    };
  }, [checks, maxDisplay]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-0.5">
        {timeline.map((entry, index) => {
          const tooltip = buildTooltip(entry);

          return (
            <div
              key={index}
              className={cn(
                'h-8 flex-1 rounded-sm transition-colors',
                resolveStatusColor(entry?.status),
              )}
              title={tooltip}
              aria-label={tooltip}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{oldestLabel}</span>
        <span className="font-semibold text-gray-700">{uptimeLabel}</span>
        <span>{newestLabel}</span>
      </div>
    </div>
  );
}
