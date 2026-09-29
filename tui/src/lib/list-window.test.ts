import { describe, it, expect } from "vitest";
import { computeWindow, matchesQuery, windowLabel } from "./list-window.js";

const items = Array.from({ length: 10 }, (_v, i) => i);

describe("computeWindow", () => {
  it("shows everything when it fits", () => {
    expect(computeWindow(items, 9, 20)).toEqual({ visible: items, startIndex: 0 });
  });

  it("scrolls only once the selection passes the bottom edge, and never past the end", () => {
    expect(computeWindow(items, 3, 4).startIndex).toBe(0);
    expect(computeWindow(items, 5, 4)).toEqual({ visible: [2, 3, 4, 5], startIndex: 2 });
    expect(computeWindow(items, 99, 4)).toEqual({ visible: [6, 7, 8, 9], startIndex: 6 });
  });

  it("treats a zero or negative height as one row", () => {
    expect(computeWindow(items, 4, 0)).toEqual({ visible: [4], startIndex: 4 });
  });
});

describe("windowLabel and matchesQuery", () => {
  it("labels only lists that overflow", () => {
    expect(windowLabel(0, 10, 10)).toBe("");
    expect(windowLabel(10, 20, 52)).toBe("11–30 of 52");
  });

  it("matches case-insensitively, and an empty query matches all", () => {
    expect(matchesQuery("Design-Panel", "panel")).toBe(true);
    expect(matchesQuery("deslop", "  ")).toBe(true);
    expect(matchesQuery("deslop", "qc")).toBe(false);
  });
});
