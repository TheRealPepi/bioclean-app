import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Role } from "../../convex/lib/access";

type MeResult = NonNullable<FunctionReturnType<typeof api.users.me>>;

/** The signed-in user once we know they have access. */
export type Me = Omit<MeResult, "role"> & { role: Role };
