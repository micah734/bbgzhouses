import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

type HostingConfig = {
  project_id: string;
  d1?: string;
  r2?: string;
};

const hosting = hostingConfig as HostingConfig;

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: hosting.d1 ? [{ binding: hosting.d1, database_name: "housedeck", database_id: "00000000-0000-4000-8000-000000000000" }] : [],
          r2_buckets: hosting.r2 ? [{ binding: hosting.r2, bucket_name: "housedeck" }] : [],
        },
      }),
    ],
  };
});
