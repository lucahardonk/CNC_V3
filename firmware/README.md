# Firmware — controllo wireless della CNC

```
firmware/
├── arduino_uno_grbl/        GRBL 1.1h per l'Arduino Uno (esempio grblUpload della libreria)
└── esp32_wireless_bridge/   firmware NodeMCU ESP8266: WiFi + interfaccia web completa
```

```
Browser / joystick PS4  ──WiFi──►  NodeMCU ESP8266  ──seriale 115200──►  Arduino Uno + GRBL 1.1h  ──►  shield / driver / motori
                                   AP "CNC-Remote"     via level shifter
                                   http://192.168.4.1   BSS138
```

## Ordine di installazione
1. **Arduino Uno** → [`arduino_uno_grbl/README.md`](arduino_uno_grbl/README.md): scarica GRBL **1.1h**
   (<https://github.com/gnea/grbl/releases>), installa la libreria e carica lo sketch.
2. **NodeMCU** → [`esp32_wireless_bridge/README.md`](esp32_wireless_bridge/README.md): librerie, caricamento, uso.
3. **Cablaggio** (riassunto):

| NodeMCU | GPIO | Level shifter | Arduino Uno |
|---|---|---|---|
| D5 (TX) | GPIO14 | LV1 ⇄ HV1 | pin 0 (RX) |
| D7 (RX) | GPIO13 | LV2 ⇄ HV2 | pin 1 (TX) |
| 3V3 | — | LV | — |
| — | — | HV | 5V |
| GND | — | GND | GND |

GRBL 1.1h è obbligatorio: il formato dello status `<Idle|MPos:...>`, il jog `$J=` e gli override
real-time non esistono in GRBL 0.9.

## Versioni verificate in compilazione (`arduino-cli`)
| Sketch | Scheda | Versioni |
|---|---|---|
| arduino_uno_grbl | arduino:avr:uno | GRBL 1.1h.20190825 — flash 92%, RAM 79% |
| esp32_wireless_bridge | esp8266:nodemcuv2 @160 MHz | core 3.1.2, WebSockets 2.7.2, ArduinoJson 7.4.3 — flash 33%, RAM 41% |

## Note sulla seriale
- Con la SoftwareSerial in ricezione si perdevano caratteri sulle risposte lunghe (`$$`):
  prima per un parametro sbagliato di EspSoftwareSerial (7° parametro = buffer ISR, non TX),
  poi per i ritardi del WiFi a 115200 baud. La versione attuale riceve con la **UART hardware**
  (`Serial.swap()` → D7) e trasmette in software su D5.
- Da verificare su hardware: test `$$` completo, jog, job G-code di prova.
