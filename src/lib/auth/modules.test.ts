import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_ROLES,
  MODULES,
  canAccessModule,
  moduleFloor,
  modulesForRole,
  type Module,
} from './modules'
import { ACCOUNT_ROLES, roleRank, type AccountRole } from './roles'

/**
 * The three profiles the operator assigns are Administrador (admin),
 * Gerente (manager) and Vendedor (agent). `owner` and `viewer` still
 * exist underneath: owner is whoever created the company, viewer is a
 * read-only seat.
 */
describe('role hierarchy', () => {
  it('ranks manager between agent and admin', () => {
    expect(roleRank('agent')).toBeLessThan(roleRank('manager'))
    expect(roleRank('manager')).toBeLessThan(roleRank('admin'))
  })

  it('gives every role a distinct rank', () => {
    const ranks = ACCOUNT_ROLES.map(roleRank)
    expect(new Set(ranks).size).toBe(ACCOUNT_ROLES.length)
  })

  it('mirrors the SQL CASE in is_account_member', () => {
    // Migration 053 hard-codes these numbers. If this drifts, RLS and the
    // UI disagree about who may do what — and only one of them is real.
    expect(roleRank('owner')).toBe(5)
    expect(roleRank('admin')).toBe(4)
    expect(roleRank('manager')).toBe(3)
    expect(roleRank('agent')).toBe(2)
    expect(roleRank('viewer')).toBe(1)
  })
})

describe('what a Vendedor may open', () => {
  const CAN: Module[] = ['dashboard', 'inbox', 'notifications', 'contacts', 'pipelines']
  const CANNOT: Module[] = [
    'broadcasts',
    'meta-approvals',
    'automations',
    'flows',
    'agents',
    'settings',
  ]

  it.each(CAN)('opens %s', (m) => {
    expect(canAccessModule('agent', m)).toBe(true)
  })

  it.each(CANNOT)('does not open %s', (m) => {
    expect(canAccessModule('agent', m)).toBe(false)
  })
})

describe('what a Gerente adds', () => {
  it('reaches customers in bulk and approves conversions', () => {
    // Both are irreversible in their own way: a broadcast cannot be
    // unsent, and an approved conversion cannot be withdrawn from Meta.
    expect(canAccessModule('manager', 'broadcasts')).toBe(true)
    expect(canAccessModule('manager', 'meta-approvals')).toBe(true)
  })

  it('still cannot reconfigure the system', () => {
    for (const m of ['automations', 'flows', 'agents', 'settings'] as Module[]) {
      expect(canAccessModule('manager', m), m).toBe(false)
    }
  })
})

describe('what an Administrador may open', () => {
  it('opens everything', () => {
    for (const m of MODULES) expect(canAccessModule('admin', m), m).toBe(true)
  })
})

describe('matrix invariants', () => {
  it('is monotonic — a higher role never loses access', () => {
    // The single property that keeps the matrix sane. A hand-kept grid of
    // booleans eventually grows "admin may not, but agent may"; a floor
    // per module cannot express that, and this proves it.
    for (const m of MODULES) {
      for (const lower of ACCOUNT_ROLES) {
        for (const higher of ACCOUNT_ROLES) {
          if (roleRank(higher) < roleRank(lower)) continue
          if (canAccessModule(lower, m)) {
            expect(canAccessModule(higher, m), `${higher} vs ${lower} on ${m}`).toBe(true)
          }
        }
      }
    }
  })

  it('gives every module a floor', () => {
    for (const m of MODULES) expect(ACCOUNT_ROLES).toContain(moduleFloor(m))
  })

  it('leaves no role locked out of the product', () => {
    for (const role of ACCOUNT_ROLES) {
      expect(modulesForRole(role as AccountRole).length, role).toBeGreaterThan(0)
    }
  })

  it('offers exactly the three profiles the operator assigns', () => {
    expect([...ASSIGNABLE_ROLES]).toEqual(['admin', 'manager', 'agent'])
  })

  it('never offers owner in the picker', () => {
    // Ownership transfers deliberately, not from a dropdown.
    expect(ASSIGNABLE_ROLES).not.toContain('owner')
  })
})
