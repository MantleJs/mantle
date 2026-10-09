import { useCallback, useRef, useState } from "react";
import { DropZone, FileTrigger, Text, isFileDropItem } from "react-aria-components";
import { errorFromResponse, type MantleClientError } from "@mantlejs/client";
import { useMantleClient } from "@mantlejs/react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

export interface UploadDropzoneProps<R = unknown> {
  /** Absolute URL of the service method guarded by `handleUpload()`, e.g. `${apiUrl}/attachments`. */
  url: string;
  /** Multipart field name `handleUpload(field)` reads. @default "file" */
  field?: string;
  /** Extra form fields sent with every file (merged into `context.data` by `handleUpload()`). */
  fields?: Record<string, string>;
  /** MIME types offered by the picker and checked before upload, e.g. `["image/png", "image/*"]`. */
  acceptedFileTypes?: string[];
  /** Size limit in bytes checked before upload — mirror `upload({ maxFileSize })`. */
  maxFileSize?: number;
  /** Allow several files per drop/selection, each uploaded as its own request. @default false */
  allowsMultiple?: boolean;
  /** Called with the service's response for each file that uploaded. */
  onUploaded?: (result: R, file: File) => void;
  /** Called for each file that failed — client-side validation or a server error. */
  onError?: (error: MantleClientError | Error, file: File) => void;
  /** Visible drop-zone text (also its accessible name). @default "Drop a file here" */
  label?: string;
  className?: string;
}

type UploadStatus = "uploading" | "done" | "error";

interface UploadEntry {
  id: number;
  name: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

/**
 * Drag-and-drop or pick a file, then `POST` it as `multipart/form-data` to a service whose `create`
 * (or `patch`) runs `@mantlejs/storage`'s `handleUpload()`. Built on React Aria `DropZone` +
 * `FileTrigger`, so the zone is keyboard-focusable (paste works too) and the picker button is a real
 * button. Uploads go over `XMLHttpRequest` for progress events — `@mantlejs/client` speaks JSON only —
 * with the client's current bearer token attached.
 */
export function UploadDropzone<R = unknown>({
  url,
  field = "file",
  fields,
  acceptedFileTypes,
  maxFileSize,
  allowsMultiple = false,
  onUploaded,
  onError,
  label = "Drop a file here",
  className,
}: UploadDropzoneProps<R>) {
  const client = useMantleClient();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const nextId = useRef(0);

  const update = useCallback((id: number, patch: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      // isAuthenticated() hydrates the persisted token; getAccessToken() alone may still be empty.
      await client.isAuthenticated();
      const token = client.getAccessToken();
      for (const file of allowsMultiple ? files : files.slice(0, 1)) {
        const id = nextId.current++;
        const problem = rejectReason(file, acceptedFileTypes, maxFileSize);
        setEntries((current) => [
          ...current,
          { id, name: file.name, status: problem ? "error" : "uploading", progress: 0, error: problem },
        ]);
        if (problem) {
          onError?.(new Error(problem), file);
          continue;
        }
        uploadFile<R>({ url, field, fields, file, token, onProgress: (progress) => update(id, { progress }) }).then(
          (result) => {
            update(id, { status: "done", progress: 100 });
            onUploaded?.(result, file);
          },
          (error: MantleClientError | Error) => {
            update(id, { status: "error", error: error.message });
            onError?.(error, file);
          },
        );
      }
    },
    [client, allowsMultiple, acceptedFileTypes, maxFileSize, url, field, fields, update, onUploaded, onError],
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <DropZone
        // Accept every drop and check type/size per file afterwards: drag types can't express
        // wildcards like "image/*", and a rejected file should say why rather than silently bounce.
        getDropOperation={() => "copy"}
        onDrop={async (event) => {
          const files = await Promise.all(event.items.filter(isFileDropItem).map((item) => item.getFile()));
          void start(files);
        }}
        className={({ isDropTarget, isFocusVisible }) =>
          cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors outline-none",
            isDropTarget && "border-primary bg-primary/5 text-foreground",
            isFocusVisible && "border-ring ring-3 ring-ring/50",
          )
        }
      >
        <Text slot="label">{label}</Text>
        <FileTrigger
          acceptedFileTypes={acceptedFileTypes}
          allowsMultiple={allowsMultiple}
          onSelect={(list) => void start(list ? Array.from(list) : [])}
        >
          <Button variant="outline">{allowsMultiple ? "Choose files" : "Choose file"}</Button>
        </FileTrigger>
      </DropZone>
      {entries.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Uploads">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 text-sm">
              {entry.status === "error" ? (
                <p role="alert" className="text-destructive">
                  {entry.name}: {entry.error}
                </p>
              ) : (
                <Progress value={entry.progress}>
                  <ProgressLabel>{entry.name}</ProgressLabel>
                  <ProgressValue>{(value) => (entry.status === "done" ? "Uploaded" : value)}</ProgressValue>
                </Progress>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function rejectReason(file: File, accepted?: string[], maxSize?: number): string | undefined {
  if (accepted && accepted.length > 0 && !accepted.some((type) => matchesMime(file.type, type))) {
    return `File type ${file.type || "unknown"} is not allowed.`;
  }
  if (maxSize !== undefined && file.size > maxSize) {
    return `File is larger than ${formatBytes(maxSize)}.`;
  }
  return undefined;
}

function matchesMime(actual: string, pattern: string): boolean {
  return pattern.endsWith("/*") ? actual.startsWith(pattern.slice(0, -1)) : actual === pattern;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

interface UploadRequest {
  url: string;
  field: string;
  fields?: Record<string, string>;
  file: File;
  token?: string;
  onProgress: (percent: number) => void;
}

function uploadFile<R>({ url, field, fields, file, token, onProgress }: UploadRequest): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const body = new FormData();
    // Ordinary fields first: busboy streams parts in order, and handleUpload() merges them into
    // context.data alongside the file.
    for (const [name, value] of Object.entries(fields ?? {})) body.append(name, value);
    body.append(field, file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as R);
        return;
      }
      // Same MantleError JSON → MantleClientError mapping every other client call gets.
      const response = new Response(xhr.responseText || null, { status: xhr.status, statusText: xhr.statusText });
      void errorFromResponse(response).then(reject);
    };
    xhr.onerror = () => reject(new Error("Upload failed: couldn't reach the server."));
    xhr.send(body);
  });
}
