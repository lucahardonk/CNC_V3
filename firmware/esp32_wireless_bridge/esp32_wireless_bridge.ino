// ═══════════════════════════════════════════════════════════════════════════
//  esp32_wireless_bridge v2.3 — NodeMCU 1.0 (ESP8266 / ESP-12E)
//  Bridge WiFi + interfaccia web completa per GRBL 1.1h su Arduino Uno
//
//  Librerie (Library Manager):
//    • WebSockets   di Markus Sattler (Links2004)  — testato 2.7.2
//    • ArduinoJson  di Benoit Blanchon             — testato 7.4.3
//    • EspSoftwareSerial e LittleFS: inclusi nel core ESP8266 (testato 3.1.2)
//
//  Scheda: "NodeMCU 1.0 (ESP-12E Module)", CPU 160 MHz,
//          Flash "4MB (FS:2MB OTA:~1019KB)"
//
//  L'interfaccia web è incorporata nel firmware (index_html.h, gzip):
//  NON serve caricare nulla su LittleFS. LittleFS viene usato solo per
//  salvare il file G-code e si formatta da solo al primo avvio.
//  Dopo aver modificato data/index.html rigenerare index_html.h con
//      python3 tools/embed_html.py
// ═══════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WebSocketsServer.h>
#include <SoftwareSerial.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <deque>

#include "config.h"
#include "index_html.h"

#define DBG Serial1                      // log su GPIO2 (D4), solo TX

static const char* GCODE_PATH = "/gcode.nc";
static const size_t GRBL_MAX_LINE = 80;  // LINE_BUFFER_SIZE di GRBL 1.1

// ── Seriale GRBL: RX = UART0 hardware (swap su D7), TX = SoftwareSerial D5 ──
#define grblRx Serial
SoftwareSerial grblTx;

ESP8266WebServer httpServer(HTTP_PORT);
WebSocketsServer wsServer(WS_PORT);

// ═══════════════════════════════════════════════════════════════════════════
//  Stato GRBL
// ═══════════════════════════════════════════════════════════════════════════
struct GrblState {
  String  name       = "Disconnected";
  int     alarmCode  = 0;
  int     holdReason = 0;
  float   mpos[3]    = {0, 0, 0};
  float   wpos[3]    = {0, 0, 0};
  float   wco[3]     = {0, 0, 0};
  float   feedRate   = 0;
  float   spindleRPM = 0;
  uint8_t ovFeed = 100, ovRapid = 100, ovSpindle = 100;
  bool    pinLX = false, pinLY = false, pinLZ = false, pinProbe = false;
  bool    pinDoor = false, pinHold = false, pinCS = false;
  bool    spindleOn = false, coolantFlood = false, coolantMist = false;
  int     plBuf = 0, rxBuf = 0;
  unsigned long lastRxMs = 0;            // ultimo byte ricevuto da GRBL
} grblSt;

// ═══════════════════════════════════════════════════════════════════════════
//  Streaming G-code (file su LittleFS, flow control a conteggio caratteri)
// ═══════════════════════════════════════════════════════════════════════════
struct StreamCtrl {
  bool    running  = false;              // job in corso (fino all'ultimo ok)
  bool    paused   = false;              // invio sospeso (non feed-hold)
  bool    eof      = false;              // file letto tutto, attesa ultimi ok
  int     total    = 0;
  int     sent     = 0;
  int     acked    = 0;
  int     txInFlight = 0;                // byte stimati nel buffer RX di GRBL
  std::deque<int> pendingLen;            // lunghezze righe inviate senza ok
  std::deque<String> pendingTxt;         // testo delle stesse righe (per errori)
  int     flushAcks = 0;                 // ok/error del '\n' iniziale da scartare
  String  nextLine;                      // riga letta ma non ancora inviata
  File    file;
  unsigned long lastProgressMs = 0;
  unsigned long lastAckMs = 0;           // ultimo ok/error di una riga del job
  int     lastError = 0;                 // codice error:N che ha messo in pausa
  int     errLine   = 0;                 // riga del job che ha dato l'errore
  String  errText;                       // testo della riga che ha dato l'errore
} stream;

