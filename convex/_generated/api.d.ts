/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as clients from "../clients.js";
import type * as crons from "../crons.js";
import type * as deliveries from "../deliveries.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_due from "../lib/due.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_text from "../lib/text.js";
import type * as reminders from "../reminders.js";
import type * as users from "../users.js";
import type * as vehicles from "../vehicles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  clients: typeof clients;
  crons: typeof crons;
  deliveries: typeof deliveries;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/dates": typeof lib_dates;
  "lib/due": typeof lib_due;
  "lib/geo": typeof lib_geo;
  "lib/text": typeof lib_text;
  reminders: typeof reminders;
  users: typeof users;
  vehicles: typeof vehicles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
