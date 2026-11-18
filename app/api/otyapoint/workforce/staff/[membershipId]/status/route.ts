import { proxyOpointRequest } from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ membershipId: string }> },
): Promise<Response> {
  const { membershipId } = await context.params;
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(membershipId)) {
    return new Response(JSON.stringify({ error: "invalid_staff_membership_id" }), {
      status: 400,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return proxyOpointRequest(
    request,
    `/v1/staff/${encodeURIComponent(membershipId)}/status`,
    { requireSameOrigin: true, maxBodyBytes: 4_096 },
  );
}
