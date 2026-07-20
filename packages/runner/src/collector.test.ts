import { describe, expect, it } from "vitest";
import { captureLabelPosition } from "./collector.js";

describe("captureLabelPosition", () => {
  const viewport = { width: 1440, height: 900 };
  const label = { width: 260, height: 25 };

  it("keeps labels fully inside the right edge", () => {
    expect(captureLabelPosition({
      viewport,
      target: { x: 1360, y: 100, width: 60, height: 24 },
      label,
    })).toEqual({ left: 1176, top: 71 });
  });

  it("keeps labels inside the left edge", () => {
    expect(captureLabelPosition({
      viewport,
      target: { x: 0, y: 100, width: 60, height: 24 },
      label,
    })).toEqual({ left: 4, top: 71 });
  });

  it("places a top-edge label below its target", () => {
    expect(captureLabelPosition({
      viewport,
      target: { x: 300, y: 2, width: 120, height: 24 },
      label,
    })).toEqual({ left: 296, top: 30 });
  });

  it("clamps a below-target label to the bottom edge", () => {
    expect(captureLabelPosition({
      viewport,
      target: { x: 300, y: 3, width: 120, height: 890 },
      label,
    })).toEqual({ left: 296, top: 871 });
  });
});
