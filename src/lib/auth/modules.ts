// ============================================================
// Which modules each profile may open.
//
// One fixed matrix for every company, by decision: a single rule the
// operator can explain to a client without opening the code, and no
// per-tenant drift to debug later. Any exception is a change here.
//
// IMPORTANT — this file decides what a role may DO, never which rows it
// may SEE. Every member of a company sees all of that company's contacts
// and deals; that is enforced by RLS, not by this matrix, and changing
// one does not change the other.
//
// EQUALLY IMPORTANT — hiding a menu item is not access control. The nav
// reads this matrix so people are not shown doors they cannot open, but
// the real gate is `requireModule()` on the server. A hidden route is
// still reachable by typing the URL or calling the API directly.
// ============================================================

import { type AccountRole, roleRank } from "./roles";

/** Every gated area of the product. Mirrors the sidebar and settings rail. */
export const MODULES = [
  "dashboard",
  "performance",
  "inbox",
  "notifications",
  "contacts",
  "pipelines",
  "broadcasts",
  "automations",
  "flows",
  "agents",
  "settings",
  // Inside Settings, gated separately because it releases ad spend.
  "meta-approvals",
] as const;

export type Module = (typeof MODULES)[number];

/**
 * Minimum role required to open each module.
 *
 * The shape is deliberately "one floor per module" rather than a grid of
 * booleans: roles are already a hierarchy, so a floor cannot express the
 * contradiction "an admin may not, but an agent may" — which is the bug a
 * hand-maintained grid eventually grows.
 */
const MODULE_FLOOR: Record<Module, AccountRole> = {
  // --- Everyone who works the floor ---
  dashboard: "viewer",
  performance: "viewer",
  inbox: "viewer",
  notifications: "viewer",
  contacts: "viewer",
  pipelines: "viewer",

  // --- Manager and up: reaches customers in bulk, or releases money ---
  // A broadcast goes to hundreds of people at once and cannot be recalled.
  broadcasts: "manager",
  // Approving a conversion tells Meta to spend against that outcome.
  "meta-approvals": "manager",

  // --- Admin and up: changes how the system behaves for everyone ---
  automations: "admin",
  flows: "admin",
  agents: "admin",
  settings: "admin",
};

/** True when this role may open the module. */
export function canAccessModule(role: AccountRole, module: Module): boolean {
  return roleRank(role) >= roleRank(MODULE_FLOOR[module]);
}

/** The modules this role may open, in MODULES order. */
export function modulesForRole(role: AccountRole): Module[] {
  return MODULES.filter((m) => canAccessModule(role, m));
}

/** The floor for a module — for rendering the matrix in Settings. */
export function moduleFloor(module: Module): AccountRole {
  return MODULE_FLOOR[module];
}

/**
 * The three profiles an operator assigns day to day.
 *
 * `owner` and `viewer` still exist and still work — owner is the person
 * who created the company, viewer is a read-only seat — but they are not
 * offered in the picker, because a list of five is how people end up
 * choosing the wrong one.
 */
export const ASSIGNABLE_ROLES: readonly AccountRole[] = [
  "admin",
  "manager",
  "agent",
] as const;
