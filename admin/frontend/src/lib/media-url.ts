import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRaw, ApiError } from "../api/client";
import { DEFAULT_SITE_KEY } from "../site-routing";
import { showBlogError } from "./blog-error";

// The caller owns the returned object URL and must revoke it when finished.
export async function fetchMediaObjectUrl(siteKey: string, src: string): Promise<string> {
  if (!src.startsWith("/media/")) return src;
  const response = await apiRaw(`/api/sites/${encodeURIComponent(siteKey)}/blog${src}`);
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return URL.createObjectURL(await response.blob());
}

export function useAuthedMediaUrl(src: string, explicitSiteKey?: string): string | undefined {
  const params = useParams();
  const siteKey = explicitSiteKey ?? params.siteKey ?? DEFAULT_SITE_KEY;
  const [resolved, setResolved] = useState<{ siteKey: string; src: string; url: string }>();

  useEffect(() => {
    if (!src.startsWith("/media/")) return;
    let disposed = false;
    let objectUrl: string | undefined;
    fetchMediaObjectUrl(siteKey, src).then((url) => {
      if (disposed) URL.revokeObjectURL(url);
      else {
        objectUrl = url;
        setResolved({ siteKey, src, url });
      }
    }).catch((error) => {
      showBlogError("load post image", error);
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [siteKey, src]);

  if (!src.startsWith("/media/")) return src;
  return resolved?.siteKey === siteKey && resolved.src === src ? resolved.url : undefined;
}
