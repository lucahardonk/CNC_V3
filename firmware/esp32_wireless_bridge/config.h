#pragma once
// ═══════════════════════════════════════════════════════════════════════════
//  esp32_wireless_bridge — config.h
//  Scheda: NodeMCU 1.0 (ESP-12E, ESP8266). Modifica qui i parametri.
// ═══════════════════════════════════════════════════════════════════════════

// ── WiFi Access Point ───────────────────────────────────────────────────────
#define AP_SSID         "CNC-Remote"
#define AP_PASSWORD     "cnc12345"       // min 8 caratteri; "" = rete aperta
#define AP_CHANNEL      6
#define AP_IP_1         192
#define AP_IP_2         168
#define AP_IP_3         4
#define AP_IP_4         1

// ── Seriale verso GRBL ──────────────────────────────────────────────────────
//   RX  = UART0 HARDWARE spostata con Serial.swap() su GPIO13 (D7)
//         → ricezione affidabile anche con WiFi attivo (FIFO + buffer ISR)
//   TX  = SoftwareSerial solo-trasmissione su GPIO14 (D5)
//
//   Arduino TX (pin 1) → HV2 ⇄ LV2 → ESP D7 GPIO13  (RX)
//   Arduino RX (pin 0) → HV1 ⇄ LV1 → ESP D5 GPIO14  (TX)
//
//   GPIO15 (D8) NON va collegato: deve stare basso all'avvio dell'ESP.
#define GRBL_TX_PIN       14             // D5
#define GRBL_BAUD         115200         // GRBL 1.1h: fisso a 115200
#define GRBL_HW_RXBUF     2048           // buffer RX della UART hardware (byte)

// ── Debug (solo trasmissione) ───────────────────────────────────────────────
//   Dopo lo swap la USB non riceve più i log: vanno su Serial1 = GPIO2 (D4,
//   LED blu). Leggibili solo con un adattatore USB-seriale su D4.
//   La console della pagina web mostra comunque tutto il traffico GRBL.
#define DEBUG_BAUD        115200

// ── Polling status ──────────────────────────────────────────────────────────
#define STATUS_INTERVAL_MS  200          // ms tra un '?' e il successivo
#define GRBL_TIMEOUT_MS     2000         // nessuna risposta → "Disconnected"

// ── Streaming flow-control (character counting) ─────────────────────────────
#define GRBL_RX_BUFFER_BYTES  127        // buffer RX di GRBL 1.1h = 128 → 127 per sicurezza
#define PROGRESS_INTERVAL_MS  250        // frequenza aggiornamento progresso

// ── Web Server ──────────────────────────────────────────────────────────────
#define HTTP_PORT       80
#define WS_PORT         81
