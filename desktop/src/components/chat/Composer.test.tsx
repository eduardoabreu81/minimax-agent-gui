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
