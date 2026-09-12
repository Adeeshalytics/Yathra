import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { OperatorForm } from "./operator-form";

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Company name"), "Sunrise Travels");
  await user.type(screen.getByLabelText("Business registration number"), "PV-123456");
  await user.type(screen.getByLabelText("Phone"), "077 123 4567");
  await user.type(screen.getByLabelText("Email"), "Ops@Sunrise.example");
  await user.type(screen.getByLabelText("Business address"), "12 Temple Road, Galle");
}

describe("OperatorForm", () => {
  it("shows validation errors instead of submitting an empty form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<OperatorForm submitLabel="Create operator" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Create operator" }));

    expect(await screen.findByText("Enter the company name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a normalised payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<OperatorForm submitLabel="Create operator" onSubmit={onSubmit} />);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Create operator" }));

    expect(onSubmit).toHaveBeenCalledWith({
      company_name: "Sunrise Travels",
      registration_number: "PV-123456",
      contact_phone: "077 123 4567",
      contact_email: "ops@sunrise.example",
      address: "12 Temple Road, Galle",
      status: "pending",
    });
  });

  it("shows API validation errors next to the right field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        details: { registration_number: ["An operator with this registration number already exists."] },
      }),
    );
    render(<OperatorForm submitLabel="Create operator" onSubmit={onSubmit} />);

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Create operator" }));

    expect(
      await screen.findByText("An operator with this registration number already exists."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Business registration number")).toHaveAttribute("aria-invalid", "true");
  });

  it("prefills the form when editing", () => {
    render(
      <OperatorForm
        submitLabel="Save"
        onSubmit={vi.fn()}
        operator={{
          id: "1",
          company_name: "Ruhuna Travels",
          registration_number: "PV-1",
          contact_phone: "+94412233445",
          contact_email: "info@ruhuna.example",
          address: "No. 7, Beach Road, Matara",
          status: "active",
          bus_count: 0,
          active_bus_count: 0,
          member_count: 0,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByLabelText("Company name")).toHaveValue("Ruhuna Travels");
  });
});
