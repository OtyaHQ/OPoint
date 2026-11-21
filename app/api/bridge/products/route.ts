import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deliberately disabled until the dashboard has a trusted Otya Auth session
 * exchange. The former bridge minted a local HS256 JWT that Otya Auth does
 * not issue or verify. Never forward a locally minted identity token to the
 * Cloudflare API or treat legacy Supabase staff identity as Otya Auth identity.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "cloudflare_bridge_identity_contract_unverified",
      message: "The products bridge is disabled until dashboard sessions use Otya Auth and the verified identity is mapped to an active Opoint staff membership.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "300",
      },
    },
  );
}
