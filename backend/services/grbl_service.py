"""Servizio GRBL: comunicazione seriale (pyserial) + simulatore + streaming G-code.

Singleton `grbl` usato da routers/grbl.py. Tutti gli eventi vengono inviati ai
client WebSocket tramite `subscribe()` / `broadcast()`.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import queue
import re
import threading
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("cnc.grbl")

try:
    import serial  # pyserial
except ImportError:  # pragma: no cover
    serial = None

STATUS_RE = re.compile(r"<([^|>]+)\|(.*)>")
RT_COMMANDS = {"?", "!", "~", "\x18", "\x85"}


# =========================================================================== simulatore
class SimulatedSerial:
    """Emula una scheda GRBL 1.1 per test senza macchina."""

    def __init__(self):
        self._out: "queue.Queue[str]" = queue.Queue()
        self._cmds: "queue.Queue[str]" = queue.Queue()
        self.is_open = True
        self.mpos = [0.0, 0.0, 0.0]
        self.wco = [0.0, 0.0, 0.0]
        self.state = "Idle"
        self.absolute = True
        self.feed = 500.0
        self.spindle = 0
        self.hold = False
        self._abort = False
        self._out.put("")
        self._out.put("Grbl 1.1h ['$' for help] [SIMULAZIONE]")
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()

    # --- API compatibile pyserial
    def write(self, data: bytes) -> int:
        text = data.decode(errors="ignore")
        buf = ""
        for ch in text:
            if ch == "?":
                self._out.put(self._status())
            elif ch == "!":
                self.hold = True
                if self.state in ("Run", "Jog"):
                    self.state = "Hold:0"
            elif ch == "~":
                self.hold = False
                if self.state.startswith("Hold"):
                    self.state = "Run"
            elif ch == "\x18":
                self._abort = True
                with self._cmds.mutex:
                    self._cmds.queue.clear()
                self.hold = False
                self.state = "Idle"
                self.spindle = 0
                self._out.put("Grbl 1.1h ['$' for help] [SIMULAZIONE]")
            elif ch == "\x85":
                self._abort = True
            elif ch == "\n":
                if buf.strip():
                    self._cmds.put(buf.strip())
                buf = ""
            elif ch != "\r":
                buf += ch
        return len(data)

    def readline(self) -> bytes:
        try:
            return (self._out.get(timeout=0.1) + "\r\n").encode()
        except queue.Empty:
            return b""

    def reset_input_buffer(self):
        pass

    def close(self):
        self.is_open = False

    # --- interni
    def _status(self) -> str:
        m = self.mpos
        return (f"<{self.state}|MPos:{m[0]:.3f},{m[1]:.3f},{m[2]:.3f}|FS:{int(self.feed)},{self.spindle}"
                f"|WCO:{self.wco[0]:.3f},{self.wco[1]:.3f},{self.wco[2]:.3f}>")

    def _words(self, line: str) -> dict[str, float]:
        out = {}
        for k, v in re.findall(r"([A-Z])\s*(-?\d*\.?\d+)", line.upper()):
            out.setdefault(k, float(v))
        return out

    def _move(self, target: list[float], feed: float, state: str):
        dist = math.dist(self.mpos, target)
        if dist < 1e-9:
            return
        duration = min(dist / max(feed, 1) * 60.0, 1.5)  # cappato per non bloccare la simulazione
        steps = max(1, int(duration / 0.03))
        start = list(self.mpos)
        self._abort = False
        self.state = state
        for i in range(1, steps + 1):
            while self.hold and not self._abort:
                time.sleep(0.05)
            if self._abort:
                break
            t = i / steps
            self.mpos = [start[j] + (target[j] - start[j]) * t for j in range(3)]
            time.sleep(duration / steps)
        self.state = "Idle" if not self.hold else self.state

    def _run(self):
        while self.is_open:
            try:
                line = self._cmds.get(timeout=0.2)
            except queue.Empty:
                continue
            up = re.sub(r"\(.*?\)|;.*", "", line).strip().upper()
            if not up:
                self._out.put("ok")
                continue
            if up == "$X":
                self.state = "Idle"
                self._out.put("[MSG:Caution: Unlocked]")
            elif up == "$H":
                self._move([0.0, 0.0, 0.0], 2000, "Home")
            elif up == "$$":
                for s in ("$0=10", "$1=25", "$10=1", "$100=800.000", "$101=800.000", "$102=800.000",
                          "$110=2000.000", "$111=2000.000", "$112=500.000"):
                    self._out.put(s)
            elif up.startswith("$J="):
                w = self._words(up[3:])
                rel = "G91" in up
                tgt = list(self.mpos)
                for i, ax in enumerate("XYZ"):
                    if ax in w:
                        tgt[i] = (self.mpos[i] + w[ax]) if rel else (w[ax] + self.wco[i])
                self._out.put("ok")
                self._move(tgt, w.get("F", 1000), "Jog")
                continue
            elif up.startswith("$"):
                pass
            else:
                if "G90" in up:
                    self.absolute = True
                if "G91" in up and not up.startswith("G91.1"):
                    self.absolute = False
                w = self._words(up)
                if "M3" in re.findall(r"M\d+", up) or "M4" in re.findall(r"M\d+", up):
                    self.spindle = int(w.get("S", self.spindle or 10000))
                if "M5" in re.findall(r"M\d+", up) or "M30" in re.findall(r"M\d+", up):
                    self.spindle = 0
                if "F" in w:
                    self.feed = w["F"]
                if re.search(r"G10\s*L20", up) or "G92" in up:
                    for i, ax in enumerate("XYZ"):
                        if ax in w:
                            self.wco[i] = self.mpos[i] - w[ax]
                elif "G4" in up:
                    pass
                elif any(ax in w for ax in "XYZ"):
                    rapid = re.search(r"\bG0*0\b", up) is not None
                    tgt = list(self.mpos)
                    for i, ax in enumerate("XYZ"):
                        if ax in w:
                            tgt[i] = (w[ax] + self.wco[i]) if self.absolute else self.mpos[i] + w[ax]
                    self._move(tgt, 3000 if rapid else self.feed, "Run")
            self._out.put("ok")


# =========================================================================== servizio
class GRBLService:
    def __init__(self):
        self.port: str = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
        self.baud: int = int(os.getenv("SERIAL_BAUD", "115200"))
        self.ser: Any = None
        self.simulated = False
        self.connected = False
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._reader: Optional[threading.Thread] = None
        self._poller: Optional[asyncio.Task] = None
        self._write_lock = threading.Lock()
        self._subscribers: set[asyncio.Queue] = set()
        self._ack: Optional[asyncio.Queue] = None
        self.poll_interval = 0.25
        self.state = "Disconnected"
        self.mpos = [0.0, 0.0, 0.0]
        self.wpos = [0.0, 0.0, 0.0]
        self.wco = [0.0, 0.0, 0.0]
        self.feed = 0.0
        self.spindle = 0.0
        self.job: dict[str, Any] = {"running": False, "paused": False, "sent": 0, "acked": 0, "total": 0,
                                    "layer_id": None, "errors": 0}
        self._job_task: Optional[asyncio.Task] = None
        self._stop_job = False

    # ------------------------------------------------------------------ pub/sub
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    def broadcast(self, msg: dict):
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    def _emit_log(self, direction: str, text: str):
        self.broadcast({"type": "log", "dir": direction, "text": text, "t": time.time()})

    def snapshot(self) -> dict:
        return {
            "type": "status", "connected": self.connected, "simulated": self.simulated,
            "port": self.port, "baud": self.baud, "state": self.state,
            "mpos": self.mpos, "wpos": self.wpos, "wco": self.wco,
            "feed": self.feed, "spindle": self.spindle, "job": dict(self.job),
        }

    # ------------------------------------------------------------------ connessione
    async def connect(self, port: Optional[str] = None, baud: Optional[int] = None, simulate: bool = False) -> dict:
        if self.connected:
            await self.disconnect()
        self.loop = asyncio.get_running_loop()
        self.port = port or self.port
        self.baud = int(baud or self.baud)
        self._ack = asyncio.Queue()
        if not simulate and serial is not None and Path(self.port).exists():
            try:
                self.ser = await asyncio.to_thread(serial.Serial, self.port, self.baud, timeout=0.1, write_timeout=2)
                self.simulated = False
                await asyncio.sleep(2.0)  # Arduino si resetta all'apertura della seriale
                log.info("Connesso a GRBL su %s @ %d", self.port, self.baud)
            except Exception as exc:  # noqa: BLE001
                log.warning("Impossibile aprire %s (%s) - passo in simulazione", self.port, exc)
                self._emit_log("sys", f"Errore apertura {self.port}: {exc}. Modalità simulazione.")
                self.ser = SimulatedSerial()
                self.simulated = True
        else:
            if not simulate:
                log.warning("Porta %s non disponibile - modalità simulazione", self.port)
            self.ser = SimulatedSerial()
            self.simulated = True
        self.connected = True
        self.state = "Idle"
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        self._poller = asyncio.create_task(self._poll_loop())
        self._emit_log("sys", f"Connesso {'(SIMULAZIONE)' if self.simulated else ''} {self.port} @ {self.baud}")
        self.broadcast(self.snapshot())
        return self.snapshot()

    async def disconnect(self) -> dict:
        self._stop_job = True
        if self._poller:
            self._poller.cancel()
            self._poller = None
        self.connected = False
        if self.ser is not None:
            try:
                await asyncio.to_thread(self.ser.close)
            except Exception:  # noqa: BLE001
                pass
        self.ser = None
        self.state = "Disconnected"
        log.info("Disconnesso da GRBL")
        self._emit_log("sys", "Disconnesso")
        self.broadcast(self.snapshot())
        return self.snapshot()

    # ------------------------------------------------------------------ I/O
    def _write_raw(self, data: bytes):
        if not self.connected or self.ser is None:
            raise RuntimeError("GRBL non connesso")
        with self._write_lock:
            self.ser.write(data)

    async def write_line(self, line: str, echo: bool = True):
        await asyncio.to_thread(self._write_raw, (line.strip() + "\n").encode())
        if echo:
            self._emit_log("tx", line.strip())

    async def realtime(self, ch: str):
        await asyncio.to_thread(self._write_raw, ch.encode())

    def _read_loop(self):
        while self.connected and self.ser is not None:
            try:
                raw = self.ser.readline()
            except Exception as exc:  # noqa: BLE001
                log.error("Errore lettura seriale: %s", exc)
                if self.loop:
                    self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self.disconnect()))
                break
            if not raw:
                continue
            line = raw.decode(errors="ignore").strip()
            if line and self.loop:
                self.loop.call_soon_threadsafe(self._handle_line, line)

    def _handle_line(self, line: str):
        if line.startswith("<"):
            self._parse_status(line)
            return
        if line == "ok" or line.startswith("error"):
            if self._ack is not None:
                self._ack.put_nowait(line)
            if line.startswith("error"):
                self._emit_log("rx", line)
            elif not self.job["running"]:
                self._emit_log("rx", line)
            return
        if line.startswith("ALARM"):
            self.state = "Alarm"
            log.warning("GRBL %s", line)
        if line.startswith("Grbl"):
            log.info("Banner: %s", line)
        self._emit_log("rx", line)

    def _parse_status(self, line: str):
        m = STATUS_RE.match(line)
        if not m:
            return
        self.state = m.group(1)
        wpos = None
        for field in m.group(2).split("|"):
            if ":" not in field:
                continue
            k, v = field.split(":", 1)
            nums = [float(x) for x in v.split(",") if x]
            if k == "MPos":
                self.mpos = nums[:3]
            elif k == "WPos":
                wpos = nums[:3]
            elif k == "WCO":
                self.wco = nums[:3]
            elif k == "FS":
                self.feed, self.spindle = nums[0], nums[1] if len(nums) > 1 else 0
            elif k == "F":
                self.feed = nums[0]
        if wpos is not None:
            self.wpos = wpos
            self.mpos = [wpos[i] + self.wco[i] for i in range(3)]
        else:
            self.wpos = [self.mpos[i] - self.wco[i] for i in range(3)]
        self.broadcast(self.snapshot())

    async def _poll_loop(self):
        try:
            while self.connected:
                try:
                    await self.realtime("?")
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(self.poll_interval)
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------ comandi
    async def command(self, cmd: str) -> None:
        cmd = cmd.strip()
        if cmd in RT_COMMANDS:
            await self.realtime(cmd)
            self._emit_log("tx", repr(cmd))
            return
        await self.write_line(cmd)

    async def jog(self, x: float = 0, y: float = 0, z: float = 0, feed: float = 1000) -> str:
        parts = [f"{ax}{v:.3f}" for ax, v in (("X", x), ("Y", y), ("Z", z)) if abs(v) > 1e-9]
        if not parts:
            return ""
        cmd = f"$J=G91 G21 {' '.join(parts)} F{feed:.0f}"
        await self.write_line(cmd)
        return cmd

    async def jog_cancel(self):
        await self.realtime("\x85")

    async def zero_axis(self, axis: str) -> str:
        axis = axis.upper()
        axes = "XYZ" if axis == "ALL" else axis
        if any(a not in "XYZ" for a in axes):
            raise ValueError("Asse non valido")
        # G10 L20 P1 = imposta lo zero pezzo (G54) alla posizione corrente, persistente in EEPROM
        cmd = "G10 L20 P1 " + " ".join(f"{a}0" for a in axes)
        await self.write_line(cmd)
        return cmd

    async def emergency_stop(self):
        self._stop_job = True
        try:
            await self.realtime("!")
            await asyncio.sleep(0.1)
            await self.realtime("\x18")
        finally:
            self._emit_log("sys", "EMERGENCY STOP: feed hold + soft reset")
            log.warning("EMERGENCY STOP inviato")
            self.job.update(running=False, paused=False)
            self.broadcast(self.snapshot())

    async def pause(self):
        await self.realtime("!")
        self.job["paused"] = True
        self.broadcast(self.snapshot())

    async def resume(self):
        await self.realtime("~")
        self.job["paused"] = False
        self.broadcast(self.snapshot())

    # ------------------------------------------------------------------ streaming
    @staticmethod
    def clean_lines(gcode: str) -> list[str]:
        out = []
        for raw in gcode.splitlines():
            line = re.sub(r"\(.*?\)|;.*", "", raw).strip()
            if line:
                out.append(line)
        return out

    async def start_job(self, gcode: str, layer_id: Optional[str] = None) -> dict:
        if not self.connected:
            raise RuntimeError("GRBL non connesso")
        if self.job["running"]:
            raise RuntimeError("Un lavoro è già in esecuzione")
        lines = self.clean_lines(gcode)
        if not lines:
            raise ValueError("G-code vuoto")
        self._stop_job = False
        self.job = {"running": True, "paused": False, "sent": 0, "acked": 0, "total": len(lines),
                    "layer_id": layer_id, "errors": 0, "started_at": time.time()}
        self._job_task = asyncio.create_task(self._run_job(lines))
        log.info("Avvio lavoro: %d linee (layer %s)", len(lines), layer_id)
        self._emit_log("sys", f"Avvio lavoro: {len(lines)} linee")
        return dict(self.job)

    async def _run_job(self, lines: list[str]):
        assert self._ack is not None
        while not self._ack.empty():
            self._ack.get_nowait()
        try:
            for i, line in enumerate(lines):
                if self._stop_job or not self.connected:
                    break
                await self.write_line(line, echo=True)
                self.job["sent"] = i + 1
                while True:
                    try:
                        resp = await asyncio.wait_for(self._ack.get(), timeout=1.0)
                        break
                    except asyncio.TimeoutError:
                        if self._stop_job or not self.connected:
                            resp = None
                            break
                if resp is None:
                    break
                self.job["acked"] = i + 1
                if resp.startswith("error"):
                    self.job["errors"] += 1
                    self._emit_log("sys", f"Errore alla linea {i + 1}: {line} -> {resp}")
                if (i % 5) == 0:
                    self.broadcast(self.snapshot())
            done = not self._stop_job and self.job["acked"] == self.job["total"]
            msg = "Lavoro completato (attendi fine movimenti)" if done else "Lavoro interrotto"
            log.info(msg)
            self._emit_log("sys", msg)
            self.broadcast({"type": "job_done", "completed": done, "layer_id": self.job.get("layer_id")})
        finally:
            self.job["running"] = False
            self.job["paused"] = False
            self.broadcast(self.snapshot())

    async def stop_job(self):
        self._stop_job = True


grbl = GRBLService()