String grblLineBuf;
String uploadLineBuf;
int    uploadLineCount = 0;
File   uploadFile;
bool   uploadRejected = false;
unsigned long lastPollMs = 0;

// Stop job: prima feed-hold, poi soft-reset solo a moto fermo (Hold:0 o
// Idle) per non perdere la posizione (ALARM 3). Timeout di sicurezza 3 s.
bool          stopPending = false;
unsigned long stopMs      = 0;

// ── Prototipi ───────────────────────────────────────────────────────────────
void setupWiFi();
void setupHTTP();
void loopGrbl();
void loopStream();
void processGrblLine(const String& line);
void parseStatusReport(const String& body);
void sendRaw(uint8_t b);
void sendCmd(const String& cmd);
void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len);
void handleWsMsg(const String& msg);
void broadcastJson(JsonDocument& doc);
void broadcastStatus();
void broadcastProgress(bool force);
String buildStatusJson();
String cleanGcodeLine(String line);
int countFileLines();
void streamReset();
void streamAbort();
void sendErrorMsg(const char* msg);
void startStopSequence();

// ═══════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
  // Banner sulla USB prima dello swap (visibile nel Monitor Seriale)
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n=== esp32_wireless_bridge v2.3 (ESP8266) ==="));
  Serial.println(F("RX GRBL = D7 (GPIO13, UART hardware)  TX GRBL = D5 (GPIO14)"));
  Serial.println(F("Da qui in poi la USB non riceve piu' log (vedi console web)."));
  Serial.flush();
  Serial.end();

  DBG.begin(DEBUG_BAUD);

  // RX hardware: UART0 solo ricezione, spostata su GPIO13 (D7)
  grblRx.setRxBufferSize(GRBL_HW_RXBUF);
  grblRx.begin(GRBL_BAUD, SERIAL_8N1, SERIAL_RX_ONLY);
  grblRx.swap();

  // TX software solo-trasmissione su D5. Interrupt disattivati durante ogni
  // byte (~87 µs) per un timing preciso; la RX hardware non ne risente.
  grblTx.begin(GRBL_BAUD, SWSERIAL_8N1, -1, GRBL_TX_PIN, false, 0);
  grblTx.enableIntTx(false);

  if (!LittleFS.begin()) DBG.println(F("LittleFS ERRORE"));
  if (LittleFS.exists(GCODE_PATH)) stream.total = countFileLines();

  setupWiFi();
  setupHTTP();
  wsServer.begin();
  wsServer.onEvent(wsEvent);
  DBG.println(F("Sistema pronto."));
}

void loop() {
  wsServer.loop();
  httpServer.handleClient();
  loopGrbl();
  loopStream();
}

