import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LambdaComputeProvider } from "./lambda-compute-provider";
import {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  loadLambdaConfig,
  loadRunPodConfig,
  ProviderTimeoutError,
} from "./provider-config";
import { RunPodComputeProvider } from "./runpod-compute-provider";

/**
 * A provider API that accepts the connection and then goes quiet, on a real socket, with
 * the real `fetch`: the failure a timeout exists for. `/silent/*` never sends headers;
 * `/stall/*` sends headers and half a body, then nothing.
 */
describe("provider calls give up at their deadline", () => {
  let server: Server;
  let base: string;
  const open: ServerResponse[] = [];
  const seen: string[] = [];
  const launches = () => seen.filter((line) => line.endsWith("/instance-operations/launch")).length;

  beforeAll(async () => {
    server = createServer((req, res) => {
      open.push(res);
      seen.push(`${req.method} ${req.url}`);
      if (req.url?.startsWith("/stall/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"id":');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const res of open) res.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const TIMEOUT = 150;
  const LAUNCH = {
    image: "registry.example/img:1",
    resourceClass: "gpu_24gb",
    env: {},
    maxRuntimeSeconds: 60,
    maxCostUsdCents: 10,
    idleShutdownSeconds: 60,
  };
  const env = { VISION_PROVIDER_REQUEST_TIMEOUT_MS: String(TIMEOUT) };

  const providers = (path: string) => [
    new RunPodComputeProvider({
      ...loadRunPodConfig({ ...env, VISION_RUNPOD_API_KEY: "k" }),
      baseUrl: `${base}${path}`,
    }),
    new LambdaComputeProvider({
      ...loadLambdaConfig({
        ...env,
        VISION_LAMBDA_API_KEY: "k",
        VISION_LAMBDA_REGION: "us-east-1",
        VISION_LAMBDA_SSH_KEY_NAMES: "dtp",
        // Two types: a timed-out launch must not go on to try the second.
        VISION_LAMBDA_TYPES_24GB: "gpu_1x_a10,gpu_1x_a6000",
      }),
      baseUrl: `${base}${path}`,
    }),
  ];

  it("reads the deadline from the environment, thirty seconds by default", () => {
    expect(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(loadRunPodConfig({}).requestTimeoutMs).toBe(30_000);
    expect(loadLambdaConfig({}).requestTimeoutMs).toBe(30_000);
    expect(loadRunPodConfig({ VISION_PROVIDER_REQUEST_TIMEOUT_MS: "5000" }).requestTimeoutMs).toBe(5000);
    // Empty or nonsense is unset, not zero: a zero deadline would fail every call.
    expect(loadLambdaConfig({ VISION_PROVIDER_REQUEST_TIMEOUT_MS: "" }).requestTimeoutMs).toBe(30_000);
    expect(loadLambdaConfig({ VISION_PROVIDER_REQUEST_TIMEOUT_MS: "0" }).requestTimeoutMs).toBe(30_000);
  });

  for (const path of ["/silent", "/stall"]) {
    // status() reports any failed lookup as "unknown" (never "stopped"), so the proof that
    // the deadline fired is that it comes back at all, and on time.
    it(`a ${path.slice(1)} provider's status call returns "unknown" at the deadline, not never`, async () => {
      for (const provider of providers(path)) {
        const started = Date.now();
        await expect(provider.status("ref-1"), provider.id).resolves.toBe("unknown");
        const took = Date.now() - started;
        expect(took, provider.id).toBeGreaterThanOrEqual(TIMEOUT - 20);
        expect(took, provider.id).toBeLessThan(TIMEOUT + 2_000);
      }
    });

    it(`a ${path.slice(1)} provider's launch fails with ProviderTimeoutError`, async () => {
      for (const provider of providers(path)) {
        const error = await provider.launch(LAUNCH as never).then(
          () => null,
          (e: unknown) => e
        );
        expect(error, provider.id).toBeInstanceOf(ProviderTimeoutError);
        expect((error as ProviderTimeoutError).timeoutMs).toBe(TIMEOUT);
      }
    });
  }

  it("Lambda stops at a timed-out launch instead of trying the next instance type", async () => {
    const before = launches();
    const lambda = providers("/silent")[1]!;
    await expect(lambda.launch(LAUNCH as never)).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(launches() - before).toBe(1);
  });

  it("terminate, which the idle reaper calls, is bounded too", async () => {
    for (const provider of providers("/silent")) {
      await expect(provider.terminate("ref-1"), provider.id).rejects.toBeInstanceOf(ProviderTimeoutError);
    }
  });
});
