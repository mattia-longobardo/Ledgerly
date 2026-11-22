import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { getDb } from "@ledgerly/domain/platform/db";
import { type Mail, sendMail } from "@ledgerly/domain/platform/mail";
import { mailAllowed } from "@ledgerly/domain/platform/settings";
import type { MailCategory } from "@ledgerly/domain/platform/settings";
import type { Ctx } from "@ledgerly/domain/platform/context";
import type { NotificationEvent } from "@ledgerly/api-contract";
import {
  channelsOf,
  deleteOldFacts,
  type Fact,
  notificationsLog,
  raise,
  resolve,
} from "@ledgerly/domain/platform/notifications";

interface Notification {
  userId: string;
  kind: string;
  /** What the notification is about — an account id, a document id — unique within its kind. */
  key: string;
  cooldownHours: number;
  mail: Mail;
  /**
   * The switch in Admin › Server that governs this whole class of mail, when one does. A category
   * that is switched off is not sent *and not recorded*: the log is what stops a repeat, and a
   * message that never left must not stop the one that follows the switch being turned back on.
   */
  category?: MailCategory;
}

/**
 * Sends a notification unless the same one went out inside its cooldown.
 *
 * Claiming the slot is a single conditional upsert, so two jobs racing on the same condition
 * cannot both send: only the statement that actually wrote a row gets one back. The email is sent
 * afterwards, outside any transaction (spec §4.3), and a failure to deliver is logged rather than
 * thrown — a job must not stop because an SMTP server is down.
 */
async function notifyOnce(notification: Notification, now: Date = new Date()): Promise<boolean> {
  if (notification.category && !(await mailAllowed(notification.category))) return false;
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

/**
 * Tells the person about a fact (R5e): it opens in the app — once, however often it is raised — and
 * its email goes as `notifyOnce` sends it, when the person keeps the email of the event on. Nothing
 * at all for an event of an addon that is off. Returns whether an email left.
 */
export async function notify(
  ctx: Pick<Ctx, "userId" | "addons">,
  fact: Fact,
  mail: Omit<Notification, "userId">,
  now: Date = new Date(),
): Promise<boolean> {
  if (!(await raise(ctx, fact, now))) return false;
  if (!(await channelsOf(ctx, fact.event)).email) return false;
  return notifyOnce({ ...mail, userId: ctx.userId }, now);
}

/**
 * The fact is over: it leaves the app, and its email is forgotten so the next occurrence is told at
 * once (`clearNotification`). `kind` and `key` are the email's, which may name the fact differently.
 */
export async function settle(
  ctx: Pick<Ctx, "userId">,
  fact: { event: NotificationEvent; subject: string },
  mail: { kind: string; key: string },
  now: Date = new Date(),
): Promise<void> {
  await resolve(ctx, fact.event, { subject: fact.subject }, now);
  await clearNotification(ctx.userId, mail.kind, mail.key);
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

/**
 * Drops the log rows and the facts older than the retention window, so neither table can grow
 * without bound.
 */
export async function deleteOldNotifications(cutoff: Date): Promise<number> {
  const rows = await getDb()
    .delete(notificationsLog)
    .where(lt(notificationsLog.sentAt, cutoff))
    .returning({ id: notificationsLog.id });
  return rows.length + (await deleteOldFacts(cutoff));
}
