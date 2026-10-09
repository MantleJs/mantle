import { useCallback, useRef, useState } from "react";
import { DropZone, FileTrigger, Text, isFileDropItem } from "react-aria-components";
import type { Id, MantleClientError } from "@mantlejs/client";
import { useMantleClient } from "@mantlejs/react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

export interface UploadDropzoneProps<R = unknown> {
  /** Service path whose `create` runs `handleUpload()`, e.g. `"attachments"`. */
  service: string;
  /** Upload into an existing record instead — `PATCH /:service/:id` (its `patch` must run `handleUpload()`). */
  id?: Id;
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
 * button. Each file goes through `client.service(service).upload()`, so it gets the client's bearer
 * token, its one refresh-and-retry on 401, typed `MantleClientError`s, and progress events.
 */
export function UploadDropzone<R = unknown>({
  service,
  id: recordId,
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
    (files: File[]) => {
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
        client
          .service<R>(service)
          .upload(file, {
            id: recordId,
            field,
            fields,
            onProgress: ({ percent }) => {
              if (percent !== undefined) update(id, { progress: percent });
            },
          })
          .then(
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
    [
      client,
      allowsMultiple,
      acceptedFileTypes,
      maxFileSize,
      service,
      recordId,
      field,
      fields,
      update,
      onUploaded,
      onError,
    ],
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
