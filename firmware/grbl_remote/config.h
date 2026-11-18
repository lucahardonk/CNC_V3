#pragma once
// ═══════════════════════════════════════════════════════════════════════════
//  GRBL-Remote v1.0  —  config.h
//  Modifica qui tutti i parametri prima di compilare.
// ═══════════════════════════════════════════════════════════════════════════

// ── WiFi Access Point ───────────────────────────────────────────────────────
#define AP_SSID         "CNC-Remote"
#define AP_PASSWORD     "cnc12345"       // min 8 caratteri; "" = rete aperta
#define AP_CHANNEL      6
#define AP_IP_1         192
#define AP_IP_2         168
#define AP_IP_3         4
#define AP_IP_4         1

// ── GRBL Serial (SoftwareSerial su D6/D5) ──────────────────────────────────
//   Arduino TX (pin 1) → LevelShifter → ESP D6 GPIO12  (RX)
//   Arduino RX (pin 0) → LevelShifter → ESP D5 GPIO14  (TX)
#define GRBL_RX_PIN     12               // D6 — riceve da Arduino TX
#define GRBL_TX_PIN     14               // D5 — invia ad Arduino RX
#define GRBL_BAUD       115200
// Buffer SoftwareSerial — aumenta se perdi caratteri
#define GRBL_SW_RXBUF   256   // byte ricevuti già decodificati (ISR ~10 KB heap)
#define GRBL_SW_ISRBUF  0     // fronti ISR: 0 = automatico (RXBUF x 10)

// ── Polling status ──────────────────────────────────────────────────────────
#define STATUS_INTERVAL_MS  150          // ms tra un '?' e il successivo

// ── Streaming flow-control ──────────────────────────────────────────────────
#define GRBL_RX_BUFFER_BYTES  128        // buffer RX di GRBL (valore GRBL default)

// ── Web Server ──────────────────────────────────────────────────────────────
#define HTTP_PORT       80
#define WS_PORT         81

// ── Dimensioni macchina (usate dal visualizzatore per la griglia) ───────────
//   Corrispondono a $130, $131, $132 in GRBL
#define MACHINE_X_MM    300.0f
#define MACHINE_Y_MM    200.0f
#define MACHINE_Z_MM    80.0f
