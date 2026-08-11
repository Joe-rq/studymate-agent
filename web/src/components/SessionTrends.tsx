import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface Props {
  accuracyTrend: Array<{ date: string; avgAccuracy: number }>;
  durationTrend: Array<{ date: string; totalMinutes: number }>;
}

/** 从当前主题解析强调色（适配 light/dark × 角色 Ambient）。 */
function themeColor(): string {
  try {
    return (
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#7ba88f'
    );
  } catch {
    return '#7ba88f';
  }
}

/** Session 趋势：正确率折线 + 专注时长折线。 */
export default function SessionTrends({ accuracyTrend, durationTrend }: Props) {
  const primary = themeColor();

  return (
    <div>
      <div className="chart-block">
        <p className="card-title">正确率趋势</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={accuracyTrend} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              domain={[0, 1]}
            />
            <Tooltip formatter={(v) => `${Math.round(Number(v ?? 0) * 100)}%`} />
            <Line
              type="monotone"
              dataKey="avgAccuracy"
              stroke={primary}
              strokeWidth={2}
              dot={{ r: 3 }}
              name="正确率"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-block">
        <p className="card-title">专注时长趋势</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={durationTrend} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}分`} />
            <Tooltip formatter={(v) => `${Number(v ?? 0)} 分钟`} />
            <Line
              type="monotone"
              dataKey="totalMinutes"
              stroke={primary}
              strokeWidth={2}
              dot={{ r: 3 }}
              name="时长"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
