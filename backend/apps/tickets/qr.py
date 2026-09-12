"""
QR codes for e-tickets.

The QR code holds only the ticket number plus a signature made with the server's secret, e.g.
``TK7KQ2M9XHAB:2Tq…``. No names, phone numbers or seat details: anyone can read a QR code, and a
conductor's scanner looks everything else up on the server. The signature means a ticket number
typed into a QR generator by hand is rejected.
"""

import base64

from django.core import signing
from reportlab.graphics.barcode import qrencoder

SALT = "yathra.tickets.qr"
QUIET_ZONE = 4  # modules of white border the QR standard asks for


def ticket_code(ticket_number: str) -> str:
    return signing.Signer(salt=SALT).sign(ticket_number)


def read_ticket_code(code: str) -> str | None:
    """The ticket number inside a scanned code, or None if it wasn't signed by us."""
    try:
        return signing.Signer(salt=SALT).unsign(code.strip())
    except (signing.BadSignature, AttributeError):
        return None


def qr_matrix(value: str) -> list[list[bool]]:
    code = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)
    code.addData(value)
    code.make()
    size = code.getModuleCount()
    return [[bool(code.isDark(row, col)) for col in range(size)] for row in range(size)]


def dark_runs(matrix: list[list[bool]]):
    """(row, first column, length) for each horizontal run of dark modules."""
    for row, cells in enumerate(matrix):
        col = 0
        while col < len(cells):
            if cells[col]:
                start = col
                while col < len(cells) and cells[col]:
                    col += 1
                yield row, start, col - start
            else:
                col += 1


def qr_svg(value: str) -> str:
    matrix = qr_matrix(value)
    size = len(matrix) + QUIET_ZONE * 2
    path = "".join(
        f"M{start + QUIET_ZONE} {row + QUIET_ZONE}h{length}v1h-{length}z"
        for row, start, length in dark_runs(matrix)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'shape-rendering="crispEdges"><rect width="{size}" height="{size}" fill="#fff"/>'
        f'<path d="{path}" fill="#000"/></svg>'
    )


def qr_data_uri(value: str) -> str:
    """For an <img src>: the browser never has to parse our SVG as markup."""
    encoded = base64.b64encode(qr_svg(value).encode()).decode()
    return f"data:image/svg+xml;base64,{encoded}"