// ═══════════════════════════════════════════════════════════════════════════
//  WiFi AP
// ═══════════════════════════════════════════════════════════════════════════
void setupWiFi() {
  WiFi.mode(WIFI_AP);
  IPAddress ip(AP_IP_1, AP_IP_2, AP_IP_3, AP_IP_4);
  WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0));
  const char* pw = strlen(AP_PASSWORD) >= 8 ? AP_PASSWORD : nullptr;
  WiFi.softAP(AP_SSID, pw, AP_CHANNEL);
  DBG.printf("AP '%s'  IP %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}

// ═══════════════════════════════════════════════════════════════════════════
//  HTTP
// ═══════════════════════════════════════════════════════════════════════════
void setupHTTP() {
  httpServer.on("/", HTTP_GET, []() {
    httpServer.sendHeader("Content-Encoding", "gzip");
    httpServer.sendHeader("Cache-Control", "no-cache");
    httpServer.send_P(200, "text/html", (PGM_P)INDEX_HTML_GZ, INDEX_HTML_GZ_LEN);
  });

  httpServer.on("/api/status", HTTP_GET, []() {
    httpServer.send(200, "application/json", buildStatusJson());
  });

  // Upload G-code (multipart). Righe pulite da commenti e spazi.
  httpServer.on("/api/upload", HTTP_POST,
    []() {
      if (uploadRejected) {
        httpServer.send(409, "application/json",
          "{\"ok\":false,\"msg\":\"Job in corso: fermarlo prima di caricare un nuovo file\"}");
        return;
      }
      stream.total = uploadLineCount;
      streamReset();
      JsonDocument doc;
      doc["type"]  = "file_ready";
      doc["lines"] = stream.total;
      broadcastJson(doc);
      httpServer.send(200, "application/json",
        "{\"ok\":true,\"lines\":" + String(stream.total) + "}");
      DBG.printf("G-code ricevuto: %d righe\n", stream.total);
    },
    []() {
      HTTPUpload& up = httpServer.upload();
      if (up.status == UPLOAD_FILE_START) {
        uploadRejected = stream.running;
        if (uploadRejected) return;
        if (stream.file) stream.file.close();
        uploadFile = LittleFS.open(GCODE_PATH, "w");
        uploadLineCount = 0;
        uploadLineBuf = "";
      } else if (up.status == UPLOAD_FILE_WRITE) {
        if (uploadRejected || !uploadFile) return;
        for (size_t i = 0; i < up.currentSize; i++) {
          char c = (char)up.buf[i];
          if (c == '\n' || c == '\r') {
            String l = cleanGcodeLine(uploadLineBuf);
            if (l.length()) { uploadFile.print(l); uploadFile.print('\n'); uploadLineCount++; }
            uploadLineBuf = "";
          } else if (uploadLineBuf.length() < 256) {
            uploadLineBuf += c;
          }
        }
      } else if (up.status == UPLOAD_FILE_END || up.status == UPLOAD_FILE_ABORTED) {
        if (uploadRejected || !uploadFile) return;
        String l = cleanGcodeLine(uploadLineBuf);   // ultima riga senza '\n'
        if (l.length()) { uploadFile.print(l); uploadFile.print('\n'); uploadLineCount++; }
        uploadLineBuf = "";
        uploadFile.close();
      }
    }
  );

  httpServer.onNotFound([]() { httpServer.send(404, "text/plain", "Not found"); });
  httpServer.begin();
}

// ═══════════════════════════════════════════════════════════════════════════
//  WebSocket
// ═══════════════════════════════════════════════════════════════════════════
void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
  if (type == WStype_CONNECTED) {
    String js = buildStatusJson();
    wsServer.sendTXT(num, js);
    if (stream.total > 0) {
      JsonDocument doc;
      doc["type"] = "file_ready"; doc["lines"] = stream.total;
      String out; serializeJson(doc, out);
      wsServer.sendTXT(num, out);
    }
  } else if (type == WStype_TEXT) {
    String msg;
    msg.reserve(len + 1);
    for (size_t i = 0; i < len; i++) msg += (char)payload[i];
    handleWsMsg(msg);
  }
}

