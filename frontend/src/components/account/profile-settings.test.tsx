import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { ProfileSettings } from "./profile-settings";

const auth = vi.hoisted(() => ({
  user: {
    id: "user-1",
    name: "Kasuni Fernando",
    email: "kasuni@example.com",
    phone: "+94771234567",
    role: "customer" as const,
    is_active: true,
    created_at: "2029-04-02T09:00:00+05:30",
    updated_at: "2029-04-02T09:00:00+05:30",
  },
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfileSettings />
    </QueryClientProvider>,
  );
}

describe("ProfileSettings", () => {
  beforeEach(() => {
    auth.updateProfile.mockReset();
    auth.changePassword.mockReset();
  });

  it("starts from the signed-in details", () => {
    renderSettings();

    expect(screen.getByLabelText("Full name")).toHaveValue("Kasuni Fernando");
    expect(screen.getByLabelText("Email address")).toHaveValue("kasuni@example.com");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("+94771234567");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("saves a changed name, phone and email", async () => {
    const person = userEvent.setup();
    auth.updateProfile.mockResolvedValue({ ...auth.user, name: "Kasuni Perera" });
    renderSettings();

    const name = screen.getByLabelText("Full name");
    await person.clear(name);
    await person.type(name, "Kasuni Perera");
    await person.click(screen.getByRole("button", { name: "Save changes" }));

    expect(auth.updateProfile).toHaveBeenCalledWith({
      name: "Kasuni Perera",
      email: "kasuni@example.com",
      phone: "+94771234567",
    });
  });

  it("shows the server's complaint against the right field", async () => {
    const person = userEvent.setup();
    auth.updateProfile.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        details: { email: ["An account with this email already exists."] },
      }),
    );
    renderSettings();

    const email = screen.getByLabelText("Email address");
    await person.clear(email);
    await person.type(email, "taken@example.com");
    await person.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("An account with this email already exists."),
    ).toBeInTheDocument();
  });

  it("refuses a bad phone number before asking the server", async () => {
    const person = userEvent.setup();
    renderSettings();

    const phone = screen.getByLabelText("Mobile number");
    await person.clear(phone);
    await person.type(phone, "12");
    await person.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/Enter a valid phone number/)).toBeInTheDocument();
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });

  it("changes the password once both new entries match", async () => {
    const person = userEvent.setup();
    auth.changePassword.mockResolvedValue(auth.user);
    renderSettings();

    await person.type(screen.getByLabelText("Current password"), "Yathra@Dev2026");
    await person.type(screen.getByLabelText("New password"), "Kandy-Express-2027");
    await person.type(screen.getByLabelText("Confirm new password"), "Kandy-Express-2027");
    await person.click(screen.getByRole("button", { name: "Change password" }));

    expect(auth.changePassword).toHaveBeenCalledWith({
      current_password: "Yathra@Dev2026",
      new_password: "Kandy-Express-2027",
    });
  });

  it("catches a mistyped confirmation without calling the server", async () => {
    const person = userEvent.setup();
    renderSettings();

    await person.type(screen.getByLabelText("Current password"), "Yathra@Dev2026");
    await person.type(screen.getByLabelText("New password"), "Kandy-Express-2027");
    await person.type(screen.getByLabelText("Confirm new password"), "Kandy-Express-2028");
    await person.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Passwords don’t match.")).toBeInTheDocument();
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it("reports a wrong current password from the server", async () => {
    const person = userEvent.setup();
    auth.changePassword.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        details: { current_password: ["That isn’t your current password."] },
      }),
    );
    renderSettings();

    await person.type(screen.getByLabelText("Current password"), "wrong-password");
    await person.type(screen.getByLabelText("New password"), "Kandy-Express-2027");
    await person.type(screen.getByLabelText("Confirm new password"), "Kandy-Express-2027");
    await person.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("That isn’t your current password.")).toBeInTheDocument();
  });
});
