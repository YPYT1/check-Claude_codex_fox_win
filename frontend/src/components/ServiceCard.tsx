import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Service } from '@/lib/api';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from './StatusBadge';
import { UptimeIndicator } from './UptimeIndicator';

interface ServiceCardProps {
  service: Service;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }
  return date.toLocaleString();
}

export function ServiceCard({ service }: ServiceCardProps) {
  const [isHovering, setIsHovering] = useState(false);

  const {
    data: detailData,
    isLoading: detailLoading,
    isError: detailError,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ['service-detail', service.id, service.lastCheck],
    queryFn: () => api.getServiceDetail(service.id),
    enabled: isHovering && Boolean(service.lastCheck),
    staleTime: 10_000,
    retry: 1,
  });

  const detailResult = detailData?.result ?? null;
  const detailStatus = detailResult?.status ?? 'unknown';
  const responseTimeLabel =
    detailResult && Number.isFinite(detailResult.responseTime)
      ? `${detailResult.responseTime}ms`
      : '--';
  const detailCheckedAt =
    detailResult?.checkedAt ?? detailData?.lastCheck ?? service.lastCheck ?? null;
  const lastCheckTimestamp = formatTimestamp(detailCheckedAt);
  const stdoutText = detailResult?.stdout?.trim() ?? '';
  const stderrText = detailResult?.stderr?.trim() ?? '';
  const answerContent = detailResult?.answer ?? null;
  const messageContent = detailResult?.message ?? null;
  const modelLabel = useMemo(() => {
    if (!service.model) {
      return null;
    }

    const trimmed = service.model.trim();
    if (!trimmed) {
      return null;
    }

    const ignoredPrefixes = new Set(['claude', 'anthropic', 'openai', 'azure', 'gpt', 'api']);
    const segments = trimmed.split(/[-_:]/).map((segment) => segment.trim()).filter(Boolean);
    for (const segment of segments) {
      const lower = segment.toLowerCase();
      if (ignoredPrefixes.has(lower)) {
        continue;
      }
      if (/^\d+$/.test(segment)) {
        continue;
      }
      return segment;
    }

    return trimmed;
  }, [service.model]);

  return (
    <div
      className="relative rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-shadow duration-200 hover:shadow-md"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900">{service.name}</h3>
          {modelLabel && (
            <Badge variant="secondary" className="text-[11px] font-medium tracking-wide">
              {modelLabel}
            </Badge>
          )}
        </div>
        <StatusBadge status={service.currentStatus} />
      </div>

      <div className="mb-4">
        <UptimeIndicator checks={service.recentChecks} />
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span className="text-gray-500">最近检查</span>
        <span className="font-semibold text-gray-900">{formatTimestamp(service.lastCheck)}</span>
      </div>

      {isHovering && service.lastCheck && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-lg border border-gray-300 bg-white p-4 shadow-2xl">
          {detailLoading && <p className="text-sm text-gray-500">加载详情中...</p>}

          {detailError && (
            <div className="space-y-3 text-sm">
              <p className="text-red-600">
                服务详情加载失败，请稍后重试
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => refetchDetail()}
              >
                重试
              </Button>
            </div>
          )}

          {!detailLoading && !detailError && detailResult && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-3">
                <StatusBadge status={detailStatus} size="sm" />
                <span className="text-gray-600">响应时间: {responseTimeLabel}</span>
                {lastCheckTimestamp && (
                  <span className="text-gray-600">检查时间: {lastCheckTimestamp}</span>
                )}
              </div>

              {answerContent && (
                <div>
                  <span className="text-gray-600">答案: </span>
                  <code className="text-emerald-600">{answerContent}</code>
                </div>
              )}

              {messageContent && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  额外信息: {messageContent}
                </div>
              )}

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">执行结果</h4>
                {stdoutText ? (
                  <pre className="max-h-32 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-800">
                    {stdoutText}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400">无输出</p>
                )}
              </div>

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">执行日志</h4>
                {stderrText ? (
                  <pre className="max-h-32 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-800">
                    {stderrText}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400">无日志</p>
                )}
              </div>
            </div>
          )}

          {!detailLoading && !detailError && !detailResult && (
            <p className="text-sm text-gray-500">暂无详情数据</p>
          )}
        </div>
      )}
    </div>
  );
}
