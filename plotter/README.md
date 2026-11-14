# PlotterCAM · FLSUN Super Racer (pen plotter)

Web app (Docker) per disegnare, importare SVG e mandare in stampa i disegni sulla **FLSUN Super Racer
convertita in pen plotter** (Klipper + Moonraker), **senza aprire Mainsail**.
È un adattamento di CNC_V3 (stesso stack: FastAPI + React/Vite/Tailwind, tema scuro), ma qui il pezzo
è sempre un **foglio A4** e non ci sono materiale grezzo né percorsi utensile 3D.

```
plotter/
├── backend/            FastAPI: progetti, impostazioni, proxy Moonraker, invio job
├── frontend/           React + Vite + Tailwind (canvas 2D, layer, SVG, macchina)
│   └── scripts/build_fonts.py   rigenera i font a tratto singolo
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Avvio rapido (Docker)

```bash
cd plotter
cp .env.example .env          # opzionale: cambia MOONRAKER_URL / porta
docker compose up -d --build
```

Apri **http://localhost:3000** (oppure `http://<ip-del-pc>:3000`).

| Variabile | Default | Note |
|---|---|---|
| `MOONRAKER_URL` | `http://flsun.home` | Se `flsun.home` non viene risolto dentro al container usa l'IP, es. `http://192.168.1.132` (oppure `extra_hosts` in `docker-compose.yml`) |
| `MOONRAKER_API_KEY` | vuoto | Solo se Moonraker richiede autenticazione |
| `PORT` | `3000` | Porta sull'host |

I progetti e le impostazioni vengono salvati in `plotter/data/` (volume Docker).

### Sviluppo senza Docker

```bash
# backend
cd plotter/backend && pip install -r requirements.txt
MOONRAKER_URL=http://flsun.home python3 app.py        # → :3000
# frontend (hot reload, proxy /api → :3000)
cd plotter/frontend && npm install && npm run dev     # → :5174
```

## Funzioni

### Pannello macchina (colonna destra)
- **Stato Klipper** (ready / shutdown / error) con messaggio d'errore, posizione X/Y/Z e stato di homing.
  Se Klipper è in errore compaiono i pulsanti **Firmware restart** e **Restart**.
- **Homing** (`G28`), **Centro** foglio, **Penna su/giù**, **Motori off** (`M84`), **Emergenza** (`M112`).
- **Jog XY** (0,1 / 1 / 10 / 50 mm) e **jog Z** (0,01 / 0,1 / 1 / 10 mm).
- **Zero foglio**: abbassa la penna col jog Z finché tocca il foglio e premi **Salva Z corrente**
  (es. `-4.777`). Il valore resta salvato lato server tra una sessione e l'altra.
  In alternativa **Set Z=0 (G92)** rende Z=0 la posizione attuale (lo zero foglio diventa 0, valido fino al prossimo G28).
- **Console G-code** per comandi manuali.

### Disegno 2D + layer
- Strumenti: selezione/spostamento, linea, rettangolo, cerchio, polilinea, poligono, **casella di testo**.
- **Snap** alla griglia (0,5 – 10 mm), Alt = disattiva snap temporaneamente.
- Foglio A4 (210×297 mm) con **origine al centro**; il cerchio verde tratteggiato è l'**area
  raggiungibile** della Delta (`print_radius: 132` del printer.cfg).
  ⚠ Gli angoli e i bordi alto/basso dell'A4 sono fuori portata: l'app avvisa quando un tratto esce dal raggio.
- **Layer**: aggiungi, rinomina (doppio click), colore, visibilità (i layer nascosti non vengono disegnati),
  riordino trascinando (l'ordine della lista = ordine di disegno), elimina, “sposta selezionati nel layer attivo”.
  L'icona ⏸ inserisce una **pausa per cambio penna** prima del layer (`PAUSE`; poi **Riprendi** nell'app).
- Scorciatoie: `V L R C P G T` strumenti · `Canc` elimina · `Ctrl+Z / Ctrl+Y` annulla/ripeti ·
  `Ctrl+D` duplica · `Ctrl+A` seleziona tutto · frecce = sposta (Shift = 10 mm) · `F` adatta vista ·
  `Ctrl+S` salva · rotella = zoom · tasto destro/centrale = pan.

