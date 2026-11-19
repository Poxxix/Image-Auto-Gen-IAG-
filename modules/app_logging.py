"""Rotating file logger for Theme Image Set Studio (logs/app.log, rotated at 2 MB x 5)."""
import logging
from logging.handlers import RotatingFileHandler

from config import LOG_FILE_PATH, LOGS_DIR

_CONFIGURED = False


def get_logger(name: str = "studio") -> logging.Logger:
    global _CONFIGURED
    if not _CONFIGURED:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        root = logging.getLogger("studio")
        root.setLevel(logging.INFO)
        handler = RotatingFileHandler(
            LOG_FILE_PATH, maxBytes=2 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-5s [%(name)s] %(message)s")
        )
        root.addHandler(handler)
        console = logging.StreamHandler()
        console.setFormatter(logging.Formatter("%(asctime)s %(levelname)-5s %(message)s", "%H:%M:%S"))
        root.addHandler(console)
        root.propagate = False
        _CONFIGURED = True
    return logging.getLogger(name if name.startswith("studio") else f"studio.{name}")


logger = get_logger("studio")
