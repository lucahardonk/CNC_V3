# esp32_wireless_bridge — controllo remoto della CNC via WiFi

Firmware per **NodeMCU 1.0 (ESP8266 / ESP-12E)** che fa da ponte WiFi verso l'Arduino Uno con
**GRBL 1.1h** e serve un'interfaccia web completa. (Il nome della cartella dice "esp32", ma la scheda
supportata è l'ESP8266 NodeMCU.)

```
esp32_wireless_bridge/
├── esp32_wireless_bridge.ino   firmware
├── config.h                    parametri (WiFi, pin, tempi)
├── index_html.h                interfaccia web compressa (GENERATO)
├── data/index.html             sorgente dell'interfaccia web
└── tools/embed_html.py         rigenera index_html.h da data/index.html
```

---

## Cablaggio (⚠ RX su D7, TX su D4 da v2.5)

| NodeMCU | GPIO | BSS138 LV | BSS138 HV | Arduino Uno |
|---|---|---|---|---|
| **D4** (TX ESP, Serial1) | GPIO2 | LV1 | HV1 | **pin 0 (RX)** |
| **D7** (RX ESP) | GPIO13 | LV2 | HV2 | **pin 1 (TX)** |
| 3V3 | — | LV | — | — |
| — | — | — | HV | 5V (non AREF) |
| GND | — | GND | GND | GND |

- Rispetto al primo test **la ricezione si sposta da D6 a D7**: D7 è il pin RX della UART
  *hardware* dell'ESP8266 (spostata con `Serial.swap()`). La SoftwareSerial perdeva caratteri
  sulle risposte lunghe (es. `$$`) quando il WiFi lavorava; la UART hardware ha FIFO e buffer
  da 2 KB e non ne risente.
- **Da v2.5 anche la trasmissione è hardware**: Serial1 (UART1, solo TX) su **D4 (GPIO2)**.
  Sposta il filo che andava da **D5** a LV1 su **D4**. Niente più SoftwareSerial.
  D4 è anche il LED blu della scheda: lampeggia quando si inviano comandi (normale).
- **D8 (GPIO15) non va collegato**: deve stare basso all'accensione, altrimenti l'ESP non parte.
- Il TX dell'Uno (5 V) passa **sempre** dal level shifter. GND in comune.
- Mentre lavora l'ESP non aprire la porta seriale dell'Uno dal PC (il suo chip USB usa pin 0/1).