### Casella di testo
Clicca col tool **T** sul foglio, scrivi nel riquadro a sinistra (Invio = nuova riga). Opzioni:
- **14 font a tratto singolo** pensati per la penna (Hershey Sans/Serif/Script/Gothic, EMS Allure, Readability, Tech, …)
  più un font interno semplice; lettere accentate supportate.
- **Altezza** (mm, altezza delle maiuscole), **grassetto** (passate multiple sfalsate, spessore regolabile),
  **corsivo** (inclinazione regolabile in gradi), allineamento **sinistra / centro / destra**,
  **interlinea**, **spaziatura** tra le lettere, **rotazione**.
- **Punto di ancoraggio** (griglia 3×3): quale punto della casella sta sulle coordinate X/Y.
- **Posiziona sul foglio** (griglia 3×3 + margine): allinea la casella ai punti chiave dell'A4
  (angoli, centri dei lati, centro).
- Lo stile usato viene ricordato per le caselle successive.

### Progetti
Salva / apri / elimina progetti (lista ordinata per ultima modifica), esporta e importa il progetto in JSON.

### Import SVG → G-code
**Importa SVG**: si tracciano solo i **contorni** (stroke e bordi dei riempimenti, fill ignorato);
ogni colore diventa un **layer separato**. Imposti larghezza/altezza in mm (proporzioni bloccabili),
centro, “Adatta ad A4”, tolleranza di semplificazione e quali colori importare.
Gestisce path (curve, archi, trasformazioni), line, polyline, polygon, rect, circle, ellipse.
Testo SVG non convertito, `<use>` e immagini raster non sono supportati (in Inkscape: *Oggetto → Percorso*).
DXF non è supportato.

### G-code generato
- `G21` + `G90` (assoluto), opzionalmente `G28` a inizio/fine. Nessun comando E (niente estrusore).
- Penna giù = `zero foglio − pressione extra`, penna su = `zero foglio + alzata` (default 3 mm).
- Velocità: disegno `F600`, spostamenti `F3000`, discesa `F60`, salita `F180` (tutte configurabili in ⚙).
- Tratti ordinati per layer e per vicinanza (nearest-neighbour, con inversione dei tratti aperti).
- **Anteprima G-code**: spostamenti a vuoto tratteggiati in rosso, tratti col colore del layer e numero d'ordine.
- **Esporta G-code** scarica il file `.gcode`.

### Invio & disegno
- **Upload + Print** (default, consigliato): il file viene caricato su Moonraker in `gcodes/plottercam/`
  e avviato con `print/start`. Progresso dal `virtual_sdcard`, Stop = `CANCEL_PRINT`
  (la tua macro fa anche `G28` a fine annullamento), supporta pausa/ripresa.
- **Stream a blocchi**: invia N righe alla volta via `/printer/gcode/script` (progress = righe inviate).
- Il comando di ripresa di default è `RESUME_BASE`, perché il `RESUME` del tuo printer.cfg
  non fa nulla se il sensore filamento non rileva filamento.

## Note sulla macchina
- La Delta usa coordinate cartesiane con origine al centro del piano: X0 Y0 = centro foglio
  (correggibile con *offset centro foglio* nelle impostazioni).
- `minimum_z_position` nel printer.cfg deve essere sotto lo zero foglio (es. `-5` o `-10`),
  altrimenti Klipper rifiuta la discesa della penna.
- L'errore `ADC out of range` sull'estrusore (sensore scollegato) mette Klipper in shutdown anche se
  il plotter non usa l'hotend: va risolto nel printer.cfg / collegando un termistore, poi *Firmware restart*.

## Font
I font a tratto singolo sono in `frontend/src/lib/fonts/` (vedi `LICENSE.md` lì dentro: Hershey + EMS/OFL,
dal pacchetto npm `hersheytext`). Per rigenerarli:
`npm pack hersheytext && tar xzf hersheytext-*.tgz && python3 scripts/build_fonts.py package/svg_fonts`.
