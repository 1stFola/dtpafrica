/**
 * A stand-in for a gate, for `gate-harness.spec.ts`: it registers a cleanup, is
 * interrupted, and says on stdout what happened. Run as its own process, because
 * the thing under test ends the process.
 *
 *   tsx gate-harness.interrupt-fixture.ts ok      cleanup succeeds
 *   tsx gate-harness.interrupt-fixture.ts throws  cleanup fails
 */
import { onInterrupt } from "./gate-harness";

const mode = process.argv[2];
let fixture: string | null = null;

onInterrupt(async () => {
  // What a gate's cleanup does: reads the fixture as it stands when the signal comes.
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (mode === "throws") throw new Error("the database went away");
  console.log(`cleaned:${fixture}`);
});

fixture = "created-after-registering";
console.log("running");
// The gate is in the middle of its work; the signal arrives.
setTimeout(() => process.emit("SIGINT"), 10);
// Work that would otherwise keep going, and must not be reached.
setTimeout(() => {
  console.log("finished-normally");
  process.exit(0);
}, 2000);
