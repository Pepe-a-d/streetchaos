// Prueba de banco de la caja DIY (hito H1). Comprueba, sin soldar nada, las tres piezas:
// - MICROSD: la abre en el modo de 4 hilos, escribe 1 MB, lo vuelve a leer y lo borra;
// - GPS (NEO-M9N, por el Qwiic en 0x42): que contesta en UBX, qué receptor es, satélites y posición;
// - SENSOR (ISM330DHCX, por el Qwiic en 0x6A): que contesta, que en reposo da la gravedad y giros
//   casi 0, y que al inclinarlo los números cambian.
// Cada segundo manda el informe por el USB (ver lib/banco). La página de la caja lo enseña.
// El LED de la placa: azul mientras prueba, verde si todo va bien, rojo si algo falla.
// Por el puerto acepta «PRUEBA» (repetir todo).
//
// Patillas: hardware/caja/conexiones.md, apartado 1.
#include <Arduino.h>
#include <SD_MMC.h>
#include <Wire.h>
#include <strings.h>

#include "banco.h"
#include "ubx.h"

#ifndef FW_VERSION
#define FW_VERSION "0.0.0"
#endif

namespace {

// Placa SparkFun Thing Plus ESP32-S3
constexpr int PIN_QWIIC_SD_ON = 45;  // alimentación del Qwiic y la microSD (3.3V_P): siempre en alto
constexpr int PIN_LED = 46;          // LED RGB
constexpr int PIN_SDA = 8, PIN_SCL = 9;
constexpr int SD_CLK = 38, SD_CMD = 34, SD_D0 = 39, SD_D1 = 40, SD_D2 = 47, SD_D3 = 33;

constexpr uint8_t GPS_ADDR = 0x42;
constexpr uint8_t IMU_ADDR = 0x6A, IMU_ADDR_ALT = 0x6B;
constexpr uint8_t IMU_WHO_AM_I = 0x0F, IMU_ID = 0x6B;
constexpr uint8_t IMU_CTRL1_XL = 0x10, IMU_CTRL2_G = 0x11, IMU_CTRL3_C = 0x12, IMU_OUTX_L_G = 0x22;
constexpr float ACC_MS2 = 0.244e-3f * 9.80665f;  // ±8 g
constexpr float GYRO_DPS = 35e-3f;               // ±1000 °/s

banco::Estado est;
banco::ImuCheck imuCheck;
ubx::Parser parser;
uint32_t gpsInicio = 0, gpsUltimoPvt = 0, gpsUltimaPeticion = 0;
bool gpsVersion = false;
char linea[64];
size_t lineaN = 0;

// ---------- I2C ----------

bool i2cResponde(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool i2cLeer(uint8_t addr, uint8_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = (uint8_t)Wire.read();
  return true;
}

bool i2cEscribir(uint8_t addr, uint8_t reg, uint8_t v) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

// ---------- LED ----------

void led() {
  const banco::St s[3] = {est.sd.st, est.gps.st, est.imu.st};
  bool falla = false, prueba = false;
  for (auto x : s) {
    falla |= x == banco::St::Falla;
    prueba |= x == banco::St::Prueba;
  }
  prueba |= !est.gps.fixOk || !est.imu.incl;
  if (falla) rgbLedWrite(PIN_LED, 24, 0, 0);
  else if (prueba) rgbLedWrite(PIN_LED, 0, 0, (millis() / 500) % 2 ? 24 : 4);
  else rgbLedWrite(PIN_LED, 0, 24, 0);
}

// ---------- microSD ----------

void probarSd() {
  banco::Sd &sd = est.sd;
  sd = banco::Sd();
  SD_MMC.end();
  if (!SD_MMC.setPins(SD_CLK, SD_CMD, SD_D0, SD_D1, SD_D2, SD_D3)) {
    sd.st = banco::St::Falla;
    sd.msg = "No se pueden asignar las patillas de la microSD (fallo del programa)";
    return;
  }
  if (!SD_MMC.begin("/sdcard", false, false)) {
    sd.st = banco::St::Falla;
    sd.msg = "No se puede abrir la tarjeta: métela hasta el fondo y comprueba que está en FAT32 (MS-DOS FAT)";
    return;
  }
  switch (SD_MMC.cardType()) {
    case CARD_NONE:
      sd.st = banco::St::Falla;
      sd.msg = "No hay tarjeta";
      return;
    case CARD_MMC: strcpy(sd.tipo, "MMC"); break;
    case CARD_SD: strcpy(sd.tipo, "SD"); break;
    case CARD_SDHC: strcpy(sd.tipo, "SDHC"); break;
    default: strcpy(sd.tipo, "?"); break;
  }
  sd.gb = SD_MMC.cardSize() / 1e9f;

  // 1 MB con un patrón que cambia en cada bloque, para que no valga una tarjeta que devuelve siempre lo mismo
  static uint8_t buf[4096];
  constexpr int BLOQUES = 256;
  const char *ruta = "/prueba-caja.bin";
  File f = SD_MMC.open(ruta, FILE_WRITE);
  if (!f) {
    sd.st = banco::St::Falla;
    sd.msg = "No deja crear un archivo: ¿está protegida contra escritura o llena?";
    return;
  }
  const uint32_t t0 = millis();
  bool bien = true;
  for (int b = 0; b < BLOQUES && bien; b++) {
    for (size_t i = 0; i < sizeof buf; i++) buf[i] = (uint8_t)(i * 31 + b * 7);
    bien = f.write(buf, sizeof buf) == sizeof buf;
  }
  f.close();
  const uint32_t ms = millis() - t0;
  if (!bien) {
    SD_MMC.remove(ruta);
    sd.st = banco::St::Falla;
    sd.msg = "Falla al escribir: ¿está llena?";
    return;
  }
  sd.mbs = ms ? (BLOQUES * sizeof buf / 1048576.0f) / (ms / 1000.0f) : 0;

  f = SD_MMC.open(ruta, FILE_READ);
  for (int b = 0; b < BLOQUES && bien && f; b++) {
    bien = f.read(buf, sizeof buf) == sizeof buf;
    for (size_t i = 0; i < sizeof buf && bien; i++) bien = buf[i] == (uint8_t)(i * 31 + b * 7);
  }
  if (!f) bien = false;
  f.close();
  SD_MMC.remove(ruta);
  if (!bien) {
    sd.st = banco::St::Falla;
    sd.msg = "Lo que se lee no es lo que se escribió: prueba con otra tarjeta";
    return;
  }
  sd.st = banco::St::Ok;
}

// ---------- Sensor ----------

void probarImu() {
  banco::Imu &imu = est.imu;
  imu = banco::Imu();
  uint8_t id = 0;
  if (i2cLeer(IMU_ADDR, IMU_WHO_AM_I, &id, 1)) {
    if (id != IMU_ID) {
      imu.st = banco::St::Falla;
      imu.msg = "En 0x6A contesta otra cosa, no un ISM330DHCX";
      return;
    }
  } else {
    imu.st = banco::St::Falla;
    imu.msg = i2cLeer(IMU_ADDR_ALT, IMU_WHO_AM_I, &id, 1) && id == IMU_ID
                  ? "Contesta en 0x6B, y la caja lo espera en 0x6A: deja el puente ADR del sensor como viene"
                  : "No contesta por el Qwiic (0x6A): revisa el cable entre el GPS y el sensor";
    return;
  }
  imu.addr = IMU_ADDR;
  // Reinicio, lectura en bloque (BDU) y direcciones seguidas; 104 Hz, ±8 g y ±1000 °/s
  i2cEscribir(IMU_ADDR, IMU_CTRL3_C, 0x01);
  delay(20);
  bool bien = i2cEscribir(IMU_ADDR, IMU_CTRL3_C, 0x44) && i2cEscribir(IMU_ADDR, IMU_CTRL1_XL, 0x4C) && i2cEscribir(IMU_ADDR, IMU_CTRL2_G, 0x48);
  if (!bien) {
    imu.st = banco::St::Falla;
    imu.msg = "Contesta pero no deja configurarlo";
    return;
  }
  delay(100);
  imuCheck.reset(millis());
}

void leerImu() {
  banco::Imu &imu = est.imu;
  if (!imu.addr) return;
  uint8_t b[12];
  if (!i2cLeer(IMU_ADDR, IMU_OUTX_L_G, b, sizeof b)) {
    imu.st = banco::St::Falla;
    imu.msg = "Ha dejado de contestar: ¿se ha soltado el cable?";
    return;
  }
  auto s16 = [&](int i) { return (int16_t)(b[i] | (b[i + 1] << 8)); };
  for (int k = 0; k < 3; k++) {
    imu.g[k] = s16(k * 2) * GYRO_DPS;
    imu.a[k] = s16(6 + k * 2) * ACC_MS2;
  }
  imuCheck.sample(imu.a, imu.g, millis());
  imu.st = imuCheck.st();
  imu.msg = imuCheck.msg();
  imu.incl = imuCheck.incl();
}

// ---------- GPS ----------

void gpsEnviar(const uint8_t *data, size_t n) {
  Wire.beginTransmission(GPS_ADDR);
  Wire.write(data, n);
  Wire.endTransmission();
}

void gpsPedir(uint8_t cls, uint8_t id) {
  uint8_t f[8];
  const size_t n = ubx::build(cls, id, nullptr, 0, f, sizeof f);
  gpsEnviar(f, n);
}

void iniciarGps() {
  banco::Gps &gps = est.gps;
  gps = banco::Gps();
  gpsVersion = false;
  gpsInicio = millis();
  gpsUltimoPvt = 0;
  parser.reset();
  if (!i2cResponde(GPS_ADDR)) {
    gps.st = banco::St::Falla;
    gps.msg = "No contesta por el Qwiic (0x42): revisa el cable entre la placa y el GPS";
    return;
  }
  // Sin NMEA por el I2C y con NAV-PVT en cada solución (1 por segundo)
  const uint32_t keys[2] = {ubx::KEY_I2COUTPROT_NMEA, ubx::KEY_MSGOUT_NAV_PVT_I2C};
  const uint8_t vals[2] = {0, 1};
  uint8_t f[32];
  gpsEnviar(f, ubx::buildValset1(keys, vals, 2, f, sizeof f));
  gpsPedir(ubx::CLS_MON, ubx::ID_MON_VER);
  gpsUltimaPeticion = millis();
}

void gpsTrama(const ubx::Frame &fr) {
  banco::Gps &gps = est.gps;
  ubx::Version v;
  ubx::Pvt p;
  if (ubx::parseVersion(fr, v)) {
    gpsVersion = true;
    strncpy(gps.mod, v.mod[0] ? v.mod : "?", sizeof gps.mod - 1);
    strncpy(gps.fw, v.fw[0] ? v.fw : v.sw, sizeof gps.fw - 1);
    if (v.mod[0] && !strstr(v.mod, "M9N")) {
      gps.st = banco::St::Falla;
      gps.msg = "Contesta, pero no es un NEO-M9N: mira el modelo en la placa del GPS";
    } else {
      gps.st = banco::St::Ok;
      gps.msg = v.mod[0] ? "" : "No dice el modelo";
    }
    Serial.printf("GPS: %s, %s (%s)\n", gps.mod, gps.fw, v.hw);
  } else if (ubx::parsePvt(fr, p)) {
    gpsUltimoPvt = millis();
    gps.pvt = true;
    gps.fix = p.fixType;
    gps.fixOk = p.fixOk();
    gps.sats = p.numSV;
    gps.hacc = p.hAcc / 1000.0f;
    if (gps.fixOk && gps.ttff < 0) {
      gps.ttff = (int32_t)((millis() - gpsInicio) / 1000);
      Serial.printf("GPS: primera posición en %ld s, %u satélites\n", (long)gps.ttff, (unsigned)gps.sats);
    }
  }
}

void leerGps() {
  banco::Gps &gps = est.gps;
  if (gps.st == banco::St::Falla && !gpsVersion) return;
  uint8_t nb[2];
  if (!i2cLeer(GPS_ADDR, 0xFD, nb, 2)) return;
  uint16_t n = (uint16_t)((nb[0] << 8) | nb[1]);
  if (n == 0xFFFF) n = 0;  // el receptor dice «no sé»
  while (n > 0) {
    const uint8_t pide = n > 64 ? 64 : (uint8_t)n;
    Wire.beginTransmission(GPS_ADDR);
    Wire.write((uint8_t)0xFF);
    if (Wire.endTransmission(false) != 0) return;
    const int got = Wire.requestFrom((int)GPS_ADDR, (int)pide);
    if (got <= 0) return;
    for (int i = 0; i < got; i++)
      if (parser.feed((uint8_t)Wire.read())) gpsTrama(parser.frame());
    n -= (uint16_t)got;
  }
  const uint32_t ahora = millis();
  if (!gpsVersion) {
    if (ahora - gpsInicio > 4000) {
      gps.st = banco::St::Falla;
      gps.msg = "Contesta por el Qwiic pero no habla UBX: ¿es un GPS de u-blox?";
    } else if (ahora - gpsUltimaPeticion > 1000) {
      gpsPedir(ubx::CLS_MON, ubx::ID_MON_VER);
      gpsUltimaPeticion = ahora;
    }
  } else if (ahora - gpsUltimoPvt > 1500 && ahora - gpsUltimaPeticion > 1000) {
    // Si no llegan solas (configuración que no entró), se piden
    gpsPedir(ubx::CLS_NAV, ubx::ID_NAV_PVT);
    gpsUltimaPeticion = ahora;
  }
}

// ---------- Informe ----------

void informe() {
  static char buf[640];
  est.fw = FW_VERSION;
  est.up = millis() / 1000;
  if (banco::informe(est, buf, sizeof buf)) Serial.println(buf);
}

void resumen() {
  Serial.printf("MICROSD: %s %s %s %.1f GB %.1f MB/s\n", banco::stName(est.sd.st), est.sd.msg, est.sd.tipo, est.sd.gb, est.sd.mbs);
  Serial.printf("GPS: %s %s %s\n", banco::stName(est.gps.st), est.gps.msg, est.gps.mod);
  Serial.printf("SENSOR: %s %s\n", banco::stName(est.imu.st), est.imu.msg);
}

void probarTodo() {
  rgbLedWrite(PIN_LED, 0, 0, 24);
  Serial.println("Prueba de banco de la caja DIY " FW_VERSION);
  probarSd();
  probarImu();
  iniciarGps();
  resumen();
  informe();
}

void leerOrden() {
  while (Serial.available()) {
    const int c = Serial.read();
    if (c == '\n' || c == '\r') {
      linea[lineaN] = 0;
      if (lineaN && !strcasecmp(linea, "PRUEBA")) probarTodo();
      lineaN = 0;
    } else if (lineaN + 1 < sizeof linea) {
      linea[lineaN++] = (char)c;
    }
  }
}

}  // namespace

void setup() {
  pinMode(PIN_QWIIC_SD_ON, OUTPUT);
  digitalWrite(PIN_QWIIC_SD_ON, HIGH);
  // Sin el Mac conectado, que escribir por el USB no pare el programa
  Serial.setTxTimeoutMs(0);
  Serial.begin(115200);
  delay(200);
  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  probarTodo();
}

void loop() {
  static uint32_t tImu = 0, tInforme = 0, tLed = 0;
  const uint32_t ahora = millis();
  leerOrden();
  leerGps();
  if (ahora - tImu >= 20) {  // 50 Hz
    tImu = ahora;
    leerImu();
  }
  if (ahora - tLed >= 100) {
    tLed = ahora;
    led();
  }
  if (ahora - tInforme >= 1000) {
    tInforme = ahora;
    informe();
  }
  delay(2);
}
