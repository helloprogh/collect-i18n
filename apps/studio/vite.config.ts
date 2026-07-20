import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [vue()],
    server: {
      host: "127.0.0.1",
      port: 4174,
      proxy: env.COLLECT_I18N_SERVICE_URL ? { "/api": env.COLLECT_I18N_SERVICE_URL } : undefined,
    },
  };
});
