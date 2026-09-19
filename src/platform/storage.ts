import "server-only";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
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

/** The object's key in the bucket: the app's key under the environment's prefix, if any. */
function objectKey(key: string): string {
  return `${readEnv().S3_KEY_PREFIX ?? ""}${assertStorageKey(key)}`;
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
      Key: objectKey(key),
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: objectKey(key) }),
    );
    return result.Body ? await result.Body.transformToByteArray() : null;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: objectKey(key) }));
}

/**
 * Deletes every object under a folder of the app's (`payslips/<userId>/`): what a removed user
 * leaves behind. The folder must be a valid key followed by `/`, so nothing wider can be named.
 */
export async function deleteFolder(folder: string): Promise<number> {
  if (!folder.endsWith("/")) throw new RangeError("A folder ends with /");
  const Prefix = objectKey(folder.slice(0, -1)) + "/";
  const Bucket = readEnv().S3_BUCKET;
  let deleted = 0;
  let ContinuationToken: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
    if (keys.length > 0) {
      await s3().send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return deleted;
}
