import { describe, it, expect } from "vitest";
import { computeWarnings, type ComputeWarningsParams } from "../src/warnings";

describe("warnings.ts", () => {
  it("HIGH_FEE fires when fee_rate > 200", () => {
    const params: ComputeWarningsParams = {
      feeSats: 10_000,
      feeRateSatVb: 201,
      changeAmount: 1000,
      rbfSignaling: false,
    };

    const warnings = computeWarnings(params);

    expect(warnings).toContainEqual({ code: "HIGH_FEE" });
  });

  it("RBF_SIGNALING fires iff rbfSignaling is true", () => {
    const params: ComputeWarningsParams = {
      feeSats: 1000,
      feeRateSatVb: 5,
      changeAmount: 1000,
      rbfSignaling: true,
    };

    const warnings = computeWarnings(params);

    expect(warnings).toContainEqual({ code: "RBF_SIGNALING" });
  });
});
