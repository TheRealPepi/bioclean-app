import { expect, test } from "vitest";
import { memberFrom, upgradeCachedMe } from "./me";

const COMPANY = {
  _id: "company1",
  name: "Bioclean Green Cozumel",
  timeZone: "America/Cancun",
  phoneCountryCode: "52",
  serviceArea: null,
};

/** What `users.me` answers for a driver. */
const DRIVER = {
  _id: "user1",
  name: "Chofer Uno",
  email: "chofer@example.com",
  image: null,
  role: "driver",
  memberRole: "driver",
  can: ["deliver"],
  company: COMPANY,
  canCreateCompany: false,
};

/** The test's plain objects, as the query's result (whose ids are branded strings). */
const result = (value: unknown) => value as Parameters<typeof memberFrom>[0];

test("someone is a member only with a role and a company", () => {
  expect(memberFrom(result(DRIVER))).toEqual({
    _id: "user1",
    name: "Chofer Uno",
    email: "chofer@example.com",
    image: null,
    memberRole: "driver",
    can: ["deliver"],
    company: COMPANY,
  });
  expect(memberFrom(result({ ...DRIVER, memberRole: null, company: null, can: [] }))).toBeNull();
  expect(memberFrom(null)).toBeNull();
  expect(memberFrom(undefined)).toBeNull();
});

test("a profile stored on the phone opens the app without signal", () => {
  expect(upgradeCachedMe(DRIVER)).toMatchObject({ memberRole: "driver", company: COMPANY });
});

test("a profile stored before companies existed still opens the driver's app", () => {
  // All that older versions of the app stored.
  const old = { _id: "user1", name: "Chofer Uno", email: "chofer@example.com", image: null, role: "driver" };
  expect(upgradeCachedMe(old)).toEqual({
    _id: "user1",
    name: "Chofer Uno",
    email: "chofer@example.com",
    image: null,
    memberRole: "driver",
    can: ["deliver"],
    // The only company there was, in its zone; its name comes with the next connection.
    company: { _id: "", name: "", timeZone: "America/Cancun", phoneCountryCode: "52", serviceArea: null },
  });
  // The same profile from the version in between, stored before its company was set up.
  expect(upgradeCachedMe({ ...old, memberRole: null, can: [], company: null })).toMatchObject({
    memberRole: "driver",
    company: { timeZone: "America/Cancun" },
  });
});

test("anything else on the phone is not a profile", () => {
  expect(upgradeCachedMe(undefined)).toBeNull();
  expect(upgradeCachedMe("driver")).toBeNull();
  expect(upgradeCachedMe({ name: "Chofer Uno", role: "driver" })).toBeNull();
  // The office never works without signal.
  expect(upgradeCachedMe({ _id: "user2", name: "Oficina", role: "admin" })).toBeNull();
});
