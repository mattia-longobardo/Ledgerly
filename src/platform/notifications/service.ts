import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { redactForLog } from "@/platform/auth/logger";
import { getDb } from "@/platform/db/client";
import { type Mail, sendMail } from "@/platform/mail";
import { notificationsLog } from "./schema";

export interface Notification {
  userId: string;
  kind: string;
  /** What the notification is about — an account id, a document id — unique within its kind. */
  key: string;
  cooldownHours: number;
  mail: Mail;
}

/**
 * Sends a notification unless the same one went out inside its cooldown.
 *
 * Claiming the slot is a single conditional upsert, so two jobs racing on the same condition
 * cannot both send: only the statement that actually wrote a row gets one back. The email is sent
 * afterwards, outside any transaction (spec §4.3), and a failure to deliver is logged rather than
 * thrown — a job must not stop because an SMTP server is down.
 */
export async function notifyOnce(notification: Notification, now: Date = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - notification.cooldownHours * 3_600_000);
  const claimed = await getDb()
    .insert(notificationsLog)
    .values({
      userId: notification.userId,
      kind: notification.kind,
      key: notification.key,
      sentAt: now,
    })
    .onConflictDoUpdate({
      target: [notificationsLog.userId, notificationsLog.kind, notificationsLog.key],
      set: { sentAt: now },
      setWhere: lt(notificationsLog.sentAt, cutoff),
    })
    .returning({ id: notificationsLog.id });
  if (claimed.length === 0) return false;

  try {
    await sendMail(notification.mail);
    return true;
  } catch (error) {
    console.error("[notifications] delivery failed", redactForLog(error));
    return false;
  }
}

/** Forgets a resolved condition, so the next occurrence notifies again immediately. */
export async function clearNotification(userId: string, kind: string, key: string): Promise<void> {
  await getDb()
    .delete(notificationsLog)
    .where(
      and(
        eq(notificationsLog.userId, userId),
        eq(notificationsLog.kind, kind),
        eq(notificationsLog.key, key),
      ),
    );
}

/** Drops log rows older than the retention window, so the table cannot grow without bound. */
export async function deleteOldNotifications(cutoff: Date): Promise<number> {
  const rows = await getDb()
    .delete(notificationsLog)
    .where(lt(notificationsLog.sentAt, cutoff))
    .returning({ id: notificationsLog.id });
  return rows.length;
}
