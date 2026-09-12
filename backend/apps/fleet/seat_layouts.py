"""Seat-layout generation and validation, shared by the admin API and the dev seed."""

import re
from collections import Counter
from collections.abc import Iterable, Mapping

from .models import (
    BOOKABLE_SEAT_TYPES,
    PASSENGER_SEAT_TYPES,
    SeatLayoutType,
    SeatType,
)

SEAT_NUMBER_PATTERN = re.compile(r"[A-Z0-9-]{1,8}")
MIN_PASSENGER_ROWS = 2
MAX_PASSENGER_ROWS = 20
MAX_CONDUCTOR_SEATS = 2

# Seats left / right of the aisle.
TEMPLATES: dict[str, tuple[int, int]] = {
    SeatLayoutType.TWO_BY_TWO: (2, 2),
    SeatLayoutType.TWO_BY_ONE: (2, 1),
}


def _seat(number: str, row: int, column: int, seat_type: str, *, available: bool = True) -> dict:
    return {
        "seat_number": number,
        "row": row,
        "column": column,
        "seat_type": seat_type,
        "is_available": available,
    }


def generate_layout(
    layout_type: str,
    passenger_rows: int,
    *,
    back_row_full: bool = True,
    conductor_seat: bool = True,
) -> dict:
    """
    Build a standard layout as plain data (nothing is saved).

    Row 1 is the cab: the driver sits on the right (Sri Lanka drives on the left) and an
    optional conductor seat sits by the door on the left. Passenger rows follow, numbered
    1..N left-to-right, front-to-back. A full back row also fills the aisle position.
    """
    if layout_type not in TEMPLATES:
        raise ValueError(f"No template for layout type {layout_type!r}.")
    left, right = TEMPLATES[layout_type]
    aisle = left + 1
    columns = left + 1 + right
    rows = passenger_rows + 1

    seats = [_seat("D", 1, columns, SeatType.DRIVER.value, available=False)]
    if conductor_seat:
        seats.append(_seat("C", 1, 1, SeatType.CONDUCTOR.value, available=False))

    number = 1
    for row in range(2, rows + 1):
        full_row = back_row_full and row == rows
        for column in range(1, columns + 1):
            if column == aisle and not full_row:
                continue
            if column in (1, columns):
                seat_type = SeatType.WINDOW
            elif not full_row and column in (aisle - 1, aisle + 1):
                seat_type = SeatType.AISLE
            else:
                seat_type = SeatType.NORMAL
            seats.append(_seat(str(number), row, column, seat_type.value))
            number += 1

    return {
        "layout_type": layout_type,
        "rows": rows,
        "columns": columns,
        "seats": seats,
        **count_seats(seats),
    }


def count_seats(seats: Iterable[Mapping]) -> dict[str, int]:
    seats = list(seats)
    return {
        "seat_count": sum(1 for s in seats if s["seat_type"] in PASSENGER_SEAT_TYPES),
        "bookable_seat_count": sum(
            1
            for s in seats
            if s["seat_type"] in BOOKABLE_SEAT_TYPES and s.get("is_available", True)
        ),
    }


def validate_seat_config(rows: int, columns: int, seats: Iterable[Mapping]) -> list[str]:
    """Every problem with a proposed layout, as readable messages (empty list = valid)."""
    errors: list[str] = []
    by_position: dict[tuple[int, int], str] = {}
    numbers: Counter[str] = Counter()
    types: Counter[str] = Counter()

    for seat in seats:
        number = str(seat["seat_number"])
        row, column = seat["row"], seat["column"]
        if not (1 <= row <= rows and 1 <= column <= columns):
            errors.append(
                f"Seat {number} (row {row}, column {column}) is outside the "
                f"{rows} × {columns} grid."
            )
        position = (row, column)
        if position in by_position:
            errors.append(
                f"Seats {by_position[position]} and {number} are both at row {row}, "
                f"column {column}."
            )
        else:
            by_position[position] = number
        numbers[number.upper()] += 1
        types[str(seat["seat_type"])] += 1

    errors += [f"Seat number {n} is used {c} times." for n, c in numbers.items() if c > 1]
    if types[SeatType.DRIVER.value] != 1:
        errors.append("A layout needs exactly one driver seat.")
    if types[SeatType.CONDUCTOR.value] > MAX_CONDUCTOR_SEATS:
        errors.append(f"A layout can have at most {MAX_CONDUCTOR_SEATS} conductor seats.")
    if not any(types[seat_type] for seat_type in PASSENGER_SEAT_TYPES):
        errors.append("Add at least one passenger seat.")
    return errors
