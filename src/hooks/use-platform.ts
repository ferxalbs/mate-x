import { useState, useEffect } from "react";

export type Platform = "mac" | "windows" | "linux" | "unknown";

export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("mac os x") || userAgent.includes("macintosh")) {
      setPlatform("mac");
    } else if (userAgent.includes("windows") || userAgent.includes("win32")) {
      setPlatform("windows");
    } else if (userAgent.includes("linux")) {
      setPlatform("linux");
    }
  }, []);

  return platform;
}
