import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeVideoMediaUrl,
  parseGoogleDriveFileId,
  toGoogleDriveEmbedUrl,
} from "./media-url";

test("parseGoogleDriveFileId from view URL", () => {
  const id = parseGoogleDriveFileId(
    "https://drive.google.com/file/d/1VXdakTFwAZls2XqVueRLEXVGWRlif9QI/view"
  );
  assert.equal(id, "1VXdakTFwAZls2XqVueRLEXVGWRlif9QI");
});

test("toGoogleDriveEmbedUrl", () => {
  assert.equal(
    toGoogleDriveEmbedUrl("abc123"),
    "https://drive.google.com/file/d/abc123/preview"
  );
});

test("normalizeVideoMediaUrl stores preview embed", () => {
  const info = normalizeVideoMediaUrl(
    "https://drive.google.com/file/d/abc123/view"
  );
  assert.equal(info.mediaType, "google_drive");
  assert.equal(info.embedUrl, "https://drive.google.com/file/d/abc123/preview");
});
