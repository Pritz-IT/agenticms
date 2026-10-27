import type { APIRoute } from "astro";
import { getConfig } from "../lib/config";
import { buildRobotsTxt } from "../lib/routes";

export const GET: APIRoute = () => {
  const config = getConfig();
  return new Response(buildRobotsTxt(config.settings?.siteUrl, config.buildTarget), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
