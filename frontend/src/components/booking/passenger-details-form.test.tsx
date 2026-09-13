import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { passengerDefaults } from "@/lib/validations/booking";

import { PassengerDetailsForm } from "./passenger-details-form";

const BOOKER = { name: "Kasuni Fernando", phone: "+94771234567", email: "kasuni@example.com" };

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <PassengerDetailsForm
      defaultValues={passengerDefaults(["15", "16"], BOOKER)}
      submitLabel="Review booking"
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

const field = (label: string, index: number, name: string) =>
  screen.getByLabelText(label, { selector: `#passenger-${index}-${name}` });

describe("PassengerDetailsForm", () => {
  it("suggests the booker's details and needs every passenger's name", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    expect(field("Full name", 0, "name")).toHaveValue("Kasuni Fernando");
    expect(field("Full name", 1, "name")).toHaveValue("");
    // The booker's email is only suggested once; other passengers don't need one.
    expect(field("Email (optional)", 0, "email")).toHaveValue("kasuni@example.com");
    expect(field("Email (optional)", 1, "email")).toHaveValue("");
    expect(screen.getByText("Passenger 2 · Seat 16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review booking" }));

    expect(await screen.findByText("Enter the passenger’s full name.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends tidy details for each seat", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.type(field("Full name", 1, "name"), "  Dilan   Fernando ");
    await user.type(field("Email (optional)", 1, "email"), "DILAN@Example.com");
    await user.click(screen.getByRole("button", { name: "Review booking" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith([
      { seat_number: "15", name: "Kasuni Fernando", phone: "+94771234567", email: "kasuni@example.com" },
      { seat_number: "16", name: "Dilan Fernando", phone: "+94771234567", email: "dilan@example.com" },
    ]);
  });

  it("lets a passenger travel without an email address", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.type(field("Full name", 1, "name"), "Dilan Fernando");
    await user.clear(field("Email (optional)", 0, "email"));
    await user.click(screen.getByRole("button", { name: "Review booking" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].map((p: { email: string }) => p.email)).toEqual(["", ""]);
  });

  it("still rejects an email address that isn't one", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.type(field("Full name", 1, "name"), "Dilan Fernando");
    await user.type(field("Email (optional)", 1, "email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Review booking" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a bad phone number before sending", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.type(field("Full name", 1, "name"), "Dilan Fernando");
    await user.clear(field("Phone", 1, "phone"));
    await user.type(field("Phone", 1, "phone"), "12");
    await user.click(screen.getByRole("button", { name: "Review booking" }));

    expect(await screen.findByText("Enter a valid phone number, e.g. 077 123 4567.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server's objections on the right passenger", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        details: { passengers: [{}, { email: ["This email address is blocked."] }] },
      }),
    );
    renderForm(onSubmit);

    await user.type(field("Full name", 1, "name"), "Dilan Fernando");
    await user.click(screen.getByRole("button", { name: "Review booking" }));

    expect(await screen.findByText("This email address is blocked.")).toBeInTheDocument();
    expect(field("Email (optional)", 1, "email")).toHaveAttribute("aria-invalid", "true");
  });
});
