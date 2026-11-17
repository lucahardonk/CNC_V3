# CNC V3

Applicazione full-stack in un unico container Docker: **CAD 2D + visualizzatore 3D + sender G-code** per CNC a 3 assi con Arduino/GRBL.

- Frontend: React 18 + Vite + Tailwind + Three.js (@react-three/fiber, drei) + Zustand
- Backend: FastAPI (Python 3.11) + pyserial + shapely + SQLite (async)
- Porta: **5550** → http://localhost:5550

## Avvio rapido (Docker)

```bash
docker compose up --build        # oppure: docker-compose up --build
```

Poi apri **http://localhost:5550**. Il container lancia automaticamente `python3 main.py`, che mostra log colorati (rich) con lo stato di dati, porta seriale e frontend.

## Porta seriale (GRBL)

Di default si usa `/dev/ttyACM0` a 115200 baud. Per cambiarla modifica `docker-compose.yml`:

```yaml
devices:
  - /dev/ttyUSB0:/dev/ttyUSB0
environment:
  - SERIAL_PORT=/dev/ttyUSB0
  - SERIAL_BAUD=115200
```

La porta può essere cambiata anche dall'interfaccia: **Impostazioni (⚙) → Macchina**.

**Modalità simulazione:** se la porta seriale non esiste, il backend passa automaticamente a un GRBL simulato (badge `SIM` in alto a destra), utile per testare senza macchina.
> Nota: per default la sezione `devices:` in `docker-compose.yml` è commentata (Docker rifiuta di avviare il container se il device non esiste sull'host). Quando la CNC è collegata via USB, decommenta **entrambe** le righe (`devices:` e `- /dev/ttyACM0:/dev/ttyACM0`) e riavvia con `docker compose up -d`.

Per l'accesso alla seriale l'utente potrebbe dover appartenere al gruppo `dialout` (`sudo usermod -aG dialout $USER`).

## Dati persistenti, backup

Tutto è salvato in `./data` (volume `./data:/app/data`):

- `projects.db` – progetti, layer, geometrie (SQLite)
- `settings.json`, `tools.json`, `materials.json` – configurazione, libreria utensili, profili materiale
- `gcode/` – G-code generati

**Export/Import:** Impostazioni → Esporta/Importa → *Esporta ZIP* (oppure `GET /api/export`) scarica un archivio con tutti i progetti e la configurazione. *Importa ZIP* ripristina tutto (i dati correnti vengono salvati prima in `data/backup_before_import/`).

## Flusso di lavoro

1. **Dashboard** → *Nuovo progetto*: nome, materiale, dimensioni del grezzo.
2. **Vista 3D**: grezzo centrato in origine (X0 Y0 = centro, Z0 = superficie superiore).
3. **Nuovo layer** → CAD 2D: linea, rettangolo, cerchio, arco, costruzione, trim, mirror, fillet, ponticelli (bridge).
4. **Genera percorso**: profilo esterno/interno/sul centro o pocket, con parametri da materiale + utensile.
5. **Taglio**: imposta lo zero pezzo con il jog, poi PLAY / PAUSA / STOP, console GRBL in tempo reale (WebSocket).

Scorciatoie CAD: `Alt` disattiva lo snap, `Shift` ortogonale, `Ctrl+Z`/`Ctrl+Y` annulla/ripeti, `Canc` elimina, `H` adatta vista, `Esc` annulla strumento.

### Import DXF

Nel CAD 2D, il pulsante **Importa DXF** in alto carica un file `.dxf`, che viene letto dal backend con [ezdxf](https://ezdxf.mozman.at/) (`POST /api/dxf/parse`).
- **Entità supportate:** LINE, ARC, CIRCLE, LWPOLYLINE e POLYLINE (i bulge diventano archi), SPLINE (approssimata con punti), ELLIPSE e blocchi INSERT (esplosi).
- **Unità:** vengono convertite in mm automaticamente in base a `$INSUNITS` (per esempio 4 = mm, 1 = pollici ×25.4).
- **Anteprima:** prima dell'inserimento si apre un'anteprima sullo stock. Qui si sceglie il posizionamento (centrato, angolo dello stock o coordinate originali), una scala aggiuntiva, quali layer importare e se importare come costruzione.
- **Layer:** i layer del DXF diventano layer di disegno, con il loro colore ACI/true color.

### Layer di disegno

Il pannello **Layer** a destra organizza le entità del layer di lavorazione corrente, in stile AutoCAD:
- **Per ogni layer:** visibilità (occhio), blocco (lucchetto), colore (clic sul quadratino) e nome (doppio clic per rinominare).
- **Layer 0:** è sempre presente e accoglie le entità non assegnate. Eliminando un layer (cestino), le sue entità passano al Layer 0.
- **Nuovo layer:** pulsante `+` (nome + colore). Il layer evidenziato è il *layer corrente*, dove finiscono le nuove entità.
- **Assegnare la selezione a un layer:** in tre modi:
  - tasto destro sul canvas → *Assegna a layer* (layer esistente o *Nuovo layer…*);
  - trascinare il badge "N entità selezionate" su un layer;
  - il menu *Layer* nel pannello Proprietà.
- **Layer nascosti:** non vengono disegnati e sono **esclusi dal G-code**.
- **Layer bloccati:** restano visibili (anche per lo snap), ma non sono selezionabili né modificabili.

### Selezione e misure

- **Selezione:**
  - click = entità più vicina;
  - trascinamento nel vuoto = selezione rettangolare;
  - `Ctrl`/`Shift`+click = aggiungi o rimuovi dalla selezione;
  - `Esc` = deseleziona.

  Le entità selezionate sono blu, con quadratini sui vertici.
- **Pannello Proprietà / Misure:** è sempre visibile.
  - **Linea:** lunghezza, ΔX, ΔY e angolo.
  - **Cerchio:** diametro, raggio e circonferenza.
  - **Arco:** raggio, angolo iniziale e finale, ampiezza, lunghezza dell'arco e corda.
  - **Selezione multipla:** numero di entità e lunghezza totale delle linee.
- **Misura distanza** (toolbar, gruppo misura, tasto `N`): click sul punto A, poi sul punto B → distanza, ΔX, ΔY e angolo, con snap sui punti.

## Sviluppo locale (senza Docker)

```bash
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
python3 main.py                      # http://localhost:5550
```

Hot reload del frontend: `cd frontend && npm run dev` (proxy `/api` → `localhost:5550`).

Variabili d'ambiente: `PORT` (5550), `DATA_DIR` (`./data`), `SERIAL_PORT`, `SERIAL_BAUD`, `FRONTEND_DIST`.

## Struttura

```
main.py              orchestratore (uvicorn + log rich)
backend/             FastAPI: routers/ (projects, layers, entities, tools, settings, grbl, export)
                     services/ (grbl_service.py, gcode_generator.py)
frontend/src/        pages/, components/ (cad, viewer3d, cutting, settings, dashboard, common), store/, services/
data/                volume persistente
```

> La cartella `V2/` contiene materiale della versione precedente e non è usata da CNC V3.
