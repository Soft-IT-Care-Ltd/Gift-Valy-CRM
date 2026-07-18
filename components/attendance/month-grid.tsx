// Shared, hook-free display for a person's monthly attendance (R10). Usable from
// both server and client trees. Renders the roll-up counts and a calendar grid
// coloured by each day's status.
import { formatDateTime } from "@/lib/format";
import {
  DAY_CELL_CODES,
  DAY_CELL_LABELS,
  WEEKDAY_LABELS,
  type DayCellStatus,
} from "@/lib/attendance-constants";
import type { AttendanceCounts, DayCell } from "@/lib/attendance";

// Cell colours per status (light background + readable text), theme-safe.
const CELL_CLASS: Record<DayCellStatus, string> = {
  PRESENT: "bg-green-100 text-green-800 border-green-200",
  LATE: "bg-amber-100 text-amber-800 border-amber-200",
  HALF_DAY: "bg-sky-100 text-sky-800 border-sky-200",
  ABSENT: "bg-red-100 text-red-700 border-red-200",
  LEAVE: "bg-violet-100 text-violet-800 border-violet-200",
  OFF: "bg-muted text-muted-foreground border-transparent",
  NOT_MARKED: "border-dashed text-muted-foreground",
  UPCOMING: "text-muted-foreground/50 border-transparent",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3 text-center">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function MonthGrid({
  days,
  counts,
}: {
  days: DayCell[];
  counts: AttendanceCounts;
}) {
  const leadingBlanks = days.length > 0 ? days[0].weekday : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Present" value={counts.present} />
        <Stat label="Late" value={counts.late} />
        <Stat label="Half-day" value={counts.halfDay} />
        <Stat label="Absent" value={counts.absent} />
        <Stat label="On leave" value={counts.leave} />
        <Stat label="Work hours" value={counts.totalWorkHours} />
      </div>

      <div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map((d) => {
            const dayNum = Number(d.date.slice(8, 10));
            const title = [
              `${d.date} — ${DAY_CELL_LABELS[d.status]}`,
              d.shiftName ? `Shift: ${d.shiftName}` : null,
              d.checkInAt ? `In: ${formatDateTime(d.checkInAt)}` : null,
              d.checkOutAt ? `Out: ${formatDateTime(d.checkOutAt)}` : null,
              d.workedHours != null ? `${d.workedHours}h` : null,
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <div
                key={d.date}
                title={title}
                className={`flex aspect-square flex-col items-center justify-center rounded-md border text-xs ${CELL_CLASS[d.status]}`}
              >
                <span className="font-medium">{dayNum}</span>
                <span className="text-[10px] leading-none">
                  {DAY_CELL_CODES[d.status]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(
          ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "LEAVE", "OFF"] as DayCellStatus[]
        ).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span
              className={`inline-block h-3 w-3 rounded-sm border ${CELL_CLASS[s]}`}
            />
            {DAY_CELL_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
