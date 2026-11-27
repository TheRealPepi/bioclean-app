import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every hour, because each company gets its reminders in the morning of its
// own time zone (see `reminders.tick`).
crons.hourly("recordatorios de pago", { minuteUTC: 0 }, internal.reminders.tick, {});

// 08:00 UTC: night in the Americas.
crons.daily(
  "borrar rutas vencidas",
  { hourUTC: 8, minuteUTC: 0 },
  internal.routes.purgeExpired,
  {},
);

export default crons;
