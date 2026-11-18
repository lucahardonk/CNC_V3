# GRBL-Remote v1.0 — Guida completa

Bridge WiFi per Arduino Uno + GRBL via NodeMCU ESP8266 (ESP-12E).

---

## Schema di cablaggio

```
Arduino Uno            BSS138 Level Shifter        NodeMCU ESP8266
─────────────          ────────────────────         ───────────────
TX  (pin 1) ────────── HV1 ──────── LV1 ─────────  D6  GPIO12  (RX)
RX  (pin 0) ────────── HV2 ──────── LV2 ─────────  D5  GPIO14  (TX)
5V  ────────────────── HV
                       LV  ─────────────────────── 3V3
GND ────────────────── GND ─────────────────────── GND

Alimentazione NodeMCU: via USB separato (raccomandata)
                    o  VIN del NodeMCU collegato a 5V Arduino (max 300mA)
```

> **IMPORTANTE** – i GPIO del NodeMCU lavorano a **3.3 V**.
> Il level shifter bidirezionale (BSS138 o simile) è **obbligatorio**
> sul collegamento Arduino TX → ESP RX per proteggere il chip.

### Perché D5 / D6 e non i pin 0/1 (USB)?

Usando SoftwareSerial su D5/D6 (GPIO14/GPIO12), la porta USB del NodeMCU
(GPIO1/GPIO3) resta **libera per caricare nuovo firmware** senza scollegare
nulla. Non c'è mai conflitto.

---

## Setup Arduino IDE

### 1 — Board Manager
Aggiungi l'URL del core ESP8266:
```
https://arduino.esp8266.com/stable/package_esp8266com_index.json
```
*(File → Preferenze → "URL aggiuntivi per il gestore schede")*

Installa: **ESP8266 by ESP8266 Community** ≥ 3.1.2

### 2 — Impostazioni Board

| Parametro        | Valore                             |
|------------------|------------------------------------|
| Board            | NodeMCU 1.0 (ESP-12E Module)       |
| **CPU Frequency**| **160 MHz**  ← obbligatorio        |
| Flash Size       | 4MB (FS: 2MB OTA: 1MB)             |
| Upload Speed     | 921600                             |
| Reset Method     | DTR (default)                      |

### 3 — Librerie (Library Manager)

| Libreria              | Autore            | Versione min |
|-----------------------|-------------------|--------------|
| `arduinoWebSockets`   | Links2004         | 2.4.1        |
| `EspSoftwareSerial`   | Juraj Andrassy    | 8.0.0        |
| `ArduinoJson`         | bblanchon         | 7.0.0        |

LittleFS è incluso nel core ESP8266 ≥ 3.0 — non serve installarlo.

### 4 — Plugin LittleFS Data Upload

Scarica il plugin per caricare la cartella `data/` su LittleFS:
- <https://github.com/earlephilhower/arduino-littlefs-upload/releases>
- Copia il `.vsix` / `.jar` nella cartella `tools/` di Arduino IDE
- Riavvia l'IDE

Poi: **Strumenti → ESP8266 LittleFS Data Upload**
*(Con la porta seriale non aperta da Serial Monitor)*

### 5 — Caricamento firmware

1. Collega NodeMCU via USB
2. Seleziona la porta COM corretta
3. Clicca **Upload** (il firmware viene caricato su flash)
4. Poi: **Strumenti → ESP8266 LittleFS Data Upload** (carica `data/index.html`)

---

## Primo avvio

1. Sul tuo PC/telefono cerca la rete WiFi **`CNC-Remote`**
2. Password: **`cnc12345`** (modificabile in `config.h`)
3. Apri il browser e vai su **`http://192.168.4.1`**
4. L'interfaccia si carica. Il LED verde in alto a destra indica "Connesso".
5. Accendi l'Arduino con GRBL → lo stato apparirà nella DRO.

---

## Utilizzo

