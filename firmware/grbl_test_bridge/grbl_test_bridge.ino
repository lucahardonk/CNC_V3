/*
 * grbl_test_bridge.ino
 * ---------------------------------------------------------------
 * Sketch di TEST MINIMALE per ESP8266 (NodeMCU 1.0).
 * Verifica la comunicazione ESP8266 <-> Arduino Uno (GRBL) tramite
 * SoftwareSerial + level shifter BSS138, prima di caricare il
 * firmware principale GRBL-Remote.
 *
 * Collegamenti:
 *   ESP D5 (GPIO14, TX) -> LV1/HV1 -> Arduino RX (pin 0)
 *   Arduino TX (pin 1)  -> HV2/LV2 -> ESP D6 (GPIO12, RX)
 *   GND comune. LV = 3.3V (ESP), HV = 5V (Arduino).
 *
 * Uso:
 *   1. Collegarsi alla rete WiFi "CNC-Test" (senza password)
 *   2. Aprire http://192.168.4.1
 *   3. Inviare "?" o "$I": se arriva una risposta, il bridge funziona.
 * ---------------------------------------------------------------
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <SoftwareSerial.h>

// --- Configurazione ---------------------------------------------
static const char*    AP_SSID      = "CNC-Test";
static const uint32_t GRBL_BAUD    = 115200;
static const uint32_t DEBUG_BAUD   = 115200;
static const size_t   POLL_MAX     = 512;   // byte massimi restituiti da /poll
static const size_t   RX_BUF_SIZE  = 1024;  // buffer circolare risposte GRBL

// --- Oggetti globali --------------------------------------------
SoftwareSerial   grblSerial;
ESP8266WebServer server(80);

// Buffer circolare: accumula i byte ricevuti da GRBL tra un poll e l'altro
static char   rxBuf[RX_BUF_SIZE];
static size_t rxHead = 0, rxTail = 0;

// --- Pagina HTML (inline, in PROGMEM) ---------------------------
static const char INDEX_HTML[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CNC Test Bridge</title>
<style>
body{background:#111;color:#ddd;font-family:monospace;margin:0;padding:10px}
h1{font-size:18px;color:#4caf50;margin:4px 0 10px}
.row{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
input{flex:1;min-width:150px;background:#222;color:#fff;border:1px solid #444;padding:10px;font-family:monospace;font-size:16px}
button{background:#333;color:#fff;border:1px solid #555;padding:10px 14px;font-family:monospace;font-size:15px;cursor:pointer}
button:active{background:#4caf50}
textarea{width:100%;height:60vh;box-sizing:border-box;background:#000;color:#0f0;border:1px solid #444;padding:6px;font-family:monospace;font-size:13px}
#st{font-size:12px;color:#888}
</style></head><body>
<h1>CNC Test Bridge &mdash; ESP8266 &harr; GRBL</h1>
<div class="row">
<input id="cmd" placeholder="Comando GRBL (es. ?, $$, $I, $H, G0 X0)" autocomplete="off">
<button onclick="sendCmd()">Invia</button>
</div>
<div class="row">
<button onclick="send('?')">? Stato</button>
<button onclick="send('$I')">$I Info</button>
<button onclick="send('$$')">$$ Impostazioni</button>
<button onclick="send('')">\n A capo</button>
<button onclick="log.value=''">Pulisci</button>
</div>
<textarea id="log" readonly></textarea>
<div id="st">In attesa...</div>
<script>
const log=document.getElementById('log'),st=document.getElementById('st'),inp=document.getElementById('cmd');
function add(t){log.value+=t;log.scrollTop=log.scrollHeight;}
function send(c){
  add('> '+(c===''?'\\n':c)+'\n');
  fetch('/send?cmd='+encodeURIComponent(c)).then(r=>r.text())
   .then(()=>st.textContent='Inviato: '+(c===''?'\\n':c))
   .catch(e=>st.textContent='Errore invio: '+e);
}
function sendCmd(){send(inp.value.trim());inp.value='';inp.focus();}
inp.addEventListener('keydown',e=>{if(e.key==='Enter')sendCmd();});
function poll(){
  fetch('/poll').then(r=>r.text()).then(t=>{if(t.length)add(t);st.textContent='Connesso - '+new Date().toLocaleTimeString();})
   .catch(()=>st.textContent='Disconnesso').finally(()=>setTimeout(poll,500));
}
poll();
</script></body></html>)HTML";

// --- Buffer circolare -------------------------------------------
static void rxPush(char c) {
  size_t next = (rxHead + 1) % RX_BUF_SIZE;
  if (next == rxTail) rxTail = (rxTail + 1) % RX_BUF_SIZE;  // pieno: scarta il byte più vecchio
  rxBuf[rxHead] = c;
  rxHead = next;
}

// Legge dalla SoftwareSerial, copia sul buffer e stampa su USB per debug
static void pumpGrbl() {
  while (grblSerial.available()) {
    char c = (char)grblSerial.read();
    rxPush(c);
    Serial.write(c);
  }
}

// --- Handler HTTP -----------------------------------------------
static void handleRoot() {
  server.send_P(200, "text/html", INDEX_HTML);
}

// GET /send?cmd=...  -> invia comando + '\n' a GRBL
static void handleSend() {
  String cmd = server.arg("cmd");
  // "?" e "!" / "~" sono comandi real-time: GRBL li accetta anche con '\n'
  grblSerial.print(cmd);
  grblSerial.print('\n');
  Serial.print(F("[TX] "));
  Serial.println(cmd.length() ? cmd : String(F("\\n")));
  server.send(200, "text/plain", "ok");
}

// GET /poll -> restituisce fino a POLL_MAX byte ricevuti da GRBL
static void handlePoll() {
  pumpGrbl();
  String out;
  out.reserve(POLL_MAX);
  while (rxTail != rxHead && out.length() < POLL_MAX) {
    out += rxBuf[rxTail];
    rxTail = (rxTail + 1) % RX_BUF_SIZE;
  }
  server.sendHeader("Cache-Control", "no-cache");
  server.send(200, "text/plain", out);
}

static void handleNotFound() {
  server.send(404, "text/plain", "Non trovato");
}

// --- Setup / Loop -----------------------------------------------
void setup() {
  Serial.begin(DEBUG_BAUD);
  delay(100);
  Serial.println(F("\n\n=== CNC Test Bridge ==="));

  // SoftwareSerial verso GRBL: RX=D6 (GPIO12), TX=D5 (GPIO14)
  // 6° param = buffer byte RX; 7° param = buffer fronti ISR (0 = calcolato
  // automaticamente: 256 byte x 10 fronti). NON è il buffer TX!
  grblSerial.begin(GRBL_BAUD, SWSERIAL_8N1, D6, D5, false, 256, 0);
  if (!grblSerial) {
    Serial.println(F("ERRORE: configurazione SoftwareSerial non valida"));
  }

  // Access point
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  WiFi.softAP(AP_SSID);
  Serial.print(F("AP attivo: "));
  Serial.print(AP_SSID);
  Serial.print(F("  IP: "));
  Serial.println(WiFi.softAPIP());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/send", HTTP_GET, handleSend);
  server.on("/poll", HTTP_GET, handlePoll);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println(F("Server HTTP avviato sulla porta 80"));
}

void loop() {
  pumpGrbl();           // svuota spesso la SoftwareSerial (buffer HW piccolo)
  server.handleClient();
  pumpGrbl();
  yield();
}
