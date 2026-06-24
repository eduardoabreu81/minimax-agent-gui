// Vitest for the Composer integration with context-refs.
//
// Mocks apiFetch (so we don't hit the real backend) and exercises
// the user flow:
//   1. Type a message with @-refs → chips appear
//   2. Click send → expand is called, attached context block is
//      appended, onSend is called with the augmented message
//   3. Hard-limit refusal path → send is blocked, alert shown

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./Composer.tsx";

// Mock apiFetch so we don't need a real backend
vi.mock("@/lib/api.js", () => ({
  apiFetch: vi.fn(),
}));

// Mock alert so we can assert on the hard-limit refusal
const mockAlert = vi.fn();
vi.stubGlobal("alert", mockAlert);

import { apiFetch } from "@/lib/api.js";
const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiFetch.mockReset();
  mockAlert.mockReset();
});

describe("Composer — context-refs integration", () => {
  it("renders the textarea and send button", () => {
    render(
      <Composer
        onSend={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    expect(screen.getByTestId("composer-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("composer-send")).toBeInTheDocument();
  });

  it("renders chips for parsed refs as user types", async () => {
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "Look at @file:src/main.py");
    // Chip for file ref should be visible
    expect(await screen.findByTestId("ref-chip-file")).toBeInTheDocument();
  });

  it("on submit, calls expand and sends the augmented message with attached context", async () => {
    const onSend = vi.fn();
    const u = userEvent.setup();

    // Mock expand to return a successful file expansion
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        results: [
          {
            ref: { raw: "@file:src/main.py", type: "file", value: "src/main.py" },
            content: "print('hi')\n",
            warning: "",
            error: "",
            size_bytes: 13,
          },
        ],
        total_bytes: 13,
        soft_warning: "",
        refused: false,
        refusal_reason: "",
        parsed_refs: [],
      }),
    });

    render(
      <Composer
        onSend={onSend}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "Review @file:src/main.py");
    await u.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    const sentText = onSend.mock.calls[0][0];
    // The user's original message is preserved
    expect(sentText).toContain("Review @file:src/main.py");
    // And the attached context block is appended
    expect(sentText).toContain("--- Attached Context ---");
    expect(sentText).toContain("print('hi')");
    expect(sentText).toContain("--- End Attached Context ---");
  });

  it("blocks send when hard limit refused", async () => {
    const onSend = vi.fn();
    const u = userEvent.setup();

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        results: [],
        total_bytes: 0,
        soft_warning: "",
        refused: true,
        refusal_reason: "expanded content is 100,000 bytes (>= 50% of context, hard limit).",
        parsed_refs: [],
      }),
    });

    render(
      <Composer
        onSend={onSend}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "Read @file:big.json");
    await u.click(screen.getByTestId("composer-send"));

    // onSend NOT called
    expect(onSend).not.toHaveBeenCalled();
    // Alert shown with the refusal reason
    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalled();
    });
    expect(mockAlert.mock.calls[0][0]).toContain("Context too large to send");
  });

  it("disables send when expand reports refused (after a debounced call)", async () => {
    const u = userEvent.setup({ delay: null });

    // First call: refused (the debounced expand reports a refusal)
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        results: [],
        total_bytes: 0,
        soft_warning: "",
        refused: true,
        refusal_reason: "expanded content is 100,000 bytes (>= 50% of context, hard limit).",
        parsed_refs: [],
      }),
    });

    render(
      <Composer
        onSend={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "Read @file:big.json");

    // Wait for the debounced expand to fire and the send button to
    // become disabled because report.refused is true. The 400ms
    // debounce + React render can take a moment, so use a longer
    // waitFor timeout.
    await waitFor(() => {
      expect(screen.getByTestId("composer-send")).toBeDisabled();
    }, { timeout: 3000 });
    expect(screen.getByTestId("hard-limit-error")).toBeInTheDocument();
  });

  it("sends the plain message when expand fails (network error)", async () => {
    const onSend = vi.fn();
    const u = userEvent.setup();

    // Network error
    mockApiFetch.mockRejectedValueOnce(new Error("network"));

    render(
      <Composer
        onSend={onSend}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "Read @file:foo.py");
    await u.click(screen.getByTestId("composer-send"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
    });
    const sentText = onSend.mock.calls[0][0];
    // No attached block — plain text only
    expect(sentText).not.toContain("--- Attached Context ---");
    expect(sentText).toContain("Read @file:foo.py");
  });

  it("clears the textarea after a successful send", async () => {
    const onSend = vi.fn();
    const u = userEvent.setup();

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        results: [],
        total_bytes: 0,
        soft_warning: "",
        refused: false,
        refusal_reason: "",
        parsed_refs: [],
      }),
    });

    render(
      <Composer
        onSend={onSend}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await u.type(textarea, "hello");
    expect(textarea.value).toBe("hello");
    await u.click(screen.getByTestId("composer-send"));
    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });
});

