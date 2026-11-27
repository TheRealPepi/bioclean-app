import { useMemo } from "react";
import { timeZoneLabel, timeZoneOptions } from "../lib/timeZones";

export function TimeZoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const zones = useMemo(
    () => timeZoneOptions(value).map((zone) => ({ zone, label: timeZoneLabel(zone) })),
    [value],
  );
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map(({ zone, label }) => (
        <option key={zone} value={zone}>
          {label}
        </option>
      ))}
    </select>
  );
}
