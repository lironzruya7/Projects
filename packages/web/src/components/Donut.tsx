import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts';
import { formatMoney } from '../lib/format';

export interface DonutDatum {
  name: string;
  value: number;
  color: string;
}

function renderActiveShape(props: any): JSX.Element {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 11}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  );
}

/** An interactive donut: tap a slice to highlight it and see its share in the center. */
export function Donut({
  data,
  currency,
  height = 240,
  onSlice,
}: {
  data: DonutDatum[];
  currency: string;
  height?: number;
  onSlice?: (name: string) => void;
}): JSX.Element {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const shown = active != null ? data[active] : null;
  const centerLabel = shown ? shown.name : 'Total';
  const centerValue = shown ? shown.value : total;
  const pct = shown && total > 0 ? Math.round((shown.value / total) * 100) : null;

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={data.length > 1 ? 2 : 0}
            stroke="none"
            activeIndex={active ?? undefined}
            activeShape={renderActiveShape}
            onClick={(_, i) => {
              setActive(i === active ? null : i);
              if (onSlice && data[i]) onSlice(data[i]!.name);
            }}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} className="cursor-pointer outline-none" />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-xs text-muted max-w-[60%] truncate text-center rtl-aware" dir="auto">
          {centerLabel}
          {pct != null && <span className="text-brand"> · {pct}%</span>}
        </div>
        <div className="text-xl font-semibold">{formatMoney(centerValue, currency)}</div>
      </div>
    </div>
  );
}
