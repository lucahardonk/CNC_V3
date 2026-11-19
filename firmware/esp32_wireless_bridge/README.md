# esp32_wireless_bridge

Firmware per NodeMCU 1.0 (ESP8266 / ESP-12E): bridge WiFi per GRBL 1.1h su Arduino Uno.
Crea un access point, serve l'interfaccia web (integrata nel firmware) e gestisce
streaming G-code, jog e air cut via WebSocket.

## Cablaggio

| NodeMCU | GPIO | BSS138 LV | BSS138 HV | Arduino Uno |
|---|---|---|---|---|
| **D4** (TX, Serial1) | GPIO2 | LV1 | HV1 | **pin 0 (RX)** |
| **D7** (RX, UART0) | GPIO13 | LV2 | HV2 | **pin 1 (TX)** |
| 3V3 | — | LV | — | — |
| — | — | — | HV | 5V |
| GND | — | GND | GND | GND |

- **D8 (GPIO15) non va collegato**: deve restare basso all'avvio, altrimenti l'ESP non parte.
- Il LED blu della scheda è su D4: lampeggia durante la trasmissione verso GRBL (normale).
- Con il bridge in funzione l'USB dell'Arduino non deve essere collegata al PC (usa i pin 0/1).

## Installazione

1. Core ESP8266: in *File → Impostazioni → URL aggiuntive* aggiungi
   `https://arduino.esp8266.com/stable/package_esp8266com_index.json` e installa **esp8266** (testato 3.1.2).
2. Librerie: **WebSockets** di Markus Sattler (2.7.2) e **ArduinoJson** di Benoit Blanchon (7.x).
3. Scheda *NodeMCU 1.0 (ESP-12E Module)*, CPU *160 MHz*, Flash *4MB (FS:2MB OTA:~1019KB)*.
4. Carica lo sketch. Non serve caricare nulla su LittleFS: l'HTML è incorporato nel firmware.

## Connessione

Rete WiFi **CNC-Remote** (aperta, senza password) → http://192.168.4.1
(HTTP porta 80, WebSocket porta 81). SSID e canale si cambiano in `config.h`.

## Modifica UI

Dopo aver modificato `data/index.html`: `python3 tools/embed_html.py`, poi ricompila e ricarica.

## Compilazione da CLI

```bash
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2:xtal=160 firmware/esp32_wireless_bridge
```

## Funzionalità

- DRO posizione lavoro/macchina, stato GRBL, pin e override
- Jog con step preimpostati o personalizzati (tasti `[` `]`, tastierino numerico)
- Streaming G-code con flow control a conteggio caratteri, pausa automatica sugli errori
- Air cut ingombro: perimetro XY del file a quota di sicurezza, mandrino spento
- E-STOP (feed hold + reset controllato)
- Badge RAM dell'ESP (heap libero e blocco massimo)
- Viewer G-code 3D con overlay della punta
