# 69 — A screen for the audit trail

The Vision engine has written an audit row for every rights change, every read of raw
footage, every identity and every promotion since Phase 1, and nothing in the admin app
could show one. Answering "who read this footage" meant a database query. This adds the
route that reads the trail and the screen that shows it.

---

## Who may read it

A new permission, **`vision.audit.read`**. `vision.read` does not open the trail.

The trail names people: who read raw youth footage, who put a name to a player, who
promoted a model, each with their email. Every annotator holds `vision.read`. They should
not be able to browse what their colleagues did.

| Role | Holds it |
|---|---|
| `super_admin` | yes |
| `vision_admin` | yes, by default |
| every other role, `read_only` included | no |

The operator key passes every permission check, as it does everywhere.

**On a database that already has roles, the seed does not hand it out.** `seed:rbac`
adds the permission to the catalogue and tops up `super_admin`. It leaves every other
existing role exactly as an admin left it, on purpose, so that grants made in the UI
survive. `vision_admin` on live therefore gets it by hand: Settings, Roles. A fresh
database (CI) creates `vision_admin` with it.

## The route

`GET /vision/audit`, newest first.

| Query | Meaning |
|---|---|
| `action` | one action (`media.raw.read`), or a family ending in a dot (`identity.`) |
| `targetKind`, `targetId` | what was acted on |
| `actor` | an admin id matched whole, or any part of an email, whatever its case |
| `method` | `jwt`, `api_key`, `provision_key`, or `none` for a row with no actor |
| `from`, `to` | ISO 8601 moments, both inclusive |
| `limit` | 1 to 200, default 50 |
| `cursor` | the `nextCursor` of the page before |

The answer is `{ items, nextCursor }`. The first page also carries `matching`, the count
of rows the filters match, and `facets`: every action the code writes, the target kinds
on the trail, and the methods. A later page is a continuation and counts nothing again.

Paging is by cursor, not by offset: the next page starts after the last row of this one,
so rows written while somebody reads do not shift the pages under them. Rows are ordered
by time and then by id, so two rows written in one millisecond keep one order.

A filter the route cannot read is refused, `400 AuditFilterInvalid` with the field's
name. It is never dropped: a dropped filter would show somebody every row and let them
believe they were looking at a few.

The route only reads. There is no route that edits or removes a row, and reading the
trail writes nothing to it.

## The screen

`/admin/vision/audit`, "Audit trail" in the Vision sidebar, shown only to someone who
holds the permission. Anyone else who opens the address is sent back to the overview.

- **Filters**: action (grouped by family, with "every identity action" and the like),
  who, how they signed in, kind of thing, its id, and a day at each end.
- **The filters are the address.** A filtered trail can be bookmarked or sent to someone.
- **Days are the reader's own.** A picked day is turned into its first and last moment in
  the browser's time zone; picking one day at both ends shows that whole day.
- **Who** is said in words. Three of the four answers are not a person, and the screen
  says so: "the operator key", "the worker on the box", "the system". An empty cell would
  read as a gap.
- **Its trail**: beside each target, one click shows every row about that thing.
- **Details** opens the row's data and its full ids.
- **Show older** fetches the next page from where the last ended.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,557 passed (was 1,541); typecheck clean |
| Web suite | 225 passed (12 new); typecheck clean; the build succeeds |
| Mutation runner | 34 of 34 killed: the permission, the order, the cursor, the count, every filter's rule, the day boundaries, and how an actor is put into words |
| `vision:identitycheck` | 84 of 84, twice. Fourteen new checks against a running API and the real database: a reviewer is refused and so is nobody; a Vision admin reads the reviewer's rows by id and by email; a family and a single action; pages of two walk every row once in order; a time filter; a bad filter refused by name; reading writes nothing |
| `vision:trackcheck` | 71 of 71 |
| The whole dev trail through the route | 1,624 rows in nine pages: every row once, newest first, the count equal to the rows walked |
| In the browser, as a Vision admin | the page loads with its filters filled from the API; a filtered address shows the filtered rows and the menus show the filter; details open and close; "its trail" narrows to one target; clear returns to everything; "Show older" adds the next fifty; a day filter asks the API for that local day; a bad filter in the address shows the API's reason |
| In the browser, as an annotator | no "Audit trail" in the sidebar; the address redirects to the overview; the API answers 403 |
| Scratch people and rows | removed; the litter check reports nothing |

Two things were not seen. A screenshot could not be taken, because the app's window was
hidden while the checks ran, so the layout was checked through the page's text and
structure and not by eye. Phone width was not exercised for the same reason; the table
sits in the same scrolling wrapper as every other Vision table.

## What is not done

| Item | Why |
|---|---|
| **An export** | A CSV of a filtered trail is what a data-subject request or a partner dispute would want. Not asked for yet. |
| **Search inside `data` and `reason`** | The filters cover the indexed columns. Free text over JSON wants its own index. |
| **Names for targets** | A row shows a kind and an id. Showing the footage's title or the player's name means a lookup per kind. Two kinds link to their page; "its trail" covers the rest. |
| **Gate rows on a developer's trail** | Done since, in [70](./70-GATE-AUDIT-LITTER.md). As listed: the dev database's trail holds rows gates wrote about things they have since removed (model versions, jobs). The gates clean up by a list of ids that misses some kinds. It does not affect live, where no gate runs, but the screen makes it visible. |
| **Reading the trail is not itself audited** | Who looked at the trail is not recorded. |

## After merge

1. Run the seed on live so the permission exists and `super_admin` holds it:
   `sudo docker exec dtp-staging-api-1 pnpm --filter @dtp/api seed:rbac`.
2. To let the Vision admin role see the screen, grant `vision.audit.read` to it in
   Settings, Roles. Until then only a super admin sees "Audit trail".

No migration. Nothing else to configure.