describe("Composer — /skill slash menu", () => {
  it("opens the slash menu when the user types '/' and fetches the skill list", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        skills: [
          { name: "review", description: "Review code for issues" },
          { name: "test", description: "Run the test suite" },
        ],
      }),
    });
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "/");
    // Wait for the slash menu to render (it appears after the
    // skills fetch resolves).
    await waitFor(() => {
      expect(screen.getByText("review")).toBeInTheDocument();
    });
    expect(screen.getByText("test")).toBeInTheDocument();
    // Skills endpoint was called once
    expect(mockApiFetch).toHaveBeenCalledWith("/api/skills");
  });

  it("filters the slash menu as the user types after '/'", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        skills: [
          { name: "review", description: "Review code" },
          { name: "test", description: "Run tests" },
          { name: "deploy", description: "Deploy to production" },
        ],
      }),
    });
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "/re");
    // "review" matches, others are filtered out
    await waitFor(() => {
      expect(screen.getByText("review")).toBeInTheDocument();
    });
    expect(screen.queryByText("test")).not.toBeInTheDocument();
    expect(screen.queryByText("deploy")).not.toBeInTheDocument();
  });

  it("pressing Enter on a skill calls onActivateSkill and clears the input", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        skills: [
          { name: "review", description: "Review code" },
          { name: "test", description: "Run tests" },
        ],
      }),
    });
    const onActivateSkill = vi.fn();
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={onActivateSkill}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await u.type(textarea, "/");
    await waitFor(() => {
      expect(screen.getByText("review")).toBeInTheDocument();
    });
    await u.keyboard("{Enter}");
    expect(onActivateSkill).toHaveBeenCalledWith("review");
    // Input cleared after activation
    expect(textarea.value).toBe("");
  });

  it("closes the slash menu when the user types a non-slash character", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        skills: [{ name: "review", description: "Review code" }],
      }),
    });
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "/");
    await waitFor(() => {
      expect(screen.getByText("review")).toBeInTheDocument();
    });
    // Type a non-slash character → menu closes
    await u.type(textarea, "x");
    expect(screen.queryByText("review")).not.toBeInTheDocument();
  });
});

describe("Composer — attachment (paperclip)", () => {
  it("uploads the picked file and shows the attachment chip", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, path: "/uploads/foo.png" }),
    });
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const fileInput = screen.getByTestId("composer-file-input") as HTMLInputElement;
    const file = new File(["hello"], "foo.png", { type: "image/png" });
    await u.upload(fileInput, file);
    // Upload endpoint called with FormData
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({ method: "POST" })
    );
    // Chip rendered with the file name
    await waitFor(() => {
      expect(screen.getByTestId("composer-attachment-chip")).toBeInTheDocument();
    });
    expect(screen.getByText("foo.png")).toBeInTheDocument();
  });

  it("removing the attachment chip clears the state", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, path: "/uploads/foo.png" }),
    });
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const fileInput = screen.getByTestId("composer-file-input") as HTMLInputElement;
    await u.upload(fileInput, new File(["hi"], "foo.png", { type: "image/png" }));
    await waitFor(() => {
      expect(screen.getByTestId("composer-attachment-chip")).toBeInTheDocument();
    });
    await u.click(screen.getByLabelText("Remove attachment"));
    expect(screen.queryByTestId("composer-attachment-chip")).not.toBeInTheDocument();
  });

  it("passes the attachment to onSend when sending", async () => {
    mockApiFetch
      // 1st: /api/upload
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, path: "/uploads/foo.png" }),
      })
      // 2nd: /api/context-refs/expand (no refs → empty result)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          results: [],
          total_bytes: 0,
          soft_warning: "",
          refused: false,
          refusal_reason: "",
          parsed_refs: [],
        }),
      });
    const onSend = vi.fn();
    const u = userEvent.setup();
    render(
      <Composer
        onSend={onSend}
        onActivateSkill={vi.fn()}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const fileInput = screen.getByTestId("composer-file-input") as HTMLInputElement;
    await u.upload(fileInput, new File(["hi"], "foo.png", { type: "image/png" }));
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "see attached");
    await u.click(screen.getByTestId("composer-send"));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
    });
    expect(onSend.mock.calls[0][1]).toEqual({
      name: "foo.png",
      path: "/uploads/foo.png",
      type: "image/png",
    });
  });
});

describe("Composer — onDirtyChange callback", () => {
  it("fires true when the user types, false when the textarea is cleared on send", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        results: [],
        total_bytes: 0,
        soft_warning: "",
        refused: false,
        refusal_reason: "",
        parsed_refs: [],
      }),
    });
    const onDirtyChange = vi.fn();
    const u = userEvent.setup();
    render(
      <Composer
        onSend={vi.fn()}
        onActivateSkill={vi.fn()}
        onDirtyChange={onDirtyChange}
        status="idle"
        expertLabel="M3"
        sessionId="test-session"
      />
    );
    const textarea = screen.getByTestId("composer-textarea");
    await u.type(textarea, "hi");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await u.click(screen.getByTestId("composer-send"));
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
  });
});
