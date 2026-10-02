import { beforeEach, describe, expect, it, vi } from "vitest";

// Team mode: a cover path written on a teammate's machine must resolve
// against THIS machine's workspace root.

let workspace: string | null = null;

vi.mock("../lib/storage", () => ({
  getCachedWorkspacePath: () => workspace,
}));
vi.mock("../lib/invokeWrapper", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `http://asset.localhost/${encodeURIComponent(p)}`,
}));

import { imgSrc, remapWorkspaceAsset } from "../lib/images";

describe("remapWorkspaceAsset", () => {
  beforeEach(() => { workspace = null; });

  it("leaves paths alone when no shared workspace is set", () => {
    const p = "C:\\Users\\ali\\Drive\\HeraVex\\library\\game-1\\assets\\images\\c.png";
    expect(remapWorkspaceAsset(p)).toBe(p);
  });

  it("re-anchors a teammate's Windows cover path onto the local root", () => {
    workspace = "G:\\My Drive\\HeraVex";
    const p = "C:\\Users\\ali\\Google Drive\\HeraVex\\library\\my-game-ab12\\assets\\images\\ab12_1.png";
    expect(remapWorkspaceAsset(p)).toBe("G:\\My Drive\\HeraVex\\library\\my-game-ab12\\assets\\images\\ab12_1.png");
  });

  it("re-anchors a macOS path onto a Windows root", () => {
    workspace = "D:\\Team";
    const p = "/Users/veli/Library/CloudStorage/GoogleDrive/HeraVex/library/g-1/assets/images/x.jpg";
    expect(remapWorkspaceAsset(p)).toBe("D:\\Team\\library\\g-1\\assets\\images\\x.jpg");
  });

  it("keeps paths already under the local root", () => {
    workspace = "G:\\My Drive\\HeraVex";
    const p = "G:\\My Drive\\HeraVex\\library\\g\\assets\\images\\x.png";
    expect(remapWorkspaceAsset(p)).toBe(p);
  });

  it("does not touch user files outside HeraVex-managed assets", () => {
    workspace = "G:\\My Drive\\HeraVex";
    const p = "D:\\Art\\library\\concepts\\hero.png";
    expect(remapWorkspaceAsset(p)).toBe(p);
  });

  it("uses the last managed segment when the root contains 'library'", () => {
    workspace = "/home/me/team";
    const p = "/mnt/library/shared/assets/HeraVex/library/g-2/assets/images/y.png";
    expect(remapWorkspaceAsset(p)).toBe("/home/me/team/library/g-2/assets/images/y.png");
  });

  it("resolves legacy relative library paths", () => {
    workspace = "/home/me/team";
    expect(remapWorkspaceAsset("library/abc/refs/hero.png")).toBe("/home/me/team/library/abc/refs/hero.png");
  });

  it("imgSrc passes data URLs through and remaps file paths", () => {
    workspace = "/home/me/team";
    expect(imgSrc("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(imgSrc(undefined)).toBeUndefined();
    expect(imgSrc("/Users/x/HeraVex/library/g/assets/images/c.png"))
      .toBe(`http://asset.localhost/${encodeURIComponent("/home/me/team/library/g/assets/images/c.png")}`);
  });
});
