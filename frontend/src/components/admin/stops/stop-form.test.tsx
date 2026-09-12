import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StopForm } from "./stop-form";

describe("StopForm", () => {
  it("requires latitude and longitude together", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StopForm submitLabel="Add stop" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Stop name"), "Ella");
    await user.type(screen.getByLabelText("City / town"), "Ella");
    await user.type(screen.getByLabelText("Latitude (optional)"), "6.8667");
    await user.click(screen.getByRole("button", { name: "Add stop" }));

    expect(
      await screen.findByText("Enter both latitude and longitude, or leave both empty."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits empty coordinates as null", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<StopForm submitLabel="Add stop" onSubmit={onSubmit} cities={["Ella", "Kandy"]} />);

    await user.type(screen.getByLabelText("Stop name"), "Ella Bus Stand");
    await user.type(screen.getByLabelText("City / town"), "Ella");
    await user.click(screen.getByRole("button", { name: "Add stop" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ella Bus Stand",
      city: "Ella",
      latitude: null,
      longitude: null,
      active: true,
    });
  });
});
