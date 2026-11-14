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

export default crons;
