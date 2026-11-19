# arduino_uno_grbl — GRBL 1.1h per Arduino Uno

`arduino_uno_grbl.ino` è l'esempio **grblUpload** della libreria GRBL 1.1h, copiato senza modifiche
(licenza MIT in `license.txt`). Da solo non contiene GRBL: compila la libreria installata nell'IDE.

## 1. Scarica GRBL 1.1h
- <https://github.com/gnea/grbl/releases> → **v1.1h.20190825** → *Source code (zip)*
- Guida ufficiale: <https://github.com/gnea/grbl/wiki/Compiling-Grbl>

## 2. Installa la libreria
1. Estrai lo zip: dentro `grbl-1.1h.20190825/` c'è **un'altra cartella `grbl`** (quella con `examples`).
2. Cancella eventuali vecchie versioni in `Documenti/Arduino/libraries/grbl`.
3. Arduino IDE → **Sketch → #include libreria → Aggiungi libreria da file .ZIP…** → scegli la cartella `grbl` interna.

## 3. Carica sull'Uno
1. **Scollega i fili su pin 0/1** (level shifter), altrimenti l'upload fallisce.
2. Apri `arduino_uno_grbl.ino` (oppure *File → Esempi → grbl → grblUpload*).
3. Scheda **Arduino Uno**, porta corretta → **Carica**.
   L'avviso "Low memory available" è normale: GRBL usa ~92% della flash e ~79% della RAM.
4. Monitor Seriale a **115200**: deve comparire `Grbl 1.1h ['$' for help]`.

## 4. Impostazioni
Se sostituisci l'Arduino della CNC: prima salva l'output di `$$` dalla vecchia scheda, poi
reinserisci i valori sulla nuova una riga alla volta (ognuna risponde `ok`).
Controlla con `$I` che la riga `[OPT:...]` sia uguale (la CNC risponde `[OPT:V,15,128]`).

Note:
- Il baud (115200) è fisso nella compilazione di GRBL (`BAUD_RATE` in `grbl/config.h`).
- La Y doppia (2 motori) è gestita dallo shield CNC (ponticelli di clonazione asse), non da GRBL.
