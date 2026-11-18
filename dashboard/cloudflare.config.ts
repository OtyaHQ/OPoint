import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "opoint-dashboard-staging",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-18",
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      OTYA_ID: bindings.worker({ worker: "otya-id-staging" }),
      OPOINT_API: bindings.worker({ worker: "opoint-api-staging" }),
    },
  }),
});
