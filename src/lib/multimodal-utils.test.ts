import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, it } from "vitest";
import { getContentString } from "@/components/thread/utils";
import {
  MAX_TOTAL_BYTES,
  attachmentBytes,
  fileToContentBlock,
  isAttachmentBlock,
  isMarkdownAttachmentBlock,
  markdownAttachmentBlock,
  readMarkdownAttachment,
  validateAttachment,
} from "./multimodal-utils";

function file(name: string, text: string, type = "") {
  return new File([text], name, { type });
}

describe("which files the composer takes", () => {
  it("takes .md files, whatever type the browser gives them", () => {
    expect(validateAttachment(file("notes.md", "# Notes"))).toBeNull();
    expect(
      validateAttachment(file("NOTES.MD", "# Notes", "text/markdown")),
    ).toBeNull();
    expect(
      validateAttachment(file("notes.md", "# Notes", "text/x-markdown")),
    ).toBeNull();
  });

  it("turns away anything else, including images and PDFs", () => {
    for (const [name, type] of [
      ["screenshot.png", "image/png"],
      ["runbook.pdf", "application/pdf"],
      ["notes.txt", "text/plain"],
      ["notes.markdown", "text/markdown"],
      ["notes.md.exe", ""],
    ]) {
      expect(validateAttachment(file(name, "x", type))).toBe(
        `${name}: only Markdown (.md) files are supported.`,
      );
    }
  });

  it("turns away an empty file and one over the limit", () => {
    expect(validateAttachment(file("empty.md", ""))).toBe("empty.md is empty.");
    expect(
      validateAttachment(file("big.md", "a".repeat(MAX_TOTAL_BYTES + 1))),
    ).toMatch(/^big\.md is .*; the limit is 500 KB\.$/);
  });
});

describe("a Markdown file inside a message", () => {
  it("goes as a tagged text block carrying the file's name and text", async () => {
    const block = await fileToContentBlock(
      file('Say "hi" & go.md', "# Runbook\n\nStep one."),
    );

    expect(block.type).toBe("text");
    expect(isMarkdownAttachmentBlock(block)).toBe(true);
    expect(isAttachmentBlock(block)).toBe(true);
    expect(readMarkdownAttachment(block)).toEqual({
      filename: 'Say "hi" & go.md',
      text: "# Runbook\n\nStep one.",
    });
    expect(attachmentBytes(block)).toBe("# Runbook\n\nStep one.".length);
  });

  it("is not mistaken for the person's own words", () => {
    expect(isMarkdownAttachmentBlock({ type: "text", text: "# Hi" })).toBe(
      false,
    );
    const content = [
      { type: "text", text: "Summarise the runbook" },
      markdownAttachmentBlock("runbook.md", "# Runbook\n\nStep one."),
    ] as Message["content"];
    expect(getContentString(content)).toBe("Summarise the runbook");
  });

  it("still recognises images and PDFs from older threads", () => {
    expect(
      isAttachmentBlock({
        type: "file",
        base64: "JVBERi0",
        mime_type: "application/pdf",
        extras: { filename: "runbook.pdf" },
      }),
    ).toBe(true);
  });
});
