"""
gunicorn settings used on Kubernetes (`gunicorn --config python:config.gunicorn …`).

Each gunicorn worker is a separate process with its own Prometheus counters. With
PROMETHEUS_MULTIPROC_DIR set, prometheus_client writes every process's values to files in that
directory and /metrics adds them up, so a scrape sees the whole pod rather than whichever worker
happened to answer.
"""

import os
import shutil


def on_starting(server):
    # Start from an empty directory: files left by a previous run would count twice.
    directory = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if directory:
        shutil.rmtree(directory, ignore_errors=True)
        os.makedirs(directory, exist_ok=True)


def child_exit(server, worker):
    # A worker that exits (restart, timeout) must stop contributing live gauges.
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        from prometheus_client import multiprocess

        multiprocess.mark_process_dead(worker.pid)
