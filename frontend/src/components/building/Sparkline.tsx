import { ResponsiveContainer, AreaChart, Area } from 'recharts';

interface Props {
  data: number[];
  color: string;
  width?: number | string;
  height?: number;
}

export default function Sparkline({ data, color, width = 120, height = 32 }: Props) {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} />;
  }
  const points = data.map((v, i) => ({ i, v }));
  const gradId = `sparkfill-${color.replace('#', '')}`;
  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