### Jog manuale
- **Pulsanti freccia** nel pannello Jog
- **Tastiera numpad**: 4/6=X, 8/2=Y, +/-=Z, 7/9/1/3=diagonali
- **`[` e `]`**: cambia step size (0.01 → 50 mm)
- **Spazio**: Feed Hold | **`~`**: Cycle Start | **Ctrl+R**: Reset

### Gamepad PS4 / T-29
Collega il controller via USB o Bluetooth al dispositivo che apre il browser:

| Controllo       | Azione CNC                          |
|-----------------|-------------------------------------|
| Stick sinistro  | Jog XY continuo proporzionale       |
| R2 (grilletto)  | Jog Z+                              |
| L2 (grilletto)  | Jog Z−                              |
| D-pad           | Jog XY a step fisso                 |
| ✕ (croce)       | Stop Jog                            |
| ○ (cerchio)     | Feed Hold `!`                       |
| △ (triangolo)   | Cycle Start `~`                     |
| □ (quadrato)    | Zero X+Y+Z                          |
| L1 / R1         | Step size più piccolo / più grande  |
| OPTIONS         | Home `$H`                           |
| SHARE / L3      | Soft Reset `Ctrl+X`                 |

> Il gamepad funziona tramite la **Gamepad API del browser** (Chrome/Edge/Firefox).
> Non serve nessuna modifica hardware né al firmware.

### Caricamento G-code
1. Trascina il file `.nc/.gcode` nell'area drop (tab G-code)
2. Il file viene caricato su LittleFS dell'ESP8266 (visualizzato in anteprima 3D)
3. Premi **▶ Start** per avviare lo streaming
4. Usa **⏸ Pausa** o **⏹ Stop** in qualsiasi momento

### Probe Z automatico
1. Posiziona il probe sotto la punta utensile
2. Imposta: Profondità max (es. -20), Feed (es. 50), Spessore sonda (es. 2 mm)
3. Premi **🔩 Probe Z** → esegue G38.2, imposta Z=spessore, risale a Z5

### Impostazioni $$
- Tab **Impostazioni** → **↻ Carica $$**
- Modifica il valore nel campo e premi ✓ o Invio per salvare
- Usa il campo di ricerca per filtrare per numero o descrizione

---

## Personalizzazione (config.h)

```cpp
#define AP_SSID      "CNC-Remote"     // Nome rete WiFi
#define AP_PASSWORD  "cnc12345"       // Password (min 8 char)
#define GRBL_BAUD    115200           // Deve corrispondere a GRBL
#define MACHINE_X_MM 300.0f          // Corsa X (da $130)
#define MACHINE_Y_MM 200.0f          // Corsa Y (da $131)
#define MACHINE_Z_MM 80.0f           // Corsa Z (da $132)
```

---

## Troubleshooting

| Problema | Soluzione |
|---|---|
| "File non trovato" al caricamento pagina | Eseguire il plugin LittleFS Data Upload |
| GRBL non risponde | Verificare cablaggio level shifter e baud rate |
| Caratteri corrotti o righe troncate | Vedi `firmware/README.md` → *Problemi noti*. Il baud di GRBL si cambia solo ricompilando GRBL (`BAUD_RATE` in `grbl/config.h`), **non** con un parametro `$` |
| Gamepad non rilevato | Usare Chrome o Edge; verificare che il gamepad sia connesso **prima** di aprire la pagina |
| Upload G-code lento | File molto grandi (>1 MB) richiedono qualche secondo via WiFi |
| Jog continuo da gamepad instabile | Aumentare `DEAD = 0.15` nel JS fino a 0.25 |

---

## ✅ Versioni verificate in compilazione

Il firmware è stato compilato senza errori con `arduino-cli` (scheda **NodeMCU 1.0 ESP-12E**, CPU 160 MHz) usando:

| Componente | Versione |
|---|---|
| Core ESP8266 | 3.1.2 |
| WebSockets (Markus Sattler) | 2.7.2 |
| ArduinoJson (Benoit Blanchon) | 7.4.3 |
| EspSoftwareSerial (incluso nel core) | 8.0.1 |
| LittleFS (incluso nel core) | 0.1.0 |

Utilizzo memoria: flash 31 %, RAM 41 %.
