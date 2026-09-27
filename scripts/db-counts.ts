/** Count the rows the privacy promise covers. Used to verify the erase works. */
import { count, eq } from 'drizzle-orm';
import { readyDb } from '../src/lib/db';
import { annotations, readEvents, readReceipts } from '../src/lib/db/schema';

const database = await readyDb();
const anon = process.argv[2];

const events = await database.select({ n: count() }).from(readEvents);
const receipts = await database.select({ n: count() }).from(readReceipts);
const notes = await database.select({ n: count() }).from(annotations);

console.log(
  JSON.stringify({
    readEvents: events[0]?.n,
    readReceipts: receipts[0]?.n,
    annotations: notes[0]?.n,
    myAnnotations: anon
      ? (
          await database
            .select({ n: count() })
            .from(annotations)
            .where(eq(annotations.anonId, anon))
        )[0]?.n
      : undefined,
  }),
);
process.exit(0);
