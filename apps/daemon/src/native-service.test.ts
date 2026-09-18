import { describe, expect, it, vi } from "vitest";
import { NativeService, type NativeRunner } from "./native-service.js";

describe("NativeService", () => {
  it("uses argument-safe JXA notification delivery on macOS", async () => {
    const runner = vi.fn<NativeRunner>().mockResolvedValue({ stdout: Buffer.alloc(0), stderr: "" });
    const service = new NativeService("darwin", runner);

    await service.notify("Build's done", "Review $(unsafe)");

    expect(runner).toHaveBeenCalledOnce();
    const [executable, args] = runner.mock.calls[0] ?? [];
    expect(executable).toBe("osascript");
    expect(args?.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
    expect(args?.slice(-2)).toEqual(["Build's done", "Review $(unsafe)"]);
  });

  it("decodes a macOS clipboard image returned by JXA", async () => {
    const png = Buffer.from("fixture-png");
    const runner = vi.fn<NativeRunner>().mockResolvedValue({
      stdout: Buffer.from(`public.png\n${png.toString("base64")}\n`), stderr: "",
    });
    const service = new NativeService("darwin", runner);

    await expect(service.readClipboardImage()).resolves.toEqual({
      mimeType: "image/png", base64: png.toString("base64"),
    });
    expect(runner.mock.calls[0]?.[0]).toBe("osascript");
  });

  it("falls back from Wayland to xclip on Linux", async () => {
    const runner = vi.fn<NativeRunner>()
      .mockRejectedValueOnce(new Error("wl-paste unavailable"))
      .mockResolvedValueOnce({ stdout: Buffer.from("image"), stderr: "" });
    const service = new NativeService("linux", runner);

    await expect(service.readClipboardImage()).resolves.toEqual({
      mimeType: "image/png", base64: Buffer.from("image").toString("base64"),
    });
    expect(runner.mock.calls.map(([executable]) => executable)).toEqual(["wl-paste", "xclip"]);
  });
});
