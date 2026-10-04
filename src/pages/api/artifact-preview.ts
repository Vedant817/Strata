/**
 * Server-rendered artifact preview, for the authoring form only.
 *
 * The builder in `ArtifactBuilder.astro` shows a writer what they are making
 * before they publish it. That preview has to be the *same* renderer the article
 * uses, or it is a lie: a second drawing path would drift, and the drift would
 * only show up after publication, on the page that matters.
 *
 * So this endpoint runs `Artifact.astro` through Astro's container API and
 * returns its HTML. No chart runtime reaches the browser — the figure arrives as
 * markup, exactly as it will arrive in the article.
 *
 * Not in the reading path, and nothing a reader depends on: it renders whatever
 * fields are posted, bounded by the same coercion a save applies, and returns an
 * empty figure rather than an error when those fields do not make a figure.
 */
import { experimental_AstroContainer } from 'astro/container';
import type { APIRoute } from 'astro';
import Artifact from '../../components/Artifact.astro';
import { ARTIFACT_KINDS, formToProps, type ArtifactKind } from '../../lib/artifact-props';
import { escapeHtml } from '../../lib/inline';

/** Whatever `create()` resolves to, without naming the private constructor. */
type Container = Awaited<ReturnType<typeof experimental_AstroContainer.create>>;

let container: Container | null = null;

/** Held between calls: building a container per request is pure overhead. */
async function getContainer(): Promise<Container> {
  if (!container) container = await experimental_AstroContainer.create();
  return container;
}

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response('Expected JSON.', { status: 400 });
  }

  const body = (raw ?? {}) as { component?: unknown; title?: unknown; fields?: unknown };
  const component = typeof body.component === 'string' ? body.component.slice(0, 20) : 'curve';
  const kind = (ARTIFACT_KINDS as readonly string[]).includes(component)
    ? (component as ArtifactKind)
    : 'curve';
  const title = typeof body.title === 'string' ? body.title.slice(0, 300) : '';
  /* The same call a save makes, on the same cell values, so the preview is what
     publishing will produce rather than a hopeful approximation of it. */
  const fields =
    body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
      ? (body.fields as Record<string, string>)
      : {};

  try {
    const html = await (await getContainer()).renderToString(Artifact, {
      props: { component: kind, title, props: formToProps(kind, fields) },
    });
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (err) {
    /* A figure that cannot be drawn is a writer's problem to see, not a 500 that
       loses the draft they were editing.

       Escaped, because this endpoint is anonymous and the message is built from
       whatever the caller sent. Today `formToProps` cannot throw — every numeric
       field is `Number(x) || 0` behind a clamp — so this arm is unreachable and
       the escaping is for the day that stops being true. An error path is exactly
       where nobody re-reads the interpolation. */
    const reason = escapeHtml(String((err as Error).message).slice(0, 160));
    return new Response(
      `<p class="meta">This figure cannot be drawn yet: ${reason}</p>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
};