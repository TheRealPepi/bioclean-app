import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 14:00 UTC = 9:00 a.m. in Cozumel (UTC-5 all year).
crons.daily(
  "recordatorios de pago",
  { hourUTC: 14, minuteUTC: 0 },
  internal.reminders.run,
  {},
);

// 08:00 UTC = 3:00 a.m. in Cozumel.
crons.daily(
  "borrar rutas vencidas",
  { hourUTC: 8, minuteUTC: 0 },
  internal.routes.purgeExpired,
  {},
);

export default crons;
