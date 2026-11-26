interface DailyPoint {
  date: string;
  success: number;
  failure: number;
  limit: number;
}

export function DailyUsageChart({ data }: { data: DailyPoint[] }) {
  if (!data.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">
        아직 기록된 요청이 없습니다.
      </div>
    );
  }
  const max = Math.max(1, ...data.map((point) => point.success + point.failure));
  const width = 520;
  const height = 150;
  const padding = { top: 10, right: 8, bottom: 24, left: 26 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const barWidth = Math.max(6, Math.min(28, innerWidth / data.length - 8));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full min-w-[420px]">
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + innerHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text x={4} y={y + 3} fontSize={9} fill="#94a3b8">
                {Math.round(max * ratio)}
              </text>
            </g>
          );
        })}
        {data.map((point, index) => {
          const total = point.success + point.failure;
          const x =
            padding.left +
            (index + 0.5) * (innerWidth / data.length) -
            barWidth / 2;
          const successHeight = (point.success / max) * innerHeight;
          const failureHeight = (point.failure / max) * innerHeight;
          const baseY = padding.top + innerHeight;
          return (
            <g key={point.date}>
              {total === 0 ? (
                <rect x={x} y={baseY - 2} width={barWidth} height={2} fill="#e2e8f0" rx={1} />
              ) : null}
              <rect
                x={x}
                y={baseY - successHeight}
                width={barWidth}
                height={successHeight}
                fill="#3b82f6"
                rx={2}
              >
                <title>{`${point.date} 성공 ${point.success}`}</title>
              </rect>
              <rect
                x={x}
                y={baseY - successHeight - failureHeight}
                width={barWidth}
                height={failureHeight}
                fill="#f87171"
                rx={2}
              >
                <title>{`${point.date} 실패 ${point.failure} (한도 ${point.limit})`}</title>
              </rect>
              <text
                x={x + barWidth / 2}
                y={height - 8}
                fontSize={8.5}
                textAnchor="middle"
                fill="#94a3b8"
              >
                {point.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-brand-500" /> 성공
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-400" /> 실패
        </span>
        <span className="ml-auto">최근 {data.length}일 · 프로그램 자체 기록</span>
      </div>
    </div>
  );
}

export function ShareBar({
  label,
  value,
  total,
  suffix,
}: {
  label: string;
  value: number;
  total: number;
  suffix?: string;
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-40 flex-none truncate text-[11px] text-slate-600" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-16 flex-none text-right text-[11px] tabular-nums text-slate-500">
        {value}
        {suffix ?? ""} · {percent}%
      </span>
    </div>
  );
}
