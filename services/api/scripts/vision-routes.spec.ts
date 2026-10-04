import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BEGIN, DOC_PATH, END, renderTable, routesIn, routesNamedIn, scanRoutes, shape, withTable } from "./vision-routes";

// A checkout on Windows may have CRLF; the table is compared as text.
const doc = readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
const routes = scanRoutes();

describe("reading routes from a controller", () => {
  const source = `
@Controller("vision/things")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class ThingsController {
  @Get()
  @RequirePermissions("vision.read")
  async list() {
    return [];
  }

  /** One of them. */
  @Get(":id")
  @RequirePermissions("vision.read")
  async one(@Param("id") id: string) {
    return id;
  }

  @Post(":id/close")
  @RequirePermissions("vision.review")
  async close(
    @Param("id") id: string,
    @Body() dto: CloseDto
  ) {
    return id;
  }
}

@Controller("vision/worker")
export class WorkerController {
  @Post("register")
  @UseGuards(VisionWorkerBootstrapGuard)
  async register() {}

  @UseGuards(VisionWorkerGuard)
  @Post("jobs/claim")
  async claim() {}
}
`;
  it("joins the class's prefix to the method's path, and takes the permission beside it", () => {
    expect(routesIn(source, "things.controller.ts")).toEqual([
      { method: "GET", path: "/vision/things", access: "vision.read", file: "things.controller.ts" },
      { method: "GET", path: "/vision/things/:id", access: "vision.read", file: "things.controller.ts" },
      { method: "POST", path: "/vision/things/:id/close", access: "vision.review", file: "things.controller.ts" },
      // A guard of its own, written below the verb or above it.
      { method: "POST", path: "/vision/worker/register", access: "bootstrap token", file: "things.controller.ts" },
      { method: "POST", path: "/vision/worker/jobs/claim", access: "worker token", file: "things.controller.ts" },
    ]);
  });

  it("reads a file with Windows line endings the same way", () => {
    // It gave every route the permission of the one before it.
    expect(routesIn(source.replace(/\n/g, "\r\n"), "things.controller.ts")).toEqual(routesIn(source, "things.controller.ts"));
  });

  it("does not hand one method the permission of the next", () => {
    const out = routesIn(`@Controller("vision")\nexport class C {\n  @Get("open")\n  async open() {}\n\n  @Get("shut")\n  @RequirePermissions("vision.read")\n  async shut() {}\n}\n`, "c.ts");
    expect(out.map((r) => `${r.path}:${r.access}`)).toEqual(["/vision/open:", "/vision/shut:vision.read"]);
  });
});

describe("the Vision routes", () => {
  it("are all found", () => {
    // A scan that silently finds nothing would make every check below pass.
    expect(routes.length).toBeGreaterThan(100);
    expect(new Set(routes.map((r) => `${r.method} ${r.path}`)).size).toBe(routes.length);
  });

  it("each say who may call them: a permission, or a token of their own", () => {
    const open = routes.filter((r) => !r.access);
    expect(open.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    // The token-guarded surfaces are the worker's and the partner upload's, and nothing else.
    for (const r of routes.filter((x) => !x.access.startsWith("vision."))) expect(r.path, r.path).toMatch(/^\/vision\/(worker|partner-uploads)(\/|$)/);
  });
});

describe("docs/vision/07-API-CONTRACTS.md", () => {
  it("carries the table of every route as built, exactly as the controllers have it", () => {
    expect(doc).toContain(BEGIN);
    expect(doc).toContain(END);
    // If this fails: pnpm --filter @dtp/api vision:routes --write
    expect(withTable(doc, renderTable(routes))).toBe(doc);
  });

  it("names no route in its hand-written tables that the code does not have, unless it says the route is not built", () => {
    const built = new Set(routes.map((r) => `${r.method} ${shape(r.path)}`));
    const handWritten = routesNamedIn(doc.slice(0, doc.indexOf(BEGIN)));
    expect(handWritten.length).toBeGreaterThan(60);
    const wrong = handWritten.filter((r) => !built.has(`${r.method} ${shape(r.path)}`) && !/not built/i.test(r.text));
    expect(wrong.map((r) => `07:${r.line} ${r.method} ${r.path}`)).toEqual([]);
  });

  it("does not call a route unbuilt that the code has", () => {
    const built = new Set(routes.map((r) => `${r.method} ${shape(r.path)}`));
    const stale = routesNamedIn(doc.slice(0, doc.indexOf(BEGIN))).filter((r) => /not built/i.test(r.text) && built.has(`${r.method} ${shape(r.path)}`));
    expect(stale.map((r) => `07:${r.line} ${r.method} ${r.path}`)).toEqual([]);
  });
});
