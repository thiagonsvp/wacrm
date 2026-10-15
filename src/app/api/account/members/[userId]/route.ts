// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migration 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

type MemberCtx = Awaited<ReturnType<typeof requireRole>>;

/**
 * For a target who is a member of the caller's company but currently has
 * ANOTHER company open, return their membership here. `null` means the
 * target has this company open (the 018 RPCs handle that case); a target
 * with no membership here at all is "not_member".
 */
async function membershipElsewhere(
  ctx: MemberCtx,
  userId: string,
): Promise<{ role: string } | null | "not_member"> {
  const { data: membership } = await ctx.supabase
    .from("account_members")
    .select("role")
    .eq("account_id", ctx.accountId)
    .eq("user_id", userId)
    .maybeSingle();
  // The target's profile is outside the caller's RLS scope when they are
  // working elsewhere; only its account_id is read.
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.account_id === ctx.accountId) return null;
  if (!membership) return "not_member";
  return { role: membership.role as string };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isAccountRole(role)) {
      return NextResponse.json(
        { error: "'role' must be one of owner, admin, manager, agent, viewer" },
        { status: 400 },
      );
    }

    // The RPC blocks promotion to / demotion from owner, but
    // surface the friendlier 400 before crossing the wire too.
    if (role === "owner") {
      return NextResponse.json(
        {
          error:
            "Use POST /api/account/transfer-ownership to promote a member to owner",
        },
        { status: 400 },
      );
    }

    // Member of this company but working in another one right now: the
    // RPC only sees the company a person has open, so it refused them.
    // Their role HERE is the membership row; switch_account applies it
    // the next time they open this company.
    const away = await membershipElsewhere(ctx, userId);
    if (away === "not_member") {
      return NextResponse.json(
        { error: "Target user is not a member of your account" },
        { status: 403 },
      );
    }
    if (away) {
      if (userId === ctx.userId) {
        return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
      }
      if (away.role === "owner") {
        return NextResponse.json(
          { error: "Use transfer_account_ownership to demote an owner" },
          { status: 400 },
        );
      }
      // RLS: account_members is writable only by this company's admins.
      const { error } = await ctx.supabase
        .from("account_members")
        .update({ role })
        .eq("account_id", ctx.accountId)
        .eq("user_id", userId);
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true });
    }

    const { error } = await ctx.supabase.rpc("set_member_role", {
      p_user_id: userId,
      p_new_role: role,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    // Working in another company right now: removing them from THIS one
    // is just dropping the membership; their other companies and their
    // open session are untouched.
    const away = await membershipElsewhere(ctx, userId);
    if (away === "not_member") {
      return NextResponse.json(
        { error: "Target user is not a member of your account" },
        { status: 403 },
      );
    }
    if (away) {
      if (userId === ctx.userId || away.role === "owner") {
        return NextResponse.json(
          { error: "Cannot remove the owner or yourself" },
          { status: 400 },
        );
      }
      const { error } = await ctx.supabase
        .from("account_members")
        .delete()
        .eq("account_id", ctx.accountId)
        .eq("user_id", userId);
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true, newPersonalAccountId: null });
    }

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
