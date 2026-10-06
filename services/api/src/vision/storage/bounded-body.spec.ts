import { describe, expect, it } from "vitest";
import { readBoundedBody } from "./bounded-body";
import { SmallObjectTooLargeError } from "./object-store";
import { InMemoryObjectStore } from "./in-memory-object-store";
describe("bounded small object reads", () => {
  it("accumulates chunks through the exact limit", async () => {
    async function* body() { yield Buffer.from("ab"); yield Buffer.from("cd"); }
    expect((await readBoundedBody(body(), 4)).toString()).toBe("abcd");
  });
  it("stops and closes a stream before accumulating more than the byte limit", async () => {
    let closed = false, reachedTail = false;
    async function* body() { try { yield Buffer.from("abc"); yield Buffer.from("de"); reachedTail = true; yield Buffer.from("tail"); } finally { closed = true; } }
    await expect(readBoundedBody(body(), 4)).rejects.toBeInstanceOf(SmallObjectTooLargeError);
    expect(closed).toBe(true); expect(reachedTail).toBe(false);
  });
  it("applies the same limit to in-memory storage while preserving existing unbounded callers", async () => {
    const store = new InMemoryObjectStore();
    await store.putSmallObject("derived", "small.json", "12345", "application/json");
    await expect(store.getSmallObject("derived", "small.json", 4)).rejects.toBeInstanceOf(SmallObjectTooLargeError);
    expect((await store.getSmallObject("derived", "small.json"))?.toString()).toBe("12345");
  });
});
