import { proxyOpointRequest } from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return proxyOpointRequest(request, "/v1/staff/invitations");
}

export async function POST(request: Request): Promise<Response> {
  return proxyOpointRequest(request, "/v1/staff/invitations", {
    requireSameOrigin: true,
    maxBodyBytes: 8_192,
  });
}
