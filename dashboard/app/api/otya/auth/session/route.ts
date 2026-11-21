import { cookies } from "next/headers";
import {
  clearSessionCookies,
  fetchOtyaMe,
  jsonResponse,
  loadBrowserSession,
} from "@/lib/otya";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const jar = await cookies();
  const result = await loadBrowserSession(jar);

  if (result.kind === "anonymous") {
    clearSessionCookies(jar);
    return jsonResponse({ authenticated: false });
  }
  if (result.kind === "unavailable") {
    return jsonResponse({ error: "identity_service_unavailable" }, 503);
  }

  try {
    const memberships = await fetchOtyaMe(result.session.accessToken);
    return jsonResponse({
      authenticated: true,
      identity: result.session.identity,
      memberships: memberships.memberships,
      pendingMemberships: memberships.pendingMemberships,
    });
  } catch {
    return jsonResponse({ error: "opoint_membership_service_unavailable" }, 503);
  }
}
