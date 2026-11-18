// ═══════════════════════════════════════════════════════════════════════════
//  GRBL-Remote v1.0  —  NodeMCU ESP8266 (ESP-12E)
//  WiFi bridge + interfaccia web completa per GRBL su Arduino Uno
//
//  Librerie richieste (Arduino Library Manager):
//    • arduinoWebSockets  di Links2004      >= 2.4.1
//    • EspSoftwareSerial  di Juraj Andrassy >= 8.0.0
//    • ArduinoJson        di bblanchon      >= 7.0.0
//    • LittleFS: incluso nel core ESP8266 >= 3.0.0
//
//  Board:         "NodeMCU 1.0 (ESP-12E Module)"
//  CPU Frequency: 160 MHz  ← IMPORTANTE
//  Flash Size:    4MB (FS:2MB OTA:1MB)
//  Upload Speed:  921600
//
//  PRIMA DEL PRIMO AVVIO: caricare data/index.html su LittleFS con
//  il plugin "ESP8266 LittleFS Data Upload" per Arduino IDE.
// ═══════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WebSocketsServer.h>
#include <SoftwareSerial.h>      // EspSoftwareSerial
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <deque>

#include "config.h"

// ───────────────────────────────────────────────────────────────────────────
//  Hardware serial bridge (SoftwareSerial su D6/D5)
//  → non interferisce con l'upload firmware via USB
// ───────────────────────────────────────────────────────────────────────────
SoftwareSerial grblSerial(GRBL_RX_PIN, GRBL_TX_PIN);

// ───────────────────────────────────────────────────────────────────────────
//  Server HTTP (porta 80) + WebSocket (porta 81)
// ───────────────────────────────────────────────────────────────────────────
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

  uint8_t ovFeed     = 100;
  uint8_t ovRapid    = 100;
  uint8_t ovSpindle  = 100;

  bool    pinLX      = false;
  bool    pinLY      = false;
  bool    pinLZ      = false;
  bool    pinProbe   = false;
  bool    pinDoor    = false;
  bool    pinHold    = false;
  bool    pinCS      = false;

  bool    spindleOn     = false;
  bool    coolantFlood  = false;
  bool    coolantMist   = false;

  int     plBuf      = 0;
  int     rxBuf      = 0;
} grblSt;

// ═══════════════════════════════════════════════════════════════════════════
//  Streaming G-code (file su LittleFS, flow-control a conteggio caratteri)
// ═══════════════════════════════════════════════════════════════════════════
struct StreamCtrl {
  bool    running    = false;
  bool    paused     = false;
  bool    done       = false;
  int     total      = 0;
  int     sent       = 0;
  int     acked      = 0;
  int     txInFlight = 0;          // byte stimati nel buffer RX di GRBL
  std::deque<int> pendingLen;      // lunghezza di ogni riga inviata e non ancora acked
  File    file;                    // handle LittleFS aperto durante lo streaming
} stream;

// ═══════════════════════════════════════════════════════════════════════════
//  Accumulatore seriale GRBL
// ═══════════════════════════════════════════════════════════════════════════
String grblLineBuf = "";

// Upload G-code
String uploadLineBuf = "";
int    uploadLineCount = 0;

// Polling status
unsigned long lastPollMs = 0;

// ═══════════════════════════════════════════════════════════════════════════
//  FORWARD DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════
void setupWiFi();
void setupHTTP();
void setupWS();
void loopGrbl();
void loopStream();
void processGrblLine(const String& line);
void parseStatusReport(const String& body);
void parsePins(const String& s);
void parseOverrides(const String& s);
void parseAccessory(const String& s);
void sendRaw(uint8_t byte1);
void sendCmd(const String& cmd);
void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len);
void handleWsMsg(uint8_t num, const String& msg);
void broadcastJson(JsonDocument& doc);
void broadcastStatus();
String buildStatusJson();
void serveFile(const String& path, const String& mime);

// ═══════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("\n===  GRBL-Remote v1.0  ==="));

  // SoftwareSerial per GRBL
  grblSerial.begin(GRBL_BAUD, SWSERIAL_8N1, GRBL_RX_PIN, GRBL_TX_PIN,
                   false, GRBL_SW_RXBUF, GRBL_SW_ISRBUF);
  Serial.printf("GRBL serial: RX=GPIO%d  TX=GPIO%d  baud=%d\n",
                GRBL_RX_PIN, GRBL_TX_PIN, GRBL_BAUD);

  // LittleFS
  if (!LittleFS.begin()) {
    Serial.println(F("LittleFS ERRORE — caricare prima data/index.html!"));
  } else {
    Serial.println(F("LittleFS OK"));
  }

  setupWiFi();
  setupHTTP();
  setupWS();
  Serial.println(F("Sistema pronto."));
}

