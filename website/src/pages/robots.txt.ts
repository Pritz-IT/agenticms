import type { APIRoute } from "astro";
import { getConfig } from "../lib/config";
import { buildRobotsTxt } from "../lib/routes";

export const GET: APIRoute = () => {
  return new Response(buildRobotsTxt(getConfig().settings?.siteUrl), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
