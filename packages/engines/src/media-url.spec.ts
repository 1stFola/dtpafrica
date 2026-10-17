import { describe, it, expect } from "vitest";
import * as allure from "allure-js-commons";
import {
  parseGoogleDriveFileId,
  toGoogleDriveEmbedUrl,
  normalizeVideoMediaUrl,
  isYoutubeUrl,
  isGoogleDriveUrl,
  isAllowedVideoMediaUrl,
  isAllowedImageMediaUrl,
  videoEmbedUrl,
  youtubeVideoId,
} from "./media-url";

describe("Media URL Utilities", () => {
  describe("parseGoogleDriveFileId", () => {
    it("extracts file ID from a standard /file/d/ view URL", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");
      await allure.story("Google Drive parsing");
      await allure.description("Given a Drive share URL, the file ID is extracted correctly");

      const id = parseGoogleDriveFileId(
        "https://drive.google.com/file/d/1VXdakTFwAZls2XqVueRLEXVGWRlif9QI/view"
      );
      expect(id).toBe("1VXdakTFwAZls2XqVueRLEXVGWRlif9QI");
    });

    it("extracts file ID from a /preview URL", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");

      const id = parseGoogleDriveFileId(
        "https://drive.google.com/file/d/abc123/preview"
      );
      expect(id).toBe("abc123");
    });

    it("returns null for an empty string", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");

      expect(parseGoogleDriveFileId("")).toBeNull();
    });

    it("returns null for a non-Drive URL", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");

      expect(parseGoogleDriveFileId("https://youtube.com/watch?v=abc")).toBeNull();
    });
  });

  describe("toGoogleDriveEmbedUrl", () => {
    it("generates a /preview embed URL from a file ID", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");
      await allure.story("Google Drive embed URL generation");

      expect(toGoogleDriveEmbedUrl("abc123")).toBe(
        "https://drive.google.com/file/d/abc123/preview"
      );
    });
  });

  describe("normalizeVideoMediaUrl", () => {
    it("identifies a Google Drive URL and returns preview embed", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");
      await allure.story("URL normalisation");
      await allure.severity("critical");

      const info = normalizeVideoMediaUrl(
        "https://drive.google.com/file/d/abc123/view"
      );
      expect(info.mediaType).toBe("google_drive");
      expect(info.embedUrl).toBe("https://drive.google.com/file/d/abc123/preview");
    });

    it("identifies a YouTube watch URL", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");
      await allure.severity("critical");

      const info = normalizeVideoMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(info.mediaType).toBe("youtube");
      expect(info.embedUrl).toContain("dQw4w9WgXcQ");
    });

    it("identifies a YouTube short URL", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");

      const info = normalizeVideoMediaUrl("https://youtu.be/dQw4w9WgXcQ");
      expect(info.mediaType).toBe("youtube");
    });

    it("reads the video id behind a /live/ broadcast link so it embeds like a watch URL", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");

      const info = normalizeVideoMediaUrl("https://www.youtube.com/live/jfKfPfyJRdk?feature=share");
      expect(info.mediaType).toBe("youtube");
      expect(info.thumbnailUrl).toBe("https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg");
      expect(videoEmbedUrl("https://youtube.com/live/jfKfPfyJRdk", "youtube")).toBe(
        "https://www.youtube.com/embed/jfKfPfyJRdk"
      );
      expect(youtubeVideoId("https://m.youtube.com/watch?v=jfKfPfyJRdk")).toBe("jfKfPfyJRdk");
      expect(youtubeVideoId("https://youtu.be/jfKfPfyJRdk?t=12")).toBe("jfKfPfyJRdk");
    });

    it("classifies unknown video URLs as external", async () => {
      await allure.epic("Engines");
      await allure.feature("Media URL");

      const info = normalizeVideoMediaUrl("https://vimeo.com/12345678");
      expect(info.mediaType).toBe("external");
    });
  });

  describe("isYoutubeUrl", () => {
    it("returns true for youtube.com watch URL", () => {
      expect(isYoutubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    });

    it("returns true for youtu.be short URL", () => {
      expect(isYoutubeUrl("https://youtu.be/abc")).toBe(true);
    });

    it("returns true for a youtube.com/live broadcast link", () => {
      expect(isYoutubeUrl("https://www.youtube.com/live/abc123?si=share")).toBe(true);
    });

    it("returns false for Google Drive URL", () => {
      expect(isYoutubeUrl("https://drive.google.com/file/d/abc/view")).toBe(false);
    });
  });

  describe("isGoogleDriveUrl", () => {
    it("returns true for drive.google.com URL", () => {
      expect(isGoogleDriveUrl("https://drive.google.com/file/d/abc/view")).toBe(true);
    });

    it("returns false for YouTube URL", () => {
      expect(isGoogleDriveUrl("https://youtube.com/watch?v=abc")).toBe(false);
    });
  });

  describe("isAllowedVideoMediaUrl", () => {
    it("allows YouTube URLs", () => {
      expect(isAllowedVideoMediaUrl("https://youtube.com/watch?v=abc")).toBe(true);
    });

    it("allows Google Drive URLs", () => {
      expect(isAllowedVideoMediaUrl("https://drive.google.com/file/d/abc/view")).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isAllowedVideoMediaUrl("")).toBe(false);
    });
  });

  describe("isAllowedImageMediaUrl", () => {
    it("allows standard HTTP and HTTPS image URLs", () => {
      expect(isAllowedImageMediaUrl("https://example.com/photo.jpg")).toBe(true);
      expect(isAllowedImageMediaUrl("http://example.com/photo.jpg")).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isAllowedImageMediaUrl("")).toBe(false);
    });
  });
});
