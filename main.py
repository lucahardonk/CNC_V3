#!/usr/bin/env python3
"""CNC V3 - Orchestratore principale.

Uso:  python3 main.py
Avvia il server FastAPI (API + WebSocket GRBL + frontend statico) sulla porta 5550
con log colorati tramite `rich`.
"""
import logging
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"

try:
    from rich.console import Console
    from rich.logging import RichHandler
    from rich.panel import Panel
    console = Console()
    HAS_RICH = True
except ImportError:  # fallback senza rich
    HAS_RICH = False

    class Console:  # type: ignore
        def print(self, msg, **kw):
            print(msg)

    class Panel:  # type: ignore
        @staticmethod
        def fit(msg, **kw):
            return msg

    console = Console()


def log(msg: str) -> None:
    console.print(f"[dim]{time.strftime('%H:%M:%S')}[/dim] {msg}")


def setup_logging() -> dict:
    """Configura il logging root (rich) e restituisce la log_config per uvicorn."""
    handlers = [RichHandler(console=console, rich_tracebacks=True, show_path=False, markup=False)] if HAS_RICH else [logging.StreamHandler()]
    logging.basicConfig(level=logging.INFO, format="%(message)s", datefmt="[%X]", handlers=handlers, force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)
    return None


def main() -> None:
    port = int(os.getenv("PORT", "5550"))
    console.print(Panel.fit(
        "[bold green]CNC V3[/bold green] [dim]v1.0[/dim]\n"
        "CAD 2D · Visualizzatore 3D · Controller GRBL\n"
        f"[dim]http://localhost:{port}[/dim]",
        border_style="bright_green", padding=(1, 4),
    ))

    data_dir = Path(os.getenv("DATA_DIR", str(ROOT / "data")))
    os.environ["DATA_DIR"] = str(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    log(f"[cyan]→[/cyan] Dati persistiti in: [bold]{data_dir}[/bold]")

    serial_port = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
    if Path(serial_port).exists():
        log(f"[green]✓[/green] Arduino rilevato su [bold]{serial_port}[/bold]")
    else:
        log(f"[yellow]⚠[/yellow] {serial_port} non trovato - modalità simulazione attiva")

    frontend_dist = Path(os.getenv("FRONTEND_DIST", str(ROOT / "frontend" / "dist")))
    os.environ["FRONTEND_DIST"] = str(frontend_dist)
    if (frontend_dist / "index.html").exists():
        log(f"[green]✓[/green] Frontend pronto in [bold]{frontend_dist}[/bold]")
    else:
        log(f"[yellow]⚠[/yellow] Frontend non trovato in {frontend_dist} (solo API disponibili)")

    log(f"[cyan]→[/cyan] Avvio server FastAPI sulla porta [bold]{port}[/bold]...")

    sys.path.insert(0, str(BACKEND_DIR))
    os.chdir(str(BACKEND_DIR))
    setup_logging()

    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=port, log_level="info",
                access_log=True, reload=False, log_config=None)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("[red]■[/red] Arresto richiesto dall'utente")
