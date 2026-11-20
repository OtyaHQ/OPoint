declare module "cloudflare:workers" {
  export const env: {
    OTYA_ID?: { fetch(request: Request): Promise<Response> };
    OPOINT_API?: { fetch(request: Request): Promise<Response> };
  };
}
