import { describe, it, expect } from "vitest";
import {
  computeLocktime,
  computeSequence,
  classifyLocktime,
  isRbfSignaling,
} from "../src/sequences";

describe("sequences.ts", () => {
  describe("Test 1: rbf:true → nSequence=0xFFFFFFFD, locktime=current_height", () => {
    it("should return nSequence 0xFFFFFFFD when rbf is true", () => {
      const rbf = true;
      const nLockTime = 850000; // Some block height

      const nSequence = computeSequence(rbf, nLockTime);

      expect(nSequence).toBe(0xfffffffd);
    });

    it("should return current_height as locktime when rbf is true and current_height provided", () => {
      const rbf = true;
      const explicitLocktime = undefined;
      const currentHeight = 850000;

      const locktime = computeLocktime(rbf, explicitLocktime, currentHeight);

      expect(locktime).toBe(850000);
    });

    it("should signal RBF when nSequence is 0xFFFFFFFD", () => {
      const nSequence = 0xfffffffd;

      const signaling = isRbfSignaling(nSequence);

      expect(signaling).toBe(true);
    });
  });

  describe("Test 2: rbf:false + locktime present → nSequence=0xFFFFFFFE", () => {
    it("should return nSequence 0xFFFFFFFE when rbf is false but locktime is non-zero", () => {
      const rbf = false;
      const nLockTime = 600000; // Non-zero locktime

      const nSequence = computeSequence(rbf, nLockTime);

      expect(nSequence).toBe(0xfffffffe);
    });

    it("should use explicit locktime when provided", () => {
      const rbf = false;
      const explicitLocktime = 600000;
      const currentHeight = undefined;

      const locktime = computeLocktime(rbf, explicitLocktime, currentHeight);

      expect(locktime).toBe(600000);
    });

    it("should NOT signal RBF when nSequence is 0xFFFFFFFE", () => {
      const nSequence = 0xfffffffe;

      const signaling = isRbfSignaling(nSequence);

      expect(signaling).toBe(false);
    });
  });

  describe("Test 3: locktime 499999999 → block_height, 500000000 → unix_timestamp", () => {
    it("should classify 499999999 as block_height", () => {
      const nLockTime = 499999999;

      const classification = classifyLocktime(nLockTime);

      expect(classification).toBe("block_height");
    });

    it("should classify 500000000 as unix_timestamp", () => {
      const nLockTime = 500000000;

      const classification = classifyLocktime(nLockTime);

      expect(classification).toBe("unix_timestamp");
    });

    it("should classify 0 as none", () => {
      const nLockTime = 0;

      const classification = classifyLocktime(nLockTime);

      expect(classification).toBe("none");
    });

    it("should classify block heights correctly", () => {
      expect(classifyLocktime(1)).toBe("block_height");
      expect(classifyLocktime(850000)).toBe("block_height");
      expect(classifyLocktime(499999998)).toBe("block_height");
    });

    it("should classify unix timestamps correctly", () => {
      expect(classifyLocktime(500000001)).toBe("unix_timestamp");
      expect(classifyLocktime(1704067200)).toBe("unix_timestamp"); // 2024-01-01 00:00:00 UTC
      expect(classifyLocktime(4294967295)).toBe("unix_timestamp"); // Max uint32
    });
  });

  describe("Additional edge cases", () => {
    it("should return 0xFFFFFFFF when rbf is false and locktime is 0", () => {
      const rbf = false;
      const nLockTime = 0;

      const nSequence = computeSequence(rbf, nLockTime);

      expect(nSequence).toBe(0xffffffff);
    });

    it("should return 0 locktime when rbf is false and no explicit locktime or current_height", () => {
      const rbf = false;
      const explicitLocktime = undefined;
      const currentHeight = undefined;

      const locktime = computeLocktime(rbf, explicitLocktime, currentHeight);

      expect(locktime).toBe(0);
    });

    it("should prioritize explicit locktime over current_height", () => {
      const rbf = true;
      const explicitLocktime = 700000;
      const currentHeight = 850000;

      const locktime = computeLocktime(rbf, explicitLocktime, currentHeight);

      expect(locktime).toBe(700000);
    });

    it("should return 0 locktime when rbf is true but no current_height provided", () => {
      const rbf = true;
      const explicitLocktime = undefined;
      const currentHeight = undefined;

      const locktime = computeLocktime(rbf, explicitLocktime, currentHeight);

      expect(locktime).toBe(0);
    });

    it("should signal RBF for any nSequence <= 0xFFFFFFFD", () => {
      expect(isRbfSignaling(0x00000000)).toBe(true);
      expect(isRbfSignaling(0xfffffffc)).toBe(true);
      expect(isRbfSignaling(0xfffffffd)).toBe(true);
      expect(isRbfSignaling(0xfffffffe)).toBe(false);
      expect(isRbfSignaling(0xffffffff)).toBe(false);
    });
  });
});
