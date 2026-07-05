import { useEffect, useState, type RefObject } from "react";

export function useResizeObserver(ref: RefObject<HTMLElement | null>) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          // use borderBoxSize if available for better accuracy when there's padding/border
          width: entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width,
          height: entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height,
        });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return dimensions;
}