### La USB del NodeMCU
- **Caricare il firmware via USB funziona sempre** (lo swap avviene solo dopo l'avvio).
- Il Monitor Seriale mostra solo il banner iniziale; poi la UART serve a GRBL.
  Tutto il traffico GRBL è visibile nella **console della pagina web**.
  Non ci sono più log di debug seriali (D4 ora è il TX verso GRBL).

---

## Installazione

1. **Core ESP8266**: in *File → Impostazioni → URL aggiuntive* aggiungi
   `https://arduino.esp8266.com/stable/package_esp8266com_index.json`, poi installa **esp8266**
   dal Gestore schede (testato 3.1.2).
2. **Librerie** (Gestore librerie):
   - **WebSockets** di *Markus Sattler* (testato 2.7.2)
   - **ArduinoJson** di *Benoit Blanchon* (testato 7.4.3, serve la 7.x)
   - LittleFS è già incluso nel core.
3. **Strumenti**: Scheda *NodeMCU 1.0 (ESP-12E Module)*, CPU *160 MHz*,
   Flash Size *4MB (FS:2MB OTA:~1019KB)*, porta del NodeMCU.
4. Apri `esp32_wireless_bridge.ino` → **Carica**.

**Non serve caricare file su LittleFS**: la pagina web è dentro il firmware (`index_html.h`).
LittleFS serve solo a salvare il G-code e al primo avvio si formatta da solo (qualche secondo).

Se modifichi `data/index.html`: `python3 tools/embed_html.py` e ricarica il firmware.

---

## Primo test

1. Alimenta NodeMCU e Uno, collegati come sopra.
2. Connettiti al WiFi **CNC-Remote** (password `cnc12345`, modificabile in `config.h`).
3. Apri **http://192.168.4.1**.
4. In alto deve comparire lo stato GRBL (Idle/Alarm) e i DRO si aggiornano.
   Se resta *Disconnected* l'ESP non riceve nulla da GRBL: controlla il filo pin 1 → HV2/LV2 → **D7**.
5. Tab **MDI**: invia `$I` e `$$`. Le risposte devono arrivare intere
   (`$$` fino a `$132=...` e `ok`). Il tab **Impostazioni** → *Carica $$* deve mostrare tutti i parametri.
6. Solo dopo, con la CNC collegata: jog a passi piccoli, poi un G-code di prova "in aria".

---

## Utilizzo

### Jog manuale
- Pulsanti freccia nel pannello Jog
- Tastiera numpad: 4/6=X, 8/2=Y, +/-=Z, 7/9/1/3=diagonali
- `[` e `]`: cambia lo step (0.01 → 50 mm)
- Spazio: Feed Hold | `~`: Cycle Start | Ctrl+R: Reset

### Visualizzatore 3D (stile CAD)
- Pulsante **⚙ Mouse** nella barra del visualizzatore: scegli il preset (salvato nel browser)
  - **Fusion 360**: centrale = pan, Shift+centrale = ruota, Ctrl+centrale = zoom
  - **SolidWorks**: centrale = ruota, Ctrl+centrale = pan, Shift+centrale = zoom
  - **Sinistro/Destro**: sinistro = ruota, destro (o Shift+sinistro) = pan
- Rotella = zoom (opzioni "Zoom verso il cursore" e "Inverti rotella"), doppio clic = adatta
- Touch: 1 dito ruota, 2 dita pan/pinch

### Errori e allarmi
In console ogni `error:N` / `ALARM:N` di GRBL viene mostrato con il suo significato
(es. `error:8 — comando $ consentito solo a macchina ferma (Idle)`).

### Job G-code
1. Tab **G-code**: trascina il file `.nc/.gcode` o usa il selettore. Viene salvato sull'ESP
   (commenti rimossi) e mostrato nel visualizzatore.
2. **▶ Start** avvia lo streaming (flow control a conteggio caratteri sul buffer da 128 byte di GRBL).
3. **⏸ Pausa**: feed-hold + sospende l'invio; di nuovo per riprendere.
4. **⏹ Stop**: feed-hold, poi soft-reset appena la macchina è ferma (così non si perde la posizione).
- Durante un job i comandi manuali (MDI, jog, zero, $$) vengono rifiutati; restano attivi
  Hold/Start/Reset e gli override.
- Su `error:N` il job va in pausa automaticamente; su `ALARM` si ferma.

### Probe Z, Impostazioni $$
- **Probe Z**: G38.2 con profondità, feed e spessore sonda impostabili.
- **Impostazioni**: *Carica $$*, modifica il valore e conferma con ✓ o Invio.

---

## Versioni
- **v2.1**: rimosso il gamepad, visualizzatore 3D con mouse stile Fusion/SolidWorks, significato di errori/allarmi in console
- **v2.0**: RX hardware su D7, interfaccia incorporata nel firmware

## Problemi comuni

| Problema | Soluzione |
|---|---|
| Stato sempre *Disconnected* | Filo GRBL TX → HV2/LV2 → **D7**, GND comune, LV a 3,3 V e HV a 5 V |
| GRBL non esegue i comandi | Filo D4 → LV1/HV1 → pin 0 dell'Uno; porta seriale dell'Uno chiusa sul PC |
| L'ESP non parte con i fili collegati | Qualcosa è collegato a D8 (GPIO15) o D3/D4 tenuti a massa (D4 va solo a LV1) |
| Il baud va cambiato | In GRBL 1.1h si cambia solo ricompilando GRBL (`BAUD_RATE` in `grbl/config.h`), poi `GRBL_BAUD` in `config.h` |
