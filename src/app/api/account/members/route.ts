// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Who belongs to this company lives in account_members; profiles only
    // says which company each person has OPEN right now. Listing from
    // profiles dropped anyone currently working in another company (a
    // manager of two stores vanished from one roster), so the roster is
    // built from memberships, with the role held in THIS company.
    const { data: memberships, error: memErr } = await ctx.supabase
      .from("account_members")
      .select("user_id, role, created_at")
      .eq("account_id", ctx.accountId);
    if (memErr) {
      console.error("[GET /api/account/members] membership fetch error:", memErr);
      return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
    }

    // People with this company open but no membership row (a super admin
    // visiting) still show, as before.
    const { data: active, error } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, created_at")
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
    }

    // A member working in another company has a profile the caller cannot
    // read under RLS; the ids come from the RLS-checked membership query
    // above, so reading just those profiles with the service role is safe.
    const activeIds = new Set((active as ProfileRow[]).map((p) => p.user_id));
    const elsewhere = (memberships ?? [])
      .map((m) => m.user_id as string)
      .filter((id) => !activeIds.has(id));
    let away: ProfileRow[] = [];
    if (elsewhere.length) {
      const { data: awayRows } = await supabaseAdmin()
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, account_role, created_at")
        .in("user_id", elsewhere);
      away = (awayRows ?? []) as ProfileRow[];
    }

    const roleHere = new Map((memberships ?? []).map((m) => [m.user_id as string, m]));
    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = [...(active as ProfileRow[]), ...away]
      .flatMap((row) => {
        const membership = roleHere.get(row.user_id);
        const role = membership?.role ?? row.account_role;
        // Defensive: skip a role TS does not know rather than crash the page.
        if (!isAccountRole(role)) return [];
        return [
          {
            user_id: row.user_id,
            full_name: row.full_name ?? "",
            email: canSeeEmails ? row.email : null,
            avatar_url: row.avatar_url,
            role,
            joined_at: (membership?.created_at as string | undefined) ?? row.created_at,
          },
        ];
      })
      .sort((x, y) => x.joined_at.localeCompare(y.joined_at));

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
