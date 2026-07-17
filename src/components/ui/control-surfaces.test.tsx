import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Input } from "./input";
import { Textarea } from "./textarea";

describe("control surfaces", () => {
  it("keeps text inputs on the stable control surface", () => {
    const html = renderToStaticMarkup(<Input aria-label="Name" />);

    expect(html).toContain("bg-mate-control-bg");
    expect(html).toContain("control-surface");
    expect(html).not.toContain("bg-background/50");
    expect(html).not.toContain("dark:bg-input/10");
    expect(html).not.toContain("backdrop-blur");
  });

  it("keeps textareas on the stable control surface", () => {
    const html = renderToStaticMarkup(<Textarea aria-label="Description" />);

    expect(html).toContain("bg-mate-control-bg");
    expect(html).toContain("control-surface");
    expect(html).not.toContain("bg-background/50");
    expect(html).not.toContain("dark:bg-input/10");
    expect(html).not.toContain("backdrop-blur");
  });
});
