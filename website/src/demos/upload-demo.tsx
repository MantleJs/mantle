import { useState } from "react";
import { UploadDropzone } from "@/components/mantle/upload-dropzone";
import { DemoLog, DemoShell } from "./demo-shell";
import { DEMO_API } from "./mock-api";

/**
 * `upload-dropzone` uploads through `client.service(service).upload()`, which uses `XMLHttpRequest` when
 * progress is wanted. This stand-in answers requests to the demo API like a service running
 * `@mantlejs/storage`'s `handleUpload()` would — with progress events along the way — without the file
 * ever leaving the browser. It implements the slice of XHR `@mantlejs/client`'s upload transport uses.
 */
class DemoUploadXHR {
  status = 0;
  statusText = "";
  responseText = "";
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = "";
  private timer: ReturnType<typeof setInterval> | undefined;

  open(_method: string, url: string): void {
    this.url = url;
  }

  setRequestHeader(): void {
    // The bearer token would go here; the mock server doesn't check it.
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === "content-type" ? "application/json" : null;
  }

  abort(): void {
    clearInterval(this.timer);
    this.onabort?.();
  }

  send(body: FormData): void {
    if (!this.url.startsWith(DEMO_API)) {
      queueMicrotask(() => this.onerror?.());
      return;
    }
    const file = [...body.values()].find((value): value is File => value instanceof File);
    const total = file?.size ?? 1;
    let loaded = 0;
    this.timer = setInterval(() => {
      loaded = Math.min(total, loaded + Math.ceil(total / 8));
      this.upload.onprogress?.(new ProgressEvent("progress", { lengthComputable: true, loaded, total }));
      if (loaded < total) return;
      clearInterval(this.timer);
      this.status = 201;
      this.statusText = "Created";
      this.responseText = JSON.stringify({
        id: crypto.randomUUID(),
        name: file?.name,
        mimeType: file?.type,
        size: file?.size,
      });
      this.onload?.();
    }, 150);
  }
}

let patched = false;
function installDemoUploads(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;
  // Only this page's island patches XHR; nothing else on a docs page uses it.
  (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = DemoUploadXHR;
}

export function UploadDropzoneDemo() {
  installDemoUploads();
  const [log, setLog] = useState<string[]>([]);
  return (
    <DemoShell
      footer={
        <>
          Drop or choose an image under 2 MB. Type and size are checked before upload (try a PDF or a large photo);
          accepted files stream to the mock <code>/attachments</code> service with progress. Files never leave your
          browser.
        </>
      }
    >
      <UploadDropzone<{ id: string; name: string; size: number }>
        service="attachments"
        acceptedFileTypes={["image/*"]}
        maxFileSize={2 * 1024 * 1024}
        allowsMultiple
        onUploaded={(result) => setLog((l) => [...l, `onUploaded → ${result.name} (${result.size} bytes)`])}
        onError={(error, file) => setLog((l) => [...l, `onError → ${file.name}: ${error.message}`])}
      />
      <DemoLog entries={log} />
    </DemoShell>
  );
}
