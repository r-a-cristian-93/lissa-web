import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // base: "/lissa-web/", // 👈 THIS is the important line
  plugins: [react()],
});
