import { proxyOpointRequest } from "@/lib/server/otya-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return proxyOpointRequest(request, "/v1/branches");
}
