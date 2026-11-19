# CNC V3

Sistema per CNC a 3 assi (Arduino Uno + GRBL 1.1h). Due componenti indipendenti:
il CAD/sender su PC e il controllo wireless su ESP8266. Si usano in alternativa
(la seriale dell'Uno è una sola).

## CAD + Sender (Docker)

Webapp con CAD 2D, generazione G-code per layer, visualizzatore 3D e invio a GRBL via USB.

```bash
docker compose up --build
```

Apri http://localhost:5550. La seriale predefinita è `/dev/ttyACM0` a 115200 baud
(`SERIAL_PORT`, `SERIAL_BAUD` in `docker-compose.yml`). Con la CNC collegata decommenta
la sezione `devices:`; se la porta non esiste il backend parte in **modalità simulazione**
(badge `SIM`). Progetti e database sono salvati nel volume `./data`.

## Controllo wireless (ESP8266)

Bridge WiFi tra browser e GRBL con interfaccia web integrata nel firmware: DRO, jog,
streaming G-code, air cut, E-STOP. Connettiti alla rete **CNC-Remote** (aperta, senza
password) e apri http://192.168.4.1.

Cablaggio, installazione e dettagli: [firmware/esp32_wireless_bridge/README.md](firmware/esp32_wireless_bridge/README.md).

## Struttura

```
backend/     API FastAPI, generatore G-code, sender seriale
frontend/    interfaccia React (CAD, viewer, controllo macchina)
firmware/    GRBL per Arduino Uno e bridge wireless ESP8266
data/        dati persistenti (database, progetti)
```

## Sviluppo locale (senza Docker)

```bash
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
python3 main.py                      # http://localhost:5550
```
