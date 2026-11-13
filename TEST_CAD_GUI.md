# Test GUI del CAD – punti, vincoli e quote guida

Data: 13/11/2026 · branch `all_in_one`
Ambiente: browser Chrome della VM di sviluppo, backend FastAPI locale (porta 5550), progetto di prova con grezzo 200×150 mm.
**Non testato sulla CNC reale né sul NUC.**

Ogni test è stato fatto con mouse e tastiera reali sull'interfaccia. Dove serviva, il risultato salvato è stato controllato anche via API (`/api/layers/<id>/entities`).

## Cosa è stato implementato

- **Punti chiave come parte della figura.** Si trascina un punto chiave con lo strumento Selezione:
  - estremi di linea e punti di spline: si stirano;
  - vertici del rettangolo, centro di cerchio/arco/ellisse/asola: spostano la figura intera.
- **Snap durante il trascinamento** sull'origine e sui punti delle altre figure.
- **Vincolo di coincidenza** quando si rilascia un punto su un altro punto (o sull'origine):
  - marker = quadratino verde, che diventa blu quando è selezionato;
  - si seleziona con un click e si elimina con Canc;
  - vincoli automatici quando si disegna partendo da un punto esistente (linee in catena, raccordi);
  - due figure che condividono un punto ruotano attorno ad esso come un cardine.
- **Quote guida che posizionano la geometria** (click sull'etichetta → nuovo valore → la geometria si adatta). Tipi supportati:
  - lunghezza di una linea;
  - lato del rettangolo;
  - diametro/raggio;
  - distanza punto-punto, anche tra figure diverse o verso l'origine;
  - angolo tra due linee.
- **Solver iterativo.** Durante il trascinamento l'anteprima è già risolta. Se una modifica di quota è impossibile, viene rifiutata con un messaggio invece di stravolgere il disegno.
- **Persistenza.** Vincoli e collegamenti delle quote vengono salvati (in `data._meta`) e sopravvivono al ricaricamento della pagina.
- **G-code.** Il generatore ignora le entità `constraint`.

## Risultati (20 test)

| # | Test | Esito | Note |
|---|------|-------|------|
| 1 | Triangolo con linee in catena dall'origine | ✅ | 4 vincoli automatici, di cui 2 con l'origine |
| 2 | Quota lunghezza sulla base | ✅ | "60.00 mm" |
| 3 | Modifica della quota a 80 | ✅ | La base si allunga, il triangolo resta chiuso |
| 4 | Quota angolare tra base e lato | ✅ (corretto) | L'etichetta con l'arco piccolo non era cliccabile → ora è cliccabile (raggio minimo, click sull'etichetta) |
| 5 | Modifica dell'angolo a 45° | ✅ | Il triangolo resta chiuso, il valore è salvato |
| 6 | Trascinamento dell'apice | ✅ | Base 80 e angolo 45° rispettati (l'apice scorre lungo la retta a 45°) |
| 7 | Rettangolo trascinato per un vertice sul vertice del triangolo | ✅ | Snap + "Vincolo di coincidenza creato" |
| 8 | Nuova linea che parte dall'apice | ✅ | Vincolo automatico |
| 9 | Trascinamento dell'estremo libero di quella linea | ✅ | Si stira solo quell'estremo, l'altro resta incernierato |
| 10 | Trascinamento dell'apice con la linea attaccata | ✅ | Linea e triangolo seguono |
| 11 | Selezione del marker del vincolo | ✅ | Il pannello mostra "Vincolo di coincidenza · Linea inizio ≡ Linea fine" |
| 12 | Canc sul vincolo, poi spostamento del rettangolo | ✅ | Il contatore scende, il rettangolo si stacca; Ctrl+Z ripristina il vincolo |
| 13 | Cerchio con il centro trascinato sul vertice del rettangolo + quota Ø modificata a 40 | ✅ | Vincolo creato, il raggio cambia e il centro resta sul vertice |
| 14 | Quota punto-punto (apice ↔ vertice del rettangolo), modificata a 100 | ✅ (2 difetti corretti) | Vedi difetti A e B sotto |
| 15 | Spline: trascinamento di un punto interno; ultimo punto trascinato sull'origine | ✅ | Si stira, vincolo con l'origine creato |
| 16 | Quota verticale del lato del rettangolo, modificata a 50 | ✅ (corretto) | L'etichetta è "30.00 mm", senza il difetto "34..00". Difetto C corretto |
| 17 | Ctrl+C / Ctrl+V del triangolo con quota | ✅ (2 difetti corretti) | Vedi difetti D ed E. La copia resta chiusa trascinando l'apice |
| 18 | Annulla/Ripeti dopo creazione ed eliminazione di vincoli | ✅ | Il contatore dei vincoli segue Ctrl+Z / Ctrl+Y |
| 19 | Ricaricamento della pagina (F5) | ✅ | Vincoli, quote guida e collegamenti persistono; le quote restano modificabili |
| 20 | Raccordo R3 su vertici vincolati + Genera percorso | ✅ (corretto) | 2 vincoli arco↔linee creati. G-code generato (935 righe, profilo esterno) senza errori. Difetto F corretto |

## Difetti trovati e corretti durante i test

- **A – Quota punto-punto.** Cliccando su un vertice che sta su una linea, lo strumento Quota prendeva la linea e non il punto, quindi la quota non diventava punto-punto. Ora un click vicino a un punto chiave ha la priorità.
- **B – Solver con figure collegate.** Su un disegno sovra-vincolato la modifica di una quota spostava anche il triangolo ancorato all'origine. Correzioni:
  - un punto bloccato blocca anche i punti coincidenti;
  - le figure collegate all'origine sono "più pesanti" delle figure libere;
  - una modifica di quota impossibile viene rifiutata con un messaggio.
- **C – Click sulle etichette.** Con due etichette sovrapposte il click prendeva la quota sbagliata. Ora l'area cliccabile segue la forma dell'etichetta lungo la linea di quota.
- **D – Selezione a riquadro.** Selezionava anche vincoli lontani dal riquadro. Ora un vincolo è incluso solo se la sua posizione è nel riquadro.
- **E – Copia/incolla.** Perdeva i vincoli interni della figura. Ora i vincoli tra figure copiate vengono copiati, e i punti coincidenti tra le copie vengono rivincolati (es. vertici che prima erano vincolati entrambi all'origine).
- **F – Raccordo.** L'arco era arrotondato a 0,001 mm/°, quindi un estremo non combaciava e mancava un vincolo. Ora l'arco è a piena precisione.
- **G – Etichetta "34..00 mm".** Le etichette verticali erano scritte male. Corretto: ora il testo è spostato con `dy`.

## Limiti noti (non risolti)

- Il solver è iterativo e semplice:
  - un sistema sovra-vincolato non viene risolto: la modifica viene rifiutata o compare un avviso;
  - non ci sono vincoli di parallelismo, perpendicolarità, orizzontale/verticale tra figure diverse (esistono solo i comandi esistenti sulla singola linea).
- Le quote angolari collegate (guida) funzionano solo tra linee vere, non tra i lati di un rettangolo. Per avere un angolo guida, esplodere prima il rettangolo.
- Trascinare il vertice di un rettangolo, cerchio o ellisse sposta la figura rigida, non la deforma. Le dimensioni si cambiano con le quote o con il pannello Proprietà.
- Lo snap sui punti di altri layer funziona, ma non crea vincoli: i vincoli valgono solo dentro lo stesso layer.
- I vincoli verso l'origine non vengono copiati con Ctrl+C (la copia viene posizionata altrove).
- Dopo un raccordo la quota guida della linea accorciata prende la nuova lunghezza (es. 80 → 68,68). È voluto, ma da sapere.
- Il taglio (trim) su figure vincolate rimuove i vincoli che non combaciano più. È stato verificato nei test unitari, non con un test GUI dedicato.

## Test unitari del solver (Node)

Tutti superati:
- triangolo chiuso con quota;
- cardine;
- rettangolo vincolato all'origine;
- quota punto-punto;
- angolo 90°;
- salvataggio/caricamento dei metadati;
- poligono a 5 vincoli;
- scarto dei vincoli violati;
- rifiuto del caso sovra-vincolato;
- spostamento delle sole figure libere.
