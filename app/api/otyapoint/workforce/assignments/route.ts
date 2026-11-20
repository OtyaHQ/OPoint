import { proxyOpointRequest } from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return proxyOpointRequest(request, "/v1/staff/work-assignments");
}

export async function POST(request: Request): Promise<Response> {
  return proxyOpointRequest(request, "/v1/staff/work-assignments", {
    requireSameOrigin: true,
    maxBodyBytes: 8_192,
  });
}
