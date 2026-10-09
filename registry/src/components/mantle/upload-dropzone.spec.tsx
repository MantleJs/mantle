import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantleClientError } from "@mantlejs/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createHarness, expectNoAxeViolations } from "@/test/harness";
import { UploadDropzone, type UploadDropzoneProps } from "@/components/mantle/upload-dropzone";

/** Minimal XMLHttpRequest double: records the request, lets the test drive progress and completion. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body?: FormData;
  status = 0;
  statusText = "";
  responseText = "";
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
  }
  progress(loaded: number, total: number) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded, total }));
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    act(() => this.onload?.());
  }
}

function setup(props: Partial<UploadDropzoneProps> = {}) {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const harness = createHarness();
  const onUploaded = vi.fn();
  const onError = vi.fn();
  const view = harness.render(
    <UploadDropzone url="http://api.test/attachments" onUploaded={onUploaded} onError={onError} {...props} />,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("FileTrigger input not rendered");
  return { ...harness, view, input, onUploaded, onError };
}

function pick(input: HTMLInputElement, ...files: File[]) {
  fireEvent.change(input, { target: { files } });
}

const png = () => new File(["png-bytes"], "photo.png", { type: "image/png" });

describe("UploadDropzone", () => {
  it("POSTs multipart form data with the bearer token, extra fields, and progress", async () => {
    const { client, input, onUploaded } = setup({ field: "photo", fields: { articleId: "42" } });
    await client.setTokens({ accessToken: "tok" });

    pick(input, png());
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://api.test/attachments");
    expect(xhr.headers["authorization"]).toBe("Bearer tok");
    expect([...(xhr.body?.keys() ?? [])]).toEqual(["articleId", "photo"]);
    expect((xhr.body?.get("photo") as File).name).toBe("photo.png");

    xhr.progress(5, 10);
    expect(screen.getByRole("progressbar", { name: "photo.png" }).getAttribute("aria-valuenow")).toBe("50");

    xhr.respond(201, { id: 9, key: "123-photo.png" });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ id: 9, key: "123-photo.png" }, expect.any(File)));
    expect(screen.getByText("Uploaded")).toBeTruthy();
  });

  it("shows a server-side MantleError (e.g. handleUpload's size limit) and reports it", async () => {
    const { input, onError } = setup();
    pick(input, png());
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    FakeXhr.instances[0].respond(400, { name: "BadRequest", code: 400, message: "File exceeds the 5 MB limit" });

    expect((await screen.findByRole("alert")).textContent).toBe("photo.png: File exceeds the 5 MB limit");
    const [error] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(MantleClientError);
    expect((error as MantleClientError).name).toBe("BadRequest");
  });

  it("rejects disallowed types and oversized files before any request", async () => {
    const { input, onError } = setup({ acceptedFileTypes: ["image/*"], maxFileSize: 4, allowsMultiple: true });

    pick(input, new File(["hello"], "notes.txt", { type: "text/plain" }), png());

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "notes.txt: File type text/plain is not allowed.",
      "photo.png: File is larger than 4 bytes.",
    ]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("uploads only the first file unless allowsMultiple", async () => {
    const { input } = setup();
    pick(input, png(), new File(["b"], "second.png", { type: "image/png" }));
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    expect(screen.queryByText("second.png")).toBeNull();
  });

  it("opens the file picker from the keyboard", async () => {
    const { input } = setup();
    const click = vi.spyOn(input, "click");
    const user = userEvent.setup();

    const chooser = screen.getByRole("button", { name: "Choose file" });
    while (document.activeElement !== chooser) await user.tab();
    await user.keyboard("{Enter}");

    expect(click).toHaveBeenCalled();
  });

  it("has no axe violations, idle and with progress and errors listed", async () => {
    const { view, input } = setup({ acceptedFileTypes: ["image/png"], allowsMultiple: true });
    await expectNoAxeViolations(view.container);

    pick(input, png(), new File(["x"], "bad.txt", { type: "text/plain" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].progress(1, 4);
    await expectNoAxeViolations(view.container);
  });
});
