import { and, eq } from 'drizzle-orm';
import { readyDb } from '../db';
import { listCollaborators, readingLists, users } from '../db/schema';

/**
 * Reading-list collaboration, with a role.
 *
 * The share link that shipped first is not collaboration: it grants one
 * undifferentiated capability to whoever holds the URL, cannot be revoked per
 * person, and leaves no record of who shaped the list. This adds the thing that
 * makes a list social — named people, each with a role, revocable
 * individually.
 *
 * The role is binary on purpose. `editor` may add and remove items; `viewer`
 * may only read. The owner is always an editor and can never be demoted or
 * removed, because a list with no owner is a list nobody can fix.
 */
export type ListRole = 'editor' | 'viewer';

export interface Collaborator {
  handle: string;
  displayName: string;
  role: ListRole;
  isOwner: boolean;
}

/** The viewer's effective role on a list, or null if they have no access. */
export async function roleFor(
  listId: string,
  viewerUserId: string | null,
): Promise<ListRole | null> {
  if (!viewerUserId) return null;
  const database = await readyDb();
  const [row] = await database
    .select({ ownerId: readingLists.ownerId, role: listCollaborators.role })
    .from(readingLists)
    .leftJoin(
      listCollaborators,
      and(
        eq(listCollaborators.listId, readingLists.id),
        eq(listCollaborators.userId, viewerUserId),
      ),
    )
    .where(eq(readingLists.id, listId))
    .limit(1);
  if (!row) return null;
  if (row.ownerId === viewerUserId) return 'editor';
  return row.role ?? null;
}

/** Can this viewer add or remove items on the list? */
export async function canEdit(listId: string, viewerUserId: string | null): Promise<boolean> {
  return (await roleFor(listId, viewerUserId)) === 'editor';
}

/** A lighter existence check than `roleFor`, for access gates that only need
 *  "is this person attached to the list at all". */
export async function isListCollaborator(
  listId: string,
  viewerUserId: string,
): Promise<boolean> {
  const database = await readyDb();
  const [row] = await database
    .select({ userId: listCollaborators.userId })
    .from(listCollaborators)
    .where(and(eq(listCollaborators.listId, listId), eq(listCollaborators.userId, viewerUserId)))
    .limit(1);
  return row !== undefined;
}

async function isOwner(listId: string, userId: string): Promise<boolean> {
  const database = await readyDb();
  const [row] = await database
    .select({ ownerId: readingLists.ownerId })
    .from(readingLists)
    .where(eq(readingLists.id, listId))
    .limit(1);
  return row?.ownerId === userId;
}

export async function getCollaborators(listId: string): Promise<Collaborator[]> {
  const database = await readyDb();
  const [list] = await database
    .select({ ownerId: readingLists.ownerId })
    .from(readingLists)
    .where(eq(readingLists.id, listId))
    .limit(1);
  if (!list) return [];

  const out: Collaborator[] = [];
  // The owner first, as a full editor.
  const [owner] = await database
    .select({ handle: users.handle, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, list.ownerId))
    .limit(1);
  if (owner) {
    out.push({ handle: owner.handle, displayName: owner.displayName, role: 'editor', isOwner: true });
  }

  const rows = await database
    .select({
      handle: users.handle,
      displayName: users.displayName,
      role: listCollaborators.role,
    })
    .from(listCollaborators)
    .innerJoin(users, eq(listCollaborators.userId, users.id))
    .where(eq(listCollaborators.listId, listId));
  for (const r of rows) {
    out.push({ handle: r.handle, displayName: r.displayName, role: r.role as ListRole, isOwner: false });
  }
  return out;
}

export async function addCollaborator(
  listId: string,
  ownerId: string,
  handle: string,
  role: ListRole,
): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  const database = await readyDb();
  const [list] = await database
    .select({ ownerId: readingLists.ownerId })
    .from(readingLists)
    .where(and(eq(readingLists.id, listId), eq(readingLists.ownerId, ownerId)))
    .limit(1);
  if (!list) return { ok: false, error: 'That list is not yours.' };
  const [target] = await database
    .select({ id: users.id, handle: users.handle })
    .from(users)
    .where(eq(users.handle, handle.trim().toLowerCase()))
    .limit(1);
  if (!target) return { ok: false, error: `No account with the handle @${handle}.` };
  if (target.id === ownerId) return { ok: false, error: 'You already own this list.' };
  await database
    .insert(listCollaborators)
    .values({ listId, userId: target.id, role, addedById: ownerId })
    .onConflictDoUpdate({
      target: [listCollaborators.listId, listCollaborators.userId],
      set: { role },
    });
  return { ok: true, handle: target.handle };
}

export async function removeCollaborator(
  listId: string,
  ownerId: string,
  handle: string,
): Promise<boolean> {
  const database = await readyDb();
  if (!(await isOwner(listId, ownerId))) return false;
  const [target] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.handle, handle.trim().toLowerCase()))
    .limit(1);
  if (!target || target.id === ownerId) return false; // never remove the owner
  const result = await database
    .delete(listCollaborators)
    .where(and(eq(listCollaborators.listId, listId), eq(listCollaborators.userId, target.id)));
  return (result.rowsAffected ?? 0) > 0;
}
