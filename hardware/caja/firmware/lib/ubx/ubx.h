// Protocolo UBX de u-blox: lector de tramas byte a byte, armado de tramas y los dos mensajes que usa
// la caja (NAV-PVT, la posición y la velocidad; MON-VER, qué receptor es). C++ puro, sin Arduino: así
// se prueba en el ordenador (entorno `native` de PlatformIO).
//
// Trama: 0xB5 0x62, clase, id, longitud (uint16 LE), carga, CK_A, CK_B (Fletcher de 8 bits sobre
// clase..carga). Lo que no es UBX (las frases NMEA) se salta.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace ubx {

constexpr uint8_t SYNC1 = 0xB5;
constexpr uint8_t SYNC2 = 0x62;

constexpr uint8_t CLS_NAV = 0x01, ID_NAV_PVT = 0x07;
constexpr uint8_t CLS_ACK = 0x05, ID_ACK_NAK = 0x00, ID_ACK_ACK = 0x01;
constexpr uint8_t CLS_CFG = 0x06, ID_CFG_VALSET = 0x8A;
constexpr uint8_t CLS_MON = 0x0A, ID_MON_VER = 0x04;

// Claves de configuración (receptores M9 y M10, «CFG-VALSET»)
constexpr uint32_t KEY_I2COUTPROT_NMEA = 0x10720002;    // L: NMEA por el I2C
constexpr uint32_t KEY_MSGOUT_NAV_PVT_I2C = 0x20910006; // U1: NAV-PVT por el I2C cada N soluciones

struct Frame {
  uint8_t cls = 0;
  uint8_t id = 0;
  uint16_t len = 0;
  const uint8_t *payload = nullptr;
};

class Parser {
 public:
  static constexpr uint16_t MAX = 512;  // MON-VER con 10 extensiones ocupa 340
  // Mete un byte; true cuando acaba de completar una trama buena (está en frame())
  bool feed(uint8_t b);
  const Frame &frame() const { return frame_; }
  uint32_t badChecksums() const { return bad_; }
  uint32_t tooLong() const { return long_; }
  void reset() { state_ = 0; }

 private:
  uint8_t state_ = 0;
  uint8_t cls_ = 0, id_ = 0, ckA_ = 0, ckB_ = 0;
  uint16_t len_ = 0, pos_ = 0;
  uint8_t buf_[MAX];
  Frame frame_;
  uint32_t bad_ = 0, long_ = 0;
};

// Arma una trama en `out`; devuelve los bytes escritos (0 si no cabe)
size_t build(uint8_t cls, uint8_t id, const uint8_t *payload, uint16_t len, uint8_t *out, size_t cap);

// CFG-VALSET en la RAM del receptor (se pierde al apagarlo), con claves de 1 byte (tipos L y U1)
size_t buildValset1(const uint32_t *keys, const uint8_t *values, size_t n, uint8_t *out, size_t cap);

struct Pvt {
  uint32_t iTOW = 0;           // ms de la semana GPS
  uint16_t year = 0;
  uint8_t month = 0, day = 0, hour = 0, min = 0, sec = 0;
  uint8_t valid = 0;           // bit 0 fecha válida, bit 1 hora válida
  uint32_t tAcc = 0;           // ns
  int32_t nano = 0;            // ns
  uint8_t fixType = 0;         // 0 nada, 2 2D, 3 3D
  uint8_t flags = 0;           // bit 0 gnssFixOK
  uint8_t numSV = 0;
  int32_t lon = 0, lat = 0;    // 1e-7 grados
  int32_t height = 0, hMSL = 0; // mm
  uint32_t hAcc = 0, vAcc = 0; // mm
  int32_t velN = 0, velE = 0, velD = 0, gSpeed = 0; // mm/s
  int32_t headMot = 0;         // 1e-5 grados
  uint32_t sAcc = 0;           // mm/s
  uint32_t headAcc = 0;        // 1e-5 grados
  uint16_t pDOP = 0;           // 0,01
  bool fixOk() const { return (flags & 1) && fixType >= 3; }
};
bool parsePvt(const Frame &f, Pvt &out);

struct Version {
  char sw[31] = {0};   // «ROM SPG 4.04 (…)»
  char hw[11] = {0};   // «000A0000»
  char mod[24] = {0};  // de la extensión «MOD=…», p. ej. «NEO-M9N»
  char fw[24] = {0};   // de la extensión «FWVER=…», p. ej. «SPG 4.04»
};
bool parseVersion(const Frame &f, Version &out);

}  // namespace ubx
