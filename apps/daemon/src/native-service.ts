import { spawn } from "node:child_process";

export type NativeRunner = (executable: string, args: string[], input?: string) => Promise<{ stdout: Buffer; stderr: string }>;

export interface NativeAdapter {
  notify(title: string, body: string): Promise<void>;
  readClipboardImage(): Promise<{ mimeType: string; base64: string }>;
}

function run(executable: string, args: string[], input?: string): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    if (input) child.stdin?.end(input);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr });
      else reject(new Error(stderr.trim() || `${executable} exited with code ${code}`));
    });
  });
}

export class NativeService implements NativeAdapter {
  readonly #platform: NodeJS.Platform;
  readonly #run: NativeRunner;

  constructor(platform: NodeJS.Platform = process.platform, runner: NativeRunner = run) {
    this.#platform = platform;
    this.#run = runner;
  }

  async notify(title: string, body: string): Promise<void> {
    if (this.#platform === "darwin") {
      const script = "function run(a){var app=Application.currentApplication();app.includeStandardAdditions=true;app.displayNotification(a[1],{withTitle:a[0]});}";
      await this.#run("osascript", ["-l", "JavaScript", "-e", script, title, body]);
      return;
    }
    if (this.#platform === "linux") {
      await this.#run("notify-send", [title, body]);
      return;
    }
    throw new Error(`Desktop notifications are not supported on ${this.#platform}`);
  }

  async readClipboardImage(): Promise<{ mimeType: string; base64: string }> {
    if (this.#platform === "darwin") {
      const script = `ObjC.import('AppKit');
function run(){var p=$.NSPasteboard.generalPasteboard;var d=p.dataForType('public.png');
if(!d){var t=p.dataForType('public.tiff');if(t){var r=$.NSBitmapImageRep.imageRepWithData(t);if(r){d=r.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({}));}}}
if(d){return 'public.png\\n'+ObjC.unwrap(d.base64EncodedStringWithOptions(0));}
throw new Error('Clipboard does not contain a PNG or TIFF image');}`;
      const { stdout } = await this.#run("osascript", ["-l", "JavaScript", "-e", script]);
      const [, ...data] = stdout.toString("utf8").trim().split("\n");
      return { mimeType: "image/png", base64: data.join("") };
    }
    if (this.#platform === "linux") {
      try {
        const { stdout } = await this.#run("wl-paste", ["--no-newline", "--type", "image/png"]);
        return { mimeType: "image/png", base64: stdout.toString("base64") };
      } catch {
        const { stdout } = await this.#run("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
        return { mimeType: "image/png", base64: stdout.toString("base64") };
      }
    }
    throw new Error(`Clipboard image reading is not supported on ${this.#platform}`);
  }
}
