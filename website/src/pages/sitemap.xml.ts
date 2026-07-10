import type { APIRoute } from "astro";
import { getConfig, getDefaultLocale } from "../lib/config";
import { buildSitemapUrls, buildSitemapXml } from "../lib/routes";

export const GET: APIRoute = () => {
  const urls = buildSitemapUrls(getConfig(), getDefaultLocale());
  return new Response(buildSitemapXml(urls), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