void handleWsMsg(const String& msg) {
  JsonDocument doc;
  if (deserializeJson(doc, msg) != DeserializationError::Ok) return;
  String type = doc["type"] | "";

  // Durante un job i comandi manuali (non real-time) falserebbero il
  // conteggio caratteri: vengono rifiutati.
  // Sempre accettati, anche con job attivo
  if (type == "estop") {
    startStopSequence();
    DBG.println(F("E-STOP: hold + reset"));
    return;
  }
  if (type == "stream_force_clear") {
    streamAbort();
    stopPending = false;
    sendErrorMsg("Stato job azzerato");
    return;
  }

  bool manual = (type == "cmd" || type == "jog" || type == "set_zero" ||
                 type == "get_settings" || type == "set_setting" ||
                 type == "gcode_text");
  if (manual && stream.running) {
    String c = doc["cmd"] | "";
    bool isRt = c.length() == 1 &&
                ((uint8_t)c[0] < 0x20 || (uint8_t)c[0] >= 0x80 ||
                 c[0] == '~' || c[0] == '!' || c[0] == '?');
    if (!(type == "cmd" && isRt)) {
      sendErrorMsg("Job in corso: comando ignorato (usa Pausa/Stop)");
      return;
    }
  }

  if (type == "cmd") {
    String cmd = doc["cmd"] | "";
    if (!cmd.length()) return;
    uint8_t c0 = (uint8_t)cmd[0];
    if (cmd.length() == 1 && (c0 < 0x20 || c0 >= 0x80 || c0 == '~' || c0 == '!' || c0 == '?'))
    {
      sendRaw(c0);                       // real-time: senza '\n'
      if (c0 == 0x18) streamAbort();
    } else
      sendCmd(cmd);

  } else if (type == "rt") {
    int code = doc["code"] | 0;
    if (code > 0 && code < 256) sendRaw((uint8_t)code);
    if (code == 0x18) streamAbort();     // soft-reset svuota il buffer GRBL

  } else if (type == "jog") {
    String axes = doc["axes"] | "";
    float  feed = doc["feed"] | 1000.0f;
    if (axes.length()) sendCmd("$J=G91 G21 " + axes + " F" + String((int)feed));

  } else if (type == "jog_cancel") {
    sendRaw(0x85);

  } else if (type == "set_zero") {
    String axes = doc["axes"] | "XYZ";
    String cmd  = "G10 L20 P1";
    if (axes.indexOf('X') >= 0) cmd += " X0";
    if (axes.indexOf('Y') >= 0) cmd += " Y0";
    if (axes.indexOf('Z') >= 0) cmd += " Z0";
    sendCmd(cmd);

  } else if (type == "stream_start") {
    if (stream.running) return;
    if (!LittleFS.exists(GCODE_PATH) || stream.total == 0) {
      sendErrorMsg("Nessun file G-code caricato.");
      return;
    }
    if (grblSt.name == "Alarm" || grblSt.name == "Disconnected") {
      sendErrorMsg("GRBL non pronto (Alarm/Disconnected): sblocca con $X o Home");
      return;
    }
    streamReset();
    stream.file = LittleFS.open(GCODE_PATH, "r");
    if (!stream.file) { sendErrorMsg("Impossibile aprire il file G-code"); return; }
    stream.running = true;
    stream.lastAckMs = millis();
    // '\n' iniziale: chiude un'eventuale riga parziale/spazzatura rimasta nel
    // buffer di GRBL (disturbi sulla linea TX, comandi interrotti). Senza,
    // GRBL la concatenerebbe alla riga 1 → error:2. La sua risposta viene
    // scartata (flushAcks) e non conta come riga del job.
    sendCmd("");
    stream.txInFlight = 1;
    stream.pendingLen.push_back(1);
    stream.pendingTxt.push_back("");
    stream.flushAcks = 1;
    broadcastProgress(true);
    DBG.printf("Streaming avviato: %d righe\n", stream.total);

  } else if (type == "stream_pause") {
    // Sospende l'invio di nuove righe e mette GRBL in feed-hold; al resume
    // invia cycle-start.
    if (!stream.running) return;
    stream.paused = !stream.paused;
    if (!stream.paused) { stream.lastError = 0; stream.errLine = 0; stream.errText = ""; stream.lastAckMs = millis(); }
    sendRaw(stream.paused ? '!' : '~');
    broadcastProgress(true);

  } else if (type == "stream_stop") {
    startStopSequence();

  } else if (type == "gcode_text") {
    String text = doc["text"] | "";
    if (!text.length()) return;
    if (stream.file) stream.file.close();
    File f = LittleFS.open(GCODE_PATH, "w");
    int count = 0, start = 0;
    while (start < (int)text.length()) {
      int end = text.indexOf('\n', start);
      if (end < 0) end = text.length();
      String l = cleanGcodeLine(text.substring(start, end));
      if (l.length()) { f.print(l); f.print('\n'); count++; }
      start = end + 1;
    }
    f.close();
    stream.total = count;
    streamReset();
    JsonDocument r;
    r["type"] = "file_ready"; r["lines"] = count;
    broadcastJson(r);

  } else if (type == "get_settings") {
    sendCmd("$$");

  } else if (type == "set_setting") {
    int    idx = doc["idx"] | -1;
    String val = doc["val"] | "";
    if (idx >= 0 && val.length()) sendCmd("$" + String(idx) + "=" + val);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Ricezione da GRBL
// ═══════════════════════════════════════════════════════════════════════════
void loopGrbl() {
  int n = 0;
  while (grblRx.available() && n < 512) {   // limite per non bloccare il WiFi
    char c = (char)grblRx.read();
    n++;
    grblSt.lastRxMs = millis();
    if (c == '\n' || c == '\r') {
      grblLineBuf.trim();
      if (grblLineBuf.length()) processGrblLine(grblLineBuf);
      grblLineBuf = "";
    } else if (grblLineBuf.length() < 256) {
      grblLineBuf += c;
    }
  }

  unsigned long now = millis();
  if (stopPending) {
    bool stopped = (grblSt.name == "Hold" && grblSt.holdReason == 0) ||
                   grblSt.name == "Idle" || grblSt.name == "Alarm";
    if (stopped || now - stopMs > 3000) {
      sendRaw(0x18);                     // soft-reset: svuota buffer GRBL
      stopPending = false;
    }
  }
  if (now - lastPollMs >= STATUS_INTERVAL_MS) {
    lastPollMs = now;
    sendRaw('?');
    if (grblSt.name != "Disconnected" && now - grblSt.lastRxMs > GRBL_TIMEOUT_MS) {
      grblSt.name = "Disconnected";
      broadcastStatus();
    }
  }

  // ── Watchdog job: evita lo stato "job zombie" (running per sempre) ──────
  if (stream.running) {
    if (grblSt.name == "Disconnected") {
      streamAbort();
      sendErrorMsg("Arduino non risponde: job annullato");
    } else if (!stream.paused && !stream.pendingLen.empty() &&
               grblSt.name == "Idle" && now - stream.lastAckMs > 3000) {
      // GRBL fermo ma mancano degli ok: sono andati persi
      DBG.printf("Watchdog: %u ok mancanti\n", (unsigned)stream.pendingLen.size());
      stream.acked += stream.pendingLen.size() - stream.flushAcks;
      stream.pendingLen.clear();
      stream.pendingTxt.clear();
      stream.flushAcks = 0;
      stream.txInFlight = 0;
      stream.lastAckMs = now;
      if (stream.eof) sendErrorMsg("Risposte 'ok' mancanti: job chiuso dal watchdog");
      else            sendErrorMsg("Risposte 'ok' mancanti: conteggio riallineato, il job prosegue");
      broadcastProgress(true);
    }
  }
}

// Consuma l'ok/error della riga più vecchia del job. Ritorna false se era
// la risposta al '\n' di pulizia iniziale (non è una riga del job).
static bool ackStreamLine(String* txt = nullptr) {
  if (!stream.running || stream.pendingLen.empty()) return false;
  stream.txInFlight -= stream.pendingLen.front();
  if (stream.txInFlight < 0) stream.txInFlight = 0;
  stream.pendingLen.pop_front();
  if (txt) *txt = stream.pendingTxt.empty() ? String() : stream.pendingTxt.front();
  if (!stream.pendingTxt.empty()) stream.pendingTxt.pop_front();
  stream.lastAckMs = millis();
  if (stream.flushAcks > 0) { stream.flushAcks--; return false; }
  stream.acked++;
  return true;
}

void processGrblLine(const String& line) {
  if (line.charAt(0) == '<') {
    int end = line.lastIndexOf('>');
    if (end < 0) return;                 // report troncato: ignorato
    parseStatusReport(line.substring(1, end));
    broadcastStatus();
    return;
  }

  if (line == "ok") {
    if (stream.running) { ackStreamLine(); broadcastProgress(false); }
    else { JsonDocument r; r["type"] = "ok"; broadcastJson(r); }
    return;
  }

  if (line.startsWith("error:")) {
    int code = line.substring(6).toInt();
    bool inJob = stream.running && !stream.pendingLen.empty();
    String errTxt;
    if (inJob && !ackStreamLine(&errTxt)) {
      // Errore sul '\n' di pulizia: GRBL aveva spazzatura nel buffer, ora
      // scartata. Il job prosegue normalmente.
      DBG.printf("Scartata riga spuria nel buffer GRBL (error:%d)\n", code);
      sendErrorMsg("Scartati caratteri spuri nel buffer di GRBL prima del job (normale, il job prosegue)");
      return;
    }
    if (inJob) {
      stream.paused = true;              // auto-pausa: le righe già in GRBL proseguono
      stream.lastError = code;
      stream.errLine   = stream.acked;
      stream.errText   = errTxt;
      DBG.printf("error:%d riga %d: %s\n", code, stream.acked, errTxt.c_str());
      broadcastProgress(true);
    }
    JsonDocument doc;
    doc["type"] = "error"; doc["code"] = code;
    if (inJob) { doc["lineNo"] = stream.acked; doc["text"] = errTxt; }
    broadcastJson(doc);
    return;
  }

  if (line.startsWith("ALARM:")) {
    grblSt.alarmCode = line.substring(6).toInt();
    grblSt.name = "Alarm";
    streamAbort();
    JsonDocument doc;
    doc["type"] = "alarm"; doc["code"] = grblSt.alarmCode;
    broadcastJson(doc);
    return;
  }

  JsonDocument doc;
  if (line.charAt(0) == '$' && line.indexOf('=') > 0) { doc["type"] = "setting"; doc["raw"] = line; }
  else if (line.charAt(0) == '[')                     { doc["type"] = "info";    doc["line"] = line; }
  else if (line.startsWith("Grbl "))                  {
    doc["type"] = "welcome"; doc["version"] = line;
    streamAbort();                       // GRBL si è resettato
  }
  else                                                { doc["type"] = "raw";     doc["line"] = line; }
  broadcastJson(doc);
}

// ── Status report  <State|Campo:val|...> ────────────────────────────────────
static void parse3(const String& v, float* out) {
  sscanf(v.c_str(), "%f,%f,%f", &out[0], &out[1], &out[2]);
}

void parseStatusReport(const String& body) {
  int start = 0;
  bool first = true;
  while (start <= (int)body.length()) {
    int pipe = body.indexOf('|', start);
    if (pipe < 0) pipe = body.length();
    String part = body.substring(start, pipe);
    start = pipe + 1;

    if (first) {
      first = false;
      int colon = part.indexOf(':');
      grblSt.name = colon > 0 ? part.substring(0, colon) : part;
      int sub = colon > 0 ? part.substring(colon + 1).toInt() : 0;
      if (grblSt.name == "Hold") grblSt.holdReason = sub;
      continue;
    }
    int colon = part.indexOf(':');
    if (colon < 0) continue;
    String key = part.substring(0, colon);
    String val = part.substring(colon + 1);

    if (key == "MPos") {
      parse3(val, grblSt.mpos);
      for (int i = 0; i < 3; i++) grblSt.wpos[i] = grblSt.mpos[i] - grblSt.wco[i];
    } else if (key == "WPos") {
      parse3(val, grblSt.wpos);
      for (int i = 0; i < 3; i++) grblSt.mpos[i] = grblSt.wpos[i] + grblSt.wco[i];
    } else if (key == "WCO") {
      parse3(val, grblSt.wco);
      for (int i = 0; i < 3; i++) grblSt.wpos[i] = grblSt.mpos[i] - grblSt.wco[i];
    } else if (key == "Bf") {
      sscanf(val.c_str(), "%d,%d", &grblSt.plBuf, &grblSt.rxBuf);
    } else if (key == "FS") {
      sscanf(val.c_str(), "%f,%f", &grblSt.feedRate, &grblSt.spindleRPM);
    } else if (key == "F") {
      grblSt.feedRate = val.toFloat();
    } else if (key == "Pn") {
      grblSt.pinLX = val.indexOf('X') >= 0;  grblSt.pinLY   = val.indexOf('Y') >= 0;
      grblSt.pinLZ = val.indexOf('Z') >= 0;  grblSt.pinProbe= val.indexOf('P') >= 0;
      grblSt.pinDoor = val.indexOf('D') >= 0; grblSt.pinHold = val.indexOf('H') >= 0;
      grblSt.pinCS = val.indexOf('R') >= 0 || val.indexOf('S') >= 0;
    } else if (key == "Ov") {
      int f = 100, r = 100, s = 100;
      sscanf(val.c_str(), "%d,%d,%d", &f, &r, &s);
      grblSt.ovFeed = f; grblSt.ovRapid = r; grblSt.ovSpindle = s;
      // In GRBL 1.1 il campo A: compare solo se qualcosa è attivo, e sempre
      // insieme a Ov: se Ov c'è e A no → tutto spento.
      grblSt.spindleOn = grblSt.coolantFlood = grblSt.coolantMist = false;
    } else if (key == "A") {
      grblSt.spindleOn    = val.indexOf('S') >= 0 || val.indexOf('C') >= 0;
      grblSt.coolantFlood = val.indexOf('F') >= 0;
      grblSt.coolantMist  = val.indexOf('M') >= 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Streaming (character counting)
// ═══════════════════════════════════════════════════════════════════════════
void loopStream() {
  if (!stream.running || stream.paused) return;

  while (!stream.eof) {
    if (!stream.nextLine.length()) {
      if (!stream.file || !stream.file.available()) {
        stream.eof = true;
        if (stream.file) stream.file.close();
        break;
      }
      stream.nextLine = stream.file.readStringUntil('\n');
      stream.nextLine.trim();
      if (!stream.nextLine.length()) continue;
    }
    int lineBytes = stream.nextLine.length() + 1;     // + '\n'
    // La riga resta in attesa (non viene persa) finché non c'è spazio.
    // Se il buffer è vuoto la si invia comunque (riga lunghissima).
    if (stream.txInFlight > 0 && stream.txInFlight + lineBytes > GRBL_RX_BUFFER_BYTES) break;
    sendCmd(stream.nextLine);
    stream.txInFlight += lineBytes;
    stream.pendingLen.push_back(lineBytes);
    stream.pendingTxt.push_back(stream.nextLine);
    stream.sent++;
    stream.nextLine = "";
  }

  if (stream.eof && stream.pendingLen.empty()) {
    stream.running = false;
    broadcastProgress(true);
    JsonDocument doc;
    doc["type"] = "stream_done"; doc["total"] = stream.total;
    broadcastJson(doc);
    DBG.println(F("Job completato"));
  }
}

void streamReset() {
  if (stream.file) stream.file.close();
  stream.running = stream.paused = stream.eof = false;
  stream.sent = stream.acked = stream.txInFlight = 0;
  stream.lastError = stream.errLine = 0;
  stream.errText = "";
  stream.flushAcks = 0;
  stream.pendingLen.clear();
  stream.pendingTxt.clear();
  stream.nextLine = "";
}

void streamAbort() {
  bool wasRunning = stream.running;
  streamReset();
  if (wasRunning) {
    JsonDocument r; r["type"] = "stream_stopped";
    broadcastJson(r);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════════════════════════════════════
// Rimuove commenti ';' e '(...)', spazi iniziali/finali e '%'
String cleanGcodeLine(String line) {
  int sc = line.indexOf(';');
  if (sc >= 0) line = line.substring(0, sc);
  int p;
  while ((p = line.indexOf('(')) >= 0) {
    int q = line.indexOf(')', p);
    line = line.substring(0, p) + (q >= 0 ? line.substring(q + 1) : String());
  }
  line.trim();
  if (line == "%") line = "";
  if (line.length() > GRBL_MAX_LINE - 1) DBG.printf("Riga > %u caratteri: %s\n", (unsigned)GRBL_MAX_LINE - 1, line.c_str());
  return line;
}

int countFileLines() {
  File f = LittleFS.open(GCODE_PATH, "r");
  int n = 0;
  while (f && f.available()) if (f.read() == '\n') n++;
  if (f) f.close();
  return n;
}

// Stop controllato: feed-hold subito, soft-reset a moto fermo (o dopo 3 s)
// in loopGrbl(). Svuota anche lo stato del job. Usato da Stop ed E-STOP.
void startStopSequence() {
  sendRaw('!');
  stopPending = true;
  stopMs = millis();
  streamAbort();
}

void sendRaw(uint8_t b) { grblTx.write(b); }

void sendCmd(const String& cmd) {
  grblTx.print(cmd);
  grblTx.write('\n');
}

void sendErrorMsg(const char* msg) {
  JsonDocument r; r["type"] = "error_msg"; r["msg"] = msg;
  broadcastJson(r);
}

void broadcastJson(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  wsServer.broadcastTXT(out);
}

void broadcastStatus() {
  String js = buildStatusJson();
  wsServer.broadcastTXT(js);
}

void broadcastProgress(bool force) {
  unsigned long now = millis();
  if (!force && now - stream.lastProgressMs < PROGRESS_INTERVAL_MS) return;
  stream.lastProgressMs = now;
  JsonDocument doc;
  doc["type"]    = "stream_progress";
  doc["running"] = stream.running;
  doc["paused"]  = stream.paused;
  doc["sent"]    = stream.sent;
  doc["acked"]   = stream.acked;
  doc["total"]   = stream.total;
  doc["lastError"] = stream.lastError;
  doc["errLine"]   = stream.errLine;
  doc["errText"]   = stream.errText;
  broadcastJson(doc);
}

String buildStatusJson() {
  JsonDocument doc;
  doc["type"]  = "status";
  doc["state"] = grblSt.name;
  doc["alarm"] = grblSt.alarmCode;
  doc["hold"]  = grblSt.holdReason;
  JsonArray mp = doc["mpos"].to<JsonArray>();
  JsonArray wp = doc["wpos"].to<JsonArray>();
  JsonArray wc = doc["wco"].to<JsonArray>();
  for (int i = 0; i < 3; i++) { mp.add(grblSt.mpos[i]); wp.add(grblSt.wpos[i]); wc.add(grblSt.wco[i]); }
  doc["feed"]    = grblSt.feedRate;
  doc["spindle"] = grblSt.spindleRPM;
  JsonArray ov = doc["ov"].to<JsonArray>();
  ov.add(grblSt.ovFeed); ov.add(grblSt.ovRapid); ov.add(grblSt.ovSpindle);
  JsonObject pins = doc["pins"].to<JsonObject>();
  pins["lx"] = grblSt.pinLX; pins["ly"] = grblSt.pinLY; pins["lz"] = grblSt.pinLZ;
  pins["prb"] = grblSt.pinProbe; pins["door"] = grblSt.pinDoor;
  pins["hold"] = grblSt.pinHold; pins["cs"] = grblSt.pinCS;
  JsonObject acc = doc["acc"].to<JsonObject>();
  acc["spindle"] = grblSt.spindleOn; acc["flood"] = grblSt.coolantFlood; acc["mist"] = grblSt.coolantMist;
  doc["buf_pl"] = grblSt.plBuf;
  doc["buf_rx"] = grblSt.rxBuf;
  JsonObject st = doc["stream"].to<JsonObject>();
  st["running"] = stream.running; st["paused"] = stream.paused;
  st["sent"] = stream.sent; st["acked"] = stream.acked; st["total"] = stream.total;
  st["lastError"] = stream.lastError; st["errLine"] = stream.errLine; st["errText"] = stream.errText;
  doc["rx_age"] = (uint32_t)(millis() - grblSt.lastRxMs);
  String out;
  serializeJson(doc, out);
  return out;
}
