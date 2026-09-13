import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LatLng } from "@/lib/map";

vi.mock("./location-picker-map", () => ({
  LocationPickerMap: ({ onPick }: { onPick: (position: LatLng) => void }) => (
    <button type="button" onClick={() => onPick([7.2906, 80.6337])}>
      pretend map
    </button>
  ),
}));

import { LocationPicker } from "./location-picker";

describe("LocationPicker", () => {
  it("stays out of the way until it is asked for", async () => {
    const user = userEvent.setup();
    render(<LocationPicker latitude="" longitude="" onPick={vi.fn()} />);

    expect(screen.queryByText("pretend map")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pick on map" }));

    expect(await screen.findByText("pretend map")).toBeInTheDocument();
  });

  it("hands back the coordinates of the place that was clicked", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<LocationPicker latitude="" longitude="" onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: "Pick on map" }));
    await user.click(await screen.findByText("pretend map"));

    expect(onPick).toHaveBeenCalledWith({ latitude: "7.290600", longitude: "80.633700" });
  });

  it("shows the current position and offers to clear it", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <LocationPicker
        latitude="6.933600"
        longitude="79.850000"
        onPick={vi.fn()}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("6.93360, 79.85000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move on map" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear coordinates" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("offers nothing to clear when there is no position", () => {
    render(<LocationPicker latitude="" longitude="" onPick={vi.fn()} onClear={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Clear coordinates" })).not.toBeInTheDocument();
  });
});
