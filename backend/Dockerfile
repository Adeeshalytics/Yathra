# syntax=docker/dockerfile:1

FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
RUN python -m venv /opt/venv
WORKDIR /app

# --- Development: source is bind-mounted, runserver auto-reloads -------------
FROM base AS development
COPY requirements/ requirements/
RUN pip install -r requirements/dev.txt
COPY . .
ENV DJANGO_SETTINGS_MODULE=config.settings.development
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# --- Production: gunicorn, non-root, static files baked in -------------------
FROM base AS production
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY requirements/ requirements/
RUN pip install -r requirements/prod.txt
COPY --chown=app:app . .
ENV DJANGO_SETTINGS_MODULE=config.settings.production
# collectstatic needs importable settings, not real secrets or a real database.
RUN DJANGO_SECRET_KEY=collectstatic-only \
    DATABASE_URL=sqlite:////tmp/collectstatic.db \
    DJANGO_ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput
USER app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
