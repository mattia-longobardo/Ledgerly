import { describe, expect, it } from "vitest";

describe("ensureBucket", () => {
  it("rethrows the original HeadBucket failure instead of masking it with a CreateBucket error", async () => {
    const originalAccessKeyId = process.env.S3_ACCESS_KEY_ID;
    const originalSecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    process.env.S3_ACCESS_KEY_ID = "wrong-access-key-id";
    process.env.S3_SECRET_ACCESS_KEY = "wrong-secret-access-key";

    try {
      // Fresh module instance: `readEnv()` and the cached `S3Client` must pick up the bad
      // credentials above rather than ones already cached by another test file.
      const { ensureBucket } = await import("./storage");

      let error: unknown;
      try {
        await ensureBucket();
      } catch (caught) {
        error = caught;
      }

      // With wrong credentials, HeadBucket fails with a 403 (not the 404 that means "create it").
      // The old code swallowed that error unconditionally and replaced it with whatever
      // CreateBucket then failed with ("InvalidAccessKeyId") — a confusing secondary error that
      // hides the real cause. The fix must let the original HeadBucket failure propagate.
      expect((error as { name?: string } | undefined)?.name).not.toBe("InvalidAccessKeyId");
      expect(
        (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode,
      ).toBe(403);
    } finally {
      process.env.S3_ACCESS_KEY_ID = originalAccessKeyId;
      process.env.S3_SECRET_ACCESS_KEY = originalSecretAccessKey;
    }
  });
});
