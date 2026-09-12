from django.db import IntegrityError


def violated_constraint(exc: IntegrityError) -> str:
    """Name of the PostgreSQL constraint behind an IntegrityError ("" if unknown)."""
    diag = getattr(exc.__cause__, "diag", None)
    return getattr(diag, "constraint_name", None) or ""