// ═══════════════════════════════════════════════════════════════════════════
//  LOOP
// ═══════════════════════════════════════════════════════════════════════════
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
  Serial.printf("AP '%s'  IP: %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}

// ═══════════════════════════════════════════════════════════════════════════
//  HTTP Routes
// ═══════════════════════════════════════════════════════════════════════════
void setupHTTP() {
  // Root → index.html
  httpServer.on("/", HTTP_GET, []() {
    serveFile("/index.html", "text/html");
  });

  // Snapshot stato corrente (usato al caricamento pagina)
  httpServer.on("/api/status", HTTP_GET, []() {
    httpServer.send(200, "application/json", buildStatusJson());
  });

  // Comando singolo via REST (alternativa al WebSocket)
  httpServer.on("/api/cmd", HTTP_POST, []() {
    String cmd = httpServer.arg("plain");
    cmd.trim();
    if (cmd.length()) sendCmd(cmd);
    httpServer.send(200, "text/plain", "ok");
  });

  // Upload G-code (multipart form-data)
  httpServer.on("/api/upload", HTTP_POST,
    // handler completamento
    []() {
      // Flush ultima riga pendente
      uploadLineBuf.trim();
      if (uploadLineBuf.length() > 0) {
        uploadLineCount++;
      }
      uploadLineBuf = "";
      stream.total  = uploadLineCount;
      stream.sent   = 0;
      stream.acked  = 0;
      stream.txInFlight = 0;
      stream.pendingLen.clear();
      stream.running = false;
      stream.done    = false;

      JsonDocument doc;
      doc["type"]  = "file_ready";
      doc["lines"] = stream.total;
      broadcastJson(doc);

      httpServer.send(200, "application/json",
        "{\"ok\":true,\"lines\":" + String(stream.total) + "}");
      Serial.printf("G-code ricevuto: %d linee\n", stream.total);
    },
    // handler upload chunked
    []() {
      HTTPUpload& up = httpServer.upload();
      if (up.status == UPLOAD_FILE_START) {
        // Apri file su LittleFS (sovrascrive il precedente)
        if (LittleFS.exists("/gcode.nc")) LittleFS.remove("/gcode.nc");
        stream.file   = LittleFS.open("/gcode.nc", "w");
        uploadLineCount = 0;
        uploadLineBuf   = "";
        Serial.printf("Upload G-code: '%s'\n", up.filename.c_str());

      } else if (up.status == UPLOAD_FILE_WRITE) {
        for (size_t i = 0; i < up.currentSize; i++) {
          char c = (char)up.buf[i];
          if (c == '\n' || c == '\r') {
            // Elimina commenti e spazi
            int sc = uploadLineBuf.indexOf(';');
            if (sc >= 0) uploadLineBuf = uploadLineBuf.substring(0, sc);
            int paren = uploadLineBuf.indexOf('(');
            if (paren >= 0) uploadLineBuf = uploadLineBuf.substring(0, paren);
            uploadLineBuf.trim();
            if (uploadLineBuf.length() > 0) {
              stream.file.println(uploadLineBuf);
              uploadLineCount++;
            }
            uploadLineBuf = "";
          } else {
            uploadLineBuf += c;
          }
        }
      } else if (up.status == UPLOAD_FILE_END) {
        stream.file.close();
      }
    }
  );

  // File statici da LittleFS (css, js, favicon, ecc.)
  httpServer.onNotFound([]() {
    String path = httpServer.uri();
    String mime = "text/plain";
    if (path.endsWith(".html"))  mime = "text/html";
    else if (path.endsWith(".css"))  mime = "text/css";
    else if (path.endsWith(".js"))   mime = "application/javascript";
    else if (path.endsWith(".json")) mime = "application/json";
    else if (path.endsWith(".ico"))  mime = "image/x-icon";
    else if (path.endsWith(".png"))  mime = "image/png";
    else if (path.endsWith(".svg"))  mime = "image/svg+xml";
    if (LittleFS.exists(path)) {
      serveFile(path, mime);
    } else {
      httpServer.send(404, "text/plain", "Not found");
    }
  });

  httpServer.begin();
  Serial.printf("HTTP su porta %d\n", HTTP_PORT);
}

// ═══════════════════════════════════════════════════════════════════════════
//  WebSocket
// ═══════════════════════════════════════════════════════════════════════════
void setupWS() {
  wsServer.begin();
  wsServer.onEvent(wsEvent);
  Serial.printf("WebSocket su porta %d\n", WS_PORT);
}

void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED: {
      Serial.printf("WS[%d] connesso da %s\n", num,
                    wsServer.remoteIP(num).toString().c_str());
      { String js = buildStatusJson(); wsServer.sendTXT(num, js); }
      break;
    }
    case WStype_DISCONNECTED:
      Serial.printf("WS[%d] disconnesso\n", num);
      break;
    case WStype_TEXT: {
      String msg;
      msg.reserve(len + 1);
      for (size_t i = 0; i < len; i++) msg += (char)payload[i];
      handleWsMsg(num, msg);
      break;
    }
    default:
      break;
  }
}

