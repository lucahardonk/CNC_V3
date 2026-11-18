# Firmware — controllo wireless della CNC

Questa cartella contiene il firmware della CNC e del bridge WiFi:

```
firmware/
├── README.md               ← questo file (GRBL + panoramica)
├── grbl_test_bridge/       ← sketch ESP8266 di TEST del collegamento seriale
│   └── grbl_test_bridge.ino
└── grbl_remote/            ← firmware ESP8266 completo (web UI, streaming G-code, joystick)
    ├── grbl_remote.ino
    ├── config.h
    ├── data/index.html     ← interfaccia web (va caricata su LittleFS)
    └── README.md           ← guida dettagliata: librerie, LittleFS, uso, joystick PS4/T-29
```

Architettura:

```
Browser (PC/telefono/joystick)  ──WiFi──►  NodeMCU ESP8266  ──seriale 115200──►  Arduino Uno + GRBL 1.1h  ──►  driver/motori
                                            (AP "CNC-Remote")   via level shifter     (shield CNC)
```

---

## 1. GRBL 1.1h sull'Arduino Uno

La CNC usa **GRBL 1.1h** (`[VER:1.1h.20190825:]`). Il firmware ESP richiede la 1.1:
il formato dello status (`<Idle|MPos:...|FS:...>`), il jog `$J=` e gli override
real-time (0x90–0x9F) **non esistono** in GRBL 0.9.

### Dove scaricarlo
- Release ufficiale: <https://github.com/gnea/grbl/releases> → **v1.1h** (25/08/2019) → *Source code (zip)*
- Guida ufficiale di compilazione: <https://github.com/gnea/grbl/wiki/Compiling-Grbl>

### Come installarlo (Arduino IDE)
1. **Salva le impostazioni attuali** se stai sostituendo un Arduino: Monitor Seriale a 115200,
   invia `$$` e copia tutte le righe `$0=...` … `$132=...`; invia `$I` e annota la riga `[OPT:...]`.
2. Estrai lo zip. Dentro la cartella `grbl-1.1h.20190825` c'è **un'altra cartella `grbl`**:
   è quella (con dentro `examples`) che va installata.
3. Elimina eventuali vecchie versioni in `Documenti/Arduino/libraries/grbl`.
4. Arduino IDE → **Sketch → #include libreria → Aggiungi libreria da file .ZIP…** → scegli la cartella `grbl` interna.
5. **Scollega i fili su pin 0/1** dell'Uno (altrimenti l'upload fallisce).
6. **File → Esempi → grbl → grblUpload**, non modificarlo. Scheda **Arduino Uno**, porta corretta → **Carica**.
   L'avviso di poca memoria disponibile è normale.
7. Monitor Seriale a 115200: deve comparire `Grbl 1.1h ['$' for help]`.
   Reinserisci le impostazioni salvate una riga alla volta (ognuna deve rispondere `ok`).

Note:
- Il baud (115200) è fissato a compilazione in GRBL (`BAUD_RATE` in `grbl/config.h`), non si cambia con `$`.
- La Y doppia (2 motori) è gestita dallo shield CNC (ponticelli di clonazione asse), non da GRBL.

---

## 2. Collegamento ESP8266 ↔ Arduino Uno

| NodeMCU | GPIO | BSS138 LV | BSS138 HV | Arduino Uno |
|---|---|---|---|---|
| D5 (TX ESP) | GPIO14 | LV1 | HV1 | pin 0 (RX) |
| D6 (RX ESP) | GPIO12 | LV2 | HV2 | pin 1 (TX) |
| 3V3 | — | LV | — | — |
| — | — | — | HV | 5V (**non** AREF) |
| GND | — | GND | GND | GND |

- L'ESP8266 lavora a **3,3 V**: il TX dell'Uno (5 V) **non** va mai collegato direttamente a D6.
- GND in comune tra NodeMCU, level shifter e Uno.
- L'USB del NodeMCU resta libera per caricare il firmware (la seriale verso GRBL è software su D5/D6).
- Con l'Uno collegato al PC via USB non aprire la sua porta seriale mentre lavora l'ESP
  (il chip USB dell'Uno condivide i pin 0/1).

---

## 3. Firmware ESP8266

Scheda **NodeMCU 1.0 (ESP-12E Module)**, CPU **160 MHz**, core ESP8266 (URL Board Manager:
`https://arduino.esp8266.com/stable/package_esp8266com_index.json`).

### 3a. `grbl_test_bridge` — test del collegamento (fare per primo)
- Nessuna libreria esterna. Crea l'AP **CNC-Test** (senza password) → apri `http://192.168.4.1`.
- Pulsanti `?`, `$I`, `$$`: le risposte di GRBL compaiono nella pagina e sul Monitor Seriale USB (115200).
- Esito atteso con `$I`: `[VER:1.1h.20190825:]` `[OPT:V,15,128]` `ok`.

### 3b. `grbl_remote` — firmware completo
Interfaccia web (DRO, stato pin, visualizzatore toolpath, upload e streaming G-code con
character-counting, jog, override, editor `$$`, joystick PS4/T-29 tramite Gamepad API del browser).
Librerie, caricamento di `data/` su LittleFS e istruzioni d'uso: vedi [`grbl_remote/README.md`](grbl_remote/README.md).

Versioni con cui entrambi gli sketch compilano senza errori (`arduino-cli`, nodemcuv2 @160 MHz):
core ESP8266 3.1.2, EspSoftwareSerial 8.0.1 (incluso nel core), WebSockets 2.7.2, ArduinoJson 7.4.3.

### Correzione seriale applicata
In EspSoftwareSerial v8 la firma è
`begin(baud, config, rxPin, txPin, invert, bufCapacity, isrBufCapacity)`:
il 7° parametro **non** è un buffer di trasmissione ma il buffer dei fronti di segnale in ricezione
(ISR). Con il valore 64 usato inizialmente si ricevevano solo ~6–10 caratteri per risposta
(`<Idle|MPos�`). Ora è `0` (dimensionamento automatico = `bufCapacity × 10`):
- test bridge: `begin(115200, SWSERIAL_8N1, D6, D5, false, 256, 0)`
- firmware completo: `GRBL_SW_RXBUF 256`, `GRBL_SW_ISRBUF 0` in `config.h`

---

## Problemi noti

- **Perdita occasionale di caratteri a 115200 baud con SoftwareSerial.** Dopo la correzione le
  risposte brevi arrivano intere, ma nel test su hardware un `$$` lungo ha perso un carattere
  (`$1=0` al posto di `$21=0`) e la coda della risposta (da `$120` in poi). Per lo streaming G-code
  è critico: con il character-counting un `ok` perso blocca l'invio. Da risolvere e verificare
  su hardware prima di lavorare con la CNC.
- Il firmware completo `grbl_remote` è compilato ma **non ancora provato** su ESP8266 + GRBL + CNC.
