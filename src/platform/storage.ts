import "server-only";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readEnv } from "./env";
import { assertStorageKey } from "./storage-keys";

let client: S3Client | undefined;

function s3(): S3Client {
  const env = readEnv();
  client ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // S3-compatible stores (Silo, MinIO) mishandle the SDK's default CRC32 checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

/** Creates the bucket if it does not already exist. Call once at startup, never inside a transaction. */
export async function ensureBucket(): Promise<void> {
  const Bucket = readEnv().S3_BUCKET;
  try {
    await s3().send(new HeadBucketCommand({ Bucket }));
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
    await s3().send(new CreateBucketCommand({ Bucket }));
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: readEnv().S3_BUCKET,
      Key: assertStorageKey(key),
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: assertStorageKey(key) }),
    );
    return result.Body ? await result.Body.transformToByteArray() : null;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: assertStorageKey(key) }));
}
