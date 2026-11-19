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
//   TX  = Serial1 HARDWARE (UART1, solo trasmissione) su GPIO2 (D4)
//         → nessun bit-banging software, timing preciso anche con WiFi
//
//   Arduino TX (pin 1) → HV2 ⇄ LV2 → ESP D7 GPIO13  (RX)
//   Arduino RX (pin 0) → HV1 ⇄ LV1 → ESP D4 GPIO2   (TX, Serial1)
//
//   GPIO15 (D8) NON va collegato: deve stare basso all'avvio dell'ESP.
//   GPIO2 (D4) deve essere alto all'avvio: la linea TX a riposo è alta, ok.
//   Il LED blu della scheda (su D4) lampeggia durante la trasmissione.
#define GRBL_BAUD         115200         // GRBL 1.1h: fisso a 115200
#define GRBL_HW_RXBUF     2048           // buffer RX della UART hardware (byte)

// Debug seriale eliminato: la console della pagina web mostra tutto il
// traffico GRBL e i messaggi del bridge.

// ── Polling status ──────────────────────────────────────────────────────────
#define STATUS_INTERVAL_MS  200          // ms tra un '?' e il successivo
#define GRBL_TIMEOUT_MS     2000         // nessuna risposta → "Disconnected"

// ── Streaming flow-control (character counting) ─────────────────────────────
#define GRBL_RX_BUFFER_BYTES  127        // buffer RX di GRBL 1.1h = 128 → 127 per sicurezza
#define PROGRESS_INTERVAL_MS  250        // frequenza aggiornamento progresso

// ── Web Server ──────────────────────────────────────────────────────────────
#define HTTP_PORT       80
#define WS_PORT         81

// ═══════════════════════════════════════════════════════════════════════════
//  CNC Luca - valori misurati 2026-11-18  (GRBL 1.1h, Arduino Uno)
//  Parametri $$ reali della macchina, solo come riferimento/ripristino.
//  Il firmware NON li invia automaticamente a GRBL.
// ═══════════════════════════════════════════════════════════════════════════
#define GRBL_DEFAULT_STEP_PULSE_US        8       // $0
#define GRBL_DEFAULT_STEP_IDLE_DELAY_MS   25      // $1
#define GRBL_DEFAULT_STEP_PORT_INVERT     0       // $2
#define GRBL_DEFAULT_DIR_PORT_INVERT      0       // $3
#define GRBL_DEFAULT_STEP_ENABLE_INVERT   0       // $4
#define GRBL_DEFAULT_LIMIT_PINS_INVERT    0       // $5
#define GRBL_DEFAULT_PROBE_PIN_INVERT     0       // $6
#define GRBL_DEFAULT_STATUS_REPORT        1       // $10
#define GRBL_DEFAULT_JUNCTION_DEV_MM      0.010   // $11
#define GRBL_DEFAULT_ARC_TOLERANCE_MM     0.002   // $12
#define GRBL_DEFAULT_REPORT_INCHES        0       // $13
#define GRBL_DEFAULT_SOFT_LIMITS          0       // $20
#define GRBL_DEFAULT_HARD_LIMITS          0       // $21
#define GRBL_DEFAULT_HOMING_ENABLE        1       // $22
#define GRBL_DEFAULT_HOMING_DIR_INVERT    0       // $23
#define GRBL_DEFAULT_HOMING_FEED          600     // $24  mm/min
#define GRBL_DEFAULT_HOMING_SEEK          200     // $25  mm/min
#define GRBL_DEFAULT_HOMING_DEBOUNCE_MS   10      // $26
#define GRBL_DEFAULT_HOMING_PULLOFF_MM    2.0     // $27
#define GRBL_DEFAULT_SPINDLE_MAX_RPM      24000   // $30
#define GRBL_DEFAULT_SPINDLE_MIN_RPM      0       // $31
#define GRBL_DEFAULT_LASER_MODE           0       // $32
#define GRBL_DEFAULT_X_STEPS_PER_MM       1600    // $100
#define GRBL_DEFAULT_Y_STEPS_PER_MM       1600    // $101
#define GRBL_DEFAULT_Z_STEPS_PER_MM       1600    // $102
#define GRBL_DEFAULT_X_MAX_RATE           1500    // $110 mm/min
#define GRBL_DEFAULT_Y_MAX_RATE           1500    // $111 mm/min
#define GRBL_DEFAULT_Z_MAX_RATE           1500    // $112 mm/min
#define GRBL_DEFAULT_X_ACCEL              200     // $120 mm/s²
#define GRBL_DEFAULT_Y_ACCEL              200     // $121 mm/s²
#define GRBL_DEFAULT_Z_ACCEL              200     // $122 mm/s²
#define GRBL_DEFAULT_X_MAX_TRAVEL         1000    // $130 mm
#define GRBL_DEFAULT_Y_MAX_TRAVEL         1000    // $131 mm
#define GRBL_DEFAULT_Z_MAX_TRAVEL         300     // $132 mm
