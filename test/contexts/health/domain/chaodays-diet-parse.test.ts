import { describe, expect, it } from "vitest";
import { parseGlucoseReadings, stripGlucoseText } from "../../../../src/contexts/health/domain/chaodays-diet-parse";

describe("parseGlucoseReadings", () => {
  it("parses a pre-meal reading", () => {
    expect(parseGlucoseReadings("前血糖：93", "08:00")).toEqual([
      { label: "餐前", value: 93, mealContext: "pre_meal", time: "08:00" },
    ]);
  });

  it("parses a post-meal reading without an hour marker", () => {
    expect(parseGlucoseReadings("後血糖：70", "08:00")).toEqual([
      { label: "餐後", value: 70, mealContext: "post_meal", time: "08:00" },
    ]);
  });

  it("parses multiple post-meal readings with hour markers on the same text", () => {
    expect(parseGlucoseReadings("前血糖：93\n後血糖(1hr)：140\n後血糖(2hr)：102", "08:00")).toEqual([
      { label: "餐前", value: 93, mealContext: "pre_meal", time: "08:00" },
      { label: "餐後1hr", value: 140, mealContext: "post_meal", time: "08:00" },
      { label: "餐後2hr", value: 102, mealContext: "post_meal", time: "08:00" },
    ]);
  });

  it("parses a fasting reading", () => {
    expect(parseGlucoseReadings("空腹血糖：88", "07:00")).toEqual([
      { label: "空腹", value: 88, mealContext: "fasting", time: "07:00" },
    ]);
  });

  it("parses fasting text without the 血糖 word", () => {
    expect(parseGlucoseReadings("空腹：88", "07:00")).toEqual([
      { label: "空腹", value: 88, mealContext: "fasting", time: "07:00" },
    ]);
  });

  it("extracts glucose readings mixed with food text", () => {
    expect(parseGlucoseReadings("一根香蕉\n前血糖：70\n後血糖(2hr)：102", "12:30")).toEqual([
      { label: "餐前", value: 70, mealContext: "pre_meal", time: "12:30" },
      { label: "餐後2hr", value: 102, mealContext: "post_meal", time: "12:30" },
    ]);
  });

  it("skips a value-less glucose marker", () => {
    expect(parseGlucoseReadings("後血糖：", "08:00")).toEqual([]);
  });

  it("returns no readings for pure food text", () => {
    expect(parseGlucoseReadings("20克豌豆片", "12:30")).toEqual([]);
  });

  it("accepts a half-width colon", () => {
    expect(parseGlucoseReadings("前血糖:93", "08:00")).toEqual([
      { label: "餐前", value: 93, mealContext: "pre_meal", time: "08:00" },
    ]);
  });
});

describe("stripGlucoseText", () => {
  it("returns empty for glucose-only text", () => {
    expect(stripGlucoseText("前血糖：93\n後血糖(1hr)：70")).toBe("");
  });

  it("removes the glucose lines and keeps the food description", () => {
    expect(stripGlucoseText("一根香蕉\n前血糖：70\n後血糖(2hr)：102")).toBe("一根香蕉");
  });

  it("leaves pure food text unchanged", () => {
    expect(stripGlucoseText("20克豌豆片")).toBe("20克豌豆片");
  });
});
