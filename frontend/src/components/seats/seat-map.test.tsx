import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Seat } from "@/lib/api/admin-types";

import { SeatMap } from "./seat-map";

const SEATS: Seat[] = [
  { seat_number: "D", row: 1, column: 3, seat_type: "driver", is_available: false },
  { seat_number: "1", row: 2, column: 1, seat_type: "window", is_available: true },
  { seat_number: "2", row: 2, column: 3, seat_type: "window", is_available: false },
];

describe("SeatMap", () => {
  it("describes the whole map for assistive technology in view mode", () => {
    render(<SeatMap rows={2} columns={3} seats={SEATS} label="Coach" />);
    expect(screen.getByRole("img", { name: "Coach: 2 passenger seats, 1 bookable, in 2 rows" })).toBeInTheDocument();
  });

  it("exposes every cell as a labelled button in edit mode", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();
    render(<SeatMap mode="edit" rows={2} columns={3} seats={SEATS} onCellClick={onCellClick} />);

    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Seat 2, window, row 2 column 3, blocked" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Empty cell, row 2 column 2" }));
    expect(onCellClick).toHaveBeenCalledWith(2, 2, undefined);
  });
});
