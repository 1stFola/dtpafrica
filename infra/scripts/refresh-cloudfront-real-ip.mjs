#!/usr/bin/env node
/**
 * Rewrites the CloudFront block of `set_real_ip_from` lines in infra/nginx.staging.conf.
 *
 * nginx takes the visitor's address from X-Forwarded-For only when the connection comes from
 * an address listed there. Listing everything (0.0.0.0/0) let anyone reaching the box directly
 * write their own X-Forwarded-For and appear to be someone else, which defeats per-IP rate
 * limits. So the list is CloudFront's origin-facing ranges, as AWS publishes them.
 *
 * AWS changes those ranges now and then. Run this to refresh them, then commit the result:
 *
 *   node infra/scripts/refresh-cloudfront-real-ip.mjs            # fetches ip-ranges.json
 *   node infra/scripts/refresh-cloudfront-real-ip.mjs ranges.json # or reads a saved copy
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://ip-ranges.amazonaws.com/ip-ranges.json";
const CONF = join(dirname(fileURLToPath(import.meta.url)), "..", "nginx.staging.conf");
const BEGIN = "# BEGIN cloudfront-origin-facing";
const END = "# END cloudfront-origin-facing";

const raw = process.argv[2] ? readFileSync(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
const ranges = JSON.parse(raw);

const pick = (list, field) =>
  list.filter((p) => p.service === "CLOUDFRONT_ORIGIN_FACING").map((p) => p[field]);
const v4 = [...new Set(pick(ranges.prefixes, "ip_prefix"))].sort();
const v6 = [...new Set(pick(ranges.ipv6_prefixes, "ipv6_prefix"))].sort();
if (v4.length === 0) throw new Error("No CLOUDFRONT_ORIGIN_FACING ranges found; refusing to empty the list.");

const conf = readFileSync(CONF, "utf8");
const eol = conf.includes("\r\n") ? "\r\n" : "\n";
const start = conf.indexOf(BEGIN);
const stop = conf.indexOf(END);
if (start < 0 || stop < start) throw new Error(`Markers not found in ${CONF}`);

const indent = conf.slice(conf.lastIndexOf("\n", start) + 1, start);
const lines = [
  BEGIN,
  `# ${SOURCE} createDate ${ranges.createDate}`,
  ...[...v4, ...v6].map((cidr) => `set_real_ip_from ${cidr};`),
].map((line, i) => (i === 0 ? line : indent + line));

writeFileSync(CONF, conf.slice(0, start) + lines.join(eol) + eol + indent + conf.slice(stop));
console.log(`Wrote ${v4.length} IPv4 and ${v6.length} IPv6 CloudFront ranges to ${CONF}`);
