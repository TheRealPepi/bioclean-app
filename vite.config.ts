import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev:https` serves over HTTPS on the local network so drivers' phones
// can use the camera and GPS while testing (browsers require a secure context).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
}));
