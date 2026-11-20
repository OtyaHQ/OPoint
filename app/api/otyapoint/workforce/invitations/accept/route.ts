import { proxyOpointRequest } from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return proxyOpointRequest(request, "/v1/staff/invitations/accept", {
    requireSameOrigin: true,
    maxBodyBytes: 4_096,
  });
}
