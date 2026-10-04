import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getIdentity } from '../../lib/repo/auth';
import { parseImportFile, IMPORT_LIMITS } from '../../lib/import/parse';
import { humanIssues } from '../../lib/validation';
import { importPost } from '../../lib/import/service';

/**
 * Import an archive.
 *
 * Only the signed-in author may import. This is not a light restriction: an
 * import creates posts under somebody else's byline, and a stranger who could
 * reach this would be publishing as you. Unauthenticated callers get the same
 * 401 as an empty editor, and the check happens before any parsing so a large
 * body cannot be used to make the server work for free.
 *
 * Files arrive as JSON rather than as a multipart upload because the browser can
 * read them with `File.text()` and the payload stays inspectable — one request,
 * no temp files, and the exact bytes that were parsed are the ones in the body.
 */
const fileSchema = z.object({
  filename: z.string().min(1).max(240),
  content: z.string().max(IMPORT_LIMITS.maxBytesPerPost),
});

const bodySchema = z.object({
  files: z.array(fileSchema).min(1).max(25),
  /** Import as a draft even when the source had a publish date. */
  asDraft: z.boolean().optional(),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = await getIdentity(cookies);
  if (!identity.userId) {
    return json({ error: 'Claim a handle before importing an archive.' }, 401);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'That was not JSON.' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return json({ error: humanIssues(parsed.error) }, 400);
  }

  const results = [];
  for (const file of parsed.data.files) {
    const { posts, warnings } = parseImportFile(file.filename, file.content);

    /* Parsing warnings belong to the file, not to a post, and a multi-post
       format is exactly where they get lost: Hashnode's Export.csv is one file
       holding two hundred posts, and a row with no content is skipped with a
       warning that used to go nowhere. The writer saw "imported 199" and had no
       way to learn which post was missing or that anything was. So the file's
       warnings ride along with every row it produced. */
    const fileWarnings = warnings.filter((w) => typeof w === 'string');

    if (posts.length === 0) {
      results.push({
        filename: file.filename,
        imported: false,
        title: '',
        slug: '',
        reason: fileWarnings[0] ?? 'Nothing readable in this file.',
        warnings: fileWarnings,
        inferred: [],
      });
      continue;
    }
    for (const post of posts) {
      const outcome = await importPost(
        parsed.data.asDraft ? { ...post, publishedAt: undefined } : post,
        identity.userId,
        file.filename,
      );
      results.push({
        ...outcome,
        draft: Boolean(parsed.data.asDraft),
        warnings: [...fileWarnings, ...(outcome.warnings ?? [])],
        url: outcome.imported ? `/w/${outcome.slug}` : undefined,
      });
    }
  }

  const imported = results.filter((r) => r.imported).length;
  return json({
    batch: results.length,
    imported,
    failed: results.length - imported,
    results,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = ({ redirect }) => redirect('/write#import', 303);