void handleWsMsg(uint8_t num, const String& msg) {
  JsonDocument doc;
  if (deserializeJson(doc, msg) != DeserializationError::Ok) {
    // Fallback: tratta come comando diretto
    sendCmd(msg);
    return;
  }

  String type = doc["type"] | "";

  // ── Comando singolo ──────────────────────────────────────────────────────
  if (type == "cmd") {
    String cmd = doc["cmd"] | "";
    if (cmd.length()) {
      // Comandi real-time (1 byte): inviati come raw
      // Comandi real-time a 1 byte: controlli (<0x20), '~' '!' '?' ed
      // estesi (>=0x80) vanno inviati SENZA '\n'
      uint8_t c0 = (uint8_t)cmd[0];
      if (cmd.length() == 1 && (c0 < 0x20 || c0 >= 0x80 ||
                                c0 == '~' || c0 == '!' || c0 == '?')) {
        sendRaw((uint8_t)cmd[0]);
      } else {
        sendCmd(cmd);
      }
    }

  // ── Override real-time (1 byte binario) ──────────────────────────────────
  } else if (type == "rt") {
    int code = doc["code"] | 0;
    if (code > 0) sendRaw((uint8_t)code);

  // ── Jog ──────────────────────────────────────────────────────────────────
  } else if (type == "jog") {
    // Supporta jog diagonale (assi multipli)
    String axes = doc["axes"] | "";   // es. "X1.000 Y-1.000"
    float  feed = doc["feed"]  | 1000.0f;
    if (axes.length() > 0) {
      String cmd = "$J=G91 G21 " + axes + " F" + String((int)feed);
      sendCmd(cmd);
    }

  // ── Jog continuo (stop) ──────────────────────────────────────────────────
  } else if (type == "jog_cancel") {
    sendRaw(0x85);

  // ── Zero WCS ─────────────────────────────────────────────────────────────
  } else if (type == "set_zero") {
    String axes = doc["axes"] | "XYZ";
    String cmd  = "G10 L20 P1";
    if (axes.indexOf('X') >= 0) cmd += " X0";
    if (axes.indexOf('Y') >= 0) cmd += " Y0";
    if (axes.indexOf('Z') >= 0) cmd += " Z0";
    sendCmd(cmd);

  // ── Avvia streaming ───────────────────────────────────────────────────────
  } else if (type == "stream_start") {
    if (stream.running) return;
    if (!LittleFS.exists("/gcode.nc")) {
      JsonDocument r; r["type"] = "error_msg";
      r["msg"] = "Nessun file G-code caricato.";
      broadcastJson(r);
      return;
    }
    stream.file = LittleFS.open("/gcode.nc", "r");
    stream.sent  = 0;
    stream.acked = 0;
    stream.txInFlight = 0;
    stream.pendingLen.clear();
    stream.running = true;
    stream.paused  = false;
    stream.done    = false;
    Serial.printf("Streaming avviato: %d linee\n", stream.total);

  // ── Pausa / Riprendi ──────────────────────────────────────────────────────
  } else if (type == "stream_pause") {
    if (stream.running) stream.paused = !stream.paused;

  // ── Stop streaming ────────────────────────────────────────────────────────
  } else if (type == "stream_stop") {
    stream.running = false;
    stream.paused  = false;
    if (stream.file) { stream.file.close(); }
    sendRaw(0x18);                           // Soft-Reset
    JsonDocument r; r["type"] = "stream_stopped";
    broadcastJson(r);

  // ── G-code text (paste dall'editor web, piccoli programmi) ───────────────
  } else if (type == "gcode_text") {
    String text = doc["text"] | "";
    if (!text.length()) return;
    if (LittleFS.exists("/gcode.nc")) LittleFS.remove("/gcode.nc");
    File f = LittleFS.open("/gcode.nc", "w");
    int count = 0;
    int start = 0;
    while (start <= (int)text.length()) {
      int end = text.indexOf('\n', start);
      if (end < 0) end = text.length();
      String line = text.substring(start, end);
      int sc = line.indexOf(';');
      if (sc >= 0) line = line.substring(0, sc);
      line.trim();
      if (line.length() > 0) { f.println(line); count++; }
      start = end + 1;
    }
    f.close();
    stream.total   = count;
    stream.sent    = 0; stream.acked = 0;
    stream.running = false; stream.done = false;
    JsonDocument r;
    r["type"]  = "file_ready";
    r["lines"] = count;
    broadcastJson(r);

  // ── Leggi impostazioni $$ ──────────────────────────────────────────────
  } else if (type == "get_settings") {
    sendCmd("$$");

  // ── Scrivi impostazione $N=V ──────────────────────────────────────────────
  } else if (type == "set_setting") {
    int    idx = doc["idx"] | -1;
    String val = doc["val"] | "";
    if (idx >= 0 && val.length()) {
      sendCmd("$" + String(idx) + "=" + val);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GRBL Serial Loop
// ═══════════════════════════════════════════════════════════════════════════
void loopGrbl() {
  // Lettura dalla seriale GRBL
  while (grblSerial.available()) {
    char c = (char)grblSerial.read();
    if (c == '\n' || c == '\r') {
      grblLineBuf.trim();
      if (grblLineBuf.length() > 0) {
        processGrblLine(grblLineBuf);
        grblLineBuf = "";
      }
    } else {
      if (grblLineBuf.length() < 512) grblLineBuf += c;
    }
    yield();
  }

  // Polling '?' periodico
  unsigned long now = millis();
  if (now - lastPollMs >= STATUS_INTERVAL_MS) {
    lastPollMs = now;
    grblSerial.write('?');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Elabora una riga completa da GRBL
// ═══════════════════════════════════════════════════════════════════════════
void processGrblLine(const String& line) {
  // Status report: <State|MPos:...|...>
  if (line.charAt(0) == '<') {
    parseStatusReport(line.substring(1, line.length() - 1));
    broadcastStatus();
    return;
  }

  // ok
  if (line == "ok") {
    if (stream.running && !stream.pendingLen.empty()) {
      stream.txInFlight -= stream.pendingLen.front();
      if (stream.txInFlight < 0) stream.txInFlight = 0;
      stream.pendingLen.pop_front();
      stream.acked++;
      JsonDocument doc;
      doc["type"]  = "stream_progress";
      doc["sent"]  = stream.sent;
      doc["acked"] = stream.acked;
      doc["total"] = stream.total;
      doc["pct"]   = stream.total > 0 ? (100 * stream.acked / stream.total) : 0;
      broadcastJson(doc);
    }
    JsonDocument r; r["type"] = "ok";
    broadcastJson(r);
    return;
  }

  // error:N
  if (line.startsWith("error:")) {
    int code = line.substring(6).toInt();
    if (stream.running && !stream.pendingLen.empty()) {
      stream.txInFlight -= stream.pendingLen.front();
      if (stream.txInFlight < 0) stream.txInFlight = 0;
      stream.pendingLen.pop_front();
      stream.acked++;
      stream.paused = true;          // auto-pausa su errore
    }
    JsonDocument doc;
    doc["type"]   = "error";
    doc["code"]   = code;
    doc["lineNo"] = stream.acked;
    broadcastJson(doc);
    return;
  }

  // ALARM:N
  if (line.startsWith("ALARM:")) {
    int code = line.substring(6).toInt();
    grblSt.alarmCode = code;
    grblSt.name = "Alarm";
    if (stream.running) {
      stream.running = false;
      if (stream.file) stream.file.close();
    }
    JsonDocument doc;
    doc["type"]  = "alarm";
    doc["code"]  = code;
    broadcastJson(doc);
    return;
  }

  // Impostazioni $N=V
  if (line.charAt(0) == '$' && line.indexOf('=') > 0) {
    JsonDocument doc;
    doc["type"] = "setting";
    doc["raw"]  = line;
    broadcastJson(doc);
    return;
  }

  // Info [ ... ]
  if (line.charAt(0) == '[') {
    JsonDocument doc;
    doc["type"] = "info";
    doc["line"] = line;
    broadcastJson(doc);
    return;
  }

  // Welcome "Grbl X.X ..."
  if (line.startsWith("Grbl ")) {
    JsonDocument doc;
    doc["type"]    = "welcome";
    doc["version"] = line;
    broadcastJson(doc);
    return;
  }

  // Riga generica
  if (line.length() > 0) {
    JsonDocument doc;
    doc["type"] = "raw";
    doc["line"] = line;
    broadcastJson(doc);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Parser status report  <State|Field:val|...>
// ═══════════════════════════════════════════════════════════════════════════
void parseStatusReport(const String& body) {
  int    start = 0;
  bool   first = true;
  String part;

  while (start <= (int)body.length()) {
    int pipe = body.indexOf('|', start);
    if (pipe < 0) pipe = body.length();
    part  = body.substring(start, pipe);
    start = pipe + 1;

    if (first) {
      int colon = part.indexOf(':');
      if (colon > 0) {
        grblSt.name = part.substring(0, colon);
        int sub = part.substring(colon + 1).toInt();
        if (grblSt.name == "Alarm") grblSt.alarmCode  = sub;
        if (grblSt.name == "Hold")  grblSt.holdReason = sub;
      } else {
        grblSt.name = part;
      }
      first = false;
      continue;
    }

    int colon = part.indexOf(':');
    if (colon < 0) continue;
    String key = part.substring(0, colon);
    String val = part.substring(colon + 1);

    if (key == "MPos") {
      sscanf(val.c_str(), "%f,%f,%f",
             &grblSt.mpos[0], &grblSt.mpos[1], &grblSt.mpos[2]);
      grblSt.wpos[0] = grblSt.mpos[0] - grblSt.wco[0];
      grblSt.wpos[1] = grblSt.mpos[1] - grblSt.wco[1];
      grblSt.wpos[2] = grblSt.mpos[2] - grblSt.wco[2];

    } else if (key == "WPos") {
      sscanf(val.c_str(), "%f,%f,%f",
             &grblSt.wpos[0], &grblSt.wpos[1], &grblSt.wpos[2]);
      grblSt.mpos[0] = grblSt.wpos[0] + grblSt.wco[0];
      grblSt.mpos[1] = grblSt.wpos[1] + grblSt.wco[1];
      grblSt.mpos[2] = grblSt.wpos[2] + grblSt.wco[2];

    } else if (key == "WCO") {
      sscanf(val.c_str(), "%f,%f,%f",
             &grblSt.wco[0], &grblSt.wco[1], &grblSt.wco[2]);

    } else if (key == "Bf") {
      sscanf(val.c_str(), "%d,%d", &grblSt.plBuf, &grblSt.rxBuf);

    } else if (key == "FS") {
      sscanf(val.c_str(), "%f,%f", &grblSt.feedRate, &grblSt.spindleRPM);

    } else if (key == "F") {
      grblSt.feedRate = val.toFloat();

    } else if (key == "Pn") {
      parsePins(val);

    } else if (key == "Ov") {
      parseOverrides(val);

    } else if (key == "A") {
      parseAccessory(val);
    }
  }
}

void parsePins(const String& s) {
  grblSt.pinLX    = s.indexOf('X') >= 0;
  grblSt.pinLY    = s.indexOf('Y') >= 0;
  grblSt.pinLZ    = s.indexOf('Z') >= 0;
  grblSt.pinProbe = s.indexOf('P') >= 0;
  grblSt.pinDoor  = s.indexOf('D') >= 0;
  grblSt.pinHold  = s.indexOf('H') >= 0;
  grblSt.pinCS    = s.indexOf('R') >= 0;
}

void parseOverrides(const String& s) {
  sscanf(s.c_str(), "%hhu,%hhu,%hhu",
         &grblSt.ovFeed, &grblSt.ovRapid, &grblSt.ovSpindle);
}

void parseAccessory(const String& s) {
  grblSt.spindleOn    = s.indexOf('S') >= 0 || s.indexOf('C') >= 0;
  grblSt.coolantFlood = s.indexOf('F') >= 0;
  grblSt.coolantMist  = s.indexOf('M') >= 0;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Streaming Loop (character-counting flow control)
// ═══════════════════════════════════════════════════════════════════════════
void loopStream() {
  if (!stream.running || stream.paused || stream.done) return;
  if (!stream.file) { stream.running = false; return; }

  // Invia linee finché c'è spazio stimato nel buffer RX di GRBL
  while (stream.file.available()) {
    String line = stream.file.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;    // salta righe vuote

    int lineBytes = line.length() + 1;   // +1 per il '\n'

    // Aspetta se il buffer stimato è pieno
    if (stream.txInFlight + lineBytes > GRBL_RX_BUFFER_BYTES) break;

    sendCmd(line);
    stream.txInFlight += lineBytes;
    stream.pendingLen.push_back(lineBytes);
    stream.sent++;
    yield();
  }

  // Fine file
  if (!stream.file.available()) {
    stream.file.close();
    // Aspetta gli ultimi ack
    if (stream.pendingLen.empty()) {
      stream.running = false;
      stream.done    = true;
      JsonDocument doc;
      doc["type"]  = "stream_done";
      doc["total"] = stream.total;
      broadcastJson(doc);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Invio a GRBL
// ═══════════════════════════════════════════════════════════════════════════
void sendRaw(uint8_t b) {
  grblSerial.write(b);
}

void sendCmd(const String& cmd) {
  grblSerial.println(cmd);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Broadcast WebSocket
// ═══════════════════════════════════════════════════════════════════════════
void broadcastJson(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  wsServer.broadcastTXT(out);
}

void broadcastStatus() {
  String js = buildStatusJson();
  wsServer.broadcastTXT(js);
}

String buildStatusJson() {
  JsonDocument doc;
  doc["type"]  = "status";
  doc["state"] = grblSt.name;
  doc["alarm"] = grblSt.alarmCode;
  doc["hold"]  = grblSt.holdReason;

  JsonArray mp = doc["mpos"].to<JsonArray>();
  mp.add(grblSt.mpos[0]); mp.add(grblSt.mpos[1]); mp.add(grblSt.mpos[2]);
  JsonArray wp = doc["wpos"].to<JsonArray>();
  wp.add(grblSt.wpos[0]); wp.add(grblSt.wpos[1]); wp.add(grblSt.wpos[2]);
  JsonArray wc = doc["wco"].to<JsonArray>();
  wc.add(grblSt.wco[0]); wc.add(grblSt.wco[1]); wc.add(grblSt.wco[2]);

  doc["feed"]    = grblSt.feedRate;
  doc["spindle"] = grblSt.spindleRPM;

  JsonArray ov = doc["ov"].to<JsonArray>();
  ov.add(grblSt.ovFeed); ov.add(grblSt.ovRapid); ov.add(grblSt.ovSpindle);

  JsonObject pins = doc["pins"].to<JsonObject>();
  pins["lx"]  = grblSt.pinLX;
  pins["ly"]  = grblSt.pinLY;
  pins["lz"]  = grblSt.pinLZ;
  pins["prb"] = grblSt.pinProbe;
  pins["door"]= grblSt.pinDoor;
  pins["hold"]= grblSt.pinHold;
  pins["cs"]  = grblSt.pinCS;

  JsonObject acc = doc["acc"].to<JsonObject>();
  acc["spindle"] = grblSt.spindleOn;
  acc["flood"]   = grblSt.coolantFlood;
  acc["mist"]    = grblSt.coolantMist;

  doc["buf_pl"] = grblSt.plBuf;
  doc["buf_rx"] = grblSt.rxBuf;

  JsonObject st = doc["stream"].to<JsonObject>();
  st["running"] = stream.running;
  st["paused"]  = stream.paused;
  st["sent"]    = stream.sent;
  st["acked"]   = stream.acked;
  st["total"]   = stream.total;

  String out;
  serializeJson(doc, out);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Serve file da LittleFS
// ═══════════════════════════════════════════════════════════════════════════
void serveFile(const String& path, const String& mime) {
  if (!LittleFS.exists(path)) {
    httpServer.send(404, "text/plain",
      "File non trovato in LittleFS: " + path +
      "\nCaricare prima data/index.html con il plugin LittleFS Data Upload.");
    return;
  }
  File f = LittleFS.open(path, "r");
  httpServer.streamFile(f, mime);
  f.close();
}